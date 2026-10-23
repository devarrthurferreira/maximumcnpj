"""Report choices are derived from trusted ownership; source estimates stay unchanged."""
from __future__ import annotations

import re
from .core import require

UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
REGIMES = ('pure', 'hybrid', 'presumed', 'actual')
SIMPLE = ('pure', 'hybrid')
NAMES = {'pure': 'Simples puro', 'hybrid': 'Simples híbrido'}
SLOTS = {'PURCHASES_V1': 'purchaseJobIds', 'SALES_V1': 'salesJobIds'}


def _check(condition, message='Opções de DIFAL do relatório inconsistentes.'):
    require(condition, 409, 'GENERATION_INCONSISTENT', message)


def parse_difal_policy(value):
    _check(isinstance(value, dict) and value.get('version') in ('DIFAL_SCENARIOS_V1', 'DIFAL_SCENARIOS_V2'))
    modern = value['version'] == 'DIFAL_SCENARIOS_V2'
    _check(set(value) == ({'version', 'enabled', 'operations'} if modern else {'version', 'enabled'}))
    enabled = value.get('enabled')
    _check(isinstance(enabled, dict) and set(enabled) == set(REGIMES) and
           all(type(enabled[key]) is bool for key in REGIMES))
    parsed = {'version': value['version'], 'enabled': {key: enabled[key] for key in REGIMES}}
    if modern:
        operations = value.get('operations')
        _check(enabled['presumed'] is False and enabled['actual'] is False and
               isinstance(operations, dict) and set(operations) == set(SIMPLE))
        _check(all(isinstance(operations[key], dict) and set(operations[key]) == {'entry', 'exit'} and
                   all(type(operations[key][direction]) is bool for direction in ('entry', 'exit')) for key in SIMPLE))
        parsed['operations'] = {key: {direction: operations[key][direction] for direction in ('entry', 'exit')} for key in SIMPLE}
    return parsed


def direction_selection(policy, direction):
    _check(direction in ('entry', 'exit'))
    if policy is None:
        return None
    policy = parse_difal_policy(policy)
    regimes = [key for key in SIMPLE if policy['enabled'][key] and
               (policy['version'] == 'DIFAL_SCENARIOS_V1' or policy['operations'][key][direction])]
    return {'enabled': bool(regimes), 'direction': direction, 'regimeIds': regimes,
            'regimeNames': [NAMES[key] for key in regimes]}


def assert_generation_available(db, generation, workspace):
    _check(generation and generation.get('workspaceId') == workspace and not generation.get('deletionStartedAt'),
           'A geração deste relatório está indisponível.')
    _check(not db.audit.find_one({'workspaceId': workspace, 'action': 'generation.delete', 'target': generation['_id']}),
           'Esta geração foi excluída.')


def report_difal_policy(db, job, workspace, _visited=None):
    visited = set() if _visited is None else _visited
    _check(job.get('workspaceId') == workspace and isinstance(job.get('_id'), str) and
           job['_id'] not in visited and len(visited) < 32, 'Linhagem das opções de DIFAL inconsistente.')
    visited.add(job['_id'])
    if 'generationId' not in job:
        if 'repeatedFrom' not in job:
            _check('difalPolicy' not in job and 'difalPolicyOrigin' not in job, 'Origem das opções de DIFAL inconsistente.')
            return None
        _check(isinstance(job.get('repeatedFrom'), str) and UUID.fullmatch(job['repeatedFrom']) and
               job.get('mode') in SLOTS, 'Origem das opções de DIFAL inconsistente.')
        if 'difalPolicy' in job:
            _check(job.get('difalPolicyOrigin') == 'RECHECK_SOURCE', 'Origem das opções de DIFAL inconsistente.')
            return parse_difal_policy(job['difalPolicy'])
        _check('difalPolicyOrigin' not in job, 'Origem das opções de DIFAL inconsistente.')
        original = db.lookupJobs.find_one({'_id': job['repeatedFrom'], 'workspaceId': workspace})
        if original is None:
            return None
        _check(original.get('clientId') == job.get('clientId') and original.get('mode') == job.get('mode'),
               'A origem da reconsulta está indisponível ou pertence a outro relatório.')
        return report_difal_policy(db, original, workspace, visited)
    generation_id = job['generationId']
    _check(isinstance(generation_id, str) and UUID.fullmatch(generation_id) and job.get('mode') in SLOTS,
           'Vínculo do relatório com a geração inconsistente.')
    generation = db.generations.find_one({'_id': generation_id, 'workspaceId': workspace})
    assert_generation_available(db, generation, workspace)
    companies = generation.get('companies')
    _check(isinstance(companies, list))
    matched = [company for company in companies if isinstance(company, dict) and company.get('clientId') == job.get('clientId')]
    owners = [(company, slot) for company in companies if isinstance(company, dict) for slot in SLOTS.values()
              for identity in (company[slot] if isinstance(company.get(slot), list) else []) if identity == job['_id']]
    _check(len(matched) == 1 and len(owners) == 1 and owners[0][0] is matched[0] and owners[0][1] == SLOTS[job['mode']],
           'O relatório não pertence ao histórico desta empresa e geração.')
    return parse_difal_policy(matched[0]['difalPolicy']) if 'difalPolicy' in matched[0] else None
