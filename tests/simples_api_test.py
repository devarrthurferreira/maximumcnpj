"""HTTP real + MongoDB descartável; PDF nativo sintético, sem dados de contribuintes."""
import base64
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
from reporting.core import utcnow
from simples_extract_test import digital_pdf

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
        status,data,headers=self.call('POST',f'/api/simples?clientId={self.client}&fileName=synthetic.pdf',digital_pdf())
        self.assertEqual(status,200,data);self.assertEqual(data['rbt12Cents'],16200000)
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
    def test_missing_section_cannot_fall_back_and_unreadable_pdf_is_not_saved(self):
        before=self.db.simplesExtractions.count_documents({})
        with patch.object(self.module,'convert_statement_pdf',side_effect=ValueError('Seção 2.2 ausente')):
            status,data,_=self.call('POST',f'/api/simples?clientId={self.client}',b'%PDF-fixture')
        self.assertEqual(status,422);self.assertEqual(data['error'],'SIMPLES_PDF')
        self.assertEqual(self.db.simplesExtractions.count_documents({}),before)
