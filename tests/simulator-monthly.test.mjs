import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineMonth,calculateMonthlySimulation,monthlyProjection,monthlyDifal} from '../public/simulator-monthly.js';
import {calculateSimulation} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,unifiedDreRows} from '../public/simulator-dre.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';
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
