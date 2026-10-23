"""Catalog reporting preserves raw reconciliation and explains the DRE selection."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from reporting.core import ReportError
from reporting.operation_catalog import OPERATION_CATALOG_VERSION, classify_operation_nature
from reporting.purchases import reconcile_purchase_snapshot, render_purchase_pdf, purchase_story, purchase_pdf_styles
from reporting.generations import generation_metadata, render_generation_pdf
from purchases_report_test import net_fixture, WORKSPACE
from difal_report_test import difal_fixture, story_text
import generations_report_test as generation_tests


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
        selected = meta['purchaseSelection']
        self.assertEqual(selected['version'], 'PURCHASE_NATURES_V1')
        self.assertTrue(selected['available'])
        self.assertEqual(selected['totals'], {'lines': 2, 'uniqueCnpjs': 1, 'uniqueDocuments': 1,
            'nonCnpjDocumentCount': 0, 'cnpjLines': 2, 'nonCnpjLines': 0, 'totalCents': 30000,
            'cnpjCents': 30000, 'nonCnpjCents': 0})
        self.assertEqual((selected['reportTotalCents'], selected['excludedTotalCents'], selected['excludedLines']),
                         (100000, 70000, 3))
        self.assertEqual([group['totalCents'] for group in selected['reportingGroups']], [30000, 0])
        self.assertEqual(selected['components']['totalCents'], 30000)
        self.assertIn('Compras consideradas: R$ 300,00', text)
        self.assertIn('Memória das compras consideradas', text)
        tables = [part for part in purchase_story(meta, 778, purchase_pdf_styles()) if hasattr(part, '_cellvalues')]
        self.assertEqual(tables[0]._cellvalues[-1][4].getPlainText(), 'R$ 300,00')

    def test_catalog_sales_show_exact_nature_and_do_not_trust_description(self):
        job, lines, items = difal_fixture(nature='6301', description='Remessa')
        job['operationVersion'] = OPERATION_CATALOG_VERSION
        lines[0].update(operationVersion=OPERATION_CATALOG_VERSION, natureOperation='VENDA')
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['natureTotals'], [{'natureCode': '6301', 'operation': 'VENDA', 'lines': 1, 'totalCents': 15000}])
        self.assertEqual(meta['difal']['amountCents'], 1500)
        self.assertIn('Receita de vendas', story_text(meta))
        self.assertNotIn('purchaseSelection', meta)

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
        self.assertFalse(meta['purchaseSelection']['available'])
        for field in ('totals', 'components', 'groups', 'reportingGroups', 'excluded', 'excludedTotalCents', 'excludedLines'):
            self.assertIsNone(meta['purchaseSelection'][field])
        self.assertIn('Compras consideradas: indisponível neste histórico', story_text(meta))
        self.assertIn('Conferência do arquivo original', story_text(meta))
        self.assertNotIn('Compras consideradas: R$ 0,00', story_text(meta))
        self.assertEqual((job, lines, items), before)

    def test_selected_groups_count_only_included_lines_of_mixed_documents(self):
        job, lines, items = catalog_fixture()
        for row, code in zip(lines, ('1102', '1910', '2102', '8000', '8000')):
            row.update(natureCode=code, natureOperation=classify_operation_nature(code))
        before = deepcopy((job, lines, items))
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        selected = meta['purchaseSelection']
        self.assertEqual(selected['totals']['totalCents'], 80000)
        self.assertEqual(selected['totals']['lines'], 4)
        self.assertEqual(selected['totals']['uniqueDocuments'], 4)
        self.assertEqual([group['totalCents'] for group in selected['reportingGroups']], [10000, 70000])
        self.assertEqual([group['count'] for group in selected['reportingGroups']], [1, 3])
        self.assertEqual([group['valuePercent'] for group in selected['reportingGroups']], [12.5, 87.5])
        self.assertEqual(selected['reportingGroups'][1]['unconfirmedCents'], 10000)
        self.assertEqual(selected['reportingGroups'][1]['nonCnpjCents'], 20000)
        self.assertEqual(meta['managerialGroups'][0]['totalCents'], 30000, 'O agrupamento original continua conciliado.')
        self.assertEqual((job, lines, items), before)

    def test_complete_old_natures_are_derived_but_one_missing_nature_blocks_selection(self):
        job, lines, items = net_fixture()
        for row, code in zip(lines, ('1102', '8000', '1202', '1910', '9999')):
            row['natureCode'] = code
        before = deepcopy((job, lines, items))
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['purchaseSelection']['origin'], 'DERIVED_FROM_SNAPSHOT')
        self.assertEqual(meta['purchaseSelection']['totals']['totalCents'], 30000)
        self.assertIsNone(meta['operationVersion'])
        self.assertEqual((job, lines, items), before)
        for missing in (None, '', '1102002'):
            with self.subTest(nature=missing):
                lines[0]['natureCode'] = missing
                selected = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)['purchaseSelection']
                self.assertFalse(selected['available'])
                self.assertEqual(selected['reason'], 'MISSING_NATURE')
                self.assertIsNone(selected['totals'])
                missing_audit = selected['natureTotals'][0]
                self.assertIsNone(missing_audit['eligible'])
                self.assertIsNone(missing_audit['consideredCents'])

    def test_all_excluded_is_a_confirmed_zero_and_does_not_reintroduce_raw_totals(self):
        job, lines, items = catalog_fixture()
        for row in lines:
            row.update(natureCode='1910', natureOperation='OUTRAS')
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        selected = meta['purchaseSelection']
        self.assertTrue(selected['available'])
        self.assertEqual(selected['totals']['totalCents'], 0)
        self.assertEqual(selected['totals']['uniqueDocuments'], 0)
        self.assertEqual(selected['excludedTotalCents'], 100000)
        self.assertEqual([group['valuePercent'] for group in selected['reportingGroups']], [0, 0])
        self.assertIn('Compras consideradas: R$ 0,00', story_text(meta))
        self.assertEqual(meta['totalCents'], 100000)

    def test_node_and_python_purchase_selection_have_identical_contracts(self):
        script = """
import {summarizePurchaseSelection} from './src/purchase-selection.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {rows,calculationVersion}=JSON.parse(input);
process.stdout.write(JSON.stringify(summarizePurchaseSelection(rows,{includeGroups:true,calculationVersion})));
"""
        for codes in [('1102', '8000', '1202', '1910', '9999'),
                      ('1102', '1910', '2102', '8000', '8000'),
                      ('1910', '1910', '5202', '9000', '9999'),
                      ('', '8000', '1202', '1910', '9999')]:
            job, lines, items = net_fixture()
            statuses = {item['cnpj']: item['status'] for item in items}
            for row, code in zip(lines, codes):
                row.update(natureCode=code, status=statuses.get(row['cnpj']))
            expected = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)['purchaseSelection']
            result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script],
                input=json.dumps({'rows': lines, 'calculationVersion': 'NET_V2'}), text=True,
                capture_output=True, check=True, cwd=Path(__file__).resolve().parents[1])
            with self.subTest(codes=codes):
                self.assertEqual(json.loads(result.stdout), expected)

    def test_generation_cover_selects_purchases_and_preserves_sales_and_original_audit(self):
        for legacy in (False, True):
            db, generation, jobs, snapshots = generation_tests.GenerationReportTests().setup_db(2, ['PURCHASES', 'SALES'])
            purchase_index = 0
            for job, lines, items in snapshots.values():
                if job['mode'] != 'PURCHASES_V1':
                    continue
                purchase_index += 1
                if legacy and purchase_index == 2:
                    continue
                for row, code in zip(lines, ('1102', '8000', '1202', '1910', '9999')):
                    row['natureCode'] = code
            with patch('reporting.generations.purchase_metadata', side_effect=lambda db, job, workspace:
                       reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)):
                meta = generation_metadata(db, generation_tests.GENERATION, WORKSPACE)
            self.assertEqual((meta['firstCompany'], meta['lastCompany']), (1, 2))
            self.assertEqual(meta['totalsByType']['SALES']['totalCents'], 200000)
            self.assertEqual(meta['totalsByType']['PURCHASES']['totalCents'], 200000)
            selected = meta['totalsByType']['PURCHASES']['purchaseSelection']
            self.assertEqual(selected['availableReports'], 1 if legacy else 2)
            self.assertEqual(selected['unavailableReports'], int(legacy))
            self.assertEqual(selected['totalCents'], 30000 if legacy else 60000)
            self.assertEqual(selected['totalCents'] + selected['excludedTotalCents'] + selected['unavailableTotalCents'], 200000)
            import fitz
            with fitz.open(stream=render_generation_pdf(meta), filetype='pdf') as pdf:
                text = ' '.join(page.get_text() for page in pdf)
            self.assertIn('Compras consideradas', text)
            self.assertIn('Arquivo original de todas as empresas', text)
            self.assertIn('TOTAL PARCIAL' if legacy else 'R$ 600,00', text)


if __name__ == '__main__':
    unittest.main()
