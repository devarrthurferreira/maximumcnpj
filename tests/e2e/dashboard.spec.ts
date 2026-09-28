import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
test('Legado: login, CSV/XLSX, processamento local e exportação', async ({page}) => {
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/legacy.html');await page.getByLabel('E-mail',{exact:true}).fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Senha',{exact:true}).fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
  await page.locator('.nav [data-nav=clients]').click();await page.getByRole('button',{name:'Nova carteira',exact:true}).click();
  const client='Carteira E2E '+randomUUID().slice(0,8);await page.locator('#client-form [name=name]').fill(client);await page.getByRole('button',{name:'Salvar carteira'}).click();await expect(page.getByRole('heading',{name:client})).toBeVisible();
  const matrix=[['CNPJ','Nome','Simples'],['00.000.000/0001-91','Sintética A','Sim'],['00000000000191','Repetida','Sim'],['12.ABC.345/01DE-35','Sintética B','Não'],['invalido','Revisar','']];
  for(const format of ['csv','xlsx']) {
    await page.locator('.nav [data-nav=import]').click();await page.locator('#import-client').selectOption({label:client});
    let buffer:Buffer;
    if(format==='csv')buffer=Buffer.from(matrix.map(r=>r.join(';')).join('\n'));else {const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(matrix),'Base');buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
    await page.locator('#import-file').setInputFiles({name:'base.'+format,mimeType:format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
    await expect(page.locator('#status-col')).toBeVisible();await page.locator('#status-col').selectOption('2');await page.locator('#validate').click();
    await expect(page.locator('#review .import-totals b')).toHaveText(['4','2','1','1']);await page.locator('#save-import').click();
    await expect(page.locator('#content .badge').first()).toHaveText('Concluído',{timeout:45000});await expect(page.locator('#results')).toContainText('Sintética');
    const download=page.waitForEvent('download');await page.locator('#export-csv').click();expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/legacy.html#overview');await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
