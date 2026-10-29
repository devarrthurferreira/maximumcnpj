"""Reopen real DRE PDFs and verify financial text, navigation and pagination."""
import copy
import unittest
from datetime import datetime, timezone
from functools import lru_cache

import pymupdf

from dre_data_test import fixture
from reporting.core import MAX_RESPONSE_BYTES
from reporting.dre_pdf import render_dre_pdf


def normalized(value):
    return ' '.join(value.split())


def amount(value):
    """Independent BRL display expectation from the captured numeric amount."""
    return f'{value:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def render(snapshot, period='complete', show_percent=False, regime_id='actual'):
    return render_dre_pdf({'snapshot': snapshot, 'options': {
        'period': period, 'showPercent': show_percent, 'regimeId': regime_id},
        'emittedAt': datetime(2026, 10, 28, 14, tzinfo=timezone.utc)})


@lru_cache(maxsize=6)
def rendered(variant, period='complete', show_percent=False):
    return render(fixture(variant), period, show_percent)


def section_text(document, label, following):
    sections = {title: page for _, title, page in document.get_toc()}
    return normalized(' '.join(document[index].get_text()
                               for index in range(sections[label] - 1, sections[following] - 1)))


class DrePdfTests(unittest.TestCase):
    def assertIn(self, member, container, msg=None):
        # Report bodies can be hundreds of kilobytes. A failed assertion must
        # identify the missing phrase without dumping the complete document.
        if isinstance(container, str) and len(container) > 500:
            return self.assertTrue(member in container, msg or f'Expected PDF text is absent: {member!r}')
        return super().assertIn(member, container, msg)

    def assertNotIn(self, member, container, msg=None):
        if isinstance(container, str) and len(container) > 500:
            return self.assertFalse(member in container, msg or f'Unexpected PDF text is present: {member!r}')
        return super().assertNotIn(member, container, msg)

    def verify_document(self, content, *, monthly):
        self.assertTrue(content.startswith(b'%PDF-'))
        self.assertLess(len(content), MAX_RESPONSE_BYTES)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            self.assertGreater(document.page_count, 5)
            self.assertFalse(document.needs_pass)
            self.assertIn('DRE', document.metadata['title'])
            labels = {label for _, label, _ in document.get_toc()}
            self.assertTrue({'Visão geral', 'Comparação entre regimes', 'Tributos, encargos e créditos',
                             'Conferência dos créditos', 'Receitas e compras na origem',
                             'Premissas, cobertura e conferências', 'Memória de cálculo'} <= labels)
            self.assertEqual('DRE mensal por regime' in labels, monthly)
            for level, label, page in document.get_toc():
                with self.subTest(bookmark=label):
                    self.assertEqual(level, 1)
                    self.assertTrue(1 <= page <= document.page_count)
                    if label != 'Visão geral':
                        self.assertIn(label, normalized(document[page - 1].get_text()))
                    else:
                        self.assertEqual(page, 1)
            letterheads = set()
            for index, page in enumerate(document):
                with self.subTest(page=index + 1):
                    text = normalized(page.get_text())
                    self.assertIn('DRE | ANÁLISE GERENCIAL', text)
                    self.assertIn('Luna. / DRE gerencial / Versão salva', text)
                    self.assertIn(f'{index + 1:02d} / {document.page_count:02d}', text)
                    self.assertNotRegex(text, r'\b(?:NaN|undefined)\b')
                    images = [image for image in page.get_images(full=True) if image[2:4] == (1241, 1755)]
                    self.assertEqual(len(images), 1, 'Each page must use the original letterhead.')
                    letterheads.add(images[0][0])
                    image_rect = page.get_image_rects(images[0][0])[0]
                    self.assertAlmostEqual(image_rect.width, page.rect.width, delta=.02)
                    self.assertAlmostEqual(image_rect.height, page.rect.height, delta=.02)
            self.assertEqual(len(letterheads), 1, 'Reuse one image object; do not duplicate the background per page.')
            self.assertGreater(len(document[0].get_drawings()), 10, 'The cover chart remains a vector drawing.')

    def test_complete_pdf_preserves_saved_subtotals_letterhead_pages_and_bookmarks(self):
        saved = fixture()
        before = copy.deepcopy(saved)
        content = render(saved)
        self.verify_document(content, monthly=True)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            statement = section_text(document, 'DRE comparativa detalhada', 'Como o resultado se forma')
            for regime in saved['result']['regimes']:
                for key in ('revenue', 'netRevenue', 'cmv', 'grossProfit', 'personnel', 'preTax', 'netProfit'):
                    with self.subTest(regime=regime['id'], subtotal=key):
                        self.assertIn(amount(regime['dre'][key]), statement)
            self.assertIn('Não some novamente os subtotais', statement)
            full = normalized(' '.join(page.get_text() for page in document))
            self.assertIn(saved['_id'], full)
            self.assertIn(saved['company']['name'], full)
            self.assertIn('11,3%', full)
        self.assertEqual(saved, before, 'The generator must leave the snapshot unchanged.')

    def test_zero_and_loss_are_downloadable_without_false_ranking_or_lost_signs(self):
        for variant in ('zero', 'loss'):
            content = rendered(variant, 'annual')
            self.verify_document(content, monthly=False)
            with pymupdf.open(stream=content, filetype='pdf') as document:
                full = normalized(' '.join(page.get_text() for page in document))
                if variant == 'zero':
                    self.assertIn('Esta versão não registra um regime vencedor.', full)
                    self.assertNotIn('Maior resultado capturado:', full)
                    self.assertNotIn('Diferença entre o maior e o menor resultado disponível:', full)
                    self.assertIn('n/d', full)
                    self.assertIn('R$ 0,00', full)
                else:
                    statement = section_text(document, 'DRE comparativa detalhada', 'Como o resultado se forma')
                    for regime in fixture('loss')['result']['regimes']:
                        self.assertLess(regime['dre']['netProfit'], 0)
                        self.assertIn(amount(regime['dre']['netProfit']), statement)

    def test_partial_monthly_pdf_keeps_gaps_and_vertical_analysis_uses_each_month(self):
        saved = fixture('partial')
        content = rendered('partial', 'monthly', True)
        self.verify_document(content, monthly=True)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            full = normalized(' '.join(page.get_text() for page in document))
            self.assertIn('3 de 9 competências', full)
            self.assertIn('Lacunas no gráfico representam dados ausentes', full)
            self.assertNotIn('DRE comparativa detalhada', {label for _, label, _ in document.get_toc()})
            annex = section_text(document, 'DRE mensal por regime', 'Premissas, cobertura e conferências')
            self.assertIn('cada percentual usa a receita da mesma competência e do mesmo regime', annex)
            for label in ('Jan/2025', 'Mar/2025', 'Set/2025'):
                self.assertIn(label, annex)
            self.assertNotIn('Fev/2025', annex)
            for entry in saved['result']['monthlyResults']:
                regime = next(row for row in entry['result']['regimes'] if row['id'] == 'actual')
                expected = 'AV ' + f"{regime['dre']['salaries'] / regime['dre']['revenue'] * 100:.1f}".replace('.', ',') + '%'
                self.assertIn(expected, annex)
                self.assertIn(amount(regime['dre']['salaries']), annex)
                self.assertIn(amount(regime['dre']['netProfit']), annex)

    def test_financial_excesses_export_pdf_with_alerts_and_preserved_negative_values(self):
        for variant in ('negative-revenue', 'purchases-above-revenue'):
            with self.subTest(variant=variant):
                saved = fixture(variant)
                before = copy.deepcopy(saved)
                content = render(saved, 'complete', True)
                self.verify_document(content, monthly=True)
                with pymupdf.open(stream=content, filetype='pdf') as document:
                    full = normalized(' '.join(page.get_text() for page in document))
                    statement = section_text(document, 'DRE comparativa detalhada', 'Como o resultado se forma')
                    annex = section_text(document, 'DRE mensal por regime', 'Premissas, cobertura e conferências')
                    premises = section_text(document, 'Premissas, cobertura e conferências', 'Memória de cálculo')
                    financial = [row for row in saved['result']['warnings'] if row['code'] in
                                 ('negative-sales', 'negative-revenue', 'purchases-above-revenue', 'costs-above-revenue')]
                    self.assertTrue(financial)
                    for warning in financial:
                        self.assertIn(normalized(warning['detail']).rstrip('. '), premises)
                    for regime in saved['result']['regimes']:
                        self.assertIn(amount(regime['dre']['revenue']), statement)
                        self.assertIn(amount(regime['dre']['cmv']), statement)
                        self.assertIn(amount(regime['dre']['netProfit']), statement)
                        self.assertLess(regime['dre']['netProfit'], 0)
                        self.assertGreaterEqual(regime['totalTaxes'], 0)
                    for month in saved['result']['monthlyResults']:
                        for regime in month['result']['regimes']:
                            self.assertIn(amount(regime['dre']['revenue']), annex)
                            self.assertIn(amount(regime['dre']['netProfit']), annex)
                    self.assertNotRegex(full, r'\b(?:NaN|Infinity|undefined)\b')
                    if variant == 'negative-revenue':
                        self.assertIn('Esta versão não registra um regime vencedor.', full)
                        self.assertIn('não fornece denominador positivo', full)
                        self.assertIn('Sem base positiva para representar a composição.', full)
                        self.assertNotIn('Maior resultado capturado:', full)
                    else:
                        self.assertTrue(all(-regime['dre']['cmv'] > regime['dre']['revenue']
                                            for regime in saved['result']['regimes']))
                self.assertEqual(saved, before)

    def test_contents_links_resolve_to_actual_section_pages_in_every_mode(self):
        for period in ('complete', 'annual', 'monthly'):
            with self.subTest(period=period), pymupdf.open(stream=rendered('complete', period), filetype='pdf') as document:
                sections = {title: page - 1 for _, title, page in document.get_toc()}
                guide = sections['Guia do relatório']
                self.assertIn('Leitura executiva', sections)
                links = document[guide].get_links()
                self.assertEqual(len(links), len(sections) - 1)
                self.assertEqual({link['page'] for link in links},
                                 {page for title, page in sections.items() if title != 'Guia do relatório'})
                for link in links:
                    self.assertEqual(link['kind'], pymupdf.LINK_GOTO)
                    self.assertTrue(document[guide].rect.contains(link['from']))
                for page in document[guide + 1:]:
                    back = page.get_links()
                    self.assertEqual(len(back), 1)
                    self.assertEqual((back[0]['kind'], back[0]['page']), (pymupdf.LINK_GOTO, guide))
                self.assertEqual('DRE mensal por regime' in sections, period != 'annual')
                self.assertEqual('DRE comparativa detalhada' in sections, period != 'monthly')

    def test_monthly_annex_has_complete_statements_without_note_only_pages(self):
        saved = fixture()
        with pymupdf.open(stream=rendered('complete', 'complete', True), filetype='pdf') as document:
            sections = {title: page - 1 for _, title, page in document.get_toc()}
            pages = document[sections['DRE mensal por regime']:sections['Premissas, cobertura e conferências']]
            content = []
            for page in pages:
                extracted = normalized(page.get_text())
                self.assertIn('Conta', extracted)
                self.assertIn('Receita de serviços', extracted)
                self.assertIn('Resultado líquido', extracted)
                self.assertIn('Total do período', extracted)
                content.append(extracted)
            annex = ' '.join(content)
            for month in saved['result']['monthlyResults']:
                for regime in month['result']['regimes']:
                    for key in ('revenue', 'netRevenue', 'cmv', 'grossProfit', 'personnel', 'preTax', 'netProfit'):
                        self.assertIn(amount(regime['dre'][key]), annex)

    def test_unavailable_regimes_and_legacy_projection_remain_explicit(self):
        unavailable = rendered('unavailable', 'complete')
        self.verify_document(unavailable, monthly=True)
        with pymupdf.open(stream=unavailable, filetype='pdf') as document:
            full = normalized(' '.join(page.get_text() for page in document))
            self.assertIn('Consolidado indisponível:', full)
            self.assertIn('Conferência necessária', full)
            self.assertIn('n/d', full)
            for regime in fixture('unavailable')['result']['regimes']:
                if not regime['available']:
                    self.assertIn(normalized(regime['status']), full)
        legacy = rendered('legacy', 'monthly')
        self.verify_document(legacy, monthly=True)
        with pymupdf.open(stream=legacy, filetype='pdf') as document:
            full = normalized(' '.join(page.get_text() for page in document))
            self.assertIn('Projeção anual salva', full)
            self.assertIn('não movimentos históricos individuais', full)
            self.assertIn('Não há análise de crescimento mensal realizado', full)
            annex = section_text(document, 'DRE mensal por regime', 'Premissas, cobertura e conferências')
            self.assertIn('Jan/2027', annex)
            self.assertIn('Dez/2027', annex)
            actual = next(row for row in fixture('legacy')['result']['regimes'] if row['id'] == 'actual')
            self.assertIn(amount(actual['dre']['revenue'] / 12), annex)

    def test_optional_rbt12_exports_without_a_statement_or_fabricated_simples_values(self):
        for variant in ('without-rbt12', 'without-rbt12-only-simples'):
            with self.subTest(variant=variant):
                saved = fixture(variant)
                before = copy.deepcopy(saved)
                content = render(saved, regime_id='pure' if variant.endswith('only-simples') else 'actual')
                self.verify_document(content, monthly=True)
                with pymupdf.open(stream=content, filetype='pdf') as document:
                    full = normalized(' '.join(page.get_text() for page in document))
                    self.assertIn('Referência de RBT12: Não informada nesta versão', full)
                    self.assertIn('os cenários do Simples não foram calculados', full)
                    self.assertIn('Consolidado indisponível:', full)
                    self.assertIn('n/d', full)
                    for regime in saved['result']['regimes']:
                        if regime['available']:
                            statement = section_text(document, 'DRE comparativa detalhada', 'Como o resultado se forma')
                            self.assertIn(amount(regime['dre']['netProfit']), statement)
                        else:
                            self.assertIn(normalized(regime['status']), full)
                    if variant.endswith('only-simples'):
                        self.assertIn('Esta versão não registra um regime vencedor.', full)
                self.assertEqual(saved, before)

    def test_long_textual_memory_paginates_without_truncation_or_financial_changes(self):
        saved = fixture('partial')
        captured_regimes = copy.deepcopy(saved['result']['regimes'])
        observations = []
        for index in range(36):
            start, end = f'INICIOREGISTRO{index:03d}', f'FIMREGISTRO{index:03d}'
            description = ('Conferência capturada da competência: Empresa A & B <conferida>; '
                           'o texto descreve a origem e preserva as condições registradas. ') * 7
            observations.append((start, end))
            saved['result']['memory'].append({'id': f'review.note.{index}', 'section': 'Notas extensas capturadas',
                'label': f'Registro integral {index:03d}', 'formula': 'Observação textual da versão salva.',
                'value': start + ' ' + description + ' ' + end, 'unit': 'text'})
        content = render(saved, 'annual')
        self.verify_document(content, monthly=False)
        with pymupdf.open(stream=content, filetype='pdf') as document:
            pages = [normalized(page.get_text()) for page in document]
            full = ' '.join(pages)
            first_page = next(index for index, page in enumerate(pages) if observations[0][0] in page)
            last_page = next(index for index, page in enumerate(pages) if observations[-1][1] in page)
            self.assertGreater(last_page, first_page + 1)
            for start, end in observations:
                self.assertEqual(full.count(start), 1)
                self.assertEqual(full.count(end), 1)
            for page in pages[first_page:last_page + 1]:
                self.assertIn('Memória / fórmula capturada', page)
            self.assertIn('Empresa A & B <conferida>', full)
            self.assertIn('Identificação e rastreabilidade', pages[-1])
            for regime in captured_regimes:
                self.assertIn(amount(regime['dre']['netProfit']), full)
        self.assertEqual(saved['result']['regimes'], captured_regimes)


if __name__ == '__main__':
    unittest.main()
