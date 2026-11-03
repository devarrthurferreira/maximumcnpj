import {documentDifalSummary} from './analysis-document-difal.js';

/** Evidence from the current linked reports, never from a checkbox or saved DRE. */
export function assessAnalysisDifal({analysis,generation,documentUploads={},generationError='',generationUnavailable=false}={}) {
  const generationId=analysis?.fiscal?.data?.generationId,clientId=analysis?.clientId;
  const companies=generation?._id===generationId?generation?.companies?.filter(item=>item.clientId===clientId):[];
  const company=companies?.length===1?companies[0]:null;
  return Object.fromEntries([['entry','PURCHASES','purchase','purchaseJobId'],['exit','SALES','sales','salesJobId']].map(([direction,type,slot,idKey])=>{
    const label=direction==='entry'?'DIFAL de entrada':'DIFAL de saída';
    const unknown=(state,note)=>({direction,label,state,amountCents:null,baseCents:null,eligibleLines:null,pendingLines:null,note,confirmed:false});
    const upload=documentUploads[type];
    if(upload?.error||generationError||generationUnavailable)return [direction,unknown('unavailable','Leitura indisponível. Confira ou tente novamente; não é um zero confirmado.')];
    if(upload?.busy||['reading','preparing','uploading','processing'].includes(upload?.status?.toLowerCase()))return [direction,unknown('reading','Relatório em leitura. O resultado anterior não confirma este arquivo.')];
    if(!generationId)return [direction,unknown('waiting','Adicione o relatório para verificar as operações de janeiro a setembro.')];
    if(!company)return [direction,unknown(generation?'unavailable':'reading','Aguardando conferência dos relatórios vinculados à empresa.')];
    const job=company[slot],jobId=company[idKey];
    if(!jobId&&!job)return [direction,unknown('waiting','Adicione o relatório para verificar as operações de janeiro a setembro.')];
    if(!job||job._id!==jobId||job.clientId!==clientId||job.generationId!==generationId)return [direction,unknown('unavailable','O relatório não corresponde à empresa e à importação atual.')];
    if(job.status!=='COMPLETED')return [direction,unknown(['UPLOADING','PROCESSING'].includes(job.status)?'reading':'unavailable','A leitura do relatório ainda não foi concluída.')];
    const summary=documentDifalSummary({job,jobId,clientId,generationId,type});
    if(!summary)return [direction,unknown('unavailable','Não foi possível confirmar a estimativa deste relatório.')];
    const confirmed=summary.state==='ready';
    const state=confirmed?(direction==='exit'?'disabled':summary.baseCents>0?'available':'none'):summary.state;
    return [direction,{...summary,direction,state,confirmed}];
  }));
}

/** New drafts have no answer. Legacy saved preferences remain visible, not inferred evidence. */
export function savedDifalChoice(fiscal) {
  if(Object.hasOwn(fiscal?.data||{},'difalChoice'))return fiscal.data.difalChoice;
  return fiscal?.revision>0?undefined:null;
}
