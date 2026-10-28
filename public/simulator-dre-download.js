/** Download a report from the saved server snapshot; browser totals are never sent. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PERIODS = new Set(['complete','annual','monthly']);
const REGIMES = new Set(['pure','hybrid','presumed','actual']);
const MAX_PDF_BYTES = 4_000_000;

export function buildDrePdfRequest({simulationId,period='complete',regimeId,showPercent=false}={}) {
  if(typeof simulationId!=='string'||!UUID.test(simulationId))throw new Error('Abra uma versão salva da simulação para baixar o PDF.');
  if(!PERIODS.has(period)||typeof showPercent!=='boolean'||(regimeId!=null&&!REGIMES.has(regimeId)))throw new Error('Confira as opções do relatório e tente novamente.');
  return {action:'dre-pdf',simulationId,period,...(regimeId?{regimeId}:{}),showPercent};
}

function safeFilename(disposition,fallback) {
  const value=disposition?.match(/(?:^|;)\s*filename="([^"]+)"/i)?.[1];
  return typeof value==='string'&&/^[a-z0-9][a-z0-9_.-]{0,200}\.pdf$/i.test(value)&&!value.includes('..')?value:fallback;
}

export async function fetchDrePdf(options,{fetchImpl=globalThis.fetch,signal}={}) {
  const payload=buildDrePdfRequest(options);
  const response=await fetchImpl('/api/reports',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json',Accept:'application/pdf'},body:JSON.stringify(payload),signal});
  if(!response.ok){
    const data=await response.json().catch(()=>null);
    const message=typeof data?.message==='string'?data.message:'Não foi possível gerar o PDF. Tente novamente.';
    const requestId=typeof data?.requestId==='string'&&/^[a-z0-9-]{1,60}$/i.test(data.requestId)?` Código: ${data.requestId}.`:'';
    throw new Error(message+requestId);
  }
  if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/pdf')throw new Error('O servidor não retornou um PDF válido. Tente novamente.');
  const blob=await response.blob();
  if(!blob.size||blob.size>MAX_PDF_BYTES)throw new Error('O PDF retornado está vazio ou ultrapassa o limite do relatório. Tente novamente.');
  const signature=new TextDecoder('ascii').decode(await blob.slice(0,5).arrayBuffer());
  if(signature!=='%PDF-')throw new Error('O arquivo retornado não é um PDF válido. Tente novamente.');
  return {blob,filename:safeFilename(response.headers.get('Content-Disposition'),`dre-${payload.simulationId}-${payload.period}.pdf`)};
}
