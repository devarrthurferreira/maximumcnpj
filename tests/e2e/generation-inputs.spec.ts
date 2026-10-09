import {test,expect,type Page} from '@playwright/test';

const client={_id:'00000000-0000-4000-8000-000000000081',code:'936',name:'EMPRESA SINTÉTICA',cnpj:'11222333000181',active:true};
async function session(page:Page){
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',name:'Equipe',role:'operator'}}}));
 await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[client,{...client,_id:'00000000-0000-4000-8000-000000000082',active:false,name:'EMPRESA INATIVA'}]}}));
}

test('A rejected generation unlocks its company and reports; uncertain retries preserve the same payload',async({page})=>{
 await session(page);
 const requests:any[]=[];
 await page.route('**/api/v4/generations',route=>{
  requests.push(route.request().postDataJSON());
  return route.fulfill({status:requests.length===1?400:503,json:{message:requests.length===1?'Revise os relatórios escolhidos.':'Falha temporária. Tente novamente.'}});
 });
 await page.goto('/generations.html');
 await page.locator('#generation-search').fill('11.222.333/0001-81');
 await expect(page.locator('[data-select-company]')).toHaveCount(1);
 await page.locator('[data-select-company]').click();
 await expect(page.locator('#generation-reports-summary')).toContainText('2 relatórios selecionados');
 await page.locator('#generation-create').click();
 await expect(page.locator('#generation-reports-error')).toContainText('Revise os relatórios');
 await expect(page.locator('[data-guided-report]').first()).toBeEnabled();
 await page.locator('#generation-reports-back').click();
 await expect(page.locator('#generation-reports-dialog')).toBeHidden();
 await expect(page.locator('[data-select-company]')).toBeFocused();
 await page.locator('[data-select-company]').click();
 await page.locator('[data-guided-report][value="PURCHASES"]').uncheck();
 await expect(page.locator('#generation-reports-summary')).toContainText('1 relatório selecionado');
 await page.locator('#generation-create').click();
 await expect(page.locator('#generation-reports-error')).toContainText('Falha temporária');
 await expect(page.locator('[data-guided-report]').first()).toBeDisabled();
 await page.locator('#generation-create').click();
 await expect.poll(()=>requests.length).toBe(3);
 expect(requests[1].generationId).not.toBe(requests[0].generationId);
 expect(requests[1].requiredReports).toEqual(['SALES']);
 expect(requests[2]).toEqual(requests[1]);
 await expect(page.locator('#generation-reports-dialog')).toHaveAttribute('aria-busy','false');
});

test('Multiple-company validation failures remain editable',async({page})=>{
 await session(page);
 await page.route('**/api/v4/generations',route=>route.fulfill({status:400,json:{message:'Empresa indisponível. Revise a seleção.'}}));
 await page.goto('/generations.html?multiple=1');
 await page.locator('.generation-company-option input').check();
 await page.locator('#generation-create').click();
 await expect(page.locator('#generation-error')).toContainText('Revise a seleção');
 await expect(page.locator('#generation-search')).toBeEnabled();
 await expect(page.locator('[data-report-choice]').first()).toBeEnabled();
 await page.locator('#generation-clear').click();
 await expect(page.locator('#generation-create')).toBeDisabled();
});

test('Compact generation fields remain usable at desktop and narrow mobile widths',async({page},info)=>{
 await session(page);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/generations.html');
 await page.locator('#generation-search').fill('sintetica');
 await expect(page.locator('[data-select-company]')).toHaveCount(1);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const searchPath=info.outputPath(`generation-search-${width}.png`);
  await page.screenshot({path:searchPath,fullPage:true});await info.attach(`Busca ${width}`,{path:searchPath,contentType:'image/png'});
  await page.locator('[data-select-company]').click();
  await page.locator('[data-guided-report][value="PURCHASES"]').uncheck();
  await page.locator('[data-guided-report][value="SALES"]').uncheck();
  await expect(page.locator('#generation-reports-summary')).toContainText('pelo menos um');
  await expect(page.locator('#generation-create')).toBeDisabled();
  expect(await page.locator('#generation-reports-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  const dialogPath=info.outputPath(`generation-reports-${width}.png`);
  await page.screenshot({path:dialogPath});await info.attach(`Relatórios ${width}`,{path:dialogPath,contentType:'image/png'});
  await page.locator('[data-guided-report][value="PURCHASES"]').check();
  await page.locator('[data-guided-report][value="SALES"]').check();
  await page.keyboard.press('Escape');
 }
 expect(errors).toEqual([]);
});
