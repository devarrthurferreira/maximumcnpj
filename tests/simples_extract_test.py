import json
import os
import unittest
from unittest.mock import patch
from reporting.simples import parse_statement_text, convert_statement_pdf, PARSER_VERSION


def money(cents):
    return f'{cents//100:,}'.replace(',', '.')+f',{cents%100:02d}'


def sample():
    months=[f'{i%12+1:02d}/{2025+i//12}' for i in range(19)]
    values=[(i+1)*100000 for i in range(19)]
    return '\n'.join([
      'Extrato do Simples Nacional', 'CNPJ Básico: 12.345.678 Nome Empresarial: EMPRESA SINTETICA',
      'Período de Apuração (PA): 08/2026', '2.1 Discriminativo de Receitas',
      'Mercado Interno Mercado Externo Total', 'RBT12 999.999.999,99 0,00 999.999.999,99',
      '2.2) Receitas Brutas Anteriores (R$)', '2.2.1) Mercado Interno',
      *[' '.join(f'{months[j]} {money(values[j])}' for j in range(i,min(i+4,19))) for i in range(0,19,4)],
      '2.2.2) Mercado Externo',
      *[' '.join(f'{months[j]} 0,00' for j in range(i,min(i+4,19))) for i in range(0,19,4)],
      '2.3) Folha de Salários Anteriores (R$)', '07/2026 999.999,99',
    ])


def digital_pdf():
    import fitz
    with fitz.open() as doc:
        page=doc.new_page()
        for i,line in enumerate(sample().splitlines()):
            page.insert_text((30,40+i*19),line,fontsize=9,fontname='helv')
        return doc.tobytes()


class SimplesExtractTests(unittest.TestCase):
    def test_only_section_22_even_when_21_disagrees(self):
        result=parse_statement_text(sample())
        self.assertEqual(result['rbt12Cents'],sum(i*100000 for i in range(8,20)))
        self.assertEqual(result['sourceSection'],'2.2')
        self.assertEqual(result['rbt12Basis']['startMonth'],'2025-08')
        self.assertEqual(result['rbt12Basis']['endMonth'],'2026-07')
        self.assertEqual(len(result['priorRevenues']),19)
        self.assertNotIn('rpaCents',result)

    def test_no_rbt12_label_or_section_21_needed(self):
        text=sample().replace('RBT12 999.999.999,99 0,00 999.999.999,99','')
        self.assertEqual(parse_statement_text(text)['rbt12Cents'],16200000)

    def test_external_revenue_is_not_discarded(self):
        text=sample().replace('08/2025 0,00','08/2025 1.234,56')
        result=parse_statement_text(text)
        self.assertEqual(result['rbt12Cents'],16323456)
        self.assertEqual(result['rbt12Basis']['externalCents'],123456)

    def test_absent_blank_illegible_and_conflicting_months_never_become_zero(self):
        base=sample()
        for text in [base.replace('08/2025 8.000,00',''),base.replace('08/2025 0,00','08/2025'),
                     base.replace('08/2025 0,00',"08/2025 00'0"),base.replace('08/2025 8.000,00','08/2025 8.000,00 08/2025 8.001,00'),
                     base.replace('08/2025 8.000,00','08/2025 -8.000,00'),base.replace('2.2.2) Mercado Externo','2.2.1) Mercado Externo')]:
            with self.subTest(text=text[-100:]):
                with self.assertRaises(ValueError):parse_statement_text(text)

    def test_missing_22_does_not_use_21_or_other_sections(self):
        with self.assertRaisesRegex(ValueError,'2.2'):
            parse_statement_text(sample().split('2.2)')[0])

    def test_pa_and_identity_must_be_explicit_and_unique(self):
        for text in [sample().replace('(PA): 08/2026','(PA): ilegível'),sample().replace('12.345.678','ilegível'),
                     sample()+'\nPeríodo de Apuração (PA): 09/2026',sample()+'\nCNPJ Básico: 87.654.321']:
            with self.assertRaises(ValueError):parse_statement_text(text)

    def test_month_of_pa_is_never_included(self):
        with self.assertRaisesRegex(ValueError,'PA'):
            parse_statement_text(sample().replace('2.2.2) Mercado Externo','08/2026 20.000,00\n2.2.2) Mercado Externo'))

    def test_native_pdf_is_searchable_and_no_ocr_called(self):
        def reject(*_):raise AssertionError('Native text must not be OCRed again')
        result,pdf,text=convert_statement_pdf(digital_pdf(),ocr_engine=reject)
        self.assertFalse(result['ocrUsed']);self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertTrue(pdf.startswith(b'%PDF'));self.assertIn('2.2)',text)

    def test_blank_page_is_preserved(self):
        import fitz
        from types import SimpleNamespace
        with fitz.open(stream=digital_pdf(),filetype='pdf') as doc:
            doc.new_page()
            content=doc.tobytes()
        empty=lambda _:SimpleNamespace(boxes=None,txts=None,scores=None)
        result,pdf,_=convert_statement_pdf(content,ocr_engine=empty)
        self.assertEqual(result['processedPages'],2)
        self.assertEqual(result['rbt12Cents'],16200000)
        with fitz.open(stream=pdf,filetype='pdf') as doc:
            self.assertEqual(len(doc),2)
            self.assertEqual(doc[1].get_text(),'')

    def test_all_pages_processed_not_just_first_rbt12_label(self):
        from reporting.pdf_ocr import group_rows
        converted={'pdf':b'%PDF-fixture','text':sample(),'ocrPages':[1,2,3],'pageCount':3,'ocrConfidence':.99,'ocrEngine':'MOCK',
                   'pages':[{'page':1,'rows':group_rows([{'text':line,'box':[0,i*20,500,i*20+10],'confidence':.99} for i,line in enumerate(sample().splitlines())])}]}
        with patch('reporting.pdf_ocr.searchable_pdf',return_value=converted):
            result,_,_=convert_statement_pdf(b'%PDF-fixture')
            self.assertEqual(result['processedPages'],3)
            converted['pages'][0]['rows'][8]['items'][0]['confidence']=.5
            with self.assertRaisesRegex(ValueError,'baixa confiança'):convert_statement_pdf(b'%PDF-fixture')

    @unittest.skipUnless(os.getenv('SIMPLES_TEST_OCR')=='1','Set SIMPLES_TEST_OCR=1 for a single real OCR regression')
    def test_image_pdf_real_ocr_and_searchable_layer(self):
        import fitz
        with fitz.open(stream=digital_pdf(),filetype='pdf') as native,fitz.open() as scan:
            page=scan.new_page()
            page.insert_image(page.rect,stream=native[0].get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'))
            image_pdf=scan.tobytes()
        result,pdf,text=convert_statement_pdf(image_pdf,timeout_seconds=90)
        self.assertTrue(result['ocrUsed']);self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['rbt12Cents'],16200000)
        with fitz.open(stream=pdf,filetype='pdf') as output:
            self.assertGreater(len(output[0].get_text()),100)
            self.assertIn('2.2',output[0].get_text())

if __name__=='__main__':unittest.main()
