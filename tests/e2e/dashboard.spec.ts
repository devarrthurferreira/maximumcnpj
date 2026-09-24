import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
test('Demonstração: navegação, filtros e layout em desktop e celular',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?demo=1');await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 await expect(page.locator('.metric strong').first()).toHaveText('36');
 await page.locator('#global-client').selectOption('demo-comercio');await expect(page.locator('.metric strong').first()).toHaveText('12');
 for(const [route,title] of [['clients','Empresas e carteiras'],['history','Cada consulta conta uma história.'],['calculator','O próximo capítulo da sua central.'],['settings','Configurações da central']]){
  await page.locator(`[data-nav="${route}"]`).first().click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 }
 await page.setViewportSize({width:390,height:844});await page.goto('/?demo=1');await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
});
test('Worker CSV e XLSX: duas identidades válidas, uma repetição, uma inválida',async({page})=>{
 for(const format of ['csv','xlsx']){
  await page.goto('/?demo=1#import');await page.locator('#import-client').selectOption('demo-comercio');
  const rows=[['CNPJ','NOME'],['00000000000191','Sintética'],['00.000.000/0001-91','Duplicada'],['invalido','Revisar'],['12ABC34501DE35','Alfanumérica']];
  let buffer:Buffer;
  if(format==='csv')buffer=Buffer.from(rows.map(r=>r.join(';')).join('\n'));
  else {const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Base');buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
  await page.locator('#import-file').setInputFiles({name:'base.'+format,mimeType:format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await page.getByRole('button',{name:'Revisar importação'}).click();await expect(page.getByRole('heading',{name:'Confira a base antes de consultar.'})).toBeVisible();
  await expect(page.locator('.import-totals b')).toHaveText(['4','2','1','1']);
 }
});
test('Exportações CSV e XLSX e nenhuma gravação em modo demonstração',async({page})=>{
 let mutations=0;page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations++;});
 await page.goto('/?demo=1#batch/demo-lote-0-0');await expect(page.locator('#results-table tbody tr')).toHaveCount(12);
 for(const format of ['csv','xlsx']){const download=page.waitForEvent('download');await page.locator('#export-'+format).click();expect((await download).suggestedFilename()).toContain('DEMONSTRACAO');}
 expect(mutations).toBe(0);
});
test('Login real e importação autenticada com fonte ainda bloqueada',async({page})=>{
 test.skip(!process.env.MONGODB_URI,'MongoDB necessário');
 await page.goto('/');await page.getByLabel('E-mail profissional').fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Senha',{exact:true}).fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Entrar na central'}).click();
 await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 await page.locator('[data-nav="clients"]').first().click();await page.getByRole('button',{name:'Nova carteira',exact:true}).click();
 await page.getByLabel('Nome da empresa ou carteira').fill('Carteira E2E');await page.getByRole('button',{name:'Salvar carteira',exact:true}).click();await expect(page.getByRole('heading',{name:'Carteira E2E',exact:true})).toBeVisible();
 await page.locator('[data-nav="import"]').first().click();await page.locator('#import-client').selectOption({label:'Carteira E2E'});
 await page.locator('#import-file').setInputFiles({name:'base.csv',mimeType:'text/csv',buffer:Buffer.from('CNPJ;NOME\n00000000000191;Sintética\n12ABC34501DE35;Alfanumérica')});
 await page.getByRole('button',{name:'Revisar importação'}).click();await page.getByRole('button',{name:'Salvar lote e continuar'}).click();
 await expect(page.getByRole('heading',{name:'Situação do lote'})).toBeVisible();await expect(page.locator('.import-totals b')).toHaveText(['2','2','0','0']);
 await page.getByRole('button',{name:'Estimar consulta'}).click();await expect(page.locator('#toast')).toContainText(/Configure|homologada|Defina|Verifique/);
});
