"""Synthetic purchase ICMS estimates: CPF eligibility, reconciliation and PDF memory."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from reporting.anticipation import (ANTICIPATION_VERSION, ANTICIPATION_LEGACY_VERSION,
                                    calculate_anticipation, summarize_anticipation)
from reporting.core import ReportError
from reporting.operation_catalog import OPERATION_CATALOG_VERSION, OPERATION_CATALOG_GROUPS, classify_operation_nature
from reporting.purchases import COMPONENT_FIELDS, reconcile_purchase_snapshot, render_purchase_pdf
from reporting.generations import generation_metadata, render_generation_pdf
from purchases_report_test import net_fixture, WORKSPACE
from difal_report_test import story_text
import generations_report_test


def anticipation_fixture(total=10000, *, nature='2102', issuer='MG', recipient='SP', cnpj=False,
                         version=ANTICIPATION_VERSION):
    job, all_lines, all_items = net_fixture()
    row = deepcopy(all_lines[0 if cnpj else -1])
    row.update(index=0, _id=f'{job["_id"]}:0', kind='FORNECEDOR', totalCents=total, grossCents=total+500,
               natureCode=nature, description='Compra sintética', recipientUf=recipient,
               operationVersion=OPERATION_CATALOG_VERSION, natureOperation=classify_operation_nature(nature))
    row['anticipation'] = calculate_anticipation(row, issuer, version)
    items = [deepcopy(all_items[0])] if cnpj else []
    if cnpj:
        items[0].update(occurrences=1, totalCents=total)
    job.update(operationVersion=OPERATION_CATALOG_VERSION, anticipationVersion=version, issuerUf=issuer,
               expectedRows=1, uploaded=1,
               summary={'lines': 1, 'unique': int(cnpj), 'invalid': int(not cnpj), 'duplicates': 0},
               purchaseInput={'totalCents': total, 'cnpjCents': total if cnpj else 0,
                   'components': {key: row[key] for key in (*COMPONENT_FIELDS, 'totalCents')},
                   'anticipation': summarize_anticipation([row], issuer, version)})
    return job, [row], items


class AnticipationReportTests(unittest.TestCase):
    def test_requested_rate_rounds_each_line_and_keeps_purchase_total(self):
        for total, expected in ((10000, 732), (15000, 1098), (100000, 7320), (1250, 92), (5, 0), (7, 1), (0, 0)):
            with self.subTest(total=total):
                job, rows, items = anticipation_fixture(total)
                meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
                self.assertEqual(meta['anticipation']['amountCents'], expected)
                self.assertEqual(meta['anticipation']['baseCents'], total)
                self.assertEqual(meta['totalCents'], total)
                self.assertEqual(sum(group['totalCents'] for group in meta['reportingGroups']), total)
                self.assertIsNone(meta['difal'])
        row = {'totalCents': 1250, 'natureCode': '1102', 'recipientUf': 'SP', 'document': '12345678901'}
        self.assertEqual(summarize_anticipation([row, row], 'MG')['amountCents'], 184)

    def test_only_cpf_is_eligible_and_other_documents_do_not_create_uf_pending(self):
        row = {'totalCents': 10000, 'natureCode': '2102002', 'recipientUf': 'SP'}
        for document in ('12345678901', '123.456.789-01'):
            self.assertTrue(calculate_anticipation({**row, 'document': document}, 'MG')['eligible'])
        for document in ('11222333000181', '123456789012', '', None, 'INVALIDO', '1234567890A'):
            with self.subTest(document=document):
                self.assertEqual(calculate_anticipation({**row, 'document': document}, 'MG')['reason'], 'NOT_CPF')
                self.assertEqual(calculate_anticipation({**row, 'document': document}, '')['reason'], 'NOT_CPF')
        meta = reconcile_purchase_snapshot(*anticipation_fixture(cnpj=True), WORKSPACE)
        self.assertEqual(meta['anticipation']['amountCents'], 0)
        self.assertEqual(meta['anticipation']['pendingLines'], 0)

    def test_catalog_purchase_and_service_prefixes_only(self):
        row = {'totalCents': 10000, 'recipientUf': 'SP', 'document': '12345678901'}
        for nature in (*OPERATION_CATALOG_GROUPS['COMPRAS'], '8000', '8000002', '8000102'):
            with self.subTest(nature=nature):
                self.assertEqual(calculate_anticipation({**row, 'natureCode': nature}, 'MG')['amountCents'], 732)
        for nature in ('1202', '2202', '5202', '5102', '9000', '1910', '9999', ''):
            self.assertEqual(calculate_anticipation({**row, 'natureCode': nature}, 'MG')['reason'], 'NOT_PURCHASE')

    def test_ufs_are_explicit_and_invalid_totals_are_rejected(self):
        row = {'totalCents': 10000, 'natureCode': '1102', 'recipientUf': 'SP', 'document': '12345678901'}
        for issuer, recipient, reason in (('MG', 'MG', 'SAME_UF'), ('', 'SP', 'MISSING_ISSUER_UF'),
                                           ('MG', '', 'MISSING_RECIPIENT_UF'), ('XX', 'SP', 'MISSING_ISSUER_UF')):
            self.assertEqual(calculate_anticipation({**row, 'recipientUf': recipient}, issuer)['reason'], reason)
        for total in (-1, 1.5, True, None, float('nan'), float('inf'), 9_007_199_254_740_992):
            self.assertEqual(calculate_anticipation({**row, 'totalCents': total}, 'MG')['reason'], 'INVALID_TOTAL')
        with self.assertRaises(ValueError):
            calculate_anticipation(row, 'MG', 'UNKNOWN')
        with self.assertRaises(ValueError):
            summarize_anticipation([{**row, 'totalCents': 9_007_199_254_740_991}]*2, 'MG')

    def test_version_one_remains_frozen_without_cpf_gate(self):
        job, rows, items = anticipation_fixture(cnpj=True, version=ANTICIPATION_LEGACY_VERSION)
        meta = reconcile_purchase_snapshot(job, rows, items, WORKSPACE)
        self.assertEqual(meta['anticipation']['amountCents'], 732)
        self.assertIn('Regra histórica V1 preservada', story_text(meta))
        self.assertNotIn('Somente compras interestaduais com fornecedor identificado por CPF', story_text(meta))
        self.assertEqual(calculate_anticipation(rows[0], 'MG')['reason'], 'NOT_CPF')

    def test_reconciliation_blocks_missing_tampered_estimates_and_summary(self):
        changes = [
            lambda j, r: r.pop('anticipation'),
            lambda j, r: r['anticipation'].update(amountCents=733),
            lambda j, r: r['anticipation'].update(baseCents=9999),
            lambda j, r: r['anticipation'].update(eligible=1),
            lambda j, r: r['anticipation'].update(reason='NOT_CPF'),
            lambda j, r: r.update(recipientUf='MG'),
            lambda j, r: r.update(natureCode='5102', natureOperation='VENDA'),
            lambda j, r: j.update(issuerUf='SP'),
            lambda j, r: j.update(anticipationVersion='UNKNOWN'),
            lambda j, r: j['purchaseInput'].pop('anticipation'),
            lambda j, r: j['purchaseInput']['anticipation'].update(ratePercent=7),
            lambda j, r: j['purchaseInput']['anticipation'].update(version=ANTICIPATION_LEGACY_VERSION),
            lambda j, r: j['purchaseInput']['anticipation'].update(amountCents=731),
            lambda j, r: j['purchaseInput']['anticipation'].update(pendingLines=1),
        ]
        for change in changes:
            job, rows, items = anticipation_fixture()
            change(job, rows[0])
            with self.assertRaises(ReportError):
                reconcile_purchase_snapshot(job, rows, items, WORKSPACE)

    def test_pdf_presents_rate_base_cpf_pending_and_unavailable_history(self):
        for options, expected in (({}, 'R$ 7,32'), ({'recipient': ''}, 'Estimativa parcial')):
            meta = reconcile_purchase_snapshot(*anticipation_fixture(**options), WORKSPACE)
            text = story_text(meta)
            for phrase in ('Antecipação de ICMS (7,32%)', 'Base elegível', expected,
                           'Somente compras interestaduais com fornecedor identificado por CPF de 11 dígitos',
                           'Simples puro e híbrido', 'sublimite estiver alcançado'):
                self.assertIn(phrase, text)
            self.assertTrue(render_purchase_pdf(meta).startswith(b'%PDF'))
        legacy = reconcile_purchase_snapshot(*net_fixture(), WORKSPACE)
        self.assertIsNone(legacy['anticipation'])
        self.assertIn('Indisponível neste histórico', story_text(legacy))

    def test_consolidation_sums_once_and_identifies_missing_and_old_versions(self):
        db, _, _, snapshots = generations_report_test.GenerationReportTests().setup_db(3, ['PURCHASES'])
        entries = list(snapshots.items())
        for index, (job_id, (old, _, _)) in enumerate(entries[:2]):
            job, rows, items = anticipation_fixture(10000 if index == 0 else 20000,
                cnpj=index == 1, version=ANTICIPATION_VERSION if index == 0 else ANTICIPATION_LEGACY_VERSION)
            job.update({key: old[key] for key in ('_id', 'generationId', 'clientId', 'clientCode', 'clientName')})
            for row in rows:
                row['jobId'] = job_id
            for item in items:
                item.update(jobId=job_id, clientId=job['clientId'])
            snapshots[job_id] = job, rows, items
        with patch('reporting.generations.purchase_metadata', side_effect=lambda db, job, workspace:
                   reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)):
            meta = generation_metadata(db, generations_report_test.GENERATION, WORKSPACE)
        self.assertEqual(meta['totalsByType']['PURCHASES']['anticipation'], {
            'baseCents': 30000, 'amountCents': 2196, 'eligibleLines': 2, 'pendingLines': 0,
            'unavailableReports': 1, 'legacyReports': 1})
        self.assertEqual(meta['totalsByType']['PURCHASES']['totalCents'], 130000)
        self.assertTrue(render_generation_pdf(meta).startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
