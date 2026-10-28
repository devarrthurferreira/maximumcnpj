import {test as base,expect,type APIRequestContext,type Page,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Credentials={id:string;email:string;password:string};
type Accounts={writer:Credentials;viewer:Credentials};
const test=base.extend<{documentAccounts:Accounts}>({
  documentAccounts:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account=(role:string)=>({id:randomUUID(),email:`analysis-document-${role}-${randomUUID()}@example.test`,password:`Synthetic-document-${randomUUID()}`});
    const writer=account('writer'),viewer=account('viewer');
    try{
      for(const [credentials,role] of [[writer,'admin'],[viewer,'viewer']] as const){
        await db.collection<any>('users').insertOne({_id:credentials.id,workspaceId,email:credentials.email,name:'Equipe sintética de documentos',
          role,active:true,mustChangePassword:false,passwordHash:await hashPassword(credentials.password),createdAt:new Date()});
      }
      await use({writer,viewer});
    }finally{
      const ids=[writer.id,viewer.id];await db.collection('sessions').deleteMany({workspaceId,userId:{$in:ids}});
      await db.collection<any>('users').deleteMany({workspaceId,_id:{$in:ids}});await mongo.close();
    }
  }
});

async function api(request:APIRequestContext,baseURL:string,method:'GET'|'POST',path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,account:Credentials){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
}
async function createCompany(request:APIRequestContext,baseURL:string,account:Credentials){
  await signIn(request,baseURL,account);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética documentos '+code,uf:'MG'}]})).items[0];
  return company;
}
async function create(request:APIRequestContext,baseURL:string,account:Credentials){
  const company=await createCompany(request,baseURL,account);
  return (await api(request,baseURL,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
}
const documentsUrl=(id:string)=>'/analyses.html?'+new URLSearchParams({id,sector:'fiscal',step:'documents'});
const card=(page:Page,type:string)=>page.locator(`[data-analysis-document="${type}"]`);
const importPath=(id:string)=>`/api/v4/analyses/${id}/fiscal/import`;
function report(type:'PURCHASES'|'SALES'){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const row=Array(28).fill('');row[0]='123.456.789-00';row[7]='15/01/2025';row[8]='Pessoa sintética';row[9]='MG';
  row[11]=type==='SALES'?'5102001':'1102001';row[14]='Documento sintético';row[15]='1';row[16]=type==='SALES'?'1000,45':'200,67';
  for(const column of [24,25,26,27])row[column]='0,00';
  return {name:`adicionar-${type.toLowerCase()}.csv`,mimeType:'text/csv',buffer:Buffer.from([header,row].map(values=>values.join(';')).join('\r\n'),'latin1')};
}
async function upload(page:Page,type:'PURCHASES'|'SALES'){
  await expect(page.locator('#purchase-file')).toBeEnabled();await expect(page.locator('#purchase-issuer-uf')).toHaveValue('MG');
  await page.locator('#purchase-file').setInputFiles(report(type));await expect(page.locator('.purchase-guided-summary')).toBeVisible();
  await expect(page.locator('#purchase-error')).toBeEmpty();
}

for(const firstType of ['PURCHASES','SALES'] as const)test(`Adicionar ${firstType} no primeiro acesso prepara o envio e conserva o arquivo ao adicionar o segundo`,async({page,baseURL,documentAccounts},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const company=await createCompany(page.request,baseURL!,documentAccounts.writer),errors:string[]=[];let imports=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{
    if(request.method()==='POST'&&/\/api\/v4\/analyses\/[^/]+\/fiscal\/import$/.test(new URL(request.url()).pathname))imports++;
  });
  await page.goto('/analyses.html?'+new URLSearchParams({client:company.id,sector:'fiscal',entry:'company'}));
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
  const analysisId=new URL(page.url()).searchParams.get('id');expect(analysisId).toBeTruthy();
  const analysis=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysisId+'?summary=1')).analysis;
  expect(analysis.fiscal.data.generationId).toBeNull();
  for(const type of ['PURCHASES','SALES']){
    await expect(card(page,type)).toContainText('Aguardando documento');
    await expect(card(page,type).getByRole('button',{name:'Adicionar documento'})).toBeVisible();
  }
  if(firstType==='SALES'){
    await page.setViewportSize({width:390,height:760});
    await card(page,firstType).getByRole('button',{name:'Adicionar documento'}).scrollIntoViewIfNeeded();
    await expect(card(page,firstType).getByRole('button',{name:'Adicionar documento'})).toBeInViewport();
    await page.screenshot({path:info.outputPath('fiscal-add-document-mobile.png'),fullPage:true});
  }else{
    await page.setViewportSize({width:1360,height:1000});
    await card(page,firstType).getByRole('button',{name:'Adicionar documento'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('fiscal-add-documents-desktop.png'),fullPage:true});
  }
  await card(page,firstType).getByRole('button',{name:'Adicionar documento'}).click();
  await expect(page).toHaveURL(url=>url.pathname==='/purchases.html'&&!!url.searchParams.get('generation'));
  const firstUrl=new URL(page.url()),generationId=firstUrl.searchParams.get('generation');
  expect(generationId).toBeTruthy();expect(firstUrl.searchParams.get('type')||'PURCHASES').toBe(firstType);
  expect(firstUrl.searchParams.get('client')).toBe(analysis.clientId);expect(firstUrl.searchParams.get('analysis')).toBe(analysis.id);
  await upload(page,firstType);expect(imports).toBe(1);
  const firstGeneration=await api(page.request,baseURL!,'GET','/api/v4/generations/'+generationId),firstCompany=firstGeneration.companies[0];
  const firstSlot=firstType==='PURCHASES'?'purchase':'sales',secondType=firstType==='PURCHASES'?'SALES':'PURCHASES';
  expect(firstCompany[firstSlot].status).toBe('COMPLETED');const firstJob=structuredClone(firstCompany[firstSlot]);

  await page.goto(documentsUrl(analysis.id));
  await expect(card(page,firstType)).toContainText('Leitura concluída');
  await expect(card(page,firstType).getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  await card(page,secondType).getByRole('button',{name:'Adicionar documento'}).click();
  await expect(page).toHaveURL(url=>url.pathname==='/purchases.html'&&!!url.searchParams.get('generation'));
  expect(new URL(page.url()).searchParams.get('generation')).toBe(generationId);
  expect(new URL(page.url()).searchParams.get('type')||'PURCHASES').toBe(secondType);
  await upload(page,secondType);
  const savedGeneration=await api(page.request,baseURL!,'GET','/api/v4/generations/'+generationId),savedCompany=savedGeneration.companies[0];
  expect(savedCompany[firstSlot]).toEqual(firstJob);expect(savedCompany.purchase.status).toBe('COMPLETED');expect(savedCompany.sales.status).toBe('COMPLETED');
  expect(savedGeneration.status).toBe('COMPLETED');expect(imports).toBe(1);
  const saved=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  expect(saved.fiscal.data.generationId).toBe(generationId);expect(errors).toEqual([]);
});

test('Adicionar documento aguarda a geração existente e não cria outra enquanto os metadados chegam',async({page,baseURL,documentAccounts})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(12_000);
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);
  const prepared=await api(page.request,baseURL!,'POST',importPath(analysis.id),{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  let imports=0,metadataReads=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===importPath(analysis.id))imports++;});
  let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),pattern='**/api/v4/generations/'+prepared.generationId;
  const held=async(route:Route)=>{metadataReads++;const response=await route.fetch();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    await page.goto(documentsUrl(analysis.id));await expect.poll(()=>metadataReads).toBe(1);
    const button=card(page,'SALES').getByRole('button',{name:'Adicionar documento'});await expect(button).toBeVisible();
    await button.click();expect(imports).toBe(0);release();
    await expect(page).toHaveURL(url=>url.pathname==='/purchases.html'&&!!url.searchParams.get('generation'));
    expect(new URL(page.url()).searchParams.get('generation')).toBe(prepared.generationId);expect(new URL(page.url()).searchParams.get('type')).toBe('SALES');
    expect(imports).toBe(0);await expect(page.locator('#purchase-file')).toBeEnabled();
  }finally{release();await page.unroute(pattern,held);}
});

test('Consulta sem permissão de escrita não oferece adicionar documentos nem prepara uma geração',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);await signIn(page.request,baseURL!,documentAccounts.viewer);
  let writes=0;page.on('request',request=>{if(['POST','PATCH','DELETE'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/v4/'))writes++;});
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'PURCHASES')).toContainText('Aguardando documento');
  await expect(page.locator('[data-analysis-add-document]')).toHaveCount(0);await expect(page.locator('#analysis-start-import')).toHaveCount(0);
  await expect(card(page,'SALES').getByRole('link',{name:'Adicionar documento'})).toHaveCount(0);expect(writes).toBe(0);
});
