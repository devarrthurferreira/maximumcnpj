import {test,expect,type Page} from '@playwright/test';
import {annualizeReports} from '../../public/simulator-projection.js';
import {calculateSimulation,createEmptyDraft,draftToInput,MODEL_VERSION,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';

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

test('DIFAL conserva o total elegível importado ao ajustar período, despesas e vendas mensais',async({page},info)=>{
  await setup(page);await page.goto(url);
  const card=page.locator('#simulator-difal');
  await expect(card).toContainText('DIFAL estimado · total importado');
  await expect(card.locator('[data-difal-amount]')).toContainText('15,00');
  await expect(card).toContainText('150,00');await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');
  await expect(card.locator('[data-difal-adjusted]')).toHaveCount(0);
  await page.locator('#period-months').selectOption('2');
  await expect(page.locator('#salesCpfCents')).toHaveValue('500.00');await expect(card.locator('[data-difal-amount]')).toContainText('15,00');
  await page.locator('#purchasesOptantCents').fill('200');await page.locator('#serviceRevenue').fill('100');
  await expect(card.locator('[data-difal-adjusted]')).toHaveCount(0);
  await page.locator('#salesCpfCents').fill('1000');
  await expect(card.locator('[data-difal-adjusted]')).toContainText('corrija e reimporte');
  await expect(card.locator('[data-difal-amount]')).toContainText('15,00');
  await page.reload();await expect(card.locator('[data-difal-adjusted]')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.locator('#restore-reports').click();
  await expect(card.locator('[data-difal-adjusted]')).toHaveCount(0);
  await expect(card.locator('[data-difal-amount]')).toContainText('15,00');
  await page.setViewportSize({width:320,height:850});await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const screenshot=info.outputPath('difal-simulator-mobile.png');await card.screenshot({path:screenshot});await info.attach('DIFAL no simulador',{path:screenshot,contentType:'image/png'});
});

test('UF pendente aparece como estimativa parcial e nova importação atualiza o DIFAL',async({page})=>{
  const report=source();report.sales.difal.pendingLines=2;
  await setup(page,report);await page.goto(url);
  await expect(page.locator('[data-difal-pending]')).toContainText('2 linhas dependem de UF');
  report.sales.difal={...report.sales.difal,baseCents:100000,amountCents:10000,pendingLines:0};
  report.sales.jobId='61080000-0000-4000-8000-000000000006';await page.reload();
  await expect(page.locator('[data-difal-amount]')).toContainText('100,00');await expect(page.locator('[data-difal-pending]')).toHaveCount(0);
  delete report.sales.difal;await page.reload();
  await expect(page.locator('#simulator-difal')).toContainText('DIFAL indisponível');await expect(page.locator('[data-difal-amount]')).toHaveCount(0);
});

test('histórico conserva o DIFAL capturado e resultados sem reler relatórios ou recalcular tributos',async({page})=>{
  const snapshot=savedSnapshot();snapshot.result.regimes[0].annualProfit=123456.78;
  await setup(page);let sourceReads=0;
  await page.route('**/api/v4/generations/*/simulator?*',r=>{sourceReads++;return r.fulfill({status:500,json:{message:'Não reler a origem'}});});
  await page.route('**/api/v4/simulations/'+snapshot._id,r=>r.fulfill({json:snapshot}));
  await page.goto('/simulator.html?simulation='+snapshot._id);
  await expect(page.locator('[data-difal-amount]')).toContainText('15,00');
  await expect(page.locator('.sim-regime').first()).toContainText('123.456,78');
  await expect(page.locator('.sim-dre')).not.toContainText('DIFAL');
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('[data-difal-amount]')).toContainText('15,00');
  expect(sourceReads).toBe(0);
  delete snapshot.source.sales.difal;await page.reload();
  await expect(page.locator('#simulator-difal')).toBeEmpty();await expect(page.locator('.sim-regime').first()).toContainText('123.456,78');
  expect(sourceReads).toBe(0);
});
