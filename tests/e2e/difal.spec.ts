import {test, expect, type Page} from '@playwright/test';
import {OPERATION_CATALOG_VERSION} from '../../src/operation-catalog.ts';
import {DIFAL_VERSION} from '../../src/difal.ts';

const clientId='00000000-0000-4000-8000-000000000081';
const generationId='00000000-0000-4000-8000-000000000082';
const existingJobId='00000000-0000-4000-8000-000000000083';
const client={_id:clientId,code:'123',name:'EMPRESA SINTÉTICA DIFAL',active:true};
const version=DIFAL_VERSION;
const outgoingDisabled={eligible:false,baseCents:0,amountCents:0,reason:'OUTGOING_DISABLED'};
type Sale={name?:string;value?:string;document?:string;uf?:string;nature?:string;description?:string;date?:string};
function csv(sales:Sale[]=[{}]) {
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Comprador'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  return [header,...sales.map(sale=>{
    const row=Array(28).fill('');
    row[0]=sale.document??'123.456.789-00';row[7]=sale.date??'15/08/2026';row[8]=sale.name??'COMPRADOR SINTÉTICO';row[9]=sale.uf??'SP';row[11]=sale.nature??'6108';row[14]=sale.description??'Camiseta';row[16]=sale.value??'150,00';
    return row;
  })].map(row=>row.join(';')).join('\r\n');
}
async function base(page:Page,uf?:string) {
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'test',role:'operator'}}}));
  await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[{...client,...(uf?{uf}:{})}]}}));
}
async function preview(page:Page,sales:Sale[]=[{}]) {
  await page.locator('#purchase-file').setInputFiles({name:'123-VENDAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv(sales))});
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  await expect(page.locator('#purchase-confirm')).toBeVisible();
}
async function ready(page:Page,uf?:string) {
  await base(page,uf);
  await page.route(/\/api\/v4\/sales(?:[/?]|$)/,route=>route.fulfill({json:{items:[],total:0}}));
  await page.goto('/purchases.html?type=SALES');
  await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
}

test('saída permanece zerada ao alterar UF e valor da venda, preservando os totais financeiros',async({page})=>{
  await ready(page);
  await expect(page.getByLabel('UF do estabelecimento emitente')).toHaveValue('');
  await preview(page);
  const previewPanel=page.locator('#purchase-review .purchase-difal');
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('0,00');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('MG');
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(previewPanel).toContainText('Não possui DIFAL de saída');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('150,00');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('SP');
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#purchase-review tbody')).toContainText('Saída desativada');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('MG');
  await preview(page,[{value:'1000,00'}]);
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('1.000,00');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('5102 preserva vendas para CPF e CNPJ nas 12 competências com saída zerada',async({page})=>{
  await ready(page,'MG');
  await preview(page,Array.from({length:12},(_,i)=>({nature:i%2?'5102090':'5102001',
    date:`15/${String(i+1).padStart(2,'0')}/2025`,document:i%2?'11222333000181':'12345678900',description:'REGATA SINTÉTICA',value:'100,00',uf:'RJ'})));
  const panel=page.locator('#purchase-review .purchase-difal');
  await expect(panel).toContainText('inclusive nas vendas interestaduais para CPF');
  await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('1.200,00');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('RJ');
  await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(panel.locator('[data-difal-empty]')).toContainText('Não possui DIFAL de saída');
});

test('saída é zero para CPF, CNPJ, documentos ausentes, serviços e UF ausente sem remover vendas',async({page})=>{
  await ready(page,'MG');
  await expect(page.getByLabel('UF do estabelecimento emitente')).toHaveValue('MG');
  await preview(page,[{},
    {name:'Pessoa jurídica',document:'11222333000181'},
    {name:'CNPJ inválido',document:'11222333000182'},
    {name:'CNO',document:'123456789012'},
    {name:'Documento ausente',document:''},
    {name:'Mesma UF',uf:'MG'},
    {name:'Serviço',nature:'9000',description:'Prestação de serviço'},
    {name:'Remessa',nature:'6949',description:'Remessa'},
    {name:'Sem UF',uf:''},{name:'CNPJ sem UF',document:'11222333000181',uf:''}]);
  const table=page.locator('#purchase-review tbody');
  await expect(table.getByRole('row').nth(0)).toContainText('Saída desativada');
  await expect(table.getByRole('row').filter({hasText:'Pessoa jurídica'})).toContainText('Saída desativada');
  for(const name of ['CNPJ inválido','CNO','Documento ausente','Mesma UF','Serviço','Remessa'])await expect(table.getByRole('row').filter({hasText:name})).toContainText('Saída desativada');
  // The preview table shows its first eight lines; all ten source values remain in the total.
  await expect(page.locator('#purchase-review .purchase-difal')).toContainText('Não possui DIFAL de saída');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('1.500,00');
  await expect(page.locator('#purchase-review [data-difal-amount]')).toContainText('0,00');
});

for(const guided of [false,true])test(`DIFAL ${guided?'guided':'full'} import preserves issuer UF during retry and displays persisted calculation`,async({page})=>{
  await base(page,'MG');
  const creates:any[]=[],uploads:any[]=[];
  let job:any=null;
  const generation=()=>({_id:generationId,requiredReports:['SALES'],companies:[{clientId,name:client.name,code:client.code,salesJobId:job?._id,sales:job}]});
  const create=async(route:any)=>{
    const payload=route.request().postDataJSON();creates.push(payload);
    if(creates.length===1)return route.fulfill({status:503,json:{message:'Falha temporária sintética'}});
    job={_id:payload.importId,clientId,clientCode:client.code,clientName:client.name,generationId:guided?generationId:undefined,type:'SALES',mode:'SALES_V1',difalVersion:version,operationVersion:OPERATION_CATALOG_VERSION,issuerUf:payload.issuerUf,calculationVersion:'NET_V2',fileName:payload.fileName,status:'UPLOADING',expectedRows:1,uploaded:0,createdAt:'2026-10-09T12:00:00Z'};
    return route.fulfill({json:guided?{generation:generation(),job}:job});
  };
  await page.route('**/api/v4/generations/'+generationId,route=>route.fulfill({json:generation()}));
  await page.route('**/api/v4/generations/'+generationId+'/sales',create);
  await page.route(/\/api\/v4\/sales(?:[/?]|$)/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/sales')return route.request().method()==='POST'?create(route):route.fulfill({json:{items:job?[job]:[],total:job?1:0}});
    if(url.pathname.endsWith('/rows')){uploads.push(route.request().postDataJSON());job.uploaded=1;return route.fulfill({json:{uploaded:1}});}
    if(url.pathname.endsWith('/finalize')){job.status='COMPLETED';return route.fulfill({json:job});}
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',difal:{version,ratePercent:10,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:0},totals:{lines:1,totalCents:15000,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:1},reportingGroups:[{status:'CPF',count:1,lines:1,totalCents:15000,countPercent:100,valuePercent:100}]}});
    if(url.pathname.endsWith('/results')||url.pathname.endsWith('/lines'))return route.fulfill({json:{items:[{document:'123.456.789-00',name:'COMPRADOR SINTÉTICO',documentKind:'CPF',operation:'VENDA',recipientUf:'SP',quantity:'0',totalCents:15000,difal:outgoingDisabled}],page:1,total:1,pageSize:100}});
    return route.fulfill({json:job});
  });
  await page.goto(guided?`/purchases.html?generation=${generationId}&client=${clientId}&type=SALES&guided=1`:'/purchases.html?type=SALES');
  if(!guided)await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
  await expect(page.getByLabel('UF do estabelecimento emitente')).toHaveValue('MG');
  await page.locator('#purchase-file').setInputFiles({name:'123-VENDAS.csv',mimeType:'text/csv',buffer:Buffer.from(csv())});
  if(!guided){await page.getByRole('button',{name:'Conferir colunas e valores'}).click();await page.locator('#purchase-confirm').click();}
  await expect(page.getByRole('button',{name:'Retomar envio deste relatório'})).toBeVisible();
  await expect(page.getByLabel('UF do estabelecimento emitente')).toBeDisabled();
  await page.getByRole('button',{name:'Retomar envio deste relatório'}).click();
  await expect(page.locator('#purchase-report-view [data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('150,00');
  expect(creates).toHaveLength(2);expect(creates[0]).toEqual(creates[1]);expect(creates[1].issuerUf).toBe('MG');
  expect(uploads[0].rows[0]).toMatchObject({recipientUf:'SP',natureCode:'6108',operation:'VENDA',natureOperation:'VENDA',operationVersion:OPERATION_CATALOG_VERSION,totalCents:15000});
  expect(uploads[0].rows[0]).not.toHaveProperty('difal');
  if(!guided){await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('#purchase-result-list')).toContainText('DIFAL de saída');await expect(page.locator('#purchase-result-list tbody')).toContainText('Saída desativada');}
});

test('Legacy completed sales display DIFAL unavailable rather than a false zero',async({page})=>{
  await base(page,'MG');
  const job={_id:existingJobId,clientId,clientCode:client.code,clientName:client.name,type:'SALES',calculationVersion:'NET_V2',fileName:'antigo.csv',status:'COMPLETED',expectedRows:1,uploaded:1,createdAt:'2026-10-01T12:00:00Z'};
  await page.route(/\/api\/v4\/sales(?:[/?]|$)/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/sales')return route.fulfill({json:{items:[job],total:1}});
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',difal:null,totals:{lines:1,totalCents:15000,uniqueDocuments:1,uniqueCnpjs:0},reportingGroups:[]}});
    if(url.pathname.endsWith('/results'))return route.fulfill({json:{items:[],total:0,pageSize:100}});
    return route.fulfill({json:job});
  });
  await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${existingJobId}`);
  await expect(page.locator('#purchase-report-view .purchase-difal')).toContainText('Indisponível neste histórico');
  await expect(page.locator('#purchase-report-view .purchase-difal')).not.toContainText('R$');
});
