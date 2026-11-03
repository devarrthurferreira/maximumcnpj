import {test,expect} from '@playwright/test';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';

for(const width of [1280,1024,390])test(`Roda do mouse sobre a DRE rola a página nos dois sentidos em ${width}px`,async({page})=>{
  const saved=drePdfFixture(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',role:'viewer',name:'Teste de rolagem'}}}));
  await page.route('**/api/v4/simulations/'+saved._id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+saved._id);
  const table=page.locator('#dre-demonstrativo > .dre-table-wrap');
  await expect(table).toBeVisible();
  // The complete statement grows with its rows; only the document scrolls vertically.
  expect(await table.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeLessThanOrEqual(1);
  await table.evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.evaluate(()=>window.scrollBy(0,-150));
  await table.locator('tbody tr').nth(2).locator('th').hover();
  const before=await page.evaluate(()=>window.scrollY);expect(before).toBeGreaterThan(0);
  await page.mouse.wheel(0,400);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before+100);
  const down=await page.evaluate(()=>window.scrollY);
  await page.mouse.wheel(0,-250);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeLessThan(down-100);
  if(width===390){
    expect(await table.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeGreaterThan(100);
    const left=await table.evaluate(element=>element.scrollLeft);
    await page.mouse.wheel(250,0);
    await expect.poll(()=>table.evaluate(element=>element.scrollLeft)).toBeGreaterThan(left+100);
    expect(await page.evaluate(()=>window.scrollX)).toBe(0);
  }
  expect(errors).toEqual([]);
});
