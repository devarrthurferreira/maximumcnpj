import test from 'node:test';
import assert from 'node:assert/strict';
import {amountCents, decimal, decodePurchaseCsv, parsePurchaseMatrix} from '../public/purchase-parser.js';

const header = Array(28).fill('');
for (const [index,label] of [[0,'Documento'],[8,'Razão social'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']]) header[index] = label;
const row = (document, name, quantity, total) => { const r = Array(28).fill(''); r[0] = document; r[8] = name; r[15] = quantity; r[16] = total; return r; };

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

test('NET_V2 aplica Q-Y+AA-AB, preserva Z informativa e denuncia total negativo', () => {
  const input = row('11222333000181','Fornecedor','10','100,00');
  input[24]='12,50'; input[25]='300,00'; input[26]='2,10'; input[27]='0,60';
  const parsed = parsePurchaseMatrix([header,input]);
  assert.equal(parsed.errors.length,0); assert.equal(parsed.totalCents,8900);
  assert.deepEqual(parsed.components,{grossCents:10000,discountCents:1250,accessoryCents:30000,freightCents:210,abatementCents:60,totalCents:8900});
  assert.equal(parsed.rows[0].quantity,'10'); assert.equal(parsed.formula,'Q - Y + AA - AB');
  input[24]='102,00'; assert.match(parsePurchaseMatrix([header,input]).errors[0].message,/negativo/);
  input[24]='[FORMULA_NAO_SUPORTADA]'; assert.match(parsePurchaseMatrix([header,input]).errors[0].message,/fórmulas/);
  const oldHeader = header.slice(0,17), oldRow = input.slice(0,17);
  assert.throws(() => parsePurchaseMatrix([oldHeader,oldRow]), /AB/);
  const legacy = parsePurchaseMatrix([oldHeader,oldRow],0,{calculationVersion:'Q_V1'});
  assert.equal(legacy.totalCents,10000); assert.equal(legacy.components,null); assert(!('grossCents' in legacy.rows[0]));
});

test('vendas rejeita colunas deslocadas mesmo com mesma largura do cabeçalho', () => {
  const salesHeader = [...header,'Código','Chave',''];
  const normal = [...row('11222333000181','Comprador','1','100,00'),'936','chave',''];
  assert.equal(parsePurchaseMatrix([salesHeader,normal],0,{type:'SALES'}).totalCents,10000);
  const shifted = [...normal]; shifted[15] = 'Kit'; shifted[16] = '1'; shifted[30] = 'chave';
  assert.match(parsePurchaseMatrix([salesHeader,shifted],0,{type:'SALES'}).errors[0].message,/desalinhadas/);
  shifted[30]=''; assert.match(parsePurchaseMatrix([salesHeader,shifted],0,{type:'SALES'}).errors[0].message,/Quantidade/);
  const sparseHeader = [...header]; sparseHeader[15]=''; const sparse = row('11222333000181','Comprador','','100,00');
  assert.equal(parsePurchaseMatrix([sparseHeader,sparse],0,{type:'SALES'}).rows[0].quantity,'0');
});

test('vendas usa comprador A/I, admite P vazio e calcula Q-Y+AA-AB sem Z', () => {
  const input = row('11222333000181','Comprador sintético','','100,00');
  input[24]='20,10'; input[25]='999,99'; input[26]='2,20'; input[27]='0,50';
  const result = parsePurchaseMatrix([header,input], 0, {type:'SALES'});
  assert.equal(result.errors.length, 0); assert.equal(result.reportType,'SALES');
  assert.equal(result.totalCents, 8160); assert.equal(result.components.accessoryCents, 99999);
  assert.equal(result.rows[0].document, '11222333000181'); assert.equal(result.rows[0].name, 'Comprador sintético');
  assert.equal(result.rows[0].quantity, '0');
  assert.equal(parsePurchaseMatrix([header,input]).errors.length, 1);
  input[8]=''; assert.match(parsePurchaseMatrix([header,input],0,{type:'SALES'}).errors[0].message,/Comprador/);
  assert.throws(() => parsePurchaseMatrix([header,input],0,{type:'SALES',calculationVersion:'Q_V1'}), /fórmula/);
});
