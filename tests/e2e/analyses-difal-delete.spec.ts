import {test as base,expect,type Page,type APIRequestContext,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {csvParse} from '../../src/domain.ts';

type Account={id:string;email:string;password:string;role:'admin'|'operator'|'viewer'};
type Workspace={db:Db;workspaceId:string;admin:Account;operator:Account;viewer:Account};
type Company={id:string;code:string;name:string};
type Method='GET'|'POST'|'PATCH';
const selection={version:'REGIME_SELECTION_V1',selected:['pure','hybrid']};
const test=base.extend<{analysisWorkspace:Workspace}>({
  analysisWorkspace:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account=(role:Account['role']):Account=>({id:randomUUID(),email:'analysis-difal-'+role+'-'+randomUUID()+'@example.test',
      password:'Synthetic-analysis-'+randomUUID(),role});
    const admin=account('admin'),operator=account('operator'),viewer=account('viewer'),accounts=[admin,operator,viewer];
    try{
      for(const user of accounts)await db.collection<any>('users').insertOne({_id:user.id,workspaceId,email:user.email,
        name:'Equipe sintética '+user.role,role:user.role,active:true,mustChangePassword:false,
        passwordHash:await hashPassword(user.password),createdAt:new Date()});
      await use({db,workspaceId,admin,operator,viewer});
    }finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:{$in:accounts.map(user=>user.id)}});
      await db.collection<any>('users').deleteMany({workspaceId,_id:{$in:accounts.map(user=>user.id)}});
      await mongo.close();
    }
  }
});

async function api(request:APIRequestContext,baseURL:string,method:Method,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function signIn(request:APIRequestContext,baseURL:string,account:Account){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
  expect((await api(request,baseURL,'GET','/api/auth/session')).user.role).toBe(account.role);
}
async function createCompany(request:APIRequestContext,baseURL:string,prefix='Empresa sintética DIFAL'):Promise<Company>{
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16)),name=prefix+' '+code;
  const imported=await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name,uf:'MG'}]});
  expect(imported.success).toBe(1);return {id:imported.items[0].id,code,name};
}
async function fiscalStep(page:Page,step:'documents'|'tax'){
  const wizard=page.locator('#analysis-wizard');
  await expect(page.locator('[data-analysis-sector="fiscal"]').first()).toBeAttached();
  if(!await wizard.isVisible())await page.locator('[data-analysis-sector="fiscal"]').first().click();
  else if(await wizard.getAttribute('data-wizard-kind')!=='fiscal')await wizard.locator('[data-analysis-sector="fiscal"]').click();
  await expect(wizard).toHaveAttribute('data-wizard-kind','fiscal');
  if(await wizard.getAttribute('data-wizard-step')!==step){
    await page.locator(step==='documents'?'#analysis-wizard-back':'#analysis-wizard-next').click();
  }
  await expect(wizard).toHaveAttribute('data-wizard-step',step);
}
async function openNew(page:Page,baseURL:string,company:Company,choice:'yes'|'no',checkRequired=false){
  await page.goto('/analyses.html?view=new');await page.locator('#analysis-company-search').fill(company.code);
  await page.locator('[data-analysis-client="'+company.id+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await page.locator('input[name="sector"][value="fiscal"]').check();
  await page.locator('#analysis-new-regime-presumed').uncheck();await page.locator('#analysis-new-regime-actual').uncheck();
  await expect(page.locator('#new-difal-yes')).not.toBeChecked();await expect(page.locator('#new-difal-no')).not.toBeChecked();
  if(checkRequired){
    await page.screenshot({path:test.info().outputPath('analysis-new-difal-choice.png'),fullPage:true});
    const posts:string[]=[];
    const observe=(request:any)=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v4/analyses')posts.push(request.url());};
    page.on('request',observe);
    try{
      await expect(page.locator('#analysis-open-company')).toBeEnabled();await page.locator('#analysis-open-company').click();
      await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('escolha Sim ou Não');
      await expect(page.locator('#new-difal-yes')).toBeFocused();expect(posts).toEqual([]);
      expect((await api(page.request,baseURL,'GET','/api/v4/analyses?clientId='+company.id)).items).toEqual([]);
    }finally{page.off('request',observe);}
  }
  await page.locator('#new-difal-'+choice).check();
  if(choice==='yes')await expect(page.locator('#new-difal-details')).toHaveJSProperty('open',true);
  else await expect(page.locator('#new-difal-details')).toBeHidden();
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses'&&response.request().method()==='POST');
  await page.locator('#analysis-open-company').click();expect((await saving).ok()).toBe(true);
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind','fiscal');
  const id=new URL(page.url()).searchParams.get('id');expect(id).toBeTruthy();
  const analysis=(await api(page.request,baseURL,'GET','/api/v4/analyses/'+id)).analysis;
  expect(analysis.clientId).toBe(company.id);expect(analysis.config.regimeSelection).toEqual(selection);
  expect(analysis.fiscal.data.difalPolicy.enabled).toEqual({pure:choice==='yes',hybrid:choice==='yes',presumed:false,actual:false});
  return analysis;
}
async function patchSector(request:APIRequestContext,baseURL:string,analysis:any,sector:'fiscal'|'accounting',data:unknown){
  return (await api(request,baseURL,'PATCH','/api/v4/analyses/'+analysis.id+'/'+sector,{
    expectedSectorRevision:analysis[sector].revision,expectedConfigRevision:analysis.config.revision,complete:true,data
  })).analysis;
}
async function prepareSources(request:APIRequestContext,baseURL:string,analysis:any,company:Company){
  const prepared=await api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/fiscal/import',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision
  });
  // Real authenticated Node ingestion derives both estimates; CPF rows never call a CNPJ provider.
  for(const kind of ['purchases','sales'] as const){
    const attached=await api(request,baseURL,'POST','/api/v4/generations/'+prepared.generationId+'/'+kind,{
      clientId:company.id,importId:randomUUID(),fileName:company.code+'-'+kind+'.csv',expectedRows:9,issuerUf:'MG'
    });
    const totals=[...(kind==='sales'?[100_000,200_000]:[50_000,70_000]),...Array(7).fill(0)];
    await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/rows',{offset:0,rows:totals.map((totalCents,index)=>({
      document:'12345678900',name:'Pessoa sintética',recipientUf:'SP',serviceDate:'2025-0'+(index+1)+'-15',
      natureCode:kind==='sales'?'5102001':'1102001',description:'Operação sintética interestadual',quantity:'1',
      grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents
    }))});
    const completed=await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/finalize',{});
    expect(completed.status).toBe('COMPLETED');expect(completed.summary.unique).toBe(0);
  }
  analysis=await patchSector(request,baseURL,prepared.analysis,'fiscal',{...prepared.analysis.fiscal.data,
    rbt12Source:'MANUAL',rbt12:100_000,rbt12ManualConfirmed:true,rbt12ExtractionId:null,rbt12DocumentId:null});
  analysis=await patchSector(request,baseURL,analysis,'accounting',{months:Array.from({length:9},(_,index)=>'2025-0'+(index+1)).map(sourceMonth=>({
    sourceMonth,salariesCents:0,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0
  }))});
  expect(analysis.readiness.ready).toBe(true);return analysis;
}
async function freezeSources(workspace:Workspace,analysis:any,snapshot:any){
  const {db,workspaceId}=workspace,jobIds=[snapshot.source.purchases.jobId,snapshot.source.sales.jobId];
  return {
    company:await db.collection<any>('clients').findOne({_id:analysis.clientId,workspaceId}),
    generation:await db.collection<any>('generations').findOne({_id:analysis.fiscal.data.generationId,workspaceId}),
    jobs:await db.collection<any>('lookupJobs').find({_id:{$in:jobIds},workspaceId}).sort({_id:1}).toArray(),
    lines:await db.collection<any>('purchaseLines').find({jobId:{$in:jobIds},workspaceId}).sort({jobId:1,index:1}).toArray()
  };
}
async function generateInBrowser(page:Page,baseURL:string,id:string){
  if(await page.locator('#analysis-wizard').isVisible())await page.locator('#analysis-wizard-close').click();
  await expect(page.locator('#analysis-generate')).toBeEnabled();
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id+'/generate'&&response.request().method()==='POST');
  await page.locator('#analysis-generate').click();expect((await saving).status()).toBe(200);
  // Read the persisted result after navigation instead of racing the discarded POST response body.
  await expect(page.locator('#simulation-snapshot')).toBeVisible();
  const simulationId=new URL(page.url()).searchParams.get('simulation');expect(simulationId).toBeTruthy();
  return api(page.request,baseURL,'GET','/api/v4/simulations/'+simulationId);
}
async function generateByApi(request:APIRequestContext,baseURL:string,analysis:any){
  return api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/generate',{requestId:randomUUID(),expectedRevision:analysis.revision});
}
function expectDifal(snapshot:any,enabled:boolean){
  expect(snapshot.result.regimes.map((row:any)=>row.id)).toEqual(['pure','hybrid']);
  expect(snapshot.result.annualRevenue).toBe(3000);
  for(const regime of snapshot.result.regimes){
    expect(regime.available).toBe(true);
    expect(Math.round(regime.dre.difal*100)).toBe(enabled?-30_000:0);
    expect(Math.round(regime.dre.icmsAnticipation*100)).toBe(enabled?-8_784:0);
  }
  expect(snapshot.result.monthlyResults.map((month:any)=>month.result.regimes.map((row:any)=>[
    Math.round(row.dre.difal*100),Math.round(row.dre.icmsAnticipation*100)
  ]))).toEqual([
    ...(enabled?[[[-10_000,-3_660],[-10_000,-3_660]],[[-20_000,-5_124],[-20_000,-5_124]]]:[[[0,0],[0,0]],[[0,0],[0,0]]]),
    ...Array.from({length:7},()=>[[0,0],[0,0]])
  ]);
}
async function fullDre(page:Page){
  const details=page.locator('#dre-demonstrativo [data-simulation-detail="dre"]');
  if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  const host=details.locator('[data-simulation-lazy="dre"]');await expect(host).toHaveAttribute('data-loaded','true');return host;
}
async function expectZeroDre(page:Page){
  await expect(page.locator('#dre-demonstrativo [data-period="annual"]')).toHaveAttribute('aria-pressed','true');
  let complete=await fullDre(page);
  for(const key of ['difal','icmsAnticipation']){
    const cells=complete.locator('[data-dre-row="'+key+'"] td');
    await expect(cells).toHaveCount(2);for(const cell of await cells.all())await expect(cell).toHaveText('R$ 0,00');
  }
  await page.locator('#dre-demonstrativo [data-period="monthly"]').click();
  for(const regime of ['pure','hybrid']){
    complete=await fullDre(page);
    await page.locator('#dre-regime').selectOption(regime);
    complete=await fullDre(page);
    await complete.locator('[data-dre-month-view="all"]').click();
    complete=await fullDre(page);
    for(const key of ['difal','icmsAnticipation']){
      const cells=complete.locator('[data-dre-row="'+key+'"] td');
      await expect(cells).toHaveCount(10);for(const cell of await cells.all())await expect(cell).toHaveText('R$ 0,00');
    }
  }
}

test('DIFAL exige Sim ou Não e a escolha persiste na DRE, CSV e nova sessão sem modificar a origem',async({page,browser,baseURL,analysisWorkspace},info)=>{
  test.setTimeout(180_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.admin);
  const company=await createCompany(page.request,baseURL!);
  let analysis=await openNew(page,baseURL!,company,'yes',true);
  const id=analysis.id;
  await fiscalStep(page,'documents');await expect(page.locator('#analysis-difal-yes')).toBeVisible();
  await expect(page.locator('#analysis-difal-yes')).toBeChecked();
  await page.screenshot({path:info.outputPath('analysis-difal-fiscal-desktop.png'),fullPage:true});
  await fiscalStep(page,'tax');await expect(page.locator('#analysis-difal-yes')).toBeVisible();
  analysis=await prepareSources(page.request,baseURL!,analysis,company);
  await page.goto('/analyses.html?id='+id);
  const included=await generateInBrowser(page,baseURL!,id);expectDifal(included,true);
  const sources=await freezeSources(analysisWorkspace,analysis,included);expect(sources.lines).toHaveLength(18);
  expect(included.source.monthlyReports.map((row:any)=>row.difal.amountCents)).toEqual([10_000,20_000,...Array(7).fill(0)]);
  expect(included.source.monthlyReports.map((row:any)=>row.anticipation.amountCents)).toEqual([3_660,5_124,...Array(7).fill(0)]);

  await page.goto('/analyses.html?id='+id+'&sector=fiscal');await fiscalStep(page,'documents');
  const savedFiscal=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis.fiscal;
  const policyWrites:string[]=[];page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(request.method()==='PATCH'&&path.startsWith('/api/v4/analyses/'))policyWrites.push(path);
  });
  const details=page.locator('#analysis-difal-details');
  if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  const enabled=(regime:string)=>details.locator('[data-analysis-difal-enabled="'+regime+'"]');
  const direction=(regime:string,operation:string)=>details.locator('[data-analysis-difal-regime="'+regime+'"][data-analysis-difal-operation="'+operation+'"]');
  await direction('pure','exit').uncheck();await direction('hybrid','entry').uncheck();await enabled('hybrid').uncheck();
  await page.locator('#analysis-difal-no').check();await expect(details).toBeHidden();
  await page.locator('#analysis-difal-yes').check();await expect(details).toHaveJSProperty('open',true);
  await expect(enabled('pure')).toBeChecked();await expect(enabled('hybrid')).not.toBeChecked();
  await expect(direction('pure','entry')).toBeChecked();await expect(direction('pure','exit')).not.toBeChecked();
  await expect(direction('hybrid','entry')).not.toBeChecked();await expect(direction('hybrid','exit')).toBeChecked();
  await expect(direction('hybrid','entry')).toBeDisabled();await expect(direction('hybrid','exit')).toBeDisabled();
  expect(policyWrites).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis.fiscal).toEqual(savedFiscal);
  await page.locator('#analysis-difal-no').check();await expect(page.locator('#analysis-difal-details')).toBeHidden();
  await fiscalStep(page,'tax');await expect(page.locator('#analysis-difal-no')).toBeVisible();
  await expect(page.locator('#analysis-difal-no')).toBeChecked();
  await page.setViewportSize({width:390,height:844});await page.locator('#analysis-difal-no').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('analysis-difal-no-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:720});
  expect(policyWrites).toEqual([]);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id+'/fiscal'&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="complete"]').click();
  const response=await saving;expect(response.ok(),await response.text()).toBe(true);analysis=(await response.json()).analysis;
  await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  expect(policyWrites).toEqual(['/api/v4/analyses/'+id+'/fiscal']);
  expect(analysis.currentSimulation.stale).toBe(true);
  expect(analysis.fiscal.data.difalPolicy.enabled).toEqual({pure:false,hybrid:false,presumed:false,actual:false});
  expect(analysis.fiscal.data.difalPolicy.operations).toEqual({pure:{entry:true,exit:false},hybrid:{entry:false,exit:true}});
  const excluded=await generateInBrowser(page,baseURL!,id);expectDifal(excluded,false);
  expect(excluded._id).not.toBe(included._id);expect(excluded.parentSimulationId).toBe(included._id);
  for(const regime of excluded.result.regimes){
    const previous=included.result.regimes.find((row:any)=>row.id===regime.id);
    expect(Math.round((regime.dre.netProfit-previous.dre.netProfit)*100)).toBe(38_784);
  }
  await expectZeroDre(page);
  await page.locator('#dre-report-period').selectOption('complete');
  const downloading=page.waitForEvent('download');await page.locator('#export-dre-csv').click();
  const download=await downloading;await download.saveAs(info.outputPath('analysis-difal-excluded-dre.csv'));
  const stream=await download.createReadStream();let csv='';for await(const chunk of stream!)csv+=chunk;
  const rows=csvParse(csv,';');
  for(const label of ['− DIFAL sobre vendas (10%)','− Antecipação de ICMS']){
    // The exported text keeps its Excel formula guard; numeric cells remain real numbers.
    const escapedLabel="'"+label;
    const annual=rows.filter(row=>row[2]===escapedLabel);expect(annual).toHaveLength(1);expect(annual[0].slice(5,7)).toEqual(['0,00','0,00']);
    const monthly=rows.filter(row=>row[3]===escapedLabel);expect(monthly).toHaveLength(2);
    for(const row of monthly){expect(row.slice(6,15)).toEqual(Array(9).fill('0,00'));expect(row[15]).toBe('0,00');}
  }
  expect(await api(page.request,baseURL!,'GET','/api/v4/simulations/'+included._id)).toEqual(included);
  expect(await freezeSources(analysisWorkspace,analysis,included)).toEqual(sources);
  expect(excluded.source).toEqual(included.source);
  await page.screenshot({path:info.outputPath('analysis-difal-excluded-dre.png'),fullPage:true});

  const fresh=await browser.newContext({baseURL});
  try{
    await signIn(fresh.request,baseURL!,analysisWorkspace.operator);const reopened=await fresh.newPage();
    reopened.on('pageerror',error=>errors.push(error.message));
    await reopened.goto('/analyses.html?id='+id+'&sector=fiscal');await fiscalStep(reopened,'documents');
    await expect(reopened.locator('#analysis-difal-no')).toBeChecked();
    await expect(reopened.locator('#analysis-difal-details')).toBeHidden();
    await fiscalStep(reopened,'tax');await expect(reopened.locator('#analysis-difal-no')).toBeChecked();
    await reopened.goto('/simulator.html?simulation='+excluded._id);await expect(reopened.locator('#simulation-snapshot')).toBeVisible();
    await expectZeroDre(reopened);
    expect(await api(fresh.request,baseURL!,'GET','/api/v4/simulations/'+excluded._id)).toEqual(excluded);
  }finally{await fresh.close();}
  expect(errors).toEqual([]);
});

test('Excluir análise exige confirmação e permissão, preserva documentos e permite novo trabalho vazio',async({page,browser,baseURL,analysisWorkspace},info)=>{
  test.setTimeout(180_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.admin);
  const company=await createCompany(page.request,baseURL!),other=await createCompany(page.request,baseURL!);
  const preserved=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:other.id,year:2028,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
  let analysis=await openNew(page,baseURL!,company,'no');
  analysis=await prepareSources(page.request,baseURL!,analysis,company);
  const first=await generateByApi(page.request,baseURL!,analysis);expectDifal(first.simulation,false);analysis=first.analysis;
  const changed=structuredClone(analysis.accounting.data);changed.months[0].salariesCents=12_500;
  analysis=await patchSector(page.request,baseURL!,analysis,'accounting',changed);
  const second=await generateByApi(page.request,baseURL!,analysis);analysis=second.analysis;
  const id=analysis.id,simulationIds=[first.simulation._id,second.simulation._id];
  expect(simulationIds[0]).not.toBe(simulationIds[1]);expect(second.simulation.parentSimulationId).toBe(simulationIds[0]);
  const sources=await freezeSources(analysisWorkspace,analysis,second.simulation);
  expect(sources.jobs).toHaveLength(2);expect(sources.lines).toHaveLength(18);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id+'/versions')).items.map((row:any)=>row._id).sort()).toEqual([...simulationIds].sort());

  const readOnly=await browser.newContext({baseURL});
  try{
    await signIn(readOnly.request,baseURL!,analysisWorkspace.viewer);const viewer=await readOnly.newPage();
    await viewer.goto('/analyses.html?id='+id);
    await expect(viewer.locator('h1')).toHaveText(company.name);await expect(viewer.locator('#analysis-delete')).toHaveCount(0);
    const denied=await readOnly.request.delete('/api/v4/analyses/'+id,{data:{expectedRevision:analysis.revision,confirmed:true},headers:{Origin:new URL(baseURL!).origin}});
    expect(denied.status()).toBe(403);
    expect((await api(readOnly.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis).toEqual(analysis);
  }finally{await readOnly.close();}

  await signIn(page.request,baseURL!,analysisWorkspace.operator);await page.goto('/analyses.html?id='+id);
  const removals:any[]=[];page.on('request',request=>{
    if(request.method()==='DELETE')removals.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
  });
  const opener=page.locator('#analysis-delete'),dialog=page.locator('#analysis-delete-dialog');
  for(const cancel of ['button','escape']){
    await opener.click();await expect(dialog).toBeVisible();await expect(dialog).toHaveAccessibleName('Excluir análise?');
    await expect(page.locator('#analysis-delete-cancel')).toBeFocused();await expect(dialog).toContainText(company.name);
    await expect(dialog).toContainText('documentos fiscais serão preservados');
    if(cancel==='button')await page.locator('#analysis-delete-cancel').click();else await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
  }
  expect(removals).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis).toEqual(analysis);
  expect(await api(page.request,baseURL!,'GET','/api/v4/simulations/'+simulationIds[0])).toEqual(first.simulation);
  await opener.click();
  const staleRevision=analysis.revision,concurrent=await browser.newContext({baseURL});
  try{
    await signIn(concurrent.request,baseURL!,analysisWorkspace.admin);
    const concurrentExpenses=structuredClone(analysis.accounting.data);concurrentExpenses.months[0].salariesCents=17_500;
    analysis=await patchSector(concurrent.request,baseURL!,analysis,'accounting',concurrentExpenses);
    expect(analysis.revision).toBe(staleRevision+1);expect(analysis.accounting.data.months[0].salariesCents).toBe(17_500);
  }finally{await concurrent.close();}
  const conflicting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await conflicting).status()).toBe(409);
  await expect(dialog).toBeVisible();await expect(page.locator('#analysis-delete-error')).toContainText('atualizada por outra pessoa ou aba');
  await expect(page.locator('#analysis-delete-cancel')).toBeFocused();
  expect(removals).toEqual([{path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}}]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis).toEqual(analysis);
  expect(await api(page.request,baseURL!,'GET','/api/v4/simulations/'+simulationIds[0])).toEqual(first.simulation);
  expect(await api(page.request,baseURL!,'GET','/api/v4/simulations/'+simulationIds[1])).toEqual(second.simulation);
  expect(await freezeSources(analysisWorkspace,analysis,second.simulation)).toEqual(sources);
  // A conflict cannot silently adopt the new revision or retry deletion.
  const refreshing=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='GET');
  await page.locator('#analysis-delete-reload').click();
  const refreshed=await refreshing;expect(refreshed.ok()).toBe(true);
  expect((await refreshed.json()).analysis.revision).toBe(analysis.revision);
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await expect(dialog).not.toBeVisible();await expect(opener).toBeEnabled();
  expect(removals).toEqual([{path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}}]);
  await opener.click();await expect(dialog).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('analysis-delete-confirmation-mobile.png'),fullPage:true});
  const deleting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await deleting).status()).toBe(200);
  await expect(page).toHaveURL(/\/analyses\.html\?deleted=1$/);
  await expect(page.locator('#analysis-search')).toBeVisible();
  expect(removals).toEqual([
    {path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}},
    {path:'/api/v4/analyses/'+id,body:{expectedRevision:analysis.revision,confirmed:true}}
  ]);
  await expect(page.locator('[data-analysis-id="'+id+'"]')).toHaveCount(0);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses?clientId='+company.id)).items).toEqual([]);
  expect((await page.request.get('/api/v4/analyses/'+id)).status()).toBe(404);
  expect((await page.request.get('/api/v4/analyses/'+id+'/versions')).status()).toBe(404);
  for(const simulationId of simulationIds)expect((await page.request.get('/api/v4/simulations/'+simulationId)).status()).toBe(404);
  expect((await api(page.request,baseURL!,'GET','/api/v4/simulations?clientId='+company.id)).items).toEqual([]);
  expect(await freezeSources(analysisWorkspace,analysis,second.simulation)).toEqual(sources);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+preserved.id)).analysis).toEqual(preserved);
  for(const kind of ['purchases','sales'] as const){
    const summary=await api(page.request,baseURL!,'GET','/api/v4/'+kind+'/'+second.simulation.source[kind].jobId+'/summary');
    expect(summary.job.status).toBe('COMPLETED');expect(summary.totals.lines).toBe(9);
  }

  // The existing company is still selectable; its deleted result must not be adopted again.
  await page.goto('/analyses.html?view=new');await page.locator('#analysis-company-search').fill(company.code);
  await page.locator('[data-analysis-client="'+company.id+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','setup');
  await page.locator('input[name="sector"][value="accounting"]').check();await page.locator('#analysis-new-year').selectOption('2028');
  for(const regime of ['pure','hybrid','presumed'])await page.locator('#analysis-new-regime-'+regime).uncheck();
  await expect(page.locator('#new-difal-yes')).not.toBeVisible();await expect(page.locator('#new-difal-no')).not.toBeVisible();
  await page.locator('#analysis-open-company').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind','accounting');
  const newId=new URL(page.url()).searchParams.get('id');expect(newId).toBeTruthy();expect(newId).not.toBe(id);
  const restarted=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+newId)).analysis;
  expect(restarted.clientId).toBe(company.id);expect(restarted.currentSimulation).toBeNull();
  expect(restarted.config.year).toBe(2028);expect(restarted.config.regimeSelection.selected).toEqual(['actual']);
  expect(restarted.fiscal.status).toBe('DRAFT');expect(restarted.fiscal.data.generationId).toBeNull();
  expect(restarted.accounting.status).toBe('DRAFT');expect(restarted.accounting.data.months).toEqual([]);
  expect(restarted.readiness.ready).toBe(false);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses?clientId='+company.id)).items.map((row:any)=>row.id)).toEqual([newId]);
  expect(await freezeSources(analysisWorkspace,analysis,second.simulation)).toEqual(sources);
  expect(errors).toEqual([]);
});

test('Excluir pelo Fiscal com documentos ausentes preserva o rascunho ao cancelar e dispensa uma DRE gerada',async({page,baseURL,analysisWorkspace},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.admin);
  const company=await createCompany(page.request,baseURL!);
  const created=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:company.id,year:2027,regimeSelection:selection})).analysis;
  const prepared=await api(page.request,baseURL!,'POST','/api/v4/analyses/'+created.id+'/fiscal/import',{
    expectedSectorRevision:created.fiscal.revision,expectedConfigRevision:created.config.revision
  });
  const analysis=prepared.analysis,id=analysis.id,{db,workspaceId}=analysisWorkspace;
  expect(analysis.currentSimulation).toBeNull();
  expect((await db.collection<any>('generations').deleteOne({_id:prepared.generationId,workspaceId})).deletedCount).toBe(1);
  const companyBefore=await db.collection<any>('clients').findOne({_id:company.id,workspaceId});
  await signIn(page.request,baseURL!,analysisWorkspace.operator);
  const writes:any[]=[];page.on('request',request=>{
    if(['POST','PATCH','DELETE'].includes(request.method())&&new URL(request.url()).pathname.startsWith('/api/v4/analyses'))
      writes.push({method:request.method(),path:new URL(request.url()).pathname,body:request.postDataJSON()});
  });
  await page.goto('/analyses.html?id='+id+'&sector=fiscal&resumed=1');
  const wizard=page.locator('#analysis-wizard'),opener=page.locator('#analysis-delete-in-wizard'),dialog=page.locator('#analysis-delete-dialog');
  await expect(wizard).toHaveAttribute('data-wizard-step','documents');
  await expect(page.locator('#analysis-fiscal-evidence')).toContainText('não estão disponíveis');
  await expect(page.locator('[data-analysis-document="PURCHASES"]')).toContainText('Documento indisponível');
  await expect(page.locator('[data-analysis-document="SALES"]')).toContainText('Documento indisponível');
  await expect(opener).toHaveText('Excluir análise');await expect(opener).toBeEnabled();
  await page.screenshot({path:info.outputPath('analysis-delete-unavailable-fiscal-desktop.png'),fullPage:true});
  await opener.click();await expect(dialog).toHaveAccessibleName('Excluir análise?');
  await expect(page.locator('#analysis-delete-company')).toHaveText(company.name);
  await expect(page.locator('#analysis-delete-cancel')).toBeFocused();
  await page.locator('#analysis-delete-cancel').click();await expect(dialog).not.toBeVisible();
  await expect(wizard).toBeVisible();await expect(wizard).toHaveAttribute('data-wizard-step','documents');await expect(opener).toBeFocused();

  await fiscalStep(page,'tax');await expect(opener).toBeVisible();
  await page.locator('#analysis-extrato-manual').click();
  const rbt12=page.locator('#analysis-rbt12');await rbt12.fill('-1');
  const originalInput=await rbt12.elementHandle();expect(originalInput).toBeTruthy();
  await opener.click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
  await expect(wizard).toHaveAttribute('data-wizard-step','tax');await expect(rbt12).toHaveValue('-1');
  expect(await originalInput!.evaluate(node=>node===document.querySelector('#analysis-rbt12'))).toBe(true);
  expect(writes).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id+'?summary=1')).analysis.fiscal.data).toEqual(analysis.fiscal.data);
  await page.setViewportSize({width:390,height:844});await expect(opener).toBeInViewport();
  await page.screenshot({path:info.outputPath('analysis-delete-unavailable-fiscal-mobile.png'),fullPage:true});
  await opener.click();await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const deleting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await deleting).status()).toBe(200);
  await expect(page).toHaveURL(/\/analyses\.html\?deleted=1$/);await expect(page.locator('#analysis-feedback')).toContainText('Análise excluída');
  expect(writes).toEqual([{method:'DELETE',path:'/api/v4/analyses/'+id,body:{expectedRevision:analysis.revision,confirmed:true}}]);
  expect((await page.request.get('/api/v4/analyses/'+id+'?summary=1')).status()).toBe(404);
  expect(await db.collection<any>('clients').findOne({_id:company.id,workspaceId})).toEqual(companyBefore);
  const restarted=await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:company.id,year:2028,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}});
  expect(restarted.created).toBe(true);expect(restarted.analysis.id).not.toBe(id);expect(restarted.analysis.currentSimulation).toBeNull();
  expect(restarted.analysis.fiscal.data.generationId).toBeNull();expect(restarted.analysis.accounting.data.months).toEqual([]);
  expect(errors).toEqual([]);
});

test('Excluir rascunho pela carteira identifica a empresa, exige revisão atual e não carrega fontes fiscais',async({page,baseURL,analysisWorkspace},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.admin);
  const marker='Carteira sintética '+randomUUID(),company=await createCompany(page.request,baseURL!,marker),other=await createCompany(page.request,baseURL!,marker);
  const make=(clientId:string)=>api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}});
  let analysis=(await make(company.id)).analysis;const preserved=(await make(other.id)).analysis,id=analysis.id;
  expect(analysis.currentSimulation).toBeNull();expect(analysis.fiscal.data.generationId).toBeNull();
  await signIn(page.request,baseURL!,analysisWorkspace.operator);
  const reads:string[]=[],summaries:(string|null)[]=[],removals:any[]=[];
  page.on('request',request=>{
    const url=new URL(request.url());
    if(request.method()==='GET'){
      if(url.searchParams.has('includeSource')||/^\/api\/v4\/(generations|purchases|sales)\//.test(url.pathname))reads.push(url.pathname+url.search);
      if(url.pathname==='/api/v4/analyses')summaries.push(url.searchParams.get('summary'));
    }
    if(request.method()==='DELETE')removals.push({path:url.pathname,body:request.postDataJSON()});
  });
  await page.goto('/analyses.html?'+new URLSearchParams({search:marker}));
  const trigger=(targetId:string)=>page.locator('[data-analysis-id="'+targetId+'"] [data-delete-analysis="'+targetId+'"]');
  const dialog=page.locator('#analysis-delete-dialog');
  await expect(trigger(id)).toHaveText('Excluir análise');await expect(trigger(preserved.id)).toBeVisible();
  await page.screenshot({path:info.outputPath('analysis-delete-list-desktop.png'),fullPage:true});
  await trigger(preserved.id).click();await expect(page.locator('#analysis-delete-company')).toHaveText(other.name);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger(preserved.id)).toBeFocused();expect(removals).toEqual([]);
  await trigger(id).click();await expect(page.locator('#analysis-delete-company')).toHaveText(company.name);
  const staleRevision=analysis.revision;
  analysis=(await api(page.request,baseURL!,'PATCH','/api/v4/analyses/'+id+'/accounting',{
    expectedSectorRevision:analysis.accounting.revision,expectedConfigRevision:analysis.config.revision,complete:false,
    data:{months:[{sourceMonth:'2025-01',salariesCents:12_345,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}]}
  })).analysis;
  const conflicting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await conflicting).status()).toBe(409);
  await expect(dialog).toBeVisible();await expect(page.locator('#analysis-delete-error')).toContainText('atualizada por outra pessoa ou aba');
  let release!:()=>void,reached!:()=>void;
  const barrier=new Promise<void>(resolve=>release=resolve),fetched=new Promise<void>(resolve=>reached=resolve);
  const pattern='**/api/v4/analyses?*';
  const held=async(route:Route)=>{const response=await route.fetch();reached();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    const refreshing=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses'&&response.request().method()==='GET');
    await page.locator('#analysis-delete-reload').click();await fetched;
    await expect(dialog).not.toBeVisible();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','true');
    await expect(trigger(id)).toBeDisabled();await expect(trigger(preserved.id)).toBeDisabled();
    await trigger(preserved.id).dispatchEvent('click');await expect(dialog).not.toBeVisible();
    expect(removals).toEqual([{path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}}]);
    release();expect((await refreshing).ok()).toBe(true);
  }finally{release();await page.unroute(pattern,held);}
  await expect(dialog).not.toBeVisible();await expect(trigger(id)).toBeEnabled();
  await expect(trigger(id)).toBeFocused();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  expect(new URL(page.url()).searchParams.get('search')).toBe(marker);
  expect(removals).toEqual([{path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}}]);
  expect(reads).toEqual([]);expect(summaries.length).toBeGreaterThanOrEqual(2);expect(summaries.every(value=>value==='1')).toBe(true);
  await page.setViewportSize({width:390,height:844});await trigger(id).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('analysis-delete-list-mobile.png'),fullPage:true});
  await trigger(id).click();await expect(dialog).toHaveAccessibleName('Excluir análise?');
  const deleting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await deleting).status()).toBe(200);
  await expect(page).toHaveURL(/\/analyses\.html\?deleted=1$/);await expect(page.locator('#analysis-search')).toBeVisible();
  expect(removals).toEqual([
    {path:'/api/v4/analyses/'+id,body:{expectedRevision:staleRevision,confirmed:true}},
    {path:'/api/v4/analyses/'+id,body:{expectedRevision:analysis.revision,confirmed:true}}
  ]);
  expect(reads).toEqual([]);expect((await page.request.get('/api/v4/analyses/'+id)).status()).toBe(404);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+preserved.id)).analysis).toEqual(preserved);
  expect(errors).toEqual([]);
});

test('Excluir nos modais Contábil e configuração preserva campos ao cancelar e respeita acesso somente consulta',async({page,browser,baseURL,analysisWorkspace})=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page.request,baseURL!,analysisWorkspace.admin);
  const company=await createCompany(page.request,baseURL!);
  let analysis=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
  analysis=(await api(page.request,baseURL!,'PATCH','/api/v4/analyses/'+analysis.id+'/accounting',{
    expectedSectorRevision:analysis.accounting.revision,expectedConfigRevision:analysis.config.revision,complete:false,
    data:{months:[{sourceMonth:'2025-01',salariesCents:10_000,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0}]}
  })).analysis;
  const id=analysis.id,readOnly=await browser.newContext({baseURL});
  try{
    await signIn(readOnly.request,baseURL!,analysisWorkspace.viewer);const viewer=await readOnly.newPage();
    viewer.on('pageerror',error=>errors.push(error.message));
    await viewer.goto('/analyses.html?search='+company.code);await expect(viewer.locator('[data-analysis-id="'+id+'"]')).toBeVisible();
    await expect(viewer.locator('[data-delete-analysis]')).toHaveCount(0);
    for(const query of ['sector=fiscal','sector=accounting','view=settings']){
      await viewer.goto('/analyses.html?id='+id+'&'+query);await expect(viewer.locator('#analysis-wizard')).toBeVisible();
      await expect(viewer.locator('[data-delete-analysis]')).toHaveCount(0);await expect(viewer.locator('#analysis-delete-in-wizard')).toHaveCount(0);
    }
  }finally{await readOnly.close();}
  const removals:string[]=[],patches:string[]=[];page.on('request',request=>{
    if(request.method()==='DELETE')removals.push(new URL(request.url()).pathname);
    if(request.method()==='PATCH')patches.push(new URL(request.url()).pathname);
  });
  await page.goto('/analyses.html?id='+id+'&sector=accounting');
  const wizard=page.locator('#analysis-wizard'),opener=page.locator('#analysis-delete-in-wizard'),dialog=page.locator('#analysis-delete-dialog');
  const salary=page.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]');await salary.fill('-5');
  const originalInput=await salary.elementHandle();
  for(const cancel of ['button','escape']){
    await opener.click();await expect(dialog).toBeVisible();await expect(page.locator('#analysis-delete-cancel')).toBeFocused();
    if(cancel==='button')await page.locator('#analysis-delete-cancel').click();else await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
    await expect(wizard).toHaveAttribute('data-wizard-kind','accounting');await expect(salary).toHaveValue('-5');
    expect(await originalInput!.evaluate(node=>node===document.querySelector('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]'))).toBe(true);
  }
  expect(removals).toEqual([]);expect(patches).toEqual([]);
  await salary.fill('123.45');await page.locator('#analysis-wizard-close').click();await page.locator('#analysis-open-config').click();
  await expect(wizard).toHaveAttribute('data-wizard-kind','config');await page.locator('#analysis-regime-actual').uncheck();
  await expect(page.locator('#analysis-config-form input[name="regime"]:checked')).toHaveCount(0);
  await opener.click();await expect(dialog).toHaveAccessibleName('Excluir análise?');await page.locator('#analysis-delete-cancel').click();
  await expect(wizard).toHaveAttribute('data-wizard-kind','config');await expect(page.locator('#analysis-config-form input[name="regime"]:checked')).toHaveCount(0);
  expect(removals).toEqual([]);expect(patches).toEqual([]);
  expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+id)).analysis).toEqual(analysis);
  await opener.click();const deleting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+id&&response.request().method()==='DELETE');
  await page.locator('#analysis-delete-confirm').click();expect((await deleting).status()).toBe(200);
  await expect(page).toHaveURL(/\/analyses\.html\?deleted=1$/);expect(removals).toEqual(['/api/v4/analyses/'+id]);expect(patches).toEqual([]);
  expect(errors).toEqual([]);
});
