/** Audit captured quarterly provisions. Never replace a saved tax with a new calculation. */
export const QUARTERLY_IRPJ_RECONCILIATION_VERSION='IRPJ_RECONCILIATION_V2';
export const QUARTERLY_IRPJ_RECONCILIATION_KEYS=Object.freeze([
  'irpjTaxBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase',
  'irpjNormalAssessed','irpjAdditionalAssessed','irpjTotalAssessed','irpjPreviousProvision','irpjCurrentMovement'
]);
const TAX_KEYS=['irpjNormalCents','irpjAdditionalCents','irpjTotalCents','csllCents'];
const RATE_KEYS=['irSales','irServices','csSales','csServices'];
const BASE_KEYS=['irpjBase','csllBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase'];
const EMPTY='A apuração trimestral do IRPJ está ausente ou incompleta nesta versão.';
const INVALID='A apuração trimestral do IRPJ não concilia com as bases, provisões ou movimentos salvos.';
const PERIOD='As competências e os trimestres do IRPJ estão ausentes, duplicados ou divergem do período salvo.';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-7,8*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b)));
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
const sourceMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const unique=(rows,key,value)=>{const matches=Array.isArray(rows)?rows.filter(row=>row?.[key]===value):[];return matches.length===1?matches[0]:null;};
const unavailable=(reason=EMPTY,status='UNAVAILABLE')=>({available:false,status,reason,version:QUARTERLY_IRPJ_RECONCILIATION_VERSION,
  values:Object.fromEntries(QUARTERLY_IRPJ_RECONCILIATION_KEYS.map(key=>[key,null])),componentMovements:null});
const zero=()=>Object.fromEntries(TAX_KEYS.map(key=>[key,0]));
const amounts=(value,signed=false)=>value&&TAX_KEYS.every(key=>Number.isSafeInteger(value[key])&&(signed||value[key]>=0))&&
  value.irpjTotalCents===value.irpjNormalCents+value.irpjAdditionalCents;
const equalAmounts=(a,b)=>amounts(a,true)&&amounts(b,true)&&TAX_KEYS.every(key=>a[key]===b[key]);
const sumAmounts=values=>Object.fromEntries(TAX_KEYS.map(key=>[key,values.reduce((total,value)=>total+value[key],0)]));

export function usesQuarterlyIncomeTax(result){
  return !!result&&(Object.hasOwn(result,'incomeTaxAssessment')||
    [result.modelVersion,result.version].some(value=>String(value||'').includes('quarterly-income-tax'))||
    result.monthlyResults?.some(row=>Object.hasOwn(row?.result||{},'incomeTaxAssessment'))===true);
}

function rational(value){
  if(!value||typeof value.numerator!=='string'||typeof value.denominator!=='string'||
     !/^-?\d{1,128}$/.test(value.numerator)||!/^\d{1,128}$/.test(value.denominator))return null;
  const numerator=BigInt(value.numerator),denominator=BigInt(value.denominator);
  return denominator>0n?{numerator,denominator}:null;
}
function exactTax(exact,rate){
  const value=rational(exact);
  if(!value||value.numerator<0n)return null;
  // Bases are reais. Multiplying by 15, 10 or 9 gives the corresponding tax in cents.
  const numerator=value.numerator*BigInt(rate),rounded=(2n*numerator+value.denominator)/(2n*value.denominator);
  const cents=Number(rounded);
  return Number.isSafeInteger(cents)?cents:null;
}
function exactMatches(exact,value){
  const parsed=rational(exact);
  return !!parsed&&close(Number(parsed.numerator)/Number(parsed.denominator),value);
}
function numberRational(value){
  if(!finite(value))return null;
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if(!match)return null;
  const exponent=Number(match[4]||0)-(match[3]?.length||0);
  if(Math.abs(exponent)>128)return null;
  let numerator=BigInt((match[1]||'')+match[2]+(match[3]||'')),denominator=1n;
  if(exponent<0)denominator=10n**BigInt(-exponent);else numerator*=10n**BigInt(exponent);
  return {numerator,denominator};
}
const equalRational=(a,b)=>!!a&&!!b&&a.numerator*b.denominator===b.numerator*a.denominator;
const addRational=(a,b)=>({numerator:a.numerator*b.denominator+b.numerator*a.denominator,denominator:a.denominator*b.denominator});
const multiplyRational=(a,b)=>({numerator:a.numerator*b.numerator,denominator:a.denominator*b.denominator});
const positiveRational=value=>value.numerator>0n?value:{numerator:0n,denominator:1n};
function closureMatches(closure,complete,provision){
  return !!closure&&typeof closure.available==='boolean'&&(!closure.available||complete)&&
    closure.status===(closure.available?'CONFIRMED':'UNAVAILABLE')&&
    (closure.available?equalAmounts(closure.taxes,provision):closure.taxes===null);
}
function containerMatches(container,frame,months,year,basis,rates){
  return container?.version==='INCOME_TAX_ASSESSMENT_V2'&&container.method==='QUARTERLY_CUMULATIVE_PROVISION'&&
    container.rounding==='HALF_UP_COMPONENT_CENTS'&&container.frame===frame&&container.scenarioYear===year&&
    container.basis===basis&&same(container.sourceMonths,months)&&container.regimes&&typeof container.regimes==='object'&&
    RATE_KEYS.every(key=>finite(container.presumptionRates?.[key])&&container.presumptionRates[key]>=0&&container.presumptionRates[key]<=1&&container.presumptionRates[key]===rates?.[key]);
}

function periodProof(period,id,context){
  if(!period||period.regimeId!==id||!Number.isInteger(period.quarter)||period.quarter<1||period.quarter>4||
     period.periodId!==`${context.year}-Q${period.quarter}`)return PERIOD;
  const expected=[period.quarter*3-2,period.quarter*3-1,period.quarter*3];
  const observed=period.observedMonths,sources=period.sourceMonths;
  if(!same(period.expectedMonths,expected)||!Array.isArray(observed)||observed.length<1||
     observed.some((month,index)=>!expected.includes(month)||(index>0&&observed[index-1]>=month))||
     period.throughMonth!==observed.at(-1)||!Array.isArray(sources)||sources.length!==observed.length||
     sources.some((month,index)=>!sourceMonth(month)||Number(month.slice(5))!==observed[index]||!context.months.includes(month))||
     new Set(sources).size!==sources.length||!same(period.missingMonths,expected.filter(month=>!observed.includes(month)))||
     period.complete!==(observed.length===3))return PERIOD;
  const capturedSources=context.months.filter(value=>expected.includes(Number(value.slice(5)))&&Number(value.slice(5))<=period.throughMonth).sort();
  if(!same(sources,capturedSources))return PERIOD;
  if(period.sourceQuarter!==`${sources[0].slice(0,4)}-Q${period.quarter}`&&
     !(context.basis==='UNIFORM_PROJECTION'&&period.sourceQuarter===null))return PERIOD;
  if(period.available!==true)return period.reason||EMPTY;
  if(period.status!==(period.closure?.available?'CONFIRMED':'PROVISIONAL')||!amounts(period.provision)||
     !closureMatches(period.closure,period.complete,period.provision))return INVALID;
  const bases=period.bases;
  if(!bases||BASE_KEYS.some(key=>!finite(bases[key])||bases[key]<0)||bases.irpjAdditionalLimit!==60000||
     !close(bases.irpjBaseWithinLimit,Math.min(bases.irpjBase,60000))||
     !close(bases.irpjExcessBase,Math.max(0,bases.irpjBase-60000))||
     !close(bases.irpjBase,bases.irpjBaseWithinLimit+bases.irpjExcessBase))return INVALID;
  if(!['irpjBase','irpjExcessBase','csllBase'].every(key=>exactMatches(period.exactBases?.[key],bases[key]))||
     exactTax(period.exactBases.irpjBase,15)!==period.provision.irpjNormalCents||
     exactTax(period.exactBases.irpjExcessBase,10)!==period.provision.irpjAdditionalCents||
     exactTax(period.exactBases.csllBase,9)!==period.provision.csllCents)return INVALID;
  if(!equalRational(positiveRational(addRational(rational(period.exactBases.irpjBase),{numerator:-60000n,denominator:1n})),rational(period.exactBases.irpjExcessBase)))return INVALID;
  if(!Array.isArray(period.inputs)||period.inputs.length!==sources.length)return PERIOD;
  let signedPreTax={numerator:0n,denominator:1n},sales={numerator:0n,denominator:1n},services={numerator:0n,denominator:1n};
  for(const [index,input] of period.inputs.entries()){
    if(input?.sourceMonth!==sources[index]||input.month!==observed[index]||
       !finite(input.salesRevenue)||!finite(input.serviceRevenue))return PERIOD;
    const financial=context.financial(input.sourceMonth,id);
    if(!financial||!close(input.salesRevenue,financial.sales)||!close(input.serviceRevenue,financial.services)||
       (id==='actual'&&!close(input.preTax,financial.preTax)))return INVALID;
    sales=addRational(sales,numberRational(input.salesRevenue));
    services=addRational(services,numberRational(input.serviceRevenue));
    if(id==='actual'){
      const exact=input.preTaxExact===undefined?numberRational(input.preTax):rational(input.preTaxExact);
      const exactValue=exact?Number(exact.numerator)/Number(exact.denominator):null;
      // This link alone tolerates cancellation in the captured floating-point DRE.
      // Bases and tax cents below still reconcile against the exact rational value.
      const operandTolerance=Math.max(1e-7,32*Number.EPSILON*Math.max(Math.abs(input.salesRevenue),Math.abs(input.serviceRevenue),Math.abs(input.preTax),Math.abs(exactValue)));
      if(!exact||!finite(input.preTax)||!finite(exactValue)||Math.abs(exactValue-input.preTax)>operandTolerance)return INVALID;
      signedPreTax=addRational(signedPreTax,exact);
    }
  }
  if(id==='actual'){
    const positiveBase=signedPreTax.numerator<0n?{numerator:0n,denominator:1n}:signedPreTax;
    if(!equalRational(signedPreTax,rational(period.exactBases.preTax))||
       !equalRational(positiveBase,rational(period.exactBases.irpjBase))||
       !equalRational(positiveBase,rational(period.exactBases.csllBase))||
       !exactMatches(period.exactBases.preTax,bases.preTax))return INVALID;
  }else{
    const excess=numberRational(period.lc224?.excessRevenue),revenue=addRational(sales,services);
    if(!excess||excess.numerator<0n||(excess.numerator>0n&&revenue.numerator<=0n))return INVALID;
    for(const [baseKey,salesRate,serviceRate,plainKey,increaseKey] of [
      ['irpjBase','irSales','irServices','irpjBaseWithoutIncrease','irpjIncrease'],
      ['csllBase','csSales','csServices','csllBaseWithoutIncrease','csllIncrease']]){
      const plain=positiveRational(addRational(multiplyRational(sales,numberRational(context.rates[salesRate])),multiplyRational(services,numberRational(context.rates[serviceRate]))));
      const increase=excess.numerator===0n?{numerator:0n,denominator:1n}:
        multiplyRational(multiplyRational(excess,plain),{numerator:revenue.denominator,denominator:revenue.numerator*10n});
      if(!equalRational(addRational(plain,increase),rational(period.exactBases[baseKey]))||
         !close(Number(plain.numerator)/Number(plain.denominator),bases[plainKey])||
         !close(Number(increase.numerator)/Number(increase.denominator),bases[increaseKey]))return INVALID;
    }
  }
  return null;
}

function assessmentProof(assessment,id,context,{month=null}={}){
  if(!assessment||typeof assessment.available!=='boolean')return {error:EMPTY};
  if(!assessment.available)return {error:assessment.reason||EMPTY};
  const periods=assessment.periods;
  if(!Array.isArray(periods)||!periods.length||new Set(periods.map(period=>period?.quarter)).size!==periods.length)return {error:PERIOD};
  if(month!==null){
    if(assessment.scope==='QUARTER'){
      if(periods.length!==1||periods[0].quarter!==Math.ceil(month/3)||periods[0].throughMonth!==month)return {error:PERIOD};
    }else if(assessment.scope!=='ANNUAL_ADJUSTMENT'||month!==12||periods.length!==4)return {error:PERIOD};
  }else if(assessment.scope!=='PERIOD')return {error:PERIOD};
  if(month===null||assessment.scope==='ANNUAL_ADJUSTMENT'){
    const capturedQuarters=[...new Set(context.months.map(value=>Math.ceil(Number(value.slice(5))/3)))].sort();
    if(!same(periods.map(period=>period.quarter),capturedQuarters)||periods.some(period=>
      period.throughMonth!==Math.max(...context.months.map(value=>Number(value.slice(5))).filter(value=>Math.ceil(value/3)===period.quarter))))return {error:PERIOD};
  }
  for(const period of periods){const error=periodProof(period,id,context);if(error)return {error};}
  const complete=periods.every(period=>period.complete);
  if(assessment.complete!==complete||assessment.status!==(assessment.closure?.available?'CONFIRMED':'PROVISIONAL')||
     !amounts(assessment.provision)||!amounts(assessment.previousProvision)||!amounts(assessment.movement,true)||
     !equalAmounts(sumAmounts(periods.map(period=>period.provision)),assessment.provision)||
     !closureMatches(assessment.closure,complete,assessment.provision))return {error:INVALID};
  for(const key of BASE_KEYS){
    if(!close(assessment.bases?.[key],periods.reduce((total,period)=>total+period.bases[key],0)))return {error:INVALID};
  }
  if(TAX_KEYS.some(key=>assessment.movement[key]!==assessment.provision[key]-assessment.previousProvision[key])||
     (month===null&&!equalAmounts(assessment.previousProvision,zero())))return {error:INVALID};
  return {assessment};
}

/** Explicit metadata proves which monthly values were captured; a missing frame is never projected. */
export function reconcileQuarterlyIrpj(result,id,{sourceMonth:selected=null,expectedSourceMonths=null,expectedCount=null}={}){
  const root=result?.incomeTaxAssessment;
  if(!root)return unavailable();
  const year=root.scenarioYear,basis=root.basis,months=root.sourceMonths,rates=root.presumptionRates;
  if(![2027,2028].includes(year)||!['ACTUAL_REPORT_MONTHS','UNIFORM_PROJECTION'].includes(basis)||
     !Array.isArray(months)||!months.length||months.length>12||months.some(value=>!sourceMonth(value))||
     new Set(months).size!==months.length||new Set(months.map(value=>value.slice(0,4))).size!==1||
     !containerMatches(root,'CONSOLIDATED',months,year,basis,rates))return unavailable(PERIOD);
  if(expectedCount!==null&&expectedCount!==undefined&&expectedCount!==months.length)return unavailable(PERIOD);
  if(expectedSourceMonths!==null&&expectedSourceMonths!==undefined&&
     (!Array.isArray(expectedSourceMonths)||!same([...expectedSourceMonths].sort(),[...months].sort())))return unavailable(PERIOD);
  const entries=basis==='ACTUAL_REPORT_MONTHS'?result.monthlyResults:
    Object.entries(root.monthlyAssessments||{}).map(([key,value])=>({sourceMonth:key,month:Number(key.slice(5)),assessment:value}));
  if(!Array.isArray(entries)||entries.length!==months.length||
     new Set(entries.map(entry=>entry?.sourceMonth)).size!==entries.length||
     entries.some(entry=>!months.includes(entry?.sourceMonth)||entry.month!==Number(entry.sourceMonth.slice(5))))return unavailable(PERIOD);
  const entryByMonth=new Map(entries.map(entry=>[entry.sourceMonth,entry]));
  for(const entry of entries){
    if(!containerMatches(entry.assessment??entry.result?.incomeTaxAssessment,'MONTH',[entry.sourceMonth],year,basis,rates))return unavailable(PERIOD);
  }
  if(selected!==null&&!entryByMonth.has(selected))return unavailable(PERIOD);
  const selectedEntry=selected===null?null:entryByMonth.get(selected);
  const regime=unique(selectedEntry?.result?.regimes??result?.regimes,'id',id);
  if(!regime)return unavailable();
  if(regime.available!==true)return unavailable(regime.status||EMPTY);
  if(['pure','hybrid'].includes(id))return regime.dre?.irpj===0?
    unavailable('IRPJ incluído no DAS; sem parcela externa neste regime.','INCLUDED_IN_DAS'):unavailable(INVALID);
  if(!['presumed','actual'].includes(id))return unavailable();
  const context={year,basis,months,rates,financial:(key,regimeId)=>{
    const saved=entryByMonth.get(key)?.result?.regimes;
    if(basis==='ACTUAL_REPORT_MONTHS'){
      const regime=unique(saved,'id',regimeId);return regime?.available===true?regime.dre??null:null;
    }
    const annual=unique(result?.regimes,'id',regimeId)?.dre;
    return annual?{sales:annual.sales/12,services:annual.services/12,preTax:annual.preTax/12}:null;
  }};
  const checked=new Map();
  function checkMonth(key){
    if(checked.has(key))return checked.get(key);
    const entry=entryByMonth.get(key),container=entry.assessment??entry.result?.incomeTaxAssessment;
    const proof=assessmentProof(container.regimes[id],id,context,{month:entry.month});
    if(proof.error){checked.set(key,proof);return proof;}
    const assessment=proof.assessment,prior=entries.filter(item=>item.month<entry.month&&
      (assessment.scope==='ANNUAL_ADJUSTMENT'||Math.ceil(item.month/3)===Math.ceil(entry.month/3))).sort((a,b)=>a.month-b.month);
    let expected=zero();
    if(assessment.scope==='ANNUAL_ADJUSTMENT'){
      const proofs=prior.map(item=>checkMonth(item.sourceMonth));
      const failed=proofs.find(item=>item.error);
      if(failed){checked.set(key,failed);return failed;}
      expected=sumAmounts(proofs.map(item=>item.assessment.movement));
    }else if(prior.length){
      const previous=checkMonth(prior.at(-1).sourceMonth);
      if(previous.error){checked.set(key,previous);return previous;}
      expected=previous.assessment.provision;
    }
    const financial=entry.result?unique(entry.result.regimes,'id',id):null;
    if(!equalAmounts(expected,assessment.previousProvision)||
       (basis==='ACTUAL_REPORT_MONTHS'&&(!financial||financial.available!==true||!close(-assessment.movement.irpjTotalCents/100,financial.dre?.irpj)||
        !close(-assessment.movement.csllCents/100,financial.dre?.csll)))){
      const failed={error:INVALID};checked.set(key,failed);return failed;
    }
    checked.set(key,proof);return proof;
  }
  let proof;
  if(selected!==null)proof=checkMonth(selected);
  else{
    proof=assessmentProof(root.regimes[id],id,context);
    if(!proof.error){
      const monthly=entries.map(entry=>checkMonth(entry.sourceMonth)),failed=monthly.find(item=>item.error);
      if(failed)proof=failed;
      else if(!equalAmounts(sumAmounts(monthly.map(item=>item.assessment.movement)),proof.assessment.movement)||
        !close(-proof.assessment.movement.irpjTotalCents/100,regime.dre?.irpj)||
        !close(-proof.assessment.movement.csllCents/100,regime.dre?.csll))proof={error:INVALID};
    }
  }
  if(proof.error)return unavailable(proof.error);
  const assessment=proof.assessment,bases=assessment.bases,tax=assessment.provision,movement=assessment.movement;
  return {available:true,status:assessment.status,reason:assessment.reason||'',version:QUARTERLY_IRPJ_RECONCILIATION_VERSION,
    scope:assessment.scope,complete:assessment.complete,closure:assessment.closure,
    componentMovements:{normal:movement.irpjNormalCents/100,additional:movement.irpjAdditionalCents/100,total:movement.irpjTotalCents/100},
    values:{irpjTaxBase:bases.irpjBase,irpjAdditionalLimit:bases.irpjAdditionalLimit,irpjBaseWithinLimit:bases.irpjBaseWithinLimit,
      irpjExcessBase:bases.irpjExcessBase,irpjNormalAssessed:tax.irpjNormalCents/100,irpjAdditionalAssessed:tax.irpjAdditionalCents/100,
      irpjTotalAssessed:tax.irpjTotalCents/100,irpjPreviousProvision:assessment.previousProvision.irpjTotalCents/100,irpjCurrentMovement:movement.irpjTotalCents/100}};
}
