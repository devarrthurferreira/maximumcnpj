"""Financial purchase reports from reconciled, immutable database snapshots only."""
from __future__ import annotations

from html import escape
from io import BytesIO
from decimal import Decimal
from datetime import datetime
from pathlib import Path
from functools import lru_cache
import math
import re

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from .brand import draw_brand_header
from .core import VERSION, display_date, number, percent, require, utcnow

PURCHASES_MODE = 'PURCHASES_V1'
GROUP_LABELS = {
    'OPTANTE': 'Optantes pelo Simples',
    'NAO_OPTANTE': 'Não optantes',
    'NAO_CONFIRMADO': 'CNPJs não confirmados',
    'NAO_CONSULTAVEL': 'CPF / documento não consultável',
}
MAX_SAFE_INTEGER = 9_007_199_254_740_991


@lru_cache(maxsize=1)
def _fonts():
    # These font files ship with the pinned ReportLab wheel, including on Vercel.
    # Embedding removes dependence on a viewer's substitutions for Base-14 fonts.
    font_dir = Path(reportlab.__file__).resolve().parent / 'fonts'
    pdfmetrics.registerFont(TTFont('MaximumPurchase', str(font_dir / 'Vera.ttf')))
    pdfmetrics.registerFont(TTFont('MaximumPurchase-Bold', str(font_dir / 'VeraBd.ttf')))
    return 'MaximumPurchase', 'MaximumPurchase-Bold'


def percentage(value, denominator):
    """Exact half-up rounding, matching the Node financial report even at .005 ties."""
    return ((value * 20_000 + denominator) // (denominator * 2)) / 100 if denominator else 0


def _check(condition):
    require(condition, 409, 'RESULT_COUNT',
            'Linhas, fornecedores ou valores divergentes do snapshot. Emissão bloqueada para conferência.')


def _integer(value, maximum=MAX_SAFE_INTEGER):
    # The Node MongoDB driver writes large JavaScript Numbers as BSON doubles.
    # Accept their exact integral values, then keep every calculation in Python ints.
    _check(isinstance(value, (int, float)) and not isinstance(value, bool) and
           (not isinstance(value, float) or math.isfinite(value) and value.is_integer()) and
           0 <= value <= min(maximum, MAX_SAFE_INTEGER))
    return int(value)


def _valid_cnpj(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{12}[0-9]{2}', value):
        return False
    if re.fullmatch(r'(\d)\1{13}', value) or value.startswith('000000000000'):
        return False
    def digit(text, weights):
        remainder = sum((ord(char) - 48) * weight for char, weight in zip(text, weights)) % 11
        return str(0 if remainder < 2 else 11 - remainder)
    first = digit(value[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return value[12:] == first + digit(value[:12] + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])


def _document_kind(document):
    if not document:
        return 'AUSENTE'
    if re.fullmatch(r'\d{11}', document):
        return 'CPF'
    if re.fullmatch(r'\d{12}', document):
        return 'CNO_OU_OUTRO'
    return 'CNPJ' if _valid_cnpj(document) else 'INVALIDO'


def reconcile_purchase_snapshot(job, lines, items, workspace):
    """Pure reconciliation also exercised by synthetic tests; never trusts cached UI totals."""
    _check(job.get('workspaceId') == workspace and job.get('mode') == PURCHASES_MODE)
    require(job.get('status') == 'COMPLETED', 409, 'INCOMPLETE', 'Conclua a consulta de compras para emitir o relatório.')
    _check(isinstance(job.get('clientId'), str) and bool(job['clientId']))
    summary, financial = job.get('summary') or {}, job.get('purchaseInput') or {}
    expected = _integer(job.get('expectedRows'), 50_000)
    _check(expected > 0 and _integer(job.get('uploaded')) == expected)
    for key in ('lines', 'unique', 'invalid', 'duplicates'):
        _integer(summary.get(key))
    _integer(financial.get('totalCents'))
    _integer(financial.get('cnpjCents'))

    by_cnpj, indexes = {}, set()
    total_cents = non_cnpj_cents = excluded_lines = 0
    quantity = Decimal(0)
    for row in lines:
        _check(row.get('workspaceId') == workspace and row.get('jobId') == job['_id'])
        index = _integer(row.get('index'), expected - 1)
        _check(index not in indexes)
        indexes.add(index)
        _check(type(row.get('valid')) is bool)
        document = row.get('document')
        _check(isinstance(document, str) and len(document) <= 40)
        _check(row.get('documentKind') == _document_kind(document))
        valid = _valid_cnpj(document)
        _check(row['valid'] == valid and row.get('cnpj') == (document if valid else ''))
        cents = _integer(row.get('totalCents'), 100_000_000_000)
        qty = row.get('quantity')
        _check(isinstance(qty, str) and re.fullmatch(r'\d{1,9}(?:\.\d{1,6})?', qty))
        quantity += Decimal(qty)
        total_cents = _integer(total_cents + cents)
        if valid:
            supplier = by_cnpj.setdefault(document, {'lines': 0, 'totalCents': 0})
            supplier['lines'] += 1
            supplier['totalCents'] = _integer(supplier['totalCents'] + cents)
        else:
            excluded_lines += 1
            non_cnpj_cents = _integer(non_cnpj_cents + cents)
    line_count, unique = len(indexes), len(by_cnpj)
    cnpj_cents = total_cents - non_cnpj_cents
    _check(line_count == expected == summary['lines'] and unique == summary['unique'] and
           excluded_lines == summary['invalid'] and line_count - excluded_lines - unique == summary['duplicates'] and
           total_cents == financial['totalCents'] and cnpj_cents == financial['cnpjCents'])
    groups = {status: {'status': status, 'label': label, 'suppliers': 0, 'lines': 0, 'totalCents': 0}
              for status, label in GROUP_LABELS.items()}
    seen, checks = set(), []
    for item in items:
        cnpj = item.get('cnpj')
        _check(item.get('workspaceId') == workspace and item.get('jobId') == job['_id'] and
               item.get('clientId') == job['clientId'] and cnpj in by_cnpj and cnpj not in seen)
        seen.add(cnpj)
        supplier = by_cnpj[cnpj]
        _check(item.get('state') == 'DONE' and item.get('status') in tuple(GROUP_LABELS)[:3] and
               _integer(item.get('occurrences')) == supplier['lines'] and
               _integer(item.get('totalCents')) == supplier['totalCents'])
        source = item.get('sourceState') or []
        if item.get('stateId'):
            _check(len(source) == 1 and source[0].get('status') == item['status'])
        else:
            _check(item['status'] == 'NAO_CONFIRMADO')
        checked_at = item.get('checkedAt')
        _check(isinstance(checked_at, datetime))
        checks.append(checked_at)
        group = groups[item['status']]
        group['suppliers'] += 1
        group['lines'] += supplier['lines']
        group['totalCents'] += supplier['totalCents']
    _check(len(seen) == unique)
    groups['NAO_CONSULTAVEL'].update(lines=excluded_lines, totalCents=non_cnpj_cents)
    for group in groups.values():
        group['supplierPercent'] = percentage(group['suppliers'], unique)
        group['valuePercent'] = percentage(group['totalCents'], cnpj_cents) if group['status'] != 'NAO_CONSULTAVEL' else None
        group['fileValuePercent'] = percentage(group['totalCents'], total_cents)
    quantity_text = format(quantity, 'f').rstrip('0').rstrip('.') if '.' in format(quantity, 'f') else format(quantity, 'f')
    return {'job': {key: job.get(key) for key in ('_id', 'clientId', 'clientCode', 'clientName', 'fileName', 'completedAt')},
            'totalCents': total_cents, 'cnpjCents': cnpj_cents, 'nonCnpjCents': non_cnpj_cents,
            'lineCount': line_count, 'uniqueSuppliers': unique, 'groups': list(groups.values()),
            'quantityDisplay': quantity_text.replace('.', ','), 'generatedAt': utcnow(),
            'firstCheck': min(checks) if checks else None, 'lastCheck': max(checks) if checks else None}


def purchase_metadata(db, job, workspace):
    """Read only the selected job and join states by workspace, exact identity and state ID."""
    query = {'workspaceId': workspace, 'jobId': job['_id']}
    lines = db.purchaseLines.find(query, {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'index': 1, 'document': 1,
                                        'documentKind': 1, 'cnpj': 1, 'quantity': 1, 'totalCents': 1, 'valid': 1})
    lines = lines.limit(50_001).batch_size(500).max_time_ms(20000)
    items = db.lookupItems.aggregate([
        {'$match': query},
        {'$lookup': {'from': 'cnpjStates', 'let': {'ref': '$stateId', 'identity': '$cnpj'},
                     'pipeline': [{'$match': {'workspaceId': workspace, '$expr': {'$and': [
                         {'$eq': ['$_id', '$$ref']}, {'$eq': ['$cnpj', '$$identity']}]}}},
                                  {'$project': {'_id': 0, 'status': 1}}], 'as': 'sourceState'}},
        {'$project': {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'clientId': 1, 'cnpj': 1, 'state': 1,
                      'stateId': 1, 'status': 1, 'occurrences': 1, 'totalCents': 1, 'checkedAt': 1, 'sourceState': 1}}
    ], maxTimeMS=20000)
    return reconcile_purchase_snapshot(job, lines, items, workspace)


def money(cents):
    """Format integer cents without conversion to floating point."""
    return f'R$ {number(cents // 100)},{cents % 100:02d}'


def render_purchase_pdf(meta):
    job = meta['job']
    font, bold = _fonts()
    stream = BytesIO()
    page_width, page_height = landscape(A4)
    width = page_width - 64
    doc = SimpleDocTemplate(stream, pagesize=landscape(A4), rightMargin=32, leftMargin=32,
                            topMargin=86, bottomMargin=40,
                            title='Maximum CNPJ - Relatório de compras',
                            author='Maximum CNPJ', pageCompression=1)
    ink, primary, muted, light = [colors.HexColor(c) for c in ('#222222', '#750207', '#666666', '#F7F3F3')]
    styles = {
        'body': ParagraphStyle('purchase-body', fontName=font, fontSize=9, leading=12, textColor=ink, spaceAfter=6),
        'small': ParagraphStyle('purchase-small', fontName=font, fontSize=8, leading=10.5, textColor=muted, spaceAfter=5),
        'title': ParagraphStyle('purchase-title', fontName=bold, fontSize=20, leading=24, textColor=ink, spaceAfter=8),
        'heading': ParagraphStyle('purchase-heading', fontName=bold, fontSize=11, leading=14, textColor=primary, spaceAfter=7),
        'cell': ParagraphStyle('purchase-cell', fontName=font, fontSize=8, leading=10.5, textColor=ink, splitLongWords=True),
        'head': ParagraphStyle('purchase-head', fontName=bold, fontSize=8, leading=10.5, textColor=colors.white),
    }

    def p(value, style='body'):
        value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value if value is not None else '-'))
        return Paragraph(escape(value).replace('\n', '<br/>'), styles[style])

    def on_page(canvas, document):
        canvas.saveState()
        draw_brand_header(canvas, page_width, page_height, font=font, bold_font=bold)
        canvas.setFillColor(muted)
        canvas.setStrokeColor(colors.HexColor('#EAD5D6'))
        canvas.line(32, 32, page_width - 32, 32)
        canvas.setFont(font, 7)
        canvas.drawString(32, 20, f'Compras {job["_id"]} | v{VERSION}')
        canvas.drawRightString(page_width - 32, 20, f'Página {document.page} | Horários de Brasília')
        canvas.restoreState()

    title = f'{job.get("clientCode") or "Sem código"} - {job.get("clientName") or "Empresa"}'
    story = [p('Relatório de compras por enquadramento', 'heading'), p(title, 'title'),
             p(f'Arquivo: {job.get("fileName") or "Não informado"}'),
             p(f'Consulta concluída: {display_date(job.get("completedAt"))} | Emissão: {display_date(meta["generatedAt"])}', 'small'),
             Spacer(1, 5),
             p(f'Total de compras: {money(meta["totalCents"])} | {number(meta["lineCount"])} linhas | '
               f'{number(meta["uniqueSuppliers"])} CNPJs únicos consultáveis', 'heading')]
    rows = [['Enquadramento', 'CNPJs únicos', '% dos CNPJs', 'Linhas', 'Valor de compras', '% valor CNPJs', '% valor arquivo']]
    for group in meta['groups']:
        consultable = group['status'] != 'NAO_CONSULTAVEL'
        rows.append([group['label'], number(group['suppliers']) if consultable else 'Fora da base',
                     percent(group['supplierPercent']) if consultable else '-', number(group['lines']),
                     money(group['totalCents']), percent(group['valuePercent']) if consultable else '-', percent(group['fileValuePercent'])])
    rows.append(['TOTAL', number(meta['uniqueSuppliers']), percent(100 if meta['uniqueSuppliers'] else 0),
                 number(meta['lineCount']), money(meta['totalCents']), '-', percent(100 if meta['totalCents'] else 0)])
    table = LongTable([[p(v, 'head' if i == 0 else 'cell') for v in row] for i, row in enumerate(rows)],
                      colWidths=[width * x for x in (.25, .10, .115, .07, .19, .14, .135)], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), primary),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light]),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#EAD5D6')),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBELOW', (0, -1), (-1, -1), .3, colors.HexColor('#B2797B')),
    ]))
    story += [table, Spacer(1, 12), p('Como ler os percentuais e valores', 'heading'),
              p(f'% dos CNPJs: base de {number(meta["uniqueSuppliers"])} CNPJs válidos distintos, incluindo os não confirmados. '
                'O mesmo fornecedor conta uma vez; todas as suas linhas de compra integram o valor.', 'small'),
              p(f'% valor CNPJs: base de {money(meta["cnpjCents"])} (Q somente dos CNPJs válidos, incluindo não confirmados). '
                f'% valor arquivo: base de {money(meta["totalCents"])} (Q de todas as linhas). '
                'CPF e outros documentos não consultáveis ficam separados e seus valores permanecem no total. '
                'Quando a base é zero, o percentual é apresentado como 0,00%.', 'small'),
              p('Colunas utilizadas: A - CNPJ fornecedor; I - razão social; P - quantidade; Q - valor total informado. '
                'O valor da coluna Q é somado uma vez por linha, sem multiplicar pela quantidade P. '
                'Não é possível identificar notas repetidas sem uma chave de nota no arquivo.', 'small'),
              p('Origem e rastreabilidade', 'heading'),
              p(f'Chamadas da consulta: {display_date(meta.get("firstCheck"))} até {display_date(meta.get("lastCheck"))}. '
                f'Quantidade informada na coluna P (soma): {meta["quantityDisplay"]}.', 'small'),
              p('As classificações são observações salvas da API Minha Receita no momento das chamadas. '
                'Não comprovam o regime na data das compras, nem a atualização fiscal da base. '
                'Erros, ausência de resposta e campos desconhecidos ficam como não confirmados; nunca como não optante. '
                'A emissão deste PDF não faz nova consulta. Referência fiscal da base: não informada.', 'small'),
              p('Resumo integral da empresa e consulta identificadas acima. Os valores são reconciliados com as linhas '
                'salvas do relatório; nenhum resultado enviado pelo navegador é aceito como fonte.', 'small')]
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return stream.getvalue()
