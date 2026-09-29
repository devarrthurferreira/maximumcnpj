import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPurchaseLine, exactCents, percentage, purchaseCsv, MAX_LINE_CENTS } from '../src/purchase-domain.ts';

const row = {document: '00.000.000/0001-91', name: 'Fornecedor sintético', quantity: '020.500000', totalCents: 1050};
test('Compras: valida quatro campos no servidor, centavos exatos e não multiplica P por Q', () => {
  const value = compactPurchaseLine({...row, status: 'OPTANTE', rawWorkbook: 'discard'});
  assert.equal(value.document, '00000000000191'); assert.equal(value.cnpj, '00000000000191'); assert.equal(value.documentKind, 'CNPJ');
  assert.equal(value.quantity, '20.5'); assert.equal(value.totalCents, 1050); assert.equal(value.valid, true);
  assert(!('status' in value)); assert(!('rawWorkbook' in value));
  for (const totalCents of [1.5, -1, '100', null, NaN, Infinity, MAX_LINE_CENTS + 1]) assert.throws(() => compactPurchaseLine({...row, totalCents}));
  for (const quantity of ['1,5', '-1', '1.0000001', '1e3', '', 1, null]) assert.throws(() => compactPurchaseLine({...row, quantity}));
  assert.throws(() => compactPurchaseLine({...row, name: ''}));
  assert.throws(() => compactPurchaseLine({...row, document: 123}));
});
test('Compras: CPF, inválido e ausência preservam valor sem virarem CNPJ ou negativa fiscal', () => {
  for (const [document, kind] of [['123.456.789-00', 'CPF'], ['', 'AUSENTE'], ['123', 'INVALIDO']]) {
    const value = compactPurchaseLine({...row, document});
    assert.equal(value.valid, false); assert.equal(value.cnpj, ''); assert.equal(value.documentKind, kind); assert.equal(value.totalCents, 1050);
  }
  assert.equal(percentage(10010, 40000), 25.03); assert.equal(percentage(0, 0), 0);
  assert.throws(() => exactCents(Number.MAX_SAFE_INTEGER + 1)); assert.throws(() => exactCents(-1));
});
test('Compras: CSV preserva P e Q e neutraliza fórmula', () => {
  const csv = purchaseCsv({_id:'test',clientCode:'1',clientName:'Empresa',fileName:'arquivo.csv'}, [{...compactPurchaseLine({...row,name:'=DDE()'}),index:0,status:'OPTANTE'}]);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes('"20.5";"10,50"')); assert(csv.includes("'"+'=DDE()'));
  assert(!csv.includes('215,25'));
});
