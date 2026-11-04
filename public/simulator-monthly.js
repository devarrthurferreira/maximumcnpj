import {assessQuarterlyIncomeTaxes,INCOME_TAX_MODEL_VERSION} from './simulator-income-tax.js';
import {REPORT_GROUPS} from './simulator-projection.js';
import {calculateSimulation, draftToInput, SIMULATION_VALUE_FIELDS, REVENUE_CONTEXT_VERSION, SIMPLES_DIAGNOSTIC_VERSION} from './simulator-engine.js';
import {parseIcmsOperations} from './simulator-icms.js';
import {resolveRegimeSelection,requiresSimplesReference} from './regime-selection.js';
import {JAN_SEP_MODEL_VERSION,assertCompleteAnalysisPeriod} from './analysis-period.js';

export const MONTHLY_MODEL_VERSION=INCOME_TAX_MODEL_VERSION;
export const MONTHLY_VERSION='REPORT_MONTHS_V1';
export const MONTHLY_FIELDS=Object.freeze([...REPORT_GROUPS,'serviceRevenueCents']);
const sum=values=>values.reduce((a,b)=>a+b,0);
const fixedMemory=id=>['rbt12','sublimit','simplesLimit','simples.revenueReference','revenue.reference'].includes(id)||/^simples\..+\.deduction$/.test(id);
const IRPJ_MONTHLY_FORMULAS={
  'presumed.irIncrease':'Excedente trimestral da LC 224/2025 × coeficiente ponderado das atividades × 10%.',
  'presumed.irTotalBase':'Base acumulada do trimestre sem acréscimo + acréscimo da base.',
  'presumed.irBasic':'Movimento da provisão normal: base acumulada do trimestre × 15%, em centavos, menos a provisão anterior.',
  'presumed.irAdditional':'Movimento do adicional: máximo(0; base acumulada do trimestre − R$ 60.000) × 10%, em centavos, menos a provisão anterior.',
  'presumed.irTotal':'Movimentos do IRPJ normal e adicional da competência.',
  'actual.preTax':'Resultado operacional da competência − CBS líquido − IBS líquido − ICMS líquido − ISS − encargos LP/LR. DIFAL não se aplica ao Lucro Real.',
  'actual.base':'Máximo(0; soma dos resultados com sinal no trimestre); sem ajustes fiscais ou compensações.',
  'actual.irBasic':'Movimento da provisão normal: base positiva acumulada do trimestre × 15%, em centavos, menos a provisão anterior.',
  'actual.irAdditional':'Movimento do adicional: máximo(0; base acumulada do trimestre − R$ 60.000) × 10%, em centavos, menos a provisão anterior.',
  'actual.irTotal':'Movimentos do IRPJ normal e adicional da competência.'
};
const monthlyMemory=item=>{
  if(item.id==='months')return {...item,value:1,formula:'Uma competência dos relatórios, calculada separadamente com as premissas do modelo.'};
  if(item.unit!=='currency'||fixedMemory(item.id)||['difal.source','difal.monthly','icmsAnticipation.source','icmsAnticipation.base','icmsAnticipation.monthly'].includes(item.id)||/^group\..+\.(purchases|base)$/.test(item.id))return item;
  const irpjFormula=item.id==='presumed.irBase'?item.formula.replace(/anuais/g,'da competência'):IRPJ_MONTHLY_FORMULAS[item.id];
  return {...item,value:item.value/12,label:item.label.replace(/anual/g,'da competência'),formula:irpjFormula??`Contribuição da competência: (${item.formula}) ÷ 12, no modelo aplicado somente aos valores deste mês.`};
};
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const asCents=(value,signed=false)=>{
  check(typeof value==='number'&&Number.isFinite(value)&&(signed||value>=0)&&Math.abs(value)<=1e12&&value===Math.round(value*100)/100,'Preencha cada competência com valores válidos em reais e até duas casas decimais.');
  return Math.round(value*100);
};
/** Capture monthly movements and their cumulative-quarter explanation together. */
function applyIncomeTaxAssessment(result,container,monthly){
  const setMemory=(id,value,label,formula,reason='')=>{
    const item=result.memory.find(entry=>entry.id===id);if(!item)return;
    if(reason){Object.assign(item,{unit:'text',value:'Conferência necessária',availability:'UNAVAILABLE',label,formula:reason});return;}
    Object.assign(item,{value,unit:'currency',label,formula});delete item.availability;
  };
  for(const id of ['presumed','actual']){
    const assessment=container.regimes[id],regime=result.regimes.find(row=>row.id===id);
    if(!regime||!assessment)continue;
    const available=regime.available&&assessment.available;
    const reason=!assessment.available?assessment.reason:!regime.available?regime.status:'';
    const b=assessment.bases,t=assessment.movement;
    if(available){
      regime.dre.irpj=t.irpjTotalCents===0?0:-t.irpjTotalCents/100;regime.dre.csll=t.csllCents===0?0:-t.csllCents/100;
      regime.dre.netProfit=regime.dre.preTax+regime.dre.irpj+regime.dre.csll;
      const d=regime.dre;
      regime.totalTaxes=-d.das-d.cbsDebit-d.ibsDebit-d.icmsNet-d.iss-(d.difal??0)-(d.icmsAnticipation??0)-d.payroll-d.irpj-d.csll-d.cbsUsed-d.ibsUsed;
      regime.annualProfit=d.netProfit;regime.monthlyProfit=monthly?d.netProfit:null;
      regime.margin=result.annualRevenue>0?d.netProfit/result.annualRevenue:null;
      regime.taxBurden=result.annualRevenue>0?regime.totalTaxes/result.annualRevenue:null;
      regime.status=container.realAnnualLossZero&&id==='actual'?'Prejuízo acumulado Jan–Set: IRPJ e CSLL zerados no cenário gerencial; isso não cancela imposto trimestral devido.':assessment.status==='PROVISIONAL'?'Provisão trimestral disponível; fechamento incompleto.':id==='actual'?'Estimativa gerencial dos trimestres capturados; sujeita aos ajustes fiscais.':'Trimestres capturados conciliados; simulação sujeita ao enquadramento.';
    }else{
      // Numeric legacy-shaped fields remain unconfirmed behind available=false.
      // Metadata and memory carry null/unavailable rather than certifying a zero.
      regime.available=false;regime.status=reason;regime.margin=null;regime.taxBurden=null;
    }
    const baseLabel=monthly?(assessment.scope==='ANNUAL_ADJUSTMENT'?'das apurações ajustadas no ano':'acumulada do trimestre'):'dos trimestres do período';
    const baseFormula=monthly?'Base acumulada das competências conhecidas do trimestre; receitas e resultados mantêm o sinal antes do mínimo zero.':'Soma das bases finais de cada trimestre capturado, sem somar novamente os acumulados mensais.';
    const taxFormula=monthly?'Movimento em centavos = provisão cumulativa arredondada − provisão anterior; pode ser negativo em uma reversão.':'Soma dos movimentos mensais em centavos; concilia com os componentes arredondados de cada trimestre.';
    for(const [suffix,key,label] of [['irBasic','irpjNormalCents','IRPJ normal'],['irAdditional','irpjAdditionalCents','Adicional de IRPJ'],['irTotal','irpjTotalCents','IRPJ total'],['csTotal','csllCents','CSLL']]){
      setMemory(`${id}.${suffix}`,t?.[key]/100,`${label}: ${monthly?'movimento da competência':'total do período'}`,taxFormula,reason);
    }
    if(id==='presumed'){
      for(const [suffix,key,label]of [['irBase','irpjBaseWithoutIncrease','Base IRPJ sem acréscimo'],['irIncrease','irpjIncrease','Acréscimo da base IRPJ'],['irTotalBase','irpjBase','Base presumida total IRPJ'],['csBase','csllBaseWithoutIncrease','Base CSLL sem acréscimo'],['csIncrease','csllIncrease','Acréscimo da base CSLL'],['csTotalBase','csllBase','Base presumida total CSLL']])setMemory(`${id}.${suffix}`,b?.[key],`${label} ${baseLabel}`,baseFormula,reason);
      setMemory('presumed.excessRevenue',assessment.available?sum(assessment.periods.map(period=>period.lc224?.excessRevenue??0)):null,`Receita excedente LC 224/2025 ${baseLabel}`,'Excedente após o limite de R$ 1.250.000 por trimestre e saldo anterior conhecido; ajuste anual quando disponível. O ano usado é o do cenário.',reason);
      for(const [suffix,key]of [['irCoefficient','irpjBaseWithoutIncrease'],['csCoefficient','csllBaseWithoutIncrease']]){
        const item=result.memory.find(entry=>entry.id===`presumed.${suffix}`);if(!item)continue;
        if(reason)Object.assign(item,{value:'Conferência necessária',unit:'text',availability:'UNAVAILABLE',formula:reason});
        else{Object.assign(item,{value:b.revenue>0?b[key]/b.revenue:0,unit:'percent',formula:'Base acumulada sem acréscimo dividida pela receita líquida acumulada do trimestre; não usar a composição de um mês isolado.'});delete item.availability;}
      }
    }else setMemory('actual.base',b?.irpjBase,`Base positiva estimada ${baseLabel}`,baseFormula+' O Lucro Real é gerencial, sem ajustes fiscais ou compensações.',reason);
    for(const key of ['irpj','csll','netProfit'])setMemory(`dre.${id}.${key}`,regime.dre[key],result.memory.find(item=>item.id===`dre.${id}.${key}`)?.label||key,key==='netProfit'?'Resultado antes de IRPJ/CSLL menos os movimentos de IRPJ e CSLL.':`Sinal oposto do movimento ${key.toUpperCase()} do período; reversões aumentam o resultado.`,reason);
    setMemory(`summary.${id}.taxes`,regime.totalTaxes,'Tributos e encargos totais','Soma dos tributos, encargos e movimentos de IRPJ/CSLL, deduzidos os créditos utilizados; sem duplicar composições.',reason);
    for(const [suffix,value]of [['margin',regime.margin],['burden',regime.taxBurden]]){
      const item=result.memory.find(entry=>entry.id===`summary.${id}.${suffix}`);
      if(item)Object.assign(item,{value:value??'Não aplicável',unit:value===null?'text':'percent'});
    }
  }
  const ranked=result.annualRevenue>0?result.regimes.filter(regime=>regime.available).sort((a,b)=>b.annualProfit-a.annualProfit):[];
  result.bestRegimeId=ranked[0]?.id??null;result.difference=ranked.length?ranked[0].annualProfit-ranked.at(-1).annualProfit:0;
}
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
  return {version:'DIFAL_MONTHS_V1',sourceJobId,sourceVersion:'DIFAL_ESTIMATE_V6',outgoingDisabled:true,sourceAmountCents:0,sourceBaseCents:0,
    annualCents:0,ratePercent:10,issuerUf:reports[0].difal?.issuerUf||'',reportMonths:reports.length,eligibleLines:0,pendingLines:0,
    months:reports.map(row=>({sourceMonth:row.sourceMonth,month:row.month,version:'DIFAL_ESTIMATE_V6',ratePercent:10,
      issuerUf:row.difal?.issuerUf||'',amountCents:0,baseCents:0,eligibleLines:0,pendingLines:0}))};
}
export function baselineMonth(row,expenses={}){
  return {sourceMonth:row.sourceMonth,groups:Object.fromEntries(REPORT_GROUPS.map(key=>[key,row.fields[key]/100])),
    values:{serviceRevenue:row.fields.serviceRevenueCents/100,...Object.fromEntries(['salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,expenses[key]??0]))}};
}
export function monthlyAnticipation(reports){
  const present=reports.filter(row=>row.anticipation);
  if(!present.length)return null;
  check(present.length===reports.length,'A antecipação de ICMS precisa estar disponível para todas as competências.');
  const sourceVersion=present[0].anticipation.version;
  for(const {anticipation:a} of reports)check(['ICMS_ANTICIPATION_V1','ICMS_ANTICIPATION_V2','ICMS_ANTICIPATION_V3','ICMS_ANTICIPATION_V4','ICMS_ANTICIPATION_V5'].includes(a.version)&&a.version===sourceVersion&&a.ratePercent===7.32&&
    ['amountCents','baseCents','eligibleLines','pendingLines'].every(key=>Number.isSafeInteger(a[key])&&a[key]>=0),'Referência da antecipação de ICMS inválida.');
  const totals=Object.fromEntries(['amountCents','baseCents','eligibleLines','pendingLines'].map(key=>[key,sum(reports.map(row=>row.anticipation[key]))]));
  check(Object.values(totals).every(Number.isSafeInteger),'Total de antecipação de ICMS acima do limite seguro.');
  return {version:'ICMS_ANTICIPATION_MONTHS_V1',sourceVersion,ratePercent:7.32,
    sourceAmountCents:totals.amountCents,sourceBaseCents:totals.baseCents,annualCents:totals.amountCents,
    eligibleLines:totals.eligibleLines,pendingLines:totals.pendingLines,reportMonths:reports.length,
    months:reports.map(row=>({sourceMonth:row.sourceMonth,month:row.month,...row.anticipation}))};
}
/** Monthly movements feed the reviewed model separately. Annual results sum those months, never a report average. */
export function calculateMonthlySimulation(draft,reports,monthlyInputs,sourceJobId,rbt12Schedule=null,analysisPeriod=null){
  if(analysisPeriod)analysisPeriod=structuredClone(assertCompleteAnalysisPeriod(analysisPeriod,reports));
  const regimeSelection=resolveRegimeSelection(draft.regimeSelection),hasSimples=requiresSimplesReference(regimeSelection);
  check(hasSimples||rbt12Schedule===null,'A composição da RBT12 não se aplica aos regimes selecionados.');
  const projection=monthlyProjection(reports),difalProjection=monthlyDifal(reports,sourceJobId),anticipationProjection=monthlyAnticipation(reports);
  const hasIcmsOperations=reports.some(row=>row.icmsOperations!==undefined);
  if(hasIcmsOperations)for(const row of reports){
    const icms=parseIcmsOperations(row.icmsOperations);
    check(icms.sourceMonth===row.sourceMonth&&icms.sourceRegularPurchasesCents===row.fields.purchasesNonOptantCents&&
      icms.sales.totalBaseCents-icms.salesReturns.totalBaseCents===sum(REPORT_GROUPS.slice(0,3).map(key=>row.fields[key])),
      'A composição de ICMS não corresponde às bases e à competência dos relatórios.');
  }
  if(rbt12Schedule){
    rbt12Schedule=structuredClone(rbt12Schedule);
    check(rbt12Schedule.version==='RBT12_MONTHLY_SECTION_22_V1'&&rbt12Schedule.sourceSection==='2.2'&&Array.isArray(rbt12Schedule.rows)&&rbt12Schedule.rows.length===reports.length,'Composição mensal da RBT12 inválida.');
    for(const [i,row] of reports.entries()){
      const reference=rbt12Schedule.rows[i];
      check(reference?.sourceMonth===row.sourceMonth,'A composição da RBT12 não corresponde às competências dos relatórios.');
      check(reference.status==='CONFIRMED'&&Number.isSafeInteger(reference.rbt12Cents)&&reference.rbt12Cents>=0,
        `O quadro 2.2 não cobre a RBT12 de ${row.sourceMonth}. Faltam as receitas de ${(reference.missingMonths||[]).join(', ')}. Importe um extrato com o histórico necessário.`);
    }
  }
  check(Array.isArray(monthlyInputs)&&monthlyInputs.length===reports.length,'Preencha os valores de todas as competências.');
  const adjustments=[];
  // Validate every month before deriving the revenue reference. A seasonal month is
  // never multiplied by twelve to decide whether the period fits this model.
  const prepared=reports.map((row,index)=>{
    const input=monthlyInputs[index],baseline=baselineMonth(row);
    check(input?.sourceMonth===row.sourceMonth&&Object.keys(input).every(key=>['sourceMonth','groups','values'].includes(key)),'As competências do cenário divergem dos relatórios.');
    check(input.groups&&Object.keys(input.groups).length===REPORT_GROUPS.length&&input.values&&Object.keys(input.values).length===6,'Campos mensais incompletos ou não reconhecidos.');
    const groups=Object.fromEntries(REPORT_GROUPS.map((key,i)=>[key,asCents(input.groups[key],i<3)/100]));
    const values=Object.fromEntries(['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,asCents(input.values[key])/100]));
    values.salesRevenue=sum(REPORT_GROUPS.slice(0,3).map(key=>asCents(groups[key],true)))/100;
    values.simplePurchases=groups.purchasesOptantCents;values.regularPurchases=groups.purchasesNonOptantCents;
    for(const key of [...REPORT_GROUPS,'serviceRevenue']){
      const value=key==='serviceRevenue'?values[key]:groups[key],original=key==='serviceRevenue'?baseline.values[key]:baseline.groups[key];
      if(value!==original)adjustments.push({sourceMonth:row.sourceMonth,field:key,reportMonthlyValue:original,simulatedMonthlyValue:value});
    }
    return {row,index,groups,values};
  });
  const revenues=prepared.map(({values})=>asCents(values.salesRevenue,true)+asCents(values.serviceRevenue));
  const revenueCents=sum(revenues),positiveRevenueCents=sum(revenues.map(value=>Math.max(0,value)));
  check(Number.isSafeInteger(revenueCents)&&Number.isSafeInteger(positiveRevenueCents),'Receita do período acima do limite seguro.');
  const revenueContext={version:REVENUE_CONTEXT_VERSION,method:'ACTUAL_REPORT_MONTHS',revenueCents,sourceMonths:reports.map(row=>row.sourceMonth),
    ...(positiveRevenueCents===revenueCents?{}:{positiveRevenueCents})};
  const monthlyResults=prepared.map(({row,index,groups,values})=>{
    const d={...draft,...(rbt12Schedule?{rbt12:rbt12Schedule.rows[index].rbt12Cents/100}:{}),values},difal={version:'DIFAL_DRE_V1',monthlyCents:0,annualCents:0,
      sourceAmountCents:0,reportMonths:1,pendingLines:0};
    const anticipation=row.anticipation?{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:row.anticipation.amountCents,annualCents:row.anticipation.amountCents*12,
      sourceAmountCents:row.anticipation.amountCents,sourceBaseCents:row.anticipation.baseCents,reportMonths:1,pendingLines:row.anticipation.pendingLines}:null;
    const raw=calculateSimulation(d,difal,anticipation,revenueContext,row.icmsOperations??null),engineInput=draftToInput(d,difal,anticipation,revenueContext,row.icmsOperations??null);
    // The existing model reports a 12-month projection from one monthly input.
    // Convert each independent run to its one-month contribution before summing.
    const result={...raw,annualRevenue:values.salesRevenue+values.serviceRevenue,difference:raw.difference/12,
      regimes:raw.regimes.map(regime=>({...regime,annualProfit:regime.annualProfit/12,monthlyProfit:regime.annualProfit/12,totalTaxes:regime.totalTaxes/12,dre:Object.fromEntries(Object.entries(regime.dre).map(([key,value])=>[key,value/12]))})),
      credits:Object.fromEntries(Object.entries(raw.credits).map(([tax,credit])=>[tax,Object.fromEntries(Object.entries(credit).map(([key,value])=>[key,value/12]))])),
      memory:raw.memory.filter(item=>!/^summary\..+\.monthly$/.test(item.id)&&!['difal.monthly','icmsAnticipation.monthly'].includes(item.id)).map(monthlyMemory)};
    return {sourceMonth:row.sourceMonth,month:row.month,groups,values,engineInput,result};
  });
  const incomeTaxes=assessQuarterlyIncomeTaxes({year:draft.year,basis:'ACTUAL_REPORT_MONTHS',
    regimeIds:regimeSelection.selected.filter(id=>['presumed','actual'].includes(id)),
    annualLossZeroForReal:analysisPeriod?.version==='JAN_SEP_V1',
    months:monthlyResults.map(row=>{
      const actual=row.result.regimes.find(regime=>regime.id==='actual');
      const projectedExact=row.result.incomeTaxAssessment.monthlyAssessments?.[`${draft.year}-01`]?.regimes.actual?.periods[0]?.inputs[0]?.preTaxExact;
      return {sourceMonth:row.sourceMonth,month:row.month,salesRevenue:row.values.salesRevenue,serviceRevenue:row.values.serviceRevenue,
        preTax:actual?.available?actual.dre.preTax:null,...(actual?.available&&projectedExact?{preTaxExact:projectedExact}:{}),actualAvailable:actual?.available===true};
    })});
  for(const row of monthlyResults){
    row.result.incomeTaxAssessment=incomeTaxes.monthlyAssessments[row.sourceMonth];
    applyIncomeTaxAssessment(row.result,row.result.incomeTaxAssessment,true);
  }
  const first=monthlyResults[0].result,annualRevenue=sum(monthlyResults.map(row=>row.result.annualRevenue));
  const regimes=first.regimes.map(regime=>{
    const all=monthlyResults.map(row=>row.result.regimes.find(item=>item.id===regime.id));
    const dre=Object.fromEntries(Object.keys(regime.dre).map(key=>[key,sum(all.map(item=>item.dre[key]))]));
    const totalTaxes=sum(all.map(item=>item.totalTaxes));
    const available=all.every(item=>item.available);
    const missingRbt12=['pure','hybrid'].includes(regime.id)&&monthlyResults.every(row=>row.result.simplesDiagnostic?.statusCode==='MISSING_RBT12');
    const status=missingRbt12?`RBT12 não informada; cálculo do Simples pendente ${monthlyResults.length===1?'na competência informada':`nas ${monthlyResults.length} competências informadas`}.`:
      !available?`Cálculo pendente em: ${monthlyResults.filter((row,index)=>!all[index].available).map(row=>`${row.sourceMonth}: ${row.result.regimes.find(item=>item.id===regime.id).status}`).join(' ')}`:
      annualRevenue===0?'Calculado com receita consolidada zero':annualRevenue<0?'Calculado com receita consolidada negativa; confira os alertas':['pure','hybrid'].includes(regime.id)?`Cálculo disponível nas competências informadas · ICMS/ISS ${draft.icmsOutside?'fora do':'no'} DAS`:
      regime.id==='presumed'?'Simulação sujeita ao enquadramento':'Cálculo disponível nas competências informadas';
    return {...regime,available,status,annualProfit:dre.netProfit,monthlyProfit:null,totalTaxes,dre,
      difalApplication:{version:regime.difalApplication.version,enabled:regime.difalApplication.enabled,operations:{...regime.difalApplication.operations},
        months:all.map((item,index)=>({sourceMonth:monthlyResults[index].sourceMonth,...item.difalApplication}))},
      margin:all.every(item=>item.available)&&annualRevenue>0?dre.netProfit/annualRevenue:null,taxBurden:all.every(item=>item.available)&&annualRevenue>0?totalTaxes/annualRevenue:null};
  });
  const ranked=annualRevenue>0?regimes.filter(row=>row.available).sort((a,b)=>b.annualProfit-a.annualProfit):[];
  const credits=Object.fromEntries(Object.keys(first.credits).map(tax=>[tax,Object.fromEntries(Object.keys(first.credits[tax]).map(key=>[key,sum(monthlyResults.map(row=>row.result.credits[tax][key]))]))]));
  const memory=first.memory.filter(item=>(item.unit==='currency'||item.id==='rbt12'||item.id==='outside'||item.availability==='UNAVAILABLE')&&(!rbt12Schedule||item.id!=='rbt12')&&
    (!fixedMemory(item.id)||monthlyResults.every(row=>row.result.memory.some(entry=>entry.id===item.id&&entry.unit===item.unit&&entry.value===item.value)))).map(item=>{
      if((fixedMemory(item.id)&&item.availability!=='UNAVAILABLE')||item.id==='outside')return {...item};
      const entries=monthlyResults.map(row=>({sourceMonth:row.sourceMonth,result:row.result,entry:row.result.memory.find(entry=>entry.id===item.id)}));
      const pending=entries.filter(({entry})=>entry?.availability==='UNAVAILABLE'||typeof entry?.value!=='number'||!Number.isFinite(entry.value));
      const label=item.label.replace(/médio mensal|mensal|anual|da competência/g,'do período');
      if(pending.length)return {...item,label,unit:'text',value:'Conferência necessária',availability:'UNAVAILABLE',
        formula:`O total não está confirmado. ${pending.map(({sourceMonth,result,entry})=>`${sourceMonth}: ${entry?.availability==='UNAVAILABLE'?(entry.formula||result.simplesDiagnostic?.message||'Conferência necessária. '):'Memória de cálculo ausente ou não numérica.'}`).join(' ')}`};
      return {...item,label,formula:'Soma dos valores calculados separadamente em cada competência importada.',value:sum(entries.map(({entry})=>entry.value))};
    });
  for(const regime of regimes){
    if(!hasSimples)continue;
    const choices=regime.difalApplication.months;
    const simple=['pure','hybrid'].includes(regime.id),operations=regime.difalApplication.operations;
    memory.push({id:`difal.option.${regime.id}`,section:`DIFAL · ${regime.name}`,label:'Opção de DIFAL do cenário',formula:'Escolha somente no Simples Puro e Híbrido, preservada em todas as competências; bloqueios automáticos são avaliados por mês.',value:!simple?'Não aplicável':regime.difalApplication.enabled?'Incluir':'Excluir',unit:'text'},
      {id:`difal.operations.${regime.id}`,section:`DIFAL · ${regime.name}`,label:'Operações de DIFAL selecionadas',formula:'A seleção controla a antecipação das compras; o DIFAL de saída permanece desativado e a origem é preservada.',value:!simple?'Não aplicável':['entry','exit'].filter(operation=>operations[operation]).map(operation=>operation==='entry'?'Entrada':'Saída').join(' e ')||'Nenhuma',unit:'text'},
      {id:`difal.status.${regime.id}`,section:`DIFAL · ${regime.name}`,label:'Aplicação por competência',formula:'Cada mês usa sua RBT12 e conserva o motivo de inclusão, exclusão ou bloqueio.',value:choices.map(item=>`${item.sourceMonth}: ${item.message}`).join(' '),unit:'text'});
  }
  const warningGroups=new Map();
  for(const row of monthlyResults)for(const item of row.result.warnings){
    if(['difal-estimate','projection','presumption-increase'].includes(item.code))continue;
    // Coalesce identical explanations while retaining every affected competence.
    const key=JSON.stringify([item.code,item.severity,item.title,item.detail]);
    const group=warningGroups.get(key)||{...item,sourceMonths:[]};
    group.sourceMonths.push(row.sourceMonth);warningGroups.set(key,group);
  }
  const warnings=[...warningGroups.values()].map(({sourceMonths,...item})=>({...item,detail:`${sourceMonths.join(', ')}: ${item.detail}`}));
  warnings.push({code:'actual-months',severity:'info',title:'Valores por competência',detail:`Compras, vendas e serviços seguem cada mês da coluna H.${hasSimples?` O DIFAL de saída permanece desativado. A antecipação das compras respeita as opções de cada regime. ${first.rbt12Source==='NOT_PROVIDED'?'RBT12 não informada; os cenários do Simples permanecem sem cálculo confirmado.':rbt12Schedule?'RBT12 móvel composta pelas 12 receitas anteriores de cada competência, exclusivamente do quadro 2.2.':'RBT12 fixa informada para o cenário.'}`:''} ${analysisPeriod?'O consolidado é a soma efetiva de janeiro a setembro. Outubro a dezembro permanecem fora do cálculo; quando informada, a referência de RBT12 conserva doze meses.':'Total anual é a soma dos meses importados. Meses fora do período não têm dados.'} Não há compensação automática de créditos entre competências.`});
  warnings.push({code:'monthly-model-scope',severity:'info',title:'Escopo do cálculo por competência',detail:'IRPJ e CSLL acumulam as bases do trimestre; a DRE mensal reconhece a diferença da provisão, inclusive reversões. O limite do adicional é R$ 60.000 por trimestre, sem redução por meses ausentes. Compras/CMV simplificam o custo; o Lucro Real é gerencial, sem estoques, ajustes fiscais ou compensação de prejuízos. Fechamentos incompletos permanecem pendentes.'});
  if(incomeTaxes.incomeTaxAssessment.regimes.presumed?.periods.some(period=>(period.lc224?.excessRevenue??0)>0))warnings.push({code:'presumption-increase',severity:'warning',title:'Acréscimo trimestral dos coeficientes de presunção',detail:`LC 224/2025 aplicada no cenário ${draft.year}: limite de R$ 1.250.000 por trimestre com saldo anterior conhecido, proporção das atividades do trimestre e ajuste anual de encerramento. A origem dos arquivos não altera o ano das regras do cenário.`});
  let simplesDiagnostic;
  if(hasSimples){
  const diagnoses=monthlyResults.map(row=>({sourceMonth:row.sourceMonth,...row.result.simplesDiagnostic}));
  const pending=diagnoses.filter(item=>!item.available),rbt12Values=diagnoses.map(item=>item.rbt12);
  const confirmedRbt12Values=rbt12Values.filter(value=>typeof value==='number'&&Number.isFinite(value));
  const sameRbt12=rbt12Values.every(value=>value===rbt12Values[0]);
  const statusCodes=new Set(diagnoses.map(item=>item.statusCode));
  simplesDiagnostic={...first.simplesDiagnostic,version:SIMPLES_DIAGNOSTIC_VERSION,
    available:pending.length===0,statusCode:statusCodes.size===1?diagnoses[0].statusCode:'MULTIPLE_MONTH_STATUSES',
    rbt12:sameRbt12?rbt12Values[0]:null,rbt12Min:confirmedRbt12Values.length?Math.min(...confirmedRbt12Values):null,rbt12Max:confirmedRbt12Values.length?Math.max(...confirmedRbt12Values):null,
    message:pending.length?`Cálculo pendente em ${pending.length} ${pending.length===1?'competência':'competências'}. Consulte os motivos de cada mês; isso não confirma exclusão do Simples Nacional.`:'Cálculo disponível em todas as competências informadas; o total é a soma dos meses, sem multiplicar um mês por 12.',
    action:pending.length?[...new Set(pending.map(item=>item.action))].join(' '):first.simplesDiagnostic.action,
    months:diagnoses};
  memory.push({id:'simples.diagnostic',section:'Simples Nacional',label:'Condição do cálculo no período',formula:'Cada competência mantém sua RBT12 e seu motivo; disponibilidade não confirma enquadramento fiscal.',value:diagnoses.map(item=>`${item.sourceMonth}: ${item.message}`).join(' '),unit:'text'},
    {id:'simples.action',section:'Simples Nacional',label:'Conferência necessária',formula:simplesDiagnostic.statusCode,value:simplesDiagnostic.action,unit:'text'});
  }
  const result={...first,incomeTaxAssessment:incomeTaxes.incomeTaxAssessment,version:analysisPeriod?JAN_SEP_MODEL_VERSION:MONTHLY_MODEL_VERSION,method:MONTHLY_VERSION,...(analysisPeriod?{analysisPeriod}:{}),annualRevenue,...(simplesDiagnostic?{simplesDiagnostic}:{}),regimes,credits,memory,warnings,monthlyResults,...(rbt12Schedule?{rbt12Schedule}:{}),
    bestRegimeId:ranked[0]?.id||null,difference:ranked.length?ranked[0].annualProfit-ranked.at(-1).annualProfit:0};
  applyIncomeTaxAssessment(result,incomeTaxes.incomeTaxAssessment,false);
  projection.scenario={unit:'CENTS',annual:{revenueCents:sum(monthlyResults.map(row=>asCents(row.values.salesRevenue,true)+asCents(row.values.serviceRevenue)))},months:monthlyResults.map(({sourceMonth,groups,values})=>({sourceMonth,groups,values}))};
  if(analysisPeriod)projection.analysisPeriod=analysisPeriod;
  return {result,projection,difalProjection,anticipationProjection,...(rbt12Schedule?{rbt12Schedule}:{}),adjustments,monthlyInputs:monthlyResults.map(({sourceMonth,groups,values})=>({sourceMonth,groups,values:Object.fromEntries(['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>[key,values[key]]))})),
    engineInput:{version:MONTHLY_VERSION,...(analysisPeriod?{analysisPeriod}:{}),regimeSelection,icmsOutside:draft.icmsOutside===true,months:monthlyResults.map(({sourceMonth,engineInput})=>({sourceMonth,input:engineInput})),...(rbt12Schedule?{rbt12Method:rbt12Schedule.version}:{rbt12:hasSimples?draft.rbt12??null:null})}};
}
