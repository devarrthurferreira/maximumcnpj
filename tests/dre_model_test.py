"""Compare the Python PDF view with the saved DRE's JavaScript presentation."""
import copy
import json
import subprocess
import unittest
from datetime import datetime, timezone
from functools import lru_cache

from dre_data_test import fixture, ROOT
from reporting.dre_model import DreModel


def model(snapshot, **options):
    return DreModel({'snapshot': snapshot, 'options': {'period': 'complete', **options},
                     'emittedAt': datetime(2026, 10, 28, 14, tzinfo=timezone.utc)})


def screen(snapshot):
    script = """
import {buildDrePresentation,unifiedDreRows,dreReportMemory} from './public/simulator-dre.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const s=JSON.parse(input);
const presentation=buildDrePresentation({result:s.result,calendar:s.monthlyDre||buildMonthlyDre(s.result,s.year||s.draft.year),
  source:s.source,monthlyGroups:s.monthlyGroups,projection:s.projection,reportMonths:s.reportMonths,
  engineInput:s.engineInput,taxSources:s.taxSources});
process.stdout.write(JSON.stringify({months:presentation.months,rows:unifiedDreRows(presentation),
  memory:dreReportMemory(presentation,{includeDre:true}),warnings:presentation.report.warnings}));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(snapshot),
                            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout)


@lru_cache(maxsize=2)
def outside_snapshot(actual=False):
    script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateSimulation,draftToInput} from './public/simulator-engine.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
import {calculateMonthlySimulation} from './public/simulator-monthly.js';
const actual=ACTUAL_MODE;
const s=drePdfFixture();s.draft.icmsOutside=true;
if(actual){Object.assign(s,calculateMonthlySimulation(s.draft,s.source.monthlyReports,s.monthlyInputs,s.source.sales.jobId,null,s.analysisPeriod));}
else{s.result=calculateSimulation(s.draft);s.engineInput=draftToInput(s.draft);delete s.analysisPeriod;delete s.source.analysisPeriod;}
s.monthlyDre=buildMonthlyDre(s.result,s.year,s.rbt12Manual);
process.stdout.write(JSON.stringify(s));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script.replace('ACTUAL_MODE', 'true' if actual else 'false')], cwd=ROOT,
                            capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout)


class DreModelTests(unittest.TestCase):
    def same(self, value, reference):
        if reference is None:
            self.assertIsNone(value)
        else:
            self.assertIsNotNone(value)
            self.assertAlmostEqual(value, reference, places=7)

    def test_saved_sections_months_and_vertical_ratios_match_screen(self):
        for variant in ('complete', 'partial', 'loss', 'zero', 'unavailable', 'legacy'):
            saved = fixture(variant)
            before = copy.deepcopy(saved)
            view, reference = model(saved), screen(saved)
            rows = {row['key']: row for row in reference['rows']}
            keys = [key for _, section in view.sections() for key, _ in section] + ['totalTaxes']
            for regime in view.regimes:
                for key in keys:
                    row = rows['cmvNetCredits' if key == 'netCosts' else key]
                    with self.subTest(variant=variant, regime=regime['id'], key=key, frame='annual'):
                        self.same(view.value(regime, key), row['values'][regime['id']])
                        self.same(view.ratio(regime, key), row['percentValues'][regime['id']])
                    for index, month in enumerate(view.months):
                        reference_index = next((i for i, entry in enumerate(reference['months'])
                                                if (entry.get('sourceMonth') if view.actual else entry.get('period')) == month), None)
                        self.assertIsNotNone(reference_index)
                        with self.subTest(variant=variant, regime=regime['id'], key=key, month=month):
                            self.same(view.value(regime, key, index), row['monthlyValues'][regime['id']][reference_index])
                            self.same(view.ratio(regime, key, index), row['monthlyPercentValues'][regime['id']][reference_index])
            self.assertEqual(saved, before, 'Rendering must not rewrite saved financial evidence.')

    def test_zero_revenue_has_no_ranking_or_percentages(self):
        saved = fixture('zero')
        self.assertIsNone(saved['result']['bestRegimeId'])
        view = model(saved)
        self.assertIsNone(view.best)
        for regime in view.regimes:
            self.assertEqual(view.value(regime, 'revenue'), 0)
            self.assertIsNone(view.ratio(regime, 'netProfit'))
            self.assertIsNone(view.ratio(regime, 'totalTaxes'))

    def test_captured_fiscal_warnings_keep_their_details(self):
        saved = fixture()
        warnings = model(saved).warnings()
        for item in saved['result']['warnings']:
            with self.subTest(code=item['code']):
                self.assertTrue(any(item['detail'].rstrip('. ') in text for text in warnings), item['detail'])
        self.assertIn(saved['source']['warnings'][0], warnings)

    def test_memory_filters_match_regime_selection(self):
        for selection in (['pure'], ['hybrid'], ['presumed'], ['actual'], ['pure', 'hybrid']):
            saved = fixture()
            saved['result']['regimeSelection'] = {'version': 'REGIME_SELECTION_V1', 'selected': selection}
            saved['result']['regimes'] = [row for row in saved['result']['regimes'] if row['id'] in selection]
            expected = [row['id'] for row in screen(saved)['memory']]
            with self.subTest(selection=selection):
                self.assertEqual([row['id'] for row in model(saved).memory()], expected)

    def test_partial_nonconsecutive_months_are_not_compared_as_monthly_growth(self):
        view = model(fixture('partial'))
        self.assertEqual(view.months, ['2025-01', '2025-03', '2025-09'])
        self.assertEqual(view.coverage, '3 de 9 competências')
        for index in range(3):
            self.assertEqual(view.movement('revenue', index)[1:], (None, None))
        full = model(fixture())
        current, delta, ratio = full.movement('revenue', 1)
        prior = full.value(full.focus, 'revenue', 0)
        self.same(delta, current - prior)
        self.same(ratio, (current - prior) / prior)

    def test_unavailable_scenarios_preserve_absence_and_memory_pending_markers(self):
        saved = fixture('unavailable')
        view = model(saved)
        unavailable = [row for row in view.regimes if not row['available']]
        self.assertTrue(unavailable)
        for regime in unavailable:
            self.assertIsNone(view.value(regime, 'netProfit'))
            self.assertIsNone(view.value(regime, 'totalTaxes'))
            self.assertIsNone(view.credit('icms', regime, 'potential'))
        memory = list(view.memory())
        originals = {row['id']: row for row in saved['result']['memory']}
        for row in memory:
            if row['id'].startswith('dre.' + unavailable[0]['id'] + '.') and type(originals[row['id']]['value']) in (int, float):
                self.assertEqual(row['unit'], 'text')
                self.assertIn('Não disponível', row['value'])

    def test_icms_historical_memory_confirms_outside_das_when_flag_is_absent(self):
        saved = copy.deepcopy(outside_snapshot())
        saved['engineInput'].pop('icmsOutside')
        view = model(saved)
        reference = {row['key']: row for row in screen(saved)['rows']}
        for regime in view.regimes:
            self.same(view.credit('icms', regime, 'used'), reference['icms.used']['values'][regime['id']])

    def test_conflicting_outside_das_evidence_does_not_confirm_simples_credit(self):
        saved = copy.deepcopy(outside_snapshot())
        next(row for row in saved['result']['memory'] if row['id'] == 'outside')['value'] = 'Não'
        view = model(saved)
        for regime in view.regimes:
            if regime['id'] in ('pure', 'hybrid'):
                self.assertIsNone(view.credit('icms', regime, 'used'))

    def test_icms_credit_balance_must_reconcile_with_the_saved_dre(self):
        saved = fixture()
        regime = next(row for row in saved['result']['regimes'] if row['id'] == 'actual')
        regime['dre']['icmsBalance'] += 100
        view = model(saved)
        self.assertIsNone(view.credit('icms', regime, 'balance'))

    def test_legacy_credit_usage_reconciles_with_minimum_of_debit_and_potential(self):
        saved = copy.deepcopy(outside_snapshot())
        saved['result']['credits']['icms']['potential'] += 100
        saved['result']['credits']['icms']['balance'] += 100
        for regime in saved['result']['regimes']:
            regime['dre']['icmsBalance'] += 100
        view = model(saved)
        for regime in view.regimes:
            self.assertIsNone(view.credit('icms', regime, 'potential'))

    def test_monthly_outside_das_can_use_captured_engine_input_when_entry_lacks_it(self):
        saved = copy.deepcopy(outside_snapshot(actual=True))
        for entry in saved['result']['monthlyResults']:
            entry.pop('engineInput', None)
            entry['result']['memory'] = [row for row in entry['result']['memory'] if row['id'] != 'outside']
        view = model(saved)
        reference = {row['key']: row for row in screen(saved)['rows']}
        for regime in view.regimes:
            self.same(view.credit('icms', regime, 'used'), reference['icms.used']['values'][regime['id']])

    def test_legacy_without_calendar_discloses_missing_monthly_evidence(self):
        import pymupdf
        from reporting.dre_pdf import render_dre_pdf
        saved = fixture('legacy')
        saved.pop('monthlyDre')
        view = model(saved)
        self.assertEqual(view.months, [])
        self.assertIn('projeção', view.coverage_note)
        for regime in view.regimes:
            self.same(view.value(regime, 'netProfit'), regime['dre']['netProfit'] if regime['available'] else None)
            self.assertIsNone(view.value(regime, 'netProfit', 0))
        pdf = render_dre_pdf({'snapshot': saved, 'options': {'period': 'complete'},
                             'emittedAt': datetime(2026, 10, 28, 14, tzinfo=timezone.utc)})
        with pymupdf.open(stream=pdf, filetype='pdf') as document:
            extracted = ' '.join(' '.join(page.get_text().split()) for page in document)
        self.assertIn('O calendário mensal não está capturado nesta versão.', extracted)
        self.assertIn('Nenhum valor mensal foi estimado para este arquivo.', extracted)


if __name__ == '__main__':
    unittest.main()
