import test from 'node:test';
import assert from 'node:assert/strict';
import {irpjQuarterlyFixture} from './fixtures/irpj-quarterly.mjs';
import {calculateSimulation,calculateTax,EXAMPLE_INPUT} from '../public/simulator-engine.js';
import {assessQuarterlyIncomeTaxes} from '../public/simulator-income-tax.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {reconcileIrpj} from '../public/irpj-reconciliation.js';
import {QUARTERLY_IRPJ_RECONCILIATION_KEYS,usesQuarterlyIncomeTax} from '../public/irpj-quarter-reconciliation.js';
import {buildDrePresentation,capturedDreRows,unifiedDreRows} from '../public/simulator-dre.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';
import {renderAnnualDre,renderCompleteMonthlyDre,renderDreCompleteDetails,renderDrePrintDocument} from '../public/simulator-dre-view.js';

const record=(result,id)=>result.regimes.find(row=>row.id===id);
const row=(presentation,key)=>capturedDreRows(presentation).find(row=>row.key===key);
const frame=(result,sourceMonth,id)=>result.monthlyResults.find(entry=>entry.sourceMonth===sourceMonth).result.incomeTaxAssessment.regimes[id];
const presentation=saved=>buildDrePresentation({...saved,calendar:saved.monthlyDre});
const month=(number,salesRevenue=0,serviceRevenue=0,preTax=0)=>({sourceMonth:`2025-${String(number).padStart(2,'0')}`,month:number,salesRevenue,serviceRevenue,preTax});

// This minimal saved-result adapter isolates the proof of full-year metadata from
// the product's Jan–Sep import window. It never supplies defaults to the validator.
function capturedAssessment(inputs){
  const calculated=assessQuarterlyIncomeTaxes({year:2027,months:inputs});
  const regimes=container=>['presumed','actual'].map(id=>({id,available:true,dre:{irpj:container.regimes[id].movement===null?null:-container.regimes[id].movement.irpjTotalCents/100,
    csll:container.regimes[id].movement===null?null:-container.regimes[id].movement.csllCents/100}}));
  return {version:'1.20.0-quarterly-income-tax',incomeTaxAssessment:calculated.incomeTaxAssessment,regimes:regimes(calculated.incomeTaxAssessment),
    monthlyResults:inputs.map(input=>({sourceMonth:input.sourceMonth,month:input.month,result:{incomeTaxAssessment:calculated.monthlyAssessments[input.sourceMonth],
      regimes:regimes(calculated.monthlyAssessments[input.sourceMonth]).map(regime=>({...regime,dre:{...regime.dre,sales:input.salesRevenue,services:input.serviceRevenue,preTax:input.preTax}}))}}))};
}

test('quarterly normal, additional and movement reconcile without summing monthly accumulations',()=>{
  const saved=irpjQuarterlyFixture(),before=structuredClone(saved),p=presentation(saved),checked=reconcileIrpj(saved.result,'presumed');
  assert.equal(p.irpjReconciliation.version,'IRPJ_RECONCILIATION_V2');
  assert.deepEqual(p.irpjReconciliation.rows.map(item=>item.key),QUARTERLY_IRPJ_RECONCILIATION_KEYS);
  assert.equal(checked.status,'CONFIRMED');assert.equal(checked.closure.available,true);
  assert.deepEqual(Object.values(checked.values),[64000,60000,60000,4000,9600,400,10000,0,10000]);
  assert.deepEqual(row(p,'irpjTotalAssessed').monthlyValues.presumed,[4800,8400,10000]);
  assert.deepEqual(row(p,'irpjCurrentMovement').monthlyValues.presumed,[4800,3600,1600]);
  assert.deepEqual(row(p,'irpjBasic').monthlyValues.presumed,[-4800,-3600,-1200]);
  assert.deepEqual(row(p,'irpjAdditional').monthlyValues.presumed,[0,0,-400]);
  assert.deepEqual(row(p,'irpj').monthlyValues.presumed,[-4800,-3600,-1600]);
  assert.match(p.irpjReconciliation.note,/Não some os acumulados mensais/);
  const keys=unifiedDreRows(p).map(item=>item.key);
  assert(keys.includes('irpj'),'O IRPJ está distribuído no resultado da DRE e no quadro de impostos.');
  const taxes=p.taxStatement.rows.filter(item=>item.key==='irpj');assert.equal(taxes.length,1);
  assert.deepEqual(taxes[0].monthlyValues.presumed,[4800,3600,1600]);assert.equal(taxes[0].values.presumed,10000);
  for(const key of ['irpjBasic','irpjAdditional',...QUARTERLY_IRPJ_RECONCILIATION_KEYS])assert.equal(keys.filter(value=>value===key).length,1);
  assert.equal(keys.filter(value=>value==='taxesDeduction').length,1);
  assert.deepEqual(saved,before);
});

test('Real loss month reverses normal and additional provision without becoming a tax refund',()=>{
  const saved=irpjQuarterlyFixture(),p=presentation(saved);
  assert.deepEqual(saved.result.monthlyResults.map(entry=>record(entry.result,'actual').dre.preTax),[100000,-80000,0]);
  const feb=reconcileIrpj(saved.result,'actual',{sourceMonth:'2025-02'});
  assert.equal(feb.status,'PROVISIONAL');assert.equal(feb.closure.available,false);
  assert.deepEqual(feb.componentMovements,{normal:-12000,additional:-4000,total:-16000});
  assert.deepEqual([feb.values.irpjTaxBase,feb.values.irpjTotalAssessed,feb.values.irpjPreviousProvision,feb.values.irpjCurrentMovement],[20000,3000,19000,-16000]);
  assert.deepEqual(row(p,'irpj').monthlyValues.actual,[-19000,16000,0]);
  assert.deepEqual(row(p,'irpjTotalAssessed').monthlyValues.actual,[19000,3000,3000]);
  assert.equal(row(p,'irpjAdditional').monthlyValues.actual[1],4000);
  assert.equal(reconcileIrpj(saved.result,'actual').values.irpjTotalAssessed,3000);
  assert.equal(row(p,'totalTaxes').values.actual,record(saved.result,'actual').totalTaxes);
});

test('Lucro Real com base trimestral negativa ou nula não calcula IRPJ e CSLL novos',()=>{
  for(const preTax of [-85000,0]){
    const inputs=[month(1,150000,0,preTax),month(2,0,0,0),month(3,0,0,0)];
    const result=capturedAssessment(inputs),checked=reconcileIrpj(result,'actual'),quarter=result.incomeTaxAssessment.regimes.actual.periods[0];
    assert.equal(checked.available,true);assert.equal(checked.values.irpjTaxBase,0);
    assert.equal(checked.values.irpjNormalAssessed,0);assert.equal(checked.values.irpjAdditionalAssessed,0);
    assert.equal(checked.values.irpjTotalAssessed,0);
    assert.equal(quarter.provision.irpjTotalCents,0);assert.equal(quarter.provision.csllCents,0);
    for(const entry of result.monthlyResults){
      const taxes=record(entry.result,'actual').dre;
      assert.equal(taxes.irpj,0);assert.equal(taxes.csll,0);
    }
    assert.match(quarter.reason,/Sem base tributável positiva/);
  }
});

test('partial quarter uses the full quarterly limit and missing months stay missing',()=>{
  const saved=irpjQuarterlyFixture({sales:[1000000,100000],rents:[],months:[1,3]}),p=presentation(saved);
  const checked=reconcileIrpj(saved.result,'presumed');
  assert.equal(checked.available,true);assert.equal(checked.status,'PROVISIONAL');assert.equal(checked.closure.taxes,null);
  assert.equal(checked.values.irpjAdditionalLimit,60000);assert.equal(checked.values.irpjAdditionalAssessed,2800);
  assert.deepEqual(p.months.map(value=>value.sourceMonth),['2025-01','2025-03']);
  assert.equal(row(p,'irpjTaxBase').monthlyValues.presumed.length,2);
  const jan=reconcileIrpj(saved.result,'presumed',{sourceMonth:'2025-01'});
  assert.equal(jan.values.irpjAdditionalLimit,60000);assert.equal(jan.values.irpjAdditionalAssessed,2000);
  assert.equal(reconcileIrpj(saved.result,'presumed',{sourceMonth:'2025-02'}).available,false);
  assert.match(p.irpjReconciliation.frames.presumed.period.reason,/fechamento incompleto/);
});

test('a complete fourth quarter can retain a valid provision while annual closure is unavailable',()=>{
  const result=capturedAssessment([month(10,100000),month(11,100000),month(12,100000)]);
  const checked=reconcileIrpj(result,'presumed',{sourceMonth:'2025-12'});
  assert.equal(checked.available,true);assert.equal(checked.complete,true);assert.equal(checked.status,'PROVISIONAL');
  assert.equal(checked.closure.available,false);assert.match(checked.reason,/anual incompleto/);
  assert.equal(checked.values.irpjCurrentMovement,1200);
});

test('unknown LC224 carry is unavailable; the known Real provision remains independently valid',()=>{
  const result=capturedAssessment([month(4,1400000,0,10000)]);
  const presumed=reconcileIrpj(result,'presumed',{sourceMonth:'2025-04'}),actual=reconcileIrpj(result,'actual');
  assert.equal(presumed.available,false);assert.match(presumed.reason,/Histórico dos trimestres anteriores incompleto/);
  assert(Object.values(presumed.values).every(value=>value===null));
  assert.equal(actual.available,true);assert.equal(actual.status,'PROVISIONAL');assert.equal(actual.values.irpjNormalAssessed,1500);
});

test('December explains the captured annual LC224 reversal with the nine-row bridge',()=>{
  const inputs=Array.from({length:12},(_,index)=>month(index+1,index===0?2000000:0));
  const result=capturedAssessment(inputs),dec=reconcileIrpj(result,'presumed',{sourceMonth:'2025-12'}),annual=reconcileIrpj(result,'presumed');
  assert.equal(dec.available,true);assert.equal(dec.scope,'ANNUAL_ADJUSTMENT');assert.equal(dec.closure.available,true);
  assert.equal(dec.values.irpjPreviousProvision,35500);assert.equal(dec.values.irpjTotalAssessed,34000);assert.equal(dec.values.irpjCurrentMovement,-1500);
  assert.deepEqual(dec.componentMovements,{normal:-900,additional:-600,total:-1500});
  assert.equal(annual.values.irpjTotalAssessed,34000);assert.equal(annual.values.irpjPreviousProvision,0);assert.equal(annual.values.irpjCurrentMovement,34000);
});

test('ambiguous annual rate reduction keeps the saved reason and never invents a numeric adjustment',()=>{
  const result=capturedAssessment(Array.from({length:12},(_,index)=>month(index+1,index===0?2000000:index===3?2000000:index===6?1500000:0)));
  const dec=reconcileIrpj(result,'presumed',{sourceMonth:'2025-12'});
  assert.equal(dec.available,false);assert.match(dec.reason,/rateio da redução precisa de validação fiscal/);
  assert.equal(dec.componentMovements,null);assert(Object.values(dec.values).every(value=>value===null));
});

test('uniform projection reads each quarterly movement instead of dividing annual tax by twelve',()=>{
  const seed=irpjQuarterlyFixture(),draft={...seed.draft,values:{...seed.draft.values,serviceRevenue:87500,rent:45150}};
  const result=calculateSimulation(draft),calendar=buildMonthlyDre(result,2027),p=buildDrePresentation({result,draft,calendar});
  assert.equal(reconcileIrpj(result,'presumed').values.irpjTotalAssessed,60000);
  assert.equal(reconcileIrpj(result,'presumed',{sourceMonth:'2027-02'}).values.irpjCurrentMovement,4200);
  assert.equal(reconcileIrpj(result,'presumed',{sourceMonth:'2027-03'}).values.irpjCurrentMovement,6600);
  assert.deepEqual(row(p,'irpj').monthlyValues.presumed.slice(0,3),[-4200,-4200,-6600]);
  assert.deepEqual(row(p,'irpjTotalAssessed').monthlyValues.presumed.slice(0,3),[4200,8400,15000]);
  assert.notEqual(row(p,'irpj').monthlyValues.presumed[1],row(p,'irpj').values.presumed/12);
});

test('captured custom presumption coefficients are proved without using presentation defaults',()=>{
  const input=structuredClone(EXAMPLE_INPUT);input.rates.irSales=.12;input.rates.irServices=.2;
  const result=calculateTax(input),checked=reconcileIrpj(result,'presumed');
  assert.equal(checked.available,true);
  const broken=structuredClone(result);broken.incomeTaxAssessment.presumptionRates.irSales=.08;
  assert.equal(reconcileIrpj(broken,'presumed').available,false);
});

test('exact bases survive large-operand cancellation while tax cents stay exact',()=>{
  const input=structuredClone(EXAMPLE_INPUT);
  for(const key of ['serviceRevenue','simplePurchases','simpleRegularPurchases','salaries','benefits','adminExpenses','rent','cardExpenses','extraPayroll'])input[key]=0;
  for(const group of Object.values(input.credits))group.base=0;
  for(const key of ['cbs','ibs','icms','iss','payroll'])input.rates[key]=0;
  input.salesRevenue=10000000000.7;input.regularPurchases=10000000000.4;
  const result=calculateTax(input),checked=reconcileIrpj(result,'actual');
  assert.equal(checked.available,true);assert.equal(checked.values.irpjNormalAssessed,.56);
});

test('missing new capture, altered amounts and broken monthly bridges never fall back to V1',()=>{
  const saved=irpjQuarterlyFixture();
  const corruptions=[
    result=>{delete result.incomeTaxAssessment;for(const entry of result.monthlyResults)delete entry.result.incomeTaxAssessment;},
    result=>{frame(result,'2025-02','actual').previousProvision.irpjNormalCents+=1;},
    result=>{frame(result,'2025-03','presumed').periods[0].exactBases.irpjBase.numerator='1';},
    result=>{frame(result,'2025-03','actual').periods[0].inputs[1].preTaxExact={numerator:'80000',denominator:'1'};},
    result=>{result.monthlyResults[1].sourceMonth='2025-01';},
    result=>{result.monthlyResults[0].result.incomeTaxAssessment.presumptionRates.irSales=.07;},
    result=>{delete frame(result,'2025-03','presumed').periods[0].sourceQuarter;},
    result=>{result.monthlyResults[1].result.regimes=result.monthlyResults[1].result.regimes.filter(item=>item.id!=='presumed');},
    result=>{result.monthlyResults[1].result.regimes.push(structuredClone(record(result.monthlyResults[1].result,'presumed')));}
  ];
  for(const [index,mutate] of corruptions.entries()){
    const result=structuredClone(saved.result);mutate(result);const before=structuredClone(result);
    assert.equal(usesQuarterlyIncomeTax(result),true);
    assert.equal(reconcileIrpj(result,index===1||index===3?'actual':'presumed').available,false,`corruption ${index}`);
    assert.deepEqual(result,before);
  }
});

test('coherent but unsupported presumed bases cannot certify an invented tax',()=>{
  const result=capturedAssessment([month(1,1000000)]);
  for(const container of [result.incomeTaxAssessment,result.monthlyResults[0].result.incomeTaxAssessment]){
    const assessment=container.regimes.presumed,period=assessment.periods[0];
    for(const bases of [assessment.bases,period.bases])Object.assign(bases,{irpjBase:90000,irpjBaseWithoutIncrease:90000,irpjExcessBase:30000});
    period.exactBases.irpjBase={numerator:'90000',denominator:'1'};period.exactBases.irpjExcessBase={numerator:'30000',denominator:'1'};
    for(const amounts of [assessment.provision,assessment.movement,period.provision])Object.assign(amounts,{irpjNormalCents:1350000,irpjAdditionalCents:300000,irpjTotalCents:1650000});
  }
  record(result,'presumed').dre.irpj=-16500;record(result.monthlyResults[0].result,'presumed').dre.irpj=-16500;
  assert.equal(reconcileIrpj(result,'presumed').available,false);
});

test('a March period cannot silently drop a captured February or replace the final quarter with an earlier accumulation',()=>{
  const saved=irpjQuarterlyFixture(),result=structuredClone(saved.result),march=frame(result,'2025-03','presumed'),period=march.periods[0];
  period.observedMonths=[1,3];period.sourceMonths=['2025-01','2025-03'];period.inputs.splice(1,1);period.missingMonths=[2];
  for(const item of [period,march]){item.complete=false;item.status='PROVISIONAL';item.closure={available:false,status:'UNAVAILABLE',reason:'Fevereiro ausente',taxes:null};}
  assert.equal(reconcileIrpj(result,'presumed',{sourceMonth:'2025-03'}).available,false);
  const earlier=structuredClone(saved.result);earlier.incomeTaxAssessment.regimes.presumed.periods=[structuredClone(frame(earlier,'2025-02','presumed').periods[0])];
  assert.equal(reconcileIrpj(earlier,'presumed').available,false);
});

test('CSV, display and print label provision and movement, preserving signs, selection and the total exactly once',()=>{
  const saved=irpjQuarterlyFixture(),p=presentation(saved),before=structuredClone(p);
  const csv=buildDreCsv({presentation:p,period:'complete',visibleRegimeIds:['actual']});
  assert.equal(csv.split('\r\n').filter(line=>line.startsWith('"Memória informativa do IRPJ";')).length,9);
  assert(csv.includes('"Movimento de IRPJ no mês";"detail";"BRL";19000,00;-16000,00;0,00;3000,00;'));
  assert(!csv.includes("'-16000,00"));assert(csv.includes('"Provisão mensal do IRPJ";"Lucro Real";"2025-02";'));
  const options={presentation:p,calendar:saved.monthlyDre,year:2027,visibleRegimeIds:['actual'],showPercent:true};
  for(const html of [renderAnnualDre(options),renderCompleteMonthlyDre({...options,month:1}),renderDrePrintDocument({...options,period:'annual'})]){
    assert.equal((html.match(/data-irpj-reconciliation="dre"/g)||[]).length,1);
    assert.match(html,/data-irpj-version="IRPJ_RECONCILIATION_V2"/);
    for(const key of QUARTERLY_IRPJ_RECONCILIATION_KEYS)assert.equal((html.match(new RegExp(`data-dre-row="${key}"`,'g'))||[]).length,1,key);
    const panel=html.slice(html.indexOf('data-irpj-reconciliation="dre"'));
    assert(!panel.slice(0,panel.indexOf('</section>')).includes('class="dre-percent"'));
    assert.match(html,/provisão anterior/i);assert.match(html,/não é restituição automática/);
  }
  const screen=renderCompleteMonthlyDre({...options,month:1});
  assert.equal(screen,renderAnnualDre(options));assert.doesNotMatch(screen,/id="dre-display-period"/);
  const monthly=renderDreCompleteDetails({...options,monthly:true,month:1});
  assert.match(monthly,/data-irpj-provisional/);assert.match(monthly,/Movimento de IRPJ no mês/);assert.match(monthly,/-R\$ 16\.000,00/);
  const monthlyIrpj=monthly.match(/data-tax-row="irpj"[^>]*>([\s\S]*?)<\/tr>/)?.[1];
  assert.match(monthlyIrpj,/-R\$ 16\.000,00/,'O quadro de impostos mantém o estorno negativo no relatório mensal.');
  assert.deepEqual(p,before);
});
