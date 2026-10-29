import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {getGeneration,attachGenerationPurchase,attachGenerationSale,deleteGeneration} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {routeV4} from '../src/lookup-http.ts';
import {simulationAnalysisDeletionStarted,reserveAnalysisDeletion} from '../src/analysis-deletion.ts';
import {analysisMonthsForYear,JAN_SEP_POLICY} from '../public/analysis-period.js';

test('MongoDB desempenho das análises: navegação sem reconciliar arquivos e geração sempre estrita',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_analysis_performance_'+randomUUID().replaceAll('-','');
  process.env.WORKSPACE_ID='analysis_performance_test';resetLookupIndexes();
  const actor={_id:'performance-operator',role:'operator',name:'Equipe sintética',email:'performance@example.test'};
  const admin={...actor,_id:'performance-admin',role:'admin'},viewer={...actor,role:'viewer'};
  const selection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
  const route=async(method:string,path:string,input:any={},user=actor):Promise<any>=>
    routeV4(user,method,new URL('https://example.test/api/v4'+path),input);
  const code=(expected:string)=>(error:any)=>error.code===expected;
  const expenses=analysisMonthsForYear(2026).map((sourceMonth,index)=>({sourceMonth,salariesCents:index===0?10000:0,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}));
  let analysis:any,clientId:string,generationId:string,purchaseJobId:string;

  async function observe<T>(action:()=>Promise<T>){
    const calls:{collection:string;method:string;args:any[]}[]=[],patches:any[]=[];
    for(const method of ['find','findOne','aggregate','createIndex'] as const){
      const original=(Collection.prototype as any)[method];
      patches.push(t.mock.method(Collection.prototype,method,function(this:Collection,...args:any[]){
        calls.push({collection:this.collectionName,method,args});return original.apply(this,args);
      }));
    }
    try{return {value:await action(),calls};}finally{for(const patch of patches)patch.mock.restore();}
  }
  const financial=(calls:{collection:string}[])=>calls.filter(call=>['purchaseLines','lookupItems','cnpjStates'].includes(call.collection));
  const saveAccounting=async()=>{
    analysis=(await route('PATCH',`/analyses/${analysis.id}/accounting?summary=1`,{expectedSectorRevision:analysis.accounting.revision,
      expectedConfigRevision:analysis.config.revision,complete:true,data:{months:expenses}})).analysis;
  };
  const saveFiscal=async()=>{
    analysis=(await route('PATCH',`/analyses/${analysis.id}/fiscal?summary=1`,{expectedSectorRevision:analysis.fiscal.revision,
      expectedConfigRevision:analysis.config.revision,complete:true,data:analysis.fiscal.data})).analysis;
  };

  try{
    const imported=await importCatalog(admin,[{code:'99171',name:'Desempenho sintético',uf:'MG'}]);
    assert.equal(imported.failed,0,JSON.stringify(imported.items));clientId=imported.items[0].id;
    analysis=(await route('POST','/analyses?summary=1',{clientId,year:2027,regimeSelection:selection})).analysis;
    const prepared=await route('POST',`/analyses/${analysis.id}/fiscal/import?summary=1`,{
      expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
    analysis=prepared.analysis;generationId=prepared.generationId;
    for(const [attach,nature,totalCents] of [[attachGenerationPurchase,'1102',20000],[attachGenerationSale,'5102',100000]] as const){
      const {job}=await attach(actor,generationId,{clientId,importId:randomUUID(),fileName:`synthetic-${nature}.csv`,expectedRows:2});
      if(nature==='1102')purchaseJobId=job._id;
      await uploadLookup(actor,job._id,{offset:0,rows:[totalCents,0].map((value,index)=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:index===0?'2026-01-15':'2026-09-15',natureCode:nature,quantity:'1',totalCents:value,grossCents:value,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
      await finalizeLookup(actor,job._id);await processLookup(actor,job._id,(async()=>{throw new Error('CPF não consulta serviços externos.');}) as typeof fetch);
    }
    await saveFiscal();await saveAccounting();

    await t.test('carteira, busca, abertura e edição Contábil não consultam linhas fiscais nem reenviam índices',async()=>{
      const observed=await observe(async()=>{
        const all=await route('GET','/analyses?summary=1');assert.equal(all.items.length,1);
        assert.equal(all.items[0].readiness.verification,'SAVED');assert.equal(all.items[0].readiness.ready,true);
        const found=await route('GET',`/analyses?summary=1&clientId=${clientId}`);assert.equal(found.items[0].id,analysis.id);
        const detail=await route('GET',`/analyses/${analysis.id}?summary=1`);
        assert.deepEqual(detail.analysis.readiness.months,analysisMonthsForYear(2026));assert.equal(detail.analysis.readiness.verification,'SAVED');
        const reopened=await route('POST','/analyses?summary=1',{clientId,year:2028,regimeSelection:selection});
        assert.equal(reopened.created,false);assert.equal(reopened.analysis.config.year,2027);
        await saveAccounting();
        assert.equal(analysis.readiness.verification,'SAVED');assert.equal(analysis.readiness.ready,true);
        await getGeneration(generationId);
      });
      assert.deepEqual(financial(observed.calls),[],'Navegar e salvar despesas não pode varrer documentos fiscais.');
      assert.equal(observed.calls.filter(call=>call.method==='createIndex').length,0,'Índices devem ser preparados uma vez por conexão.');
    });

    await t.test('includeSource devolve a reconciliação da própria análise uma única vez',async()=>{
      const baseline=await observe(()=>generationSimulator(generationId,clientId,{periodPolicy:JAN_SEP_POLICY}));
      const combined=await observe(()=>route('GET',`/analyses/${analysis.id}?includeSource=1`));
      assert.deepEqual(combined.value.source,baseline.value);assert.equal(combined.value.sourceError,null);
      assert.equal(combined.value.analysis.readiness.ready,true);
      assert.equal(combined.value.analysis.readiness.verification,undefined);
      assert.ok(financial(baseline.calls).length>0);
      const signature=(calls:typeof baseline.calls)=>financial(calls).map(call=>`${call.collection}:${call.method}`).sort();
      assert.deepEqual(signature(combined.calls),signature(baseline.calls),'Abrir Fiscal deve reutilizar a fonte da validação, sem uma segunda leitura.');
      await assert.rejects(route('GET',`/analyses/${analysis.id}?summary=1&includeSource=1`),code('VALIDATION'));
    });

    await t.test('fonte continua disponível para preencher o Fiscal enquanto o extrato está pendente',async()=>{
      analysis=(await route('PATCH',`/analyses/${analysis.id}/config?summary=1`,{expectedConfigRevision:analysis.config.revision,
        year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}})).analysis;
      assert.equal(analysis.fiscal.data.rbt12Source,'NOT_PROVIDED');
      const optional=await observe(()=>route('GET',`/analyses/${analysis.id}?includeSource=1`));
      assert.equal(optional.value.source.generationId,generationId);
      assert(!optional.value.analysis.readiness.issues.some((issue:any)=>issue.code.startsWith('RBT12_')));
      assert.deepEqual(optional.calls.filter(call=>['simplesDocuments','simplesExtractions'].includes(call.collection)),[],
        'A opção sem RBT12 não lê arquivos nem extrações do Simples.');
      analysis=(await route('PATCH',`/analyses/${analysis.id}/fiscal?summary=1`,{expectedSectorRevision:analysis.fiscal.revision,
        expectedConfigRevision:analysis.config.revision,complete:false,data:{...analysis.fiscal.data,rbt12Source:'SIMPLES_SECTION_22'}})).analysis;
      const pending=await route('GET',`/analyses/${analysis.id}?includeSource=1`);
      assert.equal(pending.source.generationId,generationId);assert.equal(pending.source.monthlyReports.length,9);
      assert.equal(pending.sourceError,null);assert.equal(pending.analysis.readiness.ready,false);
      assert.ok(pending.analysis.readiness.issues.some((issue:any)=>issue.code==='RBT12_REQUIRED'));
      analysis=(await route('PATCH',`/analyses/${analysis.id}/config?summary=1`,{expectedConfigRevision:analysis.config.revision,
        year:2027,regimeSelection:selection})).analysis;
      await saveFiscal();await saveAccounting();
    });

    await t.test('summary não dispensa reconciliação ao concluir Fiscal ou publicar; snapshot permanece íntegro',async()=>{
      const rows=await collection('purchaseLines'),line=await rows.findOne(scope({jobId:purchaseJobId!}));
      await rows.updateOne(scope({_id:line!._id}),{$set:{totalCents:line!.totalCents+1}});
      try{
        const saved=await route('GET',`/analyses/${analysis.id}?summary=1`);
        assert.equal(saved.analysis.readiness.verification,'SAVED');assert.equal(saved.analysis.readiness.ready,true);
        const checked=await route('GET',`/analyses/${analysis.id}?includeSource=1`);
        assert.equal(checked.source,null);assert.equal(checked.analysis.readiness.ready,false);assert.ok(checked.sourceError.message);
        await assert.rejects(saveFiscal());
        await assert.rejects(route('POST',`/analyses/${analysis.id}/generate?summary=1`,{
          requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_NOT_READY'));
        assert.equal(await(await collection('simulations')).countDocuments(scope({analysisId:analysis.id})),0);
      }finally{await rows.updateOne(scope({_id:line!._id}),{$set:{totalCents:line!.totalCents}});}
      const requestId=randomUUID(),expectedRevision=analysis.revision;
      const generated=await route('POST',`/analyses/${analysis.id}/generate?summary=1`,{requestId,expectedRevision});
      analysis=generated.analysis;assert.equal(analysis.readiness.verification,'SAVED');assert.equal(analysis.currentSimulation.stale,false);
      assert.deepEqual(Object.keys(generated.simulation).sort(),['_id','analysisId','createdAt','modelVersion']);
      for(const key of ['result','source','monthlyDre'])assert.equal(Object.hasOwn(generated.simulation,key),false);
      const snapshot=await route('GET',`/simulations/${generated.simulation._id}`);
      assert.equal(snapshot.result.annualRevenue,1000);assert.equal(snapshot.monthlyInputs[0].values.salaries,100);
      const repeated=await route('POST',`/analyses/${analysis.id}/generate?summary=1`,{requestId,expectedRevision});
      assert.equal(repeated.reused,true);assert.deepEqual(repeated.simulation,generated.simulation);
      const complete=await route('POST',`/analyses/${analysis.id}/generate`,{requestId,expectedRevision});
      assert.deepEqual(complete.simulation,snapshot,'O contrato padrão continua devolvendo a simulação completa.');
    });

    await t.test('resumo conserva autorização, revisão concorrente e isolamento por workspace',async()=>{
      await assert.rejects(route('PATCH',`/analyses/${analysis.id}/accounting?summary=1`,{expectedSectorRevision:analysis.accounting.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{months:expenses}},viewer),code('FORBIDDEN'));
      await assert.rejects(route('PATCH',`/analyses/${analysis.id}/accounting?summary=1`,{expectedSectorRevision:analysis.accounting.revision-1,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{months:expenses}}),code('ANALYSIS_CONFLICT'));
      process.env.WORKSPACE_ID='analysis_performance_other';
      try{
        assert.equal((await route('GET','/analyses?summary=1')).items.length,0);
        await assert.rejects(route('GET',`/analyses/${analysis.id}?summary=1`),code('NOT_FOUND'));
      }finally{process.env.WORKSPACE_ID='analysis_performance_test';}
    });

    await t.test('fonte excluída não bloqueia abrir ou editar Contábil, mas impede gerar e concluir Fiscal',async()=>{
      await deleteGeneration(admin,generationId);
      const observed=await observe(async()=>{
        analysis=(await route('GET',`/analyses/${analysis.id}?summary=1`)).analysis;
        assert.equal(analysis.readiness.verification,'SAVED');assert.equal(analysis.readiness.ready,true);
        await saveAccounting();assert.equal(analysis.accounting.status,'COMPLETE');
      });
      assert.deepEqual(financial(observed.calls),[]);
      const checked=await route('GET',`/analyses/${analysis.id}?includeSource=1`);
      assert.equal(checked.source,null);assert.equal(checked.sourceError.code,'ANALYSIS_GENERATION_UNAVAILABLE');assert.equal(checked.analysis.readiness.ready,false);
      assert.ok(checked.analysis.readiness.issues.some((issue:any)=>issue.code==='ANALYSIS_GENERATION_UNAVAILABLE'));
      await assert.rejects(saveFiscal(),code('ANALYSIS_GENERATION_UNAVAILABLE'));
      await assert.rejects(route('POST',`/analyses/${analysis.id}/generate?summary=1`,{
        requestId:randomUUID(),expectedRevision:analysis.revision}),code('ANALYSIS_NOT_READY'));
      assert.equal(await(await collection('simulations')).countDocuments(scope({analysisId:analysis.id})),1);
    });

    await t.test('travessia de versões carrega somente vínculos e ainda reconhece uma exclusão legada',async()=>{
      const snapshots=await collection('simulations'),ancestor=randomUUID(),child=randomUUID(),leaf=randomUUID(),lineageGeneration=randomUUID();
      await snapshots.insertMany([
        {_id:ancestor,...scope(),clientId,generationId:lineageGeneration,syntheticLargeResult:'x'.repeat(500_000)},
        {_id:child,...scope(),clientId,generationId:lineageGeneration,parentSimulationId:ancestor,reprocessing:{originalId:ancestor},syntheticLargeResult:'x'.repeat(500_000)}
      ]);
      const current={_id:leaf,...scope(),clientId,generationId:lineageGeneration,parentSimulationId:child,reprocessing:{originalId:child}};
      const observed=await observe(()=>simulationAnalysisDeletionStarted(current));assert.equal(observed.value,false);
      const ancestry=observed.calls.filter(call=>call.collection==='simulations'&&call.method==='findOne');assert.equal(ancestry.length,2);
      for(const call of ancestry){assert.deepEqual(call.args[1].projection,{_id:1,clientId:1,generationId:1,analysisId:1,parentSimulationId:1,'reprocessing.originalId':1});}
      await reserveAnalysisDeletion({target:randomUUID(),clientId,revision:0,actor:actor._id,createdAt:new Date(),legacySimulationIds:[ancestor]});
      assert.equal(await simulationAnalysisDeletionStarted(current),true);
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
