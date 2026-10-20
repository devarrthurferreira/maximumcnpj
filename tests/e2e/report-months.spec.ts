import {test,expect} from '@playwright/test';
import {baselineMonth,monthlyProjection,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
const generation='a1000000-0000-4000-8000-000000000001',client='a1000000-0000-4000-8000-000000000002',salesId='a1000000-0000-4000-8000-000000000003';
const reports=Array.from({length:12},(_,i)=>({sourceMonth:`2025-${String(i+1).padStart(2,'0')}`,month:i+1,salesLines:1,purchaseLines:1,
 fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:100000+i*10000,purchasesOptantCents:0,purchasesNonOptantCents:20000+i*1000,serviceRevenueCents:5000+i*100},
 difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',baseCents:100000+i*10000,amountCents:10000+i*1000,eligibleLines:1,pendingLines:0}}));
const projection=monthlyProjection(reports),fields=projection.annualGroupsCents;
const source:any={generationId:generation,clientId:client,company:{code:'TESTE',name:'Empresa sintética mensal'},periodBasis:'COLUMN_H',reportMonths:12,
 period:{startMonth:'2025-01',endMonth:'2025-12',months:12},monthlyReports:reports,projection,fields,revenueSplit:{version:'SALES_SERVICES_V1'},warnings:[],
 purchases:{jobId:'a1000000-0000-4000-8000-000000000004',fileName:'compras.csv',totalCents:projection.totals.purchases.totalCents,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2'},
 sales:{jobId:salesId,fileName:'saidas.csv',totalCents:projection.totals.sales.totalCents,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',difal:{...reports[0].difal,amountCents:186000,baseCents:1860000,eligibleLines:12}}};
test('compras, vendas e DIFAL por mês: edição isolada, rascunho, DRE, CSV, JSON e histórico',async({page},info)=>{
 let saved:any,posts=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'tester',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:source}));
 await page.route('**/api/v4/simulations',async route=>{
  const request=route.request().postDataJSON();posts++;const computed=calculateMonthlySimulation(request.draft,reports,request.monthlyInputs,salesId);
  saved={_id:request.simulationId,...request,...computed,source,company:source.company,createdAt:new Date().toISOString(),createdBy:{id:'tester',name:'Teste'},modelVersion:computed.result.version,
   manuallyAdjusted:computed.adjustments.length>0,rbt12Source:'MANUAL',rbt12Manual:{source:'MANUAL',confirmed:true,rbt12Cents:50000000},monthlyDre:buildMonthlyDre(computed.result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:50000000},source.period)};
  await route.fulfill({json:saved});
 });
 await page.route('**/api/v4/simulations/*',r=>r.fulfill({json:saved}));
 await page.goto(`/simulator.html?generation=${generation}&client=${client}`);
 await expect(page.locator('#salesCpfCents')).toHaveValue('1000.00');await expect(page.locator('[data-difal-monthly]')).toContainText('100,00');
 await expect(page.locator('#simulator-projection')).not.toContainText('Média');
 await page.locator('#rent').fill('15');await page.locator('#report-competence').selectOption('11');
 await expect(page.locator('#salesCpfCents')).toHaveValue('2100.00');await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('310.00');await expect(page.locator('#rent')).toHaveValue('0.00');
 await expect(page.locator('[data-difal-monthly]')).toContainText('210,00');await expect(page.locator('[data-difal-annual]')).toContainText('1.860,00');
 await page.locator('#rent').fill('30');await page.reload();await expect(page.locator('#report-competence')).toHaveValue('11');await expect(page.locator('#rent')).toHaveValue('30.00');
 await page.locator('#report-competence').selectOption('0');await expect(page.locator('#rent')).toHaveValue('15.00');
 await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('500000');await page.locator('#rbt12-manual-confirm').check();
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('salva');
 expect(posts).toBe(1);expect(saved.result.annualRevenue).toBe(19266);expect(saved.difalProjection.annualCents).toBe(186000);
 await expect(page.locator('.sim-calendar')).toContainText('valores por competência');
 const sales=page.locator('.dre-calendar-screen tr[data-dre-row="sales"]');
 await expect(sales).toContainText('1.000,00');await expect(sales).toContainText('2.100,00');
 const csvPromise=page.waitForEvent('download');await page.locator('#export-dre-csv').click();const download=await csvPromise;
 const stream=await download.createReadStream();const parts:Buffer[]=[];for await(const part of stream!)parts.push(Buffer.from(part));const csv=Buffer.concat(parts).toString();
 expect(csv).toContain('1000,00');expect(csv).toContain('2100,00');expect(csv).toContain('Valores por competência');
 const jsonPromise=page.waitForEvent('download');await page.locator('#export-simulation').click();const jsonDownload=await jsonPromise;
 const jsonStream=await jsonDownload.createReadStream();const chunks:Buffer[]=[];for await(const part of jsonStream!)chunks.push(Buffer.from(part));const exported=JSON.parse(Buffer.concat(chunks).toString());
 expect(exported.monthlyInputs).toEqual(saved.monthlyInputs);expect(exported.monthlyDre).toEqual(saved.monthlyDre);
 await page.goto(`/simulator.html?simulation=${saved._id}`);await expect(page.locator('#simulation-snapshot')).toBeVisible();expect(posts).toBe(1);
 await page.locator('[data-period="monthly"]').click();await expect(page.locator('.sim-calendar')).toContainText('valores por competência');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('#simulator-difal').screenshot({path:info.outputPath('difal-competencias.png')});expect(errors).toEqual([]);
});
