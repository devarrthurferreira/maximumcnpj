import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration,getGeneration,attachGenerationPurchase,attachGenerationSale,deleteGeneration} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {createSimulation,createReprocessedSimulation,getSimulation,deleteSimulation,simulationHistory} from '../src/simulation-history.ts';
import {analysisHistory,openAnalysis,getAnalysis,updateAnalysisConfig,updateAnalysisSector,importAnalysisGeneration,generateAnalysis,analysisVersions,createLegacySimulation,deleteAnalysis} from '../src/analysis-store.ts';
import {routeV4} from '../src/lookup-http.ts';
import {baselineMonth} from '../public/simulator-monthly.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';
import {analysisMonthsForYear,JAN_SEP_POLICY,JAN_SEP_MODEL_VERSION} from '../public/analysis-period.js';

test('MongoDB análises: setores explícitos, fonte confirmada, unicidade concorrente, versões e adoção legada',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_analysis_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='analysis_test';resetLookupIndexes();
  const actor={_id:'fiscal',role:'operator',name:'Fiscal de teste',email:'fiscal@example.test'};
  const administrator={...actor,_id:'administrator',role:'admin',name:'Administrador da fixture'};
  const accountant={...actor,_id:'accountant',name:'Contábil de teste'};
  const viewer={...actor,_id:'viewer',role:'viewer'};
  const selection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
  const code=(value:string)=>(error:any)=>error.code===value;
  const route=(method:string,path:string,input:any={})=>routeV4(actor,method,new URL(`https://test/api/v4${path}`),input);
  let analysis:any,first:any,latest:any,legacy:any,legacyInput:any,legacyAnalysis:any,outsideAnalysis:any,freshAnalysis:any;
  const noDifal=()=>({...defaultDifalPolicy(),enabled:{pure:false,hybrid:false,presumed:false,actual:false}});
  const accountingRows=(months=analysisMonthsForYear(2026))=>months.map((sourceMonth,index)=>({sourceMonth,salariesCents:index<2?1000*(index+1):0,rentCents:0,
    cardExpensesCents:index===1?1:0,benefitsCents:0,adminExpensesCents:0}));
  const saveAccounting=async(rows=accountingRows(),complete=true)=>{
    const result=await updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:analysis.accounting.revision,
      expectedConfigRevision:analysis.config.revision,complete,data:{months:rows}});analysis=result.analysis;return result;
  };
  const saveFiscal=async(data=analysis.fiscal.data,complete=true)=>{
    const result=await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
      expectedConfigRevision:analysis.config.revision,complete,data});analysis=result.analysis;return result;
  };
  async function reports(generationId:string,clientId:string,legacy=false){
    const jobs:any[]=[];
    for(const [attach,nature,totals] of [[attachGenerationPurchase,'1102',[20000,30000]],[attachGenerationSale,'5102',[100000,200000]]] as const){
      const selectedTotals=legacy?[...totals]:[...totals,0];
      const {job}=await attach(actor,generationId,{clientId,importId:randomUUID(),fileName:`${nature}.csv`,expectedRows:selectedTotals.length});jobs.push(job);
      await uploadLookup(actor,job._id,{offset:0,rows:selectedTotals.map((totalCents,index)=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:`2026-0${index===2?9:index+1}-15`,natureCode:nature,quantity:'1',totalCents,grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
      await finalizeLookup(actor,job._id);await processLookup(actor,job._id,(async()=>{throw new Error('CPF sintético não pode consultar API externa.');}) as typeof fetch);
    }
    return jobs;
  }
  try{
    const clients=await importCatalog(administrator,[{code:'99001',name:'Empresa de setores',uf:'MG'},{code:'99002',name:'Empresa legada',uf:'MG'},{code:'99003',name:'Empresa isolada',uf:'MG'}]);
    assert.equal(clients.failed,0,JSON.stringify(clients.items));
    const [clientId,legacyClientId,outsideId]=clients.items.map((row:any)=>row.id);

    await t.test('abre uma só análise por empresa sob concorrência sem substituir escolhas existentes',async()=>{
      const [a,b]=await Promise.all([openAnalysis(actor,{clientId,year:2027,regimeSelection:selection}),openAnalysis(accountant,{clientId,year:2027,regimeSelection:selection})]);
      assert.equal(a.analysis.id,b.analysis.id);assert.equal(await(await collection('analyses')).countDocuments(scope({clientId})),1);analysis=a.analysis;
      const reopened=await openAnalysis(actor,{clientId,year:2028,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}});
      assert.equal(reopened.created,false);assert.equal(reopened.analysis.config.year,2027);assert.deepEqual(reopened.analysis.config.regimeSelection,selection);
      assert.equal(analysis.fiscal.data.rbt12Source,'NOT_REQUIRED');assert.equal(analysis.currentSimulation,null);assert.equal(analysis.readiness.ready,false);
      assert.deepEqual((await analysisHistory(1,{clientId})).pagination,{page:1,pageSize:20,total:1,totalPages:1});
      await assert.rejects(openAnalysis(viewer,{clientId:outsideId,year:2027,regimeSelection:selection}),code('FORBIDDEN'));
      await assert.rejects(openAnalysis(actor,{clientId,year:2027,regimeSelection:selection,result:{}}),code('VALIDATION'));
      await assert.rejects(route('PATCH',`/analyses/${analysis.id}/config`,{expectedConfigRevision:0,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:[]}}),code('VALIDATION'));
    });

    await t.test('Contábil pode começar antes do Fiscal; vazio e zero são distintos, sem média automática',async()=>{
      const blank={sourceMonth:'2026-01',salariesCents:null,rentCents:null,cardExpensesCents:null,benefitsCents:null,adminExpensesCents:null};
      analysis=(await updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:0,expectedConfigRevision:0,complete:false,data:{months:[blank]}})).analysis;
      assert.equal(analysis.accounting.data.months[0].salariesCents,null);
      await assert.rejects(updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:1,expectedConfigRevision:0,complete:true,data:{months:[blank]}}),code('ANALYSIS_ACCOUNTING_INCOMPLETE'));
      await saveAccounting(accountingRows(['2026-01']));assert.equal(analysis.accounting.status,'COMPLETE');
      await saveAccounting(accountingRows(['2026-01']),false);assert.equal(analysis.accounting.status,'DRAFT');assert.equal(analysis.readiness.ready,false);
      await assert.rejects(updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:0,expectedConfigRevision:0,complete:true,data:{months:accountingRows()}}),code('ANALYSIS_CONFLICT'));
      const fiscalRevision=analysis.fiscal.revision,accountingRevision=analysis.accounting.revision;
      const changes=await Promise.all([
        updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:fiscalRevision,expectedConfigRevision:0,complete:false,data:analysis.fiscal.data}),
        updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:accountingRevision,expectedConfigRevision:0,complete:false,data:{months:accountingRows(['2026-01'])}})
      ]);
      assert.equal(changes.length,2);analysis=(await getAnalysis(analysis.id)).analysis;
      assert.equal(analysis.fiscal.revision,fiscalRevision+1);assert.equal(analysis.accounting.revision,accountingRevision+1);
    });

    await t.test('Fiscal liga fontes reais da empresa e o Contábil confirma somente os meses preenchidos',async()=>{
      const imported=await importAnalysisGeneration(actor,analysis.id,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
      analysis=imported.analysis;assert.equal(analysis.fiscal.data.generationId,imported.generationId);
      const captured=(await getGeneration(imported.generationId)).companies[0].difalPolicy!;
      assert.deepEqual(captured.enabled,{pure:false,hybrid:false,presumed:false,actual:false},'O relatório LP/LR não aplica DIFAL dos regimes ausentes.');
      assert.equal(analysis.fiscal.data.difalPolicy.enabled.pure,true,'A preferência Fiscal permanece salva para uma seleção futura.');
      assert.equal(analysis.fiscal.data.difalPolicy.enabled.hybrid,true);
      assert.deepEqual(captured.operations,analysis.fiscal.data.difalPolicy.operations);
      await assert.rejects(saveFiscal(),code('SIMULATOR_INCOMPLETE'));
      await reports(imported.generationId,clientId);await saveFiscal();
      assert.equal(analysis.fiscal.status,'COMPLETE');assert.equal(analysis.fiscal.confirmation.generationId,imported.generationId);
      assert.equal(analysis.readiness.ready,false);assert.ok(analysis.readiness.issues.some((issue:any)=>issue.code==='ACCOUNTING_NOT_CONFIRMED'));
      await assert.rejects(generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_NOT_READY'));
      await saveAccounting();assert.equal(analysis.readiness.ready,true);assert.deepEqual(analysis.readiness.months,analysisMonthsForYear(2026));
      assert.equal(await(await collection('simplesExtractions')).countDocuments(scope()),0,'Sem Simples, não há extrato fabricado.');
      const foreign=await createGeneration(actor,{generationId:randomUUID(),clientIds:[outsideId]});
      await assert.rejects(saveFiscal({...analysis.fiscal.data,generationId:foreign._id},false),code('GENERATION_CLIENT'));
      await assert.rejects(saveFiscal({...analysis.fiscal.data,icmsOperations:{version:'forged'}},false),code('VALIDATION'));
      await assert.rejects(saveFiscal({...analysis.fiscal.data,rbt12:0},false),code('RBT12_SOURCE'));
    });

    await t.test('gera apenas regimes escolhidos, congela custos mensais e repete publicação sem duplicar',async()=>{
      const requestId=randomUUID(),revision=analysis.revision;
      const generated:any=await route('POST',`/analyses/${analysis.id}/generate`,{requestId,expectedRevision:revision});
      analysis=generated.analysis;first=generated.simulation;latest=first;
      assert.equal(first.analysisId,analysis.id);assert.equal(first.analysisRevision,revision);assert.equal(first.rbt12Source,'NOT_REQUIRED');
      assert.equal(first.rbt12Extraction,null);assert.equal(first.engineInput.rbt12,null);assert.equal(first.draft.rbt12,undefined);
      assert.deepEqual(first.result.regimes.map((row:any)=>row.id),['presumed','actual']);assert.equal(first.result.annualRevenue,3000);
      assert.deepEqual(first.monthlyInputs.map((row:any)=>row.values.salaries),[10,20,0,0,0,0,0,0,0]);
      assert.deepEqual(first.monthlyInputs.map((row:any)=>row.values.cardExpenses),[0,.01,0,0,0,0,0,0,0]);
      assert.equal(first.analysisPeriod.version,JAN_SEP_POLICY);assert.equal(first.modelVersion,JAN_SEP_MODEL_VERSION);
      assert.equal(analysis.currentSimulation.id,first._id);assert.equal(analysis.currentSimulation.stale,false);
      assert.equal((await generateAnalysis(accountant,analysis.id,{requestId,expectedRevision:revision})).reused,true);
      assert.equal((await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:revision})).simulation._id,first._id);
      assert.equal(await(await collection('simulations')).countDocuments(scope({clientId})),1);
      await assert.rejects(deleteSimulation(actor,first._id),code('ANALYSIS_VERSION_PROTECTED'));
      const oldInput={simulationId:randomUUID(),generationId:first.generationId,clientId,reportMonths:first.reportMonths,periodConfirmed:true,
        monthlyGroups:first.monthlyGroups,monthlyInputs:first.monthlyInputs,draft:first.draft,rbt12Source:'NOT_REQUIRED'};
      await assert.rejects(createLegacySimulation(actor,oldInput),code('ANALYSIS_WORKFLOW_REQUIRED'));
      const summary=(await simulationHistory(1,{clientId})).items[0];
      assert.equal(summary.analysisId,analysis.id);assert.equal(summary.analysisProtected,true);assert.equal(summary.currentAnalysisId,analysis.id);
    });

    await t.test('editar muda só o rascunho; recalcular cria uma revisão ligada à anterior',async()=>{
      const before=structuredClone(await getSimulation(first._id)),oldRevision=analysis.revision;
      const rows=accountingRows();rows[0].salariesCents=4321;await saveAccounting(rows);
      assert.equal(analysis.currentSimulation.id,first._id);assert.equal(analysis.currentSimulation.stale,true);
      assert.deepEqual(await getSimulation(first._id),before);
      await assert.rejects(generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:oldRevision}),code('ANALYSIS_CONFLICT'));
      const next=await generateAnalysis(accountant,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});analysis=next.analysis;latest=next.simulation;
      assert.notEqual(latest._id,first._id);assert.equal(latest.parentSimulationId,first._id);assert.equal(latest.monthlyInputs[0].values.salaries,43.21);
      assert.deepEqual(await getSimulation(first._id),before);assert.equal((await analysisVersions(analysis.id,1)).items.filter(row=>row.current).length,1);
    });

    await t.test('confirmação detecta alteração do arquivo; dados alterados durante cálculo não viram corrente',async()=>{
      const jobId=analysis.fiscal.confirmation.purchaseJobId,jobs=await collection('lookupJobs'),original=await jobs.findOne(scope({_id:jobId}));
      await jobs.updateOne(scope({_id:jobId}),{$set:{completedAt:new Date(new Date(original!.completedAt).getTime()+1000)}});
      const changed=(await getAnalysis(analysis.id)).analysis;
      assert.ok(changed.readiness.issues.some((issue:any)=>issue.code==='FISCAL_SOURCE_CHANGED'));assert.equal(changed.currentSimulation!.stale,true);
      await assert.rejects(generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_NOT_READY'));
      await jobs.updateOne(scope({_id:jobId}),{$set:{completedAt:original!.completedAt}});
      await saveAccounting(accountingRows());const priorCurrent=analysis.currentSimulation.id;
      const originalInsert=Collection.prototype.insertOne;let injected=false,candidateId='';
      (Collection.prototype as any).insertOne=async function(doc:any,...args:any[]){
        if(this.collectionName==='simulations' && doc.analysisId===analysis.id && !injected){
          injected=true;candidateId=doc._id;
          await(await collection('analyses')).updateOne(scope({_id:analysis.id}),{$inc:{revision:1}});
        }
        return (originalInsert as any).call(this,doc,...args);
      };
      try{await assert.rejects(generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_CONFLICT'));}
      finally{Collection.prototype.insertOne=originalInsert;}
      assert.equal(injected,true);analysis=(await getAnalysis(analysis.id)).analysis;assert.equal(analysis.currentSimulation.id,priorCurrent);
      await assert.rejects(getSimulation(candidateId),code('NOT_FOUND'));
      assert.equal((await analysisVersions(analysis.id,1)).items.some(row=>row._id===candidateId),false);
      assert.equal((await simulationHistory(1,{clientId})).items.some(row=>row._id===candidateId),false);
    });

    await t.test('regime com Simples pode concluir sem RBT12 e depois acrescentar valor manual sem alterar a versão anterior',async()=>{
      analysis=(await updateAnalysisConfig(actor,analysis.id,{expectedConfigRevision:analysis.config.revision,year:2028,
        regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','presumed']}})).analysis;
      assert.equal(analysis.fiscal.status,'DRAFT');assert.equal(analysis.fiscal.data.rbt12Source,'NOT_PROVIDED');
      assert.equal((await getGeneration(analysis.fiscal.data.generationId)).companies[0].difalPolicy!.enabled.pure,false,
        'Mudar a seleção atual não altera a escolha capturada no relatório anterior.');
      await saveFiscal();assert.equal(analysis.readiness.ready,true);
      const withoutReference=await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});analysis=withoutReference.analysis;
      const frozen=structuredClone(withoutReference.simulation);
      assert.equal(frozen.rbt12Source,'NOT_PROVIDED');assert.equal(frozen.draft.rbt12,null);assert.equal(frozen.engineInput.rbt12,null);
      assert.equal(frozen.rbt12Extraction,null);assert.equal(frozen.rbt12Manual,undefined);assert.equal(frozen.rbt12Schedule,undefined);
      assert.deepEqual(frozen.result.regimes.map((row:any)=>[row.id,row.available]),[['pure',false],['presumed',true]]);
      assert.equal(frozen.result.simplesDiagnostic.statusCode,'MISSING_RBT12');assert.equal(frozen.result.bestRegimeId,'presumed');
      assert.deepEqual((await getAnalysis(analysis.id)).analysis.fiscal.data,analysis.fiscal.data);
      assert.deepEqual(frozen.monthlyInputs.map((row:any)=>row.sourceMonth),analysis.readiness.months);
      await assert.rejects(saveFiscal({...analysis.fiscal.data,rbt12Source:'SIMPLES_SECTION_22'}),code('RBT12_REQUIRED'),
        'Selecionar um PDF exige uma leitura válida; a opção sem informação é explícita.');
      await assert.rejects(saveFiscal({...analysis.fiscal.data,rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:false}),code('RBT12_CONFIRMATION'));
      await saveFiscal({...analysis.fiscal.data,rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:true});
      assert.equal(analysis.readiness.ready,true);
      const next=await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});analysis=next.analysis;
      assert.deepEqual(next.simulation.result.regimes.map((row:any)=>row.id),['pure','presumed']);assert.equal(next.simulation.rbt12Manual.confirmed,true);
      assert(next.simulation.result.regimes.every((row:any)=>row.available));assert.equal(next.simulation.parentSimulationId,frozen._id);
      assert.deepEqual(await getSimulation(frozen._id),frozen,'Informar RBT12 depois cria uma versão nova; o resultado sem referência permanece congelado.');
    });

    await t.test('bridge legado preserva retry e exclusão antes da ativação; open adota sem mutar o original',async()=>{
      const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[legacyClientId]});await reports(generation._id,legacyClientId);
      const source=await generationSimulator(generation._id,legacyClientId),monthlyInputs=source.monthlyReports!.map((row,index)=>{
        const entry=baselineMonth(row);entry.groups.salesNonOptantCents+=index+7;entry.values.serviceRevenue=index+11;
        entry.values.salaries=index+21;entry.values.rent=index+31;entry.values.cardExpenses=index+.01;entry.values.benefits=index+41;entry.values.adminExpenses=index+51;return entry;
      });
      const firstInput=monthlyInputs[0],groups=firstInput.groups;
      legacyInput={simulationId:randomUUID(),generationId:generation._id,clientId:legacyClientId,reportMonths:9,periodConfirmed:true,monthlyInputs,monthlyGroups:groups,
        rbt12Source:'MANUAL',rbt12ManualConfirmed:true,draft:{year:2027,salesAnnex:1,serviceAnnex:3,rbt12:200000,difalPolicy:defaultDifalPolicy(),
          values:{...firstInput.values,salesRevenue:groups.salesOptantCents+groups.salesNonOptantCents+groups.salesCpfCents,simplePurchases:groups.purchasesOptantCents,regularPurchases:groups.purchasesNonOptantCents}}};
      legacy=await createLegacySimulation(actor,legacyInput);const original=structuredClone(legacy);
      const stale=(await analysisHistory(1,{clientId:legacyClientId})).items[0];
      const changedInputs=structuredClone(monthlyInputs);changedInputs[0].values.salaries=123.45;
      const second=await createLegacySimulation(actor,{...legacyInput,simulationId:randomUUID(),parentSimulationId:legacy._id,monthlyInputs:changedInputs,
        draft:{...legacyInput.draft,values:{...legacyInput.draft.values,salaries:123.45}}});
      const refreshed=(await getAnalysis(stale.id)).analysis;
      assert.ok(refreshed.config.revision>stale.config.revision);assert.ok(refreshed.fiscal.revision>stale.fiscal.revision);assert.ok(refreshed.accounting.revision>stale.accounting.revision);
      assert.equal(refreshed.accounting.data.months[0].salariesCents,12345);
      for(const kind of ['fiscal','accounting'] as const)await assert.rejects(updateAnalysisSector(actor,stale.id,kind,
        {expectedSectorRevision:stale[kind].revision,expectedConfigRevision:stale.config.revision,complete:false,data:stale[kind].data}),code('ANALYSIS_CONFLICT'));
      await assert.rejects(updateAnalysisConfig(actor,stale.id,{expectedConfigRevision:stale.config.revision,year:stale.config.year,regimeSelection:stale.config.regimeSelection}),code('ANALYSIS_CONFLICT'));
      assert.equal((await analysisHistory(1,{clientId:legacyClientId})).items[0].currentSimulation!.id,second._id);
      await deleteSimulation(actor,second._id);
      const fallback=(await analysisHistory(1,{clientId:legacyClientId})).items[0];
      assert.equal(fallback.currentSimulation!.id,legacy._id);
      assert.ok(fallback.config.revision>refreshed.config.revision);assert.ok(fallback.fiscal.revision>refreshed.fiscal.revision);assert.ok(fallback.accounting.revision>refreshed.accounting.revision);
      legacyAnalysis=(await openAnalysis(actor,{clientId:legacyClientId,year:2028,regimeSelection:selection})).analysis;
      assert.equal(legacyAnalysis.legacy,true);assert.equal(legacyAnalysis.config.year,2027);assert.equal(legacyAnalysis.fiscal.status,'DRAFT');assert.equal(legacyAnalysis.accounting.status,'DRAFT');
      assert.deepEqual(legacyAnalysis.fiscal.data.monthlyOverrides,monthlyInputs.map(row=>({sourceMonth:row.sourceMonth,groups:row.groups,serviceRevenue:row.values.serviceRevenue})));
      assert.deepEqual(legacyAnalysis.accounting.data.months.map((row:any)=>row.salariesCents),Array.from({length:9},(_,index)=>(21+index)*100));
      assert.deepEqual(legacyAnalysis.accounting.data.months.map((row:any)=>row.adminExpensesCents),Array.from({length:9},(_,index)=>(51+index)*100));
      assert.deepEqual(await getSimulation(legacy._id),original);assert.deepEqual(await createLegacySimulation(actor,legacyInput),original);
      await assert.rejects(deleteSimulation(actor,legacy._id),code('ANALYSIS_VERSION_PROTECTED'));
      await assert.rejects(createLegacySimulation(actor,{...legacyInput,simulationId:randomUUID()}),code('ANALYSIS_WORKFLOW_REQUIRED'));
      assert.equal(await(await collection('analyses')).countDocuments(scope({clientId:legacyClientId})),1);
    });

    await t.test('fontes trocadas exigem nova conclusão e uma revisão pode ligar gerações sem perder o histórico',async()=>{
      const priorCurrent=analysis.currentSimulation.id,priorGeneration=analysis.fiscal.data.generationId;
      const imported=await importAnalysisGeneration(actor,analysis.id,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});analysis=imported.analysis;
      assert.notEqual(imported.generationId,priorGeneration);assert.equal(analysis.fiscal.status,'DRAFT');assert.equal(analysis.fiscal.data.monthlyOverrides,null);
      assert.deepEqual((await getGeneration(imported.generationId)).companies[0].difalPolicy!.enabled,{pure:true,hybrid:false,presumed:false,actual:false},
        'A nova importação captura DIFAL apenas para o Simples escolhido, respeitando a preferência salva.');
      assert.equal((await getGeneration(priorGeneration)).companies[0].difalPolicy!.enabled.pure,false);
      await reports(imported.generationId,clientId);await saveFiscal();
      const next=await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});analysis=next.analysis;
      assert.equal(next.simulation.parentSimulationId,priorCurrent);assert.equal(next.simulation.generationId,imported.generationId);
      assert.notEqual((await getSimulation(priorCurrent)).generationId,imported.generationId);
      const history=(await simulationHistory(1,{clientId})).items.find(row=>row._id===next.simulation._id)!;
      assert.equal(history.parentSimulationDeleted,false,'A nova importação da mesma análise conserva o vínculo válido com a versão anterior.');
    });

    await t.test('escopo, autoria, revisões compactas e leituras não executam migração global',async()=>{
      const revisions=await(await collection('analysisRevisions')).find(scope({analysisId:analysis.id})).toArray();
      assert.ok(revisions.some(row=>row.kind==='accounting' && row.createdBy.id===accountant._id));assert.ok(revisions.every(row=>!row.result && !row.source));
      const count=await(await collection('analyses')).countDocuments(scope());
      await route('GET','/analyses');await route('GET','/simulations');assert.equal(await(await collection('analyses')).countDocuments(scope()),count);
      process.env.WORKSPACE_ID='other_workspace';
      try{
        await assert.rejects(getAnalysis(analysis.id),code('NOT_FOUND'));assert.equal((await analysisHistory(1)).items.length,0);
        await assert.rejects(analysisVersions(analysis.id,1),code('NOT_FOUND'));
      }finally{process.env.WORKSPACE_ID='analysis_test';}
      const view=await routeV4(viewer,'GET',new URL(`https://test/api/v4/analyses/${analysis.id}`),{});assert.equal(view.analysis.id,analysis.id);
      await assert.rejects(routeV4(viewer,'POST',new URL(`https://test/api/v4/analyses/${analysis.id}/generate`),{requestId:randomUUID(),expectedRevision:analysis.revision}),code('FORBIDDEN'));
      await assert.rejects(route('POST',`/analyses/${analysis.id}/generate`,{requestId:randomUUID(),expectedRevision:analysis.revision,engineInput:{}}),code('VALIDATION'));
    });

    await t.test('DIFAL inicial opcional é validado e pertence apenas à criação vencedora, sem sobrescrever retomada',async()=>{
      const policy=noDifal(),original=structuredClone(policy);
      const opened=await route('POST','/analyses',{clientId:outsideId,year:2027,regimeSelection:selection,difalPolicy:policy});outsideAnalysis=opened.analysis;
      assert.equal(opened.created,true);assert.deepEqual(outsideAnalysis.fiscal.data.difalPolicy,policy);assert.deepEqual(policy,original);
      const requests=await Promise.all([
        openAnalysis(actor,{clientId:outsideId,year:2028,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']},difalPolicy:defaultDifalPolicy()}),
        openAnalysis(accountant,{clientId:outsideId,year:2028,regimeSelection:selection})
      ]);
      for(const response of requests){assert.equal(response.created,false);assert.equal(response.analysis.id,outsideAnalysis.id);
        assert.deepEqual(response.analysis.fiscal.data.difalPolicy,original);assert.equal(response.analysis.config.year,2027);}
      await assert.rejects(openAnalysis(actor,{clientId:outsideId,year:2027,regimeSelection:selection,difalPolicy:null}),code('VALIDATION'));
      await assert.rejects(openAnalysis(actor,{clientId:outsideId,year:2027,regimeSelection:selection,difalPolicy:{...policy,enabled:{...policy.enabled,presumed:true}}}),code('VALIDATION'));
      assert.deepEqual((await getAnalysis(outsideAnalysis.id)).analysis.fiscal.data.difalPolicy,original);
    });

    await t.test('exclusão exige confirmação, revisão, permissão, workspace e ausência de operação concorrente',async()=>{
      const id=outsideAnalysis.id,body={expectedRevision:outsideAnalysis.revision,confirmed:true},before=structuredClone(await getAnalysis(id));
      await assert.rejects(deleteAnalysis(viewer,id,body),code('FORBIDDEN'));
      await assert.rejects(deleteAnalysis(actor,id,{...body,confirmed:false}),code('ANALYSIS_DELETE_CONFIRMATION'));
      await assert.rejects(deleteAnalysis(actor,id,{...body,expectedRevision:body.expectedRevision+1}),code('ANALYSIS_CONFLICT'));
      await assert.rejects(deleteAnalysis(actor,id,{...body,clientId}),code('VALIDATION'));
      await assert.rejects(deleteAnalysis(actor,randomUUID(),body),code('NOT_FOUND'));
      process.env.WORKSPACE_ID='other_workspace';
      try{await assert.rejects(deleteAnalysis(actor,id,body),code('NOT_FOUND'));}finally{process.env.WORKSPACE_ID='analysis_test';}
      const c=await collection('analyses');
      await c.updateOne(scope({_id:id}),{$set:{leaseOwner:'generation-in-progress',leaseUntil:new Date(Date.now()+60000)}});
      try{await assert.rejects(deleteAnalysis(actor,id,body),code('ANALYSIS_CONFLICT'));}
      finally{await c.updateOne(scope({_id:id}),{$unset:{leaseOwner:'',leaseUntil:''}});}
      assert.deepEqual(await getAnalysis(id),before);assert.equal(await(await collection('audit')).countDocuments(scope({action:'analysis.delete',target:id})),0);
      const forgedId=randomUUID(),snapshots=await collection('simulations');
      await snapshots.insertOne({_id:forgedId,...scope(),clientId,analysisId:id});
      try{await assert.rejects(deleteAnalysis(actor,id,body),code('ANALYSIS_INCONSISTENT'));assert.ok(await snapshots.findOne(scope({_id:forgedId})));}
      finally{await snapshots.deleteOne(scope({_id:forgedId}));}
      assert.deepEqual(await getAnalysis(id),before);
    });

    await t.test('excluir análise apaga versões geridas e candidatos, conserva fontes e legado independente e permite começar vazio',async()=>{
      const unrelated=await createSimulation(actor,{simulationId:randomUUID(),generationId:first.generationId,clientId,reportMonths:first.reportMonths,
        periodConfirmed:true,monthlyGroups:first.monthlyGroups,monthlyInputs:first.monthlyInputs,draft:first.draft,rbt12Source:'NOT_REQUIRED',title:'Histórico independente preservado'});
      const sourceCollections=['clients','generations','lookupJobs','lookupItems','purchaseLines','simplesDocuments','simplesExtractions'];
      const sourceBefore=await Promise.all(sourceCollections.map(async name=>(await collection(name)).find(scope()).sort({_id:1}).toArray()));
      const otherBefore=structuredClone(await getAnalysis(legacyAnalysis.id)),unrelatedBefore=structuredClone(await getSimulation(unrelated._id));
      const id=analysis.id,body={expectedRevision:analysis.revision,confirmed:true},snapshots=await collection('simulations');
      const owned=await snapshots.find(scope({analysisId:id})).project({_id:1}).toArray();assert.ok(owned.length>=3);
      assert.ok(await(await collection('analysisRevisions')).countDocuments(scope({analysisId:id})));
      assert.ok(await(await collection('analysisGenerationRequests')).countDocuments(scope({analysisId:id})));
      await(await collection('simulationReprocessItems')).insertOne({_id:randomUUID(),...scope(),originalId:owned[0]._id,childId:owned[1]._id,status:'QUEUED',company:{name:'Somente resultado removido'}});
      const result=await route('DELETE',`/analyses/${id}`,body);assert.deepEqual(result,{deleted:true,id,clientId});
      await assert.rejects(getAnalysis(id),code('NOT_FOUND'));await assert.rejects(analysisVersions(id,1),code('NOT_FOUND'));
      for(const row of owned)await assert.rejects(getSimulation(row._id),code('NOT_FOUND'));
      assert.equal(await snapshots.countDocuments(scope({analysisId:id})),0);
      for(const name of ['analysisRevisions','analysisGenerationRequests'])assert.equal(await(await collection(name)).countDocuments(scope({analysisId:id})),0);
      assert.equal(await(await collection('simulationReprocessItems')).countDocuments(scope({originalId:{$in:owned.map(row=>row._id)}})),0);
      assert.equal((await analysisHistory(1,{clientId})).pagination.total,0);
      assert.deepEqual((await simulationHistory(1,{clientId})).items.map(row=>row._id),[unrelated._id]);
      assert.deepEqual(await getSimulation(unrelated._id),unrelatedBefore);assert.deepEqual(await getAnalysis(legacyAnalysis.id),otherBefore);
      for(let index=0;index<sourceCollections.length;index++)assert.deepEqual(await(await collection(sourceCollections[index])).find(scope()).sort({_id:1}).toArray(),sourceBefore[index],sourceCollections[index]);
      const receipts=await(await collection('audit')).find(scope({action:'analysis.delete',target:id})).toArray();
      assert.equal(receipts.length,1);assert.equal(receipts[0].actor,actor._id);assert.equal(receipts[0].revision,body.expectedRevision);
      assert.deepEqual(Object.keys(receipts[0]).sort(),['_id','action','actor','clientId','createdAt','legacySimulationIds','revision','target','workspaceId']);
      const fresh=await Promise.all([openAnalysis(actor,{clientId,year:2028,regimeSelection:selection,difalPolicy:noDifal()}),openAnalysis(accountant,{clientId,year:2028,regimeSelection:selection,difalPolicy:noDifal()})]);
      freshAnalysis=fresh[0].analysis;assert.equal(fresh[1].analysis.id,freshAnalysis.id);assert.notEqual(freshAnalysis.id,id);
      assert.equal(freshAnalysis.currentSimulation,null);assert.equal(freshAnalysis.fiscal.data.generationId,null);assert.deepEqual(freshAnalysis.accounting.data.months,[]);
      assert.equal(freshAnalysis.config.year,2028);assert.equal((await analysisVersions(freshAnalysis.id,1)).pagination.total,0);
      assert.deepEqual(await deleteAnalysis(accountant,id,body),result);assert.deepEqual(await deleteAnalysis(administrator,id,body),result);
      assert.deepEqual(await(await collection('audit')).find(scope({action:'analysis.delete',target:id})).toArray(),receipts);
      assert.equal((await getAnalysis(freshAnalysis.id)).analysis.id,freshAnalysis.id);
      await assert.rejects(deleteAnalysis(actor,id,{...body,expectedRevision:body.expectedRevision+1}),code('ANALYSIS_CONFLICT'));
    });

    await t.test('exclui rascunhos com fonte ausente ou corrompida e permite recomeçar sem afetar outra empresa',async()=>{
      for(const [index,brokenSource] of ['missing-generation','corrupt-report'].entries()){
        const imported=await importCatalog(administrator,[{code:String(99005+index),name:`Empresa de recuperação ${index+1}`,uf:'MG'}]);
        assert.equal(imported.failed,0,JSON.stringify(imported.items));const recoveryClient=imported.items[0].id!;
        let draft=(await openAnalysis(actor,{clientId:recoveryClient,year:2027,regimeSelection:selection})).analysis;
        const prepared=await importAnalysisGeneration(actor,draft.id,{expectedSectorRevision:draft.fiscal.revision,
          expectedConfigRevision:draft.config.revision});draft=prepared.analysis;
        const jobs=await reports(prepared.generationId,recoveryClient);
        draft=(await updateAnalysisSector(accountant,draft.id,'accounting',{expectedSectorRevision:draft.accounting.revision,
          expectedConfigRevision:draft.config.revision,complete:false,data:{months:accountingRows(['2026-01'])}},{summary:true})).analysis;
        assert.equal(draft.currentSimulation,null);assert.equal(draft.fiscal.status,'DRAFT');assert.equal(draft.accounting.status,'DRAFT');
        if(brokenSource==='missing-generation'){
          const removed=await(await collection('generations')).deleteOne(scope({_id:prepared.generationId}));assert.equal(removed.deletedCount,1);
        }else{
          const lines=await collection('purchaseLines'),line=await lines.findOne(scope({jobId:jobs[0]._id}));assert.ok(line);
          await lines.updateOne(scope({_id:line._id}),{$inc:{totalCents:1}});
        }
        const checked=await getAnalysis(draft.id,{includeSource:true});
        assert.equal(checked.source,null);assert.ok(checked.sourceError?.message);assert.equal(checked.analysis.readiness.ready,false);
        const sourceCollections=['clients','generations','lookupJobs','lookupItems','purchaseLines','simplesDocuments','simplesExtractions'];
        const sourceBefore=await Promise.all(sourceCollections.map(async name=>(await collection(name)).find(scope()).sort({_id:1}).toArray()));
        const otherBefore=structuredClone(await getAnalysis(outsideAnalysis.id));
        const body={expectedRevision:draft.revision,confirmed:true},result={deleted:true,id:draft.id,clientId:recoveryClient};
        assert.deepEqual(await route('DELETE',`/analyses/${draft.id}`,body),result);
        await assert.rejects(getAnalysis(draft.id),code('NOT_FOUND'));
        assert.equal((await analysisHistory(1,{clientId:recoveryClient},{summary:true})).pagination.total,0);
        assert.equal(await(await collection('analysisRevisions')).countDocuments(scope({analysisId:draft.id})),0);
        assert.equal(await(await collection('simulations')).countDocuments(scope({analysisId:draft.id})),0);
        assert.deepEqual(await getAnalysis(outsideAnalysis.id),otherBefore);
        for(let i=0;i<sourceCollections.length;i++)assert.deepEqual(await(await collection(sourceCollections[i])).find(scope()).sort({_id:1}).toArray(),sourceBefore[i],`${brokenSource}: ${sourceCollections[i]}`);
        const fresh=await openAnalysis(accountant,{clientId:recoveryClient,year:2028,regimeSelection:selection,difalPolicy:noDifal()},{summary:true});
        assert.equal(fresh.created,true);assert.notEqual(fresh.analysis.id,draft.id);assert.equal(fresh.analysis.config.year,2028);
        assert.equal(fresh.analysis.currentSimulation,null);assert.equal(fresh.analysis.fiscal.data.generationId,null);
        assert.deepEqual(fresh.analysis.accounting.data.months,[]);assert.deepEqual(fresh.analysis.fiscal.data.difalPolicy,noDifal());
        assert.equal(await(await collection('analyses')).countDocuments(scope({clientId:recoveryClient})),1);
        assert.deepEqual(await route('DELETE',`/analyses/${draft.id}`,body),result);
        assert.equal((await getAnalysis(fresh.analysis.id,{summary:true})).analysis.id,fresh.analysis.id);
      }
    });

    await t.test('adoção legada permanece identificável após nova corrente; só ela e revisões automáticas vinculadas são removidas',async()=>{
      legacyAnalysis=(await updateAnalysisSector(actor,legacyAnalysis.id,'fiscal',{expectedSectorRevision:legacyAnalysis.fiscal.revision,
        expectedConfigRevision:legacyAnalysis.config.revision,complete:true,data:legacyAnalysis.fiscal.data})).analysis;
      legacyAnalysis=(await updateAnalysisSector(accountant,legacyAnalysis.id,'accounting',{expectedSectorRevision:legacyAnalysis.accounting.revision,
        expectedConfigRevision:legacyAnalysis.config.revision,complete:true,data:legacyAnalysis.accounting.data})).analysis;
      const generated=await generateAnalysis(actor,legacyAnalysis.id,{requestId:randomUUID(),expectedRevision:legacyAnalysis.revision});legacyAnalysis=generated.analysis;
      assert.notEqual(legacyAnalysis.currentSimulation.id,legacy._id);assert.equal(legacyAnalysis.legacyReference.simulationId,legacy._id);
      const independent=await createSimulation(actor,{...legacyInput,simulationId:randomUUID(),title:'Legado não adotado'}),before=structuredClone(independent);
      const revised=await createReprocessedSimulation(actor,{...legacyInput,simulationId:randomUUID(),parentSimulationId:legacy._id,title:'Revisão automática da adotada'},
        {version:'ANALYSIS_CASCADE_TEST',originalId:legacy._id,source:legacy.source,rbt12Extraction:legacy.rbt12Extraction,rbt12Manual:legacy.rbt12Manual});
      assert.equal(revised.analysisId,undefined);
      const versions=(await analysisVersions(legacyAnalysis.id,1)).items.map(row=>row._id);
      assert.ok(versions.includes(legacy._id));assert.ok(versions.includes(revised._id));assert.ok(!versions.includes(independent._id));
      await deleteAnalysis(actor,legacyAnalysis.id,{expectedRevision:legacyAnalysis.revision,confirmed:true});
      for(const id of [legacy._id,generated.simulation._id,revised._id])await assert.rejects(getSimulation(id),code('NOT_FOUND'));
      assert.deepEqual(await getSimulation(independent._id),before);
      const reopened=(await openAnalysis(actor,{clientId:legacyClientId,year:2028,regimeSelection:selection})).analysis;
      assert.notEqual(reopened.id,legacyAnalysis.id);assert.equal(reopened.currentSimulation,null);assert.equal(reopened.fiscal.data.generationId,null);
      assert.deepEqual(reopened.accounting.data.months,[]);assert.equal((await analysisVersions(reopened.id,1)).pagination.total,0);
    });

    await t.test('falha antes do recibo restaura a análise; nova abertura conclui purga interrompida sem mudar autoria',async t=>{
      outsideAnalysis=(await updateAnalysisSector(accountant,outsideAnalysis.id,'accounting',{expectedSectorRevision:outsideAnalysis.accounting.revision,
        expectedConfigRevision:outsideAnalysis.config.revision,complete:false,data:{months:accountingRows(['2026-01'])}})).analysis;
      const id=outsideAnalysis.id,body={expectedRevision:outsideAnalysis.revision,confirmed:true},before=structuredClone(await getAnalysis(id));
      const updateOne=Collection.prototype.updateOne;
      const failedReceipt=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,filter:any,update:any,options:any){
        if(this.collectionName==='audit' && update.$setOnInsert?.action==='analysis.delete' && update.$setOnInsert.target===id)throw new Error('receipt temporarily unavailable');
        return updateOne.call(this,filter,update,options);
      });
      try{await assert.rejects(deleteAnalysis(actor,id,body),/receipt temporarily unavailable/);}finally{failedReceipt.mock.restore();}
      assert.deepEqual(await getAnalysis(id),before);assert.equal(await(await collection('audit')).countDocuments(scope({action:'analysis.delete',target:id})),0);
      const deleteMany=Collection.prototype.deleteMany;
      const failedPurge=t.mock.method(Collection.prototype,'deleteMany',async function(this:Collection,filter:any,options:any){
        if(this.collectionName==='analysisRevisions' && filter.analysisId===id)throw new Error('purge temporarily unavailable');
        return deleteMany.call(this,filter,options);
      });
      try{await assert.rejects(deleteAnalysis(actor,id,body),/purge temporarily unavailable/);}finally{failedPurge.mock.restore();}
      await assert.rejects(getAnalysis(id),code('NOT_FOUND'));assert.equal((await analysisHistory(1,{clientId:outsideId})).pagination.total,0);
      assert.equal(await(await collection('analyses')).countDocuments(scope({clientId:outsideId})),1,'A exclusão interrompida ainda protege o índice único.');
      const receipt=await(await collection('audit')).findOne(scope({action:'analysis.delete',target:id}));assert.equal(receipt!.actor,actor._id);
      outsideAnalysis=(await openAnalysis(accountant,{clientId:outsideId,year:2028,regimeSelection:selection,difalPolicy:noDifal()})).analysis;
      assert.notEqual(outsideAnalysis.id,id);assert.deepEqual(outsideAnalysis.accounting.data.months,[]);assert.equal(outsideAnalysis.currentSimulation,null);
      assert.equal(await(await collection('analyses')).countDocuments(scope({clientId:outsideId})),1);
      assert.equal(await(await collection('analysisRevisions')).countDocuments(scope({analysisId:id})),0);
      assert.deepEqual(await(await collection('audit')).findOne(scope({action:'analysis.delete',target:id})),receipt);
      assert.deepEqual(await deleteAnalysis(administrator,id,body),{deleted:true,id,clientId:outsideId});
    });

    await t.test('revisão de setor atrasada não repõe despesas depois da exclusão',async t=>{
      const id=outsideAnalysis.id,updateOne=Collection.prototype.updateOne;let release!:()=>void,reached!:()=>void,held=false;
      const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{reached=resolve;});
      const delayed=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,filter:any,update:any,options:any){
        if(this.collectionName==='analysisRevisions' && update.$setOnInsert?.analysisId===id && !held){held=true;reached();await gate;}
        return updateOne.call(this,filter,update,options);
      });
      const slow=updateAnalysisSector(accountant,id,'accounting',{expectedSectorRevision:outsideAnalysis.accounting.revision,
        expectedConfigRevision:outsideAnalysis.config.revision,complete:false,data:{months:accountingRows()}});
      const rejected=assert.rejects(slow,code('ANALYSIS_DELETED'));
      try{
        await blocked;const changed=(await getAnalysis(id)).analysis;assert.equal(changed.revision,outsideAnalysis.revision+1);
        await deleteAnalysis(actor,id,{expectedRevision:changed.revision,confirmed:true});release();await rejected;
      }finally{release();await slow.catch(()=>{});delayed.mock.restore();}
      assert.equal(await(await collection('analysisRevisions')).countDocuments(scope({analysisId:id})),0);
      await assert.rejects(getAnalysis(id),code('NOT_FOUND'));
    });

    await t.test('lease de geração bloqueia exclusão; insert após vencimento é descartado sem ressuscitar resultado',async t=>{
      freshAnalysis=(await updateAnalysisSector(actor,freshAnalysis.id,'fiscal',{expectedSectorRevision:freshAnalysis.fiscal.revision,
        expectedConfigRevision:freshAnalysis.config.revision,complete:true,data:{...freshAnalysis.fiscal.data,generationId:first.generationId}})).analysis;
      freshAnalysis=(await updateAnalysisSector(accountant,freshAnalysis.id,'accounting',{expectedSectorRevision:freshAnalysis.accounting.revision,
        expectedConfigRevision:freshAnalysis.config.revision,complete:true,data:{months:accountingRows()}})).analysis;
      const id=freshAnalysis.id,body={expectedRevision:freshAnalysis.revision,confirmed:true},insertOne=Collection.prototype.insertOne;
      let release!:()=>void,reached!:()=>void,held=false,candidateId='';
      const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{reached=resolve;});
      const delayed=t.mock.method(Collection.prototype,'insertOne',async function(this:Collection,document:any,options:any){
        if(this.collectionName==='simulations' && document.analysisId===id && !held){held=true;candidateId=document._id;reached();await gate;}
        return insertOne.call(this,document,options);
      });
      const slow=generateAnalysis(actor,id,{requestId:randomUUID(),expectedRevision:freshAnalysis.revision});
      const rejected=assert.rejects(slow,code('ANALYSIS_DELETED'));
      try{
        await blocked;await assert.rejects(deleteAnalysis(accountant,id,body),code('ANALYSIS_CONFLICT'));
        assert.equal((await getAnalysis(id)).analysis.id,id);
        await(await collection('analyses')).updateOne(scope({_id:id}),{$set:{leaseUntil:new Date(0)}});
        await deleteAnalysis(accountant,id,body);release();await rejected;
      }finally{release();await slow.catch(()=>{});delayed.mock.restore();}
      await assert.rejects(getSimulation(candidateId),code('NOT_FOUND'));assert.equal(await(await collection('simulations')).countDocuments(scope({analysisId:id})),0);
      assert.equal(await(await collection('analysisGenerationRequests')).countDocuments(scope({analysisId:id})),0);
      assert.ok(await getGeneration(first.generationId));
    });

    await t.test('abertura atrasada reserva somente dados vazios e não readota legado excluído por outra abertura',async t=>{
      const imported=await importCatalog(administrator,[{code:'99004',name:'Empresa da corrida de abertura',uf:'MG'}]);assert.equal(imported.failed,0);
      const raceClient=imported.items[0].id!,generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[raceClient]});
      await reports(generation._id,raceClient);
      const historical=await createSimulation(actor,{...legacyInput,simulationId:randomUUID(),generationId:generation._id,clientId:raceClient});
      const insertOne=Collection.prototype.insertOne;let release!:()=>void,reached!:()=>void,held=false;
      const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{reached=resolve;});
      const delayed=t.mock.method(Collection.prototype,'insertOne',async function(this:Collection,document:any,options:any){
        if(this.collectionName==='analyses' && document.clientId===raceClient && !held){
          held=true;assert.equal(document.currentSimulation,null);assert.equal(document.fiscal.data.generationId,null);
          assert.deepEqual(document.accounting.data.months,[]);reached();await gate;
        }
        return insertOne.call(this,document,options);
      });
      const slow=openAnalysis(actor,{clientId:raceClient,year:2028,regimeSelection:selection,difalPolicy:noDifal()});
      try{
        await blocked;
        const adopted=(await openAnalysis(accountant,{clientId:raceClient,year:2027,regimeSelection:selection,difalPolicy:noDifal()})).analysis;
        assert.equal(adopted.currentSimulation!.id,historical._id);assert.deepEqual(adopted.fiscal.data.difalPolicy,noDifal(),'A escolha inicial explícita prevalece após adotar o legado.');
        await deleteAnalysis(accountant,adopted.id,{expectedRevision:adopted.revision,confirmed:true});
        release();const fresh=(await slow).analysis;
        assert.notEqual(fresh.id,adopted.id);assert.equal(fresh.currentSimulation,null);assert.equal(fresh.fiscal.data.generationId,null);
        assert.deepEqual(fresh.accounting.data.months,[]);assert.equal(fresh.config.year,2028);assert.deepEqual(fresh.config.regimeSelection,selection);
        assert.deepEqual(fresh.fiscal.data.difalPolicy,noDifal());assert.equal((await analysisVersions(fresh.id,1)).pagination.total,0);
        await assert.rejects(getSimulation(historical._id),code('NOT_FOUND'));
        assert.equal(await(await collection('analyses')).countDocuments(scope({clientId:raceClient})),1);
      }finally{release();await slow.catch(()=>{});delayed.mock.restore();}
    });
    for(const deleted of [true,false])await t.test(`Fiscal recupera geração ${deleted?'excluída':'ausente'} sem perder RBT12, Contábil ou versões`,async()=>{
      const imported=await importCatalog(administrator,[{code:deleted?'99101':'99102',name:'Recuperação sintética de relatórios',uf:'MG'}]);
      assert.equal(imported.failed,0);const recoveryClient=imported.items[0].id!;
      let current=(await openAnalysis(actor,{clientId:recoveryClient,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']},difalPolicy:noDifal()})).analysis;
      const patch=(data:any,complete=false,expected=current.fiscal.revision,user=actor)=>updateAnalysisSector(user,current.id,'fiscal',{
        expectedSectorRevision:expected,expectedConfigRevision:current.config.revision,complete,data},{summary:true});
      const firstImport=await importAnalysisGeneration(actor,current.id,{expectedSectorRevision:current.fiscal.revision,expectedConfigRevision:current.config.revision});
      current=firstImport.analysis;await reports(firstImport.generationId,recoveryClient);
      current=(await patch({...current.fiscal.data,rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:true},true)).analysis;
      current=(await updateAnalysisSector(accountant,current.id,'accounting',{expectedSectorRevision:current.accounting.revision,
        expectedConfigRevision:current.config.revision,complete:true,data:{months:accountingRows()}})).analysis;
      const published=await generateAnalysis(actor,current.id,{requestId:randomUUID(),expectedRevision:current.revision});
      current=published.analysis;const snapshot=structuredClone(published.simulation),accounting=structuredClone(current.accounting);
      if(deleted)await deleteGeneration(administrator,firstImport.generationId);
      else await(await collection('generations')).deleteOne(scope({_id:firstImport.generationId}));
      await assert.rejects(getGeneration(firstImport.generationId),code('NOT_FOUND'));
      const unavailable=await getAnalysis(current.id,{includeSource:true});
      assert.equal(unavailable.source,null);assert.equal(unavailable.sourceError?.code,'ANALYSIS_GENERATION_UNAVAILABLE');
      assert.match(unavailable.sourceError!.message,/Prepare novos relatórios/);assert.equal(unavailable.analysis.readiness.ready,false);
      assert.equal(unavailable.analysis.currentSimulation!.stale,true);

      const revision=current.fiscal.revision;
      current=(await patch({...current.fiscal.data,rbt12:120000,serviceAnnex:4})).analysis;
      assert.equal(current.fiscal.data.generationId,firstImport.generationId);
      assert.equal(current.fiscal.data.rbt12,120000);assert.equal(current.fiscal.data.serviceAnnex,4);
      assert.equal(current.fiscal.revision,revision+1);assert.equal(current.fiscal.status,'DRAFT');assert.equal(current.fiscal.confirmation,null);
      assert.deepEqual(current.accounting,accounting);assert.deepEqual(await getSimulation(snapshot._id),snapshot);
      const revisionSaved=await(await collection('analysisRevisions')).findOne(scope({analysisId:current.id,revision:current.revision}));
      assert.equal(revisionSaved!.data.data.rbt12,120000);
      await assert.rejects(patch(current.fiscal.data,true),code('ANALYSIS_GENERATION_UNAVAILABLE'));
      await assert.rejects(patch(current.fiscal.data,false,revision),code('ANALYSIS_CONFLICT'));
      await assert.rejects(patch(current.fiscal.data,false,current.fiscal.revision,viewer),code('FORBIDDEN'));
      await assert.rejects(generateAnalysis(actor,current.id,{requestId:randomUUID(),expectedRevision:current.revision}),
        (error:any)=>error.code==='ANALYSIS_NOT_READY'&&/Prepare novos relatórios/.test(error.message));
      await assert.rejects(patch({...current.fiscal.data,generationId:randomUUID()}),code('NOT_FOUND'));
      const foreign=await createGeneration(actor,{generationId:randomUUID(),clientIds:[outsideId]});
      await assert.rejects(patch({...current.fiscal.data,generationId:foreign._id}),code('GENERATION_CLIENT'));
      const foreignWorkspace=await(await collection('generations')).findOne(scope({_id:foreign._id})),foreignId=randomUUID();
      await(await collection('generations')).insertOne({...foreignWorkspace!,_id:foreignId,workspaceId:'another-workspace'});
      await assert.rejects(patch({...current.fiscal.data,generationId:foreignId}),code('NOT_FOUND'));

      const replacement=await importAnalysisGeneration(actor,current.id,{expectedSectorRevision:current.fiscal.revision,expectedConfigRevision:current.config.revision});
      current=replacement.analysis;assert.notEqual(replacement.generationId,firstImport.generationId);
      assert.equal(current.fiscal.data.rbt12,120000);assert.equal(current.fiscal.data.serviceAnnex,4);assert.deepEqual(current.accounting,accounting);
      assert.equal(current.fiscal.data.monthlyOverrides,null);assert.equal(current.currentSimulation!.id,snapshot._id);
      await reports(replacement.generationId,recoveryClient);current=(await patch(current.fiscal.data,true)).analysis;
      const regenerated=await generateAnalysis(actor,current.id,{requestId:randomUUID(),expectedRevision:current.revision});
      assert.equal(regenerated.simulation.parentSimulationId,snapshot._id);assert.equal(regenerated.simulation.generationId,replacement.generationId);
      assert.deepEqual(await getSimulation(snapshot._id),snapshot);
      if(deleted)await assert.rejects(createGeneration(actor,{generationId:firstImport.generationId,clientIds:[recoveryClient]}),code('GENERATION_DELETED'));
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
