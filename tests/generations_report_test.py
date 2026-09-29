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
from purchases_report_test import net_fixture, sales_fixture, WORKSPACE

GENERATION = '00000000-0000-4000-8000-000000000090'


def generation_fixture(count=11, required_reports=None):
    companies, jobs, snapshots = [], [], {}
    for i in range(count):
        client_id = str(uuid.UUID(int=i+200))
        company = {'clientId': client_id, 'code': f'{i+1:03}', 'name': f'EMPRESA FICTÍCIA {i+1}'}
        for report_type in required_reports or ['PURCHASES']:
            sales = report_type == 'SALES'
            slot = 'sales' if sales else 'purchase'
            job, lines, items = sales_fixture() if sales else net_fixture()
            job_id = str(uuid.UUID(int=i+(1000 if sales else 100)))
            job.update(_id=job_id, generationId=GENERATION, clientId=client_id,
                       clientCode=company['code'], clientName=company['name'])
            for line in lines:
                line.update(_id=f'{job_id}:{line["index"]}', jobId=job_id)
            for item in items:
                item.update(_id=f'{job_id}:{item["cnpj"]}', jobId=job_id, clientId=client_id)
            company.update({f'{slot}JobId': job_id, f'{slot}JobIds': [job_id]})
            jobs.append(job)
            snapshots[job_id] = (job, lines, items)
        companies.append(company)
    generation = {'_id': GENERATION, 'workspaceId': WORKSPACE, 'createdAt': utcnow(), 'companies': companies}
    if required_reports is not None:
        generation['requiredReports'] = required_reports
    return generation, jobs, snapshots


class Cursor(list):
    def limit(self, _): return self
    def max_time_ms(self, _): return self


class GenerationReportTests(unittest.TestCase):
    def setup_db(self, count=11, required_reports=None):
        generation, jobs, snapshots = generation_fixture(count, required_reports)
        db = SimpleNamespace(
            generations=SimpleNamespace(find_one=lambda query: generation if query['workspaceId'] == WORKSPACE else None),
            lookupJobs=SimpleNamespace(find=lambda query: Cursor(jobs)))
        return db, generation, jobs, snapshots

    def test_sales_and_purchases_have_separate_totals_and_company_sections(self):
        db, generation, jobs, snapshots = self.setup_db(2, ['PURCHASES', 'SALES'])
        with patch('reporting.generations.purchase_metadata', side_effect=lambda db, job, workspace:
                   reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)):
            meta = generation_metadata(db, GENERATION, WORKSPACE)
        self.assertEqual(meta['requiredReports'], ['PURCHASES', 'SALES'])
        self.assertEqual(len(meta['sections']), 2)
        self.assertEqual(len(meta['purchases']), 2)
        self.assertEqual(len(meta['sales']), 2)
        self.assertEqual(meta['totalsByType']['PURCHASES']['totalCents'], 200000)
        self.assertEqual(meta['totalsByType']['SALES']['totalCents'], 200000)
        self.assertEqual(meta['sections'][0]['reports']['SALES']['reportType'], 'SALES')
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))

    def test_sales_only_and_legacy_purchase_only_generation_remain_valid(self):
        for required, expected in ((['SALES'], ['SALES']), (None, ['PURCHASES'])):
            with self.subTest(required=required):
                db, _, _, snapshots = self.setup_db(1, required)
                with patch('reporting.generations.purchase_metadata', side_effect=lambda db, job, workspace:
                           reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)):
                    meta = generation_metadata(db, GENERATION, WORKSPACE)
                self.assertEqual(meta['requiredReports'], expected)
                self.assertEqual(set(meta['totalsByType']), set(expected))
                self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))

    def test_missing_sales_outside_part_and_cross_mode_links_block_before_reading_rows(self):
        def incomplete(g, jobs): jobs[1]['status'] = 'PROCESSING'
        def missing(g, jobs): g['companies'][0]['salesJobId'] = None
        def wrong_mode(g, jobs): jobs[1]['mode'] = 'PURCHASES_V1'
        def wrong_generation(g, jobs): jobs[1]['generationId'] = 'different'
        def missing_history(g, jobs): g['companies'][0]['salesJobIds'] = []
        def repeat_slot(g, jobs): g['companies'][0]['salesJobId'] = g['companies'][0]['purchaseJobId']
        for change in (incomplete, missing, wrong_mode, wrong_generation, missing_history, repeat_slot):
            with self.subTest(change=change.__name__):
                db, generation, jobs, _ = self.setup_db(11, ['PURCHASES', 'SALES'])
                change(generation, jobs)
                with patch('reporting.generations.purchase_metadata') as read, self.assertRaises(ReportError):
                    generation_metadata(db, GENERATION, WORKSPACE, 2)
                read.assert_not_called()

    def test_invalid_required_report_config_and_hidden_sales_slot_block(self):
        for required in ([], ['UNKNOWN'], ['SALES', 'SALES'], 'SALES', None, [None]):
            with self.subTest(required=required):
                db, generation, *_ = self.setup_db(1)
                generation['requiredReports'] = required
                with self.assertRaises(ReportError):
                    generation_metadata(db, GENERATION, WORKSPACE)
        db, generation, *_ = self.setup_db(1)
        generation['companies'][0]['salesJobId'] = str(uuid.uuid4())
        with self.assertRaises(ReportError):
            generation_metadata(db, GENERATION, WORKSPACE)

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
        generation, jobs, snapshots = generation_fixture(11, ['PURCHASES', 'SALES'])
        cls.db.generations.insert_one(generation)
        cls.first_job_id = jobs[0]['_id']
        cls.first_sales_job_id = jobs[1]['_id']
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
        self.assertEqual(meta['sales'][0]['components']['grossCents'], 102500)
        for job_id in (self.first_job_id, self.first_sales_job_id):
            self.db.lookupJobs.update_one({'_id': job_id}, {'$set': {'status': 'PROCESSING'}})
            try:
                with self.assertRaises(ReportError):
                    generation_metadata(self.db, GENERATION, WORKSPACE, 2)
            finally:
                self.db.lookupJobs.update_one({'_id': job_id}, {'$set': {'status': 'COMPLETED'}})
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
