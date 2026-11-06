import {ACCOUNTING_FIELDS,accountingForYear} from './analysis-contract.ts';
import type {AccountingData} from './analysis-contract.ts';
import {analysisMonthsForYear,isAnalysisMonth,JAN_SEP_POLICY} from '../public/analysis-period.js';
import type {AnalysisPeriod} from '../public/analysis-period.js';

export type MissingSector='fiscal'|'accounting';
export type PartialAnalysis={allowed:boolean;missingSectors:MissingSector[];fiscalDataUsed?:true};
export function accountingOnlyPeriod(data:AccountingData):AnalysisPeriod|null{
  const rows=accountingForYear(data).months.filter(row=>isAnalysisMonth(row.sourceMonth)&&ACCOUNTING_FIELDS.some(key=>row[key]!==null));
  if(!rows.length||rows.some(row=>ACCOUNTING_FIELDS.some(key=>row[key]===null))||new Set(rows.map(row=>row.sourceMonth.slice(0,4))).size!==1)return null;
  const includedMonths=rows.map(row=>row.sourceMonth).sort(),sourceYear=Number(includedMonths[0].slice(0,4)),expectedMonths=analysisMonthsForYear(sourceYear);
  return {version:JAN_SEP_POLICY,sourceYear,startMonth:includedMonths[0],endMonth:includedMonths.at(-1)!,months:includedMonths.length,
    expectedMonths,includedMonths,excludedMonths:[],missingMonths:expectedMonths.filter(month=>!includedMonths.includes(month)),complete:true};
}
export function partialAnalysisAvailability(item:{fiscal:{status:string};accounting:{status:string;data:AccountingData}},issues:{sector:string;code?:string}[],options:{fiscalDataUsed?:boolean}={}):PartialAnalysis{
  const fiscalIssues=issues.filter(issue=>issue.sector==='fiscal');
  if(options.fiscalDataUsed===true&&fiscalIssues.length&&fiscalIssues.every(issue=>['FISCAL_NOT_CONFIRMED','FISCAL_SOURCE_CHANGED'].includes(issue.code||''))){
    // Only the server's checked source can turn missing confirmation into a warning. Invalid source data stays blocking.
    const accountingComplete=item.accounting.status==='COMPLETE'&&!issues.some(issue=>issue.sector==='accounting');
    if(accountingComplete||item.accounting.status!=='COMPLETE')return {allowed:true,
      missingSectors:accountingComplete?['fiscal']:['fiscal','accounting'],fiscalDataUsed:true};
  }
  if(item.fiscal.status==='COMPLETE'&&item.accounting.status!=='COMPLETE'&&!issues.some(issue=>issue.sector==='fiscal'))return {allowed:true,missingSectors:['accounting']};
  if(item.accounting.status==='COMPLETE'&&item.fiscal.status!=='COMPLETE'&&accountingOnlyPeriod(item.accounting.data))return {allowed:true,missingSectors:['fiscal']};
  return {allowed:false,missingSectors:[]};
}
export function partialAnalysisData(missingSectors:MissingSector[],options:{fiscalDataUsed?:boolean}={}){
  if(!missingSectors.length)return null;
  if(options.fiscalDataUsed===true&&missingSectors.includes('fiscal'))return {status:'INCOMPLETE' as const,missingSectors:[...missingSectors],fiscalDataUsed:true as const,
    warning:'DRE gerada com o Fiscal pendente de conferência, após confirmação do usuário. Foram utilizados os documentos e as opções fiscais atuais disponíveis; o setor ainda precisa ser concluído ou reconfirmado.'+
      (missingSectors.includes('accounting')?' O Contábil não foi concluído: suas despesas foram consideradas zero somente nesta simulação e não representam dados confirmados.':'')+
      ' Confira os setores pendentes e gere novamente após a conclusão.'};
  const missing=missingSectors[0]==='fiscal'?'Fiscal':'Contábil';
  return {status:'INCOMPLETE' as const,missingSectors:[...missingSectors],warning:`DRE gerada sem o setor ${missing} concluído, com confirmação do usuário. Os valores desse setor foram considerados zero apenas para esta simulação e não representam dados confirmados. Complete o setor ${missing} e gere novamente.`};
}
