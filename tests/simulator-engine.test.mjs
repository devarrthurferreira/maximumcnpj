// Regression fixtures ported from calculadora@d60e8bc3b2edcc2ebd4ff11cf584689f01d0d381.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, DEFAULT_RATES, EXAMPLE_INPUT, TAX_BANDS, taxInputSchema, createEmptyDraft, draftToInput, calculateSimulation } from '../public/simulator-engine.js';

test('wizard keeps absent revenue and expense fields blank until explicitly completed', () => {
  const draft = createEmptyDraft();
  assert.equal(draftToInput(draft), null);
  assert.throws(() => calculateSimulation(draft), /Preencha todos os campos/);
  for (const key of Object.keys(draft.values)) draft.values[key] = 0;
  assert.ok(draftToInput(draft));
  draft.values.serviceRevenue = null;
  assert.equal(draftToInput(draft), null);
  draft.values.serviceRevenue = '0';
  assert.equal(draftToInput(draft), null);
});

test('monthly wizard retains source defaults and explicitly marks the estimated annual revenue', () => {
  const draft = createEmptyDraft();
  for (const key of Object.keys(draft.values)) draft.values[key] = EXAMPLE_INPUT[key];
  const input = draftToInput(draft);
  assert.deepEqual(input, EXAMPLE_INPUT);
  const snapshot = structuredClone(draft);
  const projected = calculateSimulation(draft);
  const raw = calculateTax(input);
  assert.deepEqual(projected.regimes, raw.regimes);
  assert.deepEqual(projected.credits, raw.credits);
  assert.equal(projected.memory.find(item => item.id === 'rbt12').label, 'Receita estimada em 12 meses');
  assert.ok(projected.warnings.some(item => item.code === 'estimated-rbt12'));
  assert.deepEqual(draft, snapshot);
});

test('wizard rejects annual estimate overflow and unexpected or incomplete nested fields', () => {
  const draft = createEmptyDraft();
  for (const key of Object.keys(draft.values)) draft.values[key] = 0;
  draft.values.salesRevenue = 1_000_000_000_000;
  assert.equal(draftToInput(draft), null);
  draft.values.salesRevenue = 10_000;
  assert.ok(draftToInput(draft));
  assert.equal(draftToInput({ ...draft, extra: true }), null);
  assert.equal(draftToInput({ ...draft, values: { ...draft.values, extra: 0 } }), null);
  const input = draftToInput(draft);
  input.credits.regular.unexpected = 0;
  assert.equal(taxInputSchema.safeParse(input).success, false);
  delete input.credits.regular.unexpected;
  delete input.rates.icms;
  assert.equal(taxInputSchema.safeParse(input).success, false);
});

const example = ()           => structuredClone(EXAMPLE_INPUT);
const close = (actual        , expected        ) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} differs from ${expected}`);
const memory = (result                   , id        ) => {
  const item = result.memory.find(row => row.id === id);
  assert.ok(item, `Missing memory: ${id}`);
  assert.equal(typeof item.value, 'number');
  return item.value          ;
};
function zero()           {
  const input = example();
  for (const key of ['serviceRevenue', 'salesRevenue', 'simplePurchases', 'regularPurchases', 'simpleRegularPurchases', 'salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses', 'extraPayroll', 'rbt12']         ) input[key] = 0;
  for (const group of Object.values(input.credits)) group.base = 0;
  return input;
}

test('reproduces all four reviewed spreadsheet results without intermediate rounding', () => {
  const result = calculateTax(example());
  [143383.96938144, 118395.342618603, 90447.081624, 93819.7790064].forEach((value, index) => close(result.regimes[index].annualProfit, value));
  close(result.credits.icms.debit, 17999.9928);
  close(result.credits.icms.potential, 22464);
  close(result.credits.icms.due, 0);
  close(result.credits.icms.balance, 4464.0072);
  assert.equal(result.bestRegimeId, 'pure');
  close(result.difference, 143383.96938144 - 90447.081624);
});

test('every required numeric field rejects absent, blank, null and numeric-string zero', () => {
  const numericPaths             = [
    ...['serviceRevenue', 'salesRevenue', 'simplePurchases', 'regularPurchases', 'simpleRegularPurchases', 'salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses', 'extraPayroll', 'rbt12'].map(key => [key]),
    ...Object.keys(DEFAULT_RATES).map(key => ['rates', key]),
    ...['simple', 'simpleRegular', 'regular'].flatMap(key => ['base', 'cbsRate', 'ibsRate'].map(field => ['credits', key, field])),
  ];
  for (const path of numericPaths) for (const invalid of [undefined, '', null, '0', NaN, Infinity, -1]) {
    const input = example()                                      ;
    let parent = input;
    for (const segment of path.slice(0, -1)) parent = parent[segment]                           ;
    parent[path.at(-1) ] = invalid;
    assert.equal(taxInputSchema.safeParse(input).success, false, `${path.join('.')} accepted ${String(invalid)}`);
  }
});

test('all values zero remain explicit valid numbers and calculate without division by zero', () => {
  const input = zero();
  for (const key of Object.keys(input.rates)                               ) input.rates[key] = 0;
  for (const group of Object.values(input.credits)) { group.cbsRate = 0; group.ibsRate = 0; }
  assert.equal(taxInputSchema.safeParse(input).success, true);
  const result = calculateTax(input);
  assert.equal(result.annualRevenue, 0);
  assert.equal(result.bestRegimeId, null);
  assert.equal(result.difference, 0);
  for (const regime of result.regimes) {
    assert.equal(regime.available, true);
    assert.equal(regime.annualProfit, 0);
    assert.equal(regime.margin, null);
    assert.equal(regime.taxBurden, null);
    for (const value of Object.values(regime.dre)) assert.equal(value, 0);
  }
});

test('zero revenue with actual costs preserves loss and does not rank scenarios', () => {
  const input = zero();
  input.adminExpenses = 1200;
  input.rent = 800;
  input.salaries = 1000;
  const result = calculateTax(input);
  close(result.regimes[0].annualProfit, -36000);
  close(result.regimes[3].annualProfit, -39336);
  assert.equal(result.regimes[3].dre.irpj, 0);
  assert.equal(result.regimes[3].dre.csll, 0);
  assert.equal(result.bestRegimeId, null);
  assert.equal(result.regimes[3].margin, null);
});

test('ICMS is debit on sales minus credit on non-Simples purchases exactly once', () => {
  const input = example();
  input.salesRevenue = 20000;
  input.regularPurchases = 5000;
  input.credits.regular.base = 5000;
  const result = calculateTax(input);
  assert.deepEqual(result.credits.icms, { debit: 43200, potential: 10800, used: 10800, due: 32400, balance: 0 });
  assert.equal(result.regimes[2].dre.icmsNet, -32400);
  assert.equal(result.regimes[2].dre.cmvRegular, -60000);
  assert.equal(result.regimes[2].dre.icmsUsed, 10800);
  assert.equal(result.regimes[0].dre.icmsNet, 0);
  assert.equal(result.regimes[0].dre.icmsUsed, 0);
});

test('editable ICMS rate changes both credit and debit and can be zero', () => {
  const input = example();
  input.salesRevenue = 20000;
  input.regularPurchases = 5000;
  input.credits.regular.base = 5000;
  input.rates.icms = .12;
  assert.deepEqual(calculateTax(input).credits.icms, { debit: 28800, potential: 7200, used: 7200, due: 21600, balance: 0 });
  input.rates.icms = 0;
  for (const value of Object.values(calculateTax(input).credits.icms)) assert.equal(value, 0);
});

test('no non-Simples purchases means no ICMS credit, even with optant purchases', () => {
  const input = example();
  input.regularPurchases = 0;
  input.credits.regular.base = 0;
  const credit = calculateTax(input).credits.icms;
  assert.equal(credit.potential, 0);
  assert.equal(credit.due, credit.debit);
});

test('no sales and positive purchases separate surplus ICMS from profit', () => {
  const input = example();
  input.salesRevenue = 0;
  const result = calculateTax(input);
  assert.equal(result.credits.icms.debit, 0);
  assert.equal(result.credits.icms.used, 0);
  assert.equal(result.credits.icms.due, 0);
  assert.equal(result.credits.icms.balance, 22464);
  assert.equal(result.regimes[2].dre.icmsNet, 0);
});

test('outside-DAS flag applies net ICMS and ISS to both Simples and removes internal shares', () => {
  const input = example();
  input.icmsOutside = true;
  const result = calculateTax(input);
  for (const regime of result.regimes.slice(0, 2)) {
    close(regime.dre.icmsNet, -result.credits.icms.due);
    close(regime.dre.iss, -input.serviceRevenue * 12 * input.rates.iss);
    close(regime.dre.icmsUsed, result.credits.icms.used);
  }
  const normal = calculateTax(example());
  close(result.regimes[0].dre.das - normal.regimes[0].dre.das,
    memory(result, 'simples.icmsRemoved') + memory(result, 'simples.issRemoved'));
});

test('Simples regular supplier purchases are a subset, never duplicate CMV', () => {
  const input = example();
  input.simpleRegularPurchases = 1000;
  input.credits.simple.base = input.simplePurchases - 1000;
  input.credits.simpleRegular.base = 1000;
  const result = calculateTax(input);
  close(result.regimes[2].dre.cmv, -(input.simplePurchases + input.regularPurchases) * 12);
  close(result.credits.cbs.potential, ((input.simplePurchases - 1000) * .015 + 1000 * .0911 + 10400 * .0911) * 12);
  close(result.credits.icms.potential, input.regularPurchases * 12 * .18);
});

test('supplier subset, eligible bases and excessive combined credits are validated', () => {
  const subset = example();
  subset.simpleRegularPurchases = subset.simplePurchases + 1;
  assert.equal(taxInputSchema.safeParse(subset).success, false);
  for (const key of ['simple', 'simpleRegular', 'regular']         ) {
    const input = example();
    input.credits[key].base += 1;
    assert.equal(taxInputSchema.safeParse(input).success, false);
  }
  const excessive = example();
  excessive.credits.regular.cbsRate = .8;
  excessive.credits.regular.ibsRate = .3;
  assert.equal(taxInputSchema.safeParse(excessive).success, false);
});

test('CBS and IBS settle independently and surplus never creates negative tax', () => {
  const input = example();
  input.rates.cbs = .001;
  input.rates.ibs = .1;
  const result = calculateTax(input);
  assert.equal(result.credits.cbs.due, 0);
  assert.ok(result.credits.cbs.balance > 0);
  assert.ok(result.credits.ibs.due > 0);
  for (const value of Object.values(result.credits)) {
    close(value.debit, value.used + value.due);
    close(value.potential, value.used + value.balance);
    assert.ok(value.due >= 0 && value.balance >= 0);
  }
  assert.equal(result.regimes[0].dre.cbsUsed, 0);
});

for (const [index, rbt12] of [180000, 360000, 720000, 1800000, 3600000, 4800000].entries()) {
  test(`Anexo II uses the correct nominal, deduction, shares and IPI in band ${index + 1}`, () => {
    const input = example();
    input.salesAnnex = 2;
    input.icmsOutside = true;
    input.rbt12 = rbt12;
    const result = calculateTax(input);
    const nominal = [.045, .078, .10, .112, .147, .299][index];
    const deduction = [0, 5940, 13860, 22500, 85500, 720000][index];
    const cbs = [.1385, .1385, .1385, .1385, .1385, .2522][index];
    const ibs = [.0015, .0015, .0015, .0015, .0015, 0][index];
    const ipi = [.075, .075, .075, .075, .075, .3513][index];
    const effective = (rbt12 * nominal - deduction) / rbt12;
    assert.equal(memory(result, 'simples.band'), index + 1);
    close(memory(result, 'simples.sales.nominal'), nominal);
    close(memory(result, 'simples.sales.deduction'), deduction);
    close(memory(result, 'simples.sales.effective'), effective);
    close(memory(result, 'simples.sales.cbs'), effective * cbs);
    close(memory(result, 'simples.sales.ibs'), effective * ibs);
    close(memory(result, 'simples.ipiIncluded'), input.salesRevenue * 12 * effective * ipi);
    assert.equal(result.regimes[0].available, true);
    assert.ok(result.warnings.some(warning => warning.code === 'industry-ipi'));
  });
}

test('all six upper boundaries are inclusive and the next cent enters the next band', () => {
  for (const [index, row] of TAX_BANDS[1].entries()) {
    const input = example(); input.icmsOutside = true; input.rbt12 = row.ceiling;
    assert.equal(memory(calculateTax(input), 'simples.band'), index + 1);
    input.rbt12 += .01;
    const result = calculateTax(input);
    assert.equal(memory(result, 'simples.band'), index < 5 ? index + 2 : 0);
    assert.equal(result.regimes[0].available, index < 5);
  }
});

test('Anexos III and IV apply capped ISS shares in band five; V uses its normal shares', () => {
  for (const serviceAnnex of [3, 4, 5]         ) {
    const input = example(); input.serviceAnnex = serviceAnnex; input.rbt12 = 3600000;
    const result = calculateTax(input);
    const effective = (3600000 * ({3: .21, 4: .22, 5: .23}[serviceAnnex]) - ({3: 125640, 4: 183780, 5: 62100}[serviceAnnex])) / 3600000;
    const expectedCbs = serviceAnnex === 3 ? (effective - .05) * .232 : serviceAnnex === 4 ? (effective - .05) * .3627 : effective * .1696;
    const expectedIbs = serviceAnnex === 3 ? (effective - .05) * .0026 : serviceAnnex === 4 ? (effective - .05) * .004 : effective * .0019;
    close(memory(result, 'simples.services.cbs'), expectedCbs);
    close(memory(result, 'simples.services.ibs'), expectedIbs);
    if (serviceAnnex !== 5) close(memory(result, 'simples.services.iss'), .05);
  }
});

test('sublimit is strict greater-than, with separate preventive projection and availability checks', () => {
  const input = example(); input.rbt12 = 3600000;
  assert.equal(calculateTax(input).warnings.some(w => w.code === 'sublimit'), false);
  input.rbt12 = 3600000.01;
  let result = calculateTax(input);
  assert.ok(result.warnings.some(w => w.code === 'sublimit'));
  assert.equal(result.regimes[0].available, false);
  assert.equal(result.regimes[1].available, false);
  assert.equal(result.regimes[2].available, true);
  input.icmsOutside = true;
  assert.equal(calculateTax(input).regimes[0].available, true);
  input.rbt12 = 500000; input.salesRevenue = 300001; input.icmsOutside = false;
  result = calculateTax(input);
  assert.ok(result.warnings.some(w => w.code === 'sublimit'));
  assert.equal(result.regimes[0].available, true, 'projected excess alone is preventive and cannot choose effective collection date');
});

test('Simples above 4.8 million is unavailable and excluded from comparison', () => {
  const input = example(); input.rbt12 = 4800000.01; input.icmsOutside = true;
  const result = calculateTax(input);
  assert.equal(result.regimes[0].available, false);
  assert.equal(result.regimes[0].annualProfit, 0);
  assert.ok(['presumed', 'actual'].includes(result.bestRegimeId ));
  input.rbt12 = 500000; input.salesRevenue = 500000;
  assert.equal(calculateTax(input).regimes[0].available, false);
});

test('positive revenue and zero RBT12 disables only Simples', () => {
  const input = example(); input.rbt12 = 0;
  const result = calculateTax(input);
  assert.equal(result.regimes[0].available, false);
  assert.equal(result.regimes[1].available, false);
  assert.equal(result.regimes[2].available, true);
  assert.equal(result.regimes[3].available, true);
});

test('Lucro Presumido signals eligibility and warns above 78 million without deciding the prior-year test', () => {
  const base = calculateTax(example());
  assert.equal(base.regimes[2].status, 'Simulação sujeita ao enquadramento');
  assert.equal(base.warnings.find(w => w.code === 'presumed-eligibility')?.severity, 'info');
  assert.equal(base.warnings.some(w => w.code === 'presumed-limit-reference'), false);
  const input = zero();
  input.salesRevenue = 6500000;
  input.rbt12 = 78000000;
  assert.equal(calculateTax(input).warnings.some(w => w.code === 'presumed-limit-reference'), false);
  for (const field of ['rbt12', 'salesRevenue']         ) {
    const above = structuredClone(input);
    above[field] += .01;
    const result = calculateTax(above);
    assert.equal(result.warnings.find(w => w.code === 'presumed-limit-reference')?.severity, 'warning');
    assert.equal(result.regimes[2].available, true);
    assert.equal(result.regimes[2].status, 'Simulação sujeita ao enquadramento');
    assert.ok(Number.isFinite(result.regimes[2].annualProfit));
  }
  assert.equal(calculateTax(zero()).regimes[2].status, 'Calculado com receita zero');
});

test('presumed profit bases use separate service and sales coefficients plus the relative excess rule', () => {
  const input = example(); input.serviceRevenue = 300000; input.salesRevenue = 200000;
  const result = calculateTax(input);
  const normalIr = 2400000 * .08 + 3600000 * .32;
  const normalCs = 2400000 * .12 + 3600000 * .32;
  const totalIr = normalIr + 1000000 * (normalIr / 6000000) * .1;
  const totalCs = normalCs + 1000000 * (normalCs / 6000000) * .1;
  close(memory(result, 'presumed.irTotalBase'), totalIr);
  close(memory(result, 'presumed.csTotalBase'), totalCs);
  close(-result.regimes[2].dre.irpj, totalIr * .15 + (totalIr - 240000) * .1);
  close(-result.regimes[2].dre.csll, totalCs * .09);
  assert.ok(result.warnings.some(w => w.code === 'presumption-increase'));
});

test('ISS applies only to services, and sales-only scenarios use sales presumptions', () => {
  const input = example(); input.serviceRevenue = 0;
  const result = calculateTax(input);
  assert.equal(result.regimes[2].dre.iss, 0);
  close(memory(result, 'presumed.irBase'), input.salesRevenue * 12 * input.rates.irSales);
  close(memory(result, 'presumed.csBase'), input.salesRevenue * 12 * input.rates.csSales);
});

test('all DRE subtotals reconcile without duplicated CMV, personnel or ICMS credits', () => {
  for (const outside of [false, true]) {
    const input = example(); input.icmsOutside = outside;
    const result = calculateTax(input);
    for (const regime of result.regimes) {
      const d = regime.dre;
      close(d.revenue, d.services + d.sales);
      close(d.cmv, d.cmvSimple + d.cmvRegular);
      close(d.grossProfit, d.netRevenue + d.cmv + d.cbsUsed + d.ibsUsed);
      close(d.personnel, d.salaries + d.benefits + d.payroll);
      close(d.preTax, d.grossProfit + d.personnel + d.administrative + d.rent + d.cards);
      close(d.netProfit, d.preTax + d.irpj + d.csll);
      close(regime.totalTaxes, -d.das-d.cbsDebit-d.ibsDebit-d.icmsNet-d.iss-d.payroll-d.irpj-d.csll-d.cbsUsed-d.ibsUsed);
      close(regime.annualProfit, result.annualRevenue + d.cmv + d.salaries + d.benefits + d.administrative + d.rent + d.cards - regime.totalTaxes);
      close(regime.monthlyProfit, regime.annualProfit / 12);
    }
    close(memory(result, 'actual.preTax'), result.regimes[3].dre.preTax);
  }
});

test('unsupported years, annexes, extra keys and out-of-range rates are rejected', () => {
  for (const patch of [{year: 2026}, {salesAnnex: 3}, {serviceAnnex: 1}, {icmsOutside: 'false'}, {unknown: 1}]) assert.equal(taxInputSchema.safeParse({...example(), ...patch}).success, false);
  const input = example(); input.rates.icms = 1.01;
  assert.equal(taxInputSchema.safeParse(input).success, false);
  assert.throws(() => calculateTax(input));
});

test('calculation is deterministic, leaves input untouched and provides finite documented results', () => {
  const input = example(); input.year = 2028;
  const snapshot = structuredClone(input);
  const result = calculateTax(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(calculateTax(input), result);
  assert.ok(result.memory.length > 200);
  assert.equal(new Set(result.memory.map(row => row.id)).size, result.memory.length);
  for (const row of result.memory) {
    assert.ok(row.label && row.formula && row.section);
    if (typeof row.value === 'number') assert.ok(Number.isFinite(row.value));
  }
});
