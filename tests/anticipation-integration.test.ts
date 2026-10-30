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
import {ANTICIPATION_VERSION,ANTICIPATION_CPF_CNPJ_VERSION,ANTICIPATION_PREVIOUS_VERSION,ANTICIPATION_LEGACY_VERSION} from '../src/icms-anticipation.ts';
import {DIFAL_VERSION,DIFAL_CATALOG_VERSION,DIFAL_PREVIOUS_VERSION} from '../src/difal.ts';

const actor={_id:'anticipation-test',role:'admin',name:'Teste',email:'test@example.test'};
const cnpj='00000000000191';
const row=(totalCents=100005,extra:Record<string,unknown>={})=>({document:'123.456.789-01',name:'Fornecedor sintético',natureCode:'1102009',recipientUf:'SP',
 serviceDate:'2026-08-15',quantity:'1',grossCents:totalCents,totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,...extra});
const errorCode=(code:string)=>(error:any)=>error.code===code;

test('Antecipação compras V4: CPF e CNPJ, exclusão 8000, UF, snapshot, CSV, retomada e versões históricas', {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
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
  assert.deepEqual(summary.anticipation,{version:ANTICIPATION_VERSION,ratePercent:7.32,issuerUf:'MG',eligibleLines:2,baseCents:200010,amountCents:14640,pendingLines:1});
  assert.deepEqual(summary.job.purchaseInput.anticipation,summary.anticipation);
  assert.equal(summary.anticipationOrigin,'IMPORTED');
  assert.equal(summary.totals.totalCents,237760);assert.equal(providerCalls,1,'Somente CNPJ vai ao provedor; CPF não cria consulta.');
  const details=await purchaseRows(job._id,'ALL',1,true);
  assert.deepEqual(details.items.map((row:any)=>row.anticipation.reason),['ELIGIBLE','SAME_UF','ELIGIBLE','NOT_CPF_OR_CNPJ','NOT_CPF_OR_CNPJ','SERVICE_PURCHASE_EXCLUDED','NOT_PURCHASE','MISSING_RECIPIENT_UF']);
  assert(details.items.every((row:any)=>row.anticipationOrigin==='IMPORTED'));
  const grouped=await purchaseRows(job._id,'ALL',1),cpf=grouped.items.find((row:any)=>row.documentKind==='CPF');
  assert.deepEqual(cpf.anticipation,{baseCents:100005,amountCents:7320,eligibleLines:1,pendingLines:1});
  const csv=await purchaseExport(job._id,'ALL',1);
  assert(csv.content.includes('Antecipação de ICMS'));assert(csv.content.includes('"NOT_CPF_OR_CNPJ"'));assert(csv.content.includes('"73,20"'));assert(csv.content.includes(ANTICIPATION_VERSION));
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
   assert.equal(months![0].difal.amountCents,0);
   await jobs.updateOne(scope({_id:purchase._id}),{$unset:{anticipationVersion:'',issuerUf:'','purchaseInput.anticipation':''}});
   await lines.updateMany(scope({jobId:purchase._id}),{$unset:{anticipation:''}});
   const derived=await purchaseSummary(purchase._id),derivedMonths=await monthlyReportSource(derived,sales,undefined,'MG');
   assert.equal(derived.anticipationOrigin,'DERIVED_FROM_SNAPSHOT');
   assert.equal(derived.anticipation?.issuerUf,'');assert.equal(derived.anticipation?.pendingLines,1);
   assert.deepEqual(derivedMonths![0].anticipation,derived.anticipation,'A UF das vendas não substitui a UF ausente das compras.');
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
   for(const version of [undefined,ANTICIPATION_LEGACY_VERSION,ANTICIPATION_PREVIOUS_VERSION,ANTICIPATION_CPF_CNPJ_VERSION]){
    const old=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'legado.csv',expectedRows:1,issuerUf:'MG'},PURCHASE_MODE);
    await jobs.updateOne(scope({_id:old._id}),version?{$set:{anticipationVersion:version}}:{$unset:{anticipationVersion:''}});
    const payload={offset:0,rows:[row(20000,{document:cnpj})]};
    await uploadLookup(actor,old._id,payload);
    const staged=await (await collection('lookupStage')).findOne(scope({jobId:old._id,index:0}));
    assert.equal(Object.hasOwn(staged!,'anticipation'),!!version);
    await uploadLookup(actor,old._id,payload);await complete(old._id);
    const oldSummary=await purchaseSummary(old._id);
    assert.equal(oldSummary.anticipation?.version,ANTICIPATION_VERSION);assert.equal(oldSummary.anticipation?.amountCents,1464);
    if(version)assert.equal(oldSummary.job.purchaseInput.anticipation.amountCents,version===ANTICIPATION_PREVIOUS_VERSION?0:1464);
    assert.equal(oldSummary.anticipationOrigin,'DERIVED_FROM_SNAPSHOT');
    assert.equal(Object.hasOwn(oldSummary.job.purchaseInput,'anticipation'),!!version,'Finalizar upload legado não persiste resumo derivado.');
    const repeated=await recheckLookup(actor,old._id);
    assert.equal(repeated.anticipationVersion,version);
    await (await collection('providerControl')).deleteMany({});await processLookup(actor,repeated._id,transport);
    assert.deepEqual((await purchaseSummary(repeated._id)).anticipation,oldSummary.anticipation);
    if(!version)assert((await purchaseExport(old._id,'ALL',1)).content.includes('DERIVED_FROM_SNAPSHOT'));
   }
  });
  await t.test('relatório existente deriva CPF por linha, agrupa, exporta e preserva jobs, linhas e hashes',async()=>{
   const original=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'compras-historicas.csv',expectedRows:7,issuerUf:'MG'},PURCHASE_MODE);
   await jobs.updateOne(scope({_id:original._id}),{$unset:{anticipationVersion:''}});
   const payload={offset:0,rows:[row(7),row(7),row(10000,{natureCode:'8000',recipientUf:''}),row(20000,{document:cnpj}),row(200,{recipientUf:'MG'}),row(500,{recipientUf:''}),row(1000,{natureCode:'1202'})]};
   await uploadLookup(actor,original._id,payload);await uploadLookup(actor,original._id,payload);await complete(original._id);
   const snapshot=async()=>({job:await jobs.findOne(scope({_id:original._id})),rows:await lines.find(scope({jobId:original._id})).sort({index:1}).toArray(),
     chunks:await (await collection('chunks')).find(scope({_id:`lookup:${original._id}:0`})).toArray(),items:await (await collection('lookupItems')).find(scope({jobId:original._id})).sort({_id:1}).toArray()});
   const before=await snapshot(),callsBefore=providerCalls;
   const derived=await purchaseSummary(original._id);
   assert.equal(derived.job.anticipationVersion,undefined);assert.equal(derived.job.purchaseInput.anticipation,undefined);
   assert.equal(derived.anticipationOrigin,'DERIVED_FROM_SNAPSHOT');
   assert.deepEqual(derived.anticipation,{version:ANTICIPATION_VERSION,ratePercent:7.32,issuerUf:'MG',eligibleLines:3,baseCents:20014,amountCents:1466,pendingLines:1});
   assert.equal(derived.purchaseSelection.totals.totalCents,30714,'Serviços sem UF permanecem nas compras consideradas sem gerar antecipação.');
   const detailed=await purchaseRows(original._id,'ALL',1,true),grouped=await purchaseRows(original._id,'ALL',1);
   assert(detailed.items.every((row:any)=>row.anticipationOrigin==='DERIVED_FROM_SNAPSHOT'));
   assert.deepEqual(detailed.items.map((row:any)=>row.anticipation.amountCents),[1,1,0,1464,0,0,0]);
   assert.equal(detailed.items[2].anticipation.reason,'SERVICE_PURCHASE_EXCLUDED');
   assert.deepEqual(grouped.items.find((row:any)=>row.documentKind==='CPF').anticipation,{baseCents:14,amountCents:2,eligibleLines:2,pendingLines:1});
   assert.equal(grouped.items.find((row:any)=>row.documentKind==='CNPJ').anticipation.amountCents,1464);
   const exported=await purchaseExport(original._id,'ALL',1);
   assert(exported.content.includes('DIFAL de entrada — Antecipação de ICMS (R$)'));assert(exported.content.includes('Origem DIFAL de entrada'));
   assert(exported.content.includes('DERIVED_FROM_SNAPSHOT'));assert(exported.content.includes(ANTICIPATION_VERSION));assert(exported.content.includes('Pendente — UF do fornecedor ausente'));
   assert.equal(providerCalls,callsBefore);assert.deepEqual(await snapshot(),before);
   await lines.updateOne(scope({jobId:original._id,index:0}),{$inc:{totalCents:1}});
   try{await assert.rejects(purchaseExport(original._id,'ALL',1),errorCode('PURCHASE_TOTAL'));}
   finally{await lines.updateOne(scope({jobId:original._id,index:0}),{$inc:{totalCents:-1}});}
   const repeated=await recheckLookup(actor,original._id);
   assert.equal(repeated.anticipationVersion,undefined);
   await (await collection('providerControl')).deleteMany({});await processLookup(actor,repeated._id,transport);
   assert.deepEqual((await purchaseSummary(repeated._id)).anticipation,derived.anticipation);
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('metadados históricos ausentes tornam a estimativa inteira indisponível, sem confirmar zero',async()=>{
   const old=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'compras-sem-metadados.csv',expectedRows:2,issuerUf:'MG'},PURCHASE_MODE);
   await jobs.updateOne(scope({_id:old._id}),{$unset:{anticipationVersion:''}});
   await uploadLookup(actor,old._id,{offset:0,rows:[row(10000),row(10000)]});await complete(old._id);
   await jobs.updateOne(scope({_id:old._id}),{$unset:{operationVersion:''}});
   await lines.updateMany(scope({jobId:old._id}),{$unset:{operationVersion:'',natureOperation:''}});
   for(const field of ['natureCode','recipientUf']){
    await lines.updateOne(scope({jobId:old._id,index:1}),{$unset:{[field]:''}});
    const unavailable=await purchaseSummary(old._id);
    assert.equal(unavailable.anticipation,null);assert.equal(unavailable.anticipationOrigin,'UNAVAILABLE');
    for(const detailed of [true,false])assert((await purchaseRows(old._id,'ALL',1,detailed)).items.every((row:any)=>row.anticipation===null&&row.anticipationOrigin==='UNAVAILABLE'));
    const csv=await purchaseExport(old._id,'ALL',1);assert(csv.content.includes('Indisponível — reimporte as compras'));assert(!csv.content.includes(ANTICIPATION_VERSION));
    await lines.updateOne(scope({jobId:old._id,index:1}),{$set:{[field]:field==='natureCode'?'1102':'SP'}});
   }
   for(const invalidIssuer of [null,'sp','XX']){
    await jobs.updateOne(scope({_id:old._id}),{$set:{issuerUf:invalidIssuer}});
    assert.equal((await purchaseSummary(old._id)).anticipationOrigin,'UNAVAILABLE');
   }
   await jobs.updateOne(scope({_id:old._id}),{$unset:{issuerUf:''}});
   assert.equal((await purchaseSummary(old._id)).anticipation?.pendingLines,2);
  });
 }finally{
  await (await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});

test('relatórios históricos mantêm compras e exibem saída desativada depois de validar os impostos originais',
 {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
 process.env.MONGODB_DB='maximum_tax_current_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='tax_current_test';resetLookupIndexes();
 let providerCalls=0;
 const transport=(async(url:string|URL|Request)=>{
  providerCalls++;const identity=String(url).split('/').pop();
  return identity==='12ABC34501DE35'?new Response('',{status:404}):Response.json({cnpj:identity,razao_social:'Empresa sintética',opcao_pelo_simples:false});
 }) as typeof fetch;
 try{
  const clientId=(await importCatalog(actor,[{code:'982',name:'Empresa sintética',uf:'MG'}])).items[0].id;
  const jobs=await collection('lookupJobs'),lines=await collection('purchaseLines');
  for(const [mode,version] of [[SALES_MODE,DIFAL_CATALOG_VERSION],[SALES_MODE,DIFAL_PREVIOUS_VERSION],[PURCHASE_MODE,ANTICIPATION_PREVIOUS_VERSION],[PURCHASE_MODE,ANTICIPATION_LEGACY_VERSION],[PURCHASE_MODE,ANTICIPATION_CPF_CNPJ_VERSION]] as const){
   await t.test(`${mode} ${version}`,async()=>{
    const sales=mode===SALES_MODE,tax=sales?'difal':'anticipation',versionField=tax+'Version',originField=tax+'Origin';
    const currentVersion=sales?DIFAL_VERSION:ANTICIPATION_VERSION,currentAmount=sales?0:3;
    const inputs=[row(7),row(7,{document:cnpj}),row(7,{document:'12.abc.345/01de-35'}),
     row(100,{document:'00000000000192'}),row(100,{document:'123456789012'}),row(100,{document:''}),
     row(100,{document:cnpj,recipientUf:'MG'}),row(100,{document:cnpj,recipientUf:''}),row(100)]
     .map((input,index)=>({...input,natureCode:index===8?(sales?'5405':'8000'):(sales?'6102':'1102'),description:'Mercadoria sintética'}));
    const job=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'historico.csv',expectedRows:inputs.length,issuerUf:'MG'},mode);
    await jobs.updateOne(scope({_id:job._id}),{$set:{[versionField]:version}});
    const payload={offset:0,rows:inputs};await uploadLookup(actor,job._id,payload);await uploadLookup(actor,job._id,payload);
    await finalizeLookup(actor,job._id);await (await collection('providerControl')).deleteMany({});await processLookup(actor,job._id,transport);
    const snapshot=async()=>({job:await jobs.findOne(scope({_id:job._id})),rows:await lines.find(scope({jobId:job._id})).sort({index:1}).toArray(),
     chunks:await (await collection('chunks')).find(scope({_id:`lookup:${job._id}:0`})).toArray(),items:await (await collection('lookupItems')).find(scope({jobId:job._id})).sort({_id:1}).toArray()});
    const before=await snapshot(),callsBefore=providerCalls;
    await (await collection('clients')).updateOne(scope({_id:clientId}),{$set:{uf:'SP'}});
    const summary=await purchaseSummary(job._id,true,mode);
    assert.equal(summary[originField],'DERIVED_FROM_SNAPSHOT');assert.equal(summary[tax]?.version,currentVersion);
    assert.equal(summary[tax]?.amountCents,currentAmount);assert.equal(summary[tax]?.baseCents,sales?0:21);assert.equal(summary[tax]?.pendingLines,sales?0:1);
    assert.equal(summary.job[versionField],version);assert.equal(summary.job.purchaseInput[tax].version,version);
    assert.equal(summary.job.purchaseInput[tax].amountCents,before.job!.purchaseInput[tax].amountCents);
    if(version!==ANTICIPATION_LEGACY_VERSION&&version!==ANTICIPATION_CPF_CNPJ_VERSION)assert.equal(before.rows[1][tax].reason,'NOT_CPF');
    if(version===DIFAL_PREVIOUS_VERSION)assert.equal(before.rows[8].operation,'OUTRAS','Classificação histórica pode diferir do catálogo atual.');
    const detail=await purchaseRows(job._id,'ALL',1,true,mode),grouped=await purchaseRows(job._id,'ALL',1,false,mode);
    assert(detail.items.every((entry:any)=>entry[originField]==='DERIVED_FROM_SNAPSHOT'));
    assert.deepEqual(detail.items.map((entry:any)=>entry[tax].reason),sales?Array(9).fill('OUTGOING_DISABLED'):['ELIGIBLE','ELIGIBLE','ELIGIBLE','NOT_CPF_OR_CNPJ','NOT_CPF_OR_CNPJ','NOT_CPF_OR_CNPJ','SAME_UF','MISSING_RECIPIENT_UF','SERVICE_PURCHASE_EXCLUDED']);
    if(!sales){assert.equal(summary.purchaseSelection.totals.totalCents,621);assert.equal(before.rows[8].anticipation.amountCents,7);}
    assert.equal(grouped.items.reduce((sum:number,entry:any)=>sum+entry[tax].amountCents,0),currentAmount);
    assert.equal(grouped.items.find((entry:any)=>entry.document==='12ABC34501DE35')[tax].amountCents,sales?0:1,'CNPJ alfanumérico com status não confirmado mantém a base fiscal gerencial.');
    const csv=await purchaseExport(job._id,'ALL',1,mode);
    assert(csv.content.includes(currentVersion));assert(!csv.content.includes(version));assert(csv.content.includes('DERIVED_FROM_SNAPSHOT'));
    assert.equal(providerCalls,callsBefore);assert.deepEqual(await snapshot(),before);
    await lines.updateOne(scope({jobId:job._id,index:1}),{$inc:{[tax+'.amountCents']:1}});
    try{await assert.rejects(purchaseRows(job._id,'ALL',1,true,mode),errorCode(sales?'DIFAL_SNAPSHOT':'ANTICIPATION_SNAPSHOT'));}
    finally{await lines.updateOne(scope({jobId:job._id,index:1}),{$inc:{[tax+'.amountCents']:-1}});}
    await jobs.updateOne(scope({_id:job._id}),{$inc:{['purchaseInput.'+tax+'.amountCents']:1}});
    try{await assert.rejects(purchaseExport(job._id,'ALL',1,mode),errorCode(sales?'DIFAL_SNAPSHOT':'ANTICIPATION_SNAPSHOT'));}
    finally{await jobs.updateOne(scope({_id:job._id}),{$inc:{['purchaseInput.'+tax+'.amountCents']:-1}});}
    const repeated=await recheckLookup(actor,job._id);
    assert.equal(repeated[versionField],version);assert.deepEqual(repeated.purchaseInput,before.job!.purchaseInput);
    await (await collection('providerControl')).deleteMany({});await processLookup(actor,repeated._id,transport);
    assert.deepEqual((await purchaseSummary(repeated._id,true,mode))[tax],summary[tax]);assert.deepEqual(await snapshot(),before);
   });
  }
 }finally{
  await (await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});
