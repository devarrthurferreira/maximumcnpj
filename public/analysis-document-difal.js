import {difalDirectionSelection} from './difal-policy.js';
import {resolveRegimeSelection} from './regime-selection.js';
import {DIFAL_VERSION,isDifalVersion} from './difal.js';
import {isAnticipationVersion} from './icms-anticipation.js';

/** Display the server's checked estimate, without recalculating tax in the browser. */
export function documentDifalSummary({job,type,jobId,clientId,generationId,policy,regimeSelection,choice}) {
  if(!['PURCHASES','SALES'].includes(type)||choice===null||choice==='no'||!jobId||!clientId||!generationId||
     job?.status!=='COMPLETED'||job._id!==jobId||job.clientId!==clientId||job.generationId!==generationId||
     job.mode!==(type==='PURCHASES'?'PURCHASES_V1':'SALES_V1'))return null;
  const entry=type==='PURCHASES',direction=entry?'entry':'exit';
  let selection,selected;
  try {
    selection=difalDirectionSelection(policy,direction);
    selected=resolveRegimeSelection(regimeSelection).selected;
  } catch { return null; }
  if(!selection?.regimeIds.some(id=>selected.includes(id)))return null;

  const currentSales=!entry&&Object.hasOwn(job,'currentDifal');
  const summary=currentSales?job.currentDifal:job.purchaseInput?.[entry?'anticipation':'difal'];
  const version=currentSales?DIFAL_VERSION:job[entry?'anticipationVersion':'difalVersion'];
  const period=currentSales?job.currentDifalPeriod:job.reportPeriod;
  const singleYear=period?.sourceYear??Number(String(period?.startMonth||'').slice(0,4));
  const safePeriod=Number.isInteger(singleYear)&&singleYear>=2000&&singleYear<=2099&&
    (currentSales?period?.version==='JAN_SEP_V1'&&period.complete&&period.includedMonths?.length>0:
      typeof period?.startMonth==='string'&&typeof period?.endMonth==='string'&&
      /^20\d{2}-0[1-9]$/.test(period.startMonth)&&/^20\d{2}-0[1-9]$/.test(period.endMonth)&&
      period.startMonth.slice(0,4)===period.endMonth.slice(0,4));
  const knownVersion=entry?isAnticipationVersion:isDifalVersion;
  const label=entry?'DIFAL de entrada':'DIFAL de saída';
  const context=entry?'Antecipação de ICMS · estimativa do arquivo':`Estimativa do arquivo · janeiro a setembro${safePeriod?' de '+singleYear:''}`;
  const unavailable={label,context,state:'unavailable',amountCents:null,
    note:'Estimativa indisponível nesta leitura. Confira o relatório.'};
  if(!summary||(!entry&&(!safePeriod||summary.version!==DIFAL_VERSION))||!knownVersion(summary.version)||(version!==undefined&&version!==summary.version)||
     !['amountCents','baseCents','eligibleLines','pendingLines'].every(key=>Number.isSafeInteger(summary[key])&&summary[key]>=0)||
     !Number.isFinite(summary.ratePercent)||summary.ratePercent<=0||summary.ratePercent>100)return unavailable;
  if(summary.pendingLines){
    const partial=summary.eligibleLines>0;
    return {label,context,state:partial?'partial':'pending',amountCents:partial?summary.amountCents:null,
      note:`${partial?'Valor parcial · ':''}${summary.pendingLines} ${summary.pendingLines===1?'linha com UF pendente':'linhas com UF pendente'}. Confira o relatório.`};
  }
  return {label,context,state:'ready',amountCents:summary.amountCents,
    note:summary.baseCents===0?(entry?'Sem operações elegíveis neste arquivo.':'Não possui vendas elegíveis para CPF de outro estado. DIFAL de vendas: R$ 0,00.'):''};
}

const currentEstimates = new Map();
/** Fetch each completed sale's checked Jan–Sep estimate independently of upload status. */
export async function loadDocumentDifal(generation,{clientId,request,onUpdate=()=>{}}) {
  const company=generation?.companies?.find(company=>company.clientId===clientId),job=company?.sales;
  if(!job||job._id!==company.salesJobId||job.clientId!==clientId||job.generationId!==generation._id||
     job.mode!=='SALES_V1'||job.status!=='COMPLETED')return;
  const period=job.reportPeriod;
  if(job.difalVersion===DIFAL_VERSION&&job.purchaseInput?.difal?.version===DIFAL_VERSION&&
     /^20\d{2}-0[1-9]$/.test(period?.startMonth||'')&&/^20\d{2}-0[1-9]$/.test(period?.endMonth||'')&&
     period.startMonth.slice(0,4)===period.endMonth.slice(0,4))return;
  const key=JSON.stringify([job._id,job.completedAt,job.difalVersion,DIFAL_VERSION]);
  if(!currentEstimates.has(key))currentEstimates.set(key,
    request('/api/v4/sales/'+encodeURIComponent(job._id)+'/difal-period').then(result=>{
      if(result.jobId!==job._id||result.clientId!==clientId||result.generationId!==generation._id||
         result.difal?.version!==DIFAL_VERSION||result.period?.version!=='JAN_SEP_V1')throw new Error('Resumo DIFAL não corresponde ao documento.');
      return result;
    }).catch(()=>{currentEstimates.delete(key);return null;}));
  const result=await currentEstimates.get(key);
  Object.assign(job,{currentDifal:result?.difal||null,currentDifalPeriod:result?.period||null});
  onUpdate();
}
