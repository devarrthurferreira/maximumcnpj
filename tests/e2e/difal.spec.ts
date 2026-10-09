import {test, expect, type Page} from '@playwright/test';

const clientId='00000000-0000-4000-8000-000000000081';
const generationId='00000000-0000-4000-8000-000000000082';
const existingJobId='00000000-0000-4000-8000-000000000083';
const client={_id:clientId,code:'123',name:'EMPRESA SINTÉTICA DIFAL',active:true};
const version='DIFAL_ESTIMATE_V1';
const eligible={eligible:true,baseCents:15000,amountCents:1500,reason:'ELIGIBLE'};
type Sale={name?:string;value?:string;document?:string;uf?:string;nature?:string;description?:string};
function csv(sales:Sale[]=[{}]) {
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Comprador'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  return [header,...sales.map(sale=>{
    const row=Array(28).fill('');
    row[0]=sale.document??'123.456.789-00';row[7]='15/08/2026';row[8]=sale.name??'COMPRADOR SINTÉTICO';row[9]=sale.uf??'SP';row[11]=sale.nature??'6108';row[14]=sale.description??'Camiseta';row[16]=sale.value??'150,00';
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

test('DIFAL preview recalculates UF and changed sale value without changing financial totals',async({page})=>{
  await ready(page);
  await expect(page.getByLabel('UF do estabelecimento emitente')).toHaveValue('');
  await preview(page);
  const previewPanel=page.locator('#purchase-review .purchase-difal');
  await expect(previewPanel.locator('[data-difal-amount]')).toHaveText('Pendente');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('MG');
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('15,00');
  await expect(previewPanel).toContainText('alíquota média estimada');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('150,00');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('SP');
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(page.locator('#purchase-review tbody')).toContainText('Emitente e destinatário na mesma UF');
  await page.getByLabel('UF do estabelecimento emitente').selectOption('MG');
  await preview(page,[{value:'1000,00'}]);
  await expect(previewPanel.locator('[data-difal-amount]')).toContainText('100,00');
  await expect(page.locator('#purchase-review .import-totals')).toContainText('1.000,00');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('DIFAL rejects CNPJ, same UF, services and non-sale natures and marks missing recipient UF',async({page})=>{
  await ready(page,'MG');
  await expect(page.getByLabel('UF do estabelecimento emitente')).toHaveValue('MG');
  await preview(page,[{},
    {name:'Pessoa jurídica',document:'11222333000181'},
    {name:'Mesma UF',uf:'MG'},
    {name:'Serviço',nature:'9000',description:'Prestação de serviço'},
    {name:'Remessa',nature:'6949',description:'Remessa'},
    {name:'Sem UF',uf:''}]);
  const table=page.locator('#purchase-review tbody');
  await expect(table.getByRole('row').nth(0)).toContainText('15,00');
  for(const name of ['Pessoa jurídica','Mesma UF','Serviço','Remessa'])await expect(table.getByRole('row').filter({hasText:name})).toContainText('Não se aplica');
  await expect(table.getByRole('row').filter({hasText:'Sem UF'})).toContainText('Pendente');
  await expect(page.locator('#purchase-review .purchase-difal')).toContainText('1 linha(s) pendente(s)');
  await expect(page.locator('#purchase-review .purchase-difal')).toContainText('Valor parcial');
  await expect(page.locator('#purchase-review [data-difal-amount]')).toContainText('15,00');
});

for(const guided of [false,true])test(`DIFAL ${guided?'guided':'full'} import preserves issuer UF during retry and displays persisted calculation`,async({page})=>{
  await base(page,'MG');
  const creates:any[]=[],uploads:any[]=[];
  let job:any=null;
  const generation=()=>({_id:generationId,requiredReports:['SALES'],companies:[{clientId,name:client.name,code:client.code,salesJobId:job?._id,sales:job}]});
  const create=async(route:any)=>{
    const payload=route.request().postDataJSON();creates.push(payload);
    if(creates.length===1)return route.fulfill({status:503,json:{message:'Falha temporária sintética'}});
    job={_id:payload.importId,clientId,clientCode:client.code,clientName:client.name,generationId:guided?generationId:undefined,type:'SALES',difalVersion:version,issuerUf:payload.issuerUf,calculationVersion:'NET_V2',fileName:payload.fileName,status:'UPLOADING',expectedRows:1,uploaded:0,createdAt:'2026-10-09T12:00:00Z'};
    return route.fulfill({json:guided?{generation:generation(),job}:job});
  };
  await page.route('**/api/v4/generations/'+generationId,route=>route.fulfill({json:generation()}));
  await page.route('**/api/v4/generations/'+generationId+'/sales',create);
  await page.route(/\/api\/v4\/sales(?:[/?]|$)/,route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/v4/sales')return route.request().method()==='POST'?create(route):route.fulfill({json:{items:job?[job]:[],total:job?1:0}});
    if(url.pathname.endsWith('/rows')){uploads.push(route.request().postDataJSON());job.uploaded=1;return route.fulfill({json:{uploaded:1}});}
    if(url.pathname.endsWith('/finalize')){job.status='COMPLETED';return route.fulfill({json:job});}
    if(url.pathname.endsWith('/summary'))return route.fulfill({json:{job,calculationVersion:'NET_V2',difal:{version,ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:15000,amountCents:1500,pendingLines:0},totals:{lines:1,totalCents:15000,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:1},reportingGroups:[{status:'CPF',count:1,lines:1,totalCents:15000,countPercent:100,valuePercent:100}]}});
    if(url.pathname.endsWith('/results')||url.pathname.endsWith('/lines'))return route.fulfill({json:{items:[{document:'123.456.789-00',name:'COMPRADOR SINTÉTICO',documentKind:'CPF',operation:'VENDA',recipientUf:'SP',quantity:'0',totalCents:15000,difal:eligible}],page:1,total:1,pageSize:100}});
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
  await expect(page.locator('#purchase-report-view [data-difal-amount]')).toContainText('15,00');
  await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('150,00');
  expect(creates).toHaveLength(2);expect(creates[0]).toEqual(creates[1]);expect(creates[1].issuerUf).toBe('MG');
  expect(uploads[0].rows[0]).toMatchObject({recipientUf:'SP',natureCode:'6108',operation:'VENDA',totalCents:15000});
  expect(uploads[0].rows[0]).not.toHaveProperty('difal');
  if(!guided){await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('#purchase-result-list')).toContainText('DIFAL estimado · 10%');await expect(page.locator('#purchase-result-list tbody')).toContainText('15,00');}
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
