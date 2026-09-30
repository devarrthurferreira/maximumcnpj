"""Endpoint autenticado para extrair RBT12 do Extrato do Simples Nacional sem armazenar o PDF."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
import hashlib
import json
import os
import uuid

from reporting.core import ReportError, allowed_origin, require, session_hash, utcnow
from reporting.service import database, authenticate, rate_limit
from reporting.simples import extract_statement_pdf, PARSER_VERSION

MAX_PDF_BYTES = 8 * 1024 * 1024


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Request-Id', self.request_id)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        self.request_id = str(uuid.uuid4())
        self.send_json(405, {'error': 'METHOD_NOT_ALLOWED', 'message': 'Envie o extrato em PDF pelo simulador.'})

    def do_POST(self):
        self.request_id = str(uuid.uuid4())
        try:
            require(allowed_origin(self.headers), 403, 'ORIGIN', 'Origem da requisição não autorizada.')
            session_hash(self.headers)
            content_type = self.headers.get('Content-Type', '').split(';')[0].lower()
            require(content_type == 'application/pdf', 415, 'CONTENT_TYPE', 'Envie o Extrato do Simples em PDF.')
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            require(0 < size <= MAX_PDF_BYTES, 413, 'PDF_LIMIT', 'O PDF deve ter no máximo 8 MiB.')
            query = parse_qs(urlsplit(self.path).query)
            client_id = (query.get('clientId') or [''])[0]
            file_name = (query.get('fileName') or ['extrato-simples.pdf'])[0][:200]
            require(isinstance(client_id, str) and len(client_id) == 36, 400, 'CLIENT', 'Selecione a empresa antes de ler o extrato.')

            db = database()
            workspace = os.getenv('WORKSPACE_ID', 'maximum')
            actor = authenticate(db, self.headers, workspace)
            rate_limit(db, actor['_id'], workspace, False)
            client = db.clients.find_one({'_id': client_id, 'workspaceId': workspace, 'active': True}, {'_id': 1, 'name': 1, 'code': 1})
            require(client, 404, 'CLIENT', 'Empresa não encontrada neste ambiente.')

            content = self.rfile.read(size)
            result = extract_statement_pdf(content)
            extraction_id = str(uuid.uuid4())
            record = {
                '_id': extraction_id, 'workspaceId': workspace, 'clientId': client_id,
                'createdBy': actor['_id'], 'createdAt': utcnow(), 'parserVersion': PARSER_VERSION,
                'fileName': file_name, 'fileSha256': hashlib.sha256(content).hexdigest(),
                'result': result,
            }
            db.simplesExtractions.insert_one(record)
            self.send_json(200, {'extractionId': extraction_id, 'clientId': client_id, 'company': {'code': client.get('code'), 'name': client.get('name')}, **result})
        except Exception as error:
            if isinstance(error, ReportError):
                status, code, message = error.status, error.code, str(error)
            elif isinstance(error, ValueError):
                status, code, message = 422, 'SIMPLES_PDF', str(error)
            else:
                status, code, message = 503, 'SIMPLES_UNAVAILABLE', 'Não foi possível ler o extrato agora. Tente novamente ou informe a RBT12 manualmente.'
            print(json.dumps({'requestId': self.request_id, 'code': code, 'status': status, 'errorType': type(error).__name__}))
            self.send_json(status, {'error': code, 'message': message, 'requestId': self.request_id})
