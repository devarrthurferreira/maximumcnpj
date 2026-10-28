import {test,expect} from '@playwright/test';

test('Empresas: setores preservam a empresa, busca aceita CNPJ formatado e paginação chega a todos os registros',async({page})=>{
 const companies=Array.from({length:61},(_,i)=>({_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,code:String(i+1),name:`Empresa sintética ${String(i+1).padStart(3,'0')}`,cnpj:i===60?'00000000000191':null,active:true}));
 await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{name:'Equipe sintética',role:'admin'}}}));
 await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:companies}}));
 await page.goto('/#clients');
 await expect(page.locator('.company-table tbody tr')).toHaveCount(50);
 await page.locator('#companies-next').click();
 await expect(page.locator('.company-table tbody tr')).toHaveCount(11);
 await page.getByRole('searchbox',{name:'Buscar empresa'}).fill('00.000.000/0001-91');
 const row=page.locator('.company-table tbody tr');
 await expect(row).toHaveCount(1);
 await expect(row).toContainText('Empresa sintética 061');
 await expect(row.getByRole('link',{name:'Fiscal de Empresa sintética 061',exact:true})).toHaveAttribute('href',`/analyses.html?client=${companies[60]._id}&sector=fiscal&entry=company`);
 await expect(row.getByRole('link',{name:'Contábil de Empresa sintética 061',exact:true})).toHaveAttribute('href',`/analyses.html?client=${companies[60]._id}&sector=accounting`);
 await expect(row.getByRole('link',{name:'Histórico de Empresa sintética 061',exact:true})).toHaveAttribute('href',`/#activity?clientId=${companies[60]._id}`);
 await page.setViewportSize({width:390,height:844});
 for(const link of await row.getByRole('link').all())await expect(link).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('searchbox',{name:'Buscar empresa'}).fill('nenhuma empresa deste nome');
 await expect(page.getByText('Nenhuma empresa encontrada')).toBeVisible();
 await page.getByRole('button',{name:'Limpar busca',exact:true}).click();
 await expect(page.locator('.company-table tbody tr')).toHaveCount(50);
});
