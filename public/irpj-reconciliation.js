/** Explain captured IRPJ amounts only; this module never changes a saved tax. */
export const IRPJ_RECONCILIATION_VERSION = 'IRPJ_RECONCILIATION_V1';
export const IRPJ_RECONCILIATION_KEYS = Object.freeze([
  'irpjTaxBase','irpjAdditionalLimit','irpjBaseWithinLimit','irpjExcessBase',
  'irpjNormalAssessed','irpjAdditionalAssessed','irpjTotalAssessed'
]);
const MONTHLY_LIMIT=20000,NORMAL_RATE=.15,ADDITIONAL_RATE=.10;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-7,8*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b)));
const unique=(rows,key,value)=>{
  const matches=Array.isArray(rows)?rows.filter(row=>row?.[key]===value):[];
  return matches.length===1?matches[0]:null;
};
const EMPTY_REASON='A memória do IRPJ está ausente ou incompleta nesta versão.';
const INVALID_REASON='A memória do IRPJ não concilia com a base, as alíquotas ou o total salvo.';
const PERIOD_REASON='As competências do IRPJ estão ausentes, duplicadas ou divergem do período salvo.';
const unavailable=(reason=EMPTY_REASON,status='UNAVAILABLE')=>({
  available:false,status,reason,values:Object.fromEntries(IRPJ_RECONCILIATION_KEYS.map(key=>[key,null]))
});
const confirmed=values=>({available:true,status:'CONFIRMED',reason:'',values});

function captured(result,id){
  const regime=unique(result?.regimes,'id',id);
  if(!regime)return unavailable();
  if(regime.available!==true)return unavailable(typeof regime.status==='string'&&regime.status?regime.status:EMPTY_REASON);
  if(['pure','hybrid'].includes(id))return unavailable('IRPJ incluído no DAS; sem parcela externa neste regime.','INCLUDED_IN_DAS');
  if(!['presumed','actual'].includes(id))return unavailable();
  const ids={base:id==='presumed'?'presumed.irTotalBase':'actual.base',normal:id+'.irBasic',additional:id+'.irAdditional',total:id+'.irTotal'};
  const amounts={};
  for(const [key,identifier] of Object.entries(ids)){
    const entry=unique(result.memory,'id',identifier);
    if(!entry||entry.unit!=='currency'||entry.availability==='UNAVAILABLE'||!finite(entry.value)||entry.value<0)return unavailable();
    amounts[key]=entry.value;
  }
  if(!close(amounts.normal+amounts.additional,amounts.total)||!close(-amounts.total,regime.dre?.irpj))return unavailable(INVALID_REASON);
  return {available:true,amounts};
}

function period(result,id,months){
  const saved=captured(result,id);
  if(!saved.available)return saved;
  const {base,normal,additional,total}=saved.amounts,limit=MONTHLY_LIMIT*months;
  const within=Math.min(base,limit),excess=Math.max(0,base-limit);
  if(!close(normal,base*NORMAL_RATE)||!close(additional,excess*ADDITIONAL_RATE))return unavailable(INVALID_REASON);
  return confirmed({irpjTaxBase:base,irpjAdditionalLimit:limit,irpjBaseWithinLimit:within,irpjExcessBase:excess,
    irpjNormalAssessed:normal,irpjAdditionalAssessed:additional,irpjTotalAssessed:total});
}

function monthlyEntries(result,expectedSourceMonths,expectedCount){
  const rows=result?.monthlyResults;
  if(!Array.isArray(rows)||rows.length<1||rows.length>12)return null;
  const sourceMonths=new Set(),monthNumbers=new Set();
  for(const row of rows){
    if(typeof row?.sourceMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.sourceMonth)||
       row.month!==Number(row.sourceMonth.slice(5))||sourceMonths.has(row.sourceMonth)||monthNumbers.has(row.month)||!row.result)return null;
    sourceMonths.add(row.sourceMonth);monthNumbers.add(row.month);
  }
  if(expectedCount!==undefined&&expectedCount!==null&&(!Number.isInteger(expectedCount)||expectedCount!==rows.length))return null;
  if(expectedSourceMonths!==undefined&&expectedSourceMonths!==null){
    if(!Array.isArray(expectedSourceMonths)||expectedSourceMonths.length!==rows.length||
       new Set(expectedSourceMonths).size!==expectedSourceMonths.length||
       expectedSourceMonths.some(month=>typeof month!=='string'||!sourceMonths.has(month)))return null;
  }
  return rows;
}

/**
 * A monthly consolidated result is audited before summing: unused limits from
 * other months do not reduce an excess. Legacy annual projections retain their
 * 12-month limit. Selecting a projected month is handled by the caller's scale.
 */
export function reconcileIrpj(result,id,{sourceMonth=null,expectedSourceMonths=null,expectedCount=null}={}){
  if(result?.method!=='REPORT_MONTHS_V1')return sourceMonth===null?period(result,id,12):unavailable(PERIOD_REASON);
  const rows=monthlyEntries(result,expectedSourceMonths,expectedCount);
  if(!rows)return unavailable(PERIOD_REASON);
  if(sourceMonth!==null){
    const selected=rows.find(row=>row.sourceMonth===sourceMonth);
    return selected?period(selected.result,id,1):unavailable(PERIOD_REASON);
  }
  const saved=captured(result,id);
  if(!saved.available)return saved;
  const months=rows.map(row=>period(row.result,id,1));
  const failed=months.find(row=>!row.available);
  if(failed)return unavailable(failed.reason);
  const values=Object.fromEntries(IRPJ_RECONCILIATION_KEYS.map(key=>[key,months.reduce((sum,row)=>sum+row.values[key],0)]));
  if(!Object.values(values).every(finite)||!close(values.irpjTaxBase,values.irpjBaseWithinLimit+values.irpjExcessBase)||
     !close(values.irpjTaxBase,saved.amounts.base)||!close(values.irpjNormalAssessed,saved.amounts.normal)||
     !close(values.irpjAdditionalAssessed,saved.amounts.additional)||!close(values.irpjTotalAssessed,saved.amounts.total))return unavailable(INVALID_REASON);
  return confirmed(values);
}
