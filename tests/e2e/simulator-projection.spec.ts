import {readStatement,mockStatement} from './extrato-helper.ts';
import {section22} from '../fixtures/section22.ts';
import {test,expect,type Page} from '@playwright/test';
import {annualizeReports,projectScenario} from '../../public/simulator-projection.js';
import {calculateSimulation,draftToInput,MODEL_VERSION,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
const generation='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222';
const period={startDate:'2026-04-02',endDate:'2026-07-29',startMonth:'2026-04',endMonth:'2026-07',months:4,observedMonths:4,missingMonths:[]};
const fields={salesOptantCents:16000000,salesNonOptantCents:20000000,salesCpfCents:4000000,purchasesOptantCents:8000000,purchasesNonOptantCents:16000000};
const source={generationId:generation,clientId:client,company:{code:'936',name:'Empresa demonstração'},periodBasis:'COLUMN_H',reportMonths:4,period,fields,projection:annualizeReports(fields,4),warnings:[],
 purchases:{jobId:'33333333-3333-4333-8333-333333333333',fileName:'compras.csv',totalCents:24000000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-01T15:00:00Z',period},
 sales:{jobId:'44444444-4444-4444-8444-444444444444',fileName:'vendas.csv',totalCents:40000000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-01T15:00:00Z',period:{...period,startDate:'2026-04-01',endDate:'2026-07-31'}}};
const url=`/simulator.html?generation=${generation}&client=${client}`;
async function setup(page:Page){
 await mockStatement(page,88888888);
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'projection-tester',name:'Teste',role:'operator'}}}));
 await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:source}));
 await page.route('**/api/v4/simulations',r=>{const body=r.request().postDataJSON();return r.fulfill({status:201,json:{_id:body.simulationId,source,projection:{...source.projection,scenario:projectScenario(body.monthlyGroups,body.draft.values)},rbt12Source:'SIMPLES_SECTION_22',rbt12Extraction:{id:body.rbt12ExtractionId,...section22(88888888)},draft:body.draft,result:calculateSimulation(body.draft),engineInput:draftToInput(body.draft),monthlyGroups:body.monthlyGroups,reportMonths:4,periodBasis:'COLUMN_H',periodConfirmed:true,manuallyAdjusted:true,adjustments:[],generationId:generation,clientId:client,company:source.company,createdAt:'2026-10-01T15:00:00Z',createdBy:{id:'projection-tester',name:'Teste'},modelVersion:MODEL_VERSION,taxSources:TAX_SOURCES,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT}});});
}
test('4 meses viram média e 12 meses iguais, com conferência responsiva e RBT12 independente',async({page},info)=>{
 await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1100});await page.goto(url);
 await expect(page.locator('#period-months')).toHaveValue('4');await expect(page.locator('#period-months')).toBeDisabled();
 await expect(page.locator('#period-confirm')).toBeChecked();await expect(page.locator('#salesRevenue')).toHaveValue('100000.00');
 await expect(page.locator('[data-projection-total]')).toContainText('400.000,00');await expect(page.locator('[data-projection-monthly]')).toContainText('100.000,00');
 await expect(page.locator('[data-projection-annual]')).toContainText('1.200.000,00');await expect(page.locator('.projection-month')).toHaveCount(12);
 const desktop=info.outputPath('projecao-desktop.png');await page.screenshot({path:desktop});await info.attach('Projeção desktop',{path:desktop,contentType:'image/png'});
 await page.locator('[data-projection-kind="purchases"]').click();await expect(page.locator('[data-projection-annual]')).toContainText('720.000,00');
 await page.locator('.projection-memory summary').click();await expect(page.locator('.projection-memory tbody tr')).toHaveCount(5);
 await readStatement(page,88888888);
 for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill(id==='serviceRevenue'?'2000':'0');
 await page.locator('#salesCpfCents').fill('10100');
 await expect(page.locator('.projection-adjusted')).toBeVisible();await page.locator('[data-projection-kind="sales"]').click();
 await expect(page.locator('[data-projection-annual]')).toContainText('1.200.000,00');await expect(page.locator('#annual-revenue')).toContainText('1.225.200,00');
 const savedEvent=page.waitForResponse(r=>r.url().endsWith('/api/v4/simulations')&&r.request().method()==='POST');
 await page.locator('#generate-simulation').click();const saved=await(await savedEvent).json();
 expect(saved.projection.scenario.annual.revenueCents).toBe(122520000);expect(saved.engineInput.rbt12).toBe(888888.88);expect(saved.projection.timeline).toHaveLength(12);
 await expect(page.locator('.sim-regime')).toHaveCount(4);await expect(page.locator('.sim-dre')).toBeVisible();
 const results=info.outputPath('projecao-resultados.png');await page.locator('#simulation-result').screenshot({path:results});await info.attach('Resultados',{path:results,contentType:'image/png'});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
 const mobile=info.outputPath('projecao-mobile.png');await page.screenshot({path:mobile});await info.attach('Projeção mobile',{path:mobile,contentType:'image/png'});
 // A read must show stored results, even if those differ from today's browser engine.
 saved.result.regimes[0].annualProfit=123456.78;
 await page.route('**/api/v4/simulations/'+saved._id,r=>r.fulfill({json:saved}));
 let rereads=0;await page.route('**/api/v4/generations/*/simulator?*',r=>{rereads++;return r.fulfill({status:500,json:{message:'Do not reread'}});});
 await page.goto('/simulator.html?simulation='+saved._id);await expect(page.locator('[data-projection-annual]')).toContainText('1.200.000,00');
 await expect(page.locator('.sim-regime').first()).toContainText('123.456,78');expect(rereads).toBe(0);expect(errors).toEqual([]);
});
test('Rascunho de 12 meses não sobrescreve a média automática de quatro competências',async({page})=>{
 await setup(page);await page.goto(url);await expect(page.locator('#salesRevenue')).toHaveValue('100000.00');
 await page.evaluate(({generation,client,source})=>{
  const key=`maximum-simulator:v1:projection-tester:${generation}:${client}:${source.purchases.jobId}:${source.sales.jobId}`;
  sessionStorage.setItem(key,JSON.stringify({months:12,confirmed:true,edited:true,fields:{salesOptantCents:'1.00',salesNonOptantCents:'1.00',salesCpfCents:'1.00',purchasesOptantCents:'1.00',purchasesNonOptantCents:'1.00',serviceRevenue:'2000.00',rbt12:'888888.88'}}));
 },{generation,client,source});
 await page.reload();await expect(page.locator('#salesRevenue')).toHaveValue('100000.00');await expect(page.locator('#period-months')).toHaveValue('4');
 await expect(page.locator('#serviceRevenue')).toHaveValue('2000.00');await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('.projection-adjusted')).toHaveCount(0);
});
