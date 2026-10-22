"""Catalog reporting preserves raw reconciliation and explains the DRE selection."""
from copy import deepcopy
import unittest

from reporting.core import ReportError
from reporting.operation_catalog import OPERATION_CATALOG_VERSION, classify_operation_nature
from reporting.purchases import reconcile_purchase_snapshot, render_purchase_pdf
from purchases_report_test import net_fixture, WORKSPACE
from difal_report_test import difal_fixture, story_text


def catalog_fixture():
    job, lines, items = net_fixture()
    job['operationVersion'] = OPERATION_CATALOG_VERSION
    for row, code in zip(lines, ('1102', '8000', '1202', '1910', '9999')):
        row.update(operationVersion=OPERATION_CATALOG_VERSION, natureCode=code,
                   natureOperation=classify_operation_nature(code), description='Produto sintético', recipientUf='SP')
    return job, lines, items


class OperationReportTests(unittest.TestCase):
    def test_purchase_natures_reconcile_raw_total_and_show_return_destination(self):
        meta = reconcile_purchase_snapshot(*catalog_fixture(), WORKSPACE)
        self.assertEqual(meta['totalCents'], 100000)
        self.assertEqual(sum(item['totalCents'] for item in meta['natureTotals']), 100000)
        self.assertEqual(sum(item['lines'] for item in meta['natureTotals']), 5)
        self.assertEqual([(item['natureCode'], item['operation'], item['totalCents']) for item in meta['natureTotals']], [
            ('1102', 'COMPRAS', 10000), ('1202', 'DEVOLUCAO_VENDA', 40000),
            ('1910', 'OUTRAS', 10000), ('8000', 'SERVICO_COMPRA', 20000), ('9999', 'NAO_CLASSIFICADA', 20000)])
        text = story_text(meta)
        for expected in ('Conferência das naturezas de operação', 'Serviços de compra (8000)',
                         'Devoluções de venda', 'Abate a receita de vendas', 'Fora das bases da DRE',
                         'Não classificada', 'coluna D (OPERAÇÃO)', 'Q - Y + AA - AB'):
            self.assertIn(expected, text)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_catalog_sales_show_exact_nature_and_do_not_trust_description(self):
        job, lines, items = difal_fixture(nature='6301', description='Remessa')
        job['operationVersion'] = OPERATION_CATALOG_VERSION
        lines[0].update(operationVersion=OPERATION_CATALOG_VERSION, natureOperation='VENDA')
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['natureTotals'], [{'natureCode': '6301', 'operation': 'VENDA', 'lines': 1, 'totalCents': 15000}])
        self.assertEqual(meta['difal']['amountCents'], 1500)
        self.assertIn('Receita de vendas', story_text(meta))

    def test_catalog_snapshot_metadata_cannot_be_missing_or_tampered(self):
        mutations = [
            lambda job, row: job.update(operationVersion='UNKNOWN'),
            lambda job, row: row.pop('operationVersion'),
            lambda job, row: row.update(operationVersion='UNKNOWN'),
            lambda job, row: row.pop('natureCode'),
            lambda job, row: row.update(natureCode='1102002'),
            lambda job, row: row.update(natureOperation='VENDA'),
            lambda job, row: row.pop('natureOperation'),
            lambda job, row: row.update(recipientUf='sp'),
            lambda job, row: row.pop('description'),
        ]
        for mutation in mutations:
            job, lines, items = catalog_fixture()
            mutation(job, lines[0])
            with self.assertRaises(ReportError):
                reconcile_purchase_snapshot(job, lines, items, WORKSPACE)

    def test_legacy_purchase_report_keeps_its_frozen_base_without_inventing_natures(self):
        job, lines, items = net_fixture()
        before = deepcopy((job, lines, items))
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertIsNone(meta['operationVersion'])
        self.assertIsNone(meta['natureTotals'])
        self.assertNotIn('Conferência das naturezas de operação', story_text(meta))
        self.assertEqual(meta['totalCents'], 100000)
        self.assertEqual((job, lines, items), before)


if __name__ == '__main__':
    unittest.main()
