"""Purchase and sales reports from reconciled, immutable financial snapshots only."""
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
SALES_MODE = 'SALES_V1'
FINANCIAL_MODES = (PURCHASES_MODE, SALES_MODE)
GROUP_LABELS = {
    'OPTANTE': 'Optantes pelo Simples',
    'NAO_OPTANTE': 'Não optantes',
    'NAO_CONFIRMADO': 'CNPJs não confirmados',
    'NAO_CONSULTAVEL': 'CPF / documento não consultável',
}
MAX_SAFE_INTEGER = 9_007_199_254_740_991
COMPONENT_FIELDS = ('grossCents', 'discountCents', 'accessoryCents', 'freightCents', 'abatementCents')
COMPONENT_LABELS = ('Q - Valor bruto', 'Y - Desconto', 'Z - Despesa acessória', 'AA - Frete', 'AB - Abatimento', 'Novo total')
MANAGEMENT_NOTE = ('Somente optantes confirmados integram Simples. Os demais documentos integram Não optante '
                   'no agrupamento gerencial solicitado; a situação original da fonte permanece preservada.')
SALES_MANAGEMENT_NOTE = ('Somente CNPJs optantes confirmados integram Optantes SN. CPFs ficam em um grupo próprio. '
                         'Os demais documentos e os CNPJs não confirmados integram Não optantes SN; '
                         'a situação original da fonte permanece preservada.')


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


def reporting_percentages(values):
    """Apportion hundredths of one percent; exact ties follow the reporting group order."""
    denominator = sum(values)
    if not denominator:
        return [0 for _ in values]
    quotients = [divmod(value * 10000, denominator) for value in values]
    basis_points = [quotient for quotient, _ in quotients]
    remaining = 10000 - sum(basis_points)
    order = sorted(range(len(values)), key=lambda index: (-quotients[index][1], index))
    for index in order[:remaining]:
        basis_points[index] += 1
    return [value / 100 for value in basis_points]


def signed_percentage(value, denominator):
    """Exact half-up rounding for signed balances, matching the Node report."""
    numerator, base = _signed_integer(value) * 10000, _signed_integer(denominator)
    if not base:
        return 0
    rounded = (abs(numerator) * 2 + abs(base)) // (abs(base) * 2)
    return (-rounded if (numerator < 0) != (base < 0) else rounded) / 100


def signed_reporting_percentages(values, denominator):
    """Signed largest remainders preserve empty groups and reconcile exactly to 100%."""
    values, denominator = [_signed_integer(value) for value in values], _signed_integer(denominator)
    _check(bool(values) and sum(values) == denominator)
    if not denominator:
        return [0 for _ in values]
    direction = -1 if denominator < 0 else 1
    quotients = [divmod(value * 10000 * direction, abs(denominator)) for value in values]
    basis_points = [quotient for quotient, _ in quotients]
    remaining = 10000 - sum(basis_points)
    order = sorted(range(len(values)), key=lambda index: (-quotients[index][1], index))
    for index in order[:remaining]:
        basis_points[index] += 1
    return [value / 100 for value in basis_points]


def _check(condition):
    require(condition, 409, 'RESULT_COUNT',
            'Linhas, CNPJs ou valores divergentes do snapshot. Emissão bloqueada para conferência.')


def _signed_integer(value, maximum=MAX_SAFE_INTEGER):
    _check(isinstance(value, (int, float)) and not isinstance(value, bool) and
           (not isinstance(value, float) or math.isfinite(value) and value.is_integer()) and
           -min(maximum, MAX_SAFE_INTEGER) <= value <= min(maximum, MAX_SAFE_INTEGER))
    return int(value)


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
    _check(job.get('workspaceId') == workspace and job.get('mode') in FINANCIAL_MODES)
    sales = job['mode'] == SALES_MODE
    label, partner_kind = ('vendas', 'CLIENTE') if sales else ('compras', 'FORNECEDOR')
    require(job.get('status') == 'COMPLETED', 409, 'INCOMPLETE', f'Conclua a consulta de {label} para emitir o relatório.')
    _check(isinstance(job.get('clientId'), str) and bool(job['clientId']))
    version = job.get('calculationVersion', 'Q_V1')
    _check(version in ('Q_V1', 'NET_V2') and (not sales or version == 'NET_V2'))
    summary, financial = job.get('summary') or {}, job.get('purchaseInput') or {}
    components = {key: 0 for key in (*COMPONENT_FIELDS, 'totalCents')} if version == 'NET_V2' else None
    expected = _integer(job.get('expectedRows'), 50_000)
    _check(expected > 0 and _integer(job.get('uploaded')) == expected)
    for key in ('lines', 'unique', 'invalid', 'duplicates'):
        _integer(summary.get(key))
    _integer(financial.get('totalCents'))
    _integer(financial.get('cnpjCents'))

    by_cnpj, indexes, non_cnpj_documents, cpf_documents = {}, set(), set(), set()
    total_raw_cents = total_cents = non_cnpj_cents = excluded_lines = cpf_cents = cpf_lines = 0
    operation_totals = {key: {'operation': key, 'lines': 0, 'totalCents': 0, 'balanceCents': 0} for key in ('VENDA','SERVICO','DEVOLUCAO','OUTRAS')}
    quantity = Decimal(0)
    # v0.8.0 dropped the redundant partner kind when copying financial lines.
    # Its server-owned SALES_V1 job still identifies buyers; explicit mismatches
    # and missing kinds in newer snapshots remain invalid.
    legacy_line_kind = partner_kind if not sales or job.get('version') == '0.8.0' else None
    for row in lines:
        _check(row.get('workspaceId') == workspace and row.get('jobId') == job['_id'])
        _check(row.get('kind', legacy_line_kind) == partner_kind)
        index = _integer(row.get('index'), expected - 1)
        _check(index not in indexes)
        indexes.add(index)
        _check(type(row.get('valid')) is bool)
        document = row.get('document')
        _check(isinstance(document, str) and len(document) <= 40)
        _check(row.get('documentKind') == _document_kind(document))
        valid = _valid_cnpj(document)
        _check(row['valid'] == valid and row.get('cnpj') == (document if valid else ''))
        raw_cents = _integer(row.get('totalCents'), 100_000_000_000)
        operation = row.get('operation') if sales else None
        if sales:
            operation = operation if operation in operation_totals else 'OUTRAS'
            balance_cents = _signed_integer(row.get('balanceCents', -raw_cents if operation == 'DEVOLUCAO' else raw_cents), 100_000_000_000)
            _check(balance_cents == (-raw_cents if operation == 'DEVOLUCAO' else raw_cents))
            operation_totals[operation]['lines'] += 1
            operation_totals[operation]['totalCents'] = _integer(operation_totals[operation]['totalCents'] + raw_cents)
            operation_totals[operation]['balanceCents'] = _signed_integer(operation_totals[operation]['balanceCents'] + balance_cents)
        else:
            balance_cents = raw_cents
        cents = raw_cents
        if components is not None:
            values = {key: _integer(row.get(key), 100_000_000_000) for key in COMPONENT_FIELDS}
            _check(values['grossCents'] - values['discountCents'] + values['freightCents'] - values['abatementCents'] == cents)
            for key, value in {**values, 'totalCents': cents}.items():
                components[key] = _integer(components[key] + value)
        qty = row.get('quantity')
        _check(isinstance(qty, str) and re.fullmatch(r'\d{1,9}(?:\.\d{1,6})?', qty))
        quantity += Decimal(qty)
        total_raw_cents = _integer(total_raw_cents + raw_cents)
        total_cents = _signed_integer(total_cents + balance_cents) if sales else _integer(total_cents + balance_cents)
        if valid:
            supplier = by_cnpj.setdefault(document, {'lines': 0, 'totalCents': 0, 'balanceCents': 0})
            supplier['lines'] += 1
            supplier['totalCents'] = _integer(supplier['totalCents'] + raw_cents)
            supplier['balanceCents'] = _signed_integer(supplier['balanceCents'] + balance_cents) if sales else _integer(supplier['balanceCents'] + balance_cents)
        else:
            excluded_lines += 1
            non_cnpj_cents = _signed_integer(non_cnpj_cents + balance_cents) if sales else _integer(non_cnpj_cents + balance_cents)
            non_cnpj_documents.add((row['documentKind'], document) if document else ('AUSENTE', index))
            if row['documentKind'] == 'CPF':
                cpf_documents.add(document)
                cpf_lines += 1
                cpf_cents = _signed_integer(cpf_cents + balance_cents) if sales else _integer(cpf_cents + balance_cents)
    line_count, unique = len(indexes), len(by_cnpj)
    raw_cnpj_cents = _integer(sum(supplier['totalCents'] for supplier in by_cnpj.values()))
    cnpj_cents = total_cents - non_cnpj_cents
    _check(line_count == expected == summary['lines'] and unique == summary['unique'] and
           excluded_lines == summary['invalid'] and line_count - excluded_lines - unique == summary['duplicates'] and
           total_raw_cents == financial['totalCents'] and raw_cnpj_cents == financial['cnpjCents'])
    if sales and 'balanceCents' in financial:
        _check(_signed_integer(financial.get('balanceCents')) == total_cents)
    if components is not None:
        stored_components = financial.get('components')
        _check(isinstance(stored_components, dict))
        for key, value in components.items():
            _check(_integer(stored_components.get(key)) == value)
    groups = {status: {'status': status, 'label': label, 'suppliers': 0, 'lines': 0, 'totalCents': 0}
              for status, label in GROUP_LABELS.items()}
    seen, checks = set(), []
    for item in items:
        cnpj = item.get('cnpj')
        _check(item.get('workspaceId') == workspace and item.get('jobId') == job['_id'] and
               item.get('clientId') == job['clientId'] and cnpj in by_cnpj and cnpj not in seen)
        _check(item.get('kind', None if sales else partner_kind) == partner_kind)
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
        group['totalCents'] += supplier['balanceCents'] if sales else supplier['totalCents']
    _check(len(seen) == unique)
    groups['NAO_CONSULTAVEL'].update(lines=excluded_lines, totalCents=non_cnpj_cents)
    for group in groups.values():
        group['supplierPercent'] = percentage(group['suppliers'], unique)
        group['valuePercent'] = (signed_percentage(group['totalCents'], cnpj_cents) if sales else percentage(group['totalCents'], cnpj_cents)) if group['status'] != 'NAO_CONSULTAVEL' else None
        group['fileValuePercent'] = signed_percentage(group['totalCents'], total_cents) if sales else percentage(group['totalCents'], total_cents)
    unknown = dict(groups['NAO_CONFIRMADO'])
    unique_documents = unique + len(non_cnpj_documents)
    optant = groups['OPTANTE']
    optant_count_basis_points = (optant['suppliers'] * 20_000 + unique_documents) // (unique_documents * 2) if unique_documents else 0
    optant_value_basis_points = (optant['totalCents'] * 20_000 + total_cents) // (total_cents * 2) if total_cents else 0
    reporting_groups = [
        {'status': 'OPTANTE', 'count': optant['suppliers'], 'lines': optant['lines'], 'totalCents': optant['totalCents'],
         'countPercent': optant_count_basis_points / 100, 'valuePercent': optant_value_basis_points / 100,
         'unconfirmedCount': 0, 'unconfirmedCents': 0, 'nonCnpjCount': 0, 'nonCnpjCents': 0},
        {'status': 'NAO_OPTANTE', 'count': unique_documents - optant['suppliers'],
         'lines': line_count - optant['lines'], 'totalCents': total_cents - optant['totalCents'],
         'countPercent': (10000 - optant_count_basis_points) / 100 if unique_documents else 0,
         'valuePercent': (10000 - optant_value_basis_points) / 100 if total_cents else 0,
         'unconfirmedCount': unknown['suppliers'], 'unconfirmedCents': unknown['totalCents'],
         'nonCnpjCount': len(non_cnpj_documents), 'nonCnpjCents': non_cnpj_cents},
    ]
    if sales:
        nonoptant = reporting_groups[1]
        nonoptant.update(count=nonoptant['count'] - len(cpf_documents), lines=nonoptant['lines'] - cpf_lines,
                         totalCents=nonoptant['totalCents'] - cpf_cents,
                         nonCnpjCount=nonoptant['nonCnpjCount'] - len(cpf_documents),
                         nonCnpjCents=nonoptant['nonCnpjCents'] - cpf_cents)
        reporting_groups.append({'status': 'CPF', 'count': len(cpf_documents), 'lines': cpf_lines, 'totalCents': cpf_cents,
                                 'unconfirmedCount': 0, 'unconfirmedCents': 0,
                                 'nonCnpjCount': len(cpf_documents), 'nonCnpjCents': cpf_cents})
        for group, value in zip(reporting_groups, reporting_percentages([group['count'] for group in reporting_groups])):
            group['countPercent'] = value
        values = signed_reporting_percentages([group['totalCents'] for group in reporting_groups], total_cents)
        for group, value in zip(reporting_groups, values):
            group['valuePercent'] = value
    labels = {'OPTANTE': 'Optantes SN', 'NAO_OPTANTE': 'Não optantes SN', 'CPF': 'CPFs'} if sales else {
        'OPTANTE': 'Simples', 'NAO_OPTANTE': 'Não optante'}
    managerial_groups = [{**group, 'label': labels[group['status']],
                          'suppliers': group['count'], 'supplierPercent': group['countPercent'],
                          'fileValuePercent': group['valuePercent']} for group in reporting_groups]
    quantity_text = format(quantity, 'f').rstrip('0').rstrip('.') if '.' in format(quantity, 'f') else format(quantity, 'f')
    return {'job': {key: job.get(key) for key in ('_id', 'mode', 'clientId', 'clientCode', 'clientName', 'fileName', 'completedAt', 'reportPeriod')},
            'reportType': 'SALES' if sales else 'PURCHASES',
            'totalCents': total_cents, 'cnpjCents': cnpj_cents, 'nonCnpjCents': non_cnpj_cents,
            'lineCount': line_count, 'uniqueSuppliers': unique, 'groups': list(groups.values()),
            'uniqueDocuments': unique_documents, 'nonCnpjDocumentCount': len(non_cnpj_documents),
            'cpfCents': cpf_cents, 'cpfDocumentCount': len(cpf_documents), 'cpfLineCount': cpf_lines,
            'reportingGroups': reporting_groups, 'managerialGroups': managerial_groups,
            'unconfirmed': unknown, 'components': components, 'operationTotals': list(operation_totals.values()) if sales else [], 'calculationVersion': version,
            'quantityDisplay': quantity_text.replace('.', ','), 'generatedAt': utcnow(),
            'firstCheck': min(checks) if checks else None, 'lastCheck': max(checks) if checks else None}


def purchase_metadata(db, job, workspace):
    """Read only the selected job and join states by workspace, exact identity and state ID."""
    query = {'workspaceId': workspace, 'jobId': job['_id']}
    lines = db.purchaseLines.find(query, {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'index': 1, 'document': 1,
                                        'documentKind': 1, 'cnpj': 1, 'quantity': 1, 'operation': 1, 'balanceCents': 1, 'totalCents': 1, 'valid': 1, 'kind': 1,
                                        **{key: 1 for key in COMPONENT_FIELDS}})
    lines = lines.limit(50_001).batch_size(500).max_time_ms(20000)
    items = db.lookupItems.aggregate([
        {'$match': query},
        {'$lookup': {'from': 'cnpjStates', 'let': {'ref': '$stateId', 'identity': '$cnpj'},
                     'pipeline': [{'$match': {'workspaceId': workspace, '$expr': {'$and': [
                         {'$eq': ['$_id', '$$ref']}, {'$eq': ['$cnpj', '$$identity']}]}}},
                                  {'$project': {'_id': 0, 'status': 1}}], 'as': 'sourceState'}},
        {'$project': {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'clientId': 1, 'cnpj': 1, 'state': 1,
                      'stateId': 1, 'status': 1, 'occurrences': 1, 'totalCents': 1, 'checkedAt': 1, 'sourceState': 1, 'kind': 1}}
    ], maxTimeMS=20000)
    return reconcile_purchase_snapshot(job, lines, items, workspace)


def money(cents):
    """Format integer cents without conversion to floating point, including returns."""
    sign = '-' if cents < 0 else ''
    value = abs(cents)
    return f'{sign}R$ {number(value // 100)},{value % 100:02d}'


def purchase_pdf_styles():
    font, bold = _fonts()
    ink, primary, muted = [colors.HexColor(c) for c in ('#222222', '#750207', '#666666')]
    return {
        'body': ParagraphStyle('purchase-body', fontName=font, fontSize=8.3, leading=11, textColor=ink, spaceAfter=5),
        'small': ParagraphStyle('purchase-small', fontName=font, fontSize=7.5, leading=10, textColor=muted, spaceAfter=4),
        'title': ParagraphStyle('purchase-title', fontName=bold, fontSize=17, leading=21, textColor=ink, spaceAfter=7, keepWithNext=True),
        'heading': ParagraphStyle('purchase-heading', fontName=bold, fontSize=10, leading=13, textColor=primary, spaceAfter=6, keepWithNext=True),
        'cell': ParagraphStyle('purchase-cell', fontName=font, fontSize=7.6, leading=10, textColor=ink, splitLongWords=True),
        'head': ParagraphStyle('purchase-head', fontName=bold, fontSize=7.6, leading=10, textColor=colors.white),
    }


def purchase_paragraph(value, styles, style='body'):
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value if value is not None else '-'))
    return Paragraph(escape(value).replace('\n', '<br/>'), styles[style])


def purchase_table(rows, fractions, width, styles, total_row=False, padding=7):
    table = LongTable([[purchase_paragraph(v, styles, 'head' if i == 0 else 'cell') for v in row]
                       for i, row in enumerate(rows)],
                      colWidths=[width * x for x in fractions], repeatRows=1, hAlign='LEFT')
    settings = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#750207')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F3F3')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), padding), ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
    ]
    if total_row:
        settings.extend([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#EAD5D6')),
                         ('LINEBELOW', (0, -1), (-1, -1), .3, colors.HexColor('#B2797B'))])
    table.setStyle(TableStyle(settings))
    return table


def purchase_story(meta, width, styles):
    """The same reconciled per-company memory is used in single and consolidated PDFs."""
    job = meta['job']
    sales = job.get('mode') == SALES_MODE
    report_label, partner = ('Vendas', 'comprador') if sales else ('Compras', 'fornecedor')
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    title = f'{job.get("clientCode") or "Sem código"} - {job.get("clientName") or "Empresa"}'
    calculation_label = 'atual' if meta['calculationVersion'] == 'NET_V2' else 'anterior'
    period = job.get('reportPeriod') or {}
    period_text = (f'Período pela coluna H: {period.get("startDate")} a {period.get("endDate")} · '
                   f'{period.get("months")} {"mês" if period.get("months") == 1 else "meses"}') if period else 'Período fiscal: snapshot anterior sem coluna H persistida'
    story = [p(f'{report_label} - enquadramento e memória de cálculo', 'heading'), p(title, 'title'),
             p(f'Arquivo: {job.get("fileName") or "Não informado"}'), p(period_text, 'small'),
             p(f'Consulta: {job["_id"]} | Conclusão: {display_date(job.get("completedAt"))} | '
               f'Emissão: {display_date(meta["generatedAt"])}', 'small'),
             p(f'Total: {money(meta["totalCents"])} | {number(meta["lineCount"])} linhas | '
               f'{number(meta["uniqueDocuments"])} documentos na base | Cálculo {calculation_label}', 'heading')]
    rows = [['Grupo gerencial', 'Documentos', '% dos documentos', 'Linhas', f'Valor de {report_label.lower()}', '% do valor total']]
    for group in meta['managerialGroups']:
        rows.append([group['label'], number(group['count']), percent(group['countPercent']), number(group['lines']),
                     money(group['totalCents']), percent(group['valuePercent'])])
    rows.append(['TOTAL', number(meta['uniqueDocuments']), percent(100 if meta['uniqueDocuments'] else 0),
                 number(meta['lineCount']), money(meta['totalCents']), percent(100 if meta['totalCents'] else 0)])
    story += [purchase_table(rows, (.24, .12, .16, .08, .24, .16), width, styles, True), Spacer(1, 6)]
    if sales and meta.get('operationTotals'):
        operation_labels = {'VENDA':'Vendas','SERVICO':'Serviços','DEVOLUCAO':'Devoluções','OUTRAS':'Outras'}
        operation_rows = [['Operação','Linhas','Valor antes do sinal','Impacto no saldo']]
        for item in meta['operationTotals']:
            operation_rows.append([operation_labels.get(item['operation'], item['operation']), number(item['lines']), money(item['totalCents']), money(item['balanceCents'])])
        story += [p('Vendas, serviços, devoluções e outras', 'heading'), purchase_table(operation_rows, (.32,.12,.28,.28), width, styles), Spacer(1, 6)]
    unknown = meta['unconfirmed']
    if sales:
        story.append(p(f'Já incluídos em Não optantes SN: não confirmados na fonte = {number(unknown["suppliers"])} CNPJs '
                       f'e {money(unknown["totalCents"])}; outros documentos não consultáveis = '
                       f'{number(meta["nonCnpjDocumentCount"] - meta["cpfDocumentCount"])} documentos e '
                       f'{money(meta["nonCnpjCents"] - meta["cpfCents"])}. CPFs em grupo separado = '
                       f'{number(meta["cpfDocumentCount"])} documentos e {money(meta["cpfCents"])}. '
                       f'{SALES_MANAGEMENT_NOTE}', 'small'))
    else:
        story.append(p(f'Já incluídos em Não optante: não confirmados na fonte = {number(unknown["suppliers"])} CNPJs '
                       f'e {money(unknown["totalCents"])}; CPF e demais documentos não consultáveis = '
                       f'{number(meta["nonCnpjDocumentCount"])} documentos e {money(meta["nonCnpjCents"])}. {MANAGEMENT_NOTE}', 'small'))
    story += [Spacer(1, 3), p('Memória dos valores importados', 'heading')]
    if meta['components'] is not None:
        values = meta['components']
        memory = [list(COMPONENT_LABELS), [money(values[key]) for key in (*COMPONENT_FIELDS, 'totalCents')]]
        story += [purchase_table(memory, (.17, .16, .18, .16, .16, .17), width, styles), Spacer(1, 5),
                  p(f'Q - Y + AA - AB = {money(values["grossCents"])} - {money(values["discountCents"])} + '
                    f'{money(values["freightCents"])} - {money(values["abatementCents"])} = {money(values["totalCents"])}. '
                    'Z é apenas informativa e não entra na fórmula.', 'small')]
    else:
        story += [p(f'Regra anterior: total = soma da coluna Q = {money(meta["totalCents"])}. '
                    'Os ajustes Y, Z, AA e AB não foram armazenados neste lote. Reimporte o arquivo em uma nova consulta '
                    'para aplicar Q - Y + AA - AB; este histórico mantém o cálculo original.', 'small')]
    story += [
        p(f'Bases dos percentuais: {number(meta["uniqueDocuments"])} documentos e '
          f'{money(meta["totalCents"])} do arquivo completo, incluindo CPF e demais documentos. '
          f'Cada {partner} conta uma vez por documento; todas as suas linhas compõem o valor. '
          'Cada linha sem documento conta separadamente. Base de valor zero resulta em 0,00%.' +
          (' Percentuais distribuídos em centésimos pelo maior resto para totalizar 100,00%.' if sales else ''), 'small'),
        p(('Valores somados por linha. A = CNPJ comprador; I = comprador; ' if sales else
           f'Valores somados por linha, sem multiplicar por P. Quantidade P total: {meta["quantityDisplay"]}. '
           'A = CNPJ fornecedor; I = razão social; P = quantidade; ') + 'Q = valor bruto; Y = desconto; '
          'Z = despesa acessória; AA = frete; AB = abatimento não tributado.', 'small'),
        p(f'Fonte: Minha Receita. Chamadas de {display_date(meta.get("firstCheck"))} a {display_date(meta.get("lastCheck"))}. '
          f'A observação salva não comprova o regime na data da {"venda" if sales else "compra"} nem a atualização fiscal da base. '
          'Referência fiscal não informada. Este PDF lê o snapshot reconciliado e não faz nova consulta.', 'small'),
    ]
    return story


def purchase_page_callback(footer):
    font, bold = _fonts()
    page_width, page_height = landscape(A4)
    def on_page(canvas, document):
        canvas.saveState()
        draw_brand_header(canvas, page_width, page_height, font=font, bold_font=bold)
        canvas.setFillColor(colors.HexColor('#666666'))
        canvas.setStrokeColor(colors.HexColor('#EAD5D6'))
        canvas.line(32, 32, page_width - 32, 32)
        canvas.setFont(font, 7)
        canvas.drawString(32, 20, f'{footer} | v{VERSION}')
        canvas.drawRightString(page_width - 32, 20, f'Página {document.page} | Horários de Brasília')
        canvas.restoreState()
    return on_page


def render_purchase_pdf(meta):
    stream = BytesIO()
    label = 'Vendas' if meta['job'].get('mode') == SALES_MODE else 'Compras'
    doc = SimpleDocTemplate(stream, pagesize=landscape(A4), rightMargin=32, leftMargin=32,
                            topMargin=86, bottomMargin=40,
                            title=f'Maximum CNPJ - Relatório de {label.lower()}', author='Maximum CNPJ', pageCompression=1)
    story = purchase_story(meta, landscape(A4)[0] - 64, purchase_pdf_styles())
    on_page = purchase_page_callback(f'{label} {meta["job"]["_id"]}')
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return stream.getvalue()
