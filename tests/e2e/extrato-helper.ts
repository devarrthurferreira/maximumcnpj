import {expect,type Page} from '@playwright/test';
import {section22} from '../fixtures/section22.ts';
export const extractionId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const documentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const attemptId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** Explicit synthetic history covers 2025 and 2026 source months. The original PA
 * window and its scalar stay unchanged; a repeated twelve-month pattern also
 * preserves custom cent totals in every complete rolling window. */
export function statementHistory(totalCents=15_000_000){
 const extraction=section22(totalCents),first=2024*12,last=2025*12+7;
 const earlier=Array.from({length:last-first},(_,index)=>{
   const absolute=first+index,year=Math.floor(absolute/12),month=String(absolute%12+1).padStart(2,'0');
   const template=extraction.rbt12Window[((absolute-last)%12+12)%12];
   return {...template,period:`${month}/${year}`,month:`${year}-${month}`,usedInRbt12:false};
 });
 return {...extraction,priorRevenues:[...earlier,...extraction.priorRevenues]};
}
/** OCR/Blob transport is mocked in browser tests; real OCR is independently exercised in Python. */
export async function mockStatement(page:Page,totalCents=15000000,id=extractionId){
 let documentClientId:string|null=null;
 await page.route('**/api/v4/simples-documents',async r=>{
   if(r.request().method()!=='POST')return r.continue();
   const clientId=JSON.parse(r.request().postData()||'{}').clientId;
   documentClientId=clientId;
   await r.fulfill({json:{documentId,attemptId,status:'AWAITING_UPLOAD',fileName:'sintetico.pdf',sizeBytes:32,
     originalPutUrl:'https://vercel.com/api/blob/?pathname=synthetic%2Foriginal.pdf&vercel-blob-delegation=test&vercel-blob-signature=test',
     originalGetUrl:'https://store-fixture.private.blob.vercel-storage.com/synthetic/original.pdf?vercel-blob-signature=test',
     searchablePutUrl:'https://vercel.com/api/blob/?pathname=synthetic%2Fsearchable.pdf&vercel-blob-delegation=test&vercel-blob-signature=test',clientId}});
 });
 await page.route('https://vercel.com/api/blob/**',r=>r.fulfill({status:200,body:''}));
 await page.route('**/api/v4/simples-documents/*/process-urls',r=>r.fulfill({json:{
   documentId,attemptId,originalGetUrl:'https://store-fixture.private.blob.vercel-storage.com/synthetic/original.pdf?vercel-blob-signature=test',
   searchablePutUrl:'https://vercel.com/api/blob/?pathname=synthetic%2Fsearchable.pdf&vercel-blob-delegation=test&vercel-blob-signature=test'}}));
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{documentId,clientId:documentClientId,status:'READY',extractionId:id,hasReadyExtraction:true,originalStored:true,retryable:true,error:null}}));
 await page.route('**/api/simples?*',r=>r.fulfill({json:{extractionId:id,documentId,originalStored:true,searchableStored:true,
   clientId:new URL(r.request().url()).searchParams.get('clientId'),fileName:'sintetico.pdf',...statementHistory(totalCents)}}));
}
export async function readStatement(page:Page,totalCents=15000000,id=extractionId){
 await mockStatement(page,totalCents,id);
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
 await page.locator('#rbt12-read').click();
 await expect(page.locator('#rbt12')).toHaveValue((totalCents/100).toFixed(2));
 await expect(page.locator('#rbt12')).toHaveAttribute('readonly','');
}
