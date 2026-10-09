import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {getJob, resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup, cancelLookup} from '../src/lookup-jobs.ts';
import {routeV4} from '../src/lookup-http.ts';
import {LOOKUP_MODE} from '../src/lookup-domain.ts';
import {PURCHASE_MODE, SALES_MODE} from '../src/purchase-domain.ts';
import {purchaseSummary} from '../src/purchase-store.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale, getGeneration} from '../src/generation-store.ts';

const cnpj = '00000000000191';
const actor = {_id: 'recheck-tester', role: 'operator', name: 'Teste sintético', email: 'recheck@example.test'};
const code = (expected: string) => (error: any) => error.code === expected;
const transport = (async () => Response.json({cnpj, razao_social: 'Empresa sintética', opcao_pelo_simples: true})) as typeof fetch;
const row = (document: string) => ({document, name: 'Destinatário sintético', serviceDate: '2026-08-15', quantity: '1',
  natureCode: '6108', description: 'Venda de mercadoria', recipientUf: 'SP', grossCents: 15000, totalCents: 15000,
  discountCents: 0, accessoryCents: 123, freightCents: 0, abatementCents: 0});

test('MongoDB: reconsulta idempotente, retomada de cópia, permissões e snapshots preservados', {skip: !process.env.MONGODB_URI, timeout: 120000}, async t => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  const testDb = 'maximum_recheck_test_' + randomUUID().replaceAll('-', '');
  process.env.MONGODB_DB = testDb; process.env.WORKSPACE_ID = 'recheck_test'; resetLookupIndexes();
  try {
    const clients = await importCatalog({...actor, role: 'admin'}, [{code: '941', name: 'Carteira sintética A', uf: 'MG'}, {code: '942', name: 'Carteira sintética B'}]);
    const clientId = clients.items[0].id;
    async function complete(id: string) {
      await finalizeLookup(actor, id);
      await (await collection('providerControl')).deleteMany({});
      return processLookup(actor, id, transport);
    }
    async function financial(mode = PURCHASE_MODE) {
      const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId], requiredReports: [mode === SALES_MODE ? 'SALES' : 'PURCHASES']});
      const input = {importId: randomUUID(), clientId, fileName: 'sintetico.csv', expectedRows: 3, issuerUf: 'MG'};
      const attached = await (mode === SALES_MODE ? attachGenerationSale : attachGenerationPurchase)(actor, generation._id, input);
      await uploadLookup(actor, attached.job._id, {offset: 0, rows: [row(cnpj), row(cnpj), row('12345678900')]});
      return {job: await complete(attached.job._id), generationId: generation._id};
    }
    const source = await financial();
    await t.test('perda da resposta retorna o mesmo lote financeiro; conclusão não reconsulta nem altera geração anterior', async () => {
      for (const mode of [PURCHASE_MODE, SALES_MODE]) {
        const {job: old, generationId} = mode === PURCHASE_MODE ? source : await financial(mode);
        const before = await purchaseSummary(old._id, true, mode), generation = await getGeneration(generationId);
        const original = await getJob(old._id), importId = randomUUID();
        const url = new URL(`https://test/api/v4/lookups/${old._id}/recheck`);
        const fresh: any = await routeV4(actor, 'POST', url, {importId});
        const retried: any = await routeV4(actor, 'POST', url, {importId});
        assert.equal(fresh._id, importId); assert.equal(retried._id, importId); assert.equal(retried.status, 'PROCESSING');
        assert.equal(retried.repeatedFrom, old._id); assert.equal(retried.generationId, undefined);
        assert.equal(await (await collection('lookupJobs')).countDocuments(scope({repeatedFrom: old._id})), 1);
        assert.equal(await (await collection('lookupItems')).countDocuments(scope({jobId: importId, state: 'PENDING', attempts: 0})), 1);
        assert.equal(await (await collection('purchaseLines')).countDocuments(scope({jobId: importId})), 3);
        const lines = await (await collection('purchaseLines')).find(scope({jobId: old._id})).sort({index: 1}).toArray();
        const copies = await (await collection('purchaseLines')).find(scope({jobId: importId})).sort({index: 1}).toArray();
        const content = (line: any) => {const {_id, jobId, ...data} = line; return data;};
        assert.deepEqual(copies.map(content), lines.map(content), 'Copia valores, naturezas e DIFAL integralmente.');
        let calls = 0;
        await (await collection('providerControl')).deleteMany({});
        await processLookup(actor, importId, (async () => {calls++; return Response.json({cnpj, opcao_pelo_simples: false});}) as typeof fetch);
        assert.equal((await recheckLookup(actor, old._id, {importId})).status, 'COMPLETED');
        assert.equal(calls, 1, 'Apenas um CNPJ único é consultado novamente.');
        const after = await purchaseSummary(importId, true, mode);
        assert.deepEqual(after.totals, before.totals); assert.deepEqual(after.components, before.components);
        if (mode === SALES_MODE) {assert.deepEqual(after.difal, before.difal); assert.equal(after.difal?.amountCents, 1500);}
        assert.equal(after.groups.find(group => group.status === 'NAO_OPTANTE')?.count, 1);
        assert.deepEqual(await purchaseSummary(old._id, true, mode), before);
        assert.deepEqual(await getJob(old._id), original);
        assert.deepEqual(await getGeneration(generationId), generation);
      }
    });
    await t.test('consulta cadastral aceita o mesmo contrato e mantém chamadas antigas sem importId', async () => {
      const old = await createLookup(actor, {importId: randomUUID(), clientId, expectedRows: 3, fileName: 'cadastro.csv'});
      await uploadLookup(actor, old._id, {offset: 0, rows: [{cnpj, name: 'Empresa sintética'}, {cnpj, name: 'Repetida'}, {cnpj: '12345678900', name: 'CPF'}]});
      await complete(old._id);
      const importId = randomUUID();
      const fresh = await recheckLookup(actor, old._id, {importId});
      assert.equal((await recheckLookup(actor, old._id, {importId}))._id, fresh._id);
      assert.deepEqual(fresh.summary, {lines: 1, unique: 1, duplicates: 0, invalid: 0});
      assert.equal(await (await collection('lookupItems')).countDocuments(scope({jobId: importId, state: 'PENDING', attempts: 0})), 1);
      assert.notEqual((await recheckLookup(actor, old._id))._id, (await recheckLookup(actor, old._id, {}))._id);
    });
    await t.test('cópia interrompida retoma o mesmo ID; lease impede tentativa simultânea; cancelamento é definitivo', async () => {
      const id = source.job._id, importId = randomUUID();
      const itemCollection = await collection('lookupItems'), prototype = Object.getPrototypeOf(itemCollection), aggregate = prototype.aggregate;
      let notifyStarted!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => {notifyStarted = resolve;}), blocked = new Promise<void>(resolve => {release = resolve;});
      const patch = t.mock.method(prototype, 'aggregate', function(this: any, ...args: any[]) {
        if (this.collectionName === 'lookupItems' && args[0].some((stage: any) => stage.$merge)) {
          return {toArray: async () => {notifyStarted(); await blocked; throw new Error('Interrupção sintética da cópia');}};
        }
        return aggregate.apply(this, args);
      });
      const pending = recheckLookup(actor, id, {importId}).then(() => null, error => error);
      try {
        await started;
        await assert.rejects(recheckLookup(actor, id, {importId}), code('JOB_BUSY'));
        assert.equal((await getJob(importId)).status, 'UPLOADING');
        assert.equal(await (await collection('purchaseLines')).countDocuments(scope({jobId: importId})), 3);
      } finally {release(); await pending; patch.mock.restore();}
      assert.match((await pending).message, /Interrupção sintética/);
      assert.equal((await getJob(id)).leaseOwner, undefined); assert.equal((await getJob(importId)).leaseOwner, undefined);
      await assert.rejects(uploadLookup(actor, importId, {offset: 0, rows: [row(cnpj)]}), code('RECHECK_SOURCE'));
      await assert.rejects(finalizeLookup(actor, importId), code('RECHECK_SOURCE'));
      const resumed = await recheckLookup(actor, id, {importId});
      assert.equal(resumed.status, 'PROCESSING');
      assert.equal(await (await collection('purchaseLines')).countDocuments(scope({jobId: importId})), 3);
      assert.equal(await (await collection('lookupItems')).countDocuments(scope({jobId: importId})), 1);
      await cancelLookup(actor, importId);
      await assert.rejects(recheckLookup(actor, id, {importId}), code('RECHECK_CANCELLED'));
      assert.equal((await getJob(id)).status, 'COMPLETED');
    });
    await t.test('ID reservado não admite troca de autor, origem, upload comum ou workspace', async () => {
      const id = source.job._id, importId = randomUUID();
      const fresh = await recheckLookup(actor, id, {importId});
      await assert.rejects(recheckLookup({...actor, _id: 'other-operator'}, id, {importId}), code('LOOKUP_EXISTS'));
      await assert.rejects(recheckLookup({...actor, role: 'viewer'}, id, {importId: randomUUID()}), code('FORBIDDEN'));
      const other = await financial();
      await assert.rejects(recheckLookup(actor, other.job._id, {importId}), code('LOOKUP_EXISTS'));
      await assert.rejects(createLookup(actor, {importId, clientId, expectedRows: fresh.expectedRows, fileName: fresh.fileName}, PURCHASE_MODE), code('LOOKUP_EXISTS'));
      const normalId = randomUUID();
      await createLookup(actor, {importId: normalId, clientId, expectedRows: fresh.expectedRows, fileName: fresh.fileName}, PURCHASE_MODE);
      await assert.rejects(recheckLookup(actor, id, {importId: normalId}), code('LOOKUP_EXISTS'));
      await assert.rejects(recheckLookup(actor, id, {importId: id}), code('LOOKUP_EXISTS'));
      await assert.rejects(recheckLookup(actor, id, {importId: '------------------------------------'}), code('VALIDATION'));
      process.env.WORKSPACE_ID = 'other_workspace';
      await assert.rejects(recheckLookup(actor, id, {importId: randomUUID()}), code('NOT_FOUND'));
      process.env.WORKSPACE_ID = 'recheck_test';
      const foreignId = randomUUID();
      await (await collection('lookupJobs')).insertOne({_id: foreignId, workspaceId: 'other_workspace', mode: LOOKUP_MODE, createdBy: actor._id});
      await assert.rejects(recheckLookup(actor, id, {importId: foreignId}), code('LOOKUP_EXISTS'));
      assert.equal((await getJob(importId)).repeatedFrom, id);
    });
  } finally {
    const disposable = await database(); assert.equal(disposable.databaseName, testDb);
    await disposable.dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});
