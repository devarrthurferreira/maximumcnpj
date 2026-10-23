import {test,expect,type Page} from '@playwright/test';

const clientId='c5100000-0000-4000-8000-000000000001',generationId='c5100000-0000-4000-8000-000000000002';
const purchaseJobId='c5100000-0000-4000-8000-000000000003',salesJobId='c5100000-0000-4000-8000-000000000004';
const otherClientId='c5100000-0000-4000-8000-000000000005';
const company={_id:clientId,clientId,code:'951',name:'Empresa sintética fechamento da receita',active:true,uf:'MG'};
const policy={version:'DIFAL_SCENARIOS_V2',enabled:{pure:true,hybrid:true,presumed:false,actual:false},operations:{pure:{entry:true,exit:false},hybrid:{entry:true,exit:false}}};
const closing=(returns=15000,client=clientId,purchase=purchaseJobId,sales=salesJobId)=>({
  version:'REVENUE_RECONCILIATION_V1',status:'AVAILABLE',available:true,reason:null,generationId,clientId:client,purchaseJobId:purchase,salesJobId:sales,
  period:{startMonth:'2025-01',endMonth:'2025-01',months:1},grossSalesCents:100000,serviceSalesCents:20000,grossRevenueCents:120000,salesReturnsCents:returns,revenueAfterReturnsCents:120000-returns,
  monthly:[{sourceMonth:'2025-01',grossSalesCents:100000,serviceSalesCents:20000,grossRevenueCents:120000,salesReturnsCents:returns,revenueAfterReturnsCents:120000-returns}]
});
const pending={version:'REVENUE_RECONCILIATION_V1',status:'PENDING',available:false,reason:'Conclua os relatórios de compras e vendas desta empresa para conferir as devoluções.',monthly:[]};
function job(sales:boolean){return {_id:sales?salesJobId:purchaseJobId,generationId,clientId,clientCode:company.code,clientName:company.name,mode:sales?'SALES_V1':'PURCHASES_V1',status:'COMPLETED',calculationVersion:'NET_V2',operationVersion:'NATURE_OPERATIONS_2026_10_V1',fileName:sales?'951-VENDAS.csv':'951-COMPRAS.csv',createdAt:'2026-10-23T12:00:00Z',expectedRows:sales?4:2,uploaded:sales?4:2};}
async function mount(page:Page,{sales=true,revenue=closing()}:{sales?:boolean;revenue?:any}={}){
  const activeJob=job(sales),writes:string[]=[],generationReads:string[]=[],name=sales?'sales':'purchases';
  const totals={lines:sales?4:1,totalCents:sales?115000:50000,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:sales?4:1};
  const groups=[{status:sales?'CPF':'NAO_OPTANTE',count:1,lines:totals.lines,totalCents:totals.totalCents,countPercent:100,valuePercent:100,unconfirmedCount:0,unconfirmedCents:0}];
  const summary:any={job:activeJob,calculationVersion:'NET_V2',difalPolicy:policy,totals,reportingGroups:groups,revenueReconciliation:revenue,
    components:{grossCents:sales?135000:65000,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:sales?135000:65000},
    ...(sales?{difal:{version:'DIFAL_ESTIMATE_V4',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:100000,amountCents:10000,pendingLines:0}}:{
      anticipation:{version:'ICMS_ANTICIPATION_V3',ratePercent:7.32,issuerUf:'MG',eligibleLines:1,baseCents:50000,amountCents:3660,pendingLines:0},
      purchaseSelection:{version:'PURCHASE_NATURES_V1',available:true,reportTotalCents:65000,reportLines:2,excludedTotalCents:15000,excludedLines:1,totals,reportingGroups:groups,natureTotals:[]}})};
  const generation:any={_id:generationId,requiredReports:['PURCHASES','SALES'],status:'COMPLETED',companyCount:1,completedCount:1,missingCount:0,inProgressCount:0,createdAt:'2026-10-23T12:00:00Z',companies:[{...company,difalPolicy:policy,status:'COMPLETED',purchase:job(false),sales:job(true),purchaseJobId,salesJobId}]};
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'revenue-closing-test',role:'operator',name:'Teste sintético'}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[company]}}));
  await page.route(`**/api/v4/generations/${generationId}`,r=>r.fulfill({json:generation}));
  await page.route(`**/api/v4/generations/${generationId}/revenue?*`,r=>{generationReads.push(new URL(r.request().url()).searchParams.get('clientId')!);return r.fulfill({json:closing()});});
  await page.route('**/api/v4/lookups/**',r=>r.fulfill({json:{items:[],total:0,metrics:{total:0,completed:0}}}));
  await page.route(new RegExp(`/api/v4/${name}(?:[/?]|$)`),r=>{
    const path=new URL(r.request().url()).pathname;if(r.request().method()!=='GET')writes.push(path);
    if(path===`/api/v4/${name}`)return r.fulfill({json:{items:[activeJob],total:1}});
    if(path.endsWith('/summary'))return r.fulfill({json:summary});
    if(path.endsWith('/revenue-csv'))return r.fulfill({json:{content:'Descrição;Valor (R$)\r\nReceita bruta;1200,00\r\nDevoluções de venda;-150,00\r\nReceita após devoluções;1050,00',fileName:'fechamento-receita.csv',mimeType:'text/csv;charset=utf-8'}});
    if(path.endsWith('/results')||path.endsWith('/lines'))return r.fulfill({json:{items:[],total:0,page:1,pageSize:100}});
    return r.fulfill({json:activeJob});
  });
  return {summary,generation,writes,generationReads};
}

for(const sales of [false,true])for(const guided of [false,true])test(`fechamento final ${sales?'de vendas':'de compras'} ${guided?'guiado':'completo'} mostra bruto menos devoluções sem alterar o original`,async({page})=>{
  const {writes}=await mount(page,{sales});
  await page.goto(`/purchases.html?type=${sales?'SALES':'PURCHASES'}&client=${clientId}&job=${sales?salesJobId:purchaseJobId}${guided?`&generation=${generationId}&guided=1`:''}`);
  const panel=page.locator('#purchase-report-view [data-revenue-reconciliation]');
  await expect(panel).toHaveAttribute('data-revenue-status','available');
  await expect(panel.locator('[data-revenue-value="grossRevenueCents"]')).toContainText('1.200,00');
  await expect(panel.locator('[data-revenue-value="salesReturnsCents"]')).toContainText('− R$');await expect(panel.locator('[data-revenue-value="salesReturnsCents"]')).toContainText('150,00');
  await expect(panel.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('1.050,00');
  expect(await panel.evaluate(element=>element===element.parentElement?.lastElementChild)).toBe(true);
  await expect(panel.locator('details')).not.toHaveAttribute('open','');await expect(panel.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toBeVisible();
  await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText(sales?'1.150,00':'500,00');
  if(sales){await expect(page.getByRole('heading',{name:'Total original do arquivo de vendas',exact:true})).toBeVisible();await expect(page.locator('#purchase-report-view [data-difal-amount]')).toContainText('0,00');}
  else await expect(page.locator('#purchase-report-view [data-anticipation-amount]')).toContainText('36,60');
  await panel.locator('summary').click();await expect(panel.locator('[data-revenue-component="grossSalesCents"]')).toContainText('1.000,00');await expect(panel.locator('[data-revenue-component="serviceSalesCents"]')).toContainText('200,00');
  expect(writes).toEqual([]);
});

test('fechamento de receita é legível em desktop e celular, imprime e baixa seu CSV separado',async({page},info)=>{
  const {writes}=await mount(page);await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${salesJobId}`);
  const panel=page.locator('#purchase-report-view [data-revenue-reconciliation]');await expect(panel).toHaveAttribute('data-revenue-status','available');
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});await panel.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath(`fechamento-receita-${width}.png`)});}
  await page.emulateMedia({media:'print'});await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  await expect(panel.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toBeVisible();await expect(panel.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('1.050,00');
  await expect(panel.locator('#purchase-revenue-csv')).toBeHidden();
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(panel.locator('details')).not.toHaveAttribute('open','');
  const downloadPromise=page.waitForEvent('download');await panel.getByRole('button',{name:'Baixar fechamento CSV'}).click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('fechamento-receita.csv');const stream=await download.createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toContain('Receita após devoluções;1050,00');expect(writes).toEqual([`/api/v4/sales/${salesJobId}/revenue-csv`]);
});

for(const unavailable of [false,true])test(`fechamento ${unavailable?'ausente no histórico':'pendente do par de relatórios'} permanece explícito sem inventar devolução zero`,async({page})=>{
  const {summary,generationReads}=await mount(page,{revenue:pending});if(unavailable)delete summary.revenueReconciliation;
  await page.goto(`/purchases.html?generation=${generationId}&type=SALES&client=${clientId}&job=${salesJobId}`);
  const panel=page.locator('#purchase-report-view [data-revenue-reconciliation]');await expect(panel).toHaveAttribute('data-revenue-status',unavailable?'unavailable':'pending');
  await expect(panel.locator('[data-revenue-value]')).toHaveText(['—','—','—']);await expect(panel).not.toContainText('R$ 0,00');
  await expect(panel.getByRole('button',{name:'Baixar fechamento CSV'})).toBeDisabled();expect(generationReads).toEqual([]);
});

test('zero confirmado de devoluções mantém a receita bruta como valor após devoluções',async({page})=>{
  await mount(page,{revenue:closing(0)});await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${salesJobId}`);
  const panel=page.locator('[data-revenue-reconciliation]');await expect(panel).toHaveAttribute('data-revenue-status','available');await expect(panel.locator('[data-revenue-value="salesReturnsCents"]')).toContainText('0,00');await expect(panel.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('1.200,00');
});

test('fechamento não apresenta como confirmado um total que diverge das competências',async({page})=>{
  await mount(page,{revenue:{...closing(),revenueAfterReturnsCents:120000}});await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${salesJobId}`);
  const panel=page.locator('[data-revenue-reconciliation]');await expect(panel).toHaveAttribute('data-revenue-status','unavailable');await expect(panel.locator('[data-revenue-value]')).toHaveText(['—','—','—']);
});

test('geração exibe fechamento próprio por empresa e bloqueia resposta vinculada a outra empresa',async({page},info)=>{
  const {generation}=await mount(page),otherPurchase='c5100000-0000-4000-8000-000000000006',otherSales='c5100000-0000-4000-8000-000000000007';
  let mismatched=false;
  generation.companies.push({...generation.companies[0],clientId:otherClientId,name:'Outra empresa sintética',code:'952',purchase:{...job(false),_id:otherPurchase,clientId:otherClientId},sales:{...job(true),_id:otherSales,clientId:otherClientId},purchaseJobId:otherPurchase,salesJobId:otherSales});generation.companyCount=2;generation.completedCount=2;
  await page.route(`**/api/v4/generations/${generationId}/revenue?*`,r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('clientId')===otherClientId&&!mismatched?closing(25000,otherClientId,otherPurchase,otherSales):closing()}));
  await page.goto(`/generations.html?id=${generationId}`);
  const first=page.locator(`[data-generation-revenue-client="${clientId}"]`),second=page.locator(`[data-generation-revenue-client="${otherClientId}"]`);
  await first.scrollIntoViewIfNeeded();await expect(first.locator('[data-revenue-status]')).toHaveAttribute('data-revenue-status','available');await expect(first.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('1.050,00');
  await second.scrollIntoViewIfNeeded();await expect(second.locator('[data-revenue-status]')).toHaveAttribute('data-revenue-status','available');await expect(second.locator('[data-revenue-value="revenueAfterReturnsCents"]')).toContainText('950,00');
  mismatched=true;await page.getByRole('button',{name:'Atualizar situação',exact:true}).click();await second.scrollIntoViewIfNeeded();await expect(second.locator('[data-revenue-status]')).toHaveAttribute('data-revenue-status','unavailable');await expect(second).toContainText('não corresponde aos relatórios desta empresa');await expect(second.locator('[data-revenue-value]')).toHaveText(['—','—','—']);
  await page.setViewportSize({width:320,height:900});await first.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await first.screenshot({path:info.outputPath('geracao-fechamento-320.png')});
});

test('empresa com somente vendas mantém fechamento pendente sem buscar par por cadastro',async({page})=>{
  const {generation,generationReads}=await mount(page);generation.companies[0].purchase=null;generation.companies[0].purchaseJobId=null;
  await page.goto(`/generations.html?id=${generationId}`);const panel=page.locator('[data-generation-revenue-client]');await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator('[data-revenue-status]')).toHaveAttribute('data-revenue-status','pending');await expect(panel.locator('[data-revenue-value]')).toHaveText(['—','—','—']);expect(generationReads).toEqual([]);
});

for(const type of ['PURCHASES','SALES'])test(`geração que selecionou apenas ${type==='PURCHASES'?'compras':'vendas'} identifica fechamento indisponível`,async({page})=>{
  const {generation,generationReads}=await mount(page);generation.requiredReports=[type];
  await page.goto(`/generations.html?id=${generationId}`);const panel=page.locator('[data-generation-revenue-client]');await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator('[data-revenue-status]')).toHaveAttribute('data-revenue-status','unavailable');await expect(panel).toContainText('O fechamento da receita exige compras e vendas');await expect(panel.locator('[data-revenue-value]')).toHaveText(['—','—','—']);expect(generationReads).toEqual([]);
});
