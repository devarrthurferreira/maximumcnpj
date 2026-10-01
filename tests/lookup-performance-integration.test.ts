import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {digits} from '../src/domain.ts';
import {createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup} from '../src/lookup-jobs.ts';
import {lookupProgress} from '../src/lookup-engine.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {routeV4} from '../src/lookup-http.ts';
import {PURCHASE_MODE, SALES_MODE} from '../src/purchase-domain.ts';
import {purchaseSummary} from '../src/purchase-store.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const doc = (n: number) => { const base = '12345678' + String(n).padStart(4, '0'); return base + digits(base); };

test('MongoDB: concorrência limitada, progresso correto, retries, isolamento e revalidação imutável', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const keys = ['MONGODB_DB', 'WORKSPACE_ID', 'LOOKUP_CONCURRENCY', 'LOOKUP_INTERVAL_MS'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const testDatabase = 'maximum_performance_test_' + randomUUID().replaceAll('-', '');
  process.env.MONGODB_DB = testDatabase;
  process.env.WORKSPACE_ID = 'performance_test'; process.env.LOOKUP_CONCURRENCY = '3'; process.env.LOOKUP_INTERVAL_MS = '300'; resetLookupIndexes();
  const actor = {_id: 'performance-tester', role: 'admin', name: 'Teste sintético', email: 'test@example.test'};
  try {
    const catalog = await importCatalog(actor, [{code: '991', name: 'Carteira sintética A'}, {code: '992', name: 'Carteira sintética B'}]);
    const clientId = catalog.items[0].id;
    async function fresh(rows: any[], mode?: string) {
      const job = await createLookup(actor, {importId: randomUUID(), clientId, fileName: 'sintetico.csv', expectedRows: rows.length}, mode);
      for (let offset = 0; offset < rows.length; offset += 250) await uploadLookup(actor, job._id, {offset, rows: rows.slice(offset, offset + 250)});
      await finalizeLookup(actor, job._id); await (await collection('providerControl')).deleteMany({}); return job._id;
    }
    const cnpjs = Array.from({length: 6}, (_, i) => doc(i + 1));
    const id = await fresh([...cnpjs.map(cnpj => ({cnpj, name: 'Empresa sintética'})), {cnpj: cnpjs[0], name: 'Repetida'}, {cnpj: '12345678900', name: 'CPF'}]);
    const before = await lookupProgress(id); assert.equal(before.metrics.total, 6); assert.equal(before.metrics.pending, 6); assert.equal(before.metrics.nonOptants, 0);
    let active = 0, peak = 0; const calls: string[] = [], starts: number[] = [];
    const mock = (async (url: any) => {
      const cnpj = String(url).split('/').at(-1)!; calls.push(cnpj); starts.push(Date.now()); active++; peak = Math.max(peak, active);
      try { await sleep(800); return Response.json({cnpj, razao_social: 'Empresa sintética', opcao_pelo_simples: cnpjs.indexOf(cnpj) % 2 === 0}); }
      finally { active--; }
    }) as typeof fetch;
    const done = await processLookup(actor, id, mock);
    assert.equal(done.status, 'COMPLETED'); assert.equal(calls.length, 6); assert.equal(new Set(calls).size, 6); assert(peak >= 2 && peak <= 3, `concorrência ${peak}`);
    for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 250, 'Pausa global entre inícios deve ser respeitada.');
    const after = await lookupProgress(id); assert.equal(after.metrics.optants, 3); assert.equal(after.metrics.nonOptants, 3); assert.equal(after.metrics.unconfirmed, 0); assert.equal(after.metrics.pending, 0);
    assert.equal((await lookupProgress(id, 1, 'OPTANTE')).total, 3);
    assert(!JSON.stringify(after).includes('passwordHash'));
    const viewer: any = await routeV4({...actor, role: 'viewer'}, 'GET', new URL(`https://test/api/v4/lookups/${id}/progress`), {});
    assert.equal(viewer.canRecheck, false);
    await assert.rejects(routeV4({...actor, role: 'viewer'}, 'POST', new URL(`https://test/api/v4/lookups/${id}/recheck`), {}));
    process.env.WORKSPACE_ID = 'other'; await assert.rejects(lookupProgress(id)); process.env.WORKSPACE_ID = 'performance_test';

    const retryId = await fresh([{cnpj: doc(8), name: 'Indicador ausente'}]);
    let retryCalls = 0;
    const missing = (async () => Response.json({cnpj: doc(8), opcao_pelo_simples: ++retryCalls > 1 ? true : null})) as typeof fetch;
    const pending = await processLookup(actor, retryId, missing); assert.equal(pending.status, 'PROCESSING');
    const waiting = await lookupProgress(retryId); assert.equal(waiting.metrics.retrying, 1); assert.equal(waiting.metrics.nonOptants, 0); assert.equal(waiting.metrics.completed, 0);
    await (await collection('lookupItems')).updateMany(scope({jobId: retryId}), {$set: {nextAt: new Date(0)}});
    await (await collection('providerControl')).deleteMany({});
    assert.equal((await processLookup(actor, retryId, missing)).resultSummary.optants, 1); assert.equal(retryCalls, 2);

    process.env.LOOKUP_CONCURRENCY = '1';
    const limitedId = await fresh([{cnpj: doc(9), name: 'Limite'}, {cnpj: doc(10), name: 'Ainda não consultada'}]);
    let limitedCalls = 0;
    const limited = (async () => { limitedCalls++; return new Response('', {status: 429, headers: {'retry-after': '75'}}); }) as typeof fetch;
    await processLookup(actor, limitedId, limited); await processLookup(actor, limitedId, limited);
    assert.equal(limitedCalls, 1); const limitedProgress = await lookupProgress(limitedId);
    assert.equal(limitedProgress.metrics.nonOptants, 0); assert.equal(limitedProgress.metrics.pending, 1); assert.equal(limitedProgress.metrics.retrying, 1);
    const control = await (await collection('providerControl')).findOne({_id: 'minhareceita-global'}); assert(control!.nextAt.getTime() > Date.now() + 65000);

    const financialRow = (document: string) => ({document, name: 'Parceiro sintético', serviceDate: '2026-08-15', quantity: '1', grossCents: 10000, discountCents: 1000, accessoryCents: 300, freightCents: 2000, abatementCents: 500, totalCents: 10500});
    for (const mode of [PURCHASE_MODE, SALES_MODE]) {
      const financial = await fresh([financialRow(doc(11)), financialRow(doc(11)), financialRow('12345678900')], mode);
      await processLookup(actor, financial, (async () => Response.json({cnpj: doc(11), opcao_pelo_simples: true})) as typeof fetch);
      const oldSummary = await purchaseSummary(financial, true, mode);
      assert.equal(oldSummary.totals.totalCents, 31500);
      const renewed = await recheckLookup(actor, financial); assert.equal(renewed.repeatedFrom, financial); assert.notEqual(renewed._id, financial);
      assert.deepEqual(renewed.reportPeriod, oldSummary.period); assert.equal(renewed.mode, mode); assert.equal(renewed.status, 'PROCESSING'); assert.equal(renewed.generationId, undefined);
      assert.equal((await lookupProgress(renewed._id)).metrics.pending, 1);
      await (await collection('providerControl')).deleteMany({}); let renewedCalls = 0;
      await processLookup(actor, renewed._id, (async () => { renewedCalls++; return Response.json({cnpj: doc(11), opcao_pelo_simples: false}); }) as typeof fetch);
      assert.equal(renewedCalls, 1);
      const newSummary = await purchaseSummary(renewed._id, true, mode);
      assert.deepEqual(newSummary.totals, oldSummary.totals); assert.deepEqual(newSummary.components, oldSummary.components);
      assert.equal(newSummary.groups.find(g => g.status === 'OPTANTE')!.count, 0);
      assert.equal((await purchaseSummary(financial, true, mode)).groups.find(g => g.status === 'OPTANTE')!.count, 1);
      if (mode === SALES_MODE) assert.equal(newSummary.reportingGroups.find(g => g.status === 'CPF')!.totalCents, 10500);
      else assert.equal(newSummary.reportingGroups.find(g => g.status === 'NAO_OPTANTE')!.totalCents, 31500);
    }
    // Equal concurrent source snapshots are shared, but each job gets its own fresh verification.
    process.env.LOOKUP_CONCURRENCY = '3';
    const a = await fresh([{cnpj: doc(12), name: 'Compartilhada'}]), b = await fresh([{cnpj: doc(12), name: 'Compartilhada'}]);
    const shared = (async () => { await sleep(500); return Response.json({cnpj: doc(12), opcao_pelo_simples: true}); }) as typeof fetch;
    const concurrent = await Promise.all([processLookup(actor, a, shared), processLookup(actor, b, shared)]);
    assert(concurrent.every(j => j.status === 'COMPLETED'));
    assert.equal(await (await collection('cnpjStates')).countDocuments(scope({cnpj: doc(12)})), 1);
    assert.equal(await (await collection('lookupItems')).countDocuments(scope({cnpj: doc(12), state: 'DONE'})), 2);
  } finally {
    const disposable = await database();
    assert.equal(disposable.databaseName, testDatabase, 'A limpeza só pode atuar no banco descartável deste teste.');
    await disposable.dropDatabase(); await closeDatabase(); resetLookupIndexes();
    for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  }
});
