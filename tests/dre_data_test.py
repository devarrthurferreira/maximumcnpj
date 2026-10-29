"""DRE access and snapshot-integrity tests using synthetic production-engine data."""
import copy
import hashlib
import json
import os
import secrets
import subprocess
import unittest
import uuid
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from unittest.mock import patch

from reporting.core import ReportError, utcnow, validate
from reporting.dre_data import dre_metadata, validate_dre_snapshot

ROOT = Path(__file__).resolve().parents[1]
SIMULATION = '96969696-9696-4696-8696-969696969601'
ANALYSIS = '96969696-9696-4696-8696-969696969606'


@lru_cache(maxsize=1)
def fixtures():
    script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateSimulation} from './public/simulator-engine.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
const fixtures=Object.fromEntries(['complete','partial','loss','zero','unavailable','negative-revenue','purchases-above-revenue'].map(variant=>[variant,drePdfFixture({variant})]));
const legacy=structuredClone(fixtures.complete);
legacy.result=calculateSimulation(legacy.draft);
legacy.monthlyDre=buildMonthlyDre(legacy.result,2027,legacy.rbt12Manual);
delete legacy.analysisPeriod;delete legacy.source.analysisPeriod;
fixtures.legacy=legacy;
process.stdout.write(JSON.stringify(fixtures));
"""
    output = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                            check=True, capture_output=True, text=True, timeout=30)
    return json.loads(output.stdout)


def fixture(variant='complete'):
    return copy.deepcopy(fixtures()[variant])


class DreDataTests(unittest.TestCase):
    def test_request_accepts_only_saved_reference_and_options(self):
        options = validate({'action': 'dre-pdf', 'simulationId': SIMULATION})
        self.assertEqual(options, {'action': 'dre-pdf', 'simulationId': SIMULATION,
                                  'period': 'complete', 'regimeId': None, 'showPercent': True})
        for bad in ({'result': {}}, {'drePresentation': {}}, {'clientId': SIMULATION},
                    {'workspaceId': 'other'}, {'simulationId': {'$ne': ''}}, {'simulationId': 'a' * 36},
                    {'period': ['complete']}, {'period': 'selected'}, {'regimeId': {'$ne': ''}},
                    {'regimeId': 'unknown'}, {'showPercent': 1}, {'showPercent': 'false'},
                    {'part': 2}, {'action': []}):
            with self.subTest(bad=bad), self.assertRaises(ReportError):
                validate({'action': 'dre-pdf', 'simulationId': SIMULATION, **bad})
        for period in ('complete', 'annual', 'monthly'):
            options = validate({'action': 'dre-pdf', 'simulationId': SIMULATION, 'period': period,
                                'regimeId': 'actual', 'showPercent': False})
            self.assertEqual(options['period'], period)
            self.assertFalse(options['showPercent'])

    def test_engine_snapshots_preserve_partial_loss_zero_and_unavailable(self):
        for variant in fixtures():
            with self.subTest(variant=variant):
                saved = fixture(variant)
                before = copy.deepcopy(saved)
                self.assertIs(validate_dre_snapshot(saved), saved)
                self.assertEqual(saved, before)
        partial = fixture('partial')
        self.assertEqual([row['sourceMonth'] for row in partial['result']['monthlyResults']],
                         ['2025-01', '2025-03', '2025-09'])
        self.assertEqual(len(partial['monthlyDre']['months']), 3)

    def test_inconsistent_company_and_invalid_identifiers_are_blocked(self):
        for update in ({'clientId': '0' * 36}, {'year': True}, {'company': {'name': ''}},
                       {'source': []}, {'draft': None}, {'engineInput': []}, {'taxSources': 'invalid'},
                       {'source': {'clientId': '96969696-9696-4696-8696-969696969699'}},
                       {'source': {'company': {'code': 'ANOTHER COMPANY'}}}):
            with self.subTest(update=update), self.assertRaises(ReportError):
                validate_dre_snapshot({**fixture(), **update})

    def test_negative_revenue_preserves_values_and_rejects_fabricated_percentages(self):
        saved = fixture('negative-revenue')
        self.assertLess(saved['result']['annualRevenue'], 0)
        self.assertIs(validate_dre_snapshot(saved), saved)
        self.assertIsNone(saved['result']['bestRegimeId'])
        for result in [saved['result'], *[row['result'] for row in saved['result']['monthlyResults']]]:
            for regime in result['regimes']:
                with self.subTest(regime=regime['id'], revenue=result['annualRevenue']):
                    self.assertTrue(regime['available'])
                    self.assertEqual(regime['dre']['revenue'], result['annualRevenue'])
                    self.assertLess(regime['dre']['netProfit'], 0)
                    self.assertGreaterEqual(regime['totalTaxes'], 0)
                    self.assertIsNone(regime['margin'])
                    self.assertIsNone(regime['taxBurden'])
                    for tax in ('das', 'cbsDebit', 'ibsDebit', 'icmsNet', 'iss', 'payroll',
                                'irpj', 'csll', 'difal', 'icmsAnticipation'):
                        self.assertLessEqual(regime['dre'].get(tax, 0), 0,
                                             f'{tax} must not become a refund from negative revenue.')
        for field in ('margin', 'taxBurden'):
            changed = copy.deepcopy(saved)
            changed['result']['regimes'][0][field] = 0
            with self.subTest(field=field), self.assertRaises(ReportError):
                validate_dre_snapshot(changed)
        changed = copy.deepcopy(saved)
        changed['result']['annualRevenue'] = 0
        with self.assertRaises(ReportError):
            validate_dre_snapshot(changed)

    def test_malformed_and_unbalanced_dre_cannot_be_published(self):
        mutations = [
            lambda s: s['result']['regimes'][0]['dre'].__setitem__('netProfit', 42),
            lambda s: s['result']['regimes'][0]['dre'].__setitem__('netProfit', s['result']['regimes'][0]['dre']['netProfit'] + .01),
            lambda s: s['result']['regimes'][0]['dre'].__setitem__('revenue', True),
            lambda s: s['result']['regimes'][0]['dre'].__setitem__('sales', float('inf')),
            lambda s: s['result']['regimes'][0]['dre'].pop('rent'),
            lambda s: s['result']['regimes'][0].__setitem__('margin', .999),
            lambda s: s['result']['regimes'].append(copy.deepcopy(s['result']['regimes'][0])),
            lambda s: s['result']['regimes'][0].__setitem__('available', 'true'),
            lambda s: s['result']['memory'][0].__setitem__('value', float('nan')),
            lambda s: s['result']['credits']['cbs'].__setitem__('used', float('nan')),
            lambda s: s['result']['credits']['icms'].__setitem__('balance', 123),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                saved = fixture()
                mutate(saved)
                with self.assertRaises(ReportError) as caught:
                    validate_dre_snapshot(saved)
                self.assertEqual(caught.exception.code, 'DRE_SNAPSHOT_INVALID')

    def test_monthly_total_and_coverage_mismatches_are_blocked(self):
        mutations = [
            lambda s: s['result']['monthlyResults'].pop(),
            lambda s: s['result']['monthlyResults'][0].__setitem__('month', 9),
            lambda s: s['result']['monthlyResults'][0].__setitem__('sourceMonth', '2024-01'),
            lambda s: s['result']['monthlyResults'][0]['result']['regimes'][0]['dre'].__setitem__('cbsUsed', 700),
            lambda s: s['source']['monthlyReports'].reverse(),
            lambda s: s['analysisPeriod'].__setitem__('missingMonths', []),
            lambda s: s['monthlyDre']['regimes'][0]['rows'][0]['months'].__setitem__(0, 123),
            lambda s: s['monthlyDre']['months'][0].__setitem__('sourceMonth', '2024-01'),
            lambda s: s['result']['regimes'][0].__setitem__('available', False),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                saved = fixture('partial')
                mutate(saved)
                with self.assertRaises(ReportError):
                    validate_dre_snapshot(saved)

    def test_historical_months_must_remain_in_chronological_order(self):
        saved = fixture()
        # A historical report may predate JAN_SEP; validation still protects the
        # time axis even if every source list was incorrectly reordered together.
        for holder in (saved, saved['source'], saved['result']):
            holder.pop('analysisPeriod', None)
        saved.pop('monthlyDre')
        saved['result']['monthlyResults'].reverse()
        saved['source']['monthlyReports'].reverse()
        saved['monthlyInputs'].reverse()
        with self.assertRaises(ReportError):
            validate_dre_snapshot(saved)


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class DreDataMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.conn['maximum_dre_report_test_' + uuid.uuid4().hex]
        cls.ws = 'dre-reports-ci'
        cls.raw = secrets.token_urlsafe(32)
        cls.cookie = {'Cookie': 'maximum_session=' + cls.raw}
        cls.env = patch.dict(os.environ, {'WORKSPACE_ID': cls.ws, 'NODE_ENV': 'development',
                                          'APP_ORIGIN': 'http://dre-reports.test', 'VERCEL': '0'})
        cls.env.start()
        cls.db.users.insert_one({'_id': 'dre-viewer', 'workspaceId': cls.ws, 'active': True, 'role': 'viewer'})
        cls.db.sessions.insert_one({'_id': hashlib.sha256(cls.raw.encode()).hexdigest(),
                                    'workspaceId': cls.ws, 'userId': 'dre-viewer', 'expiresAt': utcnow() + timedelta(minutes=15)})

    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name)
        cls.conn.close()
        cls.env.stop()

    def setUp(self):
        self.db.simulations.delete_many({})
        self.db.audit.delete_many({})
        self.db.analyses.delete_many({})
        self.db.limits.delete_many({})
        self.db.users.update_one({'_id': 'dre-viewer'}, {'$set': {'active': True}, '$unset': {'mustChangePassword': ''}})
        self.saved = {**fixture(), 'workspaceId': self.ws, 'requestHash': 'internal-request-hash'}
        self.db.simulations.insert_one(self.saved)
        self.options = validate({'action': 'dre-pdf', 'simulationId': SIMULATION})

    def meta(self, workspace=None, **options):
        return dre_metadata(self.db, SIMULATION, workspace or self.ws, {**self.options, **options})

    def receipt(self, kind, identifier, **extra):
        digest = hashlib.sha256(json.dumps([self.ws, identifier], separators=(',', ':')).encode()).hexdigest()
        self.db.audit.insert_one({'_id': kind + '-delete:' + digest, 'workspaceId': self.ws,
                                  'action': kind + '.delete', 'target': identifier, **extra})

    def test_metadata_is_isolated_read_only_and_omits_internal_fields(self):
        before = self.db.simulations.find_one({'_id': SIMULATION})
        meta = self.meta()
        self.assertEqual(meta['snapshot']['result'], self.saved['result'])
        self.assertNotIn('workspaceId', meta['snapshot'])
        self.assertNotIn('requestHash', meta['snapshot'])
        self.assertEqual(self.db.simulations.find_one({'_id': SIMULATION}), before)
        with self.assertRaises(ReportError) as caught:
            self.meta('another-workspace')
        self.assertEqual(caught.exception.status, 404)
        self.assertNotIn('reportFiles', self.db.list_collection_names())

    def test_deleted_snapshot_and_durable_receipt_are_hidden(self):
        self.db.simulations.update_one({'_id': SIMULATION}, {'$set': {'deletedAt': utcnow()}})
        with self.assertRaises(ReportError):
            self.meta()
        self.db.simulations.update_one({'_id': SIMULATION}, {'$unset': {'deletedAt': ''}})
        self.receipt('simulation', SIMULATION)
        with self.assertRaises(ReportError):
            self.meta()

    def test_pending_analysis_version_requires_published_pointer(self):
        self.db.simulations.update_one({'_id': SIMULATION}, {'$set': {'analysisId': ANALYSIS, 'analysisPublication': 'PENDING'}})
        with self.assertRaises(ReportError) as caught:
            self.meta()
        self.assertEqual(caught.exception.status, 404)
        self.db.analyses.insert_one({'_id': ANALYSIS, 'workspaceId': self.ws,
                                     'clientId': self.saved['clientId'], 'currentSimulation': {'id': SIMULATION}})
        self.assertEqual(self.meta()['snapshot']['_id'], SIMULATION)
        self.db.analyses.update_one({'_id': ANALYSIS}, {'$set': {'deletionStartedAt': utcnow()}})
        with self.assertRaises(ReportError):
            self.meta()

    def test_analysis_deletion_hides_direct_adopted_and_reprocessed_history(self):
        parent = '96969696-9696-4696-8696-969696969607'
        self.db.simulations.update_one({'_id': SIMULATION}, {'$set': {
            'parentSimulationId': parent, 'reprocessing': {'originalId': parent}}})
        self.db.simulations.insert_one({'_id': parent, 'workspaceId': self.ws, 'clientId': self.saved['clientId'],
                                        'generationId': self.saved['generationId'], 'analysisId': ANALYSIS})
        self.receipt('analysis', ANALYSIS, clientId=self.saved['clientId'], legacySimulationIds=[parent])
        with self.assertRaises(ReportError):
            self.meta()
        self.db.simulations.delete_one({'_id': parent})
        self.receipt('simulation', parent, analysisId=ANALYSIS)
        with self.assertRaises(ReportError):
            self.meta()
        # An independently created parent does not establish automatic lineage.
        self.db.simulations.update_one({'_id': SIMULATION}, {'$unset': {'reprocessing': ''}})
        self.assertTrue(self.meta()['snapshot']['parentSimulationDeleted'])
        self.db.audit.update_one({'target': ANALYSIS}, {'$addToSet': {'legacySimulationIds': SIMULATION}})
        with self.assertRaises(ReportError):
            self.meta()

    def test_regime_must_belong_to_saved_selection(self):
        selected = fixture()
        selected['result']['regimes'] = selected['result']['regimes'][2:]
        selected['result']['regimeSelection']['selected'] = ['presumed', 'actual']
        for row in selected['result']['monthlyResults']:
            row['result']['regimes'] = row['result']['regimes'][2:]
            row['result']['regimeSelection']['selected'] = ['presumed', 'actual']
        selected['monthlyDre']['regimes'] = selected['monthlyDre']['regimes'][2:]
        self.db.simulations.replace_one({'_id': SIMULATION}, {**selected, 'workspaceId': self.ws})
        self.assertEqual(self.meta(regimeId='actual')['options']['regimeId'], 'actual')
        with self.assertRaises(ReportError) as caught:
            self.meta(regimeId='pure')
        self.assertEqual(caught.exception.code, 'DRE_REGIME')

    def test_http_download_requires_session_origin_active_account_and_server_snapshot(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        from api import reports as endpoint
        server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def call(payload=None, headers=None):
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/',
                                   data=json.dumps(payload or self.options).encode(),
                                   headers={'Origin': 'http://dre-reports.test', 'Content-Type': 'application/json',
                                            **self.cookie, **(headers or {})}), timeout=30)

        try:
            with patch.object(endpoint, 'database', return_value=self.db):
                for variant in ('complete', 'negative-revenue', 'purchases-above-revenue'):
                    saved = {**fixture(variant), 'workspaceId': self.ws}
                    self.db.simulations.replace_one({'_id': SIMULATION}, saved)
                    before = self.db.simulations.find_one({'_id': SIMULATION})
                    with self.subTest(variant=variant), call() as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.headers['Content-Type'], 'application/pdf')
                        self.assertEqual(response.headers['X-Report-Engine'], 'python')
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        self.assertIn(SIMULATION, response.headers['Content-Disposition'])
                        self.assertIn('attachment;', response.headers['Content-Disposition'])
                        data = response.read()
                        self.assertTrue(data.startswith(b'%PDF-'))
                        self.assertGreater(len(data), 10_000)
                    self.assertEqual(self.db.simulations.find_one({'_id': SIMULATION}), before)
                for headers, expected in (({'Cookie': ''}, 401), ({'Origin': 'https://evil.test'}, 403)):
                    with self.subTest(headers=headers), self.assertRaises(HTTPError) as caught:
                        call(headers=headers)
                    self.assertEqual(caught.exception.code, expected)
                with self.assertRaises(HTTPError) as caught:
                    call({**self.options, 'result': {'regimes': []}})
                self.assertEqual(caught.exception.code, 400)
                self.db.users.update_one({'_id': 'dre-viewer'}, {'$set': {'mustChangePassword': True}})
                with self.assertRaises(HTTPError) as caught:
                    call()
                self.assertEqual(caught.exception.code, 403)
                self.db.users.update_one({'_id': 'dre-viewer'}, {'$unset': {'mustChangePassword': ''}, '$set': {'active': False}})
                with self.assertRaises(HTTPError) as caught:
                    call()
                self.assertEqual(caught.exception.code, 401)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
