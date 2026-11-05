"""Compare the Python PDF view with the saved DRE's JavaScript presentation."""
import copy
import json
import subprocess
import unittest
from datetime import datetime, timezone
from functools import lru_cache

from dre_data_test import fixture, ROOT
from reporting.dre_model import DreModel, TAX_COMPONENT_KEYS


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
  taxRows:presentation.taxStatement?.rows||[],taxRates:presentation.taxStatement?.taxRates||presentation.statement?.taxRates,
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
        for variant in ('complete', 'partial', 'loss', 'zero', 'unavailable', 'legacy', 'negative-revenue', 'purchases-above-revenue'):
            saved = fixture(variant)
            before = copy.deepcopy(saved)
            view, reference = model(saved), screen(saved)
            rows = {row['key']: row for row in [*reference['taxRows'], *reference['rows']]}
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

    def test_separate_taxes_and_one_dre_deduction_reconcile_every_month(self):
        for variant in ('complete', 'partial', 'loss', 'zero', 'negative-revenue', 'unavailable'):
            saved = fixture(variant)
            before = copy.deepcopy(saved)
            view = model(saved)
            keys = [key for _, rows in view.sections() for key, _ in rows]
            self.assertEqual(keys.count('taxesDeduction'), 0)
            self.assertEqual(keys.count('totalTaxes'), 0)
            self.assertTrue({'das', 'icmsDebit', 'cbsIbsDebit', 'irpj', 'csll', 'icmsAnticipation',
                             'difal', 'payroll', 'icmsCredit', 'cbsIbsCredit', 'ebitda', 'financialResult'} <= set(keys))
            tax_keys = [key for key, _ in view.tax_rows()]
            self.assertEqual(len(tax_keys), len(set(tax_keys)))
            self.assertEqual(tax_keys[:8], ['das', 'icmsNet', 'cbsIbsNet', 'irpj', 'csll', 'icmsAnticipation', 'difal', 'payroll'])
            self.assertEqual(tax_keys[-8:], ['totalTaxes', 'taxBurden', 'grossAfterCosts', 'contributionMargin', 'ebitda', 'ebitdaMargin', 'netProfit', 'netMargin'])
            for regime in view.regimes:
                for index in (None, *range(len(view.months))):
                    frame = view.frame(regime, index)
                    if not frame['available']:
                        for key in ('cbsIbsNet', 'totalTaxes', 'taxesDeduction', 'operatingExpensesBeforePayroll', 'taxBurden', 'netMargin'):
                            self.assertIsNone(view.value(regime, key, index))
                        for key in tax_keys:
                            self.assertIsNone(view.tax_value(regime, key, index))
                        continue
                    dre = frame['dre']
                    combined = sum(dre[key] for key in ('cbsDebit', 'ibsDebit', 'cbsUsed', 'ibsUsed'))
                    expenses = sum(dre[key] for key in ('salaries', 'benefits', 'administrative', 'rent', 'cards'))
                    taxes = -sum([combined, *[dre[key] for key in ('das', 'icmsNet', 'irpj', 'csll', 'icmsAnticipation', 'difal', 'payroll', 'iss')]])
                    with self.subTest(variant=variant, regime=regime['id'], month=index):
                        self.same(view.value(regime, 'cbsIbsNet', index), combined)
                        self.same(view.value(regime, 'operatingExpensesBeforePayroll', index), expenses)
                        self.same(view.value(regime, 'totalTaxes', index), taxes)
                        self.same(view.value(regime, 'taxesDeduction', index), -taxes)
                        self.same(view.tax_value(regime, 'cbsIbsNet', index), -combined)
                        self.same(sum(view.tax_value(regime, key, index) for key in tax_keys if key in TAX_COMPONENT_KEYS), taxes)
                        self.same(dre['revenue'] + dre['cmv'] + expenses - taxes, dre['netProfit'])
                        self.same(view.value(regime, 'taxBurden', index), taxes / dre['revenue'] if dre['revenue'] > 0 else None)
                        self.same(view.value(regime, 'netMargin', index), dre['netProfit'] / dre['revenue'] if dre['revenue'] > 0 else None)
            self.assertEqual(saved, before)

    def test_tax_statement_signs_ratios_and_pending_states_match_screen(self):
        for variant in ('complete', 'partial', 'zero', 'unavailable', 'negative-revenue'):
            saved = fixture(variant)
            view, reference = model(saved), screen(saved)
            tax_rows = {row['key']: row for row in reference['taxRows']}
            self.assertEqual(set(tax_rows), {key for key, _ in view.tax_rows()})
            for regime in view.regimes:
                for key, row in tax_rows.items():
                    self.same(view.tax_value(regime, key), row['values'][regime['id']])
                    self.same(view.tax_ratio(regime, key), row['percentValues'][regime['id']])
                    for index, month in enumerate(view.months):
                        reference_index = next(i for i, entry in enumerate(reference['months']) if entry.get('sourceMonth') == month)
                        self.same(view.tax_value(regime, key, index), row['monthlyValues'][regime['id']][reference_index])
                        self.same(view.tax_ratio(regime, key, index), row['monthlyPercentValues'][regime['id']][reference_index])

    def test_separate_tax_statement_preserves_negative_provision_reversal(self):
        from dre_irpj_quarter_test import quarter_fixture
        saved = quarter_fixture()
        view = model(saved)
        regime = next(row for row in view.regimes if row['id'] == 'actual')
        self.assertEqual(view.value(regime, 'irpj', 1), 16000)
        self.assertEqual(view.tax_value(regime, 'irpj', 1), -16000)
        self.assertEqual(view.tax_value(regime, 'csll', 1), -7200)
        self.assertEqual(view.tax_value(regime, 'totalTaxes', 1), view.value(regime, 'totalTaxes', 1))
        self.assertEqual(view.value(regime, 'taxesDeduction', 1), -view.tax_value(regime, 'totalTaxes', 1))
        reversal = model(quarter_fixture(sales=[400000, 0, 100000], rents=[182400, 80000, 70600]))
        actual = next(row for row in reversal.regimes if row['id'] == 'actual')
        self.assertEqual(reversal.tax_value(actual, 'totalTaxes', 1), -23200)
        self.assertEqual(reversal.value(actual, 'taxesDeduction', 1), 23200)
        self.assertEqual(reversal.value(actual, 'netProfit', 1), -56800)
        self.assertIsNone(reversal.tax_ratio(actual, 'totalTaxes', 1))

    def test_legacy_projection_keeps_detailed_statement_order(self):
        view = model(fixture('legacy'))
        keys = [key for _, definitions in view.sections() for key, _ in definitions]
        self.assertFalse(view.compact_statement)
        self.assertNotIn('taxesDeduction', keys)
        self.assertLess(keys.index('cbsDebit'), keys.index('netRevenue'))
        self.assertLess(keys.index('payroll'), keys.index('personnel'))
        self.assertLess(keys.index('irpj'), keys.index('netProfit'))

    def test_iss_pending_only_in_calendar_total_remains_in_the_tax_statement(self):
        from dre_irpj_quarter_test import quarter_fixture
        saved = quarter_fixture()
        self.assertNotIn('iss', dict(model(saved).tax_rows()))
        calendar = next(row for row in saved['monthlyDre']['regimes'] if row['id'] == 'actual')
        next(row for row in calendar['rows'] if row['key'] == 'iss')['annual'] = None
        view, reference = model(saved), screen(saved)
        self.assertIn('iss', dict(view.tax_rows()))
        row = next(row for row in reference['taxRows'] if row['key'] == 'iss')
        self.assertIsNone(row['calendarAnnualValues']['actual'])
        actual = next(regime for regime in view.regimes if regime['id'] == 'actual')
        self.assertEqual(view.tax_value(actual, 'iss'), row['values']['actual'])
        self.assertEqual(row['values']['actual'], 0)
        self.assertEqual(row['monthlyValues']['actual'], [0, 0, 0])

    def test_missing_optional_tax_fields_keep_all_eight_rows_without_inventing_zero(self):
        from dre_irpj_quarter_test import quarter_fixture
        saved = quarter_fixture()
        for result in [saved['result'], *(entry['result'] for entry in saved['result']['monthlyResults'])]:
            for regime in result['regimes']:
                regime['dre'].pop('difal', None)
                regime['dre'].pop('icmsAnticipation', None)
        for regime in saved['monthlyDre']['regimes']:
            regime['rows'] = [row for row in regime['rows'] if row['key'] not in ('difal', 'icmsAnticipation')]
        before = copy.deepcopy(saved)
        view = model(saved)
        self.assertEqual([key for key, _ in view.tax_rows()][:8],
                         ['das', 'icmsNet', 'cbsIbsNet', 'irpj', 'csll', 'icmsAnticipation', 'difal', 'payroll'])
        for regime in view.regimes:
            for index in (None, *range(len(view.months))):
                self.assertIsNone(view.tax_value(regime, 'difal', index))
                self.assertIsNone(view.tax_value(regime, 'icmsAnticipation', index))
            self.assertEqual(view.tax_value(regime, 'totalTaxes'), regime['totalTaxes'])
        self.assertEqual(saved, before)

    def test_visible_pdf_regimes_filter_comparison_and_memory_without_recalculating(self):
        saved = fixture()
        before = copy.deepcopy(saved)
        view = model(saved, regimeIds=['actual'])
        self.assertEqual([row['id'] for row in view.regimes], ['actual'])
        self.assertEqual(view.focus['id'], 'actual')
        self.assertIsNone(view.best)
        self.assertEqual(view.value(view.focus, 'totalTaxes'), before['result']['regimes'][3]['totalTaxes'])
        for entry in view.memory():
            self.assertNotRegex(entry['id'], r'^(?:dre|summary)\.(?:pure|hybrid|presumed)\.')
            self.assertFalse(entry['id'].startswith(('simples.', 'presumed.', 'difal.')))
            self.assertNotIn(entry['id'], ('rbt12', 'sublimit', 'simplesLimit', 'payroll.simple'))
        self.assertFalse(any('Simples Puro' in warning or 'Simples Híbrido' in warning for warning in view.warnings()))
        self.assertEqual(saved, before)

    def test_combined_credit_is_sum_of_reconciled_cbs_and_ibs_without_new_compensation(self):
        view = model(fixture())
        for regime in view.regimes:
            for field in ('debit', 'potential', 'used', 'due', 'balance'):
                left, right = view.credit('cbs', regime, field), view.credit('ibs', regime, field)
                expected = left + right if left is not None and right is not None else None
                self.same(view.credit('cbsIbs', regime, field), expected)
            due = view.credit('cbsIbs', regime, 'due')
            if due is not None:
                self.same(due, -view.value(regime, 'cbsIbsNet'))

    def test_rates_match_captured_screen_assumptions_and_preserve_absence_and_changes(self):
        saved = fixture()
        baseline = model(saved).tax_rates()
        self.same(baseline['cbs'], .113)
        self.same(baseline['ibs'], .001)
        self.same(baseline['combined'], .114)
        for variant in ('captured', 'missing', 'conflicting', 'different_month', 'duplicated_memory'):
            candidate = copy.deepcopy(saved)
            entry = candidate['result']['monthlyResults'][0]
            captured = next(item for item in entry['result']['memory'] if item['id'] == 'rate.cbs')
            if variant == 'missing':
                entry['result']['memory'].remove(captured)
                del entry['engineInput']['rates']['cbs']
            elif variant == 'conflicting':
                entry['engineInput']['rates']['cbs'] = .12
            elif variant == 'different_month':
                entry['engineInput']['rates']['cbs'] = captured['value'] = .12
            elif variant == 'duplicated_memory':
                entry['result']['memory'].append(copy.deepcopy(captured))
            before = copy.deepcopy(candidate)
            with self.subTest(variant=variant):
                rates = model(candidate).tax_rates()
                self.assertEqual(rates, screen(candidate)['taxRates'])
                self.assertEqual(candidate, before)
                self.assertEqual(candidate['result']['regimes'], saved['result']['regimes'])
                if variant != 'captured':
                    self.assertIsNone(rates['combined'])

    def test_captured_fiscal_warnings_keep_their_details(self):
        saved = fixture()
        warnings = model(saved).warnings()
        for item in saved['result']['warnings']:
            with self.subTest(code=item['code']):
                self.assertTrue(any(item['detail'].rstrip('. ') in text for text in warnings), item['detail'])
        self.assertIn(saved['source']['warnings'][0], warnings)

    def test_negative_revenue_preserves_documentary_composition_and_alerts(self):
        saved = fixture('negative-revenue')
        view = model(saved)
        before = copy.deepcopy(saved)
        self.assertIsNone(view.best)
        self.assertLess(view.commercial()['revenue']['totalCents'], 0)
        for regime in view.regimes:
            self.assertLess(view.value(regime, 'revenue'), 0)
            self.assertLess(view.value(regime, 'netProfit'), 0)
            self.assertIsNone(view.ratio(regime, 'revenue'))
            self.assertIsNone(view.ratio(regime, 'netProfit'))
            self.assertIsNone(view.ratio(regime, 'totalTaxes'))
        financial = [row for row in saved['result']['warnings'] if row['code'] in
                     ('negative-sales', 'negative-revenue', 'purchases-above-revenue', 'costs-above-revenue')]
        self.assertTrue(financial)
        for item in financial:
            self.assertTrue(any(item['detail'].rstrip('. ') in warning for warning in view.warnings()))
        self.assertEqual(saved, before)

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

    def test_optional_rbt12_does_not_publish_zero_rates_or_simples_results(self):
        for variant in ('without-rbt12', 'without-rbt12-only-simples'):
            with self.subTest(variant=variant):
                saved = fixture(variant)
                view = model(saved)
                for regime in view.regimes:
                    for key in ('das', 'netProfit', 'totalTaxes'):
                        value = view.value(regime, key)
                        if regime['id'] in ('pure', 'hybrid'):
                            self.assertIsNone(value)
                        else:
                            self.assertIsInstance(value, (int, float))
                memory = list(view.memory())
                rbt12 = next(row for row in memory if row['id'] == 'rbt12')
                self.assertEqual(rbt12['unit'], 'text')
                self.assertEqual(rbt12['value'], 'Não informada')
                for row in memory:
                    if row['id'].startswith('simples.') and row['id'] != 'simples.revenueReference':
                        self.assertNotIsInstance(row['value'], (int, float), row['id'])
                self.assertEqual(view.best is None, variant == 'without-rbt12-only-simples')

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
