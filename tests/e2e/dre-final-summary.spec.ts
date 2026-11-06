import {test,expect} from '@playwright/test';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';
import {expectConsolidatedDre} from './dre-controls.ts';

test('DRE parcial abre sem exigir relatórios ausentes e direciona ao setor pendente',async({page})=>{
  const saved:any=drePdfFixture();
  saved.analysisId='96969696-9696-4696-8696-969696969606';
  saved.generationId=null;saved.source.generationId=null;saved.source.sourceKind='ACCOUNTING_ONLY';
  for(const key of ['purchases','sales'])Object.assign(saved.source[key],{jobId:null,available:false});
  saved.partialData={status:'INCOMPLETE',missingSectors:['fiscal'],warning:'DRE gerada sem o setor Fiscal concluído. Os valores fiscais não representam dados confirmados.'};
  saved.result.warnings.push({code:'analysis-partial-sectors',title:'DRE sem Fiscal',detail:saved.partialData.warning});
  const errors:string[]=[],refreshRequests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/refresh'))refreshRequests.push(request.url());});
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id+'&current=1');
  await expectConsolidatedDre(page);
  await expect(page.locator('[data-partial-data="fiscal"]')).toContainText('DRE sem Fiscal');
  await expect(page.locator('[data-fill-missing-sector="fiscal"]')).toHaveAttribute('href','/analyses.html?id='+saved.analysisId+'&sector=fiscal');
  await expect(page.locator('.sim-source a')).toHaveCount(0);
  await expect(page.locator('#simulator-projection')).toHaveCount(0);
  await expect(page.locator('#tax-demonstrativo [data-partial-dre-warning]')).toContainText('não representam dados confirmados');
  expect(errors).toEqual([]);expect(refreshRequests).toEqual([]);
});

test('DRE e impressão alertam quando espécie das saídas não foi capturada',async({page})=>{
  const saved=drePdfFixture();
  saved.result.warnings.push({code:'sales-species-missing',severity:'warning',title:'Espécie das vendas não identificada',detail:'Reimporte o relatório de saídas para identificar NFC-e.'});
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expectConsolidatedDre(page);
  await expect(page.locator('#tax-demonstrativo [data-sales-species-warning]')).toContainText('Reimporte o relatório de saídas');
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  await expect(page.locator('#dre-print-document [data-sales-species-warning]')).toContainText('identificar NFC-e');
});

test('DRE e impressão usam devoluções no débito de ICMS e compras no crédito',async({page},info)=>{
  const saved=drePdfFixture(),credits=saved.result.credits.icms,memory=saved.result.memory;
  const get=(id:string)=>memory.find((row:any)=>row.id===id).value;
  const money=(value:number)=>`${value<0?'-':''}R$ ${Math.abs(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  expect(credits.debit).toBeCloseTo(get('icms.salesGrossDebit')-get('icms.returnDebitReduction')+get('icms.debitFloorAdjustment'),2);
  expect(credits.potential).toBeCloseTo(get('icms.purchaseCredit'),2);
  expect(memory.some((row:any)=>row.id==='icms.returnCredit')).toBe(false);
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expectConsolidatedDre(page);
  const tax=page.locator('#tax-demonstrativo'),dre=page.locator('#dre-demonstrativo');
  await tax.locator('.dre-tax-details > summary').click();
  const detail=tax.locator('[data-icms-reconciliation="dre"]');
  await expect(detail.locator('[data-dre-row="icms.debit"] td').nth(2)).toHaveText(money(credits.debit));
  await expect(detail.locator('[data-dre-row="icms.returnDebitReduction"] td').nth(2)).toHaveText(money(-get('icms.returnDebitReduction')));
  await expect(detail.locator('[data-dre-row="icms.purchaseCredit"] td').nth(2)).toHaveText(money(credits.potential));
  await expect(detail.locator('[data-dre-row="icms.returnCredit"]')).toHaveCount(0);
  await expect(dre.locator('[data-dre-row="icmsDebit"] td').nth(2)).toHaveText(money(-credits.debit));
  await expect(dre.locator('[data-dre-row="icmsCredit"] td').nth(2)).toHaveText(money(credits.used));
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#print-dre').click();
  const printed=page.locator('#dre-print-document');
  await expect(printed.locator('> .dre-final-page')).toHaveCount(2);
  await expect(printed.locator('[data-dre-row="icmsDebit"] td').nth(2)).toHaveText(money(-credits.debit));
  await expect(printed.locator('[data-dre-row="icmsCredit"] td').nth(2)).toHaveText(money(credits.used));
  await page.emulateMedia({media:'print'});
  await page.pdf({path:info.outputPath('dre-icms-devolucoes.pdf'),preferCSSPageSize:true,printBackground:true});
});

test('impostos e DRE detalhável compartilham os regimes e a impressão',async({page},info)=>{
  const saved=drePdfFixture(),before=JSON.stringify(saved),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expectConsolidatedDre(page);

  const tax=page.locator('#tax-demonstrativo'),dre=page.locator('#dre-demonstrativo');
  const order=await page.locator('#simulation-result').evaluate(element=>['tax-demonstrativo','dre-demonstrativo']
    .map(id=>element.querySelector('#'+id)!)
    .every((item,index,array)=>index===0||Boolean(array[index-1].compareDocumentPosition(item)&Node.DOCUMENT_POSITION_FOLLOWING)));
  expect(order).toBe(true);
  await expect(page.locator('#dre-summary')).toHaveCount(0);
  await expect(tax.locator('[data-dre-visible-regime]')).toHaveCount(4);
  for(const section of [tax,dre])await expect(section.locator('> .dre-table-wrap thead th')).toHaveCount(5);
  await expect(tax.locator('[data-tax-row="taxBurden"] + .dre-indicator-spacer + [data-tax-row="grossAfterCosts"]')).toHaveCount(1);
  expect(await tax.locator('.dre-indicator-spacer').evaluate(row=>row.getBoundingClientRect().height)).toBeGreaterThanOrEqual(16);

  // A DRE mantém todos os itens abertos inicialmente e permite recolhê-los por grupo.
  await expect(dre.locator('[data-dre-group-toggle]')).toHaveCount(5);
  for(const id of ['services','sales'])await expect(dre.locator(`#dre-child-revenue-${id}`)).toBeVisible();
  for(const id of ['das','icmsDebit','cbsIbsDebit','iss','difal'])await expect(dre.locator(`#dre-child-revenueTaxes-${id}`)).toBeVisible();
  for(const id of ['cmvSimple','cmvRegular','icmsAnticipation','cbsIbsCredit','icmsCredit'])await expect(dre.locator(`#dre-child-costsWithAnticipation-${id}`)).toBeVisible();
  for(const id of ['salaries','benefits','payroll','rent','cards','administrative'])await expect(dre.locator(`#dre-child-operatingExpensesWithPayroll-${id}`)).toBeVisible();
  for(const id of ['irpj','csll'])await expect(dre.locator(`#dre-child-resultBeforeIncomeTaxes-${id}`)).toBeVisible();
  await expect(dre.locator('[data-dre-group-toggle="costsWithAnticipation"]')).toContainText('Compras e Serviços');
  await expect(dre.locator('[data-dre-row="cmvSimple"] th')).toHaveText('Compras e serviços (do Simples)');
  await expect(dre.locator('[data-dre-row="cmvRegular"] th')).toHaveText('Compras e serviços (fora do Simples)');
  await expect(dre.locator('[data-dre-group-toggle="resultBeforeIncomeTaxes"]')).toContainText('Resultado Antes do IRPJ/CSLL');
  await expect(dre.locator('[data-dre-row="benefits"] th')).toHaveText('Benefícios e Encargos');
  await expect(dre.locator('[data-dre-row="payroll"] th')).toHaveText('INSS');
  await dre.locator('[data-dre-group-toggle="revenue"]').click();
  await dre.locator('[data-dre-group-toggle="revenueTaxes"]').click();
  await expect(dre.locator('#dre-child-revenue-services')).toBeHidden();
  await expect(dre.locator('#dre-child-revenueTaxes-icmsDebit')).toBeHidden();

  await tax.locator('[data-dre-visible-regime="pure"]').uncheck();
  for(const section of [tax,dre])await expect(section.locator('> .dre-table-wrap thead th')).toHaveCount(4);
  await expect(dre.locator('[data-dre-group-toggle="revenue"]')).toHaveAttribute('aria-expanded','false');
  await expect(dre.locator('#dre-child-revenueTaxes-icmsDebit')).toBeHidden();
  await page.locator('#dre-show-percent').check();
  await expect(dre.locator('#dre-child-revenue-services')).toBeHidden();
  await dre.locator('[data-dre-group-toggle="revenue"]').click();
  await expect(dre.locator('#dre-child-revenue-services')).toBeVisible();

  await page.evaluate(()=>{window.print=()=>{};});
  await page.locator('#print-dre').click();
  const printed=page.locator('#dre-print-document'),pages=printed.locator('> .dre-final-page');
  await expect(pages).toHaveCount(2);
  await expect(pages.locator('.dre-print-letterhead')).toHaveCount(2);
  await expect.poll(()=>pages.locator('.dre-print-letterhead').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth===1414))).toBe(true);
  await expect(pages.first()).toContainText('Impostos e indicadores');
  await expect(pages.first().locator('[data-dre-combined-rate]')).toContainText('11,40%');
  await expect(pages.first()).not.toContainText('Resumo dos resultados');
  await expect(pages.first().locator('[data-tax-row="taxBurden"] + .dre-indicator-spacer + [data-tax-row="grossAfterCosts"]')).toHaveCount(1);
  await expect(pages.last()).toContainText('DRE - Consolidado');
  await expect(pages.last()).toContainText('Receitas de serviços');
  await expect(pages.last()).toContainText('Receita de vendas');
  await expect(pages.last()).toContainText('ICMS Débito');
  await expect(pages.last()).toContainText('CSLL');
  await expect(pages.last()).toContainText('Compras e Serviços');
  await expect(pages.last()).toContainText('Compras e serviços (do Simples)');
  await expect(pages.last()).toContainText('Compras e serviços (fora do Simples)');
  await expect(pages.last()).toContainText('Resultado Antes do IRPJ/CSLL');
  await expect(printed).not.toContainText('Simples Puro');
  await page.emulateMedia({media:'print'});
  await page.pdf({path:info.outputPath('dre-impressao.pdf'),preferCSSPageSize:true,printBackground:true});
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  expect(errors).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
});
