import {expect,type Page} from '@playwright/test';
import {section22} from '../fixtures/section22.ts';
export const extractionId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
/** Only the Python transport is mocked here; real OCR is independently exercised in Python. */
export async function mockStatement(page:Page,totalCents=15000000,id=extractionId){
 await page.route('**/api/simples?*',r=>r.fulfill({json:{extractionId:id,clientId:new URL(r.request().url()).searchParams.get('clientId'),fileName:'sintetico.pdf',...section22(totalCents)}}));
}
export async function readStatement(page:Page,totalCents=15000000,id=extractionId){
 await mockStatement(page,totalCents,id);
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
 await page.locator('#rbt12-read').click();
 await expect(page.locator('#rbt12')).toHaveValue((totalCents/100).toFixed(2));
 await expect(page.locator('#rbt12')).toHaveAttribute('readonly','');
}
