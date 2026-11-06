import {ACCOUNTING_FIELDS,accountingForYear} from './analysis-contract.ts';
import type {AccountingData} from './analysis-contract.ts';
import {analysisMonthsForYear,isAnalysisMonth,JAN_SEP_POLICY} from '../public/analysis-period.js';
import type {AnalysisPeriod} from '../public/analysis-period.js';

export type MissingSector='fiscal'|'accounting';
export type PartialAnalysis={allowed:boolean;missingSectors:MissingSector[]};
export function accountingOnlyPeriod(data:AccountingData):AnalysisPeriod|null{
  const rows=accountingForYear(data).months.filter(row=>isAnalysisMonth(row.sourceMonth)&&ACCOUNTING_FIELDS.some(key=>row[key]!==null));
  if(!rows.length||rows.some(row=>ACCOUNTING_FIELDS.some(key=>row[key]===null))||new Set(rows.map(row=>row.sourceMonth.slice(0,4))).size!==1)return null;
  const includedMonths=rows.map(row=>row.sourceMonth).sort(),sourceYear=Number(includedMonths[0].slice(0,4)),expectedMonths=analysisMonthsForYear(sourceYear);
  return {version:JAN_SEP_POLICY,sourceYear,startMonth:includedMonths[0],endMonth:includedMonths.at(-1)!,months:includedMonths.length,
    expectedMonths,includedMonths,excludedMonths:[],missingMonths:expectedMonths.filter(month=>!includedMonths.includes(month)),complete:true};
}
export function partialAnalysisAvailability(item:{fiscal:{status:string};accounting:{status:string;data:AccountingData}},issues:{sector:string}[]):PartialAnalysis{
  if(item.fiscal.status==='COMPLETE'&&item.accounting.status!=='COMPLETE'&&!issues.some(issue=>issue.sector==='fiscal'))return {allowed:true,missingSectors:['accounting']};
  if(item.accounting.status==='COMPLETE'&&item.fiscal.status!=='COMPLETE'&&accountingOnlyPeriod(item.accounting.data))return {allowed:true,missingSectors:['fiscal']};
  return {allowed:false,missingSectors:[]};
}
export function partialAnalysisData(missingSectors:MissingSector[]){
  if(!missingSectors.length)return null;
  const missing=missingSectors[0]==='fiscal'?'Fiscal':'Contábil';
  return {status:'INCOMPLETE' as const,missingSectors:[...missingSectors],warning:`DRE gerada sem o setor ${missing} concluído, com confirmação do usuário. Os valores desse setor foram considerados zero apenas para esta simulação e não representam dados confirmados. Complete o setor ${missing} e gere novamente.`};
}
