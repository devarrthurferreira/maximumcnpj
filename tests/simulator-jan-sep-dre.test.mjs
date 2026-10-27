import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalysisPeriod} from '../public/analysis-period.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,dreReportCoverage,unifiedDreRows} from '../public/simulator-dre.js';
import {buildDreExecutiveSummary,buildDreEvolution} from '../public/simulator-dre-summary.js';
import {renderAnnualDre,renderCompleteMonthlyDre,renderDreCompleteDetails,renderDrePrintDocument} from '../public/simulator-dre-view.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';

const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const sum=values=>values.reduce((total,value)=>total+value,0);
const row=(presentation,key)=>unifiedDreRows(presentation).find(item=>item.key===key);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

function commercial(reports){
  const grossCents=sum(reports.map(report=>report.operationAudit.grossSalesCents+report.operationAudit.serviceSalesCents));
  const returnsCents=sum(reports.map(report=>report.operationAudit.salesReturnsCents)),totalCents=grossCents-returnsCents;
  const revenueGroup=(key,share)=>({key,grossCents:grossCents*share,returnsCents:returnsCents*share,totalCents:totalCents*share,percent:totalCents>0?share*100:null});
  const purchasesCents=reports.length*400000;
  return {version:'COMMERCIAL_COMPOSITION_V1',unit:'CENTS',sourceMonths:reports.map(report=>report.sourceMonth),
    revenue:{grossCents,returnsCents,totalCents,percentDenominatorCents:totalCents,
      byCustomerType:[revenueGroup('B2B',.5),revenueGroup('B2C',.5),revenueGroup('UNIDENTIFIED',0)],
      byTaxStatus:[revenueGroup('OPTANTE',.5),revenueGroup('NAO_OPTANTE',0),revenueGroup('CPF',.5),revenueGroup('NAO_CONFIRMADO',0),revenueGroup('OUTROS',0)]},
    purchases:{totalCents:purchasesCents,percentDenominatorCents:purchasesCents,
      byTaxStatus:[['OPTANTE',.25],['NAO_OPTANTE',.625],['CPF',.125],['NAO_CONFIRMADO',0],['OUTROS',0]].map(([key,share])=>({key,totalCents:purchasesCents*share,percent:share*100}))}};
}
function fixture({rbt12=3300000,rent=100,adjustment=0,legacy=false}={}){
  const imported={startMonth:'2026-01',endMonth:'2026-12',months:12},analysisPeriod=buildAnalysisPeriod(imported,imported);
  const reports=Array.from({length:9},(_,index)=>{
    const month=index+1,gross=1000000+month*10000,services=200000,returns=50000+month*100;
    return {sourceMonth:`2026-${String(month).padStart(2,'0')}`,month,operationVersion:'NATURE_OPERATIONS_2026_10_V1',
      operationAudit:{grossSalesCents:gross,serviceSalesCents:services,salesReturnsCents:returns},
      fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:gross-returns,serviceRevenueCents:services,purchasesOptantCents:100000,purchasesNonOptantCents:300000},
      difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:month*1000,baseCents:month*10000,eligibleLines:1,pendingLines:0},
      anticipation:{version:'ICMS_ANTICIPATION_V4',ratePercent:7.32,issuerUf:'MG',amountCents:month*732,baseCents:month*10000,eligibleLines:1,pendingLines:0}};
  });
  for(const report of reports)report.commercialComposition=commercial([report]);
  const difalPolicy=defaultDifalPolicy();difalPolicy.operations.pure.exit=false;difalPolicy.operations.hybrid.entry=false;
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12,difalPolicy,values:{salesRevenue:0,serviceRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const inputs=reports.map(report=>baselineMonth(report,{salaries:300,benefits:50,rent,cardExpenses:15}));inputs[0].groups.salesCpfCents+=adjustment;
  const calculation=calculateMonthlySimulation(draft,reports,inputs,'synthetic-sales',null,legacy?null:analysisPeriod);
  const source={monthlyReports:reports,revenueSplit:{version:'SALES_SERVICES_V1'},
    fields:Object.fromEntries(Object.keys(reports[0].fields).map(key=>[key,sum(reports.map(report=>report.fields[key]))])),
    operationAudit:Object.fromEntries(['grossSalesCents','serviceSalesCents','salesReturnsCents'].map(key=>[key,sum(reports.map(report=>report.operationAudit[key]))])),
    commercialComposition:commercial(reports),...(legacy?{}:{analysisPeriod})};
  const calendar=buildMonthlyDre(calculation.result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:rbt12*100},{startMonth:'2026-01',endMonth:'2026-09',months:9});
  const presentation=buildDrePresentation({...calculation,source,calendar,reportMonths:9});
  return {...calculation,source,calendar,presentation,year:2027};
}

test('DRE V4 contém nove competências e conserva RBT12 própria, resultados e devoluções capturados',()=>{
  const input=fixture(),before=structuredClone(input);freeze(input);
  assert.equal(input.calendar.version,'DRE_CALENDAR_V4');assert.equal(input.calendar.months.length,9);
  assert.equal(input.calendar.months.at(-1).label,'Setembro');assert.equal(input.calendar.months.at(-1).sourceMonth,'2026-09');
  assert.equal(input.calendar.rbt12Reference.rbt12Cents,330000000);
  const coverage=dreReportCoverage(input.presentation);assert.equal(coverage.count,9);assert.equal(coverage.completePeriod,true);assert.equal(coverage.completeYear,false);
  for(const regime of input.result.regimes){
    assert.equal(regime.available,true,'RBT12 de R$ 3,3 milhões permanece calculável.');
    for(const item of input.calendar.regimes.find(item=>item.id===regime.id).rows){assert.equal(item.months.length,9);near(sum(item.months),item.annual);}
    near(row(input.presentation,'revenueSourceGross').values[regime.id],input.source.commercialComposition.revenue.grossCents/100);
    near(row(input.presentation,'revenueSalesReturns').values[regime.id],-input.source.commercialComposition.revenue.returnsCents/100);
    near(row(input.presentation,'revenue').values[regime.id],input.source.commercialComposition.revenue.totalCents/100);
  }
  assert.deepEqual(input,before);
});

test('resumo concilia lucro e tributos; créditos informativos não criam segunda dedução',()=>{
  const input=fixture();
  for(const regime of input.result.regimes)for(const column of [{id:regime.id,mode:'annual'},{id:regime.id,mode:'month',month:0},{id:regime.id,mode:'month',month:8}]){
    const summary=buildDreExecutiveSummary(input.presentation,column),captured=column.mode==='annual'?regime:input.result.monthlyResults[column.month].result.regimes.find(item=>item.id===regime.id);
    assert.equal(summary.reconciled,true);near(summary.result,captured.dre.netProfit);near(summary.taxes,captured.totalTaxes);
    near(summary.creditsApplied,captured.dre.cbsUsed+captured.dre.ibsUsed+captured.dre.icmsUsed);
    near(sum(summary.rows.filter(item=>['revenue','revenueDeductions','cmvNetCredits','operatingExpenses','incomeTaxes'].includes(item.key)).map(item=>item.value)),summary.result);
  }
  assert(buildDreExecutiveSummary(input.presentation,{id:'actual',mode:'annual'}).creditsApplied>0);
  for(const key of ['cbs.potential','cbs.used','ibs.potential','ibs.used'])assert.equal(row(input.presentation,key),undefined);
  assert.equal(row(input.presentation,'difal').values.pure,0);assert.equal(row(input.presentation,'icmsAnticipation').values.hybrid,0);
});

test('resumo é padrão e DRE completa materializa valores mensais de janeiro a setembro',()=>{
  const input=fixture(),html=renderAnnualDre(input);
  assert.match(html,/DRE resumida/);assert.equal((html.match(/data-dre-regime-result=/g)||[]).length,4);
  assert.match(html,/data-dre-summary-row="revenue"/);assert.match(html,/data-dre-summary-row="netProfit"/);
  assert.match(html,/data-simulation-lazy="dre"><\/div>/);assert.doesNotMatch(html,/data-dre-row=/);
  assert.match(html,/Créditos tributários utilizados/);assert.match(html,/não somar novamente/);assert.match(html,/B2B · CNPJ/);assert.match(html,/B2C · CPF/);
  const monthly=renderCompleteMonthlyDre({...input,month:8,regimeId:'pure'});
  const options=monthly.match(/<select id="dre-month">([\s\S]*?)<\/select>/)?.[1];
  assert.equal((options.match(/<option /g)||[]).length,9);assert.match(options,/Setembro/);assert.doesNotMatch(options,/Outubro|Novembro|Dezembro/);
  const detail=renderDreCompleteDetails({...input,monthly:true,month:8,monthView:false,regimeId:'pure'});
  const revenue=detail.match(/data-dre-row="revenue">([\s\S]*?)<\/tr>/)?.[1];
  assert.equal((revenue.match(/<td /g)||[]).length,10);assert.match(detail,/>9 meses<\/button>/);
  assert.match(detail,/Consolidado Jan–Set/);assert.match(detail,/data-dre-row="icmsAnticipation"/);
  const evolution=buildDreEvolution(input.presentation,input.calendar,'actual',8);assert.equal(evolution.months.length,9);assert.equal(evolution.current.sourceMonth,'2026-09');
});

test('CSV e impressão completos usam nove meses, detalham tudo e preservam percentuais comerciais',()=>{
  const input=fixture(),csv=buildDreCsv({...input,period:'complete'}),html=renderDrePrintDocument({...input,period:'complete'});
  const header=csv.split('\r\n').find(line=>line.startsWith('"Regime";"Escopo";'));
  assert(header);assert.equal(header.split(';').length,18);assert.match(header,/Setembro/);assert.doesNotMatch(header,/Outubro|Novembro|Dezembro/);
  assert.match(csv,/DRE resumida · consolidado de janeiro a setembro/);assert.match(csv,/Consolidado Jan–Set \/ indicador do período/);
  assert.match(csv,/"Compras por fornecedor";"Fora do Simples";22500,00;62,50;36000,00/);
  assert.doesNotMatch(csv,/;6250,000000;/);assert.match(csv,/"Créditos tributários utilizados · informativo"/);
  assert.equal((html.match(/data-report-part="monthly"/g)||[]).length,4);
  assert.equal((html.match(/data-dre-row="revenue"/g)||[]).length,5);
  assert.equal((html.match(/data-icms-reconciliation="dre"/g)||[]).length,5);
  assert.match(html,/DRE consolidada · janeiro a setembro/);assert.match(html,/data-report-part="references"/);
  assert.doesNotMatch(html,/DRE anual consolidada|Janeiro a dezembro do cenário/);
});

test('ajustes da DRE não alteram a composição documental nem escondem prejuízo ou pendências',()=>{
  const adjusted=fixture({adjustment:100}),html=renderAnnualDre(adjusted);
  near(row(adjusted.presentation,'revenueManualAdjustment').values.actual,100);
  assert.match(html,/data-dre-summary-row="revenueManualAdjustment"/);assert.match(html,/ajustes manuais estão refletidos na DRE/);
  assert.equal(adjusted.presentation.commercialComposition.revenue.totalCents,adjusted.source.commercialComposition.revenue.totalCents);
  const loss=renderAnnualDre(fixture({rent:20000}));assert.match(loss,/Prejuízo estimado/);assert.match(loss,/class="dre-regime-result is-loss/);
  const pending=fixture({rbt12:4000000});assert.equal(buildDreExecutiveSummary(pending.presentation,{id:'pure',mode:'annual'}).result,null);
  const pendingHtml=renderAnnualDre(pending);assert.match(pendingHtml,/Resultado indisponível/);assert.doesNotMatch(pendingHtml,/NaN|Infinity/);
});

test('histórico sem contrato Jan–Set conserva calendário de doze meses e DRE completa inicial',()=>{
  const input=fixture({legacy:true});assert.equal(input.calendar.version,'DRE_CALENDAR_V3');assert.equal(input.calendar.months.length,12);
  assert.equal(input.presentation.analysisPeriod,undefined);
  const html=renderAnnualDre(input);assert.match(html,/DRE anual/);assert.match(html,/data-dre-row="revenue"/);assert.doesNotMatch(html,/data-simulation-lazy="dre"/);
  const header=buildDreCsv({...input,period:'monthly'}).split('\r\n').find(line=>line.startsWith('"Regime";"Escopo";'));
  assert.match(header,/Dezembro/);assert.equal(header.split(';').length,21);
});
