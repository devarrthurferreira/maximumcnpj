import {analysisRequest} from './analyses-api.js';
import {finalizeFinancialDocument,isReadyToFinalize} from './purchase-finalization.js';
import {DIFAL_VERSION,normalizeUf} from './difal.js';
import {ANTICIPATION_VERSION} from './icms-anticipation.js';
import {OPERATION_CATALOG_VERSION} from './operation-catalog.js';
import {assertMatchingPurchaseCompetences} from './purchase-model.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const types=['PURCHASES','SALES'];
const routeFor=type=>'/api/v4/'+(type==='SALES'?'sales':'purchases');
const number=value=>value.toLocaleString('pt-BR');
const aborted=()=>new DOMException('Envio interrompido. O progresso salvo pode ser retomado.','AbortError');
function checkSignal(signal){if(signal?.aborted)throw aborted();}
function checkType(type){if(!types.includes(type))throw new Error('Escolha o documento de entradas ou de saídas.');}
function checkFile(file){
  if(!file||typeof file.name!=='string'||typeof file.arrayBuffer!=='function')throw new Error('Selecione o arquivo do relatório.');
  if(!/\.(csv|xlsx|xls)$/i.test(file.name))throw new Error('Use um arquivo CSV, XLSX ou XLS.');
  if(file.size>10*1024*1024)throw new Error('Arquivo acima de 10 MiB. Divida o relatório.');
}
function checkReview(review){
  if(!review||!Array.isArray(review.errors)||!Array.isArray(review.rows))throw new Error('Não foi possível confirmar a leitura do arquivo. Selecione-o novamente.');
  if(review.errors.length||!review.rows.length){
    const details=review.errors.slice(0,20).map(item=>`Linha ${item.line}: ${item.message}`).join('\n');
    const error=new Error(review.errors.length?`O arquivo tem ${number(review.errors.length)} pendência(s). Nenhuma linha foi enviada.\n${details}${review.errors.length>20?'\nExibindo as primeiras 20 pendências.':''}`:'O relatório não contém linhas de dados. Nenhuma linha foi enviada.');
    error.validationErrors=review.errors;error.review=review;throw error;
  }
  if(review.rows.length>50000)throw new Error('Arquivo acima do limite de 50.000 linhas. Divida o relatório.');
}
function ownedJob(job,{type,generationId,clientId,importId}){
  if(!job||!UUID.test(job._id||'')||(importId&&job._id!==importId)||job.clientId!==clientId||job.generationId!==generationId||job.mode!==type+'_V1'){
    throw new Error('O relatório não corresponde à empresa, ao documento e à análise selecionados. Atualize a análise antes de continuar.');
  }
  return job;
}
function wait(milliseconds,signal){
  checkSignal(signal);
  return new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(aborted());};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},milliseconds);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

/** The original document stays in this browser; the existing worker validates its approved fields. */
export async function readFiscalDocument(file,{type,companyCode,issuerUf,resume=null,onProgress=()=>{},signal}={}){
  checkType(type);checkFile(file);checkSignal(signal);
  if(resume&&resume.mode!==type+'_V1')throw new Error('O arquivo selecionado não corresponde ao tipo do relatório em andamento.');
  onProgress('Lendo e conferindo o arquivo…');
  const buffer=await file.arrayBuffer();checkSignal(signal);
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/purchase-import-worker.js');
    const finish=(error,review)=>{worker.terminate();signal?.removeEventListener('abort',cancel);error?reject(error):resolve(review);};
    const cancel=()=>finish(aborted());
    signal?.addEventListener('abort',cancel,{once:true});
    worker.onerror=()=>finish(new Error('Não foi possível iniciar a leitura. Selecione o arquivo novamente.'));
    worker.onmessage=({data})=>{
      if(data.type==='error'){finish(new Error(data.message||'Não foi possível ler o relatório.'));return;}
      if(data.type!=='validated')return;
      try{
        checkReview(data);
        if(resume&&(file.name!==resume.fileName||data.rows.length!==resume.expectedRows))throw new Error('Para retomar, selecione o mesmo arquivo, com o mesmo nome e número de linhas. O documento já enviado será preservado.');
        onProgress(`Arquivo reconhecido · ${number(data.rows.length)} linha(s).`);
        finish(null,data);
      }catch(error){finish(error);}
    };
    try{worker.postMessage({action:'open',name:file.name,encoding:'auto',buffer,automatic:true,reportType:type,companyCode,
      issuerUf:normalizeUf(resume?resume.issuerUf:issuerUf),
      calculationVersion:resume?.calculationVersion||(resume?'Q_V1':'NET_V2'),
      difalVersion:resume?resume.difalVersion||null:DIFAL_VERSION,
      anticipationVersion:resume?resume.anticipationVersion||null:ANTICIPATION_VERSION,
      operationVersion:resume?resume.operationVersion||null:OPERATION_CATALOG_VERSION},[buffer]);}catch(error){finish(error);}
  });
}

/** Keep `pending` after an error: retrying the same object never creates another report. */
export async function uploadFiscalDocument({file,review,type,generationId,clientId,issuerUf,resume=null,pending=null,onPending=()=>{},onProgress=()=>{},signal}){
  checkType(type);checkSignal(signal);
  if(!UUID.test(generationId||'')||!UUID.test(clientId||''))throw new Error('Abra os documentos pelo Fiscal da empresa.');
  const context={type,generationId,clientId},request=(path,method='GET',body)=>analysisRequest(path,{method,body,signal});
  if(resume)ownedJob(resume,context);
  if(pending&&(pending.type!==type||pending.generationId!==generationId||pending.clientId!==clientId))throw new Error('Há um envio pendente de outra empresa ou documento. Retome o envio original.');
  if(pending&&resume&&pending.importId!==resume._id)throw new Error('O relatório vinculado mudou. Atualize a análise antes de continuar.');
  const generation=await request('/api/v4/generations/'+generationId);
  const company=generation?._id===generationId&&generation.companies?.find(item=>item.clientId===clientId);
  if(!company)throw new Error('A empresa não pertence aos documentos desta análise. Atualize antes de continuar.');
  const current=type==='SALES'?company.sales:company.purchase;
  const existing=pending?.importId||resume?._id;
  if(current&&current._id!==existing&&!['CANCELLED','INVALID'].includes(current.status))throw new Error('Este documento já possui um relatório. Retome ou confira o arquivo existente.');
  // A creation request may have failed before the slot was attached. Retry its
  // original identity; an already confirmed or resumed slot must remain linked.
  if(existing&&(!current||current._id!==existing)&&(resume||pending?.job))throw new Error('O relatório vinculado mudou. Atualize a análise antes de continuar.');
  const active=current&&current._id===existing?ownedJob(current,{...context,importId:existing}):null;
  if(active&&['CANCELLED','INVALID'].includes(active.status))throw new Error('Este envio foi cancelado. Atualize a análise para adicionar outro arquivo.');
  if(!pending){
    const needsRows=!active||active.status==='UPLOADING'&&!isReadyToFinalize(active);
    if(needsRows){
      checkFile(file);checkReview(review);
      if(active&&(file.name!==active.fileName||review.rows.length!==active.expectedRows))throw new Error('Para retomar, selecione o mesmo arquivo, com o mesmo nome e número de linhas.');
      if(active&&review.calculationVersion!==(active.calculationVersion||'Q_V1'))throw new Error('A leitura não corresponde à regra salva deste relatório. Selecione novamente o arquivo para retomá-lo.');
      const other=type==='SALES'?company.purchase:company.sales;
      if(other?.status==='COMPLETED')assertMatchingPurchaseCompetences(review.period,other.reportPeriod);
    }
    pending={...context,importId:active?._id||crypto.randomUUID(),fileName:active?.fileName||file.name,
      issuerUf:normalizeUf(active?active.issuerUf:issuerUf),rows:needsRows?review.rows.map(({difal,anticipation,...row})=>row):null,offset:0,job:active};
    // Persist the attempt identity in UI state before the first write, including uncertain network outcomes.
    onPending(pending);
  }
  const own=job=>ownedJob(job,{...context,importId:pending.importId}),path=routeFor(type)+'/'+pending.importId;
  let job=active||pending.job;
  if(!job||job.status==='UPLOADING'&&!isReadyToFinalize(job)){
    if(!Array.isArray(pending.rows)||!pending.rows.length)throw new Error('Selecione novamente o arquivo original para retomar este envio.');
    onProgress('Salvando o documento…');
    const attached=await request('/api/v4/generations/'+generationId+'/'+(type==='SALES'?'sales':'purchases'),'POST',{
      importId:pending.importId,clientId,fileName:pending.fileName,expectedRows:pending.rows.length,type,issuerUf:pending.issuerUf});
    job=own(attached.job);pending.job=job;onPending(pending);
    if(job.status==='UPLOADING'){
      // A reselected file starts at zero so the API verifies hashes of previously saved chunks.
      // A retry kept in memory repeats only its last unconfirmed chunk.
      while(pending.offset<pending.rows.length){
        checkSignal(signal);
        const next=Math.min(pending.rows.length,pending.offset+250);
        const saved=await request(path+'/rows','POST',{offset:pending.offset,rows:pending.rows.slice(pending.offset,next)});
        if(!Number.isInteger(saved.uploaded)||saved.uploaded<next)throw new Error('O envio não avançou. Retome para continuar o mesmo documento.');
        pending.offset=next;onPending(pending);onProgress(`${number(next)} de ${number(pending.rows.length)} linhas salvas…`);
      }
      job={...job,uploaded:pending.rows.length};pending.job=job;onPending(pending);
    }
  }
  own(job);
  if(job.status==='UPLOADING'){
    job=own(await finalizeFinancialDocument(job,{request,onProgress,signal,onJob:next=>{pending.job=next;onPending(pending);}}));
    pending.job=job;onPending(pending);
  }
  while(job.status==='PROCESSING'){
    const count=Number.isInteger(job.received)&&Number.isInteger(job.summary?.unique)?` ${number(job.received)} de ${number(job.summary.unique)} concluídos.`:'';
    onProgress('Documento salvo. Consultando os CNPJs…'+count);
    const delay=Number.isFinite(job.nextPollMs)&&job.nextPollMs>=0?Math.min(job.nextPollMs,60000):1200;
    await wait(delay,signal);
    job=own(await request(path+'/process','POST',{}));pending.job=job;onPending(pending);
  }
  if(job.status!=='COMPLETED')throw new Error('O documento ainda não foi concluído. Retome o relatório para conferir seu estado.');
  onProgress('Documento adicionado. Leitura concluída.');onPending(null);return job;
}
