import {test,expect} from '@playwright/test';
import * as XLSX from 'xlsx';
import {readFile} from 'node:fs/promises';

const company=(code:string,name:string,fiscal:string,accounting:string,active=true)=>{
  const field=(status:string)=>({status,updatedBy:status==='EMPTY'?null:'Equipe',updatedAt:status==='EMPTY'?null:'2026-11-26T13:00:00Z'});
  return {clientId:code,code,name,cnpj:'00000000000191',active,year:2027,fiscal:field(fiscal),accounting:field(accounting)};
};
test('relatório filtra os dois setores e exporta o mesmo recorte completo para Excel e impressão',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{name:'Consulta',role:'viewer'}}}));
  const items=[company('001','Ágata','COMPLETE','COMPLETE'),company('002','Empresa B','COMPLETE','DRAFT'),
    company('003','Empresa C','EMPTY','COMPLETE'),company('004','=Empresa D','REVIEW','EMPTY',false)];
  await page.route('**/api/v4/analyses/sector-progress*',r=>r.fulfill({json:r.request().url().includes('after=')?
    {items:items.slice(2),next:null}:{items:items.slice(0,2),next:'cursor'}}));
  await page.goto('/analyses.html?view=preenchimento');
  const rows=page.locator('tbody tr'),fiscal=page.getByRole('combobox',{name:'Fiscal',exact:true}),accounting=page.getByRole('combobox',{name:'Contábil',exact:true});
  await expect(rows).toHaveCount(4);
  await fiscal.selectOption('COMPLETE');await expect(rows).toHaveCount(2);
  await accounting.selectOption('PENDING');await expect(rows).toHaveCount(1);await expect(rows).toHaveText(/Empresa B/);
  await accounting.selectOption('COMPLETE');await expect(rows).toHaveText(/Ágata/);
  await fiscal.selectOption('ALL');await accounting.selectOption('ALL');
  const search=page.getByRole('searchbox');await search.fill('agata');await expect(rows).toHaveCount(1);await search.fill('');
  await page.getByRole('combobox',{name:'Cadastro',exact:true}).selectOption('inactive');await expect(rows).toHaveCount(1);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar Excel'}).click();
  const saved=await download;
  const workbook=XLSX.read(await readFile((await saved.path())!),{type:'buffer'}),sheet=workbook.Sheets[workbook.SheetNames[0]];
  expect(sheet.A2.v).toBe('004');expect(sheet.B2.v).toBe('=Empresa D');expect(sheet.B2.f).toBeUndefined();
  expect(sheet.F2.v).toBe('A conferir');expect(sheet.I2.v).toBe('Não iniciado');expect(sheet.A3).toBeUndefined();
  await page.emulateMedia({media:'print'});
  await expect(rows).toContainText('=Empresa D');await expect(page.locator('.analysis-filter-bar')).toBeHidden();
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await search.fill('nenhum');await expect(page.getByRole('button',{name:'Baixar Excel'})).toBeDisabled();
  expect(errors).toEqual([]);
});

test('falha em lote posterior impede a exportação parcial e permite tentar novamente',async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{role:'viewer'}}}));
  let retry=false;
  await page.route('**/api/v4/analyses/sector-progress*',route=>{
    if(route.request().url().includes('after=')){
      return retry?route.fulfill({json:{items:[],next:null}}):route.fulfill({status:503,json:{message:'Falha de leitura'}});
    }
    return route.fulfill({json:{items:[company('001','Empresa A','COMPLETE','EMPTY')],next:'cursor'}});
  });
  await page.goto('/analyses.html?view=preenchimento');
  await expect(page.getByRole('alert').filter({hasText:'Falha de leitura'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Baixar Excel'})).toHaveCount(0);
  retry=true;await page.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(page.getByRole('button',{name:'Baixar Excel'})).toBeEnabled();
});
