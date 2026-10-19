"""Leitura autenticada da identificação e seção 2.2, preservando o PDF completo."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs, unquote
from datetime import timedelta
import base64
import hashlib
import json
import os
import re
import uuid
import requests

from reporting.core import ReportError, allowed_origin, require, session_hash, utcnow
from reporting.service import database, authenticate, rate_limit
from reporting.simples import convert_statement_pdf, PARSER_VERSION

# Below the serverless request/response payload ceiling. The local CLI accepts 8 MiB.
MAX_DIRECT_PDF_BYTES = 4 * 1024 * 1024
MAX_BLOB_PDF_BYTES = 8 * 1024 * 1024
MAX_RETURN_PDF_BYTES = 2_500_000
# Longer than the 300 s function budget; expired claims remain recoverable after a hard timeout.
PROCESSING_LEASE_SECONDS = 330
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')

def _blob_signed_url(value, expected_path, operation='get'):
    require(isinstance(value, str) and len(value) < 6000, 400, 'BLOB_URL', 'URL temporária do documento inválida.')
    try:
        parsed = urlsplit(value)
        port = parsed.port
        query = parse_qs(parsed.query, keep_blank_values=True)
    except ValueError:
        raise ReportError(400, 'BLOB_URL', 'URL temporária do documento inválida.')
    require(parsed.scheme == 'https' and port in (None, 443) and not parsed.username and not parsed.password and not parsed.fragment,
            400, 'BLOB_URL', 'Origem do documento armazenado inválida.')
    # SDK 2.8 signs reads on the private storage host and writes on the Blob API.
    # The write pathname is a query parameter, not the URL path.
    if operation == 'get':
        valid_host = bool(re.fullmatch(r'[a-z0-9-]+\.private\.blob\.vercel-storage\.com', parsed.hostname or ''))
        matches_path = unquote(parsed.path.removeprefix('/')) == expected_path
    elif operation == 'put':
        valid_host = parsed.hostname == 'vercel.com'
        matches_path = parsed.path == '/api/blob/' and query.get('pathname') == [expected_path]
    else:
        raise ReportError(400, 'BLOB_URL', 'Operação do documento inválida.')
    require(valid_host, 400, 'BLOB_URL', 'Origem do documento armazenado inválida.')
    require(matches_path and all(len(query.get(key, [])) == 1 and query[key][0]
                                for key in ('vercel-blob-signature', 'vercel-blob-delegation')),
            400, 'BLOB_URL', 'A URL temporária não corresponde ao documento selecionado.')
    return value


def _download_blob(url):
    try:
        response = requests.get(url, timeout=(5, 25), allow_redirects=False)
    except requests.RequestException:
        raise ReportError(503, 'BLOB_READ', 'Não foi possível recuperar o PDF original armazenado. Tente reprocessar.') from None
    require(response.status_code == 200, 422, 'BLOB_READ', 'Não foi possível recuperar o PDF original armazenado. Reenvie ou tente reprocessar.')
    require(response.headers.get('content-type', '').split(';')[0].lower() == 'application/pdf',
            422, 'BLOB_PDF', 'O arquivo armazenado não foi identificado como PDF.')
    require(0 < len(response.content) <= MAX_BLOB_PDF_BYTES, 413, 'PDF_LIMIT', 'O PDF armazenado excede 8 MiB.')
    return response.content


def _upload_searchable(url, content):
    try:
        response = requests.put(url, data=content, headers={'Content-Type': 'application/pdf'}, timeout=(5, 30), allow_redirects=False)
    except requests.RequestException:
        raise ReportError(503, 'BLOB_WRITE', 'A leitura terminou, mas o PDF pesquisável não pôde ser armazenado. Tente reprocessar.') from None
    require(200 <= response.status_code < 300, 503, 'BLOB_WRITE', 'O OCR foi concluído, mas não foi possível armazenar o PDF pesquisável.')


def _error_details(error):
    if isinstance(error, ReportError):
        return error.status, error.code, str(error)
    if isinstance(error, ValueError):
        return 422, 'SIMPLES_PDF', str(error)
    return 503, 'SIMPLES_UNAVAILABLE', 'Não foi possível concluir a leitura do PDF. Tente novamente; se persistir, informe o código da requisição. A RBT12 não será estimada.'


def _attempt_scope(document, attempt_id, live=True):
    query = {'_id': document['_id'], 'workspaceId': document['workspaceId'], 'clientId': document['clientId'],
             'processingAttemptId': attempt_id, 'status': 'PROCESSING'}
    if live:
        query['processingLeaseUntil'] = {'$gt': utcnow()}
    return query


def _require_attempt(db, document, attempt_id):
    require(db.simplesDocuments.find_one(_attempt_scope(document, attempt_id), {'_id': 1}), 409,
            'DOCUMENT_ATTEMPT_EXPIRED', 'Esta tentativa de leitura expirou ou foi substituída. Consulte o estado do documento antes de tentar novamente.')


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
        status, code, message = _error_details(error)
        # Requests exceptions may contain delegated Blob URLs. Never log credentials or PDF contents.
        print(json.dumps({'requestId': self.request_id, 'code': code, 'status': status,
                          'errorType': type(error).__name__}))
        try:
            self.send_json(status, {'error': code, 'message': message, 'requestId': self.request_id})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self.request_id = str(uuid.uuid4())
        try:
            db, workspace, actor, query, client_id = self.context()
            extraction_id = (query.get('extractionId') or [''])[0]
            require(UUID.fullmatch(extraction_id), 400, 'RBT12_EXTRACTION', 'Selecione uma leitura do extrato.')
            record = db.simplesExtractions.find_one({'_id': extraction_id, 'workspaceId': workspace, 'clientId': client_id})
            require(record and record.get('parserVersion') == PARSER_VERSION, 409, 'RBT12_EXTRACTION', 'Leia novamente o PDF: é necessária a conferência exclusiva da seção 2.2.')
            self.send_json(200, {'extractionId': extraction_id, 'clientId': client_id, 'fileName': record['fileName'], **({'documentId': record.get('documentId')} if record.get('documentId') else {}), **record['result']})
        except Exception as error:
            self.error(error)

    def do_POST(self):
        self.request_id = str(uuid.uuid4())
        document_record = None
        db = None
        attempt_id = None
        try:
            require(allowed_origin(self.headers), 403, 'ORIGIN', 'Origem da requisição não autorizada.')
            session_hash(self.headers)
            content_type = self.headers.get('Content-Type', '').split(';')[0].lower()
            db, workspace, actor, query, client_id = self.context()
            require(actor.get('role') in ('admin', 'operator'), 403, 'FORBIDDEN', 'Seu perfil não pode processar documentos.')
            rate_limit(db, actor['_id'], workspace, False)
            client = db.clients.find_one({'_id': client_id, 'workspaceId': workspace, 'active': True}, {'_id': 1, 'name': 1, 'code': 1, 'cnpj': 1})
            require(client, 404, 'CLIENT', 'Empresa não encontrada neste ambiente.')

            if content_type == 'application/json':
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    size = 0
                require(0 < size <= 20_000, 413, 'JSON_LIMIT', 'Dados de processamento acima do limite.')
                try:
                    payload = json.loads(self.rfile.read(size).decode('utf-8'))
                except Exception:
                    raise ReportError(400, 'INVALID_JSON', 'Dados de processamento inválidos.')
                require(isinstance(payload, dict), 400, 'INVALID_JSON', 'Dados de processamento inválidos.')
                document_id = str(payload.get('documentId') or '')
                require(UUID.fullmatch(document_id), 400, 'DOCUMENT_ID', 'Documento armazenado inválido.')
                document_record = db.simplesDocuments.find_one({'_id': document_id, 'workspaceId': workspace, 'clientId': client_id})
                require(document_record, 404, 'DOCUMENT_ID', 'Documento armazenado não encontrado nesta empresa.')
                requested_attempt = payload.get('attemptId')
                require(isinstance(requested_attempt, str) and UUID.fullmatch(requested_attempt), 400, 'DOCUMENT_ATTEMPT',
                        'Atualize as URLs temporárias para iniciar uma nova tentativa de leitura.')
                searchable_path = document_record['originalPath'].removesuffix('/original.pdf') + '/attempts/' + requested_attempt + '.pdf'
                original_url = _blob_signed_url(payload.get('originalGetUrl'), document_record['originalPath'], 'get')
                require(document_record.get('originalBlobHost') and urlsplit(original_url).hostname == document_record['originalBlobHost'],
                        400, 'BLOB_URL', 'Atualize as URLs temporárias do documento armazenado.')
                searchable_url = _blob_signed_url(payload.get('searchablePutUrl'), searchable_path, 'put')
                now = utcnow()
                ticket = next((item for item in document_record.get('processingTickets', [])
                               if item.get('attemptId') == requested_attempt), None)
                require(ticket and ticket.get('expiresAt') and ticket['expiresAt'] > now
                        and ticket.get('originalUrlHash') == hashlib.sha256(original_url.encode()).hexdigest()
                        and ticket.get('searchableUrlHash') == hashlib.sha256(searchable_url.encode()).hexdigest(),
                        400, 'DOCUMENT_ATTEMPT', 'As URLs desta tentativa expiraram ou não correspondem ao documento. Solicite uma nova leitura.')
                claimed = db.simplesDocuments.update_one(
                    {'_id': document_id, 'workspaceId': workspace, 'clientId': client_id,
                     'processingAttemptId': {'$ne': requested_attempt},
                     'processingTickets': {'$elemMatch': {'attemptId': requested_attempt,
                         'originalUrlHash': ticket['originalUrlHash'], 'searchableUrlHash': ticket['searchableUrlHash'],
                         'expiresAt': {'$gt': now}}},
                     '$or': [{'status': {'$ne': 'PROCESSING'}}, {'processingLeaseUntil': {'$lte': now}},
                             {'processingLeaseUntil': {'$exists': False}}]},
                    {'$set': {'status': 'PROCESSING', 'updatedAt': now, 'processingAttemptId': requested_attempt,
                              'processingLeaseUntil': now + timedelta(seconds=PROCESSING_LEASE_SECONDS)},
                     '$inc': {'attempts': 1}, '$unset': {'lastError': ''},
                     '$pull': {'processingTickets': {'attemptId': requested_attempt}}})
                require(claimed.matched_count == 1, 409, 'DOCUMENT_PROCESSING',
                        'Já existe uma tentativa para este documento. Consulte o estado antes de iniciar outra leitura.')
                attempt_id = requested_attempt
                content = _download_blob(original_url)
                content_hash = hashlib.sha256(content).hexdigest()
                previous_hash = document_record.get('originalSha256') or document_record.get('fileSha256')
                require(not previous_hash or previous_hash == content_hash, 409,
                        'DOCUMENT_CHANGED', 'O PDF original armazenado não corresponde à leitura anterior. Anexe o documento novamente.')
                _require_attempt(db, document_record, attempt_id)
                db.simplesDocuments.update_one(_attempt_scope(document_record, attempt_id),
                                               {'$set': {'originalStored': True, 'originalSha256': content_hash}})
                file_name = document_record['fileName']
            elif content_type == 'application/pdf':
                # Compatibilidade com uploads antigos. O fluxo atual grava primeiro no Blob privado.
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    size = 0
                require(0 < size <= MAX_DIRECT_PDF_BYTES, 413, 'PDF_LIMIT', 'O envio direto aceita até 4 MiB. Use o fluxo com Blob para arquivos maiores.')
                file_name = (query.get('fileName') or ['extrato-simples.pdf'])[0][:200]
                content = self.rfile.read(size)
                require(len(content) == size, 400, 'PDF_INCOMPLETE', 'O envio do PDF ficou incompleto. Reenvie o arquivo.')
                searchable_url = None
            else:
                raise ReportError(415, 'CONTENT_TYPE', 'Envie o Extrato pelo armazenamento seguro ou em PDF.')

            result, searchable, _ = convert_statement_pdf(content, section_only=True, timeout_seconds=180)
            registered = re.sub(r'[^A-Z0-9]', '', str(client.get('cnpj') or '').upper())
            if registered:
                require(registered[:8] == result['cnpjBasico'], 422, 'RBT12_COMPANY', 'O CNPJ básico do extrato não corresponde à empresa selecionada. Nenhuma RBT12 foi vinculada.')
            else:
                result['warnings'].append('A empresa não tem CNPJ cadastrado para comparação automática. Confira o nome e o CNPJ básico do extrato antes de simular.')
            extraction_id = str(uuid.uuid4())
            document_id = document_record['_id'] if document_record else None
            if document_record:
                _require_attempt(db, document_record, attempt_id)
                _upload_searchable(searchable_url, searchable)
                _require_attempt(db, document_record, attempt_id)
            record = {'_id': extraction_id, 'workspaceId': workspace, 'clientId': client_id,
                      'createdBy': actor['_id'], 'createdAt': utcnow(), 'parserVersion': PARSER_VERSION,
                      'fileName': file_name, 'fileSha256': hashlib.sha256(content).hexdigest(), 'result': result,
                      **({'documentId': document_id, 'originalPath': document_record['originalPath'],
                          'searchablePath': searchable_path, 'attemptId': attempt_id} if document_record else {})}
            db.simplesExtractions.insert_one(record)
            if document_record:
                saved = db.simplesDocuments.update_one(_attempt_scope(document_record, attempt_id),
                    {'$set': {'status': 'READY', 'updatedAt': utcnow(), 'extractionId': extraction_id,
                              'fileSha256': record['fileSha256'], 'searchableStored': True, 'searchablePath': searchable_path,
                              'resultSummary': {'pa': result['pa'], 'rbt12Cents': result['rbt12Cents'],
                                                'processedPages': result.get('processedPages')}},
                     '$unset': {'processingLeaseUntil': '', 'lastError': ''}})
                require(saved.matched_count == 1, 409, 'DOCUMENT_ATTEMPT_EXPIRED',
                        'Esta tentativa expirou ou foi substituída. Consulte o estado atual do documento.')
            response = {'extractionId': extraction_id, 'clientId': client_id, 'fileName': file_name,
                        'company': {'code': client.get('code'), 'name': client.get('name')},
                        **({'documentId': document_id, 'originalStored': True, 'searchableStored': True} if document_record else {}),
                        **result}
            if not document_record:
                if len(searchable) <= MAX_RETURN_PDF_BYTES:
                    response['searchablePdfBase64'] = base64.b64encode(searchable).decode('ascii')
                else:
                    response['downloadNotice'] = 'A conversão foi concluída, mas o PDF pesquisável ultrapassa o limite de retorno web.'
        except Exception as error:
            if attempt_id and db is not None:
                _, code, message = _error_details(error)
                try:
                    db.simplesDocuments.update_one(_attempt_scope(document_record, attempt_id),
                        {'$set': {'status': 'OCR_FAILED', 'updatedAt': utcnow(),
                                  'lastError': {'code': code, 'message': message[:300], 'requestId': self.request_id}},
                         '$unset': {'processingLeaseUntil': ''}})
                except Exception:
                    # A database outage leaves a lease that /status exposes as retryable on expiry.
                    pass
            self.error(error)
            return
        # The result is committed. A lost HTTP connection must never undo successful work.
        try:
            self.send_json(200, response)
        except (BrokenPipeError, ConnectionResetError):
            pass
