import {test,expect} from '@playwright/test';
import {storagePoolSummary} from '../../src/dashboard.ts';
import type {StorageStats,StorageSlot} from '../../src/mongo-connections.ts';

test('overview shows honest storage, activity and searchable complete history on mobile',async({page})=>{
 const company={_id:'b8189f54-e9ab-4d56-8701-2459c84a7f67',name:'Empresa de conferência',code:'0042',cnpj:'00000000000191',active:true};
 const item={_id:'d8189f54-e9ab-4d56-8701-2459c84a7f67',clientId:company._id,clientName:company.name,clientCode:company.code,createdAt:'2026-10-28T12:00:00Z',kind:'SALES',title:'Saídas.csv',status:'COMPLETED'};
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'test',name:'Teste',role:'admin'}}}));
 await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[company]}}));
 await page.route('**/api/v4/dashboard?*',route=>route.fulfill({json:{clientCount:1,analysisCount:1,simulationCount:2,metrics:{total:3,optants:2,nonOptants:1,unknown:0,optantsPercent:66.67,reportingNonOptants:1,reportingNonOptantsPercent:33.33,unknownPercent:0},activity:{queriesLast7Days:6,batchesLast7Days:2,days:Array.from({length:7},(_,i)=>({date:`2026-10-${22+i}`,count:i===6?6:0}))},storage:{status:'LIMIT_NOT_CONFIGURED',allocatedBytes:2048,dataBytes:1024,indexBytes:1024,remainingBytes:null,limitBytes:null},recentCompanies:[company],recentActivity:[item]}}));
 const requests:URL[]=[];
 await page.route('**/api/v4/activity?*',route=>{requests.push(new URL(route.request().url()));return route.fulfill({json:{items:[item],page:1,pageSize:30,total:1,totalPages:1}});});
 await page.goto('/#overview');
 await expect(page.getByText('Consultas nos últimos 7 dias',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Armazenamento MongoDB'})).toBeVisible();
 await expect(page.getByText('Limite não informado',{exact:true})).toBeVisible();
 await expect(page.locator('.dashboard-storage')).toContainText('2 KiB');
 if(process.env.DASHBOARD_QA_SCREENSHOTS)await page.screenshot({path:process.env.DASHBOARD_QA_SCREENSHOTS+'/desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Ver histórico completo'}).click();
 await expect(page.getByRole('heading',{name:'Histórico completo'})).toBeVisible();
 await page.locator('#activity-search').fill('0042');await page.getByRole('button',{name:'Buscar',exact:true}).click();
 await expect.poll(()=>requests.at(-1)?.searchParams.get('search')).toBe('0042');
 await page.locator('#activity-kind').selectOption('SALES');await page.getByRole('button',{name:'Buscar',exact:true}).click();
 await expect.poll(()=>requests.at(-1)?.searchParams.get('kind')).toBe('SALES');
 await page.locator('#global-client').selectOption(company._id);
 await expect.poll(()=>requests.at(-1)?.searchParams.get('clientId')).toBe(company._id);
 await expect(page.locator('.dashboard-history-table a')).toHaveAttribute('href',new RegExp(`job=${item._id}.*type=SALES`));
 await page.locator('#global-client').selectOption('');
 await expect.poll(()=>requests.at(-1)?.searchParams.get('clientId')).toBe('');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/#overview');await expect(page.getByRole('heading',{name:'Últimas empresas'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(process.env.DASHBOARD_QA_SCREENSHOTS)await page.screenshot({path:process.env.DASHBOARD_QA_SCREENSHOTS+'/mobile.png',fullPage:true});
 expect(errors).toEqual([]);
});

test('overview shows three storage banks, reserve and unavailable measurements without hiding the prior history',async({page})=>{
 const stats=(slot:StorageSlot,usedBytes:number|null,scope:StorageStats['scope']='CLUSTER'):StorageStats=>({
  slot,status:usedBytes===null?'UNAVAILABLE':'AVAILABLE',scope,measurement:'UNCOMPRESSED_DATA_AND_INDEXES',usedBytes,
  dataBytes:usedBytes===null?null:usedBytes*.75,indexBytes:usedBytes===null?null:usedBytes*.25,limitBytes:512*1024*1024,
  remainingBytes:usedBytes===null?null:512*1024*1024-usedBytes,usedPercent:usedBytes===null?null:usedBytes/(512*1024*1024)*100,
  measuredAt:new Date('2026-10-30T12:00:00Z')
 });
 const pool={enabled:true,activeSlot:2,rolloverPercent:85,slots:[stats(1,450*1024*1024),stats(2,100*1024*1024),stats(3,0)]};
 let storage=storagePoolSummary(pool);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'test',name:'Teste',role:'admin'}}}));
 await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/v4/dashboard?*',route=>route.fulfill({json:{
  clientCount:0,analysisCount:0,simulationCount:0,metrics:{total:0,optants:0,nonOptants:0,unknown:0},
  activity:{queriesLast7Days:6,batchesLast7Days:2,days:Array.from({length:7},(_,i)=>({date:`2026-10-${24+i}`,count:i===6?6:0}))},
  storage,recentCompanies:[],recentActivity:[]
 }}));
 await page.goto('/#overview');
 const card=page.locator('.dashboard-storage-pool'),first=card.locator('[data-storage-slot="1"]'),active=card.locator('[data-storage-slot="2"]'),reserve=card.locator('[data-storage-slot="3"]');
 await expect(card.getByText('Banco 2 para novos lotes',{exact:true})).toBeVisible();
 await expect(card.locator('[data-storage-slot]')).toHaveCount(3);
 await expect(first.getByText('Histórico preservado',{exact:true})).toBeVisible();
 await expect(active.getByText('Novos lotes',{exact:true})).toBeVisible();
 await expect(reserve.locator('.dashboard-storage-slot-usage strong')).toHaveText('0 B');
 await expect(card.getByRole('progressbar')).toHaveCount(3);
 await active.locator('summary').click();
 await expect(active.getByText('Reserva de espaço',{exact:true})).toBeVisible();
 await expect(active).toContainText('76,8 MiB');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.evaluate(()=>window.scrollTo(0,0));
 if(process.env.DASHBOARD_QA_SCREENSHOTS)await page.screenshot({path:process.env.DASHBOARD_QA_SCREENSHOTS+'/pool-mobile.png',fullPage:true});
 storage=storagePoolSummary({...pool,slots:[pool.slots[0],pool.slots[1],stats(3,null)]});
 await page.getByRole('button',{name:'Atualizar dashboard'}).click();
 await expect(reserve.locator('.dashboard-storage-slot-usage strong')).toHaveText('Medição indisponível');
 await expect(reserve.getByText('Saldo indisponível',{exact:true})).toBeVisible();
 await expect(reserve.getByRole('progressbar')).toHaveCount(0);
 await expect(card).toContainText('Medição incompleta');
 await expect(first.getByText('Histórico preservado',{exact:true})).toBeVisible();
 storage=storagePoolSummary({...pool,slots:[pool.slots[0],pool.slots[1],stats(3,1024,'DATABASE')]});
 await page.getByRole('button',{name:'Atualizar dashboard'}).click();
 await expect(reserve).toContainText('Medição parcial · saldo indisponível');
 await reserve.locator('summary').click();
 await expect(reserve).toContainText('Somente o banco da aplicação foi medido');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.scrollTo(0,0));
 if(process.env.DASHBOARD_QA_SCREENSHOTS)await page.screenshot({path:process.env.DASHBOARD_QA_SCREENSHOTS+'/pool-desktop.png',fullPage:true});
 expect(errors).toEqual([]);
});
