"""Two fixed pages, using only the authorized and reconciled saved snapshot."""
from __future__ import annotations

import io
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from .dre_charts import FONT, BOLD
from .dre_model import SUBTOTALS, PERCENT_ROWS, money, percentage, finite

PAGE_W, PAGE_H = A4
LEFT, RIGHT, BOTTOM = 34, PAGE_W - 34, 52
WIDTH = RIGHT - LEFT
BURGUNDY, INK, MUTED = '#750207', '#24272C', '#62666D'


def render_final_pdf(model, letterhead):
    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=A4, pageCompression=1)
    pdf.setTitle('Simulador Reforma Tributária - ' + str(model.company.get('name') or 'Empresa'))
    pdf.setAuthor('Maximum Contábil')
    regimes = model.regimes
    label_width = 205 if len(regimes) == 4 else 220
    column_width = (WIDTH - label_width) / len(regimes)

    def paragraph(value, x, top, width, size=8, bold=False, color=INK, align=0):
        style = ParagraphStyle('final', fontName=BOLD if bold else FONT, fontSize=size,
                               leading=size * 1.22, textColor=colors.HexColor(color), alignment=align)
        item = Paragraph(escape(str(value)), style)
        _, height = item.wrap(width, PAGE_H)
        item.drawOn(pdf, x, top - height)
        return height

    def header(page, section):
        pdf.drawImage(letterhead, 0, 0, width=PAGE_W, height=PAGE_H)
        paragraph('SIMULADOR REFORMA TRIBUTÁRIA', LEFT, PAGE_H - 74, WIDTH, 17, True, BURGUNDY)
        top = PAGE_H - 103
        top -= paragraph(model.company.get('name') or 'Empresa', LEFT, top, WIDTH, 10.5, True) + 5
        identity = ' · '.join(value for value in [
            'Código ' + str(model.company['code']) if model.company.get('code') else '',
            'CNPJ ' + str(model.company['cnpj']) if model.company.get('cnpj') else '',
            'Cenário ' + str(model.year)] if value)
        top -= paragraph(identity, LEFT, top, WIDTH, 7.5, color=MUTED) + 4
        top -= paragraph(model.period_label + ' · ' + model.coverage, LEFT, top, WIDTH, 7.5, color=MUTED) + 12
        top -= paragraph(section, LEFT, top, WIDTH, 12, True, BURGUNDY) + 9
        pdf.setStrokeColor(colors.HexColor('#E2D9DA'))
        pdf.line(LEFT, 42, RIGHT, 42)
        paragraph('Maximum Contábil · Simulação gerencial · Valores em R$', LEFT, 31, WIDTH - 45, 6.8, color=MUTED)
        paragraph(f'{page} / 2', RIGHT - 35, 31, 35, 7.5, True, BURGUNDY, 2)
        return top

    def table(top, definitions, *, taxes=False, summary=False, body_height=None):
        # Measure every label. The table never paginates and never clips rows.
        header_height = 30
        rows = []
        for key, label in definitions:
            style = ParagraphStyle('measure', fontName=BOLD if key in SUBTOTALS else FONT,
                                   fontSize=7.5, leading=9.2)
            _, height = Paragraph(escape(label), style).wrap(label_width - 14, PAGE_H)
            rows.append((key, label, max(15, height + 5), 7 if taxes and key == 'grossAfterCosts' else 0))
        total_height = header_height + sum(height + gap for _, _, height, gap in rows)
        # Long company names and unusual values stay inside their assigned page.
        scale = min(1, body_height / total_height) if body_height else 1
        if scale < .74:
            raise ValueError('Identificação extensa demais para o relatório de duas páginas. Revise o cadastro da empresa.')
        pdf.saveState()
        pdf.translate(LEFT, top)
        pdf.scale(1, scale)
        pdf.setFillColor(colors.HexColor('#343D4A' if summary else BURGUNDY))
        pdf.rect(0, -header_height, WIDTH, header_height, stroke=0, fill=1)
        paragraph('Impostos e indicadores' if taxes else 'Resumo por regime' if summary else 'Valores em R$', 8, -7, label_width - 16, 8, True, '#FFFFFF')
        for index, regime in enumerate(regimes):
            paragraph(regime['name'], label_width + index * column_width + 5, -5,
                      column_width - 10, 7.5, True, '#FFFFFF', 2)
        cursor = -header_height
        for index, (key, label, height, gap) in enumerate(rows):
            cursor -= gap
            subtotal = key in SUBTOTALS
            background = '#175348' if key == 'netProfit' else '#F2E8E9' if subtotal else '#F7F8FA' if index % 2 == 0 else '#FFFFFF'
            pdf.setFillColor(colors.HexColor(background))
            pdf.rect(0, cursor - height, WIDTH, height, stroke=0, fill=1)
            color = '#FFFFFF' if key == 'netProfit' else INK
            paragraph(label, 8 if subtotal else 14, cursor - 3, label_width - 22, 7.5, subtotal, color)
            for number, regime in enumerate(regimes):
                value = model.tax_value(regime, key) if taxes else model.value(regime, key)
                displayed = '—' if not finite(value) else percentage(value, 2) if key in PERCENT_ROWS else money(value, False)
                if key == 'netProfit' and (not finite(value) or value < 0):
                    pdf.setFillColor(colors.HexColor('#59616E' if not finite(value) else '#842C40'))
                    pdf.rect(label_width + number * column_width, cursor - height, column_width, height, stroke=0, fill=1)
                amount_color = color if key == 'netProfit' else '#A12434' if finite(value) and value < 0 else INK
                font = BOLD if subtotal else FONT
                size = min(7.7, (column_width - 12) / max(stringWidth(displayed, font, 1), 1))
                pdf.setFont(font, size)
                pdf.setFillColor(colors.HexColor(amount_color))
                pdf.drawRightString(label_width + (number + 1) * column_width - 6, cursor - (height + size) / 2 + 1, displayed)
            cursor -= height
        pdf.restoreState()
        return top - total_height * scale

    definitions = [row for _, rows in model.sections() for row in rows]
    by_key = dict(definitions)
    summary = [(key, by_key.get(key, label)) for key, label in [
        ('revenue', 'Receita bruta'), ('services', 'Receitas de serviços'), ('sales', 'Receita de vendas'),
        ('revenueTaxes', 'Deduções da receita'), ('netRevenueAfterTaxes', 'Receita líquida'),
        ('costsWithAnticipation', 'Custo de mercadoria'), ('grossAfterCosts', 'Lucro bruto (Margem de contribuição)'),
        ('operatingExpensesWithPayroll', 'Despesas operacionais'), ('ebitda', 'Resultado operacional (EBITDA)'),
        ('financialResult', 'Despesas/Receitas financeiras'), ('resultBeforeIncomeTaxes', 'Antes do IRPJ / CSLL'),
        ('totalTaxes', 'Total de impostos'), ('netProfit', 'Resultado líquido'), ('netMargin', 'Resultado líquido (%)')]]
    pdf.bookmarkPage('summary')
    pdf.addOutlineEntry('Impostos e Resumo', 'summary', 0)
    top = header(1, 'Impostos e indicadores')
    # Reserve space for both tables and their explanatory notes on this page.
    top = table(top, model.tax_rows(), taxes=True, body_height=top - BOTTOM - 325) - 12
    top -= paragraph('Resumo dos resultados', LEFT, top, WIDTH, 11, True, BURGUNDY) + 7
    top = table(top, summary, summary=True, body_height=top - BOTTOM - 54)
    notes = ('D = Débito; C = Crédito. Tributos líquidos dos créditos utilizados. '
             'Percentuais sobre a receita bruta de serviços e vendas; sem receita positiva, '
             'não se aplica. — indica valor indisponível.')
    note_top = top - 7
    note_height = paragraph(notes, LEFT, note_top, WIDTH, 6.8, color=MUTED)
    pending = []
    for regime in regimes:
        if regime.get('available') is True:
            continue
        status = regime.get('status') or 'Cálculo pendente.'
        reason = status if len(status) <= 100 else 'Cálculo pendente. Confira os motivos por competência na análise.'
        pending.append(regime['name'] + ': ' + reason)
    if pending:
        paragraph(' | '.join(pending), LEFT, note_top - note_height - 4, WIDTH, 6.3, color=BURGUNDY)
    pdf.showPage()
    pdf.bookmarkPage('dre')
    pdf.addOutlineEntry('DRE - Consolidado', 'dre', 0)
    top = header(2, 'Demonstração do Resultado · DRE - Consolidado')
    top = table(top, definitions, body_height=top - BOTTOM - 64)
    paragraph('Receita bruta = serviços + vendas utilizados no cenário, com devoluções já tratadas na origem. '
              'Deduções negativas e créditos utilizados positivos. Resultado financeiro = receitas menos despesas financeiras. '
              'INSS / FGTS usa os encargos capturados, sem discriminar cada parcela. IRPJ e CSLL são finais. — indica indisponível.', LEFT, top - 10, WIDTH, 6.8, color=MUTED)
    pdf.showPage()
    pdf.save()
    return stream.getvalue()
