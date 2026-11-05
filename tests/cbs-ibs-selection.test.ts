import test from 'node:test';
import assert from 'node:assert/strict';
import {drePdfFixture} from './fixtures/dre-pdf.mjs';
import {calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildDrePresentation} from '../public/simulator-dre.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {draftToInput} from '../public/simulator-engine.js';
import {defaultFiscalData,parseFiscalData} from '../src/analysis-contract.ts';
import {validateSimulationRequest} from '../src/simulation-history.ts';

const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const selection={version:'REGIME_SELECTION_V1' as const,selected:['presumed' as const,'actual' as const]};

test('a escolha Fiscal aceita as quatro reduções e preserva análises antigas',()=>{
  const fiscal=defaultFiscalData(selection);assert.equal(fiscal.cbsIbsPercent,100);
  const legacy={...fiscal};delete legacy.cbsIbsPercent;
  assert.equal(Object.hasOwn(parseFiscalData(legacy,selection),'cbsIbsPercent'),false);
  for(const percent of [100,60,40,0] as const)assert.equal(parseFiscalData({...fiscal,cbsIbsPercent:percent},selection).cbsIbsPercent,percent);
  for(const invalid of [41,1,0.6,'60',null,NaN,{},-40])assert.throws(()=>parseFiscalData({...fiscal,cbsIbsPercent:invalid},selection));
});

test('percentual é validado e guardado no pedido sem mudar pedidos históricos',()=>{
  const saved=drePdfFixture();
  const request={simulationId:saved._id,generationId:saved.generationId,clientId:saved.clientId,reportMonths:saved.reportMonths,
    periodConfirmed:true,monthlyGroups:saved.monthlyGroups,draft:saved.draft,rbt12Source:'MANUAL',rbt12ManualConfirmed:true};
  const previous=validateSimulationRequest(request);
  assert.equal(Object.hasOwn(previous.draft,'cbsIbsPercent'),false);
  for(const percent of [100,60,40,0])assert.equal(validateSimulationRequest({...request,draft:{...request.draft,cbsIbsPercent:percent}}).draft.cbsIbsPercent,percent);
  for(const invalid of [50,'60',null,NaN]){
    assert.throws(()=>validateSimulationRequest({...request,draft:{...request.draft,cbsIbsPercent:invalid}}));
    assert.equal(draftToInput({...request.draft,cbsIbsPercent:invalid}),null);
  }
});

test('sem redução e reduções de 100%, 60% e 40% aplicam as alíquotas corretas a cada mês',()=>{
  const saved=drePdfFixture(),before=structuredClone(saved);
  const calculate=(percent?:100|60|40|0)=>calculateMonthlySimulation({...saved.draft,...(percent===undefined?{}:{cbsIbsPercent:percent})},
    saved.source.monthlyReports,saved.monthlyInputs,saved.source.sales.jobId,null,saved.analysisPeriod);
  const legacy=calculate(),base=calculate(100);
  assert.deepEqual(base.result,legacy.result);
  // Persisted percentages represent the retained rate, so old 60/40 choices
  // remain 6.84%/4.56% after the visible reduction labels are introduced.
  for(const [percent,cbs,ibs,combined] of [[100,.113,.001,.114],[0,0,0,0],[40,.0452,.0004,.0456],[60,.0678,.0006,.0684]] as const){
    const computed=calculate(percent);
    const calendar=buildMonthlyDre(computed.result,saved.year,saved.rbt12Manual,saved.reportPeriod);
    const presentation=buildDrePresentation({...saved,...computed,calendar});
    near(presentation.taxStatement.taxRates.cbs,cbs);near(presentation.taxStatement.taxRates.ibs,ibs);near(presentation.taxStatement.taxRates.combined,combined);
    for(const [index,month] of computed.result.monthlyResults.entries()){
      const input=computed.engineInput.months[index].input;
      assert.equal(input.rates.cbs,cbs);assert.equal(input.rates.ibs,ibs);
      assert.deepEqual(input.credits,base.engineInput.months[index].input.credits);
      const result=month.result.regimes.find((regime:any)=>regime.id==='presumed');
      const original=base.result.monthlyResults[index].result.regimes.find((regime:any)=>regime.id==='presumed');
      const revenue=month.values.salesRevenue+month.values.serviceRevenue;
      near(result.dre.cbsDebit,-revenue*cbs);near(result.dre.ibsDebit,-revenue*ibs);
      if(percent===0){
        near(result.dre.cbsUsed,0);near(result.dre.ibsUsed,0);
        for(const tax of ['cbs','ibs'] as const){
          near(month.result.credits[tax].debit,0);near(month.result.credits[tax].used,0);near(month.result.credits[tax].due,0);
          near(month.result.credits[tax].potential,base.result.monthlyResults[index].result.credits[tax].potential);
        }
      }
      near(result.dre.payroll,original.dre.payroll);near(result.dre.benefits,original.dre.benefits);
    }
    const pure=computed.result.regimes.find((regime:any)=>regime.id==='pure');
    near(pure.dre.netProfit,base.result.regimes.find((regime:any)=>regime.id==='pure').dre.netProfit);
  }
  assert.deepEqual(saved,before);
});
