"""Resolve immutable job payloads while authentication and ownership stay central."""
from __future__ import annotations

import hashlib
import json
import os
from threading import Lock

from .core import require

STORAGE_VERSION = 'MONGODB_POOL_V1'
_clients = {}
_clients_lock = Lock()


def slot_database(slot=1):
    """Open only the requested configured destination; never fall back to another."""
    require(type(slot) is int and slot in (1, 2, 3), 409, 'STORAGE_ROUTE',
            'Destino de armazenamento do relatório inválido.')
    suffix = '' if slot == 1 else f'_{slot}'
    uri = os.getenv('MONGODB_URI' + suffix, '').strip()
    require(uri, 503, 'DATABASE_NOT_CONFIGURED' if slot == 1 else 'STORAGE_NOT_CONFIGURED',
            'MongoDB não configurado.' if slot == 1 else f'O banco de armazenamento {slot} não está configurado.')
    primary_name = os.getenv('MONGODB_DB', '').strip() or 'maximum_cnpj'
    name = (os.getenv('MONGODB_DB' + suffix, '').strip() or primary_name) if slot != 1 else primary_name
    key = (slot, uri, name)
    with _clients_lock:
        if key not in _clients:
            from pymongo import MongoClient
            _clients[key] = MongoClient(uri, maxPoolSize=5, minPoolSize=0,
                                       serverSelectionTimeoutMS=8000, connectTimeoutMS=8000,
                                       socketTimeoutMS=25000, tz_aware=True)
        client = _clients[key]
    return client[name]


def close_databases():
    """Close cached clients for local workers and isolated integration tests."""
    with _clients_lock:
        clients = list(_clients.values())
        _clients.clear()
    for client in clients:
        client.close()


def job_storage_slot(job):
    if 'storageSlot' not in job and 'storageVersion' not in job:
        return 1
    slot = job.get('storageSlot')
    require(isinstance(slot, (int, float)) and not isinstance(slot, bool) and slot in (1, 2, 3)
            and job.get('storageVersion') == STORAGE_VERSION,
            409, 'STORAGE_ROUTE', 'Destino de armazenamento do relatório inconsistente.')
    # PyMongo may decode a BSON numeric value as Int64 or an integral double.
    return int(slot)


def assert_job_available(control, job, workspace):
    """Deletion receipts are authoritative even while a remote payload still exists."""
    require(isinstance(job, dict) and isinstance(job.get('_id'), str) and job.get('workspaceId') == workspace,
            404, 'NOT_FOUND', 'Consulta não encontrada para esta empresa.')
    identities = [('lookup', job['_id'])]
    if job.get('generationId'):
        identities.append(('generation', job['generationId']))
    for kind, identifier in identities:
        encoded = json.dumps([workspace, identifier], ensure_ascii=False, separators=(',', ':')).encode()
        receipt = kind + '-delete:' + hashlib.sha256(encoded).hexdigest()
        require(not control.audit.find_one({'_id': receipt, 'workspaceId': workspace,
                                            'action': kind + '.delete', 'target': identifier}, {'_id': 1}),
                404, 'NOT_FOUND', 'Consulta não encontrada para esta empresa.')


def job_database(control, job, workspace):
    """Use only routing metadata loaded from the central lookupJobs record."""
    assert_job_available(control, job, workspace)
    slot = job_storage_slot(job)
    # Returning the supplied primary also preserves isolated/local database injection.
    return control if slot == 1 else slot_database(slot)
