import {test as base,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Account={id:string;email:string;password:string};
type Workspace={db:Db;workspaceId:string;writer:Account;viewer:Account};
type ReportType='PURCHASES'|'SALES';
type ReportRow={totalCents:number;recipientUf:string};
const test=base.extend<{difalWorkspace:Workspace}>({
  difalWorkspace:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account=(role:string):Account=>({id:randomUUID(),email:`document-difal-${role}-${randomUUID()}@example.test`,password:`Synthetic-difal-${randomUUID()}`});
    const writer=account('writer'),viewer=account('viewer');
    try{
      for(const [credentials,role] of [[writer,'admin'],[viewer,'viewer']] as const)await db.collection<any>('users').insertOne({
        _id:credentials.id,workspaceId,email:credentials.email,name:'Equipe sintética DIFAL',role,active:true,mustChangePassword:false,
        passwordHash:await hashPassword(credentials.password),createdAt:new Date()
      });
      await use({db,workspaceId,writer,viewer});
    }finally{
      const ids=[writer.id,viewer.id];await db.collection('sessions').deleteMany({workspaceId,userId:{$in:ids}});
      await db.collection<any>('users').deleteMany({workspaceId,_id:{$in:ids}});await mongo.close();
    }
  }
});

async function api(request:APIRequestContext,baseURL:string,method:'GET'|'POST'|'PATCH',path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,account:Account){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
}
function policy(){return {version:'DIFAL_SCENARIOS_V2',enabled:{pure:true,hybrid:true,presumed:false,actual:false},operations:{pure:{entry:true,exit:true},hybrid:{entry:true,exit:true}}};}
async function createAnalysis(request:APIRequestContext,baseURL:string,account:Account){
  await signIn(request,baseURL,account);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética DIFAL '+code,uf:'MG'}]})).items[0];
  let analysis=(await api(request,baseURL,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid']}})).analysis;
  analysis=(await api(request,baseURL,'PATCH','/api/v4/analyses/'+analysis.id+'/fiscal',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision,complete:false,
    data:{...analysis.fiscal.data,difalPolicy:policy()}
  })).analysis;
  return analysis;
}
const documentsUrl=(id:string)=>'/analyses.html?'+new URLSearchParams({id,sector:'fiscal',step:'documents'});
const card=(page:Page,type:ReportType)=>page.locator(`[data-analysis-document="${type}"]`);
const tax=(page:Page,type:ReportType)=>card(page,type).locator(`[data-analysis-document-difal="${type}"]`);
const amount=(page:Page,type:ReportType)=>tax(page,type).locator('[data-analysis-document-difal-amount]');
function csv(type:ReportType){
  const header=Array(28).fill(''),row=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  row[0]='123.456.789-00';row[7]='15/01/2025';row[8]='Pessoa sintética';row[9]='SP';
  row[11]=type==='SALES'?'5102001':'1102001';row[14]='Operação interestadual sintética';row[15]='1';row[16]=type==='SALES'?'1000,00':'500,00';
  for(const column of [24,25,26,27])row[column]='0,00';
  return {name:`difal-${type.toLowerCase()}.csv`,mimeType:'text/csv',buffer:Buffer.from([header,row].map(values=>values.join(';')).join('\r\n'),'latin1')};
}
async function upload(page:Page,type:ReportType){
  const chooserPromise=page.waitForEvent('filechooser');await page.locator(`[data-analysis-add-document="${type}"]`).click();
  await (await chooserPromise).setFiles(csv(type));
  await expect(card(page,type)).toContainText('Leitura concluída');
  await expect(card(page,type).getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  await expect(page.locator(`[data-analysis-document-error="${type}"]`)).toHaveCount(0);
}
async function generationFor(request:APIRequestContext,baseURL:string,id:string){
  const analysis=(await api(request,baseURL,'GET','/api/v4/analyses/'+id+'?summary=1')).analysis;
  return api(request,baseURL,'GET','/api/v4/generations/'+analysis.fiscal.data.generationId);
}
async function prepare(request:APIRequestContext,baseURL:string,analysis:any){
  return api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/fiscal/import',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision
  });
}
async function attach(request:APIRequestContext,baseURL:string,analysis:any,generationId:string,type:ReportType,rows:ReportRow[],finalize=true){
  const name=type==='SALES'?'sales':'purchases';
  const attached=await api(request,baseURL,'POST',`/api/v4/generations/${generationId}/${name}`,{
    importId:randomUUID(),clientId:analysis.clientId,fileName:`difal-${name}.csv`,expectedRows:rows.length,issuerUf:'MG'
  });
  await api(request,baseURL,'POST',`/api/v4/${name}/${attached.job._id}/rows`,{offset:0,rows:rows.map(row=>({
    document:'12345678900',name:'Pessoa sintética',recipientUf:row.recipientUf,serviceDate:'2025-01-15',
    natureCode:type==='SALES'?'5102001':'1102001',description:'Operação sintética',quantity:'1',grossCents:row.totalCents,
    discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:row.totalCents
  }))});
  if(finalize){const completed=await api(request,baseURL,'POST',`/api/v4/${name}/${attached.job._id}/finalize`,{});expect(completed.status).toBe('COMPLETED');}
  return attached.job._id;
}
async function fiscalStep(page:Page,step:'regimes'|'difal'|'rbt12'|'documents'){
  const wizard=page.locator('#analysis-wizard'),steps=['regimes','difal','rbt12','documents'];
  for(let attempt=0;attempt<steps.length;attempt++){
    const current=await wizard.getAttribute('data-wizard-step');expect(steps).toContain(current);if(current===step)return;
    await page.locator(steps.indexOf(current!)>steps.indexOf(step)?'#analysis-wizard-back':'#analysis-wizard-next').click();
    await expect(wizard).not.toHaveAttribute('data-wizard-step',current!);
  }
  await expect(wizard).toHaveAttribute('data-wizard-step',step);
}

for(const first of ['PURCHASES','SALES'] as const)test(`DIFAL aparece após ler ${first}, antes do segundo documento, e permanece ao reabrir`,async({page,baseURL,difalWorkspace},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(documentsUrl(analysis.id));
  await expect(page.locator('[data-analysis-document-difal]')).toHaveCount(0);
  const originalUrl=page.url(),second=first==='PURCHASES'?'SALES':'PURCHASES';
  await upload(page,first);await expect(page).toHaveURL(originalUrl);
  await expect(amount(page,first)).toHaveText(first==='SALES'?'R$ 100,00':'R$ 36,60');
  await expect(tax(page,second)).toHaveCount(0);await expect(card(page,second)).toContainText('Aguardando documento');
  const firstGeneration=await generationFor(page.request,baseURL!,analysis.id);
  expect(firstGeneration.companies[0][first==='SALES'?'sales':'purchase'].purchaseInput[first==='SALES'?'difal':'anticipation'].amountCents).toBe(first==='SALES'?10_000:3_660);
  await upload(page,second);await expect(page).toHaveURL(originalUrl);
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 100,00');
  await expect(tax(page,'PURCHASES')).toContainText(/antecipação de ICMS/i);
  await expect(tax(page,'SALES')).toContainText(/DIFAL de saída/i);
  const saved=await generationFor(page.request,baseURL!,analysis.id);expect(saved._id).toBe(firstGeneration._id);
  expect(saved.companies[0][first==='SALES'?'sales':'purchase']).toEqual(firstGeneration.companies[0][first==='SALES'?'sales':'purchase']);
  await page.reload();await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 100,00');
  if(first==='PURCHASES')for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await tax(page,'SALES').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    for(const type of ['PURCHASES','SALES'] as const)expect(await amount(page,type).evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await page.locator('#analysis-fiscal-documents-view').screenshot({path:info.outputPath(`difal-after-read-${width}.png`)});
  }
  expect(errors).toEqual([]);
});

test('DIFAL dos cartões acompanha escolha e operação do rascunho, salva e permite consulta sem alterar a fonte',async({page,browser,baseURL,difalWorkspace})=>{
  test.setTimeout(120_000);page.setDefaultTimeout(15_000);
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'PURCHASES',[{totalCents:50_000,recipientUf:'SP'}]);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:'SP'}]);
  const original=await generationFor(page.request,baseURL!,analysis.id);await page.goto(documentsUrl(analysis.id));
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 100,00');
  const writes:string[]=[];page.on('request',request=>{if(request.method()==='PATCH'&&new URL(request.url()).pathname.startsWith('/api/v4/analyses/'))writes.push(request.url());});
  await fiscalStep(page,'difal');await page.locator('#analysis-difal-no').check();await fiscalStep(page,'documents');
  await expect(page.locator('[data-analysis-document-difal]')).toHaveCount(0);
  await fiscalStep(page,'difal');await page.locator('#analysis-difal-yes').check();
  const details=page.locator('#analysis-difal-details');if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  await details.locator('[data-analysis-difal-enabled="hybrid"]').uncheck();
  await details.locator('[data-analysis-difal-regime="pure"][data-analysis-difal-operation="exit"]').uncheck();
  await fiscalStep(page,'documents');await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(tax(page,'SALES')).toHaveCount(0);
  await fiscalStep(page,'difal');
  await details.locator('[data-analysis-difal-regime="pure"][data-analysis-difal-operation="entry"]').uncheck();
  await details.locator('[data-analysis-difal-regime="pure"][data-analysis-difal-operation="exit"]').check();
  await fiscalStep(page,'documents');await expect(tax(page,'PURCHASES')).toHaveCount(0);await expect(amount(page,'SALES')).toHaveText('R$ 100,00');
  expect(writes).toEqual([]);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="save"]').click();expect((await saving).ok()).toBe(true);
  await page.reload();await expect(tax(page,'PURCHASES')).toHaveCount(0);await expect(amount(page,'SALES')).toHaveText('R$ 100,00');
  const unchanged=await generationFor(page.request,baseURL!,analysis.id);expect(unchanged).toEqual(original);
  const context=await browser.newContext({baseURL});try{
    await signIn(context.request,baseURL!,difalWorkspace.viewer);const viewer=await context.newPage();await viewer.goto(documentsUrl(analysis.id));
    await expect(tax(viewer,'PURCHASES')).toHaveCount(0);await expect(amount(viewer,'SALES')).toHaveText('R$ 100,00');
    await expect(viewer.locator('[data-analysis-add-document]')).toHaveCount(0);await expect(card(viewer,'SALES').getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  }finally{await context.close();}
});

test('DIFAL distingue zero confirmado de estimativa parcial com UF pendente',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'PURCHASES',[{totalCents:50_000,recipientUf:'MG'}]);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:'SP'},{totalCents:50_000,recipientUf:''}]);
  await page.goto(documentsUrl(analysis.id));await expect(amount(page,'PURCHASES')).toHaveText('R$ 0,00');
  await expect(amount(page,'SALES')).toHaveText('R$ 100,00');await expect(tax(page,'SALES')).toContainText(/parcial/i);
  await expect(tax(page,'SALES')).toContainText(/UF/);await expect(tax(page,'PURCHASES')).not.toContainText(/pendente|indisponível/i);
  const generation=await generationFor(page.request,baseURL!,analysis.id);
  expect(generation.companies[0].sales.purchaseInput.difal).toMatchObject({amountCents:10_000,eligibleLines:1,pendingLines:1});
});

test('leitura incompleta não mostra DIFAL e todas as UFs pendentes não viram zero',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:''}],false);
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'SALES')).toContainText('Finalização pendente');
  await expect(tax(page,'SALES')).toHaveCount(0);await page.locator('[data-analysis-document-retry="SALES"]').click();
  await expect(card(page,'SALES')).toContainText('Leitura concluída');await expect(amount(page,'SALES')).toHaveText('Pendente');
  await expect(tax(page,'SALES')).not.toContainText('R$ 0,00');
  const generation=await generationFor(page.request,baseURL!,analysis.id);expect(generation.companies[0].sales._id).toBe(jobId);
  expect(generation.companies[0].sales.purchaseInput.difal).toMatchObject({amountCents:0,eligibleLines:0,pendingLines:1});
});
