import {JAN_SEP_POLICY,selectAnalysisPeriod} from './analysis-period.js';
import {buildRbt12Schedule} from './simulator-rbt12.js';
import {monthlyProjection} from './simulator-monthly.js';

/** Local preview only; persistence always rebuilds these source totals on the server. */
export function selectAvailableRbt12Months(source,monthlyInputs,extraction){
  const schedule=buildRbt12Schedule(extraction,source.monthlyReports.map(row=>row.sourceMonth));
  if(schedule.complete)return {source,monthlyInputs,schedule,omittedMonths:[]};
  const confirmed=schedule.rows.filter(row=>row.status==='CONFIRMED').map(row=>row.sourceMonth);
  if(source.analysisPeriod?.version!==JAN_SEP_POLICY||!confirmed.length){
    throw new Error('O quadro 2.2 não contém uma janela RBT12 completa para as competências selecionadas. Importe um extrato com as 12 receitas anteriores a pelo menos um mês da análise.');
  }
  const analysisPeriod=selectAnalysisPeriod(source.analysisPeriod,confirmed);
  const monthlyReports=source.monthlyReports.filter(row=>confirmed.includes(row.sourceMonth));
  const projection={...monthlyProjection(monthlyReports),analysisPeriod};
  const fields=projection.annualGroupsCents;
  const end=new Date(Date.UTC(Number(analysisPeriod.endMonth.slice(0,4)),Number(analysisPeriod.endMonth.slice(5)),0)).toISOString().slice(0,10);
  const period={...source.period,startDate:`${analysisPeriod.startMonth}-01`,endDate:end,startMonth:analysisPeriod.startMonth,endMonth:analysisPeriod.endMonth,months:confirmed.length};
  // Drop full-period aggregates in the local preview. Their authoritative subset is returned by save.
  const {operationAudit,commercialComposition,revenueReconciliation,...identity}=source;
  const selectedSource={...identity,analysisPeriod,monthlyReports,projection,fields,period,reportMonths:confirmed.length,
    purchases:{...source.purchases,selectedTotalCents:fields.purchasesOptantCents+fields.purchasesNonOptantCents},
    sales:{...source.sales,selectedTotalCents:fields.salesOptantCents+fields.salesNonOptantCents+fields.salesCpfCents+fields.serviceRevenueCents}};
  return {source:selectedSource,monthlyInputs:monthlyInputs.filter(row=>confirmed.includes(row.sourceMonth)),
    schedule:buildRbt12Schedule(extraction,confirmed),omittedMonths:schedule.rows.filter(row=>row.status!=='CONFIRMED').map(row=>row.sourceMonth)};
}
