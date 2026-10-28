import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {csvParse} from '../../src/domain.ts';
import {hashPassword} from '../../src/security.ts';

// Real browser, authenticated endpoints and disposable MongoDB; CPF-only rows
// keep this regression independent of external CNPJ/OCR providers.
function report(name:string,rows:{month:number;nature:string;value:number}[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const content=rows.map(item=>{
    const row=Array(28).fill('');row[0]='123.456.789-00';row[7]=`15/${String(item.month).padStart(2,'0')}/2026`;row[8]='Pessoa sintética';row[9]='SP';row[11]=item.nature;row[14]='Operação sintética';row[15]='1';row[16]=item.value.toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...content].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

async function save(page:Page){
  expect(await page.locator('#simulator-form').evaluate(form=>(form as HTMLFormElement).checkValidity()),'Campos e confirmações obrigatórios preenchidos').toBe(true);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST',{timeout:15_000});
  await page.locator('#generate-simulation').click();const response=await saving;
  expect(response.ok(),await response.text()).toBe(true);
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  return response.json();
}

async function dreCsv(page:Page){
  const downloading=page.waitForEvent('download');await page.locator('#export-dre-csv').click();
  const stream=await (await downloading).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  return csvParse(Buffer.concat(chunks).toString('utf8'));
}

test('receita bruta menos devoluções concilia relatório, DRE salva e nova sessão sem duplicar a dedução',async({page,browser,baseURL},info)=>{
  test.setTimeout(120_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  // An isolated synthetic account keeps both real logins independent of the
  // shared CI administrator's per-account limit; authentication stays unchanged.
  const credentials={email:`revenue-returns-${randomUUID()}@example.test`,password:`Synthetic-receita-${randomUUID()}`};
  const setup=new MongoClient(process.env.MONGODB_URI!);
  try{
    await setup.connect();
    await setup.db(process.env.MONGODB_DB).collection<any>('users').insertOne({
      _id:randomUUID(),workspaceId:process.env.WORKSPACE_ID||'maximum',name:'Administrador sintético de receita',
      email:credentials.email,passwordHash:await hashPassword(credentials.password),role:'admin',
      active:true,mustChangePassword:false,createdAt:new Date()
    });
  }finally{await setup.close();}
  async function post(path:string,data:unknown){
    const response=await page.request.post(path,{data,headers:{Origin:origin}});
    expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
  }
  await post('/api/auth/login',credentials);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const imported=await post('/api/v4/clients/import',{rows:[{code,name:`Empresa sintética devoluções ${code}`,uf:'MG'}]});
  const clientId=imported.items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);
  await page.locator(`[data-select-company="${clientId}"]`).click();
  for(const id of ['pure','hybrid'])await page.locator(`#generation-difal-${id}`).uncheck();
  await page.locator('#generation-create').click();
  const purchases=[{month:1,nature:'1949001',value:0},{month:8,nature:'2102001',value:400},{month:8,nature:'1202001',value:150},{month:9,nature:'2102001',value:500},{month:9,nature:'1202001',value:250}];
  const sales=[{month:1,nature:'5949001',value:0},{month:8,nature:'6102001',value:1000},{month:8,nature:'9000002',value:200},{month:8,nature:'6202001',value:100},{month:8,nature:'5901001',value:50},{month:9,nature:'6102001',value:800},{month:9,nature:'9000002',value:200}];
  for(const [name,rows] of [['compras.csv',purchases],['vendas.csv',sales]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();
    await expect(page.locator('#purchase-issuer-uf')).toHaveValue('MG');
    await page.locator('#purchase-file').setInputFiles(report(name,[...rows]));
    await expect(page.locator('[data-guided-continue]')).toBeVisible();
    await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();await page.locator('#guided-rbt12-skip').click();
  await page.locator('#rbt12').fill('100000');await page.locator('#rbt12-manual-confirm').check();
  await page.locator('#report-competence').selectOption('7');
  await expect(page.locator('#salesCpfCents')).toHaveValue('850.00');
  await expect(page.locator('#serviceRevenue')).toHaveValue('200.00');
  const saved=await save(page);
  expect(saved.source.operationAudit).toMatchObject({grossSalesCents:180_000,serviceSalesCents:40_000,salesReturnsCents:40_000,excludedSalesCents:15_000});
  expect(saved.result.annualRevenue).toBe(1800);
  expect(saved.result.regimes.map((regime:any)=>regime.dre.revenue)).toEqual([1800,1800,1800,1800]);
  expect(saved.reportMonths).toBe(9);expect(saved.analysisPeriod.version).toBe('JAN_SEP_V1');
  expect(saved.result.monthlyResults.map((month:any)=>month.result.regimes[0].dre.revenue)).toEqual([...Array(7).fill(0),1050,750]);
  expect(saved.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([0,0,0,0]);
  await page.locator('[data-period="annual"]').click();
  await page.locator('[data-simulation-detail="dre"] > summary').click();
  await expect(page.locator('[data-simulation-lazy="dre"]')).toHaveAttribute('data-loaded','true');
  await expect(page.locator('.sim-dre').getByRole('heading',{name:'Fechamento da receita',exact:true})).toBeVisible();
  const closing=page.locator('[data-revenue-reconciliation="dre"]');
  for(const [key,value] of [['revenueSourceGross','2.200,00'],['revenueSalesReturns','400,00'],['revenueAfterReturns','1.800,00'],['revenueManualAdjustment','0,00'],['revenueUsed','1.800,00']]){
    await expect(closing.locator(`[data-dre-row="${key}"] td`).first()).toContainText(value);
  }
  await expect(closing.locator('[data-dre-row="revenueSalesReturns"] td').first()).toContainText('-');
  await expect(page.locator('[data-dre-row="revenue"] th')).toContainText('utilizada');
  const rows=await dreCsv(page);
  expect(rows.filter(row=>row.some(value=>/Receita bruta de vendas e serviços/i.test(value))).some(row=>row.includes('2200,00'))).toBe(true);
  expect(rows.filter(row=>row.some(value=>/Devoluções de venda/i.test(value))).some(row=>row.includes('-400,00'))).toBe(true);
  expect(rows.filter(row=>row.some(value=>/Receita após devoluções/i.test(value))).some(row=>row.includes('1800,00'))).toBe(true);
  for(const width of [1280,320]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(width===320){
      await expect(closing.locator('[data-revenue-mobile]')).toBeVisible();
      await expect(closing.locator('[data-revenue-mobile-row="revenueSourceGross"] [data-revenue-mobile-value]')).toContainText('2.200,00');
      await expect(closing.locator('[data-revenue-mobile-row="revenueSalesReturns"] [data-revenue-mobile-value]')).toContainText('400,00');
      await expect(closing.locator('[data-revenue-mobile-row="revenueUsed"] [data-revenue-mobile-value]')).toContainText('1.800,00');
    }
    await closing.screenshot({path:info.outputPath(`fechamento-receita-${width}.png`)});
  }
  await page.setViewportSize({width:1280,height:900});
  const jobId=saved.source.sales.jobId;
  const summary=await (await page.request.get(`/api/v4/sales/${jobId}/summary`)).json();
  expect(summary.revenueReconciliation).toMatchObject({version:'REVENUE_RECONCILIATION_V1',status:'AVAILABLE',available:true,grossRevenueCents:220_000,salesReturnsCents:40_000,revenueAfterReturnsCents:180_000});
  expect(summary.totals.totalCents).toBe(215_000); // Original file balance remains distinct.
  const exported=await post(`/api/v4/sales/${jobId}/revenue-csv`,{});
  expect(exported.content).toMatch(/Receita bruta/i);expect(exported.content).toContain('2200,00');
  expect(exported.content).toContain('400,00');expect(exported.content).toContain('1800,00');
  expect(csvParse(exported.content).find(row=>row[0]==='(-) Devoluções de venda no relatório de compras')?.[1]).toBe('-400,00');
  const mongo=new MongoClient(process.env.MONGODB_URI!);
  let originalInputs:any[];
  try{
    await mongo.connect();const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    originalInputs=await db.collection('lookupJobs').find({workspaceId,_id:{$in:[saved.source.purchases.jobId,jobId]}} as any).project({_id:1,purchaseInput:1}).sort({_id:1}).toArray();
    expect(originalInputs).toHaveLength(2);
    const stored=await db.collection<any>('simulations').findOne({_id:saved._id,workspaceId});
    expect(stored?.result.annualRevenue).toBe(1800);
  }finally{await mongo.close();}
  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:credentials,headers:{Origin:origin}});expect(login.ok()).toBe(true);
    const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));
    await reopened.goto(`/simulator.html?simulation=${saved._id}`);
    await expect(reopened.locator('#simulation-snapshot')).toBeVisible();
    await expect(reopened.locator('[data-period="annual"]')).toHaveAttribute('aria-pressed','true');
    await reopened.locator('[data-period="monthly"]').click();
    await reopened.locator('#dre-month').selectOption('7');
    await reopened.locator('[data-simulation-detail="dre"] > summary').click();
    await reopened.locator('#dre-regime').selectOption('pure');
    const savedClosing=reopened.locator('[data-revenue-reconciliation="dre"]');
    await expect(savedClosing.locator('[data-dre-row="revenueSourceGross"] td').first()).toContainText('1.200,00');
    await expect(savedClosing.locator('[data-dre-row="revenueSalesReturns"] td').first()).toContainText('150,00');
    await expect(savedClosing.locator('[data-dre-row="revenueUsed"] td').first()).toContainText('1.050,00');
    await reopened.locator('#dre-month').selectOption('8');
    await expect(savedClosing.locator('[data-dre-row="revenueSourceGross"] td').first()).toContainText('1.000,00');
    await expect(savedClosing.locator('[data-dre-row="revenueSalesReturns"] td').first()).toContainText('250,00');
    await expect(savedClosing.locator('[data-dre-row="revenueUsed"] td').first()).toContainText('750,00');
    expect(await (await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    await reopened.locator('#create-version').click();
    await expect(reopened.locator('#simulator-form')).toBeVisible();
    await reopened.locator('#report-competence').selectOption('7');
    await expect(reopened.locator('label[for="salesCpfCents"]')).toContainText('após devoluções');
    await reopened.locator('#salesCpfCents').fill('950');
    const editorClosing=reopened.locator('#simulator-revenue-reconciliation');
    await expect(editorClosing.locator('[data-revenue-value="manualAdjustmentCents"]')).toContainText('100,00');
    await expect(editorClosing.locator('[data-revenue-value="usedRevenueCents"]')).toContainText('1.150,00');
    await expect(reopened.locator('#rbt12')).toHaveValue('100000.00');
    await reopened.locator('#rbt12-manual-confirm').check();
    const child=await save(reopened);
    expect(child.parentSimulationId).toBe(saved._id);expect(child.result.annualRevenue).toBe(1900);
    expect(child.source.operationAudit).toEqual(saved.source.operationAudit);
    expect(child.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([0,0,0,0]);
    expect(await (await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    await reopened.goto(`/purchases.html?type=SALES&client=${clientId}&job=${jobId}`);
    const reportClosing=reopened.locator('#purchase-report-view [data-revenue-reconciliation]');
    await reportClosing.scrollIntoViewIfNeeded();
    await expect(reportClosing.locator('[data-revenue-value="grossRevenueCents"]')).toContainText('2.200,00');
    await expect(reportClosing.locator('[data-revenue-value="salesReturnsCents"]')).toContainText('400,00');
    await expect(reportClosing.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('1.800,00');
    await reportClosing.screenshot({path:info.outputPath('fechamento-relatorio-real.png')});
  }finally{await fresh.close();}
  const audit=new MongoClient(process.env.MONGODB_URI!);
  try{
    await audit.connect();const workspaceId=process.env.WORKSPACE_ID||'maximum';
    const current=await audit.db(process.env.MONGODB_DB).collection('lookupJobs').find({workspaceId,_id:{$in:[saved.source.purchases.jobId,jobId]}} as any).project({_id:1,purchaseInput:1}).sort({_id:1}).toArray();
    expect(current).toEqual(originalInputs!);
  }finally{await audit.close();}
  expect(errors).toEqual([]);
});
