"""Read-only financial views for the PDF. No fiscal engine or source lookups.

All amounts come from a validated saved simulation. Derived subtotals, ratios
and comparisons explain those captured amounts without replacing them.
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, ROUND_HALF_UP

MONTHS = ('Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro')
REGIME_NAMES = {'pure': 'Simples Puro', 'hybrid': 'Simples Híbrido',
                'presumed': 'Lucro Presumido', 'actual': 'Lucro Real'}
SECTIONS = (
    ('Receitas', (('services', 'Receita de serviços'), ('sales', 'Receita de vendas utilizada'),
                  ('revenue', 'Receita total utilizada'))),
    ('Tributos sobre a receita', (('das', 'DAS'), ('cbsDebit', 'Débito de CBS'),
                                  ('ibsDebit', 'Débito de IBS'), ('icmsNet', 'ICMS líquido fora do DAS'),
                                  ('iss', 'ISS fora do DAS'), ('difal', 'DIFAL sobre vendas'),
                                  ('icmsAnticipation', 'Antecipação de ICMS'),
                                  ('revenueDeductions', 'Total de deduções tributárias'),
                                  ('netRevenue', 'Receita após deduções tributárias'))),
    ('Compras, custos e créditos', (('cmvSimple', 'Compras do Simples'), ('cmvRegular', 'Compras fora do Simples'),
                                    ('cmv', 'Compras / CMV total'), ('cbsUsed', 'Crédito CBS utilizado'),
                                    ('ibsUsed', 'Crédito IBS utilizado'),
                                    ('netCosts', 'Compras após créditos de CBS e IBS'), ('grossProfit', 'Lucro bruto'))),
    ('Despesas operacionais', (('salaries', 'Salários e pró-labore'), ('benefits', 'Benefícios'),
                               ('payroll', 'Encargos adicionais'), ('personnel', 'Pessoal e encargos'),
                               ('administrative', 'Outras despesas'), ('rent', 'Aluguéis'), ('cards', 'Taxas de cartão'),
                               ('operatingExpenses', 'Total de despesas operacionais'), ('preTax', 'Resultado antes de IRPJ / CSLL'))),
    ('Resultado', (('irpj', 'IRPJ e adicional'), ('csll', 'CSLL'),
                   ('incomeTaxes', 'Total de IRPJ e CSLL'), ('netProfit', 'Resultado líquido'))),
)
SUBTOTALS = {'revenue', 'netRevenue', 'cmv', 'grossProfit', 'personnel', 'preTax', 'netProfit'}
DERIVED = {'revenueDeductions', 'netCosts', 'operatingExpenses', 'incomeTaxes'}
GROUP_LABELS = {'OPTANTE': 'Simples Nacional', 'NAO_OPTANTE': 'Não optante', 'CPF': 'Pessoa física (CPF)',
                'NAO_CONFIRMADO': 'Não confirmado', 'OUTROS': 'Outros documentos',
                'B2B': 'Empresas (B2B)', 'B2C': 'Consumidor final (B2C)', 'UNIDENTIFIED': 'Não identificado'}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def close(a, b):
    return finite(a) and finite(b) and abs(a - b) <= max(.011, 8 * math.ulp(max(abs(a), abs(b))))


def total(values):
    values = list(values)
    return sum(values) if values and all(finite(value) for value in values) else None


def decimal_text(value, places=2):
    if not finite(value):
        return 'n/d'
    rounded = Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = abs(rounded)
    return f'{rounded:,.{places}f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def money(value, symbol=True):
    return ('R$ ' if symbol and finite(value) else '') + decimal_text(value)


def percentage(value, places=1):
    return decimal_text(value * 100, places) + '%' if finite(value) else 'n/d'


def compact(value):
    if not finite(value):
        return 'n/d'
    amount = abs(value)
    for threshold, suffix in ((1e12, ' tri'), (1e9, ' bi'), (1e6, ' mi'), (1e3, ' mil')):
        if amount >= threshold:
            return decimal_text(value / threshold, 1) + suffix
    return decimal_text(value, 0)


def month_label(value, short=False):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', value):
        return str(value or 'Não informado')
    label = MONTHS[int(value[5:]) - 1]
    return f'{label[:3] if short else label}/{value[:4]}'


class DreModel:
    def __init__(self, meta):
        self.snapshot = meta['snapshot']
        self.options = meta['options']
        self.emitted_at = meta['emittedAt']
        self.result = self.snapshot['result']
        selection = (self.result.get('regimeSelection') or {}).get('selected')
        self.regimes = [row for row in self.result['regimes'] if not selection or row['id'] in selection]
        self.actual = self.result.get('method') == 'REPORT_MONTHS_V1'
        self.monthly = self.result.get('monthlyResults', []) if self.actual else []
        self.calendar = self.snapshot.get('monthlyDre') or {}
        self.months = [row['sourceMonth'] for row in self.monthly] if self.actual else [
            row.get('period') or f"{self.snapshot.get('year')}-{row['number']:02d}" for row in self.calendar.get('months', [])]
        self.analysis_period = self.result.get('analysisPeriod') or self.snapshot.get('analysisPeriod') or {}
        self.available = [row for row in self.regimes if row.get('available') is True]
        self.best = next((row for row in self.available if row['id'] == self.result.get('bestRegimeId')
                          and row['dre']['revenue'] > 0), None)
        chosen = self.options.get('regimeId') or (self.best or {}).get('id')
        self.focus = next((row for row in self.regimes if row['id'] == chosen), self.regimes[0])
        self.company = self.snapshot.get('company') or self.snapshot.get('source', {}).get('company') or {}
        self.year = self.snapshot.get('year', self.snapshot.get('draft', {}).get('year'))
        self.period = self.options.get('period', 'complete')
        self.show_percent = self.options.get('showPercent', True)

    @property
    def coverage(self):
        if not self.actual:
            return 'Projeção anual salva'
        expected = 9 if self.analysis_period.get('version') == 'JAN_SEP_V1' else 12
        return f'{len(self.months)} de {expected} competências'

    @property
    def period_label(self):
        if not self.actual:
            return f'Projeção do cenário {self.year}'
        if not self.months:
            return 'Período não informado'
        first, last = self.months[0], self.months[-1]
        return month_label(first) if first == last else f'{month_label(first, True)} a {month_label(last, True)}'

    @property
    def coverage_note(self):
        if not self.actual:
            return ('Esta versão contém uma projeção anual. Os meses são as parcelas da projeção preservada, '
                    'e não movimentos históricos individuais. Não há análise de crescimento mensal realizado.')
        note = f'O consolidado soma exclusivamente {len(self.months)} competências de origem: ' + ', '.join(self.months) + '.'
        missing = self.analysis_period.get('missingMonths') or []
        if missing:
            note += ' Sem dados suficientes: ' + ', '.join(missing) + '.'
        if self.analysis_period.get('version') == 'JAN_SEP_V1':
            note += ' Outubro a dezembro ficam fora da janela desta análise.'
        return note + ' Meses ausentes não são estimados nem preenchidos com zero. O ano do cenário tributário é apresentado separadamente.'

    def frame(self, regime, index=None):
        if index is None:
            return regime
        if self.actual:
            return next((row for row in self.monthly[index]['result']['regimes'] if row['id'] == regime['id']), {})
        saved = next((row for row in self.calendar.get('regimes', []) if row['id'] == regime['id']), {})
        values = {row['key']: row.get('months', [])[index] for row in saved.get('rows', []) if index < len(row.get('months', []))}
        return {'id': regime['id'], 'available': saved.get('available') is True, 'dre': values}

    def value(self, regime, key, index=None):
        frame = self.frame(regime, index)
        if frame.get('available') is not True:
            return None
        dre = frame.get('dre') or {}
        combinations = {
            'revenueDeductions': ['das', 'cbsDebit', 'ibsDebit', 'icmsNet', 'iss'] + [key for key in ('difal', 'icmsAnticipation') if key in dre],
            'netCosts': ['cmv', 'cbsUsed', 'ibsUsed'],
            'operatingExpenses': ['personnel', 'administrative', 'rent', 'cards'],
            'incomeTaxes': ['irpj', 'csll'],
            'creditsApplied': ['cbsUsed', 'ibsUsed', 'icmsUsed'],
        }
        if key in combinations:
            return total(dre.get(part) for part in combinations[key])
        if key == 'totalTaxes':
            if finite(frame.get('totalTaxes')):
                return frame['totalTaxes']
            taxes = total(dre.get(part) for part in combinations['revenueDeductions'] + ['payroll', 'irpj', 'csll', 'cbsUsed', 'ibsUsed'])
            return -taxes if finite(taxes) else None
        value = dre.get(key)
        return value if finite(value) else None

    def ratio(self, regime, key, index=None):
        value, revenue = self.value(regime, key, index), self.value(regime, 'revenue', index)
        return value / revenue if finite(value) and finite(revenue) and revenue > 0 else None

    def sections(self):
        for title, rows in SECTIONS:
            yield title, [(key, label) for key, label in rows if key not in ('difal', 'icmsAnticipation') or
                          any(key in regime.get('dre', {}) for regime in self.regimes)]

    def credit(self, tax, regime, field):
        if regime.get('available') is not True:
            return None
        credit = (self.result.get('credits') or {}).get(tax) or {}
        if not all(finite(credit.get(key)) and credit[key] >= 0 for key in ('debit', 'potential', 'used', 'due', 'balance')):
            return None
        if not close(credit['due'], credit['debit'] - credit['used']) or not close(credit['balance'], credit['potential'] - credit['used']):
            return None
        if not self.actual and not close(credit['used'], min(credit['debit'], credit['potential'])):
            return None
        if tax == 'icms':
            if regime['id'] in ('pure', 'hybrid'):
                def captured_outside(engine, memory):
                    entries = [entry for entry in memory if entry.get('id') == 'outside']
                    text = entries[0].get('value') if len(entries) == 1 and entries[0].get('unit') == 'text' else None
                    text = text == 'Sim' if text in ('Sim', 'Não') else None
                    flag = engine.get('icmsOutside') if type(engine.get('icmsOutside')) is bool else None
                    return None if flag is not None and text is not None and flag != text else flag if flag is not None else text
                engine = self.snapshot.get('engineInput') or {}
                if self.actual:
                    flags = [captured_outside(entry.get('engineInput') or next((row.get('input') or {} for row in engine.get('months', []) if row.get('sourceMonth') == entry['sourceMonth']), {}),
                                              entry['result'].get('memory', [])) for entry in self.monthly]
                else:
                    flags = [captured_outside(engine, self.result.get('memory', []))]
                if not flags or any(flag is not True for flag in flags):
                    return None
            matches = close(self.value(regime, 'icmsNet'), -credit['due']) and close(self.value(regime, 'icmsUsed'), credit['used']) and close(self.value(regime, 'icmsBalance'), credit['balance'])
        else:
            if regime['id'] == 'pure':
                return None
            matches = close(self.value(regime, tax + 'Debit'), -credit['debit']) and close(self.value(regime, tax + 'Used'), credit['used'])
        return credit.get(field) if matches else None

    def movement(self, key, index):
        current = self.value(self.focus, key, index)
        if not self.actual or index == 0:
            return current, None, None
        before, now = self.months[index - 1], self.months[index]
        ordinal = lambda text: int(text[:4]) * 12 + int(text[5:])
        prior = self.value(self.focus, key, index - 1)
        if ordinal(now) - ordinal(before) != 1 or not finite(current) or not finite(prior):
            return current, None, None
        delta = current - prior
        return current, delta, delta / prior if prior > 0 else None

    def commercial(self):
        data = self.snapshot.get('source', {}).get('commercialComposition') or {}
        if not self.actual or data.get('version') != 'COMMERCIAL_COMPOSITION_V1' or data.get('unit') != 'CENTS' or data.get('sourceMonths') != self.months:
            return None
        revenue, purchases = data.get('revenue') or {}, data.get('purchases') or {}
        valid_cents = lambda value: type(value) is int and abs(value) <= 9007199254740991
        for block, groups in ((revenue, ('byCustomerType', 'byTaxStatus')), (purchases, ('byTaxStatus',))):
            if not valid_cents(block.get('totalCents')) or block.get('percentDenominatorCents') != block['totalCents']:
                return None
            for key in groups:
                rows = block.get(key)
                if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) or not valid_cents(row.get('totalCents')) for row in rows):
                    return None
                if sum(row['totalCents'] for row in rows) != block['totalCents']:
                    return None
        if not all(valid_cents(revenue.get(key)) for key in ('grossCents', 'returnsCents')) or revenue['grossCents'] - revenue['returnsCents'] != revenue['totalCents']:
            return None
        return data

    def memory(self):
        selected = {row['id'] for row in self.regimes}
        pending = {row['id']: row for row in self.regimes if not row['available']}
        simples = bool(selected & {'pure', 'hybrid'})
        missing_rbt12 = (self.snapshot.get('rbt12Source') or self.result.get('rbt12Source')) == 'NOT_PROVIDED'
        for entry in self.result.get('memory', []):
            identifier = str(entry.get('id') or '')
            match = re.match(r'(?:(?:dre|summary)\.|difal\.(?:option|operations|status)\.)(pure|hybrid|presumed|actual)(?:\.|$)', identifier)
            regime = match.group(1) if match else identifier.split('.')[0] if identifier.startswith(('presumed.', 'actual.')) else None
            if regime and regime not in selected:
                continue
            if not simples and (identifier.startswith(('simples.', 'difal.', 'icmsAnticipation.')) or identifier in ('rbt12', 'sublimit', 'simplesLimit', 'outside', 'payroll.simple')):
                continue
            if identifier == 'simples.pureDas' and 'pure' not in selected:
                continue
            if identifier in ('simples.hybridDas', 'simples.cbsRemoved', 'simples.ibsRemoved') and 'hybrid' not in selected:
                continue
            if identifier in ('rate.irSales', 'rate.csSales', 'rate.irServices', 'rate.csServices') and 'presumed' not in selected:
                continue
            if identifier in ('rate.payroll', 'payroll.regular') and not selected & {'presumed', 'actual'}:
                continue
            item = dict(entry)
            if self.actual and item.get('section') == 'Valores anuais':
                item['section'] = 'Valores do período'
            if regime in pending and finite(item.get('value')):
                item.update(value='Não disponível: ' + str(pending[regime].get('status') or 'cenário pendente'), unit='text')
            elif missing_rbt12 and finite(item.get('value')) and identifier.startswith('simples.') and identifier != 'simples.revenueReference':
                item.update(value='Não disponível: a RBT12 não foi informada.', unit='text')
            elif any(key in pending for key in ('pure', 'hybrid')) and item.get('unit') == 'currency' and identifier.startswith('simples.') and not (identifier.endswith('.deduction') or identifier == 'simples.revenueReference'):
                item.update(value='Não disponível: o Simples exige conferência neste período.', unit='text')
            yield item

    def warnings(self):
        values = []
        for warning in [*self.result.get('warnings', []), *self.snapshot.get('source', {}).get('warnings', [])]:
            value = (warning.get('message') or warning.get('text') or warning.get('label') or
                     '. '.join(str(warning.get(key) or '') for key in ('title', 'detail')).strip('. ')) if isinstance(warning, dict) else warning
            if value and str(value) not in values:
                values.append(str(value))
        return values
