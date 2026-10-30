import {test,expect} from '@playwright/test';
import {baselineMonth,monthlyProjection,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {buildAnalysisPeriod,JAN_SEP_POLICY} from '../../public/analysis-period.js';

test('competência incompleta leva ao campo correto e alterações exigem nova simulação',async({page},info)=>{
 let posts=0;
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'tester',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/generations/*/simulator?*',r=>{expect(new URL(r.request().url()).searchParams.get('periodPolicy')).toBe(JAN_SEP_POLICY);return r.fulfill({json:fixedSource});});
 await page.route('**/api/v4/simulations',route=>{
  posts++;const body=route.request().postDataJSON();expect(body.periodPolicy).toBe(JAN_SEP_POLICY);
  const computed=calculateMonthlySimulation(body.draft,fixedReports,body.monthlyInputs,salesId,null,analysisPeriod);
  return route.fulfill({json:{...body,_id:body.simulationId,...computed,analysisPeriod,source:fixedSource,company:source.company,createdAt:'2026-10-22T12:00:00Z',createdBy:{id:'tester',name:'Teste'},rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:50000000},monthlyDre:buildMonthlyDre(computed.result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:50000000},fixedSource.period)}});
 });
 await page.goto(`/simulator.html?generation=${generation}&client=${client}`);
 await page.locator('#rent').fill('');
 await page.locator('#report-competence').selectOption('1');
 await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('500000');await page.locator('#rbt12-manual-confirm').check();
 await page.locator('#generate-simulation').click();
 await expect(page.locator('#report-competence')).toHaveValue('0');
 await expect(page.locator('#simulator-error')).toContainText('Janeiro / 2025');
 await expect(page.locator('#rent')).toBeFocused();expect(posts).toBe(0);
 await page.locator('#rent').fill('100');await page.locator('#generate-simulation').click();
 await expect(page.locator('#simulation-save-status')).toContainText('salva');expect(posts).toBe(1);
 await expect(page.locator('[data-dre-regime-result]')).toHaveCount(4);
 await expect(page.locator('[data-simulation-detail="dre"]')).toHaveCount(0);
 await expect(page.locator('#dre-demonstrativo [data-dre-row="salaries"]')).toBeVisible();
 for(const key of ['services','das','cmvSimple','salaries','benefits','payroll','administrative','rent','cards','irpj','csll','netProfit']){
  await expect(page.locator(`#dre-demonstrativo [data-dre-row="${key}"]`)).toBeVisible();
 }
 await expect(page.locator('#dre-demonstrativo h2')).toHaveText('DRE completa');
 await expect(page.locator('#dre-demonstrativo [data-revenue-reconciliation="dre"]')).toBeVisible();
 await expect(page.locator('#dre-demonstrativo [data-icms-reconciliation="dre"]')).toBeVisible();
 const originalViewport=page.viewportSize()||await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   await page.locator('#dre-demonstrativo').screenshot({path:info.outputPath(`dre-completa-4-regimes-${width}.png`)});
  }
 }finally{await page.setViewportSize(originalViewport);}
 await page.locator('#rent').fill('200');
 await expect(page.locator('#simulation-changes-notice')).toContainText('Valores alterados');
 await expect(page.locator('#results-top')).toHaveCount(0);expect(posts).toBe(1);
 await page.locator('#report-competence').selectOption('1');
 await expect(page.locator('#simulation-changes-notice')).toBeVisible();
 await page.locator('#regenerate-simulation').click();
 await expect(page.locator('#simulation-save-status')).toContainText('salva');
 await expect(page.locator('#simulation-changes-notice')).toHaveCount(0);expect(posts).toBe(2);
});
const generation='a1000000-0000-4000-8000-000000000001',client='a1000000-0000-4000-8000-000000000002',salesId='a1000000-0000-4000-8000-000000000003';
const reports=Array.from({length:12},(_,i)=>({sourceMonth:`2025-${String(i+1).padStart(2,'0')}`,month:i+1,salesLines:1,purchaseLines:1,
 fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:100000+i*10000,purchasesOptantCents:0,purchasesNonOptantCents:20000+i*1000,serviceRevenueCents:5000+i*100},
 difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',baseCents:100000+i*10000,amountCents:10000+i*1000,eligibleLines:1,pendingLines:0}}));
const projection=monthlyProjection(reports),fields=projection.annualGroupsCents;
const source:any={generationId:generation,clientId:client,company:{code:'TESTE',name:'Empresa sintética mensal'},periodBasis:'COLUMN_H',reportMonths:12,
 period:{startMonth:'2025-01',endMonth:'2025-12',months:12},monthlyReports:reports,projection,fields,revenueSplit:{version:'SALES_SERVICES_V1'},warnings:[],
 purchases:{jobId:'a1000000-0000-4000-8000-000000000004',fileName:'compras.csv',totalCents:projection.totals.purchases.totalCents,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2'},
 sales:{jobId:salesId,fileName:'saidas.csv',totalCents:projection.totals.sales.totalCents,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',difal:{...reports[0].difal,amountCents:186000,baseCents:1860000,eligibleLines:12}}};
const analysisPeriod=buildAnalysisPeriod(source.period,source.period),fixedReports=reports.slice(0,9),fixedProjection=monthlyProjection(fixedReports);
const fixedSource={...source,analysisPeriod,periodPolicy:JAN_SEP_POLICY,reportMonths:9,period:{startMonth:'2025-01',endMonth:'2025-09',months:9},
 monthlyReports:fixedReports,projection:{...fixedProjection,analysisPeriod},fields:fixedProjection.annualGroupsCents,
 purchases:{...source.purchases,selectedTotalCents:fixedProjection.totals.purchases.totalCents},
 sales:{...source.sales,selectedTotalCents:fixedProjection.totals.sales.totalCents,difal:{...source.sales.difal,amountCents:126000,baseCents:1260000,eligibleLines:9}}};
test('DRE alterna mês e anual somando somente as competências importadas',async({page},info)=>{
 const imported=reports.slice(0,3),period={startMonth:'2025-01',endMonth:'2025-03',months:3},projection=monthlyProjection(imported);
 const monthlyInputs=imported.map(row=>baselineMonth(row));
 const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:500000,values:{serviceRevenue:50,salesRevenue:1000,simplePurchases:0,regularPurchases:200,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
 const computed=calculateMonthlySimulation(draft,imported,monthlyInputs,salesId),reference={source:'MANUAL',confirmed:true,rbt12Cents:50000000};
 const saved={_id:'a1000000-0000-4000-8000-000000000005',generationId:generation,clientId:client,draft,monthlyInputs,monthlyGroups:monthlyInputs[0].groups,...computed,
  source:{...source,reportMonths:3,period,monthlyReports:imported,projection,fields:projection.annualGroupsCents,
   purchases:{...source.purchases,totalCents:projection.totals.purchases.totalCents},sales:{...source.sales,totalCents:projection.totals.sales.totalCents,difal:{...source.sales.difal,amountCents:33000,baseCents:330000,eligibleLines:3}}},
  company:source.company,reportMonths:3,periodBasis:'COLUMN_H',periodConfirmed:true,manuallyAdjusted:false,createdAt:'2026-10-20T12:00:00Z',createdBy:{id:'tester',name:'Teste'},modelVersion:computed.result.version,
  rbt12Source:'MANUAL',rbt12Manual:reference,monthlyDre:buildMonthlyDre(computed.result,2027,reference,period)};
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'tester',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/simulations/'+saved._id,r=>r.fulfill({json:saved}));
 await page.goto('/simulator.html?simulation='+saved._id);
 const monthly=page.locator('#dre-demonstrativo [data-period="monthly"]'),annual=page.locator('#dre-demonstrativo [data-period="annual"]');
 await expect(annual).toHaveAttribute('aria-pressed','true');await expect(monthly).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#dre-month')).toHaveCount(0);await expect(page.locator('[data-dre-summary="revenue"]')).toContainText('3.453,00');
 await expect(page.locator('#dre-report-period')).toHaveValue('complete');await monthly.click();
 await expect(monthly).toHaveAttribute('aria-pressed','true');await expect(annual).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#dre-month')).toHaveCount(1);await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(3);
 await expect(page.locator('[data-dre-summary="revenue"]')).toContainText('1.050,00');
 await page.locator('#dre-month').selectOption('2');await expect(page.locator('#dre-month')).toBeFocused();
 await expect(page.locator('[data-dre-summary="revenue"]')).toContainText('1.252,00');await expect(page.locator('#dre-period-note')).toContainText('Origem: Março / 2025');
 await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('120,00');
 await page.locator('#dre-regime').selectOption('actual');await page.locator('#dre-show-percent').check();
 await annual.focus();await page.keyboard.press('Enter');await expect(annual).toBeFocused();
 await expect(annual).toHaveAttribute('aria-pressed','true');await expect(monthly).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#dre-demonstrativo h2')).toHaveText('DRE anual');await expect(page.locator('#dre-month')).toHaveCount(0);
 await expect(page.locator('#dre-period-note')).toContainText('soma das competências importadas');
 await expect(page.locator('[data-dre-summary="revenue"]')).toContainText('3.453,00');
 await expect(page.locator('[data-dre-row="difal"] td').first()).toContainText('330,00');
 await expect(page.locator('[data-dre-row="cmvRegular"] td').first()).toContainText('630,00');
 await expect(page.locator('.sim-kpis article').first()).toContainText('3.453,00');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.dre-heading').evaluate(el=>el.scrollIntoView({block:'start'}));await expect(annual).toBeInViewport();
  if(width!==320)await page.screenshot({path:info.outputPath(`dre-anual-${width}.png`)});
 }
 await monthly.click();await expect(monthly).toBeFocused();await expect(page.locator('#dre-month')).toHaveValue('2');
 await expect(page.locator('#dre-regime')).toHaveValue('actual');await expect(page.locator('#dre-show-percent')).toBeChecked();
 await expect(page.locator('[data-dre-summary="revenue"]')).toContainText('1.252,00');
 await page.locator('#dre-month').selectOption('11');await expect(page.locator('#dre-month option:checked')).toContainText('sem dados');
 await expect(page.locator('#dre-period-note')).toContainText('Sem dados importados');await expect(page.locator('[data-dre-summary="revenue"]')).toHaveText('—');
 await expect(page.locator('[data-dre-row="revenue"] td').first()).toHaveText('——');await expect(page.locator('[data-dre-row="revenue"] td').last()).toContainText('3.453,00');
 await annual.click();await monthly.click();await expect(page.locator('#dre-month')).toHaveValue('11');
 await page.locator('#dre-month').selectOption('0');await page.getByRole('button',{name:'12 meses',exact:true}).click();
 await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(14);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('compras, vendas e DIFAL por mês: edição isolada, rascunho, DRE, CSV, JSON e histórico',async({page},info)=>{
 let saved:any,posts=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'tester',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:fixedSource}));
 await page.route('**/api/v4/simulations',async route=>{
  const request=route.request().postDataJSON();posts++;const computed=calculateMonthlySimulation(request.draft,fixedReports,request.monthlyInputs,salesId,null,analysisPeriod);
  saved={_id:request.simulationId,...request,...computed,analysisPeriod,source:fixedSource,company:source.company,createdAt:new Date().toISOString(),createdBy:{id:'tester',name:'Teste'},modelVersion:computed.result.version,
   manuallyAdjusted:computed.adjustments.length>0,rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:50000000},monthlyDre:buildMonthlyDre(computed.result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:50000000},fixedSource.period)};
  await route.fulfill({json:saved});
 });
 await page.route('**/api/v4/simulations/*',r=>r.fulfill({json:saved}));
 await page.goto(`/simulator.html?generation=${generation}&client=${client}`);
 await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');await expect(page.locator('[data-difal-monthly]')).toContainText('100,00');
 await expect(page.locator('#simulator-projection')).not.toContainText('Média');
 await expect(page.locator('#report-competence option:checked')).toHaveText('Janeiro / 2025');
 await expect(page.locator('#report-prev')).toBeDisabled();await page.locator('#report-next').click();
 await expect(page.locator('#report-competence')).toHaveValue('1');await expect(page.locator('#salesCpfCents')).toHaveValue('1100.00');
 await page.locator('#report-prev').click();await expect(page.locator('#report-competence')).toHaveValue('0');
 await expect(page.locator('#report-competence')).toBeFocused();
 await expect(page.locator('#month-summary-revenue')).toContainText('1.050,00');
 const difalAudit=page.locator('#simulator-difal [data-difal-audit]'),difalMonths=page.locator('#simulator-difal [data-difal-source-disclosure]');
 await expect(difalAudit).not.toHaveAttribute('open','');await expect(difalMonths).not.toHaveAttribute('open','');
 await difalAudit.locator(':scope > summary').click();await difalMonths.locator(':scope > summary').click();
 await page.locator('#salesCpfCents').fill('');await expect(page.locator('#month-summary-revenue')).toHaveText('—');
 await expect(page.locator('#annual-revenue')).toHaveText('Confira as receitas de todos os meses');
 await page.locator('#salesCpfCents').fill('1250');
 await expect(difalAudit).toHaveAttribute('open','');await expect(difalMonths).toHaveAttribute('open','');
 await expect(page.locator('#month-summary-revenue')).toContainText('1.300,00');
 await expect(page.locator('#month-adjustment-state')).toHaveText('Receitas ou compras ajustadas');
 await page.locator('#rent').fill('15');await page.locator('#restore-month').click();
 await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');await expect(page.locator('#rent')).toHaveValue('15.00');
 await expect(page.locator('#restore-month')).toBeDisabled();
 await difalMonths.locator(':scope > summary').click();await expect(difalMonths).not.toHaveAttribute('open','');await expect(difalAudit).toHaveAttribute('open','');
 await difalAudit.locator(':scope > summary').click();
 await page.locator('#rent').fill('15');await page.locator('#report-competence').selectOption('8');
 await expect(difalAudit).not.toHaveAttribute('open','');await expect(difalMonths).not.toHaveAttribute('open','');
 await expect(page.locator('#salesCpfCents')).toHaveValue('1800.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('280.00');await expect(page.locator('#rent')).toHaveValue('0.00');
 await expect(page.locator('[data-difal-monthly]')).toContainText('180,00');await expect(page.locator('[data-difal-annual]')).toContainText('1.260,00');
 await expect(page.locator('#report-next')).toBeDisabled();
 await page.locator('#salesCpfCents').fill('1850');await page.locator('#rent').fill('30');
 await page.locator('#report-competence').selectOption('0');await page.locator('#salesCpfCents').fill('1500');await page.locator('#restore-month').click();
 await page.locator('#report-competence').selectOption('8');await expect(page.locator('#salesCpfCents')).toHaveValue('1850.00');await expect(page.locator('#rent')).toHaveValue('30.00');
 await page.locator('#restore-month').click();await expect(page.locator('#rent')).toHaveValue('30.00');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#sim-section-purchases').scrollIntoViewIfNeeded();
  const nav=await page.locator('.sim-month-nav').boundingBox();expect(nav!.y).toBeGreaterThanOrEqual(width<=1000?60:16);expect(nav!.height).toBeLessThan(135);
  await expect(page.locator('#report-competence')).toBeInViewport();
  if(width===390)await page.screenshot({path:info.outputPath('compras-mobile.png')});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.sim-month-nav').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('competencias-desktop.png')});
 await page.reload();await expect(page.locator('#report-competence')).toHaveValue('8');await expect(page.locator('#rent')).toHaveValue('30.00');
 await page.locator('#report-competence').selectOption('0');await expect(page.locator('#rent')).toHaveValue('15.00');
 await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('500000');await page.locator('#rbt12-manual-confirm').check();
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
 await expect(page.locator('#dre-demonstrativo [data-period="annual"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#dre-report-period')).toHaveValue('complete');
 await expect(page.locator('[data-dre-row="revenue"]')).toContainText('13.086,00');await page.getByRole('button',{name:'Mensal',exact:true}).click();
 await page.locator('#report-competence').selectOption('8');await expect(page.locator('#simulation-save-status')).toContainText('salva');
 await expect(page.locator('#dre-month')).toHaveValue('8');
 await expect(page.locator('[data-dre-row="revenue"]')).toContainText('1.858,00');
 await page.locator('#dre-month').selectOption('0');await expect(page.locator('[data-dre-row="revenue"]')).toContainText('1.050,00');
 expect(posts).toBe(1);expect(saved.result.annualRevenue).toBe(13086);expect(saved.difalProjection.annualCents).toBe(126000);
 await expect(page.locator('#dre-month option')).toHaveCount(9);
 await expect(page.locator('[data-dre-row="revenue"]')).toContainText('1.050,00');
 await expect(page.locator('[data-simulation-detail="dre"]')).toHaveCount(0);
 await expect(page.locator('#dre-demonstrativo [data-dre-row="netProfit"]')).toBeVisible();
 await expect(page.locator('#dre-demonstrativo [data-dre-row="netProfit"]')).toBeVisible();
 await expect(page.locator('#dre-demonstrativo [data-dre-row="salaries"]')).toBeVisible();
 await page.locator('#dre-demonstrativo').evaluate(el=>el.scrollIntoView({block:'start'}));
 await page.screenshot({path:info.outputPath('dre-visual-desktop.png')});
 await page.getByRole('button',{name:'9 meses',exact:true}).click();
 const sales=page.locator('.dre-calendar-screen tr[data-dre-row="sales"]');
 await expect(sales).toContainText('1.000,00');await expect(sales).toContainText('1.800,00');
 await page.locator('#dre-report-period').selectOption('monthly');
 const csvPromise=page.waitForEvent('download');await page.locator('#export-dre-csv').click();const download=await csvPromise;
 const stream=await download.createReadStream();const parts:Buffer[]=[];for await(const part of stream!)parts.push(Buffer.from(part));const csv=Buffer.concat(parts).toString();
 expect(csv).toContain('1000,00');expect(csv).toContain('1800,00');expect(csv).toContain('Valores por competência');
 const jsonPromise=page.waitForEvent('download');await page.locator('#export-simulation').click();const jsonDownload=await jsonPromise;
 const jsonStream=await jsonDownload.createReadStream();const chunks:Buffer[]=[];for await(const part of jsonStream!)chunks.push(Buffer.from(part));const exported=JSON.parse(Buffer.concat(chunks).toString());
 expect(exported.monthlyInputs).toEqual(saved.monthlyInputs);expect(exported.monthlyDre).toEqual(saved.monthlyDre);
 await page.goto(`/simulator.html?simulation=${saved._id}`);await expect(page.locator('#simulation-snapshot')).toBeVisible();expect(posts).toBe(1);
 await expect(page.locator('#dre-demonstrativo [data-period="annual"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#dre-report-period')).toHaveValue('complete');
 await page.locator('[data-period="monthly"]').click();await expect(page.locator('#dre-month option')).toHaveCount(9);
 await expect(page.locator('#dre-demonstrativo [data-dre-row="netProfit"]')).toBeVisible();
 await page.locator('#dre-month').selectOption('8');await expect(page.locator('[data-difal-monthly]')).toContainText('180,00');
 await page.getByRole('button',{name:'Um mês por vez',exact:true}).click();
 await expect(page.locator('[data-dre-row="revenue"]')).toContainText('1.858,00');
 await expect(page.locator('#dre-month')).toHaveValue('8');await expect(page.locator('.sim-calendar h2')).toHaveText('DRE completa');await expect(page.locator('#dre-period-note')).toContainText('Setembro / 2027');
 await expect(page.locator('.dre-calendar-screen [data-dre-row="sales"] td').first()).toContainText('1.800,00');
 await page.locator('#dre-month').selectOption('0');await expect(page.locator('#dre-month')).toHaveValue('0');
 await expect(page.locator('[data-dre-row="revenue"]')).toContainText('1.050,00');expect(posts).toBe(1);
 await page.locator('[data-dre-jump="netProfit"]').click();await expect(page.locator('.dre-calendar-screen [data-dre-row="netProfit"]')).toBeFocused();
 await expect(page.locator('.dre-calendar-screen [data-dre-row="netProfit"]')).toBeInViewport();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#dre-demonstrativo').scrollIntoViewIfNeeded();
  if(width===390){await page.screenshot({path:info.outputPath('dre-mensal-mobile.png')});await page.locator('.dre-regime-results').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('dre-visual-mobile.png')});}
 }
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#simulator-difal').screenshot({path:info.outputPath('difal-competencias.png')});expect(errors).toEqual([]);
});
