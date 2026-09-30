import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000070';
const company=(suffix:string,name:string,code:string)=>({_id:`00000000-0000-4000-8000-0000000000${suffix}`,name,code,active:true,cnpj:'11222333000181'});
const clients=[company('21','EMPRESA PRIMEIRA','936'),company('22','EMPRESA SEGUNDA','868'),company('23','OUTRA EMPRESA','101')];
const base={_id:id,companyCount:2,completedCount:1,missingCount:1,inProgressCount:0,status:'IN_PROGRESS',createdAt:'2026-09-29T15:00:00Z',salesAvailable:true,companies:clients.slice(0,2).map((c,i)=>({clientId:c._id,name:c.name,code:c.code,purchaseJobIds:i?[]:['00000000-0000-4000-8000-000000000071'],purchaseJobId:i?null:'00000000-0000-4000-8000-000000000071',status:i?'MISSING':'COMPLETED',purchase:i?null:{_id:'00000000-0000-4000-8000-000000000071',status:'COMPLETED',fileName:'936-COMPRAS.csv'}}))};
async function session(page:any,mustChangePassword=false){await page.route('**/api/auth/session',(r:any)=>r.fulfill({json:{user:{_id:'test',name:'Equipe Teste',email:'teste@example.com',role:'operator',mustChangePassword}}}));await page.route('**/api/v4/clients',(r:any)=>r.fulfill({json:{items:clients}}));}
test('Generation selects multiple companies and preserves a draft with missing purchases',async({page},testInfo)=>{
 await session(page);let created:any;const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.route(/\/api\/v4\/generations(?:[/?]|$)/,r=>{if(r.request().method()==='POST'){created=r.request().postDataJSON();return r.fulfill({json:{...base,_id:created.generationId}});}return r.fulfill({json:{...base,_id:created?.generationId||id,requiredReports:created?.requiredReports||['PURCHASES'],completedCount:0,missingCount:2,companies:base.companies.map(c=>({...c,status:'MISSING',salesJobId:null,sales:null}))}});});
 await page.goto('/generations.html');await expect(page.locator('.nav a')).toHaveText(['Início','Empresas','Iniciar','Histórico']);
 await expect(page.getByRole('button',{name:'Continuar com as empresas'})).toBeDisabled();
 await page.getByLabel('Buscar empresas').fill('936');await page.locator('.generation-company-option input').check();
 await page.getByLabel('Buscar empresas').fill('868');await page.locator('.generation-company-option input').check();
 await expect(page.locator('#generation-selection-count')).toHaveText('2 selecionada(s)');
 await page.getByLabel('Buscar empresas').fill('');
 const startShot=testInfo.outputPath('geracao-iniciar-desktop.png');await page.screenshot({path:startShot,fullPage:true});await testInfo.attach('Seleção de empresas',{path:startShot,contentType:'image/png'});
 await page.getByRole('button',{name:'Continuar com as empresas'}).click();await expect(page.getByRole('heading',{name:'0 de 2 empresas concluídas'})).toBeVisible();expect(created.clientIds).toEqual(clients.slice(0,2).map(c=>c._id));expect(created.requiredReports).toEqual(['PURCHASES','SALES']);
 await expect(page.locator('[data-report-slot="SALES"] a')).toHaveCount(2);await expect(page.locator('[data-report-slot="SALES"] a').first()).toHaveAttribute('href',/type=SALES/);await expect(page.getByRole('button',{name:'Baixar relatório completo PDF'})).toBeDisabled();
 const add=page.locator('[data-report-slot="PURCHASES"]').getByRole('link',{name:'Adicionar relatório',exact:true});await expect(add).toHaveAttribute('href',new RegExp(`generation=${created.generationId}&client=${clients[1]._id}`));
 await page.setViewportSize({width:390,height:844});const mobile=testInfo.outputPath('geracao-mobile.png');await page.screenshot({path:mobile,fullPage:true});await testInfo.attach('Geração mobile',{path:mobile,contentType:'image/png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Alternar navegação'}).click();await expect(page.getByRole('link',{name:'Histórico',exact:true})).toBeVisible();expect(pageErrors).toEqual([]);
});
test('History resumes missing reports then downloads only the completed generation',async({page},testInfo)=>{
 await session(page);let complete=false,pdfBody:any;
 await page.route(/\/api\/v4\/generations(?:[/?]|$)/,r=>{const g=complete?{...base,status:'COMPLETED',completedCount:2,missingCount:0,companies:base.companies.map(c=>({...c,status:'COMPLETED',purchaseJobId:'00000000-0000-4000-8000-000000000071',purchase:{_id:'00000000-0000-4000-8000-000000000071',status:'COMPLETED',fileName:c.code+'-COMPRAS.csv'}}))}:base;return r.fulfill({json:new URL(r.request().url()).pathname==='/api/v4/generations'?{items:[g],total:1,page:1,pageSize:20}:g});});
 await page.route('**/api/reports',r=>{pdfBody=r.request().postDataJSON();return r.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="geracao-completa.pdf"'},body:'%PDF-1.4\n%%EOF'});});
 await page.goto('/generations.html?view=history');await expect(page.locator('.generation-history-item')).toContainText('1 de 2 empresas concluídas');await expect(page.getByRole('link',{name:'Compras anteriores'})).toHaveAttribute('href','/purchases.html');
 const screenshot=testInfo.outputPath('historico-desktop.png');await page.screenshot({path:screenshot,fullPage:true});await testInfo.attach('Histórico de gerações',{path:screenshot,contentType:'image/png'});
 await page.locator('.generation-history-item').click();await expect(page.getByRole('link',{name:'Adicionar relatório',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Baixar relatório completo PDF'})).toBeDisabled();await expect(page.getByRole('link',{name:'Adicionar vendas',exact:true})).toHaveCount(2);
 complete=true;await page.getByRole('button',{name:'Atualizar situação'}).click();await expect(page.getByRole('heading',{name:'Sua geração está completa.'})).toBeVisible();
 const done=testInfo.outputPath('geracao-concluida-desktop.png');await page.screenshot({path:done,fullPage:true});await testInfo.attach('Geração concluída',{path:done,contentType:'image/png'});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar relatório completo PDF'}).click();expect((await download).suggestedFilename()).toBe('geracao-completa.pdf');expect(pdfBody).toEqual({action:'generation-pdf',generationId:id,part:1});
});
test('Generation gates company access until compulsory password reset',async({page})=>{let reads=0;await session(page,true);await page.route('**/api/v4/clients',r=>{reads++;return r.fulfill({json:{items:clients}});});await page.goto('/generations.html');await expect(page.getByRole('heading',{name:'Redefina sua senha para continuar'})).toBeVisible();await expect(page.locator('#generation-company-list')).toHaveCount(0);expect(reads).toBe(0);});


test('Generation can require only sales and cannot start without any report type',async({page})=>{
 await session(page);let created:any;
 await page.route(/\/api\/v4\/generations(?:[/?]|$)/,r=>{if(r.request().method()==='POST')created=r.request().postDataJSON();return r.fulfill({json:{...base,_id:created?.generationId||id,requiredReports:['SALES'],companyCount:1,completedCount:0,missingCount:1,companies:[{clientId:clients[0]._id,name:clients[0].name,code:clients[0].code,status:'MISSING',purchase:null,sales:null}]}});});
 await page.goto('/generations.html');await page.getByLabel('Buscar empresas').fill('936');await page.locator('.generation-company-option input').check();
 await page.locator('[data-report-choice][value="PURCHASES"]').uncheck();await page.locator('[data-report-choice][value="SALES"]').uncheck();await expect(page.getByRole('button',{name:'Continuar com as empresas'})).toBeDisabled();
 await page.locator('[data-report-choice][value="SALES"]').check();await page.getByRole('button',{name:'Continuar com as empresas'}).click();await expect(page.getByRole('heading',{name:'0 de 1 empresas concluídas'})).toBeVisible();expect(created.requiredReports).toEqual(['SALES']);
 await expect(page.locator('[data-report-slot="SALES"]')).toContainText('Adicionar relatório');await expect(page.locator('[data-report-slot="PURCHASES"]')).toContainText('Opcional');await expect(page.locator('[data-report-slot="SALES"] a')).toHaveAttribute('href',/type=SALES/);await expect(page.getByRole('button',{name:'Baixar relatório completo PDF'})).toBeDisabled();
});

test('Simulator unlocks only the two completed reports of the same company',async({page})=>{
 await session(page);let salesStatus='PROCESSING';
 await page.route('**/api/v4/generations/'+id,r=>r.fulfill({json:{...base,requiredReports:['PURCHASES','SALES'],completedCount:0,companies:[
  {...base.companies[0],status:'IN_PROGRESS',salesJobId:'00000000-0000-4000-8000-000000000073',sales:{_id:'00000000-0000-4000-8000-000000000073',status:salesStatus,fileName:'936-VENDAS.csv',received:3,summary:{unique:7}}},
  {...base.companies[1],status:'IN_PROGRESS',salesJobId:'00000000-0000-4000-8000-000000000074',sales:{_id:'00000000-0000-4000-8000-000000000074',status:'COMPLETED',fileName:'868-VENDAS.csv'}}
 ]}}));
 await page.goto('/generations.html?id='+id);
 await expect(page.getByRole('button',{name:'Ir para o simulador',exact:true})).toHaveCount(2);
 await expect(page.getByRole('link',{name:'Ir para o simulador'})).toHaveCount(0);
 const first=page.locator(`[data-simulator-client="${clients[0]._id}"]`),second=page.locator(`[data-simulator-client="${clients[1]._id}"]`);
 await expect(first).toContainText('1 de 2 relatórios concluídos');await expect(second).toContainText('1 de 2 relatórios concluídos');
 salesStatus='COMPLETED';await page.getByRole('button',{name:'Atualizar situação'}).click();
 await expect(first.getByRole('link',{name:'Ir para o simulador'})).toHaveAttribute('href',`/simulator.html?generation=${id}&client=${clients[0]._id}`);
 await expect(second.getByRole('button',{name:'Ir para o simulador'})).toBeDisabled();
});
