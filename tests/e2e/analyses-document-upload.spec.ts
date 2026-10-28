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

async function api(request:APIRequestContext,baseURL:string,method:'GET'|'POST'|'DELETE',path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,account:Credentials){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
}
async function createCompany(request:APIRequestContext,baseURL:string,account:Credentials,uf='MG'){
  await signIn(request,baseURL,account);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética documentos '+code,uf}]})).items[0];
  return company;
}
async function create(request:APIRequestContext,baseURL:string,account:Credentials,uf='MG'){
  const company=await createCompany(request,baseURL,account,uf);
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
async function selectDocument(page:Page,type:'PURCHASES'|'SALES'){
  // A real click must open the native chooser without waiting for network work.
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator(`[data-analysis-add-document="${type}"]`).click();
  const chooser=await chooserPromise;await chooser.setFiles(report(type));
}
async function completeDocument(page:Page,type:'PURCHASES'|'SALES'){
  await expect(card(page,type)).toContainText('Leitura concluída');
  await expect(card(page,type).getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  await expect(page.locator(`[data-analysis-document-error="${type}"]`)).toHaveCount(0);
}
async function generationFor(request:APIRequestContext,baseURL:string,id:string){
  const analysis=(await api(request,baseURL,'GET','/api/v4/analyses/'+id+'?summary=1')).analysis;
  expect(analysis.fiscal.data.generationId).toBeTruthy();
  return api(request,baseURL,'GET','/api/v4/generations/'+analysis.fiscal.data.generationId);
}

for(const firstType of ['PURCHASES','SALES'] as const)test(`Adicionar ${firstType} diretamente e o segundo arquivo sem sair da análise preserva os dois relatórios`,async({page,baseURL,documentAccounts},info)=>{
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
    await expect(page.locator(`[data-analysis-add-document="${type}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-analysis-document-uf]')).toHaveValue('MG');
  if(firstType==='SALES'){
    await page.setViewportSize({width:390,height:760});
    await page.locator(`[data-analysis-add-document="${firstType}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-analysis-add-document="${firstType}"]`)).toBeInViewport();
    await page.screenshot({path:info.outputPath('fiscal-inline-upload-mobile.png'),fullPage:true});
  }else{
    await page.setViewportSize({width:1360,height:1000});
    await page.locator(`[data-analysis-add-document="${firstType}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('fiscal-inline-upload-desktop.png'),fullPage:true});
  }
  const analysisUrl=page.url();
  await selectDocument(page,firstType);await completeDocument(page,firstType);
  await expect(page).toHaveURL(analysisUrl);expect(imports).toBe(1);
  const firstGeneration=await generationFor(page.request,baseURL!,analysis.id),firstCompany=firstGeneration.companies[0],generationId=firstGeneration._id;
  const firstSlot=firstType==='PURCHASES'?'purchase':'sales',secondType=firstType==='PURCHASES'?'SALES':'PURCHASES';
  expect(firstCompany[firstSlot].status).toBe('COMPLETED');const firstJob=structuredClone(firstCompany[firstSlot]);

  if(firstType==='SALES'){
    const file=report(secondType);
    const transfer=await page.evaluateHandle(({name,mimeType,bytes})=>{
      const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],name,{type:mimeType}));return transfer;
    },{name:file.name,mimeType:file.mimeType,bytes:[...file.buffer]});
    await page.locator(`[data-analysis-document-drop="${secondType}"]`).dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();
  }else await selectDocument(page,secondType);
  await completeDocument(page,secondType);await expect(page).toHaveURL(analysisUrl);
  const savedGeneration=await generationFor(page.request,baseURL!,analysis.id),savedCompany=savedGeneration.companies[0];
  expect(savedGeneration._id).toBe(generationId);expect(savedCompany[firstSlot]).toEqual(firstJob);
  expect(savedCompany.purchase.status).toBe('COMPLETED');expect(savedCompany.sales.status).toBe('COMPLETED');
  expect(savedGeneration.status).toBe('COMPLETED');expect(imports).toBe(1);
  // Compare persisted monetary values, not only presentation status.
  const purchases=await api(page.request,baseURL!,'GET','/api/v4/purchases/'+savedCompany.purchase._id+'/summary');
  const sales=await api(page.request,baseURL!,'GET','/api/v4/sales/'+savedCompany.sales._id+'/summary');
  expect(purchases.totals.totalCents).toBe(20067);expect(sales.totals.totalCents).toBe(100045);
  expect(purchases.totals.lines).toBe(1);expect(sales.totals.lines).toBe(1);expect(errors).toEqual([]);
});

test('Selecionar documento aguarda os metadados existentes sem preparar outra geração',async({page,baseURL,documentAccounts})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(12_000);
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);
  const prepared=await api(page.request,baseURL!,'POST',importPath(analysis.id),{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  let imports=0,metadataReads=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===importPath(analysis.id))imports++;});
  let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),pattern='**/api/v4/generations/'+prepared.generationId;
  const held=async(route:Route)=>{metadataReads++;const response=await route.fetch();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    await page.goto(documentsUrl(analysis.id));await expect.poll(()=>metadataReads).toBe(1);
    await selectDocument(page,'SALES');expect(imports).toBe(0);release();
    await completeDocument(page,'SALES');await expect(page).toHaveURL(url=>url.pathname==='/analyses.html'&&url.searchParams.get('id')===analysis.id);
    expect((await generationFor(page.request,baseURL!,analysis.id))._id).toBe(prepared.generationId);expect(imports).toBe(0);
  }finally{release();await page.unroute(pattern,held);}
});

test('Arquivo inválido não prepara uma geração e permite selecionar um arquivo corrigido',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);let imports=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===importPath(analysis.id))imports++;});
  await page.goto(documentsUrl(analysis.id));
  await page.locator('[data-analysis-document-file="PURCHASES"]').setInputFiles({name:'arquivo-invalido.csv',mimeType:'text/csv',buffer:Buffer.from('Documento;Valor\nPessoa;valor inválido')});
  await expect(page.locator('[data-analysis-document-error="PURCHASES"]')).not.toBeEmpty();
  expect(imports).toBe(0);
  const unchanged=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  expect(unchanged.fiscal.data.generationId).toBeNull();
  await selectDocument(page,'PURCHASES');await completeDocument(page,'PURCHASES');expect(imports).toBe(1);
});

test('Empresa sem UF permite informar a UF no próprio Fiscal e mantém essa escolha no relatório',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer,'');await page.goto(documentsUrl(analysis.id));
  await expect(page.locator('[data-analysis-document-uf]')).toHaveValue('');
  await page.locator('[data-analysis-document-uf]').selectOption('SP');
  await selectDocument(page,'PURCHASES');await completeDocument(page,'PURCHASES');
  const generation=await generationFor(page.request,baseURL!,analysis.id);
  const job=await api(page.request,baseURL!,'GET','/api/v4/purchases/'+generation.companies[0].purchase._id);
  expect(job.issuerUf).toBe('SP');await expect(page).toHaveURL(url=>url.pathname==='/analyses.html');
});

test('Uma RBT12 inválida permanece digitada ao tentar adicionar documento, sem gravação parcial',async({page,baseURL,documentAccounts})=>{
  const company=await createCompany(page.request,baseURL!,documentAccounts.writer);
  const analysis=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}})).analysis;
  await page.goto('/analyses.html?'+new URLSearchParams({id:analysis.id,sector:'fiscal',step:'rbt12'}));
  await page.locator('#analysis-extrato-manual').click();await page.locator('#analysis-rbt12').fill('1e3');
  await page.locator('#analysis-wizard-next').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
  let writes=0;page.on('request',request=>{if(['POST','PATCH','DELETE'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/v4/'))writes++;});
  await selectDocument(page,'PURCHASES');
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','rbt12');
  await expect(page.locator('#analysis-rbt12')).toHaveValue('1e3');await expect(page.locator('#analysis-rbt12')).toBeFocused();
  await expect(page.locator('[data-analysis-document-error="PURCHASES"]')).toContainText('RBT12');expect(writes).toBe(0);
  const saved=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  expect(saved.fiscal.data.generationId).toBeNull();expect(saved.fiscal.data.rbt12).toBeNull();
});

test('Retomar importação histórica sem UF conserva a UF ausente e sinaliza o imposto pendente',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);
  const prepared=await api(page.request,baseURL!,'POST',importPath(analysis.id),{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  const importId=randomUUID(),file=report('PURCHASES');
  await api(page.request,baseURL!,'POST','/api/v4/generations/'+prepared.generationId+'/purchases',{
    importId,clientId:analysis.clientId,fileName:file.name,expectedRows:1,type:'PURCHASES',issuerUf:''});
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'PURCHASES')).toContainText('Importação incompleta');
  await expect(page.locator('[data-analysis-document-uf]')).toHaveValue('MG');
  await selectDocument(page,'PURCHASES');await completeDocument(page,'PURCHASES');
  const generation=await generationFor(page.request,baseURL!,analysis.id);expect(generation._id).toBe(prepared.generationId);
  expect(generation.companies[0].purchase._id).toBe(importId);
  const summary=await api(page.request,baseURL!,'GET','/api/v4/purchases/'+importId+'/summary');
  expect(summary.job.issuerUf).toBe('');expect(summary.anticipation.issuerUf).toBe('');
  expect(summary.anticipation.pendingLines).toBe(1);expect(summary.anticipation.amountCents).toBe(0);expect(summary.totals.totalCents).toBe(20067);
});

for(const failureStage of ['create-before','create-after','rows','finalize-after'] as const)test(`Retomar envio após falha ${failureStage} reutiliza o mesmo relatório sem duplicar linhas`,async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);let failureSent=false,imports=0;
  const jobIds:string[]=[],rowJobIds:string[]=[];
  page.on('request',request=>{
    if(request.method()!=='POST')return;const pathname=new URL(request.url()).pathname;
    if(pathname===importPath(analysis.id))imports++;
    if(/\/generations\/[^/]+\/purchases$/.test(pathname))jobIds.push(request.postDataJSON().importId);
    const row=pathname.match(/^\/api\/v4\/purchases\/([^/]+)\/rows$/);if(row)rowJobIds.push(row[1]);
  });
  const failedPath=failureStage.startsWith('create')?'**/api/v4/generations/*/purchases':failureStage==='rows'?'**/api/v4/purchases/*/rows':'**/api/v4/purchases/*/finalize';
  await page.route(failedPath,async route=>{
    if(!failureSent&&route.request().method()==='POST'){
      failureSent=true;
      // An uncertain response may occur before persistence or after the server committed.
      if(failureStage.endsWith('after')){const response=await route.fetch();expect(response.ok()).toBe(true);}
      await route.fulfill({status:503,json:{error:'SERVICE_UNAVAILABLE',message:'Falha temporária sintética. Retome o envio.'}});return;
    }
    await route.continue();
  });
  await page.goto(documentsUrl(analysis.id));await selectDocument(page,'PURCHASES');
  await expect(page.locator('[data-analysis-document-error="PURCHASES"]')).toContainText('Falha temporária sintética');
  await page.locator('[data-analysis-document-retry="PURCHASES"]').click();await completeDocument(page,'PURCHASES');
  expect(failureSent).toBe(true);expect(imports).toBe(1);expect(jobIds.length).toBeGreaterThanOrEqual(1);
  expect(new Set(jobIds).size).toBe(1);expect(rowJobIds.length).toBeGreaterThanOrEqual(failureStage==='rows'?2:1);expect(new Set(rowJobIds)).toEqual(new Set(jobIds));
  const generation=await generationFor(page.request,baseURL!,analysis.id),job=generation.companies[0].purchase;
  expect(job._id).toBe(jobIds[0]);expect(job.uploaded).toBe(1);
  const summary=await api(page.request,baseURL!,'GET','/api/v4/purchases/'+job._id+'/summary');
  expect(summary.totals.lines).toBe(1);expect(summary.totals.totalCents).toBe(20067);
});

test('Uma aba antiga não envia arquivos para a geração substituída em outra aba',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);
  const original=await api(page.request,baseURL!,'POST',importPath(analysis.id),{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'PURCHASES')).toContainText('Aguardando documento');
  const current=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  const replacement=await api(page.request,baseURL!,'POST',importPath(analysis.id),{expectedSectorRevision:current.fiscal.revision,expectedConfigRevision:current.config.revision});
  expect(replacement.generationId).not.toBe(original.generationId);const attachments:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&/\/generations\/[^/]+\/(purchases|sales)$/.test(new URL(request.url()).pathname))attachments.push(request.url());});
  await selectDocument(page,'PURCHASES');
  await expect(page.locator('[data-analysis-document-error="PURCHASES"]')).not.toBeEmpty();
  await expect(page.locator('#analysis-error')).toContainText('outra aba');expect(attachments).toEqual([]);
  const saved=await generationFor(page.request,baseURL!,analysis.id);expect(saved._id).toBe(replacement.generationId);
  expect(saved.companies[0].purchase).toBeFalsy();expect(saved.companies[0].sales).toBeFalsy();
  const prior=await api(page.request,baseURL!,'GET','/api/v4/generations/'+original.generationId);
  expect(prior.companies[0].purchase).toBeFalsy();
});

test('Recuperar geração excluída remove o estado local concluído do documento antigo',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);await page.goto(documentsUrl(analysis.id));
  await selectDocument(page,'PURCHASES');await completeDocument(page,'PURCHASES');
  const original=await generationFor(page.request,baseURL!,analysis.id);
  await api(page.request,baseURL!,'DELETE','/api/v4/generations/'+original._id,{});
  let confirmed=false;page.once('dialog',async dialog=>{expect(dialog.message()).toContain('indisponíveis');confirmed=true;await dialog.accept();});
  await selectDocument(page,'SALES');await completeDocument(page,'SALES');expect(confirmed).toBe(true);
  await expect(card(page,'PURCHASES')).toContainText('Aguardando documento');
  await expect(page.locator('[data-analysis-add-document="PURCHASES"]')).toBeVisible();
  await expect(card(page,'PURCHASES').getByRole('link',{name:'Conferir relatório'})).toHaveCount(0);
  const replacement=await generationFor(page.request,baseURL!,analysis.id);expect(replacement._id).not.toBe(original._id);
  expect(replacement.companies[0].purchase).toBeFalsy();expect(replacement.companies[0].sales.status).toBe('COMPLETED');
  await selectDocument(page,'PURCHASES');await completeDocument(page,'PURCHASES');
  const completed=await generationFor(page.request,baseURL!,analysis.id);expect(completed._id).toBe(replacement._id);
  expect(completed.status).toBe('COMPLETED');
});

test('Consulta sem permissão de escrita não oferece envio nem prepara uma geração',async({page,baseURL,documentAccounts})=>{
  const analysis=await create(page.request,baseURL!,documentAccounts.writer);await signIn(page.request,baseURL!,documentAccounts.viewer);
  let writes=0;page.on('request',request=>{if(['POST','PATCH','DELETE'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/v4/'))writes++;});
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'PURCHASES')).toContainText('Aguardando documento');
  await expect(page.locator('[data-analysis-add-document]')).toHaveCount(0);await expect(page.locator('[data-analysis-document-file]')).toHaveCount(0);
  await expect(page.locator('#analysis-start-import')).toHaveCount(0);await expect(page.locator('[data-analysis-document-retry]')).toHaveCount(0);expect(writes).toBe(0);
});
