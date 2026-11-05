"""Quarterly saved evidence: exact components, signed movements and V1 isolation."""
import copy
import json
import subprocess
import unittest
from functools import lru_cache

import pymupdf

from dre_data_test import ROOT, fixture
from dre_model_test import model
from dre_pdf_test import amount, render, section_text
from reporting.dre_model import (IRPJ_KEYS, IRPJ_V2_KEYS, IRPJ_V2_ROWS, IRPJ_V2_EMPTY_REASON,
                                 IRPJ_V2_PERIOD_REASON, reconcile_irpj)


@lru_cache(maxsize=8)
def _quarter_fixture(options):
    script = """
import {irpjQuarterlyFixture} from './tests/fixtures/irpj-quarterly.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
process.stdout.write(JSON.stringify(irpjQuarterlyFixture(JSON.parse(input))));
"""
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', script], input=options,
                                    cwd=ROOT, check=True, capture_output=True, text=True, timeout=30).stdout)


def quarter_fixture(**options):
    return copy.deepcopy(_quarter_fixture(json.dumps(options, sort_keys=True)))


def assessment_result(inputs, rates=None):
    """Capture the production assessment without requiring the Jan–Sep report window."""
    script = """
import {assessQuarterlyIncomeTaxes} from './public/simulator-income-tax.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
process.stdout.write(JSON.stringify(assessQuarterlyIncomeTaxes(JSON.parse(input))));
"""
    request = {'year': 2027, 'months': inputs, **({'rates': rates} if rates is not None else {})}
    captured = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(request),
                                        cwd=ROOT, check=True, capture_output=True, text=True, timeout=30).stdout)

    def regimes(container, financial):
        rows = []
        for identifier, assessed in container['regimes'].items():
            movement = assessed['movement']
            rows.append({'id': identifier, 'available': True, 'dre': {
                'sales': financial['salesRevenue'], 'services': financial['serviceRevenue'], 'preTax': financial['preTax'],
                'irpj': -movement['irpjTotalCents'] / 100 if movement is not None else None,
                'csll': -movement['csllCents'] / 100 if movement is not None else None}})
        return rows

    root = captured['incomeTaxAssessment']
    summed = {key: sum(item[key] for item in inputs) for key in ('salesRevenue', 'serviceRevenue', 'preTax')}
    return {'version': '1.20.0-quarterly-income-tax', 'method': 'REPORT_MONTHS_V1',
            'incomeTaxAssessment': root, 'regimes': regimes(root, summed),
            'monthlyResults': [{'sourceMonth': item['sourceMonth'], 'month': item['month'], 'result': {
                'incomeTaxAssessment': captured['monthlyAssessments'][item['sourceMonth']],
                'regimes': regimes(captured['monthlyAssessments'][item['sourceMonth']], item)}} for item in inputs]}


def month(number, sales=0, services=0, pre_tax=0, **extra):
    return {'sourceMonth': f'2025-{number:02d}', 'month': number, 'salesRevenue': sales,
            'serviceRevenue': services, 'preTax': pre_tax, **extra}


def js_reconcile(requests):
    script = """
import {reconcileIrpj} from './public/irpj-reconciliation.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
process.stdout.write(JSON.stringify(JSON.parse(input).map(row=>reconcileIrpj(row.result,row.id,row.options||{}))));
"""
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(requests),
                                    cwd=ROOT, check=True, capture_output=True, text=True, timeout=30).stdout)


class DreQuarterlyIrpjTests(unittest.TestCase):

    def test_prejuizo_jan_set_real_zero_is_audited_independently(self):
        script = r"""
import {assessQuarterlyIncomeTaxes} from './public/simulator-income-tax.js';
const incomes=[50000,20000,10000,-180000,-10000,-5000,-5000,-5000,-5000];
const months=incomes.map((value,index)=>({sourceMonth:'2025-'+String(index+1).padStart(2,'0'),month:index+1,
  salesRevenue:100000,serviceRevenue:0,preTax:value}));
const tax=assessQuarterlyIncomeTaxes({year:2027,months,annualLossZeroForReal:true});
const regimes=container=>['presumed','actual'].map(id=>({id,available:container.regimes[id].available,
  dre:{irpj:-container.regimes[id].movement.irpjTotalCents/100,csll:-container.regimes[id].movement.csllCents/100}}));
const saved={version:'1.20.0-quarterly-income-tax',analysisPeriod:{version:'JAN_SEP_V1'},
  incomeTaxAssessment:tax.incomeTaxAssessment,regimes:regimes(tax.incomeTaxAssessment),
  monthlyResults:months.map(m=>({sourceMonth:m.sourceMonth,month:m.month,
    result:{incomeTaxAssessment:tax.monthlyAssessments[m.sourceMonth],
      regimes:regimes(tax.monthlyAssessments[m.sourceMonth]).map(r=>({...r,dre:{...r.dre,
        sales:m.salesRevenue,services:m.serviceRevenue,preTax:m.preTax}}))}}))};
process.stdout.write(JSON.stringify(saved));
"""
        executed = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                                  capture_output=True, text=True, check=True, timeout=30)
        saved = json.loads(executed.stdout)
        checked = reconcile_irpj(saved, 'actual')
        self.assertTrue(checked['available'], checked['reason'])
        self.assertEqual(checked['values']['irpjTotalAssessed'], 0)
        for row in saved['monthlyResults']:
            monthly = reconcile_irpj(saved, 'actual', source_month=row['sourceMonth'])
            self.assertTrue(monthly['available'], monthly['reason'])
            self.assertEqual(monthly['values']['irpjCurrentMovement'], 0)
        tampered = copy.deepcopy(saved)
        del tampered['incomeTaxAssessment']['realAnnualLossZero']
        self.assertFalse(reconcile_irpj(tampered, 'actual')['available'])


    maxDiff = 1200

    def assert_unavailable(self, checked):
        self.assertFalse(checked['available'])
        self.assertEqual(checked['status'], 'UNAVAILABLE')
        self.assertEqual(checked['values'], dict.fromkeys(IRPJ_V2_KEYS))
        self.assertIsNone(checked['componentMovements'])

    def test_frozen_v1_retains_original_monthly_rule_and_values(self):
        saved = json.loads((ROOT / 'tests/fixtures/dre-irpj-v1.json').read_text())
        before = copy.deepcopy(saved)
        self.assertEqual(saved['_fixtureOrigin'], 'a16ac5e')
        self.assertNotIn('quarterly-income-tax', saved['result']['version'])
        for identifier, tax, additional in [('presumed', 36822.06, 4296.72), ('actual', 91173.13, 26869.25)]:
            checked = reconcile_irpj(saved['result'], identifier)
            self.assertTrue(checked['available'])
            self.assertEqual(set(checked['values']), set(IRPJ_KEYS))
            self.assertAlmostEqual(checked['values']['irpjTotalAssessed'], tax, places=2)
            self.assertAlmostEqual(checked['values']['irpjAdditionalAssessed'], additional, places=2)
            self.assertEqual(reconcile_irpj(saved['result'], identifier, source_month='2025-01')['values']['irpjAdditionalLimit'], 20000)
        self.assertEqual(saved, before)

    def test_quarterly_lp_800000_sales_has_10000_irpj_and_one_deduction(self):
        saved = quarter_fixture()
        before = copy.deepcopy(saved)
        checked = reconcile_irpj(saved['result'], 'presumed')
        self.assertTrue(checked['available'])
        self.assertEqual(checked['status'], 'CONFIRMED')
        self.assertEqual(list(checked['values'].values()), [64000, 60000, 60000, 4000, 9600, 400, 10000, 0, 10000])
        view = model(saved)
        regime = next(row for row in view.regimes if row['id'] == 'presumed')
        self.assertEqual([view.irpj(regime, index)['values']['irpjTotalAssessed'] for index in range(3)], [4800, 8400, 10000])
        self.assertEqual([view.value(regime, 'irpj', index) for index in range(3)], [-4800, -3600, -1600])
        self.assertEqual(sum(view.value(regime, 'irpj', index) for index in range(3)), regime['dre']['irpj'])
        self.assertEqual(saved, before)

    def test_real_loss_reverses_components_and_keeps_signed_pre_tax(self):
        saved = quarter_fixture()
        view = model(saved)
        regime = next(row for row in view.regimes if row['id'] == 'actual')
        checked = view.irpj(regime, 1)
        self.assertEqual(checked['status'], 'PROVISIONAL')
        self.assertIsNone(checked['closure']['taxes'])
        self.assertEqual(checked['componentMovements'], {'normal': -12000, 'additional': -4000, 'total': -16000})
        self.assertEqual([checked['values'][key] for key in ('irpjTaxBase', 'irpjTotalAssessed', 'irpjPreviousProvision', 'irpjCurrentMovement')], [20000, 3000, 19000, -16000])
        self.assertEqual([view.value(regime, key, 1) for key in ('irpjBasic', 'irpjAdditional', 'irpj')], [12000, 4000, 16000])
        self.assertEqual(view.irpj(regime)['values']['irpjTotalAssessed'], 3000)

    def test_partial_quarter_is_known_provision_without_fabricating_a_missing_month(self):
        saved = quarter_fixture(sales=[1000000, 100000], months=[1, 3], rents=[])
        checked = reconcile_irpj(saved['result'], 'presumed')
        self.assertTrue(checked['available'])
        self.assertEqual(checked['status'], 'PROVISIONAL')
        self.assertFalse(checked['complete'])
        self.assertFalse(checked['closure']['available'])
        self.assertIsNone(checked['closure']['taxes'])
        self.assertEqual(checked['values']['irpjAdditionalLimit'], 60000)
        self.assertEqual(checked['values']['irpjAdditionalAssessed'], 2800)
        self.assert_unavailable(reconcile_irpj(saved['result'], 'presumed', source_month='2025-02'))

    def test_quarter_rule_does_not_reuse_the_legacy_monthly_excess(self):
        result = assessment_result([month(1, pre_tax=28000), month(2, pre_tax=16000), month(3, pre_tax=16000)])
        checked = reconcile_irpj(result, 'actual')
        self.assertTrue(checked['available'])
        self.assertEqual(checked['values']['irpjAdditionalAssessed'], 0)
        self.assertEqual(checked['values']['irpjTotalAssessed'], 9000)

    def test_cents_are_half_up_after_signed_base_without_intermediate_rounding(self):
        for pre_tax, exact in [(0.3, None), (0.2999992370605469, {'numerator': '3', 'denominator': '10'})]:
            with self.subTest(pre_tax=pre_tax):
                result = assessment_result([month(1, sales=10000000000.7 if exact else 1, pre_tax=pre_tax,
                                                   **({'preTaxExact': exact} if exact else {}))])
                checked = reconcile_irpj(result, 'actual')
                self.assertTrue(checked['available'], checked['reason'])
                self.assertEqual(checked['values']['irpjNormalAssessed'], .05)
                self.assertEqual(checked['values']['irpjTaxBase'], .3)

    def test_coefficients_and_exact_bases_are_proven_without_defaults(self):
        result = assessment_result([month(1, 400000, 100000), month(2, 100000), month(3)],
                                   {'irSales': .1, 'irServices': .4, 'csSales': .15, 'csServices': .3})
        self.assertTrue(reconcile_irpj(result, 'presumed')['available'])
        for corruption in ('missing', 'changed', 'fraction', 'cent'):
            broken = copy.deepcopy(result)
            root = broken['incomeTaxAssessment']
            if corruption == 'missing':
                del root['presumptionRates']['irSales']
            elif corruption == 'changed':
                for container in [root, *(entry['result']['incomeTaxAssessment'] for entry in broken['monthlyResults'])]:
                    container['presumptionRates']['irSales'] = .11
            elif corruption == 'fraction':
                root['regimes']['presumed']['periods'][0]['exactBases']['irpjBase']['numerator'] = '1'
            else:
                root['regimes']['presumed']['periods'][0]['provision']['irpjNormalCents'] += 1
            self.assert_unavailable(reconcile_irpj(broken, 'presumed'))

    def test_existing_february_cannot_be_omitted_from_the_march_snapshot(self):
        result = quarter_fixture()['result']
        period = result['monthlyResults'][2]['result']['incomeTaxAssessment']['regimes']['presumed']['periods'][0]
        period['inputs'].pop(1)
        period['sourceMonths'].pop(1)
        period['observedMonths'].pop(1)
        period.update(missingMonths=[2], complete=False)
        checked = reconcile_irpj(result, 'presumed', source_month='2025-03')
        self.assert_unavailable(checked)
        self.assertEqual(checked['reason'], IRPJ_V2_PERIOD_REASON)

    def test_missing_source_quarter_and_missing_or_duplicate_monthly_regimes_fail(self):
        for corruption in ('sourceQuarter', 'missing', 'duplicate', 'unavailable'):
            result = quarter_fixture()['result']
            saved = result['monthlyResults'][1]['result']
            regime = next(row for row in saved['regimes'] if row['id'] == 'presumed')
            if corruption == 'sourceQuarter':
                del saved['incomeTaxAssessment']['regimes']['presumed']['periods'][0]['sourceQuarter']
            elif corruption == 'missing':
                saved['regimes'].remove(regime)
            elif corruption == 'duplicate':
                saved['regimes'].append(copy.deepcopy(regime))
            else:
                regime['available'] = False
            self.assert_unavailable(reconcile_irpj(result, 'presumed', source_month='2025-03'))

    def test_new_version_without_capture_never_falls_back_to_v1(self):
        result = quarter_fixture()['result']
        del result['incomeTaxAssessment']
        for entry in result['monthlyResults']:
            del entry['result']['incomeTaxAssessment']
        checked = reconcile_irpj(result, 'presumed')
        self.assert_unavailable(checked)
        self.assertEqual(checked['reason'], IRPJ_V2_EMPTY_REASON)

    def test_december_annual_reversal_and_pending_rate_allocation_remain_distinct(self):
        result = assessment_result([month(index, sales=2000000 if index == 1 else 0) for index in range(1, 13)])
        checked = reconcile_irpj(result, 'presumed', source_month='2025-12')
        self.assertTrue(checked['available'], checked['reason'])
        self.assertEqual(checked['scope'], 'ANNUAL_ADJUSTMENT')
        self.assertEqual([checked['values'][key] for key in ('irpjTotalAssessed', 'irpjPreviousProvision', 'irpjCurrentMovement')], [34000, 35500, -1500])
        pending = assessment_result([month(index, sales={1: 2000000, 4: 2000000, 7: 1500000}.get(index, 0)) for index in range(1, 13)])
        checked = reconcile_irpj(pending, 'presumed', source_month='2025-12')
        self.assert_unavailable(checked)
        self.assertIn('rateio', checked['reason'])

    def test_python_and_javascript_prove_the_same_periods_components_and_reversals(self):
        requests = []
        for saved in (quarter_fixture(), quarter_fixture(sales=[1000000, 100000], months=[1, 3], rents=[]), fixture('legacy')):
            sources = saved['result']['incomeTaxAssessment']['sourceMonths']
            for identifier in ('pure', 'hybrid', 'presumed', 'actual'):
                for source in (None, *sources):
                    requests.append({'result': saved['result'], 'id': identifier, 'options': {'sourceMonth': source}})
        for request, reference in zip(requests, js_reconcile(requests)):
            checked = reconcile_irpj(request['result'], request['id'], source_month=request['options']['sourceMonth'])
            with self.subTest(regime=request['id'], month=request['options']['sourceMonth']):
                for key in ('available', 'status', 'values', 'componentMovements'):
                    self.assertEqual(checked[key], reference[key])

    def test_pdf_separates_quarter_accumulation_reversal_source_year_and_scenario(self):
        saved = quarter_fixture()
        with pymupdf.open(stream=render(saved, regime_id='actual', regime_ids=['actual']), filetype='pdf') as document:
            content = section_text(document, 'Impostos', 'Conferência dos créditos')
            self.assertEqual(document.page_count, 2)
            self.assertIn('Cenário 2027', content)
            self.assertIn('2025', content)
            actual = next(regime for regime in saved['result']['regimes'] if regime['id'] == 'actual')
            self.assertIn(amount(-actual['dre']['irpj']), content)
            self.assertIn(amount(actual['totalTaxes']), content)
            self.assertNotIn('IRPJ trimestral e movimentos da DRE', content)
            self.assertNotIn('Simples Puro', content)
            self.assertNotIn('Lucro Presumido', content)


if __name__ == '__main__':
    unittest.main()
