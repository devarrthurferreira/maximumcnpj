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
import {refreshSimulation,reprocessSimulations} from '../src/simulation-reprocessing.ts';

const code=(value:string)=>(error:any)=>error.code===value;
const row=(sourceMonth:string,salariesCents=10000)=>({sourceMonth,salariesCents,rentCents:0,cardExpensesCents:0,benefitsCents:5000,adminExpensesCents:0,financialExpensesCents:0,financialIncomeCents:0});
test('MongoDB DRE parcial: confirmação, fontes ausentes, dados preservados e última versão',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_partial_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='partial_test';resetLookupIndexes();
  const actor={_id:'operator',role:'operator',name:'Operador sintético',email:'partial@example.test'};
  const admin={...actor,role:'admin'},selection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
  let item:any,accountingOnly:any;
  const patch=async(kind:'fiscal'|'accounting',data:any,complete=true)=>{
    item=(await updateAnalysisSector(actor,item.id,kind,{expectedSectorRevision:item[kind].revision,expectedConfigRevision:item.config.revision,complete,data})).analysis;
  };
  const generate=(missing?:string[])=>generateAnalysis(actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision,...(missing?{confirmedMissingSectors:missing}:{})});
  async function fiscalReports(){
    const imported=await importAnalysisGeneration(actor,item.id,{expectedSectorRevision:item.fiscal.revision,expectedConfigRevision:item.config.revision});item=imported.analysis;
    for(const [attach,nature,amount] of [[attachGenerationPurchase,'1102',20000],[attachGenerationSale,'5102',100000]] as const){
      const {job}=await attach(actor,imported.generationId,{clientId:item.clientId,importId:randomUUID(),fileName:`${nature}.csv`,expectedRows:2});
      await uploadLookup(actor,job._id,{offset:0,rows:['2026-01','2026-03'].map(sourceMonth=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:sourceMonth+'-15',natureCode:nature,quantity:'1',totalCents:amount,grossCents:amount,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
      await finalizeLookup(actor,job._id);await processLookup(actor,job._id,(async()=>{throw new Error('CPF sintético não consulta provedor.');}) as typeof fetch);
    }
    await patch('fiscal',item.fiscal.data);
  }
  try{
    const imported=await importCatalog(admin,[{code:'99801',name:'Empresa Contábil primeiro',uf:'MG'},{code:'99802',name:'Empresa Fiscal primeiro',uf:'MG'}]);
    const [clientId,otherId]=imported.items.map((value:any)=>value.id);
    item=(await openAnalysis(actor,{clientId,year:2027,regimeSelection:selection})).analysis;
    await t.test('nenhum setor concluído bloqueia geração mesmo com confirmação forjada',async()=>{
      assert.equal(item.readiness.partial.allowed,false);await assert.rejects(generate(['fiscal']),code('ANALYSIS_NOT_READY'));
    });
    await t.test('Contábil concluído gera todas as linhas com aviso e sem inventar fontes fiscais',async()=>{
      await patch('accounting',{months:[row('2026-01'),row('2026-03',20000)]});
      assert.deepEqual(item.readiness.partial,{allowed:true,missingSectors:['fiscal']});
      await assert.rejects(generate(),code('ANALYSIS_NOT_READY'));await assert.rejects(generate(['accounting']),code('ANALYSIS_NOT_READY'));
      const generated=await generate(['fiscal']);item=generated.analysis;accountingOnly=generated.simulation;
      assert.equal(item.currentSimulation.stale,false);assert.equal(item.fiscal.status,'DRAFT');assert.equal(item.fiscal.data.generationId,null);
      assert.equal(accountingOnly.generationId,null);assert.equal(accountingOnly.source.sourceKind,'ACCOUNTING_ONLY');
      assert.equal(accountingOnly.source.purchases.jobId,null);assert.equal(accountingOnly.source.sales.jobId,null);
      assert.deepEqual(accountingOnly.analysisPeriod.includedMonths,['2026-01','2026-03']);
      assert.deepEqual(accountingOnly.partialData.missingSectors,['fiscal']);
      assert.ok(accountingOnly.result.warnings.some((value:any)=>value.code==='analysis-partial-sectors'));
      for(const regime of accountingOnly.result.regimes){assert.equal(regime.dre.salaries,-300);assert.equal(regime.dre.benefits,-100);assert.equal(regime.dre.revenue,0);}
      assert.equal(await(await collection('generations')).countDocuments(scope({clientId})),0);
      assert.equal(await(await collection('lookupJobs')).countDocuments(scope({clientId})),0);
      assert.deepEqual((await getSimulation(accountingOnly._id)).partialData,accountingOnly.partialData);
      assert.equal((await getAnalysis(item.id)).analysis.currentSimulation!.stale,false);
      assert.equal((await refreshSimulation(actor,accountingOnly._id,{})).simulation._id,accountingOnly._id);
      const reprocessing=await reprocessSimulations(actor,{});assert.equal(reprocessing.total,0,'Sem fontes fiscais, a DRE parcial não entra na fila de recálculo fiscal.');
    });
    await t.test('preencher Fiscal depois preserva Contábil e substitui a DRE parcial',async()=>{
      const accounting=structuredClone(item.accounting.data);await fiscalReports();
      assert.equal(item.readiness.ready,true);assert.deepEqual(item.accounting.data,accounting);
      const full=await generate();item=full.analysis;
      assert.equal(full.simulation.partialData,undefined);assert.equal(full.simulation.result.annualRevenue,2000);
      assert.deepEqual(item.accounting.data,accounting);assert.equal((await analysisVersions(item.id,1)).pagination.total,1);
      await assert.rejects(getSimulation(accountingOnly._id),code('NOT_FOUND'));
    });
    await t.test('Fiscal primeiro ignora rascunho contábil somente após confirmação explícita',async()=>{
      item=(await openAnalysis(actor,{clientId:otherId,year:2027,regimeSelection:selection})).analysis;
      await patch('accounting',{months:[row('2026-01',999999)]},false);await fiscalReports();
      assert.deepEqual(item.readiness.partial,{allowed:true,missingSectors:['accounting']});
      await assert.rejects(generate(),code('ANALYSIS_NOT_READY'));
      const generated=await generate(['accounting']);
      assert.deepEqual(generated.simulation.partialData.missingSectors,['accounting']);
      for(const regime of generated.simulation.result.regimes){assert.equal(regime.dre.salaries,0);assert.equal(regime.dre.benefits,0);}
      assert.equal(generated.analysis.accounting.data.months[0].salariesCents,999999);assert.equal(generated.analysis.accounting.status,'DRAFT');
      assert.equal(await(await collection('simulations')).countDocuments(scope({clientId})),1,'A outra empresa permanece intacta.');
    });
    await t.test('Fiscal marcado concluído com origem inválida não autoriza ignorar erro na fonte',async()=>{
      await(await collection('generations')).deleteOne(scope({_id:item.fiscal.data.generationId}));
      const read=(await getAnalysis(item.id)).analysis;assert.equal(read.readiness.partial.allowed,false);
      await assert.rejects(generate(['accounting']),code('ANALYSIS_NOT_READY'));
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
