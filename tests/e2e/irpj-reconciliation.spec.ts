import {test,expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';
import {baselineMonth,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {buildDrePresentation} from '../../public/simulator-dre.js';

const memoryKeys=['irpjTaxBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase',
  'irpjNormalAssessed','irpjAdditionalAssessed','irpjTotalAssessed'];
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const numeric=(value:number)=>value.toLocaleString('pt-BR',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});

/** This synthetic service-only case reproduces the Presumido amounts in the reported image. */
function irpjFixture(){
  const seed:any=drePdfFixture();
  const reports=seed.analysisPeriod.includedMonths.map((sourceMonth:string,index:number)=>{
    const services=index===0?10199156:6094915;
    return {sourceMonth,month:index+1,salesLines:1,purchaseLines:0,operationVersion:'NATURE_OPERATIONS_2026_10_V1',
      fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:0,serviceRevenueCents:services,purchasesOptantCents:0,purchasesNonOptantCents:0},
      operationAudit:{grossSalesCents:0,serviceSalesCents:services,salesReturnsCents:0,reportSalesCents:services,reportPurchasesCents:0,selectedPurchasesCents:0,excludedSalesCents:0,excludedPurchaseCents:0,unknownSalesLines:0,unknownPurchaseLines:0}};
  });
  const draft={...seed.draft,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']},
    values:Object.fromEntries(Object.keys(seed.draft.values).map(key=>[key,0]))};
  const computed=calculateMonthlySimulation(draft,reports,reports.map((row:any)=>baselineMonth(row)),seed.source.sales.jobId,null,seed.analysisPeriod);
  const sumField=(key:string,group:string)=>reports.reduce((sum:number,row:any)=>sum+row[group][key],0);
  const fields=Object.fromEntries(Object.keys(reports[0].fields).map(key=>[key,sumField(key,'fields')]));
  const operationAudit=Object.fromEntries(Object.keys(reports[0].operationAudit).map(key=>[key,sumField(key,'operationAudit')]));
  const source={...seed.source,monthlyReports:reports,fields,operationAudit,projection:computed.projection,
    purchases:{...seed.source.purchases,totalCents:0},sales:{...seed.source.sales,totalCents:fields.serviceRevenueCents}};
  delete source.commercialComposition;
  return {...seed,...computed,draft,source,title:'Conferência sintética de IRPJ',monthlyGroups:baselineMonth(reports[0]).groups,
    monthlyDre:buildMonthlyDre(computed.result,2027,seed.rbt12Manual,seed.reportPeriod),
    annualRevenue:computed.result.annualRevenue,bestRegimeId:computed.result.bestRegimeId,modelVersion:computed.result.version};
}

async function open(page:Page,saved:any){
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota fora do cenário sintético.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética de IRPJ'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expect(page.locator('#dre-display-period')).toHaveValue('annual');
}
async function onlyPresumed(dre:Locator){
  for(const id of ['pure','hybrid','actual'])await dre.locator(`[data-dre-visible-regime="${id}"]`).uncheck();
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
    width:Math.min(start.width,offsets.width-Math.max(0,start.x)),height:end.y+end.height-start.y}});
  await info.attach(name+' · IRPJ e parcelas',{path,contentType:'image/png'});
  const memoryPath=info.outputPath(name+'-memoria.png');
  await panel.screenshot({path:memoryPath,style:'.simulator-clean .topbar, .simulator-clean > .skip{visibility:hidden!important}'});
  await info.attach(name+' · memória de cálculo',{path:memoryPath,contentType:'image/png'});
}

test('IRPJ concilia o caso informado, distingue DAS e explica o adicional por competência',async({page},info)=>{
  const saved=irpjFixture(),before=JSON.stringify(saved),writes:string[]=[],errors:string[]=[];
  const presentation=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  const rows=presentation.irpjReconciliation!.rows;
  const expected=(key:string,month?:number)=>{
    const row=rows.find(item=>item.key===key)!;
    return month===undefined?row.values.presumed!:row.monthlyValues.presumed[month]!;
  };
  expect(expected('irpjNormalAssessed')).toBeCloseTo(28300.06848,7);
  expect(expected('irpjAdditionalAssessed')).toBeCloseTo(1263.72992,7);
  expect(expected('irpjTotalAssessed')).toBeCloseTo(29563.7984,7);
  expect(expected('irpjAdditionalLimit')).toBe(180000);
  expect(expected('irpjBaseWithinLimit')).toBeCloseTo(176029.824,7);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method());});
  await page.setViewportSize({width:1440,height:1000});await open(page,saved);
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),panel=dre.locator('[data-irpj-reconciliation="dre"]');
  await expect(panel).toHaveCount(1);await expect(panel.locator('tbody tr')).toHaveCount(7);
  await expect(table.locator('[data-dre-row="irpj"] td')).toHaveText(['No DAS','No DAS',money(-expected('irpjTotalAssessed')),money(saved.result.regimes.find((row:any)=>row.id==='actual').dre.irpj)]);
  for(const [key,assessed] of [['irpjBasic','irpjNormalAssessed'],['irpjAdditional','irpjAdditionalAssessed']]){
    await expect(table.locator(`[data-dre-row="${key}"] td`).nth(2)).toHaveText(money(-expected(assessed)));
    await expect(table.locator(`[data-dre-row="${key}"] .dre-composition-label`)).toHaveCount(0);
    await expect(table.locator(`[data-dre-row="${key}"] th > span`)).not.toHaveText(/^−/);
  }
  for(const key of memoryKeys){
    await expect(table.locator(`[data-dre-row="${key}"]`)).toHaveCount(0);
    await expect(panel.locator(`[data-dre-row="${key}"] td`).nth(0)).toHaveText('No DAS');
    await expect(panel.locator(`[data-dre-row="${key}"] td`).nth(2)).toHaveText(money(expected(key)));
  }
  await expect(panel.locator('.dre-percent')).toHaveCount(0);
  await expect(panel.locator('[data-irpj-method]')).toContainText('O limite não utilizado em um mês não reduz o excedente de outro');
  await captureIrpj(page,table,panel,info,'desktop-1440');
  await onlyPresumed(dre);
  await expect(panel.locator('thead th')).toHaveText(['Conferência do IRPJ','Lucro Presumido']);
  for(const month of [0,1]){
    await dre.locator('#dre-display-period').selectOption('month:'+month);
    await expect(panel).toHaveAttribute('data-irpj-period','monthly');
    for(const key of memoryKeys)await expect(panel.locator(`[data-dre-row="${key}"] td`)).toHaveText(money(expected(key,month)));
    await expect(table.locator('[data-dre-row="irpjAdditional"] td')).toHaveText(money(-expected('irpjAdditionalAssessed',month)));
    await expect(panel.locator('[data-dre-row="irpjAdditionalLimit"] td')).toHaveText('R$ 20.000,00');
  }
  await dre.locator('#dre-display-period').selectOption('annual');
  await expect(panel.locator('[data-dre-row="irpjAdditionalAssessed"] td')).toHaveText('R$ 1.263,73');
  const raw=JSON.parse(await downloadText(page,'#export-simulation'));
  expect(raw.result).toEqual(saved.result);expect(raw.monthlyDre).toEqual(saved.monthlyDre);
  expect(writes).toEqual([]);expect(errors).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});

test('CSV e impressão mantêm a memória e as parcelas informativas do regime visível',async({page})=>{
  const saved=irpjFixture();await open(page,saved);
  const dre=page.locator('#dre-demonstrativo');await onlyPresumed(dre);
  await dre.locator('#dre-report-period').selectOption('annual');
  const csv=await downloadText(page,'#export-dre-csv'),lines=csv.split('\r\n');
  const header=lines.find(line=>line.startsWith('"Escopo";'))!;
  expect(header).toContain('"Lucro Presumido"');expect(header).not.toContain('Lucro Real');expect(header).not.toContain('Simples');
  const memory=lines.filter(line=>line.startsWith('"Memória informativa do IRPJ";'));
  expect(memory).toHaveLength(7);
  const presentation=buildDrePresentation({...saved,calendar:saved.monthlyDre});
  for(const row of presentation.irpjReconciliation!.rows){
    const line=memory.find(line=>line.includes(';"'+row.label+'";'))!;
    expect(line).toContain(';'+numeric(row.values.presumed!)+';');expect(line).toContain('Informativo: não somar novamente à DRE.');
  }
  const total=lines.filter(line=>line.startsWith('"DRE";"Tributos apurados";"IRPJ total'));
  expect(total).toHaveLength(1);expect(total[0]).toContain(';-29563,80;');
  const parts=lines.filter(line=>line.startsWith('"Detalhamento informativo";"Composição do IRPJ";'));
  expect(parts).toHaveLength(2);expect(parts[0]).toContain(';-28300,07;');expect(parts[1]).toContain(';-1263,73;');
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  const printed=page.locator('#dre-print-document'),panel=printed.locator('[data-irpj-reconciliation="dre"]');
  await expect(panel).toHaveCount(1);await expect(panel.locator('thead th')).toHaveText(['Conferência do IRPJ','Lucro Presumido']);
  await expect(panel.locator('[data-dre-row="irpjTotalAssessed"] td')).toHaveText('R$ 29.563,80');
  await expect(printed.locator('[data-dre-row="irpj"] td')).toHaveText('-R$ 29.563,80');
  for(const key of memoryKeys)await expect(printed.locator(`[data-dre-row="${key}"]`)).toHaveCount(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(printed).toHaveCount(0);
});

test('memória ausente e Simples pendente continuam indisponíveis sem ocultar o total capturado',async({page})=>{
  const saved:any=drePdfFixture({variant:'without-rbt12'});
  for(const entry of saved.result.monthlyResults)entry.result.memory=entry.result.memory.filter((item:any)=>item.id!=='presumed.irBasic');
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

for(const width of [390,320])test(`memória de IRPJ cabe no documento a ${width}px e acompanha a seleção`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await open(page,irpjFixture());
  const dre=page.locator('#dre-demonstrativo'),table=dre.locator(':scope > .dre-table-wrap'),panel=dre.locator('[data-irpj-reconciliation="dre"]');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await onlyPresumed(dre);
  await expect(panel.locator('[data-dre-row="irpjAdditionalAssessed"] td')).toHaveText('R$ 1.263,73');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await panel.locator('.dre-table-wrap').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  if(width===390)await captureIrpj(page,table,panel,info,'mobile-390');
  await dre.locator('#dre-display-period').selectOption('month:1');
  await expect(panel.locator('[data-dre-row="irpjAdditionalAssessed"] td')).toHaveText('R$ 0,00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
