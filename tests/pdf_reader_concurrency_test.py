"""Native PDF work is serialized without renewing the caller's time budget."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
import unittest
from unittest.mock import patch

from reporting import pdf_ocr
from reporting.simples import convert_statement_pdf, parse_statement_text
from simples_extract_test import digital_pdf, sample, scanned_pdf


class PdfReaderConcurrencyTests(unittest.TestCase):
    @contextmanager
    def occupied_reader(self, content, *, other_preflight_delay=0):
        """Pause the first real document during the section-only native preflight."""
        entered, release = threading.Event(), threading.Event()
        owner = []
        native = pdf_ocr.native_page_text

        def preflight(page):
            if not owner:
                owner.append(threading.get_ident())
            if threading.get_ident() == owner[0]:
                entered.set()
                if not release.wait(5):
                    raise AssertionError('The synthetic document was not released.')
            elif other_preflight_delay:
                threading.Event().wait(other_preflight_delay)
            return native(page)

        with patch.object(pdf_ocr, 'native_page_text', side_effect=preflight), \
                ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(convert_statement_pdf, content, section_only=True, timeout_seconds=5)
            try:
                self.assertTrue(entered.wait(3), 'The first document must reach native preflight.')
                yield release
            finally:
                release.set()
                result, output, _ = future.result(timeout=5)
                self.assertEqual(result['rbt12Cents'], 16200000)
                self.assertTrue(output.startswith(b'%PDF'))

    def test_statement_preflight_and_direct_conversion_share_one_native_guard(self):
        import fitz
        first = digital_pdf()
        second = digital_pdf(sample().replace('12.345.678', '87.654.321')
                             .replace('08/2025 8.000,00', '08/2025 8.001,00'))
        started, entered_native = threading.Event(), threading.Event()
        second_thread = []
        real_open = fitz.open

        def watched_open(*args, **kwargs):
            if second_thread and threading.get_ident() == second_thread[0]:
                entered_native.set()
            return real_open(*args, **kwargs)

        def second_reader():
            second_thread.append(threading.get_ident())
            started.set()
            return pdf_ocr.searchable_pdf(second, timeout_seconds=3)

        with patch('fitz.open', side_effect=watched_open), self.occupied_reader(first) as release, \
                ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(second_reader)
            try:
                self.assertTrue(started.wait(2))
                self.assertFalse(entered_native.wait(.1), 'Another request must not open a native PDF during preflight.')
            finally:
                release.set()
            converted = future.result(timeout=3)

        self.assertTrue(entered_native.is_set())
        result = parse_statement_text(converted['text'])
        self.assertEqual(result['cnpjBasico'], '87654321')
        self.assertEqual(result['rbt12Cents'], 16200100)
        self.assertTrue(converted['pdf'].startswith(b'%PDF'))

    def test_waiting_for_native_reader_expires_without_opening_another_document(self):
        import fitz
        content = digital_pdf()
        waiting_thread = threading.get_ident()
        entered_native = threading.Event()
        real_open = fitz.open

        def watched_open(*args, **kwargs):
            if threading.get_ident() == waiting_thread:
                entered_native.set()
            return real_open(*args, **kwargs)

        with patch('fitz.open', side_effect=watched_open), self.occupied_reader(content):
            with self.assertRaisesRegex(ValueError, 'leitor de PDF está ocupado'):
                convert_statement_pdf(content, section_only=True, timeout_seconds=.05)
            self.assertFalse(entered_native.is_set(), 'An expired waiter must not allocate or open a PDF.')

        # The timed-out waiter neither releases the owner's guard nor keeps it.
        result, _, _ = convert_statement_pdf(content, section_only=True, timeout_seconds=2)
        self.assertEqual(result['rbt12Cents'], 16200000)

    def test_wait_and_preflight_consume_the_same_conversion_budget(self):
        content = digital_pdf()
        started = threading.Event()

        def second_reader():
            started.set()
            return convert_statement_pdf(content, section_only=True, timeout_seconds=.5)

        with self.occupied_reader(content, other_preflight_delay=.3) as release, \
                ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(second_reader)
            try:
                self.assertTrue(started.wait(2))
                # Each phase fits on its own; together they exceed the caller's
                # original budget and must not yield a successful extraction.
                threading.Event().wait(.3)
            finally:
                release.set()
            with self.assertRaisesRegex(ValueError, 'tempo disponível|leitor de PDF está ocupado'):
                future.result(timeout=3)

    def test_expired_preflight_does_not_start_conversion_with_a_fresh_budget(self):
        content = digital_pdf()
        clock = [0.0]
        native = pdf_ocr.native_page_text

        def slow_preflight(page):
            text = native(page)
            clock[0] += 2
            return text

        with patch('reporting.pdf_ocr.time.monotonic', side_effect=lambda: clock[0]), \
                patch.object(pdf_ocr, 'native_page_text', side_effect=slow_preflight), \
                patch.object(pdf_ocr, 'searchable_pdf') as convert:
            with self.assertRaisesRegex(ValueError, 'seção 2.2 excedeu o tempo disponível'):
                convert_statement_pdf(content, section_only=True, timeout_seconds=1)
            convert.assert_not_called()

    def test_native_guard_is_released_after_preflight_or_inference_failure(self):
        import fitz
        good = digital_pdf()
        scanned = scanned_pdf()

        def broken_engine(_):
            raise RuntimeError('Synthetic inference failure')

        for name, content, engine, error in [
                ('preflight', b'%PDF-invalid-synthetic', None, fitz.FileDataError),
                ('inference', scanned, broken_engine, RuntimeError)]:
            with self.subTest(stage=name):
                with self.assertRaises(error):
                    convert_statement_pdf(content, section_only=True, ocr_engine=engine)
                # Another thread is essential: a leaked RLock would allow the
                # failed thread to reenter while keeping all other requests out.
                with ThreadPoolExecutor(max_workers=1) as pool:
                    result, output, _ = pool.submit(convert_statement_pdf, good,
                        section_only=True, timeout_seconds=2).result(timeout=3)
                self.assertEqual(result['rbt12Cents'], 16200000)
                self.assertTrue(output.startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
