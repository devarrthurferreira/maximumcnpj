"""Synthetic generation boundaries, financial pagination and authenticated download."""
import hashlib
import json
import os
import secrets
import unittest
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from reporting.core import ReportError, utcnow, validate, MAX_RESPONSE_BYTES
from reporting.purchases import reconcile_purchase_snapshot
from reporting.generations import generation_metadata, render_generation_pdf
from purchases_report_test import net_fixture, WORKSPACE

GENERATION = '00000000-0000-4000-8000-000000000090'


def generation_fixture(count=11):
    companies, jobs, snapshots = [], [], {}
    for i in range(count):
        job, lines, items = net_fixture()
        job_id, client_id = str(uuid.UUID(int=i+100)), str(uuid.UUID(int=i+200))
        job.update(_id=job_id, generationId=GENERATION, clientId=client_id,
                   clientCode=f'{i+1:03}', clientName=f'EMPRESA FICTÍCIA {i+1}')
        for line in lines:
            line.update(_id=f'{job_id}:{line["index"]}', jobId=job_id)
        for item in items:
            item.update(_id=f'{job_id}:{item["cnpj"]}', jobId=job_id, clientId=client_id)
        companies.append({'clientId': client_id, 'code': job['clientCode'], 'name': job['clientName'],
                          'purchaseJobId': job_id, 'purchaseJobIds': [job_id]})
        jobs.append(job)
        snapshots[job_id] = (job, lines, items)
    return {'_id': GENERATION, 'workspaceId': WORKSPACE, 'createdAt': utcnow(), 'companies': companies}, jobs, snapshots


class Cursor(list):
    def limit(self, _): return self
    def max_time_ms(self, _): return self


class GenerationReportTests(unittest.TestCase):
    def setup_db(self, count=11):
        generation, jobs, snapshots = generation_fixture(count)
        db = SimpleNamespace(
            generations=SimpleNamespace(find_one=lambda query: generation if query['workspaceId'] == WORKSPACE else None),
            lookupJobs=SimpleNamespace(find=lambda query: Cursor(jobs)))
        return db, generation, jobs, snapshots

    def test_explicit_part_only_reads_its_snapshots_and_labels_subtotals(self):
        db, generation, jobs, snapshots = self.setup_db()
        calls = []
        def purchase(db, job, workspace):
            calls.append(job['_id'])
            return reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)
        with patch('reporting.generations.purchase_metadata', side_effect=purchase):
            meta = generation_metadata(db, GENERATION, WORKSPACE, 2)
        self.assertEqual(calls, [jobs[10]['_id']])
        self.assertEqual((meta['part'], meta['parts'], meta['firstCompany'], meta['lastCompany']), (2, 2, 11, 11))
        self.assertEqual(meta['totals']['totalCents'], 100000)
        self.assertEqual(meta['totals']['unconfirmedCents'], 10000)
        self.assertEqual(meta['companyCount'], 11)
        pdf = render_generation_pdf(meta)
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertLess(len(pdf), MAX_RESPONSE_BYTES)

    def test_incomplete_company_outside_requested_part_still_blocks(self):
        db, generation, jobs, _ = self.setup_db()
        jobs[0]['status'] = 'PROCESSING'
        with patch('reporting.generations.purchase_metadata') as purchases:
            with self.assertRaises(ReportError) as error:
                generation_metadata(db, GENERATION, WORKSPACE, 2)
            self.assertEqual(error.exception.code, 'GENERATION_INCOMPLETE')
            purchases.assert_not_called()

    def test_missing_duplicate_or_cross_linked_snapshots_block(self):
        def missing(g, jobs): g['companies'][0]['purchaseJobId'] = None
        def missing_job(g, jobs): jobs.pop()
        def wrong_client(g, jobs): jobs[0]['clientId'] = 'other'
        def wrong_generation(g, jobs): jobs[0]['generationId'] = 'other'
        def wrong_workspace(g, jobs): jobs[0]['workspaceId'] = 'other'
        def wrong_mode(g, jobs): jobs[0]['mode'] = 'SALES_V1'
        def missing_history(g, jobs): g['companies'][0]['purchaseJobIds'] = []
        def repeated_company(g, jobs): g['companies'][1]['clientId'] = g['companies'][0]['clientId']
        def repeated_job(g, jobs): g['companies'][1]['purchaseJobId'] = g['companies'][0]['purchaseJobId']
        for change in (missing, missing_job, wrong_client, wrong_generation, wrong_workspace, wrong_mode,
                       missing_history, repeated_company, repeated_job):
            with self.subTest(change=change.__name__):
                db, generation, jobs, _ = self.setup_db()
                change(generation, jobs)
                with self.assertRaises(ReportError):
                    generation_metadata(db, GENERATION, WORKSPACE)

    def test_generation_contract_rejects_hidden_filters_and_bad_parts(self):
        payload = {'action': 'generation-pdf', 'generationId': GENERATION, 'part': 1}
        self.assertEqual(validate(payload), payload)
        for extra in ({'part': True}, {'part': 6}, {'part': 0}, {'generationId': 'not-uuid'},
                      {'status': 'OPTANTE'}, {'clientId': str(uuid.uuid4())}, {'search': 'name'}):
            with self.subTest(extra=extra), self.assertRaises(ReportError):
                validate({**payload, **extra})
        db, *_ = self.setup_db(1)
        with self.assertRaises(ReportError):
            generation_metadata(db, GENERATION, WORKSPACE, 2)
        with self.assertRaises(ReportError) as error:
            generation_metadata(db, GENERATION, 'foreign-workspace')
        self.assertEqual(error.exception.status, 404)


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class GenerationMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.conn['maximum_generation_report_test_' + uuid.uuid4().hex]
        cls.env = patch.dict(os.environ, {'WORKSPACE_ID': WORKSPACE, 'NODE_ENV': 'development',
                                         'APP_ORIGIN': 'http://generation.test', 'VERCEL': '0'})
        cls.env.start()
        raw = secrets.token_urlsafe(32)
        cls.cookie = {'Cookie': 'maximum_session=' + raw}
        cls.db.users.insert_one({'_id': 'generation-user', 'workspaceId': WORKSPACE, 'active': True, 'role': 'operator'})
        cls.db.sessions.insert_one({'_id': hashlib.sha256(raw.encode()).hexdigest(), 'workspaceId': WORKSPACE,
                                   'userId': 'generation-user', 'expiresAt': utcnow() + timedelta(minutes=10)})
        generation, jobs, snapshots = generation_fixture()
        cls.db.generations.insert_one(generation)
        cls.first_job_id = jobs[0]['_id']
        for job, lines, items in snapshots.values():
            cls.db.lookupJobs.insert_one(job)
            cls.db.purchaseLines.insert_many(lines)
            for item in items:
                source = item.pop('sourceState', [])
                if source:
                    cls.db.cnpjStates.update_one({'_id': item['stateId']}, {'$set': {'workspaceId': WORKSPACE,
                        'cnpj': item['cnpj'], 'status': source[0]['status']}}, upsert=True)
            cls.db.lookupItems.insert_many(items)

    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name)
        cls.conn.close()
        cls.env.stop()

    def test_database_components_reconcile_and_other_part_completion_is_required(self):
        meta = generation_metadata(self.db, GENERATION, WORKSPACE, 2)
        self.assertEqual(meta['purchases'][0]['components']['grossCents'], 102500)
        self.db.lookupJobs.update_one({'_id': self.first_job_id}, {'$set': {'status': 'PROCESSING'}})
        try:
            with self.assertRaises(ReportError):
                generation_metadata(self.db, GENERATION, WORKSPACE, 2)
        finally:
            self.db.lookupJobs.update_one({'_id': self.first_job_id}, {'$set': {'status': 'COMPLETED'}})
        row_id = f'{meta["purchases"][0]["job"]["_id"]}:0'
        self.db.purchaseLines.update_one({'_id': row_id}, {'$inc': {'accessoryCents': 1}})
        try:
            with self.assertRaises(ReportError):
                generation_metadata(self.db, GENERATION, WORKSPACE, 2)
        finally:
            self.db.purchaseLines.update_one({'_id': row_id}, {'$inc': {'accessoryCents': -1}})

    def test_http_generation_download_has_same_auth_origin_and_reset_gates(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        from api import reports as endpoint
        server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def call(headers=None):
            payload = {'action': 'generation-pdf', 'generationId': GENERATION, 'part': 2}
            headers = {'Origin': 'http://generation.test', 'Content-Type': 'application/json', **self.cookie, **(headers or {})}
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/', data=json.dumps(payload).encode(), headers=headers), timeout=20)
        try:
            with patch.object(endpoint, 'database', return_value=self.db):
                with call() as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('parte-2-de-2', response.headers['Content-Disposition'])
                    self.assertEqual(response.headers['X-Report-Engine'], 'python')
                    self.assertTrue(response.read().startswith(b'%PDF'))
                for headers, status in (({'Origin': 'http://foreign.test'}, 403), ({'Cookie': ''}, 401)):
                    with self.subTest(headers=headers), self.assertRaises(HTTPError) as error:
                        call(headers)
                    self.assertEqual(error.exception.code, status)
                self.db.users.update_one({'_id': 'generation-user'}, {'$set': {'mustChangePassword': True}})
                try:
                    with self.assertRaises(HTTPError) as error: call()
                    self.assertEqual(error.exception.code, 403)
                finally:
                    self.db.users.update_one({'_id': 'generation-user'}, {'$unset': {'mustChangePassword': ''}})
                self.db.users.update_one({'_id': 'generation-user'}, {'$set': {'active': False}})
                try:
                    with self.assertRaises(HTTPError) as error: call()
                    self.assertEqual(error.exception.code, 401)
                finally:
                    self.db.users.update_one({'_id': 'generation-user'}, {'$set': {'active': True}})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
