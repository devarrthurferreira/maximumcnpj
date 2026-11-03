import {test,expect,type Page} from '@playwright/test';
import {defaultFiscalData} from '../../src/analysis-contract.ts';

const analysisId='18777777-7777-4777-8777-777777777771',clientId='18777777-7777-4777-8777-777777777772';
const generationId='18777777-7777-4777-8777-777777777773',purchaseId='18777777-7777-4777-8777-777777777774',salesId='18777777-7777-4777-8777-777777777775';
const period={version:'JAN_SEP_V1',sourceYear:2025,complete:true,includedMonths:['2025-01']};
const estimate={version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',amountCents:7320,baseCents:100000,eligibleLines:1,pendingLines:0};
const response=(amountCents=7320)=>({jobId:purchaseId,clientId,generationId,anticipation:{...estimate,amountCents},period});
const outgoingResponse=()=>({jobId:salesId,clientId,generationId,
  difal:{version:'DIFAL_ESTIMATE_V6',ratePercent:10,issuerUf:'MG',amountCents:0,baseCents:0,eligibleLines:0,pendingLines:0},period});
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
type Reply={status?:number;json:any};
type Options={entry?:(attempt:number)=>Reply|Promise<Reply>;exit?:(attempt:number)=>Reply|Promise<Reply>;
  salesPeriod?:{startMonth:string;endMonth:string;months:number};sourceGate?:ReturnType<typeof gate>;sourceError?:string;metadataFailureAt?:number;inline?:'legacy'|'invalid'|'valid'};

async function setup(page:Page,options:Options={}){
  const selection={version:'REGIME_SELECTION_V1' as const,selected:['pure' as const,'hybrid' as const]};
  const fiscal=defaultFiscalData(selection);fiscal.generationId=generationId;fiscal.difalChoice='no';
  fiscal.difalPolicy.enabled.pure=fiscal.difalPolicy.enabled.hybrid=false;
  fiscal.rbt12Source='MANUAL';fiscal.rbt12=120000;fiscal.rbt12ManualConfirmed=true;
  const analysis={id:analysisId,clientId,version:'ANALYSIS_SECTORS_V1',periodPolicy:'JAN_SEP_V1',revision:2,
    company:{code:'DIFAL-FAST',name:'Empresa sintética de conferência',cnpj:null,uf:'MG'},
    config:{revision:1,year:2027,regimeSelection:selection},fiscal:{revision:1,status:'DRAFT',data:fiscal},
    accounting:{revision:0,status:'DRAFT',data:{months:[]}},readiness:{ready:false,verification:'SAVED',months:[],issues:[]},currentSimulation:null};
  const inline=options.inline||'legacy',version=inline==='legacy'?'ICMS_ANTICIPATION_V4':'ICMS_ANTICIPATION_V5';
  const purchase={_id:purchaseId,clientId,generationId,mode:'PURCHASES_V1',status:'COMPLETED',fileName:'compras-sinteticas.csv',completedAt:'2025-01-31T12:00:00Z',
    anticipationVersion:version,reportPeriod:{startMonth:'2025-01',endMonth:'2025-09',months:9},
    purchaseInput:{anticipation:{...estimate,version,...(inline==='invalid'?{amountCents:null}:{})}}};
  const difal=outgoingResponse().difal;
  const sales={_id:salesId,clientId,generationId,mode:'SALES_V1',status:'COMPLETED',fileName:'vendas-sinteticas.csv',difalVersion:difal.version,
    reportPeriod:options.salesPeriod||{startMonth:'2025-01',endMonth:'2025-09',months:9},purchaseInput:{difal}};
  const generation={_id:generationId,companies:[{clientId,purchaseJobId:purchaseId,purchase,salesJobId:salesId,sales}]};
  const counts={source:0,metadata:0,entry:0,exit:0,writes:0},errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))counts.writes++;});
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota fora da fixture sintética.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic-difal',workspaceId:'synthetic',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[{_id:clientId,...analysis.company,active:true}]}}));
  await page.route(`**/api/v4/analyses/${analysisId}?*`,async route=>{
    if(new URL(route.request().url()).searchParams.has('includeSource')){
      counts.source++;await options.sourceGate?.promise;
      await route.fulfill({json:{analysis,source:null,...(options.sourceError?{sourceError:{code:'SOURCE_RECONCILIATION',message:options.sourceError}}:{})}});
    }else await route.fulfill({json:{analysis}});
  });
  await page.route(`**/api/v4/generations/${generationId}`,route=>{
    counts.metadata++;
    return counts.metadata===options.metadataFailureAt?route.fulfill({status:503,json:{error:'TEMPORARY',message:'Metadados temporariamente indisponíveis. Tente novamente.'}}):route.fulfill({json:generation});
  });
  await page.route(`**/api/v4/purchases/${purchaseId}/difal-period`,async route=>{
    const reply=options.entry?await options.entry(++counts.entry):(counts.entry++,{json:response()});
    await route.fulfill(reply);
  });
  await page.route(`**/api/v4/sales/${salesId}/difal-period`,async route=>{
    const reply=options.exit?await options.exit(++counts.exit):(counts.exit++,{json:outgoingResponse()});
    await route.fulfill(reply);
  });
  return {counts,errors};
}
const entry=(page:Page)=>page.locator('[data-difal-assessment="entry"]');
const amount=(page:Page)=>entry(page).locator('[data-difal-detected-amount]');
const retry=(page:Page)=>page.locator('#analysis-difal-retry');
const open=(page:Page,step='difal')=>page.goto(`/analyses.html?id=${analysisId}&sector=fiscal&step=${step}`);
async function releaseSource(page:Page,hold:ReturnType<typeof gate>){
  const settled=page.waitForResponse(result=>result.url().includes(`${analysisId}?includeSource=1`));
  hold.release();await(await settled).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

test('consulta em andamento mostra Conferindo nos dois cartões; atualização real preserva escolhas sem reler RBT12/source',async({page})=>{
  const first=gate(),second=gate();
  const {counts,errors}=await setup(page,{entry:async attempt=>{await(attempt===1?first:second).promise;return {json:response(attempt===1?7320:14640)};}});
  try{
    await open(page,'documents');
    const card=page.locator('[data-analysis-document-difal="PURCHASES"]');
    await expect(card).toHaveAttribute('data-difal-state','reading');await expect(card).toContainText('Conferindo…');await expect(card).not.toContainText('Indisponível');
    await page.locator('#analysis-wizard-next').click();
    await expect(entry(page)).toHaveAttribute('data-difal-state','reading');await expect(amount(page)).toHaveCount(0);await expect(retry(page)).toBeDisabled();
    first.release();await expect(amount(page)).toContainText('73,20');
    await page.locator('#analysis-difal-yes').check();await page.locator('[data-difal-include="hybrid"]').uncheck();
    await retry(page).click();await expect(entry(page)).toHaveAttribute('data-difal-state','reading');await expect(retry(page)).toBeDisabled();
    await expect(page.locator('#analysis-difal-yes')).toBeChecked();await expect(page.locator('[data-difal-include="hybrid"]')).not.toBeChecked();
    second.release();await expect(amount(page)).toContainText('146,40');await expect(retry(page)).toBeEnabled();
    await expect(page.locator('#analysis-difal-yes')).toBeChecked();await expect(page.locator('[data-difal-include="hybrid"]')).not.toBeChecked();
    expect(counts).toEqual({source:1,metadata:2,entry:2,exit:1,writes:0});expect(errors).toEqual([]);
  }finally{first.release();second.release();}
});

test('503 informa motivo e código, retry recupera o DIFAL sem apagar erro independente da conciliação',async({page})=>{
  const requestId='18888888-8888-4888-8888-888888888888';
  const {counts,errors}=await setup(page,{sourceError:'Totais da origem ainda não conciliados.',entry:attempt=>attempt===1?
    {status:503,json:{error:'SOURCE_UNAVAILABLE',message:'Banco de origem temporariamente indisponível. Tente novamente.',requestId}}:{json:response()}});
  await open(page);await expect(entry(page)).toHaveAttribute('data-difal-state','unavailable');
  await expect(entry(page)).toContainText('Banco de origem temporariamente indisponível');await expect(entry(page)).toContainText(requestId);
  await expect(amount(page)).toHaveCount(0);await expect(retry(page)).toBeEnabled();
  await expect(page.locator('#analysis-fiscal-evidence')).toContainText('Totais da origem ainda não conciliados.');
  await retry(page).click();await expect(entry(page)).toHaveAttribute('data-difal-state','available');await expect(amount(page)).toContainText('73,20');
  await expect(page.locator('#analysis-difal-no')).toBeChecked();await expect(page.locator('#analysis-rbt12')).toHaveValue('120000.00');
  await expect(page.locator('#analysis-fiscal-evidence')).toContainText('Totais da origem ainda não conciliados.');
  expect(counts).toEqual({source:1,metadata:2,entry:2,exit:1,writes:0});expect(errors).toEqual([]);
});

test('resposta incompleta pode ser tentada novamente antes de source terminar; resposta antiga não restaura erro anterior',async({page})=>{
  const hold=gate();const {counts,errors}=await setup(page,{sourceGate:hold,entry:attempt=>({json:attempt===1?{...response(),anticipation:{...estimate,amountCents:null}}:response(14640)})});
  try{
    await open(page);await expect(entry(page)).toHaveAttribute('data-difal-state','unavailable');await expect(entry(page)).toContainText('incompletos ou inconsistentes');
    await expect(retry(page)).toBeEnabled();await retry(page).click();await expect(amount(page)).toContainText('146,40');
    await releaseSource(page,hold);await expect(entry(page)).toHaveAttribute('data-difal-state','available');await expect(amount(page)).toContainText('146,40');
    expect(counts).toEqual({source:1,metadata:2,entry:2,exit:1,writes:0});expect(errors).toEqual([]);
  }finally{hold.release();}
});

test('resumo inline atual incompleto busca estimativa validada em vez de permanecer indisponível',async({page})=>{
  const {counts,errors}=await setup(page,{inline:'invalid'});await open(page);
  await expect(entry(page)).toHaveAttribute('data-difal-state','available');await expect(amount(page)).toContainText('73,20');
  expect(counts).toEqual({source:1,metadata:1,entry:1,exit:0,writes:0});expect(errors).toEqual([]);
});

test('source inicial lento não apaga falha mais nova dos metadados nem bloqueia nova tentativa',async({page})=>{
  const hold=gate(),{counts,errors}=await setup(page,{inline:'valid',sourceGate:hold,metadataFailureAt:2});
  try{
    await open(page);await expect(entry(page)).toHaveAttribute('data-difal-state','available');await expect(retry(page)).toBeEnabled();
    await retry(page).click();await expect(entry(page)).toHaveAttribute('data-difal-state','unavailable');
    await expect(entry(page)).toContainText('Metadados temporariamente indisponíveis');await expect(retry(page)).toBeEnabled();
    await releaseSource(page,hold);await expect(entry(page)).toHaveAttribute('data-difal-state','unavailable');
    await expect(entry(page)).toContainText('Metadados temporariamente indisponíveis');await expect(retry(page)).toBeEnabled();
    await retry(page).click();await expect(amount(page)).toContainText('73,20');await expect(page.locator('#analysis-difal-no')).toBeChecked();
    expect(counts).toEqual({source:1,metadata:3,entry:1,exit:1,writes:0});expect(errors).toEqual([]);
  }finally{hold.release();}
});

for(const width of [320,390])test(`saída desativada mantém evidência pendente e recupera sem alterar entrada em ${width}px`,async({page},info)=>{
  const initial=gate(),renewed=gate();
  const invalidPeriod=width===320;
  const note=invalidPeriod?'Não foi possível confirmar as competências de janeiro a setembro. Confira o período do relatório.':
    'Fonte de vendas temporariamente indisponível. Tente novamente.';
  const {counts,errors}=await setup(page,{inline:'valid',salesPeriod:{startMonth:'2025-01',endMonth:'2025-12',months:12},exit:async attempt=>{
    await(attempt===1?initial:renewed).promise;
    if(attempt===1)return invalidPeriod?{json:{...outgoingResponse(),period:{...period,complete:false}}}:
      {status:503,json:{error:'SOURCE_UNAVAILABLE',message:note}};
    return {json:outgoingResponse()};
  }});
  const card=page.locator('[data-analysis-document-difal="SALES"]'),exit=page.locator('[data-difal-assessment="exit"]');
  try{
    await page.setViewportSize({width,height:850});await open(page,'documents');
    await expect(card).toHaveAttribute('data-difal-state','reading');await expect(card).toHaveAttribute('data-difal-application-state','disabled');
    await expect(card.locator('[data-analysis-document-difal-amount]')).toHaveText('Não aplicado');
    await expect(card.locator('[data-difal-evidence-note]')).toContainText('Conferência do relatório em andamento');
    await expect(card).not.toContainText('R$ 0,00');
    initial.release();await expect(card).toHaveAttribute('data-difal-state','unavailable');
    await expect(card.locator('[data-difal-evidence-note]')).toBeVisible();await expect(card.locator('[data-difal-evidence-note]')).toContainText(note);
    await expect(card.locator('[data-analysis-document-difal-amount]')).toHaveText('Não aplicado');
    await expect(card).not.toContainText('R$ 0,00');await card.scrollIntoViewIfNeeded();
    expect(await page.locator('#analysis-wizard').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await card.screenshot({path:info.outputPath(`outgoing-policy-pending-${width}.png`)});
    await page.locator('#analysis-wizard-next').click();
    await expect(exit).toHaveAttribute('data-difal-state','unavailable');await expect(exit).toHaveAttribute('data-difal-application-state','disabled');
    await expect(exit.locator('.analysis-difal-result-heading')).toContainText('Saída não aplicada pela regra da análise');
    await expect(exit.locator('[data-difal-evidence-note]')).toBeVisible();await expect(exit.locator('[data-difal-evidence-note]')).toContainText(note);
    await expect(exit.locator('details [data-difal-evidence-note]')).toHaveCount(0);
    await expect(exit.locator('details')).not.toHaveAttribute('open');await expect(exit.locator('[data-difal-detected-amount]')).toHaveCount(0);
    await expect(entry(page)).toHaveAttribute('data-difal-state','available');await expect(amount(page)).toContainText('73,20');
    await expect(page.locator('#analysis-difal-no')).toBeChecked();await expect(retry(page)).toBeEnabled();
    expect(await page.locator('#analysis-wizard').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await exit.screenshot({path:info.outputPath(`outgoing-assessment-pending-${width}.png`)});
    await retry(page).click();await expect(exit).toHaveAttribute('data-difal-state','reading');
    await expect(exit.locator('.analysis-difal-result-heading')).toContainText('Saída não aplicada pela regra da análise');
    await expect(exit.locator('[data-difal-evidence-note]')).toBeVisible();await expect(exit.locator('[data-difal-detected-amount]')).toHaveCount(0);
    renewed.release();await expect(exit).toHaveAttribute('data-difal-state','disabled');
    await expect(exit.locator('[data-difal-detected-amount]')).toHaveText('R$ 0,00');await expect(exit.locator('[data-difal-evidence-note]')).toHaveCount(0);
    await expect(amount(page)).toContainText('73,20');await expect(page.locator('#analysis-difal-no')).toBeChecked();
    await page.locator('#analysis-wizard-back').click();await expect(card).toHaveAttribute('data-difal-state','ready');
    await expect(card.locator('[data-analysis-document-difal-amount]')).toHaveText('R$ 0,00');await expect(card).toContainText('janeiro a setembro de 2025');
    expect(counts).toEqual({source:1,metadata:2,entry:1,exit:2,writes:0});expect(errors).toEqual([]);
  }finally{initial.release();renewed.release();}
});
