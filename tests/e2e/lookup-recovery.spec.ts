import {test, expect, type Page} from '@playwright/test';

const clientId='00000000-0000-4000-8000-000000000201';
const generationId='00000000-0000-4000-8000-000000000202';
const jobId='00000000-0000-4000-8000-000000000203';
const freshId='00000000-0000-4000-8000-000000000204';
const company={_id:clientId,code:'201',name:'EMPRESA SINTÉTICA DE RECUPERAÇÃO',active:true};
const baseJob={_id:jobId,generationId,clientId,clientCode:company.code,clientName:company.name,mode:'PURCHASES_V1',status:'COMPLETED',fileName:'recuperacao-sintetica.csv',calculationVersion:'NET_V2',received:25,uploaded:30,expectedRows:30,summary:{unique:25,lines:30},createdAt:'2026-10-09T12:00:00Z'};
const guidedUrl=`/purchases.html?generation=${generationId}&client=${clientId}&job=${jobId}&guided=1`;
function summary(job=baseJob, unknown=true) {
  return {job,calculationVersion:'NET_V2',components:{grossCents:100000,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:100000},
    totals:{lines:30,uniqueDocuments:26,uniqueCnpjs:25,nonCnpjDocumentCount:1,nonCnpjLines:1,totalCents:100000},
    groups:[{status:'NAO_CONFIRMADO',count:unknown?25:0}],
    reportingGroups:[{status:'OPTANTE',count:unknown?0:25,lines:unknown?0:29,totalCents:unknown?0:90000,countPercent:unknown?0:96.15,valuePercent:unknown?0:90},
      {status:'NAO_OPTANTE',count:unknown?26:1,lines:unknown?30:1,totalCents:unknown?100000:10000,countPercent:unknown?100:3.85,valuePercent:unknown?100:10,unconfirmedCount:unknown?25:0,unconfirmedCents:unknown?90000:0}],excluded:[]};
}
function progress(job=baseJob,canRecheck=true,unknown=true) {
  const done=job.status==='COMPLETED';
  return {job,canRecheck,partial:!done,metrics:{total:25,completed:done?25:0,optants:done&&!unknown?25:0,nonOptants:0,unconfirmed:done&&unknown?25:0,pending:done?0:25,retrying:0},
    diagnostics:{confirmed:done&&!unknown?25:0,unconfirmed:done&&unknown?25:0,reasons:done&&unknown?[{code:'FONTE_INDISPONIVEL',count:25}]:[],sources:done?[{name:unknown?'Minha Receita':'OpenCNPJ.org',count:25}]:[]},
    items:done&&!unknown?[{cnpj:'00000000000191',submittedName:'FORNECEDOR SINTÉTICO',state:'DONE',status:'OPTANTE',attempts:1,source:'OpenCNPJ.org'}]:[],total:25,page:1,pageSize:25};
}
async function session(page:Page,role='operator') {
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'synthetic',role}}}));
  await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[company]}}));
  await page.route(`**/api/v4/generations/${generationId}`,r=>r.fulfill({json:{_id:generationId,requiredReports:['PURCHASES'],companies:[{clientId,purchaseJobId:jobId,purchase:baseJob}]}}));
  await page.route('**/api/v4/purchases?*',r=>r.fulfill({json:{items:[baseJob],total:1,page:1}}));
  await page.route(`**/api/v4/purchases/${jobId}`,r=>r.fulfill({json:baseJob}));
  await page.route(`**/api/v4/purchases/${jobId}/summary`,r=>r.fulfill({json:summary()}));
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>r.fulfill({json:progress(baseJob,role!=='viewer')}));
}

test('Guided failed consultation warns from saved totals, exposes reasons and preserves financial groups',async({page},info)=>{
  await session(page);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(guidedUrl);
  await expect(page.locator('.purchase-guided-summary-title .eyebrow')).toHaveText('CONSULTA ENCERRADA COM PENDÊNCIAS');
  await expect(page.locator('.purchase-guided-success')).toHaveCount(0);
  await expect(page.locator('.purchase-lookup-warning')).toContainText('25 de 25 CNPJ(s) sem enquadramento confirmado');
  await expect(page.locator('.purchase-lookup-warning')).toContainText('não comprova que estejam fora do Simples');
  await expect(page.locator('.purchase-group[data-status="NAO_OPTANTE"]')).toContainText('1.000,00');
  await expect(page.locator('.purchase-group[data-status="NAO_OPTANTE"]')).toContainText('Inclui 25 não confirmado(s)');
  await expect(page.locator('[data-diagnostics]')).toContainText('25 CNPJ(s): Fonte indisponível');
  await expect(page.getByRole('button',{name:'Consultar CNPJs novamente'})).toBeVisible();
  await expect(page.locator('#lookup-live table,#lookup-live select')).toHaveCount(0);
  await expect(page.locator('#purchase-next-step')).toContainText('Consulta salva com pendências.');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`recovery-${width}.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
});

test('Historical saved unknowns remain a warning even when the diagnostics endpoint is unavailable',async({page})=>{
  await session(page);
  const old=summary();delete (old as any).groups;
  await page.route(`**/api/v4/purchases/${jobId}/summary`,r=>r.fulfill({json:old}));
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>r.fulfill({status:503,json:{message:'Acompanhamento temporariamente indisponível.'}}));
  await page.goto(guidedUrl);
  await expect(page.locator('.purchase-guided-summary-title .eyebrow')).toContainText('PENDÊNCIAS');
  await expect(page.locator('.purchase-lookup-warning')).toContainText('Nenhum CNPJ teve o enquadramento confirmado');
  await expect(page.locator('#lookup-live [data-error]')).toContainText('temporariamente indisponível');
  await expect(page.locator('.purchase-guided-success')).toHaveCount(0);
});

test('Rechecking retries one request identity, opens a separate report and starts consultation automatically',async({page})=>{
  await session(page);
  const fresh:any={...baseJob,_id:freshId,generationId:undefined,repeatedFrom:jobId,status:'PROCESSING',received:0,nextPollMs:0};
  let attempts=0,processCalls=0;const ids:string[]=[];
  await page.route(`**/api/v4/lookups/${jobId}/recheck`,r=>{
    ids.push(r.request().postDataJSON().importId);attempts++;
    return attempts===1?r.fulfill({status:503,json:{message:'Resposta temporariamente indisponível.'}}):r.fulfill({json:fresh});
  });
  await page.route(`**/api/v4/purchases/${freshId}`,r=>r.fulfill({json:fresh}));
  await page.route(`**/api/v4/purchases/${freshId}/process`,r=>{processCalls++;fresh.status='COMPLETED';fresh.received=25;return r.fulfill({json:fresh});});
  await page.route(`**/api/v4/purchases/${freshId}/summary`,r=>r.fulfill({json:summary(fresh,false)}));
  await page.route(`**/api/v4/purchases/${freshId}/results?*`,r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:100}}));
  await page.route(`**/api/v4/lookups/${freshId}/progress?*`,r=>r.fulfill({json:progress(fresh,true,false)}));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(guidedUrl);
  await page.getByRole('button',{name:'Consultar CNPJs novamente'}).click();
  await expect(page.locator('[data-recheck-error]')).toContainText('sem criar outro relatório');
  // The same identity survives a reload after an uncertain creation response.
  await page.reload();
  await page.getByRole('button',{name:'Consultar CNPJs novamente'}).click();
  await expect(page).toHaveURL(new RegExp(`job=${freshId}`));
  await expect.poll(()=>processCalls).toBe(1);
  await expect(page.getByRole('heading',{name:'Total de compras do relatório'})).toBeVisible();
  expect(ids).toHaveLength(2);expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/);expect(ids[1]).toBe(ids[0]);
  expect(new URL(page.url()).searchParams.has('generation')).toBe(false);
  expect(new URL(page.url()).searchParams.has('auto')).toBe(false);
  await expect(page.locator('.purchase-lookup-warning')).toHaveCount(0);
  await expect(page.locator('#lookup-live tbody')).toContainText('Fonte: OpenCNPJ.org');
  await expect(page.locator('.purchase-group[data-status="OPTANTE"]')).toContainText('900,00');
  await expect(page.getByText('Este relatório foi criado por uma nova consulta dos CNPJs.',{exact:false})).toBeVisible();
});

test('Read-only users see pending reasons but cannot recheck or auto-process',async({page})=>{
  await session(page,'viewer');let writes=0;
  await page.route('**/api/v4/**',r=>{if(r.request().method()!=='GET'){writes++;return r.fulfill({status:403,json:{message:'Sem permissão.'}});}return r.fallback();});
  await page.goto(guidedUrl+'&auto=1');
  await expect(page.locator('[data-diagnostics]')).toContainText('Fonte indisponível');
  await expect(page.getByRole('button',{name:'Consultar CNPJs novamente'})).toBeHidden();
  await expect(page.locator('#purchase-process')).toHaveCount(0);
  const running:any={...baseJob,status:'PROCESSING',received:0,nextPollMs:0};
  await page.route(`**/api/v4/purchases/${jobId}`,r=>r.fulfill({json:running}));
  await page.route(`**/api/v4/lookups/${jobId}/progress?*`,r=>r.fulfill({json:progress(running,false)}));
  await page.goto(`/purchases.html?client=${clientId}&job=${jobId}&auto=1`);
  await expect(page.getByRole('heading',{name:'Consulta em andamento'})).toBeVisible();
  await expect(page.locator('#purchase-process')).toHaveCount(0);
  await page.clock.install();await page.clock.runFor(60000);expect(writes).toBe(0);
});

for (const rejection of [{status:422,code:'VALIDATION'},{status:409,code:'RECHECK_CANCELLED'},{status:409,code:'LOOKUP_EXISTS'}]) test(`A definitive ${rejection.code} recheck rejection releases its request identity`,async({page})=>{
  await session(page);const ids:string[]=[];
  const fresh:any={...baseJob,_id:freshId,generationId:undefined,repeatedFrom:jobId};
  await page.route(`**/api/v4/purchases/${freshId}`,r=>r.fulfill({json:fresh}));
  await page.route(`**/api/v4/purchases/${freshId}/summary`,r=>r.fulfill({json:summary(fresh,false)}));
  await page.route(`**/api/v4/purchases/${freshId}/results?*`,r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:100}}));
  await page.route(`**/api/v4/lookups/${freshId}/progress?*`,r=>r.fulfill({json:progress(fresh,true,false)}));
  await page.route(`**/api/v4/lookups/${jobId}/recheck`,r=>{
    ids.push(r.request().postDataJSON().importId);
    return ids.length===1 ? r.fulfill({status:rejection.status,json:{code:rejection.code,message:'Rejeição definitiva sintética.'}}) : r.fulfill({json:fresh});
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(guidedUrl);
  await page.getByRole('button',{name:'Consultar CNPJs novamente'}).click();
  await expect(page.locator('[data-recheck-error]')).toContainText('Rejeição definitiva');
  await page.getByRole('button',{name:'Consultar CNPJs novamente'}).click();
  await expect(page).toHaveURL(new RegExp(`job=${freshId}`));
  expect(ids).toHaveLength(2);expect(ids[1]).not.toBe(ids[0]);
  await expect(page.getByRole('heading',{name:'Total de compras do relatório'})).toBeVisible();
});
