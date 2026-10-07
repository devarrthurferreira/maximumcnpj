import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPurchaseLine, calculationVersion, exactCents, percentage, reconciledPercentages, purchaseCsv, MAX_LINE_CENTS, PURCHASE_MODE, SALES_MODE, isFinancialMode, financialKind, financialReportingStatus, reportPeriod, normalizeNatureCode, salesOperation } from '../src/purchase-domain.ts';

const row = {document: '00.000.000/0001-91', name: 'Fornecedor sintético', serviceDate: '2026-08-15', quantity: '020.500000', grossCents: 1200, discountCents: 200, accessoryCents: 99999, freightCents: 100, abatementCents: 50, totalCents: 1050};
test('Compras: valida componentes no servidor, centavos exatos e não multiplica P por Q', () => {
  const value = compactPurchaseLine({...row, status: 'OPTANTE', rawWorkbook: 'discard'});
  assert.equal(value.document, '00000000000191'); assert.equal(value.cnpj, '00000000000191'); assert.equal(value.documentKind, 'CNPJ');
  assert.equal(value.quantity, '20.5'); assert.equal(value.totalCents, 1050); assert.equal(value.valid, true);
  assert(!('status' in value)); assert(!('rawWorkbook' in value));
  for (const totalCents of [1.5, -1, '100', null, NaN, Infinity, MAX_LINE_CENTS + 1]) assert.throws(() => compactPurchaseLine({...row, totalCents}));
  for (const quantity of ['1,5', '-1', '1.0000001', '1e3', '', 1, null]) assert.throws(() => compactPurchaseLine({...row, quantity}));
  assert.throws(() => compactPurchaseLine({...row, name: ''}));
  assert.throws(() => compactPurchaseLine({...row, document: 123}));
});
test('Período fiscal usa a coluna H, inclui meses sem movimento no intervalo e bloqueia acima de 12 meses', () => {
  assert.deepEqual(reportPeriod(['2026-06-30','2026-08-01']), {startDate:'2026-06-30',endDate:'2026-08-01',startMonth:'2026-06',endMonth:'2026-08',months:3,observedMonths:2,missingMonths:['2026-07']});
  assert.throws(() => reportPeriod(['2025-08-01','2026-08-01']), /13 meses/);
  assert.throws(() => compactPurchaseLine({...row,serviceDate:'31/08/2026'}), /Data Escrituração/);
});

test('Compras: CPF, inválido e ausência preservam valor sem virarem CNPJ ou negativa fiscal', () => {
  for (const [document, kind] of [['123.456.789-00', 'CPF'], ['', 'AUSENTE'], ['123', 'INVALIDO']]) {
    const value = compactPurchaseLine({...row, document});
    assert.equal(value.valid, false); assert.equal(value.cnpj, ''); assert.equal(value.documentKind, kind); assert.equal(value.totalCents, 1050);
  }
  assert.equal(percentage(10010, 40000), 25.03); assert.equal(percentage(0, 0), 0);
  assert.throws(() => exactCents(Number.MAX_SAFE_INTEGER + 1)); assert.throws(() => exactCents(-1));
});
test('Compras: CSV preserva componentes, P, total e fonte e neutraliza fórmula', () => {
  const csv = purchaseCsv({calculationVersion:'NET_V2',_id:'test',clientCode:'1',clientName:'Empresa',fileName:'arquivo.csv'}, [{...compactPurchaseLine({...row,name:'=DDE()'}),index:0,status:'OPTANTE'}]);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes('"20.5";"12,00";"2,00";"999,99";"1,00";"0,50";"10,50"')); assert(csv.includes("'"+'=DDE()'));
  assert(!csv.includes('215,25'));
});

test('NET_V2 exige componentes, recalcula o total e não inclui Z; Q_V1 mantém snapshot antigo', () => {
  assert.equal(compactPurchaseLine(row).totalCents, 1050);
  for (const field of ['grossCents','discountCents','accessoryCents','freightCents','abatementCents']) {
    for (const invalid of [undefined, null, -1, 0.1, '1', Infinity, MAX_LINE_CENTS + 1]) assert.throws(() => compactPurchaseLine({...row,[field]:invalid}));
  }
  assert.throws(() => compactPurchaseLine({...row,totalCents:1049}), /divergente/);
  assert.throws(() => compactPurchaseLine({...row,discountCents:99999}), /negativo/);
  const legacy = compactPurchaseLine({document:row.document,name:row.name,quantity:row.quantity,totalCents:100}, 'Q_V1');
  assert.equal(legacy.totalCents,100); assert(!('grossCents' in legacy));
  const csv = purchaseCsv({_id:'legacy',clientName:'Empresa',fileName:'legado.csv'}, [{...legacy,index:0,status:'NAO_CONFIRMADO'}]);
  assert(csv.includes('"Q";"Q_V1";"NAO_OPTANTE";"NAO_CONFIRMADO"'));
  assert(csv.includes('"1,00";"";"";"";"";"1,00"'));
});

test('Vendas: comprador CLIENTE, natureza com 4 dígitos, quantidade opcional e mesma fórmula sem Z', () => {
  const sales = compactPurchaseLine({...row, quantity:undefined, kind:'FORNECEDOR', natureCode:'900001', description:'Venda de serviços'}, 'NET_V2', SALES_MODE);
  assert.equal(sales.kind, 'CLIENTE'); assert.equal(sales.quantity, '0'); assert.equal(sales.totalCents, 1050);
  assert.equal(sales.natureCode, '9000'); assert.equal(sales.operation, 'SERVICO');
  assert.equal(normalizeNatureCode(' 52.0201 '), '5202'); assert.equal(salesOperation('900001', ''), 'SERVICO');
  assert.equal(compactPurchaseLine({...row, quantity:''}, 'NET_V2', SALES_MODE).quantity, '0');
  assert.equal(compactPurchaseLine({...row, quantity:'2.50'}, 'NET_V2', SALES_MODE).quantity, '2.5');
  assert.throws(() => compactPurchaseLine({...row, quantity:'Kit'}, 'NET_V2', SALES_MODE), /Quantidade/);
  assert.throws(() => compactPurchaseLine({...row, quantity:undefined}), /Quantidade/);
  assert.throws(() => compactPurchaseLine(row, 'Q_V1', SALES_MODE), /fórmula/);
  assert.throws(() => calculationVersion({mode:SALES_MODE}), /fórmula/);
  assert.throws(() => calculationVersion({mode:SALES_MODE,calculationVersion:'Q_V1'}), /fórmula/);
  assert.equal(calculationVersion({mode:SALES_MODE,calculationVersion:'NET_V2'}), 'NET_V2');
  assert(isFinancialMode(SALES_MODE)); assert(isFinancialMode(PURCHASE_MODE)); assert(!isFinancialMode('SALES'));
  assert.equal(financialKind(SALES_MODE), 'CLIENTE'); assert.equal(financialKind(PURCHASE_MODE), 'FORNECEDOR');
  const csv = purchaseCsv({mode:SALES_MODE,calculationVersion:'NET_V2',_id:'sales',clientName:'Empresa',fileName:'vendas.csv'}, [{...sales,index:0,status:'NAO_CONFIRMADO'}]);
  assert(csv.includes('Comprador (I)')); assert(csv.includes('Quantidade (P) — opcional'));
  assert(csv.includes('"10,50";"Q - Y + AA - AB";"NET_V2";"NAO_OPTANTE";"NAO_CONFIRMADO"'));
});

test('Classificação gerencial: somente CNPJ com OPTANTE explícito é Simples; demais valores preservam a fonte', () => {
  const cnpj = compactPurchaseLine(row);
  assert.equal(financialReportingStatus({...cnpj,status:'OPTANTE'}),'OPTANTE');
  for (const status of ['NAO_OPTANTE','NAO_CONFIRMADO','NON_CNPJ','',undefined,null,'OTHER']) {
    assert.equal(financialReportingStatus({...cnpj,status}),'NAO_OPTANTE');
  }
  for (const document of ['12345678900','123456789012','abc-123','']) {
    const nonCnpj = compactPurchaseLine({...row,document});
    assert.equal(financialReportingStatus({...nonCnpj,status:'NON_CNPJ'}),'NAO_OPTANTE');
    assert.equal(financialReportingStatus({...nonCnpj,status:'OPTANTE'}),'NAO_OPTANTE');
    const csv = purchaseCsv({mode:PURCHASE_MODE,calculationVersion:'NET_V2',_id:'snapshot',clientName:'Empresa',fileName:'arquivo.csv'}, [{...nonCnpj,index:0,status:'NON_CNPJ'}]);
    assert(csv.includes('"NAO_OPTANTE";"NON_CNPJ"')); assert(csv.includes('"Não consultado"'));
  }
});

test('Vendas: CPF tem grupo próprio sem alterar situação fiscal nem agrupar outros documentos como CPF', () => {
  const cpf = compactPurchaseLine({...row, document:'12345678900'}, 'NET_V2', SALES_MODE);
  assert.equal(financialReportingStatus({...cpf, status:'NON_CNPJ'}, SALES_MODE), 'CPF');
  assert.equal(financialReportingStatus({...cpf, status:'NON_CNPJ'}, PURCHASE_MODE), 'NAO_OPTANTE');
  for (const document of ['123456789012', 'abc', '']) {
    assert.equal(financialReportingStatus({...compactPurchaseLine({...row, document}, 'NET_V2', SALES_MODE),status:'NON_CNPJ'}, SALES_MODE), 'NAO_OPTANTE');
  }
  const csv = purchaseCsv({mode:SALES_MODE, calculationVersion:'NET_V2',_id:'cpf-sales', clientName:'Empresa',fileName:'vendas.csv'}, [{...cpf,index:0,status:'NON_CNPJ'}]);
  assert(csv.includes('"CPF";"NON_CNPJ"')); assert(csv.includes('"Não consultado"'));
});

test('Três percentuais de vendas conciliam 100% sem grupo negativo, inclusive empates e base zero', () => {
  assert.deepEqual(reconciledPercentages([1,1,1], 3), [33.34,33.33,33.33]);
  assert.deepEqual(reconciledPercentages([10001,0,9999], 20000), [50.01,0,49.99]);
  assert.deepEqual(reconciledPercentages([0,0,0], 0), [0,0,0]);
  assert.deepEqual(reconciledPercentages([0,0,3], 3), [0,0,100]);
  assert.deepEqual(reconciledPercentages([10010,29990,3000], 43000), [23.28,69.74,6.98]);
  assert.throws(() => reconciledPercentages([1,2,3], 5));
  assert.throws(() => reconciledPercentages([1,-1,3], 3));
  assert.throws(() => reconciledPercentages([0.5,0.5,0], 1));
});
