import {Collection} from 'mongodb';
import {baselineMonth} from '../public/simulator-monthly.js';
import {annualizeReports} from '../public/simulator-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup } from '../src/lookup-jobs.ts';
import { SALES_MODE } from '../src/purchase-domain.ts';
import { purchaseSummary, purchaseRows, purchaseExport, currentSalesDocumentDifal } from '../src/purchase-store.ts';
import { DIFAL_VERSION, DIFAL_CPF_ONLY_VERSION, DIFAL_CPF_CNPJ_VERSION } from '../src/difal.ts';
import { createGeneration, attachGenerationSale, attachGenerationPurchase, getGeneration, deleteGeneration } from '../src/generation-store.ts';
import { generationSimulator } from '../src/simulator-store.ts';
import { digits } from '../src/domain.ts';
import { createSimulation, getSimulation } from '../src/simulation-history.ts';
import { reprocessSimulations, reprocessedSimulationId, REPROCESS_VERSION } from '../src/simulation-reprocessing.ts';
import { projectDifal } from '../public/simulator-projection.js';
import { calculateSimulation, draftToInput } from '../public/simulator-engine.js';
import { buildMonthlyDre } from '../public/simulator-calendar.js';
import { buildAnalysisPeriod } from '../public/analysis-period.js';
import { digest } from '../src/security.ts';

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
    assert.deepEqual(summary.difal, {version: DIFAL_VERSION, ratePercent: 10, issuerUf: 'MG', eligibleLines: 0, baseCents: 0, amountCents: 0, pendingLines: 0});
    assert.equal(summary.components?.accessoryCents, 990);
    assert.equal(summary.totals.totalCents, 175010, 'DIFAL não aumenta o saldo financeiro nem inclui despesa Z.');
    const detail = await purchaseRows(job._id, 'ALL', 1, true, SALES_MODE);
    assert.deepEqual(detail.items.map((row: any) => row.difal.amountCents), Array(10).fill(0));
    const grouped = await purchaseRows(job._id, 'CPF', 1, false, SALES_MODE);
    assert.equal(grouped.items[0].difal.amountCents, 0); assert.equal(grouped.items[0].difal.pendingLines, 0);
    const csv = await purchaseExport(job._id, 'ALL', 1, SALES_MODE);
    assert(csv.content.includes('"MG";"SP";"0";"0,00";"0,00";"OUTGOING_DISABLED"'));
    assert(csv.content.includes('"MG";"";"0";"0,00";"0,00";"OUTGOING_DISABLED"'));
    await assert.rejects(uploadLookup(actor, job._id, {offset: 0, rows: [sale({totalCents: 100000})]}));
    const lines = await collection('purchaseLines'), target = scope({jobId: job._id, index: 0});
    const saved = await lines.findOne(target);
    for (const altered of [{difal: {...saved!.difal, amountCents: 1}}, {recipientUf: 'sp'}, {operation: 'OUTRAS'}]) {
      await lines.updateOne(target, {$set: altered});
      await assert.rejects(purchaseSummary(job._id, true, SALES_MODE), (error: any) => error.code === (Object.hasOwn(altered,'recipientUf')?'OPERATION_SNAPSHOT':'DIFAL_SNAPSHOT'));
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
    assert.equal((await purchaseSummary(updated._id, true, SALES_MODE)).difal?.amountCents, 0);
    assert.equal((await purchaseSummary(job._id, true, SALES_MODE)).difal?.amountCents, 0);
    const missing = await createLookup(actor, {...input, importId: randomUUID(), expectedRows: 1, issuerUf: ''}, SALES_MODE);
    await uploadLookup(actor, missing._id, {offset: 0, rows: [sale()]}); await finalizeLookup(actor, missing._id);
    assert.equal((await purchaseSummary(missing._id, true, SALES_MODE)).difal?.pendingLines, 0);
    const legacy = await createLookup(actor, {...input, importId: randomUUID(), expectedRows: 2}, SALES_MODE);
    await (await collection('lookupJobs')).updateOne(scope({_id: legacy._id}), {$unset: {operationVersion:'',difalVersion: '', issuerUf: ''}});
    await uploadLookup(actor, legacy._id, {offset: 0, rows: rows.slice(0, 2)});
    await uploadLookup(actor, legacy._id, {offset: 0, rows: rows.slice(0, 2)});
    await finalizeLookup(actor, legacy._id); await (await collection('providerControl')).deleteMany({}); await processLookup(actor, legacy._id, transport);
    assert.equal((await purchaseSummary(legacy._id, true, SALES_MODE)).difal?.amountCents, 0);
    assert.equal((await lines.findOne(scope({jobId: legacy._id, index: 0})))!.operation, 'OUTRAS');
    assert((await purchaseExport(legacy._id, 'ALL', 1, SALES_MODE)).content.includes('OUTGOING_DISABLED'));
    const legacyRecheck = await recheckLookup(actor, legacy._id);
    assert.equal(legacyRecheck.difalVersion, undefined); assert.equal(legacyRecheck.issuerUf, undefined);
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const attachment = {...input, importId: randomUUID(), expectedRows: 1, issuerUf: 'MG'};
    const attached = await attachGenerationSale(actor, generation._id, attachment);
    assert.equal((await attachGenerationSale(actor, generation._id, attachment)).job._id, attached.job._id);
    await assert.rejects(attachGenerationSale(actor, generation._id, {...attachment, issuerUf: 'SP'}));
    await uploadLookup(actor, attached.job._id, {offset: 0, rows: [sale()]}); await finalizeLookup(actor, attached.job._id);
    const purchases = await attachGenerationPurchase(actor, generation._id, {...attachment, importId: randomUUID()});
    await uploadLookup(actor, purchases.job._id, {offset: 0, rows: [sale({natureCode:'1102'})]}); await finalizeLookup(actor, purchases.job._id);
    assert.equal(purchases.job.issuerUf,'MG','A UF explícita da compra conserva a mesma origem histórica da venda após editar o cadastro.');
    assert.equal((await getGeneration(generation._id)).companies[0].sales.issuerUf, 'MG');
    const simulator = await generationSimulator(generation._id, clientId);
    assert.deepEqual(simulator.sales.difal, (await purchaseSummary(attached.job._id, true, SALES_MODE)).difal);
    assert.equal(simulator.purchases.difal, undefined);
    const archivedCpf=await createLookup(actor,{...input,importId:randomUUID(),expectedRows:1,issuerUf:'MG'},SALES_MODE);
    const jobs=await collection('lookupJobs');
    await jobs.updateOne(scope({_id:archivedCpf._id}),{$set:{difalVersion:DIFAL_CPF_ONLY_VERSION}});
    await uploadLookup(actor,archivedCpf._id,{offset:0,rows:[sale({totalCents:17431970})]});await finalizeLookup(actor,archivedCpf._id);
    const frozenJob=(await jobs.findOne(scope({_id:archivedCpf._id})))!,frozenLines=await lines.find(scope({jobId:archivedCpf._id})).toArray();
    assert.equal(frozenJob.purchaseInput.difal.amountCents,1743197,'V5 preserva a cobrança histórica de R$ 17.431,97.');
    assert.equal(frozenLines[0].difal.baseCents,17431970);assert.equal(frozenLines[0].difal.reason,'ELIGIBLE');
    const current=await purchaseSummary(archivedCpf._id,true,SALES_MODE);
    assert.equal(current.totals.totalCents,17431970);assert.equal(current.difal?.version,DIFAL_VERSION);
    assert.equal(current.difal?.amountCents,0);assert.equal(current.difal?.baseCents,0);
    assert.equal(current.difal?.eligibleLines,0);assert.equal(current.difal?.pendingLines,0);
    const oldSignature=digest(JSON.stringify([frozenJob._id,frozenJob.clientId,frozenJob.generationId,frozenJob.completedAt,
      frozenJob.difalVersion,frozenJob.issuerUf,frozenJob.expectedRows,frozenJob.reportPeriod,frozenJob.purchaseInput,DIFAL_CPF_ONLY_VERSION,'JAN_SEP_V1']));
    const cache=await collection('documentDifalEstimates'),oldEstimate={...scope(),_id:oldSignature,createdAt:new Date(),value:{
      jobId:frozenJob._id,clientId, difal:frozenJob.purchaseInput.difal,period:buildAnalysisPeriod(current.period,current.period)}};
    await cache.insertOne(oldEstimate);
    assert.equal((await currentSalesDocumentDifal(archivedCpf._id)).difal.amountCents,0,'Cache da V5 não pode reativar a saída atual.');
    assert.equal(await cache.countDocuments(scope({'value.jobId':archivedCpf._id})),2);
    assert.deepEqual(await cache.findOne(scope({_id:oldSignature})),oldEstimate);
    const currentRows=await purchaseRows(archivedCpf._id,'ALL',1,true,SALES_MODE);
    assert.equal(currentRows.items[0].difal.reason,'OUTGOING_DISABLED');assert.equal(currentRows.items[0].totalCents,17431970);
    const currentCsv=(await purchaseExport(archivedCpf._id,'ALL',1,SALES_MODE)).content;
    assert(currentCsv.includes('"0,00";"0,00";"OUTGOING_DISABLED"'));assert(!currentCsv.includes('"17431,97"'));
    assert.deepEqual(await jobs.findOne(scope({_id:archivedCpf._id})),frozenJob);
    assert.deepEqual(await lines.find(scope({jobId:archivedCpf._id})).toArray(),frozenLines);
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
    await uploadLookup(actor,purchases._id,{offset:0,rows:rows.map(row=>({...row,natureCode:'1102'}))}); await finalizeLookup(actor,purchases._id);
    const archived=await purchaseSummary(sales._id,true,SALES_MODE);
    assert.equal(archived.difal?.version,DIFAL_VERSION); assert.equal(archived.difal?.amountCents,0);
    assert.equal(archived.difalOrigin,'DERIVED_FROM_SNAPSHOT');assert.equal(archived.job.purchaseInput.difal.amountCents,0);
    const oldJob=await (await collection('lookupJobs')).findOne(scope({_id:sales._id}));
    const oldRows=await (await collection('purchaseLines')).find(scope({jobId:sales._id})).sort({index:1}).toArray();
    const source=await generationSimulator(generation._id,clientId);
    assert.equal(source.reportMonths,12); assert.equal(source.sales.difal?.eligibleLines,0);
    assert.equal(source.sales.difal?.baseCents,0); assert.equal(source.sales.difal?.amountCents,0);
    const monthlyGroups={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:94,purchasesOptantCents:0,purchasesNonOptantCents:94};
    const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:100000,values:{serviceRevenue:0,salesRevenue:94,
      simplePurchases:0,regularPurchases:94,salaries:1,benefits:2,adminExpenses:3,rent:4,cardExpenses:5}};
    const simulationId=randomUUID();
    await createSimulation(actor,{simulationId,generationId:generation._id,clientId,title:'Cenário sintético',
      reportMonths:12,periodConfirmed:true,monthlyGroups,monthlyInputs:source.monthlyReports!.map(row=>baselineMonth(row,draft.values)),draft,rbt12Source:'MANUAL',rbt12ManualConfirmed:true});
    const simulations=await collection('simulations'), original=(await simulations.findOne(scope({_id:simulationId})))!;
    original.projection=annualizeReports(source.fields,12);delete original.monthlyInputs;delete original.source.monthlyReports;
    delete original.source.operationVersion;delete original.source.operationAudit;delete original.anticipationProjection;
    original.source.sales.difal=archived.job.purchaseInput.difal;
    original.difalProjection=projectDifal(archived.job.purchaseInput.difal,12,sales._id);
    original.engineInput=draftToInput(original.draft,original.difalProjection);
    original.result=calculateSimulation(original.draft,original.difalProjection);
    original.monthlyDre=buildMonthlyDre(original.result,original.draft.year,original.rbt12Manual,original.source.period);
    original.createdAt=new Date('2026-10-20T12:00:00Z');
    await simulations.replaceOne(scope({_id:simulationId}),original);
    const oldChild={...structuredClone(original),_id:randomUUID(),parentSimulationId:simulationId,
      createdAt:new Date('2026-10-21T12:00:00Z'),
      reprocessing:{version:'SERVICES_DIFAL_2026_10_V1',originalId:simulationId}};
    await simulations.insertOne(oldChild);
    const result=await reprocessSimulations(actor,{});
    assert.equal(result.version,REPROCESS_VERSION); assert.equal(result.total,1); assert.equal(result.counts.ok,1);
    assert.equal(result.items[0].originalId,oldChild._id,'A família usa a revisão histórica mais recente.');
    const child=await getSimulation(reprocessedSimulationId(scope().workspaceId,oldChild._id));
    assert.equal(child.parentSimulationId,oldChild._id);
    assert.equal(child.difalProjection.sourceVersion,DIFAL_VERSION);
    assert(child.difalProjection.months.every((row:any)=>row.amountCents===0)); assert.equal(child.difalProjection.annualCents,0);
    for (const regime of child.result.regimes) {
      const expectedDifal = 0;
      assert(Math.abs(regime.dre.difal - expectedDifal) < 1e-9, `${regime.id}: DIFAL de saída está desativado em todos os regimes.`);
    }
    assert.deepEqual(child.draft,original.draft); assert.deepEqual(child.rbt12Manual,original.rbt12Manual);
    await reprocessSimulations(actor,{}); assert.equal(await simulations.countDocuments(scope()),3);
    assert.deepEqual(await simulations.findOne(scope({_id:simulationId})),original);
    assert.deepEqual(await simulations.findOne(scope({_id:oldChild._id})),oldChild);
    assert.deepEqual(await (await collection('lookupJobs')).findOne(scope({_id:sales._id})),oldJob);
    assert.deepEqual(await (await collection('purchaseLines')).find(scope({jobId:sales._id})).sort({index:1}).toArray(),oldRows);
    assert.equal((await purchaseSummary(sales._id,true,SALES_MODE)).difal?.amountCents,0);
    assert((await purchaseExport(sales._id,'ALL',1,SALES_MODE)).content.includes(DIFAL_VERSION));
    const fresh=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'vendas-corrigidas.csv',
      expectedRows:rows.length,issuerUf:'MG'},SALES_MODE);
    await uploadLookup(actor,fresh._id,{offset:0,rows}); await finalizeLookup(actor,fresh._id);
    assert.equal((await purchaseSummary(fresh._id,true,SALES_MODE)).difal?.amountCents,0);
    assert((await purchaseExport(fresh._id,'ALL',1,SALES_MODE)).content.includes(`"0,00";"0,00";"OUTGOING_DISABLED";"${DIFAL_VERSION}"`));
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
    const purchaseRows = [row('12345678900', '1102', 2000, '2026-06-30'), row('12345678900', '1102', 2500, '2026-08-01'),
      row('12345678900','1202001',1000,'2026-06-30')];
    const purchases = await attachGenerationPurchase(actor, generation._id, {clientId, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: purchaseRows.length});
    await uploadLookup(actor, purchases.job._id, {offset: 0, rows: purchaseRows}); await finalizeLookup(actor, purchases.job._id);

    const summary = await purchaseSummary(sales.job._id, true, SALES_MODE);
    assert.deepEqual(summary.serviceGroups, [{status: 'OPTANTE', totalCents: 10001}, {status: 'NAO_OPTANTE', totalCents: 160016}, {status: 'CPF', totalCents: 40004}]);
    assert.equal(summary.servicesTotalCents, 210021); assert.equal(summary.totals.totalCents, 279521);
    assert.equal(summary.operationTotals.find(value => value.operation === 'SERVICO')?.lines, 6);
    assert.equal(summary.difal?.baseCents, 0, 'A saída desativada não altera os totais de mercadorias, serviços ou devoluções.');
    const source = await generationSimulator(generation._id, clientId);
    assert.deepEqual(source.revenueSplit, {version: 'SALES_SERVICES_V1'});
    assert.deepEqual(source.fields, {salesOptantCents: 10000, salesNonOptantCents: 20500, salesCpfCents: 39000, serviceRevenueCents: 210021,
      purchasesOptantCents: 0, purchasesNonOptantCents: 4500});
    assert.equal(source.sales.servicesTotalCents, 210021); assert.deepEqual(source.sales.operationTotals, summary.operationTotals);
    assert.equal(source.operationAudit.salesReturnsCents,1000,'A receita deduz a devolução de venda 1202 do relatório de compras.');
    assert.equal(source.operationAudit.excludedSalesCents,1000,'A devolução de compra 6202 no relatório de vendas não compõe a receita.');
    assert.equal(source.purchases.totalCents,5500);assert.equal(source.purchases.selectedTotalCents,4500);
    assert.equal(source.sales.totalCents, 279521); assert.equal(source.projection?.totals.sales.totalCents, 279521);
    assert.equal(source.projection?.totals.sales.totalCents, 279521);
    assert.equal(source.projection?.groups.reduce((sum, group) => sum + (group.key.startsWith('sales') || group.key === 'serviceRevenueCents' ? group.totalCents : 0), 0), 279521);
    assert.equal(providerCalls, 3, 'Resumo e simulador leem o snapshot sem consultar novamente.');

    const negative = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const negativeSales = await attachGenerationSale(actor, negative._id, {clientId, importId: randomUUID(), fileName: 'devolucoes-sinteticas.csv', expectedRows: 2, issuerUf: 'MG'});
    await uploadLookup(actor, negativeSales.job._id, {offset: 0, rows: [row('12345678900', '900001', 5000), row('12345678900', '6202', 1000)]});
    await finalizeLookup(actor, negativeSales.job._id);
    const negativePurchases = await attachGenerationPurchase(actor, negative._id, {clientId, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: 2});
    await uploadLookup(actor, negativePurchases.job._id, {offset: 0, rows: [row('12345678900', '1202', 10000),row('12345678900', '1102', 2000)]}); await finalizeLookup(actor, negativePurchases.job._id);
    const negativeSource=await generationSimulator(negative._id,clientId);
    assert.equal(negativeSource.fields.salesCpfCents,-10000,'Devoluções de mercadorias permanecem negativas mesmo sem venda no período.');
    assert.equal(negativeSource.fields.serviceRevenueCents,5000,'Receita de serviços não é apagada para ajustar mercadorias.');
    assert.equal(negativeSource.sales.selectedTotalCents,-5000);
    assert.equal(negativeSource.purchases.selectedTotalCents,2000);
    assert.equal(negativeSource.projection?.totals.sales.totalCents,-5000);
    assert.equal(negativeSource.operationAudit.salesReturnsCents,10000);
    assert.equal(negativeSource.operationAudit.excludedSalesCents,1000,'Devolução de compras continua fora da receita.');
    const warnings=negativeSource.warnings.filter(warning=>warning.startsWith('Conferência financeira · '));
    assert.equal(warnings.length,1);assert.match(warnings[0],/2026-06.*devoluções superam.*saldo negativo.*Compras.*não impedem/);
    assert.equal(providerCalls,3,'Aceitar o saldo financeiro não refaz nem altera a consulta cadastral.');
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});


test('cartão DIFAL Jan–Set corrige V4 sem alterar origem, confirma zero e usa cache sem varrer documentos',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_difal_period_'+randomUUID().replaceAll('-','');
  process.env.WORKSPACE_ID='difal_period_test';resetLookupIndexes();
  const actor={_id:'difal-period-operator',role:'admin',name:'Equipe sintética',email:'difal-period@example.test'};
  const rows=(values:{document?:string;date?:string;uf?:string;amount:number}[])=>values.map(value=>({
    document:value.document??'12345678900',name:'Documento sintético',serviceDate:value.date??'2026-01-15',
    recipientUf:value.uf??'SP',natureCode:'5102',description:'Mercadoria',quantity:'1',
    totalCents:value.amount,grossCents:value.amount,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0
  }));
  try{
    const clientId=(await importCatalog(actor,[{code:'9555',name:'DIFAL janeiro a setembro',uf:'MG'}])).items[0].id;
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId],requiredReports:['SALES']});
    const originalRows=rows([{amount:100000},{amount:200000,document:'00000000000191'},
      {amount:300000,date:'2026-09-15',uf:'MG'},{amount:400000,date:'2026-09-15'},
      {amount:900000,date:'2026-10-15'},{amount:500000,date:'2026-09-15',uf:'',document:'00000000000191'},
      {amount:600000,date:'2026-09-15',uf:''}]);
    const attached=await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),fileName:'v4-sintetico.csv',expectedRows:originalRows.length,issuerUf:'MG'});
    const jobId=attached.job._id,jobs=await collection('lookupJobs'),lines=await collection('purchaseLines');
    await jobs.updateOne(scope({_id:jobId}),{$set:{difalVersion:DIFAL_CPF_CNPJ_VERSION}});
    await uploadLookup(actor,jobId,{offset:0,rows:originalRows});await finalizeLookup(actor,jobId);
    await (await collection('providerControl')).deleteMany({});
    await processLookup(actor,jobId,(async()=>Response.json({cnpj:'00000000000191',razao_social:'Empresa sintética',opcao_pelo_simples:false})) as typeof fetch);
    const snapshot=async()=>({job:await jobs.findOne(scope({_id:jobId})),rows:await lines.find(scope({jobId})).sort({index:1}).toArray()});
    const before=await snapshot(),result=await currentSalesDocumentDifal(jobId);
    assert.equal(before.job!.purchaseInput.difal.amountCents,160000);
    assert.equal(before.job!.purchaseInput.difal.pendingLines,2);
    assert.deepEqual(result.difal,{version:DIFAL_VERSION,ratePercent:10,issuerUf:'MG',eligibleLines:0,baseCents:0,amountCents:0,pendingLines:0});
    assert.equal(result.period.sourceYear,2026);assert.equal(result.period.months,9);
    assert.deepEqual(result.period.excludedMonths,['2026-10']);assert.equal(result.jobId,jobId);
    assert.deepEqual(await snapshot(),before,'O cache fica separado; relatório e linhas originais permanecem idênticos.');
    const calls:string[]=[],patches:any[]=[];
    for(const method of ['find','findOne','aggregate'] as const){
      const original=(Collection.prototype as any)[method];
      patches.push(t.mock.method(Collection.prototype,method,function(this:Collection,...args:any[]){
        calls.push(this.collectionName);return original.apply(this,args);
      }));
    }
    try{
      assert.deepEqual(await currentSalesDocumentDifal(jobId),result);
      await getGeneration(generation._id);
      assert.deepEqual(calls.filter(name=>['purchaseLines','lookupItems','cnpjStates'].includes(name)),[]);
    }finally{for(const patch of patches)patch.mock.restore();}
    const zeroRows=rows([{amount:200000,document:'00000000000191',uf:''},{amount:300000,date:'2026-09-15',uf:'MG'}]);
    const zeroJob=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'sem-difal.csv',expectedRows:2,issuerUf:'MG'},SALES_MODE);
    await uploadLookup(actor,zeroJob._id,{offset:0,rows:zeroRows});await finalizeLookup(actor,zeroJob._id);
    await (await collection('providerControl')).deleteMany({});
    await processLookup(actor,zeroJob._id,(async()=>Response.json({cnpj:'00000000000191',razao_social:'Empresa sintética',opcao_pelo_simples:false})) as typeof fetch);
    const zero=await currentSalesDocumentDifal(zeroJob._id);
    assert.equal(zero.difal.amountCents,0);assert.equal(zero.difal.eligibleLines,0);assert.equal(zero.difal.pendingLines,0);
    const missing=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'sem-datas.csv',expectedRows:1,issuerUf:'MG'},SALES_MODE);
    await uploadLookup(actor,missing._id,{offset:0,rows:rows([{amount:1000}])});await finalizeLookup(actor,missing._id);
    await jobs.updateOne(scope({_id:missing._id}),{$unset:{reportPeriod:''}});
    await lines.updateMany(scope({jobId:missing._id}),{$unset:{serviceDate:''}});
    await assert.rejects(currentSalesDocumentDifal(missing._id),(error:any)=>error.code==='DIFAL_PERIOD');
    const ambiguous=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'anos-divergentes.csv',expectedRows:2,issuerUf:'MG'},SALES_MODE);
    await uploadLookup(actor,ambiguous._id,{offset:0,rows:rows([{amount:1000,date:'2025-09-15'},{amount:2000,date:'2026-08-15'}])});
    await finalizeLookup(actor,ambiguous._id);
    await assert.rejects(currentSalesDocumentDifal(ambiguous._id),(error:any)=>error.code==='DIFAL_PERIOD'&&error.status===409);
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});

test('cache DIFAL mantém escopo, concorrência e exclusão da geração',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_difal_cache_'+randomUUID().replaceAll('-','');
  process.env.WORKSPACE_ID='difal_cache_test';resetLookupIndexes();
  const actor={_id:'difal-cache-operator',role:'admin',name:'Equipe sintética',email:'difal-cache@example.test'};
  try{
    const clientId=(await importCatalog(actor,[{code:'9556',name:'Cache DIFAL sintético',uf:'MG'}])).items[0].id;
    const cache=await collection('documentDifalEstimates'),jobs=await collection('lookupJobs'),lines=await collection('purchaseLines');
    const createSource=async()=>{
      const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId],requiredReports:['SALES']});
      const {job}=await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),fileName:'cache-sintetico.csv',expectedRows:1,issuerUf:'MG'});
      await uploadLookup(actor,job._id,{offset:0,rows:[{document:'12345678900',name:'Pessoa sintética',serviceDate:'2026-09-15',
        quantity:'1',natureCode:'6108',description:'Mercadoria',recipientUf:'SP',totalCents:10000,grossCents:10000,
        discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}]});
      await finalizeLookup(actor,job._id);
      return {generationId:generation._id,jobId:job._id};
    };
    const source=await createSource();
    await t.test('duas leituras frias aceitam somente o resultado idêntico da colisão 11000',async t=>{
      const before={job:await jobs.findOne(scope({_id:source.jobId})),lines:await lines.find(scope({jobId:source.jobId})).toArray()};
      const original=Collection.prototype.updateOne;
      const conflict=Object.assign(new Error('Colisão concorrente sintética'),{code:11000});
      let writes=0,releaseWinner!:()=>void;
      const winnerInserted=new Promise<void>(resolve=>{releaseWinner=resolve;});
      const patch=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,...args:any[]){
        if(this.collectionName==='documentDifalEstimates'&&args[2]?.upsert){
          writes++;
          if(writes===1){await winnerInserted;throw conflict;}
          try{return await (original as any).apply(this,args);}finally{releaseWinner();}
        }
        return (original as any).apply(this,args);
      });
      try{
        const [first,second]=await Promise.all([currentSalesDocumentDifal(source.jobId),currentSalesDocumentDifal(source.jobId)]);
        assert.deepEqual(first,second);assert.equal(first.difal.amountCents,0);assert.equal(writes,2);
        assert.equal(await cache.countDocuments(scope({'value.jobId':source.jobId})),1);
        assert.deepEqual({job:await jobs.findOne(scope({_id:source.jobId})),lines:await lines.find(scope({jobId:source.jobId})).toArray()},before);
      }finally{releaseWinner();patch.mock.restore();}
    });
    await t.test('colisão em outro workspace continua bloqueada',async t=>{
      await cache.deleteMany(scope({'value.jobId':source.jobId}));
      const original=Collection.prototype.updateOne;
      const conflict=Object.assign(new Error('Colisão de outro workspace sintética'),{code:11000});
      const patch=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,...args:any[]){
        if(this.collectionName==='documentDifalEstimates'&&args[2]?.upsert){
          await this.insertOne({...args[1].$setOnInsert,_id:args[0]._id,workspaceId:'foreign_cache_test'});
          throw conflict;
        }
        return (original as any).apply(this,args);
      });
      try{
        await assert.rejects(currentSalesDocumentDifal(source.jobId),(error:any)=>error===conflict);
        assert.equal(await cache.countDocuments(scope({'value.jobId':source.jobId})),0);
      }finally{patch.mock.restore();await cache.deleteMany({workspaceId:'foreign_cache_test'});}
    });
    const preserved=await createSource(),preservedValue=await currentSalesDocumentDifal(preserved.jobId);
    await t.test('excluir geração remove seus agregados e preserva outras origens e workspaces',async()=>{
      const value=await currentSalesDocumentDifal(source.jobId);
      const foreignId=randomUUID();
      await cache.insertOne({_id:foreignId,workspaceId:'foreign_cache_test',value,createdAt:new Date()});
      await deleteGeneration(actor,source.generationId);
      assert.equal(await cache.countDocuments(scope({'value.jobId':source.jobId})),0);
      await assert.rejects(currentSalesDocumentDifal(source.jobId),(error:any)=>error.code==='NOT_FOUND');
      assert.deepEqual(await currentSalesDocumentDifal(preserved.jobId),preservedValue);
      assert(await cache.findOne({_id:foreignId,workspaceId:'foreign_cache_test'}));
      await deleteGeneration(actor,source.generationId);
      assert.equal(await cache.countDocuments(scope({'value.jobId':source.jobId})),0);
    });
    await t.test('leitura fria concluída depois da exclusão não recria o agregado',async t=>{
      const late=await createSource(),original=Collection.prototype.updateOne;
      let deleted=false,inserted=false;
      const patch=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,...args:any[]){
        if(this.collectionName==='documentDifalEstimates'&&args[2]?.upsert&&!deleted){
          deleted=true;
          await deleteGeneration(actor,late.generationId);
          const result=await (original as any).apply(this,args);
          inserted=result.upsertedCount===1;
          return result;
        }
        return (original as any).apply(this,args);
      });
      try{
        await assert.rejects(currentSalesDocumentDifal(late.jobId),(error:any)=>error.code==='NOT_FOUND');
        assert.equal(deleted,true);assert.equal(inserted,true,'A escrita atrasada deve ocorrer para exercitar a limpeza final.');
        assert.equal(await cache.countDocuments(scope({'value.jobId':late.jobId})),0);
        assert.equal(await jobs.countDocuments(scope({_id:late.jobId})),0);
        assert.equal(await lines.countDocuments(scope({jobId:late.jobId})),0);
      }finally{patch.mock.restore();}
    });
    await t.test('leitura do cache também verifica exclusão antes de responder',async t=>{
      const warm=await createSource();await currentSalesDocumentDifal(warm.jobId);
      const original=Collection.prototype.findOne;let deleted=false;
      const patch=t.mock.method(Collection.prototype,'findOne',async function(this:Collection,...args:any[]){
        const found=await (original as any).apply(this,args);
        if(this.collectionName==='documentDifalEstimates'&&found&&!deleted){deleted=true;await deleteGeneration(actor,warm.generationId);}
        return found;
      });
      try{
        await assert.rejects(currentSalesDocumentDifal(warm.jobId),(error:any)=>error.code==='NOT_FOUND');
        assert.equal(deleted,true);assert.equal(await cache.countDocuments(scope({'value.jobId':warm.jobId})),0);
      }finally{patch.mock.restore();}
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
