import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup, processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {purchaseSummary} from '../src/purchase-store.ts';
import {PURCHASE_MODE,SALES_MODE} from '../src/purchase-domain.ts';
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
    await uploadLookup(actor, purchases._id, {offset: 0, rows: [line(9000, '12345678900', '1102')]});
    await finalizeLookup(actor, purchases._id);
    const sales = (await attachGenerationSale(actor, generation._id, {
      importId: randomUUID(), clientId, fileName: 'vendas-sinteticas.csv', expectedRows: 5, issuerUf: 'MG'
    })).job;
    await uploadLookup(actor, sales._id, {offset: 0, rows: [
      line(40000, '00000000000191', '5102'), line(5000, '00000000000191', '900001'),
      line(20000, '12345678900', '6108'), line(7000, '12345678900', '900000'), line(0, '12345678900', '5901')
    ]});
    await finalizeLookup(actor, sales._id); await processLookup(actor, sales._id, transport);
    const current = await generationSimulator(generation._id, clientId);
    await t.test('fontes já classificadas validam as bases selecionadas e a conferência congelada',async()=>{
      const snapshot:any={_id:randomUUID(),generationId:generation._id,clientId,company:current.company,source:structuredClone(current),reportMonths:1,reportPeriod:current.period};
      const rebuilt=await rebuildSimulationSource(snapshot);
      assert.deepEqual(rebuilt.fields,current.fields);assert.deepEqual(rebuilt.operationAudit,current.operationAudit);
      assert.equal(rebuilt.purchases.totalCents,current.purchases.totalCents);
      const bad=structuredClone(snapshot);bad.source.fields.purchasesNonOptantCents++;
      await assert.rejects(rebuildSimulationSource(bad),(error:any)=>error.code==='REPROCESS_SOURCE');
      const badAudit=structuredClone(snapshot);badAudit.source.operationAudit.excludedSalesCents++;
      await assert.rejects(rebuildSimulationSource(badAudit),(error:any)=>error.code==='REPROCESS_SOURCE');
      const badMonth=structuredClone(snapshot);badMonth.source.monthlyReports[0].fields.salesCpfCents=0;
      await assert.rejects(rebuildSimulationSource(badMonth),(error:any)=>error.code==='REPROCESS_SOURCE');
      const badMonthAudit=structuredClone(snapshot);badMonthAudit.source.monthlyReports[0].operationAudit.excludedSalesCents++;
      await assert.rejects(rebuildSimulationSource(badMonthAudit),(error:any)=>error.code==='REPROCESS_SOURCE');
      const legacyMonthly=structuredClone(snapshot);delete legacyMonthly.source.operationVersion;delete legacyMonthly.source.operationAudit;
      assert.deepEqual((await rebuildSimulationSource(legacyMonthly)).fields,current.fields);
      legacyMonthly.source.monthlyReports[0].fields.salesCpfCents=0;
      await assert.rejects(rebuildSimulationSource(legacyMonthly),(error:any)=>error.code==='REPROCESS_SOURCE');

    });
    await t.test('metadados de natureza adulterados bloqueiam relatório e simulador antes da emissão',async()=>{
      const stored=await collection('purchaseLines'),jobs=await collection('lookupJobs');
      for(const [job,mode] of [[purchases,PURCHASE_MODE],[sales,SALES_MODE]] as const){
        const query=scope({jobId:job._id,index:0}),baseline=(await stored.findOne(query))!;
        for(const patch of [{operationVersion:'INVALID'},{natureOperation:'OUTRAS'},{natureCode:'11.02'},{recipientUf:'sp'},{description:null}]){
          await stored.updateOne(query,{$set:patch});
          try{
            await assert.rejects(purchaseSummary(job._id,true,mode),(error:any)=>error.code==='OPERATION_SNAPSHOT');
            await assert.rejects(generationSimulator(generation._id,clientId),(error:any)=>error.code==='OPERATION_SNAPSHOT');
          }finally{await stored.replaceOne(query,baseline);}
        }
        await jobs.updateOne(scope({_id:job._id}),{$set:{operationVersion:'UNKNOWN'}});
        try{await assert.rejects(purchaseSummary(job._id,true,mode),(error:any)=>error.code==='OPERATION_VERSION');}
        finally{await jobs.updateOne(scope({_id:job._id}),{$set:{operationVersion:current.operationVersion}});}
      }
    });
    await t.test('reconstrói receita negativa e alertas sem alterar os relatórios ou consultar novamente',async()=>{
      const negativeGeneration=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
      const negativePurchases=(await attachGenerationPurchase(actor,negativeGeneration._id,{importId:randomUUID(),clientId,fileName:'compras-devolucoes-sinteticas.csv',expectedRows:2,issuerUf:'MG'})).job;
      await uploadLookup(actor,negativePurchases._id,{offset:0,rows:[line(9000,'12345678900','1102'),line(100000,'12345678900','1202')]});
      await finalizeLookup(actor,negativePurchases._id);
      const negativeSales=(await attachGenerationSale(actor,negativeGeneration._id,{importId:randomUUID(),clientId,fileName:'vendas-servicos-sinteticos.csv',expectedRows:2,issuerUf:'MG'})).job;
      await uploadLookup(actor,negativeSales._id,{offset:0,rows:[line(20000,'12345678900','5102'),line(5000,'12345678900','9000')]});
      await finalizeLookup(actor,negativeSales._id);
      const negativeSource=await generationSimulator(negativeGeneration._id,clientId);
      const snapshot:any={_id:randomUUID(),generationId:negativeGeneration._id,clientId,company:negativeSource.company,source:structuredClone(negativeSource),reportMonths:1,reportPeriod:negativeSource.period};
      const before=structuredClone(snapshot),calls=providerCalls;
      const query=scope({jobId:{$in:[negativePurchases._id,negativeSales._id]}}),stored=await collection('purchaseLines');
      const originalRows=await stored.find(query).sort({jobId:1,index:1}).toArray();
      const rebuilt=await rebuildSimulationSource(snapshot);
      assert.equal(rebuilt.fields.salesCpfCents,-80000);assert.equal(rebuilt.fields.serviceRevenueCents,5000);
      assert.equal(rebuilt.sales.selectedTotalCents,-75000);assert.equal(rebuilt.sales.totalCents,25000);
      assert.equal(rebuilt.purchases.selectedTotalCents,9000);assert.equal(rebuilt.purchases.totalCents,109000);
      assert.equal(rebuilt.reprocessingSource.recalculatedSalesTotalCents,-75000);
      assert(rebuilt.warnings.some(warning=>warning.startsWith('Conferência financeira · 2026-08:')));
      assert(rebuilt.warnings.some(warning=>warning.includes('não impedem continuar')));
      assert.deepEqual(rebuilt.fields,negativeSource.fields);assert.deepEqual(snapshot,before);
      assert.deepEqual(await stored.find(query).sort({jobId:1,index:1}).toArray(),originalRows);
      assert.equal(providerCalls,calls);
      const bad=structuredClone(snapshot);bad.source.monthlyReports[0].fields.salesCpfCents++;
      await assert.rejects(rebuildSimulationSource(bad),(error:any)=>error.code==='REPROCESS_SOURCE');
    });
    const source: any = structuredClone(current);
    delete source.operationVersion; delete source.operationAudit; delete source.monthlyReports;
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
    await jobs.updateOne(scope({_id: sales._id}), {$unset: {operationVersion:'',difalVersion: '', 'purchaseInput.difal': ''}});
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
      assert.equal(rebuilt.sales.difal?.version, 'DIFAL_ESTIMATE_V5');
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
    await t.test('devolução de compra na venda é excluída da receita e preserva o total do relatório', async () => {
      await lines.updateOne(scope({jobId: sales._id, index: 2}), {$set: {natureCode: '620201'}});
      try {
        const rebuilt = await rebuildSimulationSource(original);
        assert.equal(rebuilt.fields.salesCpfCents, 0); assert.equal(rebuilt.sales.totalCents, 72000);
        assert.equal(rebuilt.sales.selectedTotalCents,52000);assert.equal(rebuilt.operationAudit.excludedSalesCents,20000);
        assert.equal(rebuilt.reprocessingSource.originalSalesTotalCents, 72000);
        assert.equal(rebuilt.reprocessingSource.salesBalanceChangeCents, -20000);
        assert.equal(rebuilt.sales.difal?.amountCents, 0, 'Vendas a CNPJ e devoluções não compõem a base de DIFAL de vendas.');
        assert(rebuilt.warnings.some((warning: string) => warning.includes('não é um ajuste manual')));
        await lines.updateOne(scope({jobId: sales._id, index: 0}), {$set: {natureCode: '6202'}});
        assert.equal((await rebuildSimulationSource(original)).sales.selectedTotalCents,12000);
      } finally {
        await lines.updateOne(scope({jobId: sales._id, index: 0}), {$set: {natureCode: '5102'}});
        await lines.updateOne(scope({jobId: sales._id, index: 2}), {$set: {natureCode: '6108'}});
      }
    });
    await t.test('evidência de operação ausente é identificada para revisão, não inventa venda elegível', async () => {
      await lines.updateOne(scope({jobId: sales._id, index: 3}), {$unset: {natureCode: '', description: ''}});
      try {
        await assert.rejects(rebuildSimulationSource(original),(error:any)=>error.code==='SIMULATION_OPERATIONS');
      } finally {await lines.updateOne(scope({jobId: sales._id, index: 3}), {$set: {natureCode: '9000', description: ''}});}
    });
    await t.test('compras antigas sem natureza bloqueiam a regra nova sem modificar o histórico',async()=>{
      await lines.updateOne(scope({jobId:purchases._id,index:0}),{$unset:{natureCode:''}});
      await jobs.updateOne(scope({_id:purchases._id}),{$unset:{operationVersion:'',anticipationVersion:''}});
      try{await assert.rejects(rebuildSimulationSource(original),(error:any)=>error.code==='SIMULATION_OPERATIONS');}
      finally{await lines.updateOne(scope({jobId:purchases._id,index:0}),{$set:{natureCode:'1102'}});await jobs.updateOne(scope({_id:purchases._id}),{$set:{operationVersion:current.operationVersion,anticipationVersion:purchases.anticipationVersion}});}
      assert.deepEqual(original,archivedSnapshot);
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
