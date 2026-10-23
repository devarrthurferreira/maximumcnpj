import {test, expect, type Page} from '@playwright/test';
import {summarizePurchaseSelection, selectPurchaseLine, PURCHASE_SELECTION_VERSION} from '../../src/purchase-selection.ts';

const clientId='82000000-0000-4000-8000-000000000001',generationId='82000000-0000-4000-8000-000000000002',jobId='82000000-0000-4000-8000-000000000003';
const client={_id:clientId,code:'820',name:'EMPRESA SINTÉTICA NATUREZAS',active:true,uf:'MG'};
const rows=[
  {document:'11222333000181',name:'FORNECEDOR MISTO',natureCode:'2102',totalCents:10000,status:'OPTANTE'},
  {document:'11222333000181',name:'FORNECEDOR MISTO',natureCode:'1202',totalCents:50000,status:'OPTANTE'},
  {document:'12345678900',name:'SERVIÇO SINTÉTICO',natureCode:'8000',totalCents:5000,status:'NON_CNPJ'},
  {document:'12345678900',name:'OUTRA OPERAÇÃO',natureCode:'2949',totalCents:3000,status:'NON_CNPJ'},
  {document:'12345678900',name:'DEVOLUÇÃO SINTÉTICA',natureCode:'2202',totalCents:2000,status:'NON_CNPJ'},
].map(row=>({...row,quantity:'1',recipientUf:'SP',grossCents:row.totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}));
function csv(source=rows) {
  const header=Array(28).fill('');
  for(const [index,title] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[index]=title;
  return [header,...source.map(item=>{const row=Array(28).fill('');row[0]=item.document;row[7]='15/08/2026';row[8]=item.name;row[9]='SP';row[11]=item.natureCode+'001';row[14]='Descrição não determina a operação';row[15]='1';row[16]=(item.totalCents/100).toFixed(2).replace('.',',');return row;})].map(row=>row.join(';')).join('\r\n');
}
async function base(page:Page) {
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'selection-test',role:'operator'}}}));
  await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[client]}}));
}
async function completed(page:Page,source=rows) {
  await base(page);let writes=0;
  const selection=summarizePurchaseSelection(source,{includeGroups:true,calculationVersion:'NET_V2'});
  const job={_id:jobId,generationId,clientId,clientCode:client.code,clientName:client.name,mode:'PURCHASES_V1',calculationVersion:'NET_V2',fileName:'820-ENTRADAS.csv',status:'COMPLETED',expectedRows:source.length,uploaded:source.length,createdAt:'2026-10-23T12:00:00Z'};
  const rawTotal=source.reduce((sum,row)=>sum+row.totalCents,0);
  await page.route('**/api/v4/generations/'+generationId,route=>route.fulfill({json:{_id:generationId,requiredReports:['PURCHASES'],companies:[{clientId,name:client.name,code:client.code,purchaseJobId:jobId,purchase:job}]}}));
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,route=>{
    if(route.request().method()!=='GET')writes++;
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/purchases')return route.fulfill({json:{items:[job],total:1}});
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',purchaseSelection:selection,totals:{lines:source.length,totalCents:rawTotal,uniqueDocuments:2,uniqueCnpjs:1,nonCnpjDocumentCount:1,nonCnpjLines:3},groups:[],reportingGroups:[{status:'OPTANTE',count:1,lines:2,totalCents:60000,valuePercent:85.71},{status:'NAO_OPTANTE',count:1,lines:3,totalCents:10000,valuePercent:14.29}]}});
    if(url.pathname.endsWith('/lines'))return route.fulfill({json:{items:source.map(row=>({...row,purchaseSelection:{version:PURCHASE_SELECTION_VERSION,origin:'DERIVED_FROM_SNAPSHOT',...selectPurchaseLine(row,selection.available)}})),total:source.length,page:1,pageSize:100}});
    if(url.pathname.endsWith('/results'))return route.fulfill({json:{items:[{document:rows[0].document,name:'FORNECEDOR MISTO',status:'OPTANTE',documentKind:'CNPJ',totalCents:60000,occurrences:2,purchaseSelection:{version:PURCHASE_SELECTION_VERSION,origin:'DERIVED_FROM_SNAPSHOT',available:selection.available,eligible:selection.available?true:null,consideredCents:selection.available?10000:null,selectedLines:selection.available?1:null,reason:'MIXED_OPERATIONS'}}],total:1,page:1,pageSize:100}});
    return route.fulfill({json:job});
  });
  return ()=>writes;
}

test('Prévia separa COMPRAS e serviços 8000 das devoluções e outras naturezas',async({page})=>{
  await base(page);await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,route=>route.fulfill({json:{items:[],total:0}}));
  await page.goto('/purchases.html');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'820-ENTRADAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await expect(page.locator('#purchase-confirm')).toBeVisible();
  const audit=page.locator('#purchase-review .purchase-selection-audit');
  await expect(audit.locator('[data-purchase-original-total]')).toContainText('700,00');
  await expect(audit.locator('[data-purchase-excluded-total]')).toContainText('550,00');
  await expect(audit.locator('[data-purchase-selection-total]')).toContainText('150,00');
  const table=page.locator('#purchase-review .purchase-preview');
  await expect(table.getByRole('row').filter({hasText:'DEVOLUÇÃO SINTÉTICA'})).toContainText('Excluída das compras');
  await expect(table.getByRole('row').filter({hasText:'SERVIÇO SINTÉTICO'})).toContainText('Incluída · serviço 8000');
  await audit.getByText('Conferir valores por natureza',{exact:true}).click();
  await expect(audit.locator('tbody tr')).toHaveCount(5);await expect(audit.locator('tbody tr').filter({hasText:'8000'})).toContainText('50,00');
});

for(const guided of [false,true])test(`Compras ${guided?'guiadas':'completas'} usam seleção no total, documentos e percentuais`,async({page},testInfo)=>{
  const writes=await completed(page);
  await page.goto(`/purchases.html?generation=${generationId}&client=${clientId}&job=${jobId}${guided?'&guided=1':''}`);
  await expect(page.locator('.purchase-hero')).toContainText('Compras consideradas');
  await expect(page.locator('.purchase-hero [data-purchase-considered-total]')).toContainText('150,00');
  await expect(page.locator('.purchase-group[data-status=OPTANTE]')).toContainText('100,00');
  await expect(page.locator('.purchase-group[data-status=OPTANTE]')).toContainText('66,67%');
  await expect(page.locator('.purchase-group[data-status=NAO_OPTANTE]')).toContainText('33,33%');
  await expect(page.locator('.purchase-selection-audit [data-purchase-original-total]')).toContainText('700,00');
  await page.locator('.purchase-selection-audit summary').click();
  await expect(page.locator('.purchase-nature-table tbody tr').filter({hasText:'1202'})).toContainText('Excluída');
  if(!guided){
    await expect(page.locator('#purchase-result-list [data-purchase-considered-cell]')).toContainText('100,00');
    await expect(page.locator('#purchase-result-list [data-purchase-considered-cell]')).toContainText('1 linha(s) considerada(s)');
    await page.locator('.purchase-group[data-status=NAO_OPTANTE]').click();
    await expect(page.locator('#purchase-csv-note')).toContainText('3 linhas originais neste grupo');
    await page.getByLabel('Visualização').selectOption('lines');
    await expect(page.locator('#purchase-result-list tbody tr').filter({hasText:'DEVOLUÇÃO SINTÉTICA'})).toContainText('Excluída das compras');
    await expect(page.locator('#purchase-result-list tbody tr').filter({hasText:'DEVOLUÇÃO SINTÉTICA'}).locator('[data-purchase-considered-cell]')).toContainText('0,00');
  }
  const desktop=testInfo.outputPath('purchase-selection-desktop.png');await page.locator('.purchase-selection-audit').screenshot({path:desktop});await testInfo.attach('Naturezas consideradas desktop',{path:desktop,contentType:'image/png'});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const mobile=testInfo.outputPath('purchase-selection-mobile.png');await page.screenshot({path:mobile,fullPage:true});await testInfo.attach('Naturezas consideradas mobile',{path:mobile,contentType:'image/png'});
  expect(writes()).toBe(0);
});

test('Histórico sem natureza mostra compras indisponíveis e conserva original sem falso zero',async({page})=>{
  await completed(page,[{...rows[0],natureCode:''}]);await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
  await expect(page.locator('[data-purchase-considered-total]')).toHaveText('Indisponível');
  await expect(page.locator('[data-purchase-original-total]')).toContainText('100,00');
  await expect(page.locator('.purchase-group')).toHaveCount(0);await expect(page.locator('.purchase-selection-audit')).toContainText('Faltam naturezas válidas');
  await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('[data-purchase-considered-cell]')).toContainText('Indisponível');
  await expect(page.locator('[data-purchase-considered-cell]')).not.toContainText('0,00');
});

test('Arquivo com somente operações excluídas mostra compras zero com origem reconciliada',async({page})=>{
  await completed(page,[rows[1],rows[3]]);await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
  await expect(page.locator('[data-purchase-considered-total]')).toContainText('0,00');
  await expect(page.locator('[data-purchase-original-total]')).toContainText('530,00');await expect(page.locator('[data-purchase-excluded-total]')).toContainText('530,00');
  await expect(page.locator('.purchase-group')).toHaveCount(2);await expect(page.getByText('Não há valor de compras considerado neste arquivo; os percentuais são zero.',{exact:false})).toBeVisible();
});
