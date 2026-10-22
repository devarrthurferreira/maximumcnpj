import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,collection,scope,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createLookup,uploadLookup,finalizeLookup,processLookup,recheckLookup} from '../src/lookup-jobs.ts';
import {createGeneration,attachGenerationPurchase,getGeneration} from '../src/generation-store.ts';
import {PURCHASE_MODE,SALES_MODE} from '../src/purchase-domain.ts';
import {monthlyReportSource} from '../src/simulation-monthly-source.ts';
import {purchaseSummary,purchaseRows,purchaseExport} from '../src/purchase-store.ts';
import {ANTICIPATION_VERSION,ANTICIPATION_LEGACY_VERSION} from '../src/icms-anticipation.ts';

const actor={_id:'anticipation-test',role:'admin',name:'Teste',email:'test@example.test'};
const cnpj='00000000000191';
const row=(totalCents=100005,extra:Record<string,unknown>={})=>({document:'123.456.789-01',name:'Fornecedor sintético',natureCode:'1102009',recipientUf:'SP',
 serviceDate:'2026-08-15',quantity:'1',grossCents:totalCents,totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,...extra});
const errorCode=(code:string)=>(error:any)=>error.code===code;

test('Antecipação compras V2: CPF, catálogo, UF, snapshot, CSV, retomada e versões históricas', {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
 process.env.MONGODB_DB='maximum_anticipation_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='anticipation_test';resetLookupIndexes();
 let providerCalls=0;
 const transport=(async()=>{providerCalls++;return Response.json({cnpj,razao_social:'Empresa sintética',opcao_pelo_simples:true});}) as typeof fetch;
 const complete=async(id:string)=>{await finalizeLookup(actor,id);await (await collection('providerControl')).deleteMany({});return processLookup(actor,id,transport);};
 try{
  const clientId=(await importCatalog(actor,[{code:'981',name:'Empresa sintética',uf:'MG'}])).items[0].id;
  const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
  const inputs=[row(100005,{anticipation:{eligible:false,amountCents:0,baseCents:0,reason:'NOT_CPF'}}),row(20000,{recipientUf:'MG'}),
   row(100005,{document:cnpj}),row(10000,{document:'',recipientUf:''}),row(5000,{document:'123456789012',recipientUf:''}),
   row(1250,{natureCode:'8000102'}),row(1000,{natureCode:'1202'}),row(500,{recipientUf:''})];
  const input={clientId,importId:randomUUID(),fileName:'compras-sinteticas.csv',expectedRows:inputs.length,issuerUf:'MG'};
  const attached=await attachGenerationPurchase(actor,generation._id,input),job=attached.job;
  assert.equal(job.anticipationVersion,ANTICIPATION_VERSION);
  assert.equal(attached.generation.companies[0].purchase.anticipationVersion,ANTICIPATION_VERSION);
  await uploadLookup(actor,job._id,{offset:0,rows:inputs});await uploadLookup(actor,job._id,{offset:0,rows:inputs});
  await complete(job._id);
  const summary=await purchaseSummary(job._id),lines=await collection('purchaseLines'),jobs=await collection('lookupJobs');
  assert.deepEqual(summary.anticipation,{version:ANTICIPATION_VERSION,ratePercent:7.32,issuerUf:'MG',eligibleLines:2,baseCents:101255,amountCents:7412,pendingLines:1});
  assert.deepEqual(summary.job.purchaseInput.anticipation,summary.anticipation);
  assert.equal(summary.totals.totalCents,237760);assert.equal(providerCalls,1,'Somente CNPJ vai ao provedor; CPF não cria consulta.');
  const details=await purchaseRows(job._id,'ALL',1,true);
  assert.deepEqual(details.items.map((row:any)=>row.anticipation.reason),['ELIGIBLE','SAME_UF','NOT_CPF','NOT_CPF','NOT_CPF','ELIGIBLE','NOT_PURCHASE','MISSING_RECIPIENT_UF']);
  const grouped=await purchaseRows(job._id,'ALL',1),cpf=grouped.items.find((row:any)=>row.documentKind==='CPF');
  assert.deepEqual(cpf.anticipation,{baseCents:101255,amountCents:7412,eligibleLines:2,pendingLines:1});
  const csv=await purchaseExport(job._id,'ALL',1);
  assert(csv.content.includes('Antecipação de ICMS'));assert(csv.content.includes('"NOT_CPF"'));assert(csv.content.includes('"73,20"'));assert(csv.content.includes('ICMS_ANTICIPATION_V2'));
  assert.equal((await getGeneration(generation._id)).companies[0].purchase.anticipationVersion,ANTICIPATION_VERSION);

  await t.test('DRE mantém pendência da UF das compras mesmo quando vendas têm UF confirmada',async()=>{
   const purchase=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'compras-sem-uf.csv',expectedRows:1,issuerUf:''},PURCHASE_MODE);
   const sale=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'vendas-com-uf.csv',expectedRows:1,issuerUf:'MG'},SALES_MODE);
   await uploadLookup(actor,purchase._id,{offset:0,rows:[row(10000)]});await complete(purchase._id);
   await uploadLookup(actor,sale._id,{offset:0,rows:[row(100000,{natureCode:'6102'})]});await complete(sale._id);
   const purchases=await purchaseSummary(purchase._id),sales=await purchaseSummary(sale._id,true,SALES_MODE);
   assert.equal(purchases.anticipation?.pendingLines,1);
   const months=await monthlyReportSource(purchases,sales,undefined,'MG');
   assert.deepEqual(months![0].anticipation,purchases.anticipation);
   assert.equal(months![0].anticipation.amountCents,0);
   assert.equal(months![0].difal.amountCents,10000);
  });

  await t.test('servidor rejeita imposto ou resumo adulterado e mantém a fonte original na reconsulta',async()=>{
   const before=await lines.find(scope({jobId:job._id})).sort({index:1}).toArray();
   await lines.updateOne(scope({jobId:job._id,index:0}),{$inc:{'anticipation.amountCents':1}});
   try{await assert.rejects(purchaseSummary(job._id),errorCode('ANTICIPATION_SNAPSHOT'));}
   finally{await lines.updateOne(scope({jobId:job._id,index:0}),{$inc:{'anticipation.amountCents':-1}});}
   await jobs.updateOne(scope({_id:job._id}),{$inc:{'purchaseInput.anticipation.amountCents':1}});
   try{await assert.rejects(purchaseExport(job._id,'ALL',1),errorCode('ANTICIPATION_SNAPSHOT'));}
   finally{await jobs.updateOne(scope({_id:job._id}),{$inc:{'purchaseInput.anticipation.amountCents':-1}});}
   const fresh=await recheckLookup(actor,job._id);assert.equal(fresh.anticipationVersion,ANTICIPATION_VERSION);
   await (await collection('providerControl')).deleteMany({});await processLookup(actor,fresh._id,transport);
   assert.deepEqual((await purchaseSummary(fresh._id)).anticipation,summary.anticipation);
   assert.deepEqual(await lines.find(scope({jobId:job._id})).sort({index:1}).toArray(),before);
  });
  await t.test('V1 mantém regra antiga e ausência de versão não ganha campos ao retomar ou reconsultar',async()=>{
   for(const version of [undefined,ANTICIPATION_LEGACY_VERSION]){
    const old=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'legado.csv',expectedRows:1,issuerUf:'MG'},PURCHASE_MODE);
    await jobs.updateOne(scope({_id:old._id}),version?{$set:{anticipationVersion:version}}:{$unset:{anticipationVersion:''}});
    const payload={offset:0,rows:[row(20000,{document:cnpj})]};
    await uploadLookup(actor,old._id,payload);
    const staged=await (await collection('lookupStage')).findOne(scope({jobId:old._id,index:0}));
    assert.equal(Object.hasOwn(staged!,'anticipation'),!!version);
    await uploadLookup(actor,old._id,payload);await complete(old._id);
    const oldSummary=await purchaseSummary(old._id);
    assert.equal(oldSummary.anticipation?.version,version);assert.equal(oldSummary.anticipation?.amountCents,version?1464:undefined);
    const repeated=await recheckLookup(actor,old._id);
    assert.equal(repeated.anticipationVersion,version);
    await (await collection('providerControl')).deleteMany({});await processLookup(actor,repeated._id,transport);
    assert.deepEqual((await purchaseSummary(repeated._id)).anticipation,oldSummary.anticipation);
    if(!version)assert((await purchaseExport(old._id,'ALL',1)).content.includes('Indisponível — reimporte as compras'));
   }
  });
 }finally{
  await (await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});
