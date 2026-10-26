import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration,getGeneration,attachGenerationPurchase,attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {createSimulation,getSimulation,deleteSimulation,simulationHistory} from '../src/simulation-history.ts';
import {analysisHistory,openAnalysis,getAnalysis,updateAnalysisConfig,updateAnalysisSector,importAnalysisGeneration,generateAnalysis,analysisVersions,createLegacySimulation} from '../src/analysis-store.ts';
import {routeV4} from '../src/lookup-http.ts';
import {baselineMonth} from '../public/simulator-monthly.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';

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
  let analysis:any,first:any,latest:any,legacy:any,legacyInput:any,legacyAnalysis:any;
  const accountingRows=(months=['2026-01','2026-02'])=>months.map((sourceMonth,index)=>({sourceMonth,salariesCents:1000*(index+1),rentCents:0,
    cardExpensesCents:index,benefitsCents:0,adminExpensesCents:0}));
  const saveAccounting=async(rows=accountingRows(),complete=true)=>{
    const result=await updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:analysis.accounting.revision,
      expectedConfigRevision:analysis.config.revision,complete,data:{months:rows}});analysis=result.analysis;return result;
  };
  const saveFiscal=async(data=analysis.fiscal.data,complete=true)=>{
    const result=await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
      expectedConfigRevision:analysis.config.revision,complete,data});analysis=result.analysis;return result;
  };
  async function reports(generationId:string,clientId:string){
    const jobs:any[]=[];
    for(const [attach,nature,totals] of [[attachGenerationPurchase,'1102',[20000,30000]],[attachGenerationSale,'5102',[100000,200000]]] as const){
      const {job}=await attach(actor,generationId,{clientId,importId:randomUUID(),fileName:`${nature}.csv`,expectedRows:2});jobs.push(job);
      await uploadLookup(actor,job._id,{offset:0,rows:totals.map((totalCents,index)=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:`2026-0${index+1}-15`,natureCode:nature,quantity:'1',totalCents,grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
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
      await saveAccounting(accountingRows(['2026-01']));assert.equal(analysis.accounting.status,'COMPLETE');assert.equal(analysis.readiness.ready,false);
      await assert.rejects(updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:0,expectedConfigRevision:0,complete:true,data:{months:accountingRows()}}),code('ANALYSIS_CONFLICT'));
      const fiscalRevision=analysis.fiscal.revision,accountingRevision=analysis.accounting.revision;
      const changes=await Promise.all([
        updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:fiscalRevision,expectedConfigRevision:0,complete:false,data:analysis.fiscal.data}),
        updateAnalysisSector(accountant,analysis.id,'accounting',{expectedSectorRevision:accountingRevision,expectedConfigRevision:0,complete:true,data:{months:accountingRows(['2026-01'])}})
      ]);
      assert.equal(changes.length,2);analysis=(await getAnalysis(analysis.id)).analysis;
      assert.equal(analysis.fiscal.revision,fiscalRevision+1);assert.equal(analysis.accounting.revision,accountingRevision+1);
    });

    await t.test('Fiscal liga fontes reais da empresa e a cobertura Contábil precisa ser exata',async()=>{
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
      assert.equal(analysis.readiness.ready,false);assert.ok(analysis.readiness.issues.some((issue:any)=>issue.code==='ACCOUNTING_MONTHS_MISMATCH'));
      await assert.rejects(generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_NOT_READY'));
      await saveAccounting();assert.equal(analysis.readiness.ready,true);assert.deepEqual(analysis.readiness.months,['2026-01','2026-02']);
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
      assert.deepEqual(first.monthlyInputs.map((row:any)=>row.values.salaries),[10,20]);
      assert.deepEqual(first.monthlyInputs.map((row:any)=>row.values.cardExpenses),[0,.01]);
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

    await t.test('regime com Simples volta a exigir confirmação efetiva de RBT12, sem reutilizar conclusão antiga',async()=>{
      analysis=(await updateAnalysisConfig(actor,analysis.id,{expectedConfigRevision:analysis.config.revision,year:2028,
        regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','presumed']}})).analysis;
      assert.equal(analysis.fiscal.status,'DRAFT');assert.equal(analysis.fiscal.data.rbt12Source,'SIMPLES_SECTION_22');
      assert.equal((await getGeneration(analysis.fiscal.data.generationId)).companies[0].difalPolicy!.enabled.pure,false,
        'Mudar a seleção atual não altera a escolha capturada no relatório anterior.');
      await assert.rejects(saveFiscal(),code('RBT12_REQUIRED'));
      await assert.rejects(saveFiscal({...analysis.fiscal.data,rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:false}),code('RBT12_CONFIRMATION'));
      await saveFiscal({...analysis.fiscal.data,rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:true});
      assert.equal(analysis.readiness.ready,true);
      const next=await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});analysis=next.analysis;
      assert.deepEqual(next.simulation.result.regimes.map((row:any)=>row.id),['pure','presumed']);assert.equal(next.simulation.rbt12Manual.confirmed,true);
    });

    await t.test('bridge legado preserva retry e exclusão antes da ativação; open adota sem mutar o original',async()=>{
      const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[legacyClientId]});await reports(generation._id,legacyClientId);
      const source=await generationSimulator(generation._id,legacyClientId),monthlyInputs=source.monthlyReports!.map((row,index)=>{
        const entry=baselineMonth(row);entry.groups.salesNonOptantCents+=index+7;entry.values.serviceRevenue=index+11;
        entry.values.salaries=index+21;entry.values.rent=index+31;entry.values.cardExpenses=index+.01;entry.values.benefits=index+41;entry.values.adminExpenses=index+51;return entry;
      });
      const firstInput=monthlyInputs[0],groups=firstInput.groups;
      legacyInput={simulationId:randomUUID(),generationId:generation._id,clientId:legacyClientId,reportMonths:2,periodConfirmed:true,monthlyInputs,monthlyGroups:groups,
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
      assert.deepEqual(legacyAnalysis.accounting.data.months.map((row:any)=>row.salariesCents),[2100,2200]);
      assert.deepEqual(legacyAnalysis.accounting.data.months.map((row:any)=>row.adminExpensesCents),[5100,5200]);
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
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
