import {calculateMonthlySimulation,MONTHLY_MODEL_VERSION} from '../public/simulator-monthly.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {planReprocessing,reprocessedSimulationId,SERVICE_REVENUE_MIGRATION_REVISION} from '../src/simulation-reprocessing.ts';
import {annualizeReports,projectDifal,projectScenario} from '../public/simulator-projection.js';
import {calculateSimulation,draftToInput,MODEL_VERSION,defaultDifalPolicy,upgradeDifalPolicy} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {section22Year2025} from './fixtures/section22.ts';

function fixture(){
 const fields={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:15000,purchasesOptantCents:0,purchasesNonOptantCents:1000};
 const source:any={generationId:'10000000-0000-4000-8000-000000000001',clientId:'10000000-0000-4000-8000-000000000002',company:{name:'Sintética',code:'1'},periodBasis:'MANUAL',period:null,fields,
  purchases:{jobId:'10000000-0000-4000-8000-000000000003',totalCents:1000},sales:{jobId:'10000000-0000-4000-8000-000000000004',totalCents:15000,difal:{version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:10000,amountCents:1000,pendingLines:0}}};
 const original:any={_id:'10000000-0000-4000-8000-000000000005',generationId:source.generationId,clientId:source.clientId,title:'Cenário',source:structuredClone(source),reportMonths:1,periodConfirmed:true,monthlyGroupsUnit:'BRL',
  monthlyGroups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:160,purchasesOptantCents:0,purchasesNonOptantCents:12},baselineMonthlyGroups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:150,purchasesOptantCents:0,purchasesNonOptantCents:10},projection:annualizeReports(fields,1),
  draft:{year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{serviceRevenue:0,salesRevenue:160,simplePurchases:0,regularPurchases:12,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}},
  rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:10000000,confirmedAt:'2026-10-10T12:00:00Z',confirmedBy:{id:'original-user',name:'Origem'}}};
 source.fields={...fields,salesCpfCents:10000,serviceRevenueCents:5000};source.revenueSplit={version:'SALES_SERVICES_V1'};
 Object.defineProperty(source,'monthlyReports',{enumerable:true,get(){const count=original.reportMonths,p=annualizeReports(source.fields,count);return Array.from({length:count},(_,index)=>({sourceMonth:`2025-${String(index+1).padStart(2,'0')}`,month:index+1,fields:Object.fromEntries(Object.entries(source.fields).map(([key,total])=>[key,index<count-1?p.monthlyGroupsCents[key]:Number(total)-p.monthlyGroupsCents[key]*(count-1)])),salesLines:2,purchaseLines:1,anticipation:{...anticipation,pendingLines:0},difal:source.sales.difal?{...source.sales.difal,amountCents:index<count-1?Math.floor(source.sales.difal.amountCents/count):source.sales.difal.amountCents-Math.floor(source.sales.difal.amountCents/count)*(count-1)}:null}));}});
 return {original,source};
}
const difalPolicy=(enabled:Record<string,boolean>={})=>({version:'DIFAL_SCENARIOS_V1',enabled:{pure:true,hybrid:true,presumed:true,actual:true,...enabled}});
const anticipation={version:'ICMS_ANTICIPATION_V3',ratePercent:7.32,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:1};

test('recálculo atualiza política e direções somente na versão vinculada, preservando o original',()=>{
 const {original,source}=fixture();
 assert.deepEqual(planReprocessing(original,source,'ws').input.draft.difalPolicy,defaultDifalPolicy());
 assert.equal(Object.hasOwn(original.draft,'difalPolicy'),false,'O original sem política permanece sem o campo.');
 original.source.difalPolicy={...defaultDifalPolicy(),enabled:{pure:false,hybrid:true,presumed:false,actual:false},
  operations:{pure:{entry:false,exit:false},hybrid:{entry:false,exit:true}}};
 assert.deepEqual(planReprocessing(original,source,'ws').input.draft.difalPolicy,original.source.difalPolicy,'Sem escolha própria, a revisão conserva a opção da empresa congelada na fonte.');

 original.draft.difalPolicy=difalPolicy({pure:false,presumed:false});
 const before=structuredClone(original),planned=planReprocessing(original,source,'ws');
 assert.deepEqual(planned.input.draft.difalPolicy,upgradeDifalPolicy(before.draft.difalPolicy));assert.deepEqual(original,before);
 planned.input.draft.difalPolicy.enabled.hybrid=false;
 assert.equal(original.draft.difalPolicy.enabled.hybrid,true,'A revisão não compartilha o objeto de opções do original.');
 for(const invalid of [null,{...difalPolicy(),version:'UNKNOWN'},difalPolicy({pure:'false' as any}),{...difalPolicy(),extra:true}]){
  original.draft.difalPolicy=invalid;
  assert.throws(()=>planReprocessing(original,source,'ws'),(error:any)=>error.code==='REPROCESS_ADJUSTMENT');
 }
});

test('pendências de UF só bloqueiam impostos potencialmente usados por algum regime',()=>{
 const {original,source}=fixture();
 original.draft.difalPolicy=difalPolicy({pure:false,hybrid:false,presumed:false,actual:false});
 source.sales.difal.pendingLines=1;
 const current={...source,monthlyReports:source.monthlyReports.map((row:any)=>({...row,anticipation:{...anticipation}}))};
 const before=structuredClone(original);
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'));
 assert.deepEqual(original,before);
 current.monthlyReports[0].difal=null;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Uma estimativa excluída não exige dados de UF para seu valor.');
 original.draft.difalPolicy.enabled.presumed=true;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Lucro Presumido legado não habilita DIFAL na revisão atual.');
 original.draft.difalPolicy.enabled.pure=true;
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='DIFAL_SOURCE_MISSING');
 original.draft.difalPolicy.enabled.pure=false;
 current.monthlyReports[0].difal={...source.sales.difal,pendingLines:0};
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Lucro Presumido não aplica antecipação de compras.');
 original.draft.difalPolicy.enabled.pure=true;
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='ANTICIPATION_UF_PENDING');
 original.draft.rbt12=3_600_000;original.rbt12Manual.rbt12Cents=360_000_000;
 original.draft.difalPolicy.enabled.presumed=false;original.draft.difalPolicy.enabled.hybrid=true;
 current.monthlyReports[0].difal.pendingLines=1;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'No sublimite exato, os cenários Simples não aplicam vendas nem entradas.');
 original.draft.difalPolicy.enabled.actual=true;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Lucro Real legado não habilita DIFAL na revisão atual.');
 current.purchases={...current.purchases,totalCents:999};
 original.draft.difalPolicy=difalPolicy({pure:false,hybrid:false,presumed:false,actual:false});
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='REPROCESS_SOURCE_TOTAL','Excluir o imposto não dispensa a conciliação das fontes.');
});

test('revisão exige somente a evidência da direção selecionada para Puro ou Híbrido',()=>{
 const {original,source}=fixture();
 const current={...source,monthlyReports:source.monthlyReports.map((row:any)=>({...row,
  difal:{...row.difal,pendingLines:1},anticipation:{...anticipation,pendingLines:0}}))};
 original.draft.difalPolicy={...defaultDifalPolicy(),enabled:{pure:true,hybrid:false,presumed:false,actual:false},
  operations:{pure:{entry:true,exit:false},hybrid:{entry:false,exit:true}}};
 const originalBefore=structuredClone(original);
 const entryPlan=planReprocessing(original,current,'ws');
 assert.deepEqual(entryPlan.input.draft.difalPolicy,original.draft.difalPolicy);
 assert.deepEqual(original,originalBefore);
 current.monthlyReports[0].difal=null;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Somente entrada dispensa a estimativa de saída.');
 delete current.monthlyReports[0].anticipation;
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='ANTICIPATION_SOURCE_MISSING');
 current.monthlyReports[0].anticipation={...anticipation};
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='ANTICIPATION_UF_PENDING');
 original.draft.difalPolicy.enabled={pure:false,hybrid:true,presumed:false,actual:false};
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='DIFAL_SOURCE_MISSING');
 current.monthlyReports[0].difal={...source.sales.difal,pendingLines:0};
 const exitPlan=planReprocessing(original,current,'ws');
 assert.deepEqual(exitPlan.input.draft.difalPolicy.operations,{pure:{entry:true,exit:false},hybrid:{entry:false,exit:true}});
 delete current.monthlyReports[0].anticipation;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Somente saída dispensa a estimativa de entrada.');
 original.draft.difalPolicy.operations.hybrid.exit=false;
 current.monthlyReports[0].difal=null;
 assert.doesNotThrow(()=>planReprocessing(original,current,'ws'),'Nenhuma direção selecionada dispensa ambas as estimativas.');
});

test('UF pendente no mês bloqueado não impede o mês aplicável com RBT12 móvel confirmada',()=>{
 const {original,source}=fixture();original.reportMonths=2;
 original.projection=annualizeReports(original.source.fields,2);
 original.baselineMonthlyGroups=Object.fromEntries(Object.entries(original.projection.monthlyGroupsCents).map(([key,value])=>[key,Number(value)/100]));
 original.monthlyGroups={...original.baselineMonthlyGroups};
 original.draft.values.salesRevenue=75;original.draft.values.regularPurchases=5;
 original.draft.difalPolicy=difalPolicy({presumed:false,actual:false});
 original.rbt12Source='SIMPLES_SECTION_22';delete original.rbt12Manual;
 const extraction=section22Year2025();
 extraction.priorRevenues=extraction.priorRevenues.map((row,index)=>({...row,internalCents:index===0?29_999_999:30_000_000,totalCents:index===0?29_999_999:30_000_000}));
 extraction.rbt12Window=extraction.priorRevenues.slice(11);
 extraction.rbt12Cents=extraction.rbt12CalculatedCents=360_000_000;
 extraction.rbt12Basis.internalCents=extraction.rbt12Basis.totalCents=360_000_000;
 original.draft.rbt12=3_600_000;original.rbt12Extraction={id:'10000000-0000-4000-8000-000000000006',...extraction};
 const current={...source,monthlyReports:source.monthlyReports.map((row:any,index:number)=>({...row,
  difal:{...row.difal,pendingLines:index},anticipation:{...anticipation,pendingLines:index}}))};
 const before=structuredClone(original),planned=planReprocessing(original,current,'ws');
 assert.deepEqual(buildRbt12Schedule(planned.context.rbt12Extraction,current.monthlyReports.map((row:any)=>row.sourceMonth)).rows.map(row=>row.rbt12Cents),[359_999_999,360_000_000]);
 assert.deepEqual(original,before);
 current.monthlyReports[0].difal.pendingLines=1;
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='DIFAL_UF_PENDING'&&error.message.includes('2025-01'));
 current.monthlyReports[0].difal.pendingLines=0;current.monthlyReports[0].anticipation.pendingLines=1;
 assert.throws(()=>planReprocessing(original,current,'ws'),(error:any)=>error.code==='ANTICIPATION_UF_PENDING'&&error.message.includes('2025-01'));
});

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
  assert.equal(p.input.monthlyInputs.length,months);
  const actualTotal=p.input.monthlyInputs.reduce((sum,row)=>sum+Math.round(row.values.serviceRevenue*100),0);
  assert.equal(actualTotal,source.fields.serviceRevenueCents+manualCents*months);
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
 original.rbt12Extraction={id:'10000000-0000-4000-8000-000000000006',...section22Year2025()};original.draft.rbt12=210000;
 const p=planReprocessing(original,source,'ws');assert.equal(p.input.rbt12ExtractionId,original.rbt12Extraction.id);assert.equal(p.context.rbt12Manual,null);
 assert.equal(p.context.rbt12Extraction.priorRevenues.length,23);
 const schedule=buildRbt12Schedule(p.context.rbt12Extraction,source.monthlyReports.map((row:any)=>row.sourceMonth));
 const computed=calculateMonthlySimulation(p.input.draft,source.monthlyReports,p.input.monthlyInputs,source.sales.jobId,schedule);
 assert.equal(computed.engineInput.months[0].input.rbt12,78000);assert.equal(p.input.draft.rbt12,210000);
 original.rbt12Extraction.rbt12Window[0].totalCents++;assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='RBT12_EXTRACTION');
});
test('recálculo bloqueia lacuna anterior à janela do PA sem completar a receita ou modificar o snapshot',()=>{
 const {original,source}=fixture();original.rbt12Source='SIMPLES_SECTION_22';delete original.rbt12Manual;original.draft.rbt12=210000;
 original.rbt12Extraction={id:'10000000-0000-4000-8000-000000000006',...section22Year2025()};
 original.rbt12Extraction.priorRevenues.splice(0,1);const before=structuredClone(original);
 assert.throws(()=>planReprocessing(original,source,'ws'),(error:any)=>error.code==='RBT12_MONTHS_MISSING'&&error.message.includes('2024-01'));
 assert.deepEqual(original,before);
});
test('regra atual exige resultado, motor, projeção e calendário reconciliados, não apenas versão',()=>{
 const {original,source}=fixture();const p=planReprocessing(original,source,'ws');
 const computed=calculateMonthlySimulation(p.input.draft,source.monthlyReports,p.input.monthlyInputs,source.sales.jobId);
 const current:any={...original,source,modelVersion:MONTHLY_MODEL_VERSION,draft:p.input.draft,monthlyGroups:p.input.monthlyGroups,monthlyInputs:p.input.monthlyInputs,
  baselineMonthlyGroups:{...original.baselineMonthlyGroups,salesCpfCents:100},baselineServiceRevenue:50,...computed,
  monthlyDre:buildMonthlyDre(computed.result,2027,original.rbt12Manual)};
 assert.equal(planReprocessing(current,source,'ws').alreadyCurrent,true);
 current.result.regimes[0].dre.netProfit++;assert.equal(planReprocessing(current,source,'ws').alreadyCurrent,false);
});
test('saldo reconstruído diferente é aceito somente com total original auditado',()=>{
 const {original,source}=fixture();source.fields.salesCpfCents=8000;source.sales.totalCents=13000;
 assert.throws(()=>planReprocessing(original,source,'ws'),(e:any)=>e.code==='REPROCESS_SOURCE_TOTAL');
 source.reprocessingSource={originalSalesTotalCents:15000};assert.equal(planReprocessing(original,source,'ws').input.monthlyGroups.salesCpfCents,90);
});

test('revisão de cenário mensal preserva meses distintos mesmo quando o último foi selecionado no formulário',()=>{
 const f=fixture(),fields={...f.source.fields,salesCpfCents:12000,serviceRevenueCents:6000,purchasesNonOptantCents:1200};
 const monthlyReports=[10000,2000].map((sales,index)=>({sourceMonth:`2026-0${index+1}`,month:index+1,salesLines:2,purchaseLines:1,anticipation:{...anticipation,pendingLines:0},
  fields:{...fields,salesCpfCents:sales,serviceRevenueCents:sales/2,purchasesNonOptantCents:sales/10},difal:{...f.source.sales.difal,amountCents:sales/10,baseCents:sales}}));
 const source={...f.source,fields,monthlyReports,purchases:{...f.source.purchases,totalCents:1200},sales:{...f.source.sales,totalCents:18000}};
 const inputs=monthlyReports.map(row=>({sourceMonth:row.sourceMonth,groups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:row.fields.salesCpfCents/100,purchasesOptantCents:0,purchasesNonOptantCents:row.fields.purchasesNonOptantCents/100},values:{serviceRevenue:row.fields.serviceRevenueCents/100,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}}));
 const draft={...f.original.draft,difalPolicy:defaultDifalPolicy(),values:{...inputs[1].values,salesRevenue:20,simplePurchases:0,regularPurchases:2}};
 const computed=calculateMonthlySimulation(draft,monthlyReports,inputs,source.sales.jobId);
 const original={...f.original,source,reportMonths:2,draft,monthlyGroups:inputs[1].groups,baselineMonthlyGroups:inputs[0].groups,baselineServiceRevenue:50,...computed,
  monthlyDre:buildMonthlyDre(computed.result,2027,f.original.rbt12Manual)};
 assert.equal(planReprocessing(original,source,'ws').alreadyCurrent,true);
 const bad=structuredClone(original);bad.monthlyDre.regimes[0].rows[0].months[0]++;
 assert.equal(planReprocessing(bad,source,'ws').alreadyCurrent,false);
});
