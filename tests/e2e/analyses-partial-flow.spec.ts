import {test as base,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';

type Fixture={clientId:string;code:string;userId:string};
const test=base.extend<{company:Fixture}>({company:async({page,baseURL},use)=>{
  expect(process.env.MONGODB_URI,'MongoDB descartável obrigatório').toBeTruthy();
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',userId=randomUUID();
  const email=`partial-${userId}@example.test`,password=`Synthetic-${randomUUID()}`,code=String(Number.parseInt(userId.replaceAll('-','').slice(0,11),16));
  try{
    await db.collection<any>('users').insertOne({_id:userId,workspaceId,email,passwordHash:await hashPassword(password),name:'Validação sintética parcial',role:'admin',active:true,mustChangePassword:false,createdAt:new Date()});
    await api(page.request,baseURL!,'POST','/api/auth/login',{email,password});
    const imported=await api(page.request,baseURL!,'POST','/api/v4/clients/import',{rows:[{code,name:'Empresa parcial '+code,uf:'MG'}]});
    await use({clientId:imported.items[0].id,code,userId});
  }finally{await db.collection<any>('sessions').deleteMany({workspaceId,userId});await db.collection<any>('users').deleteOne({_id:userId,workspaceId});await mongo.close();}
}});
async function api(request:APIRequestContext,baseURL:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}

test('Análises segue empresa, setor, regimes, RBT12 opcional, documentos e DIFAL sem decidir antes da leitura',async({page,baseURL,company},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/analyses.html');
  const wizard=page.locator('#analysis-wizard');await expect(wizard).toHaveAttribute('data-wizard-step','company');
  await expect(page.locator('input[name=sector]').first()).not.toBeVisible();
  await page.locator('#analysis-company-search').fill(company.code);await page.locator(`[data-analysis-client="${company.clientId}"]`).click();
  await expect(wizard).toHaveAttribute('data-wizard-step','sector');
  await page.locator('input[name=sector][value=fiscal]').check();await page.locator('#analysis-open-company').click();
  await expect(wizard).toHaveAttribute('data-wizard-kind','fiscal');await expect(wizard).toHaveAttribute('data-wizard-step','regimes');
  await page.locator('#analysis-fiscal-regime-presumed').uncheck();await page.locator('#analysis-fiscal-regime-actual').uncheck();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','rbt12');
  await expect(page.locator('#analysis-extrato-none')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#analysis-rbt12-pdf')).toHaveCount(0);
  await expect(page.locator('#analysis-difal-panel')).not.toBeVisible();
  await expect(page.locator('#analysis-sales-annex')).not.toBeVisible();
  await expect(page.locator('#analysis-fiscal-documents-view')).not.toBeVisible();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','documents');
  await page.locator('#analysis-wizard-back').click();await expect(wizard).toHaveAttribute('data-wizard-step','rbt12');
  await page.locator('#analysis-extrato-manual').click();await page.locator('#analysis-rbt12').fill('120000');await page.locator('#analysis-rbt12-confirm').check();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','documents');
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','cbs-ibs');
  await expect(page.locator('input[name=cbsIbsPercent][value="100"]')).toBeChecked();
  await expect(page.locator('section[data-wizard-step=cbs-ibs]')).toContainText('6,84%');
  await expect(page.locator('section[data-wizard-step=cbs-ibs]')).toContainText('4,56%');
  await page.locator('input[name=cbsIbsPercent][value="60"]').check();
  await page.locator('#analysis-wizard-next').click();await expect(wizard).toHaveAttribute('data-wizard-step','difal');
  const entry=page.locator('[data-difal-assessment="entry"]');
  await expect(entry).toHaveAttribute('data-difal-state','waiting');
  await expect(entry.locator('[data-difal-detected-amount]')).toHaveCount(0);
  for(const choice of ['yes','no']){
    await expect(page.locator('#analysis-difal-'+choice)).toBeDisabled();
    await expect(page.locator('#analysis-difal-'+choice)).not.toBeChecked();
  }
  for(const regime of ['pure','hybrid']){
    await expect(page.locator(`[data-analysis-difal="${regime}"] input[type=checkbox]`)).toHaveCount(1);
    await expect(page.locator(`[data-difal-include="${regime}"]`)).toBeDisabled();
  }
  await expect(page.locator('[data-analysis-difal-operation="exit"]')).toHaveCount(0);
  await expect(page.locator('[data-difal-assessment="exit"]')).toHaveAttribute('data-difal-state','waiting');
  await expect(page.locator('[data-difal-assessment="exit"] [data-difal-detected-amount]')).toHaveCount(0);
  await page.locator('#analysis-wizard button[value=save]').click();await expect(page.locator('#analysis-feedback')).toContainText('salvo');
  const id=new URL(page.url()).searchParams.get('id');const saved=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${id}?summary=1`)).analysis;
  expect(saved.config.regimeSelection.selected).toEqual(['pure','hybrid']);expect(saved.fiscal.data.rbt12).toBe(120000);expect(saved.fiscal.data.cbsIbsPercent).toBe(60);
  expect(saved.fiscal.data.difalChoice).toBeNull();
  expect(saved.fiscal.data.difalPolicy.operations).toEqual({pure:{entry:true,exit:false},hybrid:{entry:true,exit:false}});
  expect(saved.fiscal.data.generationId).toBeNull();
  await page.goto(`/analyses.html?id=${id}&sector=fiscal&step=cbs-ibs`);
  await expect(page.locator('input[name=cbsIbsPercent][value="60"]')).toBeChecked();
  await page.locator('#analysis-wizard-next').click();
  await expect(wizard).toHaveAttribute('data-wizard-step','difal');await expect(entry).toHaveAttribute('data-difal-state','waiting');
  await expect(page.locator('#analysis-difal-yes')).not.toBeChecked();await expect(page.locator('#analysis-difal-no')).not.toBeChecked();
  await expect(page.locator('#analysis-rbt12')).toHaveValue('120000.00');
  await page.setViewportSize({width:390,height:650});await page.screenshot({path:info.outputPath('fiscal-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Contábil aplica média a nove meses e gera somente as competências com documentos fiscais',async({page,baseURL,company},info)=>{
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
  await expect(page.locator('#analysis-new-source-year')).toHaveValue('2025');
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);
  analysis=(await api(page.request,baseURL!,'PATCH',`/api/v4/analyses/${analysis.id}/fiscal`,{expectedSectorRevision:analysis.fiscal.revision,expectedConfigRevision:analysis.config.revision,complete:true,data:{...analysis.fiscal.data,cbsIbsPercent:40}})).analysis;
  await page.goto(`/analyses.html?client=${company.clientId}&sector=accounting`);
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);await expect(page.locator('#analysis-new-source-year')).toHaveValue('2025');
  await page.locator('[data-accounting-average=salariesCents]').fill('100.01');
  for(const field of ['rentCents','cardExpensesCents','benefitsCents','adminExpensesCents','financialExpensesCents','financialIncomeCents'])await page.locator(`[data-accounting-average=${field}]`).fill('0');
  await expect(page.locator('[data-accounting-summary-months]')).toHaveText('9 meses');
  await expect(page.locator('[data-accounting-summary-total]')).toContainText('900,09');
  await page.locator('#analysis-wizard button[value=complete]').click();await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  await expect(page.locator('#analysis-generate')).toBeEnabled();await page.locator('#analysis-generate').click();
  await expect(page.locator('#simulation-snapshot')).toBeVisible();const simulationId=new URL(page.url()).searchParams.get('simulation');
  const simulation=await api(page.request,baseURL!,'GET',`/api/v4/simulations/${simulationId}`);
  expect(simulation.draft.cbsIbsPercent).toBe(40);
  expect(simulation.engineInput.months.every((row:any)=>row.input.rates.cbs===0.0452&&row.input.rates.ibs===0.0004)).toBe(true);
  await expect(page.locator('[data-dre-combined-rate]')).toContainText('4,56%');
  const payload=JSON.stringify(simulation);expect(payload).toContain('2025-01');expect(payload).toContain('2025-03');
  const stored=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${analysis.id}`)).analysis;
  expect(stored.readiness.months).toEqual(['2025-01','2025-02','2025-03']);
  expect(stored.accounting.data.months).toHaveLength(9);expect(stored.accounting.data.months.every((row:any)=>row.salariesCents===10001)).toBe(true);
  expect(simulation.monthlyInputs.map((row:any)=>row.values.salaries)).toEqual([100.01,100.01,100.01]);
  await page.goto(`/analyses.html?id=${analysis.id}&sector=fiscal&step=cbs-ibs`);
  await expect(page.locator('input[name=cbsIbsPercent][value="40"]')).toBeChecked();
  await page.locator('input[name=cbsIbsPercent][value="60"]').check();
  await page.locator('#analysis-wizard-next').click();
  await page.locator('#analysis-wizard button[value=complete]').click();
  await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  await expect(page.locator('#analysis-generate')).toBeEnabled();await page.locator('#analysis-generate').click();
  await expect(page.locator('#simulation-snapshot')).toBeVisible();
  const updatedId=new URL(page.url()).searchParams.get('simulation');expect(updatedId).not.toBe(simulationId);
  const updated=await api(page.request,baseURL!,'GET',`/api/v4/simulations/${updatedId}`);
  expect(updated.draft.cbsIbsPercent).toBe(60);
  expect(updated.engineInput.months.every((row:any)=>row.input.rates.cbs===0.0678&&row.input.rates.ibs===0.0006)).toBe(true);
  await expect(page.locator('[data-dre-combined-rate]')).toContainText('6,84%');
  const historical=await api(page.request,baseURL!,'GET',`/api/v4/simulations/${simulationId}`);
  expect(historical.draft.cbsIbsPercent).toBe(40);
  expect(historical.engineInput.months[0].input.rates.cbs).toBe(0.0452);
  await page.screenshot({path:info.outputPath('partial-consolidated-dre.png'),fullPage:true});expect(errors).toEqual([]);
});


test('Botões da empresa abrem Contábil vazio diretamente e Fiscal nos documentos sem repetir escolha de setor',async({page,baseURL,company})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const before=await api(page.request,baseURL!,'GET',`/api/v4/analyses?clientId=${company.clientId}&summary=1`);expect(before.items).toHaveLength(0);
  await page.goto(`/analyses.html?client=${company.clientId}&sector=accounting&entry=company`);
  const wizard=page.locator('#analysis-wizard');
  await expect(wizard).toHaveAttribute('data-wizard-kind','accounting');await expect(wizard).toHaveAttribute('data-wizard-step','values');
  await expect(page.locator('[data-accounting-month]')).toHaveCount(9);await expect(page.locator('#analysis-new-form')).toHaveCount(0);
  const id=new URL(page.url()).searchParams.get('id');expect(id).toBeTruthy();
  const saved=(await api(page.request,baseURL!,'GET',`/api/v4/analyses/${id}?summary=1`)).analysis;
  expect(saved.accounting.data.months).toEqual([]);expect(saved.config.regimeSelection.selected).toEqual(['pure','hybrid','presumed','actual']);
  await page.goto(`/analyses.html?client=${company.clientId}&sector=fiscal&entry=company`);
  await expect(wizard).toHaveAttribute('data-wizard-kind','fiscal');await expect(wizard).toHaveAttribute('data-wizard-step','documents');
  expect(new URL(page.url()).searchParams.get('id')).toBe(id);
  await expect(page.locator('[data-analysis-document=PURCHASES]')).toBeVisible();await expect(page.locator('[data-analysis-document=SALES]')).toBeVisible();
  const inlineRbt12=page.locator('.analysis-inline-rbt12');
  await expect(inlineRbt12).toBeVisible();
  await expect(inlineRbt12.getByRole('button',{name:'Adicionar RBT12 em PDF'})).toBeEnabled();
  await expect(inlineRbt12.locator('#analysis-inline-rbt12-pdf')).toHaveAttribute('accept','application/pdf,.pdf');
  await inlineRbt12.locator('[data-analysis-action=reference]').click();
  await expect(wizard).toHaveAttribute('data-wizard-step','rbt12');await expect(page.locator('#analysis-extrato-none')).toHaveAttribute('aria-pressed','true');
  const after=await api(page.request,baseURL!,'GET',`/api/v4/analyses?clientId=${company.clientId}&summary=1`);expect(after.items).toHaveLength(1);
  expect(after.items[0].revision).toBe(saved.revision);expect(errors).toEqual([]);
});


test('Acesso à empresa sem setor ou com permissão de consulta não cria uma análise',async({page,baseURL,company})=>{
  await page.goto(`/analyses.html?client=${company.clientId}`);
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind','new');
  const before=await api(page.request,baseURL!,'GET',`/api/v4/analyses?clientId=${company.clientId}&summary=1`);expect(before.items).toHaveLength(0);
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  try{
    await mongo.db(process.env.MONGODB_DB).collection<any>('users').updateOne({_id:company.userId},{$set:{role:'viewer'}});
    await page.goto(`/analyses.html?client=${company.clientId}&sector=accounting`);
    await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind','new');
    await expect(page.locator('#analysis-open-company')).toBeDisabled();
    const after=await api(page.request,baseURL!,'GET',`/api/v4/analyses?clientId=${company.clientId}&summary=1`);expect(after.items).toHaveLength(0);
  }finally{await mongo.close();}
});
