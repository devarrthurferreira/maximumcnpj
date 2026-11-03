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


function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
test('abertura mostra carregamento real até a análise chegar',async({page,baseURL,account},info)=>{
  const analysis=await fresh(page.request,baseURL!,account),hold=gate();
  await page.route(`**/api/v4/analyses/${analysis.id}?summary=1`,async route=>{await hold.promise;await route.continue();});
  try{
    await page.goto(url(analysis.id),{waitUntil:'domcontentloaded'});
    await expect(page.locator('#analyses-app .max-loading')).toContainText('Abrindo a análise');
    await page.screenshot({path:info.outputPath('abrindo-analise.png'),fullPage:true});
  }finally{hold.release();}
  await expect(page.locator('#analysis-wizard')).toBeVisible();await expect(page.locator('#analysis-busy-screen')).toBeHidden();
});

test('salvar mostra tela de processamento, evita duplicação e confirma depois da resposta',async({page,baseURL,account},info)=>{
  const analysis=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account));
  await page.goto(url(analysis.id));await expect(detected(page)).toHaveAttribute('data-difal-state','available');
  await page.locator('#analysis-difal-no').check();const hold=gate();let writes=0;
  await page.route(`**/api/v4/analyses/${analysis.id}/fiscal?summary=1`,async route=>{
    if(route.request().method()==='PATCH'){writes++;await hold.promise;}await route.continue();
  });
  try{
    await page.locator('button[value="save"]').click();
    const screen=page.locator('#analysis-busy-screen');await expect(screen).toBeVisible();await expect(screen).toContainText('Salvando o trabalho Fiscal');
    await expect(page.locator('#analysis-fiscal-form')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('button[value="save"]')).toBeDisabled();await expect(page.locator('#analysis-wizard-close')).toBeDisabled();
    await expect(page.locator('#analysis-feedback')).toBeHidden();
    await page.keyboard.press('Enter');expect(writes).toBe(1);
    await page.screenshot({path:info.outputPath('salvando-fiscal.png'),fullPage:true});
  }finally{hold.release();}
  await expect(page.locator('#analysis-busy-screen')).toBeHidden();await expect(page.locator('#analysis-feedback')).toContainText('Fiscal salvo');
  await expect(page.locator('#analysis-difal-no')).toBeChecked();expect(writes).toBe(1);
});

test('erro de gravação fecha carregamento e preserva escolha para nova tentativa',async({page,baseURL,account})=>{
  const analysis=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account));
  await page.goto(url(analysis.id));await expect(detected(page)).toHaveAttribute('data-difal-state','available');
  await page.locator('#analysis-difal-no').check();
  await page.route(`**/api/v4/analyses/${analysis.id}/fiscal?summary=1`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'TEMPORARY',message:'Servidor temporariamente indisponível.'})}));
  await page.locator('button[value="save"]').click();await expect(page.locator('#analysis-error')).toContainText('temporariamente indisponível');
  await expect(page.locator('#analysis-busy-screen')).toBeHidden();await expect(page.locator('#analysis-difal-no')).toBeChecked();await expect(page.locator('button[value="save"]')).toBeEnabled();
  await page.unroute(`**/api/v4/analyses/${analysis.id}/fiscal?summary=1`);
  await page.locator('button[value="save"]').click();await expect(page.locator('#analysis-feedback')).toContainText('Fiscal salvo');
});

test('atualizar conferência mostra atividade sem salvar ou alterar a preferência e adapta ao celular',async({page,baseURL,account},info)=>{
  const analysis=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account));
  await page.setViewportSize({width:390,height:844});await page.goto(url(analysis.id));
  await expect(detected(page)).toHaveAttribute('data-difal-state','available');await expect(page.locator('#analysis-difal-retry')).toBeEnabled();
  await page.locator('#analysis-difal-no').check();
  const before=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis;
  const hold=gate();await page.route(`**/api/v4/analyses/${analysis.id}?includeSource=1`,async route=>{await hold.promise;await route.continue();});
  try{
    await page.locator('#analysis-difal-retry').click();await expect(page.locator('#analysis-difal-view .max-loading')).toBeVisible();
    await expect(page.locator('#analysis-difal-retry')).toBeDisabled();await expect(page.locator('#analysis-difal-no')).toBeChecked();
    await expect(page.locator('#analysis-busy-screen')).toBeHidden();
  }finally{hold.release();}
  await expect(page.locator('#analysis-difal-view .max-loading')).toHaveCount(0);await expect(page.locator('#analysis-difal-no')).toBeChecked();
  const after=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis;expect(after.fiscal).toEqual(before.fiscal);
  await page.locator('#analysis-difal-yes').check();await expect(page.locator('[data-difal-include]')).toHaveCount(2);
  expect(await page.locator('#analysis-wizard').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('difal-simples-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:info.outputPath('difal-simples-desktop.png'),fullPage:true});
});

test('uma escolha por regime salva o valor correto sem duplicar controles',async({page,baseURL,account})=>{
  const analysis=await reports(page.request,baseURL!,await fresh(page.request,baseURL!,account));
  await page.goto(url(analysis.id));await expect(detected(page)).toHaveAttribute('data-difal-state','available');
  await page.locator('#analysis-difal-yes').check();await expect(page.locator('#analysis-difal-details input[type=checkbox]')).toHaveCount(2);
  await page.locator('[data-difal-include="hybrid"]').uncheck();await page.locator('button[value="save"]').click();
  await expect(page.locator('#analysis-feedback')).toContainText('Fiscal salvo');await page.reload();
  await expect(page.locator('[data-difal-include="pure"]')).toBeChecked();await expect(page.locator('[data-difal-include="hybrid"]')).not.toBeChecked();
  const saved=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal.data;
  expect(saved.difalPolicy.enabled.hybrid).toBe(false);expect(saved.difalPolicy.operations.hybrid.entry).toBe(false);expect(saved.difalPolicy.operations.pure.entry).toBe(true);
  await expect(detected(page).locator('[data-difal-detected-amount]')).toHaveText('R$ 73,20');
});

test('carregamento prolongado não inventa progresso, respeita movimento reduzido e limpa o temporizador',async({page,baseURL,account})=>{
  const analysis=await fresh(page.request,baseURL!,account);await page.goto(url(analysis.id));await expect(page.locator('#analysis-wizard')).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.install();
  await page.evaluate(async()=>{
    const {createLoadingScreen}=await import('/ui-loading.js');
    const screen=createLoadingScreen({id:'test-busy',target:()=>document.querySelector('.analysis-wizard-frame')});
    (window as any).testBusy=screen;screen.show({title:'Processando documento…',detail:'Aguardando resposta.'});
  });
  await expect(page.locator('#test-busy')).toBeVisible();await expect(page.locator('#test-busy [data-loading-slow]')).toBeHidden();
  expect(await page.locator('#test-busy .max-loading-spinner').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await page.clock.fastForward(13000);await expect(page.locator('#test-busy [data-loading-slow]')).toBeVisible();
  await expect(page.locator('#test-busy [aria-valuenow]')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).testBusy.hide();});await page.clock.fastForward(13000);await expect(page.locator('#test-busy')).toBeHidden();
  await page.evaluate(()=>{(window as any).testBusy.show({title:'Nova operação'});});await expect(page.locator('#test-busy [data-loading-slow]')).toBeHidden();
});
