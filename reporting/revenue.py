"""Read-only closing over the exact company pair, independently of original file balances."""
from __future__ import annotations

from datetime import date
import re

from .core import require
from .difal_policy import assert_generation_available, UUID
from .operation_catalog import normalize_operation_nature, classify_operation_nature

VERSION = 'REVENUE_RECONCILIATION_V1'
INPUTS = ('grossSalesCents', 'serviceSalesCents', 'salesReturnsCents')
AMOUNTS = (*INPUTS, 'grossRevenueCents', 'revenueAfterReturnsCents')
SLOTS = {'PURCHASES_V1': ('purchaseJobId', 'purchaseJobIds'), 'SALES_V1': ('salesJobId', 'salesJobIds')}
MAX_SAFE = 9_007_199_254_740_991


def _check(condition, message='Os relatórios do fechamento não correspondem à empresa e geração.'):
    require(condition, 409, 'GENERATION_INCONSISTENT', message)


def _integer(value):
    _check(type(value) is int and abs(value) <= MAX_SAFE, 'Valor do fechamento de receita inconsistente.')
    return value


def _ids(data):
    return {key: data[key] for key in ('generationId', 'clientId', 'purchaseJobId', 'salesJobId')
            if isinstance(data.get(key), str)}


def unavailable_revenue(reason, metadata=None, status='UNAVAILABLE'):
    return {'version': VERSION, 'status': status, 'available': False, 'reason': reason,
            **_ids(metadata or {}), 'monthly': []}


def _month_index(value):
    return int(value[:4]) * 12 + int(value[5:7]) - 1


def _month(value):
    return f'{value // 12:04d}-{value % 12 + 1:02d}'


def reconcile_revenue_months(rows, metadata):
    _check(isinstance(rows, list) and 1 <= len(rows) <= 12)
    monthly = []
    for row in sorted(rows, key=lambda item: item['sourceMonth']):
        source_month = row['sourceMonth']
        _check(isinstance(source_month, str) and re.fullmatch(r'(?:19\d{2}|20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])', source_month))
        values = {key: _integer(row[key]) for key in INPUTS}
        _check(all(value >= 0 for value in values.values()))
        gross = _integer(values['grossSalesCents'] + values['serviceSalesCents'])
        net = _integer(gross - values['salesReturnsCents'])
        monthly.append({'sourceMonth': source_month, **values, 'grossRevenueCents': gross, 'revenueAfterReturnsCents': net})
    _check(all(_month_index(row['sourceMonth']) == _month_index(monthly[index - 1]['sourceMonth']) + 1
               for index, row in enumerate(monthly) if index > 0))
    values = {key: _integer(sum(row[key] for row in monthly)) for key in AMOUNTS}
    return {'version': VERSION, 'status': 'AVAILABLE', 'available': True, 'reason': None, **_ids(metadata),
            'period': {'startMonth': monthly[0]['sourceMonth'], 'endMonth': monthly[-1]['sourceMonth'], 'months': len(monthly)},
            **values, 'monthly': monthly}


class RevenueEvidence:
    """Collect only month totals while the immutable snapshot is already being reconciled."""
    def __init__(self, job):
        self.job, self.months, self.first, self.last = job, {}, None, None
        self.complete = job.get('calculationVersion') == 'NET_V2'
        self.dates_complete = True

    def add(self, row, cents):
        service_date = row.get('serviceDate')
        try:
            parsed = date.fromisoformat(service_date) if isinstance(service_date, str) else None
            valid_date = parsed and service_date == parsed.isoformat() and 1900 <= parsed.year <= 2200
        except ValueError:
            valid_date = False
        if not valid_date:
            self.complete = self.dates_complete = False
            return
        self.first = min(self.first, service_date) if self.first else service_date
        self.last = max(self.last, service_date) if self.last else service_date
        target = self.months.setdefault(service_date[:7], {key: 0 for key in INPUTS})
        nature = normalize_operation_nature(row.get('natureCode'))
        if len(nature) != 4:
            self.complete = False
            return
        operation = classify_operation_nature(nature)
        field = ({'VENDA': 'grossSalesCents', 'SERVICO_VENDA': 'serviceSalesCents'}.get(operation)
                 if self.job['mode'] == 'SALES_V1' else 'salesReturnsCents' if operation == 'DEVOLUCAO_VENDA' else None)
        if field:
            target[field] = _integer(target[field] + cents)

    def finish(self):
        reason = 'As linhas salvas não conservam natureza e competência suficientes para conferir todas as devoluções.'
        if not self.first or not self.last or not self.dates_complete:
            if self.job.get('reportPeriod'):
                _check(False, 'As competências do fechamento divergem do período fiscal salvo.')
            return {'available': False, 'reason': reason}
        start, end = _month_index(self.first), _month_index(self.last)
        count = end - start + 1
        if not 1 <= count <= 12:
            return {'available': False, 'reason': 'As competências dos relatórios não permitem um fechamento mensal confiável.'}
        period = {'startDate': self.first, 'endDate': self.last, 'startMonth': self.first[:7], 'endMonth': self.last[:7],
                  'months': count, 'observedMonths': len(self.months),
                  'missingMonths': [_month(index) for index in range(start, end + 1) if _month(index) not in self.months]}
        if self.job.get('reportPeriod'):
            _check(all(self.job['reportPeriod'].get(key) == period[key] for key in period),
                   'As competências do fechamento divergem do período fiscal salvo.')
        if not self.complete:
            return {'available': False, 'reason': reason}
        return {'available': True, 'period': period, 'monthly': [
            {'sourceMonth': _month(index), **self.months.get(_month(index), {key: 0 for key in INPUTS})}
            for index in range(start, end + 1)]}


def revenue_from_pair(purchases, sales, metadata):
    if purchases is None or sales is None:
        return unavailable_revenue('O fechamento exige compras e vendas selecionadas na mesma geração.', metadata)
    for meta, mode, key in ((purchases, 'PURCHASES_V1', 'purchaseJobId'), (sales, 'SALES_V1', 'salesJobId')):
        _check(meta['job']['_id'] == metadata[key] and meta['job']['clientId'] == metadata['clientId'] and meta['job']['mode'] == mode)
    p, s = purchases.get('_revenueEvidence'), sales.get('_revenueEvidence')
    if not p or not s or not p.get('available') or not s.get('available'):
        return unavailable_revenue((p or {}).get('reason') or (s or {}).get('reason') or
                                  'A origem não conserva natureza e competência suficientes para fechar a receita.', metadata)
    if any(p['period'][key] != s['period'][key] for key in ('startMonth', 'endMonth', 'months')):
        return unavailable_revenue('Compras e vendas cobrem competências diferentes. Use o mesmo mês/ano inicial e final para conferir as devoluções.', metadata)
    monthly = [{'sourceMonth': sale['sourceMonth'], 'grossSalesCents': sale['grossSalesCents'],
                'serviceSalesCents': sale['serviceSalesCents'], 'salesReturnsCents': purchase['salesReturnsCents']}
               for purchase, sale in zip(p['monthly'], s['monthly'])]
    return reconcile_revenue_months(monthly, metadata)


def _owner(generation, company, job_id, mode):
    owners = [(candidate, history) for candidate in generation['companies'] if isinstance(candidate, dict)
              for _, history in SLOTS.values() for identity in (candidate.get(history) or []) if identity == job_id]
    _check(isinstance(job_id, str) and UUID.fullmatch(job_id) and len(owners) == 1 and
           owners[0][0] is company and owners[0][1] == SLOTS[mode][1])


def report_revenue_reconciliation(db, job, workspace, existing, read):
    _check(job.get('workspaceId') == workspace and job.get('mode') in SLOTS)
    if 'generationId' not in job:
        return unavailable_revenue('Este relatório não conserva um par de compras e vendas vinculado à mesma geração.', {'clientId': job['clientId']})
    generation_id = job['generationId']
    _check(isinstance(generation_id, str) and UUID.fullmatch(generation_id))
    generation = db.generations.find_one({'_id': generation_id, 'workspaceId': workspace})
    assert_generation_available(db, generation, workspace)
    _check(isinstance(generation.get('companies'), list))
    matched = [company for company in generation['companies'] if isinstance(company, dict) and company.get('clientId') == job['clientId']]
    _check(len(matched) == 1)
    company = matched[0]
    _owner(generation, company, job['_id'], job['mode'])
    metadata = {'generationId': generation_id, 'clientId': job['clientId'],
                'purchaseJobId': company.get('purchaseJobId'), 'salesJobId': company.get('salesJobId')}
    if company.get(SLOTS[job['mode']][0]) != job['_id']:
        return unavailable_revenue('Este relatório pertence a uma versão anterior; o par original completo não está registrado para este fechamento.',
                                   {'generationId': generation_id, 'clientId': job['clientId']})
    required = generation.get('requiredReports', ['PURCHASES'])
    _check(isinstance(required, list) and 1 <= len(required) <= 2 and all(value in ('PURCHASES', 'SALES') for value in required) and len(set(required)) == len(required))
    if set(required) != {'PURCHASES', 'SALES'}:
        return unavailable_revenue('O fechamento exige compras e vendas selecionadas na mesma geração.', metadata)
    if not company.get('purchaseJobId') or not company.get('salesJobId'):
        return unavailable_revenue('Adicione e conclua os relatórios de compras e vendas desta empresa para conferir as devoluções.', metadata, 'PENDING')
    jobs = {}
    for mode, (slot, _) in SLOTS.items():
        _owner(generation, company, company[slot], mode)
        selected = db.lookupJobs.find_one({'_id': company[slot], 'workspaceId': workspace})
        _check(selected and selected.get('workspaceId') == workspace and selected.get('generationId') == generation_id and
               selected.get('clientId') == job['clientId'] and selected.get('mode') == mode)
        jobs[mode] = selected
    if any(selected.get('status') != 'COMPLETED' for selected in jobs.values()):
        return unavailable_revenue('Conclua os dois relatórios para conferir a receita bruta e as devoluções do período.', metadata, 'PENDING')
    reports = {mode: existing if selected['_id'] == job['_id'] else read(db, selected, workspace)
               for mode, selected in jobs.items()}
    return revenue_from_pair(reports['PURCHASES_V1'], reports['SALES_V1'], metadata)


def revenue_totals(closings):
    available = [closing for closing in closings if closing.get('available')]
    return {'availableCompanies': len(available), 'unavailableCompanies': len(closings) - len(available),
            'complete': len(available) == len(closings),
            **({key: _integer(sum(closing[key] for closing in available)) for key in AMOUNTS} if available else {})}
