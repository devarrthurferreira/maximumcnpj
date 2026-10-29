import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSection22,rbt12InputSource} from '../src/simulation-extrato.ts';
import {defaultFiscalData,parseFiscalData} from '../src/analysis-contract.ts';
import {section22,section22Year2025} from './fixtures/section22.ts';

test('RBT12 provém de doze competências explícitas da seção 2.2, com ambos os mercados',()=>{
 const source=section22(16200000);source.rbt12Window[0].externalCents=123456;source.rbt12Window[0].totalCents+=123456;
 source.rbt12Cents+=123456;source.rbt12CalculatedCents=source.rbt12Cents;source.rbt12Basis.externalCents=123456;source.rbt12Basis.totalCents+=123456;
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
  (v:any)=>v.rbt12CalculatedCents*=100,(v:any)=>v.rbt12Reconciled=false,
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
test('Validação conserva as 23 receitas do quadro 2.2 para as janelas de janeiro a dezembro',()=>{
 const source=section22Year2025(),copy=structuredClone(source),result=validateSection22(source);
 assert.equal(result.priorRevenues.length,23);assert.equal(result.rbt12Window.length,12);
 assert.equal(result.priorRevenues[0].month,'2024-01');assert.equal(result.priorRevenues[22].month,'2025-11');
 assert.deepEqual(result.priorRevenues,source.priorRevenues);assert.notEqual(result.priorRevenues,source.priorRevenues);
 assert.notEqual(result.priorRevenues[0],source.priorRevenues[0]);assert.deepEqual(source,copy);
});
test('Histórico completo rejeita linhas antigas corrompidas ou divergência com a janela do PA',()=>{
 for(const change of [
  (v:any)=>v.priorRevenues[0].totalCents++,
  (v:any)=>v.priorRevenues[0].internalCents=-1,
  (v:any)=>v.priorRevenues[0].externalCents=NaN,
  (v:any)=>v.priorRevenues[0].period='02/2024',
  (v:any)=>v.priorRevenues.splice(1,0,{...v.priorRevenues[0]}),
  (v:any)=>v.priorRevenues.reverse(),
  (v:any)=>v.priorRevenues.push({...v.priorRevenues.at(-1),month:'2025-12',period:'12/2025'}),
  (v:any)=>v.priorRevenues.splice(11,1),
  (v:any)=>{v.priorRevenues=v.priorRevenues.map((row:any)=>({...row}));v.priorRevenues[11].internalCents++;v.priorRevenues[11].totalCents++;},
 ]){const source=section22Year2025();change(source);assert.throws(()=>validateSection22(source),(e:any)=>e.code==='RBT12_EXTRACTION');}
});
test('Snapshot legado conserva apenas os doze meses existentes, sem recriar receitas ausentes',()=>{
 const source:any=section22();delete source.priorRevenues;
 const result=validateSection22(source);assert.equal(result.priorRevenues.length,12);assert.deepEqual(result.priorRevenues,source.rbt12Window);
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
test('Regimes sem Simples dispensam referência sem fabricar RBT12 ou aceitar opções incompatíveis',()=>{
 const selection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
 assert.equal(rbt12InputSource('NOT_REQUIRED',undefined,null,undefined,selection),'NOT_REQUIRED');
 assert.equal(rbt12InputSource(undefined,undefined,null,null,selection),'NOT_REQUIRED');
 for(const [source,confirmation,extraction,value] of [
  ['MANUAL',true,null,0],['SIMPLES_SECTION_22',undefined,'extraction',100],['NOT_REQUIRED',undefined,null,0],
  ['NOT_REQUIRED',false,null,undefined],['NOT_REQUIRED',undefined,'extraction',undefined]
 ] as const)assert.throws(()=>rbt12InputSource(source,confirmation,extraction,value,selection),(error:any)=>error.code==='RBT12_SOURCE');
 for(const selected of [['pure'],['hybrid'],['pure','actual']]){
  assert.throws(()=>rbt12InputSource('NOT_REQUIRED',undefined,null,undefined,{version:'REGIME_SELECTION_V1',selected}),(error:any)=>error.code==='RBT12_SOURCE');
 }
 assert.throws(()=>rbt12InputSource('NOT_REQUIRED',undefined,null,undefined),(error:any)=>error.code==='RBT12_SOURCE','A seleção omitida continua significando os quatro regimes legados.');
});

test('RBT12 não informada é uma escolha explícita, distinta de zero, manual e extrato',()=>{
 for(const selected of [['pure'],['hybrid'],['pure','presumed','actual']]){
  const selection={version:'REGIME_SELECTION_V1',selected};
  for(const value of [null,undefined])assert.equal(rbt12InputSource('NOT_PROVIDED',undefined,null,value,selection),'NOT_PROVIDED');
  for(const [confirmation,extraction,value] of [
   [true,null,null],[false,null,null],[undefined,'extraction',null],[undefined,null,0],[undefined,null,100]
  ] as const)assert.throws(()=>rbt12InputSource('NOT_PROVIDED',confirmation,extraction,value,selection),(error:any)=>error.code==='RBT12_SOURCE');
 }
 assert.equal(rbt12InputSource(undefined,undefined,null,undefined),'SIMPLES_SECTION_22',
  'A falta de um PDF escolhido anteriormente não muda silenciosamente a origem da referência.');
 assert.throws(()=>rbt12InputSource('NOT_PROVIDED',undefined,null,null,{version:'REGIME_SELECTION_V1',selected:['actual']}),
  (error:any)=>error.code==='RBT12_SOURCE');
});

test('novo Fiscal com Simples inicia sem RBT12 e aceita somente ausência coerente de valor e vínculos',()=>{
 const selection={version:'REGIME_SELECTION_V1' as const,selected:['pure','actual'] as ('pure'|'actual')[]};
 const data=defaultFiscalData(selection);
 assert.equal(data.rbt12Source,'NOT_PROVIDED');assert.equal(data.rbt12,null);assert.equal(data.rbt12ManualConfirmed,false);
 assert.deepEqual(parseFiscalData(data,selection),data);
 const id='10000000-0000-4000-8000-000000000001';
 for(const change of [{rbt12:0},{rbt12:123.45},{rbt12ManualConfirmed:true},{rbt12ExtractionId:id},{rbt12DocumentId:id}]){
  assert.throws(()=>parseFiscalData({...data,...change},selection),(error:any)=>error.code==='RBT12_SOURCE');
 }
 const withoutSimples={version:'REGIME_SELECTION_V1' as const,selected:['actual'] as 'actual'[]};
 assert.equal(defaultFiscalData(withoutSimples).rbt12Source,'NOT_REQUIRED');
});
