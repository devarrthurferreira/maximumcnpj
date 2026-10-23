"""Synthetic revenue closings: preserved file balances, exact company pairing and final PDF sections."""
from copy import deepcopy
import os
import unittest
import uuid

import fitz
from reporting.core import ReportError, utcnow
from reporting.difal import sales_operation
from reporting.operation_catalog import OPERATION_CATALOG_VERSION, classify_operation_nature
from reporting.purchases import COMPONENT_FIELDS, reconcile_purchase_snapshot, purchase_metadata, render_purchase_pdf
from reporting.revenue import revenue_from_pair, revenue_totals
from reporting.generations import generation_metadata, render_generation_pdf

WORKSPACE = 'synthetic-revenue-closing'
GENERATION = '00000000-0000-4000-8000-000000000191'
CLIENT = '00000000-0000-4000-8000-000000000192'
PURCHASE = '00000000-0000-4000-8000-000000000193'
SALE = '00000000-0000-4000-8000-000000000194'


def revenue_fixture():
    snapshots = {}
    for mode, job_id, inputs in (
        ('PURCHASES_V1', PURCHASE, [('2102', 40000, '2026-08-25'), ('1202', 15000, '2026-08-25'),
                                  ('2102', 5000, '2026-09-25'), ('1202', 25000, '2026-09-25')]),
        ('SALES_V1', SALE, [('6102', 100000, '2026-08-02'), ('9000', 20000, '2026-08-02'),
                          ('6202', 10000, '2026-08-02'), ('5901', 5000, '2026-08-02'), ('6102', 100000, '2026-09-02')]),
    ):
        sales = mode == 'SALES_V1'
        lines = []
        for index, (nature, cents, service_date) in enumerate(inputs):
            operation = sales_operation(nature, '')
            lines.append({'_id': f'{job_id}:{index}', 'workspaceId': WORKSPACE, 'jobId': job_id, 'index': index,
                'document': '12345678900', 'documentKind': 'CPF', 'cnpj': '', 'valid': False,
                'kind': 'CLIENTE' if sales else 'FORNECEDOR', 'name': 'PARCEIRO SINTÉTICO', 'quantity': '1',
                'natureCode': nature, 'description': 'Descrição sintética', 'natureOperation': classify_operation_nature(nature),
                'operationVersion': OPERATION_CATALOG_VERSION, 'recipientUf': 'SP', 'serviceDate': service_date,
                'grossCents': cents + 1000, 'discountCents': 1100, 'accessoryCents': 99000, 'freightCents': 200,
                'abatementCents': 100, 'totalCents': cents,
                **({'operation': operation, 'balanceCents': -cents if operation == 'DEVOLUCAO' else cents} if sales else {})})
        dates = sorted(row['serviceDate'] for row in lines)
        job = {'_id': job_id, 'workspaceId': WORKSPACE, 'generationId': GENERATION, 'mode': mode, 'status': 'COMPLETED',
               'clientId': CLIENT, 'clientCode': 'SYN', 'clientName': 'EMPRESA SINTÉTICA - FECHAMENTO',
               'fileName': 'vendas-sinteticas.csv' if sales else 'compras-sinteticas.csv', 'completedAt': utcnow(),
               'calculationVersion': 'NET_V2', 'operationVersion': OPERATION_CATALOG_VERSION, 'issuerUf': 'MG',
               'expectedRows': len(lines), 'uploaded': len(lines),
               'summary': {'lines': len(lines), 'unique': 0, 'invalid': len(lines), 'duplicates': 0},
               'reportPeriod': {'startDate': dates[0], 'endDate': dates[-1], 'startMonth': dates[0][:7], 'endMonth': dates[-1][:7],
                                'months': 2, 'observedMonths': 2, 'missingMonths': []},
               'purchaseInput': {'totalCents': sum(row['totalCents'] for row in lines), 'cnpjCents': 0,
                   'components': {key: sum(row[key] for row in lines) for key in (*COMPONENT_FIELDS, 'totalCents')},
                   **({'balanceCents': sum(row['balanceCents'] for row in lines)} if sales else {})}}
        snapshots[job_id] = (job, lines, [])
    company = {'clientId': CLIENT, 'code': 'SYN', 'name': 'EMPRESA SINTÉTICA - FECHAMENTO',
               'purchaseJobId': PURCHASE, 'purchaseJobIds': [PURCHASE], 'salesJobId': SALE, 'salesJobIds': [SALE]}
    generation = {'_id': GENERATION, 'workspaceId': WORKSPACE, 'requiredReports': ['PURCHASES', 'SALES'],
                  'companies': [company], 'createdAt': utcnow()}
    return generation, snapshots


def pure_closing(snapshots):
    purchase = reconcile_purchase_snapshot(*snapshots[PURCHASE], WORKSPACE)
    sale = reconcile_purchase_snapshot(*snapshots[SALE], WORKSPACE)
    closing = revenue_from_pair(purchase, sale, {'generationId': GENERATION, 'clientId': CLIENT,
                                               'purchaseJobId': PURCHASE, 'salesJobId': SALE})
    return purchase, sale, closing


class RevenueReportTests(unittest.TestCase):
    def test_gross_minus_returns_matches_months_without_changing_raw_report(self):
        _, snapshots = revenue_fixture()
        original = deepcopy(snapshots)
        purchase, sale, closing = pure_closing(snapshots)
        self.assertEqual(sale['totalCents'], 215000)
        self.assertEqual(sale['components']['totalCents'], 235000)
        self.assertEqual(purchase['totalCents'], 85000)
        self.assertEqual(closing['grossSalesCents'], 200000)
        self.assertEqual(closing['serviceSalesCents'], 20000)
        self.assertEqual(closing['grossRevenueCents'], 220000)
        self.assertEqual(closing['salesReturnsCents'], 40000)
        self.assertEqual(closing['revenueAfterReturnsCents'], 180000)
        self.assertEqual([row['revenueAfterReturnsCents'] for row in closing['monthly']], [105000, 75000])
        self.assertEqual(snapshots, original)

    def test_missing_nature_or_competence_is_unavailable_not_zero(self):
        for field in ('natureCode', 'serviceDate'):
            with self.subTest(field=field):
                _, snapshots = revenue_fixture()
                job, lines, _ = snapshots[PURCHASE]
                job.pop('operationVersion')
                job.pop('reportPeriod')
                lines[0].pop(field)
                closing = pure_closing(snapshots)[2]
                self.assertFalse(closing['available'])
                self.assertNotIn('salesReturnsCents', closing)
                self.assertNotIn('revenueAfterReturnsCents', closing)

    def test_period_difference_and_snapshot_date_tampering_are_not_silently_combined(self):
        _, snapshots = revenue_fixture()
        job, lines, _ = snapshots[PURCHASE]
        job.pop('reportPeriod')
        for line in lines:
            line['serviceDate'] = line['serviceDate'].replace('2026-08', '2026-07')
        closing = pure_closing(snapshots)[2]
        self.assertEqual(closing['status'], 'UNAVAILABLE')
        _, snapshots = revenue_fixture()
        snapshots[PURCHASE][1][0]['serviceDate'] = '2026-07-25'
        with self.assertRaises(ReportError):
            pure_closing(snapshots)

    def test_integral_bson_doubles_have_exact_cents_in_closing(self):
        _, snapshots = revenue_fixture()
        for _, lines, _ in snapshots.values():
            for line in lines:
                for key in (*COMPONENT_FIELDS, 'totalCents'):
                    line[key] = float(line[key])
        closing = pure_closing(snapshots)[2]
        self.assertEqual(closing['revenueAfterReturnsCents'], 180000)
        self.assertIs(type(closing['revenueAfterReturnsCents']), int)

    def test_individual_pdf_ends_with_closing_and_does_not_double_deduct_sales_returns(self):
        _, snapshots = revenue_fixture()
        _, sale, closing = pure_closing(snapshots)
        sale['revenueReconciliation'] = closing
        reader = fitz.open(stream=render_purchase_pdf(sale), filetype='pdf')
        last_page = reader[-1].get_text()
        self.assertIn('RECEITA APÓS DEVOLUÇÕES', last_page)
        self.assertIn('R$ 1.800,00', last_page)
        self.assertIn('-R$ 400,00', last_page)
        full = '\n'.join(page.get_text() for page in reader)
        self.assertIn('Saldo do arquivo de vendas: R$ 2.150,00', full)
        self.assertLess(full.index('Memória dos valores importados'), full.index('Fechamento da receita'))

    def test_partial_aggregate_counts_each_company_once_without_inventing_missing_zero(self):
        _, snapshots = revenue_fixture()
        closing = pure_closing(snapshots)[2]
        unavailable = revenue_from_pair(None, None, {})
        partial = revenue_totals([closing, unavailable])
        self.assertEqual(partial['grossRevenueCents'], 220000)
        self.assertEqual(partial['revenueAfterReturnsCents'], 180000)
        self.assertEqual(partial['availableCompanies'], 1)
        self.assertEqual(partial['unavailableCompanies'], 1)
        self.assertFalse(partial['complete'])
        self.assertNotIn('revenueAfterReturnsCents', revenue_totals([unavailable]))


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class RevenueMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.conn['maximum_revenue_report_test_' + uuid.uuid4().hex]

    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name)
        cls.conn.close()

    def setUp(self):
        for name in ('generations', 'lookupJobs', 'purchaseLines'):
            self.db[name].delete_many({})
        generation, snapshots = revenue_fixture()
        self.db.generations.insert_one(generation)
        for job, lines, _ in snapshots.values():
            self.db.lookupJobs.insert_one(job)
            self.db.purchaseLines.insert_many(lines)

    def metadata(self):
        return purchase_metadata(self.db, self.db.lookupJobs.find_one({'_id': SALE}), WORKSPACE)

    def test_projection_single_and_generation_pdf_preserve_jobs_and_lines(self):
        before_jobs = list(self.db.lookupJobs.find({}).sort('_id', 1))
        before_lines = list(self.db.purchaseLines.find({}).sort('_id', 1))
        single = self.metadata()
        self.assertEqual(single['revenueReconciliation']['revenueAfterReturnsCents'], 180000)
        generation = generation_metadata(self.db, GENERATION, WORKSPACE)
        self.assertEqual(generation['revenueTotals']['revenueAfterReturnsCents'], 180000)
        self.assertEqual(generation['totalsByType']['SALES']['totalCents'], 215000)
        document = fitz.open(stream=render_generation_pdf(generation), filetype='pdf')
        last = document[-1].get_text()
        self.assertIn('Fechamento da receita da geração', last)
        self.assertIn('R$ 1.800,00', last)
        self.assertIn('-R$ 400,00', last)
        self.assertEqual(list(self.db.lookupJobs.find({}).sort('_id', 1)), before_jobs)
        self.assertEqual(list(self.db.purchaseLines.find({}).sort('_id', 1)), before_lines)

    def test_pending_counterpart_or_unselected_type_has_no_money(self):
        self.db.lookupJobs.update_one({'_id': PURCHASE}, {'$set': {'status': 'PROCESSING'}})
        pending = self.metadata()['revenueReconciliation']
        self.assertEqual(pending['status'], 'PENDING')
        self.assertNotIn('salesReturnsCents', pending)
        self.db.generations.update_one({'_id': GENERATION}, {'$set': {'requiredReports': ['SALES'],
            'companies.0.purchaseJobId': None, 'companies.0.purchaseJobIds': []}})
        self.assertEqual(self.metadata()['revenueReconciliation']['status'], 'UNAVAILABLE')

    def test_foreign_company_workspace_mode_and_duplicate_owner_block(self):
        for mutation in ({'clientId': str(uuid.uuid4())}, {'workspaceId': 'foreign'}, {'mode': 'SALES_V1'}):
            with self.subTest(mutation=mutation):
                self.db.lookupJobs.update_one({'_id': PURCHASE}, {'$set': mutation})
                with self.assertRaises(ReportError):
                    self.metadata()
                self.db.lookupJobs.update_one({'_id': PURCHASE}, {'$set': {'clientId': CLIENT, 'workspaceId': WORKSPACE, 'mode': 'PURCHASES_V1'}})
        self.db.generations.update_one({'_id': GENERATION}, {'$push': {'companies.0.salesJobIds': PURCHASE}})
        with self.assertRaises(ReportError):
            self.metadata()

    def test_historical_slot_and_recheck_do_not_borrow_current_purchases(self):
        self.db.generations.update_one({'_id': GENERATION}, {'$set': {'companies.0.salesJobId': str(uuid.uuid4())}})
        old = self.metadata()['revenueReconciliation']
        self.assertEqual(old['status'], 'UNAVAILABLE')
        self.assertNotIn('salesReturnsCents', old)
        job = self.db.lookupJobs.find_one({'_id': SALE})
        job.pop('generationId')
        job['repeatedFrom'] = str(uuid.uuid4())
        self.db.lookupJobs.replace_one({'_id': SALE}, job)
        repeated = self.metadata()['revenueReconciliation']
        self.assertEqual(repeated['status'], 'UNAVAILABLE')
        self.assertNotIn('salesReturnsCents', repeated)
