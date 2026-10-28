import {test as base,expect,type APIRequestContext,type Page,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Account={id:string;email:string;password:string};
const test=base.extend<{analysisAccount:Account}>({
  analysisAccount:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const account={id:randomUUID(),email:'analysis-performance-'+randomUUID()+'@example.test',password:'Synthetic-performance-'+randomUUID()};
    try{
      await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name:'Equipe sintética de desempenho',
        role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      await use(account);
    }finally{
      await db.collection('sessions').deleteMany({workspaceId,userId:account.id});
      await db.collection<any>('users').deleteOne({workspaceId,_id:account.id});await mongo.close();
    }
  }
});
async function api(request:APIRequestContext,baseURL:string,method:'GET'|'POST'|'PATCH'|'DELETE',path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}
async function create(request:APIRequestContext,baseURL:string,account:Account){
  await api(request,baseURL,'POST','/api/auth/login',{email:account.email,password:account.password});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
  const company=(await api(request,baseURL,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa sintética desempenho '+code,uf:'MG'}]})).items[0];
  return (await api(request,baseURL,'POST','/api/v4/analyses',{clientId:company.id,year:2027,
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
}
const month=(sourceMonth:string,salariesCents=10_000)=>({sourceMonth,salariesCents,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0});
async function patch(request:APIRequestContext,baseURL:string,analysis:any,sector:'fiscal'|'accounting',data:unknown,complete=false){
  return (await api(request,baseURL,'PATCH','/api/v4/analyses/'+analysis.id+'/'+sector,{expectedSectorRevision:analysis[sector].revision,
    expectedConfigRevision:analysis.config.revision,complete,data})).analysis;
}
async function withDocuments(request:APIRequestContext,baseURL:string,analysis:any,{complete=true,months=Array.from({length:9},(_,index)=>month('2025-0'+(index+1)))}={}){
  const prepared=await api(request,baseURL,'POST','/api/v4/analyses/'+analysis.id+'/fiscal/import',{
    expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});
  for(const kind of ['purchases','sales'] as const){
    const attached=await api(request,baseURL,'POST','/api/v4/generations/'+prepared.generationId+'/'+kind,{
      clientId:analysis.clientId,importId:randomUUID(),fileName:'desempenho-'+kind+'.csv',expectedRows:9,issuerUf:'MG'});
    await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/rows',{offset:0,rows:Array.from({length:9},(_,index)=>index+1).map(value=>{
      const totalCents=value<=2?(kind==='sales'?100_000:20_000)*value:0;
      return {document:'12345678900',name:'Pessoa sintética',serviceDate:'2025-0'+value+'-15',quantity:'1',
        natureCode:kind==='sales'?'5102001':'1102001',description:'Operação sintética',recipientUf:'MG',
        grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents};
    })});
    const completed=await api(request,baseURL,'POST','/api/v4/'+kind+'/'+attached.job._id+'/finalize',{});
    expect(completed.status).toBe('COMPLETED');
  }
  analysis=await patch(request,baseURL,prepared.analysis,'fiscal',prepared.analysis.fiscal.data,complete);
  return patch(request,baseURL,analysis,'accounting',{months});
}
async function switchSector(page:Page,sector:'fiscal'|'accounting'){
  const dialog=page.locator('#analysis-wizard');
  if(await dialog.isVisible())await dialog.locator('[data-analysis-sector="'+sector+'"]').click();
  else await page.locator('[data-analysis-sector="'+sector+'"]').first().click();
  await expect(dialog).toHaveAttribute('data-wizard-kind',sector);await expect(dialog).toBeVisible();
  if(sector==='fiscal')await fiscalDocuments(page);
}

async function fiscalDocuments(page:Page){
  const wizard=page.locator('#analysis-wizard'),steps=['regimes','difal','rbt12','documents'];
  for(let attempt=0;attempt<steps.length;attempt++){
    const current=await wizard.getAttribute('data-wizard-step');expect(steps).toContain(current);
    if(current==='documents')return;
    await page.locator('#analysis-wizard-next').click();
    await expect(wizard).not.toHaveAttribute('data-wizard-step',current!);
  }
  await expect(wizard).toHaveAttribute('data-wizard-step','documents');
}
async function openDetails(page:Page,id:string){
  const detail=page.locator('#'+id);if(await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
}
const salary=(page:Page)=>page.locator('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]');
function observe(page:Page,id:string){
  const counts={source:0,generation:0,patches:0};page.on('request',request=>{
    const url=new URL(request.url());
    if(url.pathname==='/api/v4/analyses/'+id&&url.searchParams.get('includeSource')==='1')counts.source++;
    if(/^\/api\/v4\/generations\/[a-f0-9-]+$/.test(url.pathname))counts.generation++;
    if(request.method()==='PATCH'&&url.pathname.startsWith('/api/v4/analyses/'+id))counts.patches++;
  });return counts;
}

test('Evidência fiscal lenta permite preencher e trocar setores, deduplica a leitura e preserva o rascunho ao chegar',async({page,baseURL,analysisAccount},info)=>{
  test.setTimeout(75_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);analysis=await withDocuments(page.request,baseURL!,analysis);
  const counts=observe(page,analysis.id),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
  const pattern='**/api/v4/analyses/'+analysis.id+'?includeSource=1';
  const held=async(route:Route)=>{const response=await route.fetch();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');
    await expect(salary(page)).toBeVisible();expect(counts.source).toBe(0);expect(counts.generation).toBe(0);
    await salary(page).fill('123.45');await switchSector(page,'fiscal');
    await expect(page.locator('#analysis-fiscal-evidence')).toContainText('Conferindo documentos fiscais');
    await expect.poll(()=>counts.source).toBe(1);
    // A conciliação de valores está bloqueada, mas o status dos dois arquivos deve aparecer imediatamente.
    await expect(page.locator('[data-analysis-document="PURCHASES"]')).toContainText('Leitura concluída');
    await expect(page.locator('[data-analysis-document="SALES"]')).toContainText('Leitura concluída');
    await fiscalDocuments(page);
    await openDetails(page,'analysis-fiscal-options');await page.locator('#analysis-sales-annex').selectOption('2');
    await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('123.45');
    await page.locator('#analysis-wizard-close').click();await expect(page.locator('#analysis-wizard')).not.toBeVisible();
    await switchSector(page,'fiscal');await expect(page.locator('#analysis-sales-annex')).toHaveValue('2');
    expect(counts.source).toBe(1);expect(counts.generation).toBe(1);
    await page.evaluate(()=>{(window as any).__fiscalField=document.querySelector('#analysis-sales-annex');});
    release();await expect(page.locator('#analysis-fiscal-evidence')).toBeEmpty();
    expect(await page.evaluate(()=>(window as any).__fiscalField===document.querySelector('#analysis-sales-annex'))).toBe(true);
    await expect(page.locator('#analysis-sales-annex')).toHaveValue('2');
    await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('123.45');
    expect(counts.source).toBe(1);expect(counts.patches).toBe(0);
    const saved=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis;
    expect(saved.fiscal).toEqual(analysis.fiscal);expect(saved.accounting).toEqual(analysis.accounting);
    await page.screenshot({path:info.outputPath('analysis-responsive-after-slow-evidence.png'),fullPage:true});expect(errors).toEqual([]);
  }finally{release();await page.unroute(pattern,held);}
});

test('Documento indisponível mostra recuperação local sem bloquear Contábil nem repetir consultas automaticamente',async({page,baseURL,analysisAccount},info)=>{
  test.setTimeout(75_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);analysis=await withDocuments(page.request,baseURL!,analysis);
  const counts=observe(page,analysis.id),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let unavailable=true;const pattern='**/api/v4/generations/'+analysis.fiscal.data.generationId;
  await page.route(pattern,route=>unavailable?route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'NOT_FOUND',message:'Documento indisponível'})}):route.continue());
  await page.goto('/analyses.html?id='+analysis.id+'&sector=fiscal');await fiscalDocuments(page);
  await expect(page.locator('#analysis-fiscal-evidence')).toContainText('não estão disponíveis');
  expect(counts.source).toBe(1);expect(counts.generation).toBe(1);
  let confirmation='';page.once('dialog',async dialog=>{confirmation=dialog.message();await dialog.dismiss();});
  await page.locator('#analysis-replace-missing-documents').click();
  await expect.poll(()=>confirmation).toContain('Preparar novos relatórios');
  await expect(page.locator('#analysis-fiscal-documents-view a')).toHaveCount(0);
  await switchSector(page,'accounting');await salary(page).fill('237.45');
  await switchSector(page,'fiscal');await expect(page.locator('#analysis-fiscal-evidence')).toContainText('não estão disponíveis');
  expect(counts.source).toBe(1);expect(counts.generation).toBe(1);expect(counts.patches).toBe(0);
  await page.screenshot({path:info.outputPath('analysis-missing-document-recovery.png'),fullPage:true});
  unavailable=false;await page.locator('#analysis-retry-evidence').click();
  await expect(page.locator('#analysis-fiscal-evidence')).toBeEmpty();expect(counts.source).toBe(2);expect(counts.generation).toBe(2);
  await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('237.45');
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+analysis.id+'/accounting'&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="save"]').click();expect((await saving).ok()).toBe(true);
  const saved=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis;
  expect(saved.accounting.data.months[0].salariesCents).toBe(23_745);expect(saved.fiscal).toEqual(analysis.fiscal);expect(counts.patches).toBe(1);
  expect(errors).toEqual([]);
});

test('Geração realmente excluída permite salvar RBT12 e recuperar importação sem perder o Contábil',async({page,baseURL,analysisAccount})=>{
  test.setTimeout(90_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);
  analysis=(await api(page.request,baseURL!,'PATCH','/api/v4/analyses/'+analysis.id+'/config',{
    expectedConfigRevision:analysis.config.revision,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}})).analysis;
  analysis=await withDocuments(page.request,baseURL!,analysis,{complete:false});
  analysis=await patch(page.request,baseURL!,analysis,'fiscal',{...analysis.fiscal.data,rbt12Source:'MANUAL',rbt12:1_500_000,rbt12ManualConfirmed:true});
  const removedId=analysis.fiscal.data.generationId,accounting=structuredClone(analysis.accounting),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await api(page.request,baseURL!,'DELETE','/api/v4/generations/'+removedId,{});
  await page.goto('/analyses.html?id='+analysis.id+'&sector=fiscal&step=rbt12');
  await expect(page.locator('#analysis-rbt12')).toHaveValue('1500000.00');
  await page.locator('#analysis-rbt12').fill('2700000.45');await page.locator('#analysis-rbt12-confirm').check();
  const saved=page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname.endsWith('/fiscal'));
  await page.locator('#analysis-wizard button[value="save"]').click();expect((await saved).ok()).toBe(true);
  await expect(page.locator('#analysis-rbt12')).toHaveValue('2700000.45');
  await page.locator('#analysis-wizard-next').click();
  await expect(page.locator('#analysis-fiscal-evidence')).toContainText('nova importação');
  await expect(page.locator('#analysis-fiscal-documents-view a')).toHaveCount(0);
  const rejected=page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname.endsWith('/fiscal'));
  await page.locator('#analysis-wizard button[value="complete"]').click();
  const failure=await rejected;expect(failure.status()).toBe(409);expect((await failure.json()).error).toBe('ANALYSIS_GENERATION_UNAVAILABLE');
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
  await expect(page.locator('#analysis-replace-missing-documents')).toBeVisible();
  await openDetails(page,'analysis-fiscal-options');await page.locator('#analysis-sales-annex').selectOption('2');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#analysis-replace-missing-documents').click();
  await expect(page).toHaveURL(/\/purchases\.html\?generation=/);
  const current=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  expect(current.fiscal.data.generationId).not.toBe(removedId);expect(current.fiscal.data.rbt12).toBe(2_700_000.45);
  expect(current.fiscal.data.salesAnnex).toBe(2);expect(current.accounting).toEqual(accounting);
  await api(page.request,baseURL!,'GET','/api/v4/generations/'+current.fiscal.data.generationId);
  expect((await page.request.get('/api/v4/generations/'+removedId)).status()).toBe(404);
  await expect(page.locator('#purchase-unavailable')).toHaveCount(0);await expect(page.locator('#purchase-error')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('Digitação em nove competências conserva os nós, atualiza o resumo sob demanda e salva centavos exatos',async({page,baseURL,analysisAccount})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);
  const months=Array.from({length:9},(_,index)=>month('2025-0'+(index+1)));
  analysis=await patch(page.request,baseURL!,analysis,'accounting',{months});const counts=observe(page,analysis.id);
  await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');await expect(salary(page)).toBeVisible();
  await page.locator('#analysis-accounting-summary-panel > summary').click();
  await expect(page.locator('#analysis-accounting-summary-panel')).toHaveJSProperty('open',false);
  await salary(page).fill('1');
  await page.evaluate(()=>{
    const ids=['analysis-guidance','analysis-generation','analysis-accounting-summary','analysis-wizard-progress'];
    (window as any).__stableNodes=ids.map(id=>({id,node:document.getElementById(id),child:document.getElementById(id)?.firstElementChild}));
    (window as any).__input=document.querySelector('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]');
  });
  await salary(page).pressSequentially('2345');await expect(salary(page)).toHaveValue('12345');
  expect(await page.evaluate(()=>(window as any).__stableNodes.every((item:any)=>item.node===document.getElementById(item.id)&&item.child===item.node.firstElementChild))).toBe(true);
  expect(await page.evaluate(()=>(window as any).__input===document.activeElement)).toBe(true);
  expect(counts.source).toBe(0);expect(counts.patches).toBe(0);
  await openDetails(page,'analysis-accounting-summary-panel');
  await expect(page.locator('[data-accounting-summary-total]')).toContainText('13.145,00');
  const replacements=await page.evaluate(async()=>{
    const host=document.getElementById('analysis-accounting-summary')!,input=(window as any).__input as HTMLInputElement;
    let replacements=0;const observer=new MutationObserver(records=>{replacements+=records.filter(record=>record.type==='childList').length;});observer.observe(host,{childList:true});
    for(let value=100;value<200;value++){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));observer.disconnect();return replacements;
  });
  expect(replacements).toBe(1);await expect(page.locator('[data-accounting-summary-total]')).toContainText('999,00');
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+analysis.id+'/accounting'&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="save"]').click();expect((await saving).ok()).toBe(true);
  const saved=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis;
  expect(saved.accounting.data.months).toEqual([{...months[0],salariesCents:19_900},...months.slice(1)]);
  expect(counts.source).toBe(0);expect(counts.patches).toBe(1);
});

test('Contábil identifica meses antes da conclusão Fiscal sem reconciliar fontes nem remontar campos em edição',async({page,baseURL,analysisAccount})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);
  analysis=await withDocuments(page.request,baseURL!,analysis,{complete:false,months:[month('2025-01')]});
  const summary=(await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id+'?summary=1')).analysis;
  expect(summary.fiscal.status).toBe('DRAFT');expect(summary.readiness.months).toEqual([]);
  const counts=observe(page,analysis.id);let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
  const pattern='**/api/v4/generations/'+analysis.fiscal.data.generationId;
  const held=async(route:Route)=>{const response=await route.fetch();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');await expect(salary(page)).toBeVisible();
    await salary(page).fill('321.09');await openDetails(page,'analysis-accounting-tools');
    await expect(page.locator('#analysis-accounting-period')).toContainText('O ano será identificado nos documentos');
    await expect(page.locator('#analysis-accounting-source-months')).toContainText('Janeiro a setembro de 2025');
    await page.locator('#analysis-new-source-year').fill('2025');await openDetails(page,'analysis-accounting-paste-panel');
    const pasted='2025-02\t50\t0\t0\t0\t0';await page.locator('#analysis-accounting-paste').fill(pasted);
    await page.evaluate(()=>{
      const textarea=document.getElementById('analysis-accounting-paste') as HTMLTextAreaElement;textarea.focus();textarea.setSelectionRange(4,7);
      (window as any).__editing={textarea,year:document.getElementById('analysis-new-source-year'),salary:document.querySelector('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')};
    });
    release();await expect(page.locator('#analysis-add-fiscal-months')).toHaveCount(0);await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
    await expect(page.locator('#analysis-accounting-source-months')).toContainText('Janeiro a setembro de 2025');
    await expect(page.locator('#analysis-accounting-source-months')).toContainText('9 competências');
    expect(await page.evaluate(()=>{
      const saved=(window as any).__editing;return saved.textarea===document.activeElement&&saved.textarea===document.getElementById('analysis-accounting-paste')&&
        saved.year===document.getElementById('analysis-new-source-year')&&saved.salary===document.querySelector('[data-accounting-month="2025-01"] [data-accounting-field="salariesCents"]')&&
        saved.textarea.selectionStart===4&&saved.textarea.selectionEnd===7;
    })).toBe(true);
    await expect(page.locator('#analysis-accounting-paste')).toHaveValue(pasted);await expect(page.locator('#analysis-new-source-year')).toHaveValue('2025');
    await expect(page.locator('#analysis-new-source-year')).toHaveAttribute('readonly','');
    await expect(salary(page)).toHaveValue('321.09');expect(counts).toEqual({source:0,generation:1,patches:0});
    await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
    await expect(page.locator('[data-accounting-month="2025-02"] [data-accounting-field="salariesCents"]')).toHaveValue('');
    await expect(salary(page)).toHaveValue('321.09');expect(counts).toEqual({source:0,generation:1,patches:0});
  }finally{release();await page.unroute(pattern,held);}
});

test('Cobertura fiscal parcial identifica meses excluídos; a fonte verificada mantém o Contábil em edição',async({page,baseURL,analysisAccount})=>{
  test.setTimeout(60_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);
  analysis=await withDocuments(page.request,baseURL!,analysis,{complete:false,months:[month('2025-01')]});
  const counts=observe(page,analysis.id);
  await page.route('**/api/v4/generations/'+analysis.fiscal.data.generationId,async route=>{
    const response=await route.fetch(),generation=await response.json();
    generation.companies[0].sales.reportPeriod={...generation.companies[0].sales.reportPeriod,endMonth:'2025-03',months:3};
    await route.fulfill({json:generation});
  });
  let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
  const pattern='**/api/v4/analyses/'+analysis.id+'?includeSource=1';
  const held=async(route:Route)=>{const response=await route.fetch();await barrier;await route.fulfill({response});};
  await page.route(pattern,held);
  try{
    await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');await openDetails(page,'analysis-accounting-tools');
    await expect(page.locator('#analysis-accounting-source-months')).toContainText('Janeiro a setembro de 2025');
    await expect(page.locator('#analysis-add-fiscal-months')).toHaveCount(0);await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
    const period=page.locator('#analysis-accounting-period');
    await expect(period).toContainText('3/9 meses cobertos');
    await expect(period.locator('.analysis-period-months .is-missing')).toHaveCount(6);
    await expect(period.locator('.analysis-period-months .is-missing').first()).toHaveAttribute('title',/Abril/);
    await expect(period.locator('.analysis-period-months .is-missing').last()).toHaveAttribute('title',/Setembro/);
    await expect(page.locator('#analysis-generate')).toBeDisabled();expect(counts.source).toBe(0);
    await salary(page).fill('432.10');await switchSector(page,'fiscal');
    await expect(page.locator('#analysis-fiscal-evidence')).toContainText('Conferindo documentos fiscais');
    await switchSector(page,'accounting');await openDetails(page,'analysis-accounting-tools');
    await salary(page).focus();await page.evaluate(()=>{(window as any).__activeAccountingInput=document.activeElement;});
    release();await expect(page.locator('#analysis-add-fiscal-months')).toHaveCount(0);await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
    await expect(page.locator('#analysis-accounting-source-months')).toContainText('Janeiro a setembro de 2025');
    await expect(period).toContainText('9/9 meses cobertos');
    await expect(period.locator('.analysis-period-months .is-missing')).toHaveCount(0);
    await expect(salary(page)).toHaveValue('432.10');
    expect(await page.evaluate(()=>(window as any).__activeAccountingInput===document.activeElement&&document.activeElement?.isConnected)).toBe(true);
    expect(counts).toEqual({source:1,generation:1,patches:0});
  }finally{release();await page.unroute(pattern,held);}
});

test('Ano fiscal tardio bloqueia a prévia antiga e mantém acessível um valor inválido do outro ano',async({page,baseURL,analysisAccount})=>{
  test.setTimeout(75_000);page.setDefaultTimeout(12_000);
  let analysis=await create(page.request,baseURL!,analysisAccount);
  analysis=await withDocuments(page.request,baseURL!,analysis,{complete:false,months:[month('2026-01')]});
  const savedMonths=structuredClone(analysis.accounting.data.months),counts=observe(page,analysis.id),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let release!:()=>void,barrier=new Promise<void>(resolve=>release=resolve);
  const pattern='**/api/v4/generations/'+analysis.fiscal.data.generationId;
  const held=async(route:Route)=>{const pending=barrier,response=await route.fetch();await pending;await route.fulfill({response});};
  const input=page.locator('[data-accounting-month="2026-01"] [data-accounting-field="salariesCents"]');
  await page.route(pattern,held);
  try{
    await page.goto('/analyses.html?id='+analysis.id+'&sector=accounting');await expect(input).toBeVisible();
    await openDetails(page,'analysis-accounting-tools');await openDetails(page,'analysis-accounting-paste-panel');
    const pasted='2026-02\t50\t0\t0\t0\t0';await page.locator('#analysis-accounting-paste').fill(pasted);
    await page.locator('#analysis-preview-accounting-paste').click();
    await expect(page.locator('#analysis-paste-replace-confirm')).not.toBeChecked();
    await page.locator('#analysis-paste-replace-confirm').check();
    await expect(page.locator('#analysis-apply-accounting-paste')).toBeEnabled();
    await expect(page.locator('#analysis-accounting-paste-preview')).toContainText('Fevereiro / 2026');
    release();await expect(page.locator('#analysis-new-source-year')).toHaveValue('2025');
    await expect(page.locator('#analysis-new-source-year')).toHaveAttribute('readonly','');
    await page.locator('#analysis-apply-accounting-paste').click();
    await expect(page.locator('#analysis-accounting-paste-error')).toContainText('mesmo ano dos documentos');
    await expect(page.locator('#analysis-accounting-paste')).toHaveValue(pasted);
    await expect(page.locator('[data-accounting-month="2026-02"] [data-accounting-field="salariesCents"]')).toHaveValue('');
    expect((await api(page.request,baseURL!,'GET','/api/v4/analyses/'+analysis.id)).analysis.accounting.data.months).toEqual(savedMonths);
    expect(counts.patches).toBe(0);
    await page.locator('#analysis-clear-accounting-paste').click();

    // A fresh slow response arrives while the old year's numeric input is unfinished.
    barrier=new Promise<void>(resolve=>release=resolve);
    await page.reload();await expect(input).toBeVisible();await input.fill('1234.567');
    expect(await input.evaluate(element=>(element as HTMLInputElement).validity.valid)).toBe(false);
    const original=await input.elementHandle();
    release();await expect(page.locator('[data-accounting-month="2026-01"] [data-accounting-period-note]')).toHaveText('Fora do período desta análise');
    await expect(input).toBeVisible();await expect(input).toHaveValue('1234.567');await expect(input).toBeFocused();
    expect(await original!.evaluate(node=>node===document.querySelector('[data-accounting-month="2026-01"] [data-accounting-field="salariesCents"]'))).toBe(true);
    await page.locator('#analysis-wizard button[value="save"]').click();
    await expect(page.locator('#analysis-wizard #analysis-error')).toContainText('até duas casas decimais');
    await expect(input).toBeVisible();await expect(input).toBeFocused();expect(counts.patches).toBe(0);
    await input.fill('1234.56');
    const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/analyses/'+analysis.id+'/accounting'&&response.request().method()==='PATCH');
    await page.locator('#analysis-wizard button[value="save"]').click();
    const response=await saving;expect(response.ok(),await response.text()).toBe(true);
    const saved=(await response.json()).analysis;
    expect(saved.accounting.data.months.filter((row:any)=>row.salariesCents!==null)).toEqual([{...savedMonths[0],salariesCents:123456}]);
    expect(counts).toEqual({source:0,generation:2,patches:1});expect(errors).toEqual([]);
  }finally{release();await page.unroute(pattern,held);}
});
