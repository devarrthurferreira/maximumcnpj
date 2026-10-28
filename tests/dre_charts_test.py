"""Inspect actual PDF vectors and text for chart accuracy and clipping."""
import io
import unittest

import pymupdf
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

from reporting.dre_charts import Bars, Trend, Waterfall, Donut, CoverageStrip, TEAL, CORAL
from reporting.dre_model import money
from reporting.dre_pdf import register_fonts


WIDTH = 519


def render(chart):
    register_fonts()
    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(595, 842))
    chart.drawOn(pdf, 38, 770 - chart.height)
    pdf.showPage()
    pdf.save()
    return pymupdf.open(stream=stream.getvalue(), filetype='pdf')


def same_color(actual, expected):
    target = HexColor(expected)
    return actual is not None and all(abs(a - b) < .0001 for a, b in zip(actual, (target.red, target.green, target.blue)))


class DreChartsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        register_fonts()

    def assert_bounds(self, document, chart):
        for block in document[0].get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    x0, y0, x1, y1 = span['bbox']
                    with self.subTest(text=span['text']):
                        self.assertGreaterEqual(x0, 37.8)
                        self.assertLessEqual(x1, 38 + WIDTH + .2)
                        self.assertGreaterEqual(y0, 842 - 770 - .2)
                        self.assertLessEqual(y1, 842 - 770 + chart.height + .2)

    def test_bar_vectors_share_zero_scale_and_keep_loss_zero_and_absence_distinct(self):
        chart = Bars(WIDTH, [('Prejuízo', -100, TEAL), ('Resultado zero', 0, TEAL),
                             ('Indisponível', None, TEAL), ('Lucro', 200, TEAL)])
        with render(chart) as document:
            text = document[0].get_text()
            for value in ('R$ -100,00', 'R$ 0,00', 'n/d', 'R$ 200,00'):
                self.assertIn(value, text)
            bars = [drawing for drawing in document[0].get_drawings()
                    if (same_color(drawing['fill'], TEAL) or same_color(drawing['fill'], CORAL))
                    and abs(drawing['rect'].height - 5) < .01]
            self.assertEqual(len(bars), 2, 'Zero and unavailable values must not acquire a filled value bar.')
            loss = next(row['rect'] for row in bars if same_color(row['fill'], CORAL))
            profit = next(row['rect'] for row in bars if same_color(row['fill'], TEAL))
            self.assertAlmostEqual(profit.width, loss.width * 2, delta=.02)
            self.assertAlmostEqual(profit.x0, loss.x1, delta=.02, msg='Signed bars must meet at the same zero.')
            self.assert_bounds(document, chart)

    def test_trend_does_not_connect_across_a_missing_competence(self):
        for values, expected_connections in [([100, None, 200], 0), ([100, 150, 200], 2)]:
            chart = Trend(WIDTH, ['Jan/2025', 'Fev/2025', 'Mar/2025'], [('Receita', values, TEAL)])
            with render(chart) as document:
                connections = [item for drawing in document[0].get_drawings()
                               if same_color(drawing['color'], TEAL)
                               for item in drawing['items'] if item[0] == 'l']
                self.assertEqual(len(connections), expected_connections)
                self.assertIn('Fev/2025', document[0].get_text())
                self.assert_bounds(document, chart)

    def test_labels_and_large_amounts_remain_complete_and_inside_chart(self):
        label = 'Nome de categoria extraordinariamente longo preservado integralmente para leitura e conferência'
        value = 1234567890123456.0
        charts = [Bars(WIDTH, [(label, -value, TEAL), ('Resultado', value, CORAL)]),
                  Donut(WIDTH, [(label, value), ('Outras despesas', value / 4)]),
                  Trend(WIDTH, ['Jan/2025', 'Fev/2025'], [(label, [100, 200], TEAL),
                        ('Outra legenda extensa para conferir a quebra em uma nova linha', [20, 25], CORAL)])]
        for chart in charts:
            with self.subTest(chart=type(chart).__name__), render(chart) as document:
                text = ' '.join(document[0].get_text().split())
                self.assertIn(label, text)
                self.assert_bounds(document, chart)
                if isinstance(chart, Bars):
                    self.assertIn(money(-value), text)
                    self.assertIn(money(value), text)
                elif isinstance(chart, Donut):
                    self.assertIn(money(value), text)
                    self.assertIn('80,0%', text)
                    self.assertIn('20,0%', text)

    def test_trillion_scale_charts_keep_text_inside_and_legends_separate(self):
        charts = [
            Trend(WIDTH, ['Jan/2025', 'Fev/2025', 'Mar/2025'], [
                ('Receita utilizada', [1.2e14, 1.5e14, 1.8e14], TEAL),
                ('Resultado líquido', [-2.5e13, 0, 3.5e13], CORAL),
                ('Tributos e encargos', [2.8e13, 3.1e13, 3.8e13], '#8AAEAE')]),
            Waterfall(WIDTH, [('Receita\nutilizada', 1.4e15), ('Tributos da\nreceita', -2.1e14),
                              ('Compras após\ncréditos', -8.3e14), ('Despesas\noperacionais', -4.3e14),
                              ('IRPJ e\nCSLL', 0), ('Resultado\nlíquido', -7e13)]),
            Bars(WIDTH, [('Prejuízo', -1.5e15, TEAL), ('Zero', 0, TEAL),
                         ('Disponível', 3e15, TEAL), ('Sem dados', None, TEAL)]),
        ]
        for chart in charts:
            with self.subTest(chart=type(chart).__name__), render(chart) as document:
                self.assert_bounds(document, chart)
                spans = [span for block in document[0].get_text('dict')['blocks']
                         for line in block.get('lines', []) for span in line['spans']]
                for index, first in enumerate(spans):
                    for second in spans[index + 1:]:
                        intersection = pymupdf.Rect(first['bbox']) & pymupdf.Rect(second['bbox'])
                        self.assertFalse(intersection.width > .2 and intersection.height > .2,
                                         f"Overlapping chart text: {first['text']!r} / {second['text']!r}")

    def test_financial_labels_keep_contrast_without_recoloring_chart_vectors(self):
        def luminance(color):
            channels = [((color >> shift) & 255) / 255 for shift in (16, 8, 0)]
            linear = [part / 12.92 if part <= .04045 else ((part + .055) / 1.055) ** 2.4 for part in channels]
            return sum(part * weight for part, weight in zip(linear, (.2126, .7152, .0722)))

        background = luminance(0xF1F7F6)
        charts = [Bars(WIDTH, [('Prejuízo', -100, TEAL)]),
                  Donut(WIDTH, [('Grupo A', 65), ('Grupo B', 35)])]
        for chart in charts:
            with render(chart) as document:
                spans = [span for block in document[0].get_text('dict')['blocks']
                         for line in block.get('lines', []) for span in line['spans']]
                amounts = [span for span in spans if span['text'].startswith('R$ -') or '%' in span['text']]
                self.assertTrue(amounts)
                for span in amounts:
                    self.assertGreaterEqual((background + .05) / (luminance(span['color']) + .05), 4.5)
                self.assertTrue(any(same_color(row['fill'], CORAL) for row in document[0].get_drawings()),
                                'The original coral remains in the chart geometry.')

    def test_empty_waterfall_and_invalid_composition_remain_explicit(self):
        for values in ([], [('Receita', None)], [('Receita', 0), ('Resultado', 0)]):
            chart = Waterfall(WIDTH, values)
            with render(chart) as document:
                text = document[0].get_text()
                if not values or values[0][1] is None:
                    self.assertIn('depende de valores confirmados', text)
                else:
                    self.assertIn('Resultado', text)
                self.assert_bounds(document, chart)
        for values in ([('Despesas', 0)], [('Despesas', -100)], [('Despesas', None)]):
            chart = Donut(WIDTH, values)
            with render(chart) as document:
                self.assertIn('Sem base positiva', document[0].get_text())
                self.assertNotIn('%', document[0].get_text())
                self.assert_bounds(document, chart)

    def test_coverage_requires_explicit_availability_for_every_label(self):
        with self.assertRaises(ValueError):
            CoverageStrip(WIDTH, ['Jan', 'Fev'], [True])
        with self.assertRaises(ValueError):
            CoverageStrip(WIDTH, ['Jan'], [1])
        labels = [f'{month:02d}/2025' for month in range(1, 13)]
        chart = CoverageStrip(WIDTH, labels, [month in (1, 3, 9) for month in range(1, 13)])
        with render(chart) as document:
            text = document[0].get_text()
            for label in labels:
                self.assertIn(label, text)
            self.assertIn('Sem dados', text)
            self.assertIn('Incluída', text)
            self.assert_bounds(document, chart)


if __name__ == '__main__':
    unittest.main()
