import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeFinancialDocument,isReadyToFinalize} from '../public/purchase-finalization.js';
const job={_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',clientId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',generationId:'cccccccc-cccc-4ccc-cccc-cccccccccccc',mode:'SALES_V1',status:'UPLOADING',expectedRows:3000,uploaded:3000};
const noWait=async()=>{};
test('Finalização retoma as partes do mesmo documento sem novo envio',async()=>{
 const paths=[],progress=[],saved=[];let waits=0;
 const responses=[{...job,finalization:{phase:'COPYING',copiedRows:1000}},{...job,finalization:{phase:'COPYING',copiedRows:2000}},{...job,status:'PROCESSING',summary:{lines:3000}}];
 const result=await finalizeFinancialDocument(job,{request:async(path,method,body)=>{paths.push(path);assert.equal(method,'POST');assert.deepEqual(body,{});return responses.shift();},onProgress:s=>progress.push(s),onJob:j=>saved.push(j),wait:async()=>{waits++;}});
 assert.equal(result.status,'PROCESSING');assert.equal(new Set(paths).size,1);assert.equal(saved.length,3);assert(progress.some(s=>s.includes('2.000')));
 assert.equal(waits,0,'Respostas com progresso continuam sem espera artificial.');
});
test('Timeout transitório repete somente a finalização, e limite de armazenamento não entra em retry',async()=>{
 let calls=0;const error=Object.assign(new Error('Tempo excedido'),{code:'DATABASE_TIMEOUT',retryable:true});
 const result=await finalizeFinancialDocument(job,{request:async()=>{if(++calls===1)throw error;return {...job,status:'COMPLETED'};},wait:noWait});
 assert.equal(result.status,'COMPLETED');assert.equal(calls,2);
 calls=0;await assert.rejects(finalizeFinancialDocument(job,{request:async()=>{calls++;throw Object.assign(new Error('Limite'),{code:'DATABASE_STORAGE_LIMIT',retryable:false});},wait:noWait}),/Limite/);assert.equal(calls,1);
});
test('Finalização rejeita resposta de outra empresa ou geração',async()=>{
 for(const change of [{clientId:'outro'},{generationId:'outra'},{mode:'PURCHASES_V1'},{_id:'outro'}])await assert.rejects(finalizeFinancialDocument(job,{request:async()=>({...job,...change,status:'COMPLETED'}),wait:noWait}),/não corresponde/);
});
test('Somente um envio completo retoma sem selecionar o arquivo',async()=>{
 assert.equal(isReadyToFinalize(job),true);assert.equal(isReadyToFinalize({...job,uploaded:2999}),false);assert.equal(isReadyToFinalize({...job,status:'COMPLETED'}),false);
 let called=false;await assert.rejects(finalizeFinancialDocument({...job,uploaded:2999},{request:async()=>{called=true;},wait:noWait}),/faltam linhas/);assert.equal(called,false);
});
test('Retry e ausência de avanço têm limites e preservam o erro real',async()=>{
 let calls=0;await assert.rejects(finalizeFinancialDocument(job,{request:async()=>{calls++;throw Object.assign(new Error('Indisponível'),{code:'DATABASE_UNAVAILABLE',retryable:true});},wait:noWait}),/Indisponível/);assert.equal(calls,4);
 calls=0;await assert.rejects(finalizeFinancialDocument(job,{request:async()=>{calls++;return {...job,finalization:{phase:'COPY',copiedRows:1000}};},wait:noWait}),/não avançou/);assert.equal(calls,4);
});
