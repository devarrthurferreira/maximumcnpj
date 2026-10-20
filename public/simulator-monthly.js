import {REPORT_GROUPS} from './simulator-projection.js';
import {calculateSimulation, draftToInput, SIMULATION_VALUE_FIELDS} from './simulator-engine.js';

export const MONTHLY_MODEL_VERSION='1.3.0-report-months';
export const MONTHLY_VERSION='REPORT_MONTHS_V1';
export const MONTHLY_FIELDS=Object.freeze([...REPORT_GROUPS,'serviceRevenueCents']);
const sum=values=>values.reduce((a,b)=>a+b,0);
const fixedMemory=id=>['rbt12','sublimit','simplesLimit'].includes(id)||/^simples\..+\.deduction$/.test(id);
const monthlyMemory=item=>{
  if(item.id==='months')return {...item,value:1,formula:'Uma competência dos relatórios, calculada separadamente com as premissas do modelo.'};
  if(item.unit!=='currency'||fixedMemory(item.id)||['difal.source','difal.monthly'].includes(item.id)||/^group\..+\.(purchases|base)$/.test(item.id))return item;
  return {...item,value:item.value/12,label:item.label.replace(/anual/g,'da competência'),formula:`Contribuição da competência: (${item.formula}) ÷ 12, no modelo aplicado somente aos valores deste mês.`};
};
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const asCents=(value,signed=false)=>{
  check(typeof value==='number'&&Number.isFinite(value)&&(signed||value>=0)&&Math.abs(value)<=1e12&&value===Math.round(value*100)/100,'Preencha cada competência com valores válidos em reais e até duas casas decimais.');
  return Math.round(value*100);
};
export function monthlyProjection(reports){
  check(Array.isArray(reports)&&reports.length>=1&&reports.length<=12,'Reimporte compras e vendas com as datas da coluna H para calcular cada competência.');
  const seen=new Set();
  for(const row of reports){
    check(/^\d{4}-(0[1-9]|1[0-2])$/.test(row.sourceMonth)&&row.month===Number(row.sourceMonth.slice(5))&&!seen.has(row.month),'Competências mensais inválidas ou duplicadas.');seen.add(row.month);
    check(MONTHLY_FIELDS.every(key=>Number.isSafeInteger(row.fields?.[key])&&(key.startsWith('sales')||row.fields[key]>=0)),'Valores mensais do relatório inválidos.');
  }
  const annualGroupsCents=Object.fromEntries(MONTHLY_FIELDS.map(key=>[key,sum(reports.map(row=>row.fields[key]))]));
  check(Object.values(annualGroupsCents).every(Number.isSafeInteger),'Total mensal acima do limite seguro.');
  const timeline=reports.map(row=>({...row,salesCents:sum(MONTHLY_FIELDS.slice(0,3).map(key=>row.fields[key]))+row.fields.serviceRevenueCents,purchasesCents:row.fields.purchasesOptantCents+row.fields.purchasesNonOptantCents}));
  const totals=Object.fromEntries(['sales','purchases'].map(side=>[side,{totalCents:sum(timeline.map(row=>row[side+'Cents'])),annualCents:sum(timeline.map(row=>row[side+'Cents']))}]));
  return {version:MONTHLY_VERSION,method:'SUM_ACTUAL_COMPETENCES',unit:'CENTS',reportMonths:reports.length,projectionMonths:reports.length,annualGroupsCents,
    groups:MONTHLY_FIELDS.map(key=>({key,totalCents:annualGroupsCents[key],annualCents:annualGroupsCents[key]})),totals,timeline};
}
export function monthlyDifal(reports,sourceJobId){
  monthlyProjection(reports);
  if(reports.some(row=>!row.difal))return null;
  const totals=Object.fromEntries(['amountCents','baseCents','eligibleLines','pendingLines'].map(key=>[key,sum(reports.map(row=>row.difal[key]))]));
  return {version:'DIFAL_MONTHS_V1',sourceJobId,sourceVersion:reports[0].difal.version,sourceAmountCents:totals.amountCents,sourceBaseCents:totals.baseCents,
    annualCents:totals.amountCents,ratePercent:10,issuerUf:reports[0].difal.issuerUf,reportMonths:reports.length,eligibleLines:totals.eligibleLines,pendingLines:totals.pendingLines,
    months:reports.map(row=>({sourceMonth:row.sourceMonth,month:row.month,...row.difal}))};
}
export function baselineMonth(row,expenses={}){
  return {sourceMonth:row.sourceMonth,groups:Object.fromEntries(REPORT_GROUPS.map(key=>[key,row.fields[key]/100])),
    values:{serviceRevenue:row.fields.serviceRevenueCents/100,...Object.fromEntries(['salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,expenses[key]??0]))}};
}
/** Monthly movements feed the reviewed model separately. Annual results sum those months, never a report average. */
export function calculateMonthlySimulation(draft,reports,monthlyInputs,sourceJobId){
  const projection=monthlyProjection(reports),difalProjection=monthlyDifal(reports,sourceJobId);
  check(Array.isArray(monthlyInputs)&&monthlyInputs.length===reports.length,'Preencha os valores de todas as competências.');
  const adjustments=[];
  const monthlyResults=reports.map((row,index)=>{
    const input=monthlyInputs[index],baseline=baselineMonth(row);
    check(input?.sourceMonth===row.sourceMonth&&Object.keys(input).every(key=>['sourceMonth','groups','values'].includes(key)),'As competências do cenário divergem dos relatórios.');
    check(input.groups&&Object.keys(input.groups).length===REPORT_GROUPS.length&&input.values&&Object.keys(input.values).length===6,'Campos mensais incompletos ou não reconhecidos.');
    const groups=Object.fromEntries(REPORT_GROUPS.map((key,i)=>[key,asCents(input.groups[key],i<3)/100]));
    const values=Object.fromEntries(['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,asCents(input.values[key])/100]));
    values.salesRevenue=sum(REPORT_GROUPS.slice(0,3).map(key=>asCents(groups[key],true)))/100;
    values.simplePurchases=groups.purchasesOptantCents;values.regularPurchases=groups.purchasesNonOptantCents;
    check(values.salesRevenue>=0,`As devoluções superam as vendas de mercadorias em ${row.sourceMonth}. Revise essa competência antes de simular.`);
    for(const key of [...REPORT_GROUPS,'serviceRevenue']){
      const value=key==='serviceRevenue'?values[key]:groups[key],original=key==='serviceRevenue'?baseline.values[key]:baseline.groups[key];
      if(value!==original)adjustments.push({sourceMonth:row.sourceMonth,field:key,reportMonthlyValue:original,simulatedMonthlyValue:value});
    }
    const d={...draft,values},difal=row.difal?{version:'DIFAL_DRE_V1',monthlyCents:row.difal.amountCents,annualCents:row.difal.amountCents*12,
      sourceAmountCents:row.difal.amountCents,reportMonths:1,pendingLines:row.difal.pendingLines}:null;
    const raw=calculateSimulation(d,difal),engineInput=draftToInput(d,difal);
    // The existing model reports a 12-month projection from one monthly input.
    // Convert each independent run to its one-month contribution before summing.
    const result={...raw,annualRevenue:values.salesRevenue+values.serviceRevenue,difference:raw.difference/12,
      regimes:raw.regimes.map(regime=>({...regime,annualProfit:regime.annualProfit/12,monthlyProfit:regime.annualProfit/12,totalTaxes:regime.totalTaxes/12,dre:Object.fromEntries(Object.entries(regime.dre).map(([key,value])=>[key,value/12]))})),
      credits:Object.fromEntries(Object.entries(raw.credits).map(([tax,credit])=>[tax,Object.fromEntries(Object.entries(credit).map(([key,value])=>[key,value/12]))])),
      memory:raw.memory.filter(item=>!/^summary\..+\.monthly$/.test(item.id)&&item.id!=='difal.monthly').map(monthlyMemory)};
    return {sourceMonth:row.sourceMonth,month:row.month,groups,values,engineInput,result};
  });
  const first=monthlyResults[0].result,annualRevenue=sum(monthlyResults.map(row=>row.result.annualRevenue));
  const regimes=first.regimes.map(regime=>{
    const all=monthlyResults.map(row=>row.result.regimes.find(item=>item.id===regime.id));
    const dre=Object.fromEntries(Object.keys(regime.dre).map(key=>[key,sum(all.map(item=>item.dre[key]))]));
    const totalTaxes=sum(all.map(item=>item.totalTaxes));
    return {...regime,available:all.every(item=>item.available),annualProfit:dre.netProfit,monthlyProfit:null,totalTaxes,dre,
      margin:annualRevenue>0?dre.netProfit/annualRevenue:null,taxBurden:annualRevenue>0?totalTaxes/annualRevenue:null};
  });
  const ranked=annualRevenue>0?regimes.filter(row=>row.available).sort((a,b)=>b.annualProfit-a.annualProfit):[];
  const credits=Object.fromEntries(Object.keys(first.credits).map(tax=>[tax,Object.fromEntries(Object.keys(first.credits[tax]).map(key=>[key,sum(monthlyResults.map(row=>row.result.credits[tax][key]))]))]));
  const memory=first.memory.filter(item=>item.unit==='currency').map(item=>fixedMemory(item.id)?{...item}:({...item,label:item.label.replace(/médio mensal|mensal|anual|da competência/g,'do período'),
    formula:'Soma dos valores calculados separadamente em cada competência importada.',
    value:sum(monthlyResults.map(row=>row.result.memory.find(entry=>entry.id===item.id)?.value||0))}));
  const warnings=[...new Map(monthlyResults.flatMap(row=>row.result.warnings.map(item=>({...item,detail:`${row.sourceMonth}: ${item.detail}`}))).filter(item=>!['difal-estimate'].includes(item.code)).map(item=>[item.code,item])).values()];
  warnings.push({code:'actual-months',severity:'info',title:'Valores por competência',detail:'Compras, vendas, serviços e DIFAL seguem cada mês da coluna H. Tributos estimados separadamente com as premissas do simulador e RBT12 fixa; total anual é a soma dos meses importados. Meses fora do período não têm dados. Não há compensação automática de créditos entre competências.'});
  const result={...first,version:MONTHLY_MODEL_VERSION,method:MONTHLY_VERSION,annualRevenue,regimes,credits,memory,warnings,monthlyResults,
    bestRegimeId:ranked[0]?.id||null,difference:ranked.length?ranked[0].annualProfit-ranked.at(-1).annualProfit:0};
  projection.scenario={unit:'CENTS',annual:{revenueCents:sum(monthlyResults.map(row=>asCents(row.values.salesRevenue)+asCents(row.values.serviceRevenue)))},months:monthlyResults.map(({sourceMonth,groups,values})=>({sourceMonth,groups,values}))};
  return {result,projection,difalProjection,adjustments,monthlyInputs:monthlyResults.map(({sourceMonth,groups,values})=>({sourceMonth,groups,values:Object.fromEntries(['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,values[key]]))})),
    engineInput:{version:MONTHLY_VERSION,months:monthlyResults.map(({sourceMonth,engineInput})=>({sourceMonth,input:engineInput})),rbt12:draft.rbt12}};
}
