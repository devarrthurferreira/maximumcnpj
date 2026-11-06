import {test,expect,type Page} from '@playwright/test';
import {defaultFiscalData} from '../../src/analysis-contract.ts';

const analysisId='19222222-2222-4222-8222-222222222221';
const clientId='19222222-2222-4222-8222-222222222222';
const simulationId='19222222-2222-4222-8222-222222222223';
const selection={version:'REGIME_SELECTION_V1' as const,selected:['actual' as const]};
function record(missing:'fiscal'|'accounting',allowed=true){
  return {id:analysisId,clientId,version:'ANALYSIS_SECTORS_V1',periodPolicy:'JAN_SEP_V1',revision:4,
    company:{code:'PARTIAL-UI',name:'Empresa sintética com setor pendente',cnpj:null},
    config:{revision:1,year:2027,regimeSelection:selection},
    fiscal:{revision:1,status:missing==='fiscal'?'DRAFT':'COMPLETE',data:defaultFiscalData(selection)},
    accounting:{revision:1,status:missing==='accounting'?'DRAFT':'COMPLETE',data:{months:[{sourceMonth:'2025-01',salariesCents:12000,rentCents:5000,cardExpensesCents:0,benefitsCents:1000,adminExpensesCents:0,financialExpensesCents:0,financialIncomeCents:0}]}},
    readiness:{ready:false,verification:'SAVED',months:['2025-01'],issues:[{code:missing.toUpperCase()+'_NOT_CONFIRMED',sector:missing,message:'Setor ainda não concluído.'}],partial:{allowed,missingSectors:[missing]}},currentSimulation:null};
}
async function setup(page:Page,missing:'fiscal'|'accounting',allowed=true,role='operator'){
  const analysis=record(missing,allowed),requests:any[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota fora da fixture sintética.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic-partial',role,name:'Teste'}}}));
  await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[{_id:clientId,...analysis.company,active:true}]}}));
  await page.route('**/api/v4/analyses?*',route=>route.fulfill({json:{items:[analysis],pagination:{page:1,total:1,totalPages:1,pageSize:20}}}));
  await page.route(`**/api/v4/analyses/${analysisId}?*`,route=>route.fulfill({json:{analysis,source:null}}));
  await page.route(`**/api/v4/analyses/${analysisId}`,route=>route.fulfill({json:{analysis,source:null}}));
  await page.route(`**/api/v4/analyses/${analysisId}/generate?*`,async route=>{
    requests.push(route.request().postDataJSON());
    await route.fulfill({json:{analysis:{...analysis,currentSimulation:{id:simulationId,analysisRevision:analysis.revision,stale:false,legacy:false}},simulation:{_id:simulationId}}});
  });
  await page.route('**/simulator.html?*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>DRE sintética</title><h1>DRE sintética</h1>'}));
  return {analysis,requests,errors};
}

for(const missingAccounting of [false,true]){
  test(`Fiscal desatualizado${missingAccounting?' e Contábil pendente':''} é conferido antes da confirmação e permite gerar com aviso`,async({page})=>{
    const {analysis,requests,errors}=await setup(page,'fiscal');
    analysis.fiscal.status='COMPLETE';analysis.accounting.status=missingAccounting?'DRAFT':'COMPLETE';
    // The fast navigation summary still looks confirmed; only the full read detects changed fiscal documents.
    analysis.readiness={...analysis.readiness,ready:true,issues:[],partial:{allowed:false,missingSectors:[]}};
    const summary={...analysis,currentSimulation:{id:'19222222-2222-4222-8222-222222222224',analysisRevision:analysis.revision,stale:false,legacy:false}};
    const verified={...summary,currentSimulation:{...summary.currentSimulation,stale:true},readiness:{...analysis.readiness,ready:false,verification:undefined,
      issues:[{code:'FISCAL_SOURCE_CHANGED',sector:'fiscal',message:'Os arquivos ou as opções fiscais mudaram após a confirmação.'}],
      partial:{allowed:true,missingSectors:missingAccounting?['fiscal','accounting']:['fiscal'],fiscalDataUsed:true}}};
    let fullReads=0;
    await page.route(`**/api/v4/analyses/${analysisId}?*`,route=>route.fulfill({json:{analysis:summary}}));
    await page.route(`**/api/v4/analyses/${analysisId}`,route=>{fullReads++;return route.fulfill({json:{analysis:verified}});});
    await page.goto(`/analyses.html?id=${analysisId}`);
    const button=page.locator('#analysis-generate');await expect(button).toBeVisible();await expect(button).toBeEnabled();await expect(button).toHaveText('Conferir e atualizar DRE');
    page.once('dialog',async dialog=>{
      expect(fullReads).toBe(1);expect(dialog.message()).toContain('documentos e as opções fiscais atuais');
      expect(dialog.message()).toContain('reconfirmação');expect(dialog.message()).not.toContain('somente os dados do Contábil');
      if(missingAccounting)expect(dialog.message()).toContain('despesas serão consideradas zero');
      await dialog.dismiss();
    });
    await button.click();expect(requests).toHaveLength(0);await expect(page.locator('#analysis-generation')).toContainText('Fiscal está pendente de reconfirmação');
    await expect(page.locator('#analysis-generate')).toBeEnabled();
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain('incompleto');await dialog.accept();});
    await page.locator('#analysis-generate').click();
    await expect(page).toHaveURL(new RegExp(`/simulator.html\\?simulation=${simulationId}&current=1`));
    expect(fullReads).toBe(2);expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({expectedRevision:4,confirmedMissingSectors:missingAccounting?['fiscal','accounting']:['fiscal']});
    expect(analysis.accounting.data.months[0].salariesCents).toBe(12000);expect(errors).toEqual([]);
  });
}

test('conferência completa abre a DRE pendente já atual sem repetir geração ou pedir confirmação',async({page})=>{
  const {analysis,requests,errors}=await setup(page,'fiscal');
  const summary={...analysis,currentSimulation:{id:simulationId,analysisRevision:analysis.revision,stale:true,legacy:false}};
  const verified={...summary,currentSimulation:{...summary.currentSimulation,stale:false},
    readiness:{...analysis.readiness,partial:{allowed:true,missingSectors:['fiscal'],fiscalDataUsed:true}}};
  await page.route(`**/api/v4/analyses/${analysisId}?*`,route=>route.fulfill({json:{analysis:summary}}));
  let fullReads=0,dialogs=0;
  await page.route(`**/api/v4/analyses/${analysisId}`,route=>{fullReads++;return route.fulfill({json:{analysis:verified}});});
  page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});
  await page.goto(`/analyses.html?id=${analysisId}`);await expect(page.locator('#analysis-generate')).toBeEnabled();
  await page.locator('#analysis-generate').click();
  await expect(page).toHaveURL(new RegExp(`/simulator.html\\?simulation=${simulationId}&current=1`));
  expect(fullReads).toBe(1);expect(dialogs).toBe(0);expect(requests).toHaveLength(0);expect(errors).toEqual([]);
});

test('nova conferência com DRE desatualizada renova a confirmação e o pedido após resposta de geração não confirmada',async({page})=>{
  const {analysis,errors}=await setup(page,'fiscal'),requests:any[]=[];
  const verified={...analysis,currentSimulation:{id:'19222222-2222-4222-8222-222222222224',analysisRevision:analysis.revision,stale:true,legacy:false},
    readiness:{...analysis.readiness,partial:{allowed:true,missingSectors:['fiscal'],fiscalDataUsed:true}}};
  let fullReads=0;
  await page.route(`**/api/v4/analyses/${analysisId}`,route=>{fullReads++;return route.fulfill({json:{analysis:verified}});});
  await page.route(`**/api/v4/analyses/${analysisId}/generate?*`,async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1)return route.fulfill({status:503,json:{error:'TEMPORARY_UNCONFIRMED',message:'Resposta de geração não confirmada.'}});
    return route.fulfill({json:{analysis:{...verified,currentSimulation:{...verified.currentSimulation,id:simulationId,stale:false}},simulation:{_id:simulationId}}});
  });
  await page.goto(`/analyses.html?id=${analysisId}`);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#analysis-generate').click();
  await expect(page.locator('#analysis-error')).toContainText('Resposta de geração não confirmada.');
  await expect(page.locator('#analysis-generate')).toBeEnabled();
  let reconfirmed=false;
  page.once('dialog',async dialog=>{reconfirmed=true;expect(dialog.message()).toContain('reconfirmação');await dialog.accept();});
  await page.locator('#analysis-generate').click();await expect(page).toHaveURL(new RegExp(`/simulator.html\\?simulation=${simulationId}&current=1`));
  expect(reconfirmed).toBe(true);expect(fullReads).toBe(2);expect(requests).toHaveLength(2);
  expect(requests[0].expectedRevision).toBe(requests[1].expectedRevision);expect(requests[0].confirmedMissingSectors).toEqual(requests[1].confirmedMissingSectors);
  expect(requests[0].requestId).not.toBe(requests[1].requestId);expect(errors).toEqual([]);
});

for(const missing of ['fiscal','accounting'] as const){
  test(`DRE sem ${missing} confirma o setor exato e cancelar preserva o preenchimento`,async({page})=>{
    const {analysis,requests,errors}=await setup(page,missing),before=structuredClone(analysis),name=missing==='fiscal'?'Fiscal':'Contábil';
    await page.goto(`/analyses.html?id=${analysisId}`);
    const generate=page.locator('#analysis-generate');await expect(generate).toBeEnabled();
    await expect(page.locator('#analysis-generation')).toContainText(`O setor ${name} ainda não foi concluído`);
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain(`sem o ${name}`);await dialog.dismiss();});
    await generate.click();expect(requests).toHaveLength(0);expect(analysis).toEqual(before);await expect(generate).toBeEnabled();
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain('incompleta');await dialog.accept();});
    await generate.click();await expect(page).toHaveURL(new RegExp(`/simulator.html\\?simulation=${simulationId}&current=1`));
    expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({expectedRevision:4,confirmedMissingSectors:[missing]});expect(requests[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(analysis).toEqual(before);expect(errors).toEqual([]);
  });
}

test('o navegador mantém a geração bloqueada quando o servidor não autoriza dados parciais',async({page})=>{
  const {requests,errors}=await setup(page,'fiscal',false);await page.goto(`/analyses.html?id=${analysisId}`);
  await expect(page.locator('#analysis-generate')).toBeDisabled();expect(requests).toHaveLength(0);expect(errors).toEqual([]);
});

test('cards permitem preencher o setor pendente e revisar o setor concluído no mesmo trabalho',async({page},info)=>{
  const {errors}=await setup(page,'fiscal');await page.goto('/analyses.html?view=list');
  const card=page.locator(`[data-analysis-id="${analysisId}"]`);
  await expect(card.locator('[data-analysis-card-sector="fiscal"]')).toContainText('Preencher Fiscal');
  await expect(card.locator('[data-analysis-card-sector="accounting"]')).toContainText('Revisar dados');
  await expect(card.locator('[data-analysis-card-sector="accounting"]')).toContainText('Conferido');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`partial-analysis-cards-${width}.png`),fullPage:true});
  }
  await card.locator('[data-analysis-card-sector="accounting"]').click();
  await expect(page).toHaveURL(new RegExp(`id=${analysisId}&sector=accounting`));
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind','accounting');
  await expect(page.locator('[data-accounting-average="salariesCents"]')).toHaveValue('120.00');
  expect(errors).toEqual([]);
});


test('limpeza da Diretoria exige confirmação e apresenta as contagens confirmadas pelo servidor',async({page})=>{
  const {errors}=await setup(page,'fiscal',true,'admin');let cleanup=0;
  await page.route('**/api/v4/analyses/cleanup-versions',async route=>{
    cleanup++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({confirmed:true});
    await route.fulfill({json:{companies:12,removed:35,removedRevisions:18,failed:[{clientId,code:'BUSY'}]}});
  });
  await page.goto('/analyses.html?view=list');await page.locator('.analysis-other-access > summary').click();
  const button=page.locator('#analysis-cleanup-versions');await expect(button).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());await button.click();expect(cleanup).toBe(0);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Fiscal e no Contábil');await dialog.accept();});
  await button.click();await expect(page.locator('#analysis-feedback')).toContainText('12 empresa(s): 35 versão(ões) antiga(s) e 18 revisão(ões) removida(s)');
  await expect(page.locator('#analysis-feedback')).toContainText('1 empresa(s) pendente(s)');await expect(page.locator('#analysis-cleanup-versions')).toBeEnabled();
  expect(cleanup).toBe(1);expect(errors).toEqual([]);
});

test('cards das DREs salvas retomam cada setor e não oferecem versões anteriores',async({page})=>{
  const {analysis,errors}=await setup(page,'fiscal');
  await page.route('**/api/v4/simulations?*',route=>route.fulfill({json:{page:1,pageSize:20,total:1,items:[{
    _id:simulationId,analysisId,clientId,company:analysis.company,year:2027,reportMonths:1,calculationMethod:'REPORT_MONTHS_V1',annualRevenue:0,bestAnnualProfit:-180,bestRegimeName:'Lucro Real',
    createdAt:'2026-11-06T12:00:00Z',parentSimulationId:'19222222-2222-4222-8222-222222222224',partialData:{status:'INCOMPLETE',missingSectors:['fiscal'],warning:'Fiscal não preenchido.'}
  }]}}));
  await page.goto('/simulations.html');const card=page.locator(`[data-simulation-id="${simulationId}"]`);
  await expect(page.locator('h1')).toHaveText('Últimas DREs salvas');await expect(card).toContainText('DRE incompleta');
  await expect(card.locator('a[href$="sector=fiscal"]')).toHaveText('Preencher Fiscal →');await expect(card.locator('a[href$="sector=accounting"]')).toHaveText('Preencher Contábil →');
  await expect(card.locator('.history-parent')).toHaveCount(0);await expect(card.locator('.history-open').last()).toContainText('Abrir última DRE');expect(errors).toEqual([]);
});

test('card da DRE com Fiscal pendente identifica competências dos relatórios utilizados',async({page})=>{
  const {analysis,errors}=await setup(page,'fiscal');
  await page.route('**/api/v4/simulations?*',route=>route.fulfill({json:{page:1,pageSize:20,total:1,items:[{
    _id:simulationId,analysisId,clientId,company:analysis.company,year:2027,reportMonths:1,calculationMethod:'REPORT_MONTHS_V1',annualRevenue:1000,bestAnnualProfit:500,bestRegimeName:'Lucro Real',
    createdAt:'2026-11-06T12:00:00Z',partialData:{status:'INCOMPLETE',missingSectors:['fiscal'],fiscalDataUsed:true,warning:'Documentos fiscais atuais utilizados com conferência pendente.'}
  }]}}));
  await page.goto('/simulations.html');const card=page.locator(`[data-simulation-id="${simulationId}"]`);
  await expect(card.locator('.history-tags')).toContainText('NOS RELATÓRIOS');await expect(card.locator('.history-tags')).not.toContainText('NO CONTÁBIL');
  await expect(card).toContainText('Documentos fiscais atuais utilizados');expect(errors).toEqual([]);
});
