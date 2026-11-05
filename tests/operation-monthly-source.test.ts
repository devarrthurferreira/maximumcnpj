import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOperationMonths,aggregateOperationAudit} from '../src/simulation-monthly-source.ts';
import {baselineMonth,calculateMonthlySimulation,monthlyProjection} from '../public/simulator-monthly.js';
import {OPERATION_CATALOG_VERSION} from '../src/operation-catalog.ts';

const row=(natureCode:string,totalCents:number,extra:Record<string,unknown>={})=>({natureCode,totalCents,serviceDate:'2026-01-15',
  document:'12345678900',documentKind:'CPF',cnpj:'',valid:false,recipientUf:'SP',description:'Descrição não classifica operação',...extra});
const report=(rows:any[],statuses:Map<string,unknown>=new Map())=>({rows,statuses});

test('espécie da saída chega ao ICMS e sinaliza vendas antigas sem identificar NFC-e',()=>{
  const sales=report([row('5102',10000,{documentSpecies:'NFC-e'}),row('6102',20000,{documentSpecies:'NFE'}),row('5102',3000)]);
  const purchases=report([row('1102',100,{recipientUf:'MG'})]);
  const month=selectOperationMonths(purchases,sales,'MG')![0];
  assert.deepEqual(month.salesSpecies,{version:'SALES_SPECIES_V1',nfceLines:1,nfceBaseCents:10000,missingLines:1,missingBaseCents:3000});
  assert.equal(month.icmsOperations.sales.internalTaxCents,1800);
  assert.equal(month.icmsOperations.sales.interstateTaxCents,2760);
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{salesRevenue:0,serviceRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const calculated=calculateMonthlySimulation(draft,[month],[baselineMonth(month)],'synthetic-sales');
  assert.equal(calculated.result.credits.icms.debit,45.60);
  assert.match(calculated.result.warnings.find(item=>item.code==='sales-species-missing')!.detail,/reimporte o relatório de saídas/i);
  assert.equal(calculated.result.memory.find(item=>item.id==='icms.nfceSales')!.value,100);
  assert.equal(sales.rows[0].recipientUf,'SP');
});

test('compras e serviços 8000 entram uma vez no custo de cada grupo do Simples',()=>{
  const optant={document:'00000000000191',cnpj:'00000000000191',documentKind:'CNPJ',valid:true,recipientUf:'MG'};
  const regular={document:'11222333000181',cnpj:'11222333000181',documentKind:'CNPJ',valid:true,recipientUf:'MG'};
  const statuses=new Map([['00000000000191','OPTANTE'],['11222333000181','NAO_OPTANTE']]);
  const purchases=report([row('1102',4000,optant),row('8000002',6000,optant),row('2102',5000,regular),
    row('8000102',7000,regular),row('1202',2000,optant)],statuses);
  const sales=report([row('5102',100000,optant)],statuses),before=structuredClone({purchases,sales});
  const month=selectOperationMonths(purchases,sales,'MG')![0];
  assert.equal(month.fields.purchasesOptantCents,10000);
  assert.equal(month.fields.purchasesNonOptantCents,12000);
  assert.equal(month.operationAudit.purchaseGoodsCents,9000);
  assert.equal(month.operationAudit.purchaseServicesCents,13000);
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,
    values:{salesRevenue:0,serviceRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const calculated=calculateMonthlySimulation(draft,[month],[baselineMonth(month)],'synthetic-sales');
  for(const regime of calculated.result.regimes.filter(item=>item.available)){
    assert.equal(regime.dre.cmvSimple,-100);
    assert.equal(regime.dre.cmvRegular,-120);
  }
  assert.deepEqual({purchases,sales},before);
});

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
  assert.deepEqual(months[0].anticipation,{version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:0});
  assert.equal(months[1].anticipation.amountCents,0);assert.equal(months[1].anticipation.pendingLines,0);
  assert.equal(months[0].difal.amountCents,0,'A saída está desativada sem alterar a seleção de receita pelo catálogo.');
  assert.equal(months[0].difal.eligibleLines,0);
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
  const pending={document:'11222333000181',cnpj:'11222333000181',documentKind:'CNPJ',valid:true};
  const statuses=new Map([['00000000000191','OPTANTE'],['11222333000181','NAO_CONFIRMADO']]);
  const purchases=report([row('1202',3000,optant),row('2202',2000,pending),row('8000',1000,pending)],statuses);
  const sales=report([row('5102',20000,optant),row('5102',10000),row('5102',5000,pending)],statuses);
  const month=selectOperationMonths(purchases,sales,'MG')![0];
  assert.equal(month.fields.salesOptantCents,17000);assert.equal(month.fields.salesNonOptantCents,3000);
  assert.equal(month.fields.salesCpfCents,10000);assert.equal(month.fields.purchasesNonOptantCents,1000);
  assert.equal(month.anticipation.amountCents,0);assert.equal(month.anticipation.eligibleLines,0);
  assert.equal(month.difal.amountCents,0);assert.equal(month.difal.eligibleLines,0);
  assert.equal(statuses.get('11222333000181'),'NAO_CONFIRMADO');
  assert.throws(()=>selectOperationMonths({...purchases,statuses:new Map()},sales,'MG'),(error:any)=>error.code==='SIMULATION_MONTHS');
});

test('CPF fica excluído e CNPJ pode gerar antecipação ou pendência de UF; custos conservados',()=>{
  const purchases=report([
    row('2102',10000),row('8000102',20000,{document:'123.456.789-00',recipientUf:''}),
    row('2102',30000,{document:'00000000000191',cnpj:'00000000000191',documentKind:'CNPJ',valid:true,recipientUf:''}),
    ...['123456789012','','12345'].map(document=>row('2102',1000,{document,documentKind:'INVALID',recipientUf:''})),
    row('2102',2000,{recipientUf:''}),row('2102',4000,{recipientUf:'MG'}),row('2202',500)
  ],new Map([['00000000000191','OPTANTE']]));
  const month=selectOperationMonths(purchases,report([row('6102',100000)]),'MG')![0];
  assert.equal(month.fields.purchasesOptantCents+month.fields.purchasesNonOptantCents,69000);
  assert.equal(month.fields.salesCpfCents,99500);
  assert.deepEqual(month.anticipation,{version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:1});
  assert.equal(month.difal.amountCents,0);
});

test('natureza ausente bloqueia cálculo novo; UFs ausentes afetam somente impostos ativos',()=>{
  for(const nature of ['',undefined,'12']){
    const purchases=report([row('1102',1000,{natureCode:nature})]);
    assert.throws(()=>selectOperationMonths(purchases,report([row('5102',10000)]),'MG'),(error:any)=>error.status===409&&error.code==='SIMULATION_OPERATIONS');
  }
  const month=selectOperationMonths(report([row('1102',1000)]),report([row('5102',10000)]))![0];
  assert.equal(month.anticipation.pendingLines,0);assert.equal(month.anticipation.amountCents,0);
  assert.equal(month.difal.pendingLines,0);assert.equal(month.difal.amountCents,0);
});


test('Saída desativada conserva receita; entrada com CNPJ exclui CPF, arredonda por linha e usa UFs próprias',()=>{
  const numeric={document:'00.000.000/0001-91',cnpj:'00000000000191',documentKind:'CNPJ',valid:true};
  const alpha={document:'12.abc.345/01de-35',cnpj:'12ABC34501DE35',documentKind:'CNPJ',valid:true};
  const statuses=new Map([['00000000000191','OPTANTE'],['12ABC34501DE35','NAO_CONFIRMADO']]);
  const purchases=report([row('2102',10000),row('2102',20000,numeric),row('8000102',30000,alpha),row('2102',7,alpha),row('2102',7,alpha),
    row('2102',1000,{...numeric,recipientUf:'MG'}),row('2202',5000,numeric)],statuses);
  const sales=report([row('6102',10000),row('5103',20000,numeric),row('6102',30000,alpha),
    row('6102',1000,{...numeric,recipientUf:'MG'}),row('9000',5000,alpha)],statuses);
  const month=selectOperationMonths(purchases,sales,'MG')![0];
  assert.deepEqual(month.anticipation,{version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',eligibleLines:3,baseCents:20014,amountCents:1466,pendingLines:0});
  assert.equal(month.fields.purchasesOptantCents+month.fields.purchasesNonOptantCents,61014,'Serviço 8000 continua nos custos de compras.');
  assert.deepEqual(month.difal,{version:'DIFAL_ESTIMATE_V6',ratePercent:10,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:0});
  assert.equal(month.fields.salesOptantCents,16000,'Devolução reduz a receita, sem entrar na base do imposto de compras.');
  assert.equal(statuses.get('12ABC34501DE35'),'NAO_CONFIRMADO','Elegibilidade documental não modifica o enquadramento capturado.');
  const pending=selectOperationMonths(purchases,sales,'MG','')![0];
  assert.equal(pending.anticipation.pendingLines,4);assert.equal(pending.anticipation.amountCents,0);
  assert.equal(pending.difal.amountCents,0);
});
