import {test as base,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {processLookup} from '../../src/lookup-jobs.ts';
import {closeDatabase} from '../../src/store.ts';

const test=base.extend<{account:{id:string;email:string;password:string}}>({account:async({},use)=>{
  if(!process.env.MONGODB_URI?.includes('127.0.0.1'))throw new Error('Use MongoDB local descartável.');
  const mongo=new MongoClient(process.env.MONGODB_URI);await mongo.connect();
  const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
  const account={id:randomUUID(),email:`choice-${randomUUID()}@example.test`,password:`Synthetic-${randomUUID()}`};
  try{
    await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name:'Teste escolha DIFAL',role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
    await use(account);
  }finally{await db.collection('sessions').deleteMany({workspaceId,userId:account.id});await db.collection<any>('users').deleteOne({_id:account.id,workspaceId});await mongo.close();}
}});
test.afterAll(async()=>closeDatabase());
async function api(request:APIRequestContext,baseURL:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function fresh(request:APIRequestContext,baseURL:string,account:any){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Conferência sintética '+code,uf:'MG'}]})).items[0];
  return (await api(request,baseURL,'POST','/api/v4/analyses',{clientId:company.id,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid']},difalChoice:null})).analysis;
}
async function attach(request:APIRequestContext,baseURL:string,analysis:any,generationId:string,type:'purchases'|'sales',document:string,recipientUf:string){
  const attached=await api(request,baseURL,'POST',`/api/v4/generations/${generationId}/${type}`,{importId:randomUUID(),clientId:analysis.clientId,fileName:`synthetic-${type}.csv`,expectedRows:1,issuerUf:'MG'});
  const totalCents=type==='purchases'?100000:200000;
  await api(request,baseURL,'POST',`/api/v4/${type}/${attached.job._id}/rows`,{offset:0,rows:[{document,name:'Operação sintética',recipientUf,serviceDate:'2025-01-15',natureCode:type==='sales'?'5102001':'1102001',description:'Operação sintética',quantity:'1',grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents}]});
  let job=await api(request,baseURL,'POST',`/api/v4/${type}/${attached.job._id}/finalize`,{});
  if(job.status!=='COMPLETED'){
    const actor=(await api(request,baseURL,'GET','/api/auth/session')).user;
    job=await processLookup(actor,attached.job._id,(async()=>Response.json({cnpj:'00000000000191',razao_social:'Fornecedor sintético',opcao_pelo_simples:false})) as typeof fetch);
  }
  expect(job.status).toBe('COMPLETED');
}
async function reports(request:APIRequestContext,baseURL:string,analysis:any,document='00000000000191',recipientUf='SP'){
  const prepared=await api(request,baseURL,'POST',`/api/v4/analyses/${analysis.id}/fiscal/import`,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  await attach(request,baseURL,analysis,prepared.generationId,'purchases',document,recipientUf);
  await attach(request,baseURL,analysis,prepared.generationId,'sales','12345678900','SP');
  return (await api(request,baseURL,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis;
}
const url=(id:string)=>`/analyses.html?id=${id}&sector=fiscal&step=difal`;
const detected=(page:any,direction='entry')=>page.locator(`[data-difal-assessment="${direction}"]`);

test('DIFAL pela leitura: novo rascunho não tem resposta e preparar importação não decide pelo usuário',async({page,baseURL,account})=>{
  const analysis=await fresh(page.request,baseURL!,account);await page.goto(url(analysis.id));
  await expect(detected(page)).toHaveAttribute('data-difal-state','waiting');
  await expect(page.locator('#analysis-difal-yes')).not.toBeChecked();await expect(page.locator('#analysis-difal-no')).not.toBeChecked();
  await expect(page.locator('#analysis-difal-yes')).toBeDisabled();await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveCount(0);
  await api(page.request,baseURL!,'POST',`/api/v4/analyses/${analysis.id}/fiscal/import`,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  await page.reload();await expect(detected(page)).toHaveAttribute('data-difal-state','waiting');
  await expect(page.locator('#analysis-difal-yes')).not.toBeChecked();
  const saved=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis;
  expect(saved.fiscal.data.difalChoice).toBeNull();
  await page.locator('#analysis-difal-documents').click();await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
  await page.locator('#analysis-wizard-next').click();await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','cbs-ibs');
  await page.locator('#analysis-wizard-next').click();await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','difal');
});

test('DIFAL pela leitura: valor antes da escolha, Não persistido e atualização sem alterar preferências',async({page,baseURL,account},info)=>{
  const initial=await fresh(page.request,baseURL!,account),analysis=await reports(page.request,baseURL!,initial);
  await page.goto(url(analysis.id));await expect(detected(page)).toHaveAttribute('data-difal-state','available');
  await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveText('R$ 73,20');
  await expect(page.locator('#analysis-difal-yes')).not.toBeChecked();await expect(page.locator('#analysis-difal-no')).not.toBeChecked();
  await page.locator('button[value="complete"]').click();await expect(page.locator('#analysis-error')).toContainText('escolha Sim ou Não');
  await page.locator('#analysis-difal-no').check();
  const saving=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`);
  await page.locator('button[value="save"]').click();expect((await saving).ok()).toBe(true);
  await page.reload();await expect(page.locator('#analysis-difal-no')).toBeChecked();
  await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveText('R$ 73,20');
  const before=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal;
  await page.locator('#analysis-difal-retry').click();await expect(detected(page)).toHaveAttribute('data-difal-state','available');
  const after=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal;
  expect(after).toEqual(before);await expect(page.locator('#analysis-difal-no')).toBeChecked();
  await expect(page.locator('[data-analysis-difal-operation="exit"]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('difal-detected-before-choice.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('difal-detected-mobile.png'),fullPage:true});
  await expect(page.locator('#analysis-wizard')).toBeVisible();
});

test('DIFAL pela leitura: CPF excluído confirma zero sem selecionar Não pelo usuário',async({page,baseURL,account})=>{
  const analysis=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account),'12345678900');
  await page.goto(url(analysis.id));await expect(detected(page)).toHaveAttribute('data-difal-state','none');
  await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveText('R$ 0,00');
  await expect(page.locator('#analysis-difal-no')).not.toBeChecked();await expect(page.locator('#analysis-difal-yes')).toBeDisabled();
  await expect(detected(page,'exit')).toContainText('não significa ausência de vendas interestaduais');
  const saving=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`);
  await page.locator('button[value="complete"]').click();expect((await saving).ok()).toBe(true);
});

test('DIFAL pela leitura: UF pendente não vira zero e servidor recusa confirmar entrada positiva sem escolha',async({page,baseURL,account})=>{
  const initial=await fresh(page.request,baseURL!,account),positive=await reports(page.request,baseURL!,initial);
  const refused=await page.request.patch(`/api/v4/analyses/${positive.id}/fiscal`,{headers:{Origin:new URL(baseURL!).origin},data:{expectedSectorRevision:positive.fiscal.revision,expectedConfigRevision:positive.config.revision,complete:true,data:positive.fiscal.data}});
  expect(refused.status()).toBe(422);expect((await refused.json()).error).toBe('ANALYSIS_DIFAL_CHOICE');
  const pending=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account),'00000000000191','');
  await page.goto(url(pending.id));await expect(detected(page)).toHaveAttribute('data-difal-state','pending');
  await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveCount(0);await expect(page.locator('#analysis-difal-yes')).toBeDisabled();
});
