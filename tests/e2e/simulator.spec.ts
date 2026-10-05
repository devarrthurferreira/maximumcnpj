import {readStatement,mockStatement} from './extrato-helper.ts';
import {section22} from '../fixtures/section22.ts';
import {test,expect} from '@playwright/test';
import {calculateSimulation,draftToInput,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT,MODEL_VERSION} from '../../public/simulator-engine.js';
const generation='00000000-0000-4000-8000-000000000001',client='00000000-0000-4000-8000-000000000002';
const source={generationId:generation,clientId:client,company:{code:'001',name:'EMPRESA SINTÉTICA'},
  purchases:{jobId:'00000000-0000-4000-8000-000000000003',fileName:'compras.csv',totalCents:450001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  sales:{jobId:'00000000-0000-4000-8000-000000000004',fileName:'vendas.csv',totalCents:1000001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  fields:{salesOptantCents:200001,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100001,purchasesNonOptantCents:350000},warnings:['Não confirmados incluídos em Não optantes.'],periodBasis:'REPORT_TOTALS'};
async function setup(page:any){
  await mockStatement(page);
  await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',(r:any)=>r.fulfill({json:source}));
  await page.route('**/api/v4/simulations',(r:any)=>r.fulfill({status:201,json:snapshot(r.request().postDataJSON())}));
}
const url=`/simulator.html?generation=${generation}&client=${client}`;
function snapshot(body:any){return {_id:body.simulationId,generationId:generation,clientId:client,company:source.company,title:'Simulação de teste',source,rbt12Source:'SIMPLES_SECTION_22',rbt12Extraction:{id:body.rbt12ExtractionId,...section22(Math.round(body.draft.rbt12*100))},draft:body.draft,result:calculateSimulation(body.draft),engineInput:draftToInput(body.draft),taxSources:TAX_SOURCES,monthlyGroups:body.monthlyGroups,monthlyGroupsUnit:'BRL',reportMonths:body.reportMonths,periodConfirmed:true,manuallyAdjusted:false,adjustments:[],createdAt:'2026-09-30T16:00:00Z',createdBy:{id:'operator',name:'Teste'},modelVersion:MODEL_VERSION,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,parentSimulationId:body.parentSimulationId||null};}
async function complete(page:any, values:any={}){await page.locator('#period-confirm').check();await readStatement(page,Math.round((values.rbt12??150000)*100));for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill(String(values[id]??0));}

test('Verified report values populate five categories and require monthly inputs before computing original engine',async({page},info)=>{
  await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1100});await page.goto(url);
  await expect(page.locator('.sim-section').first().getByRole('heading',{level:2})).toHaveText('Extrato e cenário');
  await expect(page.locator('#period-months')).toBeVisible();await expect(page.locator('#period-confirm')).toBeVisible();
  await expect(page.locator('#salesOptantCents')).toHaveValue('2000.01');
  await expect(page.locator('#salesNonOptantCents')).toHaveValue('5000.00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('3000.00');
  await expect(page.locator('#salesRevenue')).toHaveValue('10000.01');
  await expect(page.locator('#purchasesOptantCents')).toHaveValue('1000.01');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('3500.00');
  await expect(page.locator('#serviceRevenue')).toHaveValue('');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#results-top')).toHaveCount(0);
  await page.locator('#period-confirm').check();
  await readStatement(page);
  for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill('0');
  await expect(page.locator('#annual-revenue')).toContainText('120.000,12');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva no histórico');await expect(page.locator('.sim-regime')).toHaveCount(4);await expect(page.locator('.sim-dre')).toContainText('Indicador');
  await expect(page.locator('.sim-dre')).not.toContainText('NaN');
  const cells=await page.locator('.sim-dre tr').filter({hasText:'Receita bruta total'}).locator('td').allTextContents();expect(cells.every(t=>t.includes('120.000,12'))).toBe(true);
  const shot=info.outputPath('simulador-desktop.png');await page.screenshot({path:shot,fullPage:true});await info.attach('Simulador completo',{path:shot,contentType:'image/png'});
  await expect(page.locator('.sim-charts')).toBeHidden();
  await page.locator('.sim-charts-details summary').focus();await page.keyboard.press('Enter');
  const charts=info.outputPath('simulador-graficos-desktop.png');await page.locator('.sim-charts').screenshot({path:charts});await info.attach('Gráficos do simulador',{path:charts,contentType:'image/png'});
  await page.locator('.sim-charts-details summary').focus();await page.keyboard.press('Enter');await expect(page.locator('.sim-charts')).toBeHidden();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar simulação',exact:true}).click();expect((await download).suggestedFilename()).toBe('simulacao-001-2027.json');
  await page.locator('#salesCpfCents').fill('3500');await expect(page.locator('#salesRevenue')).toHaveValue('10500.01');await expect(page.locator('#results-top')).toHaveCount(0);
  await page.reload();await expect(page.locator('#salesCpfCents')).toHaveValue('3500.00');await expect(page.locator('#serviceRevenue')).toHaveValue('0.00');
  await expect(page.locator('#rbt12')).toHaveValue('150000.00');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.locator('.sim-dre tbody th').first().evaluate(el=>getComputedStyle(el).position)).toBe('sticky');
  await page.locator('.sim-table-wrap').evaluate(el=>el.scrollLeft=350);await expect(page.locator('.sim-dre th').first()).toBeVisible();
  const mobile=info.outputPath('simulador-mobile.png');await page.screenshot({path:mobile,fullPage:true});await info.attach('Simulador mobile',{path:mobile,contentType:'image/png'});expect(errors).toEqual([]);
});
test('Multi-month normalization balances cents, restores reports, and isolates drafts by company',async({page})=>{
  await setup(page);await page.goto(url);await page.locator('#period-months').selectOption('3');
  await expect(page.locator('#salesRevenue')).toHaveValue('3333.34');
  const sum=await page.locator('#purchasesOptantCents,#purchasesNonOptantCents').evaluateAll(inputs=>inputs.reduce((total,input)=>total+Math.round(Number((input as HTMLInputElement).value)*100),0));expect(sum).toBe(150000);
  await expect(page.locator('#period-confirm')).not.toBeChecked();await page.locator('#serviceRevenue').fill('100');await page.locator('#salesCpfCents').fill('10');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Restaurar valores dos relatórios'}).click();await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');await expect(page.locator('#serviceRevenue')).toHaveValue('100');
  const other='00000000-0000-4000-8000-000000000009';await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:{...source,clientId:other}}));await page.goto(`/simulator.html?generation=${generation}&client=${other}`);await expect(page.locator('#serviceRevenue')).toHaveValue('');await expect(page.locator('#period-months')).toHaveValue('1');
});
test('Incomplete source or expired session never produces a simulator with fabricated zeroes',async({page})=>{
  await setup(page);await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({status:409,json:{message:'Conclua os relatórios de compras e vendas.'}}));await page.goto(url);await expect(page.locator('#simulator-error')).toContainText('Conclua');await expect(page.locator('#simulator-form')).toHaveCount(0);
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:null}}));await page.goto(url);await expect(page.getByRole('heading',{name:'Entre para continuar'})).toBeVisible();await expect(page.locator('#simulator-form')).toHaveCount(0);
});

test('Dashboard shows five charts, scales every monetary view and expands every notice in one summary',async({page})=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:1000,salaries:15000,rent:700});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  await expect(page.locator('.sim-charts')).toBeHidden();await expect(page.locator('.sim-dre')).toBeVisible();
  await page.locator('.sim-charts-details summary').focus();await page.keyboard.press('Enter');await expect(page.locator('.sim-charts')).toBeVisible();
  await expect(page.locator('.sim-chart-card')).toHaveCount(5);await expect(page.locator('.sim-chart-profit .is-negative')).toHaveCount(4);
  await expect(page.locator('#simulation-notices details')).toHaveCount(1);await expect(page.locator('#simulation-notices details')).not.toHaveAttribute('open','');
  await page.locator('#simulation-notices summary').click();await expect(page.locator('.sim-notices-content')).toContainText('RBT12 informada');await expect(page.locator('.sim-notices-content')).toContainText('Não confirmados incluídos');
  await expect(page.locator('.sim-notices-content article')).toHaveCount(9);
  const annual=await page.locator('.sim-chart-profit .sim-chart-row-head strong').allTextContents();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();await expect(page.locator('.sim-dre .eyebrow')).toContainText('MENSAL');
  await expect(page.getByRole('button',{name:'Mensal',exact:true})).toBeFocused();
  await expect(page.locator('.sim-charts')).toBeVisible();
  await expect(page.locator('.sim-chart-revenue .sim-chart-composition-summary strong')).toContainText('11.000,01');
  await expect(page.locator('.sim-chart-purchases .sim-chart-composition-summary strong')).toContainText('4.500,01');
  await expect(page.locator('.sim-chart-expense-total strong')).toContainText('15.700,00');
  const cells=await page.locator('.sim-dre tr').filter({hasText:'Receita bruta total'}).locator('td').allTextContents();expect(cells).toHaveLength(13);expect(cells.slice(0,12).every(t=>t.includes('11.000,01'))).toBe(true);expect(cells[12]).toContain('132.000,12');await expect(page.locator('.sim-calendar thead th')).toHaveCount(14);
  const parse=(v:string)=>Number(v.replace(/[^0-9,-]/g,'').replace(',','.'));
  const monthly=await page.locator('.sim-chart-profit .sim-chart-row-head strong').allTextContents();monthly.forEach((v,i)=>expect(parse(v)).toBeCloseTo(parse(annual[i])/12,2));
  expect(await page.locator('#simulation-result').innerText()).not.toMatch(/NaN|Infinity/);
});
test('Saved detail only reads captured snapshot and opens an independent editable version',async({page},info)=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:2700,salaries:500});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/v4/simulations')&&r.method()==='POST');await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();const body=(await request).postDataJSON();const saved=snapshot(body);
  await expect(page.locator('#saved-simulation-link')).toBeVisible();
  // A previously captured result must not be recalculated with the current browser engine.
  saved.result.regimes[0].annualProfit=123456.78;saved.result.regimes[0].monthlyProfit=10288.065;saved.result.regimes[0].dre.netProfit=123456.78;
  await page.route('**/api/v4/simulations/'+saved._id,r=>r.fulfill({json:saved}));
  let sourceReads=0;await page.route('**/api/v4/generations/*/simulator?*',r=>{sourceReads++;return r.fulfill({status:500,json:{message:'Must not read current source'}});});
  await page.goto('/simulator.html?simulation='+saved._id);await expect(page.locator('#simulation-snapshot')).toContainText('2.700,00');await expect(page.locator('#simulator-form')).toHaveCount(0);expect(sourceReads).toBe(0);
  await expect(page.locator('#simulation-snapshot .sim-detail-grid')).toBeHidden();await expect(page.locator('#create-version')).toBeVisible();
  await page.locator('.sim-captured-details summary').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('#simulation-snapshot .sim-detail-grid')).toBeVisible();
  await expect(page.locator('.sim-regime').first()).toContainText('123.456,78');await expect(page.locator('#simulation-snapshot .sim-detail-grid strong')).toHaveCount(13);
  await page.locator('.sim-captured-details summary').first().focus();await page.keyboard.press('Enter');
  await page.evaluate(()=>{
    (window as any).__printEvidence=[];
    window.addEventListener('beforeprint',()=>{(window as any).__printEvidence.push({
      charts:document.querySelector('.sim-charts')!.getBoundingClientRect().height>0,
      captured:document.querySelector('#simulation-snapshot .sim-detail-grid')!.getBoundingClientRect().height>0,
      values:document.querySelector('#simulation-snapshot .sim-detail-grid')!.textContent?.includes('2.700,00')});});
  });
  const printed=info.outputPath('simulacao-sintetica-impressao.pdf');
  await page.pdf({path:printed,format:'A4',printBackground:true});
  await info.attach('Impressão da versão salva',{path:printed,contentType:'application/pdf'});
  expect(await page.evaluate(()=>(window as any).__printEvidence)).toEqual([{charts:true,captured:true,values:true}]);
  await expect(page.locator('.sim-charts')).toBeHidden();await expect(page.locator('#simulation-snapshot .sim-detail-grid')).toBeHidden();
  const downloadEvent=page.waitForEvent('download');await page.locator('#export-simulation').click();const download=await downloadEvent;const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk;const exported=JSON.parse(text);expect(exported._id).toBe(saved._id);expect(exported.draft).toEqual(saved.draft);expect(exported.result).toEqual(saved.result);expect(exported.source).toEqual(source);
  await page.locator('#create-version').click();await expect(page.locator('#serviceRevenue')).toHaveValue('2700.00');await expect(page.locator('#period-confirm')).not.toBeChecked();await page.locator('#period-confirm').check();await page.locator('#serviceRevenue').fill('3000');
  const copyRequest=page.waitForRequest(r=>r.url().endsWith('/api/v4/simulations')&&r.method()==='POST');await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();const copy=(await copyRequest).postDataJSON();expect(copy.simulationId).not.toBe(saved._id);expect(copy.parentSimulationId).toBe(saved._id);expect(copy.draft.values.serviceRevenue).toBe(3000);expect(sourceReads).toBe(0);
});
test('Save is single-flight and failed retries preserve the exact immutable request',async({page})=>{
  await setup(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);const requests:any[]=[];
  await page.route('**/api/v4/simulations',async r=>{const body=r.request().postDataJSON();requests.push(body);if(requests.length===1){await gate;await r.fulfill({status:503,json:{message:'Falha temporária no salvamento.'}});}else await r.fulfill({status:201,json:snapshot(body)});});
  await page.goto(url);await complete(page);await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#serviceRevenue')).toBeDisabled();await expect(page.locator('#generate-simulation')).toBeDisabled();await expect(page.locator('#simulation-save-status')).toContainText('Salvando');expect(requests).toHaveLength(1);release();
  await expect(page.locator('#retry-save')).toBeVisible();await expect(page.locator('#simulation-save-status')).not.toContainText('Simulação salva');await expect(page.locator('#serviceRevenue')).toBeEnabled();
  await page.locator('#retry-save').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  await page.locator('#serviceRevenue').fill('100');await expect(page.locator('#simulation-result')).toBeEmpty();await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');expect(requests[2].simulationId).not.toBe(requests[0].simulationId);
});
test('Unavailable regimes and zero revenue never become misleading zero-valued comparisons',async({page})=>{
  await setup(page);await page.goto(url);await complete(page,{serviceRevenue:500000});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');await expect(page.locator('.sim-chart-profit .sim-chart-unavailable')).toHaveCount(2);await expect(page.locator('.sim-regime').first()).toContainText('Indisponível');
  for(const id of ['salesOptantCents','salesNonOptantCents','salesCpfCents','serviceRevenue','purchasesOptantCents','purchasesNonOptantCents'])await page.locator('#'+id).fill('0');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');await expect(page.locator('.sim-kpis')).toContainText('Sem ranking');await expect(page.locator('.sim-chart-burden')).toContainText('Não aplicável');await expect(page.locator('#simulation-result')).not.toContainText('NaN');
});

test('RBT12 vem somente da seção 2.2 e falha em PDF novo apaga a leitura anterior',async({page})=>{
 await setup(page);await page.goto(url);await complete(page);
 await expect(page.locator('#rbt12')).toHaveAttribute('readonly','');
 await page.locator('#rbt12-details summary').click();await expect(page.locator('#rbt12-details tbody tr')).toHaveCount(12);
 await expect(page.locator('#rbt12-details')).toContainText('08/2025');await expect(page.locator('#rbt12-details')).toContainText('07/2026');
 await page.route('**/api/simples?*',r=>r.fulfill({status:422,json:{message:'Seção 2.2 incompleta: competência ilegível.'}}));
 await page.locator('#rbt12-pdf').setInputFiles({name:'ilegivel.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-unreadable')});
 await expect(page.locator('#rbt12')).toHaveValue('');await page.locator('#rbt12-read').click();
 await expect(page.locator('#rbt12-status')).toContainText('ilegível');
 await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('#rbt12-details')).toBeEmpty();
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulator-error')).toContainText('seção 2.2');
 await expect(page.locator('#results-top')).toHaveCount(0);
});
test('Conferência do PDF abre pelo teclado e mantém avisos visíveis no celular',async({page})=>{
 await setup(page);
 const warning='Confira os valores da seção 2.2 com a imagem original.';
 await page.route('**/api/simples?*',r=>r.fulfill({json:{...section22(15000000),
   extractionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   searchableStored:true,warnings:[warning]}}));
 await page.goto(url);
 for(const id of ['rbt12-pdf','serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await expect(page.locator('#'+id)).toBeVisible();
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});
 await page.locator('#rbt12-read').click();await expect(page.locator('#rbt12')).toHaveValue('150000.00');
 await expect(page.getByText(warning,{exact:true})).toBeVisible();await expect(page.locator('#rbt12-details table')).toBeHidden();
 await page.locator('#rbt12-details summary').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#rbt12-details tbody tr')).toHaveCount(12);await expect(page.locator('#rbt12-details table')).toBeVisible();
 for(const width of [390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
 await page.locator('#rbt12-details summary').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#rbt12-details table')).toBeHidden();await expect(page.getByText(warning,{exact:true})).toBeVisible();
 await expect(page.locator('#rbt12-view-original')).toBeVisible();await expect(page.locator('#rbt12')).toHaveAttribute('readonly','');
});
test('Falha no upload não informa original armazenado nem oferece reprocessamento',async({page})=>{
 await setup(page);let uploads=0,reads=0;
 await page.route('https://vercel.com/api/blob/**',r=>{uploads++;return r.fulfill({status:403,body:'Upload recusado'});});
 await page.route('**/api/simples?*',r=>{reads++;return r.fulfill({status:500,json:{message:'Não deveria executar OCR'}});});
 await page.goto(url);
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});
 await page.locator('#rbt12-read').click();
 await expect(page.locator('#rbt12-status')).toContainText('Não foi possível armazenar');
 await expect(page.locator('#rbt12-status')).not.toContainText('ficou armazenado');
 await expect(page.locator('#rbt12-reprocess')).toBeHidden();
 await expect(page.locator('#rbt12-view-original')).toBeHidden();
 await expect(page.locator('#rbt12')).toHaveValue('');
 await expect(page.locator('#rbt12-pdf')).toBeEnabled();
 expect(uploads).toBe(1);expect(reads).toBe(0);
});
test('OCR indisponível preserva original e reprocessa sem novo upload no endpoint real do Blob',async({page})=>{
 await setup(page);let uploads=0,reads=0;
 await page.route('https://vercel.com/api/blob/**',r=>{uploads++;return r.fulfill({status:200,body:''});});
 await page.route('**/api/simples?*',r=>{reads++;return r.fulfill({status:504,contentType:'text/html',body:'<html>Gateway timeout</html>'});});
 await page.goto(url);
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});
 await page.locator('#rbt12-read').click();
 await expect(page.locator('#rbt12-status')).toContainText('O servidor não conseguiu concluir');
 await expect(page.locator('#rbt12-status')).toContainText('ficou armazenado');
 await expect(page.locator('#rbt12-view-original')).toBeVisible();
 await expect(page.locator('#rbt12-reprocess')).toBeVisible();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/simples?*',async r=>{reads++;await gate;return r.fulfill({json:{extractionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',searchableStored:true,...section22(15000000)}});});
 await page.locator('#rbt12-reprocess').click();
 await expect(page.locator('#rbt12-pdf')).toBeDisabled();
 await expect(page.locator('#rbt12-read')).toBeDisabled();
 await expect(page.locator('#generate-simulation')).toBeDisabled();
 release();
 await expect(page.locator('#rbt12')).toHaveValue('150000.00');
 await expect(page.locator('#rbt12-view-searchable')).toBeVisible();
 await expect(page.locator('#rbt12-pdf')).toBeEnabled();
 expect(uploads).toBe(1);expect(reads).toBe(2);
});
test('Leitura da seção 2.2 aguarda além de 55 segundos e informa as páginas preservadas',async({page})=>{
 await setup(page);await page.clock.install();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/simples?*',async r=>{await gate;return r.fulfill({json:{...section22(15000000),
   extractionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   searchableStored:true,extractionScope:'SECTION_22',searchablePdfScope:'SELECTED_PAGES',pageCount:8,processedPages:2,
   processedPageNumbers:[1,2],preservedPages:[3,4,5,6,7,8],ocrPages:[1,2],searchablePdfBase64:Buffer.from('%PDF-synthetic').toString('base64')}});});
 await page.goto(url);
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});
 const processing=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/simples'&&r.method()==='POST');
 await page.locator('#rbt12-read').click();await processing;
 try {
   await page.clock.fastForward(60000);
   await expect(page.locator('#rbt12-pdf')).toBeDisabled();
   await expect(page.locator('#rbt12-status')).not.toContainText('demorou');
 } finally {release();}
 await expect(page.locator('#rbt12')).toHaveValue('150000.00');
 await expect(page.locator('#rbt12-status')).toContainText('Seção 2.2 conferida');
 await expect(page.locator('#rbt12-details table')).toBeHidden();
 await page.locator('#rbt12-details summary').click();
 await expect(page.locator('#rbt12-details')).toContainText('2 de 8 páginas analisadas (páginas 1, 2)');
 await expect(page.locator('#rbt12-details')).toContainText('demais foram preservadas sem OCR adicional');
 await expect(page.locator('#rbt12-view-searchable')).toHaveText('Ver PDF com seção 2.2 pesquisável');
 await expect(page.locator('#rbt12-download')).toHaveText('Baixar PDF com seção 2.2 pesquisável');
 await readStatement(page);
 await expect(page.locator('#rbt12-status')).toContainText('Seção 2.2 conferida');
 await page.locator('#rbt12-details summary').click();
 await expect(page.locator('#rbt12-details')).toContainText('3 página(s) processada(s)');
 await expect(page.locator('#rbt12-view-searchable')).toHaveText('Ver PDF pesquisável');
});
test('DRE mensal mostra 12 meses, muda regime e conserva a RBT12 do extrato',async({page},info)=>{
 await setup(page);await page.setViewportSize({width:1440,height:1100});await page.goto(url);await complete(page,{serviceRevenue:1000,salaries:3000,rent:700});
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
 await page.getByRole('button',{name:'Mensal',exact:true}).click();
 await expect(page.locator('.sim-calendar thead th')).toHaveCount(14);
 await expect(page.locator('.sim-calendar thead')).toContainText('Janeiro');await expect(page.locator('.sim-calendar thead')).toContainText('Dezembro');
 await expect(page.locator('.sim-extrato-reference')).toContainText('150.000,00');await expect(page.locator('.sim-extrato-reference')).toContainText('08/2026');
 const options=await page.locator('#dre-regime option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
 const parse=(text:string)=>Number(text.replace(/[^0-9,-]/g,'').replace(',','.'));
 for(const id of options){await page.locator('#dre-regime').selectOption(id);
  const values=await page.locator('[data-dre-row="revenue"] td').allTextContents();expect(values).toHaveLength(13);
  expect(parse(values[12])).toBeCloseTo(parse(values[0])*12,2);expect(new Set(values.slice(0,12)).size).toBe(1);
 }
 const desktop=info.outputPath('dre-janeiro-dezembro-desktop.png');await page.locator('.sim-calendar').screenshot({path:desktop});await info.attach('DRE mensal desktop',{path:desktop,contentType:'image/png'});
 await page.setViewportSize({width:390,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('.sim-calendar .sim-table-wrap').evaluate(el=>el.scrollLeft=el.scrollWidth);
 const heading=page.locator('.sim-calendar thead th').first();expect(await heading.evaluate(el=>getComputedStyle(el).position)).toBe('sticky');
 const mobile=info.outputPath('dre-janeiro-dezembro-mobile.png');await page.locator('.sim-calendar').screenshot({path:mobile});await info.attach('DRE mensal mobile',{path:mobile,contentType:'image/png'});
 await page.getByRole('button',{name:'Anual',exact:true}).click();await expect(page.locator('.sim-dre thead th')).toHaveCount(5);
});
