import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRevenueReconciliation, reconcileRevenueMonths, unavailableRevenueReconciliation} from '../public/revenue-reconciliation.js';

const month = (sourceMonth, grossSalesCents, serviceSalesCents, salesReturnsCents) => ({sourceMonth,
  operationVersion:'NATURE_OPERATIONS_2026_10_V1', operationAudit:{grossSalesCents,serviceSalesCents,salesReturnsCents},
  fields:{salesOptantCents:0,salesNonOptantCents:grossSalesCents-salesReturnsCents,salesCpfCents:0,serviceRevenueCents:serviceSalesCents}});
const source = () => ({generationId:'generation',clientId:'client',purchases:{jobId:'purchases'},sales:{jobId:'sales',selectedTotalCents:180000},
  monthlyReports:[month('2026-08',100000,20000,15000),month('2026-09',100000,0,25000)],
  operationAudit:{grossSalesCents:200000,serviceSalesCents:20000,salesReturnsCents:40000},
  fields:{salesOptantCents:0,salesNonOptantCents:160000,salesCpfCents:0,serviceRevenueCents:20000}});

test('fechamento soma bruto, serviços e devoluções uma vez; ajustes preservam origem e entrada',()=>{
  const input=source(), before=structuredClone(input);
  const result=buildRevenueReconciliation({source:input,scenarioRevenueCents:190000});
  assert.equal(result.status,'AVAILABLE');assert.equal(result.grossRevenueCents,220000);
  assert.equal(result.salesReturnsCents,40000);assert.equal(result.revenueAfterReturnsCents,180000);
  assert.equal(result.manualAdjustmentCents,10000);assert.equal(result.usedRevenueCents,190000);
  assert.deepEqual([result.purchaseJobId,result.salesJobId],['purchases','sales']);
  assert.equal(result.monthly[0].revenueAfterReturnsCents,105000);
  assert.deepEqual(input,before);
});
test('fechamento mensal confere a competência original e sinal negativo sem usar média',()=>{
  const monthly=source();monthly.monthlyReports[1]=month('2026-09',1000,0,25000);
  delete monthly.operationAudit;delete monthly.fields;delete monthly.sales.selectedTotalCents;
  const closing=buildRevenueReconciliation({source:monthly,sourceMonth:'2026-09',scenarioRevenueCents:-24000});
  assert.equal(closing.available,true);assert.equal(closing.revenueAfterReturnsCents,-24000);
  assert.equal(closing.manualAdjustmentCents,0);assert.equal(closing.period.months,1);
  assert.equal(buildRevenueReconciliation({source:monthly,sourceMonth:'2025-09'}).available,false);
});
test('fechamento recusa legados sem auditoria ou totais mensais divergentes sem inventar zero',()=>{
  for(const mutate of [
    item=>delete item.monthlyReports, item=>delete item.monthlyReports[0].operationAudit,
    item=>item.monthlyReports[0].fields.salesCpfCents=1, item=>item.operationAudit.salesReturnsCents++,
    item=>item.fields.serviceRevenueCents++, item=>item.sales.selectedTotalCents++,
    item=>item.monthlyReports[1].sourceMonth='2026-08', item=>item.monthlyReports[1].sourceMonth='2026-10',
    item=>item.monthlyReports[0].operationAudit.grossSalesCents=NaN,
  ]){
    const input=source();mutate(input);const result=buildRevenueReconciliation({source:input,scenarioRevenueCents:180000});
    assert.equal(result.available,false);assert.equal(result.status,'UNAVAILABLE');
    for(const key of ['grossSalesCents','grossRevenueCents','salesReturnsCents','revenueAfterReturnsCents','manualAdjustmentCents','usedRevenueCents'])assert.equal(Object.hasOwn(result,key),false);
  }
});
test('fechamento canonical mantém indisponibilidade e valida totais/meses ao reabrir',()=>{
  const closing=buildRevenueReconciliation({source:source()});
  assert.deepEqual(buildRevenueReconciliation({source:{revenueReconciliation:closing}}),closing);
  const pending=unavailableRevenueReconciliation('Conclua compras.',{generationId:'generation'},'PENDING');
  assert.deepEqual(buildRevenueReconciliation({source:pending}),pending);
  const tampered={...closing,grossRevenueCents:closing.grossRevenueCents+1};
  assert.equal(buildRevenueReconciliation({source:tampered}).available,false);
});
test('centavos seguros, competências válidas e dedução zero confirmada requerem evidência',()=>{
  const closing=reconcileRevenueMonths([{sourceMonth:'2026-08',grossSalesCents:0,serviceSalesCents:0,salesReturnsCents:0}]);
  assert.equal(closing.revenueAfterReturnsCents,0);assert.equal(closing.available,true);
  for(const values of [[],[{sourceMonth:'2026-13',grossSalesCents:1,serviceSalesCents:0,salesReturnsCents:0}],
    [{sourceMonth:'2026-08',grossSalesCents:Number.MAX_SAFE_INTEGER,serviceSalesCents:1,salesReturnsCents:0}]])assert.throws(()=>reconcileRevenueMonths(values));
});
