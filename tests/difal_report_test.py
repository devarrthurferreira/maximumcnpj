"""Synthetic DIFAL snapshots: calculation parity, reconciliation and PDF presentation."""
import unittest
from copy import deepcopy
from unittest.mock import patch

from reporting.core import ReportError
from reporting.difal import DIFAL_VERSION, calculate_difal, sales_operation
from reporting.purchases import COMPONENT_FIELDS, reconcile_purchase_snapshot, purchase_story, purchase_pdf_styles, render_purchase_pdf
from reporting.generations import generation_metadata, render_generation_pdf
from purchases_report_test import sales_fixture, net_fixture, WORKSPACE
import generations_report_test


def difal_fixture(cents=15000, *, reason='ELIGIBLE', issuer='MG', recipient='SP',
                  nature='6108', description='Camiseta', operation='VENDA', cnpj=False):
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
    job.update(difalVersion=DIFAL_VERSION, issuerUf=issuer, expectedRows=1, uploaded=1,
               summary={'lines': 1, 'unique': int(cnpj), 'invalid': int(not cnpj), 'duplicates': 0},
               purchaseInput={'totalCents': cents, 'balanceCents': row['balanceCents'],
                              'cnpjCents': cents if cnpj else 0,
                              'components': {key: row[key] for key in (*COMPONENT_FIELDS, 'totalCents')},
                              'difal': {'version': DIFAL_VERSION, 'ratePercent': 10, 'issuerUf': issuer,
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
    def test_requested_amounts_and_recalculation_preserve_sale_total(self):
        for total, amount in ((15000, 1500), (100000, 10000), (25000, 2500), (5, 1), (4, 0)):
            with self.subTest(total=total):
                job, lines, items = difal_fixture(total)
                self.assertEqual(calculate_difal(lines[0], 'MG')['amountCents'], amount)
                meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(meta['difal']['amountCents'], amount)
                self.assertEqual(meta['totalCents'], total)
                self.assertEqual(meta['components']['accessoryCents'], 1234)
                self.assertEqual(sum(group['totalCents'] for group in meta['reportingGroups']), total)
        _, lines, _ = difal_fixture()
        lines[0]['totalCents'] = 100000
        self.assertEqual(calculate_difal(lines[0], 'MG')['amountCents'], 10000)

    def test_exclusions_and_missing_ufs_have_distinct_states(self):
        cases = [
            {'reason': 'NOT_CPF', 'cnpj': True},
            {'reason': 'SAME_UF', 'recipient': 'MG'},
            {'reason': 'NOT_SALE', 'nature': '9000', 'operation': 'SERVICO', 'description': 'Prestação de serviço'},
            {'reason': 'NOT_SALE', 'nature': '6202', 'operation': 'DEVOLUCAO', 'description': 'Devolução'},
            {'reason': 'NOT_SALE', 'nature': '6918', 'operation': 'OUTRAS', 'description': 'Remessa'},
            {'reason': 'INELIGIBLE_NATURE', 'nature': '6999', 'description': 'Venda'},
            {'reason': 'MISSING_ISSUER_UF', 'issuer': ''},
            {'reason': 'MISSING_RECIPIENT_UF', 'recipient': ''},
        ]
        for case in cases:
            with self.subTest(case=case):
                job, lines, items = difal_fixture(**case)
                self.assertEqual(calculate_difal(lines[0], job['issuerUf']), lines[0]['difal'])
                meta = reconcile_purchase_snapshot(job, lines, items, WORKSPACE)
                self.assertEqual(meta['difal']['amountCents'], 0)
                self.assertEqual(meta['difal']['baseCents'], 0)
                self.assertEqual(meta['difal']['pendingLines'], int(case['reason'].startswith('MISSING_')))

    def test_explicit_allowlist_product_description_and_contradictions(self):
        for nature in ('6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108'):
            for description in ('', 'Camiseta'):
                job, lines, items = difal_fixture(nature=nature, description=description)
                self.assertEqual(sales_operation(nature, description), 'VENDA')
                self.assertEqual(reconcile_purchase_snapshot(job, lines, items, WORKSPACE)['difal']['amountCents'], 1500)
        for description in ('Prestação de serviço', 'Devolução', 'Remessa', 'Transferência', 'Bonificação'):
            _, lines, _ = difal_fixture(description=description)
            self.assertFalse(calculate_difal(lines[0], 'MG')['eligible'])
        self.assertEqual(sales_operation('6999', 'Camiseta'), 'OUTRAS')
        self.assertEqual(sales_operation('6108', 'Venda de kit para conserto'), 'VENDA')

    def test_snapshot_reconciliation_blocks_tampered_or_missing_difal(self):
        mutations = [
            lambda j, r: r['difal'].update(amountCents=1499),
            lambda j, r: r['difal'].update(baseCents=14999),
            lambda j, r: r['difal'].update(eligible=1),
            lambda j, r: r['difal'].update(reason='SAME_UF'),
            lambda j, r: r.pop('difal'),
            lambda j, r: r.update(recipientUf='MG'),
            lambda j, r: r.update(recipientUf='sp'),
            lambda j, r: r.update(description='Prestação de serviço'),
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
                job, rows, items = difal_fixture()
                change(job, rows[0])
                with self.assertRaises(ReportError):
                    reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_changed_sale_without_updated_difal_blocks_report(self):
        job, rows, items = difal_fixture()
        rows[0].update(totalCents=100000, grossCents=100000, balanceCents=100000)
        job['purchaseInput'].update(totalCents=100000, balanceCents=100000)
        job['purchaseInput']['components'].update(totalCents=100000, grossCents=100000)
        with self.assertRaises(ReportError):
            reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_pdf_has_separate_estimate_base_pending_and_legacy_notice(self):
        for fixture_args, expected in (({}, 'R$ 15,00'), ({'reason': 'MISSING_RECIPIENT_UF', 'recipient': ''}, 'Estimativa parcial')):
            meta = reconcile_purchase_snapshot(*difal_fixture(**fixture_args), WORKSPACE)
            text = story_text(meta)
            self.assertIn('DIFAL estimado (10%)', text)
            self.assertIn('Base elegível', text)
            self.assertIn(expected, text)
            self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        meta = reconcile_purchase_snapshot(*sales_fixture(), WORKSPACE)
        self.assertIsNone(meta['difal'])
        self.assertIn('Indisponível neste histórico', story_text(meta))
        purchase = reconcile_purchase_snapshot(*net_fixture(), WORKSPACE)
        self.assertNotIn('DIFAL', story_text(purchase))

    def test_consolidation_sums_difal_once_and_marks_legacy_reports(self):
        helper = generations_report_test.GenerationReportTests()
        db, _, _, snapshots = helper.setup_db(2, ['SALES'])
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
        self.assertEqual((difal['baseCents'], difal['amountCents'], difal['eligibleLines']), (115000, 11500, 2))
        self.assertEqual(meta['totalsByType']['SALES']['totalCents'], 115000)
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))
        snapshots[entries[1][0]][0].pop('difalVersion')
        with patch('reporting.generations.purchase_metadata', side_effect=metadata):
            meta = generation_metadata(db, '00000000-0000-4000-8000-000000000090', WORKSPACE)
        self.assertEqual(meta['totalsByType']['SALES']['difal']['unavailableReports'], 1)
        self.assertEqual(meta['totalsByType']['SALES']['difal']['amountCents'], 1500)
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
