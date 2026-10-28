import {test as base,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Account={id:string;email:string;password:string};
const test=base.extend<{finalizationAccount:Account}>({
  finalizationAccount:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account={id:randomUUID(),email:`fiscal-finalization-${randomUUID()}@example.test`,password:`Synthetic-finalization-${randomUUID()}`};
    try{
      await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name:'Equipe sintética finalização',
        role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      await use(account);
    }finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:account.id});
      await db.collection<any>('users').deleteOne({workspaceId,_id:account.id});await mongo.close();
    }
  }
});

async function api(request:APIRequestContext,baseURL:string,method:'GET'|'POST',path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
const documentsUrl=(id:string)=>'/analyses.html?'+new URLSearchParams({id,sector:'fiscal',step:'documents'});
const salesCard=(page:Page)=>page.locator('[data-analysis-document="SALES"]');
const rowCount=3401,unitCents=10001;

/** Persist a fully uploaded synthetic report, intentionally leaving finalization pending. */
async function preparedReport(request:APIRequestContext,baseURL:string,account:Account){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética finalização '+code,uf:'MG'}]})).items[0];
  const analysis=(await api(request,baseURL,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
  const imported=await api(request,baseURL,'POST',`/api/v4/analyses/${analysis.id}/fiscal/import`,{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  const id=randomUUID();
  await api(request,baseURL,'POST',`/api/v4/generations/${imported.generationId}/sales`,{
    importId:id,clientId:company.id,type:'SALES',fileName:'saidas-sinteticas-finalizacao.csv',expectedRows:rowCount,issuerUf:'MG'});
  const rows=Array.from({length:rowCount},(_,index)=>({
    document:'123.456.789-00',name:'Pessoa sintética',serviceDate:`2025-${String(index%9+1).padStart(2,'0')}-15`,
    quantity:'1',natureCode:'5102',description:'Venda sintética de mercadoria',recipientUf:'MG',
    grossCents:unitCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:unitCents
  }));
  for(let offset=0;offset<rows.length;offset+=250){
    const saved=await api(request,baseURL,'POST',`/api/v4/sales/${id}/rows`,{offset,rows:rows.slice(offset,offset+250)});
    expect(saved.uploaded).toBe(Math.min(rowCount,offset+250));
  }
  const job=await api(request,baseURL,'GET',`/api/v4/sales/${id}`);
  expect(job.status).toBe('UPLOADING');expect(job.uploaded).toBe(rowCount);expect(job.summary).toBeUndefined();
  return {analysisId:analysis.id,generationId:imported.generationId,clientId:company.id,jobId:id};
}

function monitorWrites(page:Page){
  const forbidden:string[]=[],finalizations:string[]=[],errors:string[]=[];let choosers=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('filechooser',()=>choosers++);
  page.on('request',request=>{
    if(request.method()!=='POST')return;
    const path=new URL(request.url()).pathname;
    if(/\/api\/v4\/(purchases|sales)\/[^/]+\/finalize$/.test(path))finalizations.push(path);
    if(/\/api\/v4\/(purchases|sales)\/[^/]+\/rows$/.test(path)||/\/api\/v4\/generations\/[^/]+\/(purchases|sales)$/.test(path)||
       /\/api\/v4\/analyses\/[^/]+\/fiscal\/import$/.test(path))forbidden.push(path);
  });
  return {forbidden,finalizations,errors,choosers:()=>choosers};
}

async function expectCompleted(page:Page,baseURL:string,record:Awaited<ReturnType<typeof preparedReport>>){
  await expect(salesCard(page)).toContainText('Leitura concluída',{timeout:45_000});
  await expect(salesCard(page).getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  await expect(page.locator('[data-analysis-document-error="SALES"]')).toHaveCount(0);
  await expect(page).toHaveURL(url=>url.pathname==='/analyses.html'&&url.searchParams.get('id')===record.analysisId);
  const job=await api(page.request,baseURL,'GET',`/api/v4/sales/${record.jobId}`);
  expect(job.status).toBe('COMPLETED');expect(job.uploaded).toBe(rowCount);expect(job.summary.lines).toBe(rowCount);
  expect(job.summary.unique).toBe(0);expect(job.purchaseInput.totalCents).toBe(rowCount*unitCents);
  const summary=await api(page.request,baseURL,'GET',`/api/v4/sales/${record.jobId}/summary`);
  expect(summary.totals.lines).toBe(rowCount);expect(summary.totals.totalCents).toBe(rowCount*unitCents);
  expect(summary.period.startMonth).toBe('2025-01');expect(summary.period.endMonth).toBe('2025-09');
  const generation=await api(page.request,baseURL,'GET',`/api/v4/generations/${record.generationId}`);
  expect(generation.companies[0].sales._id).toBe(record.jobId);expect(generation.companies[0].sales.status).toBe('COMPLETED');
  expect(generation.companies[0].purchase).toBeFalsy();
}

test('Finalizar saídas já enviadas retoma timeout automaticamente, sem pedir arquivo nem duplicar linhas',async({page,baseURL,finalizationAccount})=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const record=await preparedReport(page.request,baseURL!,finalizationAccount),writes=monitorWrites(page);
  const path=`/api/v4/sales/${record.jobId}/finalize`;let injected=false;
  await page.route('**'+path,async route=>{
    if(!injected){injected=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({
      error:'DATABASE_TIMEOUT',message:'O banco de dados excedeu o tempo desta etapa.',retryable:true,requestId:'synthetic-finalization-timeout'})});return;}
    await route.continue();
  });
  await page.goto(documentsUrl(record.analysisId));
  await expect(salesCard(page)).toContainText('Finalização pendente');
  await expect(page.locator('[data-analysis-document-file="SALES"]')).toHaveCount(0);
  await page.locator('[data-analysis-document-retry="SALES"]').click();
  await expectCompleted(page,baseURL!,record);
  expect(injected).toBe(true);expect(writes.finalizations.length).toBeGreaterThan(2);
  expect(new Set(writes.finalizations)).toEqual(new Set([path]));
  expect(writes.forbidden).toEqual([]);expect(writes.choosers()).toBe(0);expect(writes.errors).toEqual([]);
});

test('Reabrir após uma etapa de finalização continua o mesmo documento sem o CSV original',async({page,baseURL,finalizationAccount})=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const record=await preparedReport(page.request,baseURL!,finalizationAccount);
  await page.goto(documentsUrl(record.analysisId));await expect(salesCard(page)).toContainText('Finalização pendente');
  const partial=await api(page.request,baseURL!,'POST',`/api/v4/sales/${record.jobId}/finalize`,{});
  expect(partial.status).toBe('UPLOADING');expect(partial.summary).toBeUndefined();
  expect(partial.finalization.copiedRows).toBeGreaterThan(0);expect(partial.finalization.copiedRows).toBeLessThan(rowCount);
  const writes=monitorWrites(page);
  await page.reload();await expect(page.locator('[data-analysis-document-retry="SALES"]')).toBeVisible();
  await expect(page.locator('[data-analysis-document-file="SALES"]')).toHaveCount(0);
  await page.locator('[data-analysis-document-retry="SALES"]').click();
  await expectCompleted(page,baseURL!,record);
  expect(writes.finalizations.length).toBeGreaterThan(0);
  expect(new Set(writes.finalizations)).toEqual(new Set([`/api/v4/sales/${record.jobId}/finalize`]));
  expect(writes.forbidden).toEqual([]);expect(writes.choosers()).toBe(0);expect(writes.errors).toEqual([]);
});

test('Trocar de empresa após abrir finalização pendente restaura a adição de documentos',async({page,baseURL,finalizationAccount})=>{
  const record=await preparedReport(page.request,baseURL!,finalizationAccount);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const next=(await api(page.request,baseURL!,'POST','/api/v4/clients/import',{
    rows:[{code,name:'Outra empresa sintética '+code,uf:'SP'}]
  })).items[0];
  const writes=monitorWrites(page);
  await page.goto('/purchases.html?'+new URLSearchParams({client:record.clientId,job:record.jobId,type:'SALES'}));
  await expect(page.getByRole('heading',{name:'Concluir a leitura do documento'})).toBeVisible();
  await expect(page.locator('#purchase-import')).toBeHidden();
  await page.locator('#purchase-company').selectOption(next.id);
  await expect(page.locator('#purchase-import')).toBeVisible();
  await expect(page.locator('#purchase-file')).toBeEnabled();
  await expect(page.locator('#purchase-report-view')).toBeEmpty();
  await expect(page).toHaveURL(url=>url.searchParams.get('client')===next.id&&!url.searchParams.has('job'));
  expect((await api(page.request,baseURL!,'GET',`/api/v4/sales/${record.jobId}`)).status).toBe('UPLOADING');
  expect(writes.finalizations).toEqual([]);expect(writes.forbidden).toEqual([]);expect(writes.errors).toEqual([]);
});

for(const guided of [false,true])test(`${guided?'Fluxo guiado':'Histórico'} permite cancelar uma finalização expirada e escolher outro arquivo`,async({page,baseURL,finalizationAccount})=>{
  test.setTimeout(60_000);
  const record=await preparedReport(page.request,baseURL!,finalizationAccount);
  // Model the staging TTL with the real API still reporting the fully uploaded job.
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  try{
    const removed=await mongo.db(process.env.MONGODB_DB).collection('lookupStage').deleteMany({
      workspaceId:process.env.WORKSPACE_ID||'maximum',jobId:record.jobId
    });
    expect(removed.deletedCount).toBe(rowCount);
  }finally{await mongo.close();}
  const writes=monitorWrites(page),cancelPath=`/api/v4/sales/${record.jobId}/cancel`;let cancellations=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===cancelPath)cancellations++;});
  let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;});
  await page.route(`**/api/v4/sales/${record.jobId}/finalize`,async route=>{started();await held;await route.continue();});
  const params=new URLSearchParams({client:record.clientId,job:record.jobId,type:'SALES'});
  if(guided){params.set('generation',record.generationId);params.set('guided','1');}
  await page.goto('/purchases.html?'+params);
  const cancel=page.getByRole('button',{name:guided?'Trocar arquivo':'Cancelar relatório',exact:true});
  await expect(cancel).toBeVisible();
  if(!guided)await page.getByRole('button',{name:'Retomar leitura',exact:true}).click();
  await requested;
  try{
    await expect(cancel).toBeDisabled();await expect(page.locator('#purchase-company')).toBeDisabled();
  }finally{release();}
  await expect(page.locator('#purchase-error')).toContainText('Envio incompleto ou expirado');
  await expect(cancel).toBeEnabled();await expect(page.locator('#purchase-import')).toBeHidden();
  page.once('dialog',async dialog=>{
    expect(dialog.message()).toBe(guided?'Cancelar este relatório para escolher outro arquivo? O progresso atual ficará cancelado no histórico.':
      'Cancelar este relatório? Os registros já salvos ficam no histórico, sem emitir indicadores finais.');
    await dialog.dismiss();
  });
  await cancel.click();expect(cancellations).toBe(0);
  expect((await api(page.request,baseURL!,'GET',`/api/v4/sales/${record.jobId}`)).status).toBe('UPLOADING');
  page.once('dialog',dialog=>dialog.accept());await cancel.click();
  await expect(page.locator('#purchase-import')).toBeVisible();await expect(page.locator('#purchase-file')).toBeEnabled();
  await expect(page.locator('#purchase-finalize')).toHaveCount(0);expect(cancellations).toBe(1);
  expect((await api(page.request,baseURL!,'GET',`/api/v4/sales/${record.jobId}`)).status).toBe('CANCELLED');
  expect(writes.forbidden).toEqual([]);expect(writes.errors).toEqual([]);
});
