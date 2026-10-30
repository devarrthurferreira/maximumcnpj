"""Saved zero-exit DIFAL revisions must change the amounts, not just their label."""
import copy
import csv
import hashlib
import io
import json
import os
import re
import secrets
import subprocess
import unittest
import uuid
from datetime import timedelta
from functools import lru_cache
from unittest.mock import patch

import pymupdf

from dre_data_test import ROOT
from dre_model_test import model
from dre_pdf_test import amount, render, section_text
from reporting.core import ReportError, utcnow, validate
from reporting.dre_data import dre_metadata, validate_dre_snapshot


@lru_cache(maxsize=1)
def snapshots():
    # Only the imported exit estimate changes. The real monthly engine builds
    # both complete snapshots; Python must never repair their tax calculations.
    script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateMonthlySimulation} from './public/simulator-monthly.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
import {buildDrePresentation} from './public/simulator-dre.js';
import {buildDreCsv} from './public/simulator-dre-export.js';
import {REPROCESS_VERSION} from './public/simulation-reprocess-contract.js';
const previous=drePdfFixture(),corrected=structuredClone(previous);
corrected._id='96969696-9696-4696-8696-969696969607';
corrected.parentSimulationId=previous._id;
corrected.reprocessing={version:REPROCESS_VERSION,originalId:previous._id,completedAt:'2026-10-30T14:00:00Z'};
for(const row of corrected.source.monthlyReports){
  row.difal={...row.difal,version:'DIFAL_ESTIMATE_V5',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0};
}
Object.assign(corrected,calculateMonthlySimulation(corrected.draft,corrected.source.monthlyReports,
  corrected.monthlyInputs,corrected.source.sales.jobId,null,corrected.analysisPeriod));
corrected.source.sales.difal={...corrected.source.monthlyReports[0].difal};
corrected.source.projection=corrected.projection;
corrected.modelVersion=corrected.result.version;
corrected.annualRevenue=corrected.result.annualRevenue;
corrected.bestRegimeId=corrected.result.bestRegimeId;
corrected.monthlyDre=buildMonthlyDre(corrected.result,corrected.year,corrected.rbt12Manual,corrected.source.period);
const csv=Object.fromEntries(Object.entries({previous,corrected}).map(([key,s])=>{
  const presentation=buildDrePresentation({result:s.result,calendar:s.monthlyDre,source:s.source,
    monthlyGroups:s.monthlyGroups,projection:s.projection,reportMonths:s.reportMonths,
    engineInput:s.engineInput,taxSources:s.taxSources,rbt12Source:s.rbt12Source});
  return [key,buildDreCsv({presentation,period:'complete',company:s.company,year:s.year,showPercent:false})];
}));
process.stdout.write(JSON.stringify({previous,corrected,csv}));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                            capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout)


def pair():
    data = snapshots()
    return copy.deepcopy(data['previous']), copy.deepcopy(data['corrected'])


def assert_statement(test, content, snapshot):
    """Match each financial row in the actual PDF to all four saved regimes."""
    with pymupdf.open(stream=content, filetype='pdf') as document:
        statement = section_text(document, 'DRE comparativa detalhada', 'Como o resultado se forma')
        for key, label in (('difal', 'DIFAL sobre vendas'), ('icmsAnticipation', 'Antecipação de ICMS'),
                           ('netRevenue', 'Receita após deduções tributárias'),
                           ('netProfit', 'Resultado líquido')):
            expected = label + ' ' + ' '.join(amount(row['dre'][key]) for row in snapshot['result']['regimes'])
            test.assertTrue(expected in statement, f'PDF does not preserve the saved {key} row: {expected}')
        return section_text(document, 'DRE mensal por regime', 'Premissas, cobertura e conferências')


class DreDifalZeroTests(unittest.TestCase):
    def test_zero_exit_updates_months_subtotals_taxes_and_profit_without_changing_entry(self):
        previous, corrected = pair()
        self.assertEqual(corrected['source']['sales']['difal']['amountCents'], 0)
        self.assertEqual(corrected['difalProjection']['annualCents'], 0)
        self.assertEqual(corrected['anticipationProjection'], previous['anticipationProjection'])
        self.assertEqual(corrected['anticipationProjection']['annualCents'], 197640)
        self.assertEqual(corrected['source']['fields'], previous['source']['fields'])
        self.assertEqual(corrected['monthlyInputs'], previous['monthlyInputs'])
        self.assertIs(validate_dre_snapshot(previous), previous)
        self.assertIs(validate_dre_snapshot(corrected), corrected)
        before_view, after_view = model(previous), model(corrected)
        for old, new in zip(previous['result']['regimes'], corrected['result']['regimes']):
            simple = new['id'] in ('pure', 'hybrid')
            removed = 3780 if simple else 0
            with self.subTest(regime=new['id'], frame='consolidated'):
                self.assertTrue(new['available'])
                self.assertEqual(old['dre']['difal'], -removed)
                self.assertEqual(new['dre']['difal'], 0)
                self.assertAlmostEqual(new['dre']['icmsAnticipation'], -1976.4 if simple else 0, places=7)
                self.assertEqual(new['dre']['icmsAnticipation'], old['dre']['icmsAnticipation'])
                for key in ('netRevenue', 'grossProfit', 'preTax', 'netProfit'):
                    self.assertAlmostEqual(new['dre'][key] - old['dre'][key], removed, places=7)
                self.assertAlmostEqual(new['totalTaxes'] - old['totalTaxes'], -removed, places=7)
                self.assertAlmostEqual(new['annualProfit'] - old['annualProfit'], removed, places=7)
                self.assertAlmostEqual(after_view.value(new, 'revenueDeductions') -
                                       before_view.value(old, 'revenueDeductions'), removed, places=7)
                for key in ('revenue', 'cmv', 'personnel', 'administrative', 'rent', 'cards', 'irpj', 'csll'):
                    self.assertEqual(new['dre'][key], old['dre'][key])
            for index, (old_month, new_month) in enumerate(zip(previous['result']['monthlyResults'],
                                                               corrected['result']['monthlyResults'])):
                old_row = next(row for row in old_month['result']['regimes'] if row['id'] == new['id'])
                new_row = next(row for row in new_month['result']['regimes'] if row['id'] == new['id'])
                delta = (index + 1) * 84 if simple else 0
                with self.subTest(regime=new['id'], month=new_month['sourceMonth']):
                    self.assertEqual(new_row['dre']['difal'], 0)
                    self.assertEqual(new_row['dre']['icmsAnticipation'], old_row['dre']['icmsAnticipation'])
                    self.assertAlmostEqual(new_row['dre']['netProfit'] - old_row['dre']['netProfit'], delta, places=7)
                    self.assertAlmostEqual(new_row['totalTaxes'] - old_row['totalTaxes'], -delta, places=7)
                    self.assertEqual(after_view.value(new, 'difal', index), 0)
        for regime in corrected['monthlyDre']['regimes']:
            row = next(row for row in regime['rows'] if row['key'] == 'difal')
            self.assertEqual(row['annual'], 0)
            self.assertEqual(row['months'], [0] * 9)

    def test_real_pdf_and_csv_export_zero_exit_positive_entry_and_revised_profit(self):
        previous, corrected = pair()
        frozen = copy.deepcopy(corrected)
        annex = assert_statement(self, render(corrected), corrected)
        rows = re.findall(r'DIFAL sobre vendas ([\d.,\s-]+)(?=Antecipação de ICMS)', annex)
        self.assertEqual(len(rows), 12, 'All four regimes and three monthly table pages retain the zero row.')
        self.assertTrue(all(set(row.split()) == {'0,00'} for row in rows))
        self.assertIn('Antecipação de ICMS -43,92 -87,84 -131,76 -1.976,40', annex)
        self.assertEqual(corrected, frozen)
        csv_rows = list(csv.reader(io.StringIO(snapshots()['csv']['corrected']), delimiter=';'))
        exit_rows = [row for row in csv_rows if len(row) > 5 and row[0] == 'DRE' and row[2].lstrip("'") == '− DIFAL sobre vendas (10%)']
        entry_rows = [row for row in csv_rows if len(row) > 5 and row[0] == 'DRE' and row[2].lstrip("'") == '− Antecipação de ICMS']
        self.assertEqual(len(exit_rows), 1)
        self.assertEqual(exit_rows[0][5:9], ['0,00'] * 4)
        self.assertEqual(entry_rows[0][5:9], ['-1976,40', '-1976,40', '0,00', '0,00'])
        monthly_exit = [row for row in csv_rows if len(row) > 6 and row[1] == 'DRE' and row[3].lstrip("'") == '− DIFAL sobre vendas (10%)']
        self.assertEqual(len(monthly_exit), 4)
        self.assertTrue(all(row[6:16] == ['0,00'] * 10 for row in monthly_exit))
        profit = next(row for row in csv_rows if len(row) > 5 and row[0] == 'DRE' and row[2] == 'Resultado líquido')
        self.assertEqual(profit[5:9], [f"{regime['dre']['netProfit']:.2f}".replace('.', ',')
                                     for regime in corrected['result']['regimes']])
        # Export the preceding version after the correction as well. Its original
        # exit tax and result remain available instead of being silently replaced.
        old_frozen = copy.deepcopy(previous)
        assert_statement(self, render(previous), previous)
        self.assertEqual(previous, old_frozen)
        old_csv = list(csv.reader(io.StringIO(snapshots()['csv']['previous']), delimiter=';'))
        old_exit = next(row for row in old_csv if len(row) > 5 and row[0] == 'DRE' and row[2].lstrip("'") == '− DIFAL sobre vendas (10%)')
        self.assertEqual(old_exit[5:9], ['-3780,00', '-3780,00', '0,00', '0,00'])

    def test_changing_only_the_displayed_tax_without_fixing_totals_is_rejected(self):
        previous, _ = pair()
        previous['result']['regimes'][0]['dre']['difal'] = 0
        with self.assertRaises(ReportError) as caught:
            validate_dre_snapshot(previous)
        self.assertEqual(caught.exception.code, 'DRE_SNAPSHOT_INVALID')


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class DreDifalZeroMongoTests(unittest.TestCase):
    def test_authenticated_pdf_reads_each_saved_revision_without_cached_exit_or_history_changes(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request, urlopen
        from pymongo import MongoClient
        from api import reports as endpoint

        conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        db = conn['maximum_dre_zero_exit_test_' + uuid.uuid4().hex]
        workspace, raw = 'dre-zero-exit-ci', secrets.token_urlsafe(32)
        previous, corrected = pair()
        analysis_id = '96969696-9696-4696-8696-969696969606'
        server = None
        try:
            db.users.insert_one({'_id': 'dre-zero-viewer', 'workspaceId': workspace, 'active': True, 'role': 'viewer'})
            db.sessions.insert_one({'_id': hashlib.sha256(raw.encode()).hexdigest(), 'workspaceId': workspace,
                                    'userId': 'dre-zero-viewer', 'expiresAt': utcnow() + timedelta(minutes=15)})
            db.analyses.insert_one({'_id': analysis_id, 'workspaceId': workspace, 'clientId': corrected['clientId'],
                                    'currentSimulation': {'id': corrected['_id']}})
            db.simulations.insert_many([{**saved, 'workspaceId': workspace, 'analysisId': analysis_id,
                                          'analysisPublication': 'PUBLISHED', 'requestHash': 'synthetic-private'}
                                         for saved in (previous, corrected)])
            frozen = list(db.simulations.find().sort('_id', 1))
            server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            with patch.dict(os.environ, {'WORKSPACE_ID': workspace, 'NODE_ENV': 'development',
                                          'APP_ORIGIN': 'http://dre-zero-exit.test', 'VERCEL': '0'}), \
                    patch.object(endpoint, 'database', return_value=db):
                for saved in (previous, corrected, previous):
                    options = validate({'action': 'dre-pdf', 'simulationId': saved['_id'],
                                        'period': 'complete', 'regimeId': 'hybrid', 'showPercent': False})
                    meta = dre_metadata(db, saved['_id'], workspace, options)
                    self.assertEqual(meta['snapshot']['result'], saved['result'])
                    self.assertNotIn('workspaceId', meta['snapshot'])
                    request = Request(f'http://127.0.0.1:{server.server_port}/', data=json.dumps(options).encode(),
                                      headers={'Origin': 'http://dre-zero-exit.test', 'Content-Type': 'application/json',
                                               'Cookie': 'maximum_session=' + raw})
                    with self.subTest(simulation=saved['_id']), urlopen(request, timeout=30) as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        self.assertEqual(response.headers['X-Report-Engine'], 'python')
                        self.assertIn(saved['_id'], response.headers['Content-Disposition'])
                        assert_statement(self, response.read(), saved)
            self.assertEqual(list(db.simulations.find().sort('_id', 1)), frozen)
            self.assertEqual(db.analyses.find_one({'_id': analysis_id})['currentSimulation']['id'], corrected['_id'])
        finally:
            if server is not None:
                server.shutdown()
                server.server_close()
                thread.join()
            conn.drop_database(db.name)
            conn.close()


if __name__ == '__main__':
    unittest.main()
