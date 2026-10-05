"""Extrato PGDAS-D: RBT12 exclusivamente da seção 2.2, sem fallback para 2.1."""
from __future__ import annotations
import re
import unicodedata

PARSER_VERSION = 'SIMPLES_SECTION_22_V2'
MONTH_RE = re.compile(r'(?<!\d)(0[1-9]|1[0-2])\s*/\s*(20\d{2})(?!\d)')
MONEY_RE = re.compile(r'(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\d.,])')
SECTION_RE = re.compile(r'^\s*2\s*\.\s*2\s*\)?\s*RECEITAS\s+BRUTAS\s+ANTERIORES', re.M)
MARKET_RE = re.compile(r'^\s*2\s*\.\s*2\s*\.\s*([12])\s*\)?\s*MERCADO\s+(INTERNO|EXTERNO)', re.M)
END_RE = re.compile(r'^\s*(?:2\s*\.\s*[3-9]\s*\)|[3-9]\s*\))', re.M)


def _plain(value: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c)).upper()


def _cents(value: str) -> int:
    if not MONEY_RE.fullmatch(value):
        raise ValueError('Valor monetário ambíguo na seção 2.2; confira a imagem do extrato.')
    whole, cents = value.replace('.', '').split(',')
    result = int(whole) * 100 + int(cents)
    if result > 100_000_000_000_000:
        raise ValueError('Valor da seção 2.2 acima do limite de leitura.')
    return result


def _previous_months(pa: str, count=12):
    month, year = map(int, pa.split('/'))
    absolute = year * 12 + month - 1
    return [f'{(absolute - offset) % 12 + 1:02d}/{(absolute - offset) // 12:04d}'
            for offset in range(count, 0, -1)]


def _competence_matches(block: str):
    # Page footers can occur between table rows. A complete issue date such as
    # 02/10/2026 is not the revenue competence 10/2026.
    return [match for match in MONTH_RE.finditer(block)
            if not re.search(r'\b\d{1,2}\s*/\s*$', block[:match.start()])]


def _read_market(block: str, revenues: dict, label: str):
    matches = _competence_matches(block)
    for index, match in enumerate(matches):
        period = f'{match[1]}/{match[2]}'
        # One explicit monetary value per competence. A blank cell is never zero.
        tail = block[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(block)]
        if re.search(r'[-−]\s*\d', tail):
            raise ValueError(f'Seção 2.2: valor negativo/ambíguo em {period}. Confira o extrato.')
        amounts = list(MONEY_RE.finditer(tail))
        if len(amounts) != 1:
            raise ValueError(f'Seção 2.2 · {label}: valor ausente ou ambíguo em {period}. Reenvie uma imagem legível.')
        value = _cents(amounts[0].group())
        if period in revenues and revenues[period] != value:
            raise ValueError(f'Seção 2.2: valores conflitantes para {period} no {label}.')
        revenues[period] = value


def parse_statement_text(text: str, *, ocr_used=False, ocr_confidence=None):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('RBT12: não foi possível ler texto do Extrato do Simples Nacional.')
    plain = _plain(text).replace('\r', '')
    if not re.search(r'EXTRATO\s+DO\s+SIMPLES\s+NACIONAL', plain):
        raise ValueError('RBT12: documento não identificado como Extrato do Simples Nacional.')
    pa_pattern = r'PERIODO\s+DE\s+APURACAO\s*\(\s*PA\s*\)\s*:\s*(0[1-9]|1[0-2])\s*/\s*(20\d{2})'
    pas = {f'{m[1]}/{m[2]}' for m in re.finditer(pa_pattern, plain)}
    if len(pas) != 1:
        raise ValueError('RBT12: o período de apuração (PA) deve estar legível e ser único no extrato.')
    pa = pas.pop()
    roots = {re.sub(r'\D', '', m[1]) for m in re.finditer(r'CNPJ\s+BASICO\s*:\s*(\d{2}\.\d{3}\.\d{3}|\d{8})(?!\d)', plain)}
    if len(roots) != 1:
        raise ValueError('RBT12: CNPJ básico ausente, ilegível ou mais de uma empresa no PDF.')
    name = re.search(r'NOME\s+EMPRESARIAL\s*:\s*([^\n|]+)', text, re.I)
    internal, external, section_blocks = {}, {}, []
    starts = list(SECTION_RE.finditer(plain))
    if not starts:
        raise ValueError('RBT12: seção 2.2) Receitas Brutas Anteriores não encontrada. A seção 2.1 não será utilizada.')
    for i, start in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(plain)
        stop = END_RE.search(plain, start.end(), end)
        block = plain[start.end():stop.start() if stop else end]
        section_blocks.append(block)
    # Repeated 2.2 headers on continuation pages do not reset the current market.
    block = '\n'.join(section_blocks)
    markets = list(MARKET_RE.finditer(block))
    if not markets or {m[1] for m in markets} != {'1', '2'}:
        raise ValueError('RBT12: leia integralmente 2.2.1) Mercado Interno e 2.2.2) Mercado Externo; ausência não equivale a zero.')
    for i, marker in enumerate(markets):
        number, label = marker[1], marker[2]
        if (number == '1') != (label == 'INTERNO'):
            raise ValueError('RBT12: identificação conflitante dos mercados na seção 2.2.')
        end = markets[i + 1].start() if i + 1 < len(markets) else len(block)
        _read_market(block[marker.end():end], internal if number == '1' else external, 'Mercado ' + label.title())
    expected = _previous_months(pa)
    missing_internal = [m for m in expected if m not in internal]
    missing_external = [m for m in expected if m not in external]
    if missing_internal or missing_external:
        parts = [('interno', missing_internal), ('externo', missing_external)]
        raise ValueError('RBT12 não confirmada pela seção 2.2. Competências ausentes: ' +
                         '; '.join(f'{name}: {", ".join(months)}' for name, months in parts if months) + '. Nenhum mês foi preenchido com zero.')
    month_key = lambda value: (int(value[3:]), int(value[:2]))
    all_months = sorted(set(internal) | set(external), key=month_key)
    if any(month_key(m) >= month_key(pa) for m in all_months):
        raise ValueError('Seção 2.2 contém competência igual ou posterior ao PA. Confira a leitura; o mês do PA não entra na RBT12.')
    if set(internal) != set(external):
        raise ValueError('Seção 2.2 incompleta: os mercados interno e externo têm competências diferentes.')
    monthly = [dict(period=m, month=m[3:] + '-' + m[:2], internalCents=internal[m], externalCents=external[m],
                    totalCents=internal[m] + external[m], usedInRbt12=m in expected) for m in all_months]
    selected = [row for row in monthly if row['usedInRbt12']]
    inside = sum(row['internalCents'] for row in selected)
    outside = sum(row['externalCents'] for row in selected)
    rbt12 = inside + outside
    if rbt12 > 100_000_000_000_000:
        raise ValueError('RBT12 da seção 2.2 acima do limite da calculadora.')
    return {
        'parserVersion': PARSER_VERSION, 'documentType': 'EXTRATO_SIMPLES_NACIONAL', 'sourceSection': '2.2',
        'pa': pa, 'cnpjBasico': roots.pop(), 'companyName': ' '.join(name[1].split()) if name else None,
        'rbt12Cents': rbt12, 'rbt12CalculatedCents': rbt12, 'rbt12Reconciled': True,
        'rbt12Basis': {'section': '2.2', 'startMonth': selected[0]['month'], 'endMonth': selected[-1]['month'],
                       'months': 12, 'internalCents': inside, 'externalCents': outside, 'totalCents': rbt12},
        'priorRevenues': monthly, 'rbt12Window': selected,
        'priorInternalRevenues': [{'period': row['period'], 'internalCents': row['internalCents']} for row in monthly],
        'ocrUsed': bool(ocr_used), 'ocrConfidence': round(float(ocr_confidence), 4) if ocr_confidence is not None else None,
        'warnings': [],
    }


def convert_statement_pdf(content: bytes, *, force_ocr=False, ocr_engine=None, timeout_seconds=45):
    from reporting.pdf_ocr import searchable_pdf
    converted = searchable_pdf(content, force_ocr=force_ocr, engine=ocr_engine, timeout_seconds=timeout_seconds)
    result = parse_statement_text(converted['text'], ocr_used=bool(converted['ocrPages']), ocr_confidence=converted['ocrConfidence'])
    # A low-confidence amount/date in 2.2 or its PA/identity metadata blocks confirmation.
    inside = False
    for page in converted['pages']:
        for row in page['rows']:
            line = _plain(row['text'])
            if SECTION_RE.search(line) or MARKET_RE.search(line):
                inside = True
            elif END_RE.search(line):
                inside = False
            critical = (inside and (_competence_matches(line) or MONEY_RE.search(line))) or 'CNPJ BASICO' in line or '(PA)' in line
            if critical and any(item['confidence'] is not None and item['confidence'] < .93 for item in row['items'] if re.search(r'\d', item['text'])):
                raise ValueError(f'OCR com baixa confiança em dados da seção 2.2/identificação (página {page["page"]}). Confira o PDF; a RBT12 não foi liberada.')
    result.update(pageCount=converted['pageCount'], processedPages=converted['pageCount'], ocrPages=converted['ocrPages'],
                  ocrEngine=converted['ocrEngine'], searchablePdfCreated=True)
    return result, converted['pdf'], converted['text']


def extract_statement_pdf(content: bytes):
    return convert_statement_pdf(content)[0]
