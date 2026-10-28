import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDrePdfRequest,fetchDrePdf} from '../public/simulator-dre-download.js';

const simulationId='aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const pdf='%PDF-1.7\n% synthetic fixture\n%%EOF';
const response=(body=pdf,headers={})=>new Response(body,{headers:{'Content-Type':'application/pdf',...headers}});

test('pedido de PDF envia somente a referência salva e opções, nunca os valores da DRE',()=>{
  const payload=buildDrePdfRequest({simulationId,period:'monthly',regimeId:'actual',showPercent:true,
    result:{revenue:999999},company:{name:'nome do navegador'},snapshot:{result:{tampered:true}}});
  assert.deepEqual(payload,{action:'dre-pdf',simulationId,period:'monthly',regimeId:'actual',showPercent:true});
  assert.deepEqual(buildDrePdfRequest({simulationId}),{action:'dre-pdf',simulationId,period:'complete',showPercent:false});
  for(const value of [{},{simulationId:'../empresa'},{simulationId,period:'selected'},{simulationId,regimeId:'all'},{simulationId,showPercent:1}])assert.throws(()=>buildDrePdfRequest(value));
});

test('download autenticado preserva bytes, nome do servidor e sinal de cancelamento',async()=>{
  const controller=new AbortController();let request;
  const result=await fetchDrePdf({simulationId,period:'annual',showPercent:true},{signal:controller.signal,fetchImpl:async(url,options)=>{
    request={url,options};return response(pdf,{'Content-Disposition':'attachment; filename="dre-123-saved-annual.pdf"','X-Report-Engine':'python'});
  }});
  assert.equal(request.url,'/api/reports');assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'same-origin');
  assert.equal(request.options.signal,controller.signal);assert.equal(request.options.headers.Accept,'application/pdf');
  assert.deepEqual(JSON.parse(request.options.body),{action:'dre-pdf',simulationId,period:'annual',showPercent:true});
  assert.equal(result.filename,'dre-123-saved-annual.pdf');assert.equal(await result.blob.text(),pdf);
});

test('erro do relatório mantém a mensagem e o código de atendimento para permitir nova tentativa',async()=>{
  await assert.rejects(()=>fetchDrePdf({simulationId},{fetchImpl:async()=>new Response(JSON.stringify({message:'A versão salva foi excluída.',requestId:'abc-123'}),{status:404,headers:{'Content-Type':'application/json'}})}),/A versão salva foi excluída\. Código: abc-123\./);
  await assert.rejects(()=>fetchDrePdf({simulationId},{fetchImpl:async()=>new Response('indisponível',{status:503})}),/Não foi possível gerar o PDF/);
});

test('resposta HTML, arquivo inválido, vazio ou acima do limite nunca vira download PDF',async()=>{
  for(const invalid of [
    ()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),
    ()=>response('{"error":"UNAUTHORIZED"}'),()=>response(''),
    ()=>response('%PDF-'+ '0'.repeat(4_000_000))
  ])await assert.rejects(()=>fetchDrePdf({simulationId},{fetchImpl:async()=>invalid()}),/PDF/);
});

test('nome de download não aceita caminhos, caracteres de controle ou extensão executável',async()=>{
  for(const name of ['../secrets.pdf','C:\\temp\\dre.pdf','dre.pdf.exe','..pdf']){
    const result=await fetchDrePdf({simulationId},{fetchImpl:async()=>response(pdf,{'Content-Disposition':`attachment; filename="${name}"`})});
    assert.equal(result.filename,`dre-${simulationId}-complete.pdf`);
  }
  const missing=await fetchDrePdf({simulationId},{fetchImpl:async()=>response()});
  assert.equal(missing.filename,`dre-${simulationId}-complete.pdf`);
});

test('cancelamento e falha de rede são propagados sem produzir arquivo',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>fetchDrePdf({simulationId},{signal:controller.signal,fetchImpl:async(_url,options)=>{
    options.signal.throwIfAborted();return response();
  }}),error=>error.name==='AbortError');
  await assert.rejects(()=>fetchDrePdf({simulationId},{fetchImpl:async()=>{throw new TypeError('Falha de rede');}}),/Falha de rede/);
});
