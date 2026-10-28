import {JAN_SEP_POLICY,buildAnalysisPeriod,analysisMonthsForYear,isAnalysisMonth} from './analysis-period.js';

export const ACCOUNTING_FIELDS=[
  ['salariesCents','Salários e pró-labore'],['rentCents','Aluguéis'],
  ['cardExpensesCents','Taxas de cartão'],['benefitsCents','Benefícios'],
  ['adminExpensesCents','Outras despesas']
];

const SECTORS=['fiscal','accounting'];
const names={fiscal:'Fiscal',accounting:'Contábil'};

export const usesFixedAnalysisPeriod=analysis=>analysis?.periodPolicy===JAN_SEP_POLICY;
function metadataPeriods(analysis,generation) {
  const generationId=analysis?.fiscal?.data?.generationId;
  if(!generationId||generation?._id!==generationId)return null;
  const company=generation.companies?.find(row=>row.clientId===analysis.clientId);
  if(!company)return null;
  const purchase=company.purchase,sales=company.sales;
  if(!purchase||!sales||purchase._id!==company.purchaseJobId||sales._id!==company.salesJobId||
    purchase.status!=='COMPLETED'||sales.status!=='COMPLETED'||purchase.mode!=='PURCHASES_V1'||sales.mode!=='SALES_V1'||
    [purchase,sales].some(job=>job.clientId!==analysis.clientId||job.generationId!==generationId))return null;
  return [purchase.reportPeriod,sales.reportPeriod];
}

/** Read-only coverage hints. They never confirm missing financial amounts. */
export function analysisPeriodFor(analysis,source,generation) {
  if(source?.analysisPeriod?.version===JAN_SEP_POLICY)return source.analysisPeriod;
  if(analysis?.readiness?.analysisPeriod?.version===JAN_SEP_POLICY)return analysis.readiness.analysisPeriod;
  if(!usesFixedAnalysisPeriod(analysis))return null;
  const periods=metadataPeriods(analysis,generation);if(!periods)return null;
  try{return buildAnalysisPeriod(...periods);}catch{return null;}
}

/** Retain amounts outside the selected window in storage, but exclude them from current totals. */
export function scopedAccountingMonths(analysis,months=[],source=null,generation=null) {
  if(!usesFixedAnalysisPeriod(analysis))return months;
  const period=analysisPeriodFor(analysis,source,generation);
  return months.filter(row=>isAnalysisMonth(row.sourceMonth)&&(!period||Number(row.sourceMonth.slice(0,4))===period.sourceYear));
}

/** Metadata guides entry only; it never confirms source values or authorizes generation. */
export function accountingSourceMonths(analysis,source,generation,accountingMonths=analysis?.accounting?.data?.months||[]) {
  if(usesFixedAnalysisPeriod(analysis)){
    const period=analysisPeriodFor(analysis,source,generation);
    if(period)return period.expectedMonths;
    const years=[...new Set(accountingMonths.filter(row=>isAnalysisMonth(row.sourceMonth)).map(row=>Number(row.sourceMonth.slice(0,4))))];
    return years.length===1?analysisMonthsForYear(years[0]):[];
  }
  if(source?.monthlyReports?.length)return source.monthlyReports.map(row=>row.sourceMonth);
  if(analysis?.readiness?.months?.length)return analysis.readiness.months;
  const generationId=analysis?.fiscal?.data?.generationId;
  if(!generationId||generation?._id!==generationId)return [];
  const company=generation.companies?.find(row=>row.clientId===analysis.clientId);
  if(!company)return [];
  const purchase=company.purchase,sales=company.sales;
  if(!purchase||!sales||purchase._id!==company.purchaseJobId||sales._id!==company.salesJobId||
    purchase.status!=='COMPLETED'||sales.status!=='COMPLETED'||purchase.mode!=='PURCHASES_V1'||sales.mode!=='SALES_V1'||
    [purchase,sales].some(job=>job.clientId!==analysis.clientId||job.generationId!==generationId))return [];
  const left=purchase.reportPeriod,right=sales.reportPeriod,valid=value=>typeof value==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
  if(!left||!right||!valid(left.startMonth)||!valid(left.endMonth)||left.startMonth!==right.startMonth||left.endMonth!==right.endMonth||left.months!==right.months)return [];
  const start=Number(left.startMonth.slice(0,4))*12+Number(left.startMonth.slice(5))-1;
  const end=Number(left.endMonth.slice(0,4))*12+Number(left.endMonth.slice(5))-1,length=end-start+1;
  if(!Number.isInteger(left.months)||length<1||length>12||left.months!==length)return [];
  return Array.from({length},(_,offset)=>{const value=start+offset;return `${Math.floor(value/12)}-${String(value%12+1).padStart(2,'0')}`;});
}
const validCents=value=>Number.isSafeInteger(value)&&value>=0;
const sum=values=>{
  if(!values.length)return null;
  const total=values.reduce((amount,value)=>amount+value,0);
  return Number.isSafeInteger(total)?total:null;
};

/** Entered subtotals never confirm an empty field or an absent source month. */
export function accountingSummary(months=[],expectedMonths=[]) {
  const entries=Array.isArray(months)?months:[],expected=[...new Set(expectedMonths)].sort();
  const monthsById=new Map(entries.map(row=>[row.sourceMonth,row]));
  const keys=[...new Set([...monthsById.keys(),...expected])].sort();
  const rows=keys.map(sourceMonth=>{
    const row=monthsById.get(sourceMonth),values=ACCOUNTING_FIELDS.map(([key])=>row?.[key]);
    const filled=values.filter(validCents),excluded=filled.length===0;
    const missingFields=excluded?[]:ACCOUNTING_FIELDS.filter(([key])=>!validCents(row?.[key])).map(([key])=>key);
    const enteredCents=sum(filled),complete=!excluded&&missingFields.length===0&&enteredCents!==null;
    return {sourceMonth,present:!!row,expected:expected.includes(sourceMonth),filledFields:filled.length,missingFields,
      enteredCents,totalCents:complete?enteredCents:null,complete,excluded};
  });
  const included=rows.filter(row=>!row.excluded),includedIds=included.map(row=>row.sourceMonth);
  const categories=ACCOUNTING_FIELDS.map(([key,label])=>{
    const values=includedIds.map(month=>monthsById.get(month)?.[key]),filled=values.filter(validCents),enteredCents=sum(filled);
    const missingMonths=includedIds.filter(month=>!validCents(monthsById.get(month)?.[key]));
    const complete=includedIds.length>0&&missingMonths.length===0&&enteredCents!==null;
    return {key,label,filledMonths:filled.length,missingMonths,enteredCents,totalCents:complete?enteredCents:null,complete};
  });
  const filledFields=included.reduce((total,row)=>total+row.filledFields,0);
  const enteredCents=sum(included.map(row=>row.enteredCents).filter(value=>value!==null));
  const missingMonths=expected.filter(month=>!monthsById.has(month));
  const extraMonths=expected.length?includedIds.filter(month=>!expected.includes(month)):[];
  const complete=included.length>0&&included.every(row=>row.complete)&&extraMonths.length===0&&enteredCents!==null;
  return {rows,categories,monthCount:rows.length,enteredMonths:included.length,expectedMonths:expected,
    completeMonths:rows.filter(row=>row.complete).length,filledFields,missingFields:included.length*ACCOUNTING_FIELDS.length-filledFields,
    missingMonths,extraMonths,includedMonths:rows.filter(row=>row.complete).map(row=>row.sourceMonth),
    excludedMonths:rows.filter(row=>row.excluded).map(row=>row.sourceMonth),enteredCents,totalCents:complete?enteredCents:null,complete};
}

function issueAction(issue,analysis) {
  const code=String(issue.code||'');
  if(code.startsWith('RBT12_'))return {action:'reference',label:'Conferir extrato ou RBT12'};
  if(code==='ANALYSIS_FISCAL_INCOMPLETE'||code==='SIMULATOR_INCOMPLETE'){
    return {action:'import',label:analysis.fiscal?.data?.generationId?'Retomar documentos fiscais':'Adicionar entradas e saídas'};
  }
  if(code==='ACCOUNTING_MONTHS_MISMATCH'||code==='ACCOUNTING_VALUES_MISSING'&&!analysis.accounting?.data?.months?.length){
    return {action:'accounting-months',label:'Conferir competências do Contábil'};
  }
  if(issue.sector==='config')return {action:'config',label:'Conferir escolhas da análise'};
  return {action:issue.sector==='accounting'?'accounting':'fiscal',label:issue.sector==='accounting'?'Conferir Contábil':'Conferir Fiscal'};
}

/** Guidance only: readiness remains the server's decision to authorize generation. */
export function analysisGuidance(analysis,{sector=null,configDirty=false,fiscalDirty=false,accountingDirty=false,pastePending=false,dirty=false}={}) {
  const rawIssues=Array.isArray(analysis.readiness?.issues)?analysis.readiness.issues:[];
  const savedVerification=analysis.readiness?.verification==='SAVED';
  const sectorDirty={fiscal:fiscalDirty,accounting:accountingDirty},unscopedDirty=dirty&&!configDirty&&!fiscalDirty&&!accountingDirty&&!pastePending;
  const hasUnsavedChanges=!!(dirty||configDirty||fiscalDirty||accountingDirty||pastePending);
  const sectors=Object.fromEntries(SECTORS.map(key=>{
    const saved=analysis[key],complete=saved?.status==='COMPLETE'&&!configDirty&&!sectorDirty[key]&&!unscopedDirty&&!rawIssues.some(issue=>issue.sector===key);
    const label=sectorDirty[key]?'Alterações não salvas':configDirty?'Revisar após salvar escolhas':complete?'Conferido':saved?.status==='COMPLETE'?'Conferência necessária':'Em andamento';
    return [key,{complete,dirty:!!sectorDirty[key],label,kind:complete?'ready':'pending'}];
  }));
  const confirmedCount=SECTORS.filter(key=>sectors[key].complete).length;
  const current=analysis.currentSimulation,ready=analysis.readiness?.ready===true&&!hasUnsavedChanges;
  const currentResult=!!(ready&&current?.id&&current.stale===false&&!current.legacy);
  const state=currentResult?'current':ready?'ready':'working';
  const label=currentResult?(savedVerification?'Resultado salvo':'Resultado atual'):ready?(current?'Pronta para atualizar':'Pronta para gerar'):hasUnsavedChanges?'Alterações não salvas':'Em andamento';
  const issues=[];
  if(configDirty)issues.push({code:'UNSAVED_CONFIG',sector:'config',message:'Salve os regimes e o ano escolhidos antes de concluir os setores.',action:'config',label:'Salvar escolhas da análise'});
  if(pastePending)issues.push({code:'UNSAVED_ACCOUNTING_PASTE',sector:'accounting',message:'Há dados colados no Contábil aguardando conferência. Aplique a prévia ou limpe a colagem antes de gerar.',action:'accounting',label:'Conferir colagem do Contábil'});
  for(const key of SECTORS)if(sectorDirty[key])issues.push({code:'UNSAVED_'+key.toUpperCase(),sector:key,
    message:`As alterações do ${names[key]} ainda estão somente nesta tela. Salve para continuar depois.`,action:'save-'+key,label:'Salvar trabalho '+names[key]});
  const seen=new Set();
  for(const issue of rawIssues){
    const code=String(issue.code||''),key=`${issue.sector}:${code}:${issue.message}`;
    if(seen.has(key))continue;seen.add(key);
    // A concrete pending item already explains what must be completed in a sector.
    if(code.endsWith('_NOT_CONFIRMED')&&(sectorDirty[issue.sector]||rawIssues.some(other=>other.sector===issue.sector&&other.code!==issue.code)))continue;
    issues.push({...issue,code,...issueAction(issue,analysis)});
  }
  if(hasUnsavedChanges&&!issues.some(issue=>issue.code.startsWith('UNSAVED_'))){
    const active=SECTORS.includes(sector)?sector:'fiscal';
    issues.unshift({code:'UNSAVED_FIELDS',sector:active,message:'Salve as alterações que ainda estão nos campos antes de gerar.',action:'save-'+active,label:'Salvar trabalho '+names[active]});
  }
  let primaryAction;
  if(currentResult)primaryAction={action:'result',label:savedVerification?'Ver DRE salva':'Ver DRE atual',message:savedVerification?'Última versão gerada com os dados salvos. Abra o Fiscal para conferir novamente os documentos.':'O resultado corresponde aos dados salvos e conferidos.',href:'/simulator.html?'+new URLSearchParams({simulation:current.id})};
  else if(ready)primaryAction={action:'generate',label:current?'Atualizar resultado':'Gerar análise',message:'Os dois setores estão conferidos. A próxima etapa usa os dados que já foram salvos.'};
  else {
    const next=issues.find(issue=>issue.code==='UNSAVED_CONFIG')||
      issues.find(issue=>issue.sector===sector&&issue.code.startsWith('UNSAVED_'))||issues.find(issue=>issue.code.startsWith('UNSAVED_'))||
      issues.find(issue=>issue.sector===sector)||issues[0];
    const target=SECTORS.find(key=>!sectors[key].complete)||'fiscal';
    primaryAction=next?{action:next.action,label:next.label,message:next.message,sector:next.sector}:
      {action:target,label:'Continuar no '+names[target],message:'Confira e conclua os dados deste setor para avançar.',sector:target};
  }
  return {state,label,kind:state==='working'?'pending':'ready',savedVerification,confirmedCount,sectors,primaryAction,issues,
    hasUnsavedChanges,canGenerate:ready&&!currentResult,currentResult,hasSavedResult:!!current?.id};
}
