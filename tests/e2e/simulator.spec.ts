import {test,expect} from '@playwright/test';
const generation='00000000-0000-4000-8000-000000000001',client='00000000-0000-4000-8000-000000000002';
const source={generationId:generation,clientId:client,company:{code:'001',name:'EMPRESA SINTÉTICA'},
  purchases:{jobId:'00000000-0000-4000-8000-000000000003',fileName:'compras.csv',totalCents:450001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  sales:{jobId:'00000000-0000-4000-8000-000000000004',fileName:'vendas.csv',totalCents:1000001,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-09-30T15:00:00Z'},
  fields:{salesOptantCents:200001,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100001,purchasesNonOptantCents:350000},warnings:['Não confirmados incluídos em Não optantes.'],periodBasis:'REPORT_TOTALS'};
async function setup(page:any){
  await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',(r:any)=>r.fulfill({json:source}));
}
const url=`/simulator.html?generation=${generation}&client=${client}`;
test('Verified report values populate five categories and require monthly inputs before computing original engine',async({page},info)=>{
  await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await expect(page.locator('#salesOptantCents')).toHaveValue('2000.01');
  await expect(page.locator('#salesNonOptantCents')).toHaveValue('5000.00');
  await expect(page.locator('#salesCpfCents')).toHaveValue('3000.00');
  await expect(page.locator('#salesRevenue')).toHaveValue('10000.01');
  await expect(page.locator('#purchasesOptantCents')).toHaveValue('1000.01');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('3500.00');
  await expect(page.locator('#serviceRevenue')).toHaveValue('');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();await expect(page.locator('#results-top')).toHaveCount(0);
  await page.locator('#period-confirm').check();
  for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill('0');
  await expect(page.locator('#annual-revenue')).toContainText('120.000,12');
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  await expect(page.locator('.sim-regime')).toHaveCount(4);await expect(page.locator('.sim-dre')).toContainText('Indicador');
  await expect(page.locator('.sim-dre')).not.toContainText('NaN');
  const cells=await page.locator('.sim-dre tr').filter({hasText:'Receita bruta total'}).locator('td').allTextContents();expect(cells.every(t=>t.includes('120.000,12'))).toBe(true);
  const shot=info.outputPath('simulador-desktop.png');await page.screenshot({path:shot,fullPage:true});await info.attach('Simulador completo',{path:shot,contentType:'image/png'});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar memória da simulação'}).click();expect((await download).suggestedFilename()).toBe('simulacao-001-2027.json');
  await page.locator('#salesCpfCents').fill('3500');await expect(page.locator('#salesRevenue')).toHaveValue('10500.01');await expect(page.locator('#results-top')).toHaveCount(0);
  await page.reload();await expect(page.locator('#salesCpfCents')).toHaveValue('3500.00');await expect(page.locator('#serviceRevenue')).toHaveValue('0.00');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
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
