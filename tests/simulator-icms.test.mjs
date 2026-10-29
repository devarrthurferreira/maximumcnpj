import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeIcmsOperations,parseIcmsOperations,projectIcmsOperations} from '../public/simulator-icms.js';
import {calculateTax,draftToInput,calculateSimulation} from '../public/simulator-engine.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';

const line=(natureCode,amount,recipientUf='MG',extra={})=>({natureCode,totalCents:Math.round(amount*100),recipientUf,creditGroup:'NAO_OPTANTE',...extra});
const input=()=>({sourceMonth:'2026-01',issuerUf:'MG',purchaseIssuerUf:'MG',
  sales:[line('5102',1000),line('6102',2000,'SP')],
  purchases:[line('1102',300),line('2102',500,'SP'),line('8000002',200),line('8000102',400,'SP'),line('1202',100),line('2202',200,'SP')]});
const fixture=()=>summarizeIcmsOperations(input());
const draft=()=>({year:2027,salesAnnex:1,serviceAnnex:3,rbt12:180000,values:{salesRevenue:2700,serviceRevenue:0,simplePurchases:0,regularPurchases:1400,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}});
const report=(source=fixture())=>({sourceMonth:source.sourceMonth,month:Number(source.sourceMonth.slice(5)),
  fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:source.sales.totalBaseCents-source.salesReturns.totalBaseCents,purchasesOptantCents:0,purchasesNonOptantCents:source.sourceRegularPurchasesCents,serviceRevenueCents:0},
  salesLines:2,purchaseLines:6,difal:null,icmsOperations:source});

test('ICMS usa bases de naturezas e UFs: compras 8000 são custo, devolução é crédito e interestadual usa12%',()=>{
  const original=input(),before=structuredClone(original),source=summarizeIcmsOperations(original);
  const result=projectIcmsOperations(source,{salesRevenueCents:270000,regularPurchasesCents:140000});
  assert.deepEqual(original,before);
  assert.equal(source.excludedServicePurchasesCents,60000);assert.equal(source.sourceRegularPurchasesCents,140000);
  assert.equal(source.purchases.totalBaseCents,80000);assert.equal(source.purchases.internalTaxCents,5400);assert.equal(source.purchases.interstateTaxCents,6000);
  assert.equal(source.salesReturns.totalBaseCents,30000);assert.equal(source.salesReturns.taxCents,4200);
  assert.deepEqual(Object.fromEntries(['debitCents','purchaseCreditCents','salesReturnCreditCents','potentialCents','usedCents','dueCents','balanceCents'].map(key=>[key,result[key]])),
    {debitCents:42000,purchaseCreditCents:11400,salesReturnCreditCents:4200,potentialCents:15600,usedCents:15600,dueCents:26400,balanceCents:0});
  assert.equal(result.available,true);assert.equal(2700-1400-result.dueCents/100,1036);
});

test('prefixos8000 e compras do Simples não geram crédito ou pendência de UF, mas devoluções de venda geram',()=>{
  const source=summarizeIcmsOperations({...input(),purchases:[
    ...['8000','8000002','8000102','8.000.999'].map(nature=>line(nature,100,'')),
    line('2102',200,'',{creditGroup:'OPTANTE'}),line('2202009',100,'SP',{creditGroup:'OPTANTE'}),line('1202',100,'MG',{creditGroup:undefined}),
    line('6202',500,'SP'),line('1901',600,'')
  ]});
  assert.equal(source.excludedServicePurchasesCents,40000);assert.equal(source.excludedSimplePurchasesCents,20000);
  assert.equal(source.purchases.totalBaseCents,0);assert.equal(source.purchases.pendingLines,0);
  assert.equal(source.salesReturns.taxCents,3000);assert.equal(source.salesReturns.totalBaseCents,20000);
  assert.equal(projectIcmsOperations(source,{salesRevenueCents:280000,regularPurchasesCents:40000}).available,true);
});

test('UF real define interna ou interestadual sem inferir geografia do prefixo da natureza',()=>{
  const source=summarizeIcmsOperations({...input(),sales:[line('6102',100,'MG'),line('5102',100,'sp')],
    purchases:[line('2102',100,'MG'),line('1102',100,'sp')]});
  assert.equal(source.sales.internalTaxCents,1800);assert.equal(source.sales.interstateTaxCents,1200);
  assert.equal(source.purchases.internalTaxCents,1800);assert.equal(source.purchases.interstateTaxCents,1200);
});

test('devolução integral não duplica benefício de ICMS e saldo excedente não aumenta resultado',()=>{
  const source=summarizeIcmsOperations({...input(),sales:[line('6102',1000,'SP')],purchases:[line('2202',200,'SP')]});
  const p=projectIcmsOperations(source,{salesRevenueCents:80000,regularPurchasesCents:0});
  assert.equal(p.debitCents,12000);assert.equal(p.salesReturnCreditCents,2400);assert.equal(p.dueCents,9600);
  const complete=summarizeIcmsOperations({...input(),sales:[line('6102',1000,'SP')],purchases:[line('2202',1000,'SP'),line('2102',2000,'SP')]});
  const all=projectIcmsOperations(complete,{salesRevenueCents:0,regularPurchasesCents:200000});
  assert.equal(all.usedCents,12000);assert.equal(all.dueCents,0);assert.equal(all.balanceCents,24000);
});

test('devoluções maiores que vendas mantêm receita negativa, débito bruto e saldo credor separado',()=>{
  const source=summarizeIcmsOperations({...input(),sales:[line('6102',1000,'SP')],purchases:[line('2202',2500,'SP'),line('2102',2000,'SP')]}),before=structuredClone(source);
  const p=projectIcmsOperations(source,{salesRevenueCents:-150000,regularPurchasesCents:200000});
  assert.equal(p.available,true);assert.equal(p.grossSalesCents,100000);assert.equal(p.debitCents,12000);
  assert.equal(p.salesReturnCreditCents,30000);assert.equal(p.purchaseCreditCents,24000);
  assert.equal(p.usedCents,12000);assert.equal(p.dueCents,0);assert.equal(p.balanceCents,42000);
  const row=report(source),out=calculateMonthlySimulation(draft(),[row],[baselineMonth(row)],'sales');
  assert.equal(out.result.annualRevenue,-1500);assert(out.result.regimes.every(row=>row.available));
  const regime=out.result.regimes.find(row=>row.id==='actual');
  assert.equal(regime.dre.revenue,-1500);assert.equal(regime.dre.cmv,-2000);assert.equal(regime.dre.netProfit,-3500);
  assert.equal(regime.dre.icmsUsed,120);assert.equal(regime.dre.icmsBalance,420);
  assert.deepEqual(source,before);
});

test('ajuste com base reconstruída negativa gera alerta e débito zero, sem alterar receita ou créditos da origem',()=>{
  const source=fixture(),d=draft();d.values.salesRevenue=-1000;
  const p=projectIcmsOperations(source,{salesRevenueCents:-100000,regularPurchasesCents:140000});
  assert.equal(p.available,true);assert.equal(p.unflooredGrossSalesCents,-70000);assert.equal(p.grossSalesFloorApplied,true);
  assert.equal(p.debitCents,0);assert.equal(p.usedCents,0);assert.equal(p.dueCents,0);assert.equal(p.balanceCents,p.potentialCents);
  const result=calculateSimulation(d,null,null,null,source);
  assert(result.regimes.every(row=>row.available));assert(result.warnings.some(row=>row.code==='icms-sales-base-floor'));
  assert(result.regimes.every(row=>row.dre.sales===-12000));
});

test('ajuste manual de vendas pondera as bases brutas e não altera crédito dos documentos',()=>{
  const source=fixture(),before=structuredClone(source);
  for(const [net,debit,due] of [[300000,46200,30600],[240000,37800,22200]]){
    const p=projectIcmsOperations(source,{salesRevenueCents:net,regularPurchasesCents:190000});
    assert.equal(p.debitCents,debit);assert.equal(p.dueCents,due);assert.equal(p.potentialCents,15600);assert.equal(p.purchaseAdjustmentCents,50000);
  }
  assert.deepEqual(source,before);
});

test('ajuste ponderado não amplifica o arredondamento de impostos em notas de um ou três centavos',()=>{
  for(const amount of [.01,.03]){
    const source=summarizeIcmsOperations({...input(),sales:[line('5102',amount)],purchases:[]});
    const before=projectIcmsOperations(source,{salesRevenueCents:Math.round(amount*100),regularPurchasesCents:0});
    assert.equal(before.debitCents,amount===.01?0:1);
    const adjusted=projectIcmsOperations(source,{salesRevenueCents:100000,regularPurchasesCents:0});
    assert.equal(adjusted.debitCents,18000);
  }
});

test('UF ausente fica pendente apenas nos regimes que usam o ICMS fora do DAS',()=>{
  const source=summarizeIcmsOperations({...input(),purchases:[line('2102',500,'')]}),d=draft();
  const result=calculateSimulation(d,null,null,null,source);
  for(const id of ['pure','hybrid'])assert.equal(result.regimes.find(row=>row.id===id).available,true);
  for(const id of ['presumed','actual']){
    const row=result.regimes.find(row=>row.id===id);assert.equal(row.available,false);assert.match(row.status,/sem UF/);
    assert.equal(row.margin,null);
  }
  assert.equal(result.memory.find(row=>row.id==='icms.potential').unit,'text');
  assert(result.warnings.some(row=>row.code==='icms-operations-pending'));
  assert.equal(result.simplesDiagnostic.available,true);
  d.icmsOutside=true;
  const outside=calculateSimulation(d,null,null,null,source);
  assert(outside.regimes.every(row=>!row.available));
  assert.equal(outside.simplesDiagnostic.available,false);assert.equal(outside.simplesDiagnostic.statusCode,'ICMS_OPERATIONS_PENDING');
  const empty=summarizeIcmsOperations({...input(),sales:[],purchases:[]});
  assert.equal(projectIcmsOperations(empty,{salesRevenueCents:10000,regularPurchasesCents:0}).missingSalesMix,true);
  assert.equal(projectIcmsOperations(empty,{salesRevenueCents:0,regularPurchasesCents:0}).available,true);
});

test('motor abate ICMS uma vez e mantém todos os custos8000',()=>{
  const raw=draftToInput(draft(),null,null,null,fixture());
  raw.rates.cbs=0;raw.rates.ibs=0;
  for(const group of Object.values(raw.credits)){group.cbsRate=0;group.ibsRate=0;}
  const result=calculateTax(raw),presumed=result.regimes.find(row=>row.id==='presumed');
  assert.equal(result.credits.icms.debit/12,420);assert.equal(result.credits.icms.potential/12,156);
  assert.equal(presumed.dre.cmv/12,-1400);assert.equal(presumed.dre.icmsNet/12,-264);assert.equal(presumed.dre.preTax/12,1036);
  assert.equal(presumed.dre.icmsUsed/12,156);
  assert.equal(result.memory.find(row=>row.id==='icms.purchaseCredit').value/12,114);
  assert.equal(result.memory.find(row=>row.id==='icms.returnCredit').value/12,42);
  assert.equal(result.memory.find(row=>row.id==='icms.excludedServices').value/12,600);
});

test('mensal e anual somam créditos por competência e preservam fonte e ajustes',()=>{
  const jan=report(),feb=report({...fixture(),sourceMonth:'2026-02'}),reports=[jan,feb],before=structuredClone(reports);
  const computed=calculateMonthlySimulation(draft(),reports,reports.map(row=>baselineMonth(row)),'sales');
  assert.equal(computed.result.credits.icms.potential,312);assert.equal(computed.result.credits.icms.due,528);
  assert.equal(computed.result.memory.find(row=>row.id==='icms.purchaseCredit').value,228);
  assert.equal(computed.result.memory.find(row=>row.id==='icms.returnCredit').value,84);
  assert.equal(computed.result.monthlyResults[0].result.regimes.find(row=>row.id==='presumed').dre.icmsNet,-264);
  assert.deepEqual(reports,before);
  const bad=structuredClone(reports);bad[1].icmsOperations.sourceMonth='2026-03';
  assert.throws(()=>calculateMonthlySimulation(draft(),bad,bad.map(row=>baselineMonth(row)),'sales'),/composição de ICMS/);
  const mixed=structuredClone(reports);delete mixed[1].icmsOperations;
  assert.throws(()=>calculateMonthlySimulation(draft(),mixed,mixed.map(row=>baselineMonth(row)),'sales'),/Composição de ICMS/);
});

test('composição pendente em um mês não produz total anual confirmado nem memória fiscal numérica',()=>{
  const jan=report(),source=summarizeIcmsOperations({...input(),sourceMonth:'2026-02',purchases:[line('2102',500,'')]}),feb=report(source);
  for(const reports of [[jan,feb],[feb,jan]]){
    const computed=calculateMonthlySimulation(draft(),reports,reports.map(row=>baselineMonth(row)),'sales');
    assert.equal(computed.result.regimes.find(row=>row.id==='presumed').available,false);
    assert.equal(computed.result.memory.find(row=>row.id==='icms.potential').unit,'text');
    assert.match(computed.result.memory.find(row=>row.id==='icms.potential').formula,/ICMS pendente/);
  }
});

test('contratos de crédito são estritos e não podem ser injetados no rascunho',()=>{
  const source=fixture();
  for(const mutate of [s=>s.interstateRatePercent=18,s=>s.version='OTHER',s=>s.sales.totalBaseCents++,s=>s.purchases.taxCents++,s=>s.issuerUf='XX',s=>s.untrusted=1,
    s=>{s.issuerUf='';s.purchaseIssuerUf='';},s=>s.sales.eligibleLines=0,
    s=>{s.sales.internalTaxCents=s.sales.internalBaseCents;s.sales.taxCents=s.sales.internalTaxCents+s.sales.interstateTaxCents;}]){
    const invalid=structuredClone(source);mutate(invalid);assert.throws(()=>parseIcmsOperations(invalid));
  }
  assert.equal(draftToInput({...draft(),icmsOperations:source}),null);
  assert.equal(draftToInput(draft(),null,null,null,{...source,interstateRatePercent:7}),null);
  const raw=draftToInput(draft(),null,null,null,source);raw.rates.icms=.2;
  assert.throws(()=>calculateTax(raw),/diverge/);
});
