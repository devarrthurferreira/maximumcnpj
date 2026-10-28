/** Financial imports can finish in several requests without uploading the file again. */
export function isReadyToFinalize(job) {
  return job?.status==='UPLOADING'&&Number.isInteger(job.expectedRows)&&job.expectedRows>0&&job.uploaded===job.expectedRows;
}

function pause(ms,signal) {
  if(signal?.aborted)return Promise.reject(new DOMException('Leitura interrompida. O progresso salvo pode ser retomado.','AbortError'));
  return new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('Leitura interrompida. O progresso salvo pode ser retomado.','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

/** `request` is the authenticated transport already used by the caller. */
export async function finalizeFinancialDocument(job,{request,onProgress=()=>{},onJob=()=>{},signal,wait=pause}={}) {
  if(!job?._id||!['PURCHASES_V1','SALES_V1'].includes(job.mode))throw new Error('Não foi possível identificar o relatório para finalizar.');
  const original=job,path='/api/v4/'+(job.mode==='SALES_V1'?'sales':'purchases')+'/'+job._id+'/finalize';
  let failures=0,unchanged=0,lastProgress='';
  while(job.status==='UPLOADING'){
    if(signal?.aborted)throw new DOMException('Leitura interrompida. O progresso salvo pode ser retomado.','AbortError');
    if(!isReadyToFinalize(job))throw new Error('Ainda faltam linhas do arquivo. Retome o envio do mesmo documento.');
    const progress=job.finalization;
    const copied=Number.isInteger(progress?.copiedRows)?Math.min(job.expectedRows,progress.copiedRows):null;
    const message=progress?.phase==='VERIFYING'?`Conferindo os dados salvos · ${Number(progress.verifiedRows||0).toLocaleString('pt-BR')} de ${job.expectedRows.toLocaleString('pt-BR')} linhas.`:
      progress?.phase==='PREPARING'?'Preparando as consultas dos documentos…':progress?.phase==='COMMITTING'?'Conferindo os totais e concluindo a importação…':
      copied===null?'Finalizando o documento enviado…':`Salvando a leitura · ${copied.toLocaleString('pt-BR')} de ${job.expectedRows.toLocaleString('pt-BR')} linhas.`;
    onProgress(message);
    let next;
    try { next=await request(path,'POST',{});failures=0; }
    catch(error){
      const transient=error.code==='DATABASE_TIMEOUT'||error.code==='DATABASE_UNAVAILABLE'||error.code==='JOB_BUSY'||error.retryable===true;
      if(!transient||++failures>3)throw error;
      onProgress('O servidor demorou nesta etapa. Retomando a finalização do mesmo documento…');
      await wait(failures*1500,signal);continue;
    }
    if(next?._id!==original._id||next.clientId!==original.clientId||next.generationId!==original.generationId||next.mode!==original.mode){
      throw new Error('A resposta não corresponde ao documento enviado. Atualize a análise para conferir o progresso salvo.');
    }
    if(!['UPLOADING','PROCESSING','COMPLETED'].includes(next.status))throw new Error('O relatório foi alterado ou cancelado. Atualize para conferir seu estado.');
    job=next;onJob(job);
    if(job.status==='UPLOADING'){
      const checkpoint=job.finalization;
      const marker=JSON.stringify(checkpoint?[checkpoint.phase,checkpoint.copiedRows,checkpoint.preparedCnpjs,checkpoint.verifiedRows]:null);
      unchanged=marker===lastProgress?unchanged+1:0;lastProgress=marker;
      if(unchanged>=3)throw new Error('A finalização não avançou. O documento enviado foi preservado; tente retomar em instantes.');
    }
  }
  return job;
}
