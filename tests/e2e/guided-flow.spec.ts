import {test, expect, type Page, type TestInfo} from '@playwright/test';
import * as XLSX from 'xlsx';
import {mockStatement,readStatement} from './extrato-helper.ts';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';

const generationId='00000000-0000-4000-8000-000000000090';
const clientId='00000000-0000-4000-8000-000000000091';
const jobId='00000000-0000-4000-8000-000000000092';
const company={_id:clientId,code:'091',name:'EMPRESA GUIADA SINTÉTICA',active:true};
const guidedUrl=`/purchases.html?generation=${generationId}&client=${clientId}&guided=1`;
const manualFields=['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'];

// The exported model's fixed positions are intentional. CPF-only data lets the
// real persistence flow finish without any external CNPJ lookup or real reports.
function syntheticReport(totalCents=450_000) {
  const header=Array(28).fill(''),row=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  row[0]='123.456.789-00';row[7]='15/08/2026';row[8]='PESSOA SINTÉTICA';row[15]='1';row[16]=(totalCents/100).toFixed(2).replace('.',',');
  for(const column of [24,25,26,27])row[column]='0,00';
  return [header,row];
}
const reportFile=(name:string,totalCents:number)=>({name,mimeType:'text/csv',buffer:Buffer.from(syntheticReport(totalCents).map(row=>row.join(';')).join('\r\n'),'latin1')});

async function screenshots(page:Page,info:TestInfo,name:string) {
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const path=info.outputPath(`${name}-${width}.png`);await page.screenshot({path,fullPage:true});
    await info.attach(`${name} ${width}`,{path,contentType:'image/png'});
  }
}

test('Company selection and report confirmation create nothing until an explicit valid confirmation',async({page})=>{
  await purchaseSession(page);let writes=0;
  await page.route('**/api/v4/generations',r=>{writes++;return r.fulfill({status:503,json:{message:'Falha sintética. Tente novamente.'}});});
  await page.goto('/generations.html');await expect(page.locator('[data-select-company]')).toHaveCount(0);
  await page.locator('#generation-search').fill(company.code);await page.locator(`[data-select-company="${clientId}"]`).click();
  const dialog=page.getByRole('dialog',{name:'Quais relatórios serão incluídos?'});
  await expect(dialog).toBeVisible();await expect(page.locator('#generation-reports-company')).toContainText(company.name);
  for(const type of ['PURCHASES','SALES'])await expect(page.locator(`[data-guided-report][value="${type}"]`)).toBeChecked();
  await page.locator('#generation-reports-back').click();await expect(dialog).toBeHidden();expect(writes).toBe(0);
  await page.locator(`[data-select-company="${clientId}"]`).click();
  for(const type of ['PURCHASES','SALES'])await page.locator(`[data-guided-report][value="${type}"]`).uncheck();
  await expect(page.locator('#generation-create')).toBeDisabled();expect(writes).toBe(0);
  await page.locator('[data-guided-report][value="SALES"]').check();
  const requests:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v4/generations')requests.push(r.postDataJSON());});
  await page.locator('#generation-create').click();await expect(dialog.getByRole('alert')).toContainText('Falha sintética');
  await page.locator('#generation-create').click();await expect.poll(()=>writes).toBe(2);
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0]).toMatchObject({clientIds:[clientId],requiredReports:['SALES']});
});

test('Real guided reports reach a saved manual-RBT12 simulation and reopen with their original values',async({page,browser,baseURL},info)=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const origin=new URL(baseURL!).origin;
  async function post(path:string,data:unknown){const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();}
  expect(process.env.MONGODB_URI,'Use a disposable MongoDB').toBeTruthy();
  await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16)),name='Empresa sintética fluxo '+code;
  const catalog=await post('/api/v4/clients/import',{rows:[{code,name}]});expect(catalog.success).toBe(1);const realClient=catalog.items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);
  await screenshots(page,info,'guided-company-search');await page.locator(`[data-select-company="${realClient}"]`).click();
  await screenshots(page,info,'guided-report-types');
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v4/generations'&&r.request().method()==='POST');
  await page.locator('#generation-create').click();const creation=await created;expect(creation.ok()).toBe(true);const generation={_id:creation.request().postDataJSON().generationId};
  await expect(page).toHaveURL(/purchases\.html\?.*guided=1/);expect(new URL(page.url()).searchParams.get('client')).toBe(realClient);
  for(const [kind,total] of [['purchases',450000],['sales',1200000]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();
    await page.locator('#purchase-file').setInputFiles(reportFile(code+'-'+kind+'.csv',total));
    await expect(page.locator('.purchase-guided-summary')).toBeVisible();
    await expect(page.locator('.purchase-guided-summary')).toContainText(kind==='purchases'?'4.500,00':'12.000,00');
    await expect(page.locator('.purchase-group')).toHaveCount(kind==='purchases'?2:3);
    await expect(page.locator('button.purchase-group,#purchase-results')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Conferir colunas e valores'})).toHaveCount(0);
    await expect(page.locator('[data-guided-continue]')).toBeVisible();await screenshots(page,info,'guided-'+kind+'-ready');
    await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();await expect(page.locator('#simulator-form')).toBeHidden();
  await page.locator('#guided-rbt12-skip').click();await expect(page.locator('#simulator-form')).toBeVisible();
  await expect(page.locator('#rbt12')).toBeEditable();await expect(page.locator('#rbt12')).toHaveValue('');
  for(const field of manualFields)await expect(page.locator('#'+field)).toHaveValue('');
  await expect(page.locator('#salesCpfCents')).toHaveValue('12000.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('4500.00');
  await screenshots(page,info,'guided-manual-inputs');
  let saves=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v4/simulations')saves++;});
  await page.locator('#generate-simulation').click();expect(saves).toBe(0);await expect(page.locator('#results-top')).toHaveCount(0);
  await page.locator('#rbt12').fill('150000');for(const field of manualFields)await page.locator('#'+field).fill('0');
  await page.locator('#generate-simulation').click();expect(saves).toBe(0);await expect(page.locator('#results-top')).toHaveCount(0);
  await page.locator('#rbt12-manual-confirm').check();await page.locator('#rbt12').fill('160000');await expect(page.locator('#rbt12-manual-confirm')).not.toBeChecked();
  await page.locator('#rbt12').fill('150000');await page.locator('#rbt12-manual-confirm').check();
  const saving=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v4/simulations'&&r.request().method()==='POST');
  await page.locator('#generate-simulation').click();const response=await saving;expect(response.ok(),await response.text()).toBe(true);const snapshot=await response.json();
  expect(snapshot).toMatchObject({generationId:generation._id,clientId:realClient,rbt12Source:'MANUAL',reportMonths:1,periodBasis:'COLUMN_H',draft:{rbt12:150000,values:{salesRevenue:12000,regularPurchases:4500}},source:{purchases:{totalCents:450000},sales:{totalCents:1200000}}});
  expect(snapshot.rbt12Extraction).toBeFalsy();expect(snapshot.rbt12ExtractionId).toBeFalsy();expect(snapshot.result.annualRevenue).toBe(144000);
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');await screenshots(page,info,'guided-result');
  const mongo=new MongoClient(process.env.MONGODB_URI!);
  try{await mongo.connect();const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const stored=await db.collection<any>('simulations').findOne({_id:snapshot._id,workspaceId});expect(stored?.rbt12Source).toBe('MANUAL');expect(stored?.draft.rbt12).toBe(150000);
    expect(await db.collection('purchaseLines').countDocuments({workspaceId,jobId:{$in:[snapshot.source.purchases.jobId,snapshot.source.sales.jobId]}})).toBe(2);
  }finally{await mongo.close();}
  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},headers:{Origin:origin}});expect(login.ok()).toBe(true);
    const reopened=await fresh.newPage();await reopened.goto(`/simulator.html?simulation=${snapshot._id}`);
    await expect(reopened.locator('#simulation-snapshot')).toContainText('informada manualmente');await expect(reopened.locator('#simulator-form')).toHaveCount(0);
    await expect(reopened.locator('.sim-dre')).toContainText('144.000,00');await expect(reopened.locator('.sim-regime')).toHaveCount(4);
    await reopened.locator('#create-version').click();await expect(reopened.locator('#rbt12')).toBeEditable();
    await reopened.locator('#rbt12-use-pdf').click();await readStatement(reopened);
    await reopened.reload();await expect(reopened.locator('#rbt12')).toHaveValue('150000.00');
    await expect(reopened.locator('#rbt12')).toHaveAttribute('readonly','');
    await expect(reopened.locator('#rbt12-manual-notice')).toBeHidden();
    await expect(reopened.locator('#rbt12-manual-confirm')).not.toHaveAttribute('required','');
  }finally{await fresh.close();}
  expect(errors).toEqual([]);
});

async function purchaseSession(page:Page,role='operator',status?:string) {
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'synthetic',role,mustChangePassword:false}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[company]}}));
  const job={_id:jobId,generationId,clientId,clientCode:company.code,clientName:company.name,status:status||'UPLOADING',fileName:'compras.csv',calculationVersion:'NET_V2',uploaded:1,received:0,expectedRows:1,summary:{unique:1,lines:1},nextPollMs:700};
  await page.route('**/api/v4/generations/'+generationId,r=>r.fulfill({json:{_id:generationId,requiredReports:['PURCHASES','SALES'],companies:[{clientId,code:company.code,name:company.name,purchaseJobId:status?jobId:null,purchase:status?job:null,sales:null}]}}));
  await page.route('**/api/v4/lookups/*/progress?*',r=>r.fulfill({json:{job,partial:true,canRecheck:false,metrics:{total:1,completed:0,optants:0,nonOptants:0,unconfirmed:0,pending:1,retrying:0},items:[],total:0,page:1,pageSize:25}}));
  return job;
}

test('Guided import blocks an invalid or ambiguous model before sending any rows',async({page},info)=>{
  await purchaseSession(page);let writes=0;
  await page.route(/\/api\/v4\/(?:purchases|generations\/[^/]+\/purchases)(?:[/?]|$)/,r=>{if(r.request().method()!=='GET')writes++;return r.fulfill({json:{items:[],total:0}});});
  await page.goto(guidedUrl);await expect(page.locator('#purchase-file')).toBeEnabled();
  await screenshots(page,info,'guided-upload');
  await page.locator('#purchase-file').setInputFiles({name:'invalido.csv',mimeType:'text/csv',buffer:Buffer.from('Documento;Nome;Total\n12345678900;Pessoa;10,00')});
  await expect(page.locator('#purchase-error')).toContainText('Não reconhecemos o modelo');expect(writes).toBe(0);
  const workbook=XLSX.utils.book_new();
  for(const name of ['Primeiro relatório','Segundo relatório'])XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(syntheticReport()),name);
  await page.locator('#purchase-file').setInputFiles({name:'ambiguo.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(workbook,{bookType:'xlsx',type:'buffer'})});
  await expect(page.locator('#purchase-error')).toContainText('mais de uma aba ou cabeçalho');expect(writes).toBe(0);
  const missingName=syntheticReport();missingName[1][8]='';
  await page.locator('#purchase-file').setInputFiles({name:'sem-nome.csv',mimeType:'text/csv',buffer:Buffer.from(missingName.map(row=>row.join(';')).join('\r\n'),'latin1')});
  await expect(page.locator('#purchase-review')).toContainText('Razão social (I): preenchimento obrigatório');
  await expect(page.locator('#purchase-confirm')).toHaveCount(0);expect(writes).toBe(0);
  await expect(page.getByRole('button',{name:'Conferir colunas e valores'})).toHaveCount(0);
});

for(const role of ['operator','viewer'])test(`Guided ${role} resume respects processing permissions`,async({page})=>{
  const job=await purchaseSession(page,role,'PROCESSING');let writes=0;
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,r=>{
    if(r.request().method()!=='GET'){writes++;return r.fulfill({status:503,json:{message:'Fonte sintética temporariamente indisponível. Retome a consulta.'}});}
    return r.fulfill({json:job});
  });
  await page.goto(guidedUrl+'&job='+jobId);
  await expect(page.getByRole('heading',{name:'Consultando os CNPJs'})).toBeVisible();
  if(role==='operator'){
    await expect(page.locator('#purchase-error')).toContainText('Fonte sintética temporariamente indisponível');expect(writes).toBe(1);
    await expect(page.locator('#purchase-process')).toBeEnabled();await page.locator('#purchase-process').click();
    await expect.poll(()=>writes).toBe(2);
  }else{
    await expect(page.locator('#purchase-file')).toHaveCount(0);await expect(page.locator('#purchase-process')).toHaveCount(0);
    await page.clock.install();await page.clock.runFor(5000);expect(writes).toBe(0);
  }
  await expect(page.locator('#purchase-results')).toHaveCount(0);
  await expect(page.locator('#lookup-live table,#lookup-live select')).toHaveCount(0);
});

test('Guided statement selection reads automatically and requires success before exposing the form',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let saves=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v4/simulations')saves++;});
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'synthetic',role:'operator'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:{generationId,clientId,company,
    purchases:{jobId,fileName:'compras.csv',totalCents:450000,calculationVersion:'NET_V2'},sales:{jobId:'00000000-0000-4000-8000-000000000093',fileName:'vendas.csv',totalCents:1200000,calculationVersion:'NET_V2'},
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:1200000,purchasesOptantCents:0,purchasesNonOptantCents:450000},warnings:[],periodBasis:'REPORT_TOTALS'}}));
  await mockStatement(page);
  await page.goto(`/simulator.html?generation=${generationId}&client=${clientId}&guided=1&step=extrato`);
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();await expect(page.locator('#simulator-form')).toBeHidden();
  await expect(page.locator('#guided-rbt12-continue')).toBeDisabled();
  await screenshots(page,info,'guided-extrato');
  await page.route('**/api/simples?*',r=>r.fulfill({status:422,json:{message:'Seção 2.2 incompleta: competência ilegível.'}}));
  await page.locator('#rbt12-pdf').setInputFiles({name:'ilegivel.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
  await expect(page.locator('#rbt12-status')).toContainText('ilegível');await expect(page.locator('#guided-rbt12-continue')).toBeDisabled();
  await expect(page.locator('#simulator-form')).toBeHidden();
  await mockStatement(page);
  await page.locator('#rbt12-pdf').setInputFiles({name:'extrato-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
  await expect(page.locator('#guided-rbt12-continue')).toBeEnabled();await expect(page.locator('#rbt12')).toHaveValue('150000.00');
  await expect(page.locator('#simulator-form')).toBeHidden();await page.locator('#guided-rbt12-continue').click();
  await expect(page.locator('#simulator-form')).toBeVisible();await expect(page.locator('#rbt12')).toHaveAttribute('readonly','');
  for(const id of manualFields)await expect(page.locator('#'+id)).toHaveValue('');
  await expect(page.locator('#salesCpfCents')).toHaveValue('12000.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('4500.00');
  expect(saves).toBe(0);await page.reload();await expect(page.locator('#simulator-form')).toBeVisible();
  await expect(page.locator('#guided-rbt12-stage')).toBeHidden();expect(saves).toBe(0);
  await page.route('**/api/simples?*',r=>r.fulfill({status:422,json:{message:'Seção 2.2 indisponível. Leia o extrato novamente.'}}));
  await page.reload();await expect(page.locator('#guided-rbt12-stage')).toBeVisible();
  await expect(page.locator('#simulator-form')).toBeHidden();await expect(page.locator('#rbt12-status')).toContainText('indisponível');expect(saves).toBe(0);
  expect(errors).toEqual([]);
});
