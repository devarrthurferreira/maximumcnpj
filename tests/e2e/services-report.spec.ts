import {test,expect} from '@playwright/test';

const generation='90000000-0000-4000-8000-000000000001',clientId='90000000-0000-4000-8000-000000000002',jobId='90000000-0000-4000-8000-000000000003';
const client={_id:clientId,code:'900',name:'EMPRESA SINTÉTICA SERVIÇOS',active:true};
const difal={version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:10000,amountCents:1000,pendingLines:0};
const job={_id:jobId,generationId:generation,clientId,clientCode:client.code,clientName:client.name,fileName:'900-VENDAS.csv',status:'COMPLETED',calculationVersion:'NET_V2',difalVersion:'DIFAL_ESTIMATE_V1',issuerUf:'MG',expectedRows:2,uploaded:2,received:0,createdAt:'2026-10-19T12:00:00Z',completedAt:'2026-10-19T12:00:01Z',summary:{unique:0,lines:2}};
const summary={job,calculationVersion:'NET_V2',difal,components:{grossCents:30000,discountCents:0,freightCents:0,accessoryCents:500,abatementCents:0,totalCents:30000},totals:{lines:2,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:2,totalCents:30000},groups:[],reportingGroups:[{status:'CPF',count:1,lines:2,totalCents:30000,valuePercent:100,countPercent:100}],excluded:[{documentKind:'CPF',lines:2,totalCents:30000}],operationTotals:[{operation:'VENDA',lines:1,totalCents:10000,balanceCents:10000},{operation:'SERVICO',lines:1,totalCents:20000,balanceCents:20000}]};

test('Resumo guiado mostra serviços9000, composição e DIFAL; relatório completo expõe natureza e descrição',async({page},info)=>{
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'services-report',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[client]}}));
 await page.route('**/api/v4/generations/'+generation,r=>r.fulfill({json:{_id:generation,status:'COMPLETED',requiredReports:['SALES'],companies:[{clientId,code:client.code,name:client.name,salesJobId:jobId,sales:job}]}}));
 await page.route(/\/api\/v4\/sales(?:[/?]|$)/,r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/summary'))return r.fulfill({json:summary});
  if(path.endsWith('/lines')||path.endsWith('/results'))return r.fulfill({json:{items:[{document:'52998224725',documentKind:'CPF',submittedName:'CLIENTE SINTÉTICO',reportingStatus:'CPF',status:'NON_CNPJ',operation:'SERVICO',natureCode:'9000',description:'PRESTAÇÃO DE SERVIÇO',quantity:'1',totalCents:20000,balanceCents:20000,reportingCents:20000,recipientUf:'SP',difal:{eligible:false,reason:'NOT_SALE',amountCents:0}}],total:1,page:1,pageSize:100}});
  return r.fulfill({json:job});
 });
 await page.goto(`/purchases.html?type=SALES&generation=${generation}&client=${clientId}&job=${jobId}&guided=1`);
 await expect(page.getByRole('heading',{name:'Resumo de vendas',exact:true})).toBeVisible();
 const services=page.locator('.purchase-operation-card').filter({hasText:'Vendas de serviços'});
 await expect(services).toBeVisible();await expect(services).toContainText('200,00');await expect(page.getByRole('heading',{name:'Como chegamos ao novo total'})).toBeVisible();
 await expect(page.locator('[data-difal-amount]')).toContainText('10,00');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const shot=info.outputPath('servicos-resumo-guiado.png');await page.screenshot({path:shot,fullPage:true});await info.attach('Resumo com vendas de serviços',{path:shot,contentType:'image/png'});
 await page.getByRole('link',{name:'Ver relatório completo e baixar arquivos'}).click();await page.locator('#purchase-view-filter').selectOption('lines');
 await expect(page.locator('#purchase-result-list')).toContainText('Natureza / CFOP');await expect(page.locator('#purchase-result-list')).toContainText('9000');await expect(page.locator('#purchase-result-list')).toContainText('PRESTAÇÃO DE SERVIÇO');await expect(page.locator('.purchase-source-details')).toHaveAttribute('open','');
});
