import {difalDirectionSelection} from './difal-policy.js';
import {resolveRegimeSelection} from './regime-selection.js';
import {isDifalVersion} from './difal.js';
import {isAnticipationVersion} from './icms-anticipation.js';

/** Display the completed document's stored estimate, without recalculating tax or DRE application. */
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

  const summary=job.purchaseInput?.[entry?'anticipation':'difal'];
  const version=job[entry?'anticipationVersion':'difalVersion'];
  const knownVersion=entry?isAnticipationVersion:isDifalVersion;
  const label=entry?'DIFAL de entrada':'DIFAL de saída';
  const context=entry?'Antecipação de ICMS · estimativa do arquivo':'Estimativa do arquivo';
  const unavailable={label,context,state:'unavailable',amountCents:null,
    note:'Estimativa indisponível nesta leitura. Confira o relatório.'};
  if(!summary||!knownVersion(summary.version)||(version!==undefined&&version!==summary.version)||
     !['amountCents','baseCents','eligibleLines','pendingLines'].every(key=>Number.isSafeInteger(summary[key])&&summary[key]>=0)||
     !Number.isFinite(summary.ratePercent)||summary.ratePercent<=0||summary.ratePercent>100)return unavailable;
  if(summary.pendingLines){
    const partial=summary.eligibleLines>0;
    return {label,context,state:partial?'partial':'pending',amountCents:partial?summary.amountCents:null,
      note:`${partial?'Valor parcial · ':''}${summary.pendingLines} ${summary.pendingLines===1?'linha com UF pendente':'linhas com UF pendente'}. Confira o relatório.`};
  }
  return {label,context,state:'ready',amountCents:summary.amountCents,
    note:summary.eligibleLines===0?'Sem operações elegíveis neste arquivo.':''};
}
