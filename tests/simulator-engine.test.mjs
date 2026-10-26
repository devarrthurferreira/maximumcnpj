// Regression fixtures ported from calculadora@d60e8bc3b2edcc2ebd4ff11cf584689f01d0d381.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax, DEFAULT_RATES, EXAMPLE_INPUT, TAX_BANDS, taxInputSchema, createEmptyDraft, draftToInput, calculateSimulation, defaultDifalPolicy, parseDifalPolicy, upgradeDifalPolicy, resolveDifalApplication } from '../public/simulator-engine.js';
import {projectDifal} from '../public/simulator-projection.js';

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

test('new wizard uses explicit RBT12 instead of monthly revenue times twelve', () => {
  const draft=createEmptyDraft(); for(const key of Object.keys(draft.values)) draft.values[key]=EXAMPLE_INPUT[key];
  draft.rbt12=1_376_165.25;
  const input=draftToInput(draft);
  assert.equal(input.rbt12,1_376_165.25);
  const projected=calculateSimulation(draft), memory=projected.memory.find(item=>item.id==='rbt12');
  assert.equal(memory.label,'RBT12 do Simples Nacional');
  assert.ok(projected.warnings.some(item=>item.code==='rbt12-source'));
  assert.ok(!projected.warnings.some(item=>item.code==='estimated-rbt12'));
  draft.rbt12=null; assert.equal(draftToInput(draft),null);
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

test('RBT12 além da tabela e projeção acima de R$ 4,8 milhões pedem revisão e ficam fora do ranking', () => {
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

test('diagnóstico distingue RBT12, sublimite local e limite de referência sem confirmar exclusão fiscal',()=>{
  const input=example();input.salesRevenue=100000;input.serviceRevenue=0;
  for(const [rbt12,icmsOutside,expected] of [
    [3300000,false,'READY'],[3600000,false,'READY'],[3600000.01,false,'LOCAL_TAX_REVIEW_REQUIRED'],
    [3600000.01,true,'READY'],[4800000,true,'READY'],[4800000.01,true,'RATE_TABLE_EXCEEDED']
  ]){
    const result=calculateTax({...input,rbt12,icmsOutside}),diagnostic=result.simplesDiagnostic;
    assert.equal(diagnostic.statusCode,expected);
    assert.equal(diagnostic.available,expected==='READY');
    assert.equal(diagnostic.eligibilityVerified,false);assert.equal(diagnostic.rbt12,rbt12);
    assert.equal(diagnostic.federalLimit,4800000);assert.equal(diagnostic.sublimit,3600000);
    assert.equal(diagnostic.revenueReference,1200000);assert.equal(diagnostic.revenueBasis,'AVERAGE_X12');
    assert.equal(diagnostic.completeYear,false);
    if(expected==='LOCAL_TAX_REVIEW_REQUIRED')assert.match(diagnostic.message,/não exclui/);
    if(expected==='RATE_TABLE_EXCEEDED')assert.match(diagnostic.message,/não confirma exclusão/);
  }
  const exceeded=calculateTax({...input,salesRevenue:400000.01,rbt12:3300000});
  assert.equal(exceeded.simplesDiagnostic.statusCode,'REVENUE_REVIEW_REQUIRED');
  assert.match(exceeded.simplesDiagnostic.action,/ano-calendário/);
});

test('opção explícita de ICMS e ISS fora do DAS é validada sem aceitar contexto fiscal no rascunho',()=>{
  const d=createEmptyDraft();for(const key of Object.keys(d.values))d.values[key]=EXAMPLE_INPUT[key];
  d.values.salesRevenue=100000;d.values.serviceRevenue=1000;d.values.regularPurchases=0;
  d.rbt12=4000000;d.icmsOutside=true;
  const before=structuredClone(d),outside=calculateSimulation(d);
  assert.equal(draftToInput(d).icmsOutside,true);assert.equal(outside.regimes[0].available,true);
  assert(outside.regimes[0].dre.icmsNet<0);assert(outside.regimes[0].dre.iss<0);
  assert.equal(outside.simplesDiagnostic.icmsOutside,true);assert.deepEqual(d,before);
  assert.equal(calculateSimulation({...d,icmsOutside:false}).simplesDiagnostic.statusCode,'LOCAL_TAX_REVIEW_REQUIRED');
  assert.equal(draftToInput({...d,icmsOutside:'true'}),null);
  assert.equal(draftToInput({...d,revenueContext:{revenueCents:0}}),null);
  const context={version:'SIMPLES_REVENUE_CONTEXT_V1',method:'ACTUAL_REPORT_MONTHS',revenueCents:330000000,sourceMonths:['2025-01']};
  assert.equal(draftToInput(d,null,null,{...context,revenueCents:NaN}),null);
  assert.equal(draftToInput(d,null,null,{...context,sourceMonths:['2025-01','2025-01']}),null);
});

test('memória de cenário Simples pendente não apresenta impostos intermediários ou zeros como confirmados',()=>{
  const input={...example(),salesRevenue:100000,serviceRevenue:0,rbt12:3700000,icmsOutside:false};
  const result=calculateTax(input);
  assert.equal(result.simplesDiagnostic.statusCode,'LOCAL_TAX_REVIEW_REQUIRED');
  for(const id of ['dre.pure.revenue','dre.pure.netProfit','summary.pure.taxes','summary.hybrid.monthly','simples.pureDas','simples.hybridDas','simples.salesDas','simples.sales.effective','simples.cbsRemoved']){
    const item=result.memory.find(item=>item.id===id);assert(item,id);
    assert.equal(item.unit,'text',id);assert.equal(item.availability,'UNAVAILABLE',id);
    assert.equal(item.value,'Conferência necessária');assert.match(item.formula,/sexta faixa/);
  }
  for(const id of ['annual.revenue','simples.revenueReference','rbt12','sublimit','simplesLimit','dre.presumed.netProfit','summary.actual.taxes']){
    const item=result.memory.find(item=>item.id===id);assert.equal(item.unit,'currency',id);assert.equal(typeof item.value,'number',id);
  }
  const outside=calculateTax({...input,icmsOutside:true});
  assert.equal(outside.regimes[0].available,true);
  assert.equal(outside.memory.find(item=>item.id==='simples.pureDas').unit,'currency');
  assert.equal(typeof outside.memory.find(item=>item.id==='simples.pureDas').value,'number');
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

test('DIFAL reduz receita e lucro uma vez somente no Simples, sem alterar IRPJ e CSLL dos outros regimes', () => {
  const input=example(), baseline=calculateTax(input), result=calculateTax({...input,difalMonthly:100});
  close(result.annualRevenue,baseline.annualRevenue);assert.deepEqual(result.credits,baseline.credits);
  for(const regime of result.regimes){
    const old=baseline.regimes.find(item=>item.id===regime.id),d=regime.dre,charge=['pure','hybrid'].includes(regime.id)?1200:0;
    close(d.difal,-charge);close(d.netRevenue,old.dre.netRevenue-charge);close(d.preTax,old.dre.preTax-charge);
    close(d.netRevenue,d.revenue+d.das+d.cbsDebit+d.ibsDebit+d.icmsNet+d.iss+d.difal);
    close(regime.totalTaxes,-d.das-d.cbsDebit-d.ibsDebit-d.icmsNet-d.iss-d.difal-d.payroll-d.irpj-d.csll-d.cbsUsed-d.ibsUsed);
    close(regime.annualProfit,result.annualRevenue+d.cmv+d.salaries+d.benefits+d.administrative+d.rent+d.cards-regime.totalTaxes);
    close(regime.monthlyProfit,regime.annualProfit/12);
    close(d.irpj,old.dre.irpj);close(d.csll,old.dre.csll);close(regime.totalTaxes,old.totalTaxes+charge);
  }
  close(memory(result,'actual.preTax'),result.regimes[3].dre.preTax);
  close(memory(result,'actual.base'),Math.max(0,result.regimes[3].dre.preTax));
  close(result.regimes[3].dre.csll,-Math.max(0,result.regimes[3].dre.preTax)*.09);
  close(result.regimes[3].dre.irpj,baseline.regimes[3].dre.irpj);
  const loss=calculateTax({...input,difalMonthly:1000000});
  close(loss.regimes[3].dre.irpj,baseline.regimes[3].dre.irpj);close(loss.regimes[3].dre.csll,baseline.regimes[3].dre.csll);
  assert.equal(Object.hasOwn(baseline.regimes[0].dre,'difal'),false);
  assert.equal(calculateTax({...input,difalMonthly:0}).regimes[0].dre.difal,0);
});

test('DIFAL context is distinct from editable draft, retains missing-source state and identifies partial estimates',()=>{
 const draft=createEmptyDraft();for(const key of Object.keys(draft.values))draft.values[key]=EXAMPLE_INPUT[key];
 const difal=projectDifal({version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:10000,amountCents:1000,pendingLines:2},3,'source-job');
 const before=structuredClone(draft), result=calculateSimulation(draft,difal);
 assert.equal(draftToInput(draft,difal).difalMonthly,3.33);
 close(result.regimes[0].dre.difal,-39.96);assert(result.warnings.some(warning=>warning.code==='difal-partial'));
 assert.equal(result.memory.find(row=>row.id==='difal.source').value,10);assert.deepEqual(draft,before);
 assert.equal(draftToInput({...draft,difalMonthly:999}),null);
 assert.equal(draftToInput(draft,{...difal,annualCents:1}),null);
 assert.equal(draftToInput(draft,{...difal,monthlyCents:-1}),null);
 for(const value of[-1,'0',null,Infinity])assert.equal(taxInputSchema.safeParse({...EXAMPLE_INPUT,difalMonthly:value}).success,false);
});

test('antecipação de ICMS deduz 7,32% de compras interestaduais somente nos dois regimes Simples, sem crédito ou tributo duplicado',()=>{
 const input={...example(),difalMonthly:100},baseline=calculateTax(input);
 const anticipation={version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73_200}; // R$10.000 ×7,32%.
 const result=calculateTax({...input,icmsAnticipation:anticipation});
 assert.equal(result.version,'1.10.0-regime-selection');assert.equal(baseline.version,'1.10.0-regime-selection');
 assert.deepEqual(result.credits,baseline.credits);close(result.annualRevenue,baseline.annualRevenue);
 for(const regime of result.regimes){
  const old=baseline.regimes.find(row=>row.id===regime.id),d=regime.dre,charge=['pure','hybrid'].includes(regime.id)?8784:0;
  close(d.icmsAnticipation,-charge);close(d.difal,old.dre.difal);
  close(d.netRevenue,old.dre.netRevenue-charge);close(d.preTax,old.dre.preTax-charge);
  close(d.netProfit,old.dre.netProfit-charge);close(regime.totalTaxes,old.totalTaxes+charge);
  close(d.irpj,old.dre.irpj);close(d.csll,old.dre.csll);close(d.icmsUsed,old.dre.icmsUsed);close(d.cbsUsed,old.dre.cbsUsed);
  close(d.netRevenue,d.revenue+d.das+d.cbsDebit+d.ibsDebit+d.icmsNet+d.iss+d.difal+d.icmsAnticipation);
  close(regime.annualProfit,result.annualRevenue+d.cmv+d.salaries+d.benefits+d.administrative+d.rent+d.cards-regime.totalTaxes);
 }
 assert.equal(Object.hasOwn(baseline.regimes[0].dre,'icmsAnticipation'),false);
 assert.equal(memory(result,'icmsAnticipation.annual'),8784);
 close(memory(result,'actual.preTax'),baseline.regimes[3].dre.preTax);
});

test('antecipação é bloqueada no sublimite inclusive, acima dele e com ICMS fora do DAS',()=>{
 const icmsAnticipation={version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200};
 for(const rbt12 of [3_599_999.99,3_600_000,3_600_000.01])for(const icmsOutside of [false,true]){
  const input={...example(),rbt12,icmsOutside},old=calculateTax(input),result=calculateTax({...input,icmsAnticipation});
  const charge=rbt12<3_600_000&&!icmsOutside?8784:0;
  for(const [index,regime]of result.regimes.entries()){
   assert.equal(regime.available,old.regimes[index].available);
   close(regime.dre.icmsAnticipation,index<2?-charge:0);
   close(regime.annualProfit,old.regimes[index].annualProfit-(index<2?charge:0));
  }
  close(memory(result,'icmsAnticipation.annual'),charge);
 }
 // Uma competência sazonal não deve acionar o bloqueio por sua receita multiplicada por12.
 const seasonal=calculateTax({...example(),salesRevenue:310_000,serviceRevenue:0,rbt12:3_000_000,icmsAnticipation});
 assert(seasonal.annualRevenue>3_600_000);assert(seasonal.regimes[0].available);close(seasonal.regimes[0].dre.icmsAnticipation,-8784);
});

test('antecipação usa contexto versionado, preserva fonte pendente e não aceita centavos ou versões inválidos',()=>{
 const draft=createEmptyDraft();for(const key of Object.keys(draft.values))draft.values[key]=EXAMPLE_INPUT[key];draft.rbt12=180000;
 const projection={version:'ICMS_ANTICIPATION_DRE_V1',ratePercent:7.32,monthlyCents:73200,annualCents:878400,sourceBaseCents:1_000_000,sourceAmountCents:73200,reportMonths:1,pendingLines:2};
 const before=structuredClone({draft,projection}),input=draftToInput(draft,null,projection),result=calculateSimulation(draft,null,projection);
 assert.deepEqual(input.icmsAnticipation,{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200});
 assert.equal(memory(result,'icmsAnticipation.base'),10_000);assert.equal(memory(result,'icmsAnticipation.source'),732);
 assert(result.warnings.some(row=>row.code==='icms-anticipation-partial'));
 assert.deepEqual({draft,projection},before);
 assert.equal(Object.hasOwn(draftToInput(draft),'icmsAnticipation'),false);
 for(const patch of [{version:'UNKNOWN'},{monthlyCents:-1},{monthlyCents:1.2},{monthlyCents:'73200'},{monthlyCents:Infinity},{annualCents:1},{ratePercent:10},{sourceBaseCents:-1},{sourceAmountCents:NaN},{pendingLines:1.1},{reportMonths:0}])assert.equal(draftToInput(draft,null,{...projection,...patch}),null,JSON.stringify(patch));
 for(const invalid of [null,{}, {version:'UNKNOWN',monthlyCents:0},{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:1.2},{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:-1},{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:Number.MAX_SAFE_INTEGER},{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:0,extra:true}])assert.equal(taxInputSchema.safeParse({...example(),icmsAnticipation:invalid}).success,false);
 const zero=calculateSimulation(draft,null,{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:0,annualCents:0});assert.equal(zero.regimes[0].dre.icmsAnticipation,0);
 assert.equal(draftToInput({...draft,icmsAnticipation:input.icmsAnticipation}),null);
});

test('política DIFAL é estrita, clonada em ordem fixa e omissão permanece ausente nos inputs legados',()=>{
 const expected=defaultDifalPolicy(),input={enabled:{actual:false,presumed:true,hybrid:false,pure:true},version:'DIFAL_SCENARIOS_V1'};
 const parsed=parseDifalPolicy(input);assert.deepEqual(Object.keys(parsed),['version','enabled']);assert.deepEqual(Object.keys(parsed.enabled),['pure','hybrid','presumed','actual']);
 parsed.enabled.pure=false;assert.equal(input.enabled.pure,true);assert.notEqual(defaultDifalPolicy().enabled,expected.enabled);
 for(const value of [null,{}, {...expected,version:'UNKNOWN'}, {...expected,extra:true}, {...expected,enabled:{...expected.enabled,pure:'false'}}, {...expected,enabled:{...expected.enabled,pure:null}}, {...expected,enabled:{pure:true,hybrid:true,actual:true}}, {...expected,enabled:{...expected.enabled,other:true}}]){
  assert.throws(()=>parseDifalPolicy(value),TypeError);
  assert.equal(taxInputSchema.safeParse({...example(),difalPolicy:value}).success,false);
 }
 const draft=createEmptyDraft();for(const key of Object.keys(draft.values))draft.values[key]=EXAMPLE_INPUT[key];draft.rbt12=180000;
 const before=structuredClone(draft);assert.equal(Object.hasOwn(draftToInput(draft),'difalPolicy'),false);assert.deepEqual(draft,before);
 const selected={...draft,difalPolicy:input};assert.deepEqual(draftToInput(selected).difalPolicy,parseDifalPolicy(input));
 assert.equal(draftToInput({...draft,difalPolicy:{...expected,enabled:{...expected.enabled,pure:0}}}),null);
});
test('opção independente dos dois regimes Simples remove DIFAL e antecipação uma única vez sem afetar os demais',()=>{
 const input={...example(),difalMonthly:100,icmsAnticipation:{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200}};
 const baseline=calculateTax(input),ids=['pure','hybrid','presumed','actual'];
 for(const id of ['pure','hybrid']){
  const policy=defaultDifalPolicy();policy.enabled[id]=false;const before=structuredClone({input,policy});
  const result=calculateTax({...input,difalPolicy:policy}),regime=result.regimes.find(row=>row.id===id),old=baseline.regimes.find(row=>row.id===id);
  assert.equal(regime.dre.difal,0);assert.equal(regime.dre.icmsAnticipation,0);assert.equal(regime.difalApplication.reason,'USER_EXCLUDED');
  const removed=1200+(['pure','hybrid'].includes(id)?8784:0);close(regime.dre.preTax,old.dre.preTax+removed);
  if(id!=='actual'){close(regime.dre.netProfit,old.dre.netProfit+removed);close(regime.totalTaxes,old.totalTaxes-removed);}
  for(const other of ids.filter(value=>value!==id))assert.deepEqual(result.regimes.find(row=>row.id===other),baseline.regimes.find(row=>row.id===other));
  assert.equal(result.memory.find(row=>row.id===`difal.option.${id}`).value,'Excluir');
  assert.match(result.memory.find(row=>row.id===`difal.status.${id}`).value,/escolha/);
  assert.deepEqual({input,policy},before);
 }
 const allOff=defaultDifalPolicy();for(const id of ids)allOff.enabled[id]=false;
 for(const row of calculateTax({...input,difalPolicy:allOff}).regimes){assert.equal(row.dre.difal,0);assert.equal(row.dre.icmsAnticipation,0);}
});
test('Lucro Real sempre exclui DIFAL da base positiva, IRPJ e CSLL, com memória e DRE conciliadas',()=>{
 for(const salesRevenue of [1000,50000,200000]){
  const input={...example(),salesRevenue,difalMonthly:2000},policy=defaultDifalPolicy();policy.enabled.actual=false;
  const off=calculateTax({...input,difalPolicy:policy}),without=calculateTax({...input,difalMonthly:0}),actual=off.regimes.find(row=>row.id==='actual'),reference=without.regimes.find(row=>row.id==='actual');
  for(const key of ['preTax','irpj','csll','netProfit','netRevenue'])close(actual.dre[key],reference.dre[key]);
  close(memory(off,'actual.preTax'),actual.dre.preTax);close(memory(off,'actual.base'),Math.max(0,actual.dre.preTax));
  close(memory(off,'actual.irTotal'),-actual.dre.irpj);close(memory(off,'actual.csTotal'),-actual.dre.csll);
  close(actual.dre.netProfit,actual.dre.preTax+actual.dre.irpj+actual.dre.csll);
 }
});
test('bloqueio DIFAL usa RBT12 no limite inclusive e ICMS fora do DAS somente nos regimes Simples',()=>{
 for(const rbt12 of [3599999.99,3600000,3600000.01])for(const icmsOutside of [false,true]){
  const result=calculateTax({...example(),rbt12,icmsOutside,difalMonthly:100,icmsAnticipation:{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200}});
  for(const regime of result.regimes){
   const simple=['pure','hybrid'].includes(regime.id),blocked=simple&&(rbt12>=3600000||icmsOutside);
   assert.equal(regime.difalApplication.blocked,blocked);
   close(regime.dre.difal,simple&&!blocked?-1200:0);close(regime.dre.icmsAnticipation,simple&&!blocked?-8784:0);
   if(blocked)assert.match(regime.difalApplication.message,/Zerado automaticamente/);
  }
 }
 const policy=defaultDifalPolicy();policy.enabled.pure=false;
 assert.equal(resolveDifalApplication({policy,regimeId:'pure',rbt12:3600000}).reason,'SUBLIMIT');
 assert.equal(resolveDifalApplication({regimeId:'actual',rbt12:5000000,icmsOutside:true}).salesDifal,false);
 assert.equal(resolveDifalApplication({regimeId:'actual',rbt12:5000000}).purchaseAnticipation,false);
 const noSource=calculateTax({...example(),difalPolicy:policy});assert(!Object.hasOwn(noSource.regimes[0].dre,'difal'));
});

test('V2 valida direções independentes e exclui LP/LR; migração de V1 preserva sua evidência original',()=>{
 const current=defaultDifalPolicy();
 assert.deepEqual(current,{version:'DIFAL_SCENARIOS_V2',enabled:{pure:true,hybrid:true,presumed:false,actual:false},operations:{pure:{entry:true,exit:true},hybrid:{entry:true,exit:true}}});
 const copy=parseDifalPolicy(current);copy.operations.pure.entry=false;assert.equal(current.operations.pure.entry,true);
 assert.notEqual(defaultDifalPolicy().operations.hybrid,current.operations.hybrid);
 const {operations,...missing}=current;
 for(const value of [missing,{...current,operations:null},{...current,operations:{}},
  {...current,enabled:{...current.enabled,presumed:true}},{...current,enabled:{...current.enabled,actual:true}},
  {...current,operations:{...operations,presumed:{entry:false,exit:false}}},
  {...current,operations:{...operations,pure:{entry:true}}},
  {...current,operations:{...operations,pure:{entry:true,exit:'false'}}},
  {...current,operations:{...operations,pure:{entry:true,exit:false,extra:true}}},
  {...current,operations:{...operations,hybrid:{entry:0,exit:false}}}]){
  assert.throws(()=>parseDifalPolicy(value),TypeError);
  assert.equal(taxInputSchema.safeParse({...example(),difalPolicy:value}).success,false);
 }
 const legacy={version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:true}},before=structuredClone(legacy);
 assert.deepEqual(parseDifalPolicy(legacy),before);
 const upgraded=upgradeDifalPolicy(legacy);assert.deepEqual(upgraded,{...current,enabled:{...current.enabled,pure:false}});
 const calculated=calculateTax({...example(),difalMonthly:100,difalPolicy:legacy});
 assert.deepEqual(calculated.difalPolicy,upgraded);assert.deepEqual(legacy,before);
 for(const id of ['presumed','actual']){
  const regime=calculated.regimes.find(row=>row.id===id);assert.equal(regime.dre.difal,0);
  assert.equal(regime.difalApplication.reason,'NOT_APPLICABLE');assert.equal(regime.difalApplication.enabled,false);
  assert.equal(calculated.memory.find(row=>row.id===`difal.option.${id}`).value,'Não aplicável');
 }
 assert.throws(()=>parseDifalPolicy({...legacy,operations}),TypeError,'Versão histórica não aceita campos com significado novo.');
});

test('matriz de cenários, entrada/saída e sublimite aplica cada dedução uma vez e mantém LP/LR intactos',()=>{
 const ids=['pure','hybrid','presumed','actual'];
 for(const enabledMask of [0,1,2,3])for(let operationMask=0;operationMask<16;operationMask++)
 for(const rbt12 of [3599999.99,3600000,3600000.01])for(const icmsOutside of [false,true]){
  const policy=defaultDifalPolicy();
  for(const [index,id]of ['pure','hybrid'].entries()){
   policy.enabled[id]=!!(enabledMask&(1<<index));
   policy.operations[id]={entry:!!(operationMask&(1<<(index*2))),exit:!!(operationMask&(1<<(index*2+1)))};
  }
  const before=structuredClone(policy),input={...example(),rbt12,icmsOutside},baseline=calculateTax(input);
  const result=calculateTax({...input,difalPolicy:policy,difalMonthly:100,icmsAnticipation:{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200}});
  for(const [index,id]of ids.entries()){
   const regime=result.regimes[index],reference=baseline.regimes[index],simple=index<2;
   const allowed=simple&&policy.enabled[id]&&rbt12<3600000&&!icmsOutside;
   const outgoing=allowed&&policy.operations[id].exit?1200:0,incoming=allowed&&policy.operations[id].entry?8784:0;
   const charge=reference.available?outgoing+incoming:0;
   close(regime.dre.difal,reference.available?-outgoing:0);close(regime.dre.icmsAnticipation,reference.available?-incoming:0);
   close(regime.dre.netRevenue,reference.dre.netRevenue-charge);close(regime.dre.preTax,reference.dre.preTax-charge);
   close(regime.annualProfit,reference.annualProfit-charge);close(regime.totalTaxes,reference.totalTaxes+charge);
   close(regime.dre.irpj,reference.dre.irpj);close(regime.dre.csll,reference.dre.csll);
   assert.equal(regime.difalApplication.salesDifal,!!outgoing);assert.equal(regime.difalApplication.purchaseAnticipation,!!incoming);
   if(!simple)assert.equal(regime.difalApplication.reason,'NOT_APPLICABLE');
   else if(rbt12<3600000&&!icmsOutside&&policy.enabled[id]&&!policy.operations[id].entry&&!policy.operations[id].exit)assert.equal(regime.difalApplication.reason,'NO_OPERATIONS');
  }
  assert.deepEqual(result.difalPolicy,policy);assert.deepEqual(policy,before);
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
