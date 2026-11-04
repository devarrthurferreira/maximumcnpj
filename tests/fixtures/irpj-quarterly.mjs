/** Synthetic quarterly scenario shared by presentation and browser regression tests. */
import {drePdfFixture} from './dre-pdf.mjs';
import {selectAnalysisPeriod} from '../../public/analysis-period.js';
import {baselineMonth,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';

export function irpjQuarterlyFixture({sales=[400000,300000,100000],services=[],rents=[182400,291800,70600],months=sales.map((_,index)=>index+1),rbt12=500000}={}){
  const seed=drePdfFixture(),sourceMonths=months.map(month=>`2025-${String(month).padStart(2,'0')}`);
  const analysisPeriod=selectAnalysisPeriod(seed.analysisPeriod,sourceMonths);
  const reports=months.map((month,index)=>{
    const salesCents=Math.round((sales[index]||0)*100),serviceCents=Math.round((services[index]||0)*100);
    return {sourceMonth:sourceMonths[index],month,salesLines:1,purchaseLines:0,operationVersion:'NATURE_OPERATIONS_2026_10_V1',
      fields:{salesOptantCents:0,salesNonOptantCents:salesCents,salesCpfCents:0,serviceRevenueCents:serviceCents,purchasesOptantCents:0,purchasesNonOptantCents:0},
      operationAudit:{grossSalesCents:Math.max(salesCents,0),serviceSalesCents:serviceCents,salesReturnsCents:Math.max(-salesCents,0),reportSalesCents:salesCents+serviceCents,reportPurchasesCents:0,selectedPurchasesCents:0,excludedSalesCents:0,excludedPurchaseCents:0,unknownSalesLines:0,unknownPurchaseLines:0}};
  });
  const draft={...seed.draft,rbt12,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']},
    values:Object.fromEntries(Object.keys(seed.draft.values).map(key=>[key,0]))};
  const inputs=reports.map((report,index)=>baselineMonth(report,{rent:rents[index]||0}));
  const computed=calculateMonthlySimulation(draft,reports,inputs,seed.source.sales.jobId,null,analysisPeriod);
  const sumField=(group,key)=>reports.reduce((sum,report)=>sum+report[group][key],0);
  const fields=Object.fromEntries(Object.keys(reports[0].fields).map(key=>[key,sumField('fields',key)]));
  const operationAudit=Object.fromEntries(Object.keys(reports[0].operationAudit).map(key=>[key,sumField('operationAudit',key)]));
  const period={startMonth:sourceMonths[0],endMonth:sourceMonths.at(-1),months:reports.length,observedMonths:reports.length,missingMonths:analysisPeriod.missingMonths};
  const source={...seed.source,monthlyReports:reports,fields,operationAudit,analysisPeriod,period,reportMonths:reports.length,projection:computed.projection,
    sales:{...seed.source.sales,totalCents:fields.salesNonOptantCents+fields.serviceRevenueCents,period},purchases:{...seed.source.purchases,totalCents:0,period}};
  delete source.commercialComposition;
  const rbt12Manual=rbt12===null?null:{...seed.rbt12Manual,rbt12Cents:Math.round(rbt12*100)};
  const saved={...seed,...computed,draft,source,analysisPeriod,title:'IRPJ trimestral · demonstração sintética',
    monthlyGroups:inputs[0].groups,reportMonths:reports.length,reportPeriod:period,
    rbt12Source:rbt12===null?'NOT_PROVIDED':'MANUAL',rbt12Manual,
    monthlyDre:buildMonthlyDre(computed.result,2027,rbt12Manual,period),
    annualRevenue:computed.result.annualRevenue,bestRegimeId:computed.result.bestRegimeId,modelVersion:computed.result.version};
  if(rbt12===null)delete saved.rbt12Manual;
  return saved;
}
