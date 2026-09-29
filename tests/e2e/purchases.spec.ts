import {test, expect} from '@playwright/test';
import * as XLSX from 'xlsx';

const clientId = '00000000-0000-4000-8000-000000000020';
const client = {_id:clientId, code:'000', name:'EMPRESA DEMONSTRAÇÃO', active:true};
const lines = [
  {document:'11.222.333/0001-81', name:'FORNECEDOR FICTÍCIO', quantity:'2', totalCents:10010},
  {document:'11222333000181', name:'FORNECEDOR FICTÍCIO', quantity:'7', totalCents:2020},
  {document:'123.456.789-00', name:'PESSOA FICTÍCIA', quantity:'1', totalCents:5000}
];
const csv = () => {
  const header = Array(17).fill(''); header[0] = 'CNPJ / CPF / CNO'; header[8] = 'Razão Social'; header[15] = 'Quantidade'; header[16] = 'Valor Total';
  return [header, ...lines.map(l => {const row = Array(17).fill(''); row[0] = l.document; row[8] = l.name; row[15] = l.quantity; row[16] = (l.totalCents / 100).toFixed(2).replace('.', ','); return row;})].map(row => row.join(';')).join('\r\n');
};

test('Compras imports cp1252 columns, keeps financial values and provides snapshot downloads', async ({page}, testInfo) => {
  let job:any = null, posted:any[] = [], pdfBody:any, csvBody:any;
  const pageErrors:string[] = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator',mustChangePassword:false}}}));
  await page.route('**/api/v4/clients', route => route.fulfill({json:{items:[client]}}));
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/, async route => {
    const url = new URL(route.request().url()), method = route.request().method(), p = method === 'POST' ? route.request().postDataJSON() : {};
    if (url.pathname === '/api/v4/purchases') {
      if (method === 'GET') return route.fulfill({json:{items:job ? [job] : [],total:job ? 1 : 0,page:1}});
      expect(p.clientId).toBe(clientId); expect(p.type).toBe('PURCHASES'); expect(p.expectedRows).toBe(3);
      job = {_id:p.importId,clientId,clientCode:'000',clientName:client.name,fileName:p.fileName,expectedRows:3,uploaded:0,status:'UPLOADING',createdAt:'2026-09-29T12:00:00Z',summary:{lines:3,unique:1,invalid:1,duplicates:1}};
      return route.fulfill({json:job});
    }
    if (url.pathname.endsWith('/rows')) { posted = p.rows; job.uploaded = 3; return route.fulfill({json:{uploaded:3}}); }
    if (url.pathname.endsWith('/finalize')) {job.status = 'COMPLETED'; job.completedAt = '2026-09-29T12:01:00Z';return route.fulfill({json:job});}
    if (url.pathname.endsWith('/summary')) return route.fulfill({json:{job,totals:{lines:3,uniqueCnpjs:1,cnpjLines:2,nonCnpjLines:1,totalCents:17030,cnpjCents:12030,nonCnpjCents:5000},groups:[{status:'OPTANTE',count:1,lines:2,totalCents:12030,countPercent:100,valuePercent:100},{status:'NAO_OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0},{status:'NAO_CONFIRMADO',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0}],excluded:[{documentKind:'CPF',lines:1,totalCents:5000}]}});
    if (url.pathname.endsWith('/results') || url.pathname.endsWith('/lines')) {
      const excluded = url.searchParams.get('status') === 'NON_CNPJ';
      return route.fulfill({json:{items:excluded ? [{...lines[2],submittedName:lines[2].name,documentKind:'CPF',status:'NON_CNPJ'}] : [{cnpj:'11222333000181',documentKind:'CNPJ',submittedName:lines[0].name,status:'OPTANTE',occurrences:2,totalCents:12030,checkedAt:'2026-09-29T12:01:00Z'}],total:1,page:1,pageSize:100}});
    }
    if (url.pathname.endsWith('/csv')) {expect(method).toBe('POST');csvBody=p;return route.fulfill({json:{content:'\uFEFFDocumento;Valor\n12345678900;50,00',fileName:'compras-ficticias.csv',mimeType:'text/csv;charset=utf-8',part:1,parts:1,total:1}});}
    return route.fulfill({json:job});
  });
  await page.route('**/api/reports', route => {pdfBody=route.request().postDataJSON();return route.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="compras-resumo.pdf"'},body:'%PDF-1.4\n%%EOF'});});
  await page.goto('/purchases.html');
  await expect(page.getByRole('button',{name:/Vendas/})).toBeDisabled();
  await expect(page.locator('#purchase-file')).toBeDisabled();
  await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'000-COMPRAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv(),'latin1')});
  await page.getByRole('button',{name:'Conferir colunas A, I, P e Q'}).click();
  await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'})).toBeVisible();
  await page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'}).click();
  await expect(page.getByRole('heading',{name:'Total de compras do relatório'})).toBeVisible();
  expect(posted).toEqual(lines);
  await expect(page.locator('.purchase-hero')).toContainText('170,30');
  await expect(page.locator('.purchase-group').first()).toContainText('120,30');
  await expect(page.locator('.purchase-group').first()).toContainText('100%');
  await page.getByRole('button',{name:'Ver documentos não consultáveis'}).click();
  await expect(page.locator('#purchase-result-list')).toContainText('PESSOA FICTÍCIA');
  const csvDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Baixar CSV das linhas'}).click();
  expect((await csvDownload).suggestedFilename()).toBe('compras-ficticias.csv'); expect(csvBody).toEqual({status:'NON_CNPJ',part:1});
  const pdfDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Baixar resumo PDF'}).click();
  expect((await pdfDownload).suggestedFilename()).toBe('compras-resumo.pdf'); expect(pdfBody).toMatchObject({action:'pdf',clientId,layout:'summary',status:'ALL',kind:'ALL'});
  const desktop = testInfo.outputPath('compras-desktop.png');
  await page.screenshot({path:desktop,fullPage:true}); await testInfo.attach('Compras desktop',{path:desktop,contentType:'image/png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const mobile = testInfo.outputPath('compras-mobile.png');
  await page.screenshot({path:mobile,fullPage:true}); await testInfo.attach('Compras mobile',{path:mobile,contentType:'image/png'});
  expect(pageErrors).toEqual([]);
});

test('Compras requires password reset before exposing company data', async ({page}) => {
  let clientsRead = false;
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator',mustChangePassword:true}}}));
  await page.route('**/api/v4/clients', route => {clientsRead=true;return route.fulfill({json:{items:[client]}});});
  await page.goto('/purchases.html');
  await expect(page.getByRole('heading',{name:'Redefina sua senha para continuar'})).toBeVisible();
  await expect(page.locator('#purchase-company')).toHaveCount(0); expect(clientsRead).toBe(false);
});

test('Compras preview blocks a missing reason/social name before any upload', async ({page}) => {
  let writes = 0;
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator'}}}));
  await page.route('**/api/v4/clients', route => route.fulfill({json:{items:[client]}}));
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/, route => {if(route.request().method()==='POST')writes++;return route.fulfill({json:{items:[],total:0}});});
  await page.goto('/purchases.html'); await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(csv().replaceAll('FORNECEDOR FICTÍCIO',''))});
  await page.getByRole('button',{name:'Conferir colunas A, I, P e Q'}).click();
  await expect(page.getByRole('heading',{name:'Revise o arquivo antes de importar'})).toBeVisible();
  await expect(page.locator('#purchase-confirm')).toHaveCount(0); expect(writes).toBe(0);
});

test('Excel starting at row 5 keeps fixed source coordinates and CNPJ leading zeros', async ({page}) => {
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator'}}}));
  await page.route('**/api/v4/clients', route => route.fulfill({json:{items:[client]}}));
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/, route => route.fulfill({json:{items:[],total:0}}));
  const sheet:XLSX.WorkSheet = {'!ref':'A5:Q8',A5:{t:'s',v:'Documento'},I5:{t:'s',v:'Razão Social'},P5:{t:'s',v:'Quantidade'},Q5:{t:'s',v:'Valor Total'}};
  for(let r=6;r<=8;r++) {
    sheet['A'+r]={t:'n',v:r===6?4252011000110:11222333000181,z:'00000000000000'};
    sheet['I'+r]={t:'s',v:'FORNECEDOR LINHA '+r};sheet['P'+r]={t:'n',v:1};sheet['Q'+r]={t:'n',v:r*10};
  }
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Compras');
  await page.goto('/purchases.html');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{bookType:'xlsx',type:'buffer'})});
  await page.getByLabel('Linha do cabeçalho').selectOption('4');
  await page.getByRole('button',{name:'Conferir colunas A, I, P e Q'}).click();
  await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 2 CNPJs'})).toBeVisible();
  const reviewRows=page.locator('#purchase-review tbody tr');
  await expect(reviewRows).toHaveCount(3);
  await expect(reviewRows.nth(0)).toContainText('04252011000110');await expect(reviewRows.nth(0)).toContainText('FORNECEDOR LINHA 6');await expect(reviewRows.nth(0)).toContainText('60,00');
  await expect(reviewRows.nth(1)).toContainText('11222333000181');await expect(reviewRows.nth(1)).toContainText('FORNECEDOR LINHA 7');
  await expect(reviewRows.nth(2)).toContainText('FORNECEDOR LINHA 8');await expect(reviewRows.nth(2)).toContainText('80,00');
});
