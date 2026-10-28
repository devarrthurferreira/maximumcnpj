import {test, expect, type Page} from '@playwright/test';
import {REPROCESS_VERSION} from '../../public/simulation-reprocess-contract.js';

const originalId = '00000000-0000-4000-8000-000000000001';
const childId = '00000000-0000-4000-8000-000000000002';
const original = {_id:originalId, title:'Cenário original', company:{code:'936',name:'EMPRESA SINTÉTICA'}, year:2027,
  createdAt:'2026-10-01T12:00:00Z', createdBy:{name:'Equipe de teste'}, annualRevenue:120000, bestAnnualProfit:30000, bestRegimeName:'Simples Puro', reportMonths:3};
const completed = {version:REPROCESS_VERSION,modelVersion:'current',startedAt:'2026-10-19T12:00:00Z',updatedAt:'2026-10-19T12:01:00Z',
  total:4,counts:{queued:0,processing:0,ok:2,pending:1,failed:1},retryableFailed:1,inventoryComplete:true,hasMore:false,retryAfterMs:0,page:1,pageSize:100,totalPages:1,
  items:[
    {originalId,childId,status:'OK',code:'UPDATED',message:'Nova versão criada com serviços e DIFAL.',company:original.company,title:original.title},
    {originalId:'00000000-0000-4000-8000-000000000003',childId:null,status:'PENDING',code:'SOURCE_MISSING',message:'Relatório de vendas indisponível. Confira o original.',company:{code:'937',name:'EMPRESA PENDENTE'},title:'Precisa de conferência'},
    {originalId:'00000000-0000-4000-8000-000000000004',childId:null,status:'FAILED',code:'SOURCE_FAILED',message:'Não foi possível conferir o relatório.',company:{code:'938',name:'EMPRESA COM FALHA'},title:'Falha na conferência'}
  ]};
const queued = {...completed,counts:{queued:4,processing:0,ok:0,pending:0,failed:0},retryableFailed:0,hasMore:true,items:[]};

async function mockHistory(page:Page, role='operator') {
  await page.route('**/api/auth/session', route => route.fulfill({json:{user:{_id:'synthetic-user',role,name:'Teste'}}}));
  let reads=0;
  await page.route('**/api/v4/simulations?*', route => {
    reads++;
    return route.fulfill({json:{items:[original],total:1,page:1,pageSize:20}});
  });
  return ()=>reads;
}

for (const role of ['admin','operator']) test(`Histórico ${role} retoma lote automaticamente, preserva originais e informa pendências`, async({page}) => {
  const historyReads=await mockHistory(page,role), methods:string[]=[], bodies:unknown[]=[];
  let posts=0;
  await page.route('**/api/v4/simulations/reprocess', route => {
    methods.push(route.request().method());
    if(route.request().method()==='GET') return route.fulfill({json:queued});
    bodies.push(route.request().postDataJSON()); posts++;
    return route.fulfill({json:posts===1 ? {...completed,counts:{queued:1,processing:0,ok:1,pending:1,failed:1},hasMore:true} : completed});
  });
  await page.goto('/simulations.html?search=936&year=2027');
  const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  await expect(panel).toContainText('Esta revisão adota CBS de 11,3% como premissa.');
  await expect(panel).toContainText('Os originais conservam os valores e as alíquotas capturados.');
  expect(methods).toEqual(['GET','POST','POST']);expect(bodies).toEqual([{},{}]);
  await expect(panel.locator('[data-reprocess-count="ok"] dd')).toHaveText('2');
  await expect(panel.locator('[data-reprocess-count="pending"] dd')).toHaveText('1');
  await expect(panel.locator('[data-reprocess-count="failed"] dd')).toHaveText('1');
  await expect(panel.locator('details')).not.toHaveAttribute('open');
  await expect(page.locator(`[data-simulation-id="${originalId}"]`)).toBeVisible();
  await expect(page.getByLabel('Buscar simulações')).toHaveValue('936');
  await expect(page.getByLabel('Ano do cenário')).toHaveValue('2027');
  expect(historyReads()).toBe(2);
  await panel.getByText('Conferir pendências e versões',{exact:true}).click();
  await expect(panel.getByRole('link',{name:'Abrir versão atualizada'})).toHaveAttribute('href',`/simulator.html?simulation=${childId}`);
  await expect(panel.getByText('Relatório de vendas indisponível. Confira o original.',{exact:true})).toBeVisible();
  await expect(panel).not.toContainText('As simulações verificadas estão atualizadas.');
});

test('Perfil de leitura acompanha o lote com GET e pagina detalhes sem iniciar processamento', async({page}) => {
  await mockHistory(page,'viewer');const methods:string[]=[];
  await page.route(/\/api\/v4\/simulations\/reprocess(?:\?.*)?$/, route => {
    methods.push(route.request().method());
    const second=new URL(route.request().url()).searchParams.get('page')==='2';
    return route.fulfill({json:{...queued,page:second?2:1,totalPages:2,items:second ? [{...completed.items[1],company:{name:'<img src=x onerror=alert(1)>',code:'937'},message:'<script>bad</script>'}] : completed.items.slice(0,1)}});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel).toContainText('Seu acesso permite acompanhar');
  await expect(panel.locator('details')).not.toHaveAttribute('open');
  await panel.getByText('Conferir pendências e versões',{exact:true}).click();
  await panel.getByRole('button',{name:'Próximos detalhes'}).click();
  await expect(panel).toContainText('Página 2 de 2');
  await expect(panel.getByText('<script>bad</script>',{exact:true})).toBeVisible();
  await expect(panel.locator('img,script')).toHaveCount(0);expect(methods).toEqual(['GET','GET']);
  await expect(page.locator('[data-delete-simulation]')).toHaveCount(0);
  await page.setViewportSize({width:320,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('Pendência antiga de serviços em lote encerrado é atualizada automaticamente uma vez e preserva as versões já OK', async({page}) => {
  await mockHistory(page);
  await page.clock.install();
  const pendingId='00000000-0000-4000-8000-000000000003', migratedChildId='00000000-0000-4000-8000-000000000005';
  const pendingOriginal={...original,_id:pendingId,title:'Serviços adicionais informados no cenário antigo',company:{code:'937',name:'EMPRESA SINTÉTICA COM SERVIÇOS'}};
  const unchangedChild={...original,_id:childId,title:'Versão já atualizada'};
  const pendingItem={originalId:pendingId,childId:null,status:'PENDING',code:'SERVICE_REVENUE_AMBIGUOUS',message:'Receita de serviços informada manualmente. Conferência pendente.',company:pendingOriginal.company,title:pendingOriginal.title};
  const priorBatch={...completed,total:2,counts:{queued:0,processing:0,ok:1,pending:1,failed:0},retryableFailed:0,hasMore:false,
    items:[completed.items[0],pendingItem]};
  const migratedBatch={...priorBatch,counts:{queued:0,processing:0,ok:2,pending:0,failed:0},
    items:[completed.items[0],{...pendingItem,childId:migratedChildId,status:'OK',code:'UPDATED',message:'Nova versão criada com serviços importados e serviços adicionais do cenário original.'}]};
  let migrated=false,created=0,posts=0,release!:()=>void;
  const methods:string[]=[],bodies:unknown[]=[],gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/v4/simulations?*',route=>{
    const items=[original,unchangedChild,pendingOriginal,...(migrated?[{...pendingOriginal,_id:migratedChildId,title:'Serviços atualizados'}]:[])];
    return route.fulfill({json:{items,total:items.length,page:1,pageSize:20}});
  });
  await page.route('**/api/v4/simulations/reprocess',async route=>{
    methods.push(route.request().method());
    if(route.request().method()==='GET')return route.fulfill({json:migrated?migratedBatch:priorBatch});
    bodies.push(route.request().postDataJSON());posts++;
    if(posts===1)await gate;
    if(!migrated){migrated=true;created++;}
    return route.fulfill({json:migratedBatch});
  });
  await page.goto('/simulations.html');
  const panel=page.locator('#history-reprocess');
  try {
    await expect.poll(()=>posts).toBe(1);
    await expect(panel.locator('[data-reprocess-count="pending"] dd')).toHaveText('1');
    await expect(panel.locator('.history-reprocess-status')).toContainText('naturezas e créditos de ICMS');
    await expect(page.locator('#simulations-app details[open]')).toHaveCount(0);
    expect(methods).toEqual(['GET','POST']);expect(bodies).toEqual([{}]);
  } finally {release();}
  await expect(panel.getByRole('heading',{name:'Verificação concluída'})).toBeVisible();
  await expect(panel.locator('[data-reprocess-count="ok"] dd')).toHaveText('2');
  await expect(panel.locator('[data-reprocess-count="pending"] dd')).toHaveText('0');
  await expect(page.locator('#simulations-app details[open]')).toHaveCount(0);
  await expect(page.locator(`[data-simulation-id="${pendingId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-simulation-id="${migratedChildId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-simulation-id="${childId}"]`)).toHaveCount(1);
  await panel.getByText('Conferir pendências e versões',{exact:true}).click();
  await expect(panel.locator(`a[href="/simulator.html?simulation=${migratedChildId}"]`)).toBeVisible();
  await expect(panel.locator(`a[href="/simulator.html?simulation=${childId}"]`)).toBeVisible();
  await page.clock.fastForward(10000);expect(posts).toBe(1);expect(created).toBe(1);

  await page.reload();
  await expect(panel.getByRole('heading',{name:'Verificação concluída'})).toBeVisible();
  await expect(page.locator('#simulations-app details[open]')).toHaveCount(0);
  await expect(page.locator(`[data-simulation-id="${migratedChildId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-simulation-id="${childId}"]`)).toHaveCount(1);
  await page.clock.fastForward(10000);
  expect(methods).toEqual(['GET','POST','GET','POST']);expect(bodies).toEqual([{},{}]);expect(created).toBe(1);
});

test('Falha de rede interrompe o lote e tentativa explícita retoma sem enviar dados de simulação', async({page}) => {
  await mockHistory(page);const methods:string[]=[],bodies:unknown[]=[];let posts=0;
  await page.route('**/api/v4/simulations/reprocess', route => {
    methods.push(route.request().method());
    if(route.request().method()==='GET')return route.fulfill({json:queued});
    bodies.push(route.request().postDataJSON());posts++;
    return posts===1 ? route.fulfill({status:503,json:{message:'Falha temporária ao confirmar a atualização.'}}) : route.fulfill({json:completed});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('heading',{name:'Atualização interrompida'})).toBeVisible();
  await expect(panel).toContainText('Falha temporária');expect(posts).toBe(1);
  await panel.getByRole('button',{name:'Tentar atualização novamente'}).click();
  await expect(panel.getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  expect(methods).toEqual(['GET','POST','GET','POST']);expect(bodies).toEqual([{},{}]);
});

test('Contrato desconhecido interrompe antes do POST e a versão atual permite retomar o lote', async({page}) => {
  const historyReads=await mockHistory(page),methods:string[]=[],bodies:unknown[]=[];
  let current=false;
  await page.route('**/api/v4/simulations/reprocess',route=>{
    const method=route.request().method();methods.push(method);
    if(method==='GET')return route.fulfill({json:current?queued:{...queued,version:'UNKNOWN_REPROCESS_REVISION'}});
    bodies.push(route.request().postDataJSON());return route.fulfill({json:completed});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('heading',{name:'Atualização interrompida'})).toBeVisible();
  await expect(panel).toContainText('O servidor não confirmou o andamento da atualização.');
  await expect(panel.locator('[data-reprocess-count="ok"] dd')).toHaveText('—');
  expect(methods).toEqual(['GET']);expect(bodies).toEqual([]);expect(historyReads()).toBe(1);
  current=true;await panel.getByRole('button',{name:'Tentar atualização novamente'}).click();
  await expect(panel.getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  await expect(panel.locator('[data-reprocess-count="ok"] dd')).toHaveText('2');
  await expect(page.locator(`[data-simulation-id="${originalId}"]`)).toBeVisible();
  expect(methods).toEqual(['GET','GET','POST']);expect(bodies).toEqual([{}]);expect(historyReads()).toBe(2);
});

test('Sessão expirada interrompe o reprocessamento e não oferece nova tentativa de escrita', async({page}) => {
  await mockHistory(page);let posts=0;
  await page.route('**/api/v4/simulations/reprocess', route => {
    if(route.request().method()==='GET')return route.fulfill({json:queued});
    posts++;return route.fulfill({status:401,json:{message:'Sessão expirada'}});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('link',{name:'Entrar novamente'})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Tentar atualização novamente'})).toHaveCount(0);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));expect(posts).toBe(1);
});

test('Falhas finais só voltam ao processamento por ação explícita, sem repetir pendências automaticamente', async({page}) => {
  await mockHistory(page);const bodies:unknown[]=[];
  await page.route('**/api/v4/simulations/reprocess', route => {
    if(route.request().method()==='GET')return route.fulfill({json:completed});
    const body=route.request().postDataJSON();bodies.push(body);
    return route.fulfill({json:body.retryFailed ? {...completed,counts:{queued:0,processing:0,ok:3,pending:1,failed:0},retryableFailed:0} : completed});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('button',{name:'Repetir simulações com falha'})).toBeVisible();
  expect(bodies).toEqual([{}]);
  await panel.getByRole('button',{name:'Repetir simulações com falha'}).click();
  await expect(panel.locator('[data-reprocess-count="failed"] dd')).toHaveText('0');
  await expect(panel.locator('[data-reprocess-count="pending"] dd')).toHaveText('1');
  await expect(panel.getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  expect(bodies).toEqual([{}, {retryFailed:true}]);
  await expect(panel.getByRole('button',{name:'Repetir simulações com falha'})).toHaveCount(0);
});

test('Falhas que atingiram o limite orientam conferência sem oferecer nova tentativa', async({page}) => {
  await mockHistory(page);const bodies:unknown[]=[];
  await page.route('**/api/v4/simulations/reprocess', route => {
    if(route.request().method()==='POST')bodies.push(route.request().postDataJSON());
    return route.fulfill({json:{...completed,retryableFailed:0}});
  });
  await page.goto('/simulations.html');const panel=page.locator('#history-reprocess');
  await expect(panel.getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  await expect(panel).toContainText('O limite de tentativas das simulações com falha foi alcançado.');
  await expect(panel).toContainText('Confira os registros e motivos nos detalhes.');
  await expect(panel.locator('[data-reprocess-count="failed"] dd')).toHaveText('1');
  await expect(panel.getByRole('button',{name:'Repetir simulações com falha'})).toHaveCount(0);
  expect(bodies).toEqual([{}]);
});

test('Ocultar a aba aborta o envio em andamento e voltar retoma o lote do servidor', async({page}) => {
  await mockHistory(page);let posts=0, release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/v4/simulations/reprocess', async route => {
    if(route.request().method()==='GET')return route.fulfill({json:queued});
    posts++;
    if(posts===1){await gate;await route.fulfill({json:{...queued,counts:{queued:1,processing:0,ok:1,pending:1,failed:1}}}).catch(()=>{});return;}
    return route.fulfill({json:completed});
  });
  await page.goto('/simulations.html');await expect.poll(()=>posts).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('#history-reprocess')).toContainText('Atualização pausada');
  release();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('#history-reprocess').getByRole('heading',{name:'Atualização encerrada com pendências'})).toBeVisible();
  expect(posts).toBe(2);
});


test('Versões concluídas aparecem no histórico mesmo quando uma etapa posterior falha',async({page})=>{
 let reads=0,posts=0;
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/simulations?*',route=>{
  reads++;
  const items=posts>=2?[{...original,updatedSimulationId:childId},{...original,_id:childId,title:'Versão mensal concluída',calculationMethod:'REPORT_MONTHS_V1'}]:[original];
  return route.fulfill({json:{items,total:items.length,page:1,pageSize:20}});
 });
 const partial={...queued,counts:{queued:3,processing:0,ok:1,pending:0,failed:0},items:[completed.items[0]]};
 await page.route('**/api/v4/simulations/reprocess',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:queued});
  posts++;
  return posts===1?route.fulfill({json:partial}):route.fulfill({status:503,json:{message:'Conexão interrompida após salvar a primeira revisão.'}});
 });
 await page.goto('/simulations.html?search=936&year=2027');
 const panel=page.locator('#history-reprocess');
 await expect(panel.getByRole('heading',{name:'Atualização interrompida'})).toBeVisible();
 await expect(panel.getByRole('progressbar',{name:'Progresso da revisão do histórico'})).toHaveAttribute('value','1');
 await expect(panel.getByRole('progressbar')).toHaveAttribute('max','4');
 await expect(panel).toContainText('1 de 4 processadas');await expect(panel).not.toContainText('Verificação concluída');
 await expect(page.locator(`[data-simulation-id="${childId}"]`)).toContainText('Versão mensal concluída');
 await expect(page.locator(`[data-simulation-id="${originalId}"]`).getByRole('link',{name:'Abrir versão atualizada'})).toBeVisible();
 await expect(page.getByLabel('Buscar simulações')).toHaveValue('936');await expect(page.getByLabel('Ano do cenário')).toHaveValue('2027');
 expect(reads).toBe(2);expect(posts).toBe(2);
});
