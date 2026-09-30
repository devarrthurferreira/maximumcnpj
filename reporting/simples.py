"""Leitor do Extrato do Simples Nacional: texto nativo primeiro, OCR somente quando necessário."""
from __future__ import annotations
import re
import unicodedata
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from statistics import mean

PARSER_VERSION = 'SIMPLES_RBT12_V1'
MONEY_RE = re.compile(r'(?<![\d/])(\d{1,3}(?:\.\d{3})*|\d+),([0-9]{2})(?!\d)')
MONTH_RE = re.compile(r'(?<!\d)(0[1-9]|1[0-2])/(20\d{2})(?!\d)')


def _plain(value: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c)).upper()


def _cents(text: str) -> int:
    clean = text.strip().replace('R$', '').replace(' ', '').replace('.', '').replace(',', '.')
    try:
        return int((Decimal(clean) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except InvalidOperation as exc:
        raise ValueError('Valor monetário inválido no extrato.') from exc


def _money_tokens(line: str):
    return [(_cents(match.group(0)), match.group(0)) for match in MONEY_RE.finditer(line)]


def _row_value(lines, marker):
    marker = _plain(marker)
    for line in lines:
        if marker in _plain(line):
            values = _money_tokens(line)
            if values:
                return values[-1][0]
    return None


def _previous_months(pa: str, count=12):
    month, year = map(int, pa.split('/'))
    absolute = year * 12 + month - 1
    result = []
    for offset in range(count, 0, -1):
        current = absolute - offset
        y, m0 = divmod(current, 12)
        result.append(f'{m0 + 1:02d}/{y:04d}')
    return result


def _internal_revenues(text: str):
    plain = _plain(text)
    start = max(plain.find('2.2.1'), plain.find('MERCADO INTERNO'))
    if start < 0:
        return {}
    end_candidates = [position for position in (plain.find('2.2.2', start + 1), plain.find('MERCADO EXTERNO', start + 1)) if position > start]
    end = min(end_candidates) if end_candidates else len(text)
    block = text[start:end]
    revenues = {}
    # OCR/tabelas podem colocar quatro pares competência/valor na mesma linha.
    pair = re.compile(r'(0[1-9]|1[0-2])/(20\d{2})\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})')
    for match in pair.finditer(block):
        revenues[f'{match.group(1)}/{match.group(2)}'] = _cents(match.group(3))
    return revenues


def parse_statement_text(text: str, *, ocr_used=False, ocr_confidence=None):
    """Extrai somente valores explicitamente presentes; não inventa RBT12 ausente."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Não foi possível ler texto do Extrato do Simples Nacional.')
    lines = [' '.join(line.split()) for line in text.splitlines() if line.strip()]
    joined = '\n'.join(lines)
    plain = _plain(joined)
    if 'SIMPLES NACIONAL' not in plain or 'RBT12' not in plain:
        raise ValueError('O PDF não parece ser um Extrato do Simples Nacional com RBT12 legível.')

    pa_match = re.search(r'PER[IÍ]ODO\s+DE\s+APURA[CÇ][AÃ]O\s*\(PA\)\s*:\s*(0[1-9]|1[0-2])/(20\d{2})', joined, re.I)
    if not pa_match:
        pa_match = re.search(r'\bPA\s*[:\-]?\s*(0[1-9]|1[0-2])/(20\d{2})', joined, re.I)
    pa = f'{pa_match.group(1)}/{pa_match.group(2)}' if pa_match else None

    cnpj_match = re.search(r'CNPJ\s+B[AÁ]SICO\s*:\s*([0-9.\-/]{8,18})', joined, re.I)
    name_match = re.search(r'NOME\s+EMPRESARIAL\s*:\s*(.+?)(?:\s{2,}|\n|DATA\s+DE\s+ABERTURA)', joined, re.I)
    rbt12 = _row_value(lines, 'RBT12')
    if rbt12 is None:
        raise ValueError('RBT12 não encontrada no extrato. Confira se o PDF contém a página de Discriminação de Receitas.')

    revenues = _internal_revenues(joined)
    expected_months = _previous_months(pa) if pa else []
    calculated = sum(revenues[m] for m in expected_months) if expected_months and all(m in revenues for m in expected_months) else None
    monthly = [{'period': month, 'internalCents': revenues[month]} for month in sorted(
        revenues, key=lambda value: (int(value[3:]), int(value[:2])))]
    warnings = []
    if pa and calculated is None:
        missing = [month for month in expected_months if month not in revenues]
        warnings.append('Não foi possível reconciliar os 12 meses anteriores ao PA; competências ausentes na leitura: ' + ', '.join(missing) + '.')
    elif calculated is not None and calculated != rbt12:
        warnings.append('A soma das 12 competências anteriores ao PA diverge da RBT12 impressa; use a RBT12 impressa e revise o PDF.')

    result = {
        'parserVersion': PARSER_VERSION,
        'documentType': 'EXTRATO_SIMPLES_NACIONAL',
        'pa': pa,
        'cnpjBasico': re.sub(r'\D', '', cnpj_match.group(1)) if cnpj_match else None,
        'companyName': ' '.join(name_match.group(1).split()) if name_match else None,
        'rpaCents': _row_value(lines, 'RPA'),
        'rbt12Cents': rbt12,
        'rbaCents': _row_value(lines, 'RBA)'),
        'rbaaCents': _row_value(lines, 'RBAA'),
        'annualLimitCents': _row_value(lines, 'LIMITE DE RECEITA BRUTA PROPORCIONALIZADO'),
        'priorInternalRevenues': monthly,
        'rbt12CalculatedCents': calculated,
        'rbt12Reconciled': calculated == rbt12 if calculated is not None else None,
        'ocrUsed': bool(ocr_used),
        'ocrConfidence': round(float(ocr_confidence), 4) if ocr_confidence is not None else None,
        'warnings': warnings,
    }
    return result


def _ocr_lines(output):
    boxes = getattr(output, 'boxes', None)
    texts = getattr(output, 'txts', None)
    scores = getattr(output, 'scores', None)
    if boxes is None or texts is None:
        return [], []
    records = []
    for box, text, score in zip(boxes, texts, scores if scores is not None else [None] * len(texts)):
        if not text or not str(text).strip():
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        records.append({'x': min(xs), 'y': sum(ys) / len(ys), 'h': max(ys) - min(ys), 'text': str(text).strip(), 'score': score})
    if not records:
        return [], []
    records.sort(key=lambda row: (row['y'], row['x']))
    heights = sorted(row['h'] for row in records if row['h'] > 0)
    median_h = heights[len(heights) // 2] if heights else 14
    tolerance = max(5.0, median_h * 0.65)
    rows = []
    for record in records:
        if not rows or abs(record['y'] - rows[-1]['y']) > tolerance:
            rows.append({'y': record['y'], 'items': [record]})
        else:
            rows[-1]['items'].append(record)
            rows[-1]['y'] = sum(item['y'] for item in rows[-1]['items']) / len(rows[-1]['items'])
    text_rows = [' '.join(item['text'] for item in sorted(row['items'], key=lambda item: item['x'])) for row in rows]
    confidence = [float(row['score']) for row in records if row['score'] is not None]
    return text_rows, confidence


def extract_statement_pdf(content: bytes):
    """Lê PDF em memória. PDFs digitais usam texto nativo; scans usam RapidOCR na primeira página útil."""
    if not isinstance(content, (bytes, bytearray)) or not content.startswith(b'%PDF'):
        raise ValueError('Envie um arquivo PDF válido.')
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError('Leitor PDF indisponível no servidor.') from exc
    try:
        document = fitz.open(stream=content, filetype='pdf')
    except Exception as exc:
        raise ValueError('Não foi possível abrir o PDF enviado.') from exc
    if document.page_count < 1 or document.page_count > 30:
        raise ValueError('O extrato deve ter entre 1 e 30 páginas.')

    native = '\n'.join(document.load_page(i).get_text('text') for i in range(min(document.page_count, 3)))
    try:
        return parse_statement_text(native, ocr_used=False)
    except ValueError:
        pass

    try:
        import numpy as np
        from rapidocr import RapidOCR
    except ImportError as exc:
        raise RuntimeError('OCR indisponível no servidor para este PDF digitalizado.') from exc
    engine = RapidOCR()
    all_rows, all_scores = [], []
    # RBT12 e receitas anteriores ficam no início do extrato; limitar OCR reduz latência e memória.
    for index in range(min(document.page_count, 2)):
        page = document.load_page(index)
        pix = page.get_pixmap(matrix=fitz.Matrix(2.15, 2.15), colorspace=fitz.csRGB, alpha=False)
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        output = engine(np.ascontiguousarray(image[:, :, ::-1]))
        rows, scores = _ocr_lines(output)
        all_rows.extend(rows)
        all_scores.extend(scores)
        if any('RBT12' in _plain(row) for row in rows):
            # A primeira página útil contém a tabela necessária no modelo PGDAS-D.
            break
    if not all_rows:
        raise ValueError('O OCR não conseguiu reconhecer o conteúdo do extrato.')
    return parse_statement_text('\n'.join(all_rows), ocr_used=True,
                                ocr_confidence=mean(all_scores) if all_scores else None)
