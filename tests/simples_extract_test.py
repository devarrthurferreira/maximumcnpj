import unittest
from reporting.simples import parse_statement_text

SAMPLE = r"""
SIMPLES NACIONAL
Extrato do Simples Nacional
CNPJ Básico: 46.037.488    Nome Empresarial: GDA IMPORTADORA E DISTRIBUIDORA LTDA
Período de Apuração (PA): 08/2026
Receita Bruta do PA (RPA) - Competência 254.199,63 0,00 254.199,63
Receita bruta acumulada nos doze meses anteriores ao PA proporcionalizada (RBT12) 1.376.165,25 0,00 1.376.165,25
Receita bruta acumulada no ano-calendário corrente (RBA) 1.344.134,91 0,00 1.344.134,91
Receita bruta acumulada no ano-calendário anterior (RBAA) 630.197,12 0,00 630.197,12
Limite de receita bruta proporcionalizado 4.800.000,00 4.800.000,00
2.2) Receitas Brutas Anteriores (R$)
2.2.1) Mercado Interno
01/2025 28.249,30 02/2025 12.081,03 03/2025 66.289,95 04/2025 62.087,87
05/2025 50.092,74 06/2025 51.449,88 07/2025 73.716,38 08/2025 57.550,28
09/2025 66.597,19 10/2025 51.739,37 11/2025 38.404,43 12/2025 71.938,70
01/2026 115.141,84 02/2026 123.843,52 03/2026 168.929,13 04/2026 142.356,09
05/2026 120.323,08 06/2026 184.403,42 07/2026 234.938,20
2.2.2) Mercado Externo
"""

class SimplesExtractTests(unittest.TestCase):
    def test_extracts_rbt12_and_reconciles_previous_twelve_months(self):
        result = parse_statement_text(SAMPLE)
        self.assertEqual(result['pa'], '08/2026')
        self.assertEqual(result['cnpjBasico'], '46037488')
        self.assertEqual(result['rbt12Cents'], 137616525)
        self.assertEqual(result['rbt12CalculatedCents'], 137616525)
        self.assertTrue(result['rbt12Reconciled'])
        self.assertEqual(len(result['priorInternalRevenues']), 19)
        self.assertEqual(result['rpaCents'], 25419963)
        self.assertFalse(result['ocrUsed'])
        self.assertEqual(result['warnings'], [])

    def test_never_fabricates_missing_rbt12(self):
        with self.assertRaisesRegex(ValueError, 'RBT12'):
            parse_statement_text('SIMPLES NACIONAL\nExtrato sem a tabela esperada')

if __name__ == '__main__':
    unittest.main()
