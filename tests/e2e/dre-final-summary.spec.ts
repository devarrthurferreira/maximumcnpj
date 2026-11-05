import {test,expect} from '@playwright/test';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';
import {expectConsolidatedDre} from './dre-controls.ts';

test('impostos, resumo expansível e DRE compartilham os regimes e a impressão',async({page},info)=>{
  const saved=drePdfFixture(),before=JSON.stringify(saved),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Conferência sintética'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  await expectConsolidatedDre(page);

  const tax=page.locator('#tax-demonstrativo'),summary=page.locator('#dre-summary'),dre=page.locator('#dre-demonstrativo');
  const order=await page.locator('#simulation-result').evaluate(element=>['tax-demonstrativo','dre-summary','dre-demonstrativo']
    .map(id=>element.querySelector('#'+id)!)
    .every((item,index,array)=>index===0||Boolean(array[index-1].compareDocumentPosition(item)&Node.DOCUMENT_POSITION_FOLLOWING)));
  expect(order).toBe(true);
  await expect(tax.locator('[data-dre-visible-regime]')).toHaveCount(4);
  for(const section of [tax,summary,dre])await expect(section.locator('> .dre-table-wrap thead th')).toHaveCount(5);

  const revenue=summary.locator('[data-summary-toggle="revenue"]'),deductions=summary.locator('[data-summary-toggle="revenueTaxes"]');
  await expect(revenue).toHaveAttribute('aria-expanded','true');
  await expect(summary.locator('#summary-child-revenue-services')).toBeVisible();
  await expect(summary.locator('#summary-child-revenue-sales')).toBeVisible();
  await revenue.click();
  await expect(summary.locator('#summary-child-revenue-services')).toBeHidden();
  await expect(deductions).toHaveAttribute('aria-expanded','false');
  await deductions.click();
  await expect(summary.locator('#summary-child-revenueTaxes-icmsDebit')).toBeVisible();
  await summary.locator('[data-summary-toggle="costsWithAnticipation"]').click();
  await expect(summary.locator('#summary-child-costsWithAnticipation-cbsIbsCredit')).toBeVisible();

  await tax.locator('[data-dre-visible-regime="pure"]').uncheck();
  for(const section of [tax,summary,dre])await expect(section.locator('> .dre-table-wrap thead th')).toHaveCount(4);
  await expect(summary.locator('[data-summary-toggle="revenue"]')).toHaveAttribute('aria-expanded','false');
  await expect(summary.locator('#summary-child-revenueTaxes-icmsDebit')).toBeVisible();
  await expect(summary.locator('#summary-child-costsWithAnticipation-cbsIbsCredit')).toBeVisible();

  await page.evaluate(()=>{window.print=()=>{};});
  await page.locator('#print-dre').click();
  const printed=page.locator('#dre-print-document'),pages=printed.locator('> .dre-final-page');
  await expect(pages).toHaveCount(2);
  await expect(pages.first()).toContainText('Impostos e indicadores');
  await expect(pages.first()).toContainText('Receitas de serviços');
  await expect(pages.first()).toContainText('Receita de vendas');
  await expect(pages.last()).toContainText('DRE - Consolidado');
  await expect(printed).not.toContainText('Simples Puro');
  await page.emulateMedia({media:'print'});
  await page.pdf({path:info.outputPath('dre-impressao.pdf'),preferCSSPageSize:true,printBackground:true});
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  expect(errors).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
});
