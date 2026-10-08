import { test, expect } from '@playwright/test';

test('Maximum: logo oficial no login desktop e móvel',async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null,version:'0.18.0'}}));
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

test('Maximum: navegação compacta usa somente ícones, tooltips e destaque em Iniciar',async({page})=>{
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:{_id:'visual-test',name:'Demonstração visual',email:'visual@example.test',role:'viewer'},version:'0.18.0'}});
    if(path==='/api/v4/clients')return route.fulfill({json:{items:[]}});
    if(path==='/api/v4/dashboard')return route.fulfill({json:{metrics:{total:0,optants:0,nonOptants:0,unknown:0,optantsPercent:0,nonOptantsPercent:0,unknownPercent:0,coverage:0},recent:[],entities:0,clientCount:0}});
    return route.fulfill({status:404,json:{message:'Rota não prevista no teste visual'}});
  });

  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCSS('width','92px');
  await expect(page.locator('.sidebar .maximum-logo')).toHaveCount(0);
  await expect(page.locator('.sidebar .nav-label')).toHaveCount(0);
  await expect(page.locator('.sidebar .navigation-start')).toBeVisible();
  await expect(page.locator('.sidebar .navigation-start')).toHaveAttribute('aria-label','Iniciar');
  await expect(page.locator('#toggle-nav')).toHaveAttribute('aria-label','Ocultar navegação');
  const sizes=await page.locator('.sidebar [data-navigation="overview"],.sidebar .navigation-start').evaluateAll((items:any[])=>items.map(item=>item.getBoundingClientRect().width));
  expect(sizes[1]).toBeGreaterThan(sizes[0]);
  const start=page.locator('.sidebar .navigation-start'),tooltip=start.locator('.navigation-tooltip');
  await start.hover();
  await expect(tooltip).toHaveCSS('visibility','visible');
  await expect(tooltip).toHaveCSS('opacity','1');
  await expect(tooltip).toHaveText('Iniciar');
  expect(await tooltip.boundingBox()).not.toBeNull();
  await page.screenshot({path:'test-results/maximum-brand/painel-navegacao-compacta.png',fullPage:true});

  await page.locator('#toggle-nav').click();
  await expect(page.locator('body')).toHaveClass(/navigation-hidden/);
  await expect(page.locator('#toggle-nav')).toHaveAttribute('aria-label','Abrir navegação');
  await page.locator('#toggle-nav').click();
  await expect(page.locator('body')).not.toHaveClass(/navigation-hidden/);

  await page.setViewportSize({width:390,height:844});await page.reload();
  await page.locator('#toggle-nav').click();
  await expect(page.locator('body')).toHaveClass(/mobile-open/);
  await expect(page.locator('.sidebar .navigation-start')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
