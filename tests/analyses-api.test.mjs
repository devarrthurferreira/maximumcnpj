import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisRequest,safeAnalysisRequestId} from '../public/analyses-api.js';

const clientId='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const reading='/api/simples?clientId='+clientId;
const document='/api/v4/simples-documents/'+documentId;
function clock(t){
  const timers=[];
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const timer={callback,delay,cleared:false};timers.push(timer);return timer;});
  t.mock.method(globalThis,'clearTimeout',timer=>{if(timer)timer.cleared=true;});
  return timers;
}

test('somente POST de leitura recebe 285 s; consultas, preparação e PATCH mantêm 55 s',async t=>{
  const timers=clock(t),calls=[];
  t.mock.method(globalThis,'fetch',async(path,options)=>{calls.push({path,options});return Response.json({confirmed:true});});
  for(const [path,method,expected] of [[reading,'POST',285000],[reading,'post',285000],[reading,'GET',55000],
    ['/api/v4/simples-documents','POST',55000],[document+'/process-urls','POST',55000],
    [document+'/status','GET',55000],['/api/v4/analyses/'+clientId+'/fiscal','PATCH',55000],['/api/simples-other','POST',55000]]){
    const body=method==='GET'?undefined:{documentId};
    assert.deepEqual(await analysisRequest(path,{method,body}),{confirmed:true});
    assert.equal(timers.at(-1).delay,expected,path+' '+method);
    assert.equal(timers.at(-1).cleared,true);
    assert.equal(calls.at(-1).options.credentials,'same-origin');
    assert.equal(calls.at(-1).options.body,body===undefined?undefined:JSON.stringify(body));
  }
  assert.equal(calls.length,8,'O transporte não repete mutações nem consultas globalmente.');
});

test('falha não JSON da função mostra contexto, código seguro e nenhuma URL ou HTML',async t=>{
  const body='<html>FUNCTION_INVOCATION_FAILED https://private.invalid/?vercel-blob-signature=secret</html>';
  t.mock.method(globalThis,'fetch',async()=>new Response(body,{status:500,headers:{
    'Content-Type':'text/html','X-Request-Id':'https://private.invalid/secret','X-Vercel-Id':'gru1::iad1::safe-12345'}}));
  await assert.rejects(()=>analysisRequest(reading,{method:'POST',body:{documentId}}),error=>{
    assert.match(error.message,/serviço de leitura do RBT12/);
    assert.match(error.message,/Verificar leitura/);
    assert.match(error.message,/Código da requisição: gru1::iad1::safe-12345/);
    assert.doesNotMatch(error.message,/<html>|https:|signature|secret|FUNCTION_INVOCATION_FAILED/);
    assert.equal(error.code,'FUNCTION_INVOCATION_FAILED');assert.equal(error.requestId,'gru1::iad1::safe-12345');
    assert.equal(error.retryable,true);assert.equal(error.responseUnconfirmed,true);assert.equal(error.invocationNotConfirmed,true);
    return true;
  });
});

test('mensagens JSON da aplicação e bloqueios de sessão continuam explícitos',async t=>{
  let status=422,payload={error:'RBT12_COMPANY',message:'O CNPJ básico do extrato não corresponde à empresa.',requestId,retryable:false};
  t.mock.method(globalThis,'fetch',async()=>Response.json(payload,{status}));
  await assert.rejects(()=>analysisRequest(reading,{method:'POST'}),error=>{
    assert.equal(error.message,payload.message);assert.equal(error.code,'RBT12_COMPANY');assert.equal(error.retryable,false);
    assert.equal(error.responseUnconfirmed,false);assert.equal(error.invocationNotConfirmed,false);return true;
  });
  status=503;payload={...payload,error:'BLOB_WRITE',message:'A leitura terminou, mas o PDF pesquisável não pôde ser armazenado.'};
  await assert.rejects(()=>analysisRequest(reading,{method:'POST'}),error=>{
    assert.equal(error.message,payload.message+' Código da requisição: '+requestId+'.');
    assert.equal(error.invocationNotConfirmed,false);assert.equal(error.retryable,false);return true;
  });
  status=401;payload={error:'UNAUTHORIZED',message:'Acesso não autorizado.'};
  await assert.rejects(()=>analysisRequest(reading),error=>{
    assert.match(error.message,/Sua sessão expirou/);assert.equal(error.responseUnconfirmed,false);return true;
  });
});

test('504, preparação e consulta do documento recebem orientação própria sem corpo bruto',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('FUNCTION_INVOCATION_TIMEOUT internal details',{status:504,
    headers:{'X-Request-Id':requestId,'Content-Type':'text/plain'}}));
  for(const [path,message] of [[reading,/excedeu o tempo/],['/api/v4/simples-documents',/preparar o envio do extrato RBT12/],
    [document+'/process-urls',/preparar uma nova leitura do RBT12/],[document+'/status',/conferir o estado da leitura do RBT12/]]){
    await assert.rejects(()=>analysisRequest(path,{method:path.endsWith('/status')?'GET':'POST'}),error=>{
      assert.match(error.message,message);assert.doesNotMatch(error.message,/internal details|FUNCTION_INVOCATION_TIMEOUT/);
      assert.equal(error.requestId,requestId);assert.equal(error.invocationNotConfirmed,false);return true;
    });
  }
});

test('limite interno gera pendência recuperável e cancelamento externo não vira timeout',async t=>{
  const timers=clock(t);
  t.mock.method(globalThis,'fetch',async(_path,{signal})=>{timers.at(-1).callback();signal.throwIfAborted();});
  await assert.rejects(()=>analysisRequest(reading,{method:'POST'}),error=>{
    assert.match(error.message,/Nenhuma RBT12 foi confirmada/);assert.equal(error.code,'NETWORK_TIMEOUT');
    assert.equal(error.responseUnconfirmed,true);assert.equal(timers.at(-1).delay,285000);return true;
  });
  const cancel=new AbortController();cancel.abort();
  await assert.rejects(()=>analysisRequest(reading,{signal:cancel.signal}),error=>error.name==='AbortError'&&error.code!=='NETWORK_TIMEOUT');
  assert.equal(timers.every(timer=>timer.cleared),true);
});

test('rede interrompida ou resposta inválida não confirmam a RBT12 nem expõem detalhes internos',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed https://private.invalid/?signature=secret');});
  await assert.rejects(()=>analysisRequest(reading),error=>{
    assert.equal(error.code,'NETWORK_ERROR');assert.equal(error.responseUnconfirmed,true);assert.match(error.message,/RBT12/);
    assert.doesNotMatch(error.message,/private|secret/);return true;
  });
  fetch.mock.mockImplementation(async()=>new Response('<html>Resposta indevida</html>',{status:200}));
  await assert.rejects(()=>analysisRequest(reading),error=>{
    assert.equal(error.code,'RESPONSE_INVALID');assert.equal(error.responseUnconfirmed,true);
    assert.doesNotMatch(error.message,/<html>|Resposta indevida/);return true;
  });
});

test('identificadores de diagnóstico aceitam somente UUID ou identificador restrito da plataforma',()=>{
  assert.equal(safeAnalysisRequestId(requestId),requestId);
  assert.equal(safeAnalysisRequestId('gru1::iad1::token-123'), 'gru1::iad1::token-123');
  for(const invalid of [null,{},'', '<svg/onload=1>', 'https://example.test/key', 'Bearer secret', 'x'.repeat(300), 'iad1::x\nsecret']){
    assert.equal(safeAnalysisRequestId(invalid),null);
  }
});
