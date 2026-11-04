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
  await expect(page.locator('#tax-demonstrativo > .dre-tax-table thead th')).toHaveCount(ids.length+1);
}

export async function expectConsolidatedDre(page:Page){
  await expect(page.locator('#dre-display-period')).toHaveCount(0);
  await expect(page.locator('#dre-display-status')).toContainText('Consolidado de janeiro a setembro');
  await expect(page.locator('#tax-demonstrativo')).toHaveAttribute('data-tax-period','annual');
}

/** Read monthly values through the real report control and download action. */
export async function readDreMonthlyCsv(page:Page):Promise<string[][]>{
  const control=page.locator('#dre-report-period'),previous=await control.inputValue();
  await control.selectOption('monthly');
  try{
    const downloaded=page.waitForEvent('download');await page.locator('#export-dre-csv').click();
    const stream=await(await downloaded).createReadStream(),parts:Buffer[]=[];
    for await(const part of stream!)parts.push(Buffer.from(part));
    const csv=Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/,''),rows:string[][]=[];
    let row:string[]=[],cell='',quoted=false;
    for(let index=0;index<csv.length;index++){
      const char=csv[index];
      if(char==='"'){
        if(quoted&&csv[index+1]==='"'){cell+='"';index++;}else quoted=!quoted;
      }else if(!quoted&&char===';'){row.push(cell);cell='';}
      else if(!quoted&&char==='\r'&&csv[index+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';index++;}
      else cell+=char;
    }
    return rows;
  }finally{await control.selectOption(previous);}
}

/** Monthly cells followed by the captured period total, without notes/references. */
export function dreMonthlyValues(rows:string[][],regime:string,label:string,scope='DRE'):string[]{
  const matches=rows.filter(row=>row[0]===regime&&row[1]===scope&&row[3]?.replace(/^'/,'')===label);
  expect(matches,`${scope}: ${label} · ${regime}`).toHaveLength(1);
  return matches[0].slice(6,-2);
}
