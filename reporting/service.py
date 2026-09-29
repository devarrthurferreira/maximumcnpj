"""Read-only fiscal snapshots with the same MongoDB session as Node.js."""
from __future__ import annotations
import os
import math
from datetime import timedelta
from .core import (ReportError, require, session_hash, utcnow, STATUSES, KINDS,
                   percentage, PAGE_SIZE, PDF_PART_SIZE, CSV_PART_SIZE)

_client = None

def database():
    global _client
    from pymongo import MongoClient
    require(bool(os.getenv('MONGODB_URI')), 503, 'DATABASE_NOT_CONFIGURED', 'MongoDB não configurado.')
    if _client is None:
        _client = MongoClient(os.environ['MONGODB_URI'], maxPoolSize=5, minPoolSize=0,
                             serverSelectionTimeoutMS=8000, connectTimeoutMS=8000,
                             socketTimeoutMS=25000, tz_aware=True)
    return _client[os.getenv('MONGODB_DB', 'maximum_cnpj')]


def authenticate(db, headers, workspace):
    sid = session_hash(headers)
    s = db.sessions.find_one({'_id': sid, 'workspaceId': workspace, 'expiresAt': {'$gt': utcnow()}})
    require(s, 401, 'UNAUTHORIZED', 'Sessão expirada. Entre novamente.')
    user = db.users.find_one({'_id': s['userId'], 'workspaceId': workspace, 'active': True},
                             {'passwordHash': 0})
    require(user and user.get('role') in ('admin', 'operator', 'viewer'), 401, 'UNAUTHORIZED', 'Conta indisponível.')
    require(not user.get('mustChangePassword'), 403, 'PASSWORD_CHANGE_REQUIRED', 'Redefina sua senha antes de continuar.')
    return user


def rate_limit(db, user_id, workspace, download=False):
    from pymongo import ReturnDocument
    from pymongo.errors import DuplicateKeyError
    bucket = int(utcnow().timestamp()) // 60
    key = f'reports:{workspace}:{user_id}:{"file" if download else "read"}:{bucket}'
    update = {'$inc': {'count': 1}, '$setOnInsert': {'expiresAt': utcnow() + timedelta(minutes=3)}}
    try:
        record = db.limits.find_one_and_update({'_id': key}, update, upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        record = db.limits.find_one_and_update({'_id': key}, {'$inc': {'count': 1}}, return_document=ReturnDocument.AFTER)
    require(record and record['count'] <= (15 if download else 120), 429, 'RATE_LIMIT',
            'Muitas solicitações de relatório. Tente novamente em um minuto.')


def get_job(db, job_id, workspace, client_id=''):
    q = {'_id': job_id, 'workspaceId': workspace}
    if client_id:
        q['clientId'] = client_id
    job = db.lookupJobs.find_one(q)
    require(job, 404, 'NOT_FOUND', 'Consulta não encontrada para esta empresa.')
    require(job.get('status') == 'COMPLETED', 409, 'INCOMPLETE',
            'Conclua a consulta antes de gerar seu relatório. Resultados parciais não são publicados.')
    return job


def jobs(db, workspace, client_id, page):
    # Financial purchase reports use their own history and reconciled monetary exports.
    # Legacy snapshots without a mode remain available in this general report list.
    q = {'workspaceId': workspace, 'status': 'COMPLETED', 'mode': {'$ne': 'PURCHASES_V1'}}
    if client_id:
        q['clientId'] = client_id
    fields = {'_id': 1, 'clientId': 1, 'clientCode': 1, 'clientName': 1, 'fileName': 1,
              'completedAt': 1, 'createdAt': 1, 'summary': 1, 'resultSummary': 1}
    items = list(db.lookupJobs.find(q, fields).sort([('completedAt', -1), ('_id', -1)]).skip((page-1)*30).limit(30).max_time_ms(15000))
    return {'items': items, 'total': db.lookupJobs.count_documents(q, maxTimeMS=15000), 'page': page}


def base_stages(job_id, workspace):
    k = {'$toUpper': {'$ifNull': ['$kind', '']}}
    customer = {'$regexMatch': {'input': k, 'regex': 'CLIENT'}}
    supplier = {'$regexMatch': {'input': k, 'regex': 'FORNEC'}}
    return [
        {'$match': {'workspaceId': workspace, 'jobId': job_id, 'state': 'DONE'}},
        {'$set': {'status': {'$cond': [{'$in': ['$status', list(STATUSES)[1:]]}, '$status', 'NAO_CONFIRMADO']},
                  'reportKind': {'$switch': {'branches': [
                      {'case': {'$and': [customer, supplier]}, 'then': 'AMBOS'},
                      {'case': customer, 'then': 'CLIENTE'}, {'case': supplier, 'then': 'FORNECEDOR'}],
                      'default': 'OUTROS'}}}}]


def cohort(stages, kind, status='ALL'):
    result = list(stages)
    q = {}
    if kind != 'ALL': q['reportKind'] = kind
    if status != 'ALL': q['status'] = status
    if q: result.append({'$match': q})
    return result


def details_stages(workspace):
    return [
        {'$lookup': {'from': 'cnpjStates', 'let': {'ref': '$stateId', 'doc': '$cnpj'},
          'pipeline': [{'$match': {'workspaceId': workspace, '$expr': {'$and': [
              {'$eq': ['$_id', '$$ref']}, {'$eq': ['$cnpj', '$$doc']}]}}},
                       {'$project': {'_id': 0, 'name': 1, 'tradeName': 1, 'uf': 1, 'mei': 1,
                                     'optionDate': 1, 'exclusionDate': 1, 'registryStatus': 1}}], 'as': 'details'}},
        {'$set': {'details': {'$arrayElemAt': ['$details', 0]}}}]


def metadata(db, job, workspace, kind):
    values = list(db.lookupItems.aggregate(base_stages(job['_id'], workspace) + [
        {'$group': {'_id': {'status': '$status', 'kind': '$reportKind'}, 'count': {'$sum': 1},
                    'occurrences': {'$sum': {'$ifNull': ['$occurrences', 1]}},
                    'firstCheck': {'$min': '$checkedAt'}, 'lastCheck': {'$max': '$checkedAt'},
                    'nameWarnings': {'$sum': {'$cond': [{'$in': ['$nameMatch', ['DIVERGENTE_REVISAR', 'SEMELHANTE_REVISAR']]}, 1, 0]}}}}
    ], maxTimeMS=20000))
    total = sum(x['count'] for x in values)
    require(total == job.get('summary', {}).get('unique'), 409, 'RESULT_COUNT', 'Contagem do histórico inconsistente. Relatório bloqueado para conferência.')
    selected = [v for v in values if kind == 'ALL' or v['_id']['kind'] == kind]
    denominator = sum(v['count'] for v in selected)
    groups = [{'status': s, 'label': label, 'count': sum(v['count'] for v in selected if v['_id']['status'] == s)}
              for s, label in list(STATUSES.items())[1:]]
    for group in groups:
        group['percent'] = percentage(group['count'], denominator)
        group['batchPercent'] = percentage(group['count'], total)
    checkdates = [v[key] for v in selected for key in ('firstCheck', 'lastCheck') if v.get(key)]
    return {'job': {k: job.get(k) for k in ('_id', 'clientId', 'clientCode', 'clientName', 'fileName', 'createdAt', 'completedAt', 'source', 'summary')},
            'total': total, 'denominator': denominator, 'kind': kind, 'groups': groups,
            'kinds': [{'kind': k, 'label': label, 'count': sum(v['count'] for v in values if v['_id']['kind'] == k)} for k, label in list(KINDS.items())[1:]],
            'coverage': percentage(sum(g['count'] for g in groups if g['status'] != 'NAO_CONFIRMADO'), denominator),
            'nameWarnings': sum(v['nameWarnings'] for v in selected),
            'occurrences': sum(v['occurrences'] for v in selected),
            'firstCheck': min(checkdates) if checkdates else None, 'lastCheck': max(checkdates) if checkdates else None,
            'sourceReferenceDate': None, 'pdfPartSize': PDF_PART_SIZE, 'csvPartSize': CSV_PART_SIZE,
            'generatedAt': utcnow()}


def result_rows(db, job_id, workspace, options, size=PAGE_SIZE, page=1):
    stages = cohort(base_stages(job_id, workspace), options['kind'], options['status'])
    search = options.get('search', '')
    if search:
        stages += details_stages(workspace)
        document = re_document(search)
        stages += [{'$match': {'$or': [
            {'cnpj': {'$regex': document, '$options': 'i'}},
            {'submittedName': {'$regex': __import__('re').escape(search), '$options': 'i'}},
            {'details.name': {'$regex': __import__('re').escape(search), '$options': 'i'}}]}}]
    # Join only the visible/downloaded page when no name search is necessary.
    selected = [{'$sort': {'cnpj': 1}}, {'$skip': (page-1)*size}, {'$limit': size}]
    if not search: selected += details_stages(workspace)
    selected += [{'$project': {'_id': 0, 'cnpj': 1, 'status': 1, 'submittedName': 1, 'kind': 1,
                               'uf': 1, 'occurrences': 1, 'reason': 1, 'nameMatch': 1, 'checkedAt': 1,
                               'source': 1, 'details': 1, 'reportKind': 1}}]
    output = list(db.lookupItems.aggregate(stages + [{'$facet': {'items': selected, 'count': [{'$count': 'total'}]}}], maxTimeMS=20000))[0]
    total = output['count'][0]['total'] if output['count'] else 0
    require(page == 1 or (page-1)*size < total, 400, 'PART_RANGE', 'Parte ou página fora do intervalo.')
    return {'items': output['items'], 'total': total, 'page': page, 'parts': max(1, math.ceil(total/size)), 'pageSize': size}


def re_document(text):
    import re
    raw = re.sub(r'[. /\-]', '', text).upper()
    return re.escape(raw if re.fullmatch(r'[A-Z0-9]{14}', raw) else text)
