"""Synthetic financial snapshots only; no real client files or credentials."""
import hashlib
import json
import os
import secrets
import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from reporting.core import ReportError, utcnow, MAX_RESPONSE_BYTES
from reporting.purchases import reconcile_purchase_snapshot, render_purchase_pdf, money, percentage, _integer, MAX_SAFE_INTEGER, COMPONENT_FIELDS

JOB = '00000000-0000-4000-8000-000000000071'
CLIENT = '00000000-0000-4000-8000-000000000072'
WORKSPACE = 'synthetic-purchases'


def fixture():
    now = utcnow()
    cnpjs = ['11222333000181', '11444777000161', '12345678000195']
    job = {'_id': JOB, 'workspaceId': WORKSPACE, 'mode': 'PURCHASES_V1', 'status': 'COMPLETED',
           'clientId': CLIENT, 'clientCode': '000', 'clientName': 'EMPRESA FICTÍCIA - EXEMPLO',
           'fileName': 'compras-sinteticas.csv', 'completedAt': now, 'expectedRows': 5, 'uploaded': 5,
           'summary': {'lines': 5, 'unique': 3, 'invalid': 1, 'duplicates': 1},
           'purchaseInput': {'totalCents': 100000, 'cnpjCents': 80000}}
    documents = [cnpjs[0], cnpjs[0], cnpjs[1], cnpjs[2], '12345678901']
    cents = [10000, 20000, 40000, 10000, 20000]
    quantities = ['2', '1', '4', '0.5', '1.25']
    lines = [{'_id': f'{JOB}:{i}', 'workspaceId': WORKSPACE, 'jobId': JOB, 'index': i,
              'document': doc, 'documentKind': 'CNPJ' if i < 4 else 'CPF', 'cnpj': doc if i < 4 else '',
              'name': 'FORNECEDOR FICTÍCIO', 'quantity': quantities[i], 'totalCents': cents[i], 'valid': i < 4}
             for i, doc in enumerate(documents)]
    statuses = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO']
    items = [{'_id': f'{JOB}:{cnpj}', 'workspaceId': WORKSPACE, 'jobId': JOB, 'clientId': CLIENT,
              'cnpj': cnpj, 'state': 'DONE', 'status': statuses[i], 'occurrences': 2 if i == 0 else 1,
              'totalCents': [30000, 40000, 10000][i], 'checkedAt': now,
              **({'stateId': f'synthetic-state-{i}', 'sourceState': [{'status': statuses[i]}]} if i < 2 else {})}
             for i, cnpj in enumerate(cnpjs)]
    return job, lines, items


def net_fixture():
    job, lines, items = fixture()
    job['calculationVersion'] = 'NET_V2'
    for line in lines:
        line.update(grossCents=line['totalCents'] + 500, discountCents=200, accessoryCents=177,
                    freightCents=100, abatementCents=400)
    job['purchaseInput']['components'] = {key: sum(line[key] for line in lines)
                                          for key in (*COMPONENT_FIELDS, 'totalCents')}
    return job, lines, items


def large_double_fixture():
    """BSON doubles as emitted by Node for cent values above the Int32 range."""
    job, lines, items = fixture()
    lines[0]['totalCents'] = 3_000_000_000.0
    items[0]['totalCents'] = 3_000_020_000.0
    job['purchaseInput'] = {'totalCents': 3_000_090_000.0, 'cnpjCents': 3_000_070_000.0}
    return job, lines, items


class PurchaseReportTests(unittest.TestCase):
    def test_net_formula_components_and_managerial_unknown_preserve_source(self):
        job, lines, items = net_fixture()
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['calculationVersion'], 'NET_V2')
        self.assertEqual(meta['components'], {'grossCents': 102500, 'discountCents': 1000,
            'accessoryCents': 885, 'freightCents': 500, 'abatementCents': 2000, 'totalCents': 100000})
        nonoptant = meta['managerialGroups'][1]
        self.assertEqual((nonoptant['suppliers'], nonoptant['lines'], nonoptant['totalCents']), (2, 2, 50000))
        self.assertEqual((nonoptant['supplierPercent'], nonoptant['valuePercent']), (66.67, 62.5))
        self.assertEqual(meta['unconfirmed']['totalCents'], 10000)
        self.assertEqual(items[2]['status'], 'NAO_CONFIRMADO')
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        legacy = reconcile_purchase_snapshot(*fixture(), WORKSPACE)
        self.assertEqual(legacy['calculationVersion'], 'Q_V1')
        self.assertIsNone(legacy['components'])

    def test_net_component_tampering_and_unknown_versions_block_pdf(self):
        def omitted(job, lines, items): del lines[0]['discountCents']
        def formula(job, lines, items): lines[0]['freightCents'] += 1
        def informational(job, lines, items): lines[0]['accessoryCents'] += 1
        def summary(job, lines, items): job['purchaseInput']['components']['grossCents'] += 1
        def missing_summary(job, lines, items): del job['purchaseInput']['components']
        def future_version(job, lines, items): job['calculationVersion'] = 'NET_V3'
        def negative(job, lines, items): lines[0]['discountCents'] = -1
        def excessive(job, lines, items): lines[0]['accessoryCents'] = 100_000_000_001
        for change in (omitted, formula, informational, summary, missing_summary, future_version, negative, excessive):
            with self.subTest(change=change.__name__):
                job, lines, items = net_fixture()
                change(job, lines, items)
                with self.assertRaises(ReportError):
                    reconcile_purchase_snapshot(job, lines, items, WORKSPACE)

    def test_bson_integral_doubles_are_normalized_without_losing_centavos(self):
        meta = reconcile_purchase_snapshot(*large_double_fixture(), WORKSPACE)
        self.assertIs(type(meta['totalCents']), int)
        self.assertEqual(meta['totalCents'], 3_000_090_000)
        self.assertIs(type(meta['groups'][0]['totalCents']), int)
        self.assertEqual(meta['groups'][0]['totalCents'], 3_000_020_000)
        self.assertEqual(money(meta['totalCents']), 'R$ 30.000.900,00')
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        self.assertEqual(_integer(float(MAX_SAFE_INTEGER)), MAX_SAFE_INTEGER)
        for invalid in (True, False, float('nan'), float('inf'), float('-inf'), 1.5,
                        -1.0, float(MAX_SAFE_INTEGER + 1), MAX_SAFE_INTEGER + 1):
            with self.subTest(value=invalid), self.assertRaises(ReportError):
                _integer(invalid)

    def test_duplicate_suppliers_preserve_all_amounts_and_explicit_denominators(self):
        job, lines, items = fixture()
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['totalCents'], 100000)
        self.assertEqual(meta['cnpjCents'], 80000)
        self.assertEqual(meta['uniqueSuppliers'], 3)
        self.assertEqual(meta['quantityDisplay'], '8,75')
        optant, nonoptant, unknown, excluded = meta['groups']
        self.assertEqual((optant['suppliers'], optant['lines'], optant['totalCents']), (1, 2, 30000))
        self.assertEqual((optant['supplierPercent'], optant['valuePercent'], optant['fileValuePercent']), (33.33, 37.5, 30))
        self.assertEqual(nonoptant['totalCents'], 40000)
        self.assertEqual(unknown['totalCents'], 10000)
        self.assertEqual((excluded['suppliers'], excluded['totalCents'], excluded['valuePercent']), (0, 20000, None))

    def test_all_cpf_and_zero_value_are_complete_with_zero_denominators(self):
        job, lines, _ = fixture()
        line = dict(lines[-1], index=0, totalCents=0)
        job.update(expectedRows=1, uploaded=1, summary={'lines': 1, 'unique': 0, 'invalid': 1, 'duplicates': 0},
                   purchaseInput={'totalCents': 0, 'cnpjCents': 0})
        meta = reconcile_purchase_snapshot(job, [line], [], WORKSPACE)
        self.assertEqual(meta['uniqueSuppliers'], 0)
        self.assertTrue(all(group['supplierPercent'] == 0 and group['fileValuePercent'] == 0 for group in meta['groups']))
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_missing_or_tampered_snapshots_block_report(self):
        def alter_job(job, lines, items): job['purchaseInput']['totalCents'] += 1
        def alter_line(job, lines, items): lines[0]['totalCents'] += 1
        def incomplete(job, lines, items): items[0]['state'] = 'PENDING'
        def wrong_client(job, lines, items): items[0]['clientId'] = 'other'
        def wrong_workspace(job, lines, items): lines[0]['workspaceId'] = 'other'
        def missing_state(job, lines, items): items[0]['sourceState'] = []
        def wrong_status(job, lines, items): items[0]['sourceState'][0]['status'] = 'NAO_OPTANTE'
        def missing_lookup(job, lines, items): items.pop()
        def duplicated_index(job, lines, items): lines[1]['index'] = 0
        def fractional_money(job, lines, items): lines[0]['totalCents'] = 10000.5
        def bad_quantity(job, lines, items): lines[0]['quantity'] = 'NaN'
        def cpf_classified_as_cnpj(job, lines, items): lines[-1].update(valid=True, cnpj='12345678901')
        for change in (alter_job, alter_line, incomplete, wrong_client, wrong_workspace, missing_state,
                       wrong_status, missing_lookup, duplicated_index, fractional_money, bad_quantity, cpf_classified_as_cnpj):
            with self.subTest(change=change.__name__):
                job, lines, items = fixture()
                change(job, lines, items)
                with self.assertRaises(ReportError) as error:
                    reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(error.exception.status, 409)

    def test_pdf_uses_integer_money_and_escapes_markup(self):
        self.assertEqual(money(9_007_199_254_740_991), 'R$ 90.071.992.547.409,91')
        self.assertEqual(percentage(10010, 40000), 25.03)
        job, lines, items = fixture()
        job['clientName'] = 'FICTÍCIA & <img src="https://invalid.test/">'
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        data = render_purchase_pdf(meta)
        self.assertTrue(data.startswith(b'%PDF'))
        self.assertLess(len(data), MAX_RESPONSE_BYTES)


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class PurchaseMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.conn['maximum_purchase_report_test_' + uuid.uuid4().hex]
        cls.env = patch.dict(os.environ, {'WORKSPACE_ID': WORKSPACE, 'NODE_ENV': 'development',
                                         'APP_ORIGIN': 'http://purchases.test', 'VERCEL': '0'})
        cls.env.start()
        cls.raw = secrets.token_urlsafe(32)
        cls.cookie = {'Cookie': 'maximum_session=' + cls.raw}
        cls.db.users.insert_one({'_id': 'synthetic-user', 'workspaceId': WORKSPACE, 'active': True, 'role': 'operator'})
        cls.db.sessions.insert_one({'_id': hashlib.sha256(cls.raw.encode()).hexdigest(), 'workspaceId': WORKSPACE,
                                   'userId': 'synthetic-user', 'expiresAt': utcnow() + timedelta(minutes=10)})
        job, lines, items = fixture()
        cls.db.lookupJobs.insert_one(job)
        cls.db.purchaseLines.insert_many(lines)
        for item in items:
            source = item.pop('sourceState', [])
            if source:
                cls.db.cnpjStates.insert_one({'_id': item['stateId'], 'workspaceId': WORKSPACE,
                                              'cnpj': item['cnpj'], 'status': source[0]['status']})
            cls.db.lookupItems.insert_one(item)

    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name)
        cls.conn.close()
        cls.env.stop()

    def test_scoped_database_snapshot_and_generic_history(self):
        from reporting.purchases import purchase_metadata
        from reporting.service import get_job, jobs
        job = get_job(self.db, JOB, WORKSPACE, CLIENT)
        self.assertEqual(purchase_metadata(self.db, job, WORKSPACE)['totalCents'], 100000)
        self.assertEqual(jobs(self.db, WORKSPACE, CLIENT, 1)['total'], 0)
        self.db.cnpjStates.update_one({'_id': 'synthetic-state-0'}, {'$set': {'workspaceId': 'another-workspace'}})
        try:
            with self.assertRaises(ReportError):
                purchase_metadata(self.db, job, WORKSPACE)
        finally:
            self.db.cnpjStates.update_one({'_id': 'synthetic-state-0'}, {'$set': {'workspaceId': WORKSPACE}})

    def test_large_bson_doubles_survive_database_read_and_pdf_render(self):
        from reporting.purchases import purchase_metadata
        from reporting.service import get_job
        job, lines, items = large_double_fixture()
        job_id = str(uuid.uuid4())
        job['_id'] = job_id
        for line in lines:
            line.update(_id=f'{job_id}:{line["index"]}', jobId=job_id)
        for item in items:
            item.update(_id=f'{job_id}:{item["cnpj"]}', jobId=job_id)
            item.pop('sourceState', None)
        self.db.lookupJobs.insert_one(job)
        self.db.purchaseLines.insert_many(lines)
        self.db.lookupItems.insert_many(items)
        stored = self.db.purchaseLines.find_one({'_id': f'{job_id}:0'})
        self.assertIs(type(stored['totalCents']), float)
        meta = purchase_metadata(self.db, get_job(self.db, job_id, WORKSPACE, CLIENT), WORKSPACE)
        self.assertIs(type(meta['totalCents']), int)
        self.assertEqual(meta['totalCents'], 3_000_090_000)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_authenticated_http_financial_pdf_and_refused_generic_exports(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        from api import reports as endpoint
        server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def call(extra):
            payload = {'action': 'pdf', 'layout': 'summary', 'jobId': JOB, 'clientId': CLIENT, **extra}
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/', data=json.dumps(payload).encode(),
                                   headers={'Origin': 'http://purchases.test', 'Content-Type': 'application/json', **self.cookie}), timeout=15)
        try:
            with patch.object(endpoint, 'database', return_value=self.db):
                with call({}) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('compras-', response.headers['Content-Disposition'])
                    self.assertTrue(response.read().startswith(b'%PDF'))
                for extra in ({'clientId': ''}, {'layout': 'detailed'}, {'action': 'csv'}, {'status': 'OPTANTE'}):
                    with self.subTest(extra=extra), self.assertRaises(HTTPError) as error:
                        call(extra)
                    self.assertEqual(error.exception.code, 400)
                self.db.purchaseLines.update_one({'_id': f'{JOB}:0'}, {'$inc': {'totalCents': 1}})
                try:
                    with self.assertRaises(HTTPError) as error:
                        call({})
                    self.assertEqual(error.exception.code, 409)
                finally:
                    self.db.purchaseLines.update_one({'_id': f'{JOB}:0'}, {'$inc': {'totalCents': -1}})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
