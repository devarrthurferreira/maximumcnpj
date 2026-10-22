import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOperationMonths,aggregateOperationAudit} from '../src/simulation-monthly-source.ts';
import {monthlyProjection} from '../public/simulator-monthly.js';
import {OPERATION_CATALOG_VERSION} from '../src/operation-catalog.ts';

const row=(natureCode:string,totalCents:number,extra:Record<string,unknown>={})=>({natureCode,totalCents,serviceDate:'2026-01-15',
  document:'12345678900',documentKind:'CPF',cnpj:'',valid:false,recipientUf:'SP',description:'Descrição não classifica operação',...extra});
const report=(rows:any[],statuses:Map<string,unknown>=new Map())=>({rows,statuses});

test('catálogo seleciona receita e compras, devolução de venda vem somente de compras e conserva auditoria dos relatórios',()=>{
  const purchases=report([row('1102009',40000),row('8000002',10000),row('1202999',5000),row('1901',9000),
    row('2102',3000,{recipientUf:''}),row('1102',5000,{recipientUf:'MG'}),
    row('8000102',10001,{serviceDate:'2026-02-15'}),row('8888',500,{serviceDate:'2026-02-15'})]);
  const sales=report([row('5103009',100000,{operation:'OUTRAS'}),row('900001',20000),row('6202',9000,{balanceCents:-9000}),
    row('5901',7000,{description:'VENDA'}),row('7777',1000,{description:'VENDA'}),row('6102',20000,{serviceDate:'2026-02-28'})]);
  const before=structuredClone({purchases,sales});
  const months=selectOperationMonths(purchases,sales,'MG')!;
  assert.equal(months.length,2);assert(months.every(month=>month.operationVersion===OPERATION_CATALOG_VERSION));
  assert.deepEqual(months[0].fields,{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:95000,purchasesOptantCents:0,purchasesNonOptantCents:58000,serviceRevenueCents:20000});
  assert.equal(months[1].fields.purchasesNonOptantCents,10001);
  assert.deepEqual(months[0].anticipation,{version:'ICMS_ANTICIPATION_V2',ratePercent:7.32,issuerUf:'MG',eligibleLines:2,baseCents:50000,amountCents:3660,pendingLines:1});
  assert.equal(months[1].anticipation.amountCents,732);
  assert.equal(months[0].difal.amountCents,10000,'Operação antiga OUTRAS não substitui VENDA do catálogo.');
  assert.equal(months[0].difal.eligibleLines,1);
  const audit=aggregateOperationAudit(months),projection=monthlyProjection(months);
  assert.equal(projection.totals.sales.totalCents,135000);assert.equal(projection.totals.purchases.totalCents,68001);
  assert.equal(audit.reportSalesCents,139000);assert.equal(audit.reportSalesGrossCents,157000);assert.equal(audit.reportSalesBalanceAdjustmentCents,-18000);
  assert.equal(audit.reportPurchasesCents,82501);assert.equal(audit.salesReturnsCents,5000);
  assert.equal(audit.excludedSalesCents,17000);assert.equal(audit.excludedPurchaseCents,9500);
  assert.equal(audit.unknownSalesLines,1);assert.equal(audit.unknownPurchaseLines,1);
  assert.equal(audit.natures.find(item=>item.side==='SALES'&&item.natureCode==='6202')!.excludedCents,9000);
  assert.equal(audit.natures.find(item=>item.side==='PURCHASES'&&item.natureCode==='1202')!.salesReturnsCents,5000);
  assert.equal(audit.natures.find(item=>item.natureCode==='8000')!.purchasesCents,20001);
  assert.deepEqual({purchases,sales},before,'Seleção não altera linhas ou enquadramentos congelados.');
});

test('devoluções mantêm CPF e enquadramento consultado, sem converter ausência fiscal em negativa',()=>{
  const optant={document:'00000000000191',cnpj:'00000000000191',documentKind:'CNPJ',valid:true};
  const pending={document:'11111111000191',cnpj:'11111111000191',documentKind:'CNPJ',valid:true};
  const statuses=new Map([['00000000000191','OPTANTE'],['11111111000191','NAO_CONFIRMADO']]);
  const purchases=report([row('1202',3000,optant),row('2202',2000,pending),row('8000',1000,pending)],statuses);
  const sales=report([row('5102',20000,optant),row('5102',10000),row('5102',5000,pending)],statuses);
  const month=selectOperationMonths(purchases,sales,'MG')![0];
  assert.equal(month.fields.salesOptantCents,17000);assert.equal(month.fields.salesNonOptantCents,3000);
  assert.equal(month.fields.salesCpfCents,10000);assert.equal(month.fields.purchasesNonOptantCents,1000);
  assert.equal(month.anticipation.amountCents,0);assert.equal(month.anticipation.eligibleLines,0);
  assert.equal(statuses.get('11111111000191'),'NAO_CONFIRMADO');
  assert.throws(()=>selectOperationMonths({...purchases,statuses:new Map()},sales,'MG'),(error:any)=>error.code==='SIMULATION_MONTHS');
});

test('compras sem CPF conservam custos, mas não compõem a antecipação nem pendências de UF',()=>{
  const purchases=report([
    row('2102',10000),row('8000102',20000,{document:'123.456.789-00'}),
    row('2102',30000,{document:'00000000000191',cnpj:'00000000000191',documentKind:'CNPJ',valid:true,recipientUf:''}),
    ...['123456789012','','12345'].map(document=>row('2102',1000,{document,documentKind:'INVALID',recipientUf:''})),
    row('2102',2000,{recipientUf:''}),row('2102',4000,{recipientUf:'MG'}),row('2202',500)
  ],new Map([['00000000000191','OPTANTE']]));
  const month=selectOperationMonths(purchases,report([row('6102',100000)]),'MG')![0];
  assert.equal(month.fields.purchasesOptantCents+month.fields.purchasesNonOptantCents,69000);
  assert.equal(month.fields.salesCpfCents,99500);
  assert.deepEqual(month.anticipation,{version:'ICMS_ANTICIPATION_V2',ratePercent:7.32,issuerUf:'MG',eligibleLines:2,baseCents:30000,amountCents:2196,pendingLines:1});
  assert.equal(month.difal.amountCents,10000);
});

test('natureza ausente bloqueia cálculo novo e UFs ausentes permanecem pendentes',()=>{
  for(const nature of ['',undefined,'12']){
    const purchases=report([row('1102',1000,{natureCode:nature})]);
    assert.throws(()=>selectOperationMonths(purchases,report([row('5102',10000)]),'MG'),(error:any)=>error.status===409&&error.code==='SIMULATION_OPERATIONS');
  }
  const month=selectOperationMonths(report([row('1102',1000)]),report([row('5102',10000)]))![0];
  assert.equal(month.anticipation.pendingLines,1);assert.equal(month.anticipation.amountCents,0);
  assert.equal(month.difal.pendingLines,1);assert.equal(month.difal.amountCents,0);
});
