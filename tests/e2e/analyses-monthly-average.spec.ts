import {test as base,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Context={db:Db;workspaceId:string;accountId:string};
const fields=['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'];
const test=base.extend<{accountingContext:Context}>({
  accountingContext:async({page,baseURL},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',accountId=randomUUID();
    const email=`average-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}`;
    await db.collection<any>('users').insertOne({_id:accountId,workspaceId,email,name:'Contábil sintético',role:'admin',active:true,
      mustChangePassword:false,passwordHash:await hashPassword(password),createdAt:new Date()});
    await api(page.request,baseURL!,'POST','/api/auth/login',{email,password});
    try{await use({db,workspaceId,accountId});}
    finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:accountId});
      await db.collection<any>('users').deleteOne({_id:accountId,workspaceId});await mongo.close();
    }
  }
});
async function api(request:APIRequestContext,origin:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(path,{method,data,headers:{Origin:new URL(origin).origin}});
  expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
}
async function create(request:APIRequestContext,origin:string){
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=await api(request,origin,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética médias '+code,uf:'MG'}]});
  return (await api(request,origin,'POST','/api/v4/analyses',{clientId:company.items[0].id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
}
const field=(page:Page,key:string)=>page.locator(`[data-accounting-average="${key}"]`);
async function fill(page:Page,values:string[]){for(let i=0;i<fields.length;i++)await field(page,fields[i]).fill(values[i]);}
async function save(page:Page,id:string,complete=false){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${id}/accounting`&&r.request().method()==='PATCH');
  await page.locator('#analysis-accounting-form button[value="'+(complete?'complete':'save')+'"]').click();
  const result=await response;expect(result.ok(),await result.text()).toBe(true);
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');return (await result.json()).analysis;
}
async function switchTo(page:Page,sector:'accounting'|'fiscal'){
  await page.locator('#analysis-wizard [data-analysis-sector="'+sector+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind',sector);
}

test('média numérica replica nove meses, totaliza, salva antes Fiscal e reabre em desktop e celular',async({page,baseURL,accountingContext},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const analysis=await create(page.request,baseURL!);await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);
  await expect(page.locator('[data-accounting-average]')).toHaveCount(5);
  await expect(page.locator('[name=accounting-fill-mode],#analysis-accounting-copy,#analysis-accounting-paste')).toHaveCount(0);
  await expect(field(page,'salariesCents')).toHaveAttribute('type','number');
  await page.locator('#analysis-new-source-year').fill('2026');await fill(page,['1000','200','12.34','0','0.01']);
  await expect(page.locator('[data-accounting-summary-total]')).toHaveText('R$ 10.911,15');
  await page.locator('#analysis-average-months > summary').click();
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
  await expect(page.locator('[data-accounting-month="2026-09"] [data-average-value=salariesCents]')).toHaveText('R$ 1.000,00');
  await expect(page.locator('[data-accounting-month="2026-10"]')).toHaveCount(0);
  const saved=await save(page,analysis.id,true);
  expect(saved.accounting.data.monthlyAverage.values.salariesCents).toBe(100000);
  expect(saved.accounting.data.months).toHaveLength(9);expect(saved.accounting.data.months.every((row:any)=>row.salariesCents===100000)).toBe(true);
  expect(saved.accounting.status).toBe('COMPLETE');expect(saved.fiscal.status).toBe('DRAFT');
  await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);await expect(field(page,'salariesCents')).toHaveValue('1000.00');
  await expect(page.locator('#analysis-draft-status')).toHaveText('Dados salvos');
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:960});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`media-mensal-${width}.png`),fullPage:true});
  }
  const stored=await accountingContext.db.collection<any>('analyses').findOne({_id:analysis.id});
  expect(stored?.accounting.data).toEqual(saved.accounting.data);expect(errors).toEqual([]);
});

test('rascunho mantém digitação ao alternar setores e salvar o Fiscal; vazio não vira zero',async({page,baseURL,accountingContext})=>{
  const analysis=await create(page.request,baseURL!);await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);
  await field(page,'salariesCents').fill('1234.56');await field(page,'rentCents').fill('');
  await switchTo(page,'fiscal');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`&&r.request().method()==='PATCH');
  await page.locator('#analysis-fiscal-form button[value=save]').click();expect((await response).ok()).toBe(true);
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await switchTo(page,'accounting');await expect(field(page,'salariesCents')).toHaveValue('1234.56');await expect(field(page,'rentCents')).toHaveValue('');
  await expect(page.locator('#analysis-draft-status')).toHaveText('Alterações não salvas');
  expect((await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}`)).analysis.accounting.data.months).toEqual([]);
  const saved=await save(page,analysis.id);expect(saved.accounting.status).toBe('DRAFT');
  expect(saved.accounting.data.months.every((row:any)=>row.salariesCents===123456&&row.rentCents===null)).toBe(true);
  await page.locator('#analysis-accounting-form button[value=complete]').click();
  await expect(page.locator('#analysis-error')).toContainText('média mensal de Aluguéis');
});

test('erro ou resposta incompleta ao salvar não confirma nem descarta os valores digitados',async({page,baseURL,accountingContext})=>{
  const analysis=await create(page.request,baseURL!);await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);await fill(page,['1000','0','0','0','0']);
  const endpoint=`**/api/v4/analyses/${analysis.id}/accounting*`;
  await page.route(endpoint,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Falha sintética no salvamento',code:'SERVICE_UNAVAILABLE'})}));
  await page.locator('#analysis-accounting-form button[value=save]').click();
  await expect(page.locator('#analysis-error')).toBeVisible();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await expect(field(page,'salariesCents')).toHaveValue('1000');await expect(page.locator('#analysis-draft-status')).toHaveText('Alterações não salvas');
  await page.unroute(endpoint);await page.route(endpoint,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({analysis:{id:analysis.id}})}));
  await page.locator('#analysis-accounting-form button[value=save]').click();
  await expect(page.locator('#analysis-error')).toContainText('incompleta');await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await expect(field(page,'salariesCents')).toHaveValue('1000');await expect(page.locator('#analysis-draft-status')).toHaveText('Alterações não salvas');
  await page.unroute(endpoint);const saved=await save(page,analysis.id,true);expect(saved.accounting.data.months[8].salariesCents).toBe(100000);
});

test('médias legadas são sugeridas sem apagar meses e só se tornam uniformes após salvar',async({page,baseURL,accountingContext})=>{
  let analysis=await create(page.request,baseURL!);
  const months=[{sourceMonth:'2025-01',salariesCents:10000,rentCents:5000,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0},
    {sourceMonth:'2025-02',salariesCents:20000,rentCents:5000,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}];
  analysis=(await api(page.request,baseURL!,'PATCH',`/api/v4/analyses/${analysis.id}/accounting`,{
    expectedSectorRevision:analysis.accounting.revision,expectedConfigRevision:analysis.config.revision,complete:false,data:{months}})).analysis;
  await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);
  await expect(page.locator('#analysis-average-legacy')).toContainText('preenchimento anterior está preservado');
  await expect(field(page,'salariesCents')).toHaveValue('150.00');
  await switchTo(page,'fiscal');await switchTo(page,'accounting');
  expect((await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}`)).analysis.accounting.data).toEqual({months});
  const saved=await save(page,analysis.id,true);expect(saved.accounting.revision).toBe(analysis.accounting.revision+1);
  expect(saved.accounting.data.months).toHaveLength(9);expect(saved.accounting.data.months.every((row:any)=>row.salariesCents===15000)).toBe(true);
});

test('retorno de outro setor não atualiza revisão-base do Contábil alterado por outra aba',async({page,baseURL,accountingContext})=>{
  let analysis=await create(page.request,baseURL!);await page.goto(`/analyses.html?id=${analysis.id}&sector=accounting`);
  await fill(page,['222','0','0','0','0']);
  const values=Object.fromEntries(fields.map((key,index)=>[key,index===0?11100:0]));
  const months=Array.from({length:9},(_,index)=>({sourceMonth:`2026-0${index+1}`,...values}));
  analysis=(await api(page.request,baseURL!,'PATCH',`/api/v4/analyses/${analysis.id}/accounting`,{expectedSectorRevision:analysis.accounting.revision,
    expectedConfigRevision:analysis.config.revision,complete:true,data:{months,monthlyAverage:{version:'MONTHLY_AVERAGE_V1',values}}})).analysis;
  await switchTo(page,'fiscal');
  const fiscalSave=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`&&r.request().method()==='PATCH');
  await page.locator('#analysis-fiscal-form button[value=save]').click();expect((await fiscalSave).ok()).toBe(true);
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');await switchTo(page,'accounting');
  await expect(field(page,'salariesCents')).toHaveValue('222');
  const conflict=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/accounting`&&r.request().method()==='PATCH');
  await page.locator('#analysis-accounting-form button[value=complete]').click();expect((await conflict).status()).toBe(409);
  await expect(page.locator('#analysis-error')).toContainText('Seus campos continuam nesta tela');await expect(field(page,'salariesCents')).toHaveValue('222');
  expect((await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}`)).analysis.accounting.data.months[0].salariesCents).toBe(11100);
});

test('mudar os próprios regimes preserva Fiscal em edição e não provoca conflito artificial ao salvar',async({page,baseURL,accountingContext})=>{
  const analysis=await create(page.request,baseURL!);await page.goto(`/analyses.html?id=${analysis.id}&sector=fiscal`);
  // An already edited fiscal input stays local while this tab changes its configuration.
  await page.locator('#analysis-sales-annex').selectOption('2',{force:true});
  await page.locator('#analysis-fiscal-form input[name=regime][value=presumed]').check();
  const configSave=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/config`&&r.request().method()==='PATCH');
  await page.locator('#analysis-wizard-next').click();expect((await configSave).ok()).toBe(true);
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  const fiscalSave=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`&&r.request().method()==='PATCH');
  await page.locator('#analysis-fiscal-form button[value=save]').click();const saved=await fiscalSave;
  expect(saved.ok(),await saved.text()).toBe(true);expect((await saved.json()).analysis.fiscal.data.salesAnnex).toBe(2);
});
