import {test as base,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Fixture={clientId:string;code:string};
const test=base.extend<{company:Fixture}>({company:async({page,baseURL},use)=>{
  expect(process.env.MONGODB_URI,'MongoDB descartável obrigatório').toBeTruthy();
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',userId=randomUUID();
  const email=`partial-${userId}@example.test`,password=`Synthetic-${randomUUID()}`,code=String(Number.parseInt(userId.replaceAll('-','').slice(0,11),16));
  try{
    await db.collection<any>('users').insertOne({_id:userId,workspaceId,email,passwordHash:await hashPassword(password),name:'Validação sintética parcial',role:'admin',active:true,mustChangePassword:false,createdAt:new Date()});
    await api(page.request,baseURL!,'POST','/api/auth/login',{email,password});
    const imported=await api(page.request,baseURL!,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa parcial '+code,uf:'MG'}]});
    await use({clientId:imported.items[0].id,code});
  }finally{await db.collection<any>('sessions').deleteMany({workspaceId,userId});await db.collection<any>('users').deleteOne({_id:userId,workspaceId});await mongo.close();}
}});
async function api(request:APIRequestContext,baseURL:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}

test('Análises começa na empresa, escolhe setor, regimes, DIFAL e pede apenas RBT12 nessa etapa',async({page,baseURL,company},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/analyses.html');
  const wizard=page.locator('#analysis-wizard');await expect(wizard).toHaveAttribute('data-wizard-step','company');
  await expect(page.locator('input[name=sector]').first()).not.toBeVisible();
  await page.locator('#analysis-company-search').fill(company.code);await page.locator(`[data-analysis-client="${company.clientId}"]`).click();
  await expect(wizard).toHaveAttribute('data-wizard-step','sector');
  await page.locator('input[name=sector][value=fiscal]').check();await page.locator('#analysis-open-company').click();
  await expect(wizard).toHaveAttribute('data-wizard-kind','fiscal');await expect(wizard).toHaveAttribute('data-wizard-step','regimes');
  await page.locator('#analysis-fiscal-regime-presumed').uncheck();await page.locator('#analysis-fiscal-regime-actual').uncheck();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','difal');
  await page.locator('#analysis-wizard-next').click();await expect(page.locator('#analysis-error')).toContainText('escolha Sim ou Não');
  await expect(wizard).toHaveAttribute('data-wizard-step','difal');
  await page.locator('#analysis-difal-yes').check();
  for(const id of ['pure','hybrid']){
    await expect(page.locator(`[data-analysis-difal="${id}"] input[type=checkbox]`)).toHaveCount(3);
    await expect(page.locator(`[data-analysis-difal="${id}"]`)).toContainText('Incluir DIFAL neste regime');
    await expect(page.locator(`[data-analysis-difal="${id}"]`)).toContainText('ENTRADA - antecipação das compras');
    await expect(page.locator(`[data-analysis-difal="${id}"]`)).toContainText('SAÍDAS - vendas');
  }
  await page.locator('[data-analysis-difal-regime=hybrid][data-analysis-difal-operation=entry]').uncheck();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','rbt12');
  await expect(page.locator('#analysis-rbt12-pdf')).toBeVisible();
  await expect(page.locator('#analysis-difal-panel')).not.toBeVisible();
  await expect(page.locator('#analysis-sales-annex')).not.toBeVisible();
  await expect(page.locator('#analysis-fiscal-documents-view')).not.toBeVisible();
  await page.locator('#analysis-extrato-manual').click();await page.locator('#analysis-rbt12').fill('120000');await page.locator('#analysis-rbt12-confirm').check();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','documents');
  await page.locator('#analysis-wizard button[value=save]').click();await expect(page.locator('#analysis-feedback')).toContainText('salvo');
  const id=new URL(page.url()).searchParams.get('id');const saved=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${id}?summary=1`)).analysis;
  expect(saved.config.regimeSelection.selected).toEqual(['pure','hybrid']);expect(saved.fiscal.data.rbt12).toBe(120000);
  expect(saved.fiscal.data.difalPolicy.operations.hybrid.entry).toBe(false);
  expect(saved.fiscal.data.generationId).toBeNull();
  await page.setViewportSize({width:390,height:650});await page.screenshot({path:info.outputPath('fiscal-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Contábil abre nove meses, ignora vazios e gera relatório único dos meses não consecutivos preenchidos',async({page,baseURL,company},info)=>{
  test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let analysis=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{clientId:company.clientId,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['actual']}})).analysis;
  const imported=await api(page.request,baseURL!,'POST',`/api/v4/analyses/${analysis.id}/fiscal/import`,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision});analysis=imported.analysis;
  for(const kind of ['purchases','sales']){
    const linked=await api(page.request,baseURL!,'POST',`/api/v4/generations/${imported.generationId}/${kind}`,{clientId:company.clientId,importId:randomUUID(),fileName:`partial-${kind}.csv`,expectedRows:3,issuerUf:'MG'});
    await api(page.request,baseURL!,'POST',`/api/v4/${kind}/${linked.job._id}/rows`,{offset:0,rows:[1,2,3].map(month=>{
      const totalCents=kind==='sales'?100_000:20_000;
      return {document:'12345678900',name:'Pessoa sintética',serviceDate:`2025-0${month}-15`,quantity:'1',natureCode:kind==='sales'?'5102001':'1102001',description:'Operação parcial',recipientUf:'MG',grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents};
    })});
    await api(page.request,baseURL!,'POST',`/api/v4/${kind}/${linked.job._id}/finalize`,{});
  }
  // With Fiscal still a draft, the source year arrives asynchronously from metadata.
  // The untouched empty grid must follow it without creating zero expenses.
  await page.goto(`/analyses.html?client=${company.clientId}&sector=accounting`);
  await expect(page.locator('[data-accounting-month="2025-01"]')).toBeVisible();
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
  analysis=(await api(page.request,baseURL!,'PATCH',`/api/v4/analyses/${analysis.id}/fiscal`,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision,complete:true,data:analysis.fiscal.data})).analysis;
  await page.goto(`/analyses.html?client=${company.clientId}&sector=accounting`);
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);await expect(page.locator('[data-accounting-month="2025-01"]')).toBeVisible();
  for(const month of ['2025-01','2025-03']){
    const details=page.locator(`[data-accounting-month="${month}"]`);if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator('summary').click();
    await details.locator('[data-accounting-field=salariesCents]').fill(month.endsWith('01')?'100.01':'200.02');
    for(const field of ['rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'])await details.locator(`[data-accounting-field=${field}]`).fill('0');
  }
  await expect(page.locator('[data-accounting-summary-months]')).toHaveText('2 / 9');await expect(page.locator('[data-accounting-summary-excluded]')).toHaveText('7');
  await expect(page.locator('[data-accounting-summary-total]')).toContainText('300,03');
  await page.locator('#analysis-wizard button[value=complete]').click();await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  await expect(page.locator('#analysis-generate')).toBeEnabled();await page.locator('#analysis-generate').click();
  await expect(page.locator('#simulation-snapshot')).toBeVisible();const simulationId=new URL(page.url()).searchParams.get('simulation');
  const simulation=await api(page.request,baseURL!,'GET',`/api/v4/simulations/${simulationId}`);
  const payload=JSON.stringify(simulation);expect(payload).toContain('2025-01');expect(payload).toContain('2025-03');
  const stored=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}`)).analysis;
  expect(stored.readiness.months).toEqual(['2025-01','2025-03']);
  expect(stored.accounting.data.months.filter((row:any)=>row.salariesCents!==null).map((row:any)=>row.sourceMonth)).toEqual(['2025-01','2025-03']);
  await page.screenshot({path:info.outputPath('partial-consolidated-dre.png'),fullPage:true});expect(errors).toEqual([]);
});
