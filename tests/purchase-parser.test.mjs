import test from 'node:test';
import assert from 'node:assert/strict';
import {amountCents, decimal, decodePurchaseCsv, parsePurchaseMatrix} from '../public/purchase-parser.js';

const header = Array.from({length:17}, (_,i) => ['Documento','','','','','','','','Razão social','','','','','','','Quantidade','Valor Total'][i]);
const row = (document, name, quantity, total) => { const r = Array(17).fill(''); r[0] = document; r[8] = name; r[15] = quantity; r[16] = total; return r; };

test('purchase parser keeps cents exact and accepts Brazilian formatting or numeric Excel cells', () => {
  assert.equal(amountCents('1.234,56'), 123456);
  assert.equal(amountCents('R$ 10,05'), 1005);
  assert.equal(amountCents('1.000'), 100000);
  assert.equal(amountCents(0.29), 29);
  assert.equal(amountCents('0,00'), 0);
  assert.equal(decimal('001,250000', 6, 'Quantidade'), '1.25');
  assert.equal(decimal(12.345678, 6, 'Quantidade'), '12.345678');
  for (const value of ['', '-1', '1,999', 'abc', Number.POSITIVE_INFINITY, 1.005, '1000000000,01']) assert.throws(() => amountCents(value));
});

test('purchase preview deduplicates valid CNPJs without discarding any purchase value or multiplying P', () => {
  const report = parsePurchaseMatrix([header,
    row('11.222.333/0001-81','Fornecedor A','2','100,10'),
    row('11222333000181','Fornecedor A','7','20,20'),
    row('123.456.789-00','Pessoa exemplo','1','50,00'),
    Array(17).fill('')]);
  assert.equal(report.uniqueCnpjs, 1);
  assert.equal(report.nonCnpjLines, 1);
  assert.equal(report.rows.length, 3);
  assert.equal(report.totalCents, 17030);
  assert.equal(report.rows[1].quantity, '7');
  assert.equal(report.rows[1].totalCents, 2020);
  assert.equal(report.ignored, 1);
  assert.equal(report.errors.length, 0);
});

test('purchase preview blocks missing names/amounts, formulas and excessive quantities', () => {
  const report = parsePurchaseMatrix([header,
    row('11222333000181','','1','1,00'),
    row('11222333000181','Exemplo','1',''),
    row('11222333000181','Exemplo','[FORMULA_NAO_SUPORTADA]','1'),
    row('11222333000181','Exemplo','1000000000','1')]);
  assert.deepEqual(report.errors.map(e => e.line), [2,3,4,5]);
  assert.match(report.errors[0].message, /Razão social/);
  assert.equal(report.rows.length, 0);
  assert.throws(() => parsePurchaseMatrix([['wrong','header']]));
});

test('CSV detection decodes Portuguese cp1252 and UTF-8, and retains quoted separators', () => {
  const csv = [header, row('11222333000181','Razão; Comércio','1','1,50')].map(r => r.map(v => '"' + v.replaceAll('"','""') + '"').join(';')).join('\r\n');
  const windows = decodePurchaseCsv(Buffer.from(csv,'latin1'));
  assert.equal(windows.encoding, 'windows-1252');
  assert.equal(windows.matrix[1][8], 'Razão; Comércio');
  assert.equal(parsePurchaseMatrix(windows.matrix).totalCents, 150);
  const utf8 = decodePurchaseCsv(Buffer.from('\uFEFF' + csv));
  assert.equal(utf8.encoding, 'utf-8');
  assert.equal(utf8.matrix[0][0], 'Documento');
});
