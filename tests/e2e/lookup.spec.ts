import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
test('Novo painel: sessão, importação de códigos e leitura do modelo cliente/fornecedor',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v4/lookups/*/process',r=>r.fulfill({status:200,contentType:'application/json',body:'{"status":"PROCESSING"}'}));
 await page.goto('/');await page.getByLabel('E-mail',{exact:true}).fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Senha',{exact:true}).fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 const code=String(Date.now()),name='Cliente teste '+randomUUID().slice(0,6);
 await page.locator('.nav [data-nav=clients]').click();await page.locator('#import-catalog').click();
 await page.locator('#catalog-file').setInputFiles({name:'empresas.csv',mimeType:'text/csv',buffer:Buffer.from(`Razão social;ID;CNPJ;Ativa?\n${name};${code};;Ativa\n`)});
 await expect(page.locator('#col-code')).toBeVisible();await page.locator('#review-file').click();await page.locator('#save-catalog').click();await expect(page.locator('#client-table')).toContainText(name);
 await expect(page.locator('#dialog')).not.toBeVisible();await expect(page.locator('#dialog #col-cnpj')).toHaveCount(0);
 for(const format of ['csv','xlsx']){
  await page.goto('/#import');await page.locator('#owner').selectOption({label:code+' · '+name});
  const rows=[['TIPO','CNPJ / CPF / CNO','Razão Social','Estado','RESPOSTA'],['CLIENTE','00.000.000/0001-91','Sintética A','MG','Não optante'],['FORNECEDOR','00000000000191','Sintética A','MG','Optante'],['CLIENTE','12345678900','Pessoa sintética','MG','']];
  let buffer:Buffer;if(format==='csv')buffer=Buffer.from(rows.map(r=>r.join(';')).join('\n'));else{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),'Relatório');buffer=XLSX.write(b,{bookType:'xlsx',type:'buffer'});}
  await page.locator('#import-file').setInputFiles({name:code+'-relatorio.'+format,mimeType:format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await expect(page.locator('#col-cnpj')).toHaveCount(1);await expect(page.locator('#col-cnpj')).toHaveValue('1');await expect(page.locator('#col-name')).toHaveValue('2');await page.locator('#review-file').click();await page.locator('#save-lookup').click();
  await expect(page.getByRole('heading',{name:'Andamento da consulta'})).toBeVisible();await page.locator('#pause-now').click();await expect(page.locator('.import-totals b')).toHaveText(['3','1','1','1']);
 }
 await page.setViewportSize({width:390,height:844});await page.goto('/#overview');await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('Dashboard and lookup history expose two groups while preserving source failures',async({page})=>{
 const jobId='00000000-0000-4000-8000-000000000099';let selected='';
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',name:'Equipe Teste',role:'viewer'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[]}}));
 await page.route(/\/api\/v4\/dashboard(?:\?|$)/,r=>r.fulfill({json:{metrics:{total:3,optants:1,nonOptants:1,unknown:1,optantsPercent:33.33,nonOptantsPercent:33.33,unknownPercent:33.33,reportingNonOptants:2,reportingNonOptantsPercent:66.67,coverage:66.67},clientCount:1,entities:3,recent:[]}}));
 await page.route(/\/api\/v4\/lookups\//,r=>{
  const url=new URL(r.request().url());
  if(url.pathname.endsWith('/results')){selected=url.searchParams.get('status')||'';return r.fulfill({json:{items:[{cnpj:'11222333000181',submittedName:'EMPRESA FICTÍCIA',status:'NAO_CONFIRMADO',reportingStatus:'NAO_OPTANTE',reason:'Fonte sem resposta',occurrences:1}],total:1,page:1}});}
  return r.fulfill({json:{_id:jobId,clientCode:'1234',clientName:'EMPRESA DEMONSTRAÇÃO',fileName:'fixture.csv',status:'COMPLETED',createdAt:'2026-09-29T12:00:00Z',summary:{lines:3,unique:3,duplicates:0,invalid:0},resultSummary:{total:3,optants:1,nonOptants:1,unknown:1,optantsPercent:33.33,nonOptantsPercent:33.33,unknownPercent:33.33,reportingNonOptants:2,reportingNonOptantsPercent:66.67}}});
 });
 await page.goto('/');await expect(page.locator('.metric-label')).toHaveText(['CNPJs únicos','Simples','Não optante','Empresas ativas']);await expect(page.locator('.metric').nth(2)).toContainText('66,67%');
 await page.goto('/#job/'+jobId);await expect(page.locator('#result-status option')).toHaveText(['Todos os enquadramentos','Simples','Não optante']);await page.locator('#result-status').selectOption('NAO_OPTANTE');await page.locator('#result-filter').click();
 await expect.poll(()=>selected).toBe('NAO_OPTANTE');await expect(page.locator('#result-table')).toContainText('Não optante');await expect(page.locator('#result-table')).toContainText('Origem: não confirmado');await expect(page.locator('#result-table')).toContainText('Fonte sem resposta');
});
