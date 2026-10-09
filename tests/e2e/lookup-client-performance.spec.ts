import {test, expect, type Page} from '@playwright/test';

const jobId = '00000000-0000-4000-8000-000000000081';
const clientId = '00000000-0000-4000-8000-000000000082';
const generationId = '00000000-0000-4000-8000-000000000083';
const company = {_id:clientId, code:'081', name:'EMPRESA SINTÉTICA DE DESEMPENHO', active:true};
const baseJob = {
  _id:jobId, clientId, clientCode:company.code, clientName:company.name,
  fileName:'desempenho-sintetico.csv', status:'PROCESSING', received:0, uploaded:10,
  expectedRows:10, summary:{lines:10,unique:10,duplicates:0,invalid:0}, nextPollMs:60000,
  createdAt:'2026-10-09T12:00:00Z'
};
function progress(completed:number, compact=false) {
  return {job:{_id:jobId,status:'PROCESSING'}, partial:true, canRecheck:false,
    metrics:{total:10,completed,optants:completed,nonOptants:0,unconfirmed:0,pending:10-completed,retrying:0},
    items:[],total:10,page:1,pageSize:25,...(compact?{summaryOnly:true}:{})};
}
async function session(page:Page, role='operator') {
  await page.route('**/api/auth/session', r=>r.fulfill({json:{user:{_id:'synthetic',name:'Equipe sintética',role}}}));
  await page.route('**/api/v4/clients', r=>r.fulfill({json:{items:[company]}}));
  const now=new Date();await page.clock.install({time:now});await page.clock.pauseAt(now);
}

test('Lookup batches reuse the job response, honor zero/cooldown hints and keep pause single-flight',async({page})=>{
  await session(page);
  let reads=0, calls=0, active=0, maxActive=0, release!:()=>void;
  const firstBatch = new Promise<void>(resolve=>release=resolve);
  await page.route(`**/api/v4/lookups/${jobId}`,r=>{reads++;return r.fulfill({json:baseJob});});
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>r.fulfill({json:progress(0)}));
  await page.route(`**/api/v4/lookups/${jobId}/results?*`,r=>r.fulfill({json:{items:[],total:0,page:1}}));
  await page.route(`**/api/v4/lookups/${jobId}/process`,async r=>{
    const batch=++calls; active++; maxActive=Math.max(maxActive,active);
    if(batch===1)await firstBatch;
    await r.fulfill({json:{...baseJob,received:batch===4?10:batch,
      status:batch===4?'COMPLETED':'PROCESSING',nextPollMs:batch===3?60000:0,
      ...(batch===4?{resultSummary:{optantsPercent:100,nonOptantsPercent:0,unknownPercent:0}}:{})}});
    active--;
  });
  await page.goto('/#job/'+jobId);
  await expect(page.locator('#process-now')).toBeVisible();
  await page.evaluate(()=>{(window as any).progressNode=document.querySelector('#lookup-process-count');});
  await page.locator('#process-now').click();
  await expect.poll(()=>calls).toBe(1);
  await expect(page.locator('#process-now')).toBeDisabled();
  await page.locator('#process-now').dispatchEvent('click');
  await page.locator('#pause-now').click();
  release();
  await expect(page.locator('#lookup-process-count')).toContainText('1 / 10');
  await page.clock.runFor(500);
  expect(calls).toBe(1);
  await page.locator('#process-now').click();
  await expect(page.locator('#lookup-process-count')).toContainText('2 / 10');
  await page.clock.runFor(1);
  await expect.poll(()=>calls).toBe(3);
  await expect(page.locator('#lookup-process-count')).toContainText('3 / 10');
  expect(await page.evaluate(()=>(window as any).progressNode===document.querySelector('#lookup-process-count'))).toBe(true);
  expect(reads).toBe(1);
  await page.clock.runFor(59998);
  expect(calls).toBe(3);
  await page.clock.runFor(2);
  await expect(page.getByRole('heading',{name:'Resultados da API'})).toBeVisible();
  expect(calls).toBe(4);expect(reads).toBe(1);expect(maxActive).toBe(1);
});

async function purchasesSession(page:Page, role='operator') {
  await session(page,role);
  const job={...baseJob,generationId,mode:'PURCHASES_V1',calculationVersion:'NET_V2'};
  await page.route(`**/api/v4/generations/${generationId}`,r=>r.fulfill({json:{_id:generationId,requiredReports:['PURCHASES','SALES'],companies:[{clientId,code:company.code,name:company.name,purchaseJobId:jobId,purchase:job,sales:null}]}}));
  return job;
}
const purchasesUrl=`/purchases.html?generation=${generationId}&client=${clientId}&job=${jobId}&guided=1`;

test('Guided purchases request only progress totals and update a running batch without a second job read',async({page})=>{
  const job=await purchasesSession(page);
  let reads=0,calls=0,completed=0,progressReads=0,release!:()=>void;
  const firstBatch=new Promise<void>(resolve=>release=resolve);
  await page.route(`**/api/v4/purchases/${jobId}`,r=>{reads++;return r.fulfill({json:job});});
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>{
    const query=new URL(r.request().url()).searchParams;
    expect(query.get('summary')).toBe('1');progressReads++;
    return r.fulfill({json:progress(completed,true)});
  });
  await page.route(`**/api/v4/purchases/${jobId}/process`,async r=>{
    const batch=++calls;
    if(batch===1)await firstBatch;
    return r.fulfill({json:{...job,received:batch===1?2:3,nextPollMs:batch===1?0:60000}});
  });
  await page.goto(purchasesUrl);
  await expect(page.locator('[data-processing-count]')).toHaveText('0 de 10 concluídos');
  await page.evaluate(()=>{(window as any).progressNode=document.querySelector('[data-processing-count]');});
  await page.clock.runFor(60000);
  await expect.poll(()=>calls).toBe(1);
  await expect(page.locator('#purchase-process')).toBeDisabled();
  completed=2;
  await page.clock.runFor(5000);
  await expect(page.locator('[data-processing-count]')).toHaveText('2 de 10 concluídos');
  await page.locator('#purchase-process').dispatchEvent('click');
  await page.locator('#purchase-pause').click();
  release();
  await expect(page.locator('#purchase-process')).toBeEnabled();
  await page.clock.runFor(500);
  expect(calls).toBe(1);
  await page.locator('#purchase-process').click();
  await expect(page.locator('[data-processing-count]')).toHaveText('3 de 10 concluídos');
  expect(reads).toBe(1);expect(calls).toBe(2);expect(progressReads).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).progressNode===document.querySelector('[data-processing-count]'))).toBe(true);
  await page.clock.runFor(59999);
  expect(calls).toBe(2);
  await page.locator('#purchase-pause').click();
});

test('Read-only purchases receive live counts without issuing a process request',async({page})=>{
  const job=await purchasesSession(page,'viewer');let writes=0,completed=1;
  await page.route(`**/api/v4/purchases/${jobId}`,r=>r.fulfill({json:job}));
  await page.route(`**/api/v4/purchases/${jobId}/process`,r=>{writes++;return r.fulfill({json:job});});
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>r.fulfill({json:progress(completed,true)}));
  await page.goto(purchasesUrl);
  await expect(page.locator('[data-processing-count]')).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.locator('[data-processing-count]')).toHaveText('1 de 10 concluídos');
  completed=3;
  await page.clock.runFor(6000);
  await expect(page.locator('[data-processing-count]')).toHaveText('3 de 10 concluídos');
  await expect(page.locator('#purchase-process')).toHaveCount(0);
  await page.clock.runFor(60000);
  expect(writes).toBe(0);
});
