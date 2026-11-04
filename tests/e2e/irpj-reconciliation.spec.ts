import {test,expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import {irpjQuarterlyFixture} from '../fixtures/irpj-quarterly.mjs';
import {buildDrePresentation} from '../../public/simulator-dre.js';
import {irpjRowLabel} from '../../public/simulator-irpj-display.js';

const memoryKeys=['irpjTaxBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase',
  'irpjNormalAssessed','irpjAdditionalAssessed','irpjTotalAssessed','irpjPreviousProvision','irpjCurrentMovement'];
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const numeric=(value:number)=>value.toLocaleString('pt-BR',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});

async function open(page:Page,saved:any){
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota fora do cenário sintético.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética de IRPJ'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expect(page.locator('#dre-display-period')).toHaveValue('annual');
}
async function onlyRegime(dre:Locator,id:string){
  for(const candidate of ['pure','hybrid','presumed','actual'])if(candidate!==id)await dre.locator(`[data-dre-visible-regime="${candidate}"]`).uncheck();
}
async function downloadText(page:Page,selector:string){
  const pending=page.waitForEvent('download');await page.locator(selector).click();
  const stream=await (await pending).createReadStream();let content='';
  for await(const chunk of stream!)content+=chunk;
  return content;
}
async function captureIrpj(page:Page,table:Locator,panel:Locator,info:TestInfo,name:string){
  const first=table.locator('[data-dre-row="irpj"]'),last=table.locator('[data-dre-row="irpjAdditional"]');
  await first.scrollIntoViewIfNeeded();
  const start=(await first.boundingBox())!,end=(await last.boundingBox())!;
  const offsets=await page.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth}));
  const path=info.outputPath(name+'-parcelas.png');
  await page.screenshot({path,fullPage:true,clip:{x:Math.max(0,start.x+offsets.x),y:start.y+offsets.y,
    width:Math.min(start.width,offsets.width-Math.max(0,start.x)),height:end.y+end.height-start.y},
    style:'.simulator-clean .topbar, .simulator-clean > .skip{visibility:hidden!important}'});
  await info.attach(name+' · IRPJ e parcelas',{path,contentType:'image/png'});
  const memoryPath=info.outputPath(name+'-memoria.png');
  await panel.screenshot({path:memoryPath,style:'.simulator-clean .topbar, .simulator-clean > .skip{visibility:hidden!important}'});
  await info.attach(name+' · memória de cálculo',{path:memoryPath,contentType:'image/png'});
}

test('IRPJ trimestral concilia provisões, DAS e reversão mensal do Real',async({page},info)=>{
  const saved:any=irpjQuarterlyFixture(),before=JSON.stringify(saved),writes:string[]=[],errors:string[]=[];
  const presentation=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  const rows=presentation.irpjReconciliation!.rows;
  const expected=(key:string,id='actual',month?:number)=>{
    const row=rows.find(item=>item.key===key)!;
    return month===undefined?row.values[id]!:row.monthlyValues[id][month]!;
  };
  expect(expected('irpjNormalAssessed','presumed')).toBe(9600);
  expect(expected('irpjAdditionalAssessed','presumed')).toBe(400);
  expect(expected('irpjTotalAssessed','presumed')).toBe(10000);
  expect(expected('irpjTotalAssessed')).toBe(3000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method());});
  await page.setViewportSize({width:1440,height:1000});await open(page,saved);
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),panel=dre.locator('[data-irpj-reconciliation="dre"]');
  await expect(panel).toHaveCount(1);await expect(panel).toHaveAttribute('data-irpj-version','IRPJ_RECONCILIATION_V2');
  await expect(panel.locator('tbody tr')).toHaveCount(9);
  await expect(table.locator('[data-dre-row="irpj"] td')).toHaveText(['No DAS','No DAS','-R$ 10.000,00','-R$ 3.000,00']);
  for(const key of memoryKeys){
    await expect(table.locator(`[data-dre-row="${key}"]`)).toHaveCount(0);
    await expect(panel.locator(`[data-dre-row="${key}"] td`).nth(0)).toHaveText('No DAS');
    await expect(panel.locator(`[data-dre-row="${key}"] td`).nth(3)).toHaveText(money(expected(key)));
  }
  for(const key of ['irpjBasic','irpjAdditional']){
    await expect(table.locator(`[data-dre-row="${key}"] .dre-composition-label`)).toHaveCount(0);
    await expect(table.locator(`[data-dre-row="${key}"] th > span`)).not.toHaveText(/^−/);
  }
  await expect(panel.locator('.dre-percent')).toHaveCount(0);
  await expect(panel.locator('[data-irpj-method]')).toContainText('Não some os acumulados mensais');
  await onlyRegime(dre,'actual');
  await dre.locator('#dre-display-period').selectOption('month:1');
  await expect(panel).toHaveAttribute('data-irpj-period','monthly');
  await expect(panel.locator('thead th')).toHaveText(['Conferência do IRPJ','Lucro Real']);
  for(const key of memoryKeys)await expect(panel.locator(`[data-dre-row="${key}"] td`)).toHaveText(money(expected(key,'actual',1)));
  await expect(panel.locator('[data-dre-row="irpjAdditionalLimit"] td')).toHaveText('R$ 60.000,00');
  await expect(panel.locator('[data-dre-row="irpjTotalAssessed"] td')).toHaveText('R$ 3.000,00');
  await expect(panel.locator('[data-dre-row="irpjPreviousProvision"] td')).toHaveText('R$ 19.000,00');
  await expect(panel.locator('[data-dre-row="irpjCurrentMovement"] td')).toHaveText('-R$ 16.000,00');
  await expect(table.locator('[data-dre-row="irpj"] td')).toHaveText('R$ 16.000,00');
  await expect(table.locator('[data-dre-row="irpjBasic"] td')).toHaveText('R$ 12.000,00');
  await expect(table.locator('[data-dre-row="irpjAdditional"] td')).toHaveText('R$ 4.000,00');
  await expect(panel.locator('[data-irpj-provisional]')).toContainText('fechamento');
  await expect(panel).toContainText('não é restituição automática');
  await captureIrpj(page,table,panel,info,'desktop-1440-reversao');
  await dre.locator('#dre-display-period').selectOption('month:2');
  await expect(table.locator('[data-dre-row="irpj"] td')).toHaveText('R$ 0,00');
  await expect(panel.locator('[data-irpj-provisional]')).toHaveCount(0);
  await dre.locator('#dre-display-period').selectOption('annual');
  await expect(panel.locator('[data-dre-row="irpjTotalAssessed"] td')).toHaveText('R$ 3.000,00');
  const raw=JSON.parse(await downloadText(page,'#export-simulation'));
  expect(raw.result).toEqual(saved.result);expect(raw.monthlyDre).toEqual(saved.monthlyDre);
  expect(writes).toEqual([]);expect(errors).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});

test('CSV e impressão distinguem acumulados e movimentos e preservam o regime visível',async({page})=>{
  const saved:any=irpjQuarterlyFixture();await open(page,saved);
  const dre=page.locator('#dre-demonstrativo');await onlyRegime(dre,'actual');
  await dre.locator('#dre-report-period').selectOption('complete');
  const csv=await downloadText(page,'#export-dre-csv'),lines=csv.split('\r\n');
  const header=lines.find(line=>line.startsWith('"Escopo";'))!;
  expect(header).toContain('"Lucro Real"');expect(header).not.toContain('Lucro Presumido');expect(header).not.toContain('Simples');
  const memory=lines.filter(line=>line.startsWith('"Memória informativa do IRPJ";'));
  expect(memory).toHaveLength(9);
  const presentation=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  for(const row of presentation.irpjReconciliation!.rows){
    const line=memory.find(line=>line.includes(';"'+irpjRowLabel(row,presentation)+'";'))!;
    expect(line).toContain(';'+numeric(row.values.actual!)+';');expect(line).toContain('Informativo: não somar novamente à DRE.');
  }
  const total=lines.filter(line=>line.startsWith('"DRE";"Tributos apurados";"IRPJ do período'));
  expect(total).toHaveLength(1);expect(total[0]).toContain(';-3000,00;');
  const parts=lines.filter(line=>line.startsWith('"Detalhamento informativo";"Composição do IRPJ";'));
  expect(parts).toHaveLength(2);expect(parts[0]).toContain(';-3000,00;');expect(parts[1]).toContain(';0,00;');
  expect(csv).toContain('"Movimento de IRPJ no mês";"detail";"BRL";19000,00;-16000,00;0,00;3000,00;');
  expect(csv).toContain('"Provisão mensal do IRPJ";"Lucro Real";"2025-02";');
  await dre.locator('#dre-report-period').selectOption('annual');
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  const printed=page.locator('#dre-print-document'),panel=printed.locator('[data-irpj-reconciliation="dre"]');
  await expect(panel).toHaveCount(1);await expect(panel.locator('thead th')).toHaveText(['Conferência do IRPJ','Lucro Real']);
  await expect(panel.locator('[data-dre-row="irpjTotalAssessed"] td')).toHaveText('R$ 3.000,00');
  await expect(printed.locator('[data-dre-row="irpj"] td')).toHaveText('-R$ 3.000,00');
  for(const key of memoryKeys)await expect(printed.locator(`[data-dre-row="${key}"]`)).toHaveCount(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(printed).toHaveCount(0);
});

test('captura trimestral ausente e Simples pendente preservam indisponibilidade e total salvo',async({page})=>{
  const saved:any=irpjQuarterlyFixture({rbt12:null});
  delete saved.result.incomeTaxAssessment.regimes.presumed;
  const total=saved.result.regimes.find((item:any)=>item.id==='presumed').dre.irpj;
  await open(page,saved);
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),panel=dre.locator('[data-irpj-reconciliation="dre"]');
  await expect(table.locator('[data-dre-row="irpj"] td').nth(0)).toHaveText('—');
  await expect(table.locator('[data-dre-row="irpj"] td').nth(2)).toHaveText(money(total));
  await expect(table.locator('[data-dre-row="irpjBasic"] td').nth(2)).toHaveText('—');
  await expect(panel.locator('[data-dre-row="irpjTaxBase"] td').nth(2)).toHaveText('—');
  await expect(panel.locator('[data-irpj-unavailable]')).toContainText('Lucro Presumido:');
  await expect(panel.locator('.dre-irpj-in-das')).toHaveCount(0);
  await expect(panel.locator('[data-dre-row="irpjTaxBase"] td').nth(3)).not.toHaveText('—');
});

for(const width of [390,320,321])test(`memória trimestral cabe no documento a ${width}px e acompanha a reversão`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await open(page,irpjQuarterlyFixture());
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),panel=dre.locator('[data-irpj-reconciliation="dre"]');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await onlyRegime(dre,'actual');await dre.locator('#dre-display-period').selectOption('month:1');
  await expect(panel.locator('tbody tr')).toHaveCount(9);
  await expect(panel.locator('[data-dre-row="irpjCurrentMovement"] td')).toHaveText('-R$ 16.000,00');
  await expect(table.locator('[data-dre-row="irpj"] td')).toHaveText('R$ 16.000,00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await panel.locator('.dre-table-wrap').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  if(width===390)await captureIrpj(page,table,panel,info,'mobile-390-reversao');
  await dre.locator('#dre-display-period').selectOption('annual');
  await expect(panel.locator('[data-dre-row="irpjTotalAssessed"] td')).toHaveText('R$ 3.000,00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
