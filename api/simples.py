"""Leitura autenticada do extrato: OCR integral, 2.2 exclusiva, PDF pesquisável efêmero."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
import base64
import hashlib
import json
import os
import re
import uuid

from reporting.core import ReportError, allowed_origin, require, session_hash, utcnow
from reporting.service import database, authenticate, rate_limit
from reporting.simples import convert_statement_pdf, PARSER_VERSION

# Below the serverless request/response payload ceiling. The local CLI accepts 8 MiB.
MAX_PDF_BYTES = 4 * 1024 * 1024
MAX_RETURN_PDF_BYTES = 2_500_000
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        for name, value in [('Content-Type', 'application/json; charset=utf-8'), ('Cache-Control', 'no-store'),
                            ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'no-referrer'),
                            ('X-Request-Id', self.request_id), ('Content-Length', str(len(content)))]:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(content)

    def context(self):
        session_hash(self.headers)
        db, workspace = database(), os.getenv('WORKSPACE_ID', 'maximum')
        actor = authenticate(db, self.headers, workspace)
        query = parse_qs(urlsplit(self.path).query)
        client_id = (query.get('clientId') or [''])[0]
        require(UUID.fullmatch(client_id), 400, 'CLIENT', 'Selecione a empresa antes de ler o extrato.')
        return db, workspace, actor, query, client_id

    def error(self, error):
        if isinstance(error, ReportError):
            status, code, message = error.status, error.code, str(error)
        elif isinstance(error, ValueError):
            status, code, message = 422, 'SIMPLES_PDF', str(error)
        else:
            status, code, message = 503, 'SIMPLES_UNAVAILABLE', 'Não foi possível concluir a leitura da seção 2.2. Tente novamente com um PDF legível; a projeção não substitui a RBT12.'
        print(json.dumps({'requestId': self.request_id, 'code': code, 'status': status, 'errorType': type(error).__name__}))
        self.send_json(status, {'error': code, 'message': message, 'requestId': self.request_id})

    def do_GET(self):
        self.request_id = str(uuid.uuid4())
        try:
            db, workspace, actor, query, client_id = self.context()
            extraction_id = (query.get('extractionId') or [''])[0]
            require(UUID.fullmatch(extraction_id), 400, 'RBT12_EXTRACTION', 'Selecione uma leitura do extrato.')
            record = db.simplesExtractions.find_one({'_id': extraction_id, 'workspaceId': workspace, 'clientId': client_id})
            require(record and record.get('parserVersion') == PARSER_VERSION, 409, 'RBT12_EXTRACTION', 'Leia novamente o PDF: é necessária a conferência exclusiva da seção 2.2.')
            self.send_json(200, {'extractionId': extraction_id, 'clientId': client_id, 'fileName': record['fileName'], **record['result']})
        except Exception as error:
            self.error(error)

    def do_POST(self):
        self.request_id = str(uuid.uuid4())
        try:
            require(allowed_origin(self.headers), 403, 'ORIGIN', 'Origem da requisição não autorizada.')
            session_hash(self.headers)
            require(self.headers.get('Content-Type', '').split(';')[0].lower() == 'application/pdf', 415, 'CONTENT_TYPE', 'Envie o Extrato do Simples em PDF.')
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            require(0 < size <= MAX_PDF_BYTES, 413, 'PDF_LIMIT', 'O envio web aceita PDFs de até 4 MiB. Para arquivos maiores, utilize o conversor Python local.')
            db, workspace, actor, query, client_id = self.context()
            rate_limit(db, actor['_id'], workspace, False)
            file_name = (query.get('fileName') or ['extrato-simples.pdf'])[0][:200]
            client = db.clients.find_one({'_id': client_id, 'workspaceId': workspace, 'active': True}, {'_id': 1, 'name': 1, 'code': 1, 'cnpj': 1})
            require(client, 404, 'CLIENT', 'Empresa não encontrada neste ambiente.')
            content = self.rfile.read(size)
            require(len(content) == size, 400, 'PDF_INCOMPLETE', 'O envio do PDF ficou incompleto. Reenvie o arquivo.')
            result, searchable, _ = convert_statement_pdf(content)
            registered = re.sub(r'[^A-Z0-9]', '', str(client.get('cnpj') or '').upper())
            if registered:
                require(registered[:8] == result['cnpjBasico'], 422, 'RBT12_COMPANY', 'O CNPJ básico do extrato não corresponde à empresa selecionada. Nenhuma RBT12 foi vinculada.')
            else:
                result['warnings'].append('A empresa não tem CNPJ cadastrado para comparação automática. Confira o nome e o CNPJ básico do extrato antes de simular.')
            extraction_id = str(uuid.uuid4())
            record = {'_id': extraction_id, 'workspaceId': workspace, 'clientId': client_id,
                      'createdBy': actor['_id'], 'createdAt': utcnow(), 'parserVersion': PARSER_VERSION,
                      'fileName': file_name, 'fileSha256': hashlib.sha256(content).hexdigest(), 'result': result}
            db.simplesExtractions.insert_one(record)
            # No PDF, OCR full text or base64 is persisted in MongoDB.
            response = {'extractionId': extraction_id, 'clientId': client_id, 'fileName': file_name,
                        'company': {'code': client.get('code'), 'name': client.get('name')}, **result}
            if len(searchable) <= MAX_RETURN_PDF_BYTES:
                response['searchablePdfBase64'] = base64.b64encode(searchable).decode('ascii')
            else:
                response['downloadNotice'] = 'A conversão foi concluída, mas o PDF pesquisável ultrapassa o limite de retorno web. O conversor Python local permite salvá-lo.'
            self.send_json(200, response)
        except Exception as error:
            self.error(error)
