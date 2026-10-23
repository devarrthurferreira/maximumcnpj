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
async function mount(page:Page,initialPolicy?:any){
  const currentSource=initialPolicy?{...source,difalPolicy:initialPolicy}:source;
  const state:{writes:any[];snapshots:Map<string,any>;extraction:any;sourceReads:number}={writes:[],snapshots:new Map(),extraction:null,sourceReads:0};
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'difal-options',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',r=>{state.sourceReads++;return r.fulfill({json:currentSource});});
  await page.route('**/api/v4/simulations',r=>{
    const body=r.request().postDataJSON();state.writes.push(body);
    const schedule=body.rbt12ExtractionId?buildRbt12Schedule(state.extraction,reports.map(row=>row.sourceMonth)):null;
    const computed=calculateMonthlySimulation(body.draft,reports,body.monthlyInputs,salesId,schedule);
    const reference=body.rbt12ExtractionId?{...state.extraction,extractionId}:{source:'MANUAL',confirmed:true,rbt12Cents:Math.round(body.draft.rbt12*100)};
    const saved={...body,...computed,_id:body.simulationId,source:currentSource,company:source.company,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'difal-options',name:'Teste'},modelVersion:computed.result.version,
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
async function showMonthlyDre(page:Page){
  await expect(page.locator('#dre-demonstrativo [data-period="annual"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#dre-report-period')).toHaveValue('complete');
  await page.getByRole('button',{name:'Mensal',exact:true}).click();
}
async function capturePanel(page:Page,selector:string,path:string){
  const panel=page.locator(selector);
  await panel.evaluate(element=>window.scrollTo({top:window.scrollY+element.getBoundingClientRect().top-96,behavior:'instant'}));
  await panel.screenshot({path});
}

const policy=(pure=true,hybrid=true,pureEntry=true,pureExit=true,hybridEntry=true,hybridExit=true)=>({version:'DIFAL_SCENARIOS_V2',enabled:{pure,hybrid,presumed:false,actual:false},operations:{pure:{entry:pureEntry,exit:pureExit},hybrid:{entry:hybridEntry,exit:hybridExit}}});
const selectedPolicy=policy(false,true,true,true,false,true);
const secondClient='a2000000-0000-4000-8000-000000000006';
async function companySelection(page:Page){
  const requests:any[]=[];
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'difal-options',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[{_id:client,code:'101',name:'Empresa A sintética',active:true},{_id:secondClient,code:'202',name:'Empresa B sintética',active:true}]}}));
  await page.route('**/api/v4/generations',r=>{requests.push(r.request().postDataJSON());return r.fulfill({status:requests.length===1?422:503,json:{message:requests.length===1?'Revise a seleção sintética.':'Falha temporária sintética.'}});});
  return requests;
}

test('DIFAL aparece após escolher a empresa, mantém escolhas separadas e congela o retry',async({page},info)=>{
  const requests=await companySelection(page);await page.goto('/generations.html');await page.locator('#generation-search').fill('Empresa');
  await page.locator(`[data-select-company="${client}"]`).click();
  await expect(page.locator('#generation-difal-pure')).toBeFocused();
  for(const id of ['pure','hybrid'])await expect(page.locator(`#generation-difal-${id}`)).toBeChecked();
  await expect(page.locator('[data-generation-difal-regime]')).toHaveCount(2);await expect(page.locator('[data-generation-difal-operation]')).toHaveCount(4);
  expect(await page.locator('.generation-difal-options').evaluate(element=>!!(element.compareDocumentPosition(document.querySelector('#generation-reports-heading')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.locator('#generation-difal-pure').uncheck();await page.locator('#generation-difal-entry-hybrid').uncheck();
  await expect(page.locator('#generation-difal-entry-pure')).toBeDisabled();
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await page.locator('#generation-reports-dialog').evaluate(element=>element.scrollTop=0);
    expect(await page.locator('#generation-reports-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`difal-escolha-empresa-${width}.png`)});
  }
  await page.locator('#generation-reports-back').click();await page.locator(`[data-select-company="${secondClient}"]`).click();
  for(const id of ['pure','hybrid'])await expect(page.locator(`#generation-difal-${id}`)).toBeChecked();
  await page.locator('#generation-difal-hybrid').uncheck();await page.locator('#generation-difal-exit-pure').uncheck();await page.locator('#generation-reports-back').click();
  await page.locator(`[data-select-company="${client}"]`).click();await expect(page.locator('#generation-difal-pure')).not.toBeChecked();await expect(page.locator('#generation-difal-entry-hybrid')).not.toBeChecked();await expect(page.locator('#generation-difal-hybrid')).toBeChecked();
  expect(requests).toHaveLength(0);await page.locator('#generation-create').click();await expect(page.locator('#generation-reports-error')).toContainText('Revise a seleção');
  expect(requests[0].companyDifalPolicies).toEqual([{clientId:client,difalPolicy:selectedPolicy}]);await expect(page.locator('#generation-difal-pure')).toBeEnabled();
  await page.locator('#generation-reports-back').click();await page.locator(`[data-select-company="${secondClient}"]`).click();await expect(page.locator('#generation-difal-hybrid')).not.toBeChecked();
  await page.locator('#generation-create').click();await expect(page.locator('#generation-reports-error')).toContainText('Falha temporária');
  for(const id of ['pure','hybrid'])await expect(page.locator(`#generation-difal-${id}`)).toBeDisabled();
  await expect(page.locator('[data-generation-difal-operation]:enabled')).toHaveCount(0);
  await page.locator('#generation-create').click();await expect.poll(()=>requests.length).toBe(3);
  expect(requests[2]).toEqual(requests[1]);expect(requests[1].generationId).not.toBe(requests[0].generationId);
  expect(requests[1].companyDifalPolicies).toEqual([{clientId:secondClient,difalPolicy:policy(true,false,true,false)}]);
});

test('seleção de várias empresas mantém DIFAL independente e envia apenas as empresas selecionadas',async({page})=>{
  const requests=await companySelection(page);await page.goto('/generations.html?multiple=1');
  await page.locator(`.generation-company-option input[value="${client}"]`).check();await page.locator(`#generation-difal-${client}-pure`).uncheck();
  await page.locator(`.generation-company-option input[value="${secondClient}"]`).check();await page.locator(`#generation-difal-exit-${secondClient}-pure`).uncheck();await page.locator(`#generation-difal-entry-${secondClient}-hybrid`).uncheck();
  await expect(page.locator(`#generation-difal-${secondClient}-pure`)).toBeChecked();await expect(page.locator(`#generation-difal-exit-${client}-pure`)).toBeChecked();
  await page.locator(`.generation-company-option input[value="${client}"]`).uncheck();await expect(page.locator(`[data-company-difal="${client}"]`)).toHaveCount(0);
  await page.locator('#generation-create').click();await expect(page.locator('#generation-error')).toContainText('Revise a seleção');
  expect(requests[0].clientIds).toEqual([secondClient]);expect(requests[0].companyDifalPolicies).toEqual([{clientId:secondClient,difalPolicy:policy(true,true,true,false,false,true)}]);
  await page.locator(`.generation-company-option input[value="${client}"]`).check();await expect(page.locator(`#generation-difal-${client}-pure`)).not.toBeChecked();
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#generation-create').click();await expect(page.locator('#generation-error')).toContainText('Falha temporária');
  await expect(page.locator('[data-generation-difal-regime]:enabled')).toHaveCount(0);await page.locator('#generation-create').click();await expect.poll(()=>requests.length).toBe(3);
  expect(requests[2]).toEqual(requests[1]);expect(requests[1].companyDifalPolicies).toHaveLength(2);expect(requests[1].companyDifalPolicies[1].difalPolicy.enabled.pure).toBe(false);
});

test('opções iniciais da empresa chegam ao extrato, ao rascunho e à versão salva sem substituir ajustes',async({page})=>{
  const initial=structuredClone(selectedPolicy),state=await mount(page,initial);
  await page.goto(`/simulator.html?generation=${generation}&client=${client}&guided=1&step=extrato`);
  await expect(page.locator('[data-guided-difal-summary]')).toContainText('Simples puro: não incluir. Simples híbrido: saída (vendas)');await expect(page.locator('#simulator-form')).toBeHidden();
  await page.locator('#guided-rbt12-skip').click();await expect(page.locator('.sim-difal-review')).not.toHaveAttribute('open','');await expect(page.locator('[data-difal-selection-summary]')).toContainText('Simples puro: não incluir. Simples híbrido: saída (vendas)');
  await page.locator('.sim-difal-review>summary').click();await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();await expect(page.locator('#difal-enabled-hybrid')).toBeChecked();
  await page.locator('#rbt12').fill('3600000');await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','SUBLIMIT');await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();
  await page.locator('#rbt12').fill('100000');await page.locator('#rbt12-manual-confirm').check();await page.locator('#difal-enabled-hybrid').uncheck();
  await page.reload();await expect(page.locator('#simulator-form')).toBeVisible();await expect(page.locator('[data-difal-selection-summary]')).toContainText('Simples puro: não incluir. Simples híbrido: não incluir');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  const saved=state.snapshots.get(state.writes[0].simulationId),expected=policy(false,false,true,true,false,true);
  expect(saved.draft.difalPolicy).toEqual(expected);expect(initial).toEqual(selectedPolicy);expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,0,0,0]);
  const frozen=JSON.stringify(saved);await page.goto(`/simulator.html?simulation=${saved._id}`);await expect(page.locator('#sim-difal-options input')).toHaveCount(0);await expect(page.locator('[data-difal-option="hybrid"]')).toContainText('Não incluído por escolha');
  await page.locator('#create-version').click();await expect(page.locator('#difal-enabled-hybrid')).not.toBeChecked();await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();expect(JSON.stringify(saved)).toBe(frozen);expect(state.writes).toHaveLength(1);
});

test('entrada no Puro e saída no Híbrido persistem no rascunho, histórico e exportação',async({page},info)=>{
  const state=await mount(page);await open(page);
  for(const id of ['pure','hybrid'])await expect(page.locator(`#difal-enabled-${id}`)).toBeChecked();
  await expect(page.locator('[data-difal-regime]')).toHaveCount(2);await expect(page.locator('[data-difal-operation]')).toHaveCount(4);
  await manual(page);await page.locator('#difal-exit-pure').uncheck();await page.locator('#difal-entry-hybrid').uncheck();
  await expect(page.locator('#month-summary-difal')).toHaveText('Por cenário');
  await expect(page.locator('[data-difal-monthly]')).toHaveText('Por cenário');
  await expect(page.locator('[data-difal-applied-regime="pure"] [data-difal-applied-month]')).toContainText('0,00');
  await expect(page.locator('[data-difal-applied-regime="hybrid"] [data-difal-applied-month]')).toContainText('100,00');
  await expect(page.locator('[data-anticipation-applied-regime="pure"] [data-anticipation-applied-month]')).toContainText('36,60');
  await expect(page.locator('[data-anticipation-applied-regime="hybrid"] [data-anticipation-applied-month]')).toContainText('0,00');
  await page.reload();await expect(page.locator('#difal-exit-pure')).not.toBeChecked();await expect(page.locator('#difal-entry-hybrid')).not.toBeChecked();await expect(page.locator('#difal-entry-pure')).toBeChecked();await expect(page.locator('#difal-exit-hybrid')).toBeChecked();
  await expect(page.locator('[data-difal-state="pure"]')).toContainText('entrada');await expect(page.locator('[data-difal-state="hybrid"]')).toContainText('saída');
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  expect(state.writes).toHaveLength(1);const saved=state.snapshots.get(state.writes[0].simulationId);
  expect(saved.draft.difalPolicy).toEqual(policy(true,true,true,false,false,true));
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,-300,0,0]);
  expect(saved.result.regimes.map((row:any)=>Math.round(row.dre.icmsAnticipation*100))).toEqual([-10980,0,0,0]);
  expect(saved.difalProjection.annualCents).toBe(30000);expect(saved.source.fields).toEqual(source.fields);
  await page.locator('#difal-exit-pure').check();await expect(page.locator('#simulation-changes-notice')).toBeVisible();expect(state.writes).toHaveLength(1);
  await expect(page.locator('#month-summary-difal')).toContainText('100,00');await expect(page.locator('[data-difal-monthly]')).toContainText('100,00');
  await page.locator('#regenerate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');expect(state.writes).toHaveLength(2);
  expect(state.writes[1].draft.difalPolicy.operations.pure).toEqual({entry:true,exit:true});
  await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-desktop.png'));
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.setViewportSize({width:390,height:1100});await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-mobile.png'));
  await page.setViewportSize({width:320,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await capturePanel(page,'#sim-difal-options',info.outputPath('difal-opcoes-mobile-320.png'));
  const before=JSON.stringify(saved);await page.goto(`/simulator.html?simulation=${saved._id}`);
  await expect(page.locator('[data-difal-option="pure"]')).toContainText('entrada (compras)');await expect(page.locator('[data-difal-option="hybrid"]')).toContainText('saída (vendas)');
  await expect(page.locator('#sim-difal-options input')).toHaveCount(0);
  await expect(page.locator('[data-difal-monthly]')).toHaveText('Por cenário');
  await expect(page.locator('[data-difal-applied-regime="pure"] [data-difal-applied-month]')).toContainText('0,00');
  await expect(page.locator('[data-difal-applied-regime="hybrid"] [data-difal-applied-month]')).toContainText('100,00');
  await showMonthlyDre(page);
  await page.locator('#dre-regime').selectOption('pure');await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('0,00');
  await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('36,60');
  await page.locator('#dre-regime').selectOption('hybrid');await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('100,00');
  await expect(page.locator('[data-dre-row="icmsAnticipation"] td').first()).toContainText('0,00');
  const download=page.waitForEvent('download');await page.locator('#export-simulation').click();
  const exported=await download,stream=await exported.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(payload.draft.difalPolicy).toEqual(saved.draft.difalPolicy);expect(payload.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,-300,0,0]);
  expect(JSON.stringify(saved)).toBe(before);expect(state.writes).toHaveLength(2);
});

test('saída desmarcada some dos KPIs e da impressão; entrada e histórico mantêm seus valores',async({page},info)=>{
  const state=await mount(page);await open(page);await manual(page);
  await expect(page.locator('#month-summary-difal')).toContainText('100,00');
  await page.locator('#difal-exit-pure').uncheck();await page.locator('#difal-exit-hybrid').uncheck();
  const exit=page.locator('#simulator-difal'),entry=page.locator('#simulator-anticipation');
  await expect(page.locator('#month-summary-difal')).toContainText('0,00');
  await expect(exit.locator('[data-difal-monthly]')).toContainText('0,00');await expect(exit.locator('[data-difal-annual]')).toContainText('0,00');
  await expect(exit.locator('[data-difal-application-status]')).toHaveText('Não incluído');
  await expect(entry.locator('[data-anticipation-monthly]')).toContainText('36,60');
  await expect(exit.locator('[data-difal-source-monthly]')).toContainText('100,00');
  await expect(exit.locator('[data-difal-source-monthly]')).toBeHidden();
  await page.reload();await expect(page.locator('#month-summary-difal')).toContainText('0,00');
  await expect(page.locator('#difal-exit-pure')).not.toBeChecked();await expect(page.locator('#difal-entry-pure')).toBeChecked();
  await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  const saved=state.snapshots.get(state.writes[0].simulationId),frozen=JSON.stringify(saved);
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,0,0,0]);
  expect(saved.source.monthlyReports[0].difal.amountCents).toBe(10000);expect(saved.difalProjection.annualCents).toBe(30000);
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  const print=page.locator('#simulation-print-context');
  await expect(print.locator('[data-difal-monthly]')).toContainText('0,00');await expect(print.locator('[data-anticipation-monthly]')).toContainText('36,60');
  await expect(print.locator('[data-difal-audit]')).toHaveCount(0);await expect(print.locator('[data-difal-source-monthly]')).toHaveCount(0);
  await expect(exit.locator('[data-difal-audit]')).not.toHaveAttribute('open','');
  await page.emulateMedia({media:'print'});await expect(exit.locator('[data-difal-source-monthly]')).toBeHidden();
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await page.setViewportSize({width:320,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await capturePanel(page,'#simulator-difal',info.outputPath('difal-saida-desativada-320.png'));
  await page.setViewportSize({width:1280,height:900});await page.goto(`/simulator.html?simulation=${saved._id}`);
  await expect(exit.locator('[data-difal-application-status]')).toHaveText('Não incluído');
  await expect(exit.locator('[data-difal-monthly]')).toContainText('0,00');await expect(entry.locator('[data-anticipation-monthly]')).toContainText('36,60');
  await showMonthlyDre(page);
  await page.locator('#dre-month').selectOption('1');await expect(exit.locator('[data-difal-monthly]')).toContainText('0,00');await expect(entry.locator('[data-anticipation-monthly]')).toContainText('73,20');
  await page.locator('#dre-month').selectOption('2');await expect(exit.locator('[data-difal-monthly]')).toHaveText('Indisponível');
  expect(JSON.stringify(saved)).toBe(frozen);expect(state.sourceReads).toBe(2);expect(state.writes).toHaveLength(1);
  await page.locator('#create-version').click();await expect(page.locator('#difal-exit-pure')).not.toBeChecked();await expect(page.locator('#difal-exit-hybrid')).not.toBeChecked();
  await expect(page.locator('#month-summary-difal')).toContainText('0,00');await expect(entry.locator('[data-anticipation-monthly]')).toContainText('36,60');
});

test('sem operações não gera DIFAL e desmarcar o cenário conserva suas direções',async({page})=>{
  const state=await mount(page);await open(page);await manual(page);
  await page.locator('#difal-entry-pure').uncheck();await page.locator('#difal-exit-pure').uncheck();await page.locator('#difal-enabled-hybrid').uncheck();
  await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','NO_OPERATIONS');
  await expect(page.locator('#difal-entry-hybrid')).toBeDisabled();await expect(page.locator('#difal-exit-hybrid')).toBeDisabled();
  await page.locator('#difal-enabled-hybrid').check();await expect(page.locator('#difal-entry-hybrid')).toBeChecked();await expect(page.locator('#difal-exit-hybrid')).toBeChecked();
  await page.locator('#difal-enabled-hybrid').uncheck();await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  const saved=state.snapshots.get(state.writes[0].simulationId);
  expect(saved.draft.difalPolicy).toEqual(policy(true,false,false,false));
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([0,0,0,0]);expect(saved.result.regimes.map((row:any)=>row.dre.icmsAnticipation)).toEqual([0,0,0,0]);
  expect(saved.difalProjection.annualCents).toBe(30000);
});

test('V1 permanece histórico e uma nova versão permite DIFAL só no Simples com direções explícitas',async({page})=>{
  const oldPolicy={version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:true}},state=await mount(page,oldPolicy);
  const draft={...blankDraft(),difalPolicy:oldPolicy},monthlyInputs=reports.map(row=>baselineMonth(row));
  const computed=calculateMonthlySimulation(draft,reports,monthlyInputs,salesId);
  const snapshot:any={...computed,_id:'a2000000-0000-4000-8000-000000000007',generationId:generation,clientId:client,draft,monthlyInputs,monthlyGroups:monthlyInputs[0].groups,source,company:source.company,reportMonths:2,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'legacy',name:'Teste'},rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:10000000},modelVersion:'1.6.0-difal-scenarios'};
  snapshot.result.difalPolicy=structuredClone(oldPolicy);
  snapshot.monthlyDre=buildMonthlyDre(snapshot.result,2027,snapshot.rbt12Manual,source.period);
  state.snapshots.set(snapshot._id,snapshot);const before=JSON.stringify(snapshot);
  await page.goto(`/simulator.html?simulation=${snapshot._id}`);
  await expect(page.locator('[data-difal-legacy-policy]')).toContainText('Opções históricas');await expect(page.locator('[data-difal-option]')).toHaveCount(4);await expect(page.locator('#sim-difal-options input')).toHaveCount(0);
  await expect(page.locator('[data-difal-option="actual"]')).toContainText('Incluído por escolha');
  await page.locator('#create-version').click();await expect(page.locator('[data-difal-option]')).toHaveCount(2);await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();await expect(page.locator('#difal-enabled-hybrid')).toBeChecked();
  await page.locator('.sim-difal-review > summary').click();await expect(page.locator('#difal-entry-hybrid')).toBeChecked();await expect(page.locator('#difal-exit-hybrid')).toBeChecked();
  await page.locator('#difal-entry-hybrid').uncheck();await page.locator('#rbt12-manual-confirm').check();await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
  expect(state.writes[0].draft.difalPolicy).toEqual(selectedPolicy);expect(JSON.stringify(snapshot)).toBe(before);
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
  await expect(page.locator('[data-difal-option="presumed"]')).toHaveCount(0);
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
  expect(saved.result.regimes.map((row:any)=>row.dre.difal)).toEqual([-100,-100,0,0]);
  await page.goto(`/simulator.html?simulation=${saved._id}`);
  await expect(page.locator('#sim-difal-options input')).toHaveCount(0);await expect(page.locator('[data-difal-option="pure"]')).toHaveAttribute('data-state','ENABLED');
  await showMonthlyDre(page);
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
  const state=await mount(page,selectedPolicy),draft=blankDraft(),monthlyInputs=reports.map(row=>baselineMonth(row));
  const computed=calculateMonthlySimulation(draft,reports,monthlyInputs,salesId),snapshot:any={...computed,_id:'a2000000-0000-4000-8000-000000000005',generationId:generation,clientId:client,draft,monthlyInputs,monthlyGroups:monthlyInputs[0].groups,source,company:source.company,reportMonths:2,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'legacy',name:'Teste'},rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:10000000},modelVersion:'1.5.0-cpf-cnpj'};
  delete snapshot.result.difalPolicy;
  for(const regime of snapshot.result.regimes)delete regime.difalApplication;
  for(const row of snapshot.result.monthlyResults){delete row.result.difalPolicy;for(const regime of row.result.regimes)delete regime.difalApplication;}
  snapshot.monthlyDre=buildMonthlyDre(snapshot.result,2027,snapshot.rbt12Manual,source.period);
  const before=JSON.stringify(snapshot);state.snapshots.set(snapshot._id,snapshot);
  await page.goto(`/simulator.html?simulation=${snapshot._id}`);
  await expect(page.locator('[data-difal-legacy]')).toContainText('não registrava opções de DIFAL');await expect(page.locator('#sim-difal-options input')).toHaveCount(0);
  await showMonthlyDre(page);
  await page.locator('#dre-month').selectOption('1');await expect(page.locator('[data-difal-legacy]')).toBeVisible();
  expect(JSON.stringify(snapshot)).toBe(before);expect(state.sourceReads).toBe(0);expect(state.writes).toHaveLength(0);
  await page.locator('#create-version').click();await expect(page.locator('#difal-enabled-pure')).not.toBeChecked();await expect(page.locator('#difal-enabled-actual')).toHaveCount(0);await expect(page.locator('#difal-enabled-hybrid')).toBeChecked();
  expect(JSON.stringify(snapshot)).toBe(before);expect(state.sourceReads).toBe(1);expect(state.writes).toHaveLength(0);
});
