"""PDF pesquisável integral, sem serviço externo, uma passagem OCR por página de imagem."""
from __future__ import annotations
from functools import lru_cache
from statistics import mean, median
import math
import threading
import time

# RapidOCR mutates its settings during calls. Serialize inference within each instance.
_OCR_LOCK = threading.Lock()
MAX_PAGES = 30
MAX_BYTES = 8 * 1024 * 1024


@lru_cache(maxsize=1)
def _rapid_engine():
    from rapidocr import RapidOCR
    return RapidOCR(params={
        'Global.log_level': 'error', 'Global.max_side_len': 3508,
        'Global.text_score': .5, 'Global.use_cls': False, 'Det.limit_side_len': 2400, 'Det.limit_type': 'max',
        'EngineConfig.onnxruntime.intra_op_num_threads': 2,
        'EngineConfig.onnxruntime.inter_op_num_threads': 1,
    })


def group_rows(items):
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


def searchable_pdf(content: bytes, *, force_ocr=False, engine=None, timeout_seconds=45, stop_when=None):
    """Process pages until complete or an optional caller-defined goal is met.

    The callback receives the processed page rows. Unprocessed pages are copied
    from the original PDF, preserving the complete document without extra OCR.
    """
    import fitz
    if not isinstance(content, (bytes, bytearray)) or not content.startswith(b'%PDF') or len(content) > MAX_BYTES:
        raise ValueError('Envie um PDF válido de até 8 MiB.')
    started = time.monotonic()
    with fitz.open(stream=content, filetype='pdf') as document, fitz.open() as output:
        if document.is_encrypted:
            raise ValueError('O PDF está protegido por senha. Envie uma cópia desbloqueada.')
        if not 1 <= len(document) <= MAX_PAGES:
            raise ValueError(f'O extrato deve ter entre 1 e {MAX_PAGES} páginas. Nenhuma página será ignorada.')
        pages, ocr_pages, scores, preserved_pages = [], [], [], []
        for index, original in enumerate(document):
            if time.monotonic() - started > timeout_seconds:
                if stop_when is not None:
                    raise ValueError('A leitura da seção 2.2 excedeu o tempo disponível. Nenhum resultado parcial foi utilizado.')
                raise ValueError('O OCR integral excedeu o tempo disponível. Use um PDF menor ou o conversor Python local; não foi aceito resultado parcial.')
            words = original.get_text('words', sort=True)
            readable = _native_text_is_complete(original, words)
            if readable and not force_ocr:
                items = [{'text': w[4], 'box': list(w[:4]), 'confidence': None} for w in words]
                output.insert_pdf(document, from_page=index, to_page=index)
            else:
                # Blank pages are preserved, never silently removed.
                scale = min(300 / 72, math.sqrt(12_000_000 / max(1, original.rect.width * original.rect.height)))
                pix = original.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                remaining = max(.1, timeout_seconds - (time.monotonic() - started))
                if not _OCR_LOCK.acquire(timeout=remaining):
                    raise ValueError('O leitor OCR está ocupado. Aguarde e tente novamente.')
                try:
                    records = _ocr_page(pix, engine)
                finally:
                    _OCR_LOCK.release()
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
        if time.monotonic() - started > timeout_seconds:
            if stop_when is not None:
                raise ValueError('A leitura da seção 2.2 excedeu o tempo disponível. Nenhum resultado parcial foi utilizado.')
            raise ValueError('O OCR integral excedeu o tempo disponível. Nenhum resultado parcial foi utilizado.')
        return {'pdf': output.tobytes(garbage=4, deflate=True),
                'text': '\n\n'.join('\n'.join(row['text'] for row in page['rows']) for page in pages),
                'pages': pages, 'pageCount': len(document), 'processedPages': len(pages),
                'preservedPages': preserved_pages, 'ocrPages': ocr_pages,
                'ocrConfidence': mean(scores) if scores else None, 'ocrEngine': 'RapidOCR' if ocr_pages else 'NATIVE'}
