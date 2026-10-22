import {test,expect,type Page} from '@playwright/test';
import {baselineMonth,monthlyProjection,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {buildRbt12Schedule} from '../../public/simulator-rbt12.js';
import {section22Year2025} from '../fixtures/section22.ts';
import {mockStatement,documentId,extractionId} from './extrato-helper.ts';

const generation='a2000000-0000-4000-8000-000000000001',client='a2000000-0000-4000-8000-000000000002';
const salesId='a2000000-0000-4000-8000-000000000003',purchaseId='a2000000-0000-4000-8000-000000000004';
const reports=[1,2].map(month=>({sourceMonth:`2025-0${month}`,month,salesLines:1,purchaseLines:1,
  fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:100000*month,serviceRevenueCents:0,purchasesOptantCents:0,purchasesNonOptantCents:50000*month},
  difal:{version:'DIFAL_ESTIMATE_V4',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:100000*month,amountCents:10000*month,pendingLines:0},
  anticipation:{version:'ICMS_ANTICIPATION_V3',ratePercent:7.32,issuerUf:'MG',eligibleLines:1,baseCents:50000*month,amountCents:3660*month,pendingLines:0}}));
const projection=monthlyProjection(reports);
const source:any={generationId:generation,clientId:client,company:{code:'OPCOES',name:'Empresa sintética DIFAL'},periodBasis:'COLUMN_H',reportMonths:2,
  period:{startMonth:'2025-01',endMonth:'2025-02',months:2},fields:projection.annualGroupsCents,projection,monthlyReports:reports,revenueSplit:{version:'SALES_SERVICES_V1'},warnings:[],
  purchases:{jobId:purchaseId,fileName:'compras.csv',totalCents:150000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2'},
  sales:{jobId:salesId,fileName:'vendas.csv',totalCents:300000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',difal:{...reports[0].difal,baseCents:300000,amountCents:30000,eligibleLines:2}}};
const blankDraft=()=>({year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{salesRevenue:1000,serviceRevenue:0,simplePurchases:0,regularPurchases:500,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}});
async function mount(page:Page){
  const state:{writes:any[];snapshots:Map<string,any>;extraction:any;sourceReads:number}={writes:[],snapshots:new Map(),extraction:null,sourceReads:0};
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'difal-options',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',r=>{state.sourceReads++;return r.fulfill({json:source});});
  await page.route('**/api/v4/simulations',r=>{
    const body=r.request().postDataJSON();state.writes.push(body);
    const schedule=body.rbt12ExtractionId?buildRbt12Schedule(state.extraction,reports.map(row=>row.sourceMonth)):null;
    const computed=calculateMonthlySimulation(body.draft,reports,body.monthlyInputs,salesId,schedule);
    const reference=body.rbt12ExtractionId?{...state.extraction,extractionId}:{source:'MANUAL',confirmed:true,rbt12Cents:Math.round(body.draft.rbt12*100)};
    const saved={...body,...computed,_id:body.simulationId,source,company:source.company,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'difal-options',name:'Teste'},modelVersion:computed.result.version,
      rbt12Source:body.rbt12ExtractionId?'SIMPLES_SECTION_22':'MANUAL',...(body.rbt12ExtractionId?{rbt12Extraction:reference}:{rbt12Manual:reference}),monthlyDre:buildMonthlyDre(computed.result,2027,reference,source.period)};
    state.snapshots.set(saved._id,saved);return r.fulfill({json:saved});
  });
  await page.route('**/api/v4/simulations/*',r=>r.fulfill({json:state.snapshots.get(new URL(r.request().url()).pathname.split('/').pop()!)}));
  return state;
}
const open=async(page:Page)=>page.goto(`/simulator.html?generation=${generation}&client=${client}`);
async function manual(page:Page,value='100000'){
  await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill(value);await page.locator('#rbt12-manual-confirm').check();
}
async function capturePanel(page:Page,selector:string,path:string){
  const panel=page.locator(selector);
  await panel.evaluate(element=>window.scrollTo({top:window.scrollY+element.getBoundingClientRect().top-96,behavior:'instant'}));
  await panel.screenshot({path});
}

test('opções independentes de DIFAL persistem no rascunho e alterações exigem nova simulação',async({page},info)=>{
  const state=await mount(page);await open(page);
  for(const id of ['pure','hybrid','presumed','actual'])await expect(page.locator(`#difal-enabled-${id}`)).toBeChecked();
  await manual(page);await page.locator('#difal-enabled-pure').uncheck();await page.locator('#difal-enabled-actual').uncheck();
  await page.reload();await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();await expect(page.locator('#difal-enabled-actual')).not.toBeChecked();await expect(page.locator('#difal-enabled-hybrid')).toBeChecked();
  await expect(page.locator('[data-difal-state="pure"]')).toContainText('Excluído deste cenário');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  expect(state.writes).toHaveLength(1);const saved=state.snapshots.get(state.writes[0].simulationId);
  expect(saved.draft.difalPolicy).toEqual({version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:false}});
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,-300,-300,0]);
  expect(saved.result.regimes.map((row:any)=>Math.round(row.dre.icmsAnticipation*100))).toEqual([0,-10980,0,0]);
  expect(saved.difalProjection.annualCents).toBe(30000);expect(saved.source.fields).toEqual(source.fields);
  await page.locator('#difal-enabled-hybrid').uncheck();await expect(page.locator('#simulation-changes-notice')).toBeVisible();expect(state.writes).toHaveLength(1);
  await page.locator('#regenerate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');expect(state.writes).toHaveLength(2);
  expect(state.writes[1].draft.difalPolicy.enabled.hybrid).toBe(false);
  await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-desktop.png'));
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.setViewportSize({width:390,height:1100});await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-mobile.png'));
});

test('RBT12 de cada competência bloqueia os Simples e preserva escolhas para os demais meses',async({page},info)=>{
  const state=await mount(page),extraction=section22Year2025();
  const revenues=extraction.priorRevenues.map(row=>({...row,internalCents:row.month==='2025-01'?50000000:29000000,externalCents:0,totalCents:row.month==='2025-01'?50000000:29000000}));
  state.extraction={...extraction,rbt12Cents:369000000,rbt12CalculatedCents:369000000,priorRevenues:revenues,rbt12Window:revenues.slice(11),rbt12Basis:{...extraction.rbt12Basis,internalCents:369000000,totalCents:369000000}};
  await mockStatement(page,369000000);
  await page.route('**/api/simples?*',r=>r.fulfill({json:{...state.extraction,extractionId,documentId,clientId:client,originalStored:true,searchableStored:true}}));
  await open(page);await page.locator('#rbt12-pdf').setInputFiles({name:'sublimite-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});await page.locator('#rbt12-read').click();
  await expect(page.locator('#rbt12')).toHaveValue('3690000.00');
  await expect(page.locator('[data-section22-history]')).toBeVisible();await expect(page.locator('[data-section22-history] tbody tr')).toHaveCount(23);
  await expect(page.locator('[data-section22-month="2025-01"] .sim-extrato-month-total')).toContainText('500.000,00');
  await expect(page.locator('.sim-extrato-pa table')).toBeHidden();
  await page.locator('[data-rbt12-window="2025-01"]>summary').click();
  await expect(page.locator('[data-rbt12-window="2025-01"] tbody tr')).toHaveCount(12);
  await page.setViewportSize({width:1280,height:1800});
  await capturePanel(page,'#rbt12-details',info.outputPath('receitas-mensais-23-desktop.png'));
  await capturePanel(page,'#rbt12-schedule',info.outputPath('rbt12-competencia-12-desktop.png'));
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    for(const selector of ['[data-section22-history]','#rbt12-schedule .projection-table-wrap']){
      expect(await page.locator(selector).evaluate(table=>table.querySelector('tbody tr>*:nth-child(2)')!.getBoundingClientRect().right<=table.getBoundingClientRect().right+1)).toBe(true);
    }
  }
  await page.setViewportSize({width:390,height:1800});
  await capturePanel(page,'#rbt12-details',info.outputPath('receitas-mensais-23-mobile.png'));
  await capturePanel(page,'#rbt12-schedule',info.outputPath('rbt12-competencia-12-mobile.png'));
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','ENABLED');
  await expect(page.locator('#difal-options-context')).toContainText('3.480.000,00');
  await page.locator('#report-competence').selectOption('1');
  for(const id of ['pure','hybrid']){await expect(page.locator(`[data-difal-option="${id}"]`)).toHaveAttribute('data-state','SUBLIMIT');await expect(page.locator(`#difal-enabled-${id}`)).toBeChecked();await expect(page.locator(`#difal-enabled-${id}`)).toBeEnabled();}
  await expect(page.locator('[data-difal-option="presumed"]')).toHaveAttribute('data-state','ENABLED');
  await page.locator('#difal-enabled-pure').uncheck();await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','SUBLIMIT');
  await page.locator('#report-competence').selectOption('0');await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','USER_EXCLUDED');
  await page.locator('#difal-enabled-pure').check();await page.locator('#report-competence').selectOption('1');
  await capturePanel(page,'#sim-difal-options',info.outputPath('difal-bloqueado-desktop.png'));
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.setViewportSize({width:390,height:1100});await capturePanel(page,'#sim-difal-options',info.outputPath('difal-bloqueado-mobile.png'));
  await page.setViewportSize({width:1280,height:900});
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  const saved=state.snapshots.get(state.writes[0].simulationId);
  expect(saved.result.monthlyResults.map((row:any)=>row.result.regimes.find((r:any)=>r.id==='pure').dre.difal)).toEqual([-100,0]);
  expect(saved.result.monthlyResults.map((row:any)=>row.result.regimes.find((r:any)=>r.id==='pure').dre.icmsAnticipation)).toEqual([-36.6,0]);
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([-100,-100,-300,-300]);
  await page.goto(`/simulator.html?simulation=${saved._id}`);
  await expect(page.locator('#sim-difal-options input')).toHaveCount(0);await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','ENABLED');
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','SUBLIMIT');await expect(page.locator('[data-difal-option="pure"]')).toContainText('Incluído por escolha');
  expect(state.sourceReads).toBe(1);expect(state.writes).toHaveLength(1);
  await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-historico.png'));
});

test('extração com RBT12 divergente das receitas mensais não preenche nem confirma o extrato',async({page})=>{
  const state=await mount(page),invalid=section22Year2025();invalid.rbt12Cents+=100000;
  await mockStatement(page);
  await page.route('**/api/simples?*',r=>r.fulfill({json:{...invalid,extractionId,documentId,clientId:client,originalStored:true,searchableStored:true}}));
  await open(page);await page.locator('#rbt12-pdf').setInputFiles({name:'inconsistente.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});await page.locator('#rbt12-read').click();
  await expect(page.locator('#rbt12-status')).toContainText('inconsistente');await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('#rbt12-details')).toBeEmpty();
  await page.locator('#generate-simulation').click();expect(state.writes).toHaveLength(0);await expect(page.locator('#results-top')).toHaveCount(0);
});

test('histórico sem opções registradas mostra valores congelados sem inferir escolhas',async({page})=>{
  const state=await mount(page),draft=blankDraft(),monthlyInputs=reports.map(row=>baselineMonth(row));
  const computed=calculateMonthlySimulation(draft,reports,monthlyInputs,salesId),snapshot:any={...computed,_id:'a2000000-0000-4000-8000-000000000005',draft,monthlyInputs,monthlyGroups:monthlyInputs[0].groups,source,company:source.company,reportMonths:2,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'legacy',name:'Teste'},rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:10000000},modelVersion:'1.5.0-cpf-cnpj'};
  delete snapshot.result.difalPolicy;
  for(const regime of snapshot.result.regimes)delete regime.difalApplication;
  for(const row of snapshot.result.monthlyResults){delete row.result.difalPolicy;for(const regime of row.result.regimes)delete regime.difalApplication;}
  snapshot.monthlyDre=buildMonthlyDre(snapshot.result,2027,snapshot.rbt12Manual,source.period);
  const before=JSON.stringify(snapshot);state.snapshots.set(snapshot._id,snapshot);
  await page.goto(`/simulator.html?simulation=${snapshot._id}`);
  await expect(page.locator('[data-difal-legacy]')).toContainText('não registrava opções de DIFAL');await expect(page.locator('#sim-difal-options input')).toHaveCount(0);
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('[data-difal-legacy]')).toBeVisible();
  expect(JSON.stringify(snapshot)).toBe(before);expect(state.sourceReads).toBe(0);expect(state.writes).toHaveLength(0);
});
