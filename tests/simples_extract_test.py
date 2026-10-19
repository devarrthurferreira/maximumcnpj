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


def declaration_sample():
    """Anonymized PGDAS-D declaration layout with the same synthetic revenues."""
    return (sample().replace('Extrato do Simples Nacional',
            'Programa Gerador do Documento de Arrecadação\ndo Simples Nacional - Declaratório\nDeclaração Original')
            .replace('CNPJ Básico: 12.345.678', 'CNPJ Matriz: 12.345.678/0001-00')
            .replace('Período de Apuração (PA): 08/2026', 'Período de Apuração: 01/08/2026 a 31/08/2026'))


def digital_pdf(text=None):
    import fitz
    with fitz.open() as doc:
        page=doc.new_page()
        for i,line in enumerate((sample() if text is None else text).splitlines()):
            page.insert_text((30,40+i*19),line,fontsize=9,fontname='helv')
        return doc.tobytes()


def scanned_pdf(*, native_footer=False):
    import fitz
    with fitz.open(stream=digital_pdf(),filetype='pdf') as native,fitz.open() as scan:
        page=scan.new_page()
        page.insert_image(page.rect,stream=native[0].get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png'))
        if native_footer:
            page.insert_text((30,790),'Arquivo digitalizado pelo sistema da empresa para consulta de documento fiscal',fontsize=9)
        return scan.tobytes()


def paged_pdf(*texts, scanned_tail=True):
    """Synthetic pages with a non-text tail that must not need OCR for 2.2."""
    import fitz
    with fitz.open() as doc:
        for text in texts:
            page=doc.new_page()
            for i,line in enumerate(text.splitlines()):
                page.insert_text((30,40+i*19),line,fontsize=9,fontname='helv')
        if scanned_tail:
            page=doc.new_page()
            page.draw_rect(fitz.Rect(50,50,400,300),color=(0,0,0),fill=(.5,.5,.5))
        return doc.tobytes()


class SimplesExtractTests(unittest.TestCase):
    def test_cnpj_punctuation_can_be_separate_tokens_without_changing_digits(self):
        for text in [sample().replace('12.345.678', '12 . 345 . 678'),
                     declaration_sample().replace('12.345.678/0001-00', '12 . 345 . 678 / 0001 - 00'),
                     declaration_sample().replace('12.345.678/0001-00', '12.345.678 /\n0001 - 00')]:
            with self.subTest(text=text[:180]):
                result = parse_statement_text(text)
                self.assertEqual(result['cnpjBasico'], '12345678')
                self.assertEqual(result['rbt12Cents'], 16200000)
        for invalid in ['12 . 345 . 67', '12 . 345 . 6789', '12 . 34S . 678', '12 . 345 . 67 8']:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'CNPJ'):
                parse_statement_text(sample().replace('12.345.678', invalid))
        for invalid in ['12 . 345 . 678 / 0001 - 0', '12 . 345 . 678 / 0001 - 000', '12 . 345 . 678 / 0001 - O0']:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'CNPJ'):
                parse_statement_text(declaration_sample().replace('12.345.678/0001-00', invalid))
        with self.assertRaisesRegex(ValueError, 'CNPJ'):
            parse_statement_text(sample() + '\nCNPJ Básico: 87 . 654 . 321')

    def test_pa_rejects_truncated_year_and_extra_date_components(self):
        for invalid in ['08/202600', '08/2026/01', '08/2026 / 01', '08/2026X']:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'PA'):
                parse_statement_text(sample().replace('(PA): 08/2026', '(PA): ' + invalid))
        for invalid in ['31/08/202600', '31/08/2026/01', '31/08/2026 / 01']:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'PA'):
                parse_statement_text(declaration_sample().replace('31/08/2026', invalid))

    def test_continuation_metadata_is_not_a_revenue_competence(self):
        base = sample()
        cut = base.index('09/2025')
        header = ('Extrato do Simples Nacional\nCNPJ Básico: 12 . 345 . 678\n'
                  'Período de Apuração (PA): 08/2026\n'
                  '2.2) Receitas Brutas Anteriores (R$)\n2.2.1) Mercado Interno\n')
        for text in [base[:cut] + '\n' + header + base[cut:],
                     base[:cut] + '\n' + header.replace('Período de Apuração (PA): 08/2026',
                         'Período de Apuração: 01/08/2026 a 31/08/2026') + base[cut:]]:
            result = parse_statement_text(text)
            self.assertEqual(result['rbt12Cents'], 16200000)
            self.assertEqual(len(result['priorRevenues']), 19)
        result, _, _ = convert_statement_pdf(paged_pdf(base[:cut], header + base[cut:], scanned_tail=False),
            section_only=True, ocr_engine=lambda _: self.fail('Native continuation does not need OCR'))
        self.assertEqual(result['processedPages'], 2)
        self.assertEqual(result['rbt12Cents'], 16200000)
        for conflict in [header.replace('08/2026', '07/2026'), header.replace('12 . 345 . 678', '87 . 654 . 321')]:
            with self.assertRaises(ValueError):
                parse_statement_text(base[:cut] + '\n' + conflict + base[cut:])

    def test_next_section_without_parenthesis_stops_before_payroll_but_not_money(self):
        for heading in ['2.3 Folha', '2.3\nFolha', '2 . 3 Folha']:
            with self.subTest(heading=heading):
                self.assertEqual(parse_statement_text(sample().replace('2.3) Folha', heading))['rbt12Cents'], 16200000)
        # A monetary token at the start of a wrapped line is not a section label.
        text = sample().replace('08/2025 8.000,00', '08/2025\n2.300,00')
        self.assertEqual(parse_statement_text(text)['rbt12Cents'], 15630000)

    def test_wrapped_sections_and_competences_keep_ocr_confidence_gate(self):
        from reporting.pdf_ocr import group_rows
        cases = [
            (sample().replace('2.2) Receitas', '2.2)\nReceitas')
                .replace('2.2.1) Mercado', '2.2.1)\nMercado')
                .replace('2.2.2) Mercado', '2.2.2)\nMercado'), '05/2025'),
            (sample().replace('08/2025 8.000,00', '08/\n2025\n8.000,00'), '2025'),
            (sample().replace('12.345.678', '12 . 345 .\n678'), '678'),
        ]
        for text, critical in cases:
            rows = group_rows([{'text': line, 'box': [0, i * 20, 500, i * 20 + 10], 'confidence': .99}
                               for i, line in enumerate(text.splitlines())])
            converted = {'pdf': b'%PDF-fixture', 'text': text, 'ocrPages': [1], 'pageCount': 1,
                         'ocrConfidence': .98, 'ocrEngine': 'MOCK', 'pages': [{'page': 1, 'rows': rows}]}
            with self.subTest(critical=critical), patch('reporting.pdf_ocr.searchable_pdf', return_value=converted):
                self.assertEqual(convert_statement_pdf(b'%PDF-fixture')[0]['rbt12Cents'], 16200000)
                matched = [row for row in rows if row['text'].startswith(critical)]
                self.assertTrue(matched)
                for row in matched:
                    row['items'][0]['confidence'] = .4
                with self.assertRaisesRegex(ValueError, 'baixa confiança'):
                    convert_statement_pdf(b'%PDF-fixture')

    def test_pgdas_declaration_uses_date_range_and_matriz_with_same_22_basis(self):
        result=parse_statement_text(declaration_sample())
        self.assertEqual(result['documentType'],'PGDAS_D_DECLARACAO')
        self.assertEqual(result['pa'],'08/2026')
        self.assertEqual(result['cnpjBasico'],'12345678')
        self.assertEqual(result['companyName'],'EMPRESA SINTETICA')
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertEqual(result['rbt12Basis'],parse_statement_text(sample())['rbt12Basis'])
        self.assertEqual(result['parserVersion'],PARSER_VERSION)

    def test_declaration_pdf_preserves_pages_after_complete_section(self):
        def reject(*_):raise AssertionError('Native declaration and unrelated tail do not need OCR')
        result,pdf,text=convert_statement_pdf(paged_pdf(declaration_sample()),section_only=True,ocr_engine=reject)
        self.assertEqual(result['documentType'],'PGDAS_D_DECLARACAO')
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertFalse(result['ocrUsed'])
        self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['preservedPages'],[2])
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertIn('Programa Gerador',text)

    def test_declaration_requires_explicit_title_full_matriz_and_valid_month_range(self):
        base=declaration_sample()
        invalid=[base.replace('do Simples Nacional - Declaratório','de outro programa'),
                 base.replace('12.345.678/0001-00','12.345.678/0001'),
                 base.replace('01/08/2026 a 31/08/2026','01/08/2026 a 31/09/2026'),
                 base.replace('01/08/2026 a 31/08/2026','01/02/2026 a 30/02/2026'),
                 base.replace('01/08/2026 a 31/08/2026','02/08/2026 a 31/08/2026'),
                 base.replace('01/08/2026 a 31/08/2026','01/08/2026 a 30/08/2026'),
                 base.replace('01/08/2026 a 31/08/2026','31/08/2026 a 01/08/2026')]
        for text in invalid:
            with self.subTest(text=text[:250]), self.assertRaises(ValueError):
                parse_statement_text(text)

    def test_declaration_checks_conflicts_between_both_metadata_formats(self):
        for extra in ['Período de Apuração (PA): 07/2026',
                      'Período de Apuração: 01/07/2026 a 31/07/2026',
                      'CNPJ Básico: 87.654.321', 'CNPJ Matriz: 87.654.321/0001-00',
                      'CNPJ Matriz: 12.345.678/0002-00']:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                parse_statement_text(declaration_sample()+'\n'+extra)
        same=declaration_sample()+'\nCNPJ Básico: 12.345.678\nPeríodo de Apuração (PA): 08/2026'
        self.assertEqual(parse_statement_text(same)['rbt12Cents'],16200000)
        self.assertEqual(parse_statement_text(declaration_sample().replace('12.345.678/0001-00','12345678000100'))['cnpjBasico'],'12345678')

    def test_declaration_identity_on_preserved_pages_is_still_checked(self):
        for extra in ['Período de Apuração (PA): 07/2026', 'CNPJ Básico: 87.654.321',
                      'Período de Apuração: 01/07/2026 a 31/07/2026', 'CNPJ Matriz: 87.654.321/0001-00']:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                convert_statement_pdf(paged_pdf(declaration_sample(),extra),section_only=True)

    def test_declaration_ocr_metadata_confidence_is_required(self):
        from reporting.pdf_ocr import group_rows
        for critical in ['CNPJ Matriz:', 'Período de Apuração:']:
            rows=group_rows([{'text':line,'box':[0,i*20,500,i*20+10],
                             'confidence':.6 if line.startswith(critical) else .99}
                            for i,line in enumerate(declaration_sample().splitlines())])
            converted={'pdf':b'%PDF-fixture','text':declaration_sample(),'ocrPages':[1],'pageCount':1,
                       'ocrConfidence':.98,'ocrEngine':'MOCK','pages':[{'page':1,'rows':rows}]}
            with self.subTest(critical=critical), patch('reporting.pdf_ocr.searchable_pdf',return_value=converted):
                with self.assertRaisesRegex(ValueError,'baixa confiança'):
                    convert_statement_pdf(b'%PDF-fixture')

    def test_wrapped_ocr_pa_and_identity_values_keep_confidence_gate(self):
        from reporting.pdf_ocr import group_rows
        cases=[(sample().replace('Período de Apuração (PA):', 'Período de Apuração\n( PA ):'), '( PA ):'),
               (declaration_sample().replace('Período de Apuração: ', 'Período de Apuração:\n'), '01/08/2026'),
               (declaration_sample().replace(' a 31/08/2026', ' a\n31/08/2026'), '31/08/2026'),
               (sample().replace('CNPJ Básico: ', 'CNPJ Básico:\n'), '12.345.678'),
               (declaration_sample().replace('CNPJ Matriz: ', 'CNPJ Matriz:\n'), '12.345.678/0001-00')]
        for text, critical in cases:
            rows=group_rows([{'text':line,'box':[0,i*20,500,i*20+10],'confidence':.99}
                            for i,line in enumerate(text.splitlines())])
            converted={'pdf':b'%PDF-fixture','text':text,'ocrPages':[1],'pageCount':1,
                       'ocrConfidence':.98,'ocrEngine':'MOCK','pages':[{'page':1,'rows':rows}]}
            with self.subTest(critical=critical), patch('reporting.pdf_ocr.searchable_pdf',return_value=converted):
                self.assertEqual(convert_statement_pdf(b'%PDF-fixture')[0]['rbt12Cents'],16200000)
                for row in rows:
                    if row['text'].startswith(critical):
                        row['items'][0]['confidence']=.6
                with self.assertRaisesRegex(ValueError,'baixa confiança'):
                    convert_statement_pdf(b'%PDF-fixture')

    def test_fragmented_or_contaminated_money_never_uses_a_numeric_suffix(self):
        for amount in ['8 000,00','8\n000,00','8O00,00','8.000,00x','8.000,00 5','R$ 8 000,00',
                       '8.000,00\n5', '8.000,00\n,50', '8.000,00\n1']:
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                parse_statement_text(sample().replace('08/2025 8.000,00','08/2025 '+amount))
        valid=sample().replace('08/2025 8.000,00','08/2025 R$ 8000,00')
        self.assertEqual(parse_statement_text(valid)['rbt12Cents'],16200000)

    def test_joined_amount_and_next_competence_only_adds_a_cell_separator(self):
        import re
        expected = parse_statement_text(sample())
        joined = re.sub(r'(\d,\d{2}) (?=(?:0[1-9]|1[0-2])/20\d{2})', r'\1', sample())
        result = parse_statement_text(joined)
        self.assertEqual(result['priorRevenues'], expected['priorRevenues'])
        self.assertEqual(result['rbt12Window'], expected['rbt12Window'])
        self.assertEqual(result['rbt12Cents'], 16200000)
        # Unsupported dates or extra decimal digits must not be guessed/repaired.
        for invalid in ['7.000,0013/2025', '7.000,00008/2025', '7.000,0008/202500',
                        '7.000,0008/2025/01', '7.000,0008/2025X']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_statement_text(sample().replace('7.000,00 08/2025', invalid))

    def test_joined_cell_confidence_covers_value_and_wrapped_competence(self):
        from reporting.pdf_ocr import group_rows
        for text, critical in [
            (sample().replace('7.000,00 08/2025', '7.000,0008/2025'), '05/2025'),
            (sample().replace('7.000,00 08/2025', '7.000,0008/\n2025'), '2025'),
        ]:
            rows = group_rows([{'text': line, 'box': [0, i * 20, 500, i * 20 + 10], 'confidence': .99}
                               for i, line in enumerate(text.splitlines())])
            converted = {'pdf': b'%PDF-fixture', 'text': text, 'ocrPages': [1], 'pageCount': 1,
                         'ocrConfidence': .98, 'ocrEngine': 'MOCK', 'pages': [{'page': 1, 'rows': rows}]}
            with self.subTest(critical=critical), patch('reporting.pdf_ocr.searchable_pdf', return_value=converted):
                self.assertEqual(convert_statement_pdf(b'%PDF-fixture')[0]['rbt12Cents'], 16200000)
                matched = [row for row in rows if row['text'].startswith(critical)]
                self.assertTrue(matched)
                for row in matched:
                    row['items'][0]['confidence'] = .4
                with self.assertRaisesRegex(ValueError, 'baixa confiança'):
                    convert_statement_pdf(b'%PDF-fixture')

    def test_known_page_footers_are_tolerated_but_cannot_hide_numeric_fragments(self):
        footers = [
            'Emitido em 02/10/2026 às 08:20', 'Página 1 de 3',
            'Número da Declaração: 12345678202608001 Número do Recibo: 01.02.34567.8901234-5',
            'Autenticação: 12345.67890.12345.67890 Página 1',
        ]
        for footer in footers:
            text = sample().replace('2.2.2) Mercado Externo', footer + '\n2.2.2) Mercado Externo')
            with self.subTest(footer=footer):
                self.assertEqual(parse_statement_text(text)['rbt12Cents'], 16200000)
                for extra in [' 5', '\n,50']:
                    with self.assertRaises(ValueError):
                        parse_statement_text(text.replace(footer, footer + extra))

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

    def test_full_issue_date_in_page_footer_is_not_a_revenue_month(self):
        for date in ['02/10/2026', '02 / 10 / 2026']:
            with self.subTest(date=date):
                text=sample().replace('2.2.2) Mercado Externo',f'Emitido em {date} às 08:20\n2.2.2) Mercado Externo')
                result=parse_statement_text(text)
                self.assertEqual(result['rbt12Cents'],16200000)
                self.assertEqual(len(result['priorRevenues']),19)

    def test_native_pdf_is_searchable_and_no_ocr_called(self):
        def reject(*_):raise AssertionError('Native text must not be OCRed again')
        result,pdf,text=convert_statement_pdf(digital_pdf(),ocr_engine=reject)
        self.assertFalse(result['ocrUsed']);self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertTrue(pdf.startswith(b'%PDF'));self.assertIn('2.2)',text)

    def test_blank_page_is_preserved(self):
        import fitz
        with fitz.open(stream=digital_pdf(),filetype='pdf') as doc:
            doc.new_page()
            content=doc.tobytes()
        with patch('reporting.pdf_ocr._rapid_engine',side_effect=AssertionError('Blank pages do not need a model')):
            result,pdf,_=convert_statement_pdf(content)
        self.assertEqual(result['processedPages'],2)
        self.assertEqual(result['rbt12Cents'],16200000)
        with fitz.open(stream=pdf,filetype='pdf') as doc:
            self.assertEqual(len(doc),2)
            self.assertEqual(doc[1].get_text(),'')

    def test_image_with_native_footer_is_ocr_processed(self):
        from types import SimpleNamespace
        lines=sample().splitlines()
        boxes=[[[100,100+i*50],[2200,100+i*50],[2200,135+i*50],[100,135+i*50]] for i in range(len(lines))]
        with patch('reporting.pdf_ocr._rapid_engine') as factory:
            factory.return_value.return_value=SimpleNamespace(boxes=boxes,txts=lines,scores=[.99]*len(lines))
            result,_,text=convert_statement_pdf(scanned_pdf(native_footer=True))
            factory.return_value.assert_called_once()
            self.assertTrue(result['ocrUsed'])
            self.assertEqual(result['rbt12Cents'],16200000)
            self.assertIn('2.2) Receitas Brutas Anteriores',text)

    def test_mismatched_ocr_records_are_not_silently_truncated(self):
        from types import SimpleNamespace
        engine=lambda _:SimpleNamespace(boxes=[],txts=['123,45'],scores=[.99])
        with self.assertRaisesRegex(ValueError,'OCR não reconheceu'):
            convert_statement_pdf(scanned_pdf(),ocr_engine=engine)

    def test_all_pages_processed_not_just_first_rbt12_label(self):
        from reporting.pdf_ocr import group_rows
        converted={'pdf':b'%PDF-fixture','text':sample(),'ocrPages':[1,2,3],'pageCount':3,'ocrConfidence':.99,'ocrEngine':'MOCK',
                   'pages':[{'page':1,'rows':group_rows([{'text':line,'box':[0,i*20,500,i*20+10],'confidence':.99} for i,line in enumerate(sample().splitlines())])}]}
        with patch('reporting.pdf_ocr.searchable_pdf',return_value=converted):
            result,_,_=convert_statement_pdf(b'%PDF-fixture')
            self.assertEqual(result['processedPages'],3)
            converted['pages'][0]['rows'][8]['items'][0]['confidence']=.5
            with self.assertRaisesRegex(ValueError,'baixa confiança'):convert_statement_pdf(b'%PDF-fixture')

    def test_footer_issue_date_confidence_is_not_a_fiscal_value(self):
        from reporting.pdf_ocr import group_rows
        text=sample().replace('2.2.2) Mercado Externo','Emitido em 02/10/2026 às 08:20\n2.2.2) Mercado Externo')
        rows=group_rows([{'text':line,'box':[0,i*20,500,i*20+10],
                         'confidence':.6 if line.startswith('Emitido em') else .99}
                        for i,line in enumerate(text.splitlines())])
        converted={'pdf':b'%PDF-fixture','text':text,'ocrPages':[1],'pageCount':1,'ocrConfidence':.98,'ocrEngine':'MOCK',
                   'pages':[{'page':1,'rows':rows}]}
        with patch('reporting.pdf_ocr.searchable_pdf',return_value=converted):
            self.assertEqual(convert_statement_pdf(b'%PDF-fixture')[0]['rbt12Cents'],16200000)

    def test_section_mode_skips_unrelated_ocr_and_preserves_original_pages(self):
        import fitz
        content=paged_pdf(sample())
        def reject(*_):raise AssertionError('Unrelated tail page must not run OCR')
        result,pdf,text=convert_statement_pdf(content,section_only=True,ocr_engine=reject)
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertEqual(result['pageCount'],2)
        self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['processedPageNumbers'],[1])
        self.assertEqual(result['preservedPages'],[2])
        self.assertEqual(result['searchablePdfScope'],'SELECTED_PAGES')
        self.assertEqual(result['extractionScope'],'SECTION_22')
        with fitz.open(stream=content,filetype='pdf') as original,fitz.open(stream=pdf,filetype='pdf') as output:
            self.assertEqual(len(output),len(original))
            self.assertEqual(output[1].get_pixmap().samples,original[1].get_pixmap().samples)

    def test_section_mode_follows_both_tables_across_pages(self):
        internal,external=sample().split('2.2.2) Mercado Externo')
        result,_,_=convert_statement_pdf(paged_pdf(internal,'2.2.2) Mercado Externo'+external),section_only=True,
            ocr_engine=lambda _:self.fail('Tail OCR must not run'))
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertEqual(result['processedPages'],2)
        self.assertEqual(result['preservedPages'],[3])

    def test_section_mode_does_not_stop_before_boundary_or_accept_later_conflict(self):
        complete=sample().split('2.3)')[0]
        conflict='08/2025 1,00\n2.3) Folha de Salários Anteriores\nSem outras receitas neste documento fiscal de teste'
        with self.assertRaisesRegex(ValueError,'conflitantes'):
            convert_statement_pdf(paged_pdf(complete,conflict),section_only=True)

    def test_section_mode_missing_values_still_block_at_boundary(self):
        with self.assertRaisesRegex(ValueError,'ausentes'):
            convert_statement_pdf(paged_pdf(sample().replace('08/2025 8.000,00','')),section_only=True,
                ocr_engine=lambda _:self.fail('An incomplete section must not start unrelated OCR'))

    def test_section_mode_checks_native_identity_on_preserved_pages(self):
        other='CNPJ Básico: 87.654.321 Nome Empresarial: OUTRA EMPRESA SINTETICA\nDados de outra empresa não podem ser aceitos'
        with self.assertRaisesRegex(ValueError,'CNPJ'):
            convert_statement_pdf(paged_pdf(sample(),other),section_only=True)

    def test_section_mode_reads_later_native_section_for_conflicts(self):
        other=sample().replace('08/2025 8.000,00','08/2025 8.001,00')
        with self.assertRaisesRegex(ValueError,'conflitantes'):
            convert_statement_pdf(paged_pdf(sample(),other),section_only=True)

    def test_section_mode_accepts_eof_after_complete_tables(self):
        result,_,_=convert_statement_pdf(paged_pdf(sample().split('2.3)')[0],scanned_tail=False),section_only=True)
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertEqual(result['processedPages'],1)
        self.assertEqual(result['preservedPages'],[])

    def test_section_mode_keeps_critical_ocr_confidence_gate(self):
        from types import SimpleNamespace
        lines=sample().splitlines()
        boxes=[[[100,100+i*50],[2200,100+i*50],[2200,135+i*50],[100,135+i*50]] for i in range(len(lines))]
        scores=[.99]*len(lines);scores[8]=.5
        engine=lambda _:SimpleNamespace(boxes=boxes,txts=lines,scores=scores)
        with self.assertRaisesRegex(ValueError,'baixa confiança'):
            convert_statement_pdf(scanned_pdf(),section_only=True,ocr_engine=engine)

    def test_section_mode_requires_boundary_after_last_reopened_table(self):
        from types import SimpleNamespace
        for header in ['2.2) Receitas Brutas Anteriores (R$)\n2.2.1) Mercado Interno', '2.2) Receitas Brutas Anteriores (R$)\n2.2.2) Mercado Externo']:
            with self.subTest(header=header):
                # A second table is still open, even though the first had 2.3.
                amount='8.000,00' if 'Interno' in header else '0,00'
                first=sample()+'\n'+header+'\n08/2025 '+amount
                lines=['08/2025 8.001,00','2.3) Folha de Salários Anteriores']
                boxes=[[[50,50+i*40],[600,50+i*40],[600,80+i*40],[50,80+i*40]] for i in range(2)]
                engine=lambda _:SimpleNamespace(boxes=boxes,txts=lines,scores=[.99,.99])
                with self.assertRaisesRegex(ValueError,'conflitantes'):
                    convert_statement_pdf(paged_pdf(first),section_only=True,ocr_engine=engine)

    def test_section_mode_waits_for_identification_on_later_page(self):
        identity='CNPJ Básico: 12.345.678 Nome Empresarial: EMPRESA SINTETICA\nPeríodo de Apuração (PA): 08/2026'
        first='\n'.join(line for line in sample().splitlines() if not line.startswith(('CNPJ Básico:','Período de Apuração')))
        result,_,_=convert_statement_pdf(paged_pdf(first,identity),section_only=True,
            ocr_engine=lambda _:self.fail('Unrelated tail must not be processed'))
        self.assertEqual(result['rbt12Cents'],16200000)
        self.assertEqual(result['processedPages'],2)
        self.assertEqual(result['preservedPages'],[3])

    @unittest.skipUnless(os.getenv('SIMPLES_TEST_OCR')=='1','Set SIMPLES_TEST_OCR=1 for a single real OCR regression')
    def test_image_pdf_real_ocr_and_searchable_layer(self):
        import fitz
        for native_footer in [False,True]:
            with self.subTest(native_footer=native_footer):
                result,pdf,text=convert_statement_pdf(scanned_pdf(native_footer=native_footer),timeout_seconds=90)
                self.assertTrue(result['ocrUsed']);self.assertEqual(result['processedPages'],1)
                self.assertEqual(result['rbt12Cents'],16200000)
                with fitz.open(stream=pdf,filetype='pdf') as output:
                    self.assertGreater(len(output[0].get_text()),100)
                    self.assertIn('2.2',output[0].get_text())

if __name__=='__main__':unittest.main()
