import {readStatement,mockStatement} from './extrato-helper.ts';
import {section22} from '../fixtures/section22.ts';
import {test,expect,type Page} from '@playwright/test';
import {annualizeReports,projectScenario} from '../../public/simulator-projection.js';
import {calculateSimulation,createEmptyDraft,draftToInput,MODEL_VERSION,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
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
 await expect(page.locator('.projection-timeline')).toBeVisible();await expect(page.locator('#period-months')).toBeVisible();
 await expect(page.locator('#rbt12-pdf')).toBeVisible();
 const desktop=info.outputPath('projecao-desktop.png');await page.screenshot({path:desktop});await info.attach('Projeção desktop',{path:desktop,contentType:'image/png'});
 await page.locator('.projection-memory summary').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.projection-timeline')).toBeHidden();
 await page.locator('.projection-memory summary').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.projection-timeline')).toBeVisible();
 await page.locator('[data-projection-kind="purchases"]').click();await expect(page.locator('[data-projection-annual]')).toContainText('720.000,00');
 await expect(page.locator('.projection-timeline')).toBeVisible();await expect(page.locator('.projection-memory tbody tr')).toHaveCount(5);
 await page.locator('.projection-memory summary').focus();await page.keyboard.press('Enter');await expect(page.locator('.projection-timeline')).toBeHidden();
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

test('Serviços do relatório são preenchidos separados das mercadorias e restaurados sem duplicar receita',async({page},info)=>{
 const splitFields={...fields,serviceRevenueCents:8000000};
 const splitSource={...source,revenueSplit:{version:'SALES_SERVICES_V1'},fields:splitFields,projection:annualizeReports(splitFields,4),sales:{...source.sales,totalCents:48000000,servicesTotalCents:8000000,difal:{version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:10,baseCents:4000000,amountCents:400000,pendingLines:0}}};
 await setup(page);await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:splitSource}));await page.goto(url);
 await expect(page.locator('#serviceRevenue')).toHaveValue('20000.00');await expect(page.locator('#serviceRevenue-help')).toContainText('9000');
 await expect(page.locator('#salesRevenue')).toHaveValue('100000.00');await expect(page.locator('#monthly-revenue')).toContainText('120.000,00');
 await expect(page.locator('[data-projection-total]')).toContainText('480.000,00');await expect(page.locator('.projection-memory tbody tr')).toHaveCount(6);
 await expect(page.locator('.projection-memory')).toContainText('Vendas de serviços');
 for(const [size,width] of [['desktop',1440],['mobile',390]] as const){
  await page.setViewportSize({width,height:1000});const shot=info.outputPath(`servicos-difal-${size}.png`);await page.locator('#sim-section-revenue').screenshot({path:shot});await info.attach(`Serviços e DIFAL ${size}`,{path:shot,contentType:'image/png'});
 }
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('#serviceRevenue').fill('25000');await expect(page.locator('#monthly-revenue')).toContainText('125.000,00');await expect(page.locator('.projection-adjusted')).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());await page.locator('#restore-reports').click();await expect(page.locator('#serviceRevenue')).toHaveValue('20000.00');await expect(page.locator('#monthly-revenue')).toContainText('120.000,00');
 // A draft written before the service split must not restore combined sales plus manual services.
 await page.evaluate(({generation,client,source})=>{
  const key=`maximum-simulator:v1:projection-tester:${generation}:${client}:${source.purchases.jobId}:${source.sales.jobId}`;
  sessionStorage.setItem(key,JSON.stringify({projectionVersion:'AVERAGE_X12_V1',months:4,confirmed:true,edited:true,fields:{salesOptantCents:'60000.00',salesNonOptantCents:'50000.00',salesCpfCents:'10000.00',serviceRevenue:'20000.00',rent:'700.00'}}));
 },{generation,client,source});
 await page.reload();await expect(page.locator('#salesRevenue')).toHaveValue('100000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('20000.00');await expect(page.locator('#rent')).toHaveValue('700.00');await expect(page.locator('#monthly-revenue')).toContainText('120.000,00');
});


test('Nova versão legada separa os serviços e exige revisão do valor manual anterior',async({page})=>{
 const oldDraft:any=createEmptyDraft();for(const key of Object.keys(oldDraft.values))oldDraft.values[key]=0;
 oldDraft.rbt12=888888.88;oldDraft.values.salesRevenue=100000;oldDraft.values.serviceRevenue=2000;oldDraft.values.rent=700;oldDraft.values.simplePurchases=20000;oldDraft.values.regularPurchases=40000;
 const old={_id:'55555555-5555-4555-8555-555555555555',source,draft:oldDraft,result:calculateSimulation(oldDraft),engineInput:draftToInput(oldDraft),monthlyGroups:Object.fromEntries(Object.entries(fields).map(([key,amount])=>[key,amount/400])),reportMonths:4,periodBasis:'COLUMN_H',periodConfirmed:true,manuallyAdjusted:true,adjustments:[],generationId:generation,clientId:client,company:source.company,createdAt:'2026-10-01T15:00:00Z',createdBy:{id:'projection-tester',name:'Teste'},modelVersion:MODEL_VERSION,taxSources:TAX_SOURCES,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,rbt12Source:'MANUAL'};
 const splitFields={...fields,salesOptantCents:8000000,serviceRevenueCents:8000000};
 const current={...source,revenueSplit:{version:'SALES_SERVICES_V1'},fields:splitFields,projection:annualizeReports(splitFields,4),sales:{...source.sales,servicesTotalCents:8000000}};
 await setup(page);let reads=0,saves=0;
 await page.route('**/api/v4/generations/*/simulator?*',r=>{reads++;return r.fulfill({json:current});});
 await page.route('**/api/v4/simulations/'+old._id,r=>r.fulfill({json:old}));
 await page.route('**/api/v4/simulations',r=>{saves++;const body=r.request().postDataJSON();expect(body.monthlyGroups.salesOptantCents).toBe(20000);expect(body.draft.values.serviceRevenue).toBe(22000);expect(body.draft.values.salesRevenue).toBe(80000);expect(body.draft.values.rent).toBe(700);return r.fulfill({status:201,json:{...old,_id:body.simulationId,source:current,draft:body.draft,result:calculateSimulation(body.draft),engineInput:draftToInput(body.draft),monthlyGroups:body.monthlyGroups,projection:annualizeReports(splitFields,4)}});});
 await page.goto('/simulator.html?simulation='+old._id);expect(reads).toBe(0);await expect(page.locator('#simulation-snapshot')).toContainText('2.000,00');
 await page.locator('#create-version').click();await expect(page.locator('#salesRevenue')).toHaveValue('80000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('20000.00');await expect(page.locator('#rent')).toHaveValue('700.00');
 await expect(page.locator('#sim-service-migration')).toContainText('2.000,00');await expect(page.locator('#service-migration-confirm')).not.toBeChecked();
 await page.locator('#rbt12-manual-confirm').check();await page.locator('#generate-simulation').click();expect(saves).toBe(0);
 await page.locator('#serviceRevenue').fill('22000');await page.locator('#service-migration-confirm').check();
 await page.reload();await expect(page.locator('#serviceRevenue')).toHaveValue('22000.00');await expect(page.locator('#service-migration-confirm')).toBeChecked();
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');expect(saves).toBe(1);expect(reads).toBe(2);
 await expect(page.locator('#annual-revenue')).toContainText('1.224.000,00');
 // Failed source reconciliation leaves the original saved version readable.
 await page.goto('/simulator.html?simulation='+old._id);await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({status:409,json:{message:'Conclua os relatórios.'}}));
 await page.locator('#create-version').click();await expect(page.locator('#simulator-error')).toContainText('simulação salva foi preservada');await expect(page.locator('#simulation-snapshot')).toBeVisible();await expect(page.locator('#simulator-form')).toHaveCount(0);await expect(page.locator('#create-version')).toBeEnabled();
});
