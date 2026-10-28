"""Complete, single-file DRE report rendered in Python from a saved snapshot.

The user's Luna letterhead is embedded unchanged. All charts are PDF vectors;
the report makes no network request, executes no tax calculation and stores no
additional customer data. Long statements and calculation memory paginate.
"""
from __future__ import annotations

import io
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
                               PageBreak, KeepTogether, LongTable, Table, TableStyle)

from .core import VERSION, display_date
from .dre_model import (DreModel, SUBTOTALS, DERIVED, GROUP_LABELS, finite, close,
                        total, money, percentage, decimal_text, month_label)
from .dre_charts import (Bars, Trend, Waterfall, Donut, draw_text, TEAL, DEEP, CORAL,
                         MINT, INK, MUTED, LINE, PALE, COLORS, FONT, BOLD, CoverageStrip)
from .dre_insights import executive_insights, monthly_insights
from .dre_layout import Panel, Navigation, draw_navigation_links, running_label

PAGE_W, PAGE_H = A4
MARGIN = 38
WIDTH = PAGE_W - 2 * MARGIN
LETTERHEAD = Path(__file__).resolve().parent / 'assets' / 'luna-letterhead.jpg'


@lru_cache(maxsize=1)
def register_fonts():
    font_dir = Path(reportlab.__file__).resolve().parent / 'fonts'
    pdfmetrics.registerFont(TTFont(FONT, str(font_dir / 'Vera.ttf')))
    pdfmetrics.registerFont(TTFont(BOLD, str(font_dir / 'VeraBd.ttf')))
    pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=BOLD, italic=FONT, boldItalic=BOLD)


@lru_cache(maxsize=1)
def letterhead():
    image = ImageReader(str(LETTERHEAD))
    if image.getSize() != (1241, 1755):
        raise ValueError('Timbrado Luna ausente ou com dimensões inesperadas.')
    return image


def text(value):
    value = str(value if value is not None else '')
    return escape(value.replace('\u2212', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\u2011', '-'))


def styles():
    base = dict(fontName=FONT, textColor=colors.HexColor(INK), leading=13, fontSize=8.6,
                spaceAfter=7, splitLongWords=True, allowWidows=0, allowOrphans=0)
    return {
        'body': ParagraphStyle('LunaBody', **base),
        'small': ParagraphStyle('LunaSmall', **{**base, 'fontSize': 7.5, 'leading': 10.8, 'textColor': colors.HexColor(MUTED)}),
        'tiny': ParagraphStyle('LunaTiny', **{**base, 'fontSize': 6.8, 'leading': 9.4, 'spaceAfter': 0}),
        'cell': ParagraphStyle('LunaCell', **{**base, 'fontSize': 7.5, 'leading': 10.1, 'spaceAfter': 0}),
        'number': ParagraphStyle('LunaNumber', **{**base, 'fontSize': 7.4, 'leading': 10, 'alignment': TA_RIGHT, 'spaceAfter': 0}),
        'monthly_number': ParagraphStyle('LunaMonthlyNumber', **{**base, 'fontSize': 7.1, 'leading': 8.5, 'alignment': TA_RIGHT, 'spaceAfter': 0}),
        'head': ParagraphStyle('LunaHead', **{**base, 'fontName': BOLD, 'fontSize': 7.5, 'leading': 10.3,
                              'textColor': colors.white, 'spaceAfter': 0}),
        'eyebrow': ParagraphStyle('LunaEyebrow', **{**base, 'fontName': BOLD, 'fontSize': 8, 'leading': 11,
                                  'textColor': colors.HexColor(TEAL), 'spaceAfter': 7}),
        'title': ParagraphStyle('LunaTitle', **{**base, 'fontName': BOLD, 'fontSize': 26, 'leading': 31,
                                'textColor': colors.HexColor(DEEP), 'spaceAfter': 9}),
        'h1': ParagraphStyle('LunaH1', **{**base, 'fontName': BOLD, 'fontSize': 20, 'leading': 25,
                             'textColor': colors.HexColor(DEEP), 'spaceAfter': 8, 'keepWithNext': True}),
        'h2': ParagraphStyle('LunaH2', **{**base, 'fontName': BOLD, 'fontSize': 12.5, 'leading': 17,
                             'textColor': colors.HexColor(TEAL), 'spaceBefore': 11, 'spaceAfter': 8, 'keepWithNext': True}),
        'kpi_label': ParagraphStyle('LunaKpiLabel', **{**base, 'fontName': BOLD, 'fontSize': 8, 'leading': 11,
                                    'textColor': colors.HexColor(TEAL), 'spaceAfter': 6}),
        'kpi_value': ParagraphStyle('LunaKpiValue', **{**base, 'fontName': BOLD, 'fontSize': 15, 'leading': 22,
                                    'textColor': colors.HexColor(DEEP), 'spaceAfter': 5}),
        'hero_label': ParagraphStyle('LunaHeroLabel', **{**base, 'fontName': BOLD, 'fontSize': 8, 'leading': 12,
                                      'textColor': colors.HexColor('#C9E0DC'), 'spaceAfter': 6}),
        'hero_value': ParagraphStyle('LunaHeroValue', **{**base, 'fontName': BOLD, 'fontSize': 27, 'leading': 32,
                                      'textColor': colors.white, 'spaceAfter': 4}),
        'hero_detail': ParagraphStyle('LunaHeroDetail', **{**base, 'fontSize': 7.1, 'leading': 10,
                                       'textColor': colors.HexColor('#D5E7E4'), 'spaceAfter': 0}),
        'chapter_number': ParagraphStyle('LunaChapterNumber', **{**base, 'fontName': BOLD, 'fontSize': 31, 'leading': 36,
                                          'textColor': colors.HexColor(MINT), 'alignment': TA_RIGHT, 'spaceAfter': 0}),
    }


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.states = []
        self.section_entries = []
        self.navigation_panels = []
        self.running_entries = []

    def showPage(self):
        self.states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        pages = len(self.states)
        entries = list(self.section_entries)
        panels = list(self.navigation_panels)
        running = list(self.running_entries)
        guide = next(((page, f'dre-section-{index}') for index, (page, label) in enumerate(entries)
                      if label == 'Guia do relatório'), None)
        for state in self.states:
            self.__dict__.update(state)
            for index, (page_number, label) in enumerate(entries):
                if page_number == self._pageNumber:
                    key = f'dre-section-{index}'
                    self.bookmarkPage(key)
                    self.addOutlineEntry(label, key, level=0, closed=False)
            draw_navigation_links(self, panels, entries)
            if self._pageNumber > 1:
                active = next((label for page, label in reversed(running) if page <= self._pageNumber), '')
                running_label(self, active, PAGE_W - MARGIN, PAGE_H - 76, WIDTH * .73, align='right')
            if guide and self._pageNumber > guide[0]:
                draw_text(self, 'SUMÁRIO', PAGE_W - MARGIN - 72, 25, 6.6, TEAL, align='right')
                self.linkAbsolute('Voltar ao sumário', guide[1],
                                  (PAGE_W - MARGIN - 125, 19, PAGE_W - MARGIN - 65, 35), thickness=0,
                                  name=f'dre-back-{self._pageNumber}')
            draw_text(self, f'{self._pageNumber:02d} / {pages:02d}', PAGE_W - MARGIN, 25, 7.5, TEAL, bold=True, align='right')
            super().showPage()
        super().save()


class ReportDocument(BaseDocTemplate):
    def afterFlowable(self, flowable):
        section = getattr(flowable, '_luna_section', None)
        if section:
            self.canv.section_entries.append((self.page, section))
            self.canv.running_entries.append((self.page, section))
        running = getattr(flowable, '_luna_running', None)
        if running:
            self.canv.running_entries.append((self.page, running))


class Report:
    def __init__(self, meta):
        register_fonts()
        self.model = DreModel(meta)
        self.styles = styles()
        self.story = []
        self.chapter = 0

    def p(self, value, style='body', markup=False):
        return Paragraph(str(value) if markup else text(value), self.styles[style])

    def add(self, *items):
        self.story.extend(items)

    def title(self, title, description='', new_page=True):
        if new_page and self.story:
            self.add(PageBreak())
        self.chapter += 1
        heading = Table([[[self.p('RELATÓRIO GERENCIAL', 'eyebrow'), self.p(title, 'h1')],
                          self.p(f'{self.chapter:02d}', 'chapter_number')]], colWidths=[WIDTH - 65, 65])
        heading.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (0, 0), 12),
            ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LINEBELOW', (0, 0), (-1, -1), .7, colors.HexColor(LINE)),
        ]))
        heading._luna_section = title
        heading.keepWithNext = True
        self.add(heading, Spacer(1, 8))
        if description:
            self.add(self.p(description, 'small'))
        self.add(Spacer(1, 7))

    def note(self, value, warning=False):
        table = Table([[self.p(value, 'small')]], colWidths=[WIDTH])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FFF2EE' if warning else PALE)),
            ('LINEBEFORE', (0, 0), (0, -1), 2.5, colors.HexColor(CORAL if warning else TEAL)),
            ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
            ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))
        return table

    def table(self, headers, rows, widths=None, *, highlights=(), groups=(), spans=(), small=False, compact=False, repeat_context=None):
        widths = widths or [WIDTH / len(headers)] * len(headers)
        content = [[self.p(value, 'head') for value in headers]]
        if repeat_context:
            content.insert(0, [self.p(repeat_context, 'head')] + [''] * (len(headers) - 1))
        offset = 2 if repeat_context else 1
        for row in rows:
            content.append([value if isinstance(value, Paragraph) else self.p(value, 'tiny' if small else 'cell') for value in row])
        table = LongTable(content, colWidths=widths, repeatRows=offset, hAlign='LEFT',
                          spaceBefore=4, spaceAfter=10, splitByRow=1)
        commands = [
            ('BACKGROUND', (0, 0), (-1, offset - 1), colors.HexColor(TEAL)),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 1 if compact == 'monthly' else 2.6 if compact else 6 if not small else 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1 if compact == 'monthly' else 2.6 if compact else 6 if not small else 4),
            ('ROWBACKGROUNDS', (0, offset), (-1, -1), [colors.white, colors.HexColor('#F7FAFA')]),
            ('LINEBELOW', (0, 0), (-1, 0), .5, colors.HexColor(TEAL)),
            ('LINEBELOW', (0, -1), (-1, -1), .6, colors.HexColor(LINE)),
        ]
        if repeat_context:
            commands += [('SPAN', (0, 0), (-1, 0)), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(DEEP)),
                         ('TOPPADDING', (0, 0), (-1, offset - 1), 5), ('BOTTOMPADDING', (0, 0), (-1, offset - 1), 5)]
        for index in highlights:
            commands += [('BACKGROUND', (0, index + offset), (-1, index + offset), colors.HexColor('#DFEDEA')),
                         ('LINEABOVE', (0, index + offset), (-1, index + offset), .5, colors.HexColor(MINT))]
        for index in groups:
            commands += [('BACKGROUND', (0, index + offset), (-1, index + offset), colors.HexColor('#EAF2F1')),
                         ('SPAN', (0, index + offset), (-1, index + offset))]
            if index + 1 < len(rows):
                commands.append(('NOSPLIT', (0, index + offset), (-1, index + offset + 1)))
        for index in spans:
            commands.append(('SPAN', (0, index + offset), (-1, index + offset)))
        table.setStyle(TableStyle(commands))
        return table

    def number(self, value, *, ratio=None, bold=False, symbol=False, compact=False, result=False):
        value_text = text(money(value, symbol))
        if result and finite(value) and value < 0:
            value_text = f'<font color="#B24538">{value_text}</font>'
        if bold:
            value_text = '<b>' + value_text + '</b>'
        if ratio is not None:
            label = 'AV ' + percentage(ratio) if compact else percentage(ratio) + ' da receita'
            value_text += f'<br/><font color="{MUTED}" size="6.5">{text(label)}</font>'
        return self.p(value_text, 'monthly_number' if compact else 'number', True)

    def kpis(self, items):
        gap = 10
        cell_width = (WIDTH - gap * (len(items) - 1)) / len(items)
        row, widths = [], []
        for index, (label, value, detail) in enumerate(items):
            if index:
                row.append('')
                widths.append(gap)
            row.append([self.p(label, 'kpi_label'), self.p(value, 'kpi_value'), self.p(detail, 'small')])
            widths.append(cell_width)
        table = Table([row], colWidths=widths, hAlign='LEFT', spaceBefore=7, spaceAfter=14)
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 12),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 12),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]
        for index in range(0, len(row), 2):
            commands += [('BACKGROUND', (index, 0), (index, 0), colors.HexColor(PALE)),
                         ('LINEABOVE', (index, 0), (index, 0), 2, colors.HexColor(TEAL if index != 2 else CORAL))]
        table.setStyle(TableStyle(commands))
        return table

    def insight_cards(self, items):
        gap = 12
        width = (WIDTH - gap) / 2
        for start in range(0, len(items), 2):
            cards = []
            for item in items[start:start + 2]:
                cards.append(Panel(width, [self.p(item['label'].upper(), 'kpi_label'),
                                          self.p(item['value'], 'kpi_value'),
                                          self.p(item['detail'], 'small')],
                                   accent=CORAL if item['tone'] == 'warning' else TEAL, min_height=132))
            heights = [card.wrap(width, 10000)[1] for card in cards]
            for card in cards:
                card.min_height = max(heights)
            row = [cards[0], '', cards[1] if len(cards) > 1 else '']
            table = Table([row], colWidths=[width, gap, width])
            table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
            self.add(table, Spacer(1, gap))

    def guide(self):
        sections = [('Visão geral', 'Os principais números do cenário em destaque.'),
                    ('Leitura executiva', 'Comparação, cobertura e indicadores de gestão.'),
                    ('Comparação entre regimes', 'Resultado, margem e carga de tributos e encargos.')]
        if self.model.period != 'monthly':
            sections += [('DRE comparativa detalhada', 'Contas, deduções e subtotais de cada cenário.'),
                         ('Como o resultado se forma', 'Da receita ao resultado, com a composição das despesas.')]
        if self.model.period != 'annual':
            sections += [('Evolução mês a mês', 'Série por competência, variação e margens.')]
        sections += [('Tributos, encargos e créditos', 'Valores capturados e detalhamento do IRPJ.'),
                     ('Conferência dos créditos', 'Débitos, créditos utilizados e saldos potenciais.'),
                     ('Receitas e compras na origem', 'Composição documental e conciliação com a DRE.')]
        if self.model.period != 'annual':
            sections += [('DRE mensal por regime', 'Anexo de contas por competência e cenário.')]
        sections += [('Premissas, cobertura e conferências', 'Condições, RBT12, DIFAL e referências da versão.'),
                     ('Memória de cálculo', 'Fórmulas, valores e identificação das fontes.')]
        self.title('Guia do relatório', 'Clique em uma seção para navegar. O link SUMÁRIO no rodapé permite voltar a esta página.')
        self.add(Navigation(WIDTH, sections), Spacer(1, 16),
                 self.note('Leitura sugerida: visão geral e leitura executiva para entender os resultados; '
                           'comparativos e DRE para analisar; anexos e memória para conferir os valores.'))

    def executive(self):
        m = self.model
        self.title('Leitura executiva', m.focus['name'] + ' em destaque. Indicadores do período ' + m.period_label + '.')
        self.insight_cards(executive_insights(m))
        self.add(self.p('Competências que compõem o consolidado', 'h2'))
        if m.actual and m.months:
            if m.analysis_period.get('version') == 'JAN_SEP_V1':
                months = [f'{m.months[0][:4]}-{index:02d}' for index in range(1, 10)]
                caption = 'Janela de janeiro a setembro'
            else:
                first = int(m.months[0][:4]) * 12 + int(m.months[0][5:]) - 1
                last = int(m.months[-1][:4]) * 12 + int(m.months[-1][5:]) - 1
                # A historical snapshot need not use the current Jan-Sep window.
                # Keep long, sparse historical ranges bounded without inventing
                # availability for an arbitrarily large calendar.
                months = [f'{value // 12}-{value % 12 + 1:02d}' for value in range(first, last + 1)] if last - first < 24 else list(m.months)
                caption = 'Competências no intervalo' if last - first < 24 else 'Competências registradas'
            self.add(CoverageStrip(WIDTH, [month_label(month, True) for month in months],
                                   [month in m.months for month in months], caption=caption))
        self.add(self.p(m.coverage_note, 'small'))
        self.add(self.p('Como interpretar os indicadores', 'h2'), self.note(
            'Resultado positivo indica lucro; resultado negativo indica prejuízo. A margem relaciona o resultado '
            'à receita do próprio cenário. A diferença entre regimes compara os valores salvos e depende das '
            'premissas e da disponibilidade dos cenários; não representa economia garantida.'),
            Spacer(1, 8), self.p('Os próximos capítulos detalham as contas que explicam esses indicadores.', 'small'))

    def cover(self):
        m = self.model
        captions = {'complete': 'RELATÓRIO COMPLETO', 'annual': 'RELATÓRIO CONSOLIDADO', 'monthly': 'RELATÓRIO MENSAL'}
        heading = self.p('Demonstração<br/>do resultado', 'title', True)
        heading._luna_section = 'Visão geral'
        self.add(Spacer(1, 3), self.p(captions[m.period] + ' / DEMONSTRAÇÃO DO RESULTADO', 'eyebrow'),
                 heading,
                 self.p(m.company.get('name', 'Empresa'), 'h2'))
        self.add(self.p('Código ' + str(m.company.get('code') or 'não informado') +
                        '   |   ' + str(m.snapshot.get('title') or 'Análise gerencial de cenários'), 'small'))
        self.add(self.table(['BASE DOS DOCUMENTOS', 'CENÁRIO TRIBUTÁRIO', 'COBERTURA'],
                            [[m.period_label, str(m.year), m.coverage]], [WIDTH * .43, WIDTH * .27, WIDTH * .30]))
        focus = m.focus
        net = m.value(focus, 'netProfit')
        amount = money(net)
        hero_size = min(27, 260 / max(pdfmetrics.stringWidth(amount, BOLD, 1), 1))
        margin = percentage(m.ratio(focus, 'netProfit'))
        margin_width = (WIDTH - 32) * .35 - 24
        margin_size = min(27, margin_width / max(pdfmetrics.stringWidth(margin, BOLD, 1), 1))
        hero = Table([[[self.p('RESULTADO LÍQUIDO / ' + focus['name'].upper(), 'hero_label'),
                       self.p(f'<font size="{hero_size:.2f}">{text(amount)}</font>', 'hero_value', True),
                       self.p('Resultado indisponível nesta versão' if not finite(net) else
                              'Prejuízo no período' if net < 0 else 'Resultado do período analisado', 'hero_detail')],
                      [self.p('MARGEM LÍQUIDA', 'hero_label'),
                       self.p(f'<font size="{margin_size:.2f}">{text(margin)}</font>', 'hero_value', True),
                       self.p('Resultado / receita do cenário', 'hero_detail')]]],
                     colWidths=[(WIDTH - 32) * .65, (WIDTH - 32) * .35])
        hero.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('LINEBEFORE', (1, 0), (1, 0), .6, colors.HexColor(TEAL)), ('LEFTPADDING', (1, 0), (1, 0), 14)]))
        self.add(Panel(WIDTH, [hero], background=DEEP, accent=CORAL, padding=16), Spacer(1, 8))
        self.add(self.kpis([
            ('RECEITA UTILIZADA', money(m.value(focus, 'revenue')), 'Base do período e regime em destaque.'),
            ('TRIBUTOS E ENCARGOS', money(m.value(focus, 'totalTaxes')), 'Total líquido dos créditos utilizados.'),
        ]))
        self.add(self.p('Resultado em cada cenário', 'h2'), Bars(WIDTH, [
            (regime['name'], m.value(regime, 'netProfit'), COLORS[i]) for i, regime in enumerate(m.regimes)]))
        if m.best:
            same = [row for row in m.available if close(m.value(row, 'netProfit'), m.value(m.best, 'netProfit'))]
            insight = ('Maior resultado capturado: ' + ', '.join(row['name'] for row in same) + '. ' +
                       'A comparação usa as mesmas competências e as premissas desta versão; não confirma enquadramento fiscal.')
        else:
            insight = 'Esta versão não registra um regime vencedor. Consulte a disponibilidade e as condições dos cenários nas próximas páginas.'
        self.add(self.note(insight), Spacer(1, 8))
        self.add(self.p('Emitido em ' + display_date(m.emitted_at) + ' (horário de Brasília). '
                        'Versão salva em ' + display_date(m.snapshot.get('createdAt')) + '.', 'small'))

    def overview(self):
        m = self.model
        self.title('Comparação entre regimes', 'Mesma empresa, mesmas competências e valores salvos. Valores monetários em R$.')
        headers = ['Indicador'] + [row['name'] for row in m.regimes]
        definitions = [('revenue', 'Receita utilizada', False), ('netRevenue', 'Receita após tributos', False),
                       ('grossProfit', 'Lucro bruto', False), ('totalTaxes', 'Tributos e encargos', False),
                       ('netProfit', 'Resultado líquido', False), ('netProfit', 'Margem líquida', True),
                       ('totalTaxes', 'Carga de tributos e encargos', True)]
        rows = [[label] + [self.p(percentage(m.ratio(regime, key)), 'number') if ratio else self.number(m.value(regime, key), bold=key == 'netProfit', result=key == 'netProfit')
                           for regime in m.regimes] for key, label, ratio in definitions]
        self.add(self.table(headers, rows, [157] + [(WIDTH - 157) / len(m.regimes)] * len(m.regimes), highlights=[4]))
        self.add(self.p('Tributos e encargos por cenário', 'h2'),
                 Bars(WIDTH, [(row['name'], m.value(row, 'totalTaxes'), COLORS[i]) for i, row in enumerate(m.regimes)]),
                 self.p('Inclui os encargos da folha capturados no modelo. Os créditos utilizados já estão abatidos dos totais; não devem ser descontados novamente.', 'small'))
        if m.best and len(m.available) > 1:
            high = max(m.available, key=lambda row: m.value(row, 'netProfit'))
            low = min(m.available, key=lambda row: m.value(row, 'netProfit'))
            delta = m.value(high, 'netProfit') - m.value(low, 'netProfit')
            self.add(self.note(f'Diferença entre o maior e o menor resultado disponível: {money(delta)}. '
                              f'Comparação de {high["name"]} com {low["name"]}, no período {m.period_label}.'))
        self.add(self.p('Condições de disponibilidade', 'h2'))
        for regime in m.regimes:
            self.add(self.p(f'{regime["name"]}: ' + str(regime.get('status') or ('Calculado' if regime['available'] else 'Indisponível')), 'small'))

    def statement(self):
        m = self.model
        self.title('DRE comparativa detalhada', 'Demonstrativo consolidado de ' + m.period_label + '. Sinais negativos representam deduções. Valores em R$.')
        self.add(self.p('As linhas de total e subtotal explicam a formação do resultado. Não some novamente os subtotais às contas que os compõem. ' +
                        ('A análise vertical (AV) usa a receita utilizada do respectivo regime como denominador.' if m.show_percent else ''), 'small'))
        rows, highlights, groups = [], [], []
        for section, definitions in m.sections():
            groups.append(len(rows))
            rows.append([self.p('<b>' + text(section) + '</b>', 'cell', True)] + [''] * len(m.regimes))
            for key, label in definitions:
                if key in SUBTOTALS:
                    highlights.append(len(rows))
                rows.append([self.p(('<b>' + text(label) + '</b>') if key in SUBTOTALS else text(label), 'cell', True)] + [
                    self.number(m.value(regime, key), ratio=m.ratio(regime, key) if m.show_percent else None, bold=key in SUBTOTALS, result=key == 'netProfit')
                    for regime in m.regimes])
        self.add(self.table(['Conta / subtotal'] + [row['name'] for row in m.regimes], rows,
                            [177] + [(WIDTH - 177) / len(m.regimes)] * len(m.regimes), highlights=highlights, groups=groups))
        self.add(self.note('n/d significa valor indisponível ou não aplicável nesta versão. Zero é apresentado como 0,00. '
                          'Créditos de CBS e IBS são adicionados uma vez; o crédito de ICMS já está refletido no ICMS líquido. '
                          'Os valores são exibidos com duas casas, preservando a precisão do cálculo salvo.'))

    def formation(self):
        m, regime = self.model, self.model.focus
        self.title('Como o resultado se forma', regime['name'] + ' - ' + m.period_label)
        keys = [('revenue', 'Receita\nutilizada'), ('revenueDeductions', 'Tributos da\nreceita'),
                ('netCosts', 'Compras após\ncréditos'), ('operatingExpenses', 'Despesas\noperacionais'),
                ('incomeTaxes', 'IRPJ e\nCSLL'), ('netProfit', 'Resultado\nlíquido')]
        self.add(Waterfall(WIDTH, [(label, m.value(regime, key)) for key, label in keys]))
        self.add(self.table(['Etapa', 'Impacto no resultado', '% da receita'], [
            [label.replace('\n', ' '), self.number(m.value(regime, key), bold=key == 'netProfit'),
             self.p(percentage(m.ratio(regime, key)), 'number')] for key, label in keys], [WIDTH * .48, WIDTH * .29, WIDTH * .23], highlights=[5], small=True))
        expenses = [('Pessoal e encargos', 'personnel'), ('Outras despesas', 'administrative'),
                    ('Aluguéis', 'rent'), ('Taxas de cartão', 'cards')]
        self.add(KeepTogether([self.p('Composição das despesas operacionais', 'h2'),
                 self.p('Participações calculadas sobre o total de despesas operacionais confirmado. '
                        'Pessoal e encargos agrega salários, benefícios e encargos adicionais.', 'small'),
                 Donut(WIDTH, [(label, -value if finite(value) else None) for label, key in expenses
                              for value in [m.value(regime, key)]], 'Despesas')]))

    def evolution(self):
        m = self.model
        self.title('Evolução mês a mês', m.focus['name'] + ' - valores por competência de origem. Cenário tributário ' + str(m.year) + '.')
        if not m.actual:
            self.add(self.note(m.coverage_note), Spacer(1, 10), self.p('O anexo mensal apresenta somente as parcelas capturadas na projeção salva.'))
            return
        year_months = []
        first = int(m.months[0][:4]) * 12 + int(m.months[0][5:]) - 1
        last = int(m.months[-1][:4]) * 12 + int(m.months[-1][5:]) - 1
        for ordinal in range(first, last + 1):
            year_months.append(f'{ordinal // 12}-{ordinal % 12 + 1:02d}')
        series = []
        for key, label, color in [('revenue', 'Receita utilizada', TEAL), ('netProfit', 'Resultado líquido', CORAL), ('totalTaxes', 'Tributos e encargos', '#8AAEAE')]:
            values = [m.value(m.focus, key, m.months.index(month)) if month in m.months else None for month in year_months]
            series.append((label, values, color))
        self.add(Trend(WIDTH, [month_label(month, True) for month in year_months], series, height=200), Spacer(1, 8))
        rows = []
        for index, month in enumerate(m.months):
            revenue, _, change = m.movement('revenue', index)
            rows.append([month_label(month, True), self.number(revenue), self.p(percentage(change), 'number'),
                         self.number(m.value(m.focus, 'totalTaxes', index)), self.number(m.value(m.focus, 'netProfit', index), result=True),
                         self.p(percentage(m.ratio(m.focus, 'netProfit', index)), 'number')])
        self.add(self.table(['Competência', 'Receita', 'Var. receita', 'Tributos', 'Resultado', 'Margem'], rows,
                            [77, 94, 70, 94, 104, WIDTH - 439], small=True, compact=True))
        self.add(self.note('Variação da receita = (mês atual - mês anterior) / mês anterior. '
                          'O percentual só é apresentado para competências consecutivas, disponíveis e com base anterior positiva. '
                          'A margem usa a receita do próprio mês. Lacunas no gráfico representam dados ausentes, e não valor zero.'))
        self.add(self.p('Leitura do período', 'h2'), self.table(['Indicador', 'Valor', 'Leitura'],
            [[item['label'], self.p(item['value'], 'number'), item['detail']] for item in monthly_insights(m)],
            [122, 100, WIDTH - 222], small=True, compact=True))

    def taxes(self):
        m = self.model
        self.title('Tributos, encargos e créditos', 'Valores do período. Os quadros de crédito explicam os valores já considerados na DRE.')
        keys = [('DAS', 'das', -1), ('CBS - débito', 'cbsDebit', -1), ('IBS - débito', 'ibsDebit', -1),
                ('ICMS líquido', 'icmsNet', -1), ('ISS', 'iss', -1), ('DIFAL sobre vendas', 'difal', -1),
                ('Antecipação de ICMS', 'icmsAnticipation', -1), ('Encargos da folha', 'payroll', -1),
                ('IRPJ e adicional', 'irpj', -1), ('CSLL', 'csll', -1),
                ('(-) Crédito CBS utilizado', 'cbsUsed', -1), ('(-) Crédito IBS utilizado', 'ibsUsed', -1),
                ('Tributos e encargos líquidos', 'totalTaxes', 1)]
        keys = [row for row in keys if row[1] not in ('difal', 'icmsAnticipation') or any(row[1] in regime['dre'] for regime in m.regimes)]
        rows = [[label] + [self.number(value * sign if finite(value) else None, bold=key == 'totalTaxes')
                           for regime in m.regimes for value in [m.value(regime, key)]] for label, key, sign in keys]
        self.add(self.table(['Tributo / encargo'] + [row['name'] for row in m.regimes], rows,
                            [177] + [(WIDTH - 177) / len(m.regimes)] * len(m.regimes), highlights=[len(rows) - 1]))
        self.add(self.note('O total é o mesmo indicador de tributos e encargos capturado no cenário. '
                          'No Simples, tributos incluídos no DAS não são somados separadamente. '
                          'O ICMS desta tabela já é líquido do crédito utilizado.'))
        self.add(self.p('IRPJ normal e adicional', 'h2'))
        memory = {item.get('id'): item for item in m.result.get('memory', [])}
        rows = []
        for regime in m.regimes:
            basic = memory.get(regime['id'] + '.irBasic', {}).get('value')
            additional = memory.get(regime['id'] + '.irAdditional', {}).get('value')
            valid = regime['available'] and regime['id'] in ('presumed', 'actual') and close(total([basic, additional]), -m.value(regime, 'irpj'))
            rows.append([regime['name'], self.number(basic if valid else None), self.number(additional if valid else None)])
        self.add(self.table(['Regime', 'IRPJ normal', 'Adicional'], rows, [WIDTH * .44, WIDTH * .28, WIDTH * .28]),
                 self.p('Quando o IRPJ está incluído no DAS ou a memória da versão não permite conferir as parcelas, o detalhamento é indicado como n/d.', 'small'))
        self.title('Conferência dos créditos', 'Débito - crédito utilizado = valor a recolher. Crédito potencial - utilizado = saldo potencial.')
        for tax in ('cbs', 'ibs', 'icms'):
            self.add(self.p(tax.upper(), 'h2'))
            definitions = [('debit', 'Débito'), ('potential', 'Crédito potencial'), ('used', 'Crédito utilizado'),
                           ('due', 'Valor líquido a recolher'), ('balance', 'Saldo credor potencial')]
            rows = [[label] + [self.number(m.credit(tax, regime, field), bold=field == 'due') for regime in m.regimes] for field, label in definitions]
            self.add(self.table(['Apuração de ' + tax.upper()] + [row['name'] for row in m.regimes], rows,
                                [177] + [(WIDTH - 177) / len(m.regimes)] * len(m.regimes), highlights=[3], small=True))
        self.add(self.note('Os créditos são exibidos somente quando aplicáveis ao regime e conciliados com a versão salva. '
                          'Saldo credor potencial é informativo: não aumenta o lucro nem representa restituição automática. '
                          'Créditos de ICMS de compras e devoluções são componentes do potencial, e não deduções adicionais.'))
        icms = m.result.get('credits', {}).get('icms', {})
        purchase = memory.get('icms.purchaseCredit', {}).get('value')
        returns = memory.get('icms.returnCredit', {}).get('value')
        if close(total([purchase, returns]), icms.get('potential')) and any(m.credit('icms', regime, 'potential') is not None for regime in m.regimes):
            self.add(self.p(f'Origem do crédito potencial de ICMS: compras elegíveis {money(purchase)}; '
                            f'devoluções de venda {money(returns)}. Total potencial {money(icms.get("potential"))}.', 'small'))

    def commercial(self):
        m = self.model
        data = m.commercial()
        self.title('Receitas e compras na origem', 'Composição dos documentos que sustentam a análise, antes de ajustes manuais do cenário.')
        if not data:
            self.add(self.note('Esta versão não contém composição documental completa e conciliada para o período. '
                              'A DRE e a memória preservam os valores capturados; não foi estimado um perfil de clientes ou fornecedores.'))
            return
        revenue, purchases = data['revenue'], data['purchases']
        used = m.value(m.focus, 'revenue')
        adjustment = used - revenue['totalCents'] / 100 if finite(used) else None
        self.add(self.table(['Fechamento da receita', 'Valor'], [
            ['Receita bruta dos documentos', self.number(revenue['grossCents'] / 100)],
            ['(-) Devoluções de venda já abatidas', self.number(-revenue['returnsCents'] / 100)],
            ['Receita após devoluções', self.number(revenue['totalCents'] / 100)],
            ['Ajustes do cenário (+/-)', self.number(adjustment)],
            ['Receita utilizada na DRE', self.number(used, bold=True)]], [WIDTH * .65, WIDTH * .35], highlights=[4]))
        self.add(self.p('Perfil da receita', 'h2'), Donut(WIDTH, [
            (GROUP_LABELS.get(row['key'], row['key']), row['totalCents'] / 100) for row in revenue['byCustomerType']], 'Receita líquida'))
        self.add(self.p('Receita e compras por enquadramento', 'h2'))
        sales = {row['key']: row['totalCents'] / 100 for row in revenue['byTaxStatus']}
        buys = {row['key']: row['totalCents'] / 100 for row in purchases['byTaxStatus']}
        keys = list(dict.fromkeys([*sales, *buys]))
        rows = [[GROUP_LABELS.get(key, key), self.number(sales.get(key)),
                 self.p(percentage(sales[key] * 100 / revenue['totalCents']) if key in sales and revenue['totalCents'] > 0 else 'n/d', 'number'),
                 self.number(buys.get(key)),
                 self.p(percentage(buys[key] * 100 / purchases['totalCents']) if key in buys and purchases['totalCents'] > 0 else 'n/d', 'number')] for key in keys]
        self.add(self.table(['Grupo', 'Receita', '% receita', 'Compras', '% compras'], rows, [151, 113, 63, 113, WIDTH - 440]))
        self.add(self.p('Denominadores: receita documental após devoluções (' + money(revenue['totalCents'] / 100) +
                        ') e compras selecionadas (' + money(purchases['totalCents'] / 100) + '). '
                        'Os ajustes manuais permanecem na DRE e não são redistribuídos entre os grupos documentais.', 'small'))

    def monthly_statements(self):
        m = self.model
        self.title('DRE mensal por regime', 'Valores em R$. A coluna total consolida todos os meses da versão, inclusive os apresentados nos outros quadros do regime.')
        if not m.months:
            self.add(self.note('O calendário mensal não está capturado nesta versão. O demonstrativo consolidado permanece disponível. '
                              'Nenhum valor mensal foi estimado para este arquivo.'))
            return
        if m.show_percent:
            self.add(self.p('AV = análise vertical: cada percentual usa a receita da mesma competência e do mesmo regime. A coluna total usa a receita consolidada.', 'small'))
        import math
        chunks = math.ceil(len(m.months) / 4)
        chunk_size = math.ceil(len(m.months) / chunks)
        for regime_index, regime in enumerate(m.regimes):
            for start in range(0, len(m.months), chunk_size):
                indices = list(range(start, min(start + chunk_size, len(m.months))))
                if regime_index or start:
                    self.add(PageBreak())
                context = regime['name'] + ' / ' + ', '.join(month_label(m.months[index], True) for index in indices)
                marker = Spacer(1, 1)
                marker._luna_running = 'DRE mensal / ' + context
                self.add(marker)
                rows, highlights = [], []
                # Account rows remain continuous; the derived group subtotals are
                # shown in the consolidated chapter and do not consume repeats.
                for _, definitions in m.sections():
                    for key, label in definitions:
                        if key in DERIVED:
                            continue
                        if key in SUBTOTALS:
                            highlights.append(len(rows))
                        rows.append([self.p(('<b>' + text(label) + '</b>') if key in SUBTOTALS else text(label), 'tiny', True)] +
                                    [self.number(m.value(regime, key, index), ratio=m.ratio(regime, key, index) if m.show_percent else None,
                                                 bold=key == 'netProfit', compact=True, result=key == 'netProfit') for index in indices] +
                                    [self.number(m.value(regime, key), ratio=m.ratio(regime, key) if m.show_percent else None, bold=key == 'netProfit', compact=True, result=key == 'netProfit')])
                columns = len(indices) + 1
                self.add(self.table(['Conta'] + [month_label(m.months[index], True) for index in indices] + ['Total do período'], rows,
                                    [165] + [(WIDTH - 165) / columns] * columns, highlights=highlights,
                                    small=True, compact='monthly', repeat_context=context))
                if not regime['available']:
                    self.add(self.p('Consolidado indisponível: ' + str(regime.get('status') or 'Há competências pendentes.') +
                                    ' Meses individualmente disponíveis permanecem apresentados.', 'small'))

    def premises(self):
        m = self.model
        self.title('Premissas, cobertura e conferências', 'Condições e referências capturadas na versão que deu origem a este relatório.')
        self.add(self.note(m.coverage_note), Spacer(1, 9))
        if m.snapshot.get('rbt12Source'):
            labels = {'MANUAL': 'Informada manualmente e confirmada no cenário', 'NOT_REQUIRED': 'Não exigida pelos regimes selecionados',
                      'SIMPLES_SECTION_22': 'Extrato do Simples, seção 2.2', 'SIMPLES_PDF': 'PDF do Simples, leitura histórica'}
            self.add(self.p('Referência de RBT12: ' + labels.get(m.snapshot['rbt12Source'], str(m.snapshot['rbt12Source'])) + '.', 'body'))
        schedule = m.snapshot.get('rbt12Schedule') or m.result.get('rbt12Schedule') or m.calendar.get('rbt12Schedule')
        if isinstance(schedule, dict) and isinstance(schedule.get('rows'), list):
            self.add(self.table(['Competência', 'RBT12 anterior ao mês', 'Condição'], [
                [month_label(row.get('sourceMonth'), True), self.number(row['rbt12Cents'] / 100 if row.get('status') == 'CONFIRMED' and type(row.get('rbt12Cents')) is int else None),
                 'Confirmada' if row.get('status') == 'CONFIRMED' else 'Há meses ausentes'] for row in schedule['rows']], [125, 160, WIDTH - 285]))
        for warning in m.warnings():
            self.add(self.p(warning, 'small'))
        applications = [(regime, regime.get('difalApplication')) for regime in m.regimes if isinstance(regime.get('difalApplication'), dict)]
        if applications:
            self.add(self.p('Aplicação do DIFAL por cenário', 'h2'))
            for regime, application in applications:
                groups = {}
                for row in application.get('months') or []:
                    groups.setdefault(str(row.get('message') or row.get('reason') or 'Sem descrição'), []).append(row.get('sourceMonth') or '')
                detail = ' '.join(', '.join(months) + ': ' + message for message, months in groups.items())
                self.add(self.p(regime['name'] + ': ' + (detail or str(application.get('message') or 'Condição preservada na memória de cálculo.')), 'small'))
        sources = m.snapshot.get('taxSources') or []
        if sources:
            self.add(self.p('Referências da versão salva', 'h2'))
            for source in sources:
                self.add(self.p(str(source.get('label') or 'Referência') + ' - ' + str(source.get('url') or ''), 'small'))

    def memory(self):
        m = self.model
        entries = list(m.memory())
        self.title('Memória de cálculo', f'{len(entries)} itens da versão salva. As fórmulas e unidades mantêm o escopo registrado no cálculo.')
        self.add(self.p('Este anexo documenta os valores e as fórmulas capturados. A emissão do PDF não aplica novas alíquotas e não recalcula os cenários. '
                        'As tabelas mensais anteriores detalham os resultados por competência; esta memória é a referência consolidada registrada pelo motor.', 'small'))
        groups = {}
        for entry in entries:
            groups.setdefault(str(entry.get('section') or 'Memória'), []).append(entry)
        rows, group_rows, wide_rows = [], [], []
        for section, items in groups.items():
            group_rows.append(len(rows))
            rows.append([self.p('<b>' + text(section) + '</b>', 'cell', True), ''])
            for entry in items:
                value, unit = entry.get('value'), entry.get('unit')
                value_text = money(value) if unit == 'currency' else percentage(value, 4) if unit == 'percent' else decimal_text(value, 4) if finite(value) else str(value if value is not None else 'n/d')
                label = '<b>' + text(entry.get('label') or entry.get('id') or 'Item') + '</b>'
                if entry.get('formula'):
                    label += '<br/><font color="' + MUTED + '">' + text(entry['formula']) + '</font>'
                if not finite(value) and len(value_text) > 70:
                    wide_rows.append(len(rows))
                    label += '<br/><font color="' + TEAL + '"><b>Condição: </b>' + text(value_text) + '</font>'
                    rows.append([self.p(label, 'cell', True), ''])
                else:
                    rows.append([self.p(label, 'cell', True), self.p(value_text, 'cell')])
        self.add(self.table(['Memória / fórmula capturada', 'Valor / condição'], rows,
                            [WIDTH * .71, WIDTH * .29], groups=group_rows, spans=wide_rows, small=True))
        self.add(self.p('Identificação e rastreabilidade', 'h2'))
        source = m.snapshot.get('source') or {}
        metadata = [
            ('Empresa / código', str(m.company.get('name') or '') + ' / ' + str(m.company.get('code') or 'não informado')),
            ('Versão da análise', m.snapshot['_id']), ('Modelo de cálculo', m.snapshot.get('modelVersion') or m.result.get('version')),
            ('Criada em', display_date(m.snapshot.get('createdAt'))), ('Emitida em', display_date(m.emitted_at)),
            ('Cenário / base', str(m.year) + ' / ' + m.period_label), ('Gerador do relatório', 'MaximumCNPJ ' + VERSION + ' / Python'),
        ]
        for key, label in (('sales', 'Relatório de vendas'), ('purchases', 'Relatório de compras')):
            if isinstance(source.get(key), dict):
                record = source[key]
                metadata.append((label, str(record.get('fileName') or 'Arquivo de origem') + ' / ' + str(record.get('jobId') or 'ID não informado')))
        self.add(self.table(['Referência', 'Registro'], [[key, value] for key, value in metadata], [155, WIDTH - 155], small=True))

    def page(self, c, doc):
        c.saveState()
        c.drawImage(letterhead(), 0, 0, width=PAGE_W, height=PAGE_H)
        draw_text(c, 'DRE | ANÁLISE GERENCIAL', PAGE_W - MARGIN, PAGE_H - 30, 8.5, '#FFFFFF', bold=True, align='right')
        draw_text(c, 'Cenário ' + str(self.model.year) + ' / ' + self.model.period_label,
                  PAGE_W - MARGIN, PAGE_H - 44, 7, '#E1F0EF', align='right', max_width=330)
        if doc.page > 1:
            running_label(c, 'Código ' + str(self.model.company.get('code') or 'não informado'), MARGIN, PAGE_H - 76, WIDTH * .25)
        c.setStrokeColor(colors.HexColor(LINE))
        c.setLineWidth(.6)
        c.line(MARGIN, 42, PAGE_W - MARGIN, 42)
        draw_text(c, 'Luna. / DRE gerencial / Versão salva', MARGIN, 25, 7, MUTED)
        c.restoreState()

    def render(self):
        self.cover()
        self.guide()
        self.executive()
        self.overview()
        if self.model.period != 'monthly':
            self.statement()
            self.formation()
        if self.model.period != 'annual':
            self.evolution()
        self.taxes()
        self.commercial()
        if self.model.period != 'annual':
            self.monthly_statements()
        self.premises()
        self.memory()
        output = io.BytesIO()
        doc = ReportDocument(output, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                              topMargin=84, bottomMargin=52, title='DRE completa - ' + str(self.model.company.get('name') or 'Empresa'),
                              author='Maximum Contábil', subject='DRE gerencial e comparativo de cenários salvos',
                              pageCompression=1, allowSplitting=1)
        doc.addPageTemplates(PageTemplate(id='LunaDRE', frames=[Frame(MARGIN, 52, WIDTH, PAGE_H - 136,
                                   leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.page))
        doc.build(self.story, canvasmaker=NumberedCanvas)
        return output.getvalue()


def render_dre_pdf(meta):
    return Report(meta).render()
