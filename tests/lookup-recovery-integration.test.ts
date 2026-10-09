import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {digits} from '../src/domain.ts';
import {createLookup, uploadLookup, finalizeLookup, processLookup} from '../src/lookup-jobs.ts';
import {lookupProgress} from '../src/lookup-engine.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {PURCHASE_MODE} from '../src/purchase-domain.ts';
import {purchaseSummary} from '../src/purchase-store.ts';

test('MongoDB: fonte alternativa consulta os 25 CNPJs e reconcilia 551 linhas sem enviar CPFs', {skip: !process.env.MONGODB_URI, timeout: 60000}, async () => {
  const keys = ['MONGODB_DB', 'WORKSPACE_ID', 'LOOKUP_CONCURRENCY', 'LOOKUP_INTERVAL_MS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.MONGODB_DB = 'maximum_recovery_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'source_recovery';
  process.env.LOOKUP_CONCURRENCY = '4'; process.env.LOOKUP_INTERVAL_MS = '300'; resetLookupIndexes();
  const actor = {_id: 'recovery-test', role: 'admin', name: 'Teste sintético', email: 'recovery@example.test'};
  try {
    const catalog = await importCatalog(actor, [{code: '990', name: 'Empresa sintética de recuperação'}]);
    const clientId = catalog.items[0].id;
    const cnpjs = Array.from({length: 25}, (_, index) => {
      const base = '12345678' + String(index + 1).padStart(4, '0'); return base + digits(base);
    });
    const documents = [...cnpjs, ...Array.from({length: 322}, (_, index) => '9' + String(index).padStart(10, '0'))];
    const rows = Array.from({length: 551}, (_, index) => {
      const amount = index === 550 ? 42785598 - 550 * 77000 : 77000;
      return {document: documents[index % documents.length], name: 'Parceiro sintético', quantity: '1', serviceDate: '2026-08-15',
        grossCents: amount, discountCents: 0, accessoryCents: 0, freightCents: 0, abatementCents: 0, totalCents: amount};
    });
    const job = await createLookup(actor, {importId: randomUUID(), clientId, fileName: 'compras-sinteticas.csv', expectedRows: rows.length}, PURCHASE_MODE);
    for (let offset = 0; offset < rows.length; offset += 250) await uploadLookup(actor, job._id, {offset, rows: rows.slice(offset, offset + 250)});
    await finalizeLookup(actor, job._id);
    const calls: {host: string; cnpj: string}[] = [];
    const transport = (async (input: any) => {
      const url = new URL(String(input)), cnpj = url.pathname.split('/').at(-1)!;
      assert(cnpjs.includes(cnpj), 'Apenas os CNPJs válidos do relatório podem sair para a API.');
      calls.push({host: url.hostname, cnpj});
      if (url.hostname === 'minhareceita.org') return Response.json({message: 'Indisponível'}, {status: 503});
      assert.equal(url.hostname, 'api.opencnpj.org');
      return Response.json({cnpj, razao_social: 'Parceiro sintético', opcao_simples: cnpjs.indexOf(cnpj) < 12 ? 'S' : 'N', opcao_mei: 'N'});
    }) as typeof fetch;
    const completed = await processLookup(actor, job._id, transport);
    assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.source, 'OpenCNPJ');
    assert.equal(calls.length, 50);
    for (const host of ['minhareceita.org', 'api.opencnpj.org']) assert.equal(new Set(calls.filter(call => call.host === host).map(call => call.cnpj)).size, 25);
    const progress = await lookupProgress(job._id, 1, 'ALL', true);
    assert.deepEqual(progress.diagnostics, {confirmed: 25, unconfirmed: 0, reasons: [], sources: [{name: 'OpenCNPJ', count: 25}]});
    assert.equal(progress.metrics.optants, 12); assert.equal(progress.metrics.nonOptants, 13);
    const report = await purchaseSummary(job._id, true, PURCHASE_MODE);
    assert.equal(report.totals.totalCents, 42785598); assert.equal(report.totals.lines, 551);
    assert.equal(report.totals.uniqueDocuments, 347); assert.equal(report.totals.uniqueCnpjs, 25);
    assert.equal(report.groups.find(group => group.status === 'NAO_CONFIRMADO')!.count, 0);
    assert.equal(report.reportingGroups.reduce((sum, group) => sum + group.totalCents, 0), 42785598);
    assert(report.groups.find(group => group.status === 'OPTANTE')!.totalCents > 0);
    await processLookup(actor, job._id, (async () => { throw new Error('Snapshot concluído não deve consultar de novo.'); }) as typeof fetch);
    assert.equal(calls.length, 50);

    // Exhausted source errors remain explicitly unknown, even in a compact read.
    const failed = await createLookup(actor, {importId: randomUUID(), clientId, fileName: 'indisponibilidade.csv', expectedRows: 1}, PURCHASE_MODE);
    await uploadLookup(actor, failed._id, {offset: 0, rows: [rows[0]]}); await finalizeLookup(actor, failed._id);
    await (await collection('lookupItems')).updateMany(scope({jobId: failed._id}), {$set: {attempts: 2}});
    await (await collection('providerControl')).deleteMany({});
    const bothDown = (async () => Response.json({message: 'Indisponível'}, {status: 503})) as typeof fetch;
    assert.equal((await processLookup(actor, failed._id, bothDown)).status, 'COMPLETED');
    const diagnostics = await lookupProgress(failed._id, 1, 'ALL', true);
    assert.equal(diagnostics.diagnostics.confirmed, 0); assert.equal(diagnostics.diagnostics.unconfirmed, 1);
    assert.deepEqual(diagnostics.diagnostics.reasons, [{code: 'FONTE_INDISPONIVEL', count: 1}]);
    assert.deepEqual(diagnostics.diagnostics.sources, [{name: 'Minha Receita / OpenCNPJ', count: 1}]);
    assert.equal(diagnostics.metrics.nonOptants, 0);
    assert.deepEqual((await lookupProgress(failed._id, 1, 'NAO_CONFIRMADO')).diagnostics, diagnostics.diagnostics);
    const original = await purchaseSummary(failed._id, true, PURCHASE_MODE);
    assert.equal(original.groups.find(group => group.status === 'NAO_CONFIRMADO')!.count, 1);
    assert.equal(original.groups.find(group => group.status === 'NAO_OPTANTE')!.count, 0);
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
