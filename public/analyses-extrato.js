import {analysisRequest} from './analyses-api.js';
import {reconcileSection22Extraction} from './simulator-rbt12.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

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
  const data=await analysisRequest('/api/simples?'+new URLSearchParams({clientId,extractionId}),{signal});
  return validateExtraction(data,{clientId,documentId,extractionId,cnpj});
}

export async function analysisDocumentStatus({clientId,documentId,signal}) {
  if(!uuid(clientId)||!uuid(documentId))throw new Error('Selecione o PDF desta empresa para conferir a leitura.');
  const status=await analysisRequest('/api/v4/simples-documents/'+encodeURIComponent(documentId)+'/status',{signal});
  if(status.documentId!==documentId||status.clientId!==clientId)throw new Error('O PDF armazenado não corresponde à empresa desta análise.');
  return status;
}

async function processDocument(urls,context) {
  if(urls.documentId!==context.documentId||!uuid(urls.attemptId))throw new Error('Não foi possível confirmar o documento preparado para a leitura.');
  const data=await analysisRequest('/api/simples?'+new URLSearchParams({clientId:context.clientId}),{
    method:'POST',signal:context.signal,body:{documentId:urls.documentId,attemptId:urls.attemptId,
      originalGetUrl:urls.originalGetUrl,searchablePutUrl:urls.searchablePutUrl}});
  return validateExtraction(data,context);
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
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  if(signal?.aborted)throw new DOMException('Operação cancelada.','AbortError');
  await onStored(started.documentId);
  onProgress('PDF armazenado. Lendo a seção 2.2 do Simples…');
  try {return await processDocument(started,{clientId,cnpj,documentId:started.documentId,signal});}
  catch(error){error.documentId=started.documentId;throw error;}
}

export async function retryAnalysisExtraction({clientId,documentId,cnpj,signal,onProgress=()=>{}}) {
  if(!uuid(clientId)||!uuid(documentId))throw new Error('Selecione o documento desta empresa para tentar a leitura novamente.');
  onProgress('Preparando uma nova leitura do PDF armazenado…');
  const urls=await analysisRequest('/api/v4/simples-documents/'+encodeURIComponent(documentId)+'/process-urls',{method:'POST',body:{},signal});
  onProgress('Lendo novamente a seção 2.2 do Simples…');
  return processDocument(urls,{clientId,documentId,cnpj,signal});
}
