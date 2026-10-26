import {test,expect,type Page} from '@playwright/test';
import {TAX_SOURCES,MODEL_VERSION,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
import {baselineMonth,monthlyProjection,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';

const generation='96333333-3333-4333-8333-333333333331';
const client='96333333-3333-4333-8333-333333333332';
const id='96333333-3333-4333-8333-333333333333';
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');

function fixture(){
  const reports=Array.from({length:12},(_,index)=>({
    sourceMonth:`2025-${String(index+1).padStart(2,'0')}`,month:index+1,salesLines:1,purchaseLines:1,
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:(index+1)*100000,purchasesOptantCents:0,purchasesNonOptantCents:20000,serviceRevenueCents:0},
    difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',baseCents:(index+1)*100000,amountCents:(index+1)*10000,eligibleLines:1,pendingLines:0},
  }));
  const draft:any={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:180000,values:{serviceRevenue:0,salesRevenue:1000,simplePurchases:0,regularPurchases:200,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const period={startMonth:'2025-01',endMonth:'2025-12',months:12};
  const source:any={generationId:generation,clientId:client,company:{code:'PERF-DRE',name:'Empresa sintética de navegação'},
    fields:monthlyProjection(reports).annualGroupsCents,revenueSplit:{version:'SALES_SERVICES_V1'},reportMonths:12,periodBasis:'COLUMN_H',period,monthlyReports:reports,warnings:[],
    purchases:{jobId:'96333333-3333-4333-8333-333333333334',fileName:'compras-sinteticas.csv',totalCents:240000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-26T10:00:00Z'},
    sales:{jobId:'96333333-3333-4333-8333-333333333335',fileName:'vendas-sinteticas.csv',totalCents:7800000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-26T10:00:00Z'},
  };
  const computed=calculateMonthlySimulation(draft,reports,reports.map(baselineMonth),source.sales.jobId);
  const reference={source:'MANUAL',confirmed:true,rbt12Cents:18000000};
  return {_id:id,generationId:generation,clientId:client,company:source.company,title:'Navegação sintética de doze competências',source,draft,...computed,
    monthlyGroups:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:1000,purchasesOptantCents:0,purchasesNonOptantCents:200},
    monthlyDre:buildMonthlyDre(computed.result,2027,reference,period),reportMonths:12,periodBasis:'COLUMN_H',periodConfirmed:true,manuallyAdjusted:false,
    rbt12Source:'MANUAL',rbt12Manual:reference,createdAt:'2026-10-26T10:00:00Z',createdBy:{id:'operator',name:'Teste'},taxSources:TAX_SOURCES,modelVersion:MODEL_VERSION,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT};
}

async function instrument(page:Page){
  // Count an expensive, observable allocation instead of relying on machine speed.
  await page.addInitScript(()=>{
    const original=window.structuredClone.bind(window);
    (window as any).__memoryClones=0;
    window.structuredClone=((value:any,options:any)=>{
      if(Array.isArray(value)&&value.some(row=>row?.id==='dre.actual.netProfit'))(window as any).__memoryClones++;
      return original(value,options);
    }) as typeof window.structuredClone;
  });
}
const memoryClones=(page:Page)=>page.evaluate(()=>(window as any).__memoryClones as number);
async function downloadText(page:Page,selector:string){
  const pending=page.waitForEvent('download');await page.locator(selector).click();
  const download=await pending,stream=await download.createReadStream();let text='';
  for await(const chunk of stream!)text+=chunk;
  return {text,name:download.suggestedFilename()};
}

test('DRE reutiliza a apresentação, adia detalhes fechados e conserva exportação e impressão completas',async({page})=>{
  const saved=fixture(),before=JSON.stringify(saved),requests:string[]=[],errors:string[]=[];
  await instrument(page);
  page.on('request',request=>{if(request.url().includes('/api/'))requests.push(request.method()+' '+new URL(request.url()).pathname);});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
  await page.route('**/api/v4/simulations/'+id,route=>route.fulfill({json:saved}));
  await page.goto('/simulator.html?simulation='+id);
  await expect(page.locator('#dre-demonstrativo')).toBeVisible();
  await expect(page.locator('.sim-charts,[data-memory-id]')).toHaveCount(0);
  const initialRequests=[...requests],initialClones=await memoryClones(page);
  expect(initialClones).toBeGreaterThan(0);

  await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await page.locator('#dre-month').selectOption('5');
  await page.locator('#dre-regime').selectOption('actual');
  await page.locator('#dre-show-percent').check();
  const month=saved.result.monthlyResults[5].result.regimes.find((row:any)=>row.id==='actual')!;
  await expect(page.locator('[data-dre-summary="result"]')).toHaveText(money(month.annualProfit));
  await page.getByRole('button',{name:'12 meses',exact:true}).click();
  await expect(page.locator('.dre-calendar-screen thead th')).toHaveCount(14);
  await expect(page.locator('.sim-charts,[data-memory-id]')).toHaveCount(0);
  expect(await memoryClones(page)).toBe(initialClones);

  await page.evaluate(()=>{(window as any).__dreNode=document.querySelector('#dre-demonstrativo');});
  await page.locator('#dre-report-period').selectOption('monthly');
  expect(await page.evaluate(()=>(window as any).__dreNode===document.querySelector('#dre-demonstrativo'))).toBe(true);
  const csv=await downloadText(page,'#export-dre-csv');
  expect(csv.name).toBe('dre-PERF-DRE-2027-mensal.csv');
  expect(csv.text).toContain('Mensal · janeiro a dezembro · todos os regimes');
  expect(csv.text).toContain('Janeiro');expect(csv.text).toContain('Dezembro');
  expect(csv.text).toContain('Lucro Real');expect(csv.text).toContain('% da receita');
  await expect(page.locator('.sim-charts,[data-memory-id]')).toHaveCount(0);

  await page.locator('.sim-charts-details > summary').click();
  await expect(page.locator('.sim-charts')).toBeVisible();
  await expect(page.locator('.sim-chart-profit .sim-chart-row').last()).toContainText(money(month.annualProfit));
  await page.locator('.sim-memory > summary').click();
  await expect(page.locator('.sim-memory [data-memory-id]')).toHaveCount(saved.result.memory.length);
  await page.getByRole('button',{name:'Anual',exact:true}).click();
  await expect(page.locator('.sim-charts-details')).toHaveAttribute('open','');
  await expect(page.locator('.sim-memory')).toHaveAttribute('open','');
  await expect(page.locator('.sim-memory [data-memory-id]')).toHaveCount(saved.result.memory.length);
  expect(await memoryClones(page)).toBe(initialClones);

  // A subsequent closed view contains neither hidden chart markup nor memory rows.
  await page.locator('.sim-charts-details > summary').click();
  await page.locator('.sim-memory > summary').click();
  await page.getByRole('button',{name:'Mensal',exact:true}).click();
  await expect(page.locator('.sim-charts,[data-memory-id]')).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('.sim-charts')).toBeVisible();
  await expect(page.locator('.sim-memory [data-memory-id]')).toHaveCount(saved.result.memory.length);
  await expect(page.locator('.dre-print-calendar')).toHaveCount(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.sim-charts')).toBeHidden();
  await expect(page.locator('.sim-memory')).not.toHaveAttribute('open','');
  await expect(page.locator('.dre-print-calendar')).toHaveCount(0);

  await page.locator('#dre-report-period').selectOption('complete');
  await page.evaluate(()=>{window.print=()=>{};});
  await page.locator('#print-dre').click();
  await expect(page.locator('#dre-print-document [data-report-part="annual"]')).toHaveCount(1);
  await expect(page.locator('#dre-print-document [data-report-part="monthly"]')).toHaveCount(4);
  await expect(page.locator('#dre-print-document')).toContainText('Memória consolidada de cálculo');
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  const exported=JSON.parse((await downloadText(page,'#export-simulation')).text);
  expect(exported.result).toEqual(saved.result);expect(exported.monthlyDre).toEqual(saved.monthlyDre);
  expect(requests).toEqual(initialRequests);expect(errors).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});

test('editar e gerar outro resultado invalida a apresentação e a memória anteriores',async({page})=>{
  const saved=fixture(),errors:string[]=[],writes:string[]=[];
  await instrument(page);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method());});
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'viewer',role:'viewer',name:'Consulta'}}}));
  await page.route('**/api/v4/generations/*/simulator?*',route=>route.fulfill({json:saved.source}));
  await page.goto(`/simulator.html?generation=${generation}&client=${client}`);
  await expect(page.locator('#simulator-form')).toBeVisible();
  await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('180000');await page.locator('#rbt12-manual-confirm').check();
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  await expect(page.locator('#dre-demonstrativo')).toBeVisible();
  await page.locator('#dre-regime').selectOption('actual');
  await page.locator('.sim-memory > summary').click();
  await expect(page.locator('[data-memory-id="dre.actual.rent"] > span')).toHaveText(money(0));
  const firstClones=await memoryClones(page);
  await page.locator('#rent').fill('500');
  await expect(page.locator('#simulation-changes-notice')).toBeVisible();
  await expect(page.locator('#dre-demonstrativo')).toHaveCount(0);
  await page.getByRole('button',{name:'Gerar simulação',exact:true}).click();
  await expect(page.locator('#dre-demonstrativo [data-dre-row="rent"] .dre-active-column .dre-amount')).toHaveText(money(-500));
  await page.locator('.sim-memory > summary').click();
  await expect(page.locator('[data-memory-id="dre.actual.rent"] > span')).toHaveText(money(-500));
  expect(await memoryClones(page)).toBeGreaterThan(firstClones);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});
