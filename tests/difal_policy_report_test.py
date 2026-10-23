"""Synthetic report selection: trusted ownership, immutable evidence and real PDFs."""
from copy import deepcopy
import os
import unittest
from unittest.mock import patch
import uuid

import pymupdf
from reporting.core import ReportError, utcnow
from reporting.difal_policy import parse_difal_policy, direction_selection, report_difal_policy
from reporting.purchases import purchase_metadata, reconcile_purchase_snapshot, render_purchase_pdf
from reporting.generations import generation_metadata, render_generation_pdf
from anticipation_report_test import anticipation_fixture
from difal_report_test import difal_fixture, story_text
import generations_report_test
from purchases_report_test import WORKSPACE

GENERATION = generations_report_test.GENERATION


def policy(*, pure_entry=True, pure_exit=False, hybrid_entry=False, hybrid_exit=False):
    return {'version': 'DIFAL_SCENARIOS_V2',
            'enabled': {'pure': True, 'hybrid': True, 'presumed': False, 'actual': False},
            'operations': {'pure': {'entry': pure_entry, 'exit': pure_exit},
                           'hybrid': {'entry': hybrid_entry, 'exit': hybrid_exit}}}


def pdf_text(data):
    with pymupdf.open(stream=data, filetype='pdf') as doc:
        return '\n'.join(page.get_text() for page in doc)


def selectable_generation(count=3):
    db, generation, jobs, snapshots = generations_report_test.GenerationReportTests().setup_db(count, ['PURCHASES', 'SALES'])
    generation['companies'][0]['difalPolicy'] = policy()
    if count > 1:
        generation['companies'][1]['difalPolicy'] = policy(pure_entry=False, hybrid_exit=True)
    for index, old in enumerate(jobs):
        sales = old['mode'] == 'SALES_V1'
        replacement, rows, items = (difal_fixture if sales else anticipation_fixture)((index // 2 + 1) * 10000)
        replacement.update({key: old[key] for key in ('_id', 'generationId', 'clientId', 'clientCode', 'clientName')})
        old.clear()
        old.update(replacement)
        for row in rows:
            row.update(_id=f'{old["_id"]}:{row["index"]}', jobId=old['_id'])
        snapshots[old['_id']] = old, rows, items
    return db, generation, jobs, snapshots


def generation_meta(db, snapshots, part=1):
    with patch('reporting.generations.purchase_metadata', side_effect=lambda db, job, workspace:
               reconcile_purchase_snapshot(*snapshots[job['_id']], workspace)):
        return generation_metadata(db, GENERATION, WORKSPACE, part)


class DifalPolicyReportTests(unittest.TestCase):
    def test_policy_is_strict_and_legacy_choices_do_not_enable_other_regimes(self):
        selected = policy(hybrid_exit=True)
        frozen = deepcopy(selected)
        self.assertEqual(direction_selection(selected, 'entry')['regimeIds'], ['pure'])
        self.assertEqual(direction_selection(selected, 'exit')['regimeIds'], ['hybrid'])
        self.assertEqual(selected, frozen)
        self.assertIsNone(direction_selection(None, 'exit'))
        v1 = {'version': 'DIFAL_SCENARIOS_V1', 'enabled': {'pure': False, 'hybrid': True, 'presumed': True, 'actual': True}}
        self.assertEqual(parse_difal_policy(v1), v1)
        self.assertEqual(direction_selection(v1, 'exit')['regimeIds'], ['hybrid'])
        self.assertEqual(direction_selection(v1, 'entry')['regimeIds'], ['hybrid'])
        invalid = [None, {}, {**selected, 'extra': True}, {**selected, 'version': 'OTHER'},
                   {**selected, 'enabled': {**selected['enabled'], 'actual': True}},
                   {**selected, 'enabled': {**selected['enabled'], 'pure': 1}},
                   {**selected, 'operations': {'pure': {'entry': True, 'exit': False}}},
                   {**selected, 'operations': {**selected['operations'], 'hybrid': {'entry': False, 'exit': 'false'}}}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ReportError):
                parse_difal_policy(value)

    def test_individual_pdf_excludes_only_chosen_direction_and_keeps_source_immutable(self):
        for sales, fixture in ((True, difal_fixture), (False, anticipation_fixture)):
            with self.subTest(sales=sales):
                values = fixture()
                frozen = deepcopy(values)
                meta = reconcile_purchase_snapshot(*values, WORKSPACE)
                raw = deepcopy(meta['difal' if sales else 'anticipation'])
                meta['difalPolicy'] = policy()
                text = pdf_text(render_purchase_pdf(meta))
                if sales:
                    self.assertIn('Não incluído por escolha', text)
                    self.assertIn('R$ 0,00', text)
                    self.assertNotIn('R$ 15,00', text)
                else:
                    self.assertIn('Simples puro', text)
                    self.assertIn('R$ 7,32', text)
                    self.assertNotIn('Não incluído por escolha', text)
                self.assertEqual(meta['difal' if sales else 'anticipation'], raw)
                self.assertEqual(values, frozen)
        meta = reconcile_purchase_snapshot(*difal_fixture(), WORKSPACE)
        meta['difalPolicy'] = policy(pure_entry=False, hybrid_exit=True)
        text = pdf_text(render_purchase_pdf(meta))
        self.assertIn('Simples híbrido', text)
        self.assertIn('R$ 15,00', text)
        self.assertNotIn('Lucro Presumido', text)
        meta.pop('difalPolicy')
        text = story_text(meta)
        self.assertIn('Sem escolha de DIFAL registrada', text)
        self.assertIn('apenas estimativas de origem', text)
        self.assertIn('R$ 15,00', text)
        for unavailable in (None, {**meta['difal'], 'pendingLines': 1, 'amountCents': 0}):
            meta.update(difalPolicy=policy(), difal=unavailable)
            text = story_text(meta)
            self.assertIn('Não incluído por escolha', text)
            self.assertNotIn('Indisponível neste histórico', text)

    def test_consolidation_selects_each_company_once_and_separates_unconfigured_evidence(self):
        db, generation, _, snapshots = selectable_generation()
        frozen = deepcopy((generation, snapshots))
        meta = generation_meta(db, snapshots)
        sales, purchases = meta['totalsByType']['SALES']['difal'], meta['totalsByType']['PURCHASES']['anticipation']
        self.assertEqual((sales['amountCents'], sales['selectedReports'], sales['excludedReports'], sales['unconfiguredReports']), (2000, 1, 1, 1))
        self.assertEqual(sales['regimeIds'], ['hybrid'])
        self.assertEqual((purchases['amountCents'], purchases['selectedReports'], purchases['excludedReports'], purchases['unconfiguredReports']), (732, 1, 1, 1))
        self.assertEqual(purchases['regimeIds'], ['pure'])
        self.assertEqual(sales['sourceEstimate']['amountCents'], 6000)
        self.assertEqual(sales['unconfiguredEstimate']['amountCents'], 3000)
        self.assertEqual(purchases['sourceEstimate']['amountCents'], 4392)
        self.assertEqual(purchases['unconfiguredEstimate']['amountCents'], 2196)
        self.assertEqual(meta['sections'][0]['reports']['SALES']['difal']['amountCents'], 1000)
        self.assertEqual(meta['sections'][1]['reports']['PURCHASES']['anticipation']['amountCents'], 1464)
        self.assertEqual((generation, snapshots), frozen)
        text = pdf_text(render_generation_pdf(meta))
        self.assertIn('Estimativa selecionada', text)
        self.assertIn('R$ 20,00', text)
        self.assertIn('sem escolha de DIFAL registrada', text)
        self.assertIn('não integram a soma selecionada', text)
        for company in generation['companies']:
            company['difalPolicy'] = policy(pure_exit=True, hybrid_entry=True, hybrid_exit=True)
        both = generation_meta(db, snapshots)
        self.assertEqual(both['totalsByType']['SALES']['difal']['amountCents'], 6000)
        self.assertEqual(both['totalsByType']['PURCHASES']['anticipation']['amountCents'], 4392)
        self.assertEqual(both['totalsByType']['SALES']['difal']['regimeIds'], ['pure', 'hybrid'])
        for company in generation['companies']:
            company['difalPolicy'] = policy(pure_entry=False)
        excluded = generation_meta(db, snapshots)
        self.assertEqual(excluded['totalsByType']['SALES']['difal']['amountCents'], 0)
        self.assertEqual(excluded['totalsByType']['SALES']['difal']['excludedReports'], 3)
        text = pdf_text(render_generation_pdf(excluded))
        self.assertIn('Não incluído por escolha', text)
        self.assertNotIn('R$ 10,00', text)
        self.assertNotIn('R$ 20,00', text)
        self.assertNotIn('R$ 30,00', text)

    def test_invalid_policy_outside_pdf_part_and_ambiguous_historical_owner_block(self):
        for mutate in (lambda generation: generation['companies'][0].update(difalPolicy=None),
                       lambda generation: generation['companies'][0]['salesJobIds'].append(generation['companies'][10]['salesJobId'])):
            db, generation, *_ = selectable_generation(11)
            mutate(generation)
            with patch('reporting.generations.purchase_metadata') as read, self.assertRaises(ReportError):
                generation_metadata(db, GENERATION, WORKSPACE, 2)
            read.assert_not_called()

    def test_resolver_validates_company_history_workspace_and_legacy_lineage(self):
        db, generation, jobs, _ = selectable_generation(1)
        source = jobs[1]
        by_id = {job['_id']: job for job in jobs}
        db.lookupJobs.find_one = lambda query: by_id.get(query['_id']) if query['workspaceId'] == WORKSPACE else None
        self.assertEqual(report_difal_policy(db, source, WORKSPACE), policy())
        generation['companies'][0]['salesJobId'] = str(uuid.uuid4())
        self.assertEqual(report_difal_policy(db, source, WORKSPACE), policy())
        repeated = {key: value for key, value in source.items() if key != 'generationId'}
        repeated.update(_id=str(uuid.uuid4()), repeatedFrom=source['_id'])
        frozen = deepcopy((generation, source, repeated))
        self.assertEqual(report_difal_policy(db, repeated, WORKSPACE), policy())
        self.assertEqual((generation, source, repeated), frozen)
        with self.assertRaises(ReportError):
            report_difal_policy(db, {**source, 'workspaceId': 'foreign'}, WORKSPACE)
        for value in (jobs[0]['_id'], repeated['_id']):
            by_id[repeated['_id']] = repeated
            repeated['repeatedFrom'] = value
            with self.assertRaises(ReportError):
                report_difal_policy(db, repeated, WORKSPACE)
        repeated['repeatedFrom'] = source['_id']
        source['clientId'] = 'different-company'
        with self.assertRaises(ReportError):
            report_difal_policy(db, repeated, WORKSPACE)
        source['clientId'] = repeated['clientId']
        by_id.pop(source['_id'])
        self.assertIsNone(report_difal_policy(db, repeated, WORKSPACE))
        repeated.update(difalPolicy=policy(), difalPolicyOrigin='RECHECK_SOURCE')
        self.assertEqual(report_difal_policy(db, repeated, WORKSPACE), policy())
        repeated.pop('difalPolicyOrigin')
        with self.assertRaises(ReportError):
            report_difal_policy(db, repeated, WORKSPACE)
        repeated.pop('difalPolicy')
        # Bounded recursion rejects corrupted chains instead of looping or guessing.
        for _ in range(33):
            older = deepcopy(repeated)
            older['_id'] = str(uuid.uuid4())
            repeated['repeatedFrom'] = older['_id']
            by_id[repeated['_id']] = repeated
            repeated = older
        with self.assertRaises(ReportError):
            report_difal_policy(db, next(job for job in by_id.values() if job.get('repeatedFrom') and job['_id'] != repeated['_id']), WORKSPACE)


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class DifalPolicyMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        cls.connection = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
        cls.db = cls.connection['maximum_difal_policy_report_' + uuid.uuid4().hex]

    @classmethod
    def tearDownClass(cls):
        cls.connection.drop_database(cls.db.name)
        cls.connection.close()

    def test_real_database_pdf_selection_rechecks_and_isolation_preserve_originals(self):
        _, generation, jobs, snapshots = selectable_generation(2)
        self.db.generations.insert_one(deepcopy(generation))
        self.db.lookupJobs.insert_many(deepcopy(jobs))
        for job, rows, _ in snapshots.values():
            self.db.purchaseLines.insert_many(deepcopy(rows))
        source = self.db.lookupJobs.find_one({'_id': jobs[1]['_id'], 'workspaceId': WORKSPACE})
        originals = (list(self.db.lookupJobs.find().sort('_id')), list(self.db.purchaseLines.find().sort('_id')),
                     self.db.generations.find_one({'_id': GENERATION}))
        meta = purchase_metadata(self.db, source, WORKSPACE)
        self.assertEqual(meta['difalPolicy'], policy())
        self.assertEqual(meta['difal']['amountCents'], 1000)
        self.assertIn('Não incluído por escolha', pdf_text(render_purchase_pdf(meta)))
        self.assertNotIn('R$ 10,00', pdf_text(render_purchase_pdf(meta)))
        consolidated = generation_metadata(self.db, GENERATION, WORKSPACE)
        self.assertEqual(consolidated['totalsByType']['SALES']['difal']['amountCents'], 2000)
        self.assertEqual(consolidated['totalsByType']['PURCHASES']['anticipation']['amountCents'], 732)
        self.assertEqual((list(self.db.lookupJobs.find().sort('_id')), list(self.db.purchaseLines.find().sort('_id')),
                          self.db.generations.find_one({'_id': GENERATION})), originals)
        repeated = {key: value for key, value in source.items() if key != 'generationId'}
        repeated.update(_id=str(uuid.uuid4()), repeatedFrom=source['_id'])
        self.db.lookupJobs.insert_one(deepcopy(repeated))
        self.db.purchaseLines.insert_many([{**row, '_id': f'{repeated["_id"]}:{row["index"]}', 'jobId': repeated['_id']}
                                           for row in snapshots[source['_id']][1]])
        self.assertEqual(purchase_metadata(self.db, repeated, WORKSPACE)['difalPolicy'], policy())
        self.assertEqual(self.db.lookupJobs.find_one({'_id': repeated['_id']}), repeated)
        self.db.lookupJobs.delete_one({'_id': source['_id']})
        orphan = purchase_metadata(self.db, repeated, WORKSPACE)
        self.assertNotIn('difalPolicy', orphan)
        self.assertEqual(orphan['difal']['amountCents'], 1000)
        repeated.update(difalPolicy=policy(), difalPolicyOrigin='RECHECK_SOURCE')
        self.db.lookupJobs.replace_one({'_id': repeated['_id']}, deepcopy(repeated))
        self.assertEqual(purchase_metadata(self.db, repeated, WORKSPACE)['difalPolicy'], policy())
        self.db.audit.insert_one({'_id': 'synthetic-deletion', 'workspaceId': WORKSPACE, 'action': 'generation.delete',
                                  'target': GENERATION, 'createdAt': utcnow()})
        with self.assertRaises(ReportError):
            generation_metadata(self.db, GENERATION, WORKSPACE)
        self.assertEqual(purchase_metadata(self.db, repeated, WORKSPACE)['difalPolicy'], policy())
        with self.assertRaises(ReportError):
            purchase_metadata(self.db, {**repeated, 'workspaceId': 'foreign'}, WORKSPACE)


if __name__ == '__main__':
    unittest.main()
