"""PDF pesquisável integral, sem serviço externo, uma passagem OCR por página de imagem."""
from __future__ import annotations
import os

# ONNX Runtime 1DS must be disabled before importing or initializing the runtime.
# The reader processes private documents locally; telemetry is never permitted.
os.environ['ORT_DISABLE_TELEMETRY'] = '1'

from functools import lru_cache
from contextlib import contextmanager
from statistics import mean, median
import math
import threading
import time

# PyMuPDF and RapidOCR share native state within a worker. Protect the entire
# native operation, including text extraction and rasterization before inference.
# Reentrancy lets the statement reader include its preflight in the same guard.
_PDF_READER_LOCK = threading.RLock()
MAX_PAGES = 30
MAX_BYTES = 8 * 1024 * 1024


def remaining_pdf_time(deadline, *, section_only=False):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        if section_only:
            raise ValueError('A leitura da seção 2.2 excedeu o tempo disponível. Nenhum resultado parcial foi utilizado.')
        raise ValueError('O OCR integral excedeu o tempo disponível. Nenhum resultado parcial foi utilizado.')
    return remaining


@contextmanager
def pdf_reader_guard(timeout_seconds, *, deadline=None, section_only=False):
    requested_deadline = time.monotonic() + timeout_seconds
    deadline = requested_deadline if deadline is None else min(deadline, requested_deadline)
    remaining = remaining_pdf_time(deadline, section_only=section_only)
    if not _PDF_READER_LOCK.acquire(timeout=remaining):
        raise ValueError('O leitor de PDF está ocupado. Aguarde e tente novamente; nenhum resultado parcial foi utilizado.')
    try:
        remaining_pdf_time(deadline, section_only=section_only)
        yield deadline
    finally:
        _PDF_READER_LOCK.release()


@lru_cache(maxsize=1)
def _rapid_engine():
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from rapidocr import RapidOCR
    return RapidOCR(params={
        'Global.log_level': 'error', 'Global.max_side_len': 3508,
        'Global.text_score': .5, 'Global.use_cls': False, 'Det.limit_side_len': 2400, 'Det.limit_type': 'max',
        'EngineConfig.onnxruntime.intra_op_num_threads': 2,
        'EngineConfig.onnxruntime.inter_op_num_threads': 1,
    })


def _deduplicate_items(items):
    """Collapse only identical text at exactly the same coordinates."""
    unique = {}
    for item in items:
        key = (item['text'], *item['box'])
        if key not in unique:
            unique[key] = dict(item)
        else:
            # A duplicate with lower OCR confidence must still block confirmation.
            scores = [record.get('confidence') for record in (unique[key], item)
                      if record.get('confidence') is not None]
            unique[key]['confidence'] = min(scores) if scores else None
    return list(unique.values())


def group_rows(items):
    items = _deduplicate_items(items)
    if not items:
        return []
    ordered = sorted(items, key=lambda item: ((item['box'][1] + item['box'][3]) / 2, item['box'][0]))
    height = median(item['box'][3] - item['box'][1] for item in ordered)
    tolerance = max(1, height * .4)
    rows = []
    for item in ordered:
        y = (item['box'][1] + item['box'][3]) / 2
        if not rows or abs(rows[-1]['y'] - y) > tolerance:
            rows.append({'y': y, 'items': [item]})
        else:
            rows[-1]['items'].append(item)
    for row in rows:
        row['items'].sort(key=lambda item: item['box'][0])
        row['text'] = ' '.join(item['text'] for item in row['items'])
    return rows


def _native_items(page, words):
    """Normalize a uniformly rotated native text layout without touching its text."""
    import fitz
    directions = set()
    layout = page.get_text('dict', flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
    for block in layout.get('blocks', []):
        for line in block.get('lines', []):
            if not any(span.get('text', '').strip() for span in line.get('spans', [])):
                continue
            x, y = line.get('dir', (1, 0))
            angle = math.degrees(math.atan2(y, x))
            cardinal = round(angle / 90) * 90
            if abs(angle - cardinal) > .01:
                directions.add(None)
            else:
                directions.add(cardinal % 360)
    # Mixed orientations and non-cardinal skew are not guessed. PDF page rotation
    # metadata is already excluded from native coordinates by PyMuPDF.
    angle = next(iter(directions)) if len(directions) == 1 else None
    matrix = fitz.Matrix(1, 1).prerotate(-angle) if angle else None
    return _deduplicate_items([{'text': word[4],
        'box': list(fitz.Rect(word[:4]) * matrix) if matrix else list(word[:4]),
        'confidence': None} for word in words])


def native_page_text(page):
    """Use the same native reading order for conversion and preserved-page checks."""
    return '\n'.join(row['text'] for row in group_rows(_native_items(page, page.get_text('words', sort=True))))


def _ocr_page(pix, engine):
    import numpy as np
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    # Empty pages do not need an OCR model (or a cold-start initialization).
    if int(image.max()) - int(image.min()) < 2:
        return []
    result = (engine or _rapid_engine())(np.ascontiguousarray(image[:, :, ::-1]))
    boxes, texts, scores = result.boxes, result.txts, result.scores
    if boxes is None or texts is None or scores is None or not len(texts) or not (len(boxes) == len(texts) == len(scores)):
        raise ValueError('OCR não reconheceu texto nesta página. Reenvie uma digitalização legível.')
    records = []
    for box, text, score in zip(boxes, texts, scores):
        xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
        if str(text).strip():
            records.append({'text': str(text).strip(), 'confidence': float(score),
                            'box': [min(xs), min(ys), max(xs), max(ys)]})
    return records


def _native_text_is_complete(page, words):
    """A digital header/footer does not make an image of a table readable."""
    import fitz
    if len(words) < 8 or '\ufffd' in page.get_text():
        return False
    page_area = max(1, page.rect.get_area())
    for image in page.get_image_info():
        region = fitz.Rect(image['bbox']) & page.rect
        # Logos and small decorative images never trigger a full-page OCR.
        if region.is_empty or region.get_area() < page_area * .2:
            continue
        native_words = sum(1 for word in words if region.contains(fitz.Point(
            (word[0] + word[2]) / 2, (word[1] + word[3]) / 2)))
        # A large scanned region with only a few native words is incomplete.
        # Complete text layers stay native; sparse layers are replaced by OCR.
        if native_words < 40:
            return False
    return True


def searchable_pdf(content: bytes, *, force_ocr=False, engine=None, timeout_seconds=45, stop_when=None, _deadline=None):
    """Process pages until complete or an optional caller-defined goal is met.

    The callback receives the processed page rows. Unprocessed pages are copied
    from the original PDF, preserving the complete document without extra OCR.
    """
    with pdf_reader_guard(timeout_seconds, deadline=_deadline, section_only=stop_when is not None) as deadline:
        return _searchable_pdf(content, force_ocr=force_ocr, engine=engine, deadline=deadline, stop_when=stop_when)


def _searchable_pdf(content, *, force_ocr, engine, deadline, stop_when):
    import fitz
    if not isinstance(content, (bytes, bytearray)) or not content.startswith(b'%PDF') or len(content) > MAX_BYTES:
        raise ValueError('Envie um PDF válido de até 8 MiB.')
    remaining_pdf_time(deadline, section_only=stop_when is not None)
    with fitz.open(stream=content, filetype='pdf') as document, fitz.open() as output:
        if document.is_encrypted:
            raise ValueError('O PDF está protegido por senha. Envie uma cópia desbloqueada.')
        if not 1 <= len(document) <= MAX_PAGES:
            raise ValueError(f'O extrato deve ter entre 1 e {MAX_PAGES} páginas. Nenhuma página será ignorada.')
        pages, ocr_pages, scores, preserved_pages = [], [], [], []
        for index, original in enumerate(document):
            remaining_pdf_time(deadline, section_only=stop_when is not None)
            words = original.get_text('words', sort=True)
            readable = _native_text_is_complete(original, words)
            if readable and not force_ocr:
                items = _native_items(original, words)
                output.insert_pdf(document, from_page=index, to_page=index)
            else:
                # Blank pages are preserved, never silently removed.
                scale = min(300 / 72, math.sqrt(12_000_000 / max(1, original.rect.width * original.rect.height)))
                pix = original.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                remaining_pdf_time(deadline, section_only=stop_when is not None)
                records = _ocr_page(pix, engine)
                remaining_pdf_time(deadline, section_only=stop_when is not None)
                xscale, yscale = original.rect.width / pix.width, original.rect.height / pix.height
                items = [{**r, 'box': [r['box'][0]*xscale, r['box'][1]*yscale, r['box'][2]*xscale, r['box'][3]*yscale]} for r in records]
                target = output.new_page(width=original.rect.width, height=original.rect.height)
                if not words and original.get_contents():
                    target.show_pdf_page(target.rect, document, index)
                else:
                    # Forced OCR must not expose a second, stale native text layer.
                    target.insert_image(target.rect, stream=pix.tobytes('jpg', jpg_quality=92))
                for row in group_rows(items):
                    for item in row['items']:
                        x0, y0, x1, y1 = item['box']
                        text = item['text'].encode('cp1252', errors='replace').decode('cp1252')
                        width_at_one = fitz.get_text_length(text, fontname='helv', fontsize=1)
                        size = min((y1-y0)*.8, (x1-x0)/max(.01, width_at_one))
                        if size > 0:
                            target.insert_text((x0, y1-(y1-y0)*.15), text, fontsize=size, fontname='helv', render_mode=3, overlay=True)
                ocr_pages.append(index + 1)
                scores.extend(r['confidence'] for r in items)
            pages.append({'page': index + 1, 'rows': group_rows(items)})
            if stop_when is not None and stop_when(pages):
                if index + 1 < len(document):
                    output.insert_pdf(document, from_page=index + 1, to_page=len(document) - 1)
                    preserved_pages = list(range(index + 2, len(document) + 1))
                break
        remaining_pdf_time(deadline, section_only=stop_when is not None)
        pdf = output.tobytes(garbage=4, deflate=True)
        remaining_pdf_time(deadline, section_only=stop_when is not None)
        return {'pdf': pdf,
                'text': '\n\n'.join('\n'.join(row['text'] for row in page['rows']) for page in pages),
                'pages': pages, 'pageCount': len(document), 'processedPages': len(pages),
                'preservedPages': preserved_pages, 'ocrPages': ocr_pages,
                'ocrConfidence': mean(scores) if scores else None, 'ocrEngine': 'RapidOCR' if ocr_pages else 'NATIVE'}
