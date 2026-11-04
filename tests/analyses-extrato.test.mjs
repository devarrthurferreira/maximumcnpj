import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisDocumentReadingMessage,loadAnalysisExtraction,retryAnalysisExtraction,uploadAnalysisExtraction} from '../public/analyses-extrato.js';
import {section22} from './fixtures/section22.ts';

const clientId='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';
const attemptId='33333333-3333-4333-8333-333333333333';
const extractionId='44444444-4444-4444-8444-444444444444';
const otherId='55555555-5555-4555-8555-555555555555';
const requestId='66666666-6666-4666-8666-666666666666';
const context={clientId,documentId,cnpj:'12345678000190'};
const urls={documentId,attemptId,originalPutUrl:'https://vercel.com/api/blob/?pathname=synthetic-original',
  originalGetUrl:'https://synthetic.private.blob.vercel-storage.com/original.pdf?synthetic=1',
  searchablePutUrl:'https://vercel.com/api/blob/?pathname=synthetic-searchable'};
const reference=()=>({extractionId,clientId,documentId,fileName:'extrato-sintetico.pdf',originalStored:true,searchableStored:true,...section22()});
const ready=()=>({documentId,clientId,status:'READY',attemptId,attempts:1,extractionId,hasReadyExtraction:true,originalStored:true,retryable:true,error:null});
const awaiting=()=>({documentId,clientId,status:'AWAITING_UPLOAD',attemptId:null,attempts:0,extractionId:null,hasReadyExtraction:false,originalStored:false,retryable:true,error:null});
const failure=(status=500,code='FUNCTION_INVOCATION_FAILED')=>new Response(code+'\nInternal diagnostics must remain hidden',{status,
  headers:{'Content-Type':'text/plain','X-Request-Id':requestId}});
function transport(t,{process=()=>Response.json(reference()),status=()=>Response.json(ready()),read=()=>Response.json(reference())}={}){
  const counts={tickets:0,uploads:0,processUrls:0,posts:[],statuses:0,reads:0};
  t.mock.method(globalThis,'fetch',async(path,options={})=>{
    const url=new URL(path,'https://maximum.test'),method=(options.method||'GET').toUpperCase();
    options.signal?.throwIfAborted();
    if(path===urls.originalPutUrl){assert.equal(method,'PUT');counts.uploads++;return new Response('',{status:200});}
    if(url.pathname==='/api/v4/simples-documents'&&method==='POST'){
      counts.tickets++;assert.equal(JSON.parse(options.body).clientId,clientId);return Response.json(urls);
    }
    if(url.pathname===`/api/v4/simples-documents/${documentId}/process-urls`){
      assert.equal(method,'POST');counts.processUrls++;return Response.json(urls);
    }
    if(url.pathname===`/api/v4/simples-documents/${documentId}/status`){
      assert.equal(method,'GET');counts.statuses++;return status({counts,options});
    }
    if(url.pathname==='/api/simples'){
      assert.equal(url.searchParams.get('clientId'),clientId);
      if(method==='POST'){
        counts.posts.push(JSON.parse(options.body));return process({counts,options});
      }
      assert.equal(method,'GET');assert.equal(url.searchParams.get('extractionId'),extractionId);
      counts.reads++;return read({counts,options});
    }
    throw new Error('Unexpected synthetic request: '+method+' '+url.pathname);
  });
  return counts;
}
const file=()=>new File(['%PDF-synthetic-transport-only'],'extrato-sintetico.pdf',{type:'application/pdf'});
const upload=options=>uploadAnalysisExtraction({...context,file:file(),...options});

test('leitura normal armazena primeiro e confirma uma única extração sem consulta extra',async t=>{
  let stored=false;const progress=[];
  const counts=transport(t,{process:()=>{assert.equal(stored,true);return Response.json(reference());}});
  const result=await upload({onStored:async id=>{assert.equal(id,documentId);stored=true;},onProgress:message=>progress.push(message)});
  assert.equal(result.extractionId,extractionId);assert.equal(result.rbt12Cents,15_000_000);
  assert.deepEqual(counts,{tickets:1,uploads:1,processUrls:0,posts:[{documentId,attemptId,
    originalGetUrl:urls.originalGetUrl,searchablePutUrl:urls.searchablePutUrl}],statuses:0,reads:0});
  assert.match(progress.at(-1),/Lendo a seção 2.2/);
});

test('resposta POST perdida recupera READY da mesma tentativa; GET transitório repete sem novo OCR',async t=>{
  const counts=transport(t,{process:()=>failure(),read:({counts})=>counts.reads===1?failure():Response.json(reference())});
  const result=await upload();
  assert.equal(result.rbt12Cents,15_000_000);assert.equal(result.documentId,documentId);
  assert.equal(counts.tickets,1);assert.equal(counts.uploads,1);assert.equal(counts.posts.length,1);
  assert.equal(counts.statuses,1);assert.equal(counts.reads,2);assert.equal(counts.processUrls,0);
});

test('invocação indisponível repete uma vez o mesmo ticket somente quando nunca houve OCR',async t=>{
  const counts=transport(t,{process:({counts})=>counts.posts.length===1?failure(502):Response.json(reference()),
    status:()=>Response.json(awaiting())});
  const result=await upload();
  assert.equal(result.extractionId,extractionId);assert.equal(counts.posts.length,2);
  assert.deepEqual(counts.posts[1],counts.posts[0]);assert.equal(counts.statuses,1);
  assert.equal(counts.tickets,1);assert.equal(counts.uploads,1);assert.equal(counts.processUrls,0);assert.equal(counts.reads,0);
});

test('segunda invocação indisponível encerra sem repetir indefinidamente ou criar outro ticket',async t=>{
  const counts=transport(t,{process:()=>failure(),status:()=>Response.json(awaiting())});
  await assert.rejects(()=>upload(),error=>{
    assert.match(error.message,/serviço de leitura do RBT12/);assert.equal(error.requestId,requestId);return true;
  });
  assert.equal(counts.posts.length,2);assert.equal(counts.statuses,2);assert.equal(counts.tickets,1);assert.equal(counts.uploads,1);
});

for(const [name,status] of [
  ['em andamento',{...ready(),status:'PROCESSING',extractionId:null,hasReadyExtraction:false,retryable:false}],
  ['READY anterior',{...ready(),attemptId:otherId}],
  ['sem identificação de tentativa',{...ready(),attemptId:null}],
  ['falha com extração antiga',{...ready(),status:'OCR_FAILED',attemptId:otherId,error:{code:'SIMPLES_PDF',message:'A seção 2.2 ficou incompleta.'}}],
  ['READY com falha posterior',{...ready(),lastError:{message:'A última tentativa foi interrompida.'}}],
  ['documento novo sem prova de ausência de OCR',{...awaiting(),attempts:undefined}],
  ['extração sem confirmação completa',{...ready(),hasReadyExtraction:false}],
])test(`recuperação não reaplica valor nem duplica OCR quando estado é ${name}`,async t=>{
  const counts=transport(t,{process:()=>failure(),status:()=>Response.json(status)});
  await assert.rejects(()=>upload(),error=>{
    assert.equal(error.documentId,documentId);assert.deepEqual(error.documentStatus,JSON.parse(JSON.stringify(status)));
    if(status.status==='PROCESSING')assert.match(error.message,/ainda está em andamento/);
    if(status.error)assert.match(error.message,/seção 2.2 ficou incompleta/);
    return true;
  });
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,0);assert.equal(counts.processUrls,0);
});

test('timeout longo consulta estado mas não repete a invocação, ainda que não iniciada',async t=>{
  const timers=[];let processingDeadline;
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;});
  t.mock.method(globalThis,'clearTimeout',()=>{});
  const counts=transport(t,{process:({options})=>{
    processingDeadline=timers.at(-1).delay;timers.at(-1).callback();options.signal.throwIfAborted();
  },status:()=>Response.json(awaiting())});
  await assert.rejects(()=>upload(),error=>error.code==='NETWORK_TIMEOUT'&&/Verificar leitura/.test(error.message));
  assert.equal(processingDeadline,285000);assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,0);
});

test('falha da consulta de estado preserva diagnóstico original e nunca autoriza novo POST',async t=>{
  const counts=transport(t,{process:()=>failure(),status:()=>failure(502)});
  await assert.rejects(()=>upload(),error=>{
    assert.match(error.message,/serviço de leitura do RBT12/);assert.match(error.message,/Também não foi possível conferir o estado/);
    assert.match(error.message,new RegExp(requestId));assert.doesNotMatch(error.message,/Não foi possível concluir esta operação|Internal diagnostics/);
    assert.equal(error.requestId,requestId);return true;
  });
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,0);
});

for(const field of ['clientId','documentId'])test(`estado de outro ${field} é recusado sem repetir ou carregar extração`,async t=>{
  const counts=transport(t,{process:()=>failure(),status:()=>Response.json({...ready(),[field]:otherId})});
  await assert.rejects(()=>upload(),/não corresponde à empresa/);
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,0);
});

test('GET da extração repete somente uma falha transitória e preserva validações de origem e valores',async t=>{
  const counts=transport(t,{read:({counts})=>{if(counts.reads===1)throw new TypeError('Network error');return Response.json(reference());}});
  assert.equal((await loadAnalysisExtraction({...context,extractionId})).rbt12Cents,15_000_000);
  assert.equal(counts.reads,2);assert.equal(counts.posts.length,0);assert.equal(counts.statuses,0);
});

for(const [name,response] of [
  ['sessão',()=>Response.json({error:'UNAUTHORIZED',message:'Sessão expirada.'},{status:401})],
  ['validação fiscal',()=>Response.json({error:'RBT12_EXTRACTION',message:'Leia novamente o extrato.'},{status:409})],
  ['rejeição explícita sem repetição',()=>Response.json({error:'SIMPLES_PDF',message:'A conferência do documento falhou.',retryable:false},{status:503})],
  ['outra empresa',()=>Response.json({...reference(),clientId:otherId})],
  ['outro documento',()=>Response.json({...reference(),documentId:otherId})],
  ['outro CNPJ',()=>Response.json({...reference(),cnpjBasico:'87654321'})],
  ['valores inconsistentes',()=>Response.json({...reference(),rbt12Cents:1})],
])test(`GET da extração não repete falha de ${name}`,async t=>{
  const counts=transport(t,{read:response});
  await assert.rejects(()=>loadAnalysisExtraction({...context,extractionId}));
  assert.equal(counts.reads,1);assert.equal(counts.posts.length,0);
});

test('segunda falha transitória do GET permanece pendente após duas consultas',async t=>{
  const counts=transport(t,{read:()=>failure()});
  await assert.rejects(()=>loadAnalysisExtraction({...context,extractionId}),/recuperar a leitura do RBT12/);
  assert.equal(counts.reads,2);assert.equal(counts.posts.length,0);
});

test('cancelamento entre erro e recuperação interrompe consultas e não produz referência',async t=>{
  const cancel=new AbortController();
  const counts=transport(t,{process:()=>{cancel.abort();return failure();}});
  await assert.rejects(()=>upload({signal:cancel.signal}),error=>error.name==='AbortError');
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,0);assert.equal(counts.reads,0);
});

test('cancelamento durante status READY impede GET e aplicação tardia',async t=>{
  const cancel=new AbortController();
  const counts=transport(t,{process:()=>failure(),status:()=>{cancel.abort();return Response.json(ready());}});
  await assert.rejects(()=>upload({signal:cancel.signal}),error=>error.name==='AbortError');
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,0);
});

test('reprocessamento explícito prepara uma tentativa e recupera somente essa tentativa',async t=>{
  const counts=transport(t,{process:()=>failure()});
  const result=await retryAnalysisExtraction(context);
  assert.equal(result.extractionId,extractionId);assert.equal(counts.processUrls,1);
  assert.equal(counts.posts.length,1);assert.equal(counts.statuses,1);assert.equal(counts.reads,1);assert.equal(counts.uploads,0);assert.equal(counts.tickets,0);
});

test('mensagem de Verificar leitura preserva motivo salvo e referência anterior sem aplicá-la',()=>{
  const message=analysisDocumentReadingMessage({...ready(),status:'OCR_FAILED',
    error:{code:'SIMPLES_PDF',message:'A seção 2.2 está ilegível nesta página.',requestId}});
  assert.match(message,/seção 2.2 está ilegível/);assert.match(message,new RegExp(requestId));
  assert.match(message,/leitura anterior foi preservada e não foi aplicada/);assert.match(message,/sem reenviar/);
  assert.doesNotMatch(analysisDocumentReadingMessage({...awaiting(),error:{message:'PDF inválido.',requestId:'https://private.invalid/secret'}}),/private|secret/);
});
