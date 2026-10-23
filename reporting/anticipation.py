"""Versioned managerial purchase ICMS estimate, separate from invoice totals."""
from __future__ import annotations

import math
import re

from .difal import normalize_uf
from .operation_catalog import is_purchase_operation, normalize_operation_nature
from .tax_documents import is_cpf_or_cnpj

ANTICIPATION_VERSION = 'ICMS_ANTICIPATION_V4'
ANTICIPATION_CPF_CNPJ_VERSION = 'ICMS_ANTICIPATION_V3'
ANTICIPATION_CPF_VERSION = 'ICMS_ANTICIPATION_V2'
ANTICIPATION_LEGACY_VERSION = 'ICMS_ANTICIPATION_V1'
ANTICIPATION_VERSIONS = (ANTICIPATION_LEGACY_VERSION, ANTICIPATION_CPF_VERSION,
                         ANTICIPATION_CPF_CNPJ_VERSION, ANTICIPATION_VERSION)
ANTICIPATION_RATE_PERCENT = 7.32
ANTICIPATION_PENDING_REASONS = frozenset(('MISSING_ISSUER_UF', 'MISSING_RECIPIENT_UF'))
MAX_SAFE_INTEGER = 9_007_199_254_740_991


def calculate_anticipation(row, issuer_uf, version=ANTICIPATION_VERSION):
    """Mirror Node: V4 excludes 8000 services; V1/V2/V3 retain their saved rules."""
    if version not in ANTICIPATION_VERSIONS:
        raise ValueError('Versão da antecipação de ICMS desconhecida.')

    def excluded(reason):
        return {'eligible': False, 'baseCents': 0, 'amountCents': 0, 'reason': reason}

    total = row.get('totalCents')
    if (not isinstance(total, (int, float)) or isinstance(total, bool) or
            isinstance(total, float) and (not math.isfinite(total) or not total.is_integer()) or
            not 0 <= total <= MAX_SAFE_INTEGER):
        return excluded('INVALID_TOTAL')
    if version == ANTICIPATION_VERSION and normalize_operation_nature(row.get('natureCode')) == '8000':
        return excluded('SERVICE_PURCHASE_EXCLUDED')
    if not is_purchase_operation(row.get('natureCode')):
        return excluded('NOT_PURCHASE')
    if version in (ANTICIPATION_VERSION, ANTICIPATION_CPF_CNPJ_VERSION) and not is_cpf_or_cnpj(row.get('document')):
        return excluded('NOT_CPF_OR_CNPJ')
    if version == ANTICIPATION_CPF_VERSION:
        document = re.sub(r'[./\-\s]', '', str(row.get('document') or '').strip())
        if not re.fullmatch(r'[0-9]{11}', document):
            return excluded('NOT_CPF')
    issuer, recipient = normalize_uf(issuer_uf), normalize_uf(row.get('recipientUf'))
    if not issuer:
        return excluded('MISSING_ISSUER_UF')
    if not recipient:
        return excluded('MISSING_RECIPIENT_UF')
    if issuer == recipient:
        return excluded('SAME_UF')
    total = int(total)
    return {'eligible': True, 'baseCents': total, 'amountCents': (total * 732 + 5000) // 10000, 'reason': 'ELIGIBLE'}


def summarize_anticipation(rows, issuer_uf, version=ANTICIPATION_VERSION):
    if version not in ANTICIPATION_VERSIONS:
        raise ValueError('Versão da antecipação de ICMS desconhecida.')
    summary = {'version': version, 'ratePercent': ANTICIPATION_RATE_PERCENT, 'issuerUf': normalize_uf(issuer_uf),
               'eligibleLines': 0, 'baseCents': 0, 'amountCents': 0, 'pendingLines': 0}
    for row in rows:
        result = calculate_anticipation(row, issuer_uf, version)
        summary['eligibleLines'] += int(result['eligible'])
        summary['pendingLines'] += int(result['reason'] in ANTICIPATION_PENDING_REASONS)
        for key in ('baseCents', 'amountCents'):
            summary[key] += result[key]
            if summary[key] > MAX_SAFE_INTEGER:
                raise ValueError('Soma da antecipação de ICMS acima do limite seguro.')
    return summary
