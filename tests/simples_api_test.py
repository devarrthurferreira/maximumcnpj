"""HTTP real + MongoDB descartável; PDF nativo sintético, sem dados de contribuintes."""
import base64
import copy
import io
from contextlib import ExitStack
from types import SimpleNamespace
import hashlib
import http.client
import importlib
import json
import os
import secrets
import threading
import unittest
import uuid
from datetime import timedelta
from http.server import HTTPServer
from unittest.mock import patch
from urllib.parse import urlencode
from reporting.core import ReportError
from reporting.core import utcnow
from simples_extract_test import digital_pdf, paged_pdf, sample, declaration_sample

def signed_urls(original_path, searchable_path):
    signature = {'vercel-blob-delegation': 'synthetic-delegation', 'vercel-blob-signature': 'synthetic-signature'}
    return (f'https://store-fixture.private.blob.vercel-storage.com/{original_path}?' + urlencode(signature),
            'https://vercel.com/api/blob/?' + urlencode({'pathname': searchable_path, **signature}))


class SignedBlobUrlTests(unittest.TestCase):
    def test_sdk_read_and_write_urls_use_different_hosts_and_path_locations(self):
        from api.simples import _blob_signed_url
        original, searchable = signed_urls('simples/test/original.pdf', 'simples/test/pesquisavel.pdf')
        self.assertEqual(_blob_signed_url(original, 'simples/test/original.pdf', 'get'), original)
        self.assertEqual(_blob_signed_url(searchable, 'simples/test/pesquisavel.pdf', 'put'), searchable)

    def test_url_cannot_target_another_document_host_or_operation(self):
        from api.simples import _blob_signed_url
        path = 'simples/test/original.pdf'
        original, searchable = signed_urls(path, path)
        cases = [
            (original, 'other.pdf', 'get'), (searchable, 'other.pdf', 'put'),
            (original, path, 'put'), (searchable, path, 'get'),
            (original.replace('https://', 'http://'), path, 'get'),
            (original.replace('.private.', '.undefined.'), path, 'get'),
            (original.replace('.com/', '.com.evil.test/'), path, 'get'),
            (original.replace('https://', 'https://user:password@'), path, 'get'),
            (original.replace('.com/', '.com:444/'), path, 'get'),
            (original + '#fragment', path, 'get'),
            (searchable.replace('vercel.com/', 'evil.test/'), path, 'put'),
            (searchable.replace('/api/blob/', '/api/other/'), path, 'put'),
            (searchable + '&pathname=other.pdf', path, 'put'),
            (searchable.replace('synthetic-signature', ''), path, 'put'),
            (searchable.replace('vercel-blob-delegation=', 'unrelated='), path, 'put'),
        ]
        for url, expected, operation in cases:
            with self.subTest(url=url), self.assertRaises(ReportError):
                _blob_signed_url(url, expected, operation)

@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO')=='1','MongoDB descartável não solicitado')
class SimplesApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn=MongoClient(os.environ['MONGODB_URI'],serverSelectionTimeoutMS=8000,tz_aware=True)
        cls.db=cls.conn['maximum_extrato_test_'+uuid.uuid4().hex]
        cls.ws='extrato-ci';cls.client=str(uuid.uuid4());cls.other=str(uuid.uuid4())
        cls.env=patch.dict(os.environ,{'WORKSPACE_ID':cls.ws,'NODE_ENV':'development','APP_ORIGIN':'http://extrato.test','VERCEL':'0'});cls.env.start()
        cls.module=importlib.import_module('api.simples');cls.database=patch.object(cls.module,'database',return_value=cls.db);cls.database.start()
        cls.raw=secrets.token_urlsafe(32);cls.cookie='maximum_session='+cls.raw
        cls.db.users.insert_one({'_id':'test-extrato','workspaceId':cls.ws,'active':True,'role':'operator'})
        cls.db.sessions.insert_one({'_id':hashlib.sha256(cls.raw.encode()).hexdigest(),'workspaceId':cls.ws,'userId':'test-extrato','expiresAt':utcnow()+timedelta(minutes=10)})
        cls.db.clients.insert_many([{'_id':cls.client,'workspaceId':cls.ws,'active':True,'name':'EMPRESA SINTETICA','cnpj':'12.345.678/0001-00'},
                                    {'_id':cls.other,'workspaceId':cls.ws,'active':True,'name':'OUTRA EMPRESA','cnpj':'87.654.321/0001-00'}])
        cls.server=HTTPServer(('127.0.0.1',0),cls.module.handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
        cls.conn.drop_database(cls.db.name);cls.conn.close();cls.database.stop();cls.env.stop()
    def call(self,method,path,body=None,headers=None):
        h={'Origin':'http://extrato.test','Cookie':self.cookie,'Content-Type':'application/pdf'};h.update(headers or {})
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=30)
        try:
            conn.request(method,path,body,headers=h);response=conn.getresponse()
            return response.status,json.loads(response.read()),dict(response.getheaders())
        finally:conn.close()
    def test_auth_origin_and_identity_reject_before_linking(self):
        path=f'/api/simples?clientId={self.client}'
        for headers,status in [({'Origin':'http://evil.test'},403),({'Cookie':''},401),({'Content-Type':'text/plain'},415)]:
            self.assertEqual(self.call('POST',path,b'%PDF',headers)[0],status)
        status,data,_=self.call('POST',f'/api/simples?clientId={self.other}',digital_pdf())
        self.assertEqual(status,422);self.assertEqual(data['error'],'RBT12_COMPANY')
        self.assertEqual(self.db.simplesExtractions.count_documents({'clientId':self.other}),0)
    def test_only_structured_result_is_stored_and_get_is_scoped(self):
        status,data,headers=self.call('POST',f'/api/simples?clientId={self.client}&fileName=synthetic.pdf',paged_pdf(sample()))
        self.assertEqual(status,200,data);self.assertEqual(data['rbt12Cents'],16200000)
        self.assertEqual(data['extractionScope'],'SECTION_22')
        self.assertEqual(data['pageCount'],2);self.assertEqual(data['processedPages'],1)
        self.assertEqual(data['preservedPages'],[2]);self.assertEqual(data['searchablePdfScope'],'SELECTED_PAGES')
        self.assertTrue(base64.b64decode(data['searchablePdfBase64']).startswith(b'%PDF'))
        self.assertEqual(headers['Cache-Control'],'no-store')
        stored=self.db.simplesExtractions.find_one({'_id':data['extractionId']})
        self.assertNotIn('searchablePdfBase64',stored['result']);self.assertNotIn('text',stored['result'])
        self.assertEqual(len(stored['fileSha256']),64)
        path=f'/api/simples?clientId={self.client}&extractionId={data["extractionId"]}'
        status,read,_=self.call('GET',path);self.assertEqual(status,200);self.assertEqual(read['rbt12Window'],data['rbt12Window'])
        self.assertNotIn('searchablePdfBase64',read)
        self.assertEqual(self.call('GET',path,None,{'Cookie':''})[0],401)
        self.assertEqual(self.call('GET',path.replace(self.client,self.other))[0],409)
        self.db.simplesExtractions.update_one({'_id':data['extractionId']},{'$set':{'workspaceId':'outside'}})
        self.assertEqual(self.call('GET',path)[0],409)
    def test_pgdas_declaration_is_saved_and_rejects_another_company(self):
        content=digital_pdf(declaration_sample())
        status,data,_=self.call('POST',f'/api/simples?clientId={self.client}',content)
        self.assertEqual(status,200,data)
        self.assertEqual(data['documentType'],'PGDAS_D_DECLARACAO')
        self.assertEqual(data['pa'],'08/2026')
        self.assertEqual(data['rbt12Cents'],16200000)
        stored=self.db.simplesExtractions.find_one({'_id':data['extractionId']})
        self.assertEqual(stored['clientId'],self.client)
        self.assertEqual(stored['result']['rbt12Window'],data['rbt12Window'])
        status,error,_=self.call('POST',f'/api/simples?clientId={self.other}',content)
        self.assertEqual(status,422)
        self.assertEqual(error['error'],'RBT12_COMPANY')
        self.assertEqual(self.db.simplesExtractions.count_documents({'clientId':self.other}),0)

    def test_missing_section_cannot_fall_back_and_unreadable_pdf_is_not_saved(self):
        before=self.db.simplesExtractions.count_documents({})
        with patch.object(self.module,'convert_statement_pdf',side_effect=ValueError('Seção 2.2 ausente')):
            status,data,_=self.call('POST',f'/api/simples?clientId={self.client}',b'%PDF-fixture')
        self.assertEqual(status,422);self.assertEqual(data['error'],'SIMPLES_PDF')
        self.assertEqual(self.db.simplesExtractions.count_documents({}),before)

    def stored_document(self):
        document_id = str(uuid.uuid4())
        prefix = f'simples/{self.ws}/{self.client}/{document_id}'
        record = {'_id': document_id, 'workspaceId': self.ws, 'clientId': self.client,
                  'fileName': 'synthetic.pdf', 'originalPath': prefix + '/original.pdf',
                  'searchablePath': prefix + '/pesquisavel.pdf', 'originalBlobHost': 'store-fixture.private.blob.vercel-storage.com', 'status': 'AWAITING_UPLOAD'}
        self.db.simplesDocuments.insert_one(record)
        return record, self.processing_payload(record)

    def processing_payload(self, record):
        attempt_id = str(uuid.uuid4())
        path = record['originalPath'].removesuffix('/original.pdf') + '/attempts/' + attempt_id + '.pdf'
        original, searchable = signed_urls(record['originalPath'], path)
        ticket = {'attemptId': attempt_id, 'originalUrlHash': hashlib.sha256(original.encode()).hexdigest(),
                  'searchableUrlHash': hashlib.sha256(searchable.encode()).hexdigest(), 'expiresAt': utcnow() + timedelta(minutes=15)}
        self.db.simplesDocuments.update_one({'_id': record['_id']}, {'$set': {'processingTickets': [ticket]}})
        return {'documentId': record['_id'], 'attemptId': attempt_id, 'originalGetUrl': original, 'searchablePutUrl': searchable}

    def test_blob_urls_process_original_save_searchable_and_allow_reprocessing(self):
        record, payload = self.stored_document()
        path = f'/api/simples?clientId={self.client}'
        with patch.object(self.module, '_download_blob', return_value=digital_pdf(declaration_sample())) as download, \
             patch.object(self.module, '_upload_searchable') as upload:
            for attempt in (1, 2):
                payload = self.processing_payload(record)
                status, data, _ = self.call('POST', path, json.dumps(payload), {'Content-Type': 'application/json'})
                self.assertEqual(status, 200, data)
                self.assertEqual(data['documentType'], 'PGDAS_D_DECLARACAO')
                self.assertFalse(data['ocrUsed'])
                self.assertEqual(data['rbt12Cents'], 16200000)
                self.assertEqual(data['documentId'], record['_id'])
                self.assertTrue(data['searchableStored'])
                self.assertNotIn('searchablePdfBase64', data)
                download.assert_called_with(payload['originalGetUrl'])
                self.assertEqual(upload.call_args.args[0], payload['searchablePutUrl'])
                self.assertTrue(upload.call_args.args[1].startswith(b'%PDF'))
                saved = self.db.simplesDocuments.find_one({'_id': record['_id']})
                self.assertEqual(saved['status'], 'READY')
                self.assertEqual(saved['attempts'], attempt)

    def test_failed_blob_ocr_can_retry_without_new_original(self):
        record, payload = self.stored_document()
        path = f'/api/simples?clientId={self.client}'
        with patch.object(self.module, '_download_blob', return_value=digital_pdf(declaration_sample())), \
             patch.object(self.module, '_upload_searchable') as upload:
            with patch.object(self.module, 'convert_statement_pdf', side_effect=ValueError('Seção 2.2 ilegível')):
                status, _, _ = self.call('POST', path, json.dumps(payload), {'Content-Type': 'application/json'})
            self.assertEqual(status, 422)
            self.assertEqual(self.db.simplesDocuments.find_one({'_id': record['_id']})['status'], 'OCR_FAILED')
            upload.assert_not_called()
            payload = self.processing_payload(record)
            status, data, _ = self.call('POST', path, json.dumps(payload), {'Content-Type': 'application/json'})
            self.assertEqual(status, 200, data)
            saved = self.db.simplesDocuments.find_one({'_id': record['_id']})
            self.assertEqual(saved['status'], 'READY')
            self.assertNotIn('lastError', saved)

    def test_foreign_document_and_invalid_signed_path_do_not_reach_blob(self):
        record, payload = self.stored_document()
        with patch.object(self.module, '_download_blob') as download:
            status, _, _ = self.call('POST', f'/api/simples?clientId={self.other}', json.dumps(payload), {'Content-Type': 'application/json'})
            self.assertEqual(status, 404)
            payload['searchablePutUrl'] += '&pathname=other.pdf'
            status, data, _ = self.call('POST', f'/api/simples?clientId={self.client}', json.dumps(payload), {'Content-Type': 'application/json'})
            self.assertEqual(status, 400, data)
            download.assert_not_called()


class MemoryCollection:
    """Atomic subset of Mongo operators used by the lifecycle; no external services."""
    def __init__(self, records=()):
        self.records = {item['_id']: copy.deepcopy(item) for item in records}
        self.lock = threading.RLock()

    @staticmethod
    def matches(record, query):
        for key, expected in query.items():
            if key == '$or':
                if not any(MemoryCollection.matches(record, option) for option in expected): return False
                continue
            value = record.get(key)
            if isinstance(expected, dict):
                for operation, bound in expected.items():
                    if operation == '$ne' and value == bound: return False
                    if operation == '$exists' and (key in record) != bound: return False
                    if operation == '$gt' and (value is None or not value > bound): return False
                    if operation == '$lte' and (value is None or not value <= bound): return False
                    if operation == '$elemMatch' and not any(MemoryCollection.matches(item, bound) for item in (value or [])): return False
            elif value != expected: return False
        return True

    def find_one(self, query, projection=None):
        with self.lock:
            return next((copy.deepcopy(item) for item in self.records.values() if self.matches(item, query)), None)

    def update_one(self, query, update):
        with self.lock:
            for record in self.records.values():
                if not self.matches(record, query): continue
                record.update(copy.deepcopy(update.get('$set', {})))
                for key, amount in update.get('$inc', {}).items(): record[key] = record.get(key, 0) + amount
                for key in update.get('$unset', {}): record.pop(key, None)
                for key, condition in update.get('$pull', {}).items():
                    record[key] = [item for item in record.get(key, []) if not self.matches(item, condition)]
                return SimpleNamespace(matched_count=1)
            return SimpleNamespace(matched_count=0)

    def insert_one(self, record):
        with self.lock:
            self.records[record['_id']] = copy.deepcopy(record)


class SimplesLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module('api.simples')
        self.real_download_blob = self.module._download_blob
        self.real_upload_searchable = self.module._upload_searchable
        self.client_id, self.document_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.prefix = 'simples/synthetic/' + self.client_id + '/' + self.document_id
        self.document = {'_id': self.document_id, 'workspaceId': 'synthetic', 'clientId': self.client_id,
                         'fileName': 'synthetic.pdf', 'originalPath': self.prefix + '/original.pdf',
                         'searchablePath': self.prefix + '/previous.pdf', 'status': 'READY', 'attempts': 1,
                         'originalBlobHost': 'store-fixture.private.blob.vercel-storage.com',
                         'searchableStored': True, 'extractionId': 'previous-extraction'}
        self.db = SimpleNamespace(simplesDocuments=MemoryCollection([self.document]), simplesExtractions=MemoryCollection(),
                                  clients=MemoryCollection([{'_id': self.client_id, 'workspaceId': 'synthetic', 'active': True,
                                                             'name': 'EMPRESA SINTÉTICA', 'cnpj': '12345678000100'}]))
        self.content = b'%PDF-synthetic'
        self.result = {'cnpjBasico': '12345678', 'pa': '08/2026', 'rbt12Cents': 100, 'warnings': []}
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, options in [('allowed_origin', {'return_value': True}), ('session_hash', {'return_value': 'synthetic'}),
                              ('rate_limit', {}), ('_download_blob', {'return_value': self.content}),
                              ('_upload_searchable', {}), ('convert_statement_pdf', {'side_effect': lambda *a, **k: (copy.deepcopy(self.result), b'%PDF-searchable', None)})]:
            self.stack.enter_context(patch.object(self.module, name, **options))

    def payload(self):
        attempt_id = str(uuid.uuid4())
        original, searchable = signed_urls(self.document['originalPath'], self.prefix + '/attempts/' + attempt_id + '.pdf')
        ticket = {'attemptId': attempt_id, 'originalUrlHash': hashlib.sha256(original.encode()).hexdigest(),
                  'searchableUrlHash': hashlib.sha256(searchable.encode()).hexdigest(), 'expiresAt': utcnow() + timedelta(minutes=15)}
        current = self.saved()
        self.db.simplesDocuments.update_one({'_id': self.document_id}, {'$set': {'processingTickets': current.get('processingTickets', []) + [ticket]}})
        return {'documentId': self.document_id, 'attemptId': attempt_id, 'originalGetUrl': original, 'searchablePutUrl': searchable}

    def saved(self):
        return self.db.simplesDocuments.find_one({'_id': self.document_id})

    def call(self, payload, role='operator', disconnect=False):
        instance = object.__new__(self.module.handler)
        body = json.dumps(payload).encode()
        instance.headers = {'Content-Type': 'application/json', 'Content-Length': str(len(body))}
        instance.rfile = io.BytesIO(body)
        instance.context = lambda: (self.db, 'synthetic', {'_id': 'synthetic-actor', 'role': role}, {}, self.client_id)
        responses = []
        def send(status, value):
            responses.append((status, value))
            if disconnect: raise BrokenPipeError('synthetic browser disconnected')
        instance.send_json = send
        instance.do_POST()
        return responses[-1]

    def test_viewer_cannot_process_and_invalid_request_never_changes_ready_document(self):
        payload = self.payload()
        before = self.saved()
        self.assertEqual(self.call(payload, role='viewer')[0], 403)
        self.assertEqual(self.saved(), before)
        payload['searchablePutUrl'] += '&pathname=other.pdf'
        self.assertEqual(self.call(payload)[0], 400)
        self.assertEqual(self.saved(), before)
        self.module._download_blob.assert_not_called()
        self.module.convert_statement_pdf.assert_not_called()

    def test_urls_must_be_the_exact_server_issued_ticket_before_any_processing(self):
        for field in ('originalGetUrl', 'searchablePutUrl'):
            payload = self.payload()
            before = self.saved()
            payload[field] = payload[field].replace('synthetic-signature', 'other-store-signature')
            status, error = self.call(payload)
            self.assertEqual(status, 400)
            self.assertEqual(error['error'], 'DOCUMENT_ATTEMPT')
            self.assertEqual(self.saved(), before)
        self.module._download_blob.assert_not_called()

    def test_disconnect_after_commit_preserves_ready_and_previous_extractions(self):
        status, response = self.call(self.payload(), disconnect=True)
        self.assertEqual(status, 200)
        saved = self.saved()
        self.assertEqual(saved['status'], 'READY')
        self.assertEqual(saved['extractionId'], response['extractionId'])
        self.assertEqual(len(self.db.simplesExtractions.records), 1)
        self.assertNotIn('lastError', saved)
        self.assertNotIn('processingLeaseUntil', saved)

    def test_consumed_ticket_cannot_be_replayed_after_a_later_success(self):
        first, second = self.payload(), self.payload()
        self.assertEqual(self.call(first)[0], 200)
        self.assertEqual(self.call(second)[0], 200)
        saved = self.saved()
        status, response = self.call(first)
        self.assertEqual((status, response['error']), (400, 'DOCUMENT_ATTEMPT'))
        self.assertEqual(self.saved(), saved)
        self.assertEqual(len(self.db.simplesExtractions.records), 2)

    def test_failed_reread_retains_the_last_success_without_claiming_current_success(self):
        payload = self.payload()
        self.module.convert_statement_pdf.side_effect = ValueError('Seção 2.2 ilegível')
        status, response = self.call(payload)
        self.assertEqual(status, 422)
        saved = self.saved()
        self.assertEqual(saved['status'], 'OCR_FAILED')
        self.assertEqual(saved['lastError']['code'], response['error'])
        self.assertEqual(saved['extractionId'], 'previous-extraction')
        self.assertEqual(saved['searchablePath'], self.document['searchablePath'])
        self.assertTrue(saved['searchableStored'])
        self.assertTrue(saved['originalStored'])
        self.assertNotIn('processingLeaseUntil', saved)
        self.assertEqual(self.db.simplesExtractions.records, {})

    def test_concurrent_live_attempt_is_rejected_and_hard_timeout_can_be_reclaimed(self):
        first, second = self.payload(), self.payload()
        started, release = threading.Event(), threading.Event()
        def convert(*args, **kwargs):
            started.set()
            self.assertTrue(release.wait(5))
            return copy.deepcopy(self.result), b'%PDF-first', None
        self.module.convert_statement_pdf.side_effect = convert
        responses = []
        worker = threading.Thread(target=lambda: responses.append(self.call(first)))
        worker.start()
        try:
            self.assertTrue(started.wait(5))
            active = self.saved()
            status, response = self.call(second)
            self.assertEqual(status, 409)
            self.assertEqual(response['error'], 'DOCUMENT_PROCESSING')
            self.assertEqual(self.saved(), active)
            # Simulate a killed function: its lease expires with no catch/finally running.
            self.db.simplesDocuments.update_one({'_id': self.document_id}, {'$set': {'processingLeaseUntil': utcnow() - timedelta(seconds=1)}})
            self.module.convert_statement_pdf.side_effect = lambda *a, **k: (copy.deepcopy(self.result), b'%PDF-new', None)
            self.assertEqual(self.call(second)[0], 200)
            committed = self.saved()
        finally:
            release.set(); worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(responses[0][0], 409)
        self.assertEqual(self.saved(), committed)
        self.assertEqual(len(self.db.simplesExtractions.records), 1)

    def test_expired_upload_finishing_after_new_success_cannot_replace_artifact_or_status(self):
        first, second = self.payload(), self.payload()
        started, release = threading.Event(), threading.Event()
        blobs, responses = {}, []
        def upload(url, content):
            if url == first['searchablePutUrl']:
                started.set()
                self.assertTrue(release.wait(5))
            blobs[url] = content
        self.module._upload_searchable.side_effect = upload
        worker = threading.Thread(target=lambda: responses.append(self.call(first)))
        worker.start()
        try:
            self.assertTrue(started.wait(5))
            self.db.simplesDocuments.update_one({'_id': self.document_id}, {'$set': {'processingLeaseUntil': utcnow() - timedelta(seconds=1)}})
            self.assertEqual(self.call(second)[0], 200)
            committed = self.saved()
        finally:
            release.set(); worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(responses[0][0], 409)
        self.assertEqual(self.saved(), committed)
        self.assertTrue(committed['searchablePath'].endswith(second['attemptId'] + '.pdf'))
        self.assertEqual(set(blobs), {first['searchablePutUrl'], second['searchablePutUrl']})
        self.assertEqual(len(self.db.simplesExtractions.records), 1)

    def test_changed_original_and_read_timeout_keep_previous_valid_artifact(self):
        self.db.simplesDocuments.update_one({'_id': self.document_id}, {'$set': {'fileSha256': '0' * 64}})
        status, response = self.call(self.payload())
        self.assertEqual((status, response['error']), (409, 'DOCUMENT_CHANGED'))
        self.module.convert_statement_pdf.assert_not_called()
        self.assertEqual(self.saved()['extractionId'], 'previous-extraction')
        self.module._download_blob.side_effect = ReportError(503, 'BLOB_READ', 'Não foi possível recuperar o PDF.')
        status, response = self.call(self.payload())
        self.assertEqual((status, response['error']), (503, 'BLOB_READ'))
        self.assertEqual(self.saved()['status'], 'OCR_FAILED')
        self.assertEqual(self.saved()['extractionId'], 'previous-extraction')

    def test_request_transport_error_does_not_expose_signed_urls(self):
        import requests
        for method, invoke, code in [('get', lambda: self.real_download_blob('https://synthetic.invalid'), 'BLOB_READ'),
                                      ('put', lambda: self.real_upload_searchable('https://synthetic.invalid', b'%PDF'), 'BLOB_WRITE')]:
            with self.subTest(method=method), patch.object(self.module.requests, method,
                    side_effect=requests.Timeout('https://secret.invalid/?vercel-blob-signature=secret')):
                with self.assertRaises(ReportError) as raised:
                    invoke()
                self.assertEqual(raised.exception.code, code)
                self.assertNotIn('secret', str(raised.exception))
