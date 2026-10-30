import {test as base,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Account={id:string;email:string;password:string};
type Workspace={db:Db;workspaceId:string;account:Account};
type Method='GET'|'POST'|'PATCH';
type WizardKind='new'|'fiscal'|'accounting';
const wizardSteps:Record<WizardKind,string[]>={
  new:['company','sector'],fiscal:['regimes','difal','rbt12','documents'],accounting:['values']
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
  await switchSector(page,sector,complete?(sector==='fiscal'?'documents':'values'):undefined);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id+'/'+sector&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="'+(complete?'complete':'save')+'"]').click();
  const response=await saving;expect(response.ok(),await response.text()).toBe(true);
  const saved=await response.json();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  if(complete)await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  else await expect(page.locator('#analysis-wizard')).toBeVisible();
  return saved.analysis;
}
function expense(page:Page,month:string,field:string){
  return page.locator('[data-accounting-average="'+field+'"]');
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
  await wizardStep(page,sector,step||(sector==='fiscal'?'documents':'values'));
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
async function prepareFiscalSource(request:APIRequestContext,baseURL:string,analysis:any,clientId:string,code:string,monthCount=9){
  const prepared=await api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/fiscal/import',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision
  });
  // Node derives and validates both monthly sources. CPF rows need no external CNPJ service.
  for(const kind of ['purchases','sales'] as const){
    const attached=await api(request,baseURL,'POST','/api/v4/generations/'+prepared.generationId+'/'+kind,{
      clientId,importId:randomUUID(),fileName:code+'-'+kind+'.csv',expectedRows:monthCount,issuerUf:'MG'
    });
    await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/rows',{offset:0,rows:Array.from({length:monthCount},(_,index)=>index+1).map(month=>{
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
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','sector');
  await expect(page.locator('#analysis-wizard-review')).toBeVisible();
  await expect(page.locator('#analysis-wizard-review')).toContainText('Lucro Real');
  await expect(page.locator('#analysis-wizard-review')).toContainText('2028');

  // Changing the search cannot leave an invisible, previously selected company active.
  await wizardStep(page,'new','company');
  await page.locator('#analysis-company-search').fill('empresa inexistente '+randomUUID());
  await expect(page.locator('#analysis-new-client')).toHaveValue('');
  await page.locator('#analysis-company-search').fill(created.code);
  await page.locator('[data-analysis-client="'+created.clientId+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','sector');
  await expect(page.locator('#analysis-wizard-review')).toContainText('Lucro Real');
  await page.locator('input[name="sector"][value="accounting"]').check();
  await expect(page.locator('#analysis-wizard-progress')).toBeVisible();
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

test('Contábil usa somente média mensal e exige confirmação ao preencher vazios com zero',async({page,baseURL,analysisWorkspace})=>{
  await signIn(page.request,baseURL!,analysisWorkspace.account);
  const created=await createAnalysis(page.request,baseURL!,2027);
  await page.goto('/analyses.html?id='+created.analysis.id+'&sector=accounting');
  await expect(page.locator('[data-accounting-average]')).toHaveCount(5);
  await expect(page.locator('[name="accounting-fill-mode"],#analysis-accounting-paste')).toHaveCount(0);
  await expense(page,'2025-01','salariesCents').fill('123.45');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#analysis-zero-empty').click();
  await expect(expense(page,'2025-01','rentCents')).toHaveValue('');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#analysis-zero-empty').click();
  for(const key of ['rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'])await expect(expense(page,'2025-01',key)).toHaveValue('0.00');
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('123.45');
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+created.analysis.id)).analysis.accounting.data.months).toEqual([]);
  const saved=await saveSector(page,created.analysis.id,'accounting',true);
  expect(saved.accounting.data.months.every((row:any)=>row.salariesCents===12345&&row.rentCents===0)).toBe(true);
  expect(saved.accounting.data.months).toHaveLength(9);
});

test('Contábil: acesso de consulta conserva valores e não oferece ações de escrita',async({page,baseURL,analysisWorkspace})=>{
  await signIn(page.request,baseURL!,analysisWorkspace.account);
  const created=await createAnalysis(page.request,baseURL!,2027),amounts=[12345,0,0,0,0];
  const analysis=await patchSector(page.request,baseURL!,created.analysis,'accounting',{months:[{sourceMonth:'2025-01',salariesCents:12345,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}]});
  await analysisWorkspace.db.collection<any>('users').updateOne({_id:analysisWorkspace.account.id,workspaceId:analysisWorkspace.workspaceId},{$set:{role:'viewer'}});
  const patches=observePatches(page);await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');
  await expect(page.locator('#analysis-accounting-form')).toBeVisible();
  await expect(expense(page,'2025-01','salariesCents')).toBeDisabled();
  await expect(page.locator('#analysis-accounting-copy-apply:not([disabled])')).toHaveCount(0);
  await expect(page.locator('#analysis-accounting-copy-undo:not([disabled])')).toHaveCount(0);
  await expect(expense(page,'2025-01','salariesCents')).toHaveValue('123.45');await expect(page.locator('#analysis-zero-empty')).toHaveCount(0);expect(patches).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis.accounting).toEqual(analysis.accounting);
});
