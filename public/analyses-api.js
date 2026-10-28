/** Shared transport for the analysis workspace and the existing PDF reader. */
export async function analysisRequest(path, {method='GET', body, signal}={}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),55000);
  const cancel=()=>controller.abort();
  if(signal?.aborted)controller.abort();
  else signal?.addEventListener('abort',cancel,{once:true});
  try {
    const response=await fetch(path,{method,credentials:'same-origin',signal:controller.signal,
      ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(response.status===401?'Sua sessão expirou. Entre novamente para continuar.':
        data?.message||'Não foi possível concluir esta operação. Tente novamente.');
      error.status=response.status;error.code=data?.error;error.details=data;error.retryable=data?.retryable===true;error.requestId=data?.requestId;
      if(response.status>=500&&/^[a-f0-9-]{36}$/i.test(data?.requestId||''))error.message+=' Código da requisição: '+data.requestId+'.';
      throw error;
    }
    if(!data)throw new Error('A resposta não foi confirmada. Atualize a análise para conferir o trabalho salvo.');
    return data;
  } catch(error) {
    if(error.name==='AbortError'&&!signal?.aborted)throw Object.assign(new Error('A resposta demorou mais que o esperado. O trabalho já salvo será preservado.'),{code:'NETWORK_TIMEOUT',retryable:true});
    throw error;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  }
}
