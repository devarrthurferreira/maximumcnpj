import {test as base,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import {csvParse} from '../../src/domain.ts';
import {hashPassword} from '../../src/security.ts';
import {JAN_SEP_MODEL_VERSION} from '../../public/analysis-period.js';

// Real browser, authenticated API and disposable MongoDB. No routes are mocked;
// CPF-only source documents cannot trigger an external CNPJ lookup.
const test=base.extend<{icmsAccount:{email:string;password:string;db:Db;workspaceId:string}}>({
  icmsAccount:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',userId=randomUUID();
    const account={email:`icms-credits-${userId}@example.test`,password:`Synthetic-icms-${randomUUID()}`};
    try{
      await db.collection<any>('users').insertOne({_id:userId,workspaceId,email:account.email,name:'Administrador sintético ICMS',role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      await use({...account,db,workspaceId});
    }finally{
      try{
        await db.collection('sessions').deleteMany({workspaceId,userId});
        await db.collection<any>('users').deleteOne({_id:userId,workspaceId});
      }finally{await mongo.close();}
    }
  }
});

type SourceRow={nature:string;uf:'MG'|'SP';cents:number;name:string};
function report(name:string,source:SourceRow[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const rows=source.map(item=>{
    const row=Array(28).fill('');
    row[0]='123.456.789-00';row[7]='15/01/2025';row[8]=item.name;row[9]=item.uf;row[11]=item.nature;row[14]='Operação sintética de ICMS';row[15]='1';row[16]=(item.cents/100).toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';
    return row;
  });
  // Both source documents explicitly cover all nine months. January carries
  // the independent tax example; the remaining competencies report zero.
  for(let month=2;month<=9;month++){
    const row=[...rows[0]];row[7]=`15/${String(month).padStart(2,'0')}/2025`;
    row[8]='Pessoa sintética sem movimento';row[14]='Competência declarada sem movimento';row[16]='0,00';rows.push(row);
  }
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...rows].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

const creditRows=[
  ['icms.debit','Débito de ICMS','420,00'],
  ['icms.potential','Crédito potencial de ICMS','156,00'],
  ['icms.purchaseCredit','Crédito de ICMS das compras elegíveis','114,00'],
  ['icms.returnCredit','Crédito de ICMS das devoluções de venda','42,00'],
  ['icms.used','Crédito utilizado de ICMS','156,00'],
  ['icms.due','Valor líquido a recolher de ICMS','264,00'],
  ['icms.balance','Saldo credor potencial de ICMS','0,00']
] as const;

async function openCompleteDre(page:Page){
  const detail=page.locator('[data-simulation-detail="dre"]');
  if(await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
  await expect(detail.locator('[data-simulation-lazy="dre"]')).toHaveAttribute('data-loaded','true');
}
async function assertAnnual(page:Page){
  await expect(page.locator('#dre-demonstrativo [data-period="annual"]')).toHaveAttribute('aria-pressed','true');
  await openCompleteDre(page);
  await page.locator('#dre-regime').selectOption('presumed');
  const main=page.locator('#dre-demonstrativo [data-simulation-lazy="dre"] > .dre-table-wrap');
  const footer=page.locator('#dre-demonstrativo [data-icms-reconciliation="dre"]');
  await expect(footer).toHaveCount(1);
  await expect(footer.locator('[data-dre-row]')).toHaveCount(creditRows.length);
  // Informational credits belong after the revenue closing, never in deductions.
  await expect(main.locator('[data-dre-row^="icms."]')).toHaveCount(0);
  await expect(main.locator('[data-dre-row="icmsNet"]')).toHaveCount(1);
  await expect(main.locator('[data-dre-row="icmsNet"] td').nth(2)).toHaveText('-R$ 264,00');
  await expect(main.locator('[data-dre-row="revenue"] td').nth(2)).toHaveText('R$ 2.700,00');
  await expect(main.locator('[data-dre-row="cmv"] td').nth(2)).toHaveText('-R$ 1.400,00');
  for(const [key,,amount] of creditRows){
    const cells=footer.locator(`[data-dre-row="${key}"] td`);
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(2)).toHaveText(`R$ ${amount}`);
    await expect(cells.first()).toHaveText('—');
    await expect(cells.first().locator('.dre-amount')).toHaveAttribute('title',/Incluído no DAS/);
  }
  expect(await page.locator('#dre-demonstrativo').evaluate(element=>{
    const revenue=element.querySelector('[data-revenue-reconciliation="dre"]'),icms=element.querySelector('[data-icms-reconciliation="dre"]');
    return !!(revenue&&icms&&(revenue.compareDocumentPosition(icms)&Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await expect(footer).toContainText('já está abatido');
  await expect(footer).toContainText('não acrescenta uma segunda dedução');
}

async function assertMonthly(page:Page){
  await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await openCompleteDre(page);
  await page.getByRole('button',{name:'9 meses',exact:true}).click();
  await page.locator('#dre-regime').selectOption('presumed');
  const footer=page.locator('#dre-demonstrativo [data-icms-reconciliation="dre"]');
  for(const [key,,amount] of creditRows){
    const cells=footer.locator(`[data-dre-row="${key}"] td`);
    await expect(cells).toHaveCount(10);
    await expect(cells.first()).toHaveText(`R$ ${amount}`);
    await expect(cells.nth(1)).toHaveText('R$ 0,00');
    await expect(cells.last()).toHaveText(`R$ ${amount}`);
  }
  const revenue=page.locator('#dre-demonstrativo [data-simulation-lazy="dre"] > .dre-table-wrap [data-dre-row="revenue"] td');
  await expect(revenue.first()).toHaveText('R$ 2.700,00');
  await expect(revenue.nth(1)).toHaveText('R$ 0,00');
  await expect(revenue.last()).toHaveText('R$ 2.700,00');
  await page.locator('#dre-regime').selectOption('pure');
  await expect(footer.locator('[data-dre-row="icms.potential"] td').first()).toHaveText('—');
  await expect(page.locator('#dre-demonstrativo [data-dre-row="icmsAnticipation"] td').first()).toHaveText('-R$ 36,60');
  await page.locator('#dre-regime').selectOption('presumed');
}

test('créditos por UF e devoluções conciliam uma vez no navegador, MongoDB, histórico, CSV e PDF completos',async({page,browser,baseURL,icmsAccount},info)=>{
  test.setTimeout(150_000);page.setDefaultTimeout(15_000);
  const {db,workspaceId,email,password}=icmsAccount,credentials={email,password};
  const origin=new URL(baseURL!).origin,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const post=async(path:string,data:unknown)=>{
    const response=await page.request.post(path,{data,headers:{Origin:origin}});
    expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
  };
  await post('/api/auth/login',credentials);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const clientId=(await post('/api/v4/clients/import',{rows:[{code,name:`Empresa sintética crédito ICMS ${code}`,uf:'MG'}]})).items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);
  await page.locator(`[data-select-company="${clientId}"]`).click();
  // Entry remains selected in the two Simples scenarios. Sales DIFAL is excluded.
  for(const id of ['pure','hybrid'])await page.locator(`#generation-difal-exit-${id}`).uncheck();
  const creating=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/generations'&&response.request().method()==='POST');
  await page.locator('#generation-create').click();expect((await creating).ok()).toBe(true);
  const purchases:SourceRow[]=[
    {nature:'1102001',uf:'MG',cents:30_000,name:'Compra sintética interna'},
    {nature:'2102001',uf:'SP',cents:50_000,name:'Compra sintética interestadual'},
    {nature:'8000002',uf:'MG',cents:20_000,name:'Serviço sintético interno 8000'},
    {nature:'8000102',uf:'SP',cents:40_000,name:'Serviço sintético interestadual 8000'},
    {nature:'1202001',uf:'MG',cents:10_000,name:'Devolução sintética interna'},
    {nature:'2202001',uf:'SP',cents:20_000,name:'Devolução sintética interestadual'}
  ];
  const sales:SourceRow[]=[
    {nature:'5102001',uf:'MG',cents:100_000,name:'Venda sintética interna'},
    {nature:'6102001',uf:'SP',cents:200_000,name:'Venda sintética interestadual'}
  ];
  for(const [kind,rows] of [['purchases',purchases],['sales',sales]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();
    await expect(page.locator('#purchase-issuer-uf')).toHaveValue('MG');
    await page.locator('#purchase-file').setInputFiles(report(`${code}-${kind}.csv`,rows));
    await expect(page.locator('.purchase-guided-summary')).toBeVisible();
    if(kind==='purchases'){
      await expect(page.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('36,60');
      await expect(page.locator('#purchase-report-view [data-purchase-considered-total]')).toContainText('1.400,00');
    }else await expect(page.locator('#purchase-report-view [data-difal-amount]')).toContainText('0,00');
    await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();await page.locator('#guided-rbt12-skip').click();
  await expect(page.locator('#simulator-form')).toBeVisible();
  await page.locator('#rbt12').fill('100000');await page.locator('#rbt12-manual-confirm').check();
  await expect(page.locator('#icms-outside')).toHaveValue('inside');
  await expect(page.locator('#salesCpfCents')).toHaveValue('2700.00');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('1400.00');
  for(const field of ['salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator(`#${field}`).fill('0');
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
  await page.locator('#generate-simulation').click();const response=await saving;
  expect(response.ok(),await response.text()).toBe(true);
  const request=response.request().postDataJSON(),saved=await response.json();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');

  // Independent arithmetic: 1,000×18% + 2,000×12% = 420; eligible purchases
  // 300×18% + 500×12% = 114; returns 100×18% + 200×12% = 42; due = 264.
  expect(saved.modelVersion).toBe(JAN_SEP_MODEL_VERSION);
  expect(saved.analysisPeriod).toMatchObject({version:'JAN_SEP_V1',months:9,complete:true});
  expect(saved.monthlyDre.version).toBe('DRE_CALENDAR_V4');
  expect(saved.result.method).toBe('REPORT_MONTHS_V1');expect(saved.result.annualRevenue).toBe(2700);
  expect(saved.engineInput.months.every((month:any)=>month.input.rates.cbs===.113&&month.input.credits.regular.cbsRate===.113&&month.input.credits.simple.cbsRate===.015)).toBe(true);
  // CBS uses the requested scenario rate independently of the unchanged ICMS rules above.
  expect(saved.result.credits.cbs.debit).toBeCloseTo(305.1,8); // 2.700 × 11,3%
  expect(saved.result.credits.cbs.used).toBeCloseTo(158.2,8); // 1.400 × 11,3%
  expect(saved.result.credits.cbs.due).toBeCloseTo(146.9,8);
  expect(saved.source.monthlyReports).toHaveLength(9);expect(saved.result.monthlyResults).toHaveLength(9);
  expect(saved.source.fields).toMatchObject({salesCpfCents:270_000,salesOptantCents:0,salesNonOptantCents:0,purchasesOptantCents:0,purchasesNonOptantCents:140_000,serviceRevenueCents:0});
  expect(saved.source.operationAudit).toMatchObject({grossSalesCents:300_000,salesReturnsCents:30_000,purchaseGoodsCents:80_000,purchaseServicesCents:60_000});
  const operations=saved.source.monthlyReports[0].icmsOperations;
  expect(operations).toMatchObject({version:'ICMS_OPERATIONS_V1',sourceMonth:'2025-01',issuerUf:'MG',purchaseIssuerUf:'MG',internalRatePercent:18,interstateRatePercent:12,excludedServicePurchasesCents:60_000,excludedSimplePurchasesCents:0,sourceRegularPurchasesCents:140_000});
  for(const [group,internal,interstate,tax] of [['sales',100_000,200_000,42_000],['purchases',30_000,50_000,11_400],['salesReturns',10_000,20_000,4200]] as const){
    expect(operations[group]).toMatchObject({internalBaseCents:internal,interstateBaseCents:interstate,totalBaseCents:internal+interstate,taxCents:tax,eligibleLines:2,pendingLines:0,pendingBaseCents:0});
  }
  expect(saved.source.monthlyReports[0].anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V4',ratePercent:7.32,baseCents:50_000,amountCents:3660,eligibleLines:1,pendingLines:0});
  expect(saved.result.credits.icms).toEqual({debit:420,potential:156,used:156,due:264,balance:0});
  expect(saved.result.monthlyResults[0].result.credits.icms).toEqual(saved.result.credits.icms);
  for(const [id,value] of [['icms.purchaseCredit',114],['icms.returnCredit',42],['icms.excludedServices',600]] as const){
    expect(saved.result.memory.find((entry:any)=>entry.id===id)).toMatchObject({unit:'currency',value});
  }
  const presumed=saved.result.regimes.find((regime:any)=>regime.id==='presumed'),pure=saved.result.regimes.find((regime:any)=>regime.id==='pure');
  expect(presumed.available).toBe(true);expect(pure.available).toBe(true);
  expect(presumed.dre).toMatchObject({revenue:2700,cmv:-1400,icmsNet:-264,icmsUsed:156,icmsBalance:0,difal:0,icmsAnticipation:0});
  expect(pure.dre).toMatchObject({revenue:2700,cmv:-1400,icmsNet:0,icmsUsed:0,icmsBalance:0,difal:0,icmsAnticipation:-36.6});
  expect(presumed.dre.revenue+presumed.dre.cmv+presumed.dre.icmsNet).toBe(1036);
  const otherTaxes=presumed.dre.das+presumed.dre.cbsDebit+presumed.dre.ibsDebit+presumed.dre.iss+presumed.dre.cbsUsed+presumed.dre.ibsUsed+presumed.dre.irpj+presumed.dre.csll;
  expect(presumed.dre.netProfit).toBeCloseTo(1036+otherTaxes,8);
  expect(presumed.dre.netProfit).not.toBeCloseTo(1036+otherTaxes+156,2);
  expect(saved.result.monthlyResults[0].result.regimes.find((regime:any)=>regime.id==='presumed').dre).toEqual(presumed.dre);

  const jobIds=[saved.source.purchases.jobId,saved.source.sales.jobId],sourceFilter={workspaceId,jobId:{$in:jobIds}};
  const frozen=async()=>({jobs:await db.collection<any>('lookupJobs').find({_id:{$in:jobIds},workspaceId}).sort({_id:1}).toArray(),rows:await db.collection<any>('purchaseLines').find(sourceFilter).sort({jobId:1,index:1}).toArray(),lookups:await db.collection('lookupItems').find(sourceFilter).sort({jobId:1,cnpj:1}).toArray()});
  const original=await frozen();
  expect(original.rows).toHaveLength(24);expect(original.lookups).toHaveLength(0);
  expect(original.rows.every(row=>row.documentKind==='CPF'&&!row.valid)).toBe(true);
  const services=original.rows.filter(row=>String(row.natureCode).startsWith('8000'));
  expect(services.map(row=>row.totalCents).sort((a,b)=>a-b)).toEqual([20_000,40_000]);
  for(const row of services)expect(row.anticipation).toEqual({eligible:false,baseCents:0,amountCents:0,reason:'SERVICE_PURCHASE_EXCLUDED'});
  const stored=await db.collection<any>('simulations').findOne({_id:saved._id,workspaceId});
  // MongoDB keeps completion dates as Date; the HTTP response serializes them as ISO strings.
  expect(stored?.source.purchases.completedAt).toBeInstanceOf(Date);
  expect(stored?.source.sales.completedAt).toBeInstanceOf(Date);
  expect(JSON.parse(JSON.stringify(stored?.source))).toEqual(saved.source);
  expect(stored?.result).toEqual(saved.result);expect(stored?.draft).toEqual(saved.draft);

  // The client submits values, never an authoritative tax composition. Reject it
  // at every plausible request level and leave both sources and snapshot intact.
  const forgedIds:string[]=[];
  for(const location of ['request','draft','monthlyInputs'] as const){
    const forged=structuredClone(request);forged.simulationId=randomUUID();forgedIds.push(forged.simulationId);
    if(location==='request')forged.icmsOperations=operations;
    else if(location==='draft')forged.draft.icmsOperations=operations;
    else forged.monthlyInputs[0].icmsOperations=operations;
    const rejected=await page.request.post('/api/v4/simulations',{data:forged,headers:{Origin:origin}});
    expect(rejected.status(),`${location}: ${await rejected.text()}`).toBe(400);
    expect((await rejected.json()).error).toBe('VALIDATION');
  }
  expect(await db.collection<any>('simulations').countDocuments({_id:{$in:forgedIds},workspaceId})).toBe(0);

  await assertAnnual(page);await assertMonthly(page);
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();
  await page.setViewportSize({width:390,height:960});
  await expect(page.locator('#dre-demonstrativo [data-icms-mobile-row="icms.potential"] [data-icms-mobile-value]')).toHaveText('R$ 156,00');
  await expect(page.locator('#dre-demonstrativo [data-icms-mobile-row="icms.potential"] [data-icms-mobile-annual]')).toContainText('156,00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#dre-demonstrativo [data-icms-reconciliation="dre"]').screenshot({path:info.outputPath('credito-icms-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});

  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:credentials,headers:{Origin:origin}});expect(login.ok(),await login.text()).toBe(true);
    const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));
    await reopened.goto(`/simulator.html?simulation=${saved._id}`);
    await expect(reopened.locator('#simulation-snapshot')).toBeVisible();await expect(reopened.locator('#simulator-form')).toHaveCount(0);
    const retrieved=await fresh.request.get(`/api/v4/simulations/${saved._id}`);expect(retrieved.ok()).toBe(true);expect(await retrieved.json()).toEqual(saved);
    await assertAnnual(reopened);await assertMonthly(reopened);
    await reopened.locator('#dre-report-period').selectOption('complete');
    await expect(reopened.locator('#dre-show-percent')).not.toBeChecked();
    const downloading=reopened.waitForEvent('download');await reopened.locator('#export-dre-csv').click();
    const download=await downloading,stream=await download.createReadStream();let csv='';
    for await(const chunk of stream!)csv+=chunk;
    expect(download.suggestedFilename()).toContain('completo');
    const csvRows=csvParse(csv,';'),scope='Apuração do crédito de ICMS';
    expect(csvRows.filter(row=>row[0]===scope)).toHaveLength(7);
    expect(csvRows.filter(row=>row[1]===scope&&['Simples Puro','Simples Híbrido','Lucro Presumido','Lucro Real'].includes(row[0]))).toHaveLength(28);
    for(const [,label,amount] of creditRows){
      const annual=csvRows.find(row=>row[0]===scope&&row[2]===label)!;
      expect(annual,label).toBeDefined();expect(annual[5]).toBe('Não disponível');expect(annual[7]).toBe(amount);
      const monthly=csvRows.find(row=>row[0]==='Lucro Presumido'&&row[1]===scope&&row[3]===label)!;
      expect(monthly,label).toBeDefined();expect(monthly[6]).toBe(amount);expect(monthly[7]).toBe('0,00');expect(monthly[15]).toBe(amount);
      expect(csvRows.filter(row=>(row[0]==='DRE'&&row[2]===label)||(row[1]==='DRE'&&row[3]===label))).toHaveLength(0);
    }
    const netIcms=csvRows.filter(row=>row[0]==='DRE'&&row[2].includes('ICMS líquido fora do DAS'));
    expect(netIcms).toHaveLength(1);expect(netIcms[0][7]).toBe('-264,00');
    await info.attach('Crédito de ICMS — CSV completo',{body:Buffer.from(csv),contentType:'text/csv'});

    await reopened.evaluate(()=>{window.print=()=>{};});await reopened.locator('#print-dre').click();
    const printed=reopened.locator('#dre-print-document');
    await expect(printed.locator('[data-icms-reconciliation="dre"]')).toHaveCount(5);
    await expect(printed.locator('.dre-print-annual-table [data-dre-row^="icms."],.dre-print-monthly-table [data-dre-row^="icms."]')).toHaveCount(0);
    for(const [key,,amount] of creditRows){
      await expect(printed.locator(`[data-dre-row="${key}"]`)).toHaveCount(5);
      await expect(printed.locator('[data-icms-reconciliation="dre"]').first().locator(`[data-dre-row="${key}"] td`).nth(2)).toHaveText(`R$ ${amount}`);
      const monthly=printed.locator(`[data-report-part="monthly"][data-report-regime="presumed"] [data-dre-row="${key}"] td`);
      await expect(monthly.first()).toHaveText(`R$ ${amount}`);await expect(monthly.nth(1)).toHaveText('R$ 0,00');await expect(monthly.last()).toHaveText(`R$ ${amount}`);
    }
    await expect(printed.locator('[data-report-memory="icms.purchaseCredit"]')).toContainText('114,00');
    await expect(printed.locator('[data-report-memory="icms.returnCredit"]')).toContainText('42,00');
    await expect(printed.locator('[data-report-memory="icms.excludedServices"]')).toContainText('600,00');
    await reopened.emulateMedia({media:'print'});await expect(printed).toBeVisible();
    const pdfPath=info.outputPath('credito-icms-completo.pdf'),pdf=await reopened.pdf({path:pdfPath,preferCSSPageSize:true,printBackground:true});
    expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(10_000);
    await info.attach('Crédito de ICMS — PDF completo',{path:pdfPath,contentType:'application/pdf'});
    await reopened.emulateMedia({media:'screen'});await reopened.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    await expect(reopened.locator('#dre-print-document')).toHaveCount(0);
    expect(await (await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
  }finally{await fresh.close();}
  expect(await frozen()).toEqual(original);
  expect(await db.collection<any>('simulations').findOne({_id:saved._id,workspaceId})).toEqual(stored);
  expect(errors).toEqual([]);
});
