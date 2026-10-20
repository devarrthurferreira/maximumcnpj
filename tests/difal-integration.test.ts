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
import { digits } from '../src/domain.ts';
import { createSimulation, getSimulation } from '../src/simulation-history.ts';
import { reprocessSimulations, reprocessedSimulationId } from '../src/simulation-reprocessing.ts';
import { projectDifal } from '../public/simulator-projection.js';
import { calculateSimulation, draftToInput } from '../public/simulator-engine.js';
import { buildMonthlyDre } from '../public/simulator-calendar.js';

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

test('5102 histórico V1: todas as competências, prefill atual, nova DRE, exportação e recálculo idempotente',
 {skip: !process.env.MONGODB_URI, timeout:120000}, async () => {
  const oldDb=process.env.MONGODB_DB, oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_difal_5102_'+randomUUID().replaceAll('-','');
  process.env.WORKSPACE_ID='difal_5102_test'; resetLookupIndexes();
  const actor={_id:'tester',role:'admin',name:'Teste',email:'test@example.test'};
  try {
    const clientId=(await importCatalog(actor,[{code:'959',name:'Empresa sintética',uf:'MG'}])).items[0].id;
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
    const rows=Array.from({length:12},(_,month)=>({document:'12345678900',name:'Pessoa sintética',quantity:'1',
      serviceDate:`2025-${String(month+1).padStart(2,'0')}-15`,natureCode:month%2?'5102090':'5102001',
      description:'REGATA SINTÉTICA',recipientUf:'RJ',grossCents:10000,discountCents:1000,accessoryCents:90000,
      freightCents:500,abatementCents:100,totalCents:9400}));
    const sales=(await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),
      fileName:'vendas-sinteticas.csv',expectedRows:rows.length,issuerUf:'MG'})).job;
    // Persist a real V1 snapshot through its original upload/reconciliation path.
    await (await collection('lookupJobs')).updateOne(scope({_id:sales._id}),{$set:{difalVersion:'DIFAL_ESTIMATE_V1'}});
    await uploadLookup(actor,sales._id,{offset:0,rows}); await finalizeLookup(actor,sales._id);
    const purchases=(await attachGenerationPurchase(actor,generation._id,{clientId,importId:randomUUID(),
      fileName:'compras-sinteticas.csv',expectedRows:rows.length})).job;
    await uploadLookup(actor,purchases._id,{offset:0,rows}); await finalizeLookup(actor,purchases._id);
    const archived=await purchaseSummary(sales._id,true,SALES_MODE);
    assert.equal(archived.difal?.version,'DIFAL_ESTIMATE_V1'); assert.equal(archived.difal?.amountCents,0);
    const oldJob=await (await collection('lookupJobs')).findOne(scope({_id:sales._id}));
    const oldRows=await (await collection('purchaseLines')).find(scope({jobId:sales._id})).sort({index:1}).toArray();
    const source=await generationSimulator(generation._id,clientId);
    assert.equal(source.reportMonths,12); assert.equal(source.sales.difal?.eligibleLines,12);
    assert.equal(source.sales.difal?.baseCents,112800); assert.equal(source.sales.difal?.amountCents,11280);
    const monthlyGroups={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:94,purchasesOptantCents:0,purchasesNonOptantCents:94};
    const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{serviceRevenue:0,salesRevenue:94,
      simplePurchases:0,regularPurchases:94,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}};
    const simulationId=randomUUID();
    await createSimulation(actor,{simulationId,generationId:generation._id,clientId,title:'Cenário sintético',
      reportMonths:12,periodConfirmed:true,monthlyGroups,draft,rbt12Source:'MANUAL',rbt12ManualConfirmed:true});
    const simulations=await collection('simulations'), original=(await simulations.findOne(scope({_id:simulationId})))!;
    original.source.sales.difal=archived.difal;
    original.difalProjection=projectDifal(archived.difal,12,sales._id);
    original.engineInput=draftToInput(original.draft,original.difalProjection);
    original.result=calculateSimulation(original.draft,original.difalProjection);
    original.monthlyDre=buildMonthlyDre(original.result,original.draft.year,original.rbt12Manual,original.source.period);
    await simulations.replaceOne(scope({_id:simulationId}),original);
    const oldChild={...structuredClone(original),_id:randomUUID(),parentSimulationId:simulationId,
      reprocessing:{version:'SERVICES_DIFAL_2026_10_V1',originalId:simulationId}};
    await simulations.insertOne(oldChild);
    const result=await reprocessSimulations(actor,{});
    assert.equal(result.version,'SERVICES_DIFAL_2026_10_V2'); assert.equal(result.total,1); assert.equal(result.counts.ok,1);
    const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,simulationId));
    assert.equal(child.difalProjection.sourceVersion,'DIFAL_ESTIMATE_V2');
    assert.equal(child.difalProjection.monthlyCents,940); assert.equal(child.difalProjection.annualCents,11280);
    assert(child.result.regimes.every((regime:any)=>Math.abs(regime.dre.difal+112.8)<1e-9));
    assert.deepEqual(child.draft,original.draft); assert.deepEqual(child.rbt12Manual,original.rbt12Manual);
    await reprocessSimulations(actor,{}); assert.equal(await simulations.countDocuments(scope()),3);
    assert.deepEqual(await simulations.findOne(scope({_id:simulationId})),original);
    assert.deepEqual(await simulations.findOne(scope({_id:oldChild._id})),oldChild);
    assert.deepEqual(await (await collection('lookupJobs')).findOne(scope({_id:sales._id})),oldJob);
    assert.deepEqual(await (await collection('purchaseLines')).find(scope({jobId:sales._id})).sort({index:1}).toArray(),oldRows);
    assert.equal((await purchaseSummary(sales._id,true,SALES_MODE)).difal?.amountCents,0);
    assert((await purchaseExport(sales._id,'ALL',1,SALES_MODE)).content.includes('DIFAL_ESTIMATE_V1'));
    const fresh=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'vendas-corrigidas.csv',
      expectedRows:rows.length,issuerUf:'MG'},SALES_MODE);
    await uploadLookup(actor,fresh._id,{offset:0,rows}); await finalizeLookup(actor,fresh._id);
    assert.equal((await purchaseSummary(fresh._id,true,SALES_MODE)).difal?.amountCents,11280);
    assert((await purchaseExport(fresh._id,'ALL',1,SALES_MODE)).content.includes('"94,00";"9,40";"ELIGIBLE";"DIFAL_ESTIMATE_V2"'));
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});

test('Serviços 9000: totais por enquadramento, separação de mercadorias e prefill conciliado sem duplicação', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_services_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'services_test'; resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  const cnpjs = ['000000000001', '111111110001', '222222220001'].map(base => base + digits(base));
  let providerCalls = 0;
  const transport = (async (url: string | URL | Request) => {
    providerCalls++;
    const cnpj = String(url).split('/').pop();
    if (cnpj === cnpjs[2]) return new Response('', {status: 404});
    return Response.json({cnpj, razao_social: 'Empresa sintética', opcao_pelo_simples: cnpj === cnpjs[0], opcao_pelo_mei: false});
  }) as typeof fetch;
  const row = (document: string, natureCode: string, totalCents: number, serviceDate = '2026-06-15') => ({
    document, natureCode, totalCents, name: 'Parceiro sintético', description: 'Venda de mercadoria', serviceDate, quantity: '1', recipientUf: 'SP',
    grossCents: totalCents, discountCents: 0, accessoryCents: 99, freightCents: 0, abatementCents: 0
  });
  try {
    const clientId = (await importCatalog(actor, [{code: '955', name: 'Empresa sintética de serviços', uf: 'MG'}])).items[0].id;
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const salesRows = [
      row(cnpjs[0], '6108', 10000), row(cnpjs[0], '900000', 10001),
      row(cnpjs[1], '6108', 20000), row(cnpjs[1], '900001', 20002),
      row(cnpjs[2], '6108', 500), row(cnpjs[2], '90001234', 30003),
      row('12345678900', '6108', 40000), row('12345678900', '9.000.01', 40004),
      row('12345678900', '6202', 1000), row('ABC', '9000', 50005), row('', '900000', 60006, '2026-08-15')
    ];
    const sales = await attachGenerationSale(actor, generation._id, {clientId, importId: randomUUID(), fileName: 'servicos-sinteticos.csv', expectedRows: salesRows.length, issuerUf: 'MG'});
    await uploadLookup(actor, sales.job._id, {offset: 0, rows: salesRows}); await finalizeLookup(actor, sales.job._id);
    await (await collection('providerControl')).deleteMany({}); await processLookup(actor, sales.job._id, transport);
    assert.equal(providerCalls, 3);
    const purchaseRows = [row('12345678900', '', 2000, '2026-06-30'), row('12345678900', '', 2500, '2026-08-01')];
    const purchases = await attachGenerationPurchase(actor, generation._id, {clientId, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: purchaseRows.length});
    await uploadLookup(actor, purchases.job._id, {offset: 0, rows: purchaseRows}); await finalizeLookup(actor, purchases.job._id);

    const summary = await purchaseSummary(sales.job._id, true, SALES_MODE);
    assert.deepEqual(summary.serviceGroups, [{status: 'OPTANTE', totalCents: 10001}, {status: 'NAO_OPTANTE', totalCents: 160016}, {status: 'CPF', totalCents: 40004}]);
    assert.equal(summary.servicesTotalCents, 210021); assert.equal(summary.totals.totalCents, 279521);
    assert.equal(summary.operationTotals.find(value => value.operation === 'SERVICO')?.lines, 6);
    assert.equal(summary.difal?.baseCents, 40000, 'Serviços e devoluções permanecem fora da base DIFAL.');
    const source = await generationSimulator(generation._id, clientId);
    assert.deepEqual(source.revenueSplit, {version: 'SALES_SERVICES_V1'});
    assert.deepEqual(source.fields, {salesOptantCents: 10000, salesNonOptantCents: 20500, salesCpfCents: 39000, serviceRevenueCents: 210021,
      purchasesOptantCents: 0, purchasesNonOptantCents: 4500});
    assert.equal(source.sales.servicesTotalCents, 210021); assert.deepEqual(source.sales.operationTotals, summary.operationTotals);
    assert.equal(source.sales.totalCents, 279521); assert.equal(source.projection?.totals.sales.totalCents, 279521);
    assert.equal(source.projection?.totals.sales.monthlyCents, 93174);
    assert.equal(source.projection?.groups.reduce((sum, group) => sum + (group.key.startsWith('sales') || group.key === 'serviceRevenueCents' ? group.monthlyCents : 0), 0), 93174);
    assert.equal(providerCalls, 3, 'Resumo e simulador leem o snapshot sem consultar novamente.');

    const negative = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const negativeSales = await attachGenerationSale(actor, negative._id, {clientId, importId: randomUUID(), fileName: 'devolucoes-sinteticas.csv', expectedRows: 2, issuerUf: 'MG'});
    await uploadLookup(actor, negativeSales.job._id, {offset: 0, rows: [row('12345678900', '900001', 5000), row('12345678900', '6202', 1000)]});
    await finalizeLookup(actor, negativeSales.job._id);
    const negativePurchases = await attachGenerationPurchase(actor, negative._id, {clientId, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: 1});
    await uploadLookup(actor, negativePurchases.job._id, {offset: 0, rows: [row('12345678900', '', 0)]}); await finalizeLookup(actor, negativePurchases.job._id);
    await assert.rejects(generationSimulator(negative._id, clientId), (error: any) => error.code === 'SIMULATOR_NEGATIVE_SALES' && /mercadorias.*serviços/.test(error.message));
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});
