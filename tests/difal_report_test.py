"""Synthetic DIFAL snapshots: calculation parity, reconciliation and PDF presentation."""
import unittest
from copy import deepcopy
from unittest.mock import patch

from reporting.core import ReportError
from reporting.difal import DIFAL_VERSION, DIFAL_CPF_ONLY_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_CPF_VERSION, DIFAL_PREVIOUS_VERSION, calculate_difal, sales_operation
from reporting.operation_catalog import OPERATION_CATALOG_GROUPS, OPERATION_CATALOG_VERSION
from reporting.purchases import COMPONENT_FIELDS, reconcile_purchase_snapshot, purchase_story, purchase_pdf_styles, render_purchase_pdf
from reporting.generations import generation_metadata, render_generation_pdf
from purchases_report_test import sales_fixture, net_fixture, WORKSPACE
import generations_report_test


def difal_fixture(cents=15000, *, reason=None, issuer='MG', recipient='SP',
                  nature='6108', description='Camiseta', operation='VENDA', cnpj=False, version=DIFAL_VERSION):
    reason = reason or ('OUTGOING_DISABLED' if version == DIFAL_VERSION else 'ELIGIBLE')
    job, source_lines, source_items = sales_fixture()
    row = deepcopy(source_lines[0 if cnpj else -1])
    row.update(index=0, _id=f'{job["_id"]}:0', totalCents=cents, grossCents=cents,
               discountCents=0, accessoryCents=1234, freightCents=0, abatementCents=0,
               natureCode=nature, description=description, operation=operation,
               balanceCents=-cents if operation == 'DEVOLUCAO' else cents, recipientUf=recipient,
               difal={'eligible': reason == 'ELIGIBLE', 'baseCents': cents if reason == 'ELIGIBLE' else 0,
                      'amountCents': (cents + 5) // 10 if reason == 'ELIGIBLE' else 0, 'reason': reason})
    items = []
    if cnpj:
        item = deepcopy(source_items[0])
        item.update(occurrences=1, totalCents=cents)
        items.append(item)
    job.update(difalVersion=version, issuerUf=issuer, expectedRows=1, uploaded=1,
               summary={'lines': 1, 'unique': int(cnpj), 'invalid': int(not cnpj), 'duplicates': 0},
               purchaseInput={'totalCents': cents, 'balanceCents': row['balanceCents'],
                              'cnpjCents': cents if cnpj else 0,
                              'components': {key: row[key] for key in (*COMPONENT_FIELDS, 'totalCents')},
                              'difal': {'version': version, 'ratePercent': 10, 'issuerUf': issuer,
                                        'eligibleLines': int(reason == 'ELIGIBLE'),
                                        'baseCents': row['difal']['baseCents'], 'amountCents': row['difal']['amountCents'],
                                        'pendingLines': int(reason in ('MISSING_ISSUER_UF', 'MISSING_RECIPIENT_UF'))}})
    return job, [row], items


def story_text(meta):
    parts = purchase_story(meta, 778, purchase_pdf_styles())
    text = []
    for part in parts:
        if hasattr(part, 'getPlainText'):
            text.append(part.getPlainText())
        if hasattr(part, '_cellvalues'):
            text.extend(cell.getPlainText() for row in part._cellvalues for cell in row)
    return '\n'.join(text)


class DifalReportTests(unittest.TestCase):
    def test_current_rule_disables_exit_and_preserves_cpf_v5_and_cnpj_v4_history(self):
        _, rows, _ = difal_fixture()
        for document in ('12345678901', '123.456.789-01'):
            self.assertEqual(calculate_difal({**rows[0], 'document': document}, 'MG', DIFAL_CPF_ONLY_VERSION)['amountCents'], 1500)
        for document in ('11222333000181', '11.222.333/0001-81', '12ABC34501DE35', '12.abc.345/01de-35'):
            self.assertEqual(calculate_difal({**rows[0], 'document': document}, 'MG', DIFAL_CPF_ONLY_VERSION)['reason'], 'NOT_CPF')
            self.assertEqual(calculate_difal({**rows[0], 'document': document}, 'MG', DIFAL_CPF_CNPJ_VERSION)['amountCents'], 1500)
        for document in ('12345678901', '123.456.789-01', '11222333000181', '12ABC34501DE35',
                         '11222333000182', '00000000000000', '', None, 'INVALIDO'):
            for issuer, recipient in (('MG', 'SP'), ('MG', 'MG'), ('', ''), (None, None)):
                with self.subTest(document=document, issuer=issuer, recipient=recipient):
                    self.assertEqual(calculate_difal({**rows[0], 'document': document, 'recipientUf': recipient}, issuer),
                                     {'eligible': False, 'baseCents': 0, 'amountCents': 0, 'reason': 'OUTGOING_DISABLED'})
        for total in (None, -1, True, 1.5, float('inf'), float('nan'), 9_007_199_254_740_992):
            self.assertEqual(calculate_difal({**rows[0], 'totalCents': total}, '')['reason'], 'INVALID_TOTAL')

    def test_v4_cnpj_snapshot_keeps_original_but_current_pdf_confirms_zero(self):
        job, rows, items = difal_fixture(cnpj=True, version=DIFAL_CPF_CNPJ_VERSION)
        frozen = deepcopy((job, rows, items))
        meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
        self.assertEqual(job['purchaseInput']['difal']['amountCents'], 1500)
        self.assertEqual(meta['difal']['version'], DIFAL_VERSION)
        self.assertEqual(meta['difal']['amountCents'], 0)
        self.assertEqual(meta['difal']['eligibleLines'], 0)
        self.assertEqual(meta['difal']['pendingLines'], 0)
        self.assertIn('Não possui DIFAL de saída', story_text(meta))
        self.assertNotIn('10%', story_text(meta))
        self.assertEqual((job, rows, items), frozen)
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))

    def test_v3_cnpj_snapshot_is_validated_and_current_view_is_read_only(self):
        job, rows, items = difal_fixture(cnpj=True, reason='NOT_CPF', version=DIFAL_CPF_VERSION)
        frozen = deepcopy((job, rows, items))
        meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
        self.assertEqual(meta['difal']['amountCents'], 0)
        self.assertEqual(meta['difal']['version'], DIFAL_VERSION)
        self.assertEqual(meta['job']['difalVersion'], DIFAL_CPF_VERSION)
        self.assertEqual(meta['difalOrigin'], 'DERIVED_FROM_SNAPSHOT')
        self.assertEqual((job, rows, items), frozen)
        self.assertEqual(calculate_difal(rows[0], 'MG', DIFAL_CPF_VERSION)['reason'], 'NOT_CPF')
        self.assertIn('Regra atual aplicada aos dados salvos no relatório de origem', story_text(meta))
        self.assertIn('Não possui DIFAL de saída', story_text(meta))
        self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        for change in (lambda j, r: r['difal'].update(amountCents=1500),
                       lambda j, r: j['purchaseInput']['difal'].update(amountCents=1500)):
            job, rows, items = deepcopy(frozen)
            change(job, rows[0])
            with self.assertRaises(ReportError):
                reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_unversioned_view_disables_exit_without_uf_and_preserves_file_validation(self):
        job, rows, items = difal_fixture()
        job.pop('difalVersion')
        job.pop('issuerUf')
        job['purchaseInput'].pop('difal')
        rows[0].pop('difal')
        meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
        self.assertEqual(meta['difalOrigin'], 'DERIVED_FROM_SNAPSHOT')
        self.assertEqual(meta['difal']['pendingLines'], 0)
        self.assertEqual(meta['difal']['amountCents'], 0)
        frozen = deepcopy((job, rows, items))
        for key, value in (('natureCode', None), ('natureCode', ''), ('natureCode', '6108002'),
                           ('recipientUf', None), ('recipientUf', 'sp'), ('recipientUf', 'XX')):
            job, rows, items = deepcopy(frozen)
            if value is None:
                rows[0].pop(key)
            else:
                rows[0][key] = value
            meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
            self.assertEqual(meta['difalOrigin'], 'DERIVED_FROM_SNAPSHOT')
            self.assertEqual(meta['difal']['version'], DIFAL_VERSION)
            self.assertEqual(meta['difal']['amountCents'], 0)
            self.assertEqual(meta['difal']['pendingLines'], 0)
        job, rows, items = difal_fixture(nature='', operation='OUTRAS', reason='NOT_SALE', version=DIFAL_CPF_VERSION)
        meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
        self.assertEqual(meta['difal']['amountCents'], 0)
        self.assertEqual(meta['difalOrigin'], 'DERIVED_FROM_SNAPSHOT')
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, [], items, WORKSPACE)

    def test_5102_original_rules_are_validated_before_current_view(self):
        for version in ('DIFAL_ESTIMATE_V1', 'DIFAL_ESTIMATE_V2', DIFAL_CPF_VERSION, DIFAL_CPF_CNPJ_VERSION, DIFAL_CPF_ONLY_VERSION, DIFAL_VERSION):
            old = version == 'DIFAL_ESTIMATE_V1'
            job, rows, items = difal_fixture(nature='5102', description='REGATA SINTÉTICA',
                                            operation='OUTRAS' if old else 'VENDA', version=version,
                                            reason='NOT_SALE' if old else ('OUTGOING_DISABLED' if version == DIFAL_VERSION else 'ELIGIBLE'))
            frozen = deepcopy((job, rows, items))
            meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
            self.assertEqual(meta['difal']['amountCents'], 0)
            self.assertEqual(meta['difal']['version'], DIFAL_VERSION)
            self.assertEqual(meta['job']['difalVersion'], version)
            self.assertEqual(meta['difalOrigin'], 'IMPORTED' if version == DIFAL_VERSION else 'DERIVED_FROM_SNAPSHOT')
            self.assertEqual((job, rows, items), frozen)
            self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        for nature in ('5102001', '5102090', '5.102.001'):
            self.assertEqual(sales_operation(nature, 'REGATA SINTÉTICA'), 'VENDA')
            self.assertEqual(sales_operation(nature, 'REGATA SINTÉTICA', 'DIFAL_ESTIMATE_V1'), 'OUTRAS')

    def test_requested_amounts_and_recalculation_preserve_sale_total(self):
        for total, amount in ((15000, 1500), (100000, 10000), (25000, 2500), (5, 1), (4, 0)):
            with self.subTest(total=total):
                job, lines, items = difal_fixture(total)
                self.assertEqual(calculate_difal(lines[0], 'MG')['amountCents'], 0)
                self.assertEqual(calculate_difal(lines[0], 'MG', DIFAL_CPF_ONLY_VERSION)['amountCents'], amount)
                meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(meta['difal']['amountCents'], 0)
                self.assertEqual(meta['totalCents'], total)
                self.assertEqual(meta['components']['accessoryCents'], 1234)
                self.assertEqual(sum(group['totalCents'] for group in meta['reportingGroups']), total)
        _, lines, _ = difal_fixture()
        lines[0]['totalCents'] = 100000
        self.assertEqual(calculate_difal(lines[0], 'MG')['amountCents'], 0)
        self.assertEqual(calculate_difal(lines[0], 'MG', DIFAL_CPF_ONLY_VERSION)['amountCents'], 10000)

    def test_legacy_exclusions_and_missing_ufs_are_validated_before_current_zero(self):
        cases = [
            {'reason': 'SAME_UF', 'recipient': 'MG'},
            {'reason': 'NOT_SALE', 'nature': '9000', 'operation': 'SERVICO', 'description': 'Prestação de serviço'},
            {'reason': 'NOT_SALE', 'nature': '6202', 'operation': 'DEVOLUCAO', 'description': 'Devolução'},
            {'reason': 'NOT_SALE', 'nature': '6918', 'operation': 'OUTRAS', 'description': 'Remessa'},
            {'reason': 'NOT_SALE', 'nature': '6999', 'operation': 'OUTRAS', 'description': 'Venda'},
            {'reason': 'MISSING_ISSUER_UF', 'issuer': ''},
            {'reason': 'MISSING_RECIPIENT_UF', 'recipient': ''},
        ]
        for case in cases:
            with self.subTest(case=case):
                job, lines, items = difal_fixture(**case, version=DIFAL_CPF_ONLY_VERSION)
                self.assertEqual(calculate_difal(lines[0], job['issuerUf'], DIFAL_CPF_ONLY_VERSION), lines[0]['difal'])
                frozen = deepcopy((job, lines, items))
                meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(meta['difal']['amountCents'], 0)
                self.assertEqual(meta['difal']['baseCents'], 0)
                self.assertEqual(meta['difal']['pendingLines'], 0)
                self.assertEqual((job, lines, items), frozen)

    def test_explicit_allowlist_product_description_and_contradictions(self):
        for nature in ('6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108'):
            for description in ('', 'Camiseta'):
                job, lines, items = difal_fixture(nature=nature, description=description)
                self.assertEqual(sales_operation(nature, description), 'VENDA')
                self.assertEqual(reconcile_purchase_snapshot(job, lines, items, WORKSPACE)['difal']['amountCents'], 0)
        for description in ('Prestação de serviço', 'Devolução', 'Remessa', 'Transferência', 'Bonificação'):
            _, lines, _ = difal_fixture(description=description)
            self.assertFalse(calculate_difal(lines[0], 'MG')['eligible'])
            self.assertTrue(calculate_difal(lines[0], 'MG', DIFAL_CPF_ONLY_VERSION)['eligible'])
            self.assertFalse(calculate_difal(lines[0], 'MG', DIFAL_PREVIOUS_VERSION)['eligible'])
        self.assertEqual(sales_operation('6999', 'Camiseta'), 'OUTRAS')
        self.assertEqual(sales_operation('6108', 'Venda de kit para conserto'), 'VENDA')

    def test_service_nature_prefix_is_prioritized_and_reported(self):
        for nature in ('9000', '900000', '900001', '90001234', '9.000.01'):
            for description in ('', 'Venda', 'Devolução'):
                with self.subTest(nature=nature, description=description):
                    self.assertEqual(sales_operation(nature, description), 'SERVICO')
                    job, rows, items = difal_fixture(nature='9000', description=description,
                                                     operation='SERVICO')
                    meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
                    text = story_text(meta)
                    self.assertIn('Vendas de serviços', text)
                    self.assertIn('Não possui DIFAL de saída', text)
                    self.assertEqual(meta['difal']['amountCents'], 0)
                    service = next(item for item in meta['operationTotals'] if item['operation'] == 'SERVICO')
                    self.assertEqual(service['balanceCents'], 15000)

    def test_snapshot_reconciliation_blocks_tampered_or_missing_difal(self):
        mutations = [
            lambda j, r: r['difal'].update(amountCents=1499),
            lambda j, r: r['difal'].update(baseCents=14999),
            lambda j, r: r['difal'].update(eligible=1),
            lambda j, r: r['difal'].update(reason='SAME_UF'),
            lambda j, r: r.pop('difal'),
            lambda j, r: r.update(recipientUf='MG'),
            lambda j, r: r.update(recipientUf='sp'),
            lambda j, r: r.update(natureCode='6999'),
            lambda j, r: r.update(operation='SERVICO'),
            lambda j, r: j.update(issuerUf='SP'),
            lambda j, r: j.update(difalVersion='UNKNOWN'),
            lambda j, r: j['purchaseInput'].pop('difal'),
            lambda j, r: j['purchaseInput']['difal'].update(ratePercent=12),
            lambda j, r: j['purchaseInput']['difal'].update(amountCents=1499),
            lambda j, r: j['purchaseInput']['difal'].update(pendingLines=1),
        ]
        for index, change in enumerate(mutations):
            with self.subTest(index=index):
                job, rows, items = difal_fixture(version=DIFAL_CPF_ONLY_VERSION)
                change(job, rows[0])
                with self.assertRaises(ReportError):
                    reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_disabled_snapshot_rejects_positive_amounts_and_incomplete_sales(self):
        for mutate in (
                lambda job, row: row['difal'].update(eligible=True, baseCents=15000, amountCents=1500, reason='ELIGIBLE'),
                lambda job, row: job['purchaseInput']['difal'].update(baseCents=15000, amountCents=1500, eligibleLines=1),
                lambda job, row: row['difal'].update(reason='MISSING_RECIPIENT_UF'),
                lambda job, row: job['purchaseInput']['difal'].update(pendingLines=1),
                lambda job, row: job['purchaseInput'].update(totalCents=14999),
                lambda job, row: job.update(uploaded=0)):
            values = difal_fixture()
            mutate(values[0], values[1][0])
            with self.assertRaises(ReportError):
                reconcile_purchase_snapshot(*values, WORKSPACE)

    def test_current_preserves_catalog_sales_but_has_no_exit_for_any_operation(self):
        for nature in OPERATION_CATALOG_GROUPS['VENDA']:
            row = {'natureCode': nature + '002', 'description': 'Remessa de serviço',
                   'document': '123.456.789-01', 'totalCents': 10005, 'recipientUf': 'SP'}
            with self.subTest(nature=nature):
                self.assertEqual(sales_operation(row['natureCode'], row['description']), 'VENDA')
                self.assertEqual(calculate_difal(row, 'MG'), {
                    'eligible': False, 'baseCents': 0, 'amountCents': 0, 'reason': 'OUTGOING_DISABLED'})
                self.assertEqual(calculate_difal(row, 'MG', DIFAL_CPF_ONLY_VERSION), {
                    'eligible': True, 'baseCents': 10005, 'amountCents': 1001, 'reason': 'ELIGIBLE'})
        for operation, natures in OPERATION_CATALOG_GROUPS.items():
            if operation == 'VENDA':
                continue
            for nature in natures:
                row = {'natureCode': nature, 'description': 'Venda de mercadoria',
                       'document': '12345678901', 'totalCents': 10000, 'recipientUf': 'SP'}
                with self.subTest(operation=operation, nature=nature):
                    self.assertEqual(calculate_difal(row, 'MG')['reason'], 'OUTGOING_DISABLED')
                    self.assertEqual(calculate_difal(row, 'MG', DIFAL_CPF_ONLY_VERSION)['reason'], 'NOT_SALE')
        for nature in ('8000002', '8000102', '9000001', '9999001', ''):
            self.assertEqual(calculate_difal({'natureCode': nature, 'description': 'Venda',
                'document': '12345678901', 'totalCents': 10000, 'recipientUf': 'SP'}, 'MG')['reason'], 'OUTGOING_DISABLED')

    def test_v2_unknown_description_sale_remains_frozen(self):
        job, rows, items = difal_fixture(nature='6999', description='Venda', reason='INELIGIBLE_NATURE')
        job['difalVersion'] = job['purchaseInput']['difal']['version'] = DIFAL_PREVIOUS_VERSION
        self.assertEqual(reconcile_purchase_snapshot(job, rows, items, WORKSPACE)['difal']['amountCents'], 0)
        rows[0]['description'] = 'Prestação de serviço'
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_changed_sale_without_updated_difal_blocks_report(self):
        job, rows, items = difal_fixture(version=DIFAL_CPF_ONLY_VERSION)
        rows[0].update(totalCents=100000, grossCents=100000, balanceCents=100000)
        job['purchaseInput'].update(totalCents=100000, balanceCents=100000)
        job['purchaseInput']['components'].update(totalCents=100000, grossCents=100000)
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_current_pdf_identifies_disabled_rule_including_cpf_interstate_and_no_uf(self):
        import pymupdf
        for fixture_args in ({}, {'issuer': '', 'recipient': ''}, {'version': DIFAL_CPF_ONLY_VERSION}):
            meta = reconcile_purchase_snapshot(*difal_fixture(**fixture_args), WORKSPACE)
            text = story_text(meta)
            self.assertIn('Não possui DIFAL de saída', text)
            self.assertIn('regra de análise', text)
            self.assertIn('R$ 0,00', text)
            self.assertNotIn('10%', text)
            self.assertNotIn('Não possui vendas elegíveis', text)
            with pymupdf.open(stream=render_purchase_pdf(meta), filetype='pdf') as pdf:
                rendered = '\n'.join(page.get_text() for page in pdf)
            self.assertIn('Não possui DIFAL de saída', rendered)
            self.assertNotIn('10%', rendered)
        meta = reconcile_purchase_snapshot(*sales_fixture(), WORKSPACE)
        self.assertEqual(meta['difal']['amountCents'], 0)
        self.assertIn('Não possui DIFAL de saída', story_text(meta))
        purchase = reconcile_purchase_snapshot(*net_fixture(), WORKSPACE)
        self.assertIn('DIFAL de entrada — Antecipação de ICMS', story_text(purchase))
        self.assertIn('Indisponível neste histórico', story_text(purchase))

    def test_consolidation_disables_exit_preserves_revenue_and_marks_legacy_reports(self):
        helper = generations_report_test.GenerationReportTests()
        db, generation, _, snapshots = helper.setup_db(2, ['SALES'])
        for company in generation['companies']:
            company['difalPolicy'] = {'version': 'DIFAL_SCENARIOS_V2',
                'enabled': {'pure': True, 'hybrid': True, 'presumed': False, 'actual': False},
                'operations': {'pure': {'entry': True, 'exit': True}, 'hybrid': {'entry': True, 'exit': True}}}
        entries = list(snapshots.items())
        for index, (job_id, (job, _, _)) in enumerate(entries):
            replacement, rows, items = difal_fixture(15000 if index == 0 else 100000)
            replacement.update({key: job[key] for key in ('_id', 'generationId', 'clientId', 'clientCode', 'clientName')})
            for row in rows:
                row['jobId'] = job_id
            snapshots[job_id] = replacement, rows, items
        def metadata(_db, job, workspace):
            return reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)
        with patch('reporting.generations.purchase_metadata', side_effect=metadata):
            meta = generation_metadata(db, '00000000-0000-4000-8000-000000000090', WORKSPACE)
        difal = meta['totalsByType']['SALES']['difal']
        self.assertEqual((difal['baseCents'], difal['amountCents'], difal['eligibleLines']), (0, 0, 0))
        self.assertEqual(meta['totalsByType']['SALES']['totalCents'], 115000)
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))
        snapshots[entries[1][0]][0].pop('difalVersion')
        with patch('reporting.generations.purchase_metadata', side_effect=metadata):
            meta = generation_metadata(db, '00000000-0000-4000-8000-000000000090', WORKSPACE)
        self.assertEqual(meta['totalsByType']['SALES']['difal']['unavailableReports'], 0)
        self.assertEqual(meta['totalsByType']['SALES']['difal']['derivedReports'], 1)
        self.assertEqual(meta['totalsByType']['SALES']['difal']['amountCents'], 0)
        snapshots[entries[1][0]][1][0].pop('recipientUf')
        with patch('reporting.generations.purchase_metadata', side_effect=metadata):
            unavailable = generation_metadata(db, '00000000-0000-4000-8000-000000000090', WORKSPACE)
        self.assertEqual(unavailable['totalsByType']['SALES']['difal']['unavailableReports'], 0)
        self.assertEqual(unavailable['totalsByType']['SALES']['difal']['amountCents'], 0)
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
