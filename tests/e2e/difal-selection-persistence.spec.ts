import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {csvParse} from '../../src/domain.ts';

// Real UI, authenticated API and disposable MongoDB: no intercepted requests.
// CPF-only reports avoid contacting any external company lookup provider.
function report(name:string,nature:string,cents:number){
  const header=Array(28).fill(''),row=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  row[0]='123.456.789-00';row[7]='15/08/2026';row[8]='Pessoa sintética';row[9]='SP';row[11]=nature;row[14]='Operação sintética';row[15]='1';row[16]=(cents/100).toFixed(2).replace('.',',');
  for(const column of [24,25,26,27])row[column]='0,00';
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,row].map(value=>value.join(';')).join('\r\n'),'latin1')};
}

test('saída desmarcada na empresa permanece excluída após importação, CSV, salvamento e nova sessão reais',async({page,browser,baseURL},info)=>{
  test.setTimeout(120_000);
  expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function post(path:string,data:unknown){
    const response=await page.request.post(path,{data,headers:{Origin:origin}});
    expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
  }
  await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const imported=await post('/api/v4/clients/import',{rows:[{code,name:`Empresa sintética saída excluída ${code}`,uf:'MG'}]});
  const clientId=imported.items[0].id;
  const policy={version:'DIFAL_SCENARIOS_V2',enabled:{pure:true,hybrid:true,presumed:false,actual:false},operations:{pure:{entry:true,exit:false},hybrid:{entry:true,exit:false}}};
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);
  await page.locator(`[data-select-company="${clientId}"]`).click();
  for(const id of ['pure','hybrid'])await page.locator(`#generation-difal-exit-${id}`).uncheck();
  const creating=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/generations'&&response.request().method()==='POST');
  await page.locator('#generation-create').click();const created=await creating;
  expect(created.ok()).toBe(true);expect(created.request().postDataJSON().companyDifalPolicies).toEqual([{clientId,difalPolicy:policy}]);
  const generationId=created.request().postDataJSON().generationId;
  for(const [kind,nature,cents] of [['purchases','1102',50_000],['sales','5102',15_000]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();
    await expect(page.locator('#purchase-issuer-uf')).toHaveValue('MG');
    await page.locator('#purchase-file').setInputFiles(report(`${code}-${kind}.csv`,nature,cents));
    await expect(page.locator('.purchase-guided-summary')).toBeVisible();
    if(kind==='purchases')await expect(page.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('36,60');
    else{
      await expect(page.locator('#purchase-report-view .purchase-difal')).toHaveAttribute('data-tax-selection','disabled');
      await expect(page.locator('#purchase-report-view [data-difal-amount]')).toContainText('0,00');
      await expect(page.locator('#purchase-report-view .purchase-difal')).toContainText('não incluído');
      await page.locator('#purchase-report-view .purchase-difal').screenshot({path:info.outputPath('saida-excluida-relatorio-real.png')});
    }
    await expect(page.locator('[data-guided-continue]')).toBeVisible();await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();await page.locator('#guided-rbt12-skip').click();
  await page.locator('#rbt12').fill('100000');await page.locator('#rbt12-manual-confirm').check();
  await expect(page.locator('#month-summary-difal')).toContainText('0,00');
  await expect(page.locator('[data-difal-monthly]')).toContainText('0,00');
  await expect(page.locator('[data-anticipation-monthly]')).toContainText('36,60');
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
  await page.locator('#generate-simulation').click();const response=await saving;
  expect(response.ok(),await response.text()).toBe(true);const saved=await response.json();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  expect(saved.draft.difalPolicy).toEqual(policy);expect(saved.source.difalPolicy).toEqual(policy);
  expect(saved.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([0,0,0,0]);
  expect(saved.result.regimes.map((regime:any)=>Math.round(regime.dre.icmsAnticipation*100))).toEqual([-3660,-3660,0,0]);
  const jobId=saved.source.sales.jobId;
  const summary=await (await page.request.get(`/api/v4/sales/${jobId}/summary`)).json();
  expect(summary.difalPolicy).toEqual(policy);expect(summary.difal.amountCents).toBe(1500);
  const exported=await post(`/api/v4/sales/${jobId}/csv`,{status:'ALL',part:1}),csv=csvParse(exported.content);
  expect(csv[0]).toContain('DIFAL estimado (R$)');
  expect(csv[1][csv[0].indexOf('DIFAL estimado (R$)')]).toBe('0,00');
  expect(csv[1][csv[0].indexOf('Situação DIFAL')]).toContain('Não incluído por escolha');
  const mongo=new MongoClient(process.env.MONGODB_URI!);
  try{
    await mongo.connect();const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const stored=await db.collection<any>('generations').findOne({_id:generationId,workspaceId});
    expect(stored?.companies.find((company:any)=>company.clientId===clientId).difalPolicy).toEqual(policy);
    const original=await db.collection<any>('lookupJobs').findOne({_id:jobId,workspaceId});
    expect(original?.purchaseInput.difal.amountCents).toBe(1500);
  }finally{await mongo.close();}
  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},headers:{Origin:origin}});expect(login.ok()).toBe(true);
    const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));
    await reopened.goto(`/simulator.html?simulation=${saved._id}`);
    await expect(reopened.locator('[data-difal-monthly]')).toContainText('0,00');
    await reopened.locator('#dre-regime').selectOption('pure');
    await expect(reopened.locator('[data-dre-row="difal"] td').first()).toContainText('0,00');
    await expect(reopened.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('36,60');
    expect(await (await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    await reopened.goto(`/purchases.html?type=SALES&client=${clientId}&job=${jobId}`);
    await expect(reopened.locator('[data-difal-amount]')).toContainText('0,00');
    await expect(reopened.locator('.purchase-difal')).toContainText('não incluído');
  }finally{await fresh.close();}
  expect(errors).toEqual([]);
});
