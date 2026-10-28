import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {database,collection,scope,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes,getJob} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createLookup,uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {PURCHASE_MODE,SALES_MODE} from '../src/purchase-domain.ts';
import {purchaseSummary} from '../src/purchase-store.ts';
import {digits} from '../src/domain.ts';

const actor={_id:'finalization-tester',role:'admin',name:'Equipe sintética',email:'finalization@example.test'};
const cnpjs=['178654320001','279876540001'].map(base=>base+digits(base));
const copiedFields=['_id','workspaceId','jobId','index','document','documentKind','cnpj','name','serviceDate','quantity',
  'natureCode','description','operation','natureOperation','operationVersion','recipientUf','difal','anticipation',
  'totalCents','balanceCents','valid','kind','grossCents','discountCents','accessoryCents','freightCents','abatementCents'];
const approved=(row:any)=>Object.fromEntries(copiedFields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const opts={skip:!process.env.MONGODB_URI,timeout:120000};
const code=(expected:string)=>(error:any)=>error.code===expected;

async function isolated(run:()=>Promise<void>){
  const previousDb=process.env.MONGODB_DB,previousWorkspace=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_finalize_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='finalization_test';resetLookupIndexes();
  try{await run();}
  finally{await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();process.env.MONGODB_DB=previousDb;process.env.WORKSPACE_ID=previousWorkspace;}
}
function sourceRows(count:number,type=SALES_MODE){
  return Array.from({length:count},(_,index)=>{
    const totalCents=10000+index,document=[cnpjs[0],cnpjs[1],cnpjs[0],'12345678900',''][index%5];
    return {document,name:'Documento sintético '+index,quantity:'1',serviceDate:`2025-${String(index%9+1).padStart(2,'0')}-15`,
      natureCode:type===SALES_MODE?'6102001':'2102001',description:'Conferência sintética por competência',recipientUf:'SP',
      grossCents:totalCents+500,discountCents:600,accessoryCents:99,freightCents:150,abatementCents:50,totalCents};
  });
}
async function uploaded(count:number,type=SALES_MODE){
  const company=(await importCatalog(actor,[{code:String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16)),name:'Empresa sintética de finalização',uf:'MG'}])).items[0];
  assert.equal(company.ok,true);
  const input=sourceRows(count,type),job=await createLookup(actor,{importId:randomUUID(),clientId:company.id,fileName:'relatorio-sintetico.csv',expectedRows:count,issuerUf:'MG'},type);
  for(let offset=0;offset<input.length;offset+=250)await uploadLookup(actor,job._id,{offset,rows:input.slice(offset,offset+250)});
  return {job,input,source:await(await collection('lookupStage')).find(scope({jobId:job._id})).sort({index:1}).toArray()};
}
async function finish(id:string,expectedRows:number){
  let job=await getJob(id),calls=0,previousCopied=0;
  while(job.status==='UPLOADING'){
    assert(calls++<100,'A finalização deve avançar e terminar em um número limitado de chamadas.');
    job=await finalizeLookup(actor,id);
    const count=await(await collection('purchaseLines')).countDocuments(scope({jobId:id}));
    assert(count>=previousCopied&&count<=expectedRows,'As cópias avançam sem duplicar linhas.');previousCopied=count;
    if(job.status==='UPLOADING'){
      assert.equal(job.summary,undefined,'Uma etapa parcial não publica o resumo financeiro.');
      assert.equal(job.purchaseInput,undefined);
      assert.equal(await(await collection('lookupStage')).countDocuments(scope({jobId:id})),expectedRows,'A fonte permanece inteira até a finalização.');
      await assert.rejects(purchaseSummary(id,true,job.mode),code('INCOMPLETE'));
    }
  }
  return {job,calls};
}
async function assertCopies(id:string,source:any[]){
  const rows=await(await collection('purchaseLines')).find(scope({jobId:id})).sort({index:1}).toArray();
  assert.equal(rows.length,source.length);
  assert.deepEqual(rows,source.map(approved),'Cada campo fiscal aprovado mantém exatamente o valor da fonte; não copia TTL ou campos extras.');
}

test('Finalização financeira grande avança por partes e preserva valores, competências e isolamento',opts,async()=>isolated(async()=>{
  const {job,input,source}=await uploaded(3401);
  const first=await finalizeLookup(actor,job._id);
  assert.equal(first.status,'UPLOADING','Um arquivo grande libera a requisição antes de copiar todas as linhas.');
  assert.equal(first.summary,undefined);assert.equal(first.purchaseInput,undefined);
  const copied=await(await collection('purchaseLines')).countDocuments(scope({jobId:job._id}));
  assert(copied>0&&copied<input.length,'A primeira chamada salva somente uma parte do arquivo.');
  assert.equal(await(await collection('lookupStage')).countDocuments(scope({jobId:job._id})),input.length);

  const saved=await getJob(job._id),workspace=process.env.WORKSPACE_ID;
  process.env.WORKSPACE_ID='another_workspace';
  try{await assert.rejects(finalizeLookup(actor,job._id));}finally{process.env.WORKSPACE_ID=workspace;}
  await assert.rejects(finalizeLookup({...actor,role:'viewer'},job._id),code('FORBIDDEN'));
  assert.deepEqual(await getJob(job._id),saved,'Recusas de acesso não alteram progresso ou resumo.');

  const {job:ready,calls}=await finish(job._id,input.length);assert(calls>0);assert.equal(ready.status,'PROCESSING');
  await assertCopies(job._id,source);
  assert.equal(ready.purchaseInput.totalCents,input.reduce((sum,row)=>sum+row.totalCents,0));
  assert.deepEqual(ready.reportPeriod,{startDate:'2025-01-15',endDate:'2025-09-15',startMonth:'2025-01',endMonth:'2025-09',months:9,observedMonths:9,missingMonths:[]});
  assert.equal(ready.summary.lines,input.length);assert.equal(ready.summary.unique,2);
  assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:job._id})),2);
  assert.equal(await(await collection('lookupStage')).countDocuments(scope({jobId:job._id})),0);
  const once=structuredClone(await getJob(job._id));await finalizeLookup(actor,job._id);assert.deepEqual(await getJob(job._id),once,'Uma resposta perdida pode ser repetida sem refazer o relatório.');

  let requests=0;await(await collection('providerControl')).deleteMany({});
  const completed=await processLookup(actor,job._id,(async(url:string|URL|Request)=>{
    requests++;const cnpj=String(url).split('/').pop();return Response.json({cnpj,razao_social:'CNPJ sintético',opcao_pelo_simples:cnpj===cnpjs[0]});
  }) as typeof fetch);
  assert.equal(completed.status,'COMPLETED');assert.equal(requests,2);
  const report=await purchaseSummary(job._id,true,SALES_MODE);
  assert.equal(report.totals.totalCents,input.reduce((sum,row)=>sum+row.totalCents,0));
  assert.equal(report.totals.lines,input.length);assert.equal(report.totals.uniqueCnpjs,2);
  assert.equal(report.reportingGroups.reduce((sum:any,group:any)=>sum+group.totalCents,0),report.totals.totalCents);
}));

test('Retomada após a cópia persistir e a resposta falhar não duplica nem perde linhas',opts,async(t)=>isolated(async()=>{
  const {job,input,source}=await uploaded(3001,PURCHASE_MODE);
  const bulkWrite=Collection.prototype.bulkWrite;let injected=false;
  const failure=t.mock.method(Collection.prototype,'bulkWrite',async function(this:Collection,...args:any[]){
    const result=await (bulkWrite as any).apply(this,args);
    if(!injected&&this.collectionName==='purchaseLines'){
      injected=true;throw Object.assign(new Error('Resposta da cópia perdida depois da gravação'),{code:89});
    }
    return result;
  });
  try{
    await assert.rejects(async()=>{
      for(let attempt=0;attempt<30&&!injected;attempt++)await finalizeLookup(actor,job._id);
    },/Resposta da cópia perdida/);
  }finally{failure.mock.restore();}
  assert.equal(injected,true);
  const count=await(await collection('purchaseLines')).countDocuments(scope({jobId:job._id}));assert(count>0&&count<input.length);
  assert.equal((await getJob(job._id)).status,'UPLOADING');
  assert.equal(await(await collection('lookupStage')).countDocuments(scope({jobId:job._id})),input.length);
  const {job:ready}=await finish(job._id,input.length);assert.equal(ready.status,'PROCESSING');
  await assertCopies(job._id,source);
  assert.equal(ready.purchaseInput.totalCents,input.reduce((sum,row)=>sum+row.totalCents,0));
  assert.equal(await(await collection('lookupJobs')).countDocuments(scope({clientId:job.clientId})),1);
}));

test('Finalização retoma uma cópia parcial legada sem checkpoint nem substituição do lote',opts,async()=>isolated(async()=>{
  const {job,input,source}=await uploaded(3007);
  // Mirrors an earlier interrupted $merge: approved rows already exist, with no new progress marker.
  await(await collection('purchaseLines')).insertMany(source.slice(0,137).map(approved) as any);
  assert.equal((await getJob(job._id)).finalization,undefined);
  const {job:ready}=await finish(job._id,input.length);
  assert.equal(ready._id,job._id);assert.equal(ready.status,'PROCESSING');
  await assertCopies(job._id,source);
  assert.equal(ready.purchaseInput.totalCents,input.reduce((sum,row)=>sum+row.totalCents,0));
  assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:job._id})),2);
}));

test('A finalização parcial continua bloqueando componentes adulterados sem publicar resumo',opts,async()=>isolated(async()=>{
  const {job,input}=await uploaded(3001);
  assert.equal((await finalizeLookup(actor,job._id)).status,'UPLOADING');
  await(await collection('lookupStage')).updateOne(scope({jobId:job._id,index:input.length-1}),{$inc:{grossCents:1}});
  await assert.rejects(finish(job._id,input.length),code('PURCHASE_TOTAL'));
  const saved=await getJob(job._id);assert.equal(saved.status,'UPLOADING');assert.equal(saved.summary,undefined);assert.equal(saved.purchaseInput,undefined);
  assert.equal(await(await collection('lookupStage')).countDocuments(scope({jobId:job._id})),input.length);
}));

test('Mais de 500 CNPJs são preparados em partes e a resposta perdida não duplica consultas',opts,async(t)=>isolated(async()=>{
  const company=(await importCatalog(actor,[{code:String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16)),name:'Empresa sintética de consultas',uf:'MG'}])).items[0];
  assert.equal(company.ok,true);
  const identities=Array.from({length:501},(_,index)=>{const base='A'+String(18000000000+index);return base+digits(base);});
  const input=sourceRows(1501).map((row,index)=>({...row,document:identities[index%identities.length]}));
  const job=await createLookup(actor,{importId:randomUUID(),clientId:company.id,fileName:'consultas-sinteticas.csv',expectedRows:input.length,issuerUf:'MG'},SALES_MODE);
  for(let offset=0;offset<input.length;offset+=250)await uploadLookup(actor,job._id,{offset,rows:input.slice(offset,offset+250)});
  const source=await(await collection('lookupStage')).find(scope({jobId:job._id})).sort({index:1}).toArray();
  let ready=await getJob(job._id);
  while(ready.finalization?.phase!=='PREPARING')ready=await finalizeLookup(actor,job._id);
  assert.equal(ready.summary,undefined);assert.equal(ready.finalization.preparedCnpjs,0);
  const original=Collection.prototype.bulkWrite;let injected=false;
  const failure=t.mock.method(Collection.prototype,'bulkWrite',async function(this:Collection,...args:any[]){
    const result=await(original as any).apply(this,args);
    if(!injected&&this.collectionName==='lookupItems'){injected=true;throw new Error('Resposta perdida após preparar as consultas');}
    return result;
  });
  try{await assert.rejects(finalizeLookup(actor,job._id),/Resposta perdida após preparar/);}finally{failure.mock.restore();}
  assert.equal(injected,true);assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:job._id})),500);
  assert.equal((await getJob(job._id)).finalization.preparedCnpjs,0,'A resposta perdida não confirma um checkpoint que não foi salvo.');
  const retried=await finalizeLookup(actor,job._id);
  assert.equal(retried.status,'UPLOADING');assert.match(retried.finalization.lastCnpj,/^A/);assert.equal(retried.finalization.preparedCnpjs,500);assert.equal(retried.summary,undefined);
  assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:job._id})),500);
  ready=(await finish(job._id,input.length)).job;
  assert.equal(ready.status,'PROCESSING');assert.equal(ready.summary.unique,501);assert.equal(ready.summary.lines,input.length);
  assert.equal(ready.purchaseInput.totalCents,input.reduce((sum,row)=>sum+row.totalCents,0));
  assert.equal(ready.purchaseInput.cnpjCents,ready.purchaseInput.totalCents);
  const items=await(await collection('lookupItems')).find(scope({jobId:job._id})).toArray();assert.equal(items.length,501);
  const expected=new Map<string,{lines:number;totalCents:number}>();
  for(const row of input){const value=expected.get(row.document)||{lines:0,totalCents:0};value.lines++;value.totalCents+=row.totalCents;expected.set(row.document,value);}
  for(const item of items){const value=expected.get(item.cnpj)!;assert.equal(item.occurrences,value.lines);assert.equal(item.totalCents,value.totalCents);assert.equal(item.state,'PENDING');assert.equal(item.attempts,0);}
  assert.equal(await(await collection('cnpjStates')).countDocuments(scope()),0,'Preparar as consultas não consulta a fonte externa.');
  await assertCopies(job._id,source);
}));
