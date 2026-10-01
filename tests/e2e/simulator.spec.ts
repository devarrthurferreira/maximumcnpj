import {test,expect} from '@playwright/test';
import {calculateSimulation,draftToInput,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT,MODEL_VERSION} from '../../public/simulator-engine.js';
const generation='00000000-0000-4000-8000-000000000001',client='00000000-0000-4000-8000-000000000002';
const source={generationId:generation,clientId:client,company:{code:'001',name:'EMPRESA SINTÉTICA'},
  purchases:{jobId:'00000000-0000-4000-8000-000000000003',fileName:'compras.csv',totalCents:450001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  sales:{jobId:'00000000-0000-4000-8000-000000000004',fileName:'vendas.csv',totalCents:1000001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  fields:{salesOptantCents:200001,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100001,purchasesNonOptantCents:350000},warnings:['Não confirmados incluídos em Não optantes.'],periodBasis:'REPORT_TOTALS'};
async function setup(page:any){
  await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',(r:any)=>r.fulfill({json:source}));
  await page.route('**/api/v4/simulations',(r:any)=>r.fulfill({status:201,json:snapshot(r.request().postDataJSON())}));
}
const url=`/simulator.html?generation=${generation}&client=${client}`;
function snapshot(body:any){return {_id:body.simulationId,generationId:generation,clientId:client,company:source.company,title:'Simulação de teste',source,draft:body.draft,result:calculateSimulation(body.draft),engineInput:draftToInput(body.draft),taxSources:TAX_SOURCES,monthlyGroups:body.monthlyGroups,monthlyGroupsUnit:'BRL',reportMonths:body.reportMonths,periodConfirmed:true,manuallyAdjusted:false,adjustments:[],createdAt:'2026-09-30T16:00:00Z',createdBy:{id:'operator',name:'Teste'},modelVersion:MODEL_VERSION,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,parentSimulationId:body.parentSimulationId||null};}
async function complete(page:any, values:any={}){await page.locator('#period-confirm').check();await page.locator('#rbt12').fill(String(values.rbt12??150000));for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill(String(values[id]??0));}

test('Verified report values populate five categories and require monthly inputs before computing original engine',async({page},info)=>{
  await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await expect(page.locator('#salesOptantCents')).toHaveValue('2000.01');
  await expect(page.locator('#salesNonOptantCents')).toHaveValue('5000.00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('3000.00');
  await expect(page.locator('#salesRevenue')).toHaveValue('10000.01');
  await expect(page.locator('#purchasesOptantCents')).toHaveValue('1000.01');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('3500.00');
  await expect(page.locator('#serviceRevenue')).toHaveValue('');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#results-top')).toHaveCount(0);
  await page.locator('#period-confirm').check();
  await page.locator('#rbt12').fill('150000');
  for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill('0');
  await expect(page.locator('#annual-revenue')).toContainText('120.000,12');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva no histórico');await expect(page.locator('.sim-regime')).toHaveCount(4);await expect(page.locator('.sim-dre')).toContainText('Indicador');
  await expect(page.locator('.sim-dre')).not.toContainText('NaN');
  const cells=await page.locator('.sim-dre tr').filter({hasText:'Receita bruta total'}).locator('td').allTextContents();expect(cells.every(t=>t.includes('120.000,12'))).toBe(true);
  const shot=info.outputPath('simulador-desktop.png');await page.screenshot({path:shot,fullPage:true});await info.attach('Simulador completo',{path:shot,contentType:'image/png'});
  const charts=info.outputPath('simulador-graficos-desktop.png');await page.locator('.sim-charts').screenshot({path:charts});await info.attach('Gráficos do simulador',{path:charts,contentType:'image/png'});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar memória da simulação'}).click();expect((await download).suggestedFilename()).toBe('simulacao-001-2027.json');
  await page.locator('#salesCpfCents').fill('3500');await expect(page.locator('#salesRevenue')).toHaveValue('10500.01');await expect(page.locator('#results-top')).toHaveCount(0);
  await page.reload();await expect(page.locator('#salesCpfCents')).toHaveValue('3500.00');await expect(page.locator('#serviceRevenue')).toHaveValue('0.00');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.locator('.sim-dre tbody th').first().evaluate(el=>getComputedStyle(el).position)).toBe('sticky');
  await page.locator('.sim-table-wrap').evaluate(el=>el.scrollLeft=350);await expect(page.locator('.sim-dre th').first()).toBeVisible();
  const mobile=info.outputPath('simulador-mobile.png');await page.screenshot({path:mobile,fullPage:true});await info.attach('Simulador mobile',{path:mobile,contentType:'image/png'});expect(errors).toEqual([]);
});
test('Multi-month normalization balances cents, restores reports, and isolates drafts by company',async({page})=>{
  await setup(page);await page.goto(url);await page.locator('#period-months').selectOption('3');
  await expect(page.locator('#salesRevenue')).toHaveValue('3333.34');
  const sum=await page.locator('#purchasesOptantCents,#purchasesNonOptantCents').evaluateAll(inputs=>inputs.reduce((total,input)=>total+Math.round(Number((input as HTMLInputElement).value)*100),0));expect(sum).toBe(150000);
  await expect(page.locator('#period-confirm')).not.toBeChecked();await page.locator('#serviceRevenue').fill('100');await page.locator('#salesCpfCents').fill('10');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Restaurar valores dos relatórios'}).click();await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('100');
  const other='00000000-0000-4000-8000-000000000009';await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:{...source,clientId:other}}));await page.goto(`/simulator.html?generation=${generation}&client=${other}`);await expect(page.locator('#serviceRevenue')).toHaveValue('');await expect(page.locator('#period-months')).toHaveValue('1');
});
test('Incomplete source or expired session never produces a simulator with fabricated zeroes',async({page})=>{
  await setup(page);await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({status:409,json:{message:'Conclua os relatórios de compras e vendas.'}}));await page.goto(url);await expect(page.locator('#simulator-error')).toContainText('Conclua');await expect(page.locator('#simulator-form')).toHaveCount(0);
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:null}}));await page.goto(url);await expect(page.getByRole('heading',{name:'Entre para continuar'})).toBeVisible();await expect(page.locator('#simulator-form')).toHaveCount(0);
});

test('Dashboard shows five charts, scales every monetary view and expands every notice in one summary',async({page})=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:1000,salaries:15000,rent:700});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  await expect(page.locator('.sim-chart-card')).toHaveCount(5);await expect(page.locator('.sim-chart-profit .is-negative')).toHaveCount(4);
  await expect(page.locator('#simulation-notices details')).toHaveCount(1);await expect(page.locator('#simulation-notices details')).not.toHaveAttribute('open','');
  await page.locator('#simulation-notices summary').click();await expect(page.locator('.sim-notices-content')).toContainText('RBT12 informada');await expect(page.locator('.sim-notices-content')).toContainText('Não confirmados incluídos');
  await expect(page.locator('.sim-notices-content article')).toHaveCount(9);
  const annual=await page.locator('.sim-chart-profit .sim-chart-row-head strong').allTextContents();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('.sim-dre .eyebrow')).toContainText('MENSAL');
  await expect(page.locator('.sim-chart-revenue .sim-chart-composition-summary strong')).toContainText('11.000,01');
  await expect(page.locator('.sim-chart-purchases .sim-chart-composition-summary strong')).toContainText('4.500,01');
  await expect(page.locator('.sim-chart-expense-total strong')).toContainText('15.700,00');
  const cells=await page.locator('.sim-dre tr').filter({hasText:'Receita bruta total'}).locator('td').allTextContents();expect(cells.every(t=>t.includes('11.000,01'))).toBe(true);
  const parse=(v:string)=>Number(v.replace(/[^0-9,-]/g,'').replace(',','.'));
  const monthly=await page.locator('.sim-chart-profit .sim-chart-row-head strong').allTextContents();monthly.forEach((v,i)=>expect(parse(v)).toBeCloseTo(parse(annual[i])/12,2));
  expect(await page.locator('#simulation-result').innerText()).not.toMatch(/NaN|Infinity/);
});
test('Saved detail only reads captured snapshot and opens an independent editable version',async({page})=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:2700,salaries:500});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/v4/simulations')&&r.method()==='POST');await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();const body=(await request).postDataJSON();const saved=snapshot(body);
  await expect(page.locator('#saved-simulation-link')).toBeVisible();
  // A previously captured result must not be recalculated with the current browser engine.
  saved.result.regimes[0].annualProfit=123456.78;saved.result.regimes[0].monthlyProfit=10288.065;saved.result.regimes[0].dre.netProfit=123456.78;
  await page.route('**/api/v4/simulations/'+saved._id,r=>r.fulfill({json:saved}));
  let sourceReads=0;await page.route('**/api/v4/generations/*/simulator?*',r=>{sourceReads++;return r.fulfill({status:500,json:{message:'Must not read current source'}});});
  await page.goto('/simulator.html?simulation='+saved._id);await expect(page.locator('#simulation-snapshot')).toContainText('2.700,00');await expect(page.locator('#simulator-form')).toHaveCount(0);expect(sourceReads).toBe(0);
  await expect(page.locator('.sim-regime').first()).toContainText('123.456,78');await expect(page.locator('#simulation-snapshot .sim-detail-grid strong')).toHaveCount(13);
  const downloadEvent=page.waitForEvent('download');await page.locator('#export-simulation').click();const download=await downloadEvent;const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;const exported=JSON.parse(text);expect(exported._id).toBe(saved._id);expect(exported.draft).toEqual(saved.draft);expect(exported.result).toEqual(saved.result);expect(exported.source).toEqual(source);
  await page.locator('#create-version').click();await expect(page.locator('#serviceRevenue')).toHaveValue('2700.00');await expect(page.locator('#period-confirm')).not.toBeChecked();await page.locator('#period-confirm').check();await page.locator('#serviceRevenue').fill('3000');
  const copyRequest=page.waitForRequest(r=>r.url().endsWith('/api/v4/simulations')&&r.method()==='POST');await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();const copy=(await copyRequest).postDataJSON();expect(copy.simulationId).not.toBe(saved._id);expect(copy.parentSimulationId).toBe(saved._id);expect(copy.draft.values.serviceRevenue).toBe(3000);expect(sourceReads).toBe(0);
});
test('Save is single-flight and failed retries preserve the exact immutable request',async({page})=>{
  await setup(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);const requests:any[]=[];
  await page.route('**/api/v4/simulations',async r=>{const body=r.request().postDataJSON();requests.push(body);if(requests.length===1){await gate;await r.fulfill({status:503,json:{message:'Falha temporária no salvamento.'}});}else await r.fulfill({status:201,json:snapshot(body)});});
  await page.goto(url);await complete(page);await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#serviceRevenue')).toBeDisabled();await expect(page.locator('#generate-simulation')).toBeDisabled();await expect(page.locator('#simulation-save-status')).toContainText('Salvando');expect(requests).toHaveLength(1);release();
  await expect(page.locator('#retry-save')).toBeVisible();await expect(page.locator('#simulation-save-status')).not.toContainText('Simulação salva');await expect(page.locator('#serviceRevenue')).toBeEnabled();
  await page.locator('#retry-save').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  await page.locator('#serviceRevenue').fill('100');await expect(page.locator('#simulation-result')).toBeEmpty();await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');expect(requests[2].simulationId).not.toBe(requests[0].simulationId);
});
test('Unavailable regimes and zero revenue never become misleading zero-valued comparisons',async({page})=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:500000});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');await expect(page.locator('.sim-chart-profit .sim-chart-unavailable')).toHaveCount(2);await expect(page.locator('.sim-regime').first()).toContainText('Indisponível');
  for(const id of ['salesOptantCents','salesNonOptantCents','salesCpfCents','serviceRevenue','purchasesOptantCents','purchasesNonOptantCents'])await page.locator('#'+id).fill('0');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');await expect(page.locator('.sim-kpis')).toContainText('Sem ranking');await expect(page.locator('.sim-chart-burden')).toContainText('Não aplicável');await expect(page.locator('#simulation-result')).not.toContainText('NaN');
});
