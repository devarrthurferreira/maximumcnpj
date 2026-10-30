import {AppError, need} from './security.ts';
import {parseRegimeSelection, requiresSimplesReference} from '../public/regime-selection.js';
import type {RegimeSelection} from '../public/regime-selection.js';
import {parseDifalPolicy, upgradeDifalPolicy} from '../public/simulator-engine.js';
import type {DifalPolicy} from '../public/simulator-engine.js';
import {JAN_SEP_POLICY,isAnalysisMonth,analysisMonthsForYear} from '../public/analysis-period.js';

export const ANALYSIS_VERSION = 'ANALYSIS_SECTORS_V1';
export const ANALYSIS_GROUPS = ['salesOptantCents','salesNonOptantCents','salesCpfCents','purchasesOptantCents','purchasesNonOptantCents'] as const;
export const ACCOUNTING_FIELDS = ['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'] as const;
export type AccountingField = typeof ACCOUNTING_FIELDS[number];
export type AccountingMonth = {sourceMonth:string} & Record<AccountingField, number|null>;
export const ACCOUNTING_AVERAGE_VERSION = 'MONTHLY_AVERAGE_V1';
export type AccountingAverage = {version:typeof ACCOUNTING_AVERAGE_VERSION;values:Record<AccountingField,number|null>};
export type AccountingData = {months:AccountingMonth[];monthlyAverage?:AccountingAverage};
export type FiscalOverride = {sourceMonth:string;groups:Record<typeof ANALYSIS_GROUPS[number],number>;serviceRevenue:number};
export type FiscalData = {
  generationId:string|null;salesAnnex:1|2;serviceAnnex:3|4|5;icmsOutside:boolean;difalPolicy:DifalPolicy;
  rbt12Source:'SIMPLES_SECTION_22'|'MANUAL'|'NOT_PROVIDED'|'NOT_REQUIRED';rbt12ExtractionId:string|null;rbt12DocumentId:string|null;
  rbt12:number|null;rbt12ManualConfirmed:boolean;monthlyOverrides:FiscalOverride[]|null;
};
export type AnalysisConfig = {revision:number;year:2027|2028;regimeSelection:RegimeSelection};
export type AnalysisIssue = {code:string;sector:'fiscal'|'accounting'|'config';message:string};

export function analysisObject(value:unknown, required:readonly string[], optional:readonly string[]=[]): asserts value is Record<string,any> {
  need(value && typeof value==='object' && !Array.isArray(value),'Informe um objeto válido.');
  need(Object.keys(value).every(key=>required.includes(key)||optional.includes(key)) && required.every(key=>Object.hasOwn(value,key)),
    'Preencha os campos da análise sem enviar campos adicionais.');
}
export function analysisId(value:unknown):string {
  need(typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),'Identificador inválido.');
  return value;
}
export function analysisRevision(value:unknown):number {
  need(typeof value==='number' && Number.isSafeInteger(value) && value>=0,'Informe a revisão dos dados que foram abertos.');
  return value;
}
export function analysisYear(value:unknown):2027|2028 {
  need(value===2027 || value===2028,'Selecione 2027 ou 2028 para a análise.');return value;
}
export function analysisSelection(value:unknown):RegimeSelection {
  try{return parseRegimeSelection(value);}catch(error){throw new AppError(400,'VALIDATION',error instanceof Error?error.message:'Seleção de regimes inválida.');}
}
export function analysisDifalPolicy(value:unknown):DifalPolicy {
  try{return upgradeDifalPolicy(parseDifalPolicy(value));}
  catch(error){throw new AppError(400,'VALIDATION',error instanceof Error?error.message:'Opções de DIFAL inválidas.');}
}
function month(value:unknown):string {
  need(typeof value==='string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value),'Informe a competência no formato AAAA-MM.');return value;
}
function money(value:unknown,signed=false):number {
  need(typeof value==='number' && Number.isFinite(value) && (signed || value>=0) && Math.abs(value)<=1_000_000_000_000 && value===Math.round(value*100)/100,
    'Informe um valor válido com no máximo duas casas decimais.');return value;
}
function cents(value:unknown):number|null {
  need(value===null || (typeof value==='number' && Number.isSafeInteger(value) && value>=0 && value<=100_000_000_000_000),
    'Informe despesas em centavos inteiros ou deixe o campo pendente. Use zero somente quando não houver despesa.');return value;
}
function uniqueMonths<T extends {sourceMonth:string}>(rows:T[]):T[] {
  need(new Set(rows.map(row=>row.sourceMonth)).size===rows.length,'Cada competência deve aparecer uma única vez.');
  return rows.sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));
}
export function parseAccountingData(value:unknown,complete=false,options:{periodPolicy?:typeof JAN_SEP_POLICY;sourceYear?:number}={}):AccountingData {
  analysisObject(value,['months'],['monthlyAverage']);
  need(Array.isArray(value.months) && value.months.length<=12,'Informe até 12 competências explicitamente.');
  const months=uniqueMonths(value.months.map((row:unknown)=>{
    analysisObject(row,['sourceMonth',...ACCOUNTING_FIELDS]);
    return {sourceMonth:month(row.sourceMonth),...Object.fromEntries(ACCOUNTING_FIELDS.map(key=>[key,cents(row[key])]))} as AccountingMonth;
  }));
  let data:AccountingData={months};
  if(Object.hasOwn(value,'monthlyAverage')){
    analysisObject(value.monthlyAverage,['version','values']);
    need(value.monthlyAverage.version===ACCOUNTING_AVERAGE_VERSION,'A média mensal precisa identificar sua versão.');
    analysisObject(value.monthlyAverage.values,ACCOUNTING_FIELDS);
    const values=Object.fromEntries(ACCOUNTING_FIELDS.map(key=>[key,cents(value.monthlyAverage.values[key])])) as AccountingAverage['values'];
    const sourceYear=Number(months[0]?.sourceMonth.slice(0,4));
    need(Number.isInteger(sourceYear)&&sourceYear>=2000&&sourceYear<=2099,'Informe o ano de janeiro a setembro da média mensal.');
    const expected=analysisMonthsForYear(sourceYear);
    need(months.length===9&&months.every((row,index)=>row.sourceMonth===expected[index]&&ACCOUNTING_FIELDS.every(key=>row[key]===values[key])),
      'A média mensal deve se repetir igualmente em todos os nove meses, de janeiro a setembro.',422,'ANALYSIS_ACCOUNTING_AVERAGE');
    data=accountingForYear({months,monthlyAverage:{version:ACCOUNTING_AVERAGE_VERSION,values}},options.sourceYear);
  }
  const selected=options.periodPolicy===JAN_SEP_POLICY?data.months.filter(row=>isAnalysisMonth(row.sourceMonth,options.sourceYear)&&ACCOUNTING_FIELDS.some(key=>row[key]!==null)):data.months;
  need(!complete||options.periodPolicy!==JAN_SEP_POLICY||options.sourceYear!==undefined||new Set(selected.map(row=>row.sourceMonth.slice(0,4))).size<=1,
    'Prepare janeiro a setembro de um único ano para concluir o Contábil.',422,'ANALYSIS_ACCOUNTING_INCOMPLETE');
  need(!complete || (selected.length>0 && selected.every(row=>ACCOUNTING_FIELDS.every(key=>row[key]!==null))),
    'Preencha todas as despesas de cada competência. Informe 0 explicitamente quando não houver valor.',422,'ANALYSIS_ACCOUNTING_INCOMPLETE');
  return data;
}
/** A saved monthly average belongs to the analysis, even before Fiscal identifies its source year.
 * Derivation never mutates stored rows or historical revisions. Legacy monthly inputs retain their dates. */
export function accountingForYear(data:AccountingData,sourceYear?:number):AccountingData {
  if(!data.monthlyAverage)return data;
  const year=sourceYear??Number(data.months[0]?.sourceMonth.slice(0,4));
  return {...data,months:analysisMonthsForYear(year).map(sourceMonth=>({sourceMonth,...data.monthlyAverage!.values}))};
}
export function defaultFiscalData(selection:RegimeSelection):FiscalData {
  return {generationId:null,salesAnnex:1,serviceAnnex:3,icmsOutside:false,difalPolicy:upgradeDifalPolicy(),
    rbt12Source:requiresSimplesReference(selection)?'NOT_PROVIDED':'NOT_REQUIRED',rbt12ExtractionId:null,rbt12DocumentId:null,
    rbt12:null,rbt12ManualConfirmed:false,monthlyOverrides:null};
}
/** Capture only applicable preferences for this import; the editable preferences remain unchanged. */
export function effectiveAnalysisDifalPolicy(preferences:DifalPolicy,selection:RegimeSelection):DifalPolicy {
  const effective=upgradeDifalPolicy(preferences),selected=parseRegimeSelection(selection).selected;
  for(const id of ['pure','hybrid','presumed','actual'] as const){
    if(!selected.includes(id))effective.enabled[id]=false;
  }
  return effective;
}
export function parseFiscalData(value:unknown,selection:RegimeSelection):FiscalData {
  analysisObject(value,['generationId','salesAnnex','serviceAnnex','icmsOutside','difalPolicy','rbt12Source','rbt12ExtractionId','rbt12DocumentId','rbt12','rbt12ManualConfirmed','monthlyOverrides']);
  need([1,2].includes(value.salesAnnex) && [3,4,5].includes(value.serviceAnnex),'Selecione anexos válidos.');
  need(typeof value.icmsOutside==='boolean' && typeof value.rbt12ManualConfirmed==='boolean','Confirme as opções fiscais.');
  const difalPolicy=analysisDifalPolicy(value.difalPolicy);
  const needsReference=requiresSimplesReference(selection);
  need(needsReference ? ['SIMPLES_SECTION_22','MANUAL','NOT_PROVIDED'].includes(value.rbt12Source) : value.rbt12Source==='NOT_REQUIRED',
    needsReference?'Escolha não informar a RBT12, preencher manualmente ou usar o extrato.':'Sem Simples selecionado, a referência de RBT12 deve estar dispensada.',400,'RBT12_SOURCE');
  const data: FiscalData={generationId:value.generationId===null?null:analysisId(value.generationId),salesAnnex:value.salesAnnex,serviceAnnex:value.serviceAnnex,
    icmsOutside:value.icmsOutside,difalPolicy,rbt12Source:value.rbt12Source,
    rbt12ExtractionId:value.rbt12ExtractionId===null?null:analysisId(value.rbt12ExtractionId),
    rbt12DocumentId:value.rbt12DocumentId===null?null:analysisId(value.rbt12DocumentId),
    rbt12:value.rbt12===null?null:money(value.rbt12),rbt12ManualConfirmed:value.rbt12ManualConfirmed,monthlyOverrides:null};
  need(needsReference || (data.rbt12===null && data.rbt12ExtractionId===null && data.rbt12DocumentId===null && !data.rbt12ManualConfirmed),
    'Não envie uma RBT12 ou um extrato quando nenhum regime do Simples foi selecionado.',400,'RBT12_SOURCE');
  need(data.rbt12Source!=='NOT_PROVIDED' || (data.rbt12===null && data.rbt12ExtractionId===null && data.rbt12DocumentId===null && !data.rbt12ManualConfirmed),
    'Sem RBT12 informada, deixe o valor vazio e desvincule o extrato e a confirmação manual.',400,'RBT12_SOURCE');
  if(value.monthlyOverrides!==null){
    need(Array.isArray(value.monthlyOverrides) && value.monthlyOverrides.length>=1 && value.monthlyOverrides.length<=12,'Os ajustes fiscais precisam corresponder às competências.');
    data.monthlyOverrides=uniqueMonths(value.monthlyOverrides.map((row:unknown)=>{
      analysisObject(row,['sourceMonth','groups','serviceRevenue']);analysisObject(row.groups,ANALYSIS_GROUPS);
      return {sourceMonth:month(row.sourceMonth),groups:Object.fromEntries(ANALYSIS_GROUPS.map((key,index)=>[key,money(row.groups[key],index<3)])) as FiscalOverride['groups'],serviceRevenue:money(row.serviceRevenue)};
    }));
  }
  return data;
}
