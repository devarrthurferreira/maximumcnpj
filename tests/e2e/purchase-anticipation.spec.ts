import {test,expect,type Page} from '@playwright/test';
import {ANTICIPATION_VERSION} from '../../src/icms-anticipation.ts';
import {OPERATION_CATALOG_VERSION} from '../../src/operation-catalog.ts';

const clientId='81000000-0000-4000-8000-000000000001',generationId='81000000-0000-4000-8000-000000000002',jobId='81000000-0000-4000-8000-000000000003';
const client={_id:clientId,code:'810',name:'EMPRESA SINTÉTICA COMPRAS',active:true};
type Purchase={name?:string;document?:string;uf?:string;nature?:string;value?:string};
function csv(purchases:Purchase[]=[{}]) {
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  return [header,...purchases.map(purchase=>{
    const row=Array(28).fill(''); row[0]=purchase.document??'123.456.789-00';row[7]='15/08/2026';row[8]=purchase.name??'FORNECEDOR SINTÉTICO';
    row[9]=purchase.uf??'SP';row[11]=purchase.nature??'2102001';row[14]='Descrição sintética';row[15]='1';row[16]=purchase.value??'150,00';return row;
  })].map(row=>row.join(';')).join('\r\n');
}
async function base(page:Page,uf='') {
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'anticipation-test',role:'operator'}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[{...client,uf}]}}));
}
async function preview(page:Page,purchases:Purchase[]=[{}]) {
  await page.locator('#purchase-file').setInputFiles({name:'810-COMPRAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv(purchases))});
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  await expect(page.locator('#purchase-confirm')).toBeVisible();
}
const result={eligible:true,baseCents:15000,amountCents:1098,reason:'ELIGIBLE'};
const summary={version:ANTICIPATION_VERSION,ratePercent:7.32,issuerUf:'MG',eligibleLines:1,baseCents:15000,amountCents:1098,pendingLines:0};
const totals={lines:1,totalCents:15000,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:1};
const groups=[{status:'NAO_OPTANTE',count:1,lines:1,totalCents:15000,countPercent:100,valuePercent:100,unconfirmedCount:0,unconfirmedCents:0}];

test('Antecipação compras mostra CPF, 7,32%, exclusões e pendências e recalcula a UF',async({page},testInfo)=>{
  await base(page);
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,r=>r.fulfill({json:{items:[],total:0}}));
  await page.goto('/purchases.html');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await preview(page);
  const panel=page.locator('#purchase-review .purchase-anticipation');
  await expect(panel.getByRole('heading',{name:'Antecipação de ICMS · compras com CPF'})).toBeVisible();
  await expect(panel.locator('[data-anticipation-amount]')).toHaveText('Pendente');
  await page.getByLabel('UF do estabelecimento comprador').selectOption('MG');
  await expect(panel.locator('[data-anticipation-amount]')).toContainText('10,98');
  await expect(panel).toContainText('7,32%');await expect(panel).toContainText('Base elegível: R$');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('150,00');
  await page.getByLabel('UF do estabelecimento comprador').selectOption('SP');
  await expect(panel.locator('[data-anticipation-amount]')).toContainText('0,00');
  await page.getByLabel('UF do estabelecimento comprador').selectOption('MG');
  await preview(page,[{},
    {name:'Pessoa jurídica',document:'11222333000181'},
    {name:'Documento outro',document:'123456789012'},
    {name:'Mesma UF',uf:'MG'},
    {name:'Serviço 8000',nature:'8000102'},
    {name:'Devolução',nature:'1202001'},
    {name:'Sem UF',uf:''},
    {name:'Sem documento',document:''}]);
  await expect(panel.locator('[data-anticipation-amount]')).toContainText('21,96');
  await expect(panel).toContainText('2 linha(s) elegível(is)');await expect(panel).toContainText('1 linha(s) pendente(s)');
  const table=page.locator('#purchase-review tbody');
  for(const name of ['Pessoa jurídica','Documento outro','Sem documento'])await expect(table.getByRole('row').filter({hasText:name})).toContainText('Fornecedor não identificado por CPF');
  await expect(table.getByRole('row').filter({hasText:'Mesma UF'})).toContainText('Não se aplica');
  await expect(table.getByRole('row').filter({has:page.getByRole('cell',{name:'Serviço 8000',exact:true})})).toContainText('10,98');
  await expect(table.getByRole('row').filter({hasText:'Devolução'})).toContainText('Não se aplica');
  await expect(table.getByRole('row').filter({hasText:'Sem UF'})).toContainText('Pendente');
  const desktop=testInfo.outputPath('anticipation-preview-desktop.png');
  await panel.screenshot({path:desktop});await testInfo.attach('Antecipação compras CPF desktop',{path:desktop,contentType:'image/png'});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const mobile=testInfo.outputPath('anticipation-preview-mobile.png');
  await panel.screenshot({path:mobile});await testInfo.attach('Antecipação compras CPF mobile',{path:mobile,contentType:'image/png'});
});

for(const guided of [false,true])test(`Antecipação ${guided?'guiada':'completa'} preserva UF no retry, mostra snapshot e envia somente insumos`,async({page})=>{
  await base(page,'MG');const creates:any[]=[],uploads:any[]=[];let job:any=null;
  const generation=()=>({_id:generationId,requiredReports:['PURCHASES'],companies:[{clientId,name:client.name,code:client.code,purchaseJobId:job?._id,purchase:job}]});
  const create=async(route:any)=>{
    const payload=route.request().postDataJSON();creates.push(payload);
    if(creates.length===1)return route.fulfill({status:503,json:{message:'Falha temporária sintética'}});
    job={_id:payload.importId,clientId,clientCode:client.code,clientName:client.name,generationId:guided?generationId:undefined,mode:'PURCHASES_V1',operationVersion:OPERATION_CATALOG_VERSION,anticipationVersion:ANTICIPATION_VERSION,issuerUf:payload.issuerUf,calculationVersion:'NET_V2',fileName:payload.fileName,status:'UPLOADING',expectedRows:1,uploaded:0,createdAt:'2026-10-22T12:00:00Z'};
    return route.fulfill({json:guided?{generation:generation(),job}:job});
  };
  await page.route('**/api/v4/generations/'+generationId,r=>r.fulfill({json:generation()}));
  await page.route('**/api/v4/generations/'+generationId+'/purchases',create);
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/purchases')return route.request().method()==='POST'?create(route):route.fulfill({json:{items:job?[job]:[],total:job?1:0}});
    if(url.pathname.endsWith('/rows')){uploads.push(route.request().postDataJSON());job.uploaded=1;return route.fulfill({json:{uploaded:1}});}
    if(url.pathname.endsWith('/finalize')){job.status='COMPLETED';return route.fulfill({json:job});}
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',anticipation:summary,totals,reportingGroups:groups}});
    if(url.pathname.endsWith('/results')||url.pathname.endsWith('/lines'))return route.fulfill({json:{items:[{document:'12345678900',name:'FORNECEDOR SINTÉTICO',documentKind:'CPF',recipientUf:'SP',quantity:'1',natureCode:'2102',natureOperation:'COMPRAS',totalCents:15000,anticipation:result}],page:1,total:1,pageSize:100}});
    return route.fulfill({json:job});
  });
  await page.goto(guided?`/purchases.html?generation=${generationId}&client=${clientId}&guided=1`:'/purchases.html');
  if(!guided)await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await page.locator('#purchase-file').setInputFiles({name:'810-COMPRAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});
  if(!guided){await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await page.locator('#purchase-confirm').click();}
  await expect(page.getByRole('button',{name:'Retomar envio deste relatório'})).toBeVisible();
  await expect(page.getByLabel('UF do estabelecimento comprador')).toBeDisabled();
  await page.getByRole('button',{name:'Retomar envio deste relatório'}).click();
  await expect(page.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('10,98');
  await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('150,00');
  expect(creates).toHaveLength(2);expect(creates[0]).toEqual(creates[1]);expect(creates[1].issuerUf).toBe('MG');
  expect(uploads[0].rows[0]).toMatchObject({document:'123.456.789-00',recipientUf:'SP',natureCode:'2102',natureOperation:'COMPRAS',operationVersion:OPERATION_CATALOG_VERSION,totalCents:15000});
  expect(uploads[0].rows[0]).not.toHaveProperty('anticipation');expect(uploads[0].rows[0]).not.toHaveProperty('difal');
  if(!guided){await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('#purchase-result-list')).toContainText('UF fornecedor');await expect(page.locator('#purchase-result-list')).toContainText('Antecipação de ICMS · 7,32%');await expect(page.locator('#purchase-result-list tbody')).toContainText('10,98');}
});

test('Retomada de compras sem versão de antecipação preserva campos e informa indisponibilidade',async({page})=>{
  await base(page,'MG');let uploaded:any;
  const job:any={_id:jobId,clientId,clientCode:client.code,clientName:client.name,mode:'PURCHASES_V1',operationVersion:OPERATION_CATALOG_VERSION,issuerUf:'MG',calculationVersion:'NET_V2',fileName:'810-COMPRAS.csv',status:'UPLOADING',expectedRows:1,uploaded:0,createdAt:'2026-10-20T12:00:00Z'};
  await page.route(/\/api\/v4\/purchases(?:[/?]|$)/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/purchases')return route.fulfill({json:route.request().method()==='POST'?job:{items:[job],total:1}});
    if(url.pathname.endsWith('/rows')){uploaded=route.request().postDataJSON();job.uploaded=1;return route.fulfill({json:{uploaded:1}});}
    if(url.pathname.endsWith('/finalize')){job.status='COMPLETED';return route.fulfill({json:job});}
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',anticipation:null,totals,reportingGroups:groups}});
    if(url.pathname.endsWith('/results'))return route.fulfill({json:{items:[],total:0,pageSize:100}});
    return route.fulfill({json:job});
  });
  await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
  await expect(page.getByRole('heading',{name:'Importação incompleta'})).toBeVisible();
  await preview(page);
  await expect(page.locator('#purchase-review .purchase-anticipation')).toContainText('Indisponível neste histórico');
  await expect(page.locator('#purchase-review [data-anticipation-amount]')).toHaveCount(0);
  await page.locator('#purchase-confirm').click();
  await expect(page.locator('#purchase-report-view .purchase-anticipation')).toContainText('Indisponível neste histórico');
  expect(uploaded.rows[0]).not.toHaveProperty('anticipation');expect(uploaded.rows[0].operationVersion).toBe(OPERATION_CATALOG_VERSION);
});
