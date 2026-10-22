import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {OPERATION_CATALOG_VERSION, OPERATION_CATALOG_GROUPS, OPERATION_CATALOG_SOURCE_ROWS,
  normalizeOperationNature, classifyOperationNature, isPurchaseOperation, isRevenueOperation} from '../src/operation-catalog.ts';

test('catálogo da coluna D conserva os 619 códigos sem sobreposição entre operações', () => {
  assert.equal(OPERATION_CATALOG_SOURCE_ROWS, 619);
  assert.deepEqual(Object.fromEntries(Object.entries(OPERATION_CATALOG_GROUPS).map(([key,codes])=>[key,codes.length])),
    {COMPRAS:108, VENDA:137, DEVOLUCAO_VENDA:45, DEVOLUCAO_COMPRA:39, OUTRAS:290});
  const entries=Object.entries(OPERATION_CATALOG_GROUPS).flatMap(([operation,codes])=>codes.map(code=>({code,operation})));
  assert.equal(new Set(entries.map(entry=>entry.code)).size,619);
  for(const {code,operation} of entries){
    assert.match(code,/^[1-7]\d{3}$/);
    assert.equal(classifyOperationNature(code+'002'),operation);
  }
});

test('catálogo separa compra, venda, devoluções e serviços sem inferir pelo texto da descrição', () => {
  for(const code of ['8000','8000002','8000102','8.000.102']){
    assert.equal(normalizeOperationNature(code),'8000');
    assert.equal(classifyOperationNature(code),'SERVICO_COMPRA');
    assert.equal(isPurchaseOperation(code),true);assert.equal(isRevenueOperation(code),false);
  }
  assert.equal(classifyOperationNature('900001'),'SERVICO_VENDA');
  assert.equal(isRevenueOperation('900001'),true);
  assert.equal(classifyOperationNature('1202001'),'DEVOLUCAO_VENDA');
  assert.equal(classifyOperationNature('5202001'),'DEVOLUCAO_COMPRA');
  assert.equal(isPurchaseOperation('1202001'),false);assert.equal(isRevenueOperation('5202001'),false);
  // These spreadsheet choices intentionally differ from inferring the description.
  assert.equal(classifyOperationNature('2214'),'OUTRAS');
  assert.equal(classifyOperationNature('6301'),'VENDA');
  assert.equal(classifyOperationNature('1933'),'COMPRAS');
  for(const value of ['',null,undefined,'9999','Venda de produto','123']){
    assert.equal(classifyOperationNature(value),'NAO_CLASSIFICADA');
    assert.equal(isRevenueOperation(value),false);assert.equal(isPurchaseOperation(value),false);
  }
});

test('relatórios Python e servidor/navegador usam exatamente o mesmo catálogo', () => {
  const source='import json; from reporting.operation_catalog import OPERATION_CATALOG_VERSION, OPERATION_CATALOG_GROUPS, classify_operation_nature; print(json.dumps({"version": OPERATION_CATALOG_VERSION, "groups": dict(OPERATION_CATALOG_GROUPS), "services": [classify_operation_nature("8000102"), classify_operation_nature("900001")]}))';
  const python=JSON.parse(execFileSync('python',['-c',source],{encoding:'utf8'}));
  assert.equal(python.version,OPERATION_CATALOG_VERSION);
  assert.deepEqual(python.groups,OPERATION_CATALOG_GROUPS);
  assert.deepEqual(python.services,['SERVICO_COMPRA','SERVICO_VENDA']);
});
