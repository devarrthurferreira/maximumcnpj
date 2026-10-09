import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup } from '../src/lookup-jobs.ts';
import { SALES_MODE } from '../src/purchase-domain.ts';
import { purchaseSummary, purchaseRows, purchaseExport } from '../src/purchase-store.ts';
import { DIFAL_VERSION } from '../src/difal.ts';
import { createGeneration, attachGenerationSale, attachGenerationPurchase, getGeneration } from '../src/generation-store.ts';
import { generationSimulator } from '../src/simulator-store.ts';

test('DIFAL MongoDB: origem imutável, CPF, reconciliação, reimportação, legado e geração idempotente', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_difal_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'difal_test'; resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  let providerCalls = 0;
  const transport = (async () => {
    providerCalls++;
    return Response.json({cnpj: '00000000000191', razao_social: 'Empresa sintética', opcao_pelo_simples: true, opcao_pelo_mei: false});
  }) as typeof fetch;
  const sale = (change: Record<string, unknown> = {}) => {
    const row = {document: '12345678900', name: 'Pessoa sintética', serviceDate: '2026-08-15', quantity: '1', natureCode: '6108', description: 'Camiseta', recipientUf: 'SP', totalCents: 15000, ...change};
    return {...row, grossCents: row.totalCents, discountCents: 0, accessoryCents: 99, freightCents: 0, abatementCents: 0};
  };
  try {
    const catalog = await importCatalog(actor, [{code: '951', name: 'Emitente MG', uf: 'MG'}]);
    const clientId = catalog.items[0].id;
    const rows = [sale(), sale({document: '00000000000191'}), sale({recipientUf: 'MG'}),
      sale({natureCode: '9000', description: 'Prestação de serviço'}), sale({totalCents: 100000}),
      sale({natureCode: '6949', description: 'Venda'}), sale({recipientUf: ''}),
      sale({natureCode: '6202', description: 'Devolução'}), sale({totalCents: 5}), sale({totalCents: 5})];
    const input = {importId: randomUUID(), clientId, fileName: 'vendas-difal.csv', expectedRows: rows.length};
    const job = await createLookup(actor, input, SALES_MODE);
    assert.equal(job.issuerUf, 'MG'); assert.equal(job.difalVersion, DIFAL_VERSION);
    // A later catalog edit cannot silently change an in-flight or completed snapshot.
    await (await collection('clients')).updateOne(scope({_id: clientId}), {$set: {uf: 'RJ'}});
    assert.equal((await createLookup(actor, input, SALES_MODE)).issuerUf, 'MG');
    await assert.rejects(createLookup(actor, {...input, issuerUf: 'SP'}, SALES_MODE));
    const malicious = rows.map(row => ({...row, operation: 'OUTRAS', difal: {eligible: true, baseCents: 1, amountCents: 999999}}));
    await uploadLookup(actor, job._id, {offset: 0, rows: malicious});
    await uploadLookup(actor, job._id, {offset: 0, rows});
    await finalizeLookup(actor, job._id);
    await (await collection('providerControl')).deleteMany({});
    await processLookup(actor, job._id, transport);
    assert.equal(providerCalls, 1, 'CPF nunca é consultado no provedor CNPJ.');
    const summary = await purchaseSummary(job._id, true, SALES_MODE);
    assert.deepEqual(summary.difal, {version: DIFAL_VERSION, ratePercent: 10, issuerUf: 'MG', eligibleLines: 4, baseCents: 115010, amountCents: 11502, pendingLines: 1});
    assert.equal(summary.components?.accessoryCents, 990);
    assert.equal(summary.totals.totalCents, 175010, 'DIFAL não aumenta o saldo financeiro nem inclui despesa Z.');
    const detail = await purchaseRows(job._id, 'ALL', 1, true, SALES_MODE);
    assert.deepEqual(detail.items.map((row: any) => row.difal.amountCents), [1500, 0, 0, 0, 10000, 0, 0, 0, 1, 1]);
    const grouped = await purchaseRows(job._id, 'CPF', 1, false, SALES_MODE);
    assert.equal(grouped.items[0].difal.amountCents, 11502); assert.equal(grouped.items[0].difal.pendingLines, 1);
    const csv = await purchaseExport(job._id, 'ALL', 1, SALES_MODE);
    assert(csv.content.includes('"MG";"SP";"10";"150,00";"15,00";"ELIGIBLE"'));
    assert(csv.content.includes('"MG";"";"10";"";"";"Pendente — UF do destinatário ausente"'));
    await assert.rejects(uploadLookup(actor, job._id, {offset: 0, rows: [sale({totalCents: 100000})]}));
    const lines = await collection('purchaseLines'), target = scope({jobId: job._id, index: 0});
    const saved = await lines.findOne(target);
    for (const altered of [{difal: {...saved!.difal, amountCents: 1}}, {recipientUf: 'MG'}, {operation: 'OUTRAS'}]) {
      await lines.updateOne(target, {$set: altered});
      await assert.rejects(purchaseSummary(job._id, true, SALES_MODE), (error: any) => error.code === 'DIFAL_SNAPSHOT');
      await lines.updateOne(target, {$set: {difal: saved!.difal, recipientUf: saved!.recipientUf, operation: saved!.operation}});
    }
    await (await collection('lookupJobs')).updateOne(scope({_id: job._id}), {$inc: {'purchaseInput.difal.amountCents': 1}});
    await assert.rejects(purchaseExport(job._id, 'ALL', 1, SALES_MODE), (error: any) => error.code === 'DIFAL_SNAPSHOT');
    await (await collection('lookupJobs')).updateOne(scope({_id: job._id}), {$inc: {'purchaseInput.difal.amountCents': -1}});
    const rechecked = await recheckLookup(actor, job._id);
    assert.equal(rechecked.issuerUf, 'MG'); assert.deepEqual(rechecked.purchaseInput.difal, summary.difal);
    await (await collection('providerControl')).deleteMany({});
    await processLookup(actor, rechecked._id, transport);
    assert.deepEqual((await purchaseSummary(rechecked._id, true, SALES_MODE)).difal, summary.difal);
    assert.equal(providerCalls, 2);
    const updated = await createLookup(actor, {...input, importId: randomUUID(), expectedRows: 1, issuerUf: 'MG'}, SALES_MODE);
    await uploadLookup(actor, updated._id, {offset: 0, rows: [sale({totalCents: 100000})]}); await finalizeLookup(actor, updated._id);
    assert.equal((await purchaseSummary(updated._id, true, SALES_MODE)).difal?.amountCents, 10000);
    assert.equal((await purchaseSummary(job._id, true, SALES_MODE)).difal?.amountCents, 11502);
    const missing = await createLookup(actor, {...input, importId: randomUUID(), expectedRows: 1, issuerUf: ''}, SALES_MODE);
    await uploadLookup(actor, missing._id, {offset: 0, rows: [sale()]}); await finalizeLookup(actor, missing._id);
    assert.equal((await purchaseSummary(missing._id, true, SALES_MODE)).difal?.pendingLines, 1);
    const legacy = await createLookup(actor, {...input, importId: randomUUID(), expectedRows: 2}, SALES_MODE);
    await (await collection('lookupJobs')).updateOne(scope({_id: legacy._id}), {$unset: {difalVersion: '', issuerUf: ''}});
    await uploadLookup(actor, legacy._id, {offset: 0, rows: rows.slice(0, 2)});
    await uploadLookup(actor, legacy._id, {offset: 0, rows: rows.slice(0, 2)});
    await finalizeLookup(actor, legacy._id); await (await collection('providerControl')).deleteMany({}); await processLookup(actor, legacy._id, transport);
    assert.equal((await purchaseSummary(legacy._id, true, SALES_MODE)).difal, null);
    assert.equal((await lines.findOne(scope({jobId: legacy._id, index: 0})))!.operation, 'OUTRAS');
    assert((await purchaseExport(legacy._id, 'ALL', 1, SALES_MODE)).content.includes('Indisponível — reimporte'));
    const legacyRecheck = await recheckLookup(actor, legacy._id);
    assert.equal(legacyRecheck.difalVersion, undefined); assert.equal(legacyRecheck.issuerUf, undefined);
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const attachment = {...input, importId: randomUUID(), expectedRows: 1, issuerUf: 'MG'};
    const attached = await attachGenerationSale(actor, generation._id, attachment);
    assert.equal((await attachGenerationSale(actor, generation._id, attachment)).job._id, attached.job._id);
    await assert.rejects(attachGenerationSale(actor, generation._id, {...attachment, issuerUf: 'SP'}));
    await uploadLookup(actor, attached.job._id, {offset: 0, rows: [sale()]}); await finalizeLookup(actor, attached.job._id);
    const purchases = await attachGenerationPurchase(actor, generation._id, {...attachment, importId: randomUUID()});
    await uploadLookup(actor, purchases.job._id, {offset: 0, rows: [sale()]}); await finalizeLookup(actor, purchases.job._id);
    assert.equal((await getGeneration(generation._id)).companies[0].sales.issuerUf, 'MG');
    const simulator = await generationSimulator(generation._id, clientId);
    assert.deepEqual(simulator.sales.difal, (await purchaseSummary(attached.job._id, true, SALES_MODE)).difal);
    assert.equal(simulator.purchases.difal, undefined);
    process.env.WORKSPACE_ID = 'different_workspace'; await assert.rejects(purchaseSummary(job._id, true, SALES_MODE)); process.env.WORKSPACE_ID = 'difal_test';
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});
