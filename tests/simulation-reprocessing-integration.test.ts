import {calculateMonthlySimulation} from '../public/simulator-monthly.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection, database, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup} from '../src/lookup-jobs.ts';
import {createSimulation, getSimulation, deleteSimulation} from '../src/simulation-history.ts';
import {reprocessSimulations, simulationReprocessingStatus, reprocessedSimulationId, SERVICE_REVENUE_MIGRATION_REVISION} from '../src/simulation-reprocessing.ts';
import {annualizeReports, projectScenario} from '../public/simulator-projection.js';
import {calculateSimulation, calculateTax, draftToInput, defaultDifalPolicy, upgradeDifalPolicy} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {section22} from './fixtures/section22.ts';
import {digest, token} from '../src/security.ts';
import {handler} from '../src/server.ts';
import {openAnalysis,getAnalysis} from '../src/analysis-store.ts';

const actor = {_id:'reprocess-admin',role:'admin',name:'Administradora sintética',email:'admin@example.test'};
const operator = {...actor,_id:'reprocess-operator',role:'operator',name:'Operador sintético',email:'operator@example.test'};
const viewer = {...actor,_id:'reprocess-viewer',role:'viewer',email:'viewer@example.test'};
const code = (expected:string) => (error:any) => error.code === expected;
const id = (index:number) => `70000000-0000-4000-8000-${String(index).padStart(12,'0')}`;

test('MongoDB recálculo: lotes, preservação, concorrência, retomada, exclusão e isolamento',
 {skip:!process.env.MONGODB_URI,timeout:120000},async t => {
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID,oldOrigin=process.env.APP_ORIGIN;
 process.env.MONGODB_DB='maximum_reprocess_'+randomUUID().replaceAll('-','');
 resetLookupIndexes();
 let server:http.Server|undefined;
 const switchWorkspace=(name:string)=>{process.env.WORKSPACE_ID='reprocess_'+name;};
 const rows=(totalCents:number,natureCode:string)=>({document:'12345678900',name:'Pessoa sintética',quantity:'1',
  serviceDate:'2026-08-15',natureCode,description:natureCode.startsWith('9000')?'Serviço sintético':'Mercadoria sintética',
  recipientUf:'SP',totalCents,grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0});
 async function fixture(recipientUf='SP'){
  const clientId=(await importCatalog(actor,[{code:'990',name:'Empresa sintética',uf:'MG'}])).items[0].id;
  const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
  for(const [attach,fileName,entries] of [
   [attachGenerationPurchase,'compras-sinteticas.csv',[rows(1000,'1102')]],
   [attachGenerationSale,'vendas-sinteticas.csv',[rows(10000,'6102'),rows(5000,'900001')]]
  ] as const){
   const {job}=await attach(actor,generation._id,{clientId,importId:randomUUID(),fileName,expectedRows:entries.length,issuerUf:'MG'});
   await uploadLookup(actor,job._id,{offset:0,rows:entries.map(row=>({...row,recipientUf}))});await finalizeLookup(actor,job._id);
  }
  const monthlyGroups={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:110,purchasesOptantCents:0,purchasesNonOptantCents:12};
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{serviceRevenue:50,salesRevenue:110,
   simplePurchases:0,regularPurchases:12,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}};
  return {generationId:generation._id,clientId,reportMonths:1,periodConfirmed:true,monthlyGroups,draft,monthlyInputs:[{sourceMonth:'2026-08',groups:monthlyGroups,values:Object.fromEntries(['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,(draft.values as any)[key]]))}],
   rbt12Source:'MANUAL',rbt12ManualConfirmed:true};
 }
 async function save(input:any,index:number,legacy=true,change?:(record:any)=>void){
  await createSimulation(actor,{...input,simulationId:id(index),title:'Cenário sintético '+index});
  const simulations=await collection('simulations');
  const original:any=await simulations.findOne(scope({_id:id(index)}));
  if(legacy){
   if (input.draft.difalPolicy === undefined) delete original.draft.difalPolicy;
   else original.draft.difalPolicy = structuredClone(input.draft.difalPolicy);
   original.modelVersion='LEGACY_SYNTHETIC';delete original.monthlyInputs;delete original.source.monthlyReports;
   delete original.source.operationVersion;delete original.source.operationAudit;
   delete original.source.revenueSplit;delete original.source.fields.serviceRevenueCents;delete original.baselineServiceRevenue;
   original.source.fields.salesCpfCents+=5000;
   original.monthlyGroups.salesCpfCents+=50;original.baselineMonthlyGroups.salesCpfCents+=50;
   original.draft.values.salesRevenue+=50;original.draft.values.serviceRevenue=0;
   original.projection={...annualizeReports(original.source.fields,1),scenario:projectScenario(original.monthlyGroups,original.draft.values)};
   original.difalProjection=null;original.engineInput=draftToInput(original.draft);original.result=calculateSimulation(original.draft);
   original.monthlyDre=buildMonthlyDre(original.result,original.draft.year,original.rbt12Extraction||original.rbt12Manual,original.source.period);
  }
  change?.(original);
  await simulations.replaceOne(scope({_id:original._id}),original);
  return structuredClone(original);
 }
 async function finish(){
  let status=await simulationReprocessingStatus();
  for(let call=0;status.hasMore&&call<10;call++)status=await reprocessSimulations(operator,{});
  assert.equal(status.hasMore,false,'O lote finito deve concluir sem polling indefinido.');return status;
 }
 try{
  await t.test('lote limitado preserva originais, deltas e RBT12 congelada; distingue atual e pendências',async()=>{
   switchWorkspace('batch');const input=await fixture();
   const policy={version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:false}};
   const safe=await save({...input,draft:{...input.draft,difalPolicy:policy}},1),additional=await save(input,2,true,o=>{o.draft.values.serviceRevenue=25;});
   const current=await save(input,3,false),inconsistent=await save(input,4,true,o=>{o.baselineMonthlyGroups.salesCpfCents=149;});
   const extractionId=randomUUID();
   await (await collection('simplesExtractions')).insertOne({...scope(),_id:extractionId,clientId:input.clientId,
    parserVersion:'SIMPLES_SECTION_22_V2',fileName:'extrato-sintetico.pdf',fileSha256:'synthetic-only',result:section22(10000000)});
   const {rbt12Source:_source,rbt12ManualConfirmed:_confirmed,...pdfInput}=input;
   const pdf=await save({...pdfInput,rbt12ExtractionId:extractionId},5);
   // The extraction can disappear; the authenticated frozen reference remains the source of truth.
   await (await collection('simplesExtractions')).deleteOne(scope({_id:extractionId}));
   const originals=[safe,additional,current,inconsistent,pdf];
   const first=await reprocessSimulations(actor,{});
   assert.equal(first.total,5);assert.equal(first.counts.queued,2);assert.equal(first.hasMore,true);
   assert.equal(first.counts.ok+first.counts.pending+first.counts.failed,3);
   const done=await finish();
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:4,pending:1,failed:0});
   const outcomes=new Map(done.items.map((item:any)=>[item.originalId,item]));
   assert.equal(outcomes.get(safe._id)!.code,'UPDATED');assert.equal(outcomes.get(current._id)!.code,'ALREADY_CURRENT');
   assert.equal(outcomes.get(current._id)!.childId,null);
   assert.equal(outcomes.get(additional._id)!.code,'UPDATED');
   assert.match(outcomes.get(additional._id)!.message,/receita mensal adicional/);
   assert.equal(outcomes.get(inconsistent._id)!.code,'REPROCESS_BASELINE');
   for(const original of originals)assert.deepEqual(await (await collection('simulations')).findOne(scope({_id:original._id})),original);
   const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,safe._id));
   assert.equal(child.parentSimulationId,safe._id);assert.equal(child.draft.values.salesRevenue,110);
   assert.deepEqual(child.draft.difalPolicy,upgradeDifalPolicy(policy));
   for(const regime of child.result.regimes)assert.equal(regime.difalApplication.enabled,upgradeDifalPolicy(policy).enabled[regime.id as keyof typeof policy.enabled]);
   assert.equal(child.draft.values.serviceRevenue,50);assert.equal(child.draft.values.regularPurchases,12);
   for(const field of ['salaries','benefits','adminExpenses','rent','cardExpenses'])assert.equal(child.draft.values[field],safe.draft.values[field]);
   assert.deepEqual(child.rbt12Manual,safe.rbt12Manual);assert.equal(child.rbt12Manual.confirmedBy.id,actor._id);
   assert.deepEqual(child.result,calculateMonthlySimulation(child.draft,child.source.monthlyReports,child.monthlyInputs,child.source.sales.jobId).result);
   assert.deepEqual(child.engineInput,calculateMonthlySimulation(child.draft,child.source.monthlyReports,child.monthlyInputs,child.source.sales.jobId).engineInput);
   assert.equal(child.source.sales.difal.amountCents,1000);assert.equal(child.monthlyDre.months.length,12);
   const additionalChild=await getSimulation(reprocessedSimulationId(scope().workspaceId,additional._id));
   assert.equal(additionalChild.draft.values.serviceRevenue,75);assert.equal(additionalChild.draft.values.salesRevenue,110);
   assert.equal(additionalChild.result.annualRevenue,(additional.draft.values.salesRevenue+additional.draft.values.serviceRevenue));
   assert.equal(additionalChild.reprocessing.serviceRevenueMigration.priorMonthlyServiceCents,2500);
   assert.equal(additionalChild.reprocessing.serviceRevenueMigration.reportMonthlyServiceCents,5000);
   assert.equal(additionalChild.reprocessing.serviceRevenueMigration.appliedMonthlyServiceCents,7500);
   const pdfChild=await getSimulation(reprocessedSimulationId(scope().workspaceId,pdf._id));
   assert.deepEqual(pdfChild.rbt12Extraction,pdf.rbt12Extraction);assert.equal(pdfChild.rbt12Manual,undefined);
   assert.equal(pdfChild.draft.rbt12,100000);assert.notEqual(pdfChild.draft.rbt12,pdfChild.result.annualRevenue);
   assert.equal(await (await collection('simulations')).countDocuments(scope({reprocessing:{$exists:true}})),3);
   const again=await reprocessSimulations(operator,{});assert.deepEqual(again.counts,done.counts);
   assert.equal(await (await collection('simulationReprocessItems')).countDocuments(scope()),5,'Filhos não entram no inventário.');
  });

  await t.test('revisão de versão sem RBT12 mantém ausência explícita, demais regimes e snapshot original',async()=>{
   switchWorkspace('optional-rbt12');const input=await fixture();
   const {rbt12ManualConfirmed:_confirmed,...request}=input;
   const original=await save({...request,rbt12Source:'NOT_PROVIDED',draft:{...input.draft,rbt12:null,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']}}},195,false,record=>{
     record.modelVersion='LEGACY_OPTIONAL_REFERENCE';record.result.version='LEGACY_OPTIONAL_REFERENCE';
    });
   const first=await reprocessSimulations(actor,{}),done=first.hasMore?await finish():first;
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:1,pending:0,failed:0});
   assert.equal(done.items[0].code,'UPDATED');
   const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,original._id));
   assert.equal(child.rbt12Source,'NOT_PROVIDED');assert.equal(child.draft.rbt12,null);assert.equal(child.engineInput.rbt12,null);
   assert.equal(child.rbt12Extraction,null);assert.equal(child.rbt12Manual,undefined);assert.equal(child.rbt12Schedule,undefined);
   assert.deepEqual(child.result.regimes.map((regime:any)=>[regime.id,regime.available]),[['pure',false],['hybrid',false],['presumed',true],['actual',true]]);
   assert.deepEqual(await(await collection('simulations')).findOne(scope({_id:original._id})),original);
   assert.deepEqual((await reprocessSimulations(operator,{})).counts,done.counts);
  });

  await t.test('CBS V10 cria um lote próprio após V9 concluído e conserva os snapshots de 9,11%',async()=>{
   switchWorkspace('cbs-version');const input=await fixture();
   const original=await save(input,90,true,record=>{
    record.createdAt=new Date('2026-10-20T12:00:00Z');
    record.modelVersion='1.10.0-regime-selection';
    record.engineInput.rates.cbs=.0911;
    for(const group of ['simpleRegular','regular'])record.engineInput.credits[group].cbsRate=.0911;
    record.result=calculateTax(record.engineInput);record.result.version=record.modelVersion;
    record.result.warnings=[{code:'model-period',severity:'info',title:'Cenário de 2027/2028',detail:'CBS de 9,11% na versão histórica sintética.'}];
    record.taxSources=[{label:'Referência histórica sintética',url:'https://example.test/historico'}];
    record.monthlyDre=buildMonthlyDre(record.result,record.draft.year,record.rbt12Manual,record.source.period);
   });
   const oldVersion='ICMS_OPERATIONS_2026_10_V9',oldBatchId='simulation-reprocessing:'+digest(JSON.stringify([scope().workspaceId,oldVersion]));
   const oldDate=new Date('2026-10-21T12:00:00Z');
   const oldChild={...structuredClone(original),_id:id(91),parentSimulationId:original._id,
    reprocessing:{version:oldVersion,originalId:original._id,completedAt:oldDate},createdAt:oldDate};
   const oldBatch={...scope(),_id:oldBatchId,version:oldVersion,startedAt:oldDate,updatedAt:oldDate,inventoryComplete:true,cursor:original._id};
   const oldItem={...scope(),_id:oldBatchId+':'+original._id,batchId:oldBatchId,originalId:original._id,childId:oldChild._id,
    status:'OK',code:'UPDATED',message:'Revisão V9 sintética concluída.',company:original.company,title:original.title,updatedAt:oldDate,attempts:1};
   const simulations=await collection('simulations'),batches=await collection('simulationReprocessBatches'),items=await collection('simulationReprocessItems');
   await simulations.insertOne(oldChild);await batches.insertOne(oldBatch);await items.insertOne(oldItem);
   const before=await simulationReprocessingStatus();
   assert.equal(before.version,'DIFAL_CPF_2026_10_V11');assert.equal(before.total,0);assert.equal(before.inventoryComplete,false);
   assert.equal((await getSimulation(original._id)).engineInput.rates.cbs,.0911);
   assert.equal((await getSimulation(oldChild._id)).engineInput.rates.cbs,.0911);
   await reprocessSimulations(actor,{});const done=await finish();
   assert.equal(done.version,'DIFAL_CPF_2026_10_V11');assert.equal(done.total,1);
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:1,pending:0,failed:0});
   const childId=reprocessedSimulationId(scope().workspaceId,oldChild._id),child=await getSimulation(childId);
   assert.notEqual(childId,oldChild._id);assert.equal(child.parentSimulationId,oldChild._id);
   assert.equal(done.items[0].originalId,oldChild._id,'A família usa a revisão automática mais recente.');
   assert.equal(child.reprocessing.version,'DIFAL_CPF_2026_10_V11');
   assert.equal(child.engineInput.months[0].input.rates.cbs,.113);
   assert.equal(child.engineInput.months[0].input.credits.regular.cbsRate,.113);
   assert.equal(child.engineInput.months[0].input.credits.simpleRegular.cbsRate,.113);
   assert.equal(child.engineInput.months[0].input.credits.simple.cbsRate,.015);
   assert(Math.abs(child.result.credits.cbs.debit-160*.113)<1e-10);
   assert(Math.abs(child.result.credits.cbs.potential-12*.113)<1e-10);
   assert.match(done.items[0].message,/CBS de 11,3%/);
   assert.deepEqual(await simulations.findOne(scope({_id:original._id})),original);
   assert.deepEqual(await simulations.findOne(scope({_id:oldChild._id})),oldChild);
   assert.deepEqual(await batches.findOne(scope({_id:oldBatchId})),oldBatch);
   assert.deepEqual(await items.findOne(scope({_id:oldItem._id})),oldItem);
   await reprocessSimulations(operator,{});
   assert.equal(await simulations.countDocuments(scope({parentSimulationId:original._id})),1,'O original conserva somente o filho V9.');
   assert.equal(await simulations.countDocuments(scope({parentSimulationId:oldChild._id})),1,'Há exatamente um filho CBS V10 da revisão anterior.');
   assert.deepEqual(await getSimulation(childId),child);
  });

  for(const selected of ['latest','current-old','orphan'] as const)await t.test(`CBS escolhe uma base por família e atualiza a versão ativa: ${selected}`,async()=>{
   switchWorkspace('cbs-family-'+selected);const input=await fixture(),familyOffset={latest:100,'current-old':200,orphan:300}[selected],original=await save(input,familyOffset);
   const simulations=await collection('simulations'),siblings=[] as any[];
   for(const [index,version] of ['V7','V8','V9'].entries()){
    const child={...structuredClone(original),_id:id(familyOffset+1+index),parentSimulationId:original._id,
     reprocessing:{version:'ICMS_OPERATIONS_2026_10_'+version,originalId:original._id,completedAt:new Date(`2026-10-${20+index}T12:00:00Z`)},
     createdAt:new Date(`2026-10-${20+index}T12:00:00Z`)};
    await simulations.insertOne(child);siblings.push(child);
   }
   if(selected==='orphan')await deleteSimulation(actor,original._id);
   const chosen=selected==='current-old'?siblings[0]:siblings[2];
   if(selected==='current-old')await simulations.insertMany(Array.from({length:498},(_,index)=>({...scope(),_id:id(1000+index),
    clientId:original.clientId,generationId:original.generationId,parentSimulationId:original._id,
    company:original.company,title:'Revisão sintética para paginação',createdAt:new Date('2026-10-25T12:00:00Z'),
    reprocessing:{version:'LEGACY_PAGING_SYNTHETIC',originalId:original._id}})));
   const opened=await openAnalysis(actor,{clientId:input.clientId,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']}});
   await simulations.updateOne(scope({_id:chosen._id}),{$set:{analysisId:opened.analysis.id,analysisRevision:opened.analysis.revision,analysisPublication:'PUBLISHED'}});
   await(await collection('analyses')).updateOne(scope({_id:opened.analysis.id}),{$set:{currentSimulation:{id:chosen._id,
    analysisRevision:opened.analysis.revision,createdAt:chosen.createdAt,modelVersion:chosen.modelVersion,legacy:false}}});
   const frozen=await simulations.find(scope()).sort({_id:1}).toArray();
   const first=await reprocessSimulations(actor,{});
   if(selected==='current-old'){assert.equal(first.hasMore,true);assert.equal(first.counts.ok,1,'A primeira página já promoveu a versão escolhida.');}
   const done=await finish();assert.equal(done.total,1);
   assert.equal(done.items[0].originalId,chosen._id);
   const childId=reprocessedSimulationId(scope().workspaceId,chosen._id),child=await getSimulation(childId);
   assert.equal(child.engineInput.months[0].input.rates.cbs,.113);
   assert.equal((await getAnalysis(opened.analysis.id,{summary:true})).analysis.currentSimulation.id,childId);
   assert.deepEqual(await simulations.find(scope({_id:{$in:frozen.map(old=>old._id)}})).sort({_id:1}).toArray(),frozen);
   await reprocessSimulations(operator,{});assert.equal((await simulationReprocessingStatus()).total,1);
   assert.equal(await simulations.countDocuments(scope({'reprocessing.version':'DIFAL_CPF_2026_10_V11'})),1);
   if(selected==='orphan')assert.equal((await getSimulation(chosen._id)).parentSimulationDeleted,true);
  });

  await t.test('UF pendente mantém a fonte conferida, mas só impede a revisão de imposto aplicável',async()=>{
   switchWorkspace('difal-policy-pending');const input=await fixture('');
   const off={version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:false,presumed:false,actual:false}};
   const excluded=await save({...input,draft:{...input.draft,difalPolicy:off}},70);
   const enabled=await save(input,71);
   const atSublimit=await save({...input,draft:{...input.draft,rbt12:3_600_000,
    difalPolicy:{...off,enabled:{...off.enabled,pure:true,hybrid:true}}}},72);
   const jobs=await collection('lookupJobs'),lines=await collection('purchaseLines');
   const sourceBefore={jobs:await jobs.find(scope()).sort({_id:1}).toArray(),lines:await lines.find(scope()).sort({_id:1}).toArray()};
   await reprocessSimulations(actor,{});const done=await finish();
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:2,pending:1,failed:0});
   const outcomes=new Map(done.items.map((item:any)=>[item.originalId,item]));
   assert.equal(outcomes.get(enabled._id)!.code,'DIFAL_UF_PENDING');
   for(const original of [excluded,atSublimit]){
    const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,original._id));
    assert.deepEqual(child.draft.difalPolicy,upgradeDifalPolicy(original.draft.difalPolicy));
    assert(child.source.monthlyReports[0].difal.pendingLines>0);
    assert(child.source.monthlyReports[0].anticipation.pendingLines>0);
    for(const regime of child.result.regimes){assert.equal(regime.dre.difal,0);assert.equal(regime.dre.icmsAnticipation,0);}
   }
   for(const original of [excluded,enabled,atSublimit])assert.deepEqual(await (await collection('simulations')).findOne(scope({_id:original._id})),original);
   assert.deepEqual({jobs:await jobs.find(scope()).sort({_id:1}).toArray(),lines:await lines.find(scope()).sort({_id:1}).toArray()},sourceBefore);
  });

  await t.test('revisão V7 conserva entrada no Puro e saída no Híbrido e não altera relatórios nem originais',async()=>{
   switchWorkspace('directions');const input=await fixture();
   const policy={...defaultDifalPolicy(),operations:{pure:{entry:true,exit:false},hybrid:{entry:false,exit:true}}};
   const original=await save({...input,draft:{...input.draft,difalPolicy:policy}},80);
   const jobs=await collection('lookupJobs'),lines=await collection('purchaseLines');
   const sourcesBefore={jobs:await jobs.find(scope()).sort({_id:1}).toArray(),lines:await lines.find(scope()).sort({_id:1}).toArray()};
   const done=await reprocessSimulations(actor,{});assert.equal(done.version,'DIFAL_CPF_2026_10_V11');
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:1,pending:0,failed:0});
   const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,original._id));
   assert.deepEqual(child.draft.difalPolicy,policy);assert.deepEqual(child.result.difalPolicy,policy);
   for(const regime of child.result.regimes){
    assert.equal(regime.dre.difal,regime.id==='hybrid'?-10:0);
    assert.equal(regime.dre.icmsAnticipation,regime.id==='pure'?-.73:0);
   }
   assert.deepEqual(await (await collection('simulations')).findOne(scope({_id:original._id})),original);
   assert.deepEqual({jobs:await jobs.find(scope()).sort({_id:1}).toArray(),lines:await lines.find(scope()).sort({_id:1}).toArray()},sourcesBefore);
   await reprocessSimulations(operator,{});
   assert.equal(await (await collection('simulations')).countDocuments(scope({parentSimulationId:original._id})),1);
   assert.deepEqual(await getSimulation(child._id),child);
  });

  await t.test('revisão retoma somente a antiga pendência de serviços uma vez, preserva OK e não ressuscita exclusões',async()=>{
   switchWorkspace('service-policy');const input=await fixture();
   const safe=await save(input,50),removedChildOriginal=await save(input,51);
   assert.equal((await reprocessSimulations(actor,{})).counts.ok,2);
   const items=await collection('simulationReprocessItems'),simulations=await collection('simulations');
   const safeChildId=reprocessedSimulationId(scope().workspaceId,safe._id);
   const safeChild=await simulations.findOne(scope({_id:safeChildId}));
   const safeItem=(await items.findOne(scope({originalId:safe._id})))!;
   const removedChildId=reprocessedSimulationId(scope().workspaceId,removedChildOriginal._id);
   await deleteSimulation(actor,removedChildId);
   const pending=await save(input,52,true,o=>{o.draft.values.serviceRevenue=25;});
   const reviewed=await save(input,53,true,o=>{o.draft.values.serviceRevenue=25;});
   const other=await save(input,54),removedOriginal=await save(input,55);
   // Reproduce the completed v0.22.0 inventory without rerunning its successful children.
   for(const original of [pending,reviewed,other,removedOriginal])await items.insertOne({...scope(),
    _id:safeItem.batchId+':'+original._id,batchId:safeItem.batchId,originalId:original._id,childId:null,status:'PENDING',
    code:original._id===other._id?'REPROCESS_BASELINE':'SERVICE_REVENUE_AMBIGUOUS',message:'Pendência sintética anterior.',
    company:original.company,title:original.title,updatedAt:new Date(),attempts:1,
    ...(original._id===reviewed._id?{serviceRevenueMigrationRevision:SERVICE_REVENUE_MIGRATION_REVISION}:{})});
   await deleteSimulation(actor,removedOriginal._id);
   const before=await simulationReprocessingStatus();assert.equal(before.hasMore,false);assert.equal(before.counts.pending,4);
   const done=await reprocessSimulations(operator,{});
   assert.deepEqual(done.counts,{queued:0,processing:0,ok:2,pending:3,failed:0});assert.equal(done.total,5);
   const migrated=(await items.findOne(scope({originalId:pending._id})))!;
   assert.equal(migrated.status,'OK');assert.equal(migrated.attempts,2);
   assert.equal(migrated.serviceRevenueMigrationRevision,SERVICE_REVENUE_MIGRATION_REVISION);
   const child=await getSimulation(migrated.childId);assert.equal(child.createdBy.id,operator._id);
   assert.equal(child.draft.values.serviceRevenue,75);assert.equal(child.reprocessing.serviceRevenueMigration.policy,'ADDITIONAL_TO_REPORT');
   assert.deepEqual(await simulations.findOne(scope({_id:safe._id})),safe);
   assert.deepEqual(await simulations.findOne(scope({_id:pending._id})),pending);
   assert.deepEqual(await simulations.findOne(scope({_id:safeChildId})),safeChild);
   assert.deepEqual(await items.findOne(scope({originalId:safe._id})),safeItem);
   assert.equal((await items.findOne(scope({originalId:reviewed._id})))!.attempts,1);
   assert.equal((await items.findOne(scope({originalId:other._id})))!.attempts,1);
   assert.equal(await simulations.countDocuments(scope({_id:removedChildId})),0);
   assert.equal(await items.countDocuments(scope({originalId:removedOriginal._id})),0);
   assert.equal((await items.findOne(scope({originalId:removedChildOriginal._id})))!.code,'REPROCESS_CHILD_DELETED');
   assert.equal(await (await collection('audit')).countDocuments(scope({action:'simulation.create',target:migrated.childId})),1);
   const repeat=await reprocessSimulations(actor,{});assert.deepEqual(repeat.counts,done.counts);
   assert.deepEqual(await items.findOne(scope({originalId:pending._id})),migrated);
   // A stale status write cannot reopen an item whose revision was already applied.
   await items.updateOne(scope({originalId:pending._id}),{$set:{status:'PENDING',code:'SERVICE_REVENUE_AMBIGUOUS'}});
   await reprocessSimulations(operator,{});
   const stale=(await items.findOne(scope({originalId:pending._id})))!;
   assert.equal(stale.status,'PENDING');assert.equal(stale.attempts,2);
   assert.equal(await simulations.countDocuments(scope({parentSimulationId:pending._id})),1);
  });

  await t.test('dois operadores concorrentes geram um único filho e preservam o autor da RBT12',async t=>{
   switchWorkspace('concurrent');const input=await fixture(),original=await save(input,10);
   const childId=reprocessedSimulationId(scope().workspaceId,original._id),insertOne=Collection.prototype.insertOne;
   let release!:()=>void,reached!:()=>void,held=false;
   const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{reached=resolve;});
   const mock=t.mock.method(Collection.prototype,'insertOne',async function(this:Collection,record:any,options:any){
    if(this.collectionName==='simulations'&&record._id===childId&&!held){held=true;reached();await gate;}
    return insertOne.call(this,record,options);
   });
   const slow=reprocessSimulations(actor,{});
   try{
    await blocked;const busy=await reprocessSimulations(operator,{});
    assert.equal(busy.counts.processing,1);assert.equal(busy.retryAfterMs,10000);assert.equal(busy.hasMore,true);
    release();assert.equal((await slow).counts.ok,1);
   }finally{release();await slow;mock.mock.restore();}
   await reprocessSimulations(operator,{});
   assert.equal(await (await collection('simulations')).countDocuments(scope({parentSimulationId:original._id})),1);
   assert.deepEqual((await getSimulation(childId)).rbt12Manual,original.rbt12Manual);
   assert.equal(await (await collection('audit')).countDocuments(scope({action:'simulation.create',target:childId})),1);
  });

  await t.test('lease vencido retoma item interrompido; falhas técnicas têm no máximo três tentativas',async t=>{
   switchWorkspace('recovery');const input=await fixture(),original=await save(input,20);
   const childId=reprocessedSimulationId(scope().workspaceId,original._id),insertOne=Collection.prototype.insertOne;
   const fail=t.mock.method(Collection.prototype,'insertOne',async function(this:Collection,record:any,options:any){
    if(this.collectionName==='simulations'&&record._id===childId)throw new Error('synthetic transient insert failure');
    return insertOne.call(this,record,options);
   });
   try{assert.equal((await reprocessSimulations(actor,{})).counts.failed,1);}finally{fail.mock.restore();}
   const items=await collection('simulationReprocessItems'),batches=await collection('simulationReprocessBatches');
   await items.updateOne(scope({originalId:original._id}),{$set:{status:'PROCESSING',processingOwner:'interrupted'}});
   await batches.updateOne(scope(),{$set:{leaseOwner:'interrupted',leaseUntil:new Date(Date.now()+60000)}});
   assert.equal((await reprocessSimulations(operator,{})).counts.processing,1);
   assert.equal(await (await collection('simulations')).countDocuments(scope({_id:childId})),0);
   await batches.updateOne(scope(),{$set:{leaseUntil:new Date(Date.now()-1000)}});
   assert.equal((await reprocessSimulations(operator,{})).counts.ok,1);
   assert.equal((await items.findOne(scope({originalId:original._id})))!.attempts,2);
   assert.deepEqual((await getSimulation(childId)).rbt12Manual,original.rbt12Manual);
   switchWorkspace('retry_limit');const retryInput=await fixture(),retryOriginal=await save(retryInput,21);
   const retryId=reprocessedSimulationId(scope().workspaceId,retryOriginal._id);let attempted=0;
   const alwaysFail=t.mock.method(Collection.prototype,'insertOne',async function(this:Collection,record:any,options:any){
    if(this.collectionName==='simulations'&&record._id===retryId){attempted++;throw new Error('synthetic repeated failure');}
    return insertOne.call(this,record,options);
   });
   try{
    const first=await reprocessSimulations(actor,{});assert.equal(first.counts.failed,1);assert.equal(first.retryableFailed,1);
    await reprocessSimulations(actor,{});assert.equal(attempted,1,'Falhas não são repetidas sem solicitação explícita.');
    await reprocessSimulations(operator,{retryFailed:true});
    const last=await reprocessSimulations(operator,{retryFailed:true});assert.equal(last.retryableFailed,0);
    await reprocessSimulations(actor,{retryFailed:true});assert.equal(attempted,3);
    assert.equal((await items.findOne(scope({originalId:retryOriginal._id})))!.attempts,3);
   }finally{alwaysFail.mock.restore();}
   assert.deepEqual(await (await collection('simulations')).findOne(scope({_id:retryOriginal._id})),retryOriginal);
  });

  await t.test('excluir filho impede recriação automática; excluir original purga metadados do lote',async()=>{
   switchWorkspace('deletion');const input=await fixture(),original=await save(input,30);
   await reprocessSimulations(actor,{});const childId=reprocessedSimulationId(scope().workspaceId,original._id);
   await deleteSimulation(operator,childId);
   const deleted=(await simulationReprocessingStatus()).items[0];assert.equal(deleted.code,'REPROCESS_CHILD_DELETED');
   assert.equal(deleted.status,'PENDING');assert.equal(deleted.childId,null);
   await reprocessSimulations(actor,{});await reprocessSimulations(operator,{retryFailed:true});
   assert.equal(await (await collection('simulations')).countDocuments(scope({_id:childId})),0);
   assert.deepEqual(await (await collection('simulations')).findOne(scope({_id:original._id})),original);
   await deleteSimulation(operator,original._id);assert.equal((await simulationReprocessingStatus()).total,0);
   assert.equal(await (await collection('simulationReprocessItems')).countDocuments(scope({originalId:original._id})),0);
   await reprocessSimulations(actor,{});assert.equal((await simulationReprocessingStatus()).total,0);
  });

  await t.test('tenant, payload, sessão, origem e permissão são verificados no endpoint real',async()=>{
   switchWorkspace('http');const input=await fixture(),original=await save(input,40);
   for(const bad of [[],false,{source:{}},{simulationId:original._id},{retryFailed:false},{retryFailed:'true'},{result:{}},{serviceRevenueMigrationRevision:SERVICE_REVENUE_MIGRATION_REVISION}])
    await assert.rejects(reprocessSimulations(actor,bad),code('VALIDATION'));
   await assert.rejects(reprocessSimulations(viewer,{}),code('FORBIDDEN'));
   assert.equal((await simulationReprocessingStatus()).total,0);
   switchWorkspace('outside');assert.equal((await reprocessSimulations(actor,{})).total,0);
   assert.equal(await (await collection('simulations')).countDocuments(scope()),0);
   switchWorkspace('http');assert.equal((await simulationReprocessingStatus()).total,0,'O lote de outro workspace não aparece.');
   server=http.createServer(handler);await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
   const base=`http://127.0.0.1:${(server.address() as any).port}`;process.env.APP_ORIGIN=base;
   const session=async(user:typeof actor)=>{
    const raw=token();await (await collection('users')).insertOne({...scope(),...user,active:true,mustChangePassword:false});
    await (await collection('sessions')).insertOne({...scope(),_id:digest(raw),userId:user._id,expiresAt:new Date(Date.now()+60000)});
    const cookie=process.env.NODE_ENV==='production'?'__Host-maximum_session':'maximum_session';
    return {Cookie:`${cookie}=${raw}`,Origin:base,'Content-Type':'application/json'};
   };
   const viewerHeaders=await session(viewer),operatorHeaders=await session(operator),url=base+'/api/v4/simulations/reprocess';
   assert.equal((await fetch(url)).status,401);
   assert.equal((await fetch(url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,401);
   const read=await fetch(url,{headers:viewerHeaders});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
   assert.equal((await fetch(url,{method:'POST',headers:viewerHeaders,body:'{}'})).status,403);
   assert.equal((await fetch(url,{method:'POST',headers:{...operatorHeaders,Origin:'https://evil.example'},body:'{}'})).status,403);
   assert.equal((await fetch(url,{method:'POST',headers:operatorHeaders,body:'{"source":{}}'})).status,400);
   const processed=await fetch(url,{method:'POST',headers:operatorHeaders,body:'{}'});assert.equal(processed.status,200);
   assert.equal((await processed.json()).counts.ok,1);
   assert.equal((await getSimulation(reprocessedSimulationId(scope().workspaceId,original._id))).createdBy.id,operator._id);
   await (await collection('users')).updateOne(scope({_id:operator._id}),{$set:{active:false}});
   assert.equal((await fetch(url,{method:'POST',headers:operatorHeaders,body:'{}'})).status,401);
  });
 }finally{
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await (await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;
 }
});
