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
