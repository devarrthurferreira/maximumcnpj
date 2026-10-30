import {legacyOutgoingDreFixture,legacyWithoutOutgoingDreFixture} from '../fixtures/dre-outgoing-legacy.mjs';
import {test,expect,type Page} from '@playwright/test';
import {annualizeReports,projectDifal} from '../../public/simulator-projection.js';
import {calculateSimulation,createEmptyDraft,draftToInput,MODEL_VERSION,OUTGOING_DIFAL_MESSAGE,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';

const generation='61080000-0000-4000-8000-000000000001',client='61080000-0000-4000-8000-000000000002';
const url=`/simulator.html?generation=${generation}&client=${client}`;
const fields={salesOptantCents:10000,salesNonOptantCents:20000,salesCpfCents:100000,purchasesOptantCents:1000,purchasesNonOptantCents:2000};
function source():any {
  return {generationId:generation,clientId:client,company:{code:'DIFAL',name:'Empresa sintética DIFAL'},periodBasis:'MANUAL',fields,warnings:[],
    purchases:{jobId:'61080000-0000-4000-8000-000000000003',fileName:'compras.csv',totalCents:3000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-09T15:00:00Z'},
    sales:{jobId:'61080000-0000-4000-8000-000000000004',fileName:'vendas.csv',totalCents:130000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-09T15:00:00Z',
      difal:{version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:15000,amountCents:1500,pendingLines:0}}};
}
async function setup(page:Page,report=source()) {
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'difal-simulator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:report}));
}
function savedSnapshot(report=source()):any {
  const draft:any=createEmptyDraft();draft.rbt12=15600;
  for(const key of Object.keys(draft.values))draft.values[key]=0;
  draft.values.salesRevenue=1300;draft.values.simplePurchases=10;draft.values.regularPurchases=20;
  return {_id:'61080000-0000-4000-8000-000000000005',generationId:generation,clientId:client,company:report.company,source:report,
    reportMonths:1,periodBasis:'MANUAL',periodConfirmed:true,manuallyAdjusted:false,adjustments:[],monthlyGroups:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value/100])),
    draft,result:calculateSimulation(draft),engineInput:draftToInput(draft),projection:annualizeReports(fields,1),modelVersion:MODEL_VERSION,taxSources:TAX_SOURCES,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,
    rbt12Source:'MANUAL',createdAt:'2026-10-09T15:00:00Z',createdBy:{id:'difal-simulator',name:'Teste'}};
}

test('DIFAL de saída permanece zerado ao ajustar período, despesas e vendas mensais',async({page},info)=>{
  const report=source();await setup(page,report);await page.goto(url);
  const card=page.locator('#simulator-difal');
  await expect(card).toContainText('DIFAL de saída');
  await expect(card.locator('[data-difal-disabled]').first()).toHaveText(OUTGOING_DIFAL_MESSAGE);
  await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');
  for(const id of ['pure','hybrid']){
    await expect(page.locator('#difal-exit-'+id)).not.toBeChecked();
    await expect(page.locator('#difal-exit-'+id)).toBeDisabled();
  }
  await page.locator('#period-months').selectOption('2');
  await expect(page.locator('#salesCpfCents')).toHaveValue('500.00');
  await expect(card.locator('[data-difal-monthly]')).toContainText('0,00');
  await expect(card.locator('[data-difal-annual]')).toContainText('0,00');
  await page.locator('#purchasesOptantCents').fill('200');await page.locator('#serviceRevenue').fill('100');
  await page.locator('#salesCpfCents').fill('1000');
  await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
  await page.reload();await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#restore-reports').click();
  await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
  expect(report.sales.difal.amountCents).toBe(1500); // The old source is evidence, never overwritten.
  await expect(card).not.toContainText('10%');
  await page.setViewportSize({width:320,height:850});await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const screenshot=info.outputPath('difal-disabled-simulator-mobile.png');await card.screenshot({path:screenshot});await info.attach('DIFAL de saída desativado',{path:screenshot,contentType:'image/png'});
});

test('UF pendente, fonte antiga positiva e ausência de resumo não reativam o DIFAL de saída',async({page})=>{
  const report=source();report.sales.difal.pendingLines=2;
  await setup(page,report);await page.goto(url);
  const card=page.locator('#simulator-difal');
  await expect(card.locator('[data-difal-application-status]')).toContainText('Desativado');
  await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(card).not.toContainText(/parcial|depende.*UF/);
  report.sales.difal={...report.sales.difal,baseCents:100000,amountCents:10000,pendingLines:0};
  report.sales.jobId='61080000-0000-4000-8000-000000000006';await page.reload();
  await expect(card.locator('[data-difal-annual]')).toContainText('0,00');
  delete report.sales.difal;await page.reload();
  await expect(card.locator('[data-difal-disabled]').first()).toHaveText(OUTGOING_DIFAL_MESSAGE);
  await expect(card.locator('[data-difal-amount]')).toContainText('0,00');
});

test('histórico sem DIFAL na DRE conserva a referência capturada sem reler a origem',async({page})=>{
  const legacy=legacyWithoutOutgoingDreFixture(),snapshot=savedSnapshot();
  snapshot.draft=legacy.draft;snapshot.result=legacy.result;snapshot.modelVersion=legacy.result.version;
  delete snapshot.engineInput;
  snapshot.monthlyGroups={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:12000,purchasesOptantCents:1000,purchasesNonOptantCents:2000};
  snapshot.source.fields=Object.fromEntries(Object.entries(snapshot.monthlyGroups).map(([key,value])=>[key,Number(value)*100]));
  snapshot.source.sales.totalCents=1200000;snapshot.source.purchases.totalCents=300000;
  snapshot.projection=annualizeReports(snapshot.source.fields,1);
  const captured=structuredClone(snapshot);
  await setup(page);let sourceReads=0;
  await page.route('**/api/v4/generations/*/simulator?*',r=>{sourceReads++;return r.fulfill({status:500,json:{message:'Não reler a origem'}});});
  await page.route('**/api/v4/simulations/'+snapshot._id,r=>r.fulfill({json:snapshot}));
  await page.goto('/simulator.html?simulation='+snapshot._id+'&historical=1');
  await expect(page.locator('[data-difal-amount]')).toContainText('15,00');
  await expect(page.locator('.sim-regime').first()).toContainText('128.160,00');
  await expect(page.locator('.sim-dre [data-dre-row="difal"]')).toHaveCount(0);
  await expect(page.locator('#simulator-difal')).toContainText('versão histórica');
  await expect(page.locator('[data-difal-monthly]')).toHaveCount(0);
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('[data-difal-amount]')).toContainText('15,00');
  expect(sourceReads).toBe(0);expect(snapshot).toEqual(captured);
  delete snapshot.source.sales.difal;await page.reload();
  await expect(page.locator('#simulator-difal')).toBeEmpty();
  await expect(page.locator('.sim-regime').first()).toContainText('128.160,00');
  expect(sourceReads).toBe(0);
});


test('DIFAL desativado fica zerado na DRE anual e mensal sem alterar a receita importada',async({page})=>{
  const report=source();await setup(page,report);
  let posted:any;
  await page.route('**/api/v4/simulations',route=>{
    posted=route.request().postDataJSON();const difal=projectDifal(report.sales.difal,posted.reportMonths,report.sales.jobId);
    return route.fulfill({status:201,json:{...savedSnapshot(report),_id:posted.simulationId,draft:posted.draft,reportMonths:posted.reportMonths,monthlyGroups:posted.monthlyGroups,difalProjection:difal,result:calculateSimulation(posted.draft,difal),engineInput:draftToInput(posted.draft,difal),projection:annualizeReports(report.fields,posted.reportMonths)}});
  });
  await page.goto(url);await page.locator('#period-months').selectOption('2');await page.locator('#period-confirm').check();
  await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('15600');await page.locator('#rbt12-manual-confirm').check();
  for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill('0');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  const annual=page.locator('.sim-dre tbody tr').filter({hasText:'DIFAL de saída — desativado'});
  await expect(annual).toHaveCount(1);for(const cell of await annual.locator('td').allTextContents())expect(cell).toContain('0,00');
  await expect(page.locator('#annual-revenue')).toContainText('7.800,00');expect(posted.draft.values.salesRevenue).toBe(650);
  for(const regime of ['pure','hybrid'])expect(posted.draft.difalPolicy.operations[regime].exit).toBe(false);
  await page.getByRole('button',{name:'Mensal',exact:true}).click();const monthly=page.locator('[data-dre-row="difal"]');
  await expect(monthly.locator('td')).toHaveCount(2);await expect(monthly.locator('td').first()).toContainText('0,00');await expect(monthly.locator('td').last()).toContainText('0,00');
});

test('histórico 1.17 mantém valores positivos da saída e células mensais capturadas',async({page})=>{
  const saved=legacyOutgoingDreFixture(),captured=structuredClone(saved);
  await setup(page);let sourceReads=0;
  await page.route('**/api/v4/generations/*/simulator?*',r=>{sourceReads++;return r.fulfill({status:500,json:{message:'Não reler a origem'}});});
  await page.route('**/api/v4/simulations/'+saved._id,r=>r.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id+'&historical=1');
  await expect(page.locator('#simulator-difal [data-difal-annual]')).toContainText('3.780,00');
  await expect(page.locator('[data-difal-applied-regime="pure"] [data-difal-applied-month]')).toContainText('84,00');
  await expect(page.locator('[data-difal-applied-regime="hybrid"] [data-difal-applied-month]')).toContainText('84,00');
  await expect(page.locator('.sim-dre')).toContainText('DIFAL sobre vendas (10%)');
  await expect(page.locator('#simulator-difal [data-difal-disabled]')).toHaveCount(0);
  await expect(page.locator('[data-difal-option="pure"] .sim-difal-scope')).toHaveText('entrada e saída');
  await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await page.locator('#dre-regime').selectOption('pure');
  await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('84,00');
  await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();
  await page.locator('#dre-month').selectOption('1');
  await expect(page.locator('[data-difal-applied-regime="pure"] [data-difal-applied-month]')).toContainText('168,00');
  await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('168,00');
  expect(sourceReads).toBe(0);expect(saved).toEqual(captured);
});
