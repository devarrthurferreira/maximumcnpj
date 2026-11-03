import {expect,type APIRequestContext,type Page} from '@playwright/test';
import {test as base} from './isolated-auth-test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {processLookup} from '../../src/lookup-jobs.ts';
import {closeDatabase} from '../../src/store.ts';
import {hashPassword} from '../../src/security.ts';
const OUTGOING_REPORT_NOTE='Não aplicado pela regra desta análise. Isso não significa ausência de vendas interestaduais.';

type Account={id:string;email:string;password:string};
type Workspace={db:Db;workspaceId:string;writer:Account;viewer:Account};
type ReportType='PURCHASES'|'SALES';
type ReportRow={totalCents:number;recipientUf:string;document?:string;serviceDate?:string};
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

test.afterAll(async()=>closeDatabase());

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
async function attach(request:APIRequestContext,baseURL:string,analysis:any,generationId:string,type:ReportType,rows:ReportRow[],finalize=true,beforeUpload?:(jobId:string)=>Promise<void>){
  const name=type==='SALES'?'sales':'purchases';
  const attached=await api(request,baseURL,'POST',`/api/v4/generations/${generationId}/${name}`,{
    importId:randomUUID(),clientId:analysis.clientId,fileName:`difal-${name}.csv`,expectedRows:rows.length,issuerUf:'MG'
  });
  await beforeUpload?.(attached.job._id);
  await api(request,baseURL,'POST',`/api/v4/${name}/${attached.job._id}/rows`,{offset:0,rows:rows.map(row=>({
    document:row.document??'12345678900',name:'Pessoa sintética',recipientUf:row.recipientUf,serviceDate:row.serviceDate??'2025-01-15',
    natureCode:type==='SALES'?'5102001':'1102001',description:'Operação sintética',quantity:'1',grossCents:row.totalCents,
    discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:row.totalCents
  }))});
  if(finalize){
    let completed=await api(request,baseURL,'POST',`/api/v4/${name}/${attached.job._id}/finalize`,{});
    if(completed.status!=='COMPLETED'){
      const actor=(await api(request,baseURL,'GET','/api/auth/session')).user;
      completed=await processLookup(actor,attached.job._id,(async()=>Response.json({cnpj:'00000000000191',razao_social:'Empresa sintética',opcao_pelo_simples:false})) as typeof fetch);
    }
    expect(completed.status).toBe('COMPLETED');
  }
  return attached.job._id;
}
async function attachLegacyEntry(request:APIRequestContext,baseURL:string,workspace:Workspace,analysis:any,generationId:string,rows:ReportRow[]){
  return attach(request,baseURL,analysis,generationId,'PURCHASES',rows,true,async jobId=>{
    // Seed a historical import before its real upload/finalization, so all V4
    // snapshots are produced and checked by the server's historical rule.
    const result=await workspace.db.collection<any>('lookupJobs').updateOne({
      _id:jobId,workspaceId:workspace.workspaceId,mode:'PURCHASES_V1',status:'UPLOADING'
    },{$set:{anticipationVersion:'ICMS_ANTICIPATION_V4'}});
    expect(result.matchedCount).toBe(1);
  });
}
async function entrySnapshot(workspace:Workspace,jobId:string){
  const filter={workspaceId:workspace.workspaceId,jobId};
  return {
    job:await workspace.db.collection<any>('lookupJobs').findOne({_id:jobId,workspaceId:workspace.workspaceId}),
    lines:await workspace.db.collection('purchaseLines').find(filter).sort({index:1}).toArray(),
    items:await workspace.db.collection('lookupItems').find(filter).sort({cnpj:1}).toArray()
  };
}
async function fiscalStep(page:Page,step:'regimes'|'difal'|'rbt12'|'documents'){
  const wizard=page.locator('#analysis-wizard'),steps=['regimes','rbt12','documents','difal'];
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
  await expect(amount(page,first)).toHaveText('R$ 0,00');
  await expect(tax(page,second)).toHaveCount(0);await expect(card(page,second)).toContainText('Aguardando documento');
  const firstGeneration=await generationFor(page.request,baseURL!,analysis.id);
  expect(firstGeneration.companies[0][first==='SALES'?'sales':'purchase'].purchaseInput[first==='SALES'?'difal':'anticipation'].amountCents).toBe(0);
  await upload(page,second);await expect(page).toHaveURL(originalUrl);
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 0,00');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await expect(tax(page,'PURCHASES')).toContainText(/antecipação de ICMS/i);
  await expect(tax(page,'SALES')).toContainText(/DIFAL de saída/i);
  const saved=await generationFor(page.request,baseURL!,analysis.id);expect(saved._id).toBe(firstGeneration._id);
  expect(saved.companies[0][first==='SALES'?'sales':'purchase']).toEqual(firstGeneration.companies[0][first==='SALES'?'sales':'purchase']);
  await page.reload();await expect(amount(page,'PURCHASES')).toHaveText('R$ 0,00');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  if(first==='PURCHASES')for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await tax(page,'SALES').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    for(const type of ['PURCHASES','SALES'] as const)expect(await amount(page,type).evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await page.locator('#analysis-fiscal-documents-view').screenshot({path:info.outputPath(`difal-after-read-${width}.png`)});
  }
  expect(errors).toEqual([]);
});

test('evidência da entrada permanece ao excluir da DRE e saída segue a regra sem alterar a fonte',async({page,browser,baseURL,difalWorkspace})=>{
  test.setTimeout(120_000);page.setDefaultTimeout(15_000);
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'PURCHASES',[{totalCents:50_000,recipientUf:'SP',document:'00000000000191'}]);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:'SP'}]);
  const original=await generationFor(page.request,baseURL!,analysis.id);await page.goto(documentsUrl(analysis.id));
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  const writes:string[]=[];page.on('request',request=>{if(request.method()==='PATCH'&&new URL(request.url()).pathname.startsWith('/api/v4/analyses/'))writes.push(request.url());});
  await fiscalStep(page,'difal');await page.locator('#analysis-difal-no').check();await fiscalStep(page,'documents');
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await expect(tax(page,'SALES')).toContainText(OUTGOING_REPORT_NOTE);
  await fiscalStep(page,'difal');await page.locator('#analysis-difal-yes').check();
  const details=page.locator('#analysis-difal-details');if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  await details.locator('[data-analysis-difal-enabled="hybrid"]').uncheck();
  await expect(details.locator('[data-analysis-difal-operation="exit"]')).toHaveCount(0);
  await fiscalStep(page,'documents');await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await fiscalStep(page,'difal');
  await details.locator('[data-analysis-difal-regime="pure"][data-analysis-difal-operation="entry"]').uncheck();
  await expect(details.locator('[data-analysis-difal-operation="exit"]')).toHaveCount(0);
  // Unchecking both inclusion cards is an explicit choice not to include entry.
  await expect(page.locator('#analysis-difal-no')).toBeChecked();
  await expect(page.locator('#analysis-difal-details')).toBeHidden();
  await page.locator('#analysis-difal-no').check();
  await fiscalStep(page,'documents');await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  expect(writes).toEqual([]);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${analysis.id}/fiscal`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="save"]').click();expect((await saving).ok()).toBe(true);
  await page.reload();await expect(amount(page,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  const unchanged=await generationFor(page.request,baseURL!,analysis.id);expect(unchanged).toEqual(original);
  const context=await browser.newContext({baseURL});try{
    await signIn(context.request,baseURL!,difalWorkspace.viewer);const viewer=await context.newPage();await viewer.goto(documentsUrl(analysis.id));
    await expect(amount(viewer,'PURCHASES')).toHaveText('R$ 36,60');await expect(amount(viewer,'SALES')).toHaveText('R$ 0,00');
    await expect(viewer.locator('[data-analysis-add-document]')).toHaveCount(0);await expect(card(viewer,'SALES').getByRole('link',{name:'Conferir relatório'})).toBeVisible();
  }finally{await context.close();}
});

test('saída é zero com CPF interestadual ou UF pendente e a entrada continua independente',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'PURCHASES',[{totalCents:50_000,recipientUf:'MG'}]);
  await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:'SP'},{totalCents:50_000,recipientUf:''}]);
  await page.goto(documentsUrl(analysis.id));await expect(amount(page,'PURCHASES')).toHaveText('R$ 0,00');
  await expect(amount(page,'SALES')).toHaveText('R$ 0,00');await expect(tax(page,'SALES')).toContainText(OUTGOING_REPORT_NOTE);
  await expect(tax(page,'SALES')).not.toContainText(/parcial|pendente|Não possui vendas/i);await expect(tax(page,'PURCHASES')).not.toContainText(/pendente|indisponível/i);
  const generation=await generationFor(page.request,baseURL!,analysis.id);
  expect(generation.companies[0].sales.purchaseInput.difal).toMatchObject({version:'DIFAL_ESTIMATE_V6',amountCents:0,eligibleLines:0,pendingLines:0});
});

test('leitura incompleta não antecipa o cartão e UF pendente só bloqueia a entrada',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[{totalCents:100_000,recipientUf:''}],false);
  await page.goto(documentsUrl(analysis.id));await expect(card(page,'SALES')).toContainText('Finalização pendente');
  await expect(tax(page,'SALES')).toHaveCount(0);await page.locator('[data-analysis-document-retry="SALES"]').click();
  await expect(card(page,'SALES')).toContainText('Leitura concluída');await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await expect(tax(page,'SALES')).toContainText(OUTGOING_REPORT_NOTE);
  const generation=await generationFor(page.request,baseURL!,analysis.id);expect(generation.companies[0].sales._id).toBe(jobId);
  expect(generation.companies[0].sales.purchaseInput.difal).toMatchObject({version:'DIFAL_ESTIMATE_V6',amountCents:0,eligibleLines:0,pendingLines:0});
  await attach(page.request,baseURL!,analysis,prepared.generationId,'PURCHASES',[{totalCents:50_000,recipientUf:'',document:'00000000000191'}]);
  await page.reload();await expect(amount(page,'PURCHASES')).toHaveText('Pendente');
  await expect(tax(page,'PURCHASES')).not.toContainText('R$ 0,00');
  await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
});


test('cartão de vendas mantém janeiro–setembro e DIFAL zero mesmo com CPF interestadual',async({page,baseURL,difalWorkspace},info)=>{
  test.setTimeout(90_000);
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attach(page.request,baseURL!,analysis,prepared.generationId,'SALES',[
    {totalCents:100_000,recipientUf:'SP'},
    {totalCents:200_000,recipientUf:'SP',document:'00000000000191'},
    {totalCents:300_000,recipientUf:'MG',serviceDate:'2025-09-15'},
    {totalCents:900_000,recipientUf:'SP',serviceDate:'2025-10-15'},
    {totalCents:500_000,recipientUf:'',document:'00000000000191',serviceDate:'2025-09-15'}
  ]);
  const original=await generationFor(page.request,baseURL!,analysis.id);
  expect(original.companies[0].sales.purchaseInput.difal.amountCents).toBe(0);
  await page.goto(documentsUrl(analysis.id));
  await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await expect(tax(page,'SALES')).toContainText('janeiro a setembro de 2025');
  await expect(card(page,'PURCHASES')).toContainText('Aguardando documento');
  const limited=await api(page.request,baseURL!,'GET',`/api/v4/sales/${jobId}/difal-period`);
  expect(limited.difal).toMatchObject({amountCents:0,baseCents:0,eligibleLines:0,pendingLines:0,version:'DIFAL_ESTIMATE_V6'});
  expect(limited.period.excludedMonths).toEqual(['2025-10']);
  expect(await generationFor(page.request,baseURL!,analysis.id)).toEqual(original);
  await page.reload();await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  const emptyAnalysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),emptyPrepared=await prepare(page.request,baseURL!,emptyAnalysis);
  await attach(page.request,baseURL!,emptyAnalysis,emptyPrepared.generationId,'SALES',[
    {totalCents:200_000,recipientUf:'SP',document:'00000000000191'},
    {totalCents:300_000,recipientUf:'MG',serviceDate:'2025-09-15'}
  ]);
  await page.goto(documentsUrl(emptyAnalysis.id));await expect(amount(page,'SALES')).toHaveText('R$ 0,00');
  await expect(tax(page,'SALES')).toContainText(OUTGOING_REPORT_NOTE);
  await expect(tax(page,'SALES')).not.toContainText(/pendente|indisponível/i);
  await page.setViewportSize({width:390,height:900});await tax(page,'SALES').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await tax(page,'SALES').screenshot({path:info.outputPath('difal-disabled-zero-jan-set.png')});
});

test('entrada V4 lê CNPJ de janeiro–setembro pela API real, exclui CPF e outubro e preserva a origem',async({page,baseURL,difalWorkspace},info)=>{
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attachLegacyEntry(page.request,baseURL!,difalWorkspace,analysis,prepared.generationId,[
    {totalCents:100_000,recipientUf:'SP',document:'00000000000191'},
    {totalCents:200_000,recipientUf:'SP',document:'00000000000191',serviceDate:'2025-09-15'},
    {totalCents:400_000,recipientUf:'SP'},
    {totalCents:900_000,recipientUf:'SP',document:'00000000000191',serviceDate:'2025-10-15'}
  ]);
  const before=await entrySnapshot(difalWorkspace,jobId);
  expect(before.job?.purchaseInput.anticipation).toMatchObject({
    version:'ICMS_ANTICIPATION_V4',baseCents:1_600_000,amountCents:117_120,eligibleLines:4,pendingLines:0
  });
  const savedFiscal=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal;
  const response=page.waitForResponse(result=>new URL(result.url()).pathname===`/api/v4/purchases/${jobId}/difal-period`);
  await page.goto(documentsUrl(analysis.id));
  const checked=await response;expect(checked.ok()).toBe(true);
  const estimate=await checked.json();
  expect(estimate).toMatchObject({jobId,clientId:analysis.clientId,generationId:prepared.generationId,
    anticipation:{version:'ICMS_ANTICIPATION_V5',baseCents:300_000,amountCents:21_960,eligibleLines:2,pendingLines:0}});
  expect(estimate.period).toMatchObject({version:'JAN_SEP_V1',sourceYear:2025,complete:true,months:9,
    includedMonths:['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09'],excludedMonths:['2025-10']});
  await info.attach('entry-v4-jan-sep-response',{body:JSON.stringify(estimate,null,2),contentType:'application/json'});
  await expect(card(page,'PURCHASES')).toContainText('Leitura concluída');
  await expect(amount(page,'PURCHASES')).toHaveText('R$ 219,60');
  await expect(tax(page,'PURCHASES')).not.toContainText(/indisponível|pendente/i);
  await expect(card(page,'SALES')).toContainText('Aguardando documento');
  await tax(page,'PURCHASES').screenshot({path:info.outputPath('entry-v4-jan-sep-desktop.png')});
  await fiscalStep(page,'difal');
  const detected=page.locator('[data-difal-assessment="entry"]');
  await expect(detected).toHaveAttribute('data-difal-state','available');
  await expect(detected.locator('[data-difal-detected-amount]')).toHaveText('R$ 219,60');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await detected.screenshot({path:info.outputPath('entry-v4-jan-sep-mobile.png')});
  await page.reload();await expect(detected.locator('[data-difal-detected-amount]')).toHaveText('R$ 219,60');
  expect(await entrySnapshot(difalWorkspace,jobId)).toEqual(before);
  expect((await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal).toEqual(savedFiscal);
  expect(errors).toEqual([]);
});

test('entrada V4 com UF de CNPJ pendente não usa o CPF histórico como valor confirmado',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attachLegacyEntry(page.request,baseURL!,difalWorkspace,analysis,prepared.generationId,[
    {totalCents:50_000,recipientUf:'',document:'00000000000191'},
    {totalCents:100_000,recipientUf:'SP'}
  ]);
  const before=await entrySnapshot(difalWorkspace,jobId);
  expect(before.job?.purchaseInput.anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V4',amountCents:7_320,pendingLines:1});
  const response=page.waitForResponse(result=>new URL(result.url()).pathname===`/api/v4/purchases/${jobId}/difal-period`);
  await page.goto(documentsUrl(analysis.id));
  const checked=await response;expect(checked.ok()).toBe(true);
  expect((await checked.json()).anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V5',amountCents:0,baseCents:0,eligibleLines:0,pendingLines:1});
  await expect(amount(page,'PURCHASES')).toHaveText('Pendente');
  await expect(tax(page,'PURCHASES')).not.toContainText(/R\$\s*(0,00|73,20)/);
  await fiscalStep(page,'difal');
  const detected=page.locator('[data-difal-assessment="entry"]');
  await expect(detected).toHaveAttribute('data-difal-state','pending');
  await expect(detected.locator('[data-difal-detected-amount]')).toHaveCount(0);
  await expect(page.locator('#analysis-difal-yes')).toBeDisabled();
  expect(await entrySnapshot(difalWorkspace,jobId)).toEqual(before);
});

test('entrada legada retoma a API real após erro temporário sem fabricar zero nem alterar escolhas salvas',async({page,baseURL,difalWorkspace})=>{
  const analysis=await createAnalysis(page.request,baseURL!,difalWorkspace.writer),prepared=await prepare(page.request,baseURL!,analysis);
  const jobId=await attachLegacyEntry(page.request,baseURL!,difalWorkspace,analysis,prepared.generationId,[
    {totalCents:100_000,recipientUf:'SP',document:'00000000000191'}
  ]);
  const before=await entrySnapshot(difalWorkspace,jobId);
  const savedFiscal=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal;
  const path=`/api/v4/purchases/${jobId}/difal-period`;let attempts=0;
  await page.route('**'+path,async route=>{
    attempts++;
    if(attempts===1)await route.fulfill({status:503,json:{error:'SYNTHETIC_TEMPORARY_READ',message:'Leitura temporariamente indisponível.'}});
    else await route.continue();
  });
  await page.goto(`/analyses.html?id=${analysis.id}&sector=fiscal&step=difal`);
  const detected=page.locator('[data-difal-assessment="entry"]');
  await expect(detected).toHaveAttribute('data-difal-state','unavailable');
  await expect(detected.locator('[data-difal-detected-amount]')).toHaveCount(0);
  await expect(detected).not.toContainText('R$ 0,00');
  await expect(page.locator('#analysis-difal-yes')).toBeDisabled();
  expect(attempts).toBe(1);
  await expect(page.locator('#analysis-difal-retry')).toBeEnabled();
  const response=page.waitForResponse(result=>new URL(result.url()).pathname===path&&result.status()===200);
  await page.locator('#analysis-difal-retry').click();
  expect((await(await response).json()).anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V5',amountCents:7_320,pendingLines:0});
  await expect(detected).toHaveAttribute('data-difal-state','available');
  await expect(detected.locator('[data-difal-detected-amount]')).toHaveText('R$ 73,20');
  expect(attempts).toBe(2);
  await fiscalStep(page,'documents');await expect(amount(page,'PURCHASES')).toHaveText('R$ 73,20');
  expect(await entrySnapshot(difalWorkspace,jobId)).toEqual(before);
  expect((await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}?summary=1`)).analysis.fiscal).toEqual(savedFiscal);
});
