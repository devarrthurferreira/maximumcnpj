import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup } from '../src/lookup-jobs.ts';
import { PURCHASE_MODE, SALES_MODE } from '../src/purchase-domain.ts';
import { purchaseSummary, purchaseRows, purchaseExport } from '../src/purchase-store.ts';
import { monthlyReportSource } from '../src/simulation-monthly-source.ts';
import { digits, csvParse } from '../src/domain.ts';

test('compras consideradas são uma projeção por linha; resumo, agrupamento, CSV, DRE e retries preservam snapshot',
  {skip: !process.env.MONGODB_URI, timeout: 120000}, async t => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_selection_' + randomUUID().replaceAll('-', ''); process.env.WORKSPACE_ID = 'selection_test'; resetLookupIndexes();
  const actor = {_id: 'selection-tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  const ids = ['000000000001', '111111110001', '222222220001'].map(base => base + digits(base));
  let calls = 0;
  const transport = (async (url: string | URL | Request) => {
    calls++; const cnpj = String(url).split('/').pop();
    if (cnpj === ids[2]) return new Response('', {status: 404});
    return Response.json({cnpj, razao_social: 'Fornecedor sintético', opcao_pelo_simples: cnpj === ids[0]});
  }) as typeof fetch;
  const row = (natureCode: string, totalCents: number, document = ids[0]) => ({document, name: 'Fornecedor sintético', natureCode,
    recipientUf: 'SP', serviceDate: '2026-08-15', quantity: '1', totalCents, grossCents: totalCents + 500,
    discountCents: 600, accessoryCents: 99, freightCents: 150, abatementCents: 50});
  const complete = async (id: string) => { await finalizeLookup(actor, id); await (await collection('providerControl')).deleteMany({}); return processLookup(actor, id, transport); };
  try {
    const clientId = (await importCatalog(actor, [{code: '871', name: 'Empresa sintética', uf: 'MG'}])).items[0].id;
    const inputs = [row('1102002', 10000), row('1202', 50000), row('8000102', 5000, ids[1]), row('1949', 3000, ids[2]),
      row('2102', 2000, '123.456.789-01'), row('5202', 600, '12345678901'), row('1102', 100, ''), row('1102', 200, ''),
      row('9999', 900), row('1102', 0, ids[1]), row('5102', 700)];
    const job = await createLookup(actor, {clientId, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: inputs.length, issuerUf: 'MG'}, PURCHASE_MODE);
    const payload = {offset: 0, rows: inputs}; await uploadLookup(actor, job._id, payload); await uploadLookup(actor, job._id, payload); await complete(job._id);
    const jobs = await collection('lookupJobs'), lines = await collection('purchaseLines');
    const snapshot = async () => ({job: await jobs.findOne(scope({_id: job._id})), rows: await lines.find(scope({jobId: job._id})).sort({index: 1}).toArray(),
      items: await (await collection('lookupItems')).find(scope({jobId: job._id})).sort({_id: 1}).toArray(),
      chunks: await (await collection('chunks')).find(scope({_id: `lookup:${job._id}:0`})).toArray()});
    const before = await snapshot(), callsBefore = calls, summary = await purchaseSummary(job._id), selection = summary.purchaseSelection!;
    assert.equal(summary.totals.totalCents, 72500); assert.equal(summary.totals.lines, 11); assert.equal(summary.totals.uniqueCnpjs, 3);
    assert.equal(selection.available, true); assert.equal(selection.totals?.totalCents, 17300); assert.equal(selection.totals?.lines, 6);
    assert.equal(selection.totals?.uniqueDocuments, 5); assert.equal(selection.totals?.uniqueCnpjs, 2); assert.equal(selection.excludedTotalCents, 55200);
    assert.deepEqual(selection.reportingGroups?.map(group => [group.status, group.count, group.totalCents, group.valuePercent]),
      [['OPTANTE', 1, 10000, 57.8], ['NAO_OPTANTE', 4, 7300, 42.2]]);
    const details = await purchaseRows(job._id, 'ALL', 1, true), grouped = await purchaseRows(job._id, 'ALL', 1);
    assert.equal(details.total, inputs.length); assert.equal(grouped.total, 6);
    assert.deepEqual(details.items.map((line: any) => line.consideredCents), [10000, 0, 5000, 0, 2000, 0, 100, 200, 0, 0, 0]);
    assert.equal(grouped.items.reduce((sum: number, item: any) => sum + item.consideredCents, 0), selection.totals?.totalCents);
    const mixed = grouped.items.find((line: any) => line.document === ids[0]);
    assert.equal(mixed.totalCents, 61600); assert.equal(mixed.consideredCents, 10000); assert.equal(mixed.selectedLines, 1);
    assert.equal(mixed.purchaseSelection.reason, 'MIXED_OPERATIONS');
    assert.equal(grouped.items.find((line: any) => line.document === ids[2]).purchaseSelection.eligible, false);
    const exported = await purchaseExport(job._id, 'ALL', 1), csv = csvParse(exported.content), header = csv[0];
    assert.equal(exported.total, inputs.length); assert.equal(csv.length, inputs.length + 1);
    const selectedColumn = header.indexOf('Compras consideradas (R$)'), reasonColumn = header.indexOf('Motivo da seleção de compras');
    assert(selectedColumn >= 0); assert.equal(csv[1][selectedColumn], '100,00'); assert.equal(csv[2][selectedColumn], '0,00');
    assert.equal(csv[2][reasonColumn], 'DEVOLUCAO_VENDA'); assert.equal(csv[3][reasonColumn], 'SERVICO_COMPRA');
    assert.equal(calls, callsBefore); assert.deepEqual(await snapshot(), before);

    await t.test('DRE retém devolução de venda nas entradas e vendas não recebem seleção de compras', async () => {
      const sale = await createLookup(actor, {clientId, importId: randomUUID(), fileName: 'vendas.csv', expectedRows: 1, issuerUf: 'MG'}, SALES_MODE);
      await uploadLookup(actor, sale._id, {offset: 0, rows: [row('5102', 100000)]}); await complete(sale._id);
      const sales = await purchaseSummary(sale._id, true, SALES_MODE);
      assert.equal(Object.hasOwn(sales, 'purchaseSelection'), false);
      assert.equal(Object.hasOwn((await purchaseRows(sale._id, 'ALL', 1, true, SALES_MODE)).items[0], 'purchaseSelection'), false);
      assert(!(await purchaseExport(sale._id, 'ALL', 1, SALES_MODE)).content.includes('Compras consideradas (R$)'));
      const monthly = await monthlyReportSource(summary, sales, undefined, 'MG');
      assert.equal(monthly![0].operationAudit.reportPurchasesCents, 72500);
      assert.equal(monthly![0].operationAudit.purchaseGoodsCents + monthly![0].operationAudit.purchaseServicesCents, 17300);
      assert.equal(monthly![0].operationAudit.salesReturnsCents, 50000);
    });
    await t.test('reconsulta copia o snapshot completo mesmo que CNPJs sejam excluídos da seleção', async () => {
      const repeated = await recheckLookup(actor, job._id);
      assert.equal(repeated.summary.unique, 3); assert.deepEqual(repeated.purchaseInput, before.job!.purchaseInput);
      await (await collection('providerControl')).deleteMany({}); await processLookup(actor, repeated._id, transport);
      assert.deepEqual((await purchaseSummary(repeated._id)).purchaseSelection, selection); assert.deepEqual(await snapshot(), before);
    });
    await t.test('adulterações financeiras e de catálogo são bloqueadas antes da seleção', async () => {
      await lines.updateOne(scope({jobId: job._id, index: 1}), {$inc: {totalCents: 1}});
      try { await assert.rejects(purchaseExport(job._id, 'ALL', 1)); }
      finally { await lines.updateOne(scope({jobId: job._id, index: 1}), {$inc: {totalCents: -1}}); }
      await lines.updateOne(scope({jobId: job._id, index: 1}), {$set: {natureOperation: 'COMPRAS'}});
      try { await assert.rejects(purchaseSummary(job._id), (error: any) => error.code === 'OPERATION_SNAPSHOT'); }
      finally { await lines.updateOne(scope({jobId: job._id, index: 1}), {$set: {natureOperation: 'DEVOLUCAO_VENDA'}}); }
    });
    await t.test('identidade de documento precisa conciliar CNPJ, validade e tipo antes do resumo, linhas ou CSV', async () => {
      const identities = await createLookup(actor, {clientId, importId: randomUUID(), fileName: 'identidades.csv', expectedRows: 2, issuerUf: 'MG'}, PURCHASE_MODE);
      await uploadLookup(actor, identities._id, {offset: 0, rows: [row('1102', 100, ids[0]), row('1102', 200, ids[1])]});
      await finalizeLookup(actor, identities._id); await (await collection('providerControl')).deleteMany({});
      await processLookup(actor, identities._id, (async (url: string | URL | Request) => Response.json({cnpj: String(url).split('/').pop(), razao_social: 'Fornecedor sintético', opcao_pelo_simples: true})) as typeof fetch);
      assert.equal((await purchaseSummary(identities._id)).purchaseSelection?.totals?.uniqueDocuments, 2);
      // Both CNPJs have the same status and tax treatment. Changing only the
      // display document used to merge their selected identities undetected.
      for (const [field, forged, original] of [['document', ids[0], ids[1]], ['documentKind', 'CPF', 'CNPJ'], ['valid', 1, true]] as const) {
        await lines.updateOne(scope({jobId: identities._id, index: 1}), {$set: {[field]: forged}});
        try {
          await assert.rejects(purchaseSummary(identities._id), (error: any) => error.code === 'RESULT_COUNT');
          await assert.rejects(purchaseRows(identities._id, 'ALL', 1, true), (error: any) => error.code === 'RESULT_COUNT');
          await assert.rejects(purchaseExport(identities._id, 'ALL', 1), (error: any) => error.code === 'RESULT_COUNT');
        } finally { await lines.updateOne(scope({jobId: identities._id, index: 1}), {$set: {[field]: original}}); }
      }
      assert.equal((await purchaseSummary(identities._id)).purchaseSelection?.totals?.uniqueDocuments, 2);
    });
    await t.test('legado com natureza suficiente deriva; natureza ausente é indisponível em resumo, linhas, agrupamento e CSV', async () => {
      const legacy = await createLookup(actor, {clientId, importId: randomUUID(), fileName: 'legado.csv', expectedRows: 2, issuerUf: 'MG'}, PURCHASE_MODE);
      await jobs.updateOne(scope({_id: legacy._id}), {$unset: {anticipationVersion: ''}});
      const payload = {offset: 0, rows: [row('1102', 100), row('1202', 300)]};
      await uploadLookup(actor, legacy._id, payload); await uploadLookup(actor, legacy._id, payload); await complete(legacy._id);
      await jobs.updateOne(scope({_id: legacy._id}), {$unset: {operationVersion: ''}});
      await lines.updateMany(scope({jobId: legacy._id}), {$unset: {operationVersion: '', natureOperation: '', recipientUf: ''}});
      assert.equal((await purchaseSummary(legacy._id)).purchaseSelection?.totals?.totalCents, 100, 'UF não é requisito de seleção de natureza.');
      await lines.updateOne(scope({jobId: legacy._id, index: 1}), {$unset: {natureCode: ''}});
      const unknown = await purchaseSummary(legacy._id);
      assert.equal(unknown.totals.totalCents, 400); assert.equal(unknown.purchaseSelection?.available, false);
      assert.equal(unknown.purchaseSelection?.totals, null); assert.equal(unknown.purchaseSelection?.excludedTotalCents, null);
      for (const detailed of [true, false]) assert((await purchaseRows(legacy._id, 'ALL', 1, detailed)).items.every((item: any) => item.consideredCents === null && item.purchaseSelection.origin === 'UNAVAILABLE'));
      const csv = csvParse((await purchaseExport(legacy._id, 'ALL', 1)).content), column = csv[0].indexOf('Compras consideradas (R$)');
      assert(csv.slice(1).every(line => line[column] === '')); assert(csv[1].includes('UNAVAILABLE'));
    });
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});
