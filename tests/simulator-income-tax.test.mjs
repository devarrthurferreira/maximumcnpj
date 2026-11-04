import test from 'node:test';
import assert from 'node:assert/strict';
import {assessQuarterlyIncomeTaxes,incomeTaxRoundCents,incomeTaxPreTaxExact} from '../public/simulator-income-tax.js';
import {calculateTax,EXAMPLE_INPUT} from '../public/simulator-engine.js';
const month=(number,salesRevenue=0,serviceRevenue=0,preTax=0)=>({sourceMonth:`2025-${String(number).padStart(2,'0')}`,month:number,salesRevenue,serviceRevenue,preTax});
const assess=months=>assessQuarterlyIncomeTaxes({year:2027,months});
const taxes=(out,id='presumed')=>out.incomeTaxAssessment.regimes[id];
const sumMovements=(out,id,key)=>Object.values(out.monthlyAssessments).reduce((sum,entry)=>sum+entry.regimes[id].movement[key],0);

test('half-up is exact for decimal ties and rational bases, without rounding the base first',()=>{
  assert.equal(incomeTaxRoundCents('1.005'),101);assert.equal(incomeTaxRoundCents('-1.005'),-101);
  assert.equal(incomeTaxRoundCents({numerator:'1',denominator:'200'}),1);
  const out=assess([month(1,.42)]),a=taxes(out);
  assert.equal(a.bases.irpjBase,.0336);assert.equal(a.provision.irpjNormalCents,1);
  assert.equal(a.periods[0].exactBases.irpjBase.numerator,'21');assert.equal(a.periods[0].exactBases.irpjBase.denominator,'625');
});

test('a complete quarter rounds each component and monthly movements telescope exactly',()=>{
  const out=assess([month(1,400000),month(2,300000),month(3,100000)]),a=taxes(out);
  assert.equal(a.status,'CONFIRMED');assert.equal(a.closure.available,true);
  assert.deepEqual(a.provision,{irpjNormalCents:960000,irpjAdditionalCents:40000,irpjTotalCents:1000000,csllCents:864000});
  assert.deepEqual(Object.values(out.monthlyAssessments).map(entry=>entry.regimes.presumed.movement.irpjTotalCents),[480000,360000,160000]);
  for(const key of Object.keys(a.provision))assert.equal(sumMovements(out,'presumed',key),a.provision[key]);
  assert.equal(a.periods[0].sourceQuarter,'2025-Q1');assert.equal(a.periods[0].periodId,'2027-Q1');
});

test('seasonal monthly revenues use the quarter threshold rather than independent 20k thresholds',()=>{
  const out=assess([month(1,250000),month(2,300000),month(3,240000)]);
  assert.equal(taxes(out).bases.irpjBase,63200);assert.equal(taxes(out).provision.irpjAdditionalCents,32000);
  assert.deepEqual(Object.values(out.monthlyAssessments).map(entry=>entry.regimes.presumed.movement.irpjAdditionalCents),[0,0,32000]);
});

test('returns are signed within the quarter and reverse previously recognised presumed tax',()=>{
  const out=assess([month(1,600000),month(2,-200000),month(3,100000)]);
  assert.equal(taxes(out).bases.irpjBase,40000);assert.equal(taxes(out).provision.irpjNormalCents,600000);
  const feb=out.monthlyAssessments['2025-02'].regimes.presumed;
  assert.equal(feb.movement.irpjNormalCents,-240000);assert.equal(feb.movement.csllCents,-216000);
});

test('Lucro Real sums signed preTax before flooring and preserves normal/additional reversals',()=>{
  const out=assess([month(1,0,0,100000),month(2,0,0,-80000),month(3,0,0,-50000)]);
  const feb=out.monthlyAssessments['2025-02'].regimes.actual;
  assert.equal(feb.bases.preTax,20000);assert.equal(feb.provision.irpjTotalCents,300000);
  assert.deepEqual(feb.movement,{irpjNormalCents:-1200000,irpjAdditionalCents:-400000,irpjTotalCents:-1600000,csllCents:-720000});
  assert.equal(taxes(out,'actual').bases.preTax,-30000);assert.equal(taxes(out,'actual').provision.irpjTotalCents,0);
  assert.equal(sumMovements(out,'actual','irpjTotalCents'),0);
});

test('comparativo Jan–Set negativo zera IRPJ e CSLL no Lucro Real, preservando Presumido',()=>{
  const values=[50000,20000,10000,-180000,-10000,-5000,-5000,-5000,-5000];
  const months=values.map((signed,index)=>month(index+1,100000,0,signed));
  const baseline=assess(months);
  assert(baseline.incomeTaxAssessment.regimes.actual.provision.irpjTotalCents>0);
  const adjusted=assessQuarterlyIncomeTaxes({year:2027,months,annualLossZeroForReal:true});
  assert.equal(adjusted.incomeTaxAssessment.realAnnualLossZero,'JAN_SEP_MANAGERIAL_V1');
  assert.equal(adjusted.incomeTaxAssessment.regimes.actual.bases.preTax,-130000);
  for(const field of ['irpjTotalCents','irpjNormalCents','irpjAdditionalCents','csllCents']){
    assert.equal(adjusted.incomeTaxAssessment.regimes.actual.provision[field],0);
    for(const entry of Object.values(adjusted.monthlyAssessments))assert.equal(entry.regimes.actual.movement[field],0);
    assert.equal(adjusted.incomeTaxAssessment.regimes.presumed.provision[field],
      baseline.incomeTaxAssessment.regimes.presumed.provision[field]);
  }
  const positive=assessQuarterlyIncomeTaxes({year:2027,months:[month(1,100000,0,10000)],annualLossZeroForReal:true});
  assert.equal(positive.incomeTaxAssessment.realAnnualLossZero,undefined);
  assert(positive.incomeTaxAssessment.regimes.actual.provision.irpjTotalCents>0);
});

test('missing quarter months preserve a provision but never a confirmed closing or a smaller limit',()=>{
  const out=assess([month(1,1000000),month(3,100000)]),a=taxes(out);
  assert.equal(a.available,true);assert.equal(a.status,'PROVISIONAL');assert.equal(a.closure.available,false);assert.equal(a.closure.taxes,null);
  assert.deepEqual(a.periods[0].missingMonths,[2]);assert.equal(a.bases.irpjAdditionalLimit,60000);
  assert.equal(out.monthlyAssessments['2025-01'].regimes.presumed.provision.irpjAdditionalCents,200000);
  assert.equal(a.provision.irpjAdditionalCents,280000);
});

test('LC224 carries unused prior capacity using the scenario year and quarter activity composition',()=>{
  const values=[100000,100000,100000,1000000,500000,500000,1000000,1000000,0];
  const out=assess(values.map((value,index)=>month(index+1,value))),periods=taxes(out).periods;
  assert.equal(periods[0].lc224.carryOut,950000);assert.equal(periods[1].lc224.allowance,2200000);
  assert.equal(periods[1].lc224.excessRevenue,0);assert.equal(periods[2].lc224.allowance,1450000);
  assert.equal(periods[2].lc224.excessRevenue,550000);assert.equal(periods[2].bases.irpjIncrease,4400);
  assert.equal(periods[2].lc224.scenarioYear,2027);assert.equal(periods[2].sourceQuarter,'2025-Q3');
});

test('unknown prior history is null and blocks a materially uncertain LC224 increment',()=>{
  const out=assess([month(4,500000),month(5,300000),month(6,700000)]),a=taxes(out);
  assert.equal(a.available,false);assert.equal(a.provision,null);assert.equal(a.movement,null);assert.equal(a.closure.taxes,null);
  assert.equal(a.periods[0].lc224.carryIn,null);assert.equal(a.periods[0].lc224.allowance,null);
  assert.match(a.periods[0].reason,/Histórico.*incompleto/);
  const small=assess([month(4,100000),month(5,100000),month(6,100000)]);
  assert.equal(taxes(small).periods[0].lc224.carryIn,null);assert.equal(taxes(small).provision.irpjTotalCents,360000);
});

test('LC224 weighted activity coefficients use each quarter rather than the annual mix',()=>{
  const out=assess([month(1,500000),month(2,500000),month(3,0,500000)]),q=taxes(out).periods[0];
  assert.equal(q.lc224.excessRevenue,250000);assert.equal(q.bases.irpjBaseWithoutIncrease,240000);
  assert.equal(q.bases.irpjIncrease,4000);assert.equal(q.bases.csllIncrease,14000/3);
  assert.equal(q.provision.irpjNormalCents,3660000);assert.equal(q.provision.irpjAdditionalCents,1840000);
});

test('captured presumption rates preserve explicit coefficients for an independent LP proof',()=>{
  const rates={irSales:.16,irServices:.08,csSales:.14,csServices:.18};
  const out=assessQuarterlyIncomeTaxes({year:2028,rates,months:[month(1,300000),month(2,0,200000),month(3)]});
  assert.deepEqual(out.incomeTaxAssessment.presumptionRates,rates);
  for(const frame of Object.values(out.monthlyAssessments))assert.deepEqual(frame.presumptionRates,rates);
  assert.equal(taxes(out).bases.irpjBase,64000);assert.equal(taxes(out).bases.csllBase,78000);
  assert.deepEqual(taxes(out).provision,{irpjNormalCents:960000,irpjAdditionalCents:40000,irpjTotalCents:1000000,csllCents:702000});
  rates.irSales=.99;assert.equal(out.incomeTaxAssessment.presumptionRates.irSales,.16);
});

test('year end below five million reverses earlier LC224 increases without rewriting earlier movements',()=>{
  const out=assess([700000,700000,600000,...Array(9).fill(100000)].map((value,index)=>month(index+1,value)));
  const march=out.monthlyAssessments['2025-03'].regimes.presumed,dec=out.monthlyAssessments['2025-12'].regimes.presumed;
  assert.equal(march.periods[0].lc224.excessRevenue,750000);assert.equal(dec.scope,'ANNUAL_ADJUSTMENT');
  assert.equal(dec.annualAdjustmentApplied,true);assert(dec.periods.every(period=>period.lc224.excessRevenue===0));
  assert.equal(dec.previousProvision.irpjTotalCents,sumMovements({monthlyAssessments:Object.fromEntries(Object.entries(out.monthlyAssessments).filter(([key])=>key!=='2025-12'))},'presumed','irpjTotalCents'));
  assert.equal(sumMovements(out,'presumed','irpjTotalCents'),taxes(out).provision.irpjTotalCents);
});

test('positive annual excess below earlier excesses stays explicitly pending instead of inventing a reduction ratio',()=>{
  const out=assess([1000000,1000000,1000000,...Array(9).fill(250000)].map((value,index)=>month(index+1,value)));
  const dec=out.monthlyAssessments['2025-12'].regimes.presumed;
  assert.equal(dec.scope,'ANNUAL_ADJUSTMENT');assert.equal(dec.available,false);assert.equal(dec.provision,null);
  assert.match(dec.reason,/rateio da redução precisa de validação/);assert.equal(taxes(out).available,false);
});

test('year end above earlier excesses uses only the residual excess in Q4',()=>{
  const out=assess(Array.from({length:12},(_,i)=>month(i+1,500000)));
  const periods=taxes(out).periods;
  assert.deepEqual(periods.map(period=>period.lc224.excessRevenue),[250000,250000,250000,250000]);
  assert.equal(taxes(out).bases.irpjIncrease,8000);assert.equal(taxes(out).provision.irpjTotalCents,9800000);
});

test('duplicate, inconsistent and multi-year source months are rejected; ordering is immaterial',()=>{
  assert.throws(()=>assess([month(1),month(1)]),/duplicadas/);
  assert.throws(()=>assess([{...month(1),month:2}]),/incoerentes/);
  assert.throws(()=>assess([{...month(1),sourceMonth:'2024-01'},month(2),month(3)]),/mesmo ano de origem/);
  const rows=[month(1,1),month(2,2),month(3,3)];assert.deepEqual(assess(rows),assess([...rows].reverse()));
});

test('missing actual base never becomes zero or a confirmed closed period',()=>{
  const out=assess([{...month(1),preTax:null,actualAvailable:false},month(2),month(3)]),a=taxes(out,'actual');
  assert.equal(a.available,false);assert.equal(a.bases,null);assert.equal(a.provision,null);assert.equal(a.closure.taxes,null);
  assert.equal(taxes(out).available,true);
});

test('the Real base comes from exact monthly operands at half-cent boundaries, without annual/12 drift',()=>{
  const input=structuredClone(EXAMPLE_INPUT);
  for(const key of ['serviceRevenue','salesRevenue','simplePurchases','regularPurchases','simpleRegularPurchases','salaries','benefits','adminExpenses','rent','cardExpenses','extraPayroll'])input[key]=0;
  for(const group of Object.values(input.credits))group.base=0;
  Object.assign(input.rates,{cbs:0,ibs:0,icms:0,iss:0,payroll:0});input.salesRevenue=.7;input.regularPurchases=.4;
  const exact=incomeTaxPreTaxExact(input);assert.deepEqual(exact,{numerator:'3',denominator:'10'});
  const out=calculateTax(input),jan=out.incomeTaxAssessment.monthlyAssessments['2027-01'].regimes.actual;
  assert.equal(jan.provision.irpjNormalCents,5);assert.equal(jan.periods[0].bases.preTax,.3);
  assert.equal(out.incomeTaxAssessment.regimes.actual.provision.irpjNormalCents,56);
  assert.equal(out.incomeTaxAssessment.regimes.actual.periods[0].exactBases.preTax.numerator,'9');
  input.salesRevenue=10000000000.7;input.regularPurchases=10000000000.4;
  const large=calculateTax(input);
  assert.equal(large.incomeTaxAssessment.regimes.actual.provision.irpjNormalCents,56);
  assert.deepEqual(large.incomeTaxAssessment.regimes.actual.periods[0].exactBases.preTax,{numerator:'9',denominator:'10'});
});
