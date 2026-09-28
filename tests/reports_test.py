import csv
import hashlib
import io
import json
import os
import secrets
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from reporting.core import *
from reporting.pdf import render_pdf

JOB = '00000000-0000-4000-8000-000000000001'
CLIENT = '00000000-0000-4000-8000-000000000002'

def fixture(count=3):
    now = utcnow()
    job = {'_id':JOB,'clientId':CLIENT,'clientCode':'000','clientName':'EMPRESA DEMONSTRAÇÃO — DADOS FICTÍCIOS',
           'fileName':'relatorio-demonstrativo.csv','createdAt':now,'completedAt':now,
           'summary':{'lines':count+4,'unique':count,'duplicates':3,'invalid':1}}
    groups = [{'status':s,'label':label,'count':count if s=='OPTANTE' else 0,
               'percent':100 if count and s=='OPTANTE' else 0,'batchPercent':100 if count and s=='OPTANTE' else 0}
              for s,label in list(STATUSES.items())[1:]]
    meta = {'job':job,'total':count,'denominator':count,'kind':'ALL','groups':groups,'coverage':100 if count else 0,
            'occurrences':count+3,'firstCheck':now,'lastCheck':now,'nameWarnings':1,'generatedAt':now,
            'kinds':[{'kind':'CLIENTE','label':'Clientes','count':count}]}
    row = {'cnpj':'11222333000181','submittedName':'NOME FICTÍCIO & <img src="https://invalid/">',
           'status':'OPTANTE','kind':'CLIENTE','uf':'MG','occurrences':1,'checkedAt':now,'nameMatch':'COMPATIVEL',
           'details':{'name':'EMPRESA DE DEMONSTRAÇÃO (não consultada)', 'mei':False,'uf':'MG',
                      'optionDate':'2020-01-01','registryStatus':'DEMONSTRAÇÃO'}}
    return meta, {'items':[dict(row) for _ in range(count)],'total':count,'page':1,'parts':1}, validate({'jobId':JOB,'action':'pdf'})

class PureTests(unittest.TestCase):
    def test_parameters_allowlist(self):
        self.assertEqual(validate({'jobId':JOB})['kind'],'ALL')
        for bad in ({'status':{'$ne':''}},{'kind':'alien'},{'page':True},{'part':0},{'jobId':'../env'},
                    {'action':'pdf','search':'oculto'}, {'search':'a'*101}):
            with self.subTest(bad=bad),self.assertRaises(ReportError):validate({'jobId':JOB,**bad})
    def test_origin_never_trusts_host(self):
        env={'APP_ORIGIN':'https://maximum.test','VERCEL':'1','VERCEL_URL':'preview.vercel.app'}
        self.assertTrue(allowed_origin({'Origin':'https://maximum.test'},env))
        self.assertTrue(allowed_origin({'Origin':'https://preview.vercel.app'},env))
        for origin in ('https://evil.vercel.app','null','https://maximum.test.evil','https://maximum.test/path'):
            self.assertFalse(allowed_origin({'Origin':origin,'Host':'maximum.test'},env))
    def test_cookie_exact_hash_and_production(self):
        raw=secrets.token_urlsafe(32)
        self.assertEqual(session_hash({'Cookie':'maximum_session='+raw},{}),hashlib.sha256(raw.encode()).hexdigest())
        self.assertEqual(session_hash({'Cookie':'__Host-maximum_session='+raw},{'VERCEL':'1'}),hashlib.sha256(raw.encode()).hexdigest())
        with self.assertRaises(ReportError):session_hash({'Cookie':'maximum_session='+raw},{'VERCEL':'1'})
        with self.assertRaises(ReportError):session_hash({'Cookie':'maximum_session=x'},{})
    def test_date_and_zero_denominator(self):
        self.assertEqual(percentage(3,0),0)
        self.assertEqual(percentage(1,3),33.33)
        self.assertEqual(display_date('2020-01-01'),'01/01/2020')
        self.assertEqual(display_date('bad'),'Não informada')
    def test_csv_neutralizes_formulas_and_preserves_cnpj(self):
        m,r,_=fixture(1);r['items'][0]['submittedName']='=IMPORTDATA("unsafe")'
        data=csv_bytes(m['job'],r['items']).decode('utf-8-sig')
        rows=list(csv.reader(io.StringIO(data),delimiter=';'))
        self.assertTrue(rows[1][4].startswith("'="));self.assertEqual(rows[1][3],'11222333000181')
        self.assertEqual(len(rows),2)
    def test_summary_and_empty_pdf(self):
        for size in (0,3):
            m,r,o=fixture(size);o['layout']='summary'
            pdf=render_pdf(m,r,o);self.assertTrue(pdf.startswith(b'%PDF'));self.assertLess(len(pdf),MAX_RESPONSE_BYTES)
            o['layout']='detailed';self.assertTrue(render_pdf(m,r,o).startswith(b'%PDF'))
    def test_500_rows_long_text_pdf(self):
        m,r,o=fixture(500)
        r['items'][0]['submittedName']='TEXTO SEM ESPAÇOS '+('M'*200)
        pdf=render_pdf(m,r,o);self.assertTrue(pdf.startswith(b'%PDF'));self.assertLess(len(pdf),MAX_RESPONSE_BYTES)

@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO')=='1','MongoDB descartável não solicitado')
class MongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn=MongoClient(os.environ['MONGODB_URI'],serverSelectionTimeoutMS=8000,tz_aware=True)
        cls.db=cls.conn['maximum_report_test_'+uuid.uuid4().hex]
        cls.env=patch.dict(os.environ,{'WORKSPACE_ID':'reports-ci','NODE_ENV':'development','APP_ORIGIN':'http://reports.test','VERCEL':'0'})
        cls.env.start()
        cls.ws='reports-ci';cls.raw=secrets.token_urlsafe(32);cls.cookie={'Cookie':'maximum_session='+cls.raw}
        cls.db.users.insert_one({'_id':'user1','workspaceId':cls.ws,'active':True,'role':'viewer'})
        cls.db.sessions.insert_one({'_id':hashlib.sha256(cls.raw.encode()).hexdigest(),'workspaceId':cls.ws,'userId':'user1','expiresAt':utcnow()+timedelta(minutes=10)})
        m,r,_=fixture(3);job={**m['job'],'workspaceId':cls.ws,'status':'COMPLETED'};cls.db.lookupJobs.insert_one(job)
        for i,status in enumerate(list(STATUSES)[1:]):
            cnpj=str(i).zfill(14);state=f'state{i}'
            cls.db.cnpjStates.insert_one({'_id':state,'cnpj':cnpj,'workspaceId':cls.ws,'name':'API '+str(i)})
            cls.db.lookupItems.insert_one({'_id':f'item{i}','workspaceId':cls.ws,'jobId':JOB,'cnpj':cnpj,'state':'DONE','status':status,
               'stateId':state,'kind':'CLIENTE' if i<2 else 'FORNECEDOR','occurrences':1,'checkedAt':utcnow(),'submittedName':'NOME '+str(i)})
        cls.db.cnpjStates.insert_one({'_id':'secret','cnpj':'9'*14,'workspaceId':'other','name':'SECRET OUTSIDE WORKSPACE'})
    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name);cls.conn.close();cls.env.stop()
    def test_auth_and_tenant(self):
        from reporting.service import authenticate,get_job
        self.assertEqual(authenticate(self.db,self.cookie,self.ws)['_id'],'user1')
        with self.assertRaises(ReportError):authenticate(self.db,self.cookie,'other')
        with self.assertRaises(ReportError):get_job(self.db,JOB,'other')
        with self.assertRaises(ReportError):get_job(self.db,JOB,self.ws,'f'*36)
    def test_summary_and_selected_type(self):
        from reporting.service import metadata,get_job,result_rows
        job=get_job(self.db,JOB,self.ws);m=metadata(self.db,job,self.ws,'CLIENTE')
        self.assertEqual(m['total'],3);self.assertEqual(m['denominator'],2)
        self.assertEqual(m['groups'][0]['percent'],50)
        o=validate({'jobId':JOB,'kind':'CLIENTE','status':'OPTANTE'})
        data=result_rows(self.db,JOB,self.ws,o,1,1);self.assertEqual(data['total'],1);self.assertEqual(data['items'][0]['details']['name'],'API 0')
        o=validate({'jobId':JOB,'search':'API 2'});self.assertEqual(result_rows(self.db,JOB,self.ws,o)['total'],1)
        with self.assertRaises(ReportError):result_rows(self.db,JOB,self.ws,o,1,2)
    def test_not_completed_and_count_mismatch(self):
        from reporting.service import metadata,get_job
        job=get_job(self.db,JOB,self.ws);job['summary']={'unique':99}
        with self.assertRaises(ReportError):metadata(self.db,job,self.ws,'ALL')
        other={**job,'_id':'incomplete','status':'PROCESSING'};self.db.lookupJobs.insert_one(other)
        with self.assertRaises(ReportError):get_job(self.db,'incomplete',self.ws)
    def test_http_downloads_and_security(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request,urlopen
        from urllib.error import HTTPError
        from api import reports as endpoint
        server=ThreadingHTTPServer(('127.0.0.1',0),endpoint.handler)
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        def call(payload,headers=None):
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/',data=json.dumps(payload).encode(),
               headers={'Origin':'http://reports.test','Content-Type':'application/json',**self.cookie,**(headers or {})}),timeout=15)
        try:
            with patch.object(endpoint,'database',return_value=self.db):
                for action in ('summary','rows','pdf','csv'):
                    with call({'jobId':JOB,'action':action}) as response:
                        self.assertEqual(response.status,200);data=response.read()
                        if action=='pdf':self.assertTrue(data.startswith(b'%PDF'))
                        if action=='csv':self.assertTrue(data.startswith(b'\xef\xbb\xbf'))
                with self.assertRaises(HTTPError) as e:call({'jobId':JOB},{'Origin':'https://evil.test'})
                self.assertEqual(e.exception.code,403)
                with self.assertRaises(HTTPError) as e:call({'jobId':JOB},{'Cookie':''})
                self.assertEqual(e.exception.code,401)
                with self.assertRaises(HTTPError) as e:call({'jobId':JOB,'action':'pdf','search':'hidden'})
                self.assertEqual(e.exception.code,400)
                self.assertEqual(self.db.lookupItems.count_documents({'workspaceId':self.ws}),3)
                self.assertNotIn('reportFiles',self.db.list_collection_names())
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
