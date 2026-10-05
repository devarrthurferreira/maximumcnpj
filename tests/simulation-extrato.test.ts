import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSection22,rbt12InputSource} from '../src/simulation-extrato.ts';
import {section22} from './fixtures/section22.ts';

test('RBT12 provém de doze competências explícitas da seção 2.2, com ambos os mercados',()=>{
 const source=section22(16200000);source.rbt12Window[0].externalCents=123456;source.rbt12Window[0].totalCents+=123456;
 source.rbt12Cents+=123456;source.rbt12Basis.externalCents=123456;source.rbt12Basis.totalCents+=123456;
 const result=validateSection22(source);assert.equal(result.rbt12Cents,16323456);assert.equal(result.rbt12Window.length,12);
 assert.equal(result.rbt12Basis.startMonth,'2025-08');assert.equal(result.rbt12Basis.endMonth,'2026-07');
});
test('RBT12 ausente, manual, com janela deslocada ou valores corrompidos nunca é aceita',()=>{
 for(const change of [
  (v:any)=>v.parserVersion='SIMPLES_PDF_V1',(v:any)=>v.sourceSection='2.1',(v:any)=>v.rbt12Cents++,
  (v:any)=>v.pa='13/2026',(v:any)=>v.cnpjBasico='',(v:any)=>v.rbt12Window.pop(),
  (v:any)=>v.rbt12Window[0].month='2026-08',(v:any)=>v.rbt12Window[0].internalCents='0',
  (v:any)=>v.rbt12Window[0].externalCents=-1,(v:any)=>v.rbt12Window[0].totalCents=NaN,
  (v:any)=>v.rbt12Basis.months=11,(v:any)=>v.rbt12Basis.totalCents++,
 ]){const value=section22();change(value);assert.throws(()=>validateSection22(value),(e:any)=>e.code==='RBT12_EXTRACTION');}
 for(const value of [null,{},[],{rbt12:150000}])assert.throws(()=>validateSection22(value));
});
test('Doze receitas explicitamente zeradas são válidas e não recebem projeção automática',()=>{
 const source=section22(0),copy=structuredClone(source),result=validateSection22(source);
 assert.equal(result.rbt12Cents,0);assert.deepEqual(source,copy);assert.equal(result.rbt12Window.length,12);
});
test('Histórico conserva o escopo da leitura e distingue páginas analisadas das preservadas',()=>{
 const processing={extractionScope:'SECTION_22',searchablePdfScope:'SELECTED_PAGES',pageCount:8,processedPages:2,
   processedPageNumbers:[1,2],preservedPages:[3,4,5,6,7,8],ocrPages:[1,2]};
 const source={...section22(),...processing},result=validateSection22(source);
 for(const [key,value] of Object.entries(processing))assert.deepEqual((result as any)[key],value);
 assert.notEqual((result as any).processedPageNumbers,source.processedPageNumbers);
 assert.equal(validateSection22(section22()).rbt12Cents,source.rbt12Cents);
 assert.equal('extractionScope' in validateSection22(section22()),false);
});
test('RBT12 manual é explícita, confirmada e independente do OCR, inclusive zero e centavos',()=>{
 for(const value of [0,0.29,123.45,500000,1_000_000_000_000])assert.equal(rbt12InputSource('MANUAL',true,null,value),'MANUAL');
 for(const value of [undefined,-1,0.001,NaN,Infinity,1_000_000_000_001]){
  assert.throws(()=>rbt12InputSource('MANUAL',true,null,value),(e:any)=>e.code==='RBT12_REQUIRED');
 }
 for(const confirmed of [undefined,false,'true',1])assert.throws(()=>rbt12InputSource('MANUAL',confirmed,null,100),(e:any)=>e.code==='RBT12_CONFIRMATION');
 assert.throws(()=>rbt12InputSource('MANUAL',true,'extraction-id',100),(e:any)=>e.code==='RBT12_SOURCE');
 assert.throws(()=>rbt12InputSource(undefined,true,null,100),(e:any)=>e.code==='RBT12_SOURCE');
 assert.throws(()=>rbt12InputSource('ESTIMATED',undefined,null,100),(e:any)=>e.code==='RBT12_SOURCE');
 assert.throws(()=>rbt12InputSource('SIMPLES_SECTION_22',true,'extraction-id',100),(e:any)=>e.code==='RBT12_SOURCE');
 assert.equal(rbt12InputSource(undefined,undefined,'extraction-id',100),'SIMPLES_SECTION_22');
 assert.equal(rbt12InputSource('SIMPLES_SECTION_22',undefined,'extraction-id',100),'SIMPLES_SECTION_22');
});
