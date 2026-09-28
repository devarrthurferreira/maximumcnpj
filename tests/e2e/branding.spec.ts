import { test, expect } from '@playwright/test';

test('Maximum: logo oficial no login desktop e móvel',async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null,version:'0.5.1'}}));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:950});await page.goto('/');
    const image=page.locator(width>1000?'.login-visual .maximum-logo':'.mobile-brand .maximum-logo');
    await expect(image).toBeVisible();
    await expect.poll(()=>image.evaluate((el:any)=>el.naturalWidth)).toBe(512);
    await expect(page.locator('#login-form button[type=submit]')).toHaveCSS('background-color','rgb(117, 2, 7)');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/maximum-brand/login-${width}.png`,fullPage:true});
  }
});

test('Maximum: marca da navegação preservada ao recolher o menu',async({page})=>{
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:{_id:'visual-test',name:'Demonstração visual',email:'visual@example.test',role:'viewer'},version:'0.5.1'}});
    if(path==='/api/v4/clients')return route.fulfill({json:{items:[]}});
    if(path==='/api/v4/dashboard')return route.fulfill({json:{metrics:{total:0,optants:0,nonOptants:0,unknown:0,optantsPercent:0,nonOptantsPercent:0,unknownPercent:0,coverage:0},recent:[],entities:0,clientCount:0}});
    return route.fulfill({status:404,json:{message:'Rota não prevista no teste visual'}});
  });
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await expect(page.locator('.sidebar .maximum-logo')).toBeVisible();
  await expect(page.locator('.metric.featured')).toHaveCSS('background-color','rgb(117, 2, 7)');
  await page.screenshot({path:'test-results/maximum-brand/painel-demonstracao.png',fullPage:true});
  await page.locator('#toggle-nav').click();
  await expect(page.locator('.sidebar .maximum-symbol')).toBeVisible();
  await expect(page.locator('.sidebar .maximum-logo')).toBeHidden();
});
