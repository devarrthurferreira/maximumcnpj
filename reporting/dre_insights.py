"""Short management readings of a saved DRE, without recalculating taxes.

Every public function returns new dictionaries. Monetary values, availability
and time series are read through DreModel so missing data remains missing and
the original snapshot is never changed. Cards have a stable presentation-only
contract: id, label, value, detail and tone (neutral, positive or warning).
"""
from __future__ import annotations

from .dre_model import close, finite, money, month_label, percentage


EXPENSES = (
    ('personnel', 'Pessoal e encargos'),
    ('administrative', 'Outras despesas'),
    ('rent', 'Aluguéis'),
    ('cards', 'Taxas de cartão'),
)


def _card(identifier, label, value, detail, tone='neutral'):
    return {'id': identifier, 'label': label, 'value': value,
            'detail': detail, 'tone': tone}


def expense_breakdown(model):
    """Return descending positive outlays with their confirmed denominator.

    Pessoal e encargos is a subtotal: salaries/benefits/payroll are deliberately
    not added again. A missing component, a positive adjustment in a deduction
    or a nonpositive denominator prevents a misleading composition.
    """
    expenses = [(key, label, model.value(model.focus, key)) for key, label in EXPENSES]
    denominator = model.value(model.focus, 'operatingExpenses')
    if (not finite(denominator) or denominator >= 0 or
            any(not finite(value) or value > 0 for _, _, value in expenses)):
        return []
    return sorted([
        {'key': key, 'label': label, 'amount': -value,
         'share': value / denominator, 'denominator': -denominator}
        for key, label, value in expenses
    ], key=lambda row: row['amount'], reverse=True)


def _coverage(model):
    if not model.actual:
        detail = model.coverage_note
    else:
        detail = (f'Base documental: {model.period_label}. Cenário tributário {model.year}. '
                  'O consolidado soma somente as competências disponíveis, sem estimar lacunas.')
    return _card('coverage', 'Cobertura da análise', model.coverage, detail)


def _result_gap(model):
    focus, best = model.focus, model.best
    selected = model.value(focus, 'netProfit')
    if not finite(selected):
        return _card('result_gap', 'Comparação do resultado', 'n/d',
                     focus['name'] + ': ' + str(focus.get('status') or 'resultado indisponível nesta versão.'),
                     'warning')
    if best is None:
        return _card('result_gap', 'Comparação do resultado', 'Sem referência',
                     'Esta versão não registra um regime vencedor. '
                     'Os resultados e as condições de disponibilidade permanecem no comparativo.')
    reference = model.value(best, 'netProfit')
    if not finite(reference) or (reference < selected and not close(reference, selected)):
        return _card('result_gap', 'Comparação do resultado', 'n/d',
                     'A referência salva não permite estabelecer uma diferença para o regime selecionado.')
    ties = [row for row in model.available if close(model.value(row, 'netProfit'), reference)]
    names = ', '.join(row['name'] for row in ties)
    delta = 0.0 if close(reference, selected) else reference - selected
    if delta == 0:
        detail = (f'{focus["name"]} está entre os maiores resultados capturados. '
                  + ('Empate entre ' + names + '. ' if len(ties) > 1 else ''))
    else:
        detail = f'Diferença de {focus["name"]} para {names}, no período {model.period_label}. '
    detail += ('O maior resultado também é prejuízo.' if reference < 0 else
               'Comparação dos valores salvos, conforme as premissas da análise.')
    return _card('result_gap', 'Diferença para o maior resultado', money(delta), detail,
                 'warning' if selected < 0 else 'positive' if delta == 0 else 'neutral')


def _tax_burden(model):
    taxes = model.value(model.focus, 'totalTaxes')
    revenue = model.value(model.focus, 'revenue')
    ratio = model.ratio(model.focus, 'totalTaxes')
    if finite(ratio):
        detail = (f'{money(taxes)} de tributos e encargos / {money(revenue)} de receita utilizada. '
                  'Os créditos utilizados já estão abatidos.')
    elif finite(revenue) and revenue <= 0:
        detail = (f'Tributos e encargos: {money(taxes)}. '
                  f'A receita de {money(revenue)} não fornece denominador positivo para o percentual.')
    else:
        detail = 'O total de tributos e encargos ou a receita está indisponível no regime selecionado.'
    return _card('tax_burden', 'Carga de tributos e encargos', percentage(ratio), detail)


def _main_expense(model):
    rows = expense_breakdown(model)
    if not rows:
        total = model.value(model.focus, 'operatingExpenses')
        components = [model.value(model.focus, key) for key, _ in EXPENSES]
        if finite(total) and total == 0 and all(finite(value) and value == 0 for value in components):
            return _card('main_expense', 'Despesas operacionais', money(0),
                         'Não há despesas operacionais registradas neste cenário. '
                         'A participação percentual não se aplica a um total zero.')
        return _card('main_expense', 'Maior despesa operacional', 'n/d',
                     'A composição requer todas as despesas confirmadas e um total positivo de gastos.')
    largest = rows[0]
    ties = [row for row in rows if close(row['amount'], largest['amount'])]
    label = 'Maior despesa · ' + largest['label'] if len(ties) == 1 else 'Maiores despesas em empate'
    names = ', '.join(row['label'] for row in ties)
    share_label = 'Participação individual' if len(ties) > 1 else 'Participação'
    detail = (f'{names}. {share_label}: {percentage(largest["share"])} das despesas operacionais '
              f'confirmadas ({money(largest["denominator"])}).')
    return _card('main_expense', label, money(largest['amount']), detail)


def executive_insights(model):
    """Four executive cards with explicit bases and no fiscal recommendation."""
    return [_coverage(model), _result_gap(model), _tax_burden(model), _main_expense(model)]


def _monthly_extreme(model, known, *, highest):
    value = (max if highest else min)(row[1] for row in known)
    tied = [index for index, candidate in known if close(candidate, value)]
    months = ', '.join(month_label(model.months[index], True) for index in tied)
    detail = ('Empate: ' if len(tied) > 1 else '') + months + '. '
    detail += f'{model.focus["name"]}; {len(known)} de {len(model.months)} competências com resultado disponível.'
    return _card('best_month' if highest else 'worst_month',
                 'Maior resultado mensal' if highest else 'Menor resultado mensal',
                 money(value), detail, 'warning' if value < 0 else 'neutral')


def _revenue_change(model):
    if len(model.months) < 2:
        return _card('revenue_change', 'Variação entre extremos', 'n/d',
                     'São necessárias pelo menos duas competências de origem com receita disponível.')
    first, last = 0, len(model.months) - 1
    initial = model.value(model.focus, 'revenue', first)
    final = model.value(model.focus, 'revenue', last)
    window = f'{month_label(model.months[first], True)} a {month_label(model.months[last], True)}'
    if not finite(initial) or not finite(final):
        return _card('revenue_change', 'Variação entre extremos', 'n/d',
                     f'{window}: a receita da primeira ou da última competência está indisponível.')
    if initial <= 0:
        return _card('revenue_change', 'Variação entre extremos', 'n/d',
                     f'{window}: de {money(initial)} para {money(final)}. '
                     'A base inicial não é positiva; o percentual não é calculado.')
    ordinal = lambda month: int(month[:4]) * 12 + int(month[5:])
    gaps = ordinal(model.months[last]) - ordinal(model.months[first]) + 1 != len(model.months)
    detail = (f'Receita de {money(initial)} para {money(final)}, de {window}. '
              'Variação entre os extremos observados, sem anualização.')
    if gaps:
        detail += ' Há lacunas entre essas competências.'
    return _card('revenue_change', 'Variação entre extremos', percentage((final - initial) / initial), detail)


def monthly_insights(model):
    """Historical monthly readings; projection parcels never imply performance.

    The endpoint-to-endpoint revenue comparison is explicitly not a monthly
    growth rate. Missing endpoints remain missing even if interior months have
    valid values. Extrema and losses name their observed-data denominator.
    """
    if not model.actual:
        return [_card('projection', 'Série mensal', 'Projeção anual salva', model.coverage_note)]
    known = [(index, model.value(model.focus, 'netProfit', index)) for index in range(len(model.months))]
    known = [(index, value) for index, value in known if finite(value)]
    if not known:
        return [_card('no_history', 'Leitura mensal', 'Sem resultado disponível',
                      'Não há competências com resultado disponível para o regime selecionado.', 'warning')]
    losses = [(index, value) for index, value in known if value < 0]
    loss_detail = ('Competências: ' + ', '.join(month_label(model.months[index], True) for index, _ in losses) + '. '
                   if losses else 'Nenhuma competência com resultado disponível apresenta prejuízo. ')
    loss_detail += f'Base: {len(known)} de {len(model.months)} competências do período; ausência não é zero.'
    return [_monthly_extreme(model, known, highest=True), _monthly_extreme(model, known, highest=False),
            _card('loss_months', 'Competências com prejuízo', f'{len(losses)} de {len(known)}',
                  loss_detail, 'warning' if losses else 'neutral'), _revenue_change(model)]
