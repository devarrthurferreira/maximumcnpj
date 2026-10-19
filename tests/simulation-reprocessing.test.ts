import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessing,reprocessedSimulationId,SERVICE_REVENUE_MIGRATION_REVISION} from '../src/simulation-reprocessing.ts';
import {annualizeReports,projectDifal,projectScenario} from '../public/simulator-projection.js';
import {calculateSimulation,draftToInput,MODEL_VERSION} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {section22} from './fixtures/section22.ts';

function fixture(){
 const fields={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:15000,purchasesOptantCents:0,purchasesNonOptantCents:1000};
 const source:any={generationId:'10000000-0000-4000-8000-000000000001',clientId:'10000000-0000-4000-8000-000000000002',company:{name:'Sintética',code:'1'},periodBasis:'MANUAL',period:null,fields,
  purchases:{jobId:'10000000-0000-4000-8000-000000000003',totalCents:1000},sales:{jobId:'10000000-0000-4000-8000-000000000004',totalCents:15000,difal:{version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:10000,amountCents:1000,pendingLines:0}}};
 const original:any={_id:'10000000-0000-4000-8000-000000000005',generationId:source.generationId,clientId:source.clientId,title:'Cenário',source:structuredClone(source),reportMonths:1,periodConfirmed:true,monthlyGroupsUnit:'BRL',
  monthlyGroups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:160,purchasesOptantCents:0,purchasesNonOptantCents:12},baselineMonthlyGroups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:150,purchasesOptantCents:0,purchasesNonOptantCents:10},projection:annualizeReports(fields,1),
  draft:{year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{serviceRevenue:0,salesRevenue:160,simplePurchases:0,regularPurchases:12,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}},
  rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:10000000,confirmedAt:'2026-10-10T12:00:00Z',confirmedBy:{id:'original-user',name:'Origem'}}};
 source.fields={...fields,salesCpfCents:10000,serviceRevenueCents:5000};source.revenueSplit={version:'SALES_SERVICES_V1'};
 return {original,source};
}
test('migração preserva deltas e despesas em centavos, separa serviço e não modifica original',()=>{
 const {original,source}=fixture(),before=structuredClone(original),p=planReprocessing(original,source,'ws');
 assert.equal(p.input.monthlyGroups.salesCpfCents,110);assert.equal(p.input.monthlyGroups.purchasesNonOptantCents,12);
 assert.equal(p.input.draft.values.serviceRevenue,50);assert.equal(p.input.draft.values.salesRevenue,110);assert.equal(p.input.draft.values.salaries,1);
 assert.deepEqual(p.context.rbt12Manual,original.rbt12Manual);assert.equal(p.context.rbt12Manual.confirmedBy.id,'original-user');
 assert.equal(p.input.parentSimulationId,original._id);assert.equal(p.alreadyCurrent,false);assert.deepEqual(original,before);
 assert.equal(p.input.simulationId,reprocessedSimulationId('ws',original._id));assert.notEqual(p.input.simulationId,reprocessedSimulationId('other',original._id));
});
test('serviços manuais legados complementam a base importada uma única vez, sem alterar a unidade mensal',()=>{
 for(const months of [1,12])for(const manual of [0,0.03,25,2500.37,30004.44]){
  const {original,source}=fixture(),oldProjection=annualizeReports(original.source.fields,months);
  original.reportMonths=months;original.projection=oldProjection;
  original.baselineMonthlyGroups=Object.fromEntries(Object.entries(oldProjection.monthlyGroupsCents).map(([field,cents])=>[field,Number(cents)/100]));
  original.monthlyGroups={...original.baselineMonthlyGroups,
   salesCpfCents:(oldProjection.monthlyGroupsCents.salesCpfCents+1000)/100,
   purchasesNonOptantCents:(oldProjection.monthlyGroupsCents.purchasesNonOptantCents+200)/100};
  original.draft.values={...original.draft.values,serviceRevenue:manual,salesRevenue:original.monthlyGroups.salesCpfCents,
   regularPurchases:original.monthlyGroups.purchasesNonOptantCents};
  const before=structuredClone(original),p=planReprocessing(original,source,'ws');
  const expected=annualizeReports(source.fields,months),manualCents=Math.round(manual*100);
  assert.equal(Math.round(p.input.draft.values.serviceRevenue*100),expected.monthlyGroupsCents.serviceRevenueCents!+manualCents);
  assert.equal(Math.round(p.input.draft.values.salesRevenue*100),expected.monthlyGroupsCents.salesCpfCents+1000);
  assert.equal(Math.round(p.input.draft.values.serviceRevenue*100)+Math.round(p.input.draft.values.salesRevenue*100),
   Math.round(original.draft.values.serviceRevenue*100)+Math.round(original.draft.values.salesRevenue*100),'A reclassificação preserva a receita combinada, inclusive quando o manual é menor que a base importada.');
  assert.deepEqual(p.context.serviceRevenueMigration,{revision:SERVICE_REVENUE_MIGRATION_REVISION,policy:'ADDITIONAL_TO_REPORT',unit:'CENTS',
   sourceJobId:source.sales.jobId,reportMonths:months,sourceServiceTotalCents:5000,reportMonthlyServiceCents:expected.monthlyGroupsCents.serviceRevenueCents,
   priorMonthlyServiceCents:manualCents,appliedMonthlyServiceCents:expected.monthlyGroupsCents.serviceRevenueCents!+manualCents,
   warning:'Os serviços manuais antigos foram preservados como receita mensal adicional aos serviços do relatório, conforme a orientação do formulário original.'});
  assert.deepEqual(original,before);
 }
});
test('cenário já separado mantém o delta de serviços, inclusive ajuste abaixo da base importada',()=>{
 const {original,source}=fixture();original.source=structuredClone(source);
 original.projection=annualizeReports(source.fields,1);original.baselineServiceRevenue=50;
 original.baselineMonthlyGroups.salesCpfCents=100;original.monthlyGroups.salesCpfCents=110;
 original.draft.values.salesRevenue=110;original.draft.values.serviceRevenue=25;
 const p=planReprocessing(original,source,'ws');assert.equal(p.input.draft.values.serviceRevenue,25);
 assert.equal(p.context.serviceRevenueMigration,null);
 original.baselineServiceRevenue=49;
 assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='REPROCESS_BASELINE');
});
test('contrato de serviços parcial ou desconhecido não é tratado como receita adicional legada',()=>{
 for(const change of [
  (o:any)=>{o.source.revenueSplit={version:'UNKNOWN'};},
  (o:any)=>{o.source.revenueSplit=null;},
  (o:any)=>{o.source.fields.serviceRevenueCents=5000;},
  (o:any)=>{o.source.fields.serviceRevenueCents=0;},
  (o:any)=>{o.baselineServiceRevenue=0;},
  (o:any)=>{o.projection.monthlyGroupsCents.serviceRevenueCents=0;},
 ]){const {original,source}=fixture();change(original);assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='REPROCESS_SERVICES');}
 const {original,source}=fixture();original.baselineServiceRevenue=null;original.draft.values.serviceRevenue=25;
 assert.equal(planReprocessing(original,source,'ws').input.draft.values.serviceRevenue,75,'Base de serviços nula equivale à ausência no contrato legado.');
});
test('totais/baseline divergentes, ajustes negativos, período trocado e DIFAL parcial não recebem OK',()=>{
 for(const [code,change]of[
  ['REPROCESS_INPUT_TOTAL',(o:any,s:any)=>o.draft.values.salesRevenue=159],
  ['REPROCESS_BASELINE',(o:any,s:any)=>o.baselineMonthlyGroups.salesCpfCents=149],
  ['REPROCESS_ADJUSTMENT',(o:any,s:any)=>{o.monthlyGroups.salesCpfCents=0;o.draft.values.salesRevenue=0;}],
  ['REPROCESS_PERIOD',(o:any,s:any)=>{o.reportPeriod={startMonth:'2026-01',endMonth:'2026-01',months:1};s.period={startMonth:'2026-02',endMonth:'2026-02',months:1};}],
  ['DIFAL_UF_PENDING',(o:any,s:any)=>s.sales.difal.pendingLines=1],
  ['DIFAL_SOURCE_MISSING',(o:any,s:any)=>delete s.sales.difal],
  ['RBT12_REQUIRED',(o:any,s:any)=>delete o.rbt12Manual.confirmedBy],
 ]as const){const {original,source}=fixture();change(original,source);assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code===code,code);}
});
test('extrato congelado validado é reutilizado sem OCR ou confirmação manual inventada',()=>{
 const {original,source}=fixture();original.rbt12Source='SIMPLES_SECTION_22';delete original.rbt12Manual;
 original.rbt12Extraction={id:'10000000-0000-4000-8000-000000000006',...section22(10000000)};
 const p=planReprocessing(original,source,'ws');assert.equal(p.input.rbt12ExtractionId,original.rbt12Extraction.id);assert.equal(p.context.rbt12Manual,null);
 original.rbt12Extraction.rbt12Window[0].totalCents++;assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='RBT12_EXTRACTION');
});
test('regra atual exige resultado, motor, projeção e calendário reconciliados, não apenas versão',()=>{
 const {original,source}=fixture();const p=planReprocessing(original,source,'ws');
 const difal=projectDifal(source.sales.difal,1,source.sales.jobId),result=calculateSimulation(p.input.draft,difal);
 const current:any={...original,source,modelVersion:MODEL_VERSION,draft:p.input.draft,monthlyGroups:p.input.monthlyGroups,
  baselineMonthlyGroups:{...original.baselineMonthlyGroups,salesCpfCents:100},baselineServiceRevenue:50,difalProjection:difal,
  engineInput:draftToInput(p.input.draft,difal),result,projection:{...annualizeReports(source.fields,1),scenario:projectScenario(p.input.monthlyGroups,p.input.draft.values)},monthlyDre:buildMonthlyDre(result,2027,original.rbt12Manual)};
 assert.equal(planReprocessing(current,source,'ws').alreadyCurrent,true);
 current.result.regimes[0].dre.netProfit++;assert.equal(planReprocessing(current,source,'ws').alreadyCurrent,false);
});
test('saldo reconstruído diferente é aceito somente com total original auditado',()=>{
 const {original,source}=fixture();source.fields.salesCpfCents=8000;source.sales.totalCents=13000;
 assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='REPROCESS_SOURCE_TOTAL');
 source.reprocessingSource={originalSalesTotalCents:15000};assert.equal(planReprocessing(original,source,'ws').input.monthlyGroups.salesCpfCents,90);
});
