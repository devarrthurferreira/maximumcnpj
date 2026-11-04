/** Shared transport for the analysis workspace and the existing PDF reader. */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const VERCEL_ID=/^[a-z0-9-]{2,24}::[a-z0-9:_-]{1,160}$/i;
const PLATFORM_ERRORS=['FUNCTION_INVOCATION_FAILED','FUNCTION_INVOCATION_TIMEOUT','FUNCTION_THROTTLED'];

export function safeAnalysisRequestId(value) {
  return typeof value==='string'&&(UUID.test(value)||VERCEL_ID.test(value))?value:null;
}

function responseRequestId(response,data) {
  return [data?.requestId,response.headers.get('X-Request-Id'),response.headers.get('X-Vercel-Id')]
    .map(safeAnalysisRequestId).find(Boolean)||null;
}

function simplesFailure(status,processing) {
  if(status===504)return 'O serviço de leitura do RBT12 excedeu o tempo de resposta. Use Verificar leitura para conferir o PDF armazenado antes de tentar novamente.';
  return processing?'O serviço de leitura do RBT12 não confirmou a resposta. Use Verificar leitura para conferir o PDF armazenado e retomar.':
    'Não foi possível recuperar a leitura do RBT12. Confira o PDF vinculado em Verificar leitura ou tente novamente.';
}

function documentFailure(path) {
  if(path.endsWith('/status'))return 'Não foi possível conferir o estado da leitura do RBT12. Tente Verificar leitura novamente antes de reprocessar.';
  if(path.endsWith('/process-urls'))return 'Não foi possível preparar uma nova leitura do RBT12. Confira o PDF vinculado e tente novamente.';
  return 'Não foi possível preparar o envio do extrato RBT12. Tente adicionar o PDF novamente.';
}

export async function analysisRequest(path, {method='GET', body, signal}={}) {
  const pathname=path.split('?')[0],simples=pathname==='/api/simples',documents=/^\/api\/v4\/simples-documents(?:\/|$)/.test(pathname);
  const pdf=simples||documents,processing=simples&&method.toUpperCase()==='POST';
  // Reading/OCR has a 300 s server budget. Other analysis operations keep their
  // existing deadline; a slow PDF must not abort after the ordinary 55 s limit.
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),processing?285000:55000);
  const cancel=()=>controller.abort();
  if(signal?.aborted)controller.abort();
  else signal?.addEventListener('abort',cancel,{once:true});
  try {
    controller.signal.throwIfAborted();
    const response=await fetch(path,{method,credentials:'same-origin',signal:controller.signal,
      ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const text=await response.text();
    controller.signal.throwIfAborted();
    let data=null;try{data=JSON.parse(text);}catch{}
    const message=typeof data?.message==='string'&&data.message.trim()?data.message:null;
    // Only recognize known platform codes. Never display its HTML/plain-text
    // response, which may contain internal details or delegated storage URLs.
    const platform=PLATFORM_ERRORS.find(code=>response.headers.get('X-Vercel-Error')===code||text.slice(0,8192).includes(code));
    const requestId=responseRequestId(response,data);
    if(!response.ok){
      const error=new Error(response.status===401?'Sua sessão expirou. Entre novamente para continuar.':
        message||(simples?simplesFailure(response.status,processing):documents?documentFailure(pathname):'Não foi possível concluir esta operação. Tente novamente.'));
      error.status=response.status;error.code=typeof data?.error==='string'?data.error:platform||(pdf?'SIMPLES_RESPONSE_UNAVAILABLE':undefined);
      error.details=data;error.retryable=typeof data?.retryable==='boolean'?data.retryable:response.status>=500||response.status===408||response.status===429;
      error.requestId=requestId;error.responseUnconfirmed=pdf&&(response.status>=500||response.status===408);
      error.invocationNotConfirmed=processing&&!message&&(platform==='FUNCTION_INVOCATION_FAILED'||response.status===502);
      if(response.status>=500&&requestId)error.message+=' Código da requisição: '+requestId+'.';
      throw error;
    }
    if(!data||typeof data!=='object')throw Object.assign(new Error(simples?simplesFailure(response.status,processing):documents?documentFailure(pathname):
      'A resposta não foi confirmada. Atualize a análise para conferir o trabalho salvo.'),
      {code:'RESPONSE_INVALID',retryable:true,responseUnconfirmed:pdf,requestId});
    return data;
  } catch(error) {
    if(signal?.aborted)throw new DOMException('Operação cancelada.','AbortError');
    if(error.name==='AbortError')throw Object.assign(new Error(processing?
      'A leitura do PDF demorou a responder. Nenhuma RBT12 foi confirmada nesta tela. Use Verificar leitura antes de reprocessar.':
      documents?documentFailure(pathname):'A resposta demorou mais que o esperado. O trabalho já salvo será preservado.'),
      {code:'NETWORK_TIMEOUT',retryable:true,responseUnconfirmed:pdf});
    if(pdf&&error instanceof TypeError)throw Object.assign(new Error(documents?documentFailure(pathname):
      'A conexão com o serviço de RBT12 foi interrompida. Use Verificar leitura para conferir o PDF armazenado antes de tentar novamente.'),
      {code:'NETWORK_ERROR',retryable:true,responseUnconfirmed:true});
    throw error;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  }
}
