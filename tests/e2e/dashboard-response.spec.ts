import {test,expect,type Page} from '@playwright/test';

const company={_id:'b8189f54-e9ab-4d56-8701-2459c84a7f67',name:'Empresa sintética',code:'0042',active:true};
const metrics={total:7,optants:3,nonOptants:3,unknown:1,optantsPercent:42.86,reportingNonOptants:4,reportingNonOptantsPercent:57.14,unknownPercent:14.29};
const summary={clientCount:1,analysisCount:2,simulationCount:3,classificationDeferred:true,
 activity:{queriesLast7Days:5,batchesLast7Days:1,days:[{date:'2026-11-03',count:5}]},
 storage:{status:'LIMIT_NOT_CONFIGURED',allocatedBytes:2048,remainingBytes:null},recentCompanies:[company],recentActivity:[]};
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function session(page:Page){
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'test',name:'Equipe sintética',role:'admin'}}}));
 await page.route('**/api/v4/dashboard?*',route=>{
  expect(new URL(route.request().url()).searchParams.get('summary')).toBe('1');
  return route.fulfill({json:summary});
 });
}

test('overview renders before the company catalog and loads classification only when opened',async({page})=>{
 const catalog=gate(),classification=gate(),errors:string[]=[];let catalogCalls=0,classificationCalls=0;
 page.on('pageerror',error=>errors.push(error.message));
 await session(page);
 await page.route('**/api/v4/clients',async route=>{catalogCalls++;await catalog.promise;await route.fulfill({json:{items:[company]}});});
 await page.route('**/api/v4/dashboard/classification?*',async route=>{classificationCalls++;await classification.promise;await route.fulfill({json:{metrics}});});
 await page.goto('/#overview');
 await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 await expect(page.locator('#global-client')).toBeDisabled();
 await expect(page.locator('#retry-client-filter')).toBeHidden();
 expect(catalogCalls).toBe(1);expect(classificationCalls).toBe(0);
 const panel=page.locator('#dashboard-classification');
 await expect(panel.locator('summary')).toHaveText('Enquadramento cadastral');
 await panel.locator('summary').click();
 await expect(panel.getByRole('status')).toHaveText('Carregando enquadramento cadastral…');
 await panel.locator('summary').click();await panel.locator('summary').click();
 expect(classificationCalls).toBe(1);
 classification.release();
 await expect(panel.locator('summary')).toContainText('7 CNPJs únicos');
 await expect(panel.locator('.dashboard-classification strong')).toHaveText(['3','4','1']);
 await panel.locator('summary').click();await panel.locator('summary').click();
 expect(classificationCalls).toBe(1);
 catalog.release();await expect(page.locator('#global-client')).toBeEnabled();
 await expect(page.locator('#retry-client-filter')).toBeHidden();
 await expect(page.locator('#global-client option')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('company and classification failures can be retried without discarding the dashboard or session',async({page})=>{
 let catalogCalls=0,classificationCalls=0;
 await session(page);
 await page.route('**/api/v4/clients',route=>{catalogCalls++;return route.fulfill(catalogCalls===1?{status:503,json:{message:'Cadastro temporariamente indisponível.'}}:{json:{items:[company]}});});
 await page.route('**/api/v4/dashboard/classification?*',route=>{classificationCalls++;return route.fulfill(classificationCalls===1?{status:503,json:{message:'Enquadramento temporariamente indisponível.'}}:{json:{metrics}});});
 await page.goto('/#overview');
 await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
 await expect(page.locator('#retry-client-filter')).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#retry-client-filter').click();
 await expect(page.locator('#retry-client-filter')).toBeHidden();
 await expect(page.locator('#global-client')).toBeEnabled();expect(catalogCalls).toBe(2);
 await expect(page.locator('#retry-client-filter')).toBeHidden();
 const panel=page.locator('#dashboard-classification');await panel.locator('summary').click();
 await expect(panel.getByRole('alert')).toHaveText('Enquadramento temporariamente indisponível.');
 await expect(panel.locator('.dashboard-classification')).toHaveCount(0);
 await panel.getByRole('button',{name:'Tentar novamente'}).click();
 await expect(panel.locator('summary')).toContainText('7 CNPJs únicos');
 expect(classificationCalls).toBe(2);
 await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
});

test('late classification responses never replace the currently selected company',async({page})=>{
 const old=gate(),seen:string[]=[];
 await session(page);
 await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[company]}}));
 await page.route('**/api/v4/dashboard/classification?*',async route=>{
  const client=new URL(route.request().url()).searchParams.get('clientId')||'';seen.push(client);
  if(!client)await old.promise;
  await route.fulfill({json:{metrics:client?{...metrics,total:2,optants:2,reportingNonOptants:0,unknown:0}:metrics}});
 });
 await page.goto('/#overview');
 await page.locator('#dashboard-classification summary').click();
 await expect(page.locator('#dashboard-classification [role=status]')).toBeVisible();
 await expect(page.locator('#global-client')).toBeEnabled();await page.locator('#global-client').selectOption(company._id);
 await expect(page.locator('#dashboard-classification summary')).toHaveText('Enquadramento cadastral');
 await page.locator('#dashboard-classification summary').click();
 await expect(page.locator('#dashboard-classification summary')).toContainText('2 CNPJs únicos');
 const oldResponse=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname==='/api/v4/dashboard/classification'&&!url.searchParams.has('clientId');
 });
 old.release();await (await oldResponse).finished();
 await expect(page.locator('#dashboard-classification .dashboard-classification strong')).toHaveText(['2','0','0']);
 expect(seen).toEqual(['',company._id]);
});

test('navigating to companies during catalog loading shares the pending request',async({page})=>{
 const catalog=gate();let calls=0;
 await session(page);
 await page.route('**/api/v4/clients',async route=>{calls++;await catalog.promise;await route.fulfill({json:{items:[company]}});});
 await page.goto('/#overview');
 await page.getByRole('button',{name:'Ver empresas'}).click();
 catalog.release();
 await expect(page.getByRole('heading',{name:'Sua carteira',exact:true})).toBeVisible();
 await expect(page.locator('#client-table')).toContainText(company.name);
 expect(calls).toBe(1);
});

for(const oldStatus of [200,401])test(`late catalog response ${oldStatus} from a previous session cannot replace the new session`,async({page})=>{
 const old=gate(),errors:string[]=[];
 const currentCompany={...company,_id:'b8189f54-e9ab-4d56-8701-2459c84a7f68',code:'0043',name:'Empresa da sessão atual'};
 let catalogCalls=0,sessions=0;
 page.on('pageerror',error=>errors.push(error.message));
 await session(page);
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'test-'+(++sessions),name:'Equipe sintética '+sessions,role:'admin'}}}));
 await page.route('**/api/auth/login',route=>route.fulfill({json:{ok:true}}));
 await page.route('**/api/auth/logout',route=>route.fulfill({json:{ok:true}}));
 await page.route('**/api/v4/clients',async route=>{
  const first=++catalogCalls===1;
  if(first)await old.promise;
  return route.fulfill(first&&oldStatus===401?{status:401,json:{message:'Sessão antiga expirada.'}}:{json:{items:[first?company:currentCompany]}});
 });
 try{
  await page.goto('/#overview');
  await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
  await expect.poll(()=>catalogCalls).toBe(1);
  await page.locator('#logout').click();await expect(page.locator('#login-form')).toBeVisible();
  await page.locator('#login-form [name=email]').fill('synthetic@example.test');
  await page.locator('#login-form [name=password]').fill('synthetic-password-only');
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('#global-client')).toBeEnabled();
  await expect(page.locator('#global-client option').last()).toContainText(currentCompany.name);
  const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/clients');
  old.release();await (await oldResponse).finished();
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await expect(page.locator('#login-form')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Sua carteira, em perspectiva.'})).toBeVisible();
  await expect(page.locator('#global-client option').last()).toContainText(currentCompany.name);
  expect(catalogCalls).toBe(2);expect(errors).toEqual([]);
 }finally{old.release();}
});
