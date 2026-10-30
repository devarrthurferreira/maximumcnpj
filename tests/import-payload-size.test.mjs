import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePayloadBytes} from '../public/import-payload-size.js';

test('Medição do payload conta JSON ASCII e um byte por linha', () => {
  assert.equal(estimatePayloadBytes([{a:1}]), 8);
  assert.equal(estimatePayloadBytes([{a:1},{b:'xy'}]), 19);
  assert.equal(estimatePayloadBytes([{}]), 3);
});

test('Medição usa UTF-8 para descrição Unicode de 2000 caracteres', () => {
  const row={description:'界'.repeat(2000)};
  assert.equal(estimatePayloadBytes([row]), 6019);
  assert.equal(estimatePayloadBytes([{text:'ação 😀'}]), Buffer.byteLength(JSON.stringify({text:'ação 😀'}),'utf8')+1);
  assert(estimatePayloadBytes([row])>JSON.stringify(row).length*2);
});

test('Dividir o arquivo em grupos preserva a soma exata medida pelo servidor', () => {
  const rows=Array.from({length:503},(_,index)=>({document:String(index),name:index%2?'Empresa brasileira':'Empresa 日本',amount:index}));
  const grouped=[rows.slice(0,250),rows.slice(250,500),rows.slice(500)];
  assert.equal(estimatePayloadBytes(rows),grouped.reduce((total,group)=>total+estimatePayloadBytes(group),0));
  assert.equal(estimatePayloadBytes(rows),rows.reduce((total,row)=>total+Buffer.byteLength(JSON.stringify(row),'utf8')+1,0));
});

test('Lista vazia mede zero e entradas inválidas não recebem um tamanho fictício', () => {
  assert.equal(estimatePayloadBytes([]),0);
  for(const value of [null,undefined,{},'rows',1,[null],[undefined],[[]],['row'],[1],[true],new Array(1),[{toJSON:()=>undefined}], [new Date(0)]]){
    assert.throws(()=>estimatePayloadBytes(value),TypeError);
  }
  const circular={};circular.self=circular;
  assert.throws(()=>estimatePayloadBytes([circular]),TypeError);
});

test('Medição conserva linhas, propriedades e referências originais', () => {
  const nested=Object.freeze({label:'histórico'});
  const row=Object.freeze({name:'Empresa',metadata:nested,ignored:undefined});
  const rows=Object.freeze([row]),before=JSON.stringify(rows);
  const expected=Buffer.byteLength(JSON.stringify(row),'utf8')+1;
  assert.equal(estimatePayloadBytes(rows),expected);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(rows[0],row);assert.equal(row.metadata,nested);
  assert(Object.hasOwn(row,'ignored'));
});
