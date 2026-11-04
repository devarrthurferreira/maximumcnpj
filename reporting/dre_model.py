"""Read-only financial views for the PDF. No fiscal engine or source lookups.

All amounts come from a validated saved simulation. Derived subtotals, ratios
and comparisons explain those captured amounts without replacing them.
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction

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
    ('Resultado', (('irpj', 'IRPJ total (normal + adicional)'), ('csll', 'CSLL'),
                   ('incomeTaxes', 'Total de IRPJ e CSLL'), ('netProfit', 'Resultado líquido'))),
)
STATEMENT_SECTIONS = (
    ('Receitas e tributos sobre receitas', (
        ('services', 'Receita de serviços'), ('sales', 'Receita de vendas utilizada'),
        ('revenue', 'Receita Total utilizada'), ('das', '(-) Simples Nacional (DAS)'),
        ('icmsNet', '(-) ICMS líquido (D - C)'), ('cbsIbsNet', '(-) CBS/IBS líquido (D - C)'),
        ('iss', '(-) ISS fora do DAS'), ('difal', '(-) DIFAL sobre vendas'),
        ('revenueTaxes', '(=) Tributos sobre receitas'), ('netRevenueAfterTaxes', '= Receita líquida após tributos'))),
    ('Compras e custos', (
        ('cmvSimple', 'Compras do Simples'), ('cmvRegular', 'Compras fora do Simples'),
        ('cmv', 'Total de compras / CMV'), ('icmsAnticipation', '(-) Antecipação de ICMS nas compras'),
        ('cbsUsed', 'Crédito CBS utilizado - informativo'), ('ibsUsed', 'Crédito IBS utilizado - informativo'),
        ('costsWithAnticipation', '= Compras / CMV e antecipação de ICMS'),
        ('grossAfterCosts', '= Resultado após receitas, custos e tributos'))),
    ('Despesas e encargos', (
        ('salaries', 'Salários e pró-labore'), ('benefits', 'Benefícios'),
        ('administrative', 'Outras despesas'), ('rent', 'Aluguéis'), ('cards', 'Taxas de cartão'),
        ('operatingExpensesBeforePayroll', 'Subtotal de despesas operacionais (sem INSS)'),
        ('payroll', '(-) INSS / encargos da folha'),
        ('operatingExpensesWithPayroll', '= Despesas e encargos da folha'))),
    ('IRPJ, CSLL e resultado', (
        ('resultBeforeIncomeTaxes', '= Resultado antes de IRPJ / CSLL'),
        ('irpj', '(-) IRPJ normal e adicional'), ('csll', '(-) CSLL'),
        ('taxesDeduction', '(-) Total de impostos'), ('netProfit', 'Resultado líquido'),
        ('netMargin', '% sobre a receita - resultado'))),
)
TAX_STATEMENT_ROWS = (
    ('das', 'Simples'), ('icmsNet', 'ICMS (D - C)'), ('cbsIbsNet', 'CBS/IBS (D - C)'),
    ('irpj', 'IRPJ'), ('csll', 'CSLL'), ('icmsAnticipation', 'Antecipação'), ('difal', 'DIFAL'),
    ('payroll', 'INSS'), ('iss', 'ISS fora do DAS'), ('totalTaxes', 'Total'),
    ('taxBurden', '% sobre a receita'), ('netProfit', 'Resultado'), ('netMargin', '% sobre a receita'),
)
TAX_COMPONENT_KEYS = frozenset(key for key, _ in TAX_STATEMENT_ROWS if key not in ('totalTaxes', 'taxBurden', 'netProfit', 'netMargin'))
PERCENT_ROWS = {'taxBurden', 'netMargin'}
SUBTOTALS = {'revenue', 'netRevenue', 'cmv', 'grossProfit', 'personnel', 'preTax', 'netProfit',
            'revenueTaxes', 'netRevenueAfterTaxes', 'costsWithAnticipation', 'grossAfterCosts',
            'operatingExpensesBeforePayroll', 'operatingExpensesWithPayroll', 'resultBeforeIncomeTaxes',
            'totalTaxes', 'taxesDeduction'}
DERIVED = {'revenueDeductions', 'netCosts', 'operatingExpenses', 'incomeTaxes'}
GROUP_LABELS = {'OPTANTE': 'Simples Nacional', 'NAO_OPTANTE': 'Não optante', 'CPF': 'Pessoa física (CPF)',
                'NAO_CONFIRMADO': 'Não confirmado', 'OUTROS': 'Outros documentos',
                'B2B': 'Empresas (B2B)', 'B2C': 'Consumidor final (B2C)', 'UNIDENTIFIED': 'Não identificado'}
IRPJ_ROWS = (
    ('irpjTaxBase', 'Base tributável do IRPJ'),
    ('irpjAdditionalLimit', 'Limite do adicional'),
    ('irpjBaseWithinLimit', 'Base dentro do limite'),
    ('irpjExcessBase', 'Base excedente ao limite'),
    ('irpjNormalAssessed', 'IRPJ normal (15% da base)'),
    ('irpjAdditionalAssessed', 'Adicional de IRPJ (10% do excedente)'),
    ('irpjTotalAssessed', 'IRPJ total (normal + adicional)'),
)
IRPJ_KEYS = tuple(key for key, _ in IRPJ_ROWS)
INCOME_TAX_ASSESSMENT_VERSION = 'INCOME_TAX_ASSESSMENT_V2'
IRPJ_RECONCILIATION_VERSION_V2 = 'IRPJ_RECONCILIATION_V2'
IRPJ_V2_ROWS = (
    ('irpjTaxBase', 'Base tributável acumulada do IRPJ'),
    ('irpjAdditionalLimit', 'Limite do adicional dos trimestres'),
    ('irpjBaseWithinLimit', 'Base dentro do limite'),
    ('irpjExcessBase', 'Base excedente ao limite'),
    ('irpjNormalAssessed', 'IRPJ normal acumulado (15%)'),
    ('irpjAdditionalAssessed', 'Adicional acumulado (10%)'),
    ('irpjTotalAssessed', 'IRPJ acumulado dos períodos'),
    ('irpjPreviousProvision', 'Provisão de IRPJ anterior'),
    ('irpjCurrentMovement', 'Movimento de IRPJ no período'),
)
IRPJ_V2_KEYS = tuple(key for key, _ in IRPJ_V2_ROWS)
INCOME_TAX_AMOUNT_KEYS = ('irpjNormalCents', 'irpjAdditionalCents', 'irpjTotalCents', 'csllCents')
INCOME_TAX_RATE_KEYS = ('irSales', 'irServices', 'csSales', 'csServices')
INCOME_TAX_BASE_KEYS = ('salesRevenue', 'serviceRevenue', 'revenue', 'preTax', 'irpjBaseWithoutIncrease',
                        'csllBaseWithoutIncrease', 'irpjIncrease', 'csllIncrease', 'irpjBase', 'csllBase',
                        'irpjAdditionalLimit', 'irpjBaseWithinLimit', 'irpjExcessBase')
IRPJ_V2_EMPTY_REASON = 'A apuração trimestral do IRPJ está ausente ou incompleta nesta versão.'
IRPJ_V2_INVALID_REASON = 'A apuração trimestral do IRPJ não concilia com as bases, provisões ou movimentos salvos.'
IRPJ_V2_PERIOD_REASON = 'As competências e os trimestres do IRPJ estão ausentes, duplicados ou divergem do período salvo.'
IRPJ_EMPTY_REASON = 'A memória do IRPJ está ausente ou incompleta nesta versão.'
IRPJ_INVALID_REASON = 'A memória do IRPJ não concilia com a base, as alíquotas ou o total salvo.'
IRPJ_PERIOD_REASON = 'As competências do IRPJ estão ausentes, duplicadas ou divergem do período salvo.'
IRPJ_CALENDAR_REASON = 'A memória do IRPJ não concilia com o total do calendário salvo.'
IRPJ_CALENDAR_MISSING_REASON = 'Calendário salvo não disponível para este regime.'
IRPJ_DAS_REASON = 'IRPJ incluído no DAS; sem parcela externa neste regime.'


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def close(a, b):
    return finite(a) and finite(b) and abs(a - b) <= max(.011, 8 * math.ulp(max(abs(a), abs(b))))


def total(values):
    values = list(values)
    return sum(values) if values and all(finite(value) for value in values) else None


def irpj_close(a, b):
    """Match the browser's strict reconciliation, not display-cent rounding."""
    return finite(a) and finite(b) and abs(a - b) <= max(1e-7, 8 * 2.220446049250313e-16 * max(abs(a), abs(b)))


def _unique(rows, key, value):
    matches = [row for row in rows if isinstance(row, dict) and row.get(key) == value] if isinstance(rows, list) else []
    return matches[0] if len(matches) == 1 else None


def _irpj_unavailable(reason=IRPJ_EMPTY_REASON, status='UNAVAILABLE'):
    return {'available': False, 'status': status, 'reason': reason, 'values': dict.fromkeys(IRPJ_KEYS)}


def _irpj_confirmed(values):
    return {'available': True, 'status': 'CONFIRMED', 'reason': '', 'values': values}


def _irpj_v2_unavailable(reason=IRPJ_V2_INVALID_REASON, status='UNAVAILABLE'):
    return {'version': IRPJ_RECONCILIATION_VERSION_V2, 'available': False, 'status': status, 'reason': reason,
            'values': dict.fromkeys(IRPJ_V2_KEYS), 'componentMovements': None}


def uses_quarterly_income_tax(result):
    if not isinstance(result, dict):
        return False
    months = result.get('monthlyResults')
    return ('incomeTaxAssessment' in result
            or any('quarterly-income-tax' in str(result.get(key, '')) for key in ('modelVersion', 'version'))
            or (isinstance(months, list) and any(isinstance(row, dict) and isinstance(row.get('result'), dict)
                                                and 'incomeTaxAssessment' in row['result'] for row in months)))


class _IncomeTaxEvidenceError(ValueError):
    pass


def _income_require(condition, reason=IRPJ_V2_INVALID_REASON):
    if not condition:
        raise _IncomeTaxEvidenceError(reason)


def _income_amounts(value, *, signed=False):
    _income_require(isinstance(value, dict))
    _income_require(all(type(value.get(key)) in (int, float) and finite(value[key]) and value[key] == int(value[key])
                        and abs(value[key]) <= 9007199254740991 and (signed or value[key] >= 0)
                        for key in INCOME_TAX_AMOUNT_KEYS))
    _income_require(value['irpjNormalCents'] + value['irpjAdditionalCents'] == value['irpjTotalCents'])
    return {key: int(value[key]) for key in INCOME_TAX_AMOUNT_KEYS}


def _income_fraction(value):
    _income_require(isinstance(value, dict) and isinstance(value.get('numerator'), str)
                    and isinstance(value.get('denominator'), str)
                    and re.fullmatch(r'-?\d{1,128}', value['numerator']) and re.fullmatch(r'\d{1,128}', value['denominator']))
    denominator = int(value['denominator'])
    _income_require(denominator > 0)
    return Fraction(int(value['numerator']), denominator)


def _income_round_cents(value):
    """Exact half-up; tax components, never their bases, are rounded to cents."""
    scaled = abs(value) * 100
    rounded = (scaled.numerator * 2 + scaled.denominator) // (scaled.denominator * 2)
    return -rounded if value < 0 else rounded


def _income_closure(closure, provision, *, complete):
    _income_require(isinstance(closure, dict) and type(closure.get('available')) is bool
                    and isinstance(closure.get('reason'), str))
    if closure['available']:
        _income_require(complete and closure.get('status') == 'CONFIRMED'
                        and _income_amounts(closure.get('taxes')) == provision)
    else:
        _income_require(closure.get('status') == 'UNAVAILABLE' and closure.get('taxes') is None)


def _income_period(period, regime_id, scenario_year, inputs_by_month, rates, basis):
    _income_require(isinstance(period, dict) and period.get('regimeId') == regime_id)
    quarter = period.get('quarter')
    _income_require(type(quarter) is int and 1 <= quarter <= 4 and period.get('periodId') == f'{scenario_year}-Q{quarter}')
    expected = list(range(quarter * 3 - 2, quarter * 3 + 1))
    observed, sources, inputs = period.get('observedMonths'), period.get('sourceMonths'), period.get('inputs')
    _income_require(period.get('expectedMonths') == expected and isinstance(observed, list) and 1 <= len(observed) <= 3
                    and all(type(month) is int and month in expected for month in observed)
                    and observed == sorted(set(observed)) and period.get('throughMonth') == observed[-1]
                    and isinstance(sources, list) and len(sources) == len(observed) and len(set(sources)) == len(sources)
                    and isinstance(inputs, list) and len(inputs) == len(sources))
    missing = [month for month in expected if month not in observed]
    _income_require(period.get('missingMonths') == missing and type(period.get('complete')) is bool
                    and period['complete'] == (not missing))
    captured_sources = sorted(source for source in inputs_by_month
                              if int(source[5:]) in expected and int(source[5:]) <= period['throughMonth'])
    _income_require(sources == captured_sources and 'sourceQuarter' in period
                    and (period['sourceQuarter'] == f'{sources[0][:4]}-Q{quarter}'
                         or (basis == 'UNIFORM_PROJECTION' and period['sourceQuarter'] is None)), IRPJ_V2_PERIOD_REASON)
    for number, source, item in zip(observed, sources, inputs):
        _income_require(isinstance(source, str) and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', source)
                        and int(source[5:]) == number and isinstance(item, dict)
                        and item.get('month') == number and item.get('sourceMonth') == source
                        and finite(item.get('salesRevenue')) and finite(item.get('serviceRevenue'))
                        and item['serviceRevenue'] >= 0
                        and (finite(item.get('preTax')) or item.get('preTax') is None))
        captured = inputs_by_month.get(source)
        _income_require(captured is not None)
        _income_require(irpj_close(item['salesRevenue'], captured.get('salesRevenue'))
                        and irpj_close(item['serviceRevenue'], captured.get('serviceRevenue')))
        if regime_id == 'actual':
            pre_tax = captured.get('preTax')
            _income_require(finite(pre_tax) and item.get('actualAvailable') is not False
                            and irpj_close(item.get('preTax'), pre_tax))
    _income_require(period.get('available') is True)
    bases, exact = period.get('bases'), period.get('exactBases')
    _income_require(isinstance(bases, dict) and isinstance(exact, dict)
                    and all(finite(bases.get(key)) or (key == 'preTax' and bases.get(key) is None)
                            for key in INCOME_TAX_BASE_KEYS))
    tax_base, excess, csll_base = (_income_fraction(exact.get(key)) for key in ('irpjBase', 'irpjExcessBase', 'csllBase'))
    _income_require(tax_base >= 0 and excess >= 0 and csll_base >= 0
                    and bases['irpjAdditionalLimit'] == 60000
                    and excess == max(Fraction(0), tax_base - 60000)
                    and irpj_close(bases['irpjBase'], float(tax_base))
                    and irpj_close(bases['irpjExcessBase'], float(excess))
                    and irpj_close(bases['csllBase'], float(csll_base))
                    and irpj_close(bases['irpjBaseWithinLimit'], float(tax_base - excess)))
    for key, input_key in (('salesRevenue', 'salesRevenue'), ('serviceRevenue', 'serviceRevenue')):
        _income_require(irpj_close(bases[key], sum(item[input_key] for item in inputs)))
    _income_require(irpj_close(bases['revenue'], bases['salesRevenue'] + bases['serviceRevenue'])
                    and irpj_close(bases['irpjBase'], bases['irpjBaseWithoutIncrease'] + bases['irpjIncrease'])
                    and irpj_close(bases['csllBase'], bases['csllBaseWithoutIncrease'] + bases['csllIncrease']))
    if regime_id == 'actual':
        signed = _income_fraction(exact.get('preTax'))
        signed_inputs = [_income_fraction(item['preTaxExact']) if item.get('preTaxExact') is not None
                         else Fraction(str(item['preTax'])) for item in inputs]
        # Only this link allows the binary residue from cancelling very large
        # captured operands. Tax bases, components and DRE bridges stay strict.
        _income_require(all(abs(float(exact_input) - item['preTax']) <= max(1e-7, 32 * 2.220446049250313e-16 *
                            max(abs(item['salesRevenue']), abs(item['serviceRevenue']), abs(item['preTax']), abs(float(exact_input))))
                            for exact_input, item in zip(signed_inputs, inputs))
                        and signed == sum(signed_inputs, Fraction(0))
                        and irpj_close(bases['preTax'], float(signed))
                        and tax_base == csll_base == max(Fraction(0), signed))
    else:
        # Prove the saved LP bases from the captured coefficients and inputs.
        # A missing coefficient is unavailable; no current default rewrites history.
        sales = sum((Fraction(str(item['salesRevenue'])) for item in inputs), Fraction(0))
        services = sum((Fraction(str(item['serviceRevenue'])) for item in inputs), Fraction(0))
        lc224 = period.get('lc224')
        _income_require(isinstance(lc224, dict) and finite(lc224.get('excessRevenue'))
                        and lc224['excessRevenue'] >= 0)
        revenue, increased_revenue = sales + services, Fraction(str(lc224['excessRevenue']))
        _income_require(increased_revenue == 0 or revenue > 0)
        for exact_base, sales_key, services_key, plain_key, increase_key in (
                (tax_base, 'irSales', 'irServices', 'irpjBaseWithoutIncrease', 'irpjIncrease'),
                (csll_base, 'csSales', 'csServices', 'csllBaseWithoutIncrease', 'csllIncrease')):
            plain = max(Fraction(0), sales * Fraction(str(rates[sales_key])) + services * Fraction(str(rates[services_key])))
            increase = increased_revenue * plain / revenue / 10 if increased_revenue else Fraction(0)
            _income_require(exact_base == plain + increase
                            and irpj_close(bases[plain_key], float(plain))
                            and irpj_close(bases[increase_key], float(increase)))
    amounts = _income_amounts(period.get('provision'))
    _income_require(amounts['irpjNormalCents'] == _income_round_cents(tax_base * Fraction(15, 100))
                    and amounts['irpjAdditionalCents'] == _income_round_cents(excess * Fraction(10, 100))
                    and amounts['csllCents'] == _income_round_cents(csll_base * Fraction(9, 100)))
    _income_closure(period.get('closure'), amounts, complete=period['complete'])
    _income_require(period.get('status') == ('CONFIRMED' if period['closure']['available'] else 'PROVISIONAL'))
    return bases, amounts


def _income_assessment(assessment, regime_id, scenario_year, inputs_by_month, rates, basis):
    _income_require(isinstance(assessment, dict))
    if assessment.get('available') is not True:
        _income_require(assessment.get('status') == 'UNAVAILABLE')
        reason = assessment.get('reason')
        raise _IncomeTaxEvidenceError(reason if isinstance(reason, str) and reason else IRPJ_V2_INVALID_REASON)
    periods = assessment.get('periods')
    _income_require(isinstance(periods, list) and 1 <= len(periods) <= 4
                    and len({period.get('quarter') for period in periods if isinstance(period, dict)}) == len(periods)
                    and assessment.get('scope') in ('QUARTER', 'PERIOD', 'ANNUAL_ADJUSTMENT')
                    and type(assessment.get('complete')) is bool)
    verified = [_income_period(period, regime_id, scenario_year, inputs_by_month, rates, basis) for period in periods]
    complete = all(period['complete'] for period in periods)
    _income_require(assessment['complete'] == complete)
    bases = assessment.get('bases')
    _income_require(isinstance(bases, dict))
    for key in INCOME_TAX_BASE_KEYS:
        values = [period_bases[key] for period_bases, _ in verified]
        _income_require(bases.get(key) is None if any(value is None for value in values)
                        else irpj_close(bases.get(key), sum(values)))
    provision = _income_amounts(assessment.get('provision'))
    previous = _income_amounts(assessment.get('previousProvision'))
    movement = _income_amounts(assessment.get('movement'), signed=True)
    for key in INCOME_TAX_AMOUNT_KEYS:
        _income_require(provision[key] == sum(amounts[key] for _, amounts in verified)
                        and movement[key] == provision[key] - previous[key])
    _income_closure(assessment.get('closure'), provision, complete=complete)
    all_closed = all(period['closure']['available'] for period in periods)
    _income_require(assessment['closure']['available'] == all_closed
                    and assessment.get('status') == ('CONFIRMED' if all_closed else 'PROVISIONAL'))
    return {'bases': bases, 'provision': provision, 'previous': previous, 'movement': movement, 'assessment': assessment}


def _income_container(container, frame, source_months, rates=None):
    _income_require(isinstance(container, dict)
                    and container.get('version') == INCOME_TAX_ASSESSMENT_VERSION
                    and container.get('method') == 'QUARTERLY_CUMULATIVE_PROVISION'
                    and container.get('rounding') == 'HALF_UP_COMPONENT_CENTS'
                    and container.get('frame') == frame and type(container.get('scenarioYear')) is int
                    and container['scenarioYear'] in (2027, 2028)
                    and container.get('basis') in ('ACTUAL_REPORT_MONTHS', 'UNIFORM_PROJECTION')
                    and isinstance(container.get('regimes'), dict))
    captured_rates = container.get('presumptionRates')
    _income_require(isinstance(captured_rates, dict)
                    and all(finite(captured_rates.get(key)) and 0 <= captured_rates[key] <= 1
                            and (rates is None or captured_rates[key] == rates.get(key)) for key in INCOME_TAX_RATE_KEYS))
    captured = container.get('sourceMonths')
    _income_require(isinstance(captured, list) and len(captured) == len(source_months)
                    and all(isinstance(month, str) for month in captured)
                    and len(set(captured)) == len(captured) and captured == source_months, IRPJ_V2_PERIOD_REASON)


def _reconcile_irpj_v2(result, regime_id, *, source_month=None, expected_source_months=None, expected_count=None):
    """Verify new quarterly evidence only; the V1 read path is intentionally separate."""
    try:
        container = result.get('incomeTaxAssessment')
        if not isinstance(container, dict):
            return _irpj_v2_unavailable(IRPJ_V2_EMPTY_REASON)
        actual = container.get('basis') == 'ACTUAL_REPORT_MONTHS'
        entries, containers, inputs_by_month, regimes_by_month = {}, {}, {}, {}
        if actual:
            months = result.get('monthlyResults')
            _income_require(isinstance(months, list) and 1 <= len(months) <= 12, IRPJ_V2_PERIOD_REASON)
            for entry in months:
                _income_require(isinstance(entry, dict) and isinstance(entry.get('result'), dict), IRPJ_V2_PERIOD_REASON)
                source = entry.get('sourceMonth')
                _income_require(isinstance(source, str) and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', source)
                                and type(entry.get('month')) is int and entry['month'] == int(source[5:])
                                and source not in entries, IRPJ_V2_PERIOD_REASON)
                entries[source] = entry['result']
                containers[source] = entry['result'].get('incomeTaxAssessment')
                regime = _unique(entry['result'].get('regimes'), 'id', regime_id)
                regimes_by_month[source] = regime
                dre = (regime or {}).get('dre') or {}
                inputs_by_month[source] = ({'salesRevenue': dre.get('sales'), 'serviceRevenue': dre.get('services'),
                                           'preTax': dre.get('preTax')} if regime and regime.get('available') is True else None)
        else:
            _income_require(isinstance(container, dict) and container.get('basis') == 'UNIFORM_PROJECTION')
            containers = container.get('monthlyAssessments')
            _income_require(isinstance(containers, dict) and len(containers) == 12, IRPJ_V2_PERIOD_REASON)
            regime = _unique(result.get('regimes'), 'id', regime_id)
            dre = (regime or {}).get('dre') or {}
            for source in containers:
                _income_require(isinstance(source, str) and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', source), IRPJ_V2_PERIOD_REASON)
                inputs_by_month[source] = {
                    key: dre.get(dre_key) / 12 if finite(dre.get(dre_key)) else None
                    for key, dre_key in (('salesRevenue', 'sales'), ('serviceRevenue', 'services'), ('preTax', 'preTax'))}
        sources = sorted(containers, key=lambda month: int(month[5:]))
        _income_require(len({month[5:] for month in sources}) == len(sources) and len({month[:4] for month in sources}) == 1,
                        IRPJ_V2_PERIOD_REASON)
        if expected_count is not None:
            _income_require(finite(expected_count) and expected_count == len(sources), IRPJ_V2_PERIOD_REASON)
        if expected_source_months is not None:
            _income_require(isinstance(expected_source_months, list) and len(expected_source_months) == len(sources)
                            and len(set(expected_source_months)) == len(expected_source_months)
                            and set(expected_source_months) == set(sources), IRPJ_V2_PERIOD_REASON)
        _income_container(container, 'CONSOLIDATED', sources)
        rates = container['presumptionRates']
        _income_require(container['basis'] == ('ACTUAL_REPORT_MONTHS' if actual else 'UNIFORM_PROJECTION'))
        for source, month_container in containers.items():
            _income_container(month_container, 'MONTH', [source], rates)
            _income_require(month_container['scenarioYear'] == container['scenarioYear']
                            and month_container['basis'] == container['basis'])
        if source_month is not None:
            _income_require(source_month in containers, IRPJ_V2_PERIOD_REASON)
        regime = _unique(result.get('regimes'), 'id', regime_id) if source_month is None or not actual else regimes_by_month.get(source_month)
        _income_require(isinstance(regime, dict))
        if regime.get('available') is not True:
            reason = regime.get('status')
            return _irpj_v2_unavailable(reason if isinstance(reason, str) and reason else IRPJ_EMPTY_REASON)
        if regime_id in ('pure', 'hybrid'):
            if source_month is not None:
                _income_container(containers[source_month], 'MONTH', [source_month])
            _income_require((regime.get('dre') or {}).get('irpj') == 0)
            return _irpj_v2_unavailable(IRPJ_DAS_REASON, 'INCLUDED_IN_DAS')
        _income_require(regime_id in ('presumed', 'actual'))
        checked = {}

        def check_month(source):
            # Only a quarter's own earlier provisions belong to its bridge;
            # December's annual adjustment explicitly uses earlier movements.
            if source in checked:
                return checked[source]
            month_container = containers[source]
            assessed = _income_assessment(month_container['regimes'].get(regime_id), regime_id,
                                           container['scenarioYear'], inputs_by_month, rates, container['basis'])
            assessment = assessed['assessment']
            month_number, quarter = int(source[5:]), (int(source[5:]) - 1) // 3 + 1
            if assessment['scope'] == 'ANNUAL_ADJUSTMENT':
                _income_require(month_number == 12 and regime_id == 'presumed'
                                and [period['quarter'] for period in assessment['periods']] == [1, 2, 3, 4])
                prior = [check_month(item) for item in sources if int(item[5:]) < month_number]
                previous = {key: sum(item['movement'][key] for item in prior) for key in INCOME_TAX_AMOUNT_KEYS}
            else:
                _income_require(assessment['scope'] == 'QUARTER' and len(assessment['periods']) == 1
                                and assessment['periods'][0]['quarter'] == quarter)
                prior = [item for item in sources if int(item[5:]) < month_number and (int(item[5:]) - 1) // 3 + 1 == quarter]
                previous = check_month(prior[-1])['provision'] if prior else dict.fromkeys(INCOME_TAX_AMOUNT_KEYS, 0)
            _income_require(assessed['previous'] == previous)
            for period in assessment['periods']:
                expected = [item for item in sources if (int(item[5:]) - 1) // 3 + 1 == period['quarter']
                            and int(item[5:]) <= month_number]
                _income_require(period['sourceMonths'] == expected, IRPJ_V2_PERIOD_REASON)
            if actual:
                saved_regime = regimes_by_month.get(source)
                saved_dre = (saved_regime or {}).get('dre') or {}
                _income_require(saved_regime and saved_regime.get('available') is True
                                and irpj_close(saved_dre.get('irpj'), -assessed['movement']['irpjTotalCents'] / 100)
                                and irpj_close(saved_dre.get('csll'), -assessed['movement']['csllCents'] / 100))
            checked[source] = assessed
            return assessed

        if source_month is None:
            assessed = _income_assessment(container['regimes'].get(regime_id), regime_id,
                                           container['scenarioYear'], inputs_by_month, rates, container['basis'])
            assessment = assessed['assessment']
            _income_require(assessment['scope'] == 'PERIOD'
                            and assessed['previous'] == dict.fromkeys(INCOME_TAX_AMOUNT_KEYS, 0)
                            and {source for period in assessment['periods'] for source in period['sourceMonths']} == set(sources))
            for source in sources:
                check_month(source)
            for key in INCOME_TAX_AMOUNT_KEYS:
                _income_require(assessed['movement'][key] == sum(item['movement'][key] for item in checked.values()))
            dre = regime.get('dre') or {}
            _income_require(irpj_close(dre.get('irpj'), -assessed['movement']['irpjTotalCents'] / 100)
                            and irpj_close(dre.get('csll'), -assessed['movement']['csllCents'] / 100))
        else:
            assessed = check_month(source_month)
            assessment = assessed['assessment']
        bases, provision, previous, movement = (assessed[key] for key in ('bases', 'provision', 'previous', 'movement'))
        values = {'irpjTaxBase': bases['irpjBase'], 'irpjAdditionalLimit': bases['irpjAdditionalLimit'],
                  'irpjBaseWithinLimit': bases['irpjBaseWithinLimit'], 'irpjExcessBase': bases['irpjExcessBase'],
                  'irpjNormalAssessed': provision['irpjNormalCents'] / 100,
                  'irpjAdditionalAssessed': provision['irpjAdditionalCents'] / 100,
                  'irpjTotalAssessed': provision['irpjTotalCents'] / 100,
                  'irpjPreviousProvision': previous['irpjTotalCents'] / 100,
                  'irpjCurrentMovement': movement['irpjTotalCents'] / 100}
        return {'version': IRPJ_RECONCILIATION_VERSION_V2, 'available': True, 'status': assessment['status'],
                'reason': assessment['reason'], 'scope': assessment['scope'], 'complete': assessment['complete'],
                'closure': {**assessment['closure'], 'taxes': dict(assessment['closure']['taxes']) if assessment['closure']['taxes'] else None},
                'basis': container['basis'], 'scenarioYear': container['scenarioYear'],
                'periods': [{key: period.get(key) for key in ('periodId', 'sourceQuarter', 'quarter', 'sourceMonths', 'complete', 'throughMonth')}
                            for period in assessment['periods']], 'values': values,
                'componentMovements': {'normal': movement['irpjNormalCents'] / 100,
                                      'additional': movement['irpjAdditionalCents'] / 100, 'total': movement['irpjTotalCents'] / 100}}
    except (_IncomeTaxEvidenceError, TypeError, ValueError, KeyError, OverflowError, ZeroDivisionError) as exc:
        return _irpj_v2_unavailable(str(exc) if isinstance(exc, _IncomeTaxEvidenceError) else IRPJ_V2_INVALID_REASON)


def _irpj_captured(result, regime_id):
    regime = _unique(result.get('regimes'), 'id', regime_id)
    if not regime:
        return _irpj_unavailable()
    if regime.get('available') is not True:
        status = regime.get('status')
        return _irpj_unavailable(status if isinstance(status, str) and status else IRPJ_EMPTY_REASON)
    if regime_id in ('pure', 'hybrid'):
        return _irpj_unavailable(IRPJ_DAS_REASON, 'INCLUDED_IN_DAS')
    if regime_id not in ('presumed', 'actual'):
        return _irpj_unavailable()
    ids = {'base': 'presumed.irTotalBase' if regime_id == 'presumed' else 'actual.base',
           'normal': regime_id + '.irBasic', 'additional': regime_id + '.irAdditional', 'total': regime_id + '.irTotal'}
    amounts = {}
    for key, identifier in ids.items():
        entry = _unique(result.get('memory'), 'id', identifier)
        if (not entry or entry.get('unit') != 'currency' or entry.get('availability') == 'UNAVAILABLE'
                or not finite(entry.get('value')) or entry['value'] < 0):
            return _irpj_unavailable()
        amounts[key] = entry['value']
    if (not irpj_close(amounts['normal'] + amounts['additional'], amounts['total'])
            or not irpj_close(-amounts['total'], (regime.get('dre') or {}).get('irpj'))):
        return _irpj_unavailable(IRPJ_INVALID_REASON)
    return {'available': True, 'amounts': amounts}


def _irpj_period(result, regime_id, months):
    saved = _irpj_captured(result, regime_id)
    if not saved['available']:
        return saved
    values = saved['amounts']
    base, limit = values['base'], 20000 * months
    within, excess = min(base, limit), max(0, base - limit)
    if not irpj_close(values['normal'], base * .15) or not irpj_close(values['additional'], excess * .10):
        return _irpj_unavailable(IRPJ_INVALID_REASON)
    return _irpj_confirmed({'irpjTaxBase': base, 'irpjAdditionalLimit': limit,
                           'irpjBaseWithinLimit': within, 'irpjExcessBase': excess,
                           'irpjNormalAssessed': values['normal'], 'irpjAdditionalAssessed': values['additional'],
                           'irpjTotalAssessed': values['total']})


def reconcile_irpj(result, regime_id, *, source_month=None, expected_source_months=None, expected_count=None):
    """Explain immutable captured taxes with the same proof as irpj-reconciliation.js.

    A consolidated managerial report sums independently checked monthly excesses;
    an unused limit in another month cannot reduce a captured monthly additional.
    """
    if uses_quarterly_income_tax(result):
        return _reconcile_irpj_v2(result, regime_id, source_month=source_month,
                                  expected_source_months=expected_source_months, expected_count=expected_count)
    if result.get('method') != 'REPORT_MONTHS_V1':
        return _irpj_period(result, regime_id, 12) if source_month is None else _irpj_unavailable(IRPJ_PERIOD_REASON)
    rows = result.get('monthlyResults')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 12:
        return _irpj_unavailable(IRPJ_PERIOD_REASON)
    source_months, numbers = set(), set()
    for row in rows:
        month = row.get('sourceMonth') if isinstance(row, dict) else None
        if (not isinstance(month, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month)
                or type(row.get('month')) not in (int, float) or row['month'] != int(month[5:])
                or month in source_months or row['month'] in numbers or not isinstance(row.get('result'), dict)):
            return _irpj_unavailable(IRPJ_PERIOD_REASON)
        source_months.add(month)
        numbers.add(row['month'])
    if expected_count is not None and (not finite(expected_count) or expected_count != int(expected_count) or expected_count != len(rows)):
        return _irpj_unavailable(IRPJ_PERIOD_REASON)
    if expected_source_months is not None and (
            not isinstance(expected_source_months, list) or len(expected_source_months) != len(rows)
            or any(not isinstance(month, str) for month in expected_source_months)
            or len(set(expected_source_months)) != len(expected_source_months) or set(expected_source_months) != source_months):
        return _irpj_unavailable(IRPJ_PERIOD_REASON)
    if source_month is not None:
        selected = next((row for row in rows if row['sourceMonth'] == source_month), None)
        return _irpj_period(selected['result'], regime_id, 1) if selected else _irpj_unavailable(IRPJ_PERIOD_REASON)
    saved = _irpj_captured(result, regime_id)
    if not saved['available']:
        return saved
    months = [_irpj_period(row['result'], regime_id, 1) for row in rows]
    failed = next((row for row in months if not row['available']), None)
    if failed:
        return _irpj_unavailable(failed['reason'])
    values = {key: sum(row['values'][key] for row in months) for key in IRPJ_KEYS}
    if (not all(finite(value) for value in values.values())
            or not irpj_close(values['irpjTaxBase'], values['irpjBaseWithinLimit'] + values['irpjExcessBase'])
            or not all(irpj_close(values[key], saved['amounts'][field]) for key, field in (
                ('irpjTaxBase', 'base'), ('irpjNormalAssessed', 'normal'),
                ('irpjAdditionalAssessed', 'additional'), ('irpjTotalAssessed', 'total')))):
        return _irpj_unavailable(IRPJ_INVALID_REASON)
    return _irpj_confirmed(values)


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
        visible = self.options.get('regimeIds')
        if visible is not None:
            # Filtering is a presentation preference only. Keep the complete
            # validated snapshot and its fiscal regime selection untouched.
            self.regimes = [row for row in self.regimes if row['id'] in visible]
        if not self.regimes:
            raise ValueError('A DRE exige ao menos um regime capturado para exibição.')
        self.actual = self.result.get('method') == 'REPORT_MONTHS_V1'
        self.quarterly_income_tax = uses_quarterly_income_tax(self.result)
        self.monthly = self.result.get('monthlyResults', []) if self.actual else []
        self.calendar = self.snapshot.get('monthlyDre') or {}
        self.months = [row['sourceMonth'] for row in self.monthly] if self.actual else [
            row.get('period') or f"{self.snapshot.get('year')}-{row['number']:02d}" for row in self.calendar.get('months', [])]
        self.analysis_period = self.result.get('analysisPeriod') or self.snapshot.get('analysisPeriod') or {}
        self.compact_statement = self.actual and self.result.get('analysisPeriod', {}).get('version') == 'JAN_SEP_V1'
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
        if key == 'taxesDeduction':
            value = self.value(regime, 'totalTaxes', index)
            return -value if finite(value) else None
        # Captured taxes are redistributed, not recalculated or deducted again.
        # Missing inputs remain unavailable instead of becoming zero.
        revenue_taxes = ('das', 'icmsNet', 'cbsIbsNet', 'iss', 'difal')
        if key == 'revenueTaxes':
            return total(self.value(regime, part, index) for part in revenue_taxes)
        if key == 'netRevenueAfterTaxes':
            return total([self.value(regime, 'revenue', index), self.value(regime, 'revenueTaxes', index)])
        if key == 'costsWithAnticipation':
            return total([self.value(regime, 'cmv', index), self.value(regime, 'icmsAnticipation', index)])
        if key == 'grossAfterCosts':
            return total([self.value(regime, 'netRevenueAfterTaxes', index),
                          self.value(regime, 'costsWithAnticipation', index)])
        if key == 'operatingExpensesWithPayroll':
            return total([self.value(regime, 'operatingExpensesBeforePayroll', index),
                          self.value(regime, 'payroll', index)])
        if key == 'resultBeforeIncomeTaxes':
            value = total([self.value(regime, 'grossAfterCosts', index),
                           self.value(regime, 'operatingExpensesWithPayroll', index)])
            expected = self.value(regime, 'preTax', index)
            return expected if finite(value) and finite(expected) and close(value, expected) else None
        if key in IRPJ_V2_KEYS or key in ('irpjBasic', 'irpjAdditional'):
            assessed = self.irpj(regime, index)
            if key in ('irpjBasic', 'irpjAdditional') and assessed.get('version') == IRPJ_RECONCILIATION_VERSION_V2:
                movement = (assessed.get('componentMovements') or {}).get('normal' if key == 'irpjBasic' else 'additional')
                return -movement if finite(movement) else None
            target = {'irpjBasic': 'irpjNormalAssessed', 'irpjAdditional': 'irpjAdditionalAssessed'}.get(key, key)
            value = assessed['values'].get(target)
            return -value if key in ('irpjBasic', 'irpjAdditional') and finite(value) else value
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
            'cbsIbsNet': ['cbsDebit', 'ibsDebit', 'cbsUsed', 'ibsUsed'],
            'operatingExpensesBeforePayroll': ['salaries', 'benefits', 'administrative', 'rent', 'cards'],
        }
        if key in combinations:
            return total(dre.get(part) for part in combinations[key])
        if key == 'totalTaxes':
            if finite(frame.get('totalTaxes')):
                return frame['totalTaxes']
            taxes = total(dre.get(part) for part in combinations['revenueDeductions'] + ['payroll', 'irpj', 'csll', 'cbsUsed', 'ibsUsed'])
            return -taxes if finite(taxes) else None
        if key in PERCENT_ROWS:
            return self.ratio(regime, 'totalTaxes' if key == 'taxBurden' else 'netProfit', index)
        value = dre.get(key)
        return value if finite(value) else None

    def ratio(self, regime, key, index=None):
        value, revenue = self.value(regime, key, index), self.value(regime, 'revenue', index)
        if key in PERCENT_ROWS:
            return value
        return value / revenue if finite(value) and finite(revenue) and revenue > 0 else None

    def sections(self):
        for title, rows in STATEMENT_SECTIONS if self.compact_statement else SECTIONS:
            yield title, [(key, 'IRPJ do período (provisão/ajuste)' if key == 'irpj' and self.quarterly_income_tax else label) for key, label in rows if
                          (key not in ('difal', 'icmsAnticipation') or any(key in regime.get('dre', {}) for regime in self.result['regimes']))]

    def tax_rows(self):
        """Separate tax statement; retaining a pending ISS prevents a false total."""
        def needs_iss(regime):
            if any(self.value(regime, 'iss', index) is None or self.value(regime, 'iss', index) != 0
                   for index in (None, *range(len(self.months)))):
                return True
            if self.snapshot.get('monthlyDre') is None:
                return False
            months = self.calendar.get('months')
            included = self.analysis_period.get('includedMonths')
            valid = (self.calendar.get('version') == 'DRE_CALENDAR_V4'
                     and (self.calendar.get('analysisPeriod') or {}).get('version') == 'JAN_SEP_V1'
                     and isinstance(months, list) and isinstance(included, list) and len(months) == len(included)
                     and all(isinstance(row, dict) and row.get('sourceMonth') == month
                             and row.get('number') == int(month[5:]) for row, month in zip(months, included)))
            saved = _unique(self.calendar.get('regimes'), 'id', regime['id']) if valid else None
            line = _unique(saved.get('rows'), 'key', 'iss') if saved and saved.get('available') is True else None
            annual = line.get('annual') if line else None
            return not finite(annual) or annual != 0

        return [(key, label) for key, label in TAX_STATEMENT_ROWS
                if key != 'iss' or any(needs_iss(regime) for regime in self.result['regimes'])]

    def tax_value(self, regime, key, index=None):
        value = self.value(regime, key, index)
        return -value if key in TAX_COMPONENT_KEYS and finite(value) else value

    def tax_ratio(self, regime, key, index=None):
        value, revenue = self.tax_value(regime, key, index), self.value(regime, 'revenue', index)
        if key in PERCENT_ROWS:
            return value
        return value / revenue if finite(value) and finite(revenue) and revenue > 0 else None

    def irpj(self, regime, index=None):
        """Reconcile the displayed period from captured evidence, without new tax amounts."""
        quarterly = self.quarterly_income_tax
        unavailable = _irpj_v2_unavailable if quarterly else _irpj_unavailable
        period = self.result.get('analysisPeriod') or {}
        period = period if self.actual and period.get('version') == 'JAN_SEP_V1' else {}
        calendar_months = self.calendar.get('months')
        valid_calendar = False
        if isinstance(calendar_months, list):
            included = period.get('includedMonths')
            if period:
                valid_calendar = (self.calendar.get('version') == 'DRE_CALENDAR_V4'
                    and (self.calendar.get('analysisPeriod') or {}).get('version') == 'JAN_SEP_V1'
                    and isinstance(included, list) and len(calendar_months) == len(included)
                    and all(isinstance(row, dict) and isinstance(month, str)
                            and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month)
                            and row.get('sourceMonth') == month and row.get('number') == int(month[5:])
                            for row, month in zip(calendar_months, included)))
            else:
                valid_calendar = (self.calendar.get('version') in ('DRE_CALENDAR_V1', 'DRE_CALENDAR_V2', 'DRE_CALENDAR_V3')
                                  and len(calendar_months) == 12)
        if self.actual:
            source = self.snapshot.get('source') or {}
            included = period.get('includedMonths')
            reports = source.get('monthlyReports')
            expected = included if included is not None else (
                [row.get('sourceMonth') if isinstance(row, dict) else None for row in reports] if isinstance(reports, list) else None)
            if expected is None and valid_calendar:
                expected = [row['sourceMonth'] for row in calendar_months if row.get('sourceMonth')]
            count = period.get('months')
            if count is None:
                count = self.snapshot.get('reportMonths')
            if count is None:
                count = source.get('reportMonths')
            if index is not None and (type(index) is not int or not 0 <= index < len(self.months)):
                return unavailable(IRPJ_V2_PERIOD_REASON if quarterly else IRPJ_PERIOD_REASON)
            assessed = reconcile_irpj(self.result, regime['id'], source_month=self.months[index] if index is not None else None,
                                      expected_source_months=expected, expected_count=count)
        else:
            if index is not None and (type(index) is not int or not 0 <= index < len(self.months)):
                return unavailable(IRPJ_V2_PERIOD_REASON if quarterly else IRPJ_PERIOD_REASON)
            assessed = reconcile_irpj(self.result, regime['id'], source_month=self.months[index] if quarterly and index is not None else None)
        # The browser's DAS label additionally requires a captured zero. The
        # shared fiscal helper alone only identifies this regime's tax scope.
        if assessed['status'] == 'INCLUDED_IN_DAS':
            captured_value = (self.frame(regime, index if self.actual else None).get('dre') or {}).get('irpj')
            if not finite(captured_value) or captured_value != 0:
                return unavailable(IRPJ_INVALID_REASON)
        if index is None or (not assessed['available'] and assessed['status'] != 'INCLUDED_IN_DAS'):
            return assessed
        if type(index) is not int or not 0 <= index < len(self.months):
            return unavailable(IRPJ_V2_PERIOD_REASON if quarterly else IRPJ_PERIOD_REASON)
        scale = 1 if self.actual or quarterly else 1 / 12
        if self.snapshot.get('monthlyDre') is not None:
            saved = _unique(self.calendar.get('regimes'), 'id', regime['id']) if valid_calendar else None
            calendar_index = next((i for i, row in enumerate(calendar_months or [])
                                   if row.get('sourceMonth') == self.months[index]), None) if self.actual else index
            if (not saved or calendar_index is None or (not self.actual and saved.get('available') is not True)
                    or (self.actual and (self.calendar.get('version') not in ('DRE_CALENDAR_V3', 'DRE_CALENDAR_V4')
                                         or calendar_months[calendar_index].get('number') != int(self.months[index][5:])))):
                return unavailable(IRPJ_CALENDAR_MISSING_REASON)
            line = _unique(saved.get('rows'), 'key', 'irpj') if saved else None
            values = line.get('months') if line else None
            value = values[calendar_index] if isinstance(values, list) and calendar_index is not None and calendar_index < len(values) else None
            # Match irpjIncludedInDas: a missing/nonzero displayed calendar cell
            # must not be described as an IRPJ included in the DAS.
            if assessed['status'] == 'INCLUDED_IN_DAS':
                return assessed if finite(value) and value == 0 else unavailable(IRPJ_CALENDAR_REASON)
            expected = assessed['componentMovements']['total'] if quarterly else assessed['values']['irpjTotalAssessed'] * scale
            if not finite(value) or not irpj_close(-value, expected):
                return unavailable(IRPJ_CALENDAR_REASON)
        if assessed['status'] == 'INCLUDED_IN_DAS':
            return assessed
        if quarterly:
            return assessed
        return _irpj_confirmed({key: value * scale for key, value in assessed['values'].items()})

    def tax_rates(self):
        """Expose captured CBS/IBS assumptions, never today's default rates."""
        months = []
        captured_inputs = self.snapshot.get('engineInput', {}).get('months', [])
        for entry in self.monthly:
            engine = entry.get('engineInput') or next((row.get('input') or {} for row in captured_inputs
                                                       if row.get('sourceMonth') == entry['sourceMonth']), {})
            engine = engine if isinstance(engine, dict) else {}
            engine_rates = engine.get('rates')
            engine_rates = engine_rates if isinstance(engine_rates, dict) else {}
            memory = entry['result'].get('memory', [])
            values = {}
            for tax in ('cbs', 'ibs'):
                raw = engine_rates.get(tax)
                found = [item for item in memory if item.get('id') == 'rate.' + tax]
                stored = found[0].get('value') if len(found) == 1 and found[0].get('unit') == 'percent' else None
                valid = lambda value: finite(value) and 0 <= value <= 1
                if ((raw is not None and not valid(raw)) or
                    (found and (len(found) != 1 or not valid(stored))) or
                    (valid(raw) and valid(stored) and not math.isclose(raw, stored, rel_tol=1e-12, abs_tol=1e-12))):
                    values[tax] = None
                else:
                    values[tax] = raw if valid(raw) else stored if valid(stored) else None
            values['combined'] = total([values['cbs'], values['ibs']])
            months.append({'sourceMonth': entry['sourceMonth'], **values})
        rates = {}
        for tax in ('cbs', 'ibs'):
            values = [month[tax] for month in months]
            rates[tax] = values[0] if values and all(finite(value) and math.isclose(value, values[0], rel_tol=1e-12, abs_tol=1e-12)
                                                   for value in values) else None
        return {**rates, 'combined': total([rates['cbs'], rates['ibs']]), 'monthly': months}

    def credit(self, tax, regime, field):
        if regime.get('available') is not True:
            return None
        if tax == 'cbsIbs':
            return total([self.credit('cbs', regime, field), self.credit('ibs', regime, field)])
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
        selected = {row['id'] for row in self.regimes}
        simples = bool(selected & {'pure', 'hybrid'})
        for warning in [*self.result.get('warnings', []), *self.snapshot.get('source', {}).get('warnings', [])]:
            code = warning.get('code') if isinstance(warning, dict) else None
            if not simples and code in ('sublimit', 'simples-unavailable', 'service-annex', 'annex-iv-payroll',
                                        'rbt12-source', 'estimated-rbt12', 'difal-estimate', 'difal-partial',
                                        'icms-anticipation', 'icms-anticipation-partial'):
                continue
            if 'presumed' not in selected and code in ('presumed-eligibility', 'presumed-limit-reference', 'presumption-increase'):
                continue
            value = (warning.get('message') or warning.get('text') or warning.get('label') or
                     '. '.join(str(warning.get(key) or '') for key in ('title', 'detail')).strip('. ')) if isinstance(warning, dict) else warning
            if value and str(value) not in values:
                values.append(str(value))
        return values
