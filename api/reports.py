"""Vercel Python function. Node.js remains responsible for login/import/consultation."""
from http.server import BaseHTTPRequestHandler
import json
import os
import uuid
from reporting.core import (ReportError, require, allowed_origin, validate, iso, csv_bytes,
                          PAGE_SIZE, PDF_PART_SIZE, CSV_PART_SIZE, MAX_RESPONSE_BYTES)
from reporting.service import database, authenticate, rate_limit, get_job, jobs, metadata, result_rows

class handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log cookies, request bodies or customer data.

    def send(self, status, content, media='application/json; charset=utf-8', filename=None):
        self.send_response(status)
        self.send_header('Content-Type', media)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Report-Engine', 'python')
        self.send_header('X-Request-Id', self.request_id)
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Length', str(len(content)))
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        self.request_id = str(uuid.uuid4())
        self.send(405, b'{"error":"METHOD_NOT_ALLOWED","message":"Utilize o painel autenticado para gerar relatorios."}')

    def do_POST(self):
        self.request_id = str(uuid.uuid4())
        try:
            require(allowed_origin(self.headers), 403, 'ORIGIN', 'Origem da requisição não autorizada.')
            # Reject malformed/no session before opening a database connection.
            from reporting.core import session_hash
            session_hash(self.headers)
            require(self.headers.get('Content-Type', '').split(';')[0] == 'application/json', 415, 'CONTENT_TYPE', 'Envie JSON.')
            try: size = int(self.headers.get('Content-Length', '0'))
            except ValueError: size = 0
            require(0 < size <= 4096, 413, 'PAYLOAD_LIMIT', 'Pedido de relatório inválido ou acima do limite.')
            try: payload = json.loads(self.rfile.read(size))
            except (ValueError, UnicodeError): raise ReportError(400, 'INVALID_JSON', 'JSON inválido.')
            options = validate(payload)
            workspace = os.getenv('WORKSPACE_ID', 'maximum')
            db = database()
            actor = authenticate(db, self.headers, workspace)
            action = options['action']
            rate_limit(db, actor['_id'], workspace, action in ('pdf', 'csv'))
            if action == 'jobs':
                return self.send(200, json.dumps(jobs(db, workspace, options['clientId'], options['page']), default=iso, ensure_ascii=False).encode())
            job = get_job(db, options['jobId'], workspace, options['clientId'])
            if job.get('mode') == 'PURCHASES_V1':
                # A purchase snapshot must never fall through to a quantity-only export.
                require(options['clientId'] == job.get('clientId'), message='Selecione a empresa do relatório de compras.')
                require(action == 'pdf' and options['layout'] == 'summary' and options['status'] == 'ALL' and
                        options['kind'] == 'ALL' and options['part'] == 1,
                        400, 'PURCHASE_REPORT_MODE', 'Use o resumo PDF na área de Compras; os CSVs ficam nessa mesma área.')
                from reporting.purchases import purchase_metadata, render_purchase_pdf
                purchase_meta = purchase_metadata(db, job, workspace)
                content = render_purchase_pdf(purchase_meta)
                require(len(content) <= MAX_RESPONSE_BYTES, 413, 'REPORT_TOO_LARGE', 'Relatório de compras acima do limite de resposta.')
                code = ''.join(c for c in str(job.get('clientCode') or 'empresa') if c.isascii() and c.isalnum())[:20]
                return self.send(200, content, 'application/pdf', f'compras-{code}-{job["_id"]}-resumo.pdf')
            # Validate completed count before any final report, including exports.
            meta = metadata(db, job, workspace, options['kind'])
            if action == 'summary':
                return self.send(200, json.dumps(meta, default=iso, ensure_ascii=False).encode())
            size = PAGE_SIZE if action == 'rows' else PDF_PART_SIZE if action == 'pdf' else CSV_PART_SIZE
            page = options['page'] if action == 'rows' else options['part']
            result = result_rows(db, job['_id'], workspace, options, size, page)
            if action == 'rows':
                content, media, filename = json.dumps(result, default=iso, ensure_ascii=False).encode(), 'application/json; charset=utf-8', None
            else:
                code = str(job.get('clientCode') or 'sem-codigo')
                code = ''.join(c for c in code if c.isascii() and c.isalnum())[:20]
                stem = f'{code}-{job["_id"]}-{options["kind"]}-{options["status"]}'
                if action == 'pdf':
                    from reporting.pdf import render_pdf
                    content = render_pdf(meta, result, options)
                    part = 'resumo' if options['layout'] == 'summary' else f'parte-{page}-de-{result["parts"]}'
                    media, filename = 'application/pdf', f'{stem}-{part}.pdf'
                else:
                    content = csv_bytes(job, result['items'])
                    media, filename = 'text/csv; charset=utf-8', f'{stem}-parte-{page}-de-{result["parts"]}.csv'
                require(len(content) <= MAX_RESPONSE_BYTES, 413, 'REPORT_TOO_LARGE', 'Arquivo acima do limite. Selecione um tipo ou enquadramento menor.')
            self.send(200, content, media, filename)
        except Exception as error:
            if isinstance(error, ReportError):
                status, code, message = error.status, error.code, str(error)
            else:
                status, code, message = 503, 'REPORT_UNAVAILABLE', 'Não foi possível gerar o relatório. Confira a conexão com MongoDB e tente novamente.'
            print(json.dumps({'requestId': self.request_id, 'code': code, 'status': status, 'errorType': type(error).__name__}))
            self.send(status, json.dumps({'error': code, 'message': message, 'requestId': self.request_id}, ensure_ascii=False).encode())
