import {test,expect,type Page} from '@playwright/test';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';
import {mockStatement,documentId} from './extrato-helper.ts';
import {section22Year2025} from '../fixtures/section22.ts';
import {processLookup} from '../../src/lookup-jobs.ts';
import {closeDatabase} from '../../src/store.ts';
import * as XLSX from 'xlsx';

// Real CSV parsing, authenticated APIs, monthly calculation and Mongo persistence.
// Blob/OCR and CNPJ provider transports are mocked; their snapshots are persisted normally.
test.afterAll(async()=>closeDatabase());
function report(name:string,rows:{month:number;nature:string;value:number;document?:string;name?:string}[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const content=rows.map(item=>{
    const row=Array(28).fill('');row[0]=item.document||'123.456.789-00';row[7]=`15/${String(item.month).padStart(2,'0')}/2025`;row[8]=item.name||'Pessoa sintética';row[9]='SP';row[11]=item.nature;row[14]='Descrição informativa';row[15]='1';row[16]=item.value.toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...content].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

async function statement(page:Page,clientId:string,extractionId:string,result:any){
  await mockStatement(page,result.rbt12Cents,extractionId);
  await page.route('**/api/simples?*',r=>r.fulfill({json:{extractionId,documentId,clientId,originalStored:true,searchableStored:true,...result}}));
  await page.locator('#rbt12-pdf').setInputFiles({name:'extrato-23-meses-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
}

test('compras e vendas CPF e CNPJ geram DIFAL no relatório, CSV, DRE mensal e histórico',async({page,browser,baseURL},info)=>{
  test.setTimeout(120_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin,errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  async function post(path:string,data:unknown){const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();}
  await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  const session=await (await page.request.get('/api/auth/session')).json();let providerCalls=0;
  const transport=(async(url:string|URL|Request)=>{
    providerCalls++;const cnpj=String(url).split('/').pop();expect(cnpj).toBe('11222333000181');
    return Response.json({cnpj,razao_social:'Fornecedor CNPJ sintético',opcao_pelo_simples:false,opcao_pelo_mei:false});
  }) as typeof fetch;
  await page.route(/\/api\/v4\/(?:purchases|sales)\/[^/]+\/process$/,async route=>{
    const jobId=new URL(route.request().url()).pathname.split('/').at(-2)!;
    await route.fulfill({json:await processLookup(session.user,jobId,transport)});
  });
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const catalog=await post('/api/v4/clients/import',{rows:[{code,name:'Empresa sintética naturezas '+code}]});
  const clientId=catalog.items[0].id;
  await page.goto('/generations.html');await page.locator('#generation-search').fill(code);await page.locator(`[data-select-company="${clientId}"]`).click();await page.locator('#generation-create').click();
  await expect(page).toHaveURL(/purchases\.html\?.*guided=1/);
  const purchases=[{month:1,nature:'1102001',value:3000,document:'11222333000181',name:'Fornecedor CNPJ sintético'},{month:1,nature:'8000002',value:200},{month:1,nature:'1202001',value:1000},{month:1,nature:'1949001',value:100},
    {month:2,nature:'2102001',value:4000},{month:2,nature:'8000102',value:300},{month:2,nature:'1202001',value:500},{month:2,nature:'1949001',value:100}];
  const sales=[{month:1,nature:'6108001',value:6000},{month:1,nature:'6108001',value:4000,document:'11222333000181',name:'Comprador CNPJ sintético'},{month:1,nature:'9000002',value:500},{month:1,nature:'6949001',value:900},
    {month:2,nature:'5102001',value:12000},{month:2,nature:'9000002',value:700},{month:2,nature:'5949001',value:600}];
  for(const [name,rows] of [['compras.csv',purchases],['vendas.csv',sales]] as const){
    await expect(page.locator('#purchase-file')).toBeEnabled();await page.locator('#purchase-issuer-uf').selectOption('MG');
    await page.locator('#purchase-file').setInputFiles(report(name,[...rows]));await expect(page.locator('[data-guided-continue]')).toBeVisible();
    if(name==='compras.csv'){
      await expect(page.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('549,00');
      await expect(page.locator('#purchase-report-view .purchase-anticipation')).toContainText('7.500,00');
      await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('9.200,00');
      const detailed=await page.context().newPage();
      try{
        await detailed.goto((await page.locator('.purchase-guided-detail').getAttribute('href'))!);
        await expect(detailed.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('549,00');
        await detailed.locator('#purchase-view-filter').selectOption('lines');
        const legalEntity=detailed.locator('#purchase-result-list tbody tr').filter({hasText:'Fornecedor CNPJ sintético'});
        await expect(legalEntity).toContainText('3.000,00');await expect(legalEntity).toContainText('219,60');await expect(legalEntity).not.toContainText('Não se aplica');
        const downloading=detailed.waitForEvent('download');await detailed.locator('#purchase-csv').click();const download=await downloading,stream=await download.createReadStream(),parts:Buffer[]=[];
        for await(const part of stream!)parts.push(Buffer.from(part));const workbook=XLSX.read(Buffer.concat(parts).toString('utf8'),{type:'string',raw:true});
        const csvRows=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true}),headers=csvRows[0];
        const at=(row:string[],header:string)=>row[headers.indexOf(header)];
        const cnpj=csvRows.slice(1).find(row=>at(row,'Documento do fornecedor (A)')==='11222333000181')!;
        expect(at(cnpj,'Total calculado (R$)')).toBe('3000,00');expect(at(cnpj,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('3000,00');expect(at(cnpj,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('219,60');expect(at(cnpj,'Situação DIFAL de entrada — Antecipação de ICMS')).toBe('ELIGIBLE');
        expect(at(cnpj,'Versão DIFAL de entrada — Antecipação de ICMS')).toBe('ICMS_ANTICIPATION_V3');
        expect(at(cnpj,'Origem DIFAL de entrada')).toBe('IMPORTED');
        expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(String(at(row,'DIFAL de entrada — Antecipação de ICMS (R$)')||'0').replace(',','.')),0)).toBeCloseTo(549,2);
      }finally{await detailed.close();}
    }else{
      const detailed=await page.context().newPage();
      try{
        await detailed.goto((await page.locator('.purchase-guided-detail').getAttribute('href'))!);
        await expect(detailed.locator('#purchase-report-view [data-difal-amount]')).toContainText('2.200,00');
        await detailed.locator('#purchase-view-filter').selectOption('lines');
        const legalEntity=detailed.locator('#purchase-result-list tbody tr').filter({hasText:'Comprador CNPJ sintético'});
        await expect(legalEntity).toContainText('4.000,00');await expect(legalEntity).toContainText('400,00');
        const downloading=detailed.waitForEvent('download');await detailed.locator('#purchase-csv').click();const download=await downloading,stream=await download.createReadStream(),parts:Buffer[]=[];
        for await(const part of stream!)parts.push(Buffer.from(part));const workbook=XLSX.read(Buffer.concat(parts).toString('utf8'),{type:'string',raw:true});
        const csvRows=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true}),headers=csvRows[0],at=(row:string[],header:string)=>row[headers.indexOf(header)];
        const cnpj=csvRows.slice(1).find(row=>at(row,'Documento do comprador (A)')==='11222333000181')!;
        expect(at(cnpj,'Base DIFAL (R$)')).toBe('4000,00');expect(at(cnpj,'DIFAL estimado (R$)')).toBe('400,00');expect(at(cnpj,'Situação DIFAL')).toBe('ELIGIBLE');expect(at(cnpj,'Versão DIFAL')).toBe('DIFAL_ESTIMATE_V4');
        expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(String(at(row,'DIFAL estimado (R$)')||'0').replace(',','.')),0)).toBeCloseTo(2200,2);
      }finally{await detailed.close();}
    }
    await page.locator('[data-guided-continue]').click();
  }
  expect(providerCalls).toBe(2);
  await expect(page.locator('#guided-rbt12-stage')).toBeVisible();
  const result=section22Year2025(),extractionId=randomUUID(),mongo=new MongoClient(process.env.MONGODB_URI!);
  try{await mongo.connect();await mongo.db(process.env.MONGODB_DB).collection('simplesExtractions').insertOne({_id:extractionId as any,clientId,workspaceId:process.env.WORKSPACE_ID||'maximum',parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result});}finally{await mongo.close();}
  await statement(page,clientId,extractionId,result);await expect(page.locator('#guided-rbt12-continue')).toBeEnabled();await page.locator('#guided-rbt12-continue').click();
  for(const regime of ['pure','hybrid','presumed','actual'])await expect(page.locator(`#difal-enabled-${regime}`)).toBeChecked();
  await expect(page.locator('label[for="rbt12"]')).toHaveText('RBT12 do PA 12/2025');await expect(page.locator('#rbt12')).toHaveValue('210000.00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('5000.00');await expect(page.locator('#salesNonOptantCents')).toHaveValue('4000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('500.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('3200.00');
  await expect(page.locator('#month-context')).toContainText('78.000,00');
  await expect(page.locator('[data-difal-monthly]')).toContainText('1.000,00');await expect(page.locator('[data-anticipation-monthly]')).toContainText('234,24');
  await expect(page.locator('#rbt12-schedule > details')).toHaveAttribute('open','');await expect(page.locator('#rbt12-schedule .projection-table-wrap tbody tr')).toHaveCount(2);await expect(page.locator('#rbt12-schedule')).toContainText('90.000,00');
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
  expect(saved.draft.difalPolicy).toEqual({version:'DIFAL_SCENARIOS_V1',enabled:{pure:true,hybrid:true,presumed:true,actual:true}});
  expect(saved.difalProjection.annualCents).toBe(220_000);
  expect(saved.difalProjection.sourceVersion).toBe('DIFAL_ESTIMATE_V4');
  expect(saved.anticipationProjection.sourceVersion).toBe('ICMS_ANTICIPATION_V3');
  expect(saved.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([-2200,-2200,-2200,-2200]);
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
    await expect(reopened.locator('#sim-difal-options [data-difal-option="pure"]')).toContainText('Incluído por escolha');
    await reopened.locator('#create-version').click();await expect(reopened.locator('#simulator-form')).toBeVisible();
    await expect(reopened.locator('#difal-enabled-pure')).toBeChecked();
    await reopened.locator('#difal-enabled-pure').uncheck();await reopened.locator('#difal-enabled-actual').uncheck();
    await reopened.locator('#rbt12-manual').click();await reopened.locator('#rbt12').fill('100000');await reopened.locator('#rbt12-manual-confirm').check();
    const childSaving=reopened.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
    await reopened.locator('#generate-simulation').click();const childResponse=await childSaving;expect(childResponse.ok(),await childResponse.text()).toBe(true);const child=await childResponse.json();
    expect(child.parentSimulationId).toBe(saved._id);expect(child.draft.difalPolicy.enabled).toEqual({pure:false,hybrid:true,presumed:true,actual:false});
    expect(child.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([0,-2200,-2200,0]);
    expect(child.result.regimes.map((regime:any)=>regime.dre.icmsAnticipation)).toEqual([0,-549,0,0]);
    expect(child.difalProjection).toEqual(saved.difalProjection);expect(child.source.fields).toEqual(saved.source.fields);
    await reopened.goto(`/simulator.html?simulation=${child._id}`);
    await expect(reopened.locator('[data-difal-option="pure"]')).toContainText('Não incluído por escolha');
    await expect(reopened.locator('[data-difal-state="pure"]')).toContainText('Excluído deste cenário');
    expect(await (await fresh.request.get(`/api/v4/simulations/${child._id}`)).json()).toEqual(child);
    expect(await (await fresh.request.get(`/api/v4/simulations/${saved._id}`)).json()).toEqual(saved);
    await reopened.locator('#create-version').click();await expect(reopened.locator('#difal-enabled-pure')).not.toBeChecked();await expect(reopened.locator('#difal-enabled-actual')).not.toBeChecked();
  }finally{await fresh.close();}
  await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('3600000');await page.locator('#rbt12-manual-confirm').check();
  const atSublimit=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/simulations'&&response.request().method()==='POST');
  await page.locator('#generate-simulation').click();const sublimitResponse=await atSublimit;expect(sublimitResponse.ok(),await sublimitResponse.text()).toBe(true);const sublimit=await sublimitResponse.json();
  expect(sublimit.result.regimes.map((regime:any)=>regime.dre.icmsAnticipation)).toEqual([0,0,0,0]);
  expect(sublimit.result.regimes.map((regime:any)=>regime.dre.difal)).toEqual([0,0,-2200,-2200]);
  expect(sublimit.draft.difalPolicy.enabled).toEqual(saved.draft.difalPolicy.enabled);
  for(const regime of ['pure','hybrid']){await expect(page.locator(`#difal-enabled-${regime}`)).toBeChecked();await expect(page.locator(`[data-difal-option="${regime}"]`)).toHaveAttribute('data-state','SUBLIMIT');}
  expect(sublimit.source.fields).toEqual(saved.source.fields);expect(sublimit.difalProjection).toEqual(saved.difalProjection);
  // A shorter, valid PA window cannot silently replace earlier monthly RBT12s.
  let missingHistoryWrites=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v4/simulations')missingHistoryWrites++;});
  await page.locator('#rbt12-use-pdf').click();
  await statement(page,clientId,randomUUID(),{...result,priorRevenues:result.rbt12Window});await page.locator('#rbt12-read').click();
  await expect(page.locator('#rbt12-schedule')).toContainText('Histórico incompleto');await expect(page.locator('#rbt12-schedule')).toContainText('Faltam:');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulator-error')).toContainText('não cobre todas as janelas de RBT12');expect(missingHistoryWrites).toBe(0);
  expect(errors).toEqual([]);
});
