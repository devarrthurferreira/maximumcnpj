import {test,expect} from '@playwright/test';
import {calculateSimulation,draftToInput,TAX_SOURCES,MODEL_VERSION,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
import {annualizeReports,projectDifal} from '../../public/simulator-projection.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
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
test('DRE agrupa valores salvos, preserva escolhas e exporta composição sem alterar snapshot',async({page})=>{
  const saved=fixture();saved.result.regimes[0].dre.netProfit=123456.78;saved.result.regimes[0].annualProfit=123456.78;
  await open(page,saved);
  await expect(page.locator('.dre-complete > .dre-table-wrap [data-dre-section]')).toHaveCount(5);
  await expect(page.locator('.dre-complete > .dre-table-wrap [data-dre-row]')).toHaveCount(31);
  await expect(page.locator('.dre-complete [data-dre-row="netProfit"] td').first()).toContainText('123.456,78');
  await expect(page.locator('#dre-show-percent')).not.toBeChecked();await expect(page.locator('.dre-complete details[open]')).toHaveCount(0);
  await page.locator('#dre-show-percent').check();await expect(page.locator('.dre-complete [data-dre-row="revenue"] .dre-percent').first()).toHaveText('100%');
  await expect(page.locator('.dre-complete [data-dre-row="difal"] .dre-percent').first()).toHaveText('-2,4%');
  await page.locator('[data-state-key="dre-indicators"] summary').click();await page.locator('[data-state-key="dre-icmsCredits"] summary').click();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await page.locator('#dre-regime').selectOption('actual');
  await expect(page.locator('[data-state-key="dre-indicators"]')).toHaveAttribute('open','');await expect(page.locator('[data-state-key="dre-icmsCredits"]')).toHaveAttribute('open','');
  await expect(page.locator('#dre-show-percent')).toBeChecked();await page.locator('[data-state-key="dre-method"] summary').click();
  await page.getByRole('button',{name:'Anual',exact:true}).click();await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('[data-state-key="dre-method"]')).toHaveAttribute('open','');
  await expect(page.locator('#dre-regime')).toHaveValue('actual');
  const csv=await downloadText(page,'#export-dre-csv');expect(csv.name).toBe('dre-DRE-2027-mensal.csv');expect(csv.text).toContain('Janeiro');expect(csv.text).toContain('Dezembro');expect(csv.text).toContain('Lucro Real');expect(csv.text).toContain('Simples Puro');expect(csv.text).toContain('% da receita');
  const json=JSON.parse((await downloadText(page,'#export-simulation')).text);expect(json.result).toEqual(saved.result);expect(json.monthlyDre).toEqual(saved.monthlyDre);expect(json.drePresentation.version).toBe('DRE_PRESENTATION_V1');
});
test('Calendário capturado conserva meses distintos, modo móvel e impressão dos dois semestres',async({page},info)=>{
  const saved=fixture(),row=saved.monthlyDre.regimes[0].rows.find((item:any)=>item.key==='revenue')!;
  row.months[0]=7777.77;row.months[11]=8888.88;row.annual=999999.99;
  await open(page,saved);await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(14);
  const revenue=page.locator('.dre-calendar-screen [data-dre-row="revenue"]');await expect(revenue.locator('td').first()).toContainText('7.777,77');await expect(revenue.locator('td').nth(11)).toContainText('8.888,88');await expect(revenue.locator('td').last()).toContainText('999.999,99');
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();await page.locator('#dre-month').selectOption('11');
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(3);await expect(page.locator('.dre-calendar-screen [data-dre-row="revenue"] td').first()).toContainText('8.888,88');
  for(const width of [390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const metrics=await page.locator('.dre-calendar-screen').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,table:el.querySelector('table')!.getBoundingClientRect().width}));expect(metrics.scroll,JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.client+1);}
  const mobile=info.outputPath('dre-completa-mobile.png');await page.locator('.dre-complete').screenshot({path:mobile});await info.attach('DRE completa no celular',{path:mobile,contentType:'image/png'});
  await page.setViewportSize({width:1440,height:1100});await page.getByRole('button',{name:'12 meses',exact:true}).click();
  const desktop=info.outputPath('dre-completa-desktop.png');await page.locator('.dre-complete').screenshot({path:desktop});await info.attach('DRE completa desktop',{path:desktop,contentType:'image/png'});
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();
  await page.evaluate(()=>{(window as any).__drePrint=[];window.addEventListener('beforeprint',()=>{(window as any).__drePrint.push({semesters:document.querySelectorAll('.dre-print-semester').length,text:document.querySelector('.dre-print-calendar')?.textContent,open:document.querySelectorAll('.dre-complete details:not([open])').length});});});
  const pdf=info.outputPath('dre-completa-semestrais.pdf');await page.pdf({path:pdf,format:'A4',printBackground:true});await info.attach('DRE completa em PDF',{path:pdf,contentType:'application/pdf'});
  const printed=await page.evaluate(()=>(window as any).__drePrint);expect(printed).toHaveLength(1);expect(printed[0].semesters).toBe(2);expect(printed[0].open).toBe(0);for(const value of ['Janeiro a junho','Julho a dezembro','Simples Puro','7.777,77','8.888,88','999.999,99'])expect(printed[0].text).toContain(value);
  await expect(page.locator('.dre-print-calendar')).toHaveCount(0);await expect(page.locator('.dre-complete details[open]')).toHaveCount(0);await expect(page.locator('#dre-month')).toHaveValue('11');
});
test('DRE legada sem DIFAL não inventa valores e receita zero não recebe percentuais',async({page})=>{
  const saved=fixture();saved.draft.values={serviceRevenue:0,salesRevenue:0,simplePurchases:0,regularPurchases:0,salaries:100,benefits:0,adminExpenses:0,rent:0,cardExpenses:0};saved.result=calculateSimulation(saved.draft);saved.monthlyDre=buildMonthlyDre(saved.result,2027);saved.result.regimes[1].available=false;saved.monthlyDre.regimes[1].available=false;
  await open(page,saved);await page.locator('#dre-show-percent').check();
  await expect(page.locator('.dre-complete [data-dre-row="difal"]')).toHaveCount(0);
  const amounts=await page.locator('.dre-complete > .dre-table-wrap .dre-percent').allTextContents();expect(amounts.length).toBeGreaterThan(0);expect(amounts.every(value=>value==='—')).toBe(true);
  await expect(page.locator('.dre-complete [data-dre-row="revenue"] td').nth(1)).toHaveText('——');
  await expect(page.locator('.dre-complete')).not.toContainText('NaN');await expect(page.locator('.dre-complete')).not.toContainText('Infinity');
});
