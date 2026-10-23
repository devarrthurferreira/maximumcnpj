import {test,expect} from '@playwright/test';
import {calculateSimulation,draftToInput,TAX_SOURCES,MODEL_VERSION,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
import {annualizeReports,projectDifal} from '../../public/simulator-projection.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {baselineMonth,monthlyProjection,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
const generation='88888888-8888-4888-8888-888888888881',client='88888888-8888-4888-8888-888888888882',id='88888888-8888-4888-8888-888888888883';
function fixture(){
  const fields={salesOptantCents:200000,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100000,purchasesNonOptantCents:350000,serviceRevenueCents:250000};
  const difal={version:'DIFAL_ESTIMATE_V1',ratePercent:10,amountCents:30000,baseCents:300000,eligibleLines:3,pendingLines:0,issuerUf:'MG'};
  const source={generationId:generation,clientId:client,company:{code:'DRE',name:'EMPRESA SINTÉTICA DRE'},fields,revenueSplit:{version:'SALES_SERVICES_V1'},reportMonths:1,periodBasis:'REPORT_TOTALS',warnings:[],
    purchases:{jobId:'88888888-8888-4888-8888-888888888884',fileName:'compras-sinteticas.csv',totalCents:450000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-19T10:00:00Z'},
    sales:{jobId:'88888888-8888-4888-8888-888888888885',fileName:'vendas-sinteticas.csv',totalCents:1250000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-19T10:00:00Z',difal}};
  const draft:any={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:150000,values:{serviceRevenue:2500,salesRevenue:10000,simplePurchases:1000,regularPurchases:3500,salaries:1200,benefits:200,adminExpenses:300,rent:500,cardExpenses:100}};
  const projection=annualizeReports(fields,1),difalProjection=projectDifal(difal,1,source.sales.jobId),result=calculateSimulation(draft,difalProjection);
  const reference={source:'MANUAL',confirmed:true,rbt12Cents:15000000};
  return {_id:id,generationId:generation,clientId:client,company:source.company,title:'DRE completa sintética',source,draft,result,projection,difalProjection,engineInput:draftToInput(draft,difalProjection),monthlyGroups:{salesOptantCents:2000,salesNonOptantCents:5000,salesCpfCents:3000,purchasesOptantCents:1000,purchasesNonOptantCents:3500},monthlyDre:buildMonthlyDre(result,2027,reference),reportMonths:1,periodBasis:'REPORT_TOTALS',periodConfirmed:true,manuallyAdjusted:false,adjustments:[],rbt12Source:'MANUAL',rbt12Manual:reference,createdAt:'2026-10-19T10:00:00Z',createdBy:{id:'operator',name:'Teste'},taxSources:TAX_SOURCES,modelVersion:MODEL_VERSION,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT};
}
async function open(page:any,saved:any){
  await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/simulations/'+id,(r:any)=>r.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+id);
  await expect(page.locator('.dre-complete')).toBeVisible();
}
async function downloadText(page:any,selector:string){const pending=page.waitForEvent('download');await page.locator(selector).click();const download=await pending;const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;return {text,name:download.suggestedFilename()};}
test('evolução compara competências reais e informa ausência sem gravar ou alterar o histórico',async({page},info)=>{
  const original=fixture(),draft=original.draft;
  const reports=[100000,150000,0].map((sales,index)=>({sourceMonth:`2025-0${index+1}`,month:index+1,salesLines:sales?1:0,purchaseLines:1,
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:sales,purchasesOptantCents:0,purchasesNonOptantCents:20000,serviceRevenueCents:0},
    difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',baseCents:sales,amountCents:sales/10,eligibleLines:sales?1:0,pendingLines:0}}));
  const period={startMonth:'2025-01',endMonth:'2025-03',months:3},projection=monthlyProjection(reports),computed=calculateMonthlySimulation(draft,reports,reports.map(baselineMonth),original.source.sales.jobId);
  const saved={...original,...computed,reportMonths:3,periodBasis:'COLUMN_H',source:{...original.source,reportMonths:3,period,monthlyReports:reports,projection,fields:projection.annualGroupsCents},
    monthlyDre:buildMonthlyDre(computed.result,2027,original.rbt12Manual,period)};
  const before=JSON.stringify(saved),writes:string[]=[],errors:string[]=[];
  page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
  page.on('pageerror',e=>errors.push(e.message));
  await open(page,saved);await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await expect(page.locator('.dre-evolution')).toContainText('O mês anterior está fora deste calendário');
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('#dre-month')).toBeFocused();
  await expect(page.locator('[data-dre-change="revenue"] strong')).toHaveText('+R$ 500,00');
  await expect(page.locator('[data-dre-change="revenue"]')).toContainText('+50% sobre o valor do mês anterior');
  await expect(page.locator('[data-dre-change="difal"] strong')).toHaveText('+R$ 50,00');
  await expect(page.locator('[data-dre-change="netMargin"] strong')).toContainText('p.p.');
  await page.locator('#dre-month').selectOption('2');
  await expect(page.locator('[data-dre-change="revenue"] strong')).toHaveText('-R$ 1.500,00');
  await expect(page.locator('[data-dre-change="netMargin"] strong')).toHaveText('—');
  await page.locator('#dre-month').selectOption('3');
  await expect(page.locator('.dre-evolution')).toContainText('Sem dados importados para o mês selecionado');
  await expect(page.locator('[data-dre-change="revenue"] strong')).toHaveText('—');
  await page.getByRole('button',{name:'Anual',exact:true}).click();
  await expect(page.locator('#dre-evolution-year')).not.toHaveAttribute('open','');
  await page.locator('#dre-evolution-year summary').click();await expect(page.locator('#dre-evolution-year')).toContainText('3 de 12 meses com dados importados');
  await expect(page.locator('[data-dre-evolution-month]')).toHaveCount(12);
  await expect(page.locator('[data-dre-evolution-month="2"]')).toContainText('R$ 0,00');
  await expect(page.locator('[data-dre-evolution-month="3"]')).toContainText('Sem dados importados');
  await page.locator('#dre-regime').selectOption('actual');await expect(page.locator('#dre-evolution-year')).toHaveAttribute('open','');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(width===390)await page.locator('#dre-evolution-year').screenshot({path:info.outputPath('dre-evolucao-mobile.png')});
  }
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await page.locator('#dre-month').selectOption('1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.dre-evolution').screenshot({path:info.outputPath('dre-variacao-mobile.png')});
  expect(writes).toEqual([]);expect(errors).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});
test('DRE única conserva composição, escolhas, exportação e impressão anual isolada',async({page},info)=>{
  const saved=fixture();saved.result.regimes[0].dre.netProfit=123456.78;saved.result.regimes[0].annualProfit=123456.78;
  await open(page,saved);
  await expect(page.locator('.dre-complete > .dre-table-wrap > table')).toHaveCount(1);await expect(page.locator('.dre-complete > .dre-table-wrap > table > tbody')).toHaveCount(1);
  await expect(page.locator('.dre-complete > .dre-table-wrap [data-dre-row]')).toHaveCount(60);
  await expect(page.locator('[data-revenue-reconciliation="dre"] table')).toHaveCount(1);await expect(page.locator('[data-revenue-reconciliation="dre"] [data-dre-row]')).toHaveCount(5);
  await expect(page.locator('[data-revenue-reconciliation="dre"] [data-revenue-unavailable]')).toContainText('projeção histórica');
  await expect(page.locator('.dre-complete details,.dre-section-row')).toHaveCount(0);
  const keys=await page.locator('.dre-complete [data-dre-row]').evaluateAll(rows=>rows.map(row=>(row as HTMLElement).dataset.dreRow));expect(new Set(keys).size).toBe(keys.length);expect(keys[keys.indexOf('sales')+1]).toBe('salesOptantCents');expect(keys.indexOf('grossMargin')).toBeGreaterThan(keys.indexOf('netProfit'));expect(keys.slice(-5)).toEqual(['revenueSourceGross','revenueSalesReturns','revenueAfterReturns','revenueManualAdjustment','revenueUsed']);
  await expect(page.locator('.dre-footnotes')).toContainText('Saldo informativo');
  await expect(page.locator('.dre-complete [data-dre-row="netProfit"] td').first()).toContainText('123.456,78');
  await expect(page.locator('[data-dre-summary="result"]')).toContainText('123.456,78');
  await expect(page.locator('.dre-visual-empty')).toContainText('não concilia');await expect(page.locator('.dre-flow-bars')).toHaveCount(0);
  await page.locator('#dre-regime').selectOption('actual');await expect(page.locator('.dre-flow-bars li')).toHaveCount(6);
  await expect(page.locator('.dre-table-wrap thead .dre-active-column')).toHaveText('Lucro Real');
  await page.locator('#dre-regime').selectOption('pure');
  await expect(page.locator('#dre-show-percent')).not.toBeChecked();await expect(page.locator('.dre-complete details[open]')).toHaveCount(0);
  await page.locator('#dre-show-percent').check();await expect(page.locator('.dre-complete [data-dre-row="revenue"] .dre-percent').first()).toHaveText('100%');
  await expect(page.locator('.dre-complete [data-dre-row="difal"] .dre-percent').first()).toHaveText('-2,4%');
  await page.locator('.sim-charts-details summary').click();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await page.locator('#dre-regime').selectOption('actual');
  await expect(page.locator('.sim-charts-details')).toHaveAttribute('open','');await expect(page.locator('.dre-complete > .dre-table-wrap > table')).toHaveCount(1);
  await expect(page.locator('#dre-show-percent')).toBeChecked();
  await page.getByRole('button',{name:'Anual',exact:true}).click();await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('.sim-charts-details')).toHaveAttribute('open','');
  await expect(page.locator('#dre-regime')).toHaveValue('actual');
  await page.locator('#dre-report-period').selectOption('monthly');
  const csv=await downloadText(page,'#export-dre-csv');expect(csv.name).toBe('dre-DRE-2027-mensal.csv');expect(csv.text).toContain('Janeiro');expect(csv.text).toContain('Dezembro');expect(csv.text).toContain('Lucro Real');expect(csv.text).toContain('Simples Puro');expect(csv.text).toContain('% da receita');
  const json=JSON.parse((await downloadText(page,'#export-simulation')).text);expect(json.result).toEqual(saved.result);expect(json.monthlyDre).toEqual(saved.monthlyDre);expect(json.drePresentation.version).toBe('DRE_PRESENTATION_V1');
  await page.getByRole('button',{name:'Anual',exact:true}).click();
  await page.locator('#dre-report-period').selectOption('annual');
  await page.evaluate(()=>{window.print=()=>{};});
  await page.locator('#print-dre').click();await page.locator('#print-dre').click();
  await expect(page.locator('#dre-print-document')).toHaveCount(1);await expect(page.locator('#dre-print-document > .dre-table-wrap > table')).toHaveCount(1);await expect(page.locator('#dre-print-document > .dre-table-wrap thead th')).toHaveCount(5);
  await expect(page.locator('#dre-print-document')).toContainText('EMPRESA SINTÉTICA DRE');await expect(page.locator('#dre-print-document')).toContainText('RBT12 fixa: R$ 150.000,00');
  expect(await page.locator('#dre-print-page-style').textContent()).toContain('A4 landscape');await expect(page.locator('#dre-print-document')).toContainText('Memória consolidada de cálculo');await expect(page.locator('#dre-print-document [data-report-part="monthly"]')).toHaveCount(0);
  await page.emulateMedia({media:'print'});await expect(page.locator('.shell')).toBeHidden();await expect(page.locator('#dre-print-document')).toBeVisible();await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('#dre-print-document,#dre-print-page-style')).toHaveCount(0);await expect(page.locator('body')).not.toHaveClass(/dre-print-only/);await expect(page.locator('#print-dre')).toBeFocused();
  await page.locator('#print-dre').click();await page.emulateMedia({media:'print'});await expect(page.locator('.shell')).toBeHidden();await expect(page.locator('#dre-print-document')).toBeVisible();const pdf=info.outputPath('dre-unica-anual.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});await info.attach('DRE única anual',{path:pdf,contentType:'application/pdf'});await page.emulateMedia({media:'screen'});
  await expect(page.locator('#dre-print-document,#dre-print-page-style')).toHaveCount(0);await expect(page.locator('.sim-charts-details')).toHaveAttribute('open','');

});
test('Calendário único conserva meses distintos, modo móvel e impressão mensal isolada',async({page},info)=>{
  const saved=fixture(),row=saved.monthlyDre.regimes[0].rows.find((item:any)=>item.key==='revenue')!;
  row.months[0]=7777.77;row.months[11]=8888.88;row.annual=999999.99;
  await open(page,saved);await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(3);
  await page.getByRole('button',{name:'12 meses',exact:true}).click();
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(14);
  const revenue=page.locator('.dre-calendar-screen [data-dre-row="revenue"]');await expect(revenue.locator('td').first()).toContainText('7.777,77');await expect(revenue.locator('td').nth(11)).toContainText('8.888,88');await expect(revenue.locator('td').last()).toContainText('999.999,99');
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();await page.locator('#dre-month').selectOption('11');
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(3);await expect(page.locator('.dre-calendar-screen [data-dre-row="revenue"] td').first()).toContainText('8.888,88');
  for(const width of [390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const metrics=await page.locator('.dre-calendar-screen').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,table:el.querySelector('table')!.getBoundingClientRect().width}));expect(metrics.scroll,JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.client+1);await expect(page.locator('[data-revenue-mobile]')).toBeVisible();await expect(page.locator('[data-revenue-mobile-row="revenueUsed"] [data-revenue-mobile-value]')).toHaveText('R$ 8.888,88');await expect(page.locator('[data-revenue-mobile-row="revenueUsed"] [data-revenue-mobile-annual]')).toContainText('999.999,99');}
  const mobile=info.outputPath('dre-completa-mobile.png');await page.locator('.dre-complete').screenshot({path:mobile});await info.attach('DRE completa no celular',{path:mobile,contentType:'image/png'});
  await page.setViewportSize({width:1440,height:1100});await page.getByRole('button',{name:'12 meses',exact:true}).click();
  const desktop=info.outputPath('dre-completa-desktop.png');await page.locator('.dre-complete').screenshot({path:desktop});await info.attach('DRE completa desktop',{path:desktop,contentType:'image/png'});
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();
  await page.locator('#dre-report-period').selectOption('monthly');
  await page.evaluate(()=>{window.print=()=>{};(window as any).__drePrint=[];window.addEventListener('beforeprint',()=>{const doc=document.querySelector('#dre-print-document')!;(window as any).__drePrint.push({monthlyParts:doc.querySelectorAll('[data-report-part="monthly"]').length,monthlyTables:doc.querySelectorAll('.dre-print-monthly-table > table').length,annualParts:doc.querySelectorAll('[data-report-part="annual"]').length,closingRows:doc.querySelectorAll('[data-revenue-reconciliation="dre"] [data-dre-row]').length,text:doc.textContent,page:document.querySelector('#dre-print-page-style')?.textContent});});});
  await page.locator('#print-dre').click();await expect(page.locator('#dre-print-document .dre-print-monthly-table > table')).toHaveCount(4);await expect(page.locator('#dre-print-document .dre-print-monthly-table > table > tbody')).toHaveCount(4);
  await page.emulateMedia({media:'print'});await expect(page.locator('.shell')).toBeHidden();await expect(page.locator('#dre-print-document')).toBeVisible();
  const pdf=info.outputPath('dre-unica-mensal.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});await info.attach('DRE mensal única em PDF',{path:pdf,contentType:'application/pdf'});await page.emulateMedia({media:'screen'});
  const printed=await page.evaluate(()=>(window as any).__drePrint);expect(printed).toHaveLength(1);expect(printed[0].monthlyParts).toBe(4);expect(printed[0].monthlyTables).toBe(4);expect(printed[0].annualParts).toBe(0);expect(printed[0].closingRows).toBe(20);expect(printed[0].page).toContain('A3 landscape');
  for(const value of ['Janeiro','Dezembro','Simples Puro','EMPRESA SINTÉTICA DRE','2027','7.777,77','8.888,88','999.999,99','RBT12 fixa: R$ 150.000,00'])expect(printed[0].text).toContain(value);
  expect(printed[0].text).not.toContain('Memória de cálculo completa');expect(printed[0].text).not.toContain('Janeiro a junho');
  await expect(page.locator('#dre-print-document,#dre-print-page-style')).toHaveCount(0);await expect(page.locator('body')).not.toHaveClass(/dre-print-only/);await expect(page.locator('#dre-month')).toHaveValue('11');await expect(page.locator('#simulation-result details[open]')).toHaveCount(0);

});
test('serviços e DIFAL conciliam entre tela e CSV após reabrir histórico sem gravações',async({page})=>{
  const saved=fixture();
  const writes:string[]=[];
  page.on('request',request=>{
    if(request.url().includes('/api/') && !['GET','HEAD'].includes(request.method())) writes.push(request.method()+' '+request.url());
  });
  await open(page,saved);
  for(let visit=0;visit<2;visit++){
    if(visit) await page.reload();
    await expect(page.locator('.dre-complete > .dre-table-wrap > table')).toHaveCount(1);
    await expect(page.locator('#simulation-result details[open],dialog[open]')).toHaveCount(0);
    for(const [key,amount] of [['services','30.000,00'],['difal','3.600,00']]){
      const cells=page.locator(`.dre-complete [data-dre-row="${key}"] td`);
      await expect(cells).toHaveCount(4);
      for(const [index,cell] of (await cells.allTextContents()).entries()) expect(cell).toContain(key==='difal'&&index>1?'0,00':amount);
    }
    await page.locator('#dre-report-period').selectOption('annual');
    const annual=(await downloadText(page,'#export-dre-csv')).text;
    const annualDifal=annual.split('\r\n').filter(line=>line.includes('DIFAL sobre vendas (10%)'));
    expect(annualDifal).toHaveLength(1);
    expect(annualDifal[0].split(';').slice(5,9)).toEqual(['-3600,00','-3600,00','0,00','0,00']);
    const annualServices=annual.split('\r\n').filter(line=>line.startsWith('"DRE";')&&line.includes('"Receita de serviços"'));
    expect(annualServices).toHaveLength(1);
    expect(annualServices[0].split(';').slice(5,9)).toEqual(Array(4).fill('30000,00'));
    await page.getByRole('button',{name:'Mensal',exact:true}).click();
    await page.getByRole('button',{name:'12 meses',exact:true}).click();
    await page.locator('#dre-report-period').selectOption('monthly');
    const monthly=(await downloadText(page,'#export-dre-csv')).text;
    const monthlyDifal=monthly.split('\r\n').filter(line=>line.includes('DIFAL sobre vendas (10%)'));
    expect(monthlyDifal).toHaveLength(4);
    const monthlyServices=monthly.split('\r\n').filter(line=>line.includes(';"DRE";')&&line.includes('"Receita de serviços"'));
    expect(monthlyServices).toHaveLength(4);
    for(const line of monthlyServices) expect(line.split(';').slice(6,19)).toEqual([...Array(12).fill('2500,00'),'30000,00']);
    for(const [index,line] of monthlyDifal.entries()) expect(line.split(';').slice(6,19)).toEqual(index<2?[...Array(12).fill('-300,00'),'-3600,00']:Array(13).fill('0,00'));
    for(const regime of saved.result.regimes){
      await page.locator('#dre-regime').selectOption(regime.id);
      await expect(page.locator('.dre-complete > .dre-table-wrap > table')).toHaveCount(1);
      for(const [key,amount,total] of [['services','2.500,00','30.000,00'],['difal', ['pure','hybrid'].includes(regime.id)?'300,00':'0,00', ['pure','hybrid'].includes(regime.id)?'3.600,00':'0,00']]){
        const cells=page.locator(`.dre-complete [data-dre-row="${key}"] td`);
        await expect(cells).toHaveCount(13);
        for(const cell of (await cells.allTextContents()).slice(0,12)) expect(cell).toContain(amount);
        await expect(cells.last()).toContainText(total);
      }
    }
    const exported=JSON.parse((await downloadText(page,'#export-simulation')).text);
    expect(exported.result).toEqual(saved.result);
    expect(exported.monthlyDre).toEqual(saved.monthlyDre);
    await page.getByRole('button',{name:'Anual',exact:true}).click();
  }
  expect(writes).toEqual([]);
});

test('DRE legada sem DIFAL não inventa valores e receita zero não recebe percentuais',async({page})=>{
  const saved=fixture();saved.draft.values={serviceRevenue:0,salesRevenue:0,simplePurchases:0,regularPurchases:0,salaries:100,benefits:0,adminExpenses:0,rent:0,cardExpenses:0};saved.result=calculateSimulation(saved.draft);saved.monthlyDre=buildMonthlyDre(saved.result,2027);saved.result.regimes[1].available=false;saved.monthlyDre.regimes[1].available=false;
  await open(page,saved);await page.locator('#dre-show-percent').check();
  await expect(page.locator('.dre-complete [data-dre-row="difal"]')).toHaveCount(0);
  const amounts=await page.locator('.dre-complete > .dre-table-wrap .dre-percent').allTextContents();expect(amounts.length).toBeGreaterThan(0);expect(amounts.every(value=>value==='—')).toBe(true);
  await expect(page.locator('.dre-complete [data-dre-row="revenue"] td').nth(1)).toHaveText('——');
  await expect(page.locator('.dre-result-card')).toHaveClass(/is-loss/);
  await expect(page.locator('.dre-result-card')).toContainText('Prejuízo estimado');
  await expect(page.locator('.dre-result-card [data-dre-summary="margin"]')).toHaveText('—');
  await page.locator('#dre-regime').selectOption('hybrid');await expect(page.locator('[data-dre-summary="result"]')).toHaveText('—');
  await expect(page.locator('.dre-result-card')).toHaveClass(/is-unavailable/);await expect(page.locator('.dre-flow-bars')).toHaveCount(0);
  await expect(page.locator('.dre-complete')).not.toContainText('NaN');await expect(page.locator('.dre-complete')).not.toContainText('Infinity');
});

test('relatório completo inicia no anual e reúne quatro regimes, competência real, diagnóstico e memória',async({page},info)=>{
  const original=fixture(),draft={...original.draft,rbt12:3300000};
  const reports=[120000000,110000000,100000000].map((sales,index)=>({operationVersion:'NATURE_OPERATIONS_2026_10_V1',sourceMonth:`2025-0${index+1}`,month:index+1,salesLines:1,purchaseLines:1,
    operationAudit:{grossSalesCents:sales+100000,serviceSalesCents:0,salesReturnsCents:100000},
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:sales,purchasesOptantCents:0,purchasesNonOptantCents:10000000,serviceRevenueCents:0},
    difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:0,baseCents:0,eligibleLines:0,pendingLines:0}}));
  const period={startMonth:'2025-01',endMonth:'2025-03',months:3},reference={source:'MANUAL',confirmed:true,rbt12Cents:330000000};
  const computed=calculateMonthlySimulation(draft,reports,reports.map(row=>baselineMonth(row)),original.source.sales.jobId);
  const saved={...original,...computed,draft,reportMonths:3,periodBasis:'COLUMN_H',rbt12Manual:reference,source:{...original.source,monthlyReports:reports,reportMonths:3,period,fields:computed.projection.annualGroupsCents},monthlyDre:buildMonthlyDre(computed.result,2027,reference,period)};
  const before=JSON.stringify(saved),errors:string[]=[],writes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method());});
  await open(page,saved);
  await expect(page.getByRole('button',{name:'Anual',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#dre-report-period')).toHaveValue('complete');
  await expect(page.locator('[data-report-coverage]')).toContainText('3 de 12 competências');
  await expect(page.locator('[data-simples-diagnostic]')).toContainText('Cálculo disponível');
  await expect(page.locator('[data-simples-diagnostic]')).toContainText('3.300.000,00');
  await expect(page.locator('[data-dre-summary="revenue"]')).toHaveText('R$ 3.300.000,00');
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await page.locator('[data-simples-diagnostic]').screenshot({path:info.outputPath('simples-33-milhoes-mobile.png')});
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await expect(page.locator('#dre-report-period')).toHaveValue('complete');
  await expect(page.locator('[data-dre-summary="revenue"]')).toHaveText('R$ 1.200.000,00');
  const csv=await downloadText(page,'#export-dre-csv');expect(csv.name).toBe('dre-DRE-2027-completo.csv');
  expect(csv.text).toContain('Relatório completo');expect(csv.text).toContain('3 de 12 competências');
  const revenueRows=csv.text.split('\r\n').filter(line=>line.includes('"Receita total utilizada"'));
  expect(revenueRows).toHaveLength(5);expect(revenueRows[0]).toContain(';3300000,00;3300000,00;3300000,00;3300000,00;');
  for(const row of revenueRows.slice(1))expect(row).toContain(';1200000,00;1100000,00;1000000,00;"Não disponível"');
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  const print=page.locator('#dre-print-document');
  await expect(print.locator('[data-report-part="annual"]')).toHaveCount(1);await expect(print.locator('[data-report-part="monthly"]')).toHaveCount(4);
  await expect(print.locator('[data-report-part="references"]')).toHaveCount(1);await expect(print.locator('[data-revenue-reconciliation="dre"]')).toHaveCount(5);
  await expect(print.locator('[data-revenue-reconciliation="dre"]').first()).toContainText('3.303.000,00');await expect(print.locator('[data-revenue-reconciliation="dre"]').first()).toContainText('3.000,00');
  await expect(print).toContainText('Cenário 2027');await expect(print).toContainText('Origem: 2025-01');await expect(print).toContainText('CBS de 9,11%');await expect(print).toContainText('R$ 3.300.000,00');
  const parts=await print.locator('[data-report-part]').evaluateAll(elements=>elements.map(element=>(element as HTMLElement).dataset.reportPart));expect(parts).toEqual(['annual','monthly','monthly','monthly','monthly','references']);
  await page.emulateMedia({media:'print'});await expect(page.locator('.shell')).toBeHidden();await expect(print).toBeVisible();
  const pdf=info.outputPath('dre-relatorio-completo-33-milhoes.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});await info.attach('Relatório completo anual e mensal',{path:pdf,contentType:'application/pdf'});
  await page.emulateMedia({media:'screen'});await expect(page.locator('#dre-print-document')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Mensal',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);expect(writes).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});

test('memória histórica completa conserva o anual e oculta valores pendentes ao selecionar um mês válido',async({page})=>{
  const original=fixture(),reports=[100000,150000].map((sales,index)=>({sourceMonth:`2025-0${index+1}`,month:index+1,salesLines:1,purchaseLines:1,
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:sales,purchasesOptantCents:0,purchasesNonOptantCents:20000,serviceRevenueCents:0},
    difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0}}));
  const period={startMonth:'2025-01',endMonth:'2025-02',months:2};
  const computed=calculateMonthlySimulation(original.draft,reports,reports.map(row=>baselineMonth(row)),original.source.sales.jobId);
  // Emulate an older saved calculation: January is valid, February blocks the annual Simples total,
  // but its raw memory still contains numeric derived values from the unsupported calculation.
  for(const result of [computed.result,computed.result.monthlyResults[1].result]){
    delete result.simplesDiagnostic;
    for(const regime of result.regimes.filter(item=>['pure','hybrid'].includes(item.id))){
      regime.available=false;regime.status='2025-02: conferência da RBT12 necessária.';
    }
  }
  const memory=(id:string)=>computed.result.memory.find(item=>item.id===id)!;
  Object.assign(memory('simples.pureDas'),{unit:'currency',value:98765.43});
  Object.assign(memory('simples.hybridDas'),{unit:'currency',value:87654.32});
  Object.assign(memory('dre.pure.netProfit'),{unit:'currency',value:76543.21});
  Object.assign(memory('summary.pure.taxes'),{unit:'currency',value:65432.10});
  computed.result.memory.push({...original.result.memory.find(item=>item.id==='summary.pure.margin')!,unit:'percent',value:0.42});
  memory('dre.actual.revenue').label='Receita bruta total';
  memory('dre.actual.netRevenue').label='Receita líquida';
  const saved={...original,...computed,reportMonths:2,periodBasis:'COLUMN_H',source:{...original.source,monthlyReports:reports,reportMonths:2,period,fields:computed.projection.annualGroupsCents},
    monthlyDre:buildMonthlyDre(computed.result,2027,original.rbt12Manual,period)};
  const before=JSON.stringify(saved),writes:string[]=[],errors:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method());});
  page.on('pageerror',error=>errors.push(error.message));
  await open(page,saved);await page.locator('.sim-memory > summary').click();
  const complete=page.locator('.sim-memory');
  await expect(complete.locator('[data-memory-id]')).toHaveCount(saved.result.memory.length);
  await expect(complete.locator('summary')).toContainText(`${saved.result.memory.length} itens`);
  await expect(complete.locator('[data-memory-id="dre.actual.revenue"] strong')).toHaveText('Receita total utilizada');
  await expect(complete.locator('[data-memory-id="dre.actual.netRevenue"] strong')).toHaveText('Receita após deduções tributárias');
  const checkAnnualMemory=async()=>{
    await expect(complete.locator('[data-memory-id="dre.actual.revenue"] > span')).toHaveText('R$ 2.500,00');
    for(const key of ['simples.pureDas','simples.hybridDas','dre.pure.netProfit','summary.pure.taxes','summary.pure.margin'])
      await expect(complete.locator(`[data-memory-id="${key}"] > span`)).toContainText('Não disponível');
    for(const value of ['98.765,43','87.654,32','76.543,21','65.432,10'])await expect(complete).not.toContainText(value);
  };
  await checkAnnualMemory();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await page.locator('#dre-regime').selectOption('pure');await page.locator('#dre-month').selectOption('0');
  await expect(page.locator('[data-dre-summary="revenue"]')).toHaveText('R$ 1.000,00');
  await expect(complete).toHaveAttribute('open','');await checkAnnualMemory();
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('[data-dre-summary="revenue"]')).toHaveText('—');await checkAnnualMemory();
  await page.getByRole('button',{name:'Anual',exact:true}).click();await checkAnnualMemory();
  const exported=JSON.parse((await downloadText(page,'#export-simulation')).text);
  expect(exported.result).toEqual(saved.result);expect(exported.result.memory.find((item:any)=>item.id==='simples.pureDas').value).toBe(98765.43);
  expect(exported.result.memory.find((item:any)=>item.id==='dre.actual.revenue').label).toBe('Receita bruta total');
  expect(JSON.stringify(saved)).toBe(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
});
