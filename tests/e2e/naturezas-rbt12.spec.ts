import {test,expect,type Page} from '@playwright/test';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';
import {mockStatement,documentId} from './extrato-helper.ts';
import {section22Year2025} from '../fixtures/section22.ts';

// Real CSV parsing, authenticated APIs, monthly calculation and Mongo persistence.
// Only Blob/OCR transport is mocked; its matching synthetic extraction is trusted server data.
function report(name:string,rows:{month:number;nature:string;value:number}[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const content=rows.map(item=>{
    const row=Array(28).fill('');row[0]='123.456.789-00';row[7]=`15/${String(item.month).padStart(2,'0')}/2025`;row[8]='Pessoa sintética';row[9]='SP';row[11]=item.nature;row[14]='Descrição informativa';row[15]='1';row[16]=item.value.toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...content].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

async function statement(page:Page,clientId:string,extractionId:string,result:any){
  await mockStatement(page,result.rbt12Cents,extractionId);
  await page.route('**/api/simples?*',r=>r.fulfill({json:{extractionId,documentId,clientId,originalStored:true,searchableStored:true,...result}}));
  await page.locator('#rbt12-pdf').setInputFiles({name:'extrato-23-meses-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
}

test('naturezas, devoluções, antecipação e RBT12 móvel atravessam importação, DRE e histórico real',async({page,browser,baseURL},info)=>{
  test.setTimeout(120_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin,errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  async function post(path:string,data:unknown){const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();}
  await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const catalog=await post('/api/v4/clients/import',{rows:[{code,name:'Empresa sintética naturezas '+code}]});
  const clientId=catalog.items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);await page.locator(`[data-select-company="${clientId}"]`).click();await page.locator('#generation-create').click();
  await expect(page).toHaveURL(/purchases\.html\?.*guided=1/);
  const purchases=[{month:1,nature:'1102001',value:3000},{month:1,nature:'8000002',value:200},{month:1,nature:'1202001',value:1000},{month:1,nature:'1949001',value:100},
    {month:2,nature:'2102001',value:4000},{month:2,nature:'8000102',value:300},{month:2,nature:'1202001',value:500},{month:2,nature:'1949001',value:100}];
  const sales=[{month:1,nature:'6108001',value:10000},{month:1,nature:'9000002',value:500},{month:1,nature:'6949001',value:900},
    {month:2,nature:'5102001',value:12000},{month:2,nature:'9000002',value:700},{month:2,nature:'5949001',value:600}];
  for(const [name,rows] of [['compras.csv',purchases],['vendas.csv',sales]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();await page.locator('#purchase-issuer-uf').selectOption('MG');
    await page.locator('#purchase-file').setInputFiles(report(name,[...rows]));await expect(page.locator('[data-guided-continue]')).toBeVisible();await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();
  const result=section22Year2025(),extractionId=randomUUID(),mongo=new MongoClient(process.env.MONGODB_URI!);
  try{await mongo.connect();await mongo.db(process.env.MONGODB_DB).collection('simplesExtractions').insertOne({_id:extractionId as any,clientId,workspaceId:process.env.WORKSPACE_ID||'maximum',parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result});}finally{await mongo.close();}
  await statement(page,clientId,extractionId,result);await expect(page.locator('#guided-rbt12-continue')).toBeEnabled();await page.locator('#guided-rbt12-continue').click();
  await expect(page.locator('label[for="rbt12"]')).toHaveText('RBT12 do PA 12/2025');await expect(page.locator('#rbt12')).toHaveValue('210000.00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('9000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('500.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('3200.00');
  await expect(page.locator('#month-context')).toContainText('78.000,00');
  await expect(page.locator('[data-difal-monthly]')).toContainText('1.000,00');await expect(page.locator('[data-anticipation-monthly]')).toContainText('234,24');
  await page.locator('#rbt12-schedule summary').click();await expect(page.locator('#rbt12-schedule tbody tr')).toHaveCount(2);await expect(page.locator('#rbt12-schedule')).toContainText('90.000,00');
  await page.locator('.sim-report-details>summary').click();await page.locator('.sim-operation-audit>summary').click();
  await expect(page.locator('.sim-operation-audit')).toContainText('21.700,00');await expect(page.locator('.sim-operation-audit')).toContainText('7.500,00');await expect(page.locator('.sim-operation-audit')).toContainText('1.500,00');
  await page.locator('.sim-report-details>summary').click();
  await page.locator('#report-competence').selectOption('1');await expect(page.locator('#salesCpfCents')).toHaveValue('11500.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('4300.00');await expect(page.locator('[data-anticipation-monthly]')).toContainText('314,76');await expect(page.locator('#month-context')).toContainText('90.000,00');
  await page.locator('#report-competence').selectOption('0');
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
  await page.locator('#generate-simulation').click();const response=await saving;expect(response.ok(),await response.text()).toBe(true);const saved=await response.json();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  expect(saved.rbt12Schedule.rows.map((row:any)=>row.rbt12Cents)).toEqual([7_800_000,9_000_000]);
  expect(saved.source.operationAudit).toMatchObject({salesReturnsCents:150_000,purchaseServicesCents:50_000,excludedSalesCents:150_000,excludedPurchaseCents:20_000});
  expect(saved.result.annualRevenue).toBe(21_700);
  expect(saved.result.monthlyResults.map((row:any)=>row.engineInput.rbt12)).toEqual([78_000,90_000]);
  expect(saved.result.regimes.filter((regime:any)=>['pure','hybrid'].includes(regime.id)).map((regime:any)=>regime.dre.icmsAnticipation)).toEqual([-549,-549]);
  expect(saved.result.regimes.filter((regime:any)=>['presumed','actual'].includes(regime.id)).map((regime:any)=>regime.dre.icmsAnticipation)).toEqual([0,0]);
  await page.locator('#dre-regime').selectOption('pure');await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('234,24');
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('314,76');
  await page.locator('#dre-regime').selectOption('actual');await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('0,00');
  await page.getByRole('button',{name:'Anual',exact:true}).click();await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('549,00');
  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},headers:{Origin:origin}});expect(login.ok()).toBe(true);
    const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));await reopened.goto(`/simulator.html?simulation=${saved._id}`);
    await expect(reopened.locator('#simulation-snapshot')).toBeVisible();await expect(reopened.locator('#simulator-form')).toHaveCount(0);await expect(reopened.locator('#rbt12-schedule')).toContainText('78.000,00');
    await reopened.locator('#dre-regime').selectOption('hybrid');await expect(reopened.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('234,24');
    const stored=await fresh.request.get(`/api/v4/simulations/${saved._id}`);expect(await stored.json()).toEqual(saved);
    for(const width of [1440,390]){await reopened.setViewportSize({width,height:1000});expect(await reopened.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await reopened.locator('#simulator-anticipation').screenshot({path:info.outputPath(`antecipacao-${width}.png`)});}
  }finally{await fresh.close();}
  // A shorter, valid PA window cannot silently replace earlier monthly RBT12s.
  let missingHistoryWrites=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v4/simulations')missingHistoryWrites++;});
  await statement(page,clientId,randomUUID(),{...result,priorRevenues:result.rbt12Window});await page.locator('#rbt12-read').click();
  await expect(page.locator('#rbt12-schedule')).toContainText('Histórico incompleto');await expect(page.locator('#rbt12-schedule')).toContainText('Faltam:');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulator-error')).toContainText('não cobre todas as janelas de RBT12');expect(missingHistoryWrites).toBe(0);
  expect(errors).toEqual([]);
});
