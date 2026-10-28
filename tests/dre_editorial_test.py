"""Regressions for calendars, large percentages and shifted PDF navigation."""
import copy
import json
import subprocess
import unittest
from functools import lru_cache
from pathlib import Path

import pymupdf

from dre_data_test import fixture
from dre_pdf_test import render, normalized
from reporting.dre_data import validate_dre_snapshot


ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def engine_fixtures():
    # Build fresh synthetic scenarios through the production engine. Dates are
    # assigned to the synthetic documents before calculation, never to results.
    script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateSimulation} from './public/simulator-engine.js';
import {calculateMonthlySimulation} from './public/simulator-monthly.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
const cross = drePdfFixture({variant:'partial'});
const months = ['2024-11','2025-01','2025-09'];
const reports = cross.source.monthlyReports.map((row,index)=>({
  ...row, sourceMonth:months[index], month:Number(months[index].slice(5)),
  icmsOperations:{...row.icmsOperations,sourceMonth:months[index]},
  commercialComposition:{...row.commercialComposition,sourceMonths:[months[index]]}
}));
const inputs = cross.monthlyInputs.map((row,index)=>({...row,sourceMonth:months[index]}));
const computed = calculateMonthlySimulation(cross.draft,reports,inputs,cross.source.sales.jobId);
Object.assign(cross,computed);
cross.source.monthlyReports = reports;
cross.source.projection = computed.projection;
cross.source.commercialComposition.sourceMonths = months;
const period = {startMonth:months[0],endMonth:months.at(-1),
  startDate:'2024-11-01',endDate:'2025-09-30',months:3,observedMonths:3,
  missingMonths:['2024-12','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08']};
cross.reportPeriod = period; cross.source.period = period;
cross.source.purchases.period = period; cross.source.sales.period = period;
cross.modelVersion = computed.result.version;
cross.annualRevenue = computed.result.annualRevenue;
cross.bestRegimeId = computed.result.bestRegimeId;
delete cross.analysisPeriod; delete cross.source.analysisPeriod;
// Older snapshots may omit the stored presentation calendar. The actual
// report-month entries remain the authoritative, validated chronological base.
delete cross.monthlyDre;
const tiny = drePdfFixture();
tiny.draft.values = {salesRevenue:1,serviceRevenue:0,simplePurchases:0,
  regularPurchases:0,salaries:1000000,benefits:0,adminExpenses:0,rent:0,cardExpenses:0};
tiny.result = calculateSimulation(tiny.draft);
tiny.monthlyDre = buildMonthlyDre(tiny.result,2027,tiny.rbt12Manual);
tiny.modelVersion = tiny.result.version;
tiny.annualRevenue = tiny.result.annualRevenue;
tiny.bestRegimeId = tiny.result.bestRegimeId;
tiny.manuallyAdjusted = true;
delete tiny.analysisPeriod; delete tiny.source.analysisPeriod;
process.stdout.write(JSON.stringify({cross,tiny}));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script],
                            cwd=ROOT, check=True, capture_output=True, text=True,
                            timeout=30)
    return json.loads(result.stdout)


def sections(document):
    return {label: page - 1 for _, label, page in document.get_toc()}


class DreEditorialTests(unittest.TestCase):
    def test_cross_year_coverage_uses_actual_years_and_keeps_intervening_gap(self):
        saved = copy.deepcopy(engine_fixtures()['cross'])
        validate_dre_snapshot(saved)
        before = copy.deepcopy(saved)
        with pymupdf.open(stream=render(saved, 'annual'), filetype='pdf') as document:
            positions = sections(document)
            executive = document[positions['Leitura executiva']]
            lines = executive.get_text().splitlines()
            # Each label occurs separately in the strip. This excludes the
            # coverage prose, which can also mention the first and last month.
            for month in ('Nov/2024', 'Dez/2024', 'Jan/2025', 'Set/2025'):
                self.assertIn(month, lines)
            self.assertNotIn('Jan/2024', lines)
            self.assertNotIn('Nov/2025', lines)
            self.assertIn('Sem dados', normalized(executive.get_text()))
            self.assertEqual(saved['result']['monthlyResults'][0]['sourceMonth'], '2024-11')
        self.assertEqual(saved, before)

    def test_tiny_positive_revenue_keeps_large_negative_margin_on_one_line(self):
        saved = copy.deepcopy(engine_fixtures()['tiny'])
        validate_dre_snapshot(saved)
        before = copy.deepcopy(saved)
        actual = next(row for row in saved['result']['regimes'] if row['id'] == 'actual')
        value = actual['dre']['netProfit'] / actual['dre']['revenue'] * 100
        expected = f'{value:,.1f}'.replace(',', '_').replace('.', ',').replace('_', '.') + '%'
        self.assertLess(value, -1000000)
        with pymupdf.open(stream=render(saved, 'annual'), filetype='pdf') as document:
            lines = [line for block in document[0].get_text('dict')['blocks']
                     for line in block.get('lines', [])]
            matches = [line for line in lines
                       if ''.join(span['text'] for span in line['spans']) == expected]
            self.assertEqual(len(matches), 1, 'The cover margin must remain a complete numeric line.')
            x0, _, x1, _ = matches[0]['bbox']
            self.assertGreaterEqual(x0, 38)
            self.assertLessEqual(x1, 557.4)
        self.assertEqual(saved, before)

    def test_long_company_and_title_shift_guide_without_breaking_links(self):
        saved = fixture()
        saved['company']['name'] = ('INÍCIO - ' +
            'COMÉRCIO & SERVIÇOS <DEMONSTRAÇÃO> SOCIEDADE LIMITADA ' * 5 + ' - FIM')
        saved['source']['company'] = copy.deepcopy(saved['company'])
        saved['title'] = 'Conferência: ' + 'detalhes do período e cenários capturados ' * 4
        validate_dre_snapshot(saved)
        before = copy.deepcopy(saved)
        with pymupdf.open(stream=render(saved, 'complete', True), filetype='pdf') as document:
            positions = sections(document)
            guide = positions['Guia do relatório']
            self.assertGreater(guide, 1, 'The fixture must move the guide beyond the second page.')
            full_text = normalized(' '.join(page.get_text() for page in document))
            self.assertTrue(normalized(saved['company']['name']) in full_text)
            expected_destinations = {page for label, page in positions.items() if label != 'Guia do relatório'}
            guide_links = document[guide].get_links()
            self.assertEqual({link['page'] for link in guide_links}, expected_destinations)
            self.assertTrue(all(link['kind'] == pymupdf.LINK_GOTO for link in guide_links))
            for index, page in enumerate(document):
                if index <= guide:
                    continue
                with self.subTest(page=index + 1):
                    links = page.get_links()
                    self.assertEqual(len(links), 1)
                    self.assertEqual(links[0]['kind'], pymupdf.LINK_GOTO)
                    self.assertEqual(links[0]['page'], guide)
        self.assertEqual(saved, before)


if __name__ == '__main__':
    unittest.main()
