import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {attachGenerationPurchase,attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {openAnalysis,getAnalysis,updateAnalysisSector,importAnalysisGeneration,generateAnalysis,analysisVersions} from '../src/analysis-store.ts';
import {getSimulation} from '../src/simulation-history.ts';
import {analysisMonthsForYear} from '../public/analysis-period.js';
import {ACCOUNTING_AVERAGE_VERSION,ACCOUNTING_FIELDS} from '../src/analysis-contract.ts';

test('MongoDB: média mensal e histórico sobrevivem à ordem dos setores e à mudança do ano fiscal',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_average_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='average_test';resetLookupIndexes();
  const actor={_id:'average-accountant',role:'admin',name:'Contábil sintético',email:'average@example.test'};
  const fiscal={...actor,_id:'average-fiscal',name:'Fiscal sintético'};
  const selection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
  const options={summary:true};
  const data=(year:number,salariesCents=100000)=>{
    const values={salariesCents,rentCents:20000,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0};
    return {monthlyAverage:{version:ACCOUNTING_AVERAGE_VERSION,values},months:analysisMonthsForYear(year).map(sourceMonth=>({sourceMonth,...values}))};
  };
  const save=(item:any,kind:'accounting'|'fiscal',value:any,complete=true)=>updateAnalysisSector(kind==='accounting'?actor:fiscal,item.id,kind,
    {expectedSectorRevision:item[kind].revision,expectedConfigRevision:item.config.revision,complete,data:value},options);
  async function fresh(code:string){
    const result=await importCatalog(actor,[{code,name:`Média sintética ${code}`,uf:'MG'}]);
    assert.equal(result.failed,0);
    return (await openAnalysis(actor,{clientId:result.items[0].id,year:2027,regimeSelection:selection},options)).analysis;
  }
  async function reports(item:any,year:number){
    const imported=await importAnalysisGeneration(fiscal,item.id,{expectedSectorRevision:item.fiscal.revision,expectedConfigRevision:item.config.revision},options);
    for(const [attach,nature,value] of [[attachGenerationPurchase,'1102',200000],[attachGenerationSale,'5102',2000000]] as const){
      const {job}=await attach(fiscal,imported.generationId,{clientId:item.clientId,importId:randomUUID(),fileName:'synthetic.csv',expectedRows:2});
      await uploadLookup(fiscal,job._id,{offset:0,rows:[1,9].map(month=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:`${year}-${String(month).padStart(2,'0')}-15`,natureCode:nature,quantity:'1',totalCents:value,grossCents:value,
        discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
      await finalizeLookup(fiscal,job._id);
      await processLookup(fiscal,job._id,(async()=>{throw new Error('Dados sintéticos não consultam serviços externos.');}) as typeof fetch);
    }
    return (await save(imported.analysis,'fiscal',imported.analysis.fiscal.data)).analysis;
  }
  try{
    await t.test('Contábil primeiro: salva, fecha conexão, importa Fiscal de outro ano e gera nove meses sem perder revisão',async()=>{
      let item=await fresh('98501');
      item=(await save(item,'accounting',data(2026))).analysis;
      const savedAccounting=structuredClone((await(await collection('analyses')).findOne(scope({_id:item.id})))!.accounting);
      const historyBefore=await(await collection('analysisRevisions')).find(scope({analysisId:item.id,kind:'accounting'})).toArray();
      assert.equal(historyBefore.length,1);
      await closeDatabase();resetLookupIndexes();
      item=(await getAnalysis(item.id,options)).analysis;
      assert.deepEqual(item.accounting,savedAccounting);
      item=await reports(item,2025);
      assert.equal(item.readiness.ready,true);
      assert.deepEqual(item.accounting.data.months.map(row=>row.sourceMonth),analysisMonthsForYear(2025));
      assert(item.accounting.data.months.every(row=>row.salariesCents===100000));
      const raw=(await(await collection('analyses')).findOne(scope({_id:item.id})))!;
      assert.deepEqual(raw.accounting,savedAccounting,'Importação altera somente o Fiscal; Contábil salvo permanece intacto.');
      const viewed=await getAnalysis(item.id,{includeSource:true});
      assert.deepEqual(viewed.analysis.accounting.data,item.accounting.data);
      assert.deepEqual(await(await collection('analysisRevisions')).find(scope({analysisId:item.id,kind:'accounting'})).toArray(),historyBefore);
      const generated=await generateAnalysis(actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision});
      assert.equal(generated.simulation.monthlyInputs.length,9);
      assert(generated.simulation.monthlyInputs.every((row:any)=>row.values.salaries===1000));
      assert.equal(generated.simulation.result.regimes[0].dre.salaries,-9000);
      const snapshot=structuredClone(await getSimulation(generated.simulation._id));
      item=(await save(generated.analysis,'accounting',data(2025,120000))).analysis;
      const next=await generateAnalysis(actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision});
      assert.equal(next.simulation.result.regimes[0].dre.salaries,-10800);
      assert.equal(next.simulation.parentSimulationId,snapshot._id);
      assert.deepEqual(await getSimulation(snapshot._id),snapshot);
      assert.equal((await analysisVersions(item.id,1)).items.length,2);
    });
    await t.test('Fiscal primeiro: média recebida com ano provisório é gravada no ano correto do relatório',async()=>{
      let item=await reports(await fresh('98502'),2024);
      item=(await save(item,'accounting',data(2026))).analysis;
      assert.equal(item.readiness.ready,true);
      const raw=(await(await collection('analyses')).findOne(scope({_id:item.id})))!;
      assert.deepEqual(raw.accounting.data.months.map((row:any)=>row.sourceMonth),analysisMonthsForYear(2024));
      const generated=await generateAnalysis(actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision});
      assert.equal(generated.simulation.result.regimes[0].dre.salaries,-9000);
    });
    await t.test('rascunho incompleto é preservado ao importar, sem transformar pendência em zero',async()=>{
      let item=await fresh('98503');const draft=data(2026) as any;
      draft.monthlyAverage.values.benefitsCents=null;draft.months.forEach((row:any)=>{row.benefitsCents=null;});
      item=(await save(item,'accounting',draft,false)).analysis;
      const before=structuredClone(item.accounting.data.monthlyAverage);
      item=await reports(item,2025);
      assert.deepEqual(item.accounting.data.monthlyAverage,before);
      assert(item.accounting.data.months.every(row=>row.benefitsCents===null&&row.salariesCents===100000));
      assert.equal(item.accounting.status,'DRAFT');assert.equal(item.readiness.ready,false);
    });
    await t.test('salvamentos dos setores independentes preservam ambos; revisão antiga não sobrescreve alteração nova',async()=>{
      let item=await fresh('98504');
      await Promise.all([save(item,'accounting',data(2026),false),save(item,'fiscal',item.fiscal.data,false)]);
      item=(await getAnalysis(item.id,options)).analysis;
      assert.equal(item.accounting.revision,1);assert.equal(item.fiscal.revision,1);
      const previous=structuredClone(item);
      item=(await save(item,'accounting',data(2026,150000),false)).analysis;
      await assert.rejects(save(previous,'accounting',data(2026,250000),false),(error:any)=>error.code==='ANALYSIS_CONFLICT');
      assert.equal((await getAnalysis(item.id,options)).analysis.accounting.data.monthlyAverage!.values.salariesCents,150000);
      const revisions=await(await collection('analysisRevisions')).find(scope({analysisId:item.id,kind:'accounting'})).sort({revision:1}).toArray();
      assert.deepEqual(revisions.map(row=>row.data.data.monthlyAverage.values.salariesCents),[100000,150000]);
    });
    await t.test('lançamentos antigos só mudam ao salvar a média; revisões originais mantêm cada valor',async()=>{
      let item=await fresh('98505');
      const months=analysisMonthsForYear(2025).map((sourceMonth,index)=>({sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(key=>[key,key==='salariesCents'?(index+1)*10000:0]))}));
      item=(await save(item,'accounting',{months})).analysis;
      const original=structuredClone(item.accounting);
      item=await reports(item,2025);
      assert.deepEqual(item.accounting,original);
      item=(await save(item,'accounting',data(2025,50000))).analysis;
      const revisions=await(await collection('analysisRevisions')).find(scope({analysisId:item.id,kind:'accounting'})).sort({revision:1}).toArray();
      assert.deepEqual(revisions[0].data,original);
      assert.equal(revisions[1].data.data.monthlyAverage.values.salariesCents,50000);
    });
  }finally{await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;}
});
