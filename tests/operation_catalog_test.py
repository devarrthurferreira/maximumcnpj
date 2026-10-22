import unittest

from reporting.operation_catalog import (
    OPERATION_CATALOG_GROUPS, classify_operation_nature,
    is_purchase_operation, is_revenue_operation, normalize_operation_nature,
)


class OperationCatalogTests(unittest.TestCase):
    def test_catalog_has_no_overlapping_codes(self):
        codes = [code for values in OPERATION_CATALOG_GROUPS.values() for code in values]
        self.assertEqual(len(codes), 619)
        self.assertEqual(len(set(codes)), 619)

    def test_prefixes_and_direction_do_not_depend_on_description(self):
        for code in ('8000', '8000002', '8000102', '8.000.102'):
            self.assertEqual(normalize_operation_nature(code), '8000')
            self.assertTrue(is_purchase_operation(code))
            self.assertFalse(is_revenue_operation(code))
        self.assertEqual(classify_operation_nature('1202001'), 'DEVOLUCAO_VENDA')
        self.assertEqual(classify_operation_nature('5202001'), 'DEVOLUCAO_COMPRA')
        self.assertEqual(classify_operation_nature('2214'), 'OUTRAS')
        self.assertEqual(classify_operation_nature('6301'), 'VENDA')
        self.assertTrue(is_revenue_operation('9000001'))
        self.assertEqual(classify_operation_nature('9999'), 'NAO_CLASSIFICADA')
        self.assertEqual(classify_operation_nature(None), 'NAO_CLASSIFICADA')


if __name__ == '__main__':
    unittest.main()
