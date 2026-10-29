/** Synthetic, deterministic saved snapshots calculated by the production engine. */
import {buildAnalysisPeriod,selectAnalysisPeriod} from '../../public/analysis-period.js';
import {baselineMonth,calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {defaultDifalPolicy,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT} from '../../public/simulator-engine.js';
import {summarizeIcmsOperations} from '../../public/simulator-icms.js';

const sum=values=>values.reduce((total,value)=>total+value,0);
const split=(value,weights)=>{const result=weights.map(weight=>Math.round(value*weight));result[result.length-1]+=value-sum(result);return result;};
const ids={simulation:'96969696-9696-4696-8696-969696969601',client:'96969696-9696-4696-8696-969696969602',generation:'96969696-9696-4696-8696-969696969603',purchases:'96969696-9696-4696-8696-969696969604',sales:'96969696-9696-4696-8696-969696969605'};

function composition(reports){
  const grossCents=sum(reports.map(row=>row.operationAudit.grossSalesCents+row.operationAudit.serviceSalesCents));
  const returnsCents=sum(reports.map(row=>row.operationAudit.salesReturnsCents)),totalCents=grossCents-returnsCents;
  const revenue=(keys,weights)=>{
    const gross=split(grossCents,weights),returns=split(returnsCents,weights);
    return keys.map((key,index)=>({key,grossCents:gross[index],returnsCents:returns[index],totalCents:gross[index]-returns[index],percent:totalCents>0?(gross[index]-returns[index])/totalCents*100:null}));
  };
  const purchasesCents=sum(reports.map(row=>row.fields.purchasesOptantCents+row.fields.purchasesNonOptantCents));
  const purchaseSimple=sum(reports.map(row=>row.fields.purchasesOptantCents));
  return {version:'COMMERCIAL_COMPOSITION_V1',unit:'CENTS',sourceMonths:reports.map(row=>row.sourceMonth),
    revenue:{grossCents,returnsCents,totalCents,percentDenominatorCents:totalCents,
      byCustomerType:revenue(['B2B','B2C','UNIDENTIFIED'],[.65,.35,0]),
      byTaxStatus:revenue(['OPTANTE','NAO_OPTANTE','CPF','NAO_CONFIRMADO','OUTROS'],[.25,.4,.35,0,0])},
    purchases:{totalCents:purchasesCents,percentDenominatorCents:purchasesCents,
      byTaxStatus:[['OPTANTE',purchaseSimple],['NAO_OPTANTE',purchasesCents-purchaseSimple],['CPF',0],['NAO_CONFIRMADO',0],['OUTROS',0]].map(([key,totalCents])=>({key,totalCents,percent:purchasesCents?totalCents/purchasesCents*100:null}))}};
}

export function drePdfFixture({variant='complete',simulationId=ids.simulation,clientId=ids.client,generationId=ids.generation}={}){
  const imported={startMonth:'2025-01',endMonth:'2025-12',months:12};
  const full=buildAnalysisPeriod(imported,imported);
  const analysisPeriod=variant==='partial'?selectAnalysisPeriod(full,['2025-01','2025-03','2025-09']):full;
  const seasonal=[145000,162000,98000,189000,178000,212000,195000,223000,235000];
  const reports=analysisPeriod.includedMonths.map(sourceMonth=>{
    const month=Number(sourceMonth.slice(5));
    const gross=variant==='zero'?0:seasonal[month-1]*100;
    const service=variant==='zero'?0:(18000+month*2500)*100;
    const returns=variant==='zero'?0:variant==='negative-revenue'?gross+service+25000*100:Math.round(gross*.015),net=gross-returns;
    const [optant,nonOptant,cpf]=split(net,[.25,.4,.35]);
    const purchaseFactor=variant==='purchases-above-revenue'?4:1;
    const purchaseSimple=variant==='zero'?0:(16000+month*800)*100*purchaseFactor;
    const purchaseRegular=variant==='zero'?0:(46000+month*2500)*100*purchaseFactor;
    const line=(natureCode,totalCents,recipientUf='MG',creditGroup='NAO_OPTANTE')=>({natureCode,totalCents,recipientUf,creditGroup});
    const internal=Math.round(gross*.6),regularInternal=Math.round(purchaseRegular*.55);
    const icmsOperations=summarizeIcmsOperations({sourceMonth,issuerUf:'MG',
      sales:[line('5102',internal),line('6102',gross-internal,'SP')],
      purchases:[line('1102',purchaseSimple,'MG','OPTANTE'),line('1102',regularInternal),line('2102',purchaseRegular-regularInternal,'SP'),line('1202',returns)]});
    return {sourceMonth,month,operationVersion:'NATURE_OPERATIONS_2026_10_V1',salesLines:gross?68+month*3:0,purchaseLines:gross?34+month*2:0,
      operationAudit:{grossSalesCents:gross,serviceSalesCents:service,salesReturnsCents:returns,reportSalesCents:gross+service,reportPurchasesCents:purchaseSimple+purchaseRegular+returns,selectedPurchasesCents:purchaseSimple+purchaseRegular,excludedSalesCents:0,excludedPurchaseCents:0,unknownSalesLines:0,unknownPurchaseLines:0},
      fields:{salesOptantCents:optant,salesNonOptantCents:nonOptant,salesCpfCents:cpf,serviceRevenueCents:service,purchasesOptantCents:purchaseSimple,purchasesNonOptantCents:purchaseRegular},
      difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:variant==='zero'?0:month*8400,baseCents:variant==='zero'?0:month*84000,eligibleLines:variant==='zero'?0:month+1,pendingLines:0},
      anticipation:{version:'ICMS_ANTICIPATION_V4',ratePercent:7.32,issuerUf:'MG',amountCents:variant==='zero'?0:month*4392,baseCents:variant==='zero'?0:month*60000,eligibleLines:variant==='zero'?0:month+1,pendingLines:0},icmsOperations};
  });
  for(const row of reports)row.commercialComposition=composition([row]);
  const first=baselineMonth(reports[0]);
  const missingRbt12=variant==='without-rbt12'||variant==='without-rbt12-only-simples';
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:missingRbt12?null:variant==='unavailable'?4000000:3300000,difalPolicy:defaultDifalPolicy(),
    ...(missingRbt12?{regimeSelection:{version:'REGIME_SELECTION_V1',selected:variant==='without-rbt12-only-simples'?['pure','hybrid']:['pure','hybrid','presumed','actual']}}:{}),
    values:{salesRevenue:sum(Object.values(first.groups).slice(0,3)),serviceRevenue:first.values.serviceRevenue,simplePurchases:first.groups.purchasesOptantCents,regularPurchases:first.groups.purchasesNonOptantCents,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const inputs=reports.map(row=>baselineMonth(row,variant==='zero'?{}:{salaries:22000+row.month*300,benefits:3600+row.month*80,adminExpenses:row.month===3?28000:4100+row.month*90,rent:variant==='loss'?185000:6500,cardExpenses:1800+row.month*110}));
  const computed=calculateMonthlySimulation(draft,reports,inputs,ids.sales,null,analysisPeriod);
  const period={startMonth:analysisPeriod.startMonth,endMonth:analysisPeriod.endMonth,startDate:'2025-01-01',endDate:'2025-09-30',months:reports.length,observedMonths:reports.length,missingMonths:analysisPeriod.missingMonths};
  const company={code:'DEMO-01',name:'COMÉRCIO E SERVIÇOS DEMONSTRAÇÃO LTDA.'};
  const fields=Object.fromEntries(Object.keys(reports[0].fields).map(key=>[key,sum(reports.map(row=>row.fields[key]))]));
  const source={generationId,clientId,company,monthlyReports:reports,fields,analysisPeriod,revenueSplit:{version:'SALES_SERVICES_V1'},operationVersion:'NATURE_OPERATIONS_2026_10_V1',reportMonths:reports.length,periodBasis:'COLUMN_H',period,projection:computed.projection,
    commercialComposition:composition(reports),operationAudit:Object.fromEntries(Object.keys(reports[0].operationAudit).map(key=>[key,sum(reports.map(row=>row.operationAudit[key]))])),
    purchases:{jobId:ids.purchases,fileName:'compras-demonstracao.csv',totalCents:sum(reports.map(row=>row.operationAudit.reportPurchasesCents)),formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-28T14:00:00Z',period},
    sales:{jobId:ids.sales,fileName:'vendas-demonstracao.csv',totalCents:sum(reports.map(row=>row.operationAudit.reportSalesCents)),formula:'Q - Y + AA - AB',calculationVersion:'NET_V2',completedAt:'2026-10-28T14:00:00Z',period},
    warnings:['Dados sintéticos de demonstração: nenhum valor pertence a cliente real.']};
  const rbt12Manual=missingRbt12?null:{source:'MANUAL',confirmed:true,rbt12Cents:draft.rbt12*100,confirmedAt:'2026-10-28T14:00:00Z',confirmedBy:{id:'synthetic-reviewer',name:'Equipe de demonstração'}};
  return {_id:simulationId,clientId,generationId,company,title:'DRE completa - demonstração sintética',source,draft,...computed,analysisPeriod,
    monthlyGroups:first.groups,monthlyGroupsUnit:'BRL',reportMonths:reports.length,reportPeriod:period,periodBasis:'COLUMN_H',periodConfirmed:true,manuallyAdjusted:false,
    monthlyDre:buildMonthlyDre(computed.result,2027,rbt12Manual,period),rbt12Source:missingRbt12?'NOT_PROVIDED':'MANUAL',...(rbt12Manual?{rbt12Manual}:{}),
    createdAt:'2026-10-28T14:00:00Z',createdBy:{id:'synthetic-reviewer',name:'Equipe de demonstração'},year:2027,
    taxSources:TAX_SOURCES,modelVersion:computed.result.version,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,
    annualRevenue:computed.result.annualRevenue,bestRegimeId:computed.result.bestRegimeId};
}
