import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineMonth,calculateMonthlySimulation,monthlyProjection,monthlyDifal,monthlyAnticipation} from '../public/simulator-monthly.js';
import {calculateSimulation} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,unifiedDreRows} from '../public/simulator-dre.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const make=(month,sales,purchases,services,difal)=>({sourceMonth:`2025-${String(month).padStart(2,'0')}`,month,salesLines:2,purchaseLines:1,
 fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:sales,purchasesOptantCents:0,purchasesNonOptantCents:purchases,serviceRevenueCents:services},
 difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:difal,baseCents:difal*10,eligibleLines:sales?1:0,pendingLines:0}});
const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:500000,values:{serviceRevenue:0,salesRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
const reports=[make(1,100001,50000,10003,10000),make(2,0,0,0,0),make(3,400009,100000,30007,40001)];
test('competências distintas, mês sem movimento e período parcial: nenhuma média nem extrapolação',()=>{
 const p=monthlyProjection(reports);assert.equal(p.version,'REPORT_MONTHS_V1');assert.equal(p.totals.sales.annualCents,540020);assert(!Object.hasOwn(p.totals.sales,'monthlyCents'));
 const inputs=reports.map(row=>baselineMonth(row));inputs[2].values.rent=20;
 const {result,projection,difalProjection}=calculateMonthlySimulation(draft,reports,inputs,'sales');
 assert.equal(difalProjection.annualCents,50001);assert.deepEqual(difalProjection.months.map(row=>row.amountCents),[10000,0,40001]);
 close(result.annualRevenue,5400.20);assert.equal(projection.scenario.annual.revenueCents,540020);
 for(const regime of result.regimes){close(regime.dre.sales,5000.10);close(regime.dre.services,400.10);close(regime.dre.difal,-500.01);close(regime.dre.cmvRegular,-1500);close(regime.dre.rent,-20);}
 assert.equal(result.memory.find(row=>row.id==='simplesLimit').value,4800000);assert.equal(result.memory.find(row=>row.id==='rbt12').value,500000);
 for(const month of result.monthlyResults){assert.equal(month.result.memory.find(row=>row.id==='simplesLimit').value,4800000);assert.equal(month.result.memory.find(row=>row.id==='months').value,1);}
 const calendar=buildMonthlyDre(result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:50000000},{startMonth:'2025-01',endMonth:'2025-03',months:3});
 assert.equal(calendar.version,'DRE_CALENDAR_V3');assert.equal(calendar.months[0].sourceMonth,'2025-01');assert.equal(calendar.months[3].sourceMonth,null);
 const cells=calendar.regimes[0].rows.find(row=>row.key==='sales').months;
 close(cells[0],1000.01);assert.equal(cells[1],0);close(cells[2],4000.09);assert.equal(cells[3],null);
 const source={monthlyReports:reports,revenueSplit:{version:'SALES_SERVICES_V1'}};
 const presentation=buildDrePresentation({result,calendar,projection,source}),rows=unifiedDreRows(presentation);
 for(const key of ['salesCpfCents','serviceReport','cbs.used','irpjBasic','irpjAdditional']){
  const row=rows.find(row=>row.key===key);assert(row,key);const id=key.startsWith('irpj')?'actual':key.startsWith('cbs')?'hybrid':'pure';
  assert.equal(typeof row.monthlyValues[id][0],'number',`${key} missing month`);assert.equal(row.monthlyValues[id][3],null);
  close(row.values[id],row.monthlyValues[id].slice(0,3).reduce((a,b)=>a+b,0));
 }
 const csv=buildDreCsv({presentation,period:'monthly',year:2027});assert(csv.includes('valores por competência')||csv.includes('Valores por competência'));assert(csv.includes('1000,01'));assert(csv.includes('4000,09'));
});
test('tributos e DIFAL são calculados separadamente; ajuste em um mês não muda outro nem a base DIFAL',()=>{
 const inputs=reports.map(row=>baselineMonth(row)),original=structuredClone(reports);
 inputs[0].groups.salesCpfCents+=100;inputs[0].values.serviceRevenue+=20;
 const out=calculateMonthlySimulation(draft,reports,inputs,'sales');
 assert.equal(out.adjustments.length,2);assert(out.adjustments.every(row=>row.sourceMonth==='2025-01'));assert.deepEqual(reports,original);
 close(out.result.monthlyResults[2].result.annualRevenue,4300.16);
 for(const month of out.result.monthlyResults){
  const baseline=calculateSimulation({...draft,values:month.values});
  for(const regime of month.result.regimes){const before=baseline.regimes.find(row=>row.id===regime.id);const d=reports.find(row=>row.month===month.month).difal.amountCents/100;
   close(regime.dre.netRevenue,before.dre.netRevenue/12-d);close(regime.dre.preTax,before.dre.preTax/12-d);
  }
 }
 assert.equal(out.difalProjection.sourceAmountCents,50001);
});
test('contrato mensal impede competências, entradas e DIFAL forjados; ausência permanece indisponível',()=>{
 const inputs=reports.map(row=>baselineMonth(row));
 assert.throws(()=>calculateMonthlySimulation(draft,reports,inputs.slice(1),'sales'));
 assert.throws(()=>calculateMonthlySimulation(draft,reports,[{...inputs[0],sourceMonth:'2025-04'},...inputs.slice(1)],'sales'));
 assert.throws(()=>calculateMonthlySimulation(draft,reports,[{...inputs[0],difal:0},...inputs.slice(1)],'sales'));
 assert.throws(()=>monthlyProjection([reports[0],reports[0]]));
 const bad=structuredClone(inputs);bad[0].groups.salesCpfCents=-10;assert.throws(()=>calculateMonthlySimulation(draft,reports,bad,'sales'),/2025-01/);
 assert.equal(monthlyDifal([{...reports[0],difal:null}],'sales'),null);
});
test('doze competências com valores diferentes preservam centavos e soma exata de DIFAL',()=>{
 const months=Array.from({length:12},(_,i)=>make(i+1,100001+i*1000,20000+i*100,5+i,10000+i*100));
 const out=calculateMonthlySimulation(draft,months,months.map(row=>baselineMonth(row)),'sales');
 const calendar=buildMonthlyDre(out.result,2028);
 for(const regime of calendar.regimes)for(const row of regime.rows)close(row.annual,row.months.reduce((a,b)=>a+b,0));
 assert.equal(out.difalProjection.annualCents,126600);assert.notEqual(out.result.monthlyResults[0].result.annualRevenue,out.result.monthlyResults[11].result.annualRevenue);
});
test('RBT12 móvel do2.2 muda a alíquota e bloqueia antecipação no mês que alcança sublimite',()=>{
 const history=Array.from({length:13},(_,i)=>({month:`${2024+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,internalCents:i===0?29_000_000:30_000_000,externalCents:0,totalCents:i===0?29_000_000:30_000_000}));
 const extraction={pa:'02/2025',sourceSection:'2.2',parserVersion:'SIMPLES_SECTION_22_V2',priorRevenues:history.map(row=>({...row,period:row.month.slice(5)+'/'+row.month.slice(0,4)}))};
 const rows=[make(1,10000000,1000000,0,10000),make(2,10000000,1000000,0,10000)].map(row=>({...row,operationVersion:'NATURE_OPERATIONS_2026_10_V1',
   anticipation:{version:'ICMS_ANTICIPATION_V2',ratePercent:7.32,issuerUf:'MG',amountCents:73200,baseCents:1000000,eligibleLines:1,pendingLines:0}}));
 const schedule=buildRbt12Schedule(extraction,rows.map(row=>row.sourceMonth));
 const out=calculateMonthlySimulation(draft,rows,rows.map(row=>baselineMonth(row)),'sales',schedule);
 assert.deepEqual(out.engineInput.months.map(row=>row.input.rbt12),[3590000,3600000]);
 for(const id of ['pure','hybrid']){
  const months=out.result.monthlyResults.map(row=>row.result.regimes.find(r=>r.id===id));
  close(months[0].dre.icmsAnticipation,-732);close(months[1].dre.icmsAnticipation,0);
  close(out.result.regimes.find(row=>row.id===id).dre.icmsAnticipation,-732);
  assert.notEqual(months[0].dre.das,months[1].dre.das);
 }
 for(const id of ['presumed','actual'])close(out.result.regimes.find(row=>row.id===id).dre.icmsAnticipation,0);
 assert.equal(out.anticipationProjection.sourceAmountCents,146400);
 assert.equal(out.anticipationProjection.sourceVersion,'ICMS_ANTICIPATION_V2');
 close(out.result.memory.find(row=>row.id==='icmsAnticipation.base').value,20000);
 close(out.result.monthlyResults[0].result.memory.find(row=>row.id==='icmsAnticipation.source').value,732);
 assert(!out.result.memory.some(row=>row.id==='rbt12'));
 const partial=buildRbt12Schedule({...extraction,priorRevenues:extraction.priorRevenues.slice(1)},rows.map(row=>row.sourceMonth));
 assert.throws(()=>calculateMonthlySimulation(draft,rows,rows.map(row=>baselineMonth(row)),'sales',partial),/2024-01/);
 assert.throws(()=>calculateMonthlySimulation(draft,[rows[0],{...rows[1],anticipation:null}],rows.map(row=>baselineMonth(row)),'sales',schedule),/todas as competências/);
});

test('antecipação mensal preserva versão histórica explícita e impede misturar políticas',()=>{
 const summary={ratePercent:7.32,issuerUf:'MG',amountCents:732,baseCents:10000,eligibleLines:1,pendingLines:0};
 for(const version of ['ICMS_ANTICIPATION_V1','ICMS_ANTICIPATION_V2']){
  const rows=[{sourceMonth:'2025-01',month:1,anticipation:{...summary,version}},{sourceMonth:'2025-02',month:2,anticipation:{...summary,version}}];
  assert.equal(monthlyAnticipation(rows).sourceVersion,version);
  assert.equal(monthlyAnticipation(rows).annualCents,1464);
  assert.throws(()=>monthlyAnticipation([rows[0],{...rows[1],anticipation:{...summary,version:version==='ICMS_ANTICIPATION_V1'?'ICMS_ANTICIPATION_V2':'ICMS_ANTICIPATION_V1'}}]),/inválida/);
 }
});

test('memória anual não atribui a todo período a parcela a deduzir de uma única faixa',()=>{
 const rows=[make(1,1000000,100000,0,0),make(2,2000000,100000,0,0)];
 const schedule={version:'RBT12_MONTHLY_SECTION_22_V1',source:'SIMPLES_SECTION_22',sourceSection:'2.2',pa:'02/2026',complete:true,
  rows:rows.map((row,index)=>({sourceMonth:row.sourceMonth,status:'CONFIRMED',rbt12Cents:index?36000000:18000000}))};
 const out=calculateMonthlySimulation(draft,rows,rows.map(row=>baselineMonth(row)),'sales',schedule);
 for(const [id,expected] of [['simples.sales.deduction',[0,5940]],['simples.services.deduction',[0,9360]]]){
  assert.deepEqual(out.result.monthlyResults.map(row=>row.result.memory.find(item=>item.id===id).value),expected);
  assert.equal(out.result.memory.some(item=>item.id===id),false);
 }
 assert.equal(out.result.memory.find(item=>item.id==='sublimit').value,3600000);
 assert.equal(out.result.memory.find(item=>item.id==='simplesLimit').value,4800000);
 const equalSchedule=structuredClone(schedule);equalSchedule.rows[1].rbt12Cents=18000000;
 const sameBand=calculateMonthlySimulation(draft,rows,rows.map(row=>baselineMonth(row)),'sales',equalSchedule);
 assert.equal(sameBand.result.memory.find(item=>item.id==='simples.sales.deduction').value,0);
 const manual=calculateMonthlySimulation(draft,rows,rows.map(row=>baselineMonth(row)),'sales');
 assert.equal(manual.result.memory.find(item=>item.id==='rbt12').value,draft.rbt12);
 assert.equal(manual.result.memory.find(item=>item.id==='simples.sales.deduction').value,13860);
});
