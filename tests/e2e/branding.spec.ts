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

async function mockWorkspace(page:any) {
  await page.route('**/api/**',(route:any)=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{user:{_id:'visual-test',name:'Demonstração visual',email:'visual@example.test',role:'viewer'},version:'0.18.1'}});
    if(path==='/api/v4/clients')return route.fulfill({json:{items:[]}});
    if(path==='/api/v4/dashboard')return route.fulfill({json:{metrics:{total:0,optants:0,nonOptants:0,unknown:0,optantsPercent:0,nonOptantsPercent:0,unknownPercent:0,coverage:0},recent:[],entities:0,clientCount:0}});
    return route.fulfill({status:404,json:{message:'Rota não prevista no teste visual'}});
  });
}

test('Maximum: navegação compacta expande rótulos e preserva a preferência entre páginas',async({page})=>{
  await mockWorkspace(page);
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  const sidebar=page.locator('.sidebar'),toggle=page.locator('#toggle-nav');
  await expect(sidebar).toHaveCSS('width','72px');
  await expect(sidebar).toHaveCSS('border-radius','0px');
  const rail=await sidebar.boundingBox();
  expect(rail).not.toBeNull();expect(rail!.x).toBe(0);expect(rail!.y).toBe(0);
  expect(rail!.height).toBe(1000);
  await expect(page.locator('.navigation-brand-copy')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toHaveAttribute('data-navigation-action','Expandir navegação');
  const centers=await page.locator('.sidebar .navigation-icon').evaluateAll((items:any[])=>items.map(item=>{const r=item.getBoundingClientRect();return r.left+r.width/2;}));
  for(const center of centers)expect(Math.abs(center-rail!.width/2)).toBeLessThanOrEqual(1);
  const start=page.locator('.navigation-start');
  await expect(start).toHaveAttribute('href','/generations.html');
  await start.hover();await expect(start.locator('.navigation-label')).toBeVisible();
  await expect(start.locator('.navigation-label')).toHaveText('Iniciar');
  await expect(sidebar).toHaveCSS('width','72px');
  await page.screenshot({path:'test-results/maximum-brand/navbar-compacta.png',fullPage:true});

  await toggle.click();
  await expect(sidebar).toHaveCSS('width','232px');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(toggle).toHaveAttribute('data-navigation-action','Recolher navegação');
  await expect(page.locator('.navigation-brand-copy')).toBeVisible();
  await expect(page.locator('.navigation-user-copy')).toContainText('Demonstração visual');
  await expect(page.locator('.sidebar .nav a')).toHaveText(['Início','Empresas','Iniciar','Histórico','Simulações']);
  await page.locator('.navigation-item[data-navigation=clients]').click();
  await expect(page.locator('[data-navigation=clients]')).toHaveAttribute('aria-current','page');
  await page.screenshot({path:'test-results/maximum-brand/navbar-expandida.png',fullPage:true});
  await page.reload();await expect(sidebar).toHaveCSS('width','232px');
  await toggle.click();await expect(sidebar).toHaveCSS('width','72px');
  await page.reload();await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Maximum: gaveta móvel tem rótulos, foco contido e fecha por Esc, botão, link e overlay',async({page})=>{
  await mockWorkspace(page);
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const toggle=page.locator('#toggle-nav'),sidebar=page.locator('.sidebar');
  await expect(sidebar).toBeHidden();
  await expect(sidebar).toHaveJSProperty('inert',true);
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('role','dialog');
  await expect(sidebar).toHaveAttribute('aria-modal','true');
  await expect(page.locator('.navigation-close')).toBeFocused();
  await expect(page.locator('.main')).toHaveJSProperty('inert',true);
  await expect(sidebar).toHaveCSS('width','272px');
  await expect(sidebar).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.getByRole('link',{name:'Histórico',exact:true})).toBeVisible();
  await expect(page.locator('.navigation-profile')).toContainText('Demonstração visual');
  await page.locator('#logout').focus();await page.keyboard.press('Tab');
  await expect(page.locator('.navigation-rail-cap')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#logout')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/maximum-brand/navbar-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();await expect(toggle).toBeFocused();
  await expect(page.locator('.main')).toHaveJSProperty('inert',false);
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();await page.locator('.navigation-close').click();
  await expect(toggle).toBeFocused();await expect(sidebar).toBeHidden();
  await toggle.click();await page.locator('.navigation-overlay').click({position:{x:350,y:400}});
  await expect(toggle).toBeFocused();await expect(sidebar).toBeHidden();
  await toggle.click();await page.locator('[data-navigation=clients]').click();
  await expect(sidebar).toBeHidden();await expect(page.locator('.main')).toHaveJSProperty('inert',false);
  await expect(page.locator('[data-navigation=clients]')).toHaveAttribute('aria-current','page');
  await toggle.click();
  // Some browsers clear focus when the mobile close button disappears at the breakpoint.
  await page.locator('.navigation-close').evaluate((button:HTMLElement)=>button.blur());
  await page.setViewportSize({width:1440,height:900});
  await expect(sidebar).not.toHaveAttribute('aria-modal','true');
  await expect(page.locator('.main')).toHaveJSProperty('inert',false);
  await expect(toggle).toBeFocused();
});

test('Maximum: navegação continua utilizável sem armazenamento de preferências',async({page})=>{
  await mockWorkspace(page);
  await page.addInitScript(()=>{
    Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('Blocked','SecurityError');}});
    Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Blocked','SecurityError');}});
  });
  await page.goto('/');
  const toggle=page.locator('#toggle-nav');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
  await page.locator('[data-navigation=clients]').click();
  await expect(page.locator('[data-navigation=clients]')).toHaveAttribute('aria-current','page');
});
