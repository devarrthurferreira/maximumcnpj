import {DIFAL_VERSION,isDifalVersion} from './difal.js';
import {ANTICIPATION_VERSION,isAnticipationVersion} from './icms-anticipation.js';

/** Display the server's checked estimate, without recalculating tax in the browser. */
export function documentDifalSummary({job,type,jobId,clientId,generationId,policy,regimeSelection,choice}) {
  if(!['PURCHASES','SALES'].includes(type)||!jobId||!clientId||!generationId||
     job?.status!=='COMPLETED'||job._id!==jobId||job.clientId!==clientId||job.generationId!==generationId||
     job.mode!==(type==='PURCHASES'?'PURCHASES_V1':'SALES_V1'))return null;
  const entry=type==='PURCHASES';

  const taxKey=entry?'anticipation':'difal',currentKey=entry?'currentAnticipation':'currentDifal';
  const current=Object.hasOwn(job,currentKey),expectedVersion=entry?ANTICIPATION_VERSION:DIFAL_VERSION;
  const summary=current?job[currentKey]:job.purchaseInput?.[taxKey];
  const version=current?expectedVersion:job[entry?'anticipationVersion':'difalVersion'];
  const period=current?job[currentKey+'Period']:job.reportPeriod;
  const singleYear=period?.sourceYear??Number(String(period?.startMonth||'').slice(0,4));
  const safePeriod=Number.isInteger(singleYear)&&singleYear>=2000&&singleYear<=2099&&
    (current?period?.version==='JAN_SEP_V1'&&period.complete&&period.includedMonths?.length>0:
      typeof period?.startMonth==='string'&&typeof period?.endMonth==='string'&&
      /^20\d{2}-0[1-9]$/.test(period.startMonth)&&/^20\d{2}-0[1-9]$/.test(period.endMonth)&&
      period.startMonth.slice(0,4)===period.endMonth.slice(0,4));
  const knownVersion=entry?isAnticipationVersion:isDifalVersion;
  const label=entry?'DIFAL de entrada':'DIFAL de saída';
  const context=entry?'Antecipação de ICMS · estimativa do arquivo':`DIFAL de saída desativado · janeiro a setembro${safePeriod?' de '+singleYear:''}`;
  const unavailable={label,context,state:'unavailable',amountCents:null,
    note:'Estimativa indisponível nesta leitura. Confira o relatório.'};
  if(!summary||(!safePeriod||summary.version!==expectedVersion)||!knownVersion(summary.version)||(version!==undefined&&version!==summary.version)||
     !['amountCents','baseCents','eligibleLines','pendingLines'].every(key=>Number.isSafeInteger(summary[key])&&summary[key]>=0)||
     !Number.isFinite(summary.ratePercent)||summary.ratePercent<=0||summary.ratePercent>100)return unavailable;
  const totals={baseCents:summary.baseCents,eligibleLines:summary.eligibleLines,pendingLines:summary.pendingLines};
  if(!entry){
    if(['amountCents','baseCents','eligibleLines','pendingLines'].some(key=>summary[key]!==0))return unavailable;
    return {label,context,...totals,state:'ready',amountCents:0,note:'Não aplicado pela regra desta análise. Isso não significa ausência de vendas interestaduais.'};
  }
  if(summary.pendingLines){
    const partial=summary.eligibleLines>0;
    return {label,context,...totals,state:partial?'partial':'pending',amountCents:partial?summary.amountCents:null,
      note:`${partial?'Valor parcial · ':''}${summary.pendingLines} ${summary.pendingLines===1?'linha com UF pendente':'linhas com UF pendente'}. Confira o relatório.`};
  }
  return {label,context,...totals,state:'ready',amountCents:summary.amountCents,
    note:summary.baseCents===0?'Sem operações elegíveis neste arquivo.':''};
}

const currentEstimates = new Map();
/** Fetch checked Jan–Sep estimates independently; failures never become confirmed zero. */
export async function loadDocumentDifal(generation,{clientId,request,onUpdate=()=>{}}) {
  const company=generation?.companies?.find(company=>company.clientId===clientId);
  if(!company)return;
  await Promise.all([
    ['sales','salesJobId','SALES_V1','difal','difalVersion',DIFAL_VERSION,'currentDifal'],
    ['purchases','purchaseJobId','PURCHASES_V1','anticipation','anticipationVersion',ANTICIPATION_VERSION,'currentAnticipation']
  ].map(async ([slot,idKey,mode,taxKey,versionKey,currentVersion,currentKey])=>{
    const job=company[slot==='purchases'?'purchase':slot];
    if(!job||job._id!==company[idKey]||job.clientId!==clientId||job.generationId!==generation._id||
       job.mode!==mode||job.status!=='COMPLETED')return;
    const period=job.reportPeriod;
    if(job[versionKey]===currentVersion&&job.purchaseInput?.[taxKey]?.version===currentVersion&&
       /^20\d{2}-0[1-9]$/.test(period?.startMonth||'')&&/^20\d{2}-0[1-9]$/.test(period?.endMonth||'')&&
       period.startMonth.slice(0,4)===period.endMonth.slice(0,4))return;
    const key=JSON.stringify([job._id,job.completedAt,job[versionKey],currentVersion,clientId,generation._id]);
    if(!currentEstimates.has(key))currentEstimates.set(key,
      request('/api/v4/'+slot+'/'+encodeURIComponent(job._id)+'/difal-period').then(result=>{
        if(result.jobId!==job._id||result.clientId!==clientId||result.generationId!==generation._id||
           result[taxKey]?.version!==currentVersion||result.period?.version!=='JAN_SEP_V1')throw new Error('Resumo DIFAL não corresponde ao documento.');
        return result;
      }).catch(()=>{currentEstimates.delete(key);return null;}));
    const result=await currentEstimates.get(key);
    Object.assign(job,{[currentKey]:result?.[taxKey]||null,[currentKey+'Period']:result?.period||null});
    onUpdate();
  }));
}
