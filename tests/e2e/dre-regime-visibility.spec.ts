import {test,expect,type Page} from '@playwright/test';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';

async function open(page:Page,saved:any){
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética DRE'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expect(page.locator('#dre-display-period')).toHaveValue('annual');
}
async function downloadText(page:Page,selector:string){
  const pending=page.waitForEvent('download');await page.locator(selector).click();
  const file=await pending,stream=await file.createReadStream();let text='';
  for await(const chunk of stream!)text+=chunk;
  return text;
}
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');

test('DRE mostra e oculta regimes na própria tabela, preserva competências e exporta a seleção',async({page},info)=>{
  const saved=drePdfFixture(),before=JSON.stringify(saved),writes:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  await open(page,saved);
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),choices=dre.locator('[data-dre-visible-regime]');
  await expect(choices).toHaveCount(4);await expect(table.locator('thead th')).toHaveCount(5);
  await expect(dre.locator('[data-dre-regime-result]')).toHaveCount(4);
  await expect(dre.locator('#dre-regime,#dre-show-percent,.sim-period-toggle,.dre-quick-nav')).toHaveCount(0);
  await expect(dre.locator('[data-dre-combined-rate]')).toContainText('11,40%');
  await expect(dre.locator('[data-dre-combined-rate]')).toContainText('CBS 11,30% + IBS 0,10%');
  await expect(table.locator('[data-dre-row="cbsDebit"],[data-dre-row="ibsDebit"]')).toHaveCount(0);
  await expect(table.locator('[data-dre-row="cbsIbsNet"]')).toHaveCount(1);
  for(const key of ['taxBurden','netMargin'])await expect(table.locator(`[data-dre-row="${key}"] td`).first()).toContainText('%');
  for(const id of ['pure','hybrid']){
    await dre.locator(`[data-dre-visible-regime="${id}"]`).uncheck();
    await expect(dre.locator(`[data-dre-visible-regime="${id}"]`)).toBeFocused();
  }
  await expect(table.locator('thead th')).toHaveText(['DRE · consolidado Jan–Set','Lucro Presumido','Lucro Real']);
  await expect(dre.locator('[data-dre-regime-result]')).toHaveCount(2);
  const actual=saved.result.regimes.find((regime:any)=>regime.id==='actual');
  await expect(table.locator('[data-dre-row="netProfit"] td').last()).toHaveText(money(actual.dre.netProfit));
  await dre.locator('#dre-display-period').selectOption('month:8');
  await expect(dre.locator('#dre-display-period')).toBeFocused();
  await expect(dre.locator('#dre-display-status')).toContainText('Setembro / 2025');
  const monthActual=saved.result.monthlyResults[8].result.regimes.find((regime:any)=>regime.id==='actual');
  await expect(table.locator('[data-dre-row="revenue"] td').last()).toHaveText(money(monthActual.dre.revenue));
  await expect(table.locator('thead th')).toHaveText(['DRE · Setembro','Lucro Presumido','Lucro Real']);
  await dre.locator('#dre-display-period').selectOption('annual');
  await expect(table.locator('[data-dre-row="revenue"] td').last()).toHaveText(money(actual.dre.revenue));
  await dre.locator('#dre-report-period').selectOption('annual');
  const csv=await downloadText(page,'#export-dre-csv');
  const csvHeader=csv.split('\r\n').find(line=>line.startsWith('"Escopo";'))!;
  expect(csvHeader).toContain('"Lucro Presumido";"Lucro Real"');expect(csvHeader).not.toContain('Simples Puro');expect(csvHeader).not.toContain('Simples Híbrido');
  const raw=JSON.parse(await downloadText(page,'#export-simulation'));
  expect(raw.result).toEqual(saved.result);expect(raw.monthlyDre).toEqual(saved.monthlyDre);
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  const printTable=page.locator('#dre-print-document > .dre-table-wrap').filter({has:page.locator('[data-dre-row="cbsIbsNet"]')});
  await expect(printTable).toHaveCount(1);
  await expect(printTable.locator('thead th')).toHaveText(['Indicador','Lucro Presumido','Lucro Real']);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#dre-print-document')).toHaveCount(0);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await dre.locator('.dre-heading').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('dre-regimes-'+width+'.png')});
  }
  await dre.locator('[data-dre-visible-regime="presumed"]').uncheck();
  await expect(dre.locator('[data-dre-visible-regime="actual"]')).toBeDisabled();
  await expect(table.locator('thead th')).toHaveCount(2);
  expect(await table.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await dre.locator('[data-dre-visible-regime="pure"]').check();
  await expect(dre.locator('[data-dre-visible-regime="actual"]')).toBeEnabled();
  await expect(table.locator('thead th')).toHaveText(['DRE · consolidado Jan–Set','Simples Puro','Lucro Real']);
  expect(writes).toEqual([]);expect(errors).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});

test('regimes não gerados ficam identificados e cálculo pendente não vira zero',async({page})=>{
  const saved=drePdfFixture({variant:'without-rbt12-only-simples'}),before=JSON.stringify(saved);
  await open(page,saved);
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap');
  for(const id of ['presumed','actual']){
    await expect(dre.locator(`[data-dre-visible-regime="${id}"]`)).toBeDisabled();
    await expect(dre.locator(`.dre-regime-option:has([data-dre-visible-regime="${id}"])`)).toContainText('Não gerado nesta versão');
  }
  await expect(table.locator('[data-dre-row="netProfit"] td')).toHaveText(['—','—']);
  await expect(dre.locator('.dre-regime-option:has([data-dre-visible-regime="pure"])')).toContainText('Cálculo pendente');
  await dre.locator('[data-dre-visible-regime="pure"]').uncheck();
  await expect(dre.locator('[data-dre-visible-regime="hybrid"]')).toBeDisabled();
  await expect(table.locator('[data-dre-row="netProfit"] td')).toHaveText(['—']);
  await dre.locator('#dre-display-period').selectOption('month:8');
  await expect(table.locator('[data-dre-row="netProfit"] td')).toHaveText(['—']);
  expect(JSON.stringify(saved)).toBe(before);
});

test('troca de regimes cancela PDF em andamento e usa o novo conjunto sem enviar valores financeiros',async({page})=>{
  const saved=drePdfFixture(),requests:any[]=[];let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/reports',async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1){started();await gate;try{await route.fulfill({status:503,json:{message:'Resposta anterior descartada.'}});}catch{}return;}
    await route.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n% Arquivo sintético de transporte\n%%EOF'),headers:{'Content-Disposition':'attachment; filename="dre-visible.pdf"'}});
  });
  await open(page,saved);await page.locator('#download-dre-pdf').click();await waiting;
  try{
    await expect(page.locator('#download-dre-pdf')).toBeDisabled();
    await page.locator('[data-dre-visible-regime="pure"]').uncheck();
    await expect(page.locator('#download-dre-pdf')).toBeEnabled();
  }finally{release();}
  const pending=page.waitForEvent('download');await page.locator('#download-dre-pdf').click();await pending;
  expect(requests).toEqual([
    {action:'dre-pdf',simulationId:saved._id,period:'complete',regimeIds:['pure','hybrid','presumed','actual'],showPercent:false},
    {action:'dre-pdf',simulationId:saved._id,period:'complete',regimeIds:['hybrid','presumed','actual'],showPercent:false}
  ]);
  await expect(page.locator('#dre-pdf-status')).toContainText('PDF baixado:');
});
