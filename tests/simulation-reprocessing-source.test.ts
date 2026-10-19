import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup, processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {rebuildSimulationSource} from '../src/simulation-reprocessing-source.ts';
import {annualizeReports} from '../public/simulator-projection.js';

test('Recálculo reconstrói serviços, devoluções e DIFAL sobre linhas congeladas sem novas consultas',
  {skip: !process.env.MONGODB_URI, timeout: 120000}, async t => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_rebuild_source_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'rebuild-source-test'; resetLookupIndexes();
  const actor = {_id: 'rebuild-tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  let providerCalls = 0;
  const transport = (async () => {
    providerCalls++;
    return Response.json({cnpj: '00000000000191', razao_social: 'Empresa sintética', opcao_pelo_simples: true, opcao_pelo_mei: false});
  }) as typeof fetch;
  const line = (totalCents: number, document: string, natureCode: string) => ({
    document, name: 'Pessoa sintética', natureCode, description: '', recipientUf: 'SP',
    serviceDate: '2026-08-15', quantity: '1', totalCents, grossCents: totalCents,
    discountCents: 0, accessoryCents: 90, freightCents: 0, abatementCents: 0
  });
  try {
    const clientId = (await importCatalog(actor, [{code: '970', name: 'Empresa sintética', uf: 'MG'}])).items[0].id;
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const purchases = (await attachGenerationPurchase(actor, generation._id, {
      importId: randomUUID(), clientId, fileName: 'compras-sinteticas.csv', expectedRows: 1
    })).job;
    await uploadLookup(actor, purchases._id, {offset: 0, rows: [line(9000, '12345678900', '5102')]});
    await finalizeLookup(actor, purchases._id);
    const sales = (await attachGenerationSale(actor, generation._id, {
      importId: randomUUID(), clientId, fileName: 'vendas-sinteticas.csv', expectedRows: 5, issuerUf: 'MG'
    })).job;
    await uploadLookup(actor, sales._id, {offset: 0, rows: [
      line(40000, '00000000000191', '5102'), line(5000, '00000000000191', '900001'),
      line(20000, '12345678900', '6108'), line(7000, '12345678900', '900000'), line(0, '12345678900', '')
    ]});
    await finalizeLookup(actor, sales._id); await processLookup(actor, sales._id, transport);
    const current = await generationSimulator(generation._id, clientId);
    const source: any = structuredClone(current);
    delete source.revenueSplit; delete source.fields.serviceRevenueCents;
    source.fields.salesOptantCents = 45000; source.fields.salesCpfCents = 27000;
    delete source.sales.difal; delete source.sales.servicesTotalCents; delete source.sales.operationTotals;
    source.projection = annualizeReports(source.fields, 1);
    const original: any = {_id: randomUUID(), generationId: generation._id, clientId,
      company: structuredClone(source.company), source, reportMonths: 1, reportPeriod: structuredClone(source.period), periodConfirmed: true};
    const lines = await collection('purchaseLines'), jobs = await collection('lookupJobs');
    // Archive fixture predating persisted operation/DIFAL, with the original values,
    // document snapshot, nature and destination UF still available for reconstruction.
    await lines.updateMany(scope({jobId: sales._id}), {$unset: {operation: '', balanceCents: '', difal: ''}});
    await lines.updateOne(scope({jobId: sales._id, index: 1}), {$set: {natureCode: '9.000.01'}});
    await jobs.updateOne(scope({_id: sales._id}), {$unset: {difalVersion: '', 'purchaseInput.difal': ''}});
    const archivedRows = await lines.find(scope({jobId: sales._id})).sort({index: 1}).toArray();
    const archivedJob = await jobs.findOne(scope({_id: sales._id}));
    const archivedSnapshot = structuredClone(original);
    const archivedItems = await (await collection('lookupItems')).find(scope({jobId: sales._id})).toArray();
    // A current address edit must never complete an old missing UF.
    await (await collection('clients')).updateOne(scope({_id: clientId}), {$set: {uf: 'SP'}});

    await t.test('separa 9000 por enquadramento e reconstrói DIFAL com UFs arquivadas', async () => {
      const rebuilt = await rebuildSimulationSource(original);
      assert.deepEqual(rebuilt.fields, {salesOptantCents: 40000, salesNonOptantCents: 0, salesCpfCents: 20000,
        serviceRevenueCents: 12000, purchasesOptantCents: 0, purchasesNonOptantCents: 9000});
      assert.equal(rebuilt.sales.totalCents, 72000);
      assert.equal(rebuilt.sales.difal?.amountCents, 2000); assert.equal(rebuilt.sales.difal?.pendingLines, 0);
      assert.equal(rebuilt.reprocessingSource.originalSalesTotalCents, 72000);
      assert.equal(rebuilt.reprocessingSource.salesBalanceChangeCents, 0);
      assert.equal(rebuilt.reprocessingSource.missingOperationEvidenceLines, 0, 'Linha neutra sem evidência não bloqueia a receita.');
      assert.equal(rebuilt.reprocessingSource.issuerUfSource, 'ORIGINAL_JOB');
      assert.deepEqual(rebuilt.period, original.source.period);
      assert.equal(rebuilt.projection?.totals.sales.totalCents, 72000);
      assert.deepEqual(await lines.find(scope({jobId: sales._id})).sort({index: 1}).toArray(), archivedRows);
      assert.deepEqual(await jobs.findOne(scope({_id: sales._id})), archivedJob);
      assert.deepEqual(await (await collection('lookupItems')).find(scope({jobId: sales._id})).toArray(), archivedItems);
      assert.deepEqual(original, archivedSnapshot); assert.equal(providerCalls, 1);
    });
    await t.test('ausência de UF histórica fica pendente; cadastro atual não é utilizado', async () => {
      await jobs.updateOne(scope({_id: sales._id}), {$unset: {issuerUf: ''}});
      try {
        const rebuilt = await rebuildSimulationSource(original);
        assert.equal(rebuilt.sales.difal?.pendingLines, 1); assert.equal(rebuilt.sales.difal?.amountCents, 0);
        assert.equal(rebuilt.reprocessingSource.issuerUfSource, 'UNAVAILABLE');
        const withFrozenUf = structuredClone(original); withFrozenUf.source.sales.difal = current.sales.difal;
        const fromFrozen = await rebuildSimulationSource(withFrozenUf);
        assert.equal(fromFrozen.sales.difal?.amountCents, 2000);
        assert.equal(fromFrozen.reprocessingSource.issuerUfSource, 'ORIGINAL_SIMULATION');
      } finally {await jobs.updateOne(scope({_id: sales._id}), {$set: {issuerUf: 'MG'}});}
      await lines.updateOne(scope({jobId: sales._id, index: 2}), {$unset: {recipientUf: ''}});
      try {assert.equal((await rebuildSimulationSource(original)).sales.difal?.pendingLines, 1);}
      finally {await lines.updateOne(scope({jobId: sales._id, index: 2}), {$set: {recipientUf: 'SP'}});}
    });
    await t.test('devolução antes sem operação altera apenas o saldo reconstruído e registra o delta', async () => {
      await lines.updateOne(scope({jobId: sales._id, index: 2}), {$set: {natureCode: '620201'}});
      try {
        const rebuilt = await rebuildSimulationSource(original);
        assert.equal(rebuilt.fields.salesCpfCents, -20000); assert.equal(rebuilt.sales.totalCents, 32000);
        assert.equal(rebuilt.reprocessingSource.originalSalesTotalCents, 72000);
        assert.equal(rebuilt.reprocessingSource.salesBalanceChangeCents, -40000);
        assert.equal(rebuilt.sales.difal?.amountCents, 0);
        assert(rebuilt.warnings.some((warning: string) => warning.includes('não é um ajuste manual')));
        await lines.updateOne(scope({jobId: sales._id, index: 0}), {$set: {natureCode: '6202'}});
        await assert.rejects(rebuildSimulationSource(original), (error: any) => error.status === 409 && error.code === 'REPROCESS_SOURCE');
      } finally {
        await lines.updateOne(scope({jobId: sales._id, index: 0}), {$set: {natureCode: '5102'}});
        await lines.updateOne(scope({jobId: sales._id, index: 2}), {$set: {natureCode: '6108'}});
      }
    });
    await t.test('evidência de operação ausente é identificada para revisão, não inventa venda elegível', async () => {
      await lines.updateOne(scope({jobId: sales._id, index: 3}), {$unset: {natureCode: '', description: ''}});
      try {
        const rebuilt = await rebuildSimulationSource(original);
        assert.equal(rebuilt.reprocessingSource.missingOperationEvidenceLines, 1);
        assert.equal(rebuilt.fields.serviceRevenueCents, 5000);
        assert.equal(rebuilt.sales.difal?.amountCents, 2000);
      } finally {await lines.updateOne(scope({jobId: sales._id, index: 3}), {$set: {natureCode: '9000', description: ''}});}
    });
    await t.test('origem, competência, componentes e workspace divergentes bloqueiam antes do recálculo', async () => {
      for (const bad of [
        {...original, clientId: randomUUID()},
        {...original, source: {...source, sales: {...source.sales, totalCents: 1}}},
        {...original, reportPeriod: {...original.reportPeriod, startMonth: '2026-07'}}
      ]) await assert.rejects(rebuildSimulationSource(bad), (error: any) => error.code === 'REPROCESS_SOURCE');
      await lines.updateOne(scope({jobId: sales._id, index: 0}), {$inc: {grossCents: 1}});
      try {await assert.rejects(rebuildSimulationSource(original), (error: any) => error.code === 'PURCHASE_TOTAL');}
      finally {await lines.updateOne(scope({jobId: sales._id, index: 0}), {$inc: {grossCents: -1}});}
      process.env.WORKSPACE_ID = 'outside';
      try {await assert.rejects(rebuildSimulationSource(original), (error: any) => error.status === 404);}
      finally {process.env.WORKSPACE_ID = 'rebuild-source-test';}
      assert.equal(providerCalls, 1);
    });
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});
