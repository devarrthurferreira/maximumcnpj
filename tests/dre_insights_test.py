"""Management readings preserve the financial and historical snapshot boundaries."""
import copy
import unittest
from datetime import datetime, timezone

from dre_data_test import fixture
from reporting.dre_insights import executive_insights, expense_breakdown, monthly_insights
from reporting.dre_model import DreModel


def model(snapshot, regime='actual'):
    return DreModel({'snapshot': snapshot, 'options': {'period': 'complete', 'regimeId': regime},
                     'emittedAt': datetime(2026, 10, 28, 14, tzinfo=timezone.utc)})


def cards(items):
    return {row['id']: row for row in items}


def brl(value):
    return 'R$ ' + f'{value:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def percent(value):
    return f'{value * 100:.1f}'.replace('.', ',') + '%'


class DreInsightsTests(unittest.TestCase):
    def test_executive_comparison_uses_selected_regime_and_saved_period_totals(self):
        saved = fixture()
        selected = next(row for row in saved['result']['regimes'] if row['id'] == 'actual')
        best = next(row for row in saved['result']['regimes'] if row['id'] == saved['result']['bestRegimeId'])
        readings = cards(executive_insights(model(saved)))
        self.assertEqual(readings['result_gap']['value'], brl(best['dre']['netProfit'] - selected['dre']['netProfit']))
        self.assertIn('Lucro Real para Simples Puro', readings['result_gap']['detail'])
        self.assertIn('Jan/2025 a Set/2025', readings['result_gap']['detail'])
        self.assertEqual(readings['tax_burden']['value'], percent(selected['totalTaxes'] / selected['dre']['revenue']))
        self.assertIn(brl(selected['totalTaxes']), readings['tax_burden']['detail'])
        self.assertIn(brl(selected['dre']['revenue']), readings['tax_burden']['detail'])
        self.assertIn('créditos utilizados já estão abatidos', readings['tax_burden']['detail'])

    def test_partial_period_never_becomes_annual_and_exposes_nonconsecutive_extremes(self):
        saved = fixture('partial')
        view = model(saved)
        readings = cards(executive_insights(view))
        self.assertEqual(readings['coverage']['value'], '3 de 9 competências')
        self.assertIn('sem estimar lacunas', readings['coverage']['detail'])
        monthly = cards(monthly_insights(view))
        self.assertEqual(monthly['loss_months']['value'], '1 de 3')
        self.assertIn('Mar/2025', monthly['loss_months']['detail'])
        self.assertEqual(monthly['revenue_change']['value'], '66,5%')
        self.assertIn('de Jan/2025 a Set/2025', monthly['revenue_change']['detail'])
        self.assertIn('sem anualização', monthly['revenue_change']['detail'])
        self.assertIn('Há lacunas', monthly['revenue_change']['detail'])
        # The historical model itself still forbids month-on-month percentages
        # across these gaps; the new reading is explicitly endpoint-to-endpoint.
        self.assertIsNone(view.movement('revenue', 1)[2])
        self.assertIsNone(view.movement('revenue', 2)[2])

    def test_loss_comparison_does_not_present_the_least_loss_as_profit(self):
        view = model(fixture('loss'))
        readings = cards(executive_insights(view))
        self.assertEqual(readings['result_gap']['tone'], 'warning')
        self.assertIn('O maior resultado também é prejuízo', readings['result_gap']['detail'])
        monthly = cards(monthly_insights(view))
        self.assertEqual(monthly['loss_months']['value'], '9 de 9')
        self.assertEqual(monthly['best_month']['tone'], 'warning')
        self.assertEqual(monthly['worst_month']['tone'], 'warning')
        self.assertIn('R$ -', monthly['best_month']['value'])
        self.assertIn('R$ -', monthly['worst_month']['value'])
        # Selecting the captured best still means a loss and a zero gap.
        focused_best = cards(executive_insights(model(fixture('loss'), view.best['id'])))
        self.assertEqual(focused_best['result_gap']['value'], 'R$ 0,00')
        self.assertEqual(focused_best['result_gap']['tone'], 'warning')

    def test_zero_preserves_zero_without_a_winner_or_a_fictitious_percentage(self):
        view = model(fixture('zero'))
        readings = cards(executive_insights(view))
        self.assertEqual(readings['result_gap']['value'], 'Sem referência')
        self.assertEqual(readings['result_gap']['tone'], 'neutral')
        self.assertEqual(readings['tax_burden']['value'], 'n/d')
        self.assertIn('R$ 0,00', readings['tax_burden']['detail'])
        self.assertEqual(readings['main_expense']['value'], 'R$ 0,00')
        self.assertEqual(expense_breakdown(view), [])
        monthly = cards(monthly_insights(view))
        self.assertEqual(monthly['revenue_change']['value'], 'n/d')
        self.assertEqual(monthly['loss_months']['value'], '0 de 9')
        self.assertEqual(monthly['best_month']['value'], 'R$ 0,00')
        self.assertIn('Empate', monthly['best_month']['detail'])
        self.assertIn('Jan/2025', monthly['best_month']['detail'])
        self.assertIn('Set/2025', monthly['best_month']['detail'])

    def test_unavailable_selected_regime_is_never_replaced_with_zero_or_another_regime(self):
        view = model(fixture('unavailable'), 'pure')
        self.assertFalse(view.focus['available'])
        readings = cards(executive_insights(view))
        self.assertEqual(readings['result_gap']['value'], 'n/d')
        self.assertIn(view.focus['status'], readings['result_gap']['detail'])
        self.assertEqual(readings['tax_burden']['value'], 'n/d')
        self.assertEqual(readings['main_expense']['value'], 'n/d')
        self.assertEqual(expense_breakdown(view), [])
        monthly = cards(monthly_insights(view))
        self.assertEqual(set(monthly), {'no_history'})

    def test_legacy_projection_never_yields_historical_monthly_insights(self):
        view = model(fixture('legacy'))
        readings = cards(executive_insights(view))
        self.assertEqual(readings['coverage']['value'], 'Projeção anual salva')
        monthly = cards(monthly_insights(view))
        self.assertEqual(set(monthly), {'projection'})
        self.assertIn('não movimentos históricos individuais', monthly['projection']['detail'])
        self.assertIn('Não há análise de crescimento mensal realizado', monthly['projection']['detail'])

    def test_expense_composition_does_not_double_count_personnel_subtotals(self):
        saved = fixture()
        selected = next(row for row in saved['result']['regimes'] if row['id'] == 'actual')['dre']
        expected_total = -sum(selected[key] for key in ('personnel', 'administrative', 'rent', 'cards'))
        view = model(saved)
        expenses = expense_breakdown(view)
        self.assertEqual(len(expenses), 4)
        self.assertAlmostEqual(sum(row['amount'] for row in expenses), expected_total)
        self.assertAlmostEqual(sum(row['share'] for row in expenses), 1)
        self.assertEqual(expenses[0]['key'], 'personnel')
        self.assertAlmostEqual(expenses[0]['amount'], -selected['personnel'])
        reading = cards(executive_insights(view))['main_expense']
        self.assertEqual(reading['value'], brl(-selected['personnel']))
        self.assertIn(percent(-selected['personnel'] / expected_total), reading['detail'])
        self.assertIn(brl(expected_total), reading['detail'])
        # An incomplete denominator cannot silently omit a component.
        del selected['rent']
        self.assertEqual(expense_breakdown(view), [])
        self.assertEqual(cards(executive_insights(view))['main_expense']['value'], 'n/d')

    def test_tied_results_name_every_tied_regime_and_do_not_invent_a_gap(self):
        saved = fixture()
        best = next(row for row in saved['result']['regimes'] if row['id'] == saved['result']['bestRegimeId'])
        selected = next(row for row in saved['result']['regimes'] if row['id'] == 'actual')
        selected['dre']['netProfit'] = best['dre']['netProfit']
        gap = cards(executive_insights(model(saved)))['result_gap']
        self.assertEqual(gap['value'], 'R$ 0,00')
        self.assertIn('Empate entre', gap['detail'])
        self.assertIn('Simples Puro', gap['detail'])
        self.assertIn('Lucro Real', gap['detail'])
        self.assertEqual(gap['tone'], 'positive')

    def test_excluded_saved_winner_does_not_become_a_new_recommendation(self):
        saved = fixture()
        saved['result']['regimeSelection']['selected'] = ['actual']
        gap = cards(executive_insights(model(saved)))['result_gap']
        self.assertEqual(gap['value'], 'Sem referência')
        self.assertNotIn('Simples Puro', gap['detail'])

    def test_missing_endpoint_is_not_replaced_with_nearest_available_month(self):
        saved = fixture()
        first = next(row for row in saved['result']['monthlyResults'][0]['result']['regimes'] if row['id'] == 'actual')
        first['available'] = False
        readings = cards(monthly_insights(model(saved)))
        self.assertEqual(readings['revenue_change']['value'], 'n/d')
        self.assertIn('indisponível', readings['revenue_change']['detail'])
        self.assertEqual(readings['loss_months']['value'], '1 de 8')
        self.assertIn('8 de 9 competências', readings['loss_months']['detail'])

    def test_nonpositive_starting_revenue_never_becomes_a_growth_percentage(self):
        for initial in (0, -100):
            with self.subTest(initial=initial):
                saved = fixture()
                first = next(row for row in saved['result']['monthlyResults'][0]['result']['regimes'] if row['id'] == 'actual')
                first['dre']['revenue'] = initial
                reading = cards(monthly_insights(model(saved)))['revenue_change']
                self.assertEqual(reading['value'], 'n/d')
                self.assertIn('base inicial não é positiva', reading['detail'])

    def test_all_variants_remain_unchanged_and_cards_have_no_snapshot_aliases(self):
        for variant in ('complete', 'partial', 'loss', 'zero', 'unavailable', 'legacy'):
            with self.subTest(variant=variant):
                saved = fixture(variant)
                before = copy.deepcopy(saved)
                view = model(saved)
                executive = executive_insights(view)
                monthly = monthly_insights(view)
                expenses = expense_breakdown(view)
                self.assertEqual(saved, before)
                for row in executive + monthly:
                    self.assertEqual(set(row), {'id', 'label', 'value', 'detail', 'tone'})
                    self.assertIn(row['tone'], ('neutral', 'positive', 'warning'))
                    self.assertIsInstance(row['value'], str)
                executive[0]['detail'] = 'modified output'
                monthly[0]['detail'] = 'modified output'
                if expenses:
                    expenses[0]['amount'] = -999
                self.assertEqual(saved, before)
                self.assertNotEqual(executive_insights(view)[0]['detail'], 'modified output')
                self.assertNotEqual(monthly_insights(view)[0]['detail'], 'modified output')


if __name__ == '__main__':
    unittest.main()
