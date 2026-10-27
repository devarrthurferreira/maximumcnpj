import {test as base,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Account={id:string;email:string;password:string};
type Workspace={db:Db;workspaceId:string;account:Account};
type Method='GET'|'POST'|'PATCH';
type WizardKind='new'|'fiscal'|'accounting';
const wizardSteps:Record<WizardKind,string[]>={
  new:['company','setup'],fiscal:['documents','tax'],accounting:['values']
};
const test=base.extend<{analysisWorkspace:Workspace}>({
  analysisWorkspace:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account={id:randomUUID(),email:'analysis-usability-'+randomUUID()+'@example.test',password:'Synthetic-usability-'+randomUUID()};
    try{
      await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name:'Equipe sintética de usabilidade',
        role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      await use({db,workspaceId,account});
    }finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:account.id});
      await db.collection<any>('users').deleteOne({workspaceId,_id:account.id});
      await mongo.close();
    }
  }
});

async function api(request:APIRequestContext,baseURL:string,method:Method,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);
  return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,account:Account){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
  expect((await api(request,baseURL,'GET','/api/auth/session')).user.role).toBe('admin');
}
async function createAnalysis(request:APIRequestContext,baseURL:string,year:2027|2028){
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const imported=await api(request,baseURL,'POST','/api/v4/clients/import',{
    rows:[{code,name:'Empresa sintética usabilidade '+code,uf:'MG'}]
  });
  const clientId=imported.items[0].id;
  const opened=await api(request,baseURL,'POST','/api/v4/analyses',{
    clientId,year,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}
  });
  return {clientId,code,analysis:opened.analysis};
}
async function patchSector(request:APIRequestContext,baseURL:string,analysis:any,sector:'fiscal'|'accounting',data:unknown,complete=false){
  const response=await api(request,baseURL,'PATCH','/api/v4/analyses/'+analysis.id+'/'+sector,{
    expectedSectorRevision:analysis[sector].revision,expectedConfigRevision:analysis.config.revision,complete,data
  });
  return response.analysis;
}
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
async function saveSector(page:Page,id:string,sector:'fiscal'|'accounting',complete=false){
  await switchSector(page,sector,complete?(sector==='fiscal'?'tax':'values'):undefined);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id+'/'+sector&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="'+(complete?'complete':'save')+'"]').click();
  const response=await saving;expect(response.ok(),await response.text()).toBe(true);
  const saved=await response.json();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  if(complete)await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  else await expect(page.locator('#analysis-wizard')).toBeVisible();
  return saved.analysis;
}
function expense(page:Page,month:string,field:string){
  return page.locator('[data-accounting-month="'+month+'"] [data-accounting-field="'+field+'"]');
}
async function openDetails(page:Page,id:string){
  const detail=page.locator('#'+id);await expect(detail).toBeAttached();
  if(await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
  await expect(detail).toHaveJSProperty('open',true);
}
async function switchSector(page:Page,sector:'fiscal'|'accounting',step?:string){
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
  await wizardStep(page,sector,step||(sector==='fiscal'?'tax':'values'));
  await expect(page.locator('#analysis-'+sector+'-form')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('sector='+sector));
}
function observePatches(page:Page){
  const paths:string[]=[];
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(request.method()==='PATCH'&&path.startsWith('/api/v4/analyses/'))paths.push(path);
  });
  return paths;
}
async function prepareFiscalSource(request:APIRequestContext,baseURL:string,analysis:any,clientId:string,code:string){
  const prepared=await api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/fiscal/import',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision
  });
  // Node derives and validates both monthly sources. CPF rows need no external CNPJ service.
  for(const kind of ['purchases','sales'] as const){
    const attached=await api(request,baseURL,'POST','/api/v4/generations/'+prepared.generationId+'/'+kind,{
      clientId,importId:randomUUID(),fileName:code+'-'+kind+'.csv',expectedRows:9,issuerUf:'MG'
    });
    await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/rows',{offset:0,rows:Array.from({length:9},(_,index)=>index+1).map(month=>{
      const totalCents=month<=2?(kind==='sales'?1_000_000:100_000)*month:0;
      return {document:'12345678900',name:'Pessoa sintética',serviceDate:'2025-0'+month+'-15',quantity:'1',
        natureCode:kind==='sales'?'5102001':'1102001',description:'Competência sintética de usabilidade',recipientUf:'MG',
        grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents};
    })});
    const completed=await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/finalize',{});
    expect(completed.status).toBe('COMPLETED');expect(completed.summary.unique).toBe(0);
  }
  return patchSector(request,baseURL,prepared.analysis,'fiscal',prepared.analysis.fiscal.data,true);
}

test('Retomar uma empresa mostra as escolhas salvas e conserva regimes, valores e revisão',async({page,baseURL,analysisWorkspace})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.account);
  const created=await createAnalysis(page.request,baseURL!,2028);
  let analysis=await patchSector(page.request,baseURL!,created.analysis,'fiscal',{...created.analysis.fiscal.data,salesAnnex:2});
  analysis=await patchSector(page.request,baseURL!,analysis,'accounting',{months:[{
    sourceMonth:'2025-01',salariesCents:123456,rentCents:10000,cardExpensesCents:0,benefitsCents:null,adminExpensesCents:450
  }]});
  const before=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis;
  const patches=observePatches(page);
  await page.goto('/analyses.html?view=new');
  await page.locator('#analysis-company-search').fill(created.code);
  await page.locator('[data-analysis-client="'+created.clientId+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await expect(page.locator('#analysis-wizard-review')).toBeVisible();
  await expect(page.locator('#analysis-wizard-review')).toContainText('Lucro Real');
  await expect(page.locator('#analysis-wizard-review')).toContainText('2028');

  // Changing the search cannot leave an invisible, previously selected company active.
  await wizardStep(page,'new','company');
  await page.locator('#analysis-company-search').fill('empresa inexistente '+randomUUID());
  await expect(page.locator('#analysis-new-client')).toHaveValue('');
  await page.locator('#analysis-company-search').fill(created.code);
  await page.locator('[data-analysis-client="'+created.clientId+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await expect(page.locator('#analysis-wizard-review')).toContainText('Lucro Real');
  await page.locator('input[name="sector"][value="accounting"]').check();
  await page.locator('#analysis-wizard-back').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','company');
  await page.locator('#analysis-wizard-next').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await expect(page.locator('input[name="sector"][value="accounting"]')).toBeChecked();
  await expect(page.locator('#analysis-open-company')).toContainText('Continuar');
  expect(patches).toEqual([]);
  await page.locator('#analysis-open-company').click();
  await switchSector(page,'accounting','values');
  expect(new URL(page.url()).searchParams.get('id')).toBe(analysis.id);
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('1234.56');
  await expect(expense(page,'2025-01','cardExpensesCents')).toHaveValue('0.00');
  await expect(expense(page,'2025-01','benefitsCents')).toHaveValue('');
  const wizard=page.locator('#analysis-wizard');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.locator('#analysis-wizard-progress')).toBeHidden();
  await expect(wizard).toHaveAttribute('aria-labelledby','analysis-wizard-title');
  await expect(wizard).toHaveAccessibleName(/\S/);
  expect(await wizard.evaluate(element=>element.matches(':modal'))).toBe(true);
  expect(await wizard.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.locator('#analysis-wizard-close').focus();await page.keyboard.press('Shift+Tab');
  expect(await wizard.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await wizard.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await closeWizard(page);
  const opener=page.locator('[data-analysis-sector="accounting"]').first();await opener.click();
  // A queued native close event must not close the same dialog after a fast reopen.
  await wizard.evaluate(async element=>{
    const closed=new Promise(resolve=>element.addEventListener('close',resolve,{once:true}));
    (document.getElementById('analysis-wizard-close') as HTMLButtonElement).click();
    (Array.from(document.querySelectorAll('[data-analysis-sector="accounting"]')).find(node=>!node.closest('dialog')) as HTMLElement).click();
    await closed;
  });
  await expect(wizard).toBeVisible();await page.keyboard.press('Escape');
  await expect(wizard).not.toBeVisible();await expect(opener).toBeFocused();
  expect(patches).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis).toEqual(before);
  expect(await analysisWorkspace.db.collection('analyses').countDocuments({
    workspaceId:analysisWorkspace.workspaceId,clientId:created.clientId
  })).toBe(1);
  expect(errors).toEqual([]);
});

test('Colagem tem prévia e substituição explícita; trocar setores preserva rascunhos até salvar e concluir',async({page,baseURL,analysisWorkspace},info)=>{
  test.setTimeout(120_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.account);
  const created=await createAnalysis(page.request,baseURL!,2027);
  let analysis=await prepareFiscalSource(page.request,baseURL!,created.analysis,created.clientId,created.code);
  const originalMonths=[{sourceMonth:'2025-01',salariesCents:11100,rentCents:22200,cardExpensesCents:33300,benefitsCents:44400,adminExpensesCents:55500}];
  analysis=await patchSector(page.request,baseURL!,analysis,'accounting',{months:originalMonths});
  const id=analysis.id,patches=observePatches(page);
  const importRequests:string[]=[];
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(request.method()==='POST'&&path==='/api/v4/analyses/'+id+'/fiscal/import')importRequests.push(path);
  });
  await page.goto('/analyses.html?id='+id+'&sector=accounting');
  await switchSector(page,'accounting','values');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('111.00');
  await expect(page.locator('#analysis-generate')).toBeDisabled();
  await openDetails(page,'analysis-accounting-tools');
  const pasted=[
    '01/2025\tR$ 1.234,56\t250,00\t\t0\t10,50',
    '02/2025\t2.000,00\t300,00\t12,34\t5,00\t0,00'
  ].join('\n');
  const pastePanel=page.locator('#analysis-accounting-paste-panel');
  await expect(pastePanel).toBeVisible();
  if(await pastePanel.getAttribute('open')===null)await page.locator('#analysis-accounting-paste-panel > summary').click();
  await page.locator('#analysis-accounting-paste').fill(pasted);
  await page.locator('#analysis-preview-accounting-paste').click();
  await expect(page.locator('#analysis-accounting-paste-preview')).toContainText('1.234,56');
  await expect(page.locator('#analysis-accounting-paste-preview')).toContainText('2.000,00');
  await expect(page.locator('#analysis-paste-replace-confirm')).not.toBeChecked();
  await expect(page.locator('#analysis-apply-accounting-paste')).toBeDisabled();
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('111.00');
  await expect(page.locator('[data-accounting-month="2025-02"]')).toHaveCount(0);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis.accounting.data.months).toEqual(originalMonths);
  expect(patches).toEqual([]);
  await page.locator('#analysis-wizard button[value="complete"]').click();
  await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('Confira e aplique a colagem');
  await expect(page.locator('#analysis-wizard')).toBeVisible();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','values');
  await expect(page.locator('#analysis-accounting-paste')).toHaveValue(pasted);
  await expect(page.locator('#analysis-accounting-paste-preview')).toBeVisible();
  expect(patches).toEqual([]);
  const stillDraft=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis;
  expect(stillDraft.accounting.status).toBe('DRAFT');expect(stillDraft.accounting.data.months).toEqual(originalMonths);

  const initialViewport=page.viewportSize()||await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  for(const width of [390,320]){
    await page.setViewportSize({width,height:960});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('analysis-paste-'+width+'.png'),fullPage:true});
    await page.locator('#analysis-accounting-import').screenshot({path:info.outputPath('analysis-paste-preview-'+width+'.png')});
  }
  await page.setViewportSize(initialViewport);

  // An unapplied paste is still pending work, even before an expense field becomes dirty.
  await switchSector(page,'fiscal','documents');
  await page.locator('#analysis-start-import').click();
  await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('Contábil');
  expect(importRequests).toEqual([]);
  expect(patches).toEqual([]);
  await switchSector(page,'accounting','values');
  await expect(page.locator('#analysis-accounting-paste')).toHaveValue(pasted);
  await expect(page.locator('#analysis-accounting-paste-preview')).toBeVisible();
  await expect(page.locator('#analysis-accounting-paste-preview')).toContainText('1.234,56');
  await expect(page.locator('#analysis-accounting-paste-preview')).toContainText('2.000,00');
  await expect(page.locator('#analysis-paste-replace-confirm')).not.toBeChecked();
  await expect(page.locator('#analysis-apply-accounting-paste')).toBeDisabled();
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('111.00');
  expect(patches).toEqual([]);

  await page.locator('#analysis-paste-replace-confirm').check();
  await page.locator('#analysis-apply-accounting-paste').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','values');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('1234.56');
  await expect(expense(page,'2025-01','cardExpensesCents')).toHaveValue('');
  await expect(expense(page,'2025-01','benefitsCents')).toHaveValue('0.00');
  await expect(expense(page,'2025-02','adminExpensesCents')).toHaveValue('0.00');
  await expect(page.locator('#analysis-month-2025-01')).toHaveJSProperty('open',true);
  await expect(page.locator('#analysis-month-2025-02')).toHaveJSProperty('open',false);
  await openDetails(page,'analysis-month-2025-02');
  await expect(page.locator('#analysis-month-2025-01')).toHaveJSProperty('open',false);
  await openDetails(page,'analysis-month-2025-01');
  await expect(page.locator('#analysis-month-2025-02')).toHaveJSProperty('open',false);
  // Closing a step does not validate, coerce or discard an unfinished numeric edit.
  await expense(page,'2025-01','salariesCents').fill('1234.567');
  expect(await expense(page,'2025-01','salariesCents').evaluate(element=>(element as HTMLInputElement).validity.valid)).toBe(false);
  await page.keyboard.press('Escape');await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  await switchSector(page,'accounting','values');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('1234.567');
  expect(patches).toEqual([]);
  await expense(page,'2025-01','salariesCents').fill('1234.56');
  await switchSector(page,'fiscal','documents');
  await page.locator('#analysis-start-import').click();
  await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('Contábil');
  expect(importRequests).toEqual([]);
  await wizardStep(page,'fiscal','tax');
  await openDetails(page,'analysis-fiscal-options');
  await page.locator('#analysis-sales-annex').selectOption('2');
  await switchSector(page,'accounting');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('1234.56');
  await expect(expense(page,'2025-01','cardExpensesCents')).toHaveValue('');
  await expect(expense(page,'2025-02','cardExpensesCents')).toHaveValue('12.34');
  await switchSector(page,'fiscal');
  await expect(page.locator('#analysis-sales-annex')).toHaveValue('2');
  expect(patches).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis.accounting.data.months).toEqual(originalMonths);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis.fiscal.data.salesAnnex).toBe(1);

  // Saving one sector must not discard or silently submit the other sector's draft.
  analysis=await saveSector(page,id,'fiscal',true);
  expect(analysis.fiscal.data.salesAnnex).toBe(2);
  expect(analysis.accounting.data.months).toEqual(originalMonths);
  expect(patches).toEqual(['/api/v4/analyses/'+id+'/fiscal']);
  await switchSector(page,'accounting');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('1234.56');
  await expect(expense(page,'2025-01','cardExpensesCents')).toHaveValue('');
  analysis=await saveSector(page,id,'accounting');
  const expectedMonths=[
    {sourceMonth:'2025-01',salariesCents:123456,rentCents:25000,cardExpensesCents:null,benefitsCents:0,adminExpensesCents:1050},
    {sourceMonth:'2025-02',salariesCents:200000,rentCents:30000,cardExpensesCents:1234,benefitsCents:500,adminExpensesCents:0}
  ];
  expect(analysis.accounting.data.months).toEqual(expectedMonths);
  expect(analysis.accounting.status).toBe('DRAFT');expect(analysis.readiness.ready).toBe(false);
  await expect(page.locator('#analysis-generate')).toBeDisabled();
  await page.locator('#analysis-wizard button[value="complete"]').click();
  await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('Adicione as competências que faltam');
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','values');
  expect(patches).toEqual(['/api/v4/analyses/'+id+'/fiscal','/api/v4/analyses/'+id+'/accounting']);
  await expect(expense(page,'2025-01','cardExpensesCents')).toHaveValue('');
  await expense(page,'2025-01','cardExpensesCents').fill('0');
  // Enter in a fully filled expense form must not implicitly save or conclude it.
  await expense(page,'2025-01','cardExpensesCents').press('Enter');
  await expect(page.locator('#analysis-wizard')).toBeVisible();
  expect(patches).toEqual(['/api/v4/analyses/'+id+'/fiscal','/api/v4/analyses/'+id+'/accounting']);
  const beforeExplicitCompletion=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis;
  expect(beforeExplicitCompletion.accounting.status).toBe('DRAFT');
  expect(beforeExplicitCompletion.accounting.data.months).toEqual(expectedMonths);
  // Preparing the fixed period adds seven empty months and preserves the two edited ones.
  await openDetails(page,'analysis-accounting-tools');await expect(page.locator('#analysis-new-source-year')).toHaveValue('2025');
  await page.locator('#analysis-add-month').click();await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
  await page.locator('#analysis-wizard button[value="complete"]').click();
  await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('Use zero somente');
  expect(patches).toEqual(['/api/v4/analyses/'+id+'/fiscal','/api/v4/analyses/'+id+'/accounting']);
  const remainingMonths=Array.from({length:7},(_,index)=>({sourceMonth:'2025-0'+(index+3),salariesCents:0,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}));
  for(const month of remainingMonths){
    await openDetails(page,'analysis-month-'+month.sourceMonth);
    for(const field of ['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents']){
      await expect(expense(page,month.sourceMonth,field)).toHaveValue('');await expense(page,month.sourceMonth,field).fill('0');
    }
  }
  analysis=await saveSector(page,id,'accounting',true);
  expect(analysis.accounting.data.months).toEqual([{...expectedMonths[0],cardExpensesCents:0},expectedMonths[1],...remainingMonths]);
  expect(analysis.readiness.ready).toBe(true);
  await expect(page.locator('#analysis-generate')).toBeEnabled();
  await switchSector(page,'accounting','values');await openDetails(page,'analysis-accounting-summary-panel');
  await page.screenshot({path:info.outputPath('analysis-pasted-months-complete.png'),fullPage:true});
  await closeWizard(page);
  const generating=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id+'/generate'&&response.request().method()==='POST');
  await page.locator('#analysis-generate').click();expect((await generating).status()).toBe(200);
  await expect(page.locator('#simulation-snapshot')).toBeVisible();
  const simulationId=new URL(page.url()).searchParams.get('simulation');expect(simulationId).toBeTruthy();
  const snapshot=await api(page.request,baseURL!,'GET','/api/v4/simulations/'+simulationId);
  expect(snapshot.analysisId).toBe(id);expect(snapshot.draft.salesAnnex).toBe(2);
  expect(snapshot.rbt12Source).toBe('NOT_REQUIRED');expect(snapshot.result.regimes.map((row:any)=>row.id)).toEqual(['actual']);
  expect(snapshot.monthlyInputs.map((row:any)=>({sourceMonth:row.sourceMonth,values:row.values}))).toEqual([
    {sourceMonth:'2025-01',values:{serviceRevenue:0,salaries:1234.56,rent:250,cardExpenses:0,benefits:0,adminExpenses:10.5}},
    {sourceMonth:'2025-02',values:{serviceRevenue:0,salaries:2000,rent:300,cardExpenses:12.34,benefits:5,adminExpenses:0}},
    ...remainingMonths.map(({sourceMonth})=>({sourceMonth,values:{serviceRevenue:0,salaries:0,rent:0,cardExpenses:0,benefits:0,adminExpenses:0}}))
  ]);
  expect((await analysisWorkspace.db.collection<any>('analyses').findOne({_id:id,workspaceId:analysisWorkspace.workspaceId}))?.currentSimulation.id).toBe(simulationId);
  await page.goto('/analyses.html?search='+created.code);
  await expect(page.locator('[data-analysis-id="'+id+'"]')).toHaveAttribute('data-analysis-state','current');
  await expect(page.locator('[data-analysis-count="current"] strong')).toHaveText('1');
  await expect(page.locator('[data-analysis-count="ready"] strong')).toHaveText('0');
  await expect(page.locator('[data-analysis-count="working"] strong')).toHaveText('0');
  expect(errors).toEqual([]);
});
