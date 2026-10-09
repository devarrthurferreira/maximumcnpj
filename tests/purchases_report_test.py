"""Synthetic financial snapshots only; no real client files or credentials."""
import hashlib
import json
import os
import secrets
import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from reporting.core import ReportError, utcnow, MAX_RESPONSE_BYTES
from reporting.purchases import (reconcile_purchase_snapshot, render_purchase_pdf, purchase_story, purchase_pdf_styles,
                                money, percentage, reporting_percentages, signed_percentage, signed_reporting_percentages,
                                _integer, MAX_SAFE_INTEGER, COMPONENT_FIELDS)

JOB = '00000000-0000-4000-8000-000000000071'
CLIENT = '00000000-0000-4000-8000-000000000072'
WORKSPACE = 'synthetic-purchases'
SALES_JOB = '00000000-0000-4000-8000-000000000073'


def fixture():
    now = utcnow()
    cnpjs = ['11222333000181', '11444777000161', '12345678000195']
    job = {'_id': JOB, 'workspaceId': WORKSPACE, 'mode': 'PURCHASES_V1', 'status': 'COMPLETED',
           'clientId': CLIENT, 'clientCode': '000', 'clientName': 'EMPRESA FICTÍCIA - EXEMPLO',
           'fileName': 'compras-sinteticas.csv', 'completedAt': now, 'expectedRows': 5, 'uploaded': 5,
           'summary': {'lines': 5, 'unique': 3, 'invalid': 1, 'duplicates': 1},
           'purchaseInput': {'totalCents': 100000, 'cnpjCents': 80000}}
    documents = [cnpjs[0], cnpjs[0], cnpjs[1], cnpjs[2], '12345678901']
    cents = [10000, 20000, 40000, 10000, 20000]
    quantities = ['2', '1', '4', '0.5', '1.25']
    lines = [{'_id': f'{JOB}:{i}', 'workspaceId': WORKSPACE, 'jobId': JOB, 'index': i,
              'document': doc, 'documentKind': 'CNPJ' if i < 4 else 'CPF', 'cnpj': doc if i < 4 else '',
              'name': 'FORNECEDOR FICTÍCIO', 'quantity': quantities[i], 'totalCents': cents[i], 'valid': i < 4}
             for i, doc in enumerate(documents)]
    statuses = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO']
    items = [{'_id': f'{JOB}:{cnpj}', 'workspaceId': WORKSPACE, 'jobId': JOB, 'clientId': CLIENT,
              'cnpj': cnpj, 'state': 'DONE', 'status': statuses[i], 'occurrences': 2 if i == 0 else 1,
              'totalCents': [30000, 40000, 10000][i], 'checkedAt': now,
              **({'stateId': f'synthetic-state-{i}', 'sourceState': [{'status': statuses[i]}]} if i < 2 else {})}
             for i, cnpj in enumerate(cnpjs)]
    return job, lines, items


def net_fixture():
    job, lines, items = fixture()
    job['calculationVersion'] = 'NET_V2'
    for line in lines:
        line.update(grossCents=line['totalCents'] + 500, discountCents=200, accessoryCents=177,
                    freightCents=100, abatementCents=400)
    job['purchaseInput']['components'] = {key: sum(line[key] for line in lines)
                                          for key in (*COMPONENT_FIELDS, 'totalCents')}
    return job, lines, items


def sales_fixture():
    job, lines, items = net_fixture()
    job.update(_id=SALES_JOB, mode='SALES_V1', fileName='vendas-sinteticas.csv')
    for line in lines:
        line.update(_id=f'{SALES_JOB}:{line["index"]}', jobId=SALES_JOB, kind='CLIENTE', name='COMPRADOR FICTÍCIO')
    for item in items:
        item.update(_id=f'{SALES_JOB}:{item["cnpj"]}', jobId=SALES_JOB, kind='CLIENTE')
    return job, lines, items


def large_double_fixture():
    """BSON doubles as emitted by Node for cent values above the Int32 range."""
    job, lines, items = fixture()
    lines[0]['totalCents'] = 3_000_000_000.0
    items[0]['totalCents'] = 3_000_020_000.0
    job['purchaseInput'] = {'totalCents': 3_000_090_000.0, 'cnpjCents': 3_000_070_000.0}
    return job, lines, items


class PurchaseReportTests(unittest.TestCase):
    def test_sales_use_net_formula_and_buyer_labels_with_separate_source_status(self):
        job, lines, items = sales_fixture()
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['reportType'], 'SALES')
        self.assertEqual(meta['totalCents'], 100000)
        self.assertEqual(meta['components']['accessoryCents'], 885)
        self.assertEqual([group['totalCents'] for group in meta['managerialGroups']], [30000, 50000, 20000])
        self.assertEqual([group['count'] for group in meta['managerialGroups']], [1, 2, 1])
        self.assertEqual(meta['unconfirmed']['totalCents'], 10000)
        text = '\n'.join(part.getPlainText() for part in purchase_story(meta, 778, purchase_pdf_styles())
                         if hasattr(part, 'getPlainText'))
        self.assertIn('Vendas - enquadramento', text)
        self.assertIn('Cada comprador conta uma vez', text)
        self.assertIn('A = CNPJ comprador; I = comprador;', text)
        self.assertIn('Q - Y + AA - AB', text)
        self.assertIn('CPFs em grupo separado = 1 documentos e R$ 200,00', text)
        self.assertNotIn('fornecedor', text)
        self.assertNotIn('Quantidade P total', text)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_sales_separate_repeated_cpfs_keep_unknown_and_other_documents_in_nonoptant(self):
        job, lines, items = sales_fixture()
        for document, kind, cents in [('12345678901', 'CPF', 100), ('123456789012', 'CNO_OU_OUTRO', 200),
                                      ('INVALIDO', 'INVALIDO', 300), ('', 'AUSENTE', 400), ('', 'AUSENTE', 500)]:
            index = len(lines)
            lines.append({**lines[-1], '_id': f'{SALES_JOB}:{index}', 'index': index, 'document': document,
                          'documentKind': kind, 'cnpj': '', 'valid': False, 'totalCents': cents,
                          'grossCents': cents + 500, 'discountCents': 200, 'accessoryCents': 177,
                          'freightCents': 100, 'abatementCents': 400})
        job.update(expectedRows=10, uploaded=10, summary={'lines': 10, 'unique': 3, 'invalid': 6, 'duplicates': 1})
        job['purchaseInput'] = {'totalCents': 101500, 'cnpjCents': 80000,
                               'components': {key: sum(line[key] for line in lines) for key in (*COMPONENT_FIELDS, 'totalCents')}}
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual((meta['uniqueDocuments'], meta['nonCnpjDocumentCount']), (8, 5))
        self.assertEqual((meta['cpfDocumentCount'], meta['cpfLineCount'], meta['cpfCents']), (1, 2, 20100))
        self.assertEqual(meta['reportingGroups'], [
            {'status': 'OPTANTE', 'count': 1, 'lines': 2, 'totalCents': 30000, 'countPercent': 12.5,
             'valuePercent': 29.56, 'unconfirmedCount': 0, 'unconfirmedCents': 0, 'nonCnpjCount': 0, 'nonCnpjCents': 0},
            {'status': 'NAO_OPTANTE', 'count': 6, 'lines': 6, 'totalCents': 51400, 'countPercent': 75,
             'valuePercent': 50.64, 'unconfirmedCount': 1, 'unconfirmedCents': 10000,
             'nonCnpjCount': 4, 'nonCnpjCents': 1400},
            {'status': 'CPF', 'count': 1, 'lines': 2, 'totalCents': 20100, 'countPercent': 12.5,
             'valuePercent': 19.8, 'unconfirmedCount': 0, 'unconfirmedCents': 0,
             'nonCnpjCount': 1, 'nonCnpjCents': 20100}])
        self.assertEqual(sum(group['totalCents'] for group in meta['reportingGroups']), meta['totalCents'])
        self.assertEqual(sum(group['lines'] for group in meta['reportingGroups']), meta['lineCount'])
        self.assertEqual(sum(group['count'] for group in meta['reportingGroups']), meta['uniqueDocuments'])
        self.assertEqual(sum(group['valuePercent'] for group in meta['reportingGroups']), 100)
        self.assertEqual([item['status'] for item in items], ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'])
        self.assertEqual(meta['groups'][-1]['totalCents'], 21500)
        self.assertEqual(meta['groups'][2]['totalCents'], 10000)
        tables = [part for part in purchase_story(meta, 778, purchase_pdf_styles()) if hasattr(part, '_cellvalues')]
        self.assertEqual([row[0].getPlainText() for row in tables[0]._cellvalues],
                         ['Grupo gerencial', 'Optantes SN', 'Não optantes SN', 'CPFs', 'TOTAL'])
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_sales_zero_value_cpf_report_has_three_groups_and_no_lookup(self):
        job, lines, _ = sales_fixture()
        line = {**lines[-1], 'index': 0, 'grossCents': 500, 'totalCents': 0}
        job.update(expectedRows=1, uploaded=1, summary={'lines': 1, 'unique': 0, 'invalid': 1, 'duplicates': 0},
                   purchaseInput={'totalCents': 0, 'cnpjCents': 0,
                                  'components': {key: line[key] for key in (*COMPONENT_FIELDS, 'totalCents')}})
        meta = reconcile_purchase_snapshot(job, [line], [], WORKSPACE)
        self.assertEqual([group['countPercent'] for group in meta['reportingGroups']], [0, 0, 100])
        self.assertEqual([group['valuePercent'] for group in meta['reportingGroups']], [0, 0, 0])
        self.assertEqual([group['nonCnpjCount'] for group in meta['reportingGroups']], [0, 0, 1])
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_sales_largest_remainder_percentages_balance_and_have_stable_ties(self):
        for values, expected in (([0, 0, 0], [0, 0, 0]), ([1, 1, 1], [33.34, 33.33, 33.33]),
                                 ([1, 2, 3], [16.67, 33.33, 50]), ([1, 1, 4], [16.67, 16.67, 66.66]),
                                 ([0, 0, MAX_SAFE_INTEGER], [0, 0, 100])):
            with self.subTest(values=values):
                self.assertEqual(reporting_percentages(values), expected)

    def test_sales_signed_percentages_match_node_and_preserve_empty_groups(self):
        self.assertEqual(signed_percentage(10010, 40000), 25.03)
        self.assertEqual(signed_percentage(-10010, 40000), -25.03)
        self.assertEqual(signed_percentage(10010, -40000), -25.03)
        for values, denominator, expected in (
            ([1, 1, 1], 3, [33.34, 33.33, 33.33]),
            ([-10010, 45000, 5010], 40000, [-25.02, 112.5, 12.52]),
            ([-1, -1, -1], -3, [33.34, 33.33, 33.33]),
            ([1, 31, 0], 32, [3.13, 96.87, 0]),
            ([-1, 33, 0], 32, [-3.12, 103.12, 0]),
            ([-100, 100, 0], 0, [0, 0, 0]),
            ([0, 0, 0], 0, [0, 0, 0]),
        ):
            with self.subTest(values=values):
                self.assertEqual(signed_reporting_percentages(values, denominator), expected)
        for values, denominator in (([1, 2, 3], 5), ([0.5, 0.5, 0], 1)):
            with self.assertRaises(ReportError):
                signed_reporting_percentages(values, denominator)

    def test_sales_reject_legacy_formula_and_wrong_partner_kind(self):
        def legacy(job, lines, items): job.pop('calculationVersion')
        def wrong_line(job, lines, items): lines[0]['kind'] = 'FORNECEDOR'
        def missing_line_kind(job, lines, items): lines[0].pop('kind')
        def wrong_item(job, lines, items): items[0]['kind'] = 'FORNECEDOR'
        def wrong_mode(job, lines, items): job['mode'] = 'LOOKUP_V1'
        for change in (legacy, wrong_line, missing_line_kind, wrong_item, wrong_mode):
            with self.subTest(change=change.__name__):
                job, lines, items = sales_fixture()
                change(job, lines, items)
                with self.assertRaises(ReportError):
                    reconcile_purchase_snapshot(job, lines, items, WORKSPACE)

    def test_v080_sales_without_redundant_line_kind_preserve_existing_reports(self):
        job, lines, items = sales_fixture()
        job['version'] = '0.8.0'
        for line in lines:
            del line['kind']
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['reportType'], 'SALES')
        self.assertEqual(meta['totalCents'], 100000)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        lines[0]['kind'] = 'FORNECEDOR'
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        del lines[0]['kind']
        job['version'] = '0.8.1'
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, lines, items, WORKSPACE)

    def test_net_formula_components_and_managerial_unknown_preserve_source(self):
        job, lines, items = net_fixture()
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['calculationVersion'], 'NET_V2')
        self.assertEqual(meta['components'], {'grossCents': 102500, 'discountCents': 1000,
            'accessoryCents': 885, 'freightCents': 500, 'abatementCents': 2000, 'totalCents': 100000})
        nonoptant = meta['managerialGroups'][1]
        self.assertEqual((nonoptant['suppliers'], nonoptant['lines'], nonoptant['totalCents']), (3, 3, 70000))
        self.assertEqual((nonoptant['supplierPercent'], nonoptant['valuePercent']), (75, 70))
        self.assertEqual(len(meta['managerialGroups']), 2)
        self.assertEqual([group['label'] for group in meta['managerialGroups']], ['Simples', 'Não optante'])
        self.assertEqual(meta['unconfirmed']['totalCents'], 10000)
        self.assertEqual(items[2]['status'], 'NAO_CONFIRMADO')
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        legacy = reconcile_purchase_snapshot(*fixture(), WORKSPACE)
        self.assertEqual(legacy['calculationVersion'], 'Q_V1')
        self.assertIsNone(legacy['components'])

    def test_net_component_tampering_and_unknown_versions_block_pdf(self):
        def omitted(job, lines, items): del lines[0]['discountCents']
        def formula(job, lines, items): lines[0]['freightCents'] += 1
        def informational(job, lines, items): lines[0]['accessoryCents'] += 1
        def summary(job, lines, items): job['purchaseInput']['components']['grossCents'] += 1
        def missing_summary(job, lines, items): del job['purchaseInput']['components']
        def future_version(job, lines, items): job['calculationVersion'] = 'NET_V3'
        def negative(job, lines, items): lines[0]['discountCents'] = -1
        def excessive(job, lines, items): lines[0]['accessoryCents'] = 100_000_000_001
        for change in (omitted, formula, informational, summary, missing_summary, future_version, negative, excessive):
            with self.subTest(change=change.__name__):
                job, lines, items = net_fixture()
                change(job, lines, items)
                with self.assertRaises(ReportError):
                    reconcile_purchase_snapshot(job, lines, items, WORKSPACE)

    def test_bson_integral_doubles_are_normalized_without_losing_centavos(self):
        meta = reconcile_purchase_snapshot(*large_double_fixture(), WORKSPACE)
        self.assertIs(type(meta['totalCents']), int)
        self.assertEqual(meta['totalCents'], 3_000_090_000)
        self.assertIs(type(meta['groups'][0]['totalCents']), int)
        self.assertEqual(meta['groups'][0]['totalCents'], 3_000_020_000)
        self.assertEqual(money(meta['totalCents']), 'R$ 30.000.900,00')
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        self.assertEqual(_integer(float(MAX_SAFE_INTEGER)), MAX_SAFE_INTEGER)
        for invalid in (True, False, float('nan'), float('inf'), float('-inf'), 1.5,
                        -1.0, float(MAX_SAFE_INTEGER + 1), MAX_SAFE_INTEGER + 1):
            with self.subTest(value=invalid), self.assertRaises(ReportError):
                _integer(invalid)

    def test_duplicate_suppliers_preserve_all_amounts_and_explicit_denominators(self):
        job, lines, items = fixture()
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual(meta['totalCents'], 100000)
        self.assertEqual(meta['cnpjCents'], 80000)
        self.assertEqual(meta['uniqueSuppliers'], 3)
        self.assertEqual(meta['quantityDisplay'], '8,75')
        optant, nonoptant, unknown, excluded = meta['groups']
        self.assertEqual((optant['suppliers'], optant['lines'], optant['totalCents']), (1, 2, 30000))
        self.assertEqual((optant['supplierPercent'], optant['valuePercent'], optant['fileValuePercent']), (33.33, 37.5, 30))
        self.assertEqual(nonoptant['totalCents'], 40000)
        self.assertEqual(unknown['totalCents'], 10000)
        self.assertEqual((excluded['suppliers'], excluded['totalCents'], excluded['valuePercent']), (0, 20000, None))

    def test_all_cpf_and_zero_value_are_complete_with_zero_denominators(self):
        job, lines, _ = fixture()
        line = dict(lines[-1], index=0, totalCents=0)
        job.update(expectedRows=1, uploaded=1, summary={'lines': 1, 'unique': 0, 'invalid': 1, 'duplicates': 0},
                   purchaseInput={'totalCents': 0, 'cnpjCents': 0})
        meta = reconcile_purchase_snapshot(job, [line], [], WORKSPACE)
        self.assertEqual(meta['uniqueSuppliers'], 0)
        self.assertEqual(meta['uniqueDocuments'], 1)
        self.assertEqual(meta['nonCnpjDocumentCount'], 1)
        self.assertEqual([group['countPercent'] for group in meta['reportingGroups']], [0, 100])
        self.assertEqual([group['valuePercent'] for group in meta['reportingGroups']], [0, 0])
        self.assertTrue(all(group['supplierPercent'] == 0 and group['fileValuePercent'] == 0 for group in meta['groups']))
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_all_documents_count_once_except_missing_values_and_all_amounts_are_included(self):
        job, lines, items = net_fixture()
        for document, kind, cents in [('12345678901', 'CPF', 100), ('123456789012', 'CNO_OU_OUTRO', 200),
                                      ('INVALIDO', 'INVALIDO', 300), ('', 'AUSENTE', 400), ('', 'AUSENTE', 500)]:
            index = len(lines)
            lines.append({**lines[-1], '_id': f'{JOB}:{index}', 'index': index, 'document': document,
                          'documentKind': kind, 'cnpj': '', 'valid': False, 'totalCents': cents,
                          'grossCents': cents + 500, 'discountCents': 200, 'accessoryCents': 177,
                          'freightCents': 100, 'abatementCents': 400})
        job.update(expectedRows=10, uploaded=10, summary={'lines': 10, 'unique': 3, 'invalid': 6, 'duplicates': 1})
        job['purchaseInput'] = {'totalCents': 101500, 'cnpjCents': 80000,
                               'components': {key: sum(line[key] for line in lines) for key in (*COMPONENT_FIELDS, 'totalCents')}}
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        self.assertEqual((meta['uniqueDocuments'], meta['nonCnpjDocumentCount']), (8, 5))
        self.assertEqual(meta['reportingGroups'], [
            {'status': 'OPTANTE', 'count': 1, 'lines': 2, 'totalCents': 30000, 'countPercent': 12.5,
             'valuePercent': 29.56, 'unconfirmedCount': 0, 'unconfirmedCents': 0, 'nonCnpjCount': 0, 'nonCnpjCents': 0},
            {'status': 'NAO_OPTANTE', 'count': 7, 'lines': 8, 'totalCents': 71500, 'countPercent': 87.5,
             'valuePercent': 70.44, 'unconfirmedCount': 1, 'unconfirmedCents': 10000,
             'nonCnpjCount': 5, 'nonCnpjCents': 21500}])
        self.assertEqual(len(items), 3)
        self.assertEqual(items[-1]['status'], 'NAO_CONFIRMADO')
        tables = [part for part in purchase_story(meta, 778, purchase_pdf_styles()) if hasattr(part, '_cellvalues')]
        self.assertEqual(len(tables[0]._cellvalues), 4)
        self.assertEqual([row[0].getPlainText() for row in tables[0]._cellvalues], ['Grupo gerencial', 'Simples', 'Não optante', 'TOTAL'])

    def test_half_up_percentages_have_an_exact_complement(self):
        for cents_by_line, expected in (([1, 0, 15, 15, 1], [3.13, 96.87]),
                                        ([10010, 0, 15000, 10000, 4990], [25.03, 74.97])):
            with self.subTest(cents=cents_by_line):
                job, lines, items = fixture()
                for line, cents in zip(lines, cents_by_line):
                    line['totalCents'] = cents
                for item in items:
                    item['totalCents'] = sum(line['totalCents'] for line in lines if line['cnpj'] == item['cnpj'])
                job['purchaseInput'] = {'totalCents': sum(cents_by_line), 'cnpjCents': sum(cents_by_line[:-1])}
                meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual([group['valuePercent'] for group in meta['reportingGroups']], expected)
                self.assertEqual(sum(group['valuePercent'] for group in meta['reportingGroups']), 100)

    def test_missing_or_tampered_snapshots_block_report(self):
        def alter_job(job, lines, items): job['purchaseInput']['totalCents'] += 1
        def alter_line(job, lines, items): lines[0]['totalCents'] += 1
        def incomplete(job, lines, items): items[0]['state'] = 'PENDING'
        def wrong_client(job, lines, items): items[0]['clientId'] = 'other'
        def wrong_workspace(job, lines, items): lines[0]['workspaceId'] = 'other'
        def missing_state(job, lines, items): items[0]['sourceState'] = []
        def wrong_status(job, lines, items): items[0]['sourceState'][0]['status'] = 'NAO_OPTANTE'
        def missing_lookup(job, lines, items): items.pop()
        def duplicated_index(job, lines, items): lines[1]['index'] = 0
        def fractional_money(job, lines, items): lines[0]['totalCents'] = 10000.5
        def bad_quantity(job, lines, items): lines[0]['quantity'] = 'NaN'
        def cpf_classified_as_cnpj(job, lines, items): lines[-1].update(valid=True, cnpj='12345678901')
        for change in (alter_job, alter_line, incomplete, wrong_client, wrong_workspace, missing_state,
                       wrong_status, missing_lookup, duplicated_index, fractional_money, bad_quantity, cpf_classified_as_cnpj):
            with self.subTest(change=change.__name__):
                job, lines, items = fixture()
                change(job, lines, items)
                with self.assertRaises(ReportError) as error:
                    reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(error.exception.status, 409)

    def test_pdf_uses_integer_money_and_escapes_markup(self):
        self.assertEqual(money(9_007_199_254_740_991), 'R$ 90.071.992.547.409,91')
        self.assertEqual(percentage(10010, 40000), 25.03)
        job, lines, items = fixture()
        job['clientName'] = 'FICTÍCIA & <img src="https://invalid.test/">'
        meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
        data = render_purchase_pdf(meta)
        self.assertTrue(data.startswith(b'%PDF'))
        self.assertLess(len(data), MAX_RESPONSE_BYTES)


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class PurchaseMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.conn = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.conn['maximum_purchase_report_test_' + uuid.uuid4().hex]
        cls.env = patch.dict(os.environ, {'WORKSPACE_ID': WORKSPACE, 'NODE_ENV': 'development',
                                         'APP_ORIGIN': 'http://purchases.test', 'VERCEL': '0'})
        cls.env.start()
        cls.raw = secrets.token_urlsafe(32)
        cls.cookie = {'Cookie': 'maximum_session=' + cls.raw}
        cls.db.users.insert_one({'_id': 'synthetic-user', 'workspaceId': WORKSPACE, 'active': True, 'role': 'operator'})
        cls.db.sessions.insert_one({'_id': hashlib.sha256(cls.raw.encode()).hexdigest(), 'workspaceId': WORKSPACE,
                                   'userId': 'synthetic-user', 'expiresAt': utcnow() + timedelta(minutes=10)})
        for job, lines, items in (fixture(), sales_fixture()):
            cls.db.lookupJobs.insert_one(job)
            cls.db.purchaseLines.insert_many(lines)
            for item in items:
                source = item.pop('sourceState', [])
                if source:
                    cls.db.cnpjStates.update_one({'_id': item['stateId']}, {'$set': {'workspaceId': WORKSPACE,
                                                  'cnpj': item['cnpj'], 'status': source[0]['status']}}, upsert=True)
                cls.db.lookupItems.insert_one(item)

    @classmethod
    def tearDownClass(cls):
        cls.conn.drop_database(cls.db.name)
        cls.conn.close()
        cls.env.stop()

    def test_scoped_database_snapshot_and_generic_history(self):
        from reporting.purchases import purchase_metadata
        from reporting.service import get_job, jobs
        job = get_job(self.db, JOB, WORKSPACE, CLIENT)
        self.assertEqual(purchase_metadata(self.db, job, WORKSPACE)['totalCents'], 100000)
        sales = get_job(self.db, SALES_JOB, WORKSPACE, CLIENT)
        self.assertEqual(purchase_metadata(self.db, sales, WORKSPACE)['reportType'], 'SALES')
        self.assertEqual(jobs(self.db, WORKSPACE, CLIENT, 1)['total'], 0)
        self.db.cnpjStates.update_one({'_id': 'synthetic-state-0'}, {'$set': {'workspaceId': 'another-workspace'}})
        try:
            with self.assertRaises(ReportError):
                purchase_metadata(self.db, job, WORKSPACE)
        finally:
            self.db.cnpjStates.update_one({'_id': 'synthetic-state-0'}, {'$set': {'workspaceId': WORKSPACE}})

    def test_large_bson_doubles_survive_database_read_and_pdf_render(self):
        from reporting.purchases import purchase_metadata
        from reporting.service import get_job
        job, lines, items = large_double_fixture()
        job_id = str(uuid.uuid4())
        job['_id'] = job_id
        for line in lines:
            line.update(_id=f'{job_id}:{line["index"]}', jobId=job_id)
        for item in items:
            item.update(_id=f'{job_id}:{item["cnpj"]}', jobId=job_id)
            item.pop('sourceState', None)
        self.db.lookupJobs.insert_one(job)
        self.db.purchaseLines.insert_many(lines)
        self.db.lookupItems.insert_many(items)
        stored = self.db.purchaseLines.find_one({'_id': f'{job_id}:0'})
        self.assertIs(type(stored['totalCents']), float)
        meta = purchase_metadata(self.db, get_job(self.db, job_id, WORKSPACE, CLIENT), WORKSPACE)
        self.assertIs(type(meta['totalCents']), int)
        self.assertEqual(meta['totalCents'], 3_000_090_000)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_authenticated_http_financial_pdf_and_refused_generic_exports(self):
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        from api import reports as endpoint
        server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def call(extra):
            payload = {'action': 'pdf', 'layout': 'summary', 'jobId': JOB, 'clientId': CLIENT, **extra}
            return urlopen(Request(f'http://127.0.0.1:{server.server_port}/', data=json.dumps(payload).encode(),
                                   headers={'Origin': 'http://purchases.test', 'Content-Type': 'application/json', **self.cookie}), timeout=15)
        try:
            with patch.object(endpoint, 'database', return_value=self.db):
                with call({}) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('compras-', response.headers['Content-Disposition'])
                    self.assertTrue(response.read().startswith(b'%PDF'))
                with call({'jobId': SALES_JOB}) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('vendas-', response.headers['Content-Disposition'])
                    self.assertTrue(response.read().startswith(b'%PDF'))
                with self.assertRaises(HTTPError) as error:
                    call({'jobId': SALES_JOB, 'action': 'csv'})
                self.assertEqual(error.exception.code, 400)
                self.assertEqual(json.loads(error.exception.read())['error'], 'SALES_REPORT_MODE')
                for extra in ({'clientId': ''}, {'layout': 'detailed'}, {'action': 'csv'}, {'status': 'OPTANTE'}):
                    with self.subTest(extra=extra), self.assertRaises(HTTPError) as error:
                        call(extra)
                    self.assertEqual(error.exception.code, 400)
                self.db.purchaseLines.update_one({'_id': f'{JOB}:0'}, {'$inc': {'totalCents': 1}})
                try:
                    with self.assertRaises(HTTPError) as error:
                        call({})
                    self.assertEqual(error.exception.code, 409)
                finally:
                    self.db.purchaseLines.update_one({'_id': f'{JOB}:0'}, {'$inc': {'totalCents': -1}})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
