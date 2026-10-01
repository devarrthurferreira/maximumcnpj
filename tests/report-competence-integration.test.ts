import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {routeV4} from '../src/lookup-http.ts';

// Only synthetic CPF rows: this regression never contacts an external CNPJ provider.
test('MongoDB: comparação mensal libera o simulador sem alterar datas, valores ou validação do snapshot', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWorkspace = process.env.WORKSPACE_ID;
  const testDb = 'maximum_competence_test_' + randomUUID().replaceAll('-', '');
  process.env.MONGODB_DB = testDb; process.env.WORKSPACE_ID = 'competence_test'; resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Teste sintético', email: 'test@example.test'};
  const row = (serviceDate: string) => ({document: '12345678900', name: 'Pessoa sintética', serviceDate, quantity: '1',
    grossCents: 12000, discountCents: 2000, accessoryCents: 900, freightCents: 500, abatementCents: 500, totalCents: 10000});
  try {
    const catalog = await importCatalog(actor, [{code: '991', name: 'Empresa sintética'}]);
    const clientId = catalog.items[0].id;
    async function pair(purchaseDates: string[], saleDates: string[]) {
      const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId], requiredReports: ['PURCHASES', 'SALES']});
      const jobs: string[] = [];
      for (const [attach, dates, fileName] of [[attachGenerationPurchase, purchaseDates, 'compras.csv'], [attachGenerationSale, saleDates, 'vendas.csv']] as const) {
        const attached = await attach(actor, generation._id, {clientId, importId: randomUUID(), fileName, expectedRows: dates.length});
        await uploadLookup(actor, attached.job._id, {offset: 0, rows: dates.map(row)});
        await finalizeLookup(actor, attached.job._id); jobs.push(attached.job._id);
      }
      return {id: generation._id, jobs};
    }
    const example = await pair(['2026-04-02', '2026-08-31'], ['2026-04-01', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-31']);
    const lines = await collection('purchaseLines'), jobs = await collection('lookupJobs');
    const before = await lines.find(scope({jobId: {$in: example.jobs}})).sort({_id: 1}).toArray();
    const source: any = await routeV4({...actor, role: 'viewer'}, 'GET', new URL(`https://test/api/v4/generations/${example.id}/simulator?clientId=${clientId}`), {});
    assert.equal(source.periodBasis, 'COLUMN_H'); assert.equal(source.reportMonths, 5);
    assert.equal(source.period.startMonth, '2026-04'); assert.equal(source.period.endMonth, '2026-08');
    assert.equal(source.purchases.period.startDate, '2026-04-02'); assert.equal(source.sales.period.startDate, '2026-04-01');
    assert.equal(source.purchases.period.observedMonths, 2); assert.equal(source.sales.period.observedMonths, 5);
    assert.equal(source.fields.purchasesNonOptantCents, 20000); assert.equal(source.fields.salesCpfCents, 50000);
    assert.equal(source.fields.purchasesOptantCents, 0); assert.equal(source.fields.salesOptantCents, 0);
    assert.equal(source.purchases.totalCents / source.reportMonths, 4000);
    assert(source.warnings.some((message: string) => message.includes('mesmas competências')));
    assert.deepEqual(await lines.find(scope({jobId: {$in: example.jobs}})).sort({_id: 1}).toArray(), before);
    const differentDays = await pair(['2026-04-29', '2026-08-02'], ['2026-04-05', '2026-08-30']);
    assert.equal((await generationSimulator(differentDays.id, clientId)).reportMonths, 5);
    const singleMonth = await pair(['2026-08-01'], ['2026-08-31']);
    assert.equal((await generationSimulator(singleMonth.id, clientId)).reportMonths, 1);
    const crossYear = await pair(['2025-11-30', '2026-02-01'], ['2025-11-01', '2026-02-28']);
    assert.equal((await generationSimulator(crossYear.id, clientId)).reportMonths, 4);
    for (const saleDates of [['2026-05-01', '2026-08-31'], ['2026-04-01', '2026-09-30'], ['2026-05-01', '2026-09-30'], ['2025-04-01', '2025-08-31']]) {
      const different = await pair(['2026-04-02', '2026-08-31'], saleDates);
      await assert.rejects(generationSimulator(different.id, clientId), (error: any) => error.code === 'SIMULATOR_PERIOD' && error.message.includes('competências diferentes'));
    }
    // Matching reports by month must not weaken exact-date reconciliation of EACH original snapshot.
    await jobs.updateOne(scope({_id: example.jobs[0]}), {$set: {'reportPeriod.startDate': '2026-04-01'}});
    await assert.rejects(generationSimulator(example.id, clientId), (error: any) => error.code === 'REPORT_PERIOD');
    await jobs.updateOne(scope({_id: example.jobs[0]}), {$set: {'reportPeriod.startDate': '2026-04-02'}});
    assert.equal((await generationSimulator(example.id, clientId)).reportMonths, 5);
    process.env.WORKSPACE_ID = 'other_workspace';
    await assert.rejects(generationSimulator(example.id, clientId));
    process.env.WORKSPACE_ID = 'competence_test';
  } finally {
    const disposable = await database();
    assert.equal(disposable.databaseName, testDb, 'Limpeza limitada ao banco descartável deste teste.');
    await disposable.dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWorkspace === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWorkspace;
  }
});
