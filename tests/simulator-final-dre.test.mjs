import test from 'node:test';
import assert from 'node:assert/strict';
import {drePdfFixture} from './fixtures/dre-pdf.mjs';
import {calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation} from '../public/simulator-dre.js';
import {renderAnnualDre,renderDrePrintDocument} from '../public/simulator-dre-view.js';
import {reconcileIrpj} from '../public/irpj-reconciliation.js';
import {parseAccountingData,accountingForYear} from '../src/analysis-contract.ts';

const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function scenario(income=0,expense=0){
  const saved=drePdfFixture();
  for(const month of saved.monthlyInputs)Object.assign(month.values,{financialIncome:income,financialExpenses:expense});
  Object.assign(saved,calculateMonthlySimulation(saved.draft,saved.source.monthlyReports,saved.monthlyInputs,saved.source.sales.jobId,null,saved.analysisPeriod));
  saved.monthlyDre=buildMonthlyDre(saved.result,saved.year,saved.rbt12Manual);
  return saved;
}
test('financial entries persist after EBITDA and affect Real and Presumed bases exactly once',()=>{
  const original=scenario(),saved=scenario(1500,600),before=structuredClone(saved);
  for(const regime of saved.result.regimes){
    const old=original.result.regimes.find(row=>row.id===regime.id),d=regime.dre;
    near(d.ebitda,old.dre.ebitda);near(d.financialResult,8100);near(d.preTax,old.dre.preTax+8100);
    near(d.netProfit,d.preTax+d.irpj+d.csll);
    if(regime.id==='presumed'){
      const bases=saved.result.incomeTaxAssessment.regimes.presumed.bases,oldBases=original.result.incomeTaxAssessment.regimes.presumed.bases;
      near(bases.irpjBase,oldBases.irpjBase+13500);near(bases.csllBase,oldBases.csllBase+13500);
    }
  }
  for(const id of ['presumed','actual'])assert.equal(reconcileIrpj(saved.result,id).available,true,id);
  const expensesOnly=scenario(0,600);
  near(expensesOnly.result.regimes.find(row=>row.id==='presumed').dre.irpj,original.result.regimes.find(row=>row.id==='presumed').dre.irpj);
  assert.deepEqual(saved,before);
});
test('final statement reconciles gross debits, used credits, EBITDA and final taxes in every regime and month',()=>{
  const saved=scenario(1500,600),p=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  const rows=p.statement.sections.flatMap(section=>section.rows),keys=rows.map(row=>row.key);
  assert.deepEqual(keys,['revenue','services','sales','revenueTaxes','das','icmsDebit','cbsIbsDebit','iss','difal','netRevenueAfterTaxes',
    'costsWithAnticipation','cmvSimple','cmvRegular','icmsAnticipation','cbsIbsCredit','icmsCredit','grossAfterCosts',
    'operatingExpensesWithPayroll','salaries','benefits','payroll','rent','cards','administrative','ebitda','financialResult',
    'resultBeforeIncomeTaxes','irpj','csll','netProfit']);
  for(const regime of p.regimes)for(const month of [null,...p.months.map((_,i)=>i)]){
    const get=key=>{const row=rows.find(row=>row.key===key);return month===null?row.values[regime.id]:row.monthlyValues[regime.id][month];};
    near(get('revenue'),get('services')+get('sales'));
    near(get('revenueTaxes'),['das','icmsDebit','cbsIbsDebit','iss','difal'].reduce((sum,key)=>sum+get(key),0));
    near(get('netRevenueAfterTaxes'),get('revenue')+get('revenueTaxes'));
    near(get('costsWithAnticipation'),['cmvSimple','cmvRegular','icmsAnticipation','cbsIbsCredit','icmsCredit'].reduce((sum,key)=>sum+get(key),0));
    near(get('grossAfterCosts'),get('netRevenueAfterTaxes')+get('costsWithAnticipation'));
    near(get('ebitda'),get('grossAfterCosts')+get('operatingExpensesWithPayroll'));
    near(get('resultBeforeIncomeTaxes'),get('ebitda')+get('financialResult'));
    near(get('netProfit'),get('resultBeforeIncomeTaxes')+get('irpj')+get('csll'));
    for(const [key,numerator] of [['contributionMargin','grossAfterCosts'],['ebitdaMargin','ebitda']]){
      const row=p.taxStatement.rows.find(row=>row.key===key),value=month===null?row.values[regime.id]:row.monthlyValues[regime.id][month];
      near(value,get(numerator)/get('revenue'));
    }
  }
});
test('screen order is taxes with regime controls, summary, DRE; print stays on two consolidated pages',()=>{
  const saved=scenario(),p=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  const options={presentation:p,calendar:saved.monthlyDre,year:saved.year,company:saved.company,visibleRegimeIds:['pure','actual']};
  const html=renderAnnualDre(options);
  assert(html.indexOf('id="tax-demonstrativo"')<html.indexOf('id="dre-summary"'));
  assert(html.indexOf('id="dre-summary"')<html.indexOf('id="dre-demonstrativo"'));
  assert(html.indexOf('data-dre-visible-regime=')>html.indexOf('id="tax-demonstrativo"'));
  assert(html.indexOf('data-dre-visible-regime=')<html.indexOf('id="dre-summary"'));
  for(const key of ['revenue','revenueTaxes','costsWithAnticipation','operatingExpensesWithPayroll','resultBeforeIncomeTaxes'])assert.match(html,new RegExp(`data-summary-toggle="${key}"`));
  for(const key of ['services','sales'])assert.match(html,new RegExp(`id="summary-child-revenue-${key}" data-summary-child="revenue" class=`));
  assert.match(html,/id="summary-child-revenueTaxes-das" data-summary-child="revenueTaxes" hidden/);
  assert.match(html,/dre-indicator-spacer/);assert.match(html,/Baixar PDF · 2 páginas/);
  for(const period of ['complete','annual','monthly']){
    const printed=renderDrePrintDocument({...options,period});
    assert.equal((printed.match(/class="dre-final-page"/g)||[]).length,2);
    assert(!printed.includes('Lucro Presumido'));assert(!printed.includes('dre-report-monthly-part'));
    assert(!printed.includes('taxesDeduction'));assert.match(printed,/Simulador Reforma Tributária/);
    assert(printed.indexOf('Impostos e indicadores')<printed.indexOf('Resumo dos resultados'));
    assert.match(printed,/Receitas de serviços/);assert.match(printed,/Receita de vendas/);
  }
});
test('accounting preserves historical fields while accepting explicit financial accounts and rejecting invalid values',()=>{
  const legacy={months:[{sourceMonth:'2025-01',salariesCents:10000,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}]};
  const before=structuredClone(legacy),normalized=accountingForYear(legacy);
  assert.equal(normalized.months[0].financialIncomeCents,0);assert.deepEqual(legacy,before);
  const next=structuredClone(normalized);Object.assign(next.months[0],{financialIncomeCents:150000,financialExpensesCents:60000});
  assert.deepEqual(parseAccountingData(next,true),next);
  for(const bad of [-1,NaN,Infinity,'100',1.25,null]){
    const invalid=structuredClone(next);invalid.months[0].financialIncomeCents=bad;
    assert.throws(()=>parseAccountingData(invalid,true));
  }
});

test('financial income reduces net accounting expenses and never changes operating EBITDA totals',async()=>{
  const {accountingSummary}=await import('../public/analyses-guidance.js');
  const {accountingAveragePreview}=await import('../public/analysis-accounting-average.js');
  const {parseAccountingPaste}=await import('../public/analysis-accounting-import.js');
  const values={salariesCents:10000,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0,financialIncomeCents:15000,financialExpensesCents:6000};
  near(accountingSummary([{sourceMonth:'2025-01',...values}]).totalCents,1000);
  near(accountingAveragePreview(values,2025).totalCents,9000);
  const paste=parseAccountingPaste('01/2025;100;0;0;0;0;60;150');
  assert.deepEqual(paste.months,[{sourceMonth:'2025-01',...values}]);near(paste.totalCents,1000);
  const saved=scenario(0,200000),real=saved.result.regimes.find(row=>row.id==='actual');
  assert(real.dre.ebitda>0);assert(real.dre.preTax<0);assert.equal(real.dre.irpj,0);assert.equal(real.dre.csll,0);
});

test('monthly snapshot retains financial inputs for reopening and recomputation',()=>{
  const saved=scenario(1500,600);
  assert(saved.monthlyInputs.every(row=>row.values.financialIncome===1500&&row.values.financialExpenses===600));
  const again=calculateMonthlySimulation(saved.draft,saved.source.monthlyReports,saved.monthlyInputs,saved.source.sales.jobId,null,saved.analysisPeriod);
  for(const regime of saved.result.regimes){
    const repeat=again.result.regimes.find(item=>item.id===regime.id);
    near(repeat.dre.preTax,regime.dre.preTax);near(repeat.dre.netProfit,regime.dre.netProfit);
  }
});
