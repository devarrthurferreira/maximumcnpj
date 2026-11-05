"""Prove IRPJ component/rate/period parity from immutable synthetic evidence."""
import copy
import json
import subprocess
import unittest
from datetime import datetime, timezone

import pymupdf

from dre_data_test import ROOT, fixture
from dre_model_test import model
from dre_pdf_test import amount, render, section_text
from reporting.dre_model import (IRPJ_KEYS, IRPJ_V2_KEYS, IRPJ_V2_ROWS, IRPJ_EMPTY_REASON, IRPJ_INVALID_REASON,
                                 IRPJ_V2_EMPTY_REASON, IRPJ_V2_INVALID_REASON, IRPJ_V2_PERIOD_REASON,
                                 IRPJ_PERIOD_REASON, IRPJ_CALENDAR_REASON, IRPJ_CALENDAR_MISSING_REASON, reconcile_irpj)
from reporting.dre_pdf import Report


def memory(result, identifier):
    return next(row for row in result['memory'] if row['id'] == identifier)


def captured(base, months=1):
    normal, additional = base * .15, max(0, base - 20000 * months) * .10
    return {'regimes': [{'id': 'presumed', 'available': True, 'dre': {'irpj': -(normal + additional)}}],
            'memory': [{'id': 'presumed.' + key, 'unit': 'currency', 'value': value} for key, value in
                       [('irTotalBase', base), ('irBasic', normal), ('irAdditional', additional), ('irTotal', normal + additional)]]}


def monthly(bases):
    rows = [{'month': index + 1, 'sourceMonth': f'2025-{index + 1:02d}', 'result': captured(base)}
            for index, base in enumerate(bases)]
    result = copy.deepcopy(rows[0]['result'])
    result.update(method='REPORT_MONTHS_V1', monthlyResults=rows)
    for item in result['memory']:
        item['value'] = sum(memory(row['result'], item['id'])['value'] for row in rows)
    result['regimes'][0]['dre']['irpj'] = sum(row['result']['regimes'][0]['dre']['irpj'] for row in rows)
    return result


def js_parity(snapshots):
    script = """
import {buildDrePresentation} from './public/simulator-dre.js';
import {irpjIncludedInDas} from './public/simulator-irpj-display.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const output=JSON.parse(input).map(s=>{
 const p=buildDrePresentation({result:s.result,calendar:s.monthlyDre,source:s.source,
  reportMonths:s.reportMonths,engineInput:s.engineInput});
 const total=p.irpjReconciliation.rows.find(row=>row.key==='irpjTotalAssessed');
 const das=Object.fromEntries(['pure','hybrid'].map(id=>[id,{period:irpjIncludedInDas(p,total,{id,mode:'annual'}),
  months:p.months.map((_,month)=>irpjIncludedInDas(p,total,{id,mode:'month',month}))}]));
 return {months:p.months,rows:p.irpjReconciliation.rows,das};
});process.stdout.write(JSON.stringify(output));
"""
    output = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(snapshots),
                            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
    return json.loads(output.stdout)


class DreIrpjTests(unittest.TestCase):
    maxDiff = 1200

    def assertIn(self, member, container, msg=None):
        if isinstance(container, str) and len(container) > 500:
            return self.assertTrue(member in container, msg or f'Expected PDF text is absent: {member!r}')
        return super().assertIn(member, container, msg)

    def assertNotIn(self, member, container, msg=None):
        if isinstance(container, str) and len(container) > 500:
            return self.assertFalse(member in container, msg or f'Unexpected PDF text is present: {member!r}')
        return super().assertNotIn(member, container, msg)

    def assert_unavailable(self, assessed, reason):
        self.assertFalse(assessed['available'])
        self.assertEqual(assessed['status'], 'UNAVAILABLE')
        self.assertEqual(assessed['reason'], reason)
        keys = IRPJ_V2_KEYS if assessed.get('version') == 'IRPJ_RECONCILIATION_V2' else IRPJ_KEYS
        self.assertEqual(assessed['values'], dict.fromkeys(keys))

    def test_monthly_28000_base_is_4200_normal_plus_800_additional(self):
        result = monthly([28000])
        before = copy.deepcopy(result)
        assessed = reconcile_irpj(result, 'presumed')
        self.assertTrue(assessed['available'])
        self.assertEqual(assessed['values'], dict(zip(IRPJ_KEYS, [28000, 20000, 20000, 8000, 4200, 800, 5000])))
        self.assertEqual(result, before)

    def test_consolidation_sums_excesses_without_reusing_other_months_limits(self):
        result = monthly([28000, 16000, 16000] * 3)
        assessed = reconcile_irpj(result, 'presumed', expected_count=9)
        self.assertTrue(assessed['available'])
        self.assertEqual(assessed['values'], dict(zip(IRPJ_KEYS, [180000, 180000, 156000, 24000, 27000, 2400, 29400])))
        self.assertEqual(reconcile_irpj(result, 'presumed', source_month='2025-02')['values']['irpjAdditionalAssessed'], 0)
        self.assertEqual(assessed['values']['irpjTotalAssessed'], -result['regimes'][0]['dre']['irpj'])

    def test_matching_total_alone_cannot_validate_the_components_or_tax_base(self):
        for adjustment in ('shift', 'base', 'rate', 'dre'):
            with self.subTest(adjustment=adjustment):
                result = monthly([28000])
                saved = result['monthlyResults'][0]['result']
                if adjustment == 'shift':
                    memory(saved, 'presumed.irBasic')['value'] += 10
                    memory(saved, 'presumed.irAdditional')['value'] -= 10
                elif adjustment == 'base':
                    memory(saved, 'presumed.irTotalBase')['value'] += 100
                elif adjustment == 'rate':
                    # A sub-cent discrepancy must not pass the display tolerance.
                    memory(saved, 'presumed.irBasic')['value'] += .001
                else:
                    saved['regimes'][0]['dre']['irpj'] -= 1
                self.assert_unavailable(reconcile_irpj(result, 'presumed'), IRPJ_INVALID_REASON)

    def test_missing_duplicate_wrong_unit_and_invalid_numbers_are_unavailable(self):
        for layer in ('consolidated', 'monthly'):
            for corruption in ('missing', 'duplicate', 'unit', 'negative', 'boolean', 'nan', 'infinity', 'unavailable'):
                with self.subTest(layer=layer, corruption=corruption):
                    result = monthly([28000])
                    saved = result if layer == 'consolidated' else result['monthlyResults'][0]['result']
                    item = memory(saved, 'presumed.irBasic')
                    if corruption == 'missing':
                        saved['memory'].remove(item)
                    elif corruption == 'duplicate':
                        saved['memory'].append(copy.deepcopy(item))
                    elif corruption == 'unit':
                        item['unit'] = 'number'
                    elif corruption == 'unavailable':
                        item['availability'] = 'UNAVAILABLE'
                    else:
                        item['value'] = {'negative': -1, 'boolean': True, 'nan': float('nan'), 'infinity': float('inf')}[corruption]
                    self.assert_unavailable(reconcile_irpj(result, 'presumed'), IRPJ_EMPTY_REASON)

    def test_period_coverage_is_unique_complete_and_independent_of_array_order(self):
        result = monthly([28000, 16000, 0])
        expected = ['2025-01', '2025-02', '2025-03']
        result['monthlyResults'].reverse()
        self.assertTrue(reconcile_irpj(result, 'presumed', expected_source_months=expected)['available'])
        self.assertEqual(reconcile_irpj(result, 'presumed', source_month='2025-01')['values']['irpjAdditionalAssessed'], 800)
        for options in ({'expected_count': 2}, {'expected_count': True}, {'expected_count': 3.5},
                        {'expected_source_months': expected[:2]}, {'expected_source_months': ['2025-01'] * 3},
                        {'expected_source_months': ['2025-01', '2025-02', '2025-04']}, {'source_month': '2025-04'}):
            self.assert_unavailable(reconcile_irpj(result, 'presumed', **options), IRPJ_PERIOD_REASON)
        for corruption in ('duplicate', 'month', 'missing'):
            broken = copy.deepcopy(result)
            if corruption == 'duplicate':
                broken['monthlyResults'].append(copy.deepcopy(broken['monthlyResults'][0]))
            elif corruption == 'month':
                broken['monthlyResults'][0]['month'] = 1
            else:
                broken['monthlyResults'] = []
            self.assert_unavailable(reconcile_irpj(broken, 'presumed'), IRPJ_PERIOD_REASON)

    def test_consolidated_memory_must_equal_the_valid_months(self):
        result = monthly([28000, 16000])
        memory(result, 'presumed.irBasic')['value'] += 1
        memory(result, 'presumed.irTotal')['value'] += 1
        result['regimes'][0]['dre']['irpj'] -= 1
        self.assert_unavailable(reconcile_irpj(result, 'presumed'), IRPJ_INVALID_REASON)
        self.assertTrue(reconcile_irpj(result, 'presumed', source_month='2025-01')['available'])

    def test_uniform_v2_projection_keeps_quarter_limit_and_checks_saved_month(self):
        saved = fixture('legacy')
        before = copy.deepcopy(saved)
        view = model(saved)
        regime = next(row for row in view.regimes if row['id'] == 'actual')
        annual, month = view.irpj(regime), view.irpj(regime, 0)
        self.assertEqual(annual['values']['irpjAdditionalLimit'], 240000)
        self.assertEqual(month['values']['irpjAdditionalLimit'], 60000)
        captured = saved['result']['incomeTaxAssessment']['monthlyAssessments']['2027-01']['regimes']['actual']
        self.assertEqual(month['values']['irpjCurrentMovement'], captured['movement']['irpjTotalCents'] / 100)
        self.assertNotEqual(month['values']['irpjCurrentMovement'], annual['values']['irpjCurrentMovement'] / 12)
        self.assertEqual(saved, before)
        calendar = next(row for row in saved['monthlyDre']['regimes'] if row['id'] == 'actual')
        next(row for row in calendar['rows'] if row['key'] == 'irpj')['months'][0] -= .001
        changed = model(saved)
        self.assert_unavailable(changed.irpj(regime, 0), IRPJ_CALENDAR_REASON)
        self.assertEqual(changed.irpj(regime), annual)

    def test_monthly_calendar_cannot_override_or_duplicate_the_captured_irpj(self):
        snapshots = []
        for corruption in ('value', 'duplicate'):
            saved = fixture()
            calendar = next(row for row in saved['monthlyDre']['regimes'] if row['id'] == 'presumed')
            row = next(row for row in calendar['rows'] if row['key'] == 'irpj')
            if corruption == 'value':
                row['months'][0] -= .001
            else:
                calendar['rows'].append(copy.deepcopy(row))
            snapshots.append(saved)
        for saved, screen in zip(snapshots, js_parity(snapshots)):
            view = model(saved)
            regime = next(row for row in view.regimes if row['id'] == 'presumed')
            self.assertTrue(view.irpj(regime)['available'])
            self.assert_unavailable(view.irpj(regime, 0), IRPJ_CALENDAR_REASON)
            for row in screen['rows']:
                self.assertIsNone(row['monthlyValues']['presumed'][0])

    def test_included_in_das_label_cannot_hide_pending_period_evidence(self):
        saved = fixture()
        report = Report({'snapshot': saved, 'options': {'period': 'annual', 'showPercent': False},
                         'emittedAt': datetime(2026, 11, 4, tzinfo=timezone.utc)})
        regime = next(row for row in report.model.regimes if row['id'] == 'pure')
        self.assertEqual(report.statement_cell(regime, 'irpj').getPlainText(), 'Incluído no DAS')
        saved['result']['monthlyResults'].append(copy.deepcopy(saved['result']['monthlyResults'][0]))
        self.assert_unavailable(report.model.irpj(regime), IRPJ_V2_PERIOD_REASON)
        self.assertEqual(report.statement_cell(regime, 'irpj').getPlainText(), '0,00')

    def test_included_in_das_requires_available_monthly_calendar_frame(self):
        snapshots = []
        for variant in ('complete', 'legacy'):
            for corruption in ('version', 'regime', 'source'):
                saved = fixture(variant)
                if corruption == 'version':
                    saved['monthlyDre']['version'] = 'unknown'
                elif corruption == 'regime':
                    saved['monthlyDre']['regimes'] = [row for row in saved['monthlyDre']['regimes'] if row['id'] != 'pure']
                elif variant == 'complete':
                    saved['monthlyDre']['months'][0]['sourceMonth'] = '2024-01'
                else:
                    next(row for row in saved['monthlyDre']['regimes'] if row['id'] == 'pure')['available'] = False
                snapshots.append(saved)
        for saved, screen in zip(snapshots, js_parity(snapshots)):
            view = model(saved)
            regime = next(row for row in view.regimes if row['id'] == 'pure')
            self.assertEqual(view.irpj(regime)['status'], 'INCLUDED_IN_DAS')
            self.assert_unavailable(view.irpj(regime, 0), IRPJ_CALENDAR_MISSING_REASON)
            self.assertEqual(screen['rows'][0]['monthlyReasonByRegime']['pure'][0], IRPJ_CALENDAR_MISSING_REASON)

    def test_das_label_matches_ui_when_captured_or_calendar_irpj_is_not_zero(self):
        snapshots = []
        for corruption in ('period_nonzero', 'month_nonzero', 'calendar_null', 'calendar_nonzero', 'monthly_unavailable', 'calendar_aggregate_unavailable'):
            saved = fixture()
            regime = next(row for row in saved['result']['regimes'] if row['id'] == 'pure')
            monthly_regime = next(row for row in saved['result']['monthlyResults'][0]['result']['regimes'] if row['id'] == 'pure')
            calendar = next(row for row in saved['monthlyDre']['regimes'] if row['id'] == 'pure')
            line = next(row for row in calendar['rows'] if row['key'] == 'irpj')
            if corruption == 'period_nonzero':
                regime['dre']['irpj'] = -1
            elif corruption == 'month_nonzero':
                monthly_regime['dre']['irpj'] = -1
                line['months'][0] = -1
            elif corruption == 'calendar_null':
                line['months'][0] = None
            elif corruption == 'calendar_nonzero':
                line['months'][0] = -1
            elif corruption == 'monthly_unavailable':
                monthly_regime['available'] = False
            else:
                # This flag describes the consolidated calendar; an available
                # REPORT_MONTHS competency remains displayable in the JS UI.
                calendar['available'] = False
            snapshots.append((corruption, saved))
        for (corruption, saved), screen in zip(snapshots, js_parity([saved for _, saved in snapshots])):
            with self.subTest(corruption=corruption):
                view = model(saved)
                regime = next(row for row in view.regimes if row['id'] == 'pure')
                self.assertEqual(view.irpj(regime)['status'] == 'INCLUDED_IN_DAS', screen['das']['pure']['period'])
                self.assertEqual(view.irpj(regime, 0)['status'] == 'INCLUDED_IN_DAS', screen['das']['pure']['months'][0])
        saved = snapshots[0][1]
        with pymupdf.open(stream=render(saved, period='annual', regime_id='pure', regime_ids=['pure']), filetype='pdf') as document:
            content = section_text(document, 'Impostos', 'Conferência dos créditos')
            self.assertNotIn('Incluído no DAS', content)
            self.assertEqual(document.page_count, 2)
            regime = next(row for row in saved['result']['regimes'] if row['id'] == 'pure')
            self.assertFalse(model(saved).irpj(regime)['available'])
            self.assertIn(amount(-regime['dre']['irpj']), content)

    def test_python_and_screen_reconciliation_match_every_regime_and_period(self):
        snapshots = [fixture(variant) for variant in ('complete', 'partial', 'zero', 'loss', 'legacy', 'unavailable')]
        duplicated = fixture()
        duplicated['result']['memory'].append(copy.deepcopy(memory(duplicated['result'], 'actual.irBasic')))
        snapshots.append(duplicated)
        for saved, reference in zip(snapshots, js_parity(snapshots)):
            before = copy.deepcopy(saved)
            view = model(saved)
            rows = {row['key']: row for row in reference['rows']}
            self.assertEqual(set(rows), set(IRPJ_V2_KEYS))
            for regime in view.regimes:
                for index in (None, *range(len(view.months))):
                    assessed = view.irpj(regime, index)
                    for key, part in (('irpjBasic', 'normal'), ('irpjAdditional', 'additional')):
                        value = (assessed.get('componentMovements') or {}).get(part)
                        self.assertEqual(view.value(regime, key, index), -value if value is not None else None)
                    j = None if index is None else next(j for j, month in enumerate(reference['months']) if
                        (month.get('sourceMonth') if view.actual else month.get('period')) == view.months[index])
                    for key in IRPJ_V2_KEYS:
                        expected = rows[key]['values'][regime['id']] if j is None else rows[key]['monthlyValues'][regime['id']][j]
                        with self.subTest(regime=regime['id'], key=key, month=index):
                            if expected is None:
                                self.assertIsNone(assessed['values'][key])
                            else:
                                self.assertAlmostEqual(assessed['values'][key], expected, places=7)
            self.assertEqual(saved, before)

    def test_filtered_pdf_explains_base_rates_months_and_preserves_tax_totals(self):
        saved = fixture()
        before = copy.deepcopy(saved)
        view = model(saved, regimeIds=['presumed'])
        regime = view.regimes[0]
        with pymupdf.open(stream=render(saved, regime_id='presumed', regime_ids=['presumed']), filetype='pdf') as document:
            content = section_text(document, 'Impostos', 'Conferência dos créditos')
            self.assertEqual(document.page_count, 2)
            self.assertIn('Cenário 2027', content)
            self.assertIn('IRPJ', content)
            self.assertIn(amount(-regime['dre']['irpj']), content)
            self.assertNotIn('IRPJ trimestral e movimentos da DRE', content)
            self.assertIn(amount(regime['totalTaxes']), content)
            for hidden in ('Simples Puro', 'Simples Híbrido', 'Lucro Real'):
                self.assertNotIn(hidden, content)
        self.assertEqual(saved, before)

    def test_pdf_missing_memory_has_reason_and_keeps_original_tax_amount(self):
        saved = fixture()
        saved['result']['incomeTaxAssessment'] = None
        regime = next(row for row in saved['result']['regimes'] if row['id'] == 'presumed')
        with pymupdf.open(stream=render(saved, period='annual', regime_id='presumed', regime_ids=['presumed']), filetype='pdf') as document:
            content = section_text(document, 'Impostos', 'Conferência dos créditos')
            self.assertFalse(model(saved).irpj(regime)['available'])
            self.assertEqual(document.page_count, 2)
            self.assertIn(amount(-regime['dre']['irpj']), content)
            self.assertIn(amount(regime['totalTaxes']), content)


if __name__ == '__main__':
    unittest.main()
