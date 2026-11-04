import {analysisRequest,safeAnalysisRequestId} from './analyses-api.js';
import {reconcileSection22Extraction} from './simulator-rbt12.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const checkSignal=signal=>{if(signal?.aborted)throw new DOMException('Operação cancelada.','AbortError');};

/** Read-only recovery can retry an interrupted response, never a rejected PDF. */
const transientRead=error=>error?.responseUnconfirmed===true&&error.retryable!==false&&error.code!=='NETWORK_TIMEOUT'&&error.name!=='AbortError';

export function analysisDocumentReadingMessage(status) {
  if(status.status==='PROCESSING')return 'A leitura do PDF armazenado ainda está em andamento. Use Verificar leitura em instantes; nenhum novo processamento foi iniciado.';
  const failure=status.error||status.lastError,reason=typeof failure?.message==='string'?failure.message.trim():'';
  const requestId=safeAnalysisRequestId(failure?.requestId);
  const detail=(reason?reason+' ':'')+(requestId?'Código da requisição: '+requestId+'. ':'');
  if(status.originalStored)return 'O PDF original está armazenado. '+detail+
    (status.hasReadyExtraction?'A leitura anterior foi preservada e não foi aplicada nesta tela. ':'')+
    'Use Ler novamente para retomar sem reenviar o arquivo.';
  if(status.retryable)return 'O envio foi registrado, mas o servidor ainda não confirmou o arquivo. '+detail+'Use Ler novamente para tentar o mesmo PDF sem reenviar.';
  return 'O envio ainda não foi confirmado. '+detail+'Verifique novamente ou selecione o PDF para reenviar.';
}

function validateExtraction(data,{clientId,documentId,extractionId,cnpj}) {
  const id=data?.extractionId||data?.id;
  if(!uuid(id)||data.clientId!==clientId||(documentId&&data.documentId!==documentId)||(extractionId&&id!==extractionId)){
    throw new Error('A leitura não corresponde ao PDF e à empresa desta análise. Confira o documento antes de continuar.');
  }
  const normalized=String(cnpj||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  if(normalized&&normalized.slice(0,8)!==data.cnpjBasico)throw new Error('O CNPJ do extrato não corresponde à empresa desta análise. Selecione o documento correto.');
  const reconciled=reconcileSection22Extraction(data);
  const {searchablePdfBase64,...reference}=data;
  return {...reference,...reconciled,extractionId:id};
}

export async function loadAnalysisExtraction({clientId,documentId,extractionId,cnpj,signal}) {
  if(!uuid(clientId)||!uuid(extractionId))throw new Error('A referência do extrato não está disponível. Leia o PDF novamente.');
  for(let read=0;read<2;read++){
    checkSignal(signal);
    try{
      const data=await analysisRequest('/api/simples?'+new URLSearchParams({clientId,extractionId}),{signal});
      checkSignal(signal);
      return validateExtraction(data,{clientId,documentId,extractionId,cnpj});
    }catch(error){
      checkSignal(signal);
      if(read===0&&transientRead(error))continue;
      throw error;
    }
  }
}

export async function analysisDocumentStatus({clientId,documentId,signal}) {
  if(!uuid(clientId)||!uuid(documentId))throw new Error('Selecione o PDF desta empresa para conferir a leitura.');
  const status=await analysisRequest('/api/v4/simples-documents/'+encodeURIComponent(documentId)+'/status',{signal});
  if(status.documentId!==documentId||status.clientId!==clientId)throw new Error('O PDF armazenado não corresponde à empresa desta análise.');
  return status;
}

async function processDocument(urls,context) {
  if(urls.documentId!==context.documentId||!uuid(urls.attemptId))throw new Error('Não foi possível confirmar o documento preparado para a leitura.');
  const body={documentId:urls.documentId,attemptId:urls.attemptId,
    originalGetUrl:urls.originalGetUrl,searchablePutUrl:urls.searchablePutUrl};
  for(let invocation=0;invocation<2;invocation++){
    checkSignal(context.signal);
    try{
      const data=await analysisRequest('/api/simples?'+new URLSearchParams({clientId:context.clientId}),{
        method:'POST',signal:context.signal,body});
      checkSignal(context.signal);
      return validateExtraction(data,context);
    }catch(error){
      checkSignal(context.signal);
      if(!error.responseUnconfirmed)throw error;
      context.onProgress?.('A resposta da leitura foi interrompida. Conferindo o PDF armazenado…');
      // A lost connection does not imply a failed OCR. Consult this document
      // once and recover only the same attempt, never an older READY result.
      let status;
      try{status=await analysisDocumentStatus(context);}
      catch(statusError){
        checkSignal(context.signal);
        // Keep the original reading diagnosis if this read-only check also
        // loses its response. Identity/auth failures remain distinct errors.
        if(!statusError.responseUnconfirmed)throw statusError;
        error.message+=' Também não foi possível conferir o estado do PDF. Use Verificar leitura novamente; nenhum novo processamento foi iniciado nesta recuperação.';
        error.recoveryError={code:statusError.code,status:statusError.status,requestId:statusError.requestId};
        throw error;
      }
      checkSignal(context.signal);
      if(status.status==='READY'&&status.attemptId===urls.attemptId&&!status.error&&!status.lastError&&
         status.originalStored===true&&status.hasReadyExtraction===true&&uuid(status.extractionId)){
        context.onProgress?.('Leitura salva localizada. Recuperando a seção 2.2…');
        return loadAnalysisExtraction({...context,extractionId:status.extractionId});
      }
      // Retry just one failed invocation, reusing the exact signed ticket. A
      // new, unclaimed document is the only state that proves no OCR started.
      // The server's atomic attempt claim also rejects a competing invocation.
      if(invocation===0&&error.invocationNotConfirmed&&status.status==='AWAITING_UPLOAD'&&
         status.attempts===0&&status.attemptId===null&&status.retryable===true&&
         !status.extractionId&&!status.hasReadyExtraction&&!status.error&&!status.lastError){
        context.onProgress?.('Retomando a mesma solicitação de leitura do PDF armazenado…');
        continue;
      }
      error.documentStatus=status;
      if(status.status==='PROCESSING'||status.error||status.lastError)error.message=analysisDocumentReadingMessage(status);
      else if(status.attemptId&&status.attemptId!==urls.attemptId){
        error.message='O estado do PDF mudou durante esta leitura. Use Verificar leitura para conferir a tentativa atual antes de continuar.';
      }
      throw error;
    }
  }
}

export async function uploadAnalysisExtraction({clientId,cnpj,file,signal,onProgress=()=>{},onStored=async()=>{}}) {
  if(!uuid(clientId))throw new Error('Selecione a empresa antes de adicionar o extrato.');
  if(!file||(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'))throw new Error('Selecione o extrato ou a declaração do Simples em PDF.');
  if(file.size<=0||file.size>8*1024*1024)throw new Error('O PDF deve conter dados e ter até 8 MiB.');
  onProgress('Preparando o envio do extrato…');
  const started=await analysisRequest('/api/v4/simples-documents',{method:'POST',signal,
    body:{clientId,fileName:file.name,sizeBytes:file.size}});
  if(!uuid(started.documentId))throw new Error('O envio do PDF não foi preparado. Tente novamente.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
  const cancel=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',cancel,{once:true});
  try {
    onProgress('Armazenando o PDF original…');
    const response=await fetch(started.originalPutUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file,signal:controller.signal});
    if(!response.ok)throw new Error('Não foi possível confirmar o envio do PDF. Tente novamente.');
  } catch(error){
    checkSignal(signal);
    if(error.name==='AbortError')throw new Error('O envio do PDF demorou a responder. Selecione o arquivo para tentar enviar novamente.');
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  checkSignal(signal);
  await onStored(started.documentId);
  checkSignal(signal);
  onProgress('PDF armazenado. Lendo a seção 2.2 do Simples…');
  try {return await processDocument(started,{clientId,cnpj,documentId:started.documentId,signal,onProgress});}
  catch(error){error.documentId=started.documentId;throw error;}
}

export async function retryAnalysisExtraction({clientId,documentId,cnpj,signal,onProgress=()=>{}}) {
  if(!uuid(clientId)||!uuid(documentId))throw new Error('Selecione o documento desta empresa para tentar a leitura novamente.');
  onProgress('Preparando uma nova leitura do PDF armazenado…');
  const urls=await analysisRequest('/api/v4/simples-documents/'+encodeURIComponent(documentId)+'/process-urls',{method:'POST',body:{},signal});
  onProgress('Lendo novamente a seção 2.2 do Simples…');
  return processDocument(urls,{clientId,documentId,cnpj,signal,onProgress});
}
