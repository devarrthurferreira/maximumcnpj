import {test,expect} from '@playwright/test';
const jobId='00000000-0000-4000-8000-000000000001',clientId='00000000-0000-4000-8000-000000000002';
const job={_id:jobId,clientId,clientCode:'000',clientName:'EMPRESA TESTE',fileName:'fixture.csv',completedAt:'2026-09-28T12:00:00Z',summary:{lines:1005,unique:1001,duplicates:3,invalid:1}};
test('Relatórios por empresa: grupos, partes, busca e download',async({page})=>{
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'test',role:'viewer'}}}));
 await page.route('**/api/v4/clients',r=>r.fulfill({json:{items:[{_id:clientId,code:'000',name:'EMPRESA TESTE',active:true}]}}));
 await page.route('**/api/reports',async route=>{
  const p=route.request().postDataJSON();
  if(p.action==='jobs')return route.fulfill({json:{items:[job],total:1,page:1}});
  if(p.action==='summary')return route.fulfill({json:{job,total:1001,denominator:1001,kind:'ALL',pdfPartSize:500,csvPartSize:2000,groups:[{status:'OPTANTE',label:'Optantes',count:1000,percent:99.9},{status:'NAO_OPTANTE',label:'Não optantes',count:1,percent:0.1},{status:'NAO_CONFIRMADO',label:'Não confirmados',count:0,percent:0}]}});
  if(p.action==='rows')return route.fulfill({json:{items:p.status==='NAO_CONFIRMADO'?[]:[{cnpj:'11222333000181',submittedName:'EMPRESA FICTÍCIA',status:p.status==='NAO_OPTANTE'?'NAO_OPTANTE':'OPTANTE',occurrences:1,details:{name:'API TESTE'}}],total:p.status==='NAO_CONFIRMADO'?0:1,parts:1,page:1}});
  expect(p.search).toBeUndefined();
  return route.fulfill({status:200,contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="relatorio-fixture.pdf"'},body:'%PDF-1.4\n%%EOF'});
 });
 await page.goto('/reports.html');await page.getByLabel('Empresa responsável (Código / ID)').selectOption(clientId);
 await expect(page.getByRole('heading',{name:'Todos os CNPJs · Todos os tipos'})).toBeVisible();
 await expect(page.locator('#pdf-part option')).toHaveCount(3);
 await page.getByRole('button',{name:/Não optantes/}).click();await expect(page.locator('#pdf-part option')).toHaveCount(1);
 await expect(page.locator('#group-title')).toContainText('Não optante');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar resumo PDF'}).click();expect((await dl).suggestedFilename()).toBe('relatorio-fixture.pdf');
 await page.getByRole('button',{name:/Não confirmados/}).click();await expect(page.getByText('Nenhum resultado neste filtro')).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('Relatórios não abrem para visitante sem sessão',async({page})=>{
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:null}}));
 await page.goto('/reports.html');await expect(page.getByRole('heading',{name:'Entre para continuar'})).toBeVisible();
 await expect(page.getByLabel('Empresa responsável (Código / ID)')).toHaveCount(0);
});
