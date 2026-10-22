import test from 'node:test';
import assert from 'node:assert/strict';
import {annualizeReports, projectScenario, projectDifal, REPORT_GROUPS} from '../public/simulator-projection.js';
import {calculateSimulation, draftToInput} from '../public/simulator-engine.js';
import {renderProjectionCard} from '../public/simulator-projection-view.js';
const fields={salesOptantCents:10000000,salesNonOptantCents:20000000,salesCpfCents:10000000,purchasesOptantCents:8000000,purchasesNonOptantCents:16000000};
const manual={serviceRevenue:2000,salaries:15000,benefits:1000,adminExpenses:500,rent:3000,cardExpenses:400};
test('Quatro meses: total de R$ 400 mil / 4 = R$ 100 mil por mês, vezes 12 = R$ 1,2 milhão',()=>{
 const p=annualizeReports(fields,4);
 assert.deepEqual(p.totals.sales,{totalCents:40000000,monthlyCents:10000000,annualCents:120000000});
 assert.deepEqual(p.totals.purchases,{totalCents:24000000,monthlyCents:6000000,annualCents:72000000});
 assert.equal(p.reportMonths,4);assert.equal(p.projectionMonths,12);assert.equal(p.timeline.length,12);
 assert(p.timeline.every(row=>row.salesCents===10000000&&row.purchasesCents===6000000));
 assert.equal(p.timeline.reduce((sum,row)=>sum+row.salesCents,0),p.totals.sales.annualCents);
});
test('Todos os períodos de 1 a 12 meses usam a mesma regra; nunca período + 12, nem anualização duplicada',()=>{
 for(let n=1;n<=12;n++){
  const p=annualizeReports(Object.fromEntries(REPORT_GROUPS.map((k,i)=>[k,(i+1)*10000*n])),n);
  for(const row of p.groups){assert.equal(row.monthlyCents,row.totalCents/n);assert.equal(row.annualCents,row.monthlyCents*12);}
  assert.equal(p.timeline.length,12);assert.equal(p.projectionMonths,12);
 }
 const full=annualizeReports(fields,12);assert.equal(full.totals.sales.annualCents,full.totals.sales.monthlyCents*12);
});
test('Centavos são reconciliados por lado antes da repetição anual; entradas permanecem intactas',()=>{
 const input={salesOptantCents:200001,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100001,purchasesNonOptantCents:350000};
 const before=JSON.stringify(input),p=annualizeReports(input,3);
 assert.equal(p.totals.sales.monthlyCents,333334);assert.equal(p.totals.purchases.monthlyCents,150000);
 for(const [side,keys]of[['sales',REPORT_GROUPS.slice(0,3)],['purchases',REPORT_GROUPS.slice(3)]]){
  assert.equal(keys.reduce((sum,key)=>sum+p.monthlyGroupsCents[key],0),p.totals[side].monthlyCents);
  assert.equal(keys.reduce((sum,key)=>sum+p.annualGroupsCents[key],0),p.totals[side].annualCents);
 }
 assert.equal(JSON.stringify(input),before);assert.doesNotThrow(()=>JSON.stringify(p));
});
test('Zero é válido, mas campos ausentes, inválidos, frações de centavo e overflow são recusados',()=>{
 const zero=annualizeReports(Object.fromEntries(REPORT_GROUPS.map(k=>[k,0])),4);assert.equal(zero.totals.sales.annualCents,0);
 for(const n of[0,13,-1,1.5,'4',null,undefined,NaN,Infinity])assert.throws(()=>annualizeReports(fields,n));
 for(const value of[0.1,'100',null,undefined,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>annualizeReports({...fields,salesCpfCents:value},4));
 assert.throws(()=>annualizeReports({...fields,purchasesOptantCents:-1},4));
 assert.throws(()=>annualizeReports({...fields,salesCpfCents:Number.MAX_SAFE_INTEGER},1));
 assert.throws(()=>annualizeReports({},4));
});
test('Devolução pode deixar um grupo de vendas negativo sem quebrar a projeção; total líquido negativo é bloqueado',()=>{
 const signed={...fields,salesOptantCents:-10001,salesNonOptantCents:50000,salesCpfCents:0};
 const p=annualizeReports(signed,3);
 assert.equal(p.monthlyGroupsCents.salesOptantCents,-3334);
 assert.equal(p.monthlyGroupsCents.salesNonOptantCents,16667);
 assert.equal(p.totals.sales.totalCents,39999);
 assert.equal(p.totals.sales.monthlyCents,13333);
 assert.equal(p.totals.sales.annualCents,159996);
 const groups=Object.fromEntries(REPORT_GROUPS.map(k=>[k,p.monthlyGroupsCents[k]/100]));
 const scenario=projectScenario(groups,{...manual,salesRevenue:133.33,simplePurchases:p.monthlyGroupsCents.purchasesOptantCents/100,regularPurchases:p.monthlyGroupsCents.purchasesNonOptantCents/100});
 assert.equal(scenario.monthly.salesCents,13333);
 assert.equal(scenario.monthlyGroupsCents.salesOptantCents,-3334);
 assert.throws(()=>annualizeReports({...fields,salesOptantCents:-50000000,salesNonOptantCents:0,salesCpfCents:0},3),/saldo líquido total de vendas/i);
 assert.throws(()=>projectScenario({...groups,salesOptantCents:-999999,salesNonOptantCents:0,salesCpfCents:0},manual),/saldo líquido mensal de vendas/i);
});

test('Cenário separa médias importadas de serviços/despesas mensais e não altera a RBT12',()=>{
 const p=annualizeReports(fields,4),groups=Object.fromEntries(REPORT_GROUPS.map(k=>[k,p.monthlyGroupsCents[k]/100]));
 const values={...manual,salesRevenue:100000,simplePurchases:20000,regularPurchases:40000};
 const scenario=projectScenario(groups,values),draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:888888.88,values};
 assert.equal(scenario.annual.revenueCents,122400000);assert.equal(scenario.annual.servicesCents,2400000);
 assert.equal(scenario.monthly.expensesCents,1990000);assert.equal(scenario.annual.expensesCents,23880000);
 assert.equal(calculateSimulation(draft).annualRevenue,scenario.annual.revenueCents/100);
 assert.equal(draftToInput(draft).rbt12,888888.88);assert.equal(draft.rbt12,888888.88);
 assert.throws(()=>projectScenario(groups,{...values,salaries:null}));
});
test('Ajustes mensais do cenário não sobrescrevem a média original; a memória identifica ambos',()=>{
 const p=annualizeReports(fields,4),groups=Object.fromEntries(REPORT_GROUPS.map(k=>[k,p.monthlyGroupsCents[k]/100]));
 groups.salesCpfCents+=100;
 const scenario=projectScenario(groups,manual);
 assert.equal(p.totals.sales.monthlyCents,10000000);assert.equal(scenario.monthly.salesCents,10010000);
 assert.equal(scenario.annual.salesCents,120120000);
 const html=renderProjectionCard({projection:p,edited:true});assert(html.includes('ajustes manuais'));assert(html.includes('média original'));
});
test('Apresentação preserva 12 colunas iguais, cinco grupos, confirmação e valores zero sem barras falsas',()=>{
 const p=annualizeReports(fields,4),html=renderProjectionCard({projection:p,confirmed:false,kind:'purchases'});
 assert.equal((html.match(/class="projection-month "/g)||[]).length,12);
 assert(html.includes('240.000,00'));assert(html.includes('720.000,00'));assert(html.includes('Prévia:'));
 assert(html.includes('RBT12'));assert(html.includes('não é dividida nem multiplicada'));assert(html.includes('Não são 4 + 12 meses'));
 const zero=renderProjectionCard({projection:annualizeReports(Object.fromEntries(REPORT_GROUPS.map(k=>[k,0])),4)});
 assert.equal((zero.match(/projection-month is-zero/g)||[]).length,12);
});

test('Serviços importados formam sexto grupo sem duplicar receita; rateio preserva as duas atividades',()=>{
 const imported={salesOptantCents:10000,salesNonOptantCents:20500,salesCpfCents:39000,serviceRevenueCents:210021,purchasesOptantCents:0,purchasesNonOptantCents:4500};
 const p=annualizeReports(imported,3);
 assert.equal(p.version,'AVERAGE_X12_V2');assert.equal(p.groups.length,6);
 assert.deepEqual(p.totals.sales,{totalCents:279521,monthlyCents:93174,annualCents:1118088});
 assert.equal(p.monthlyGroupsCents.serviceRevenueCents,70007);
 const groups=Object.fromEntries(REPORT_GROUPS.map(key=>[key,p.monthlyGroupsCents[key]/100]));
 const values={...manual,serviceRevenue:700.07};
 assert.equal(projectScenario(groups,values).annual.revenueCents,p.totals.sales.annualCents);
 const edge=annualizeReports({...imported,salesOptantCents:4,salesNonOptantCents:4,salesCpfCents:-8,serviceRevenueCents:5},12);
 assert.equal(edge.totals.sales.monthlyCents,0);assert.equal(edge.monthlyGroupsCents.serviceRevenueCents,0);
 assert.equal(REPORT_GROUPS.slice(0,3).reduce((sum,key)=>sum+edge.monthlyGroupsCents[key],0),0);
 for(let months=1;months<=12;months++)for(let services=0;services<15;services++) {
  const sample=annualizeReports({...imported,salesOptantCents:4,salesNonOptantCents:4,salesCpfCents:-8,serviceRevenueCents:services},months);
  const goods=REPORT_GROUPS.slice(0,3).reduce((sum,key)=>sum+sample.monthlyGroupsCents[key],0);
  assert(goods>=0);assert(sample.monthlyGroupsCents.serviceRevenueCents>=0);
  assert.equal(goods+sample.monthlyGroupsCents.serviceRevenueCents,sample.totals.sales.monthlyCents);
 }
 assert.throws(()=>annualizeReports({...imported,serviceRevenueCents:-1},3));
 assert.throws(()=>annualizeReports({...imported,salesCpfCents:-40000},3),/mercadorias/);
 assert.equal(annualizeReports(fields,3).version,'AVERAGE_X12_V1');
 assert.equal(Object.hasOwn(annualizeReports(fields,3).monthlyGroupsCents,'serviceRevenueCents'),false);
});

test('DIFAL usa total importado já arredondado por linha, média mensal e doze meses sem recalcular a base',()=>{
 const summary={version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:2,baseCents:10005,amountCents:1001,pendingLines:1};
 const p=projectDifal(summary,3,'source-job');
 assert.equal(p.version,'DIFAL_DRE_V1');assert.equal(p.sourceAmountCents,1001);assert.equal(p.sourceBaseCents,10005);
 assert.equal(p.monthlyCents,334);assert.equal(p.annualCents,4008);assert.equal(p.pendingLines,1);
 assert.equal(p.sourceJobId,'source-job');assert.equal(summary.amountCents,1001);
 assert.equal(projectDifal(null,3,'source-job'),null);
 assert.equal(projectDifal({...summary,amountCents:0,baseCents:0,eligibleLines:0},3,'source-job').annualCents,0);
 for(const months of[0,13,1.5])assert.throws(()=>projectDifal(summary,months,'source-job'));
 for(const amountCents of[-1,1.2,'1',null,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>projectDifal({...summary,amountCents},1,'source-job'));
 assert.throws(()=>projectDifal({...summary,ratePercent:18},1,'source-job'));
});


test('projeção aceita a versão CPF/CNPJ sem reclassificar versões históricas',()=>{
 for(const version of ['DIFAL_ESTIMATE_V1','DIFAL_ESTIMATE_V2','DIFAL_ESTIMATE_V3','DIFAL_ESTIMATE_V4']){
  const result=projectDifal({version,ratePercent:10,issuerUf:'MG',eligibleLines:3,baseCents:60000,amountCents:6000,pendingLines:0},2,'source-job');
  assert.equal(result.sourceVersion,version);assert.equal(result.monthlyCents,3000);assert.equal(result.annualCents,36000);
 }
});
