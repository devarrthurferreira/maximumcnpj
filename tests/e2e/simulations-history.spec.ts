import {test,expect} from '@playwright/test';
const item={_id:'00000000-0000-4000-8000-000000000001',title:'Cenário com novas despesas',company:{code:'936',name:'EMPRESA DE TESTE'},year:2027,createdAt:'2026-09-30T16:00:00Z',createdBy:{id:'operator',name:'Equipe Teste'},annualRevenue:120000,bestRegimeId:'pure',bestRegimeName:'Simples Puro',bestAnnualProfit:50000,manuallyAdjusted:true,reportMonths:1};
async function session(page:any,user:any={_id:'operator',role:'operator',name:'Teste'}){await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user}}));}
test('Simulation history searches, filters, paginates and exposes direct detail links on desktop/mobile',async({page},info)=>{
 await session(page);const queries:URLSearchParams[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v4/simulations?*',r=>{const params=new URL(r.request().url()).searchParams;queries.push(params);const filtered=!!params.get('search');return r.fulfill({json:{items:[{...item,year:Number(params.get('year')||2027)}],total:filtered?1:21,page:Number(params.get('page')),pageSize:20}});});
 await page.goto('/simulations.html');await expect(page.getByRole('heading',{name:'21 simulações salvas'})).toBeVisible();await expect(page.locator('[data-navigation="simulations"]')).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('link',{name:'Rever simulação'})).toHaveAttribute('href','/simulator.html?simulation='+item._id);await expect(page.locator('.history-item')).toContainText('VALORES AJUSTADOS');
 await page.getByRole('button',{name:'Próxima',exact:true}).click();await expect(page.locator('.history-pager')).toContainText('Página 2 de 2');expect(queries.at(-1)?.get('page')).toBe('2');
 await page.getByLabel('Buscar simulações').fill('936');await page.getByRole('button',{name:'Buscar',exact:true}).click();await expect(page.getByRole('heading',{name:'1 simulação salva'})).toBeVisible();expect(queries.at(-1)?.get('search')).toBe('936');expect(queries.at(-1)?.get('page')).toBe('1');
 await page.getByLabel('Ano do cenário').selectOption('2028');await expect(page.locator('.history-tags')).toContainText('2028');expect(queries.at(-1)?.get('year')).toBe('2028');
 const desktop=info.outputPath('historico-simulacoes-desktop.png');await page.screenshot({path:desktop,fullPage:true});await info.attach('Histórico de simulações',{path:desktop,contentType:'image/png'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const mobile=info.outputPath('historico-simulacoes-mobile.png');await page.screenshot({path:mobile,fullPage:true});await info.attach('Histórico mobile',{path:mobile,contentType:'image/png'});expect(errors).toEqual([]);
});
test('History handles empty data, escaped titles, server failure and session gate without showing stale items',async({page})=>{
 await session(page);let failure=true;
 await page.route('**/api/v4/simulations?*',r=>failure?r.fulfill({status:503,json:{message:'Falha temporária'}}):r.fulfill({json:{items:[],total:0,page:1,pageSize:20}}));
 await page.goto('/simulations.html');await expect(page.locator('#simulations-error')).toContainText('Falha temporária');failure=false;await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(page.getByRole('heading',{name:'Seu histórico começa aqui.'})).toBeVisible();
 await page.route('**/api/v4/simulations?*',r=>r.fulfill({json:{items:[{...item,title:'<img src=x onerror=alert(1)>',company:{code:'936',name:'<script>bad</script>'},bestAnnualProfit:null,bestRegimeName:null}],total:1,page:1,pageSize:20}}));await page.reload();await expect(page.locator('.history-title')).toHaveText('<img src=x onerror=alert(1)>');await expect(page.locator('.history-title img')).toHaveCount(0);await expect(page.locator('.history-financials')).toContainText('Sem ranking neste cenário');
 await session(page,null);await page.reload();await expect(page.getByRole('heading',{name:'Entre para continuar'})).toBeVisible();await expect(page.locator('.history-item')).toHaveCount(0);
});
test('Cancelar exclusão não envia DELETE e devolve foco no desktop e celular',async({page},info)=>{
 await session(page);let deletes=0;
 await page.route('**/api/v4/simulations?*',r=>r.fulfill({json:{items:[item],total:1,page:1,pageSize:20}}));
 await page.route('**/api/v4/simulations/*',r=>{if(r.request().method()==='DELETE')deletes++;return r.fulfill({json:{deleted:true,id:item._id}});});
 await page.goto('/simulations.html');
 const remove=page.locator(`[data-delete-simulation="${item._id}"]`),dialog=page.getByRole('dialog',{name:'Excluir simulação?'});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await remove.click();
  await expect(dialog).toBeVisible();await expect(page.locator('#delete-simulation-cancel')).toBeFocused();
  await expect(page.locator('#delete-simulation-company')).toContainText(item.company.name);
  await expect(page.locator('#delete-simulation-title')).toHaveText(item.title);
  await expect(page.locator('#delete-simulation-year')).toContainText(String(item.year));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const shot=info.outputPath(`excluir-confirmacao-${width}.png`);await page.screenshot({path:shot});await info.attach(`Confirmação de exclusão ${width}`,{path:shot,contentType:'image/png'});
  if(width===1440)await page.locator('#delete-simulation-cancel').click();else await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();await expect(remove).toBeFocused();await expect(page.locator('.history-item')).toHaveCount(1);
 }
 expect(deletes).toBe(0);
});
test('Exclusão confirma somente o item escolhido, impede duplicação e permite repetir após falha',async({page})=>{
 await session(page,{_id:'admin',role:'admin',name:'Teste'});
 const other={...item,_id:'00000000-0000-4000-8000-000000000002',title:'Cenário preservado',company:{code:'937',name:'OUTRA EMPRESA'}};
 let items=[other,item];const deletions:string[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/v4/simulations?*',r=>r.fulfill({json:{items,total:items.length,page:1,pageSize:20}}));
 await page.route('**/api/v4/simulations/*',async r=>{
  expect(r.request().method()).toBe('DELETE');deletions.push(new URL(r.request().url()).pathname);
  if(deletions.length===1){await gate;return r.fulfill({status:503,json:{message:'Falha temporária na exclusão. Tente novamente.'}});}
  items=[other];return r.fulfill({json:{deleted:true,id:item._id}});
 });
 await page.goto('/simulations.html');await page.locator(`[data-delete-simulation="${item._id}"]`).click();
 const dialog=page.getByRole('dialog',{name:'Excluir simulação?'}),confirm=page.locator('#delete-simulation-confirm');
 const started=page.waitForRequest(r=>r.method()==='DELETE');await confirm.click();await started;
 try{
  await expect(confirm).toBeDisabled();await expect(page.locator('#delete-simulation-cancel')).toBeDisabled();
  await page.keyboard.press('Enter');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  expect(deletions).toEqual([`/api/v4/simulations/${item._id}`]);
 }finally{release();}
 await expect(page.locator('#delete-simulation-error')).toContainText('Falha temporária');
 await expect(page.locator('.history-item')).toHaveCount(2);await expect(confirm).toBeEnabled();
 await confirm.click();await expect(dialog).toBeHidden();
 await expect(page.locator('.history-item')).toHaveCount(1);await expect(page.locator('.history-item')).toContainText(other.title);
 await expect(page.locator('#history-feedback')).toContainText('excluída');
 expect(deletions).toEqual([`/api/v4/simulations/${item._id}`,`/api/v4/simulations/${item._id}`]);
});
test('Excluir último item da página volta à página válida e conserva empresa, busca e ano',async({page})=>{
 await session(page);const clientId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';let deleted=false;const queries:URLSearchParams[]=[];
 const remaining=Array.from({length:20},(_,index)=>({...item,_id:`00000000-0000-4000-8000-${String(index+10).padStart(12,'0')}`,title:`Cenário preservado ${index+1}`,year:2028}));
 await page.route('**/api/v4/simulations?*',r=>{
  const params=new URL(r.request().url()).searchParams;queries.push(params);const pageNumber=Number(params.get('page'));
  return r.fulfill({json:{items:pageNumber===2?(deleted?[]:[{...item,year:2028}]):remaining,total:deleted?20:21,page:pageNumber,pageSize:20}});
 });
 await page.route('**/api/v4/simulations/*',r=>{expect(r.request().method()).toBe('DELETE');expect(new URL(r.request().url()).pathname).toBe(`/api/v4/simulations/${item._id}`);deleted=true;return r.fulfill({json:{deleted:true,id:item._id}});});
 await page.goto(`/simulations.html?page=2&clientId=${clientId}&search=936&year=2028`);
 await expect(page.locator('.history-pager')).toContainText('Página 2 de 2');
 await page.locator(`[data-delete-simulation="${item._id}"]`).click();await page.locator('#delete-simulation-confirm').click();
 await expect(page.locator('.history-pager')).toContainText('Página 1 de 1');await expect(page.locator('.history-item')).toHaveCount(20);
 await expect(page.getByRole('heading',{name:'20 simulações salvas'})).toBeFocused();
 await expect(page.getByLabel('Buscar simulações')).toHaveValue('936');await expect(page.getByLabel('Ano do cenário')).toHaveValue('2028');
 const params=new URL(page.url()).searchParams;expect(Object.fromEntries(params)).toEqual({page:'1',clientId,search:'936',year:'2028'});
 expect(queries.at(-1)?.get('page')).toBe('1');
 expect(queries.every(q=>q.get('clientId')===clientId&&q.get('search')==='936'&&q.get('year')==='2028')).toBe(true);
});
test('Perfil de leitura pode rever simulações sem receber controles de exclusão',async({page})=>{
 await session(page,{_id:'viewer',role:'viewer',name:'Leitura'});let deletes=0;
 await page.route('**/api/v4/simulations?*',r=>r.fulfill({json:{items:[item],total:1,page:1,pageSize:20}}));
 await page.route('**/api/v4/simulations/*',r=>{if(r.request().method()==='DELETE')deletes++;return r.fulfill({status:403,json:{message:'Sem permissão'}});});
 await page.goto('/simulations.html');await expect(page.getByRole('link',{name:'Rever simulação'})).toBeVisible();
 await expect(page.locator('[data-delete-simulation]')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);expect(deletes).toBe(0);
});
