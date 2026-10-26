import {test as base,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {csvParse} from '../../src/domain.ts';

type Credentials={id:string;email:string;password:string};
type Accounts={db:Db;workspaceId:string;accounting:Credentials;fiscal:Credentials};
const test=base.extend<{analysisAccounts:Accounts}>({
  analysisAccounts:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const credentials=(sector:string)=>({id:randomUUID(),email:`analysis-${sector}-${randomUUID()}@example.test`,password:`Synthetic-analysis-${randomUUID()}`});
    const accounting=credentials('accounting'),fiscal=credentials('fiscal');
    try{
      for(const [account,role,name] of [[accounting,'admin','Contábil sintético'],[fiscal,'operator','Fiscal sintético']] as const){
        await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name,role,active:true,
          mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      }
      await use({db,workspaceId,accounting,fiscal});
    }finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:{$in:[accounting.id,fiscal.id]}});
      await db.collection<any>('users').deleteMany({workspaceId,_id:{$in:[accounting.id,fiscal.id]}});
      await mongo.close();
    }
  }
});

async function post(request:APIRequestContext,baseURL:string,path:string,data:unknown){
  const response=await request.post(path,{data,headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
}
async function get(request:APIRequestContext,path:string){
  const response=await request.get(path);expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,{email,password}:Credentials){
  await post(request,baseURL,'/api/auth/login',{email,password});
}
type WizardKind='new'|'fiscal'|'accounting'|'config';
const wizardSteps:Record<WizardKind,string[]>={
  new:['company','setup'],fiscal:['documents','tax'],accounting:['values'],config:['choices']
};
async function wizardStep(page:Page,kind:WizardKind,step:string){
  const wizard=page.locator('#analysis-wizard'),steps=wizardSteps[kind];
  await expect(wizard).toBeVisible();await expect(wizard).toHaveAttribute('data-wizard-kind',kind);
  expect(steps).toContain(step);
  for(let attempt=0;attempt<steps.length;attempt++){
    const current=await wizard.getAttribute('data-wizard-step');expect(steps).toContain(current);
    if(current===step)return;
    await page.locator(steps.indexOf(current!)>steps.indexOf(step)?'#analysis-wizard-back':'#analysis-wizard-next').click();
    await expect(wizard).not.toHaveAttribute('data-wizard-step',current!);
  }
  await expect(wizard).toHaveAttribute('data-wizard-step',step);
}
async function closeWizard(page:Page){
  if(await page.locator('#analysis-wizard').isVisible()){
    await page.locator('#analysis-wizard-close').click();await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  }
}
async function openSector(page:Page,sector:'fiscal'|'accounting',step?:string){
  const wizard=page.locator('#analysis-wizard'),opener=page.locator('[data-analysis-sector="'+sector+'"]').first();
  await expect(opener).toBeAttached();
  if(await wizard.isVisible()){
    const current=await wizard.getAttribute('data-wizard-kind');
    if(current!==sector){
      if(current==='fiscal'||current==='accounting')await wizard.locator('[data-analysis-sector="'+sector+'"]').click();
      else{await closeWizard(page);await opener.click();}
    }
  }else{
    await opener.click();
  }
  await expect(wizard).toBeVisible();await expect(wizard).toHaveAttribute('data-wizard-kind',sector);
  if(step)await wizardStep(page,sector,step);
}
async function openConfig(page:Page){
  await expect(page.locator('#analysis-open-config')).toBeAttached();
  await closeWizard(page);await page.locator('#analysis-open-config').click();await wizardStep(page,'config','choices');
}
async function saveConfig(page:Page){
  await wizardStep(page,'config','choices');await page.locator('#analysis-save-config').click();
  await expect(page.locator('#analysis-feedback')).toContainText('Escolhas salvas');
  await expect(page.locator('#analysis-wizard')).not.toBeVisible();
}
async function company(request:APIRequestContext,baseURL:string){
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const created=await post(request,baseURL,'/api/v4/clients/import',{rows:[{code,name:`Empresa sintética análise ${code}`,uf:'MG'}]});
  return {id:created.items[0].id,code};
}
async function saveSector(page:Page,id:string,sector:'fiscal'|'accounting',complete=true){
  await openSector(page,sector,complete?(sector==='fiscal'?'tax':'values'):undefined);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/${sector}`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="'+(complete?'complete':'save')+'"]').click();
  const response=await saving;expect(response.ok(),await response.text()).toBe(true);
  const result=await response.json();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  if(complete)await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  else await expect(page.locator('#analysis-wizard')).toBeVisible();
  return result.analysis;
}
async function generate(page:Page,id:string){
  await closeWizard(page);
  await expect(page.locator('#analysis-generate')).toBeEnabled();
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/generate`&&response.request().method()==='POST');
  await page.locator('#analysis-generate').click();const response=await saving;
  expect(response.status()).toBe(200);
  // Navigation can discard the Chromium response body; verify the persisted GET
  // opened by the application, rather than racing against that navigation.
  await expect(page.locator('#simulation-snapshot')).toBeVisible();
  const simulationId=new URL(page.url()).searchParams.get('simulation');expect(simulationId).toBeTruthy();
  return get(page.request,`/api/v4/simulations/${simulationId}`);
}
function report(name:string,kind:'purchases'|'sales'){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const rows=[1,2].map(month=>{
    const row=Array(28).fill('');row[0]='123.456.789-00';row[7]=`15/0${month}/2025`;row[8]='Pessoa sintética';row[9]='MG';
    row[11]=kind==='sales'?'5102001':'1102001';row[14]='Operação sintética por competência';row[15]='1';
    row[16]=((kind==='sales'?1000:200)*month).toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...rows].map(row=>row.join(';')).join('\r\n'),'latin1')};
}
async function importInBrowser(page:Page,code:string){
  await openSector(page,'fiscal','documents');
  await page.locator('#analysis-start-import').click();
  for(const kind of ['purchases','sales'] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();await expect(page.locator('#purchase-issuer-uf')).toHaveValue('MG');
    await page.locator('#purchase-file').setInputFiles(report(`${code}-${kind}.csv`,kind));
    await expect(page.locator('.purchase-guided-summary')).toBeVisible();await page.locator('[data-guided-continue]').click();
  }
  await openSector(page,'fiscal','tax');
}
async function openDetails(page:Page,id:string){
  const detail=page.locator('#'+id);await expect(detail).toBeAttached();
  if(await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
  await expect(detail).toHaveJSProperty('open',true);
}
async function addMonth(page:Page,month:string,values:(number|null)[]){
  await openSector(page,'accounting','values');await openDetails(page,'analysis-accounting-tools');
  await page.locator('#analysis-new-month').fill(month);await page.locator('#analysis-new-month').press('Enter');
  await expect(page.locator('[data-accounting-month="'+month+'"]')).toHaveCount(1);
  await openDetails(page,'analysis-month-'+month);
  const keys=['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'];
  for(let i=0;i<keys.length;i++)if(values[i]!==null)await page.locator(`[data-accounting-month="${month}"] [data-accounting-field="${keys[i]}"]`).fill(String(values[i]));
}

test('Fiscal e Contábil compartilham uma análise, regimes sem Simples dispensam extrato e versões preservam valores reais',async({page,browser,baseURL,analysisAccounts},info)=>{
  test.setTimeout(180_000);page.setDefaultTimeout(15_000);
  const {db,workspaceId,accounting,fiscal}=analysisAccounts,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,accounting);const client=await company(page.request,baseURL!);
  await page.goto('/analyses.html?view=new');await page.locator('#analysis-company-search').fill(client.code);
  await page.locator(`[data-analysis-client="${client.id}"]`).click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await page.locator('input[name="sector"][value="accounting"]').check();
  await page.locator('#analysis-new-regime-pure').uncheck();await page.locator('#analysis-new-regime-hybrid').uncheck();
  await page.screenshot({path:info.outputPath('analysis-setup-desktop.png'),fullPage:true});
  await page.locator('#analysis-open-company').click();await openSector(page,'accounting','values');
  const id=new URL(page.url()).searchParams.get('id')!;expect(id).toBeTruthy();
  await expect(page.locator('#analysis-generate')).toBeDisabled();
  await addMonth(page,'2025-01',[100,50,10,20,null]);
  await page.locator('#analysis-wizard button[value="complete"]').click();
  await expect(page.locator('#analysis-error')).toContainText('Use zero somente');
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','values');
  await expect(page.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')).toHaveValue('100');
  await page.locator('[data-accounting-month="2025-01"] [data-accounting-field="adminExpensesCents"]').fill('0');
  await addMonth(page,'2025-02',[200,60,15,30,5]);
  let analysis=await saveSector(page,id,'accounting');
  expect(analysis.accounting.status).toBe('COMPLETE');expect(analysis.fiscal.status).toBe('DRAFT');expect(analysis.readiness.ready).toBe(false);
  expect(analysis.accounting.data.months.map((row:any)=>row.salariesCents)).toEqual([10000,20000]);
  await page.screenshot({path:info.outputPath('analysis-overview-desktop.png'),fullPage:true});
  await openSector(page,'accounting','values');
  await page.screenshot({path:info.outputPath('analysis-accounting-desktop.png'),fullPage:true});

  const fiscalContext=await browser.newContext({baseURL});
  try{
    await signIn(fiscalContext.request,baseURL!,fiscal);const fiscalPage=await fiscalContext.newPage();
    fiscalPage.on('pageerror',error=>errors.push(error.message));const requests:string[]=[];
    fiscalPage.on('request',request=>{const path=new URL(request.url()).pathname;if(path.includes('simples'))requests.push(path);});
    await fiscalPage.goto(`/analyses.html?id=${id}&sector=fiscal`);
    await openSector(fiscalPage,'fiscal','documents');
    await expect(fiscalPage.locator('#analysis-rbt12-pdf,#analysis-rbt12')).toHaveCount(0);
    await importInBrowser(fiscalPage,client.code);
    await expect(fiscalPage.locator('#analysis-rbt12-pdf,#analysis-rbt12')).toHaveCount(0);
    await openSector(fiscalPage,'fiscal','tax');
    await fiscalPage.screenshot({path:info.outputPath('analysis-fiscal-desktop.png'),fullPage:true});
    analysis=await saveSector(fiscalPage,id,'fiscal');expect(analysis.readiness.ready).toBe(true);
    expect(analysis.accounting.updatedBy.id).toBe(accounting.id);expect(analysis.fiscal.updatedBy.id).toBe(fiscal.id);
    const first=await generate(fiscalPage,id);
    expect(first.analysisId).toBe(id);expect(first.rbt12Source).toBe('NOT_REQUIRED');expect(first.rbt12Extraction).toBeNull();
    expect(first.draft.rbt12).toBeUndefined();expect(first.engineInput.rbt12).toBeNull();expect(first.rbt12Schedule).toBeUndefined();
    expect(first.result.regimes.map((row:any)=>row.id)).toEqual(['presumed','actual']);expect(first.result.annualRevenue).toBe(3000);
    expect(first.monthlyInputs.map((row:any)=>row.values)).toEqual([
      {serviceRevenue:0,salaries:100,rent:50,cardExpenses:10,benefits:20,adminExpenses:0},
      {serviceRevenue:0,salaries:200,rent:60,cardExpenses:15,benefits:30,adminExpenses:5}
    ]);
    await expect(fiscalPage.locator('.sim-regime')).toHaveCount(2);
    await expect(fiscalPage.locator('#dre-demonstrativo > .dre-table-wrap [data-dre-row="revenue"] td')).toHaveCount(2);
    await expect(fiscalPage.locator('#dre-demonstrativo > .dre-table-wrap [data-dre-row="revenue"] td').first()).toHaveText('R$ 3.000,00');
    expect(requests).toEqual([]);
    expect(await db.collection('analyses').countDocuments({workspaceId,clientId:client.id})).toBe(1);
    const jobIds=[first.source.purchases.jobId,first.source.sales.jobId];
    const frozenRows=await db.collection('purchaseLines').find({workspaceId,jobId:{$in:jobIds}}).sort({jobId:1,index:1}).toArray();
    expect(frozenRows).toHaveLength(4);

    await fiscalPage.locator('#dre-report-period').selectOption('complete');
    const downloading=fiscalPage.waitForEvent('download');await fiscalPage.locator('#export-dre-csv').click();
    const download=await downloading,stream=await download.createReadStream();let csv='';for await(const chunk of stream!)csv+=chunk;
    const rows=csvParse(csv,';');expect(rows.some(row=>row[0]==='Lucro Presumido')).toBe(true);expect(rows.some(row=>row[0]==='Lucro Real')).toBe(true);
    expect(rows.some(row=>['Simples Puro','Simples Híbrido'].includes(row[0]))).toBe(false);
    await fiscalPage.evaluate(()=>{window.print=()=>{};});await fiscalPage.locator('#print-dre').click();
    await expect(fiscalPage.locator('#dre-print-document [data-report-part="monthly"]')).toHaveCount(2);
    await fiscalPage.pdf({path:info.outputPath('analysis-two-regimes-complete.pdf'),format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true});

    // A new login resumes the same shared costs; editing creates a new immutable version.
    await page.goto(`/analyses.html?id=${id}&sector=accounting`);
    await openSector(page,'accounting','values');
    await expect(page.locator('[data-accounting-month="2025-02"] [data-accounting-field="salariesCents"]')).toHaveValue('200.00');
    await openDetails(page,'analysis-month-2025-01');
    await page.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]').fill('150');
    analysis=await saveSector(page,id,'accounting',false);
    expect(analysis.currentSimulation).toMatchObject({id:first._id,stale:true});await expect(page.locator('#analysis-generate')).toBeDisabled();
    expect(await get(page.request,`/api/v4/simulations/${first._id}`)).toEqual(first);
    await saveSector(page,id,'accounting');const second=await generate(page,id);
    expect(second._id).not.toBe(first._id);expect(second.parentSimulationId).toBe(first._id);expect(second.monthlyInputs[0].values.salaries).toBe(150);
    expect(await get(page.request,`/api/v4/simulations/${first._id}`)).toEqual(first);
    expect(await db.collection('purchaseLines').find({workspaceId,jobId:{$in:jobIds}}).sort({jobId:1,index:1}).toArray()).toEqual(frozenRows);
    await page.locator('#edit-analysis').click();await openConfig(page);
    await page.locator('#analysis-config-form input[name="regime"][value="presumed"]').uncheck();
    await saveConfig(page);
    await page.goto(`/analyses.html?id=${id}&sector=fiscal`);await saveSector(page,id,'fiscal');
    await page.goto(`/analyses.html?id=${id}&sector=accounting`);await saveSector(page,id,'accounting');
    const single=await generate(page,id);expect(single.result.regimes.map((row:any)=>row.id)).toEqual(['actual']);
    await expect(page.locator('.sim-regime')).toHaveCount(1);await expect(page.locator('#simulation-result')).toContainText('Resultado do regime selecionado');
    await expect(page.locator('#dre-demonstrativo > .dre-table-wrap [data-dre-row="revenue"] td')).toHaveCount(1);
    await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
    await expect(page.locator('#dre-print-document [data-report-part="monthly"]')).toHaveCount(1);
    await page.pdf({path:info.outputPath('analysis-single-regime-complete.pdf'),format:'A4',landscape:true,printBackground:true,preferCSSPageSize:true});
    await page.goto(`/analyses.html?id=${id}&view=versions`);
    await expect(page.locator('[data-analysis-version]')).toHaveCount(3);
    await expect(page.locator(`[data-analysis-version="${single._id}"]`)).toContainText('Versão corrente');
    const versions=await get(page.request,`/api/v4/analyses/${id}/versions`);expect(versions.items.filter((row:any)=>row.current)).toHaveLength(1);
    expect(await db.collection('analyses').countDocuments({workspaceId,clientId:client.id})).toBe(1);
    for(const width of [390,320]){
      await page.setViewportSize({width,height:960});await page.goto(`/analyses.html?id=${id}&sector=accounting`);
      await openSector(page,'accounting','values');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:info.outputPath(`analysis-accounting-${width}.png`),fullPage:true});
    }
    expect(errors).toEqual([]);
  }finally{await fiscalContext.close();}
});

test('Simples exige referência confirmada, trocar regimes retira o extrato e conflito mantém campos digitados',async({page,browser,baseURL,analysisAccounts})=>{
  test.setTimeout(120_000);
  await signIn(page.request,baseURL!,analysisAccounts.accounting);const client=await company(page.request,baseURL!);
  let analysis=(await post(page.request,baseURL!,'/api/v4/analyses',{clientId:client.id,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid']}})).analysis;
  const id=analysis.id;await page.goto(`/analyses.html?id=${id}&sector=fiscal`);await importInBrowser(page,client.code);
  await expect(page.locator('#analysis-rbt12-pdf')).toBeVisible();
  await wizardStep(page,'fiscal','tax');
  const incomplete=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/fiscal`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="complete"]').click();expect((await incomplete).ok()).toBe(false);
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','tax');
  await expect(page.locator('#analysis-error')).toBeVisible();await page.locator('#analysis-extrato-manual').click();
  await page.locator('#analysis-rbt12').fill('100000');await page.locator('#analysis-rbt12-confirm').check();
  analysis=await saveSector(page,id,'fiscal');expect(analysis.fiscal.data).toMatchObject({rbt12Source:'MANUAL',rbt12:100000,rbt12ManualConfirmed:true,rbt12DocumentId:null});
  await openConfig(page);
  await page.locator('#analysis-config-form input[name="regime"][value="pure"]').uncheck();
  await page.locator('#analysis-config-form input[name="regime"][value="hybrid"]').uncheck();
  await page.locator('#analysis-config-form input[name="regime"][value="actual"]').check();
  await saveConfig(page);await openSector(page,'fiscal','tax');
  await expect(page.locator('#analysis-rbt12-pdf,#analysis-rbt12')).toHaveCount(0);
  analysis=await saveSector(page,id,'fiscal');expect(analysis.fiscal.data).toMatchObject({rbt12Source:'NOT_REQUIRED',rbt12:null,rbt12DocumentId:null,rbt12ExtractionId:null,rbt12ManualConfirmed:false});

  await page.goto(`/analyses.html?id=${id}&sector=accounting`);
  await addMonth(page,'2025-01',[100,0,0,0,0]);await addMonth(page,'2025-02',[200,0,0,0,0]);await saveSector(page,id,'accounting');
  const context=await browser.newContext({baseURL});
  try{
    await signIn(context.request,baseURL!,analysisAccounts.fiscal);const concurrent=await context.newPage();
    await concurrent.goto(`/analyses.html?id=${id}&sector=accounting`);
    await openSector(concurrent,'accounting','values');
    await expect(concurrent.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')).toHaveValue('100.00');
    await openDetails(concurrent,'analysis-month-2025-01');
    await concurrent.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]').fill('222');
    await openSector(page,'accounting','values');
    await openDetails(page,'analysis-month-2025-01');
    await page.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]').fill('111');await saveSector(page,id,'accounting');
    await wizardStep(concurrent,'accounting','values');
    const conflict=concurrent.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/accounting`&&response.request().method()==='PATCH');
    await concurrent.locator('#analysis-wizard button[value="complete"]').click();expect((await conflict).status()).toBe(409);
    await expect(concurrent.locator('#analysis-wizard #analysis-error')).toContainText('Seus campos continuam nesta tela');
    await wizardStep(concurrent,'accounting','values');
    await expect(concurrent.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')).toHaveValue('222.00');
    expect((await get(page.request,`/api/v4/analyses/${id}`)).analysis.accounting.data.months[0].salariesCents).toBe(11100);
    concurrent.on('dialog',dialog=>dialog.accept());await concurrent.getByRole('button',{name:'Recarregar o trabalho salvo'}).click();
    await expect(concurrent.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')).toHaveValue('111.00');
    const saved=await generate(concurrent,id);expect(saved.result.regimes.map((row:any)=>row.id)).toEqual(['actual']);expect(saved.rbt12Source).toBe('NOT_REQUIRED');
  }finally{await context.close();}
});
