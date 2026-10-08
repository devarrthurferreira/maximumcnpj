import { test, expect } from '@playwright/test';

test('Maximum: logo oficial no login desktop e móvel',async({page})=>{
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:null,version:'0.18.1'}}));
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

test('Maximum: dock lateral flutuante mantém ícones centralizados e recolhimento elegante',async({page})=>{
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:{_id:'visual-test',name:'Demonstração visual',email:'visual@example.test',role:'viewer'},version:'0.18.1'}});
    if(path==='/api/v4/clients')return route.fulfill({json:{items:[]}});
    if(path==='/api/v4/dashboard')return route.fulfill({json:{metrics:{total:0,optants:0,nonOptants:0,unknown:0,optantsPercent:0,nonOptantsPercent:0,unknownPercent:0,coverage:0},recent:[],entities:0,clientCount:0}});
    return route.fulfill({status:404,json:{message:'Rota não prevista no teste visual'}});
  });

  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  const sidebar=page.locator('.sidebar');
  await expect(sidebar).toHaveCSS('width','84px');
  await expect(sidebar).toHaveCSS('border-radius','28px');
  const rail=await sidebar.boundingBox();
  expect(rail).not.toBeNull();
  expect(Math.round(rail!.x)).toBe(16);
  expect(Math.round(rail!.y)).toBe(16);
  expect(Math.round(rail!.height)).toBe(968);

  await expect(page.locator('.sidebar .maximum-logo')).toHaveCount(0);
  await expect(page.locator('.sidebar .nav-label')).toHaveCount(0);
  await expect(page.locator('.sidebar .navigation-dock')).toBeVisible();
  await expect(page.locator('.sidebar .navigation-start')).toBeVisible();
  await expect(page.locator('.sidebar .navigation-start')).toHaveAttribute('aria-label','Iniciar');

  const centers=await page.locator('.sidebar .navigation-item').evaluateAll((items:any[])=>items.map(item=>{const r=item.getBoundingClientRect();return r.left+r.width/2;}));
  for(const center of centers)expect(Math.abs(center-(rail!.x+rail!.width/2))).toBeLessThanOrEqual(1);

  const toggle=page.locator('#toggle-nav');
  await expect(toggle).toHaveCSS('width','46px');
  await expect(toggle).toHaveCSS('border-radius','16px');
  await expect(toggle).toHaveAttribute('data-navigation-state','open');
  await expect(toggle).toHaveAttribute('aria-label','Recolher navegação');

  const start=page.locator('.sidebar .navigation-start'),tooltip=start.locator('.navigation-tooltip');
  await start.hover();
  await expect(tooltip).toHaveCSS('visibility','visible');
  await expect(tooltip).toHaveCSS('opacity','1');
  await expect(tooltip).toHaveText('Iniciar');
  expect(await tooltip.boundingBox()).not.toBeNull();
  await page.screenshot({path:'test-results/maximum-brand/navbar-dock-flutuante.png',fullPage:true});

  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/navigation-hidden/);
  await expect(toggle).toHaveAttribute('data-navigation-state','closed');
  await expect(toggle).toHaveAttribute('aria-label','Abrir navegação');
  await expect.poll(async()=>Math.round((await sidebar.boundingBox())?.x??0)).toBeLessThan(-70);
  await toggle.click();
  await expect(page.locator('body')).not.toHaveClass(/navigation-hidden/);
  await expect(toggle).toHaveAttribute('data-navigation-state','open');

  await page.setViewportSize({width:390,height:844});await page.reload();
  await page.locator('#toggle-nav').click();
  await expect(page.locator('body')).toHaveClass(/mobile-open/);
  const mobileRail=await page.locator('.sidebar').boundingBox();
  expect(mobileRail).not.toBeNull();
  expect(Math.round(mobileRail!.x)).toBe(12);
  expect(Math.round(mobileRail!.y)).toBe(12);
  await expect(page.locator('.navigation-overlay')).toBeVisible();
  await expect(page.locator('.sidebar .navigation-start')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.navigation-overlay').click();
  await expect(page.locator('body')).not.toHaveClass(/mobile-open/);
});
