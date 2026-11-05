"""Reopen real DRE PDFs and verify financial text, navigation and pagination."""
import copy
import json
import subprocess
import unittest
from datetime import datetime, timezone
from functools import lru_cache

import pymupdf

from dre_data_test import fixture, ROOT
from reporting.core import MAX_RESPONSE_BYTES
from reporting.dre_pdf import render_dre_pdf


def normalized(value):
    return ' '.join(value.split())


def amount(value):
    """Independent BRL display expectation from the captured numeric amount."""
    return f'{value:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def render(snapshot, period='complete', show_percent=False, regime_id='actual', regime_ids=None):
    return render_dre_pdf({'snapshot': snapshot, 'options': {
        'period': period, 'showPercent': show_percent, 'regimeId': regime_id,
        **({'regimeIds': regime_ids} if regime_ids is not None else {})},
        'emittedAt': datetime(2026, 10, 28, 14, tzinfo=timezone.utc)})


@lru_cache(maxsize=6)
def rendered(variant, period='complete', show_percent=False):
    return render(fixture(variant), period, show_percent)


def section_text(document, label, following):
    if document.page_count == 2 and document.get_toc()[0][1] == 'Impostos e indicadores':
        index = 1 if label == 'DRE comparativa detalhada' else 0
        return normalized(document[index].get_text())
    sections = {title: page for _, title, page in document.get_toc()}
    return normalized(' '.join(document[index].get_text()
                               for index in range(sections[label] - 1, sections[following] - 1)))


class DrePdfTests(unittest.TestCase):
    def test_species_warning_is_visible_without_adding_a_third_page(self):
        saved = fixture()
        saved['result']['warnings'].append({'code': 'sales-species-missing', 'severity': 'warning',
            'title': 'Espécie das vendas não identificada',
            'detail': '1 venda sem espécie na coluna D. Reimporte o relatório de saídas para identificar NFC-e.'})
        content = render(saved)
        self.verify_document(content)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            text = normalized(document[0].get_text())
            self.assertIn('ICMS a conferir', text)
            self.assertIn('Reimporte o relatório de saídas', text)

    def verify_document(self, content):
        self.assertTrue(content.startswith(b'%PDF-'))
        self.assertLess(len(content), MAX_RESPONSE_BYTES)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            self.assertEqual(document.page_count, 2)
            self.assertFalse(document.needs_pass)
            self.assertIn('Simulador Reforma Tributária', document.metadata['title'])
            self.assertEqual(document.get_toc(), [[1, 'Impostos e indicadores', 1], [1, 'DRE - Consolidado', 2]])
            letterheads = set()
            for index, page in enumerate(document):
                text = normalized(page.get_text())
                self.assertIn('SIMULADOR REFORMA TRIBUTÁRIA', text)
                self.assertIn('Maximum Contábil', text)
                self.assertIn(f'{index + 1} / 2', text)
                self.assertNotRegex(text, r'\b(?:NaN|Infinity|undefined)\b')
                images = [image for image in page.get_images(full=True) if image[2:4] == (1414, 2000)]
                self.assertEqual(len(images), 1)
                letterheads.add(images[0][0])
                rect = page.get_image_rects(images[0][0])[0]
                self.assertAlmostEqual(rect.width, page.rect.width, delta=.02)
                self.assertAlmostEqual(rect.height, page.rect.height, delta=.02)
                for word in page.get_text('words'):
                    self.assertGreaterEqual(word[0], 0)
                    self.assertLessEqual(word[2], page.rect.width)
                    self.assertGreaterEqual(word[1], 74, 'Texto não deve invadir o cabeçalho do timbrado.')
                    self.assertLessEqual(word[3], page.rect.height - 62, 'Texto não deve invadir o rodapé do timbrado.')
            self.assertEqual(len(letterheads), 1)
            self.assertNotIn('Resumo dos resultados', document[0].get_text())
            self.assertIn('Impostos e indicadores', document[0].get_text())
            self.assertIn('CBS/IBS do cenário: 11,40%', document[0].get_text())
            self.assertIn('DRE - Consolidado', document[1].get_text())
            self.assertIn('Receitas de serviços', document[1].get_text())
            self.assertIn('Receita de vendas', document[1].get_text())
            self.assertIn('CUSTO', document[1].get_text())
            self.assertIn('Compras e serviços (do Simples)', document[1].get_text())
            self.assertIn('Compras e serviços (fora do Simples)', document[1].get_text())
            self.assertIn('Resultado Antes do IRPJ/CSLL', document[1].get_text())
            self.assertIn('Benefícios e Encargos', document[1].get_text())
            self.assertIn('INSS', document[1].get_text())
            burden = document[0].search_for('% sobre a receita')[0]
            contribution = document[0].search_for('Margem de contribuição')[0]
            self.assertGreaterEqual(contribution.y0 - burden.y1, 15,
                                    'A linha em branco deve separar a carga tributária dos indicadores.')
            self.assertNotIn('Memória de cálculo', normalized(' '.join(page.get_text() for page in document)))

    def test_all_export_options_keep_two_pages_and_saved_values(self):
        from dre_model_test import model
        saved = fixture()
        before = copy.deepcopy(saved)
        for period in ('complete', 'annual', 'monthly'):
            for av in (False, True):
                content = render(saved, period, av)
                self.verify_document(content)
                with pymupdf.open(stream=content, filetype='pdf') as document:
                    statement, taxes = normalized(document[1].get_text()), normalized(document[0].get_text())
                    view = model(saved)
                    for _, rows in view.sections():
                        for key, label in rows:
                            self.assertIn(label, statement)
                            for regime in view.regimes:
                                self.assertIn(amount(view.value(regime, key)), statement, (regime['id'], key))
                    for regime in view.regimes:
                        self.assertIn(amount(regime['totalTaxes']), taxes)
                        for key in ('taxBurden', 'contributionMargin', 'ebitdaMargin', 'netMargin'):
                            self.assertIn(f"{view.tax_value(regime, key) * 100:.2f}".replace('.', ',') + '%', taxes)
                    self.assertNotIn('Total de impostos', statement)
                    self.assertIn('Total', taxes)
        self.assertEqual(saved, before)

    def test_loss_zero_excesses_missing_months_and_pending_regimes_keep_two_pages(self):
        for variant in ('loss', 'zero', 'partial', 'negative-revenue', 'purchases-above-revenue', 'unavailable', 'without-rbt12'):
            with self.subTest(variant=variant):
                saved = fixture(variant)
                before = copy.deepcopy(saved)
                content = render(saved)
                self.verify_document(content)
                with pymupdf.open(stream=content, filetype='pdf') as document:
                    text = normalized(' '.join(page.get_text() for page in document))
                    for regime in saved['result']['regimes']:
                        if regime['available']:
                            self.assertIn(amount(regime['dre']['netProfit']), text)
                            self.assertIn(amount(regime['totalTaxes']), text)
                        else:
                            self.assertIn(normalized(regime['status']) if len(regime['status']) <= 100 else 'Confira os motivos por competência na análise.', text)
                            self.assertIn('—', text)
                    if variant == 'partial':
                        self.assertIn('3 de 9 competências', text)
                    if variant in ('zero', 'negative-revenue'):
                        self.assertIn('sem receita positiva', text)
                self.assertEqual(saved, before)

    def test_visible_regimes_only_and_no_extra_memory_pages(self):
        saved = fixture()
        for ids in (['actual'], ['pure', 'actual'], ['hybrid', 'presumed', 'actual']):
            with self.subTest(ids=ids):
                content = render(saved, regime_ids=ids)
                self.verify_document(content)
                with pymupdf.open(stream=content, filetype='pdf') as document:
                    text = normalized(' '.join(page.get_text() for page in document))
                    for regime in saved['result']['regimes']:
                        if regime['id'] in ids:
                            self.assertIn(regime['name'], text)
                            self.assertIn(amount(regime['dre']['netProfit']), text)
                        else:
                            self.assertNotIn(regime['name'], text)

    def test_reduced_cbs_ibs_rate_is_taken_from_the_saved_calculation(self):
        script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateMonthlySimulation} from './public/simulator-monthly.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
const s=drePdfFixture();s.draft.cbsIbsPercent=Number(process.argv[1]);
Object.assign(s,calculateMonthlySimulation(s.draft,s.source.monthlyReports,s.monthlyInputs,s.source.sales.jobId,null,s.analysisPeriod));
s.monthlyDre=buildMonthlyDre(s.result,s.year,s.rbt12Manual,s.reportPeriod);s.modelVersion=s.result.version;
s.annualRevenue=s.result.annualRevenue;s.bestRegimeId=s.result.bestRegimeId;
process.stdout.write(JSON.stringify(s));
"""
        for retained, expected in ((100, '11,40% (CBS 11,30% + IBS 0,10%)'),
                                   (0, '0,00% (CBS 0,00% + IBS 0,00%)'),
                                   (40, '4,56% (CBS 4,52% + IBS 0,04%)'),
                                   (60, '6,84% (CBS 6,78% + IBS 0,06%)')):
            with self.subTest(retained=retained):
                saved = json.loads(subprocess.run(['node', '--input-type=module', '-e', script, str(retained)], cwd=ROOT,
                                                 capture_output=True, text=True, check=True, timeout=30).stdout)
                with pymupdf.open(stream=render(saved), filetype='pdf') as document:
                    self.assertEqual(document.page_count, 2)
                    text = normalized(document[0].get_text())
                    self.assertIn('CBS/IBS do cenário: ' + expected, text)

    def test_missing_optional_tax_captures_are_unavailable_not_zero(self):
        from dre_irpj_quarter_test import quarter_fixture
        saved = quarter_fixture()
        for result in [saved['result'], *(entry['result'] for entry in saved['result']['monthlyResults'])]:
            for regime in result['regimes']:
                regime['dre'].pop('difal', None)
                regime['dre'].pop('icmsAnticipation', None)
        for regime in saved['monthlyDre']['regimes']:
            regime['rows'] = [row for row in regime['rows'] if row['key'] not in ('difal', 'icmsAnticipation')]
        with pymupdf.open(stream=render(saved), filetype='pdf') as document:
            self.assertEqual(document.page_count, 2)
            text = normalized(document[0].get_text())
            for label in ('Antecipação de ICMS', 'DIFAL'):
                self.assertIn(label + ' — — — —', text)
            for regime in saved['result']['regimes']:
                self.assertIn(amount(regime['totalTaxes']), text)

    def test_financial_inputs_reconcile_through_python_and_render_exactly_twice(self):
        from reporting.dre_data import validate_dre_snapshot
        from reporting.core import ReportError
        from dre_model_test import model
        script = """
import {drePdfFixture} from './tests/fixtures/dre-pdf.mjs';
import {calculateMonthlySimulation} from './public/simulator-monthly.js';
import {buildMonthlyDre} from './public/simulator-calendar.js';
const s=drePdfFixture();for(const row of s.monthlyInputs)Object.assign(row.values,{financialIncome:1500,financialExpenses:600});
Object.assign(s,calculateMonthlySimulation(s.draft,s.source.monthlyReports,s.monthlyInputs,s.source.sales.jobId,null,s.analysisPeriod));
s.monthlyDre=buildMonthlyDre(s.result,s.year,s.rbt12Manual);s.modelVersion=s.result.version;
s.annualRevenue=s.result.annualRevenue;s.bestRegimeId=s.result.bestRegimeId;
process.stdout.write(JSON.stringify(s));
"""
        saved = json.loads(subprocess.run(['node','--input-type=module','-e',script], cwd=ROOT,
                                         capture_output=True,text=True,check=True,timeout=30).stdout)
        before = copy.deepcopy(saved)
        validate_dre_snapshot(saved)
        view = model(saved)
        for regime in view.regimes:
            self.assertAlmostEqual(view.value(regime, 'financialResult'), 8100)
            self.assertAlmostEqual(view.value(regime, 'resultBeforeIncomeTaxes'), view.value(regime, 'ebitda') + 8100)
        content = render(saved)
        self.verify_document(content)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            statement = normalized(document[1].get_text())
            self.assertIn('Despesas/Receitas financeiras 8.100,00 8.100,00 8.100,00 8.100,00', statement)
        altered = copy.deepcopy(saved)
        altered['result']['regimes'][0]['dre']['financialResult'] += 10
        with self.assertRaises(ReportError):
            validate_dre_snapshot(altered)
        self.assertEqual(saved, before)

    def test_historical_twelve_month_projection_keeps_original_report(self):
        saved = fixture('legacy')
        before = copy.deepcopy(saved)
        with pymupdf.open(stream=render(saved), filetype='pdf') as document:
            self.assertGreater(document.page_count, 2)
            text = normalized(' '.join(page.get_text() for page in document))
            self.assertIn('Projeção anual salva', text)
            self.assertIn('não movimentos históricos individuais', text)
        self.assertEqual(saved, before)


if __name__ == '__main__':
    unittest.main()
