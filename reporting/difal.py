"""Versioned managerial DIFAL estimate; never changes the sale or other taxes."""
from __future__ import annotations

import math
import re
import unicodedata

from .operation_catalog import OPERATION_CATALOG_GROUPS, classify_operation_nature
from .tax_documents import is_cpf_or_cnpj

DIFAL_VERSION = 'DIFAL_ESTIMATE_V5'
DIFAL_CPF_CNPJ_VERSION = 'DIFAL_ESTIMATE_V4'
DIFAL_CPF_VERSION = 'DIFAL_ESTIMATE_V3'
DIFAL_PREVIOUS_VERSION = 'DIFAL_ESTIMATE_V2'
DIFAL_LEGACY_VERSION = 'DIFAL_ESTIMATE_V1'
DIFAL_VERSIONS = (DIFAL_LEGACY_VERSION, DIFAL_PREVIOUS_VERSION, DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_VERSION)
DIFAL_RATE_PERCENT = 10
DIFAL_LEGACY_CFOPS = frozenset(('6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108'))
DIFAL_CFOPS = DIFAL_LEGACY_CFOPS | {'5102'}
BRAZIL_UFS = frozenset('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())
RETURN_CFOPS = frozenset(('5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556','5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413','6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556'))
OTHER_CFOPS = frozenset(('5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930'))
PENDING_REASONS = frozenset(('MISSING_ISSUER_UF', 'MISSING_RECIPIENT_UF'))


def normalize_uf(value):
    value = str(value or '').strip().upper()
    return value if value in BRAZIL_UFS else ''


def eligible_cfops(version):
    if version not in DIFAL_VERSIONS:
        raise ValueError('Versão do DIFAL desconhecida.')
    if version in (DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_VERSION):
        return OPERATION_CATALOG_GROUPS['VENDA']
    return DIFAL_LEGACY_CFOPS if version == DIFAL_LEGACY_VERSION else DIFAL_CFOPS


def sales_operation(nature_code, description, version=DIFAL_VERSION):
    """Mirror the versioned Node/browser classification for stored sales rows."""
    code = re.sub(r'[^0-9]', '', str(nature_code or ''))[:4]
    if version in (DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_VERSION):
        # Column D of the supplied nature catalog controls the operation. Product
        # descriptions neither include an unknown code nor exclude a catalog sale.
        return {'VENDA': 'VENDA', 'SERVICO_VENDA': 'SERVICO',
                'DEVOLUCAO_COMPRA': 'DEVOLUCAO'}.get(classify_operation_nature(code), 'OUTRAS')
    if code == '9000':
        return 'SERVICO'
    if code in OTHER_CFOPS:
        return 'OUTRAS'
    if code in RETURN_CFOPS:
        return 'DEVOLUCAO'
    normalized = unicodedata.normalize('NFD', str(description or '')).lower()
    normalized = re.sub(r'[\u0300-\u036f]', '', normalized)
    text = re.sub(r'[^a-z0-9]', '', normalized)
    if 'devolucao' in text:
        return 'DEVOLUCAO'
    if 'servico' in text or 'prestacao' in text:
        return 'SERVICO'
    purpose = re.sub(r'[^a-z0-9]+', ' ', normalized).strip()
    if re.match(r'^(?:remessa|transferencia|bonificacao|doacao|brinde|amostra|conserto|consignacao)(?:\s|$)', purpose):
        return 'OUTRAS'
    if code in eligible_cfops(version) or 'venda' in text or 'faturamento' in text:
        return 'VENDA'
    return 'OUTRAS'


def calculate_difal(row, issuer_uf, version=DIFAL_VERSION):
    """Integer cents and half-up rounding, matching the server's 10% estimate."""
    cfops = eligible_cfops(version)
    def excluded(reason):
        return {'eligible': False, 'baseCents': 0, 'amountCents': 0, 'reason': reason}
    total = row.get('totalCents')
    if (not isinstance(total, (int, float)) or isinstance(total, bool) or
            isinstance(total, float) and (not math.isfinite(total) or not total.is_integer()) or
            not 0 <= total <= 9_007_199_254_740_991):
        return excluded('INVALID_TOTAL')
    code = re.sub(r'[^0-9]', '', str(row.get('natureCode') or ''))[:4]
    operation_matches = row.get('operation') == 'VENDA' or (version in (DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_VERSION) and 'operation' not in row)
    if not operation_matches or sales_operation(code, row.get('description'), version) != 'VENDA':
        return excluded('NOT_SALE')
    if code not in cfops:
        return excluded('INELIGIBLE_NATURE')
    document = str(row.get('document') or '')
    if version in (DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_VERSION):
        document = re.sub(r'[./\-\s]', '', document.strip())
    if version == DIFAL_CPF_CNPJ_VERSION and not is_cpf_or_cnpj(document):
        return excluded('NOT_CPF_OR_CNPJ')
    if version != DIFAL_CPF_CNPJ_VERSION and not re.fullmatch(r'[0-9]{11}', document):
        return excluded('NOT_CPF')
    issuer, recipient = normalize_uf(issuer_uf), normalize_uf(row.get('recipientUf'))
    if not issuer:
        return excluded('MISSING_ISSUER_UF')
    if not recipient:
        return excluded('MISSING_RECIPIENT_UF')
    if issuer == recipient:
        return excluded('SAME_UF')
    total = int(total)
    return {'eligible': True, 'baseCents': total, 'amountCents': (total + 5) // 10, 'reason': 'ELIGIBLE'}
