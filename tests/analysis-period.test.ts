import test from 'node:test';
import assert from 'node:assert/strict';
import {JAN_SEP_POLICY,JAN_SEP_MODEL_VERSION,analysisMonthsForYear,buildAnalysisPeriod,assertCompleteAnalysisPeriod,isAnalysisMonth} from '../public/analysis-period.js';
import {calculateMonthlySimulation,baselineMonth,MONTHLY_MODEL_VERSION} from '../public/simulator-monthly.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {selectOperationMonths,aggregateOperationAudit} from '../src/simulation-monthly-source.ts';
import {aggregateCommercialComposition} from '../src/simulation-commercial-composition.ts';
import {parseAccountingData,ACCOUNTING_FIELDS} from '../src/analysis-contract.ts';

const period=(startMonth:string,endMonth:string)=>({startMonth,endMonth,
  months:(Number(endMonth.slice(0,4))-Number(startMonth.slice(0,4)))*12+Number(endMonth.slice(5))-Number(startMonth.slice(5))+1});
const full=period('2026-01','2026-12'),nine=period('2026-01','2026-09');
const row=(sourceMonth:string,totalCents:number,natureCode:string)=>({serviceDate:`${sourceMonth}-15`,totalCents,natureCode,
  documentKind:'CPF',document:'12345678900',cnpj:'',valid:false,recipientUf:'MG'});
const report=(rows:any[])=>({rows,statuses:new Map()});
const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:3300000,values:{serviceRevenue:0,salesRevenue:0,simplePurchases:0,
  regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};

test('jan–set aceita fontes de 9 ou 12 meses sem prorratear e registra o trimestre excluído',()=>{
  const selected=buildAnalysisPeriod(nine,full);
  assert.equal(selected.version,JAN_SEP_POLICY);assert.equal(selected.months,9);assert.equal(selected.complete,true);
  assert.deepEqual(selected.includedMonths,analysisMonthsForYear(2026));
  assert.deepEqual(selected.excludedMonths,['2026-10','2026-11','2026-12']);
  assert.deepEqual(selected.missingMonths,[]);assert.doesNotThrow(()=>assertCompleteAnalysisPeriod(selected));
  assert.equal(isAnalysisMonth('2026-09',2026),true);assert.equal(isAnalysisMonth('2026-10',2026),false);
  assert.equal(isAnalysisMonth('2025-01',2026),false);
});

test('cobertura exige os dois relatórios e nunca transforma ausência externa em zero confirmado',()=>{
  const selected=buildAnalysisPeriod(period('2026-02','2026-12'),nine);
  assert.equal(selected.complete,false);assert.deepEqual(selected.missingMonths,['2026-01']);
  assert.equal(selected.includedMonths.length,8);assert.ok(!selected.includedMonths.includes('2026-01'));
  assert.throws(()=>assertCompleteAnalysisPeriod(selected),/2026-01/);
  const onlyQuarter=buildAnalysisPeriod(period('2026-10','2026-12'),period('2026-10','2026-12'));
  assert.deepEqual(onlyQuarter.includedMonths,[]);assert.deepEqual(onlyQuarter.missingMonths,analysisMonthsForYear(2026));
});

test('fontes que cruzam anos só escolhem a janela única completa',()=>{
  const selected=buildAnalysisPeriod(period('2025-10','2026-09'),full);
  assert.equal(selected.sourceYear,2026);assert.equal(selected.complete,true);
  assert.deepEqual(selected.excludedMonths,['2025-10','2025-11','2025-12','2026-10','2026-11','2026-12']);
  assert.throws(()=>buildAnalysisPeriod(period('2025-09','2026-08'),period('2025-09','2026-08')),/anos diferentes/);
  assert.throws(()=>buildAnalysisPeriod(period('2025-01','2025-12'),full),/anos diferentes/);
});

test('seleção recorta valores reais, conserva auditoria integral e só compõe grupos dos meses escolhidos',()=>{
  const purchases=report([row('2026-01',10000,'1102'),row('2026-09',20000,'1102')]);
  const sales=report([row('2026-01',100000,'5102'),row('2026-09',200000,'5102'),row('2026-12',900000,'5102')]);
  const before=structuredClone({purchases,sales});
  assert.throws(()=>selectOperationMonths(purchases,sales,'MG'),(error:any)=>error.code==='SIMULATOR_PERIOD');
  const imported=selectOperationMonths(purchases,sales,'MG','MG',{periodPolicy:JAN_SEP_POLICY})!;
  const chosen=buildAnalysisPeriod(nine,full),months=imported.filter(row=>chosen.includedMonths.includes(row.sourceMonth));
  assert.equal(imported.length,12);assert.equal(months.length,9);
  assert.equal(aggregateOperationAudit(imported).reportSalesCents,1200000);
  assert.equal(aggregateOperationAudit(months).reportSalesCents,300000);
  assert.equal(months[1].fields.salesCpfCents,0,'Mês interno sem movimento conserva a cobertura do relatório.');
  const composition=aggregateCommercialComposition(months.map(row=>row.commercialComposition!));
  assert.equal(composition.revenue.totalCents,300000);assert.equal(composition.purchases.totalCents,30000);
  assert.equal(composition.purchases.byTaxStatus.find(group=>group.key==='CPF')!.percent,100);
  assert.deepEqual(composition.sourceMonths,analysisMonthsForYear(2026));assert.deepEqual({purchases,sales},before);
});

test('cálculo Jan–Set preserva mensalidade, RBT12 de doze meses e limites integrais; legado continua sem flag',()=>{
  const imported=Array.from({length:12},(_,index)=>({sourceMonth:`2026-${String(index+1).padStart(2,'0')}`,month:index+1,
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:100000*(index+1),purchasesOptantCents:0,purchasesNonOptantCents:10000,serviceRevenueCents:0},
    salesLines:1,purchaseLines:1,difal:null}));
  const selected=buildAnalysisPeriod(full,full),reports=imported.slice(0,9),inputs=reports.map(row=>baselineMonth(row));
  const priorRevenues=Array.from({length:20},(_,index)=>{
    const month=new Date(Date.UTC(2025,index,1)).toISOString().slice(0,7);
    return {month,period:`${month.slice(5)}/${month.slice(0,4)}`,internalCents:27500000,externalCents:0,totalCents:27500000};
  });
  const schedule=buildRbt12Schedule({sourceSection:'2.2',parserVersion:'SIMPLES_SECTION_22_V2',pa:'09/2026',priorRevenues},selected.includedMonths);
  const before=structuredClone({reports,inputs,selected,schedule});
  const computed=calculateMonthlySimulation(draft,reports,inputs,'sales',schedule,selected);
  assert.equal(computed.result.version,JAN_SEP_MODEL_VERSION);assert.equal(computed.result.annualRevenue,45000);
  assert.equal(computed.projection.scenario.annual.revenueCents,4500000);
  assert.deepEqual(computed.result.analysisPeriod,selected);assert.deepEqual(computed.engineInput.analysisPeriod,selected);
  assert.equal(computed.result.memory.find((entry:any)=>entry.id==='simplesLimit').value,4800000);
  assert.equal(computed.result.memory.find((entry:any)=>entry.id==='sublimit').value,3600000);
  assert.equal(schedule.rows.length,9);assert.ok(schedule.rows.every(row=>row.window.length===12&&row.rbt12Cents===330000000));
  assert.deepEqual(computed.engineInput.months.map((entry:any)=>entry.input.rbt12),Array(9).fill(3300000));
  assert.throws(()=>calculateMonthlySimulation(draft,imported,imported.map(row=>baselineMonth(row)),'sales',null,selected),/exatamente janeiro a setembro/);
  const legacy=calculateMonthlySimulation(draft,imported,imported.map(row=>baselineMonth(row)),'sales');
  assert.equal(legacy.result.version,MONTHLY_MODEL_VERSION);assert.equal(legacy.result.annualRevenue,78000);
  assert.equal(Object.hasOwn(legacy.result,'analysisPeriod'),false);assert.deepEqual({reports,inputs,selected,schedule},before);
});

test('despesas fora de Jan–Set permanecem salvas sem bloquear conclusão e duplicatas permanecem inválidas',()=>{
  const rows=Array.from({length:12},(_,index)=>({sourceMonth:`2026-${String(index+1).padStart(2,'0')}`,
    ...Object.fromEntries(ACCOUNTING_FIELDS.map(field=>[field,index<9?index+1:null]))}));
  const data={months:rows};
  assert.deepEqual(parseAccountingData(data,true,{periodPolicy:JAN_SEP_POLICY,sourceYear:2026}),data);
  assert.throws(()=>parseAccountingData(data,true),(error:any)=>error.code==='ANALYSIS_ACCOUNTING_INCOMPLETE');
  assert.throws(()=>parseAccountingData({months:[rows[0],rows[0]]},false,{periodPolicy:JAN_SEP_POLICY}),/única vez/);
  assert.throws(()=>parseAccountingData({months:[rows[9]]},true,{periodPolicy:JAN_SEP_POLICY,sourceYear:2026}),/despesas/);
});

test('conclusão Contábil nova exige os nove meses mesmo antes do Fiscal, com rascunho parcial permitido',()=>{
  const months=analysisMonthsForYear(2026).map(sourceMonth=>({sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(field=>[field,0]))}));
  for(const count of [1,8]){
    const data={months:months.slice(0,count)};
    assert.deepEqual(parseAccountingData(data,false,{periodPolicy:JAN_SEP_POLICY}),data);
    assert.throws(()=>parseAccountingData(data,true,{periodPolicy:JAN_SEP_POLICY}),(error:any)=>error.code==='ANALYSIS_ACCOUNTING_INCOMPLETE');
    assert.deepEqual(parseAccountingData(data,true),data,'Contrato legado sem flag permanece compatível.');
  }
  assert.deepEqual(parseAccountingData({months},true,{periodPolicy:JAN_SEP_POLICY}),{months});
});
