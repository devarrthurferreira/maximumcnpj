/** Quarterly income-tax provisions. No historical snapshot is recalculated here. */
export const INCOME_TAX_ASSESSMENT_VERSION='INCOME_TAX_ASSESSMENT_V2';
export const INCOME_TAX_METHOD='QUARTERLY_CUMULATIVE_PROVISION';
export const INCOME_TAX_MODEL_VERSION='1.20.0-quarterly-income-tax';
const LIMIT=60000,LC_QUARTER=1250000,LC_ANNUAL=5000000;
const AMOUNT_KEYS=['irpjNormalCents','irpjAdditionalCents','irpjTotalCents','csllCents'];
const BASE_KEYS=['salesRevenue','serviceRevenue','revenue','preTax','irpjBaseWithoutIncrease','csllBaseWithoutIncrease','irpjIncrease','csllIncrease','irpjBase','csllBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase'];
const DEFAULT_PRESUMPTIONS={irSales:.08,irServices:.32,csSales:.12,csServices:.32};
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){const next=a%b;a=b;b=next;}return a||1n;};
const rational=(n,d=1n)=>{check(d!==0n,'Denominador fiscal inválido.');if(d<0n){n=-n;d=-d;}const common=gcd(n,d);return {n:n/common,d:d/common};};
function decimal(value){
  if(value&&typeof value==='object'&&typeof value.numerator==='string'&&typeof value.denominator==='string')return rational(BigInt(value.numerator),BigInt(value.denominator));
  const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value));
  check(match!==null,'Valor fiscal decimal inválido.');
  const digits=match[2]+(match[3]||''),scale=(match[3]||'').length-Number(match[4]||0),sign=match[1]==='-'?-1n:1n;
  check(Math.abs(scale)<=100,'Precisão fiscal fora do limite.');
  return scale>=0?rational(sign*BigInt(digits),10n**BigInt(scale)):rational(sign*BigInt(digits)*10n**BigInt(-scale));
}
const add=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a,b)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a,b)=>rational(a.n*b.n,a.d*b.d);
const div=(a,b)=>rational(a.n*b.d,a.d*b.n);
const compare=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const zero=()=>rational(0n),positive=a=>a.n>0n?a:zero();
const total=values=>values.reduce(add,zero());
const amount=value=>Number(value.n)/Number(value.d);
const exact=value=>({numerator:value.n.toString(),denominator:value.d.toString()});
function roundedCents(value){
  const negative=value.n<0n,n=(negative?-value.n:value.n)*100n;
  const cents=(n*2n+value.d)/(value.d*2n),signed=negative?-cents:cents;
  const result=Number(signed);check(Number.isSafeInteger(result),'Tributo acima do limite seguro em centavos.');return result===0?0:result;
}
export function incomeTaxRoundCents(value){return roundedCents(decimal(value));}
/** Exact monthly pre-tax arithmetic from captured input operands, not annual / 12. */
export function incomeTaxPreTaxExact(input,icmsDueCents=null){
  const revenue=add(decimal(input.salesRevenue),decimal(input.serviceRevenue));
  const operating=total(['simplePurchases','regularPurchases','salaries','benefits','adminExpenses','rent','cardExpenses'].map(key=>decimal(input[key])));
  const netConsumptionTax=tax=>{
    const debit=mul(positive(revenue),decimal(input.rates[tax]));
    const credit=total(['simple','simpleRegular','regular'].map(group=>mul(decimal(input.credits[group].base),decimal(input.credits[group][`${tax}Rate`]))));
    return positive(sub(debit,credit));
  };
  const icms=icmsDueCents===null?positive(sub(mul(positive(decimal(input.salesRevenue)),decimal(input.rates.icms)),mul(decimal(input.regularPurchases),decimal(input.rates.icms)))):rational(BigInt(icmsDueCents),100n);
  return exact(sub(sub(revenue,operating),total([netConsumptionTax('cbs'),netConsumptionTax('ibs'),icms,mul(decimal(input.serviceRevenue),decimal(input.rates.iss)),mul(decimal(input.salaries),decimal(input.rates.payroll))])));
}
const zeroTaxes=()=>Object.fromEntries(AMOUNT_KEYS.map(key=>[key,0]));
const sumTaxes=values=>Object.fromEntries(AMOUNT_KEYS.map(key=>{
  const result=values.reduce((sum,value)=>sum+value[key],0);check(Number.isSafeInteger(result),'Soma de tributos acima do limite seguro.');return [key,result];
}));
const subtractTaxes=(a,b)=>Object.fromEntries(AMOUNT_KEYS.map(key=>[key,a[key]-b[key]]));
const closure=(available,reason,taxes)=>({available,status:available?'CONFIRMED':'UNAVAILABLE',reason,taxes:available?{...taxes}:null});
function sums(inputs){
  return {
    sales:total(inputs.map(row=>decimal(row.salesRevenue))),
    services:total(inputs.map(row=>decimal(row.serviceRevenue))),
    preTax:inputs.every(row=>row.actualAvailable!==false&&row.preTax!==null)?total(inputs.map(row=>decimal(row.preTaxExact??row.preTax))):null
  };
}
function periodFor(regimeId,quarter,inputs,year,rates,previousPeriods,overrideExcess=null){
  const expectedMonths=[quarter*3-2,quarter*3-1,quarter*3],observedMonths=inputs.map(row=>row.month),missingMonths=expectedMonths.filter(month=>!observedMonths.includes(month));
  const complete=missingMonths.length===0,throughMonth=observedMonths.at(-1),sourceMonths=inputs.map(row=>row.sourceMonth);
  const sourceYears=[...new Set(sourceMonths.map(value=>value.slice(0,4)))];
  const period={regimeId,quarter,periodId:`${year}-Q${quarter}`,sourceQuarter:sourceYears.length===1?`${sourceYears[0]}-Q${quarter}`:null,throughMonth,expectedMonths,observedMonths,missingMonths,sourceMonths,inputs:inputs.map(row=>({...row,...(row.preTaxExact?{preTaxExact:{...row.preTaxExact}}:{})})),complete,
    available:false,status:'UNAVAILABLE',reason:'',bases:null,exactBases:null,provision:null,closure:null,lc224:null};
  const pending=reason=>({...period,reason,closure:closure(false,reason,null)});
  const values=sums(inputs),revenue=add(values.sales,values.services);
  let irBase,csBase,irIncrease=zero(),csIncrease=zero(),lc224=null;
  if(regimeId==='actual'){
    if(values.preTax===null)return pending('Resultado antes de IRPJ/CSLL indisponível em uma ou mais competências do trimestre.');
    // Never assess IRPJ or CSLL on a non-positive taxable quarter.
    // A negative monthly tax movement is only a reversal of a prior provision.
    const taxableResult=positive(values.preTax);
    irBase=taxableResult;csBase=taxableResult;
  }else{
    // Signed monthly activity values are accumulated before the non-negative
    // quarterly tax base is applied. A return month can reverse a provision.
    irBase=positive(add(mul(values.sales,decimal(rates.irSales)),mul(values.services,decimal(rates.irServices))));
    csBase=positive(add(mul(values.sales,decimal(rates.csSales)),mul(values.services,decimal(rates.csServices))));
    const priorHistoryComplete=Array.from({length:quarter-1},(_,index)=>previousPeriods.get(index+1)).every(row=>row?.complete&&row.available&&row.lc224?.carryOut!==null);
    const carryIn=quarter===1?zero():priorHistoryComplete?decimal(previousPeriods.get(quarter-1).lc224.carryOut):null;
    const allowance=carryIn===null?null:add(decimal(LC_QUARTER),carryIn);
    let excess=overrideExcess;
    if(excess===null){
      if(allowance!==null)excess=positive(sub(revenue,allowance));
      else if(compare(revenue,decimal(LC_QUARTER))<=0)excess=zero();
    }
    lc224={applicable:year>=2026,scenarioYear:year,quarterLimit:LC_QUARTER,annualLimit:LC_ANNUAL,priorHistoryComplete,
      carryIn:carryIn===null?null:amount(carryIn),allowance:allowance===null?null:amount(allowance),excessRevenue:excess===null?null:amount(excess),
      carryOut:allowance===null?null:amount(positive(sub(allowance,positive(revenue)))),annualAdjustmentApplied:overrideExcess!==null};
    period.lc224=lc224;
    if(excess===null)return pending('Histórico dos trimestres anteriores incompleto: saldo do limite da LC 224/2025 não determinado.');
    if(excess.n>0n&&(values.sales.n<0n||values.services.n<0n||revenue.n<=0n))return pending('Receita líquida negativa por atividade exige conferência antes de repartir o excedente da LC 224/2025.');
    if(excess.n>0n){
      irIncrease=mul(mul(excess,div(irBase,revenue)),decimal('0.1'));
      csIncrease=mul(mul(excess,div(csBase,revenue)),decimal('0.1'));
    }
  }
  const irTotal=add(irBase,irIncrease),csTotal=add(csBase,csIncrease),excessBase=positive(sub(irTotal,decimal(LIMIT)));
  const irpjNormalCents=roundedCents(mul(irTotal,decimal('0.15'))),irpjAdditionalCents=roundedCents(mul(excessBase,decimal('0.1')));
  const provision={irpjNormalCents,irpjAdditionalCents,irpjTotalCents:irpjNormalCents+irpjAdditionalCents,csllCents:roundedCents(mul(csTotal,decimal('0.09')))};
  const bases={salesRevenue:amount(values.sales),serviceRevenue:amount(values.services),revenue:amount(revenue),preTax:values.preTax===null?null:amount(values.preTax),
    irpjBaseWithoutIncrease:amount(irBase),csllBaseWithoutIncrease:amount(csBase),irpjIncrease:amount(irIncrease),csllIncrease:amount(csIncrease),
    irpjBase:amount(irTotal),csllBase:amount(csTotal),irpjAdditionalLimit:LIMIT,irpjBaseWithinLimit:amount(sub(irTotal,excessBase)),irpjExcessBase:amount(excessBase)};
  const reason=complete?(regimeId==='actual'?(values.preTax.n<=0n?'Sem base tributável positiva no trimestre: IRPJ e CSLL devidos são zero. Uma provisão mensal anterior pode ser estornada.':'Estimativa gerencial trimestral; não inclui ajustes fiscais, estoques ou compensação de prejuízos.'):'Trimestre completo calculado com os dados e as premissas capturados.'):
    `Provisão cumulativa somente das competências conhecidas; faltam ${missingMonths.map(value=>String(value).padStart(2,'0')).join(', ')} para concluir o trimestre. O limite do adicional permanece R$ 60.000.`;
  // In Q4 a missing earlier quarter also prevents the statutory annual review.
  const closeAvailable=complete&&!(regimeId==='presumed'&&quarter===4&&!lc224.priorHistoryComplete);
  const closeReason=closeAvailable?reason:complete?'Histórico anual incompleto: ajuste de encerramento da LC 224/2025 indisponível.':reason;
  return {...period,available:true,status:closeAvailable?'CONFIRMED':'PROVISIONAL',reason:closeReason,bases,
    exactBases:{irpjBase:exact(irTotal),irpjExcessBase:exact(excessBase),csllBase:exact(csTotal),preTax:values.preTax===null?null:exact(values.preTax)},
    provision,closure:closure(closeAvailable,closeReason,provision),lc224};
}
function aggregate(periods,previousProvision,scope,forceReason=''){
  const available=periods.length>0&&periods.every(period=>period.available)&&previousProvision!==null&&!forceReason;
  const complete=periods.length>0&&periods.every(period=>period.complete);
  const allClosed=available&&periods.every(period=>period.closure.available);
  const reason=forceReason||(!available?periods.find(period=>!period.available)?.reason||'Provisão anterior indisponível.':allClosed?
    'Soma dos períodos trimestrais capturados e conciliados; cada componente foi arredondado a centavos em seu próprio período.':
    'Provisão com as competências conhecidas; fechamento incompleto indisponível. '+[...new Set(periods.filter(period=>!period.closure.available).map(period=>period.reason))].join(' '));
  const provision=available?sumTaxes(periods.map(period=>period.provision)):null;
  const bases=available?Object.fromEntries(BASE_KEYS.map(key=>[key,periods.some(period=>period.bases[key]===null)?null:periods.reduce((sum,period)=>sum+period.bases[key],0)])):null;
  return {available,status:!available?'UNAVAILABLE':allClosed?'CONFIRMED':'PROVISIONAL',reason,scope,complete,periods,bases,provision,
    previousProvision:available?{...previousProvision}:null,movement:available?subtractTaxes(provision,previousProvision):null,
    closure:closure(allClosed,reason,provision),annualAdjustmentApplied:periods.some(period=>period.lc224?.annualAdjustmentApplied)};
}
function annualReview(periods,year,rates){
  const original=[1,2,3,4].map(quarter=>periods.get(quarter));
  if(original.some(period=>!period?.available||!period.complete))return null;
  const annualRevenue=total(original.flatMap(period=>period.inputs).map(row=>add(decimal(row.salesRevenue),decimal(row.serviceRevenue))));
  const annualExcess=positive(sub(annualRevenue,decimal(LC_ANNUAL)));
  const priorExcess=original.slice(0,3).map(period=>decimal(period.lc224.excessRevenue));
  const priorSum=total(priorExcess),reducePrior=compare(annualExcess,priorSum)<0;
  if(reducePrior&&annualExcess.n>0n)return {periods:original,pendingReason:'Ajuste anual da LC 224/2025 pendente: o excedente anual positivo é menor que a soma dos excedentes anteriores. O rateio da redução precisa de validação fiscal; nenhum ajuste foi presumido.'};
  const revised=new Map();
  for(const [index,period] of original.entries()){
    const excess=index===3?(reducePrior?zero():positive(sub(annualExcess,priorSum))):
      reducePrior?zero():priorExcess[index];
    const review=periodFor('presumed',index+1,period.inputs,year,rates,revised,excess);
    review.lc224.originalExcessRevenue=period.lc224.excessRevenue;
    revised.set(index+1,review);
  }
  return {periods:[...revised.values()],pendingReason:''};
}
/**
 * Monthly DRE tax = cumulative liability of this quarter - the provision
 * already recognised. On December's LC224 review the bridge spans the year.
 */
export function assessQuarterlyIncomeTaxes({year,months,rates=DEFAULT_PRESUMPTIONS,regimeIds=['presumed','actual'],basis='ACTUAL_REPORT_MONTHS'}){
  check([2027,2028].includes(year),'Ano do cenário inválido para a apuração trimestral.');
  check(Array.isArray(months)&&months.length>=1&&months.length<=12,'Competências inválidas para a apuração trimestral.');
  check(['ACTUAL_REPORT_MONTHS','UNIFORM_PROJECTION'].includes(basis),'Origem da apuração trimestral inválida.');
  check(Array.isArray(regimeIds)&&new Set(regimeIds).size===regimeIds.length&&regimeIds.every(id=>['presumed','actual'].includes(id)),'Regimes de IRPJ/CSLL inválidos.');
  for(const key of Object.keys(DEFAULT_PRESUMPTIONS))check(typeof rates[key]==='number'&&Number.isFinite(rates[key])&&rates[key]>=0&&rates[key]<=1,'Coeficiente de presunção inválido.');
  const seen=new Set(),sourceSeen=new Set(),sourceYears=new Set();
  const ordered=months.map(row=>{
    check(row&&/^\d{4}-(0[1-9]|1[0-2])$/.test(row.sourceMonth)&&row.month===Number(row.sourceMonth.slice(5))&&!seen.has(row.month)&&!sourceSeen.has(row.sourceMonth),'Competências fiscais ausentes, incoerentes ou duplicadas.');
    seen.add(row.month);sourceSeen.add(row.sourceMonth);sourceYears.add(row.sourceMonth.slice(0,4));
    for(const key of ['salesRevenue','serviceRevenue'])check(typeof row[key]==='number'&&Number.isFinite(row[key])&&Math.abs(row[key])<=1e12,'Receita fiscal inválida.');
    check(row.serviceRevenue>=0,'Receita de serviços inválida.');
    check(row.actualAvailable===false&&row.preTax===null||typeof row.preTax==='number'&&Number.isFinite(row.preTax)&&Math.abs(row.preTax)<=1e13,'Resultado antes dos tributos inválido.');
    if(row.preTaxExact!=null){
      const exactValue=amount(decimal(row.preTaxExact));
      const operandMagnitude=Math.max(Math.abs(row.salesRevenue),Math.abs(row.serviceRevenue),Math.abs(exactValue),Math.abs(row.preTax??0));
      check(row.preTax!==null&&Math.abs(exactValue-row.preTax)<=Math.max(1e-7,32*Number.EPSILON*operandMagnitude),'Base decimal de IRPJ/CSLL não corresponde ao resultado capturado.');
    }
    return {...row,...(row.preTaxExact?{preTaxExact:{...row.preTaxExact}}:{}),actualAvailable:row.actualAvailable!==false};
  }).sort((a,b)=>a.month-b.month);
  check(sourceYears.size===1,'As competências de IRPJ/CSLL precisam pertencer ao mesmo ano de origem.');
  const baseContainer={version:INCOME_TAX_ASSESSMENT_VERSION,method:INCOME_TAX_METHOD,scenarioYear:year,rounding:'HALF_UP_COMPONENT_CENTS',basis,
    presumptionRates:Object.fromEntries(Object.keys(DEFAULT_PRESUMPTIONS).map(key=>[key,rates[key]]))};
  const monthlyAssessments=Object.fromEntries(ordered.map(row=>[row.sourceMonth,{...baseContainer,frame:'MONTH',sourceMonths:[row.sourceMonth],regimes:{}}]));
  const consolidated={...baseContainer,frame:'CONSOLIDATED',sourceMonths:ordered.map(row=>row.sourceMonth),regimes:{}};
  for(const regimeId of regimeIds){
    const periods=new Map(),groups=new Map(),previousByQuarter=new Map(),movements=[];
    let annualPeriods=null;
    for(const row of ordered){
      const quarter=Math.ceil(row.month/3),inputs=groups.get(quarter)||[];inputs.push(row);groups.set(quarter,inputs);
      const period=periodFor(regimeId,quarter,inputs,year,rates,periods);
      periods.set(quarter,period);
      let assessment;
      const review=regimeId==='presumed'&&row.month===12?annualReview(periods,year,rates):null;
      if(review){
        const previous=movements.every(value=>value!==null)?sumTaxes(movements):null;
        assessment=aggregate(review.periods,previous,'ANNUAL_ADJUSTMENT',review.pendingReason);annualPeriods=review.periods;
      }else{
        const previous=previousByQuarter.has(quarter)?previousByQuarter.get(quarter):zeroTaxes();
        assessment=aggregate([period],previous,'QUARTER');
      }
      previousByQuarter.set(quarter,period.provision);
      monthlyAssessments[row.sourceMonth].regimes[regimeId]=assessment;
      movements.push(assessment.movement);
    }
    const closingPeriods=annualPeriods||[...periods.values()];
    const failed=movements.some(value=>value===null)?'Uma ou mais competências não têm movimento de IRPJ/CSLL conciliável; o total do período não está confirmado.':'';
    const assessment=aggregate(closingPeriods,zeroTaxes(),'PERIOD',failed);
    if(assessment.available){
      const movementSum=sumTaxes(movements);
      check(AMOUNT_KEYS.every(key=>movementSum[key]===assessment.provision[key]),'Movimentos mensais não conciliam com a apuração trimestral.');
      assessment.movement=movementSum;
    }
    consolidated.regimes[regimeId]=assessment;
  }
  return {incomeTaxAssessment:consolidated,monthlyAssessments};
}
