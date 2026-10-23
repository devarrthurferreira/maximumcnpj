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
from .difal_policy import report_difal_policy, direction_selection
from .revenue import RevenueEvidence, report_revenue_reconciliation, unavailable_revenue
from .core import VERSION, display_date, number, percent, require, utcnow, snapshot_source
from .difal import DIFAL_VERSION, DIFAL_VERSIONS, DIFAL_RATE_PERCENT, PENDING_REASONS, normalize_uf, calculate_difal, sales_operation
from .operation_catalog import OPERATION_CATALOG_VERSION, classify_operation_nature, normalize_operation_nature
from .tax_documents import is_canonical_cnpj as _valid_cnpj
from .anticipation import (ANTICIPATION_VERSION, ANTICIPATION_VERSIONS, ANTICIPATION_RATE_PERCENT,
                           ANTICIPATION_PENDING_REASONS, calculate_anticipation)

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
NATURE_LABELS = {
    'COMPRAS': 'Compras', 'VENDA': 'Vendas',
    'DEVOLUCAO_VENDA': 'Devoluções de venda', 'DEVOLUCAO_COMPRA': 'Devoluções de compra',
    'OUTRAS': 'Outras operações', 'SERVICO_COMPRA': 'Serviços de compra (8000)',
    'SERVICO_VENDA': 'Vendas de serviços (9000)', 'NAO_CLASSIFICADA': 'Não classificada',
}
PURCHASE_SELECTION_VERSION = 'PURCHASE_NATURES_V1'


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


def _document_kind(document):
    if not document:
        return 'AUSENTE'
    if re.fullmatch(r'\d{11}', document):
        return 'CPF'
    if re.fullmatch(r'\d{12}', document):
        return 'CNO_OU_OUTRO'
    return 'CNPJ' if _valid_cnpj(document) else 'INVALIDO'


def select_purchase_snapshot(rows, statuses, calculation_version):
    """Select purchases after raw reconciliation, without altering the frozen source."""
    nature_totals, selected_documents = {}, {}
    report_total = selected_total = selected_lines = 0
    complete = True
    components = {key: 0 for key in (*COMPONENT_FIELDS, 'totalCents')} if calculation_version == 'NET_V2' else None
    for row in rows:
        total = _integer(row['totalCents'])
        report_total = _integer(report_total + total)
        nature = row.get('natureCode')
        present = isinstance(nature, str) and re.fullmatch(r'[0-9]{4}', nature) is not None
        complete = complete and present
        code = nature if present else ''
        operation = classify_operation_nature(nature)
        eligible = present and operation in ('COMPRAS', 'SERVICO_COMPRA')
        reason = operation if present else 'MISSING_NATURE'
        audit = nature_totals.setdefault(code, {'natureCode': code, 'operation': operation,
            'eligible': bool(eligible) if present else None, 'reason': reason, 'lines': 0, 'totalCents': 0,
            'consideredCents': 0 if present else None, 'excludedCents': 0 if present else None})
        audit['lines'] += 1
        audit['totalCents'] = _integer(audit['totalCents'] + total)
        if present:
            audit['consideredCents' if eligible else 'excludedCents'] = _integer(
                audit['consideredCents' if eligible else 'excludedCents'] + total)
        if not eligible:
            continue
        selected_total = _integer(selected_total + total)
        selected_lines += 1
        if components is not None:
            for key in components:
                components[key] = _integer(components[key] + row[key])
        identity = ('CNPJ', row['cnpj']) if row['valid'] else (
            (row['documentKind'], row['document']) if row['document'] else ('AUSENTE', row['index']))
        document = selected_documents.setdefault(identity, {'valid': row['valid'], 'cnpj': row['cnpj'],
            'documentKind': row['documentKind'], 'lines': 0, 'totalCents': 0})
        document['lines'] += 1
        document['totalCents'] = _integer(document['totalCents'] + total)
    base = {'version': PURCHASE_SELECTION_VERSION, 'catalogVersion': OPERATION_CATALOG_VERSION,
            'available': bool(complete), 'origin': 'DERIVED_FROM_SNAPSHOT' if complete else 'UNAVAILABLE',
            'reason': 'CLASSIFIED' if complete else 'MISSING_NATURE',
            'reportTotalCents': report_total, 'reportLines': len(rows),
            'natureTotals': [nature_totals[code] for code in sorted(nature_totals)]}
    if not complete:
        return {**base, **{key: None for key in ('excludedTotalCents', 'excludedLines', 'totals',
                                               'components', 'groups', 'reportingGroups', 'excluded')}}
    groups = {status: {'status': status, 'count': 0, 'lines': 0, 'totalCents': 0,
                      'countPercent': 0, 'valuePercent': 0}
              for status in ('OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO')}
    excluded_by_kind = {}
    cnpj_lines = cnpj_cents = unique_cnpjs = 0
    for document in selected_documents.values():
        if document['valid']:
            status = statuses.get(document['cnpj'])
            _check(status in groups)
            group = groups[status]
            unique_cnpjs += 1
            cnpj_lines += document['lines']
            cnpj_cents = _integer(cnpj_cents + document['totalCents'])
        else:
            kind = document['documentKind']
            group = excluded_by_kind.setdefault(kind, {'documentKind': kind, 'count': 0,
                                                       'lines': 0, 'totalCents': 0})
        group['count'] += 1
        group['lines'] += document['lines']
        group['totalCents'] = _integer(group['totalCents'] + document['totalCents'])
    unique_documents = len(selected_documents)
    non_cnpj_documents, non_cnpj_cents = unique_documents - unique_cnpjs, selected_total - cnpj_cents
    for group in groups.values():
        group['countPercent'] = percentage(group['count'], unique_cnpjs)
        group['valuePercent'] = percentage(group['totalCents'], cnpj_cents)
    optant, other, unknown = (groups[status] for status in ('OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'))
    count_bp = (optant['count'] * 20_000 + unique_documents) // (unique_documents * 2) if unique_documents else 0
    value_bp = (optant['totalCents'] * 20_000 + selected_total) // (selected_total * 2) if selected_total else 0
    reporting_groups = [
        {**optant, 'countPercent': count_bp / 100, 'valuePercent': value_bp / 100,
         'unconfirmedCount': 0, 'unconfirmedCents': 0, 'nonCnpjCount': 0, 'nonCnpjCents': 0},
        {'status': 'NAO_OPTANTE', 'count': other['count'] + unknown['count'] + non_cnpj_documents,
         'lines': selected_lines - optant['lines'], 'totalCents': selected_total - optant['totalCents'],
         'countPercent': (10000 - count_bp) / 100 if unique_documents else 0,
         'valuePercent': (10000 - value_bp) / 100 if selected_total else 0,
         'unconfirmedCount': unknown['count'], 'unconfirmedCents': unknown['totalCents'],
         'nonCnpjCount': non_cnpj_documents, 'nonCnpjCents': non_cnpj_cents},
    ]
    return {**base, 'excludedTotalCents': report_total - selected_total, 'excludedLines': len(rows) - selected_lines,
            'totals': {'lines': selected_lines, 'uniqueCnpjs': unique_cnpjs, 'uniqueDocuments': unique_documents,
                'nonCnpjDocumentCount': non_cnpj_documents, 'cnpjLines': cnpj_lines,
                'nonCnpjLines': selected_lines - cnpj_lines, 'totalCents': selected_total,
                'cnpjCents': cnpj_cents, 'nonCnpjCents': non_cnpj_cents},
            'components': components, 'groups': list(groups.values()), 'reportingGroups': reporting_groups,
            'excluded': list(excluded_by_kind.values())}


def reconcile_purchase_snapshot(job, lines, items, workspace):
    """Pure reconciliation also exercised by synthetic tests; never trusts cached UI totals."""
    _check(job.get('workspaceId') == workspace and job.get('mode') in FINANCIAL_MODES)
    sales = job['mode'] == SALES_MODE
    label, partner_kind = ('vendas', 'CLIENTE') if sales else ('compras', 'FORNECEDOR')
    require(job.get('status') == 'COMPLETED', 409, 'INCOMPLETE', f'Conclua a consulta de {label} para emitir o relatório.')
    _check(isinstance(job.get('clientId'), str) and bool(job['clientId']))
    version = job.get('calculationVersion', 'Q_V1')
    _check(version in ('Q_V1', 'NET_V2') and (not sales or version == 'NET_V2'))
    operation_version = job.get('operationVersion')
    _check(operation_version is None or operation_version == OPERATION_CATALOG_VERSION)
    summary, financial = job.get('summary') or {}, job.get('purchaseInput') or {}
    difal = None
    anticipation = None
    if sales and 'difalVersion' in job:
        _check(job['difalVersion'] in DIFAL_VERSIONS)
        issuer_uf = job.get('issuerUf')
        _check(isinstance(issuer_uf, str) and issuer_uf == normalize_uf(issuer_uf))
        difal = {'version': job['difalVersion'], 'ratePercent': DIFAL_RATE_PERCENT, 'issuerUf': issuer_uf,
                 'eligibleLines': 0, 'baseCents': 0, 'amountCents': 0, 'pendingLines': 0}
    if not sales and 'anticipationVersion' in job:
        _check(job['anticipationVersion'] in ANTICIPATION_VERSIONS)
        issuer_uf = job.get('issuerUf')
        _check(isinstance(issuer_uf, str) and issuer_uf == normalize_uf(issuer_uf))
        anticipation = {'version': job['anticipationVersion'], 'ratePercent': ANTICIPATION_RATE_PERCENT,
                        'issuerUf': issuer_uf, 'eligibleLines': 0, 'baseCents': 0, 'amountCents': 0, 'pendingLines': 0}
    # Older NET_V2 imports may already contain the required frozen operation
    # fields. Derive a read-only estimate only when every row has those fields;
    # an absent field makes the whole estimate unavailable, never a partial zero.
    issuer_metadata_valid = ('issuerUf' not in job or
        isinstance(job['issuerUf'], str) and job['issuerUf'] == normalize_uf(job['issuerUf']))
    if operation_version is not None:
        _check(issuer_metadata_valid)
    derive_difal = sales and job.get('difalVersion') != DIFAL_VERSION and version == 'NET_V2' and issuer_metadata_valid
    derive_anticipation = not sales and job.get('anticipationVersion') != ANTICIPATION_VERSION and version == 'NET_V2' and issuer_metadata_valid
    difal_derivation_complete = derive_difal
    derivation_complete = derive_anticipation
    derived_difal = {'version': DIFAL_VERSION, 'ratePercent': DIFAL_RATE_PERCENT,
        'issuerUf': normalize_uf(job.get('issuerUf')), 'eligibleLines': 0, 'baseCents': 0,
        'amountCents': 0, 'pendingLines': 0} if derive_difal else None
    derived_anticipation = {'version': ANTICIPATION_VERSION, 'ratePercent': ANTICIPATION_RATE_PERCENT,
        'issuerUf': normalize_uf(job.get('issuerUf')), 'eligibleLines': 0, 'baseCents': 0,
        'amountCents': 0, 'pendingLines': 0} if derive_anticipation else None
    components = {key: 0 for key in (*COMPONENT_FIELDS, 'totalCents')} if version == 'NET_V2' else None
    expected = _integer(job.get('expectedRows'), 50_000)
    _check(expected > 0 and _integer(job.get('uploaded')) == expected)
    for key in ('lines', 'unique', 'invalid', 'duplicates'):
        _integer(summary.get(key))
    _integer(financial.get('totalCents'))
    _integer(financial.get('cnpjCents'))

    by_cnpj, indexes, non_cnpj_documents, cpf_documents = {}, set(), set(), set()
    selection_rows, statuses = [], {}
    revenue_evidence = RevenueEvidence(job)
    total_raw_cents = total_cents = non_cnpj_cents = excluded_lines = cpf_cents = cpf_lines = 0
    operation_totals = {key: {'operation': key, 'lines': 0, 'totalCents': 0, 'balanceCents': 0} for key in ('VENDA','SERVICO','DEVOLUCAO','OUTRAS')}
    nature_totals = {}
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
        revenue_evidence.add(row, raw_cents)
        if operation_version is not None:
            _check(row.get('operationVersion') == operation_version)
            nature_code = row.get('natureCode')
            _check(isinstance(nature_code, str) and nature_code == normalize_operation_nature(nature_code) and
                   isinstance(row.get('description'), str) and isinstance(row.get('recipientUf'), str) and
                   row['recipientUf'] == normalize_uf(row['recipientUf']))
            nature_operation = classify_operation_nature(nature_code)
            _check(row.get('natureOperation') == nature_operation)
            nature = nature_totals.setdefault(nature_code, {'natureCode': nature_code,
                'operation': nature_operation, 'lines': 0, 'totalCents': 0})
            nature['lines'] += 1
            nature['totalCents'] = _integer(nature['totalCents'] + raw_cents)
        if difal is not None:
            _check(isinstance(row.get('recipientUf'), str) and row['recipientUf'] == normalize_uf(row['recipientUf']))
            _check(isinstance(row.get('natureCode'), str) and
                   row['natureCode'] == re.sub(r'[^0-9]', '', row['natureCode'])[:4] and
                   isinstance(row.get('description'), str))
            _check(row.get('operation') == sales_operation(row['natureCode'], row['description'], difal['version']))
            expected_difal = calculate_difal(row, difal['issuerUf'], difal['version'])
            stored_difal = row.get('difal')
            _check(isinstance(stored_difal, dict) and type(stored_difal.get('eligible')) is bool and
                   stored_difal['eligible'] == expected_difal['eligible'] and
                   stored_difal.get('reason') == expected_difal['reason'])
            for key in ('baseCents', 'amountCents'):
                _check(_integer(stored_difal.get(key)) == expected_difal[key])
                difal[key] = _integer(difal[key] + expected_difal[key])
            difal['eligibleLines'] += int(expected_difal['eligible'])
            difal['pendingLines'] += int(expected_difal['reason'] in PENDING_REASONS)
        if anticipation is not None:
            _check(isinstance(row.get('recipientUf'), str) and row['recipientUf'] == normalize_uf(row['recipientUf']) and
                   isinstance(row.get('natureCode'), str) and row['natureCode'] == normalize_operation_nature(row['natureCode']))
            expected_anticipation = calculate_anticipation(row, anticipation['issuerUf'], anticipation['version'])
            stored_anticipation = row.get('anticipation')
            _check(isinstance(stored_anticipation, dict) and type(stored_anticipation.get('eligible')) is bool and
                   stored_anticipation['eligible'] == expected_anticipation['eligible'] and
                   stored_anticipation.get('reason') == expected_anticipation['reason'])
            for key in ('baseCents', 'amountCents'):
                _check(_integer(stored_anticipation.get(key)) == expected_anticipation[key])
                anticipation[key] = _integer(anticipation[key] + expected_anticipation[key])
            anticipation['eligibleLines'] += int(expected_anticipation['eligible'])
            anticipation['pendingLines'] += int(expected_anticipation['reason'] in ANTICIPATION_PENDING_REASONS)
        if derive_difal or derive_anticipation:
            has_fields = (isinstance(row.get('natureCode'), str) and
                          re.fullmatch(r'[0-9]{4}', row['natureCode']) is not None and
                          isinstance(row.get('recipientUf'), str) and row['recipientUf'] == normalize_uf(row['recipientUf']))
            for deriving, target, calculate, reasons in (
                    (derive_difal, derived_difal, calculate_difal, PENDING_REASONS),
                    (derive_anticipation, derived_anticipation, calculate_anticipation, ANTICIPATION_PENDING_REASONS)):
                if not deriving or not has_fields:
                    continue
                # A historical operation label was validated above under its
                # original rule; the current tax view uses today's catalog.
                calculated = calculate({key: value for key, value in row.items() if key != 'operation'}, target['issuerUf'])
                for key in ('baseCents', 'amountCents'):
                    target[key] = _integer(target[key] + calculated[key])
                target['eligibleLines'] += int(calculated['eligible'])
                target['pendingLines'] += int(calculated['reason'] in reasons)
            difal_derivation_complete = difal_derivation_complete and has_fields
            derivation_complete = derivation_complete and has_fields
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
        if not sales:
            selection_rows.append({key: row.get(key) for key in ('natureCode', 'valid', 'cnpj', 'document',
                'documentKind', 'index', *COMPONENT_FIELDS, 'totalCents')})
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
    if difal is not None:
        stored_difal = financial.get('difal')
        _check(isinstance(stored_difal, dict) and stored_difal.get('version') == difal['version'] and
               stored_difal.get('issuerUf') == difal['issuerUf'])
        for key in ('ratePercent', 'eligibleLines', 'baseCents', 'amountCents', 'pendingLines'):
            _check(_integer(stored_difal.get(key)) == difal[key])
    if anticipation is not None:
        stored_anticipation = financial.get('anticipation')
        _check(isinstance(stored_anticipation, dict) and stored_anticipation.get('version') == anticipation['version'] and
               stored_anticipation.get('issuerUf') == anticipation['issuerUf'] and
               stored_anticipation.get('ratePercent') == ANTICIPATION_RATE_PERCENT)
        for key in ('eligibleLines', 'baseCents', 'amountCents', 'pendingLines'):
            _check(_integer(stored_anticipation.get(key)) == anticipation[key])
    groups = {status: {'status': status, 'label': label, 'suppliers': 0, 'lines': 0, 'totalCents': 0}
              for status, label in GROUP_LABELS.items()}
    seen, checks, sources = set(), [], set()
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
        sources.add(snapshot_source(item, job))
        group = groups[item['status']]
        statuses[cnpj] = item['status']
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
    difal_origin = 'IMPORTED' if difal is not None else 'UNAVAILABLE'
    anticipation_origin = 'IMPORTED' if anticipation is not None else 'UNAVAILABLE'
    if derive_difal:
        difal = derived_difal if difal_derivation_complete else None
        difal_origin = 'DERIVED_FROM_SNAPSHOT' if difal_derivation_complete else 'UNAVAILABLE'
    if derive_anticipation:
        anticipation = derived_anticipation if derivation_complete else None
        anticipation_origin = 'DERIVED_FROM_SNAPSHOT' if derivation_complete else 'UNAVAILABLE'
    return {'job': {key: job.get(key) for key in ('_id', 'mode', 'clientId', 'clientCode', 'clientName', 'fileName', 'completedAt', 'reportPeriod', 'difalVersion', 'anticipationVersion')},
            'reportType': 'SALES' if sales else 'PURCHASES', '_revenueEvidence': revenue_evidence.finish(),
            'totalCents': total_cents, 'cnpjCents': cnpj_cents, 'nonCnpjCents': non_cnpj_cents,
            'lineCount': line_count, 'uniqueSuppliers': unique, 'groups': list(groups.values()),
            'uniqueDocuments': unique_documents, 'nonCnpjDocumentCount': len(non_cnpj_documents),
            'cpfCents': cpf_cents, 'cpfDocumentCount': len(cpf_documents), 'cpfLineCount': cpf_lines,
            'reportingGroups': reporting_groups, 'managerialGroups': managerial_groups,
            'unconfirmed': unknown, 'components': components, 'operationTotals': list(operation_totals.values()) if sales else [], 'calculationVersion': version,
            'difal': difal,
            'difalOrigin': difal_origin,
            'anticipation': anticipation,
            'anticipationOrigin': anticipation_origin,
            **({'purchaseSelection': select_purchase_snapshot(selection_rows, statuses, version)} if not sales else {}),
            'operationVersion': operation_version,
            'natureTotals': [nature_totals[code] for code in sorted(nature_totals)] if operation_version else None,
            'quantityDisplay': quantity_text.replace('.', ','), 'generatedAt': utcnow(), 'sources': sorted(sources),
            'firstCheck': min(checks) if checks else None, 'lastCheck': max(checks) if checks else None}


def reconciled_purchase_metadata(db, job, workspace):
    """Read only the selected job and join states by workspace, exact identity and state ID."""
    policy = report_difal_policy(db, job, workspace)
    query = {'workspaceId': workspace, 'jobId': job['_id']}
    lines = db.purchaseLines.find(query, {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'index': 1, 'document': 1,
                                        'documentKind': 1, 'cnpj': 1, 'quantity': 1, 'operation': 1, 'balanceCents': 1, 'totalCents': 1, 'valid': 1, 'kind': 1,
                                        'natureCode': 1, 'description': 1, 'recipientUf': 1, 'difal': 1, 'serviceDate': 1,
                                        'natureOperation': 1, 'operationVersion': 1, 'anticipation': 1,
                                        **{key: 1 for key in COMPONENT_FIELDS}})
    lines = lines.limit(50_001).batch_size(500).max_time_ms(20000)
    items = db.lookupItems.aggregate([
        {'$match': query},
        {'$lookup': {'from': 'cnpjStates', 'let': {'ref': '$stateId', 'identity': '$cnpj'},
                     'pipeline': [{'$match': {'workspaceId': workspace, '$expr': {'$and': [
                         {'$eq': ['$_id', '$$ref']}, {'$eq': ['$cnpj', '$$identity']}]}}},
                                  {'$project': {'_id': 0, 'status': 1}}], 'as': 'sourceState'}},
        {'$project': {'_id': 0, 'workspaceId': 1, 'jobId': 1, 'clientId': 1, 'cnpj': 1, 'state': 1,
                      'stateId': 1, 'status': 1, 'occurrences': 1, 'totalCents': 1, 'checkedAt': 1, 'sourceState': 1, 'kind': 1, 'source': 1}}
    ], maxTimeMS=20000)
    metadata = reconcile_purchase_snapshot(job, lines, items, workspace)
    return {**metadata, **({'difalPolicy': policy} if policy is not None else {})}


def purchase_metadata(db, job, workspace):
    metadata = reconciled_purchase_metadata(db, job, workspace)
    return {**metadata, 'revenueReconciliation': report_revenue_reconciliation(
        db, job, workspace, metadata, reconciled_purchase_metadata)}


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


def purchase_selection_view(meta):
    """Presentation-only selection; the reconciled metadata remains unchanged."""
    selection = meta.get('purchaseSelection')
    if not selection or not selection['available']:
        return None
    totals = selection['totals']
    labels = {'OPTANTE': 'Simples', 'NAO_OPTANTE': 'Não optante'}
    groups = [{**group, 'label': labels[group['status']], 'suppliers': group['count'],
               'supplierPercent': group['countPercent'], 'fileValuePercent': group['valuePercent']}
              for group in selection['reportingGroups']]
    unknown = next(group for group in selection['groups'] if group['status'] == 'NAO_CONFIRMADO')
    return {**meta, **{key: totals[key] for key in ('totalCents', 'cnpjCents', 'nonCnpjCents',
                                                  'uniqueDocuments', 'nonCnpjDocumentCount')},
            'lineCount': totals['lines'], 'uniqueSuppliers': totals['uniqueCnpjs'],
            'reportingGroups': selection['reportingGroups'], 'managerialGroups': groups,
            'unconfirmed': {**unknown, 'suppliers': unknown['count']}, 'components': selection['components']}


def purchase_story(meta, width, styles):
    """The same reconciled per-company memory is used in single and consolidated PDFs."""
    job = meta['job']
    sales = job.get('mode') == SALES_MODE
    selection = None if sales else meta.get('purchaseSelection')
    selected = None if sales else purchase_selection_view(meta)
    display = selected or meta
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
               f'Emissão: {display_date(meta["generatedAt"])}', 'small')]
    if not sales and selected is None:
        story += [p('Compras consideradas: indisponível neste histórico', 'heading'),
                  p('Há naturezas ausentes ou incompletas nas linhas salvas. Reimporte as compras para aplicar '
                    'o catálogo. O valor original abaixo é mantido para conferência e não representa a base de compras selecionada.', 'small'),
                  p('Conferência do arquivo original — sem seleção por natureza', 'heading')]
    total_label = 'Saldo do arquivo de vendas' if sales else 'Compras consideradas' if selected is not None else 'Total do arquivo original'
    story.append(p(f'{total_label}: {money(display["totalCents"])} | {number(display["lineCount"])} linhas | '
                   f'{number(display["uniqueDocuments"])} documentos na base | Cálculo {calculation_label}', 'heading'))
    value_label = 'Saldo do arquivo de vendas' if sales else 'Compras consideradas' if selected is not None else 'Valor do arquivo original'
    rows = [['Grupo gerencial', 'Documentos', '% dos documentos', 'Linhas', value_label, '% do valor total']]
    for group in display['managerialGroups']:
        rows.append([group['label'], number(group['count']), percent(group['countPercent']), number(group['lines']),
                     money(group['totalCents']), percent(group['valuePercent'])])
    rows.append(['TOTAL', number(display['uniqueDocuments']), percent(100 if display['uniqueDocuments'] else 0),
                 number(display['lineCount']), money(display['totalCents']), percent(100 if display['totalCents'] else 0)])
    story += [purchase_table(rows, (.24, .12, .16, .08, .24, .16), width, styles, True,
                             padding=5 if selected is not None else 7), Spacer(1, 6)]
    if selected is not None:
        rows = [['Conciliação da seleção', 'Linhas', 'Valor'],
                ['Arquivo original', number(selection['reportLines']), money(selection['reportTotalCents'])],
                ['Fora das compras consideradas', number(selection['excludedLines']), money(selection['excludedTotalCents'])],
                ['Compras consideradas', number(selected['lineCount']), money(selected['totalCents'])]]
        story += [p('Compras por natureza de operação', 'heading'),
                  purchase_table(rows, (.55, .15, .30), width, styles, True, padding=5), Spacer(1, 5),
                  p('Somente naturezas classificadas como COMPRAS e serviços de prefixo 8000 entram nos valores, '
                    'documentos e percentuais de compras. Devoluções, outras operações e naturezas não classificadas '
                    'ficam fora dessa base e permanecem na conferência do arquivo original.', 'small')]
    if sales:
        story += difal_story(meta.get('difal'), width, styles, meta.get('difalOrigin'), meta.get('difalPolicy'))
    else:
        story += anticipation_story(meta.get('anticipation'), width, styles, meta.get('anticipationOrigin'), meta.get('difalPolicy'))
    if sales and meta.get('operationTotals'):
        operation_labels = {'VENDA':'Vendas','SERVICO':'Vendas de serviços','DEVOLUCAO':'Devoluções','OUTRAS':'Outras'}
        operation_rows = [['Operação','Linhas','Valor antes do sinal','Impacto no saldo']]
        for item in meta['operationTotals']:
            operation_rows.append([operation_labels.get(item['operation'], item['operation']), number(item['lines']), money(item['totalCents']), money(item['balanceCents'])])
        story += [p('Vendas, serviços, devoluções e outras', 'heading'), purchase_table(operation_rows, (.32,.12,.28,.28), width, styles), Spacer(1, 6)]
    if not sales and selection and (selection['available'] or any(item['natureCode'] for item in selection['natureTotals'])):
        nature_rows = [['Natureza', 'Operação', 'Linhas', 'Valor do arquivo', 'Tratamento nas bases']]
        for item in selection['natureTotals']:
            treatment = ('Compras consideradas' if item['eligible'] else
                'Fora de compras; Abate a receita de vendas' if item['operation'] == 'DEVOLUCAO_VENDA' else
                'Indisponível — natureza ausente' if item['reason'] == 'MISSING_NATURE' else 'Fora das bases da DRE')
            nature_rows.append([item['natureCode'] or 'Ausente', NATURE_LABELS[item['operation']], number(item['lines']),
                                money(item['totalCents']), treatment])
        story += [p('Conferência das naturezas de operação', 'heading'),
                  purchase_table(nature_rows, (.10, .26, .09, .22, .33), width, styles, padding=5), Spacer(1, 5),
                  p('Classificação pelos quatro primeiros dígitos, conforme a coluna D (OPERAÇÃO) do catálogo. '
                    'Esta conferência conserva todas as naturezas e os valores do arquivo original. '
                    'Somente COMPRAS e serviços de natureza 8000 integram as compras consideradas; '
                    'as devoluções de venda identificadas aqui abatem a receita de vendas na DRE.', 'small')]
    if sales and meta.get('natureTotals') is not None:
        nature_rows = [['Natureza', 'Operação', 'Linhas', 'Valor do arquivo', 'Destino na DRE']]
        destinations = ({'VENDA': 'Receita de vendas', 'SERVICO_VENDA': 'Receita de serviços'} if sales else
                        {'COMPRAS': 'Compras', 'SERVICO_COMPRA': 'Compras', 'DEVOLUCAO_VENDA': 'Abate a receita de vendas'})
        for item in meta['natureTotals']:
            nature_rows.append([item['natureCode'] or 'Ausente', NATURE_LABELS[item['operation']], number(item['lines']),
                                money(item['totalCents']), destinations.get(item['operation'], 'Fora das bases da DRE')])
        story += [p('Conferência das naturezas de operação', 'heading'),
                  purchase_table(nature_rows, (.10, .26, .09, .22, .33), width, styles), Spacer(1, 5),
                  p('Classificação pelos quatro primeiros dígitos, conforme a coluna D (OPERAÇÃO) do catálogo. '
                    'Os totais deste relatório reconciliam o arquivo completo. Na DRE, as vendas e os serviços de venda '
                    'compõem a receita; as devoluções de venda encontradas nas compras abatem essa receita. '
                    'As compras consideradas incluem apenas operações de compra e serviços de natureza 8000.', 'small')]
    unknown = display['unconfirmed']
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
                       f'{number(display["nonCnpjDocumentCount"])} documentos e {money(display["nonCnpjCents"])}. {MANAGEMENT_NOTE}' +
                       (' Os subtotais acima abrangem somente as compras consideradas.' if selected is not None else
                        ' Os subtotais acima pertencem ao arquivo original, sem seleção de compras disponível.'), 'small'))
    if selected is not None and selected['components'] is not None:
        values = selected['components']
        memory = [list(COMPONENT_LABELS), [money(values[key]) for key in (*COMPONENT_FIELDS, 'totalCents')]]
        story += [Spacer(1, 3), p('Memória das compras consideradas', 'heading'),
                  purchase_table(memory, (.17, .16, .18, .16, .16, .17), width, styles, padding=5), Spacer(1, 5),
                  p(f'Q - Y + AA - AB nas linhas incluídas = {money(values["grossCents"])} - '
                    f'{money(values["discountCents"])} + {money(values["freightCents"])} - '
                    f'{money(values["abatementCents"])} = {money(values["totalCents"])}. Z permanece apenas informativa.', 'small')]
    story += [Spacer(1, 3), p('Memória dos valores importados', 'heading')]
    if meta['components'] is not None:
        values = meta['components']
        memory = [list(COMPONENT_LABELS), [money(values[key]) for key in (*COMPONENT_FIELDS, 'totalCents')]]
        story += [purchase_table(memory, (.17, .16, .18, .16, .16, .17), width, styles,
                                padding=5 if selected is not None else 7), Spacer(1, 5),
                  p(f'Q - Y + AA - AB = {money(values["grossCents"])} - {money(values["discountCents"])} + '
                    f'{money(values["freightCents"])} - {money(values["abatementCents"])} = {money(values["totalCents"])}. '
                    'Z é apenas informativa e não entra na fórmula.', 'small')]
    else:
        story += [p(f'Regra anterior: total = soma da coluna Q = {money(meta["totalCents"])}. '
                    'Os ajustes Y, Z, AA e AB não foram armazenados neste lote. Reimporte o arquivo em uma nova consulta '
                    'para aplicar Q - Y + AA - AB; este histórico mantém o cálculo original.', 'small')]
    story += [
        p(f'Bases dos percentuais: {number(display["uniqueDocuments"])} documentos e '
          f'{money(display["totalCents"])} ' +
          ('das compras consideradas, incluindo CPF e demais documentos nas naturezas elegíveis. ' if selected is not None else
           'do arquivo completo, incluindo CPF e demais documentos. ') +
          f'Cada {partner} conta uma vez por documento; ' +
          ('somente suas linhas de compras e serviços 8000 compõem o valor. ' if selected is not None else
           'todas as suas linhas compõem o valor. ') +
          'Cada linha sem documento conta separadamente. Base de valor zero resulta em 0,00%.' +
          (' Percentuais distribuídos em centésimos pelo maior resto para totalizar 100,00%.' if sales else ''), 'small'),
        p(('Valores somados por linha. A = CNPJ comprador; I = comprador; ' if sales else
           f'Valores somados por linha, sem multiplicar por P. Quantidade P total no arquivo original: {meta["quantityDisplay"]}. '
           'A = CNPJ fornecedor; I = razão social; P = quantidade; ') + 'Q = valor bruto; Y = desconto; '
          'Z = despesa acessória; AA = frete; AB = abatimento não tributado.', 'small'),
        p(f'Fontes: {", ".join(meta["sources"]) or "Nenhuma consulta CNPJ neste relatório"}. '
          f'Chamadas de {display_date(meta.get("firstCheck"))} a {display_date(meta.get("lastCheck"))}. '
          f'A observação salva não comprova o regime na data da {"venda" if sales else "compra"} nem a atualização fiscal da base. '
          'Referência fiscal não informada. Este PDF lê o snapshot reconciliado e não faz nova consulta.', 'small'),
    ]
    story += revenue_story(meta.get('revenueReconciliation'), width, styles)
    return story


def revenue_story(closing, width, styles, title='Fechamento da receita'):
    """Keep the closing last and separate from original balances and all-file components."""
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    closing = closing or unavailable_revenue('Este relatório não conserva um par conciliado de compras e vendas para conferir as devoluções.')
    story = [Spacer(1, 8), p(title, 'heading')]
    if not closing['available']:
        status = 'Pendente' if closing['status'] == 'PENDING' else 'Indisponível'
        story.append(p(f'{status}: {closing["reason"]}', 'small'))
        return story
    period = closing['period']
    note = p(f'Receita de origem de {period["startMonth"]} a {period["endMonth"]}. '
             'Vendas e compras da mesma empresa e geração; devoluções abatidas uma única vez.', 'small')
    note.keepWithNext = True
    story.append(note)
    rows = [['Composição da receita', 'Valor do período'],
            ['Vendas de mercadorias', money(closing['grossSalesCents'])],
            ['Serviços de venda', money(closing['serviceSalesCents'])],
            ['Receita bruta (vendas + serviços)', money(closing['grossRevenueCents'])],
            ['(-) Devoluções de venda no relatório de compras', money(-closing['salesReturnsCents'])],
            ['RECEITA APÓS DEVOLUÇÕES', money(closing['revenueAfterReturnsCents'])]]
    story += [purchase_table(rows, (.70, .30), width, styles, True, padding=5), Spacer(1, 5)]
    if len(closing['monthly']) > 1:
        rows = [['Competência', 'Receita bruta', '(-) Devoluções de venda', 'Receita após devoluções']]
        rows.extend([[row['sourceMonth'], money(row['grossRevenueCents']), money(-row['salesReturnsCents']),
                      money(row['revenueAfterReturnsCents'])] for row in closing['monthly']])
        story += [purchase_table(rows, (.16, .28, .28, .28), width, styles, padding=5), Spacer(1, 5)]
    story += [p('Base: operações VENDA e serviços 9000, menos DEVOLUCAO_VENDA do relatório de compras, pela competência '
                'da coluna H. Os valores usam Q - Y + AA - AB. Devoluções de compra e outras operações não integram '
                'essa receita. Os totais originais dos arquivos permanecem preservados.', 'small'),
              p(f'Origem: vendas {closing.get("salesJobId", "")} | compras {closing.get("purchaseJobId", "")}. '
                'O cenário pode conter ajustes manuais, apresentados separadamente na DRE.', 'small')]
    return story


def difal_story(difal, width, styles, origin=None, policy=None):
    """Keep the estimate separate from invoice totals and preserve missing-data states."""
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    story = [p('DIFAL sobre vendas (10%)', 'heading')]
    choice = direction_selection(policy, 'exit')
    if choice is not None and not choice['enabled']:
        exclusion_note = p('Não incluído por escolha: DIFAL de saída desmarcado no Simples puro e híbrido. Valor selecionado: R$ 0,00.')
        exclusion_note.keepWithNext = True
        return story + [exclusion_note,
                        p('A estimativa de origem permanece preservada para auditoria; não integra os valores selecionados deste relatório.', 'small')]
    if choice is not None:
        selection_note = p('DIFAL de saída selecionado para: ' + ', '.join(choice['regimeNames']) + '. O valor abaixo é uma estimativa de origem; a DRE aplica os bloqueios por competência.', 'small')
    else:
        selection_note = p('Sem escolha de DIFAL registrada neste relatório. Os valores abaixo são apenas estimativas de origem, sem indicar inclusão em uma simulação.', 'small')
    selection_note.keepWithNext = True
    story.append(selection_note)
    if difal is None:
        return story + [p('Indisponível neste histórico: os dados salvos não permitem conferir o DIFAL em todas as linhas. '
                          'São necessários os valores das vendas, a natureza de quatro dígitos e o campo de UF '
                          'do destinatário preservados. Reimporte as vendas para completar esses dados.', 'small')]
    if origin == 'DERIVED_FROM_SNAPSHOT':
        story.append(p('Calculado a partir dos dados salvos no relatório de origem, após conferir a regra original, '
                       'sem modificar o lote ou as suas linhas. A estimativa atual inclui CPF ou CNPJ válido.', 'small'))
    rows = [['UF do emitente', 'Linhas elegíveis', 'Base elegível', 'DIFAL sobre vendas (10%)'],
            [difal['issuerUf'] or 'Não informada', number(difal['eligibleLines']),
             money(difal['baseCents']), money(difal['amountCents'])]]
    story += [purchase_table(rows, (.20, .20, .30, .30), width, styles), Spacer(1, 4)]
    if difal['pendingLines']:
        story.append(p(f'Estimativa parcial: {number(difal["pendingLines"])} linhas pendentes por UF do emitente '
                       'ou do destinatário ausente. Essas linhas não integram a base nem o valor acima.', 'small'))
    story.append(p('Alíquota média estimada de 10%, sem equivalência automática à alíquota legal. '
                   'Aplica-se somente a vendas de mercadoria elegíveis para CPF ou CNPJ válido de outra UF; '
                   'base = total registrado da venda. Valores arredondados por linha e somados uma única vez. '
                   'Este relatório mostra o total do período importado, sem alterar o total de vendas. '
                   'Nas novas simulações, cada competência usa as vendas daquele mês, e o total anual soma '
                   'as competências calculadas. A dedução na DRE depende da direção escolhida em cada cenário Simples e dos bloqueios por competência.', 'small'))
    return story


def anticipation_story(anticipation, width, styles, origin=None, policy=None):
    """Show the reconciled purchase estimate without changing the purchase base."""
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    story = [p('DIFAL de entrada — Antecipação de ICMS (7,32%)', 'heading')]
    choice = direction_selection(policy, 'entry')
    if choice is not None and not choice['enabled']:
        exclusion_note = p('Não incluído por escolha: DIFAL de entrada desmarcado no Simples puro e híbrido. Valor selecionado: R$ 0,00.')
        exclusion_note.keepWithNext = True
        return story + [exclusion_note,
                        p('A estimativa de origem permanece preservada para auditoria; não integra os valores selecionados deste relatório.', 'small')]
    if choice is not None:
        selection_note = p('DIFAL de entrada selecionado para: ' + ', '.join(choice['regimeNames']) + '. O valor abaixo é uma estimativa de origem; a DRE aplica os bloqueios por competência.', 'small')
    else:
        selection_note = p('Sem escolha de DIFAL registrada neste relatório. Os valores abaixo são apenas estimativas de origem, sem indicar inclusão em uma simulação.', 'small')
    selection_note.keepWithNext = True
    story.append(selection_note)
    if anticipation is None:
        return story + [p('Indisponível neste histórico: os dados salvos não permitem conferir a antecipação de ICMS '
                          'em todas as linhas. São necessários os valores Q - Y + AA - AB, a natureza de quatro dígitos '
                          'e o campo de UF do fornecedor preservados. Reimporte as compras para completar esses dados.', 'small')]
    if origin == 'DERIVED_FROM_SNAPSHOT':
        story.append(p('Calculado a partir dos dados salvos no relatório de origem, após conferir a regra original, '
                       'sem modificar o lote ou as suas linhas. A estimativa atual inclui CPF ou CNPJ válido.', 'small'))
    rows = [['UF da empresa', 'Linhas elegíveis', 'Base elegível', 'Antecipação de ICMS (7,32%)'],
            [anticipation['issuerUf'] or 'Não informada', number(anticipation['eligibleLines']),
             money(anticipation['baseCents']), money(anticipation['amountCents'])]]
    story += [purchase_table(rows, (.20, .20, .30, .30), width, styles), Spacer(1, 4)]
    if anticipation['pendingLines']:
        story.append(p(f'Estimativa parcial: {number(anticipation["pendingLines"])} linhas pendentes por UF da empresa '
                       'ou do fornecedor ausente. Essas linhas não integram a base nem o valor acima.', 'small'))
    nature_note = ('Naturezas consideradas: somente operações COMPRAS do catálogo. Serviços de prefixo 8000, '
                   'inclusive com sufixos, ficam fora da antecipação e permanecem nas compras consideradas.'
                   if anticipation['version'] == ANTICIPATION_VERSION else
                   'A regra histórica considera operações de compra do catálogo e serviços de prefixo 8000.')
    story.append(p('Somente compras interestaduais com fornecedor identificado por CPF de 11 dígitos ou CNPJ válido. '
                   'CNOs, documentos ausentes ou inválidos não integram esta base. ' + nature_note, 'small'))
    story.append(p('Parâmetro gerencial de 7,32%, sem equivalência automática à alíquota legal. '
                   'Base = total registrado da compra; arredondamento por linha em centavos e soma uma única vez. '
                   'Este valor fica separado do total de compras. Na DRE, a antecipação é aplicada somente ao Simples puro '
                   'e híbrido, sem cobrança nas competências em que o sublimite estiver alcançado.', 'small'))
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
