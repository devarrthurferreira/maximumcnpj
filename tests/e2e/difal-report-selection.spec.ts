import {test,expect,type Page} from '@playwright/test';

const clientId='b3100000-0000-4000-8000-000000000001',generationId='b3100000-0000-4000-8000-000000000002',jobId='b3100000-0000-4000-8000-000000000003';
const company={_id:clientId,clientId,code:'930',name:'Empresa sintética opções dos relatórios',active:true,uf:'MG'};
const selection=(pureEntry=true,pureExit=false,hybridEntry=true,hybridExit=false)=>({version:'DIFAL_SCENARIOS_V2',enabled:{pure:true,hybrid:true,presumed:false,actual:false},operations:{pure:{entry:pureEntry,exit:pureExit},hybrid:{entry:hybridEntry,exit:hybridExit}}});
const difal={version:'DIFAL_ESTIMATE_V4',ratePercent:10,issuerUf:'MG',eligibleLines:1,baseCents:15000,amountCents:1500,pendingLines:0};
const anticipation={version:'ICMS_ANTICIPATION_V3',ratePercent:7.32,issuerUf:'MG',eligibleLines:1,baseCents:15000,amountCents:1098,pendingLines:0};
const rawLine={document:'12345678900',name:'Parceiro sintético',documentKind:'CPF',recipientUf:'SP',quantity:'1',totalCents:15000,grossCents:15000,discountCents:0,freightCents:0,accessoryCents:0,abatementCents:0};
function reportCsv(sales=true){
  const header=Array(28).fill(''),row=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão social'],[9,'Estado'],[11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  row[0]=rawLine.document;row[7]='15/08/2026';row[8]=rawLine.name;row[9]='SP';row[11]=sales?'6108':'2102';row[14]=sales?'Venda':'Compra';row[15]='1';row[16]='150,00';
  return Buffer.from([header,row].map(cells=>cells.join(';')).join('\r\n'));
}
async function mount(page:Page,{sales=true,completed=true,policy=selection()}:{sales?:boolean;completed?:boolean;policy?:any}={}){
  const type=sales?'SALES':'PURCHASES',name=sales?'sales':'purchases';
  const job={_id:jobId,generationId,clientId,clientCode:company.code,clientName:company.name,type,mode:sales?'SALES':'PURCHASES',status:'COMPLETED',calculationVersion:'NET_V2',operationVersion:'NATURE_OPERATIONS_2026_10_V1',difalVersion:difal.version,anticipationVersion:anticipation.version,issuerUf:'MG',fileName:'930-relatorio.csv',createdAt:'2026-10-23T12:00:00Z',expectedRows:1,uploaded:1};
  const generation={_id:generationId,requiredReports:['PURCHASES','SALES'],companies:[{...company,...(policy===undefined?{}:{difalPolicy:policy}),...(completed?{[sales?'sales':'purchase']:job,[sales?'salesJobId':'purchaseJobId']:jobId}:{})}]};
  const row={...rawLine,natureCode:sales?'6108':'2102',operation:sales?'VENDA':'COMPRAS',reportingStatus:sales?'CPF':'NAO_OPTANTE',difal:{eligible:true,baseCents:15000,amountCents:1500,reason:'ELIGIBLE'},anticipation:{eligible:true,baseCents:15000,amountCents:1098,reason:'ELIGIBLE'}};
  const summary={job,...(policy===undefined?{}:{difalPolicy:policy}),calculationVersion:'NET_V2',difal:sales?difal:undefined,anticipation:sales?undefined:anticipation,totals:{lines:1,totalCents:15000,uniqueDocuments:1,uniqueCnpjs:0,nonCnpjDocumentCount:1,nonCnpjLines:1},reportingGroups:[{status:sales?'CPF':'NAO_OPTANTE',count:1,lines:1,totalCents:15000,countPercent:100,valuePercent:100}]};
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'report-selection',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[company]}}));
  await page.route(`**/api/v4/generations/${generationId}`,r=>r.fulfill({json:generation}));
  await page.route(new RegExp(`/api/v4/${name}(?:[/?]|$)`),r=>{
    const path=new URL(r.request().url()).pathname;
    if(path===`/api/v4/${name}`)return r.fulfill({json:{items:completed?[job]:[],total:completed?1:0}});
    if(path.endsWith('/summary'))return r.fulfill({json:summary});
    if(path.endsWith('/results')||path.endsWith('/lines'))return r.fulfill({json:{items:[row],page:1,total:1,pageSize:100,...(policy===undefined?{}:{difalPolicy:policy})}});
    return r.fulfill({json:job});
  });
  return {summary,generation,job};
}

test('saída desmarcada não aparece como DIFAL ativo na prévia de vendas',async({page},info)=>{
  await mount(page,{completed:false});
  await page.goto(`/purchases.html?generation=${generationId}&client=${clientId}&type=SALES`);
  await page.locator('#purchase-file').setInputFiles({name:'930-vendas.csv',mimeType:'text/csv',buffer:reportCsv()});
  await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
  const panel=page.locator('#purchase-review .purchase-difal');
  await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');
  await expect(panel).toHaveAttribute('data-tax-selection','disabled');
  await expect(panel).toContainText('não incluído');
  await expect(panel.locator('[data-tax-origin]')).not.toHaveAttribute('open','');
  await expect(panel.locator('[data-difal-raw-amount]')).toBeHidden();
  await expect(page.locator('#purchase-review .import-totals')).toContainText('150,00');
  await expect(page.locator('#purchase-review tbody [data-tax-cell-amount]')).toContainText('0,00');
  await panel.screenshot({path:info.outputPath('saida-desmarcada-previa.png')});
  await panel.locator('[data-tax-origin]>summary').click();await expect(panel.locator('[data-difal-raw-amount]')).toContainText('15,00');
});

for(const guided of [false,true])test(`saída desmarcada fica zerada no resumo ${guided?'guiado':'completo e linhas por link direto'}`,async({page},info)=>{
  const {summary}=await mount(page);const before=JSON.stringify(summary);
  await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${jobId}${guided?`&generation=${generationId}&guided=1`:''}`);
  const panel=page.locator('#purchase-report-view .purchase-difal');
  await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');await expect(panel).toHaveAttribute('data-tax-selection','disabled');
  await expect(panel.locator('[data-difal-raw-amount]')).toBeHidden();await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('150,00');
  if(!guided){await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('#purchase-result-list [data-tax-cell-amount]')).toContainText('0,00');await expect(page.locator('#purchase-result-list')).toContainText('Não incluído por escolha');}
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath(`saida-desmarcada-${guided?'guiado':'completo'}-${width}.png`)});}
  await panel.locator('[data-tax-origin]>summary').click();await expect(panel.locator('[data-difal-raw-amount]')).toContainText('15,00');
  expect(JSON.stringify(summary)).toBe(before);
});

for(const sales of [false,true])test(`escolha mista identifica ${sales?'saída no Puro':'entrada no Híbrido'} sem ativar o outro cenário`,async({page})=>{
  const policy=selection(false,true,true,false);await mount(page,{sales,policy});
  await page.goto(`/purchases.html?type=${sales?'SALES':'PURCHASES'}&client=${clientId}&job=${jobId}`);
  const panel=page.locator('#purchase-report-view .purchase-difal');
  await expect(panel).toHaveAttribute('data-tax-selection','enabled');
  await expect(panel.locator('[data-tax-selection-summary]')).toContainText(sales?'Simples puro':'Simples híbrido');
  await expect(panel.locator('[data-tax-selection-summary]')).toContainText(sales?'Simples híbrido: não incluído':'Simples puro: não incluído');
  await expect(panel.locator(sales?'[data-difal-amount]':'[data-anticipation-amount]')).toContainText(sales?'15,00':'10,98');
  await expect(panel).toContainText('estimativa');
  await page.getByLabel('Visualização').selectOption('lines');await expect(page.locator('#purchase-result-list [data-tax-cell-amount]')).toContainText(sales?'15,00':'10,98');
  await expect(page.locator('#purchase-result-list [data-tax-cell-scope]')).toContainText(sales?'Simples puro':'Simples híbrido');
});

test('entrada continua selecionada quando a saída está desmarcada nos dois cenários',async({page})=>{
  await mount(page,{sales:false});await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
  const panel=page.locator('#purchase-report-view .purchase-anticipation');
  await expect(panel).toHaveAttribute('data-tax-selection','enabled');await expect(panel.locator('[data-anticipation-amount]')).toContainText('10,98');
  await expect(panel.locator('[data-tax-selection-summary]')).toContainText('Simples puro');await expect(panel.locator('[data-tax-selection-summary]')).toContainText('Simples híbrido');
});

test('resumo sem política confirmada mantém estimativa identificada sem reutilizar escolha da geração',async({page})=>{
  const {summary}=await mount(page);delete summary.difalPolicy;
  Object.assign(summary.job,{difalPolicy:selection()});
  await page.goto(`/purchases.html?generation=${generationId}&type=SALES&client=${clientId}&job=${jobId}`);
  const panel=page.locator('#purchase-report-view .purchase-difal');
  await expect(panel).toHaveAttribute('data-tax-selection','unconfigured');await expect(panel.locator('[data-difal-amount]')).toContainText('15,00');
  await expect(panel).toContainText('sem escolha de cenário registrada');
});

test('link de outra geração não aplica suas opções a um relatório antigo',async({page})=>{
  const {job}=await mount(page);job.generationId='b3100000-0000-4000-8000-000000000004';
  await page.goto(`/purchases.html?generation=${generationId}&type=SALES&client=${clientId}&job=${jobId}`);
  await expect(page.locator('#purchase-error')).toContainText('Este relatório não pertence à geração selecionada');
  await expect(page.locator('.purchase-difal')).toHaveCount(0);
});

test('geração identifica a saída desmarcada e mantém entrada nos cenários escolhidos',async({page})=>{
  await mount(page);await page.goto(`/generations.html?id=${generationId}`);
  await expect(page.locator('[data-generation-tax-direction="exit"]')).toContainText('não incluir');
  await expect(page.locator('[data-generation-tax-direction="entry"]')).toContainText('Simples puro e Simples híbrido');
});

test('impressão mantém saída zerada e oculta a auditoria sem mudar sua abertura na tela',async({page})=>{
  await mount(page);await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${jobId}`);
  const panel=page.locator('#purchase-report-view .purchase-difal'),audit=panel.locator('[data-tax-origin]'),financial=page.locator('#purchase-report-view .purchase-source-details').first();
  await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');await expect(financial).not.toHaveAttribute('open','');
  for(const opened of [false,true]){
    if(opened)await audit.locator('summary').click();
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
    await expect(financial).toHaveAttribute('open','');expect(await audit.evaluate((element:HTMLDetailsElement)=>element.open)).toBe(opened);
    await page.emulateMedia({media:'print'});
    await expect(panel.locator('[data-difal-amount]')).toBeVisible();await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');
    await expect(audit).toBeHidden();await expect(panel.locator('[data-difal-raw-amount]')).toBeHidden();
    await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    await expect(financial).not.toHaveAttribute('open','');expect(await audit.evaluate((element:HTMLDetailsElement)=>element.open)).toBe(opened);
    if(opened)await expect(panel.locator('[data-difal-raw-amount]')).toContainText('15,00');else await expect(panel.locator('[data-difal-raw-amount]')).toBeHidden();
  }
});

test('trocar empresa na prévia conserva a escolha própria de saída sem misturar políticas',async({page})=>{
  const {generation}=await mount(page,{completed:false}),other={...company,_id:'b3100000-0000-4000-8000-000000000004',clientId:'b3100000-0000-4000-8000-000000000004',code:'931',name:'Outra empresa sintética'};
  generation.companies.push({...other,difalPolicy:selection(true,true,true,false)});
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[company,other]}}));
  for(const [selected,name,amount] of [[clientId,'930-vendas.csv','0,00'],[other.clientId,'931-vendas.csv','15,00'],[clientId,'930-vendas.csv','0,00']]){
    await page.goto(`/purchases.html?generation=${generationId}&client=${selected}&type=SALES`);
    await expect(page.locator('#purchase-company')).toBeDisabled();await expect(page.locator('#purchase-company')).toHaveValue(selected);
    await page.locator('#purchase-file').setInputFiles({name,mimeType:'text/csv',buffer:reportCsv()});await page.getByRole('button',{name:'Conferir colunas e valores'}).click();
    await expect(page.locator('#purchase-review [data-difal-amount]')).toContainText(amount);
  }
});
