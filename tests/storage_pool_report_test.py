"""Synthetic distributed report payloads; authentication and ownership stay primary."""
from copy import deepcopy
from datetime import timedelta
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import json
import os
import secrets
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import uuid

from reporting.core import ReportError, utcnow, validate
from reporting import storage
from reporting.service import database, get_job, jobs, metadata, result_rows
from reporting.purchases import purchase_metadata
from reporting.generations import generation_metadata


def receipt(kind, identifier, workspace):
    digest = hashlib.sha256(json.dumps([workspace, identifier], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return {'_id': kind + '-delete:' + digest, 'workspaceId': workspace,
            'action': kind + '.delete', 'target': identifier, 'createdAt': utcnow()}


class StorageRouteTests(unittest.TestCase):
    def setUp(self):
        storage.close_databases()
        self.addCleanup(storage.close_databases)

    def test_legacy_and_explicit_routes_are_strict(self):
        from bson.int64 import Int64
        self.assertEqual(storage.job_storage_slot({}), 1)
        for slot in (1, 2, 3):
            self.assertEqual(storage.job_storage_slot({'storageSlot': slot, 'storageVersion': storage.STORAGE_VERSION}), slot)
        for slot in (2.0, Int64(3)):
            selected = storage.job_storage_slot({'storageSlot': slot, 'storageVersion': storage.STORAGE_VERSION})
            self.assertEqual(selected, int(slot))
            self.assertIs(type(selected), int)
        invalid = [{'storageSlot': 1}, {'storageVersion': storage.STORAGE_VERSION},
                   {'storageSlot': 1, 'storageVersion': 'UNKNOWN'},
                   *({'storageSlot': slot, 'storageVersion': storage.STORAGE_VERSION}
                     for slot in (None, True, False, '2', 2.1, 0, 4))]
        for job in invalid:
            with self.subTest(job=job), self.assertRaises(ReportError) as caught:
                storage.job_storage_slot(job)
            self.assertEqual((caught.exception.status, caught.exception.code), (409, 'STORAGE_ROUTE'))

    def test_connections_are_lazy_cached_and_database_names_inherit_primary(self):
        clients = []
        def connect(*args, **kwargs):
            client = MagicMock()
            position = len(clients) + 1
            client.__getitem__.side_effect = lambda name: (position, name)
            clients.append(client)
            return client
        env = {'MONGODB_URI': 'mongodb://primary.test', 'MONGODB_DB': 'synthetic_primary',
               'MONGODB_URI_2': 'mongodb://second.test', 'MONGODB_URI_3': 'mongodb://third.test',
               'MONGODB_DB_3': 'synthetic_third'}
        with patch.dict(os.environ, env, clear=True), patch('pymongo.MongoClient', side_effect=connect) as factory:
            self.assertEqual(database(), (1, 'synthetic_primary'))
            self.assertEqual(factory.call_count, 1)
            self.assertEqual(storage.slot_database(2), (2, 'synthetic_primary'))
            self.assertEqual(storage.slot_database(2), (2, 'synthetic_primary'))
            self.assertEqual(factory.call_count, 2)
            self.assertEqual(storage.slot_database(3), (3, 'synthetic_third'))
            self.assertEqual([call.args[0] for call in factory.call_args_list],
                             ['mongodb://primary.test', 'mongodb://second.test', 'mongodb://third.test'])
            os.environ['MONGODB_DB_2'] = 'changed_destination'
            self.assertEqual(storage.slot_database(2), (4, 'changed_destination'))
            self.assertEqual(factory.call_count, 4)
        storage.close_databases()
        for client in clients:
            client.close.assert_called_once()

    def test_default_database_and_missing_required_destination_do_not_fall_back(self):
        with patch.dict(os.environ, {'MONGODB_URI': 'mongodb://primary.test'}, clear=True), patch('pymongo.MongoClient') as factory:
            storage.slot_database(1)
            factory.return_value.__getitem__.assert_called_once_with('maximum_cnpj')
            for slot in (2, 3):
                with self.subTest(slot=slot), self.assertRaises(ReportError) as caught:
                    storage.slot_database(slot)
                self.assertEqual((caught.exception.status, caught.exception.code), (503, 'STORAGE_NOT_CONFIGURED'))
            self.assertEqual(factory.call_count, 1)

    def test_primary_injection_and_deletion_guards_precede_remote_connections(self):
        control = SimpleNamespace(audit=SimpleNamespace(find_one=lambda *_: None))
        job = {'_id': str(uuid.uuid4()), 'workspaceId': 'synthetic-workspace'}
        with patch('reporting.storage.slot_database') as remote:
            self.assertIs(storage.job_database(control, job, 'synthetic-workspace'), control)
            self.assertIs(storage.job_database(control, {**job, 'storageSlot': 1, 'storageVersion': storage.STORAGE_VERSION},
                                               'synthetic-workspace'), control)
            control.audit.find_one = lambda *_: {'_id': 'deleted'}
            with self.assertRaises(ReportError) as caught:
                storage.job_database(control, {**job, 'storageSlot': 2, 'storageVersion': storage.STORAGE_VERSION}, 'synthetic-workspace')
            self.assertEqual((caught.exception.status, caught.exception.code), (404, 'NOT_FOUND'))
            remote.assert_not_called()


@unittest.skipUnless(os.getenv('REPORT_TEST_MONGO') == '1', 'MongoDB descartável não solicitado')
class StoragePoolMongoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pymongo import MongoClient
        from api import reports as endpoint
        uri = os.environ['MONGODB_URI']
        cls.connection = MongoClient(uri, serverSelectionTimeoutMS=8000, tz_aware=True)
        prefix = 'maximum_python_storage_' + uuid.uuid4().hex
        cls.databases = {slot: cls.connection[f'{prefix}_{slot}'] for slot in (1, 2, 3)}
        cls.workspace, cls.client_id = 'synthetic-storage-reports', str(uuid.uuid4())
        cls.environment = patch.dict(os.environ, {'MONGODB_DB': cls.databases[1].name,
            'MONGODB_URI_2': uri, 'MONGODB_DB_2': cls.databases[2].name,
            'MONGODB_URI_3': uri, 'MONGODB_DB_3': cls.databases[3].name,
            'WORKSPACE_ID': cls.workspace, 'NODE_ENV': 'development', 'VERCEL': '0',
            'APP_ORIGIN': 'http://storage-reports.test'})
        cls.environment.start()
        storage.close_databases()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), endpoint.handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        storage.close_databases()
        for db in cls.databases.values():
            cls.connection.drop_database(db.name)
        cls.connection.close()
        cls.environment.stop()

    def setUp(self):
        for db in self.databases.values():
            for name in db.list_collection_names():
                db[name].delete_many({})
        self.control = self.databases[1]
        raw = secrets.token_urlsafe(32)
        self.cookie = 'maximum_session=' + raw
        self.session = {'_id': hashlib.sha256(raw.encode()).hexdigest(), 'workspaceId': self.workspace,
                        'userId': 'synthetic-operator', 'expiresAt': utcnow() + timedelta(minutes=10)}
        self.user = {'_id': 'synthetic-operator', 'workspaceId': self.workspace, 'active': True, 'role': 'operator'}
        self.control.sessions.insert_one(deepcopy(self.session))
        self.control.users.insert_one(deepcopy(self.user))
        self.control.clients.insert_one({'_id': self.client_id, 'workspaceId': self.workspace, 'active': True,
                                        'name': 'EMPRESA SINTÉTICA', 'code': 'POOL'})

    def call(self, body, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=20)
        try:
            connection.request('POST', '/', json.dumps(body), headers={'Content-Type': 'application/json',
                'Origin': 'http://storage-reports.test', 'Cookie': self.cookie, **(headers or {})})
            response = connection.getresponse()
            return response.status, response.getheader('Content-Type'), response.read()
        finally:
            connection.close()

    def generic_job(self, slot, tagged=True):
        identifier, now = str(uuid.uuid4()), utcnow()
        job = {'_id': identifier, 'workspaceId': self.workspace, 'clientId': self.client_id, 'clientCode': 'POOL',
               'clientName': 'EMPRESA SINTÉTICA', 'fileName': 'synthetic.csv', 'status': 'COMPLETED',
               'completedAt': now, 'createdAt': now, 'summary': {'lines': 2, 'unique': 2, 'duplicates': 0, 'invalid': 0}}
        if tagged:
            job.update(storageSlot=slot, storageVersion=storage.STORAGE_VERSION)
        self.control.lookupJobs.insert_one(job)
        payload = self.databases[slot]
        for index, (cnpj, status) in enumerate((('11222333000181', 'OPTANTE'), ('11444777000161', 'NAO_OPTANTE'))):
            state = f'{identifier}:state:{index}'
            payload.cnpjStates.insert_one({'_id': state, 'workspaceId': self.workspace, 'cnpj': cnpj,
                                          'name': f'ORIGEM BANCO {slot} EMPRESA {index}', 'uf': 'MG'})
            payload.lookupItems.insert_one({'_id': f'{identifier}:{index}', 'workspaceId': self.workspace, 'jobId': identifier,
                'cnpj': cnpj, 'stateId': state, 'state': 'DONE', 'status': status, 'kind': 'CLIENTE',
                'occurrences': 1, 'checkedAt': now, 'submittedName': f'EMPRESA SINTÉTICA {index}'})
        return job

    def test_legacy_and_slots_1_2_3_share_history_and_use_their_local_state_joins(self):
        for slot, tagged in ((1, False), (1, True), (2, True), (3, True)):
            with self.subTest(slot=slot, tagged=tagged):
                job = self.generic_job(slot, tagged)
                meta = metadata(self.control, get_job(self.control, job['_id'], self.workspace), self.workspace, 'ALL')
                self.assertEqual((meta['total'], meta['denominator']), (2, 2))
                options = validate({'jobId': job['_id'], 'search': f'ORIGEM BANCO {slot}'})
                rows = result_rows(self.control, job['_id'], self.workspace, options)
                self.assertEqual(rows['total'], 2)
                self.assertTrue(all(f'BANCO {slot}' in row['details']['name'] for row in rows['items']))
                status, _, content = self.call({'action': 'csv', 'jobId': job['_id'], 'storageSlot': 1})
                self.assertEqual(status, 200, content)
                self.assertIn(f'ORIGEM BANCO {slot}', content.decode('utf-8-sig'))
                status, _, content = self.call({'action': 'pdf', 'jobId': job['_id']})
                self.assertEqual(status, 200, content)
                self.assertTrue(content.startswith(b'%PDF'))
        history = jobs(self.control, self.workspace, self.client_id, 1)
        self.assertEqual(history['total'], 4)
        self.assertEqual(len(history['items']), 4)
        for slot in (2, 3):
            self.assertEqual(self.databases[slot].lookupJobs.count_documents({}), 0)
            self.assertEqual(self.databases[slot].limits.count_documents({}), 0)
        self.assertEqual(sum(record['count'] for record in self.control.limits.find({})), 8)

    def test_required_destination_missing_unavailable_or_empty_never_reads_primary_copy(self):
        from pymongo.errors import ServerSelectionTimeoutError
        job = self.generic_job(2)
        for name in ('lookupItems', 'cnpjStates'):
            self.control[name].insert_many(list(self.databases[2][name].find({})))
        with patch.dict(os.environ, {'MONGODB_URI_2': ''}):
            status, _, content = self.call({'action': 'summary', 'jobId': job['_id']})
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(content)['error'], 'STORAGE_NOT_CONFIGURED')
        with patch('reporting.storage.slot_database', side_effect=ServerSelectionTimeoutError('synthetic unreachable destination')):
            status, _, content = self.call({'action': 'csv', 'jobId': job['_id']})
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(content)['error'], 'REPORT_UNAVAILABLE')
        self.databases[2].lookupItems.delete_many({})
        status, _, content = self.call({'action': 'csv', 'jobId': job['_id']})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(content)['error'], 'RESULT_COUNT')

    def test_primary_auth_deletion_and_workspace_are_authoritative_for_remote_payloads(self):
        job = self.generic_job(3)
        remote = self.databases[3]
        remote.sessions.insert_one(deepcopy(self.session))
        remote.users.insert_one(deepcopy(self.user))
        removed = receipt('lookup', job['_id'], self.workspace)
        remote.audit.insert_one(deepcopy(removed))
        remote.lookupItems.insert_one({'_id': 'foreign-row', 'workspaceId': 'foreign', 'jobId': job['_id'], 'state': 'DONE'})
        self.assertEqual(self.call({'action': 'summary', 'jobId': job['_id']})[0], 200)
        self.control.users.update_one({'_id': self.user['_id']}, {'$set': {'active': False}})
        self.assertEqual(self.call({'action': 'summary', 'jobId': job['_id']})[0], 401)
        self.control.users.update_one({'_id': self.user['_id']}, {'$set': {'active': True}})
        self.control.audit.insert_one(removed)
        self.assertEqual(self.call({'action': 'csv', 'jobId': job['_id']})[0], 404)
        self.assertEqual(remote.lookupItems.count_documents({'workspaceId': self.workspace}), 2)

    def test_financial_join_uses_the_job_state_in_the_same_payload_database(self):
        from purchases_report_test import net_fixture
        job, lines, items = net_fixture()
        job.update(workspaceId=self.workspace, storageSlot=2, storageVersion=storage.STORAGE_VERSION)
        self.control.lookupJobs.insert_one(job)
        payload = self.databases[2]
        for line in lines:
            line['workspaceId'] = self.workspace
        payload.purchaseLines.insert_many(lines)
        for item in items:
            item['workspaceId'] = self.workspace
            states = item.pop('sourceState', [])
            if states:
                payload.cnpjStates.insert_one({'_id': item['stateId'], 'workspaceId': self.workspace,
                                              'cnpj': item['cnpj'], 'status': states[0]['status']})
            payload.lookupItems.insert_one(item)
        self.assertEqual(purchase_metadata(self.control, job, self.workspace)['totalCents'], 100000)
        state = payload.cnpjStates.find_one({})
        self.control.cnpjStates.insert_one(deepcopy(state))
        payload.cnpjStates.delete_one({'_id': state['_id']})
        with self.assertRaises(ReportError) as caught:
            purchase_metadata(self.control, job, self.workspace)
        self.assertEqual(caught.exception.code, 'RESULT_COUNT')

    def test_purchase_and_sales_in_different_destinations_reconcile_and_render_together(self):
        from revenue_report_test import revenue_fixture, PURCHASE, SALE
        generation, snapshots = revenue_fixture()
        generation['workspaceId'] = self.workspace
        self.control.generations.insert_one(generation)
        for identifier, (job, lines, _) in snapshots.items():
            slot = 2 if identifier == PURCHASE else 3
            job.update(workspaceId=self.workspace, storageSlot=slot, storageVersion=storage.STORAGE_VERSION)
            self.control.lookupJobs.insert_one(job)
            for line in lines:
                line['workspaceId'] = self.workspace
            self.databases[slot].purchaseLines.insert_many(lines)
        original = {slot: list(self.databases[slot].purchaseLines.find({}).sort('_id', 1)) for slot in (2, 3)}
        for identifier in (PURCHASE, SALE):
            source = get_job(self.control, identifier, self.workspace)
            meta = purchase_metadata(self.control, source, self.workspace)
            self.assertEqual(meta['revenueReconciliation']['revenueAfterReturnsCents'], 180000)
        meta = generation_metadata(self.control, generation['_id'], self.workspace)
        self.assertEqual(meta['revenueTotals']['revenueAfterReturnsCents'], 180000)
        self.assertEqual(meta['totalsByType']['PURCHASES']['totalCents'], 85000)
        self.assertEqual(meta['totalsByType']['SALES']['totalCents'], 215000)
        status, _, content = self.call({'action': 'generation-pdf', 'generationId': generation['_id']})
        self.assertEqual(status, 200, content)
        self.assertTrue(content.startswith(b'%PDF'))
        self.assertEqual({slot: list(self.databases[slot].purchaseLines.find({}).sort('_id', 1)) for slot in (2, 3)}, original)
        self.control.audit.insert_one(receipt('generation', generation['_id'], self.workspace))
        self.assertEqual(self.call({'action': 'pdf', 'jobId': SALE, 'clientId': snapshots[SALE][0]['clientId'], 'layout': 'summary'})[0], 404)


if __name__ == '__main__':
    unittest.main()
