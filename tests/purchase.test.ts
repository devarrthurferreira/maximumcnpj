import { calculateDifal, summarizeDifal, normalizeUf, DIFAL_VERSION, DIFAL_ELIGIBLE_CFOPS } from '../src/difal.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPurchaseLine, calculationVersion, exactCents, percentage, signedPercentage, reconciledPercentages, reconciledSignedPercentages, purchaseCsv, moneyText, MAX_LINE_CENTS, PURCHASE_MODE, SALES_MODE, isFinancialMode, financialKind, financialReportingStatus, reportPeriod, normalizeNatureCode, salesOperation } from '../src/purchase-domain.ts';

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
  const returned = compactPurchaseLine({...row, natureCode:'520201', description:'Devolução'}, 'NET_V2', SALES_MODE);
  assert.equal(returned.natureCode,'5202'); assert.equal(returned.operation,'DEVOLUCAO'); assert.equal(returned.balanceCents,-1050);
  assert.equal(moneyText(-1050), '-10,50');
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
  assert(csv.includes('"10,50";"10,50";"Q - Y + AA - AB";"NET_V2";"NAO_OPTANTE";"NAO_CONFIRMADO"'));
  const returnCsv = purchaseCsv({mode:SALES_MODE,calculationVersion:'NET_V2',_id:'return',clientName:'Empresa',fileName:'vendas.csv'}, [{...returned,index:0,status:'NAO_CONFIRMADO'}]);
  assert(returnCsv.includes('"5202";"Devolução";"DEVOLUCAO"'));
  assert(returnCsv.includes('"10,50";"\'-10,50";"Q - Y + AA - AB"'));
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

test('Percentuais líquidos coincidem com o PDF, inclusive devoluções, empates e total zero', () => {
  assert.equal(signedPercentage(10010, 40000), 25.03);
  assert.equal(signedPercentage(-10010, 40000), -25.03);
  assert.equal(signedPercentage(10010, -40000), -25.03);
  assert.deepEqual(reconciledSignedPercentages([1, 1, 1], 3), [33.34, 33.33, 33.33]);
  assert.deepEqual(reconciledSignedPercentages([-10010, 45000, 5010], 40000), [-25.02, 112.5, 12.52]);
  assert.deepEqual(reconciledSignedPercentages([-1, -1, -1], -3), [33.34, 33.33, 33.33]);
  assert.deepEqual(reconciledSignedPercentages([1, 31, 0], 32), [3.13, 96.87, 0]);
  assert.deepEqual(reconciledSignedPercentages([-1, 33, 0], 32), [-3.12, 103.12, 0]);
  assert.deepEqual(reconciledSignedPercentages([-100, 100, 0], 0), [0, 0, 0]);
  assert.deepEqual(reconciledSignedPercentages([0, 0, 0], 0), [0, 0, 0]);
  assert.throws(() => reconciledSignedPercentages([1, 2, 3], 5));
  assert.throws(() => reconciledSignedPercentages([0.5, 0.5, 0], 1));
  assert.throws(() => signedPercentage(NaN, 0));
});

const difalSale = {totalCents: 15000, natureCode: '6108', description: 'Camiseta', document: '123.456.789-00', issuerUf: 'MG', recipientUf: 'SP'};
test('DIFAL estimado: cenários de venda CPF interestadual, exclusões e recálculo sem alterar componentes', () => {
  assert.deepEqual(calculateDifal(difalSale), {eligible: true, baseCents: 15000, amountCents: 1500, reason: 'ELIGIBLE'});
  for (const [change, reason] of [
    [{document: '00.000.000/0001-91'}, 'NOT_CPF'], [{recipientUf: 'MG'}, 'SAME_UF'],
    [{natureCode: '9000', description: 'Prestação de serviços'}, 'NOT_SALE'],
    [{description: 'Venda de serviços'}, 'NOT_SALE'], [{natureCode: '6202', description: 'Venda'}, 'NOT_SALE'],
    [{natureCode: '6949', description: 'Venda'}, 'INELIGIBLE_NATURE'], [{natureCode: '5108'}, 'NOT_SALE'],
    [{description: 'Remessa de mercadoria para venda'}, 'NOT_SALE'], [{operation: 'OUTRAS'}, 'NOT_SALE'],
    [{document: ''}, 'NOT_CPF'], [{document: '123456789012'}, 'NOT_CPF']
  ] as const) {
    assert.deepEqual(calculateDifal({...difalSale, ...change}), {eligible: false, baseCents: 0, amountCents: 0, reason});
  }
  assert.equal(calculateDifal({...difalSale, description: 'Venda de kit para conserto'}).eligible, true);
  assert.equal(calculateDifal({...difalSale, totalCents: 100000}).amountCents, 10000);
  assert.equal(calculateDifal({...difalSale, totalCents: 999}).amountCents, 100);
  assert.equal(calculateDifal({...difalSale, totalCents: 5}).amountCents, 1);
  assert.equal(calculateDifal({...difalSale, totalCents: 4}).amountCents, 0);
  assert.equal(calculateDifal({...difalSale, totalCents: 0}).amountCents, 0);
  assert.equal(calculateDifal({...difalSale, totalCents: 1.5}).reason, 'INVALID_TOTAL');
  for (const natureCode of DIFAL_ELIGIBLE_CFOPS) assert.equal(calculateDifal({...difalSale, natureCode, description: ''}).eligible, true);
  const source = {...row, ...difalSale, grossCents: 16000, discountCents: 1000, freightCents: 0, abatementCents: 0, recipientUf: ' sp ', difal: {amountCents: 999999}, operation: 'SERVICO'};
  const compact = compactPurchaseLine(source, 'NET_V2', SALES_MODE, {issuerUf: 'mg', difalVersion: DIFAL_VERSION});
  assert.equal(compact.difal?.amountCents, 1500); assert.equal(compact.operation, 'VENDA'); assert.equal(compact.recipientUf, 'SP');
  assert.equal(compact.totalCents, 15000); assert.equal(compact.grossCents, 16000); assert.equal(compact.discountCents, 1000); assert.equal(compact.accessoryCents, row.accessoryCents);
  assert.equal(compactPurchaseLine({...source, grossCents: 101000, totalCents: 100000}, 'NET_V2', SALES_MODE, {issuerUf: 'MG', difalVersion: DIFAL_VERSION}).difal?.amountCents, 10000);
  const purchase = compactPurchaseLine(source);
  assert.equal(purchase.difal, undefined); assert.equal(purchase.recipientUf, undefined);
});
test('DIFAL: pendências de UF, contexto legado e soma dos centavos por venda', () => {
  assert.equal(normalizeUf(' mg '), 'MG'); assert.equal(normalizeUf('XX'), '');
  assert.equal(calculateDifal({...difalSale, issuerUf: ''}).reason, 'MISSING_ISSUER_UF');
  assert.equal(calculateDifal({...difalSale, recipientUf: 'XX'}).reason, 'MISSING_RECIPIENT_UF');
  const result = summarizeDifal([difalSale, {...difalSale, totalCents: 100000}, {...difalSale, recipientUf: ''}, {...difalSale, document: '00000000000191'}], 'MG');
  assert.deepEqual(result, {version: DIFAL_VERSION, ratePercent: 10, issuerUf: 'MG', eligibleLines: 2, baseCents: 115000, amountCents: 11500, pendingLines: 1});
  assert.equal(summarizeDifal([{...difalSale, totalCents: 5}, {...difalSale, totalCents: 5}], 'MG').amountCents, 2);
  const source = {...row, natureCode: '6108', description: 'Camiseta', recipientUf: 'SP'};
  const legacy = compactPurchaseLine(source, 'NET_V2', SALES_MODE, {issuerUf: undefined, difalVersion: undefined});
  assert.equal(legacy.operation, 'OUTRAS'); assert.equal(legacy.difal, undefined); assert.equal(legacy.recipientUf, undefined);
  const csv = purchaseCsv({mode: SALES_MODE, calculationVersion: 'NET_V2', difalVersion: DIFAL_VERSION, issuerUf: 'MG', _id: 'difal', clientName: 'Empresa', fileName: 'vendas.csv'}, [{...compactPurchaseLine({...row, ...difalSale, grossCents: 15000, discountCents: 0, freightCents: 0, abatementCents: 0}, 'NET_V2', SALES_MODE, {issuerUf: 'MG', difalVersion: DIFAL_VERSION}), index: 0}]);
  assert(csv.includes('"MG";"SP";"10";"150,00";"15,00";"ELIGIBLE";"DIFAL_ESTIMATE_V1"'));
});
