import unittest
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from reporting.pdf_ocr import group_rows, native_page_text, searchable_pdf
from reporting.simples import convert_statement_pdf, parse_statement_text
from simples_extract_test import digital_pdf, sample


class PdfGeometryTests(unittest.TestCase):
    def test_telemetry_is_disabled_before_runtime_import_and_engine_initialization(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'onnxruntime.py').write_text(
                "import os\nassert os.environ.get('ORT_DISABLE_TELEMETRY') == '1'\n"
                "events = ['runtime_import']\n"
                "def disable_telemetry_events(): events.append('telemetry_disabled')\n")
            Path(directory, 'rapidocr.py').write_text(
                "from onnxruntime import events\n"
                "assert events == ['runtime_import', 'telemetry_disabled']\n"
                "events.append('ocr_import')\n"
                "class RapidOCR:\n"
                " def __init__(self, params):\n"
                "  assert events[-1] == 'ocr_import'\n"
                "  events.append('engine_initialized')\n")
            code = ("from reporting.pdf_ocr import _rapid_engine\n"
                    "engine = _rapid_engine()\nassert _rapid_engine() is engine\n"
                    "from onnxruntime import events\n"
                    "assert events == ['runtime_import', 'telemetry_disabled', 'ocr_import', 'engine_initialized']\n")
            # A fresh process proves import order, independent of test runner caches.
            env = {**os.environ, 'ORT_DISABLE_TELEMETRY': '0',
                   'PYTHONPATH': directory + os.pathsep + str(Path(__file__).resolve().parents[1])}
            result = subprocess.run([sys.executable, '-c', code], env=env, cwd=directory,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_cardinal_native_content_rotation_preserves_revenues_without_ocr(self):
        import fitz
        for angle in (0, 90, 180, 270):
            with self.subTest(angle=angle), fitz.open(stream=digital_pdf(), filetype='pdf') as source, fitz.open() as document:
                page = document.new_page(width=842 if angle % 180 else 595,
                                         height=595 if angle % 180 else 842)
                page.show_pdf_page(page.rect, source, 0, rotate=angle)
                content = document.tobytes()
                result, output, text = convert_statement_pdf(content, section_only=True,
                    ocr_engine=lambda _: self.fail('Native geometry must not need OCR'))
                self.assertEqual(result['rbt12Cents'], 16200000)
                self.assertFalse(result['ocrUsed'])
                self.assertEqual(text, native_page_text(page))
                with fitz.open(stream=output, filetype='pdf') as converted:
                    self.assertEqual(converted[0].get_pixmap().samples, page.get_pixmap().samples)
                    self.assertEqual(parse_statement_text(native_page_text(converted[0]))['rbt12Cents'], 16200000)

    def test_pdf_rotation_metadata_is_not_applied_twice_to_native_coordinates(self):
        import fitz
        for angle in (0, 90, 180, 270):
            with self.subTest(angle=angle), fitz.open(stream=digital_pdf(), filetype='pdf') as document:
                document[0].set_rotation(angle)
                converted = searchable_pdf(document.tobytes(),
                    engine=lambda _: self.fail('Native metadata rotation must not need OCR'))
                self.assertEqual(parse_statement_text(converted['text'])['rbt12Cents'], 16200000)
                with fitz.open(stream=converted['pdf'], filetype='pdf') as output:
                    self.assertEqual(output[0].rotation, angle)
                    self.assertEqual(output[0].get_pixmap().samples, document[0].get_pixmap().samples)

    def test_exact_duplicate_native_layer_does_not_duplicate_words_or_amounts(self):
        import fitz
        with fitz.open(stream=digital_pdf(), filetype='pdf') as document:
            for index, line in enumerate(sample().splitlines()):
                document[0].insert_text((30, 40 + index * 19), line, fontsize=9, render_mode=3)
            result, output, text = convert_statement_pdf(document.tobytes(), section_only=True,
                ocr_engine=lambda _: self.fail('An identical duplicate does not require OCR'))
            self.assertEqual(result['rbt12Cents'], 16200000)
            self.assertEqual(text.count('Extrato do Simples Nacional'), 1)
            self.assertEqual(text.count('2.2) Receitas Brutas Anteriores'), 1)
            with fitz.open(stream=output, filetype='pdf') as converted:
                self.assertEqual(converted[0].get_pixmap().samples, document[0].get_pixmap().samples)

    def test_deduplication_keeps_distinct_positions_conflicts_and_lowest_confidence(self):
        first = {'text': '8.000,00', 'box': [0, 0, 60, 10], 'confidence': .99}
        duplicate = {**first, 'confidence': .5}
        other_position = {**first, 'box': [100, 0, 160, 10]}
        conflict = {**first, 'text': '9.000,00'}
        rows = group_rows([first, duplicate, other_position, conflict])
        items = rows[0]['items']
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]['confidence'], .5)
        self.assertEqual(first['confidence'], .99, 'Input metadata remains unchanged.')
        self.assertEqual([item['text'] for item in items].count('8.000,00'), 2)
        self.assertIn('9.000,00', rows[0]['text'])

    def test_nearby_boxes_are_not_treated_as_exact_duplicates(self):
        first = {'text': '0,00', 'box': [0, 0, 40, 10], 'confidence': None}
        shifted = {**first, 'box': [.01, 0, 40.01, 10]}
        self.assertEqual(group_rows([first, shifted])[0]['text'], '0,00 0,00')

    def test_mixed_native_directions_are_not_reoriented_by_guess(self):
        import fitz
        from reporting.pdf_ocr import _native_items
        with fitz.open() as document:
            page = document.new_page()
            page.insert_text((30, 40), 'Texto horizontal sintético')
            page.insert_text((500, 400), 'Texto vertical sintético', rotate=90)
            words = page.get_text('words', sort=True)
            items = _native_items(page, words)
            self.assertEqual([item['box'] for item in items], [list(word[:4]) for word in words])


if __name__ == '__main__':
    unittest.main()
