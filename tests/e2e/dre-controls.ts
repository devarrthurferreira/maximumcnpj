import {expect,type Page} from '@playwright/test';

/** Interact with the current statement's real controls; never mutate app state. */
export async function showDreRegimes(page:Page,ids:string[]){
  expect(ids.length).toBeGreaterThan(0);
  for(const id of ids){
    const control=page.locator(`[data-dre-visible-regime="${id}"]`);
    if(!await control.isChecked())await control.check();
  }
  for(const id of ['pure','hybrid','presumed','actual']){
    if(ids.includes(id))continue;
    const control=page.locator(`[data-dre-visible-regime="${id}"]`);
    if(await control.isChecked())await control.uncheck();
  }
  await expect(page.locator('#dre-demonstrativo > .dre-table-wrap thead th')).toHaveCount(ids.length+1);
}

export async function showDreMonth(page:Page,index:number){
  await page.locator('#dre-display-period').selectOption(`month:${index}`);
  await expect(page.locator('#dre-display-period')).toHaveValue(`month:${index}`);
}

export async function showDreConsolidated(page:Page){
  await page.locator('#dre-display-period').selectOption('annual');
  await expect(page.locator('#dre-display-period')).toHaveValue('annual');
}
