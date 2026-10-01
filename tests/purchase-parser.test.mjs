import test from 'node:test';
import assert from 'node:assert/strict';
import {amountCents, decimal, decodePurchaseCsv, parsePurchaseMatrix, fiscalDate} from '../public/purchase-parser.js';

const header = Array(28).fill('');
for (const [index,label] of [[0,'Documento'],[7,'Data Escrituração/Serviço'],[8,'Razão social'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']]) header[index] = label;
const row = (document, name, quantity, total, serviceDate='15/08/2026') => { const r = Array(28).fill(''); r[0] = document; r[7] = serviceDate; r[8] = name; r[15] = quantity; r[16] = total; return r; };

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

test('coluna H aceita data brasileira, ISO e serial Excel e identifica de 1 a 12 meses', () => {
  assert.equal(fiscalDate('31/08/2026'), '2026-08-31');
  assert.equal(fiscalDate('2026-08-31T10:30:00'), '2026-08-31');
  assert.equal(fiscalDate(46265), '2026-08-31');
  assert.throws(() => fiscalDate('31/02/2026'), /inválida/);
  const twelve = parsePurchaseMatrix([header,row('11222333000181','A','1','1,00','01/09/2025'),row('11222333000181','A','1','1,00','31/08/2026')]);
  assert.deepEqual(twelve.period, {startDate:'2025-09-01',endDate:'2026-08-31',startMonth:'2025-09',endMonth:'2026-08',months:12,observedMonths:2,missingMonths:['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07']});
  const thirteen = parsePurchaseMatrix([header,row('11222333000181','A','1','1,00','01/08/2025'),row('11222333000181','A','1','1,00','31/08/2026')]);
  assert.match(thirteen.errors.at(-1).message, /13 meses/);
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

const exportHeader = [...header, 'Codigo Empresa', 'Chave Lancamento', ''];
['Estado','Contribuinte ICMS','Natureza','Classificação Fiscal','Produto'].forEach((name,i) => exportHeader[i+9]=name);
['Descrição','Quantidade','Valor Total','CST ICMS','Base Cálculo ICMS','Alíquota ICMS','Valor ICMS','Valor IPI',
  'Valor ISS','Valor Substituição Tributária','Valor Desconto','Valor Despesa Acessória','Valor Frete',
  'Abatimento não Tributado','Codigo Empresa','Chave Lancamento'].forEach((name, i) => exportHeader[i + 14] = name);
const recoveryOptions = {type:'SALES', sourceFormat:'CSV', delimiter:';', recoverDescriptionSeparators:true, companyCode:'936'};
function exportRow() {
  const values = [...row('11222333000181', 'Comprador sintético', '2', '100,00'), '936', '403', ''];
  values[9]='SP'; values[10]='Não'; values[11]='5102002'; values[12]='3922.20.00'; values[13]='42';
  values[14]='Descrição sintética'; values[17]='102';
  for (let i = 18; i < 28; i++) values[i]='0';
  values[24]='20,10'; values[25]='999,99'; values[26]='2,20'; values[27]='0,50';
  return values;
}
const splitDescription = (values, fragments = ['Tamanho:10M']) => [...values.slice(0,15), ...fragments, ...values.slice(15)];
const encodeCsv = rows => rows.map(values => values.map(value => '"' + String(value).replaceAll('"','""') + '"').join(';')).join('\r\n');

test('known CSV recovery only rejoins descriptive fragments and preserves exact financial values', () => {
  const original = exportRow(), broken = splitDescription(original); broken.pop();
  const matrix = [exportHeader, broken], unchanged = structuredClone(matrix);
  const report = parsePurchaseMatrix(matrix, 0, recoveryOptions);
  assert.deepEqual(matrix, unchanged);
  assert.equal(report.errors.length, 0); assert.equal(report.rows.length, 1); assert.equal(report.repairedCount, 1);
  assert.deepEqual(report.repairs, [{line:2, descriptionSeparators:1,
    reason:'Separadores extras da descrição (O) recompostos; colunas P a AD realinhadas com os valores originais.'}]);
  assert.deepEqual(report.rows[0], parsePurchaseMatrix([exportHeader, original],0,{type:'SALES'}).rows[0]);
  assert.equal(report.totalCents, 8160); assert.equal(report.components.accessoryCents, 99999);
  assert.equal(report.rows[0].document, original[0]); assert.equal(report.rows[0].name, original[8]);
  const multiple = parsePurchaseMatrix([exportHeader, splitDescription(original, ['Cor:Azul','Tamanho:10M','Kit:2'])],0,recoveryOptions);
  assert.equal(multiple.errors.length,0); assert.equal(multiple.repairs[0].descriptionSeparators,3);
  assert.deepEqual(multiple.rows, report.rows);
});

test('CSV recovery uses trustworthy company anchors and leaves correctly quoted descriptions unchanged', () => {
  const original=exportRow(); original[14]='Descrição; Cor:Azul; Tamanho:10M';
  const decoded=decodePurchaseCsv(Buffer.from(encodeCsv([exportHeader, original])));
  const quoted=parsePurchaseMatrix(decoded.matrix,0,{...recoveryOptions,...decoded});
  assert.equal(decoded.delimiter,';'); assert.deepEqual(decoded.sourceLines,[1,2]);
  assert.equal(quoted.errors.length,0); assert.equal(quoted.repairedCount,0);
  assert.equal(quoted.totalCents,8160);
  const normal=exportRow(), broken=splitDescription(normal);
  const implicit={...recoveryOptions}; delete implicit.companyCode;
  assert.equal(parsePurchaseMatrix([exportHeader,normal,broken],0,implicit).repairedCount,1);
  assert.equal(parsePurchaseMatrix([exportHeader,broken],0,implicit).errors.length,1);
  const other=exportRow(); other[28]='937';
  assert.equal(parsePurchaseMatrix([exportHeader,normal,other,broken],0,implicit).errors.length,1);
  assert.equal(parsePurchaseMatrix([exportHeader,broken],0,{...recoveryOptions,companyCode:'937'}).errors.length,1);
});

test('ambiguous shifts, unknown headers, incomplete numeric suffixes and workbooks stay blocked', () => {
  const normal=exportRow(), broken=splitDescription(normal);
  const unknown=[...exportHeader]; unknown[14]='Observações';
  const altered=[...exportHeader]; altered[18]='Outra base';
  const reports = [
    parsePurchaseMatrix([exportHeader,broken],0,{type:'SALES'}),
    parsePurchaseMatrix([exportHeader,broken],0,{...recoveryOptions,sourceFormat:'XLSX'}),
    parsePurchaseMatrix([exportHeader,broken],0,{...recoveryOptions,delimiter:','}),
    parsePurchaseMatrix([exportHeader,broken],0,{...recoveryOptions,recoverDescriptionSeparators:false}),
    parsePurchaseMatrix([unknown,broken],0,recoveryOptions),
    parsePurchaseMatrix([altered,broken],0,recoveryOptions),
  ];
  for (const fragment of ['123','R$ 10,00','','-10','2026-09-29']) reports.push(parsePurchaseMatrix([exportHeader,splitDescription(normal,[fragment])],0,recoveryOptions));
  for (const column of [15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]) {
    const invalid=exportRow(); invalid[column]='';
    reports.push(parsePurchaseMatrix([exportHeader,splitDescription(invalid)],0,recoveryOptions));
    invalid[column]='texto';
    reports.push(parsePurchaseMatrix([exportHeader,splitDescription(invalid)],0,recoveryOptions));
  }
  const earlierSplit=[...normal.slice(0,9),'Complemento do nome',...normal.slice(9)];
  reports.push(parsePurchaseMatrix([exportHeader,earlierSplit],0,recoveryOptions));
  const missing=splitDescription(normal); missing.splice(20,1);
  reports.push(parsePurchaseMatrix([exportHeader,missing],0,recoveryOptions));
  const negative=exportRow(); negative[24]='999,99';
  reports.push(parsePurchaseMatrix([exportHeader,splitDescription(negative)],0,recoveryOptions));
  for (const report of reports) {
    assert.equal(report.rows.length,0); assert.equal(report.errors.length,1); assert.equal(report.repairs.length,0); assert.equal(report.totalCents,0);
  }
});

test('CSV diagnostics keep physical line numbers across blank and quoted multiline records', () => {
  const normal=exportRow(); normal[14]='Descrição\r\ncom quebra';
  const broken=splitDescription(exportRow()), invalid=splitDescription(exportRow(),['123']);
  const text=[encodeCsv([exportHeader]),'',encodeCsv([normal]),encodeCsv([broken]),encodeCsv([invalid])].join('\r\n');
  const decoded=decodePurchaseCsv(Buffer.from(text));
  assert.deepEqual(decoded.sourceLines,[1,3,5,6]);
  const parsed=parsePurchaseMatrix(decoded.matrix,0,{...recoveryOptions,...decoded});
  assert.equal(parsed.rows.length,2); assert.equal(parsed.repairs[0].line,5); assert.equal(parsed.errors[0].line,6);
  assert.equal(parsed.totalCents,16320);
});
