import {analysisMonthsForYear} from './analysis-period.js';

export const RBT12_SCHEDULE_VERSION='RBT12_MONTHLY_SECTION_22_V1';
const limit=100_000_000_000_000;
const validCents=value=>Number.isSafeInteger(value)&&value>=0&&value<=limit;
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const monthNumber=month=>Number(month.slice(0,4))*12+Number(month.slice(5))-1;
const monthKey=number=>`${Math.floor(number/12)}-${String(number%12+1).padStart(2,'0')}`;
const validMonth=month=>typeof month==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);

/** Preserve every explicit row of 2.2. Legacy extracts retain only their known window. */
export function section22RevenueHistory(extraction){
  const error='O histórico de receitas do quadro 2.2 está incompleto ou inconsistente. Leia novamente o extrato.';
  check(extraction?.parserVersion==='SIMPLES_SECTION_22_V2'&&extraction.sourceSection==='2.2'&&
    typeof extraction.pa==='string'&&/^(0[1-9]|1[0-2])\/20\d{2}$/.test(extraction.pa),error);
  const pa=`${extraction.pa.slice(3)}-${extraction.pa.slice(0,2)}`,paNumber=monthNumber(pa);
  const source=extraction.priorRevenues===undefined?extraction.rbt12Window:extraction.priorRevenues;
  check(Array.isArray(source)&&source.length>=12&&source.length<=1200,error);
  let previous='';
  return source.map(row=>{
    check(validMonth(row?.month)&&row.month>previous&&row.month<pa&&
      row.period===`${row.month.slice(5)}/${row.month.slice(0,4)}`&&
      validCents(row.internalCents)&&validCents(row.externalCents)&&validCents(row.totalCents)&&
      row.totalCents===row.internalCents+row.externalCents,error);
    previous=row.month;
    return {period:row.period,month:row.month,internalCents:row.internalCents,externalCents:row.externalCents,
      totalCents:row.totalCents,usedInRbt12:monthNumber(row.month)>=paNumber-12};
  });
}

/** Reconcile a complete extraction before calling it confirmed, on browser and server alike. */
export function reconcileSection22Extraction(extraction){
  const error='A seção 2.2 está incompleta ou inconsistente. Leia novamente o extrato.';
  const priorRevenues=section22RevenueHistory(extraction),byMonth=new Map(priorRevenues.map(row=>[row.month,row]));
  const paNumber=monthNumber(`${extraction.pa.slice(3)}-${extraction.pa.slice(0,2)}`);
  const expected=Array.from({length:12},(_,index)=>monthKey(paNumber-12+index));
  check(Array.isArray(extraction.rbt12Window)&&extraction.rbt12Window.length===12,error);
  const rbt12Window=expected.map((month,index)=>{
    const prior=byMonth.get(month),row=extraction.rbt12Window[index];
    check(prior&&row?.month===month&&row.period===prior.period&&row.internalCents===prior.internalCents&&
      row.externalCents===prior.externalCents&&row.totalCents===prior.totalCents,error);
    return {...prior,usedInRbt12:true};
  });
  const internalCents=rbt12Window.reduce((total,row)=>total+row.internalCents,0);
  const externalCents=rbt12Window.reduce((total,row)=>total+row.externalCents,0);
  const totalCents=internalCents+externalCents,basis=extraction.rbt12Basis;
  check(validCents(totalCents)&&validCents(extraction.rbt12Cents)&&extraction.rbt12Cents===totalCents,error);
  check(basis?.section==='2.2'&&basis.months===12&&basis.startMonth===expected[0]&&basis.endMonth===expected[11]&&
    basis.internalCents===internalCents&&basis.externalCents===externalCents&&basis.totalCents===totalCents,error);
  check(extraction.rbt12CalculatedCents===undefined||extraction.rbt12CalculatedCents===totalCents,error);
  check(extraction.rbt12Reconciled===undefined||extraction.rbt12Reconciled===true,error);
  return {priorRevenues,rbt12Window,rbt12Cents:totalCents,
    rbt12Basis:{section:'2.2',months:12,startMonth:expected[0],endMonth:expected[11],internalCents,externalCents,totalCents}};
}

/** Each source competence uses its own twelve preceding months, exclusively from 2.2. */
export function buildRbt12Schedule(extraction,sourceMonths){
  const history=section22RevenueHistory(extraction),byMonth=new Map(history.map(row=>[row.month,row]));
  check(Array.isArray(sourceMonths)&&sourceMonths.length>=1&&sourceMonths.length<=12&&
    sourceMonths.every(validMonth)&&new Set(sourceMonths).size===sourceMonths.length,'As competências da RBT12 mensal são inválidas ou duplicadas.');
  const rows=sourceMonths.map(sourceMonth=>{
    const end=monthNumber(sourceMonth),expected=Array.from({length:12},(_,index)=>monthKey(end-12+index));
    const missingMonths=expected.filter(month=>!byMonth.has(month));
    const window=expected.filter(month=>byMonth.has(month)).map(month=>({...byMonth.get(month),usedInRbt12:true}));
    const total=window.reduce((sum,row)=>sum+row.totalCents,0);
    check(validCents(total),'A soma das receitas do quadro 2.2 excede o limite da calculadora.');
    return {sourceMonth,status:missingMonths.length?'MISSING_MONTHS':'CONFIRMED',rbt12Cents:missingMonths.length?null:total,
      startMonth:expected[0],endMonth:expected[11],missingMonths,window};
  });
  return {version:RBT12_SCHEDULE_VERSION,source:'SIMPLES_SECTION_22',sourceSection:'2.2',pa:extraction.pa,
    complete:rows.every(row=>row.status==='CONFIRMED'),rows};
}

/** Fixed MaximumCNPJ analyses calculate nine monthly RBT12 values (Jan–Sep).
 * Each value still uses the twelve actual preceding revenue months; the history
 * outside January–September is indispensable and must never be discarded.
 */
export function buildJanSepRbt12Schedule(extraction,sourceYear){
  return buildRbt12Schedule(extraction,analysisMonthsForYear(sourceYear));
}
