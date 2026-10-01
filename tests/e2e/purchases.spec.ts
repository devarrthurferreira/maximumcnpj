import {test, expect} from '@playwright/test';
import * as XLSX from 'xlsx';

const clientId = '00000000-0000-4000-8000-000000000020';
const client = {_id:clientId, code:'000', name:'EMPRESA DEMONSTRAÇÃO', active:true};
const lines = [
  {document:'11.222.333/0001-81', name:'FORNECEDOR FICTÍCIO', serviceDate:'2026-08-15', quantity:'2', grossCents:10010,discountCents:1000,accessoryCents:250,freightCents:500,abatementCents:10,totalCents:9500},
  {document:'11222333000181', name:'FORNECEDOR FICTÍCIO', serviceDate:'2026-08-16', quantity:'7',grossCents:2020,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:2020},
  {document:'123.456.789-00', name:'PESSOA FICTÍCIA', serviceDate:'2026-08-17', quantity:'1',grossCents:5000,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:5000}
];
const csv = () => {
  const header = Array(28).fill(''); header[0] = 'CNPJ / CPF / CNO'; header[7] = 'Data Escrituração/Serviço'; header[8] = 'Razão Social'; header[15] = 'Quantidade'; header[16] = 'Valor Total'; header[24]='Valor Desconto';header[25]='Valor Despesa Acessória';header[26]='Valor Frete';header[27]='Abatimento não Tributado';
  return [header, ...lines.map(l => {const row = Array(28).fill(''); row[0] = l.document; row[7] = l.serviceDate.split('-').reverse().join('/'); row[8] = l.name; row[15] = l.quantity; row[16] = (l.grossCents / 100).toFixed(2).replace('.', ',');[l.discountCents,l.accessoryCents,l.freightCents,l.abatementCents].forEach((v,i)=>row[24+i]=(v/100).toFixed(2).replace('.',',')); return row;})].map(row => row.join(';')).join('\r\n');
};

for (const type of ['PURCHASES','SALES']) test(`${type} imports cp1252 columns, keeps financial values and provides snapshot downloads`, async ({page}, testInfo) => {
  const sales=type==='SALES', report=sales?'vendas':'compras', endpoint=sales?'sales':'purchases';
  let job:any = null, posted:any[] = [], pdfBody:any, csvBody:any;
  const pageErrors:string[] = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator',mustChangePassword:false}}}));
  await page.route('**/api/v4/clients', route => route.fulfill({json:{items:[client]}}));
  await page.route(new RegExp(`/api/v4/${endpoint}(?:[/?]|$)`), async route => {
    const url = new URL(route.request().url()), method = route.request().method(), p = method === 'POST' ? route.request().postDataJSON() : {};
    if (url.pathname === `/api/v4/${endpoint}`) {
      if (method === 'GET') return route.fulfill({json:{items:job ? [job] : [],total:job ? 1 : 0,page:1}});
      expect(p.clientId).toBe(clientId); expect(p.type).toBe(type); expect(p.expectedRows).toBe(3);
      job = {_id:p.importId,calculationVersion:'NET_V2',clientId,clientCode:'000',clientName:client.name,fileName:p.fileName,expectedRows:3,uploaded:0,status:'UPLOADING',createdAt:'2026-09-29T12:00:00Z',summary:{lines:3,unique:1,invalid:1,duplicates:1}};
      return route.fulfill({json:job});
    }
    if (url.pathname.endsWith('/rows')) { posted = p.rows; job.uploaded = 3; return route.fulfill({json:{uploaded:3}}); }
    if (url.pathname.endsWith('/finalize')) {job.status = 'COMPLETED'; job.completedAt = '2026-09-29T12:01:00Z';return route.fulfill({json:job});}
    if (url.pathname.endsWith('/summary')) return route.fulfill({json:{job,calculationVersion:'NET_V2',components:{grossCents:17030,discountCents:1000,accessoryCents:250,freightCents:500,abatementCents:10,totalCents:16520},totals:{lines:3,uniqueDocuments:2,nonCnpjDocumentCount:1,uniqueCnpjs:1,cnpjLines:2,nonCnpjLines:1,totalCents:16520,cnpjCents:11520,nonCnpjCents:5000},groups:[{status:'OPTANTE',count:1,lines:2,totalCents:11520,countPercent:100,valuePercent:100},{status:'NAO_OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0},{status:'NAO_CONFIRMADO',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0}],reportingGroups:[{status:'OPTANTE',count:1,lines:2,totalCents:11520,countPercent:50,valuePercent:69.73},...(sales ? [{status:'NAO_OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0,unconfirmedCount:0,unconfirmedCents:0},{status:'CPF',count:1,lines:1,totalCents:5000,countPercent:50,valuePercent:30.27}] : [{status:'NAO_OPTANTE',count:1,lines:1,totalCents:5000,countPercent:50,valuePercent:30.27,unconfirmedCount:0,unconfirmedCents:0}])],excluded:[{documentKind:'CPF',lines:1,totalCents:5000}]}});
    if (url.pathname.endsWith('/results') || url.pathname.endsWith('/lines')) {
      const excluded = url.searchParams.get('status') === (sales ? 'CPF' : 'NAO_OPTANTE');
      return route.fulfill({json:{items:excluded ? [{...lines[2],submittedName:lines[2].name,documentKind:'CPF',status:'NON_CNPJ',reportingStatus:sales?'CPF':'NAO_OPTANTE'}] : [{cnpj:'11222333000181',documentKind:'CNPJ',submittedName:lines[0].name,status:'OPTANTE',occurrences:2,totalCents:11520,checkedAt:'2026-09-29T12:01:00Z'}],total:1,page:1,pageSize:100}});
    }
    if (url.pathname.endsWith('/csv')) {expect(method).toBe('POST');csvBody=p;return route.fulfill({json:{content:'\uFEFFDocumento;Valor\n12345678900;50,00',fileName:`${report}-ficticias.csv`,mimeType:'text/csv;charset=utf-8',part:1,parts:1,total:1}});}
    return route.fulfill({json:job});
  });
  await page.route('**/api/reports', route => {pdfBody=route.request().postDataJSON();return route.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':`attachment; filename="${report}-resumo.pdf"`},body:'%PDF-1.4\n%%EOF'});});
  await page.goto('/purchases.html'+(sales?'?type=SALES':''));
  await expect(page.getByRole('button',{name:/Vendas/})).toBeEnabled();
  await expect(page.getByRole('button',{name:sales?/Vendas/:/Compras/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#purchase-file')).toBeDisabled();
  await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:`000-${report.toUpperCase()}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv(),'latin1')});
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'})).toBeVisible();
  await page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'}).click();
  await expect(page.getByRole('heading',{name:`Total de ${report} do relatório`})).toBeVisible();
  expect(posted).toEqual(lines);
  if (sales) {await expect(page.getByRole('heading',{name:'Explore os compradores e valores'})).toBeVisible();await expect(page).toHaveURL(/type=SALES/);}
  await expect(page.locator('.purchase-hero')).toContainText('165,20');
  await expect(page.locator('.purchase-group').first()).toContainText('115,20');
  await expect(page.locator('.purchase-group')).toHaveCount(sales ? 3 : 2);
  await expect(page.locator('.purchase-group').first()).toContainText(sales ? 'Faturamento vendas Optantes SN' : 'Compras de empresas do Simples');
  await expect(page.locator('.purchase-group').first()).toContainText('69,73%');
  await expect(page.locator('.purchase-group').first()).toContainText('50%');
  await expect(page.locator(sales ? '[data-status=CPF]' : '[data-status=NAO_OPTANTE]')).toContainText('30,27%');
  await expect(page.locator('#purchase-status-filter option')).toHaveText(['Todos os enquadramentos','Simples','Não optante',...(sales ? ['CPF'] : [])]);
  await page.locator(sales ? '[data-status=CPF]' : '[data-status=NAO_OPTANTE]').click();
  await expect(page.locator('#purchase-result-list')).toContainText('PESSOA FICTÍCIA');
  await expect(page.locator('#purchase-result-list')).toContainText(sales ? 'CPF' : 'Não optante');
  const csvDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Baixar CSV das linhas'}).click();
  expect((await csvDownload).suggestedFilename()).toBe(`${report}-ficticias.csv`); expect(csvBody).toEqual({status:sales?'CPF':'NAO_OPTANTE',part:1});
  const pdfDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Baixar resumo PDF'}).click();
  expect((await pdfDownload).suggestedFilename()).toBe(`${report}-resumo.pdf`); expect(pdfBody).toMatchObject({action:'pdf',clientId,layout:'summary',status:'ALL',kind:'ALL'});
  const desktop = testInfo.outputPath(`${report}-desktop.png`);
  await page.screenshot({path:desktop,fullPage:true}); await testInfo.attach(`${report} desktop`,{path:desktop,contentType:'image/png'});
  await page.setViewportSize({width:390,height:844});
  const mobile = testInfo.outputPath(`${report}-mobile.png`);
  await page.screenshot({path:mobile,fullPage:true}); await testInfo.attach(`${report} mobile`,{path:mobile,contentType:'image/png'});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
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
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  await expect(page.getByRole('heading',{name:'Revise o arquivo antes de importar'})).toBeVisible();
  await expect(page.locator('#purchase-confirm')).toHaveCount(0); expect(writes).toBe(0);
});

test('Excel starting at row 5 keeps fixed source coordinates and CNPJ leading zeros', async ({page}) => {
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'test',role:'operator'}}}));
  await page.route('**/api/v4/clients', route => route.fulfill({json:{items:[client]}}));
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/, route => route.fulfill({json:{items:[],total:0}}));
  const sheet:XLSX.WorkSheet = {'!ref':'A5:AB8',A5:{t:'s',v:'Documento'},H5:{t:'s',v:'Data Escrituração/Serviço'},I5:{t:'s',v:'Razão Social'},P5:{t:'s',v:'Quantidade'},Q5:{t:'s',v:'Valor Total'},Y5:{t:'s',v:'Valor Desconto'},Z5:{t:'s',v:'Despesa Acessória'},AA5:{t:'s',v:'Valor Frete'},AB5:{t:'s',v:'Abatimento não Tributado'}};
  for(let r=6;r<=8;r++) {
    sheet['A'+r]={t:'n',v:r===6?4252011000110:11222333000181,z:'00000000000000'};
    sheet['H'+r]={t:'n',v:46250+r,z:'dd/mm/yyyy'};
    sheet['I'+r]={t:'s',v:'FORNECEDOR LINHA '+r};sheet['P'+r]={t:'n',v:1};sheet['Q'+r]={t:'n',v:r*10};
  }
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Compras');
  await page.goto('/purchases.html');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{bookType:'xlsx',type:'buffer'})});
  await page.getByLabel('Linha do cabeçalho').selectOption('4');
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 2 CNPJs'})).toBeVisible();
  const reviewRows=page.locator('#purchase-review tbody tr');
  await expect(reviewRows).toHaveCount(3);
  await expect(reviewRows.nth(0)).toContainText('04252011000110');await expect(reviewRows.nth(0)).toContainText('FORNECEDOR LINHA 6');await expect(reviewRows.nth(0)).toContainText('60,00');
  await expect(reviewRows.nth(1)).toContainText('11222333000181');await expect(reviewRows.nth(1)).toContainText('FORNECEDOR LINHA 7');
  await expect(reviewRows.nth(2)).toContainText('FORNECEDOR LINHA 8');await expect(reviewRows.nth(2)).toContainText('80,00');
});

for (const type of ['PURCHASES','SALES']) test(`${type} resumes the original upload within its generation and keeps source failures distinct`,async({page})=>{
 const sales=type==='SALES',report=sales?'vendas':'compras',endpoint=sales?'sales':'purchases';
 const generationId='00000000-0000-4000-8000-000000000070',jobId='00000000-0000-4000-8000-000000000071';
 let attached:any,rows:any,requestedHistory=false,attachPath='';
 const job:any={_id:jobId,generationId,clientId,clientCode:'000',clientName:client.name,fileName:'000-COMPRAS.csv',calculationVersion:'NET_V2',expectedRows:3,uploaded:2,status:'UPLOADING',createdAt:'2026-09-29T12:00:00Z',summary:{lines:3,unique:1,invalid:1,duplicates:1}};
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',role:'operator'}}}));await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[client]}}));
 await page.route(/\/api\/v4\/generations(?:[/?]|$)/,r=>{if(r.request().method()==='POST'){attached=r.request().postDataJSON();attachPath=new URL(r.request().url()).pathname;}return r.fulfill({json:{_id:generationId,companies:[{clientId}],generation:{_id:generationId},job}});});
 await page.route(new RegExp(`/api/v4/${endpoint}(?:[/?]|$)`),r=>{
  const url=new URL(r.request().url());if(url.pathname===`/api/v4/${endpoint}`){requestedHistory=true;return r.fulfill({json:{items:[],total:0}});}
  if(url.pathname.endsWith('/rows')){rows=r.request().postDataJSON();job.uploaded=3;return r.fulfill({json:{uploaded:3}});}
  if(url.pathname.endsWith('/finalize')){job.status='COMPLETED';return r.fulfill({json:job});}
  if(url.pathname.endsWith('/summary'))return r.fulfill({json:{job,calculationVersion:'NET_V2',totals:{lines:3,uniqueDocuments:2,nonCnpjDocumentCount:1,uniqueCnpjs:1,cnpjLines:2,nonCnpjLines:1,totalCents:16520,cnpjCents:11520,nonCnpjCents:5000},groups:[{status:'OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0},{status:'NAO_OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0},{status:'NAO_CONFIRMADO',count:1,lines:2,totalCents:11520,countPercent:100,valuePercent:100}],reportingGroups:[{status:'OPTANTE',count:0,lines:0,totalCents:0,countPercent:0,valuePercent:0},{status:'NAO_OPTANTE',count:sales?1:2,lines:sales?2:3,totalCents:sales?11520:16520,countPercent:sales?50:100,valuePercent:sales?69.73:100,unconfirmedCount:1,unconfirmedCents:11520},...(sales?[{status:'CPF',count:1,lines:1,totalCents:5000,countPercent:50,valuePercent:30.27}]:[])],excluded:[{documentKind:'CPF',lines:1,totalCents:5000}]}});
  if(url.pathname.endsWith('/results'))return r.fulfill({json:{items:[{cnpj:'11222333000181',submittedName:'FORNECEDOR FICTÍCIO',documentKind:'CNPJ',status:'NAO_CONFIRMADO',reportingStatus:'NAO_OPTANTE',reason:'Fonte sem resposta',totalCents:11520,occurrences:2}],page:1,total:1,pageSize:100}});
  return r.fulfill({json:job});
 });
 await page.goto(`/purchases.html?generation=${generationId}&client=${clientId}&job=${jobId}${sales?'&type=SALES':''}`);await expect(page.getByRole('heading',{name:'Importação incompleta'})).toBeVisible();await expect(page.locator('#purchase-company')).toBeDisabled();await expect(page.locator('.purchase-history')).toBeHidden();
 await page.locator('#purchase-file').setInputFiles({name:'000-COMPRAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv(),'latin1')});await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'}).click();
 await expect(page.getByRole('heading',{name:`Total de ${report} do relatório`})).toBeVisible();expect(attached).toMatchObject({importId:jobId,clientId,expectedRows:3,type});expect(attachPath).toBe(`/api/v4/generations/${generationId}/${endpoint}`);expect(rows.offset).toBe(0);expect(rows.rows).toEqual(lines);expect(requestedHistory).toBe(false);await expect(page).toHaveURL(new RegExp(`generation=${generationId}`));
 await expect(page.locator('.purchase-group')).toHaveCount(sales ? 3 : 2);await expect(page.locator('[data-status="NAO_OPTANTE"]')).toContainText('Inclui 1 não confirmado(s)');await expect(page.locator('#purchase-result-list')).toContainText('Origem: não confirmado. Fonte sem resposta');await expect(page.getByRole('link',{name:'← Voltar à geração e às outras empresas'})).toHaveAttribute('href','/generations.html?id='+generationId);
});


test('Sales accepts its model without P and blocks misaligned CSV before upload',async({page})=>{
 let writes=0;
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',role:'operator'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[client]}}));
 await page.route(/\/api\/v4\/sales(?:[/?]|$)/,r=>{if(r.request().method()==='POST')writes++;return r.fulfill({json:{items:[],total:0}});});
 const matrix=csv().split('\r\n').map(row=>row.split(';'));matrix.forEach(row=>row[15]='');matrix[0][0]='CNPJ Comprador';matrix[0][8]='Comprador';
 await page.goto('/purchases.html?type=SALES');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
 await page.locator('#purchase-file').setInputFiles({name:'000-VENDAS.csv',mimeType:'text/csv',buffer:Buffer.from(matrix.map(row=>row.join(';')).join('\r\n'),'latin1')});
 await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'})).toBeVisible();await expect(page.locator('#purchase-review')).toContainText('165,20');
 matrix[1][14]='Descrição; com separador indevido';
 await page.locator('#purchase-file').setInputFiles({name:'000-VENDAS-REVISAR.csv',mimeType:'text/csv',buffer:Buffer.from(matrix.map(row=>row.join(';')).join('\r\n'),'latin1')});
 await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await expect(page.getByRole('heading',{name:'Revise o arquivo antes de importar'})).toBeVisible();await expect(page.locator('#purchase-confirm')).toHaveCount(0);expect(writes).toBe(0);
});


test('Known CSV description separators are recovered visibly with original financial values',async({page})=>{
 const localClient={...client,code:'1234'};let writes=0;
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',role:'operator'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[localClient]}}));
 await page.route(/\/api\/v4\/sales(?:[/?]|$)/,r=>{if(r.request().method()==='POST')writes++;return r.fulfill({json:{items:[],total:0}});});
 const matrix=csv().split('\r\n').map(row=>row.split(';'));
 const suffix=['Descrição','Quantidade','Valor Total','CST ICMS','Base Cálculo ICMS','Alíquota ICMS','Valor ICMS','Valor IPI','Valor ISS','Valor Substituição Tributária','Valor Desconto','Valor Despesa Acessória','Valor Frete','Abatimento não Tributado','Codigo Empresa','Chave Lancamento'];
 ['Estado','Contribuinte ICMS','Natureza','Classificação Fiscal','Produto'].forEach((label,index)=>matrix[0][9+index]=label);
 suffix.forEach((label,index)=>matrix[0][14+index]=label);matrix[0][30]='';
 for(let index=1;index<matrix.length;index++){const row=matrix[index];['SP','Não','5102002','3922.20.00','42'].forEach((value,column)=>row[9+column]=value);row[14]=index===1?'Produto sintético; acabamento azul':'Produto simples';row[17]='060';for(const column of [18,19,20,21,22,23])row[column]='0,00';row[28]='1234';row[29]=String(100+index);}
 const buffer=Buffer.from(matrix.map(row=>row.join(';')).join('\r\n'),'latin1');
 await page.goto('/purchases.html?type=SALES');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
 await page.locator('#purchase-file').setInputFiles({name:'1234-VENDAS.csv',mimeType:'text/csv',buffer});await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
 await expect(page.locator('.purchase-repairs')).toContainText('1 linha(s) alinhada(s) automaticamente');await expect(page.locator('.purchase-repairs')).toContainText('Linhas: 2.');await expect(page.locator('.purchase-repairs')).toContainText('valores originais foram preservados');
 await expect(page.getByRole('button',{name:'Confirmar empresa e consultar 1 CNPJs'})).toBeVisible();await expect(page.locator('#purchase-review .import-totals')).toContainText('165,20');
 await expect(page.locator('#purchase-review tbody tr').first()).toContainText('100,10');await expect(page.locator('#purchase-review tbody tr').first()).toContainText('95,00');expect(writes).toBe(0);
});

test('Completed purchases continue to sales then unlock the company simulator',async({page})=>{
 const generationId='00000000-0000-4000-8000-000000000070',purchaseId='00000000-0000-4000-8000-000000000071',salesId='00000000-0000-4000-8000-000000000072';
 let salesDone=false;
 const job=(sales:boolean)=>({_id:sales?salesId:purchaseId,generationId,clientId,clientCode:client.code,clientName:client.name,calculationVersion:'NET_V2',fileName:sales?'000-VENDAS.csv':'000-COMPRAS.csv',status:'COMPLETED',expectedRows:1,uploaded:1,createdAt:'2026-09-30T12:00:00Z'});
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',role:'operator'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[client]}}));
 await page.route('**/api/v4/generations/'+generationId,r=>r.fulfill({json:{_id:generationId,requiredReports:['PURCHASES','SALES'],companies:[{clientId,name:client.name,code:client.code,purchaseJobId:purchaseId,purchase:job(false),salesJobId:salesDone?salesId:null,sales:salesDone?job(true):null}]}}));
 await page.route(/\/api\/v4\/(purchases|sales)\//,r=>{
  const url=new URL(r.request().url()),sales=url.pathname.includes('/sales/');
  if(url.pathname.endsWith('/summary'))return r.fulfill({json:{job:job(sales),calculationVersion:'NET_V2',components:{grossCents:10000,totalCents:10000},totals:{lines:1,uniqueDocuments:1,uniqueCnpjs:1,totalCents:10000},reportingGroups:[{status:'OPTANTE',count:1,lines:1,totalCents:10000,countPercent:100,valuePercent:100}]}});
  if(url.pathname.endsWith('/results'))return r.fulfill({json:{items:[],total:0,pageSize:100}});
  return r.fulfill({json:job(sales)});
 });
 await page.goto(`/purchases.html?generation=${generationId}&client=${clientId}&job=${purchaseId}`);
 await expect(page.locator('#purchase-flow')).toContainText('Empresa selecionada');
 await expect(page.locator('#purchase-next-step').getByRole('link',{name:'Continuar: importar vendas'})).toHaveAttribute('href',`/purchases.html?generation=${generationId}&client=${clientId}&type=SALES`);
 await expect(page.getByRole('link',{name:'Ir para o simulador'})).toHaveCount(0);
 await page.getByRole('link',{name:'Continuar: importar vendas'}).click();
 await expect(page).toHaveURL(new RegExp(`generation=${generationId}&client=${clientId}&type=SALES`));
 await expect(page.locator('#purchase-file')).toBeEnabled();await expect(page.locator('#purchase-company')).toBeDisabled();
 salesDone=true;
 await page.goto(`/purchases.html?generation=${generationId}&client=${clientId}&type=SALES&job=${salesId}`);
 await expect(page.locator('#purchase-next-step').getByRole('link',{name:'Ir para o simulador'})).toHaveAttribute('href',`/simulator.html?generation=${generationId}&client=${clientId}`);
 await expect(page.locator('#purchase-next-step')).toContainText('OS DOIS RELATÓRIOS ESTÃO PRONTOS');
});
