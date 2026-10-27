import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {csvParse} from '../../src/domain.ts';

function report(name:string,rows:{month:number;nature:string;value:number}[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const data=rows.map(item=>{
    const row=Array(28).fill('');row[0]='123.456.789-00';row[7]=`15/${String(item.month).padStart(2,'0')}/2026`;row[8]='Pessoa sintética';row[9]='SP';row[11]=item.nature;row[14]='Operação sintética';row[15]='1';row[16]=item.value.toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...data].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

async function save(page:Page){
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
  await page.locator('#generate-simulation').click();const response=await saving;
  expect(response.ok(),await response.text()).toBe(true);
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  return response.json();
}
async function openCompleteDre(page:Page){
  const detail=page.locator('[data-simulation-detail="dre"]');
  if(await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
  await expect(detail.locator('[data-simulation-lazy="dre"]')).toHaveAttribute('data-loaded','true');
}

test('R$ 3,3 milhões sazonais preservam Simples, devoluções, relatório completo e revisão de ICMS/ISS',async({page,browser,baseURL},info)=>{
  test.setTimeout(150_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const credentials={email:`simples-seasonal-${randomUUID()}@example.test`,password:`Synthetic-simples-${randomUUID()}`};
  const mongo=new MongoClient(process.env.MONGODB_URI!);
  try{
    await mongo.connect();
    await mongo.db(process.env.MONGODB_DB).collection<any>('users').insertOne({
      _id:randomUUID(),workspaceId:process.env.WORKSPACE_ID||'maximum',name:'Administrador sintético do Simples',
      email:credentials.email,passwordHash:await hashPassword(credentials.password),role:'admin',
      active:true,mustChangePassword:false,createdAt:new Date()
    });
  }finally{await mongo.close();}
  async function post(path:string,data:unknown){
    const response=await page.request.post(path,{data,headers:{Origin:origin}});
    expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
  }
  await post('/api/auth/login',credentials);
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const catalog=await post('/api/v4/clients/import',{rows:[{code,name:`Empresa sintética sazonal ${code}`,uf:'MG'}]});
  const clientId=catalog.items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);
  await page.locator(`[data-select-company="${clientId}"]`).click();
  for(const id of ['pure','hybrid'])await page.locator(`#generation-difal-${id}`).uncheck();
  await page.locator('#generation-create').click();
  const purchases=Array.from({length:12},(_,i)=>({month:i+1,nature:'2102001',value:1000}));
  purchases.push({month:1,nature:'1202001',value:10000});
  // January–September contains R$ 3.3m after returns. October–December is
  // deliberately present in the files and must stay outside the new analysis.
  const sales=Array.from({length:12},(_,i)=>({month:i+1,nature:'6102001',value:i===0?560000:i<9?343750:250000}));
  for(const [name,rows] of [['compras.csv',purchases],['vendas.csv',sales]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();
    await page.locator('#purchase-file').setInputFiles(report(name,[...rows]));
    await page.locator('[data-guided-continue]').click();
  }
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();
  await page.locator('#guided-rbt12-skip').click();
  await page.locator('#rbt12').fill('3300000');await page.locator('#rbt12-manual-confirm').check();
  await expect(page.locator('#icms-outside')).toHaveValue('inside');
  const saved=await save(page);
  expect(saved.result.annualRevenue).toBe(3_300_000);
  expect(saved.analysisPeriod).toMatchObject({version:'JAN_SEP_V1',months:9,complete:true,excludedMonths:['2026-10','2026-11','2026-12']});
  expect(saved.result.monthlyResults).toHaveLength(9);expect(saved.monthlyDre.version).toBe('DRE_CALENDAR_V4');
  expect(saved.result.simplesDiagnostic).toMatchObject({available:true,statusCode:'READY',revenueReference:3_300_000,rbt12:3_300_000,coveredMonths:9,completeYear:false,eligibilityVerified:false});
  for(const id of ['pure','hybrid']){
    const regime=saved.result.regimes.find((row:any)=>row.id===id);
    expect(regime.available).toBe(true);
    expect(regime.dre.revenue).toBe(3_300_000);
    expect(regime.dre.difal).toBe(0);expect(regime.dre.icmsAnticipation).toBe(0);
    const months=saved.result.monthlyResults.map((row:any)=>row.result.regimes.find((item:any)=>item.id===id));
    expect(months.every((row:any)=>row.available)).toBe(true);
    expect(months.reduce((total:number,row:any)=>total+row.dre.netProfit,0)).toBeCloseTo(regime.dre.netProfit,6);
  }
  expect(saved.result.regimes.find((row:any)=>row.id==='pure').dre.das).toBeCloseTo(-384_600,6);
  expect(saved.result.regimes.find((row:any)=>row.id==='pure').dre.netProfit).toBeCloseTo(2_906_400,6);
  await expect(page.locator('[data-period="annual"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#dre-report-period')).toHaveValue('complete');
  await expect(page.locator('[data-dre-summary-row="revenue"]')).toContainText('3.300.000,00');
  await openCompleteDre(page);
  await expect(page.locator('[data-simples-diagnostic="READY"]')).toContainText('3.300.000,00');
  await expect(page.locator('[data-report-coverage]')).toContainText('9 de 9 competências');
  const closing=page.locator('[data-revenue-reconciliation="dre"]');
  await expect(closing.locator('[data-dre-row="revenueSourceGross"] td').first()).toContainText('3.310.000,00');
  await expect(closing.locator('[data-dre-row="revenueSalesReturns"] td').first()).toContainText('10.000,00');
  const download=page.waitForEvent('download');await page.locator('#export-dre-csv').click();
  const stream=await(await download).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const csv=csvParse(Buffer.concat(chunks).toString('utf8'));
  expect(csv.some(row=>row.some(cell=>cell.includes('3300000,00')))).toBe(true);
  expect(csv.some(row=>row.some(cell=>cell.includes('550000,00')))).toBe(true);
  await page.evaluate(()=>{window.print=()=>{};});
  for(const mode of ['annual','monthly','complete']){
    await page.locator('#dre-report-period').selectOption(mode);await page.locator('#print-dre').click();
    const document=page.locator('#dre-print-document');
    await expect(document.locator('[data-report-part="annual"]')).toHaveCount(mode==='monthly'?0:1);
    await expect(document.locator('[data-report-part="monthly"]')).toHaveCount(mode==='annual'?0:4);
    await expect(document.locator('[data-report-part="references"]')).toContainText('Memória consolidada');
    await expect(document).toContainText('2026-01');await expect(document).toContainText('2027');
    await page.pdf({path:info.outputPath(`dre-sazonal-${mode}.pdf`),printBackground:true,preferCSSPageSize:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  }
  await page.locator('[data-period="monthly"]').click();
  await page.locator('#dre-regime').selectOption('pure');await page.locator('#dre-month').selectOption('0');
  await expect(page.locator('[data-dre-summary-row="revenue"]')).toContainText('550.000,00');
  await page.locator('#dre-month').selectOption('1');
  await expect(page.locator('[data-dre-summary-row="revenue"]')).toContainText('343.750,00');
  await page.locator('[data-period="annual"]').click();
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('[data-simples-diagnostic]').screenshot({path:info.outputPath('simples-sazonal-320.png')});
  await page.setViewportSize({width:1280,height:1000});
  const fresh=await browser.newContext({baseURL});
  try{
    const login=await fresh.request.post('/api/auth/login',{data:credentials,headers:{Origin:origin}});expect(login.ok()).toBe(true);
    const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));
    await reopened.goto(`/simulator.html?simulation=${saved._id}`);
    await expect(reopened.locator('[data-period="annual"]')).toHaveAttribute('aria-pressed','true');
    await openCompleteDre(reopened);
    await expect(reopened.locator('[data-simples-diagnostic="READY"]')).toBeVisible();
    expect(await(await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    await reopened.locator('#create-version').click();await reopened.locator('#rbt12').fill('4000000');
    await reopened.locator('#rbt12-manual-confirm').check();
    const pending=await save(reopened);
    expect(pending.result.simplesDiagnostic.statusCode).toBe('LOCAL_TAX_REVIEW_REQUIRED');
    await openCompleteDre(reopened);
    await expect(reopened.locator('[data-simples-message]')).toContainText(/não (significa|confirma) exclusão/);
    await reopened.locator('#icms-outside').selectOption('outside');
    await expect(reopened.locator('#results-top')).toHaveCount(0);
    const outside=await save(reopened);
    expect(outside.draft.icmsOutside).toBe(true);
    expect(outside.result.regimes.filter((row:any)=>['pure','hybrid'].includes(row.id)).every((row:any)=>row.available)).toBe(true);
    expect(outside.result.regimes.find((row:any)=>row.id==='pure').dre.icmsNet).toBeLessThan(0);
    expect(await(await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    expect(await(await fresh.request.get(`/api/v4/simulations/${pending._id}`)).json()).toEqual(pending);
    await reopened.reload();await expect(reopened.locator('#icms-outside')).toHaveValue('outside');
  }finally{await fresh.close();}
  expect(errors).toEqual([]);
});
