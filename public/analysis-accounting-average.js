import {ACCOUNTING_FIELDS} from './analyses-guidance.js';
import {analysisMonthsForYear,isAnalysisMonth} from './analysis-period.js';

const valid=value=>Number.isSafeInteger(value)&&value>=0&&value<=100_000_000_000_000;
const blank=()=>Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>[key,null]));

/** Reading an older monthly entry only proposes averages; it never rewrites it. */
export function accountingAverage(data={},sourceYear=null) {
  if(data.monthlyAverage?.version==='MONTHLY_AVERAGE_V1')return {
    values:Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>[key,valid(data.monthlyAverage.values?.[key])?data.monthlyAverage.values[key]:null])),
    legacy:false,varied:false,counts:{},fromOtherYear:false
  };
  const original=Array.isArray(data.months)?data.months:[];
  const relevant=original.filter(row=>isAnalysisMonth(row.sourceMonth)&&(!sourceYear||Number(row.sourceMonth.slice(0,4))===Number(sourceYear)));
  // If Fiscal arrived with another source year, keep the previous amounts visible.
  // They are a proposal, with a clear notice, until the operator saves the average.
  const fallback=original.filter(row=>isAnalysisMonth(row.sourceMonth));
  const rows=relevant.some(row=>ACCOUNTING_FIELDS.some(([key])=>valid(row[key])))?relevant:fallback;
  const values=blank(),counts={};let varied=false;
  for(const [key] of ACCOUNTING_FIELDS){
    const entered=rows.map(row=>row[key]).filter(valid);counts[key]=entered.length;
    if(!entered.length)continue;
    values[key]=Math.round(entered.reduce((sum,value)=>sum+value,0)/entered.length);
    varied||=new Set(entered).size>1||entered.length!==9;
  }
  return {values,counts,varied,legacy:rows.some(row=>ACCOUNTING_FIELDS.some(([key])=>valid(row[key]))),
    fromOtherYear:!!sourceYear&&rows.some(row=>Number(row.sourceMonth.slice(0,4))!==Number(sourceYear))};
}

export function accountingAverageInputValues(raw,defaults) {
  return Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>{
    if(!raw||!Object.hasOwn(raw,key))return [key,defaults[key]];
    const text=String(raw[key]);
    if(!/^\d+(?:\.\d{1,2})?$/.test(text))return [key,null];
    const [whole,fraction='']=text.split('.'),value=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    return [key,valid(value)?value:null];
  }));
}

/** Only an explicit save applies this plan; amounts stay in integer cents. */
export function accountingAverageMonths(values,sourceYear) {
  const months=analysisMonthsForYear(Number(sourceYear));
  const normalized=Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>{
    const value=values?.[key];
    if(value!==null&&!valid(value))throw new Error('Confira a média mensal: use valores não negativos, com até duas casas decimais.');
    return [key,value];
  }));
  return months.map(sourceMonth=>({sourceMonth,...normalized}));
}

export function accountingAveragePreview(values,sourceYear) {
  const months=accountingAverageMonths(values,sourceYear),entered=ACCOUNTING_FIELDS.map(([key])=>values[key]).filter(valid);
  const monthlyCents=entered.length?entered.reduce((sum,value)=>sum+value,0):null;
  return {months,monthlyCents,totalCents:monthlyCents===null?null:monthlyCents*9,
    complete:entered.length===ACCOUNTING_FIELDS.length,filledFields:entered.length};
}
