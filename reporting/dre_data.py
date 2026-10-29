"""Read and reconcile immutable DRE snapshots; never run a fiscal calculation.

Access rules mirror ``getSimulation`` and ``simulationAnalysisDeletionStarted``
in the Node service. A deleted analysis cannot be exported through this second
entry point, including versions linked by automatic reprocessing.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

from .core import require, utcnow

UUID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
MONTH = re.compile(r'\d{4}-(0[1-9]|1[0-2])')
REGIMES = {'pure', 'hybrid', 'presumed', 'actual'}
BASE_ROWS = (
    'services', 'sales', 'revenue', 'das', 'cbsDebit', 'ibsDebit', 'icmsNet', 'iss',
    'netRevenue', 'cmvSimple', 'cmvRegular', 'cmv', 'cbsUsed', 'ibsUsed', 'grossProfit',
    'salaries', 'benefits', 'payroll', 'personnel', 'administrative', 'rent', 'cards',
    'preTax', 'irpj', 'csll', 'netProfit',
)
OPTIONAL_ROWS = ('difal', 'icmsAnticipation')


def _receipt_id(kind, workspace, identifier):
    encoded = json.dumps([workspace, identifier], ensure_ascii=False, separators=(',', ':')).encode()
    return kind + '-delete:' + hashlib.sha256(encoded).hexdigest()


def _receipt(db, kind, identifier, workspace, **extra):
    return db.audit.find_one({'_id': _receipt_id(kind, workspace, identifier),
                             'workspaceId': workspace, 'action': kind + '.delete',
                             'target': identifier, **extra})


def _analysis_deleted(db, identifier, workspace):
    return bool(_receipt(db, 'analysis', identifier, workspace) or db.analyses.find_one({
        '_id': identifier, 'workspaceId': workspace, 'deletionStartedAt': {'$exists': True}}, {'_id': 1}))


def _analysis_lineage_deleted(db, snapshot, workspace):
    current, visited = snapshot, set()
    while current and current['_id'] not in visited:
        visited.add(current['_id'])
        if current.get('analysisId') and _analysis_deleted(db, current['analysisId'], workspace):
            return True
        if db.audit.find_one({'workspaceId': workspace, 'action': 'analysis.delete',
                              'clientId': snapshot['clientId'], 'legacySimulationIds': current['_id']}, {'_id': 1}):
            return True
        if db.analyses.find_one({'workspaceId': workspace, 'clientId': snapshot['clientId'],
                                'deletionStartedAt': {'$exists': True}, '$or': [
                                    {'currentSimulation.id': current['_id']},
                                    {'legacyReference.simulationId': current['_id']}]}, {'_id': 1}):
            return True
        parent_id = current.get('parentSimulationId')
        if not parent_id or (current.get('reprocessing') or {}).get('originalId') != parent_id:
            break
        removed = _receipt(db, 'simulation', parent_id, workspace, analysisId={'$exists': True})
        if removed:
            analysis = _receipt(db, 'analysis', removed['analysisId'], workspace)
            if analysis and analysis.get('clientId') == snapshot['clientId']:
                return True
        current = db.simulations.find_one({'_id': parent_id, 'workspaceId': workspace,
                                          'clientId': snapshot['clientId'], 'generationId': current.get('generationId')},
                                         {'_id': 1, 'clientId': 1, 'generationId': 1, 'analysisId': 1,
                                          'parentSimulationId': 1, 'reprocessing.originalId': 1})
    return False


def _valid(condition, message='Os valores da versão salva não conciliam. Confira a análise antes de emitir o PDF.'):
    require(condition, 409, 'DRE_SNAPSHOT_INVALID', message)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _close(left, right):
    # Values are stored as IEEE-754 BRL, not rounded display strings. Permit only
    # binary arithmetic noise, without accepting cent-level edits to a subtotal.
    return _finite(left) and _finite(right) and abs(left - right) <= max(.000001, 8 * math.ulp(max(abs(left), abs(right))))


def _regimes(result):
    _valid(isinstance(result, dict) and isinstance(result.get('regimes'), list))
    regimes = result['regimes']
    _valid(1 <= len(regimes) <= 4 and all(isinstance(row, dict) for row in regimes))
    ids = [row.get('id') for row in regimes]
    _valid(all(isinstance(value, str) and value in REGIMES for value in ids) and len(set(ids)) == len(ids))
    selection = result.get('regimeSelection')
    if selection is not None:
        _valid(isinstance(selection, dict) and selection.get('selected') == ids)
    # Returns can legitimately exceed the period's sales. Preserve the signed
    # saved revenue; the reconciliation equations below still reject corruption.
    _valid(_finite(result.get('annualRevenue')))
    credits = result.get('credits', {})
    _valid(isinstance(credits, dict))
    for tax, credit in credits.items():
        _valid(isinstance(tax, str) and isinstance(credit, dict) and
               all(key in credit for key in ('debit', 'potential', 'used', 'due', 'balance')) and
               all(_finite(value) and value >= 0 for value in credit.values()))
        _valid(_close(credit['debit'] - credit['used'], credit['due']) and
               _close(credit['potential'] - credit['used'], credit['balance']))
    for regime in regimes:
        _valid(type(regime.get('available')) is bool and isinstance(regime.get('name'), str) and regime['name'].strip())
        dre = regime.get('dre')
        _valid(isinstance(dre, dict) and all(key in dre for key in BASE_ROWS))
        _valid(all(isinstance(key, str) and _finite(value) for key, value in dre.items()))
        for key in ('annualProfit', 'totalTaxes'):
            _valid(_finite(regime.get(key)))
        for key in ('margin', 'taxBurden'):
            _valid(regime.get(key) is None or _finite(regime[key]))
        # Unavailable scenarios retain historical placeholder amounts, which the
        # renderer must mark unavailable. They are not confirmed payable values.
        if not regime['available']:
            continue
        equations = (
            (dre['services'] + dre['sales'], dre['revenue']),
            (dre['revenue'], result['annualRevenue']),
            (dre['revenue'] + sum(dre.get(key, 0) for key in ('das', 'cbsDebit', 'ibsDebit', 'icmsNet', 'iss', *OPTIONAL_ROWS)), dre['netRevenue']),
            (dre['cmvSimple'] + dre['cmvRegular'], dre['cmv']),
            (dre['netRevenue'] + dre['cmv'] + dre['cbsUsed'] + dre['ibsUsed'], dre['grossProfit']),
            (dre['salaries'] + dre['benefits'] + dre['payroll'], dre['personnel']),
            (dre['grossProfit'] + dre['personnel'] + dre['administrative'] + dre['rent'] + dre['cards'], dre['preTax']),
            (dre['preTax'] + dre['irpj'] + dre['csll'], dre['netProfit']),
            (dre['netProfit'], regime['annualProfit']),
            (-sum(dre.get(key, 0) for key in ('das', 'cbsDebit', 'ibsDebit', 'icmsNet', 'iss', *OPTIONAL_ROWS,
                                            'payroll', 'irpj', 'csll', 'cbsUsed', 'ibsUsed')), regime['totalTaxes']),
        )
        _valid(all(_close(left, right) for left, right in equations))
        for tax in ('cbs', 'ibs'):
            if tax in credits:
                _valid(_close(dre[tax + 'Used'], 0 if regime['id'] == 'pure' else credits[tax]['used']) and
                       _close(dre[tax + 'Debit'], 0 if regime['id'] == 'pure' else -credits[tax]['debit']))
        for key, numerator in (('margin', dre['netProfit']), ('taxBurden', regime['totalTaxes'])):
            value = regime.get(key)
            _valid(value is None if dre['revenue'] <= 0 else
                   _finite(value) and math.isclose(value, numerator / dre['revenue'], rel_tol=1e-12, abs_tol=1e-12))
    memory = result.get('memory', [])
    _valid(isinstance(memory, list) and all(isinstance(row, dict) for row in memory))
    _valid(all(type(row.get('value')) not in (int, float) or _finite(row['value']) for row in memory))
    warnings = result.get('warnings', [])
    _valid(isinstance(warnings, list) and all(isinstance(row, (str, dict)) for row in warnings))
    return {row['id']: row for row in regimes}


def _period(period, months):
    _valid(isinstance(period, dict) and period.get('version') == 'JAN_SEP_V1')
    year = period.get('sourceYear')
    _valid(type(year) is int and 2000 <= year <= 2099)
    expected = [f'{year}-{number:02d}' for number in range(1, 10)]
    _valid(period.get('expectedMonths') == expected and period.get('includedMonths') == months and
           1 <= len(months) <= 9 and months == sorted(set(months)) and all(month in expected for month in months))
    _valid(period.get('months') == len(months) and period.get('startMonth') == months[0] and
           period.get('endMonth') == months[-1] and period.get('complete') is True and
           period.get('missingMonths') == [month for month in expected if month not in months])
    excluded = period.get('excludedMonths')
    _valid(isinstance(excluded, list) and all(isinstance(month, str) and MONTH.fullmatch(month) and month not in expected for month in excluded)
           and len(excluded) == len(set(excluded)))
    if 'availableMonths' in period:
        available = period['availableMonths']
        _valid(isinstance(available, list) and all(isinstance(month, str) and month in expected for month in available)
               and available == sorted(set(available)) and all(month in available for month in months))


def _calendar(snapshot, regimes, monthly):
    calendar = snapshot.get('monthlyDre')
    if calendar is None:
        return
    _valid(isinstance(calendar, dict) and calendar.get('version') in ('DRE_CALENDAR_V1', 'DRE_CALENDAR_V2', 'DRE_CALENDAR_V3', 'DRE_CALENDAR_V4'))
    _valid(calendar.get('year') == snapshot.get('year', snapshot.get('draft', {}).get('year')) and calendar.get('unit') == 'BRL')
    months, rows = calendar.get('months'), calendar.get('regimes')
    _valid(isinstance(months, list) and 1 <= len(months) <= 12 and all(isinstance(row, dict) for row in months))
    _valid(isinstance(rows, list) and all(isinstance(row, dict) for row in rows) and [row.get('id') for row in rows] == list(regimes))
    if calendar['version'] == 'DRE_CALENDAR_V4':
        _period(calendar.get('analysisPeriod'), list(monthly))
        _valid([row.get('sourceMonth') for row in months] == list(monthly))
    else:
        _valid(len(months) == 12 and [row.get('number') for row in months] == list(range(1, 13)))
    for month in months:
        _valid(type(month.get('number')) is int and 1 <= month['number'] <= 12)
        if monthly:
            actual = next((key for key in monthly if int(key[-2:]) == month['number']), None)
            _valid(month.get('sourceMonth') == actual)
    expected_keys = set(BASE_ROWS) | {key for key in OPTIONAL_ROWS if any(key in row['dre'] for row in regimes.values())}
    for item in rows:
        regime = regimes[item['id']]
        _valid(item.get('available') is regime['available'] and isinstance(item.get('rows'), list))
        cells = item['rows']
        _valid(all(isinstance(cell, dict) for cell in cells))
        keys = [cell.get('key') for cell in cells]
        _valid(all(isinstance(key, str) for key in keys) and len(keys) == len(set(keys)) and set(keys) == expected_keys)
        for cell in cells:
            expected = regime['dre'].get(cell['key']) if regime['available'] else None
            _valid(cell.get('annual') is None if expected is None else _close(cell.get('annual'), expected))
            values = cell.get('months')
            _valid(isinstance(values, list) and len(values) == len(months))
            for index, month in enumerate(months):
                if monthly:
                    monthly_regime = monthly.get(month.get('sourceMonth'), {}).get(item['id'])
                    expected = monthly_regime['dre'].get(cell['key']) if monthly_regime and monthly_regime['available'] else None
                else:
                    expected = regime['dre'].get(cell['key'], 0) / 12 if regime['available'] else None
                _valid(values[index] is None if expected is None else _close(values[index], expected))


def validate_dre_snapshot(snapshot):
    """Check structural integrity and saved arithmetic, without applying tax rules."""
    _valid(isinstance(snapshot, dict))
    for key in ('_id', 'clientId', 'generationId'):
        _valid(isinstance(snapshot.get(key), str) and UUID.fullmatch(snapshot[key]))
    company = snapshot.get('company')
    _valid(isinstance(company, dict) and isinstance(company.get('name'), str) and company['name'].strip())
    draft = snapshot.get('draft', {})
    _valid(isinstance(draft, dict))
    year = snapshot.get('year', draft.get('year'))
    _valid(type(year) is int and 2000 <= year <= 2100)
    source = snapshot.get('source', {})
    _valid(isinstance(source, dict))
    _valid(isinstance(snapshot.get('engineInput', {}), dict))
    warnings = source.get('warnings', [])
    _valid(isinstance(warnings, list) and all(isinstance(row, (str, dict)) for row in warnings))
    references = snapshot.get('taxSources', [])
    _valid(isinstance(references, list) and all(isinstance(row, dict) for row in references))
    for key in ('clientId', 'generationId'):
        _valid(key not in source or source[key] == snapshot[key])
    if 'company' in source:
        _valid(isinstance(source['company'], dict) and source['company'].get('code') == company.get('code'))
    result = snapshot.get('result')
    regimes = _regimes(result)
    monthly = {}
    if result.get('method') == 'REPORT_MONTHS_V1':
        entries = result.get('monthlyResults')
        _valid(isinstance(entries, list) and 1 <= len(entries) <= 12 and all(isinstance(row, dict) for row in entries))
        months = [row.get('sourceMonth') for row in entries]
        _valid(all(isinstance(month, str) and MONTH.fullmatch(month) for month in months))
        _valid(months == sorted(months) and len(set(months)) == len(months) and
               len({month[-2:] for month in months}) == len(months))
        for entry in entries:
            _valid(type(entry.get('month')) is int and entry['month'] == int(entry['sourceMonth'][-2:]))
            current = _regimes(entry.get('result'))
            _valid(list(current) == list(regimes))
            monthly[entry['sourceMonth']] = current
        _valid(_close(result['annualRevenue'], sum(row['result']['annualRevenue'] for row in entries)))
        if 'reportMonths' in snapshot:
            _valid(type(snapshot['reportMonths']) is int and snapshot['reportMonths'] == len(months))
        for holder, key in ((source, 'monthlyReports'), (snapshot, 'monthlyInputs')):
            if key in holder:
                data = holder[key]
                _valid(isinstance(data, list) and all(isinstance(row, dict) for row in data) and
                       [row.get('sourceMonth') for row in data] == months)
        for period in (snapshot.get('analysisPeriod'), source.get('analysisPeriod'), result.get('analysisPeriod')):
            if period is not None:
                _period(period, months)
        for identifier, regime in regimes.items():
            values = [row[identifier] for row in monthly.values()]
            _valid(regime['available'] is all(row['available'] for row in values))
            _valid(all(set(row['dre']) == set(regime['dre']) for row in values))
            _valid(all(_close(regime['dre'][key], sum(row['dre'][key] for row in values)) for key in regime['dre']))
            _valid(_close(regime['totalTaxes'], sum(row['totalTaxes'] for row in values)))
    _calendar(snapshot, regimes, monthly)
    return snapshot


def dre_metadata(db, simulation_id, workspace, options):
    """Retrieve a visible saved simulation with exactly the public read guards."""
    require(isinstance(simulation_id, str) and UUID.fullmatch(simulation_id))
    record = db.simulations.find_one({'_id': simulation_id, 'workspaceId': workspace,
                                      'deletedAt': {'$exists': False}})
    require(record and not _receipt(db, 'simulation', simulation_id, workspace),
            404, 'NOT_FOUND', 'Simulação não encontrada.')
    require(not _analysis_lineage_deleted(db, record, workspace), 404, 'NOT_FOUND', 'Simulação não encontrada.')
    if record.get('analysisPublication') == 'PENDING':
        require(db.analyses.find_one({'_id': record.get('analysisId'), 'workspaceId': workspace,
                                      'currentSimulation.id': simulation_id}),
                404, 'NOT_FOUND', 'Esta versão ainda não foi publicada pela análise.')
    validate_dre_snapshot(record)
    regime = options.get('regimeId')
    require(regime is None or any(row['id'] == regime for row in record['result']['regimes']),
            400, 'DRE_REGIME', 'Selecione um dos regimes capturados nesta versão.')
    snapshot = {key: value for key, value in record.items() if key not in ('workspaceId', 'requestHash')}
    parent = record.get('parentSimulationId')
    if parent and not db.simulations.find_one({'_id': parent, 'workspaceId': workspace, 'deletedAt': {'$exists': False}}, {'_id': 1}):
        snapshot['parentSimulationDeleted'] = True
    return {'snapshot': snapshot, 'options': dict(options), 'emittedAt': utcnow()}
