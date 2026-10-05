import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes, getJob, withJob } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createGeneration, getGeneration, generationHistory, attachGenerationPurchase, attachGenerationSale, withGeneration, deleteGeneration } from '../src/generation-store.ts';
import { createLookup, uploadLookup, finalizeLookup, cancelLookup, processLookup } from '../src/lookup-jobs.ts';
import { PURCHASE_MODE } from '../src/purchase-domain.ts';
import { generationDeletion } from '../src/generation-deletion.ts';
import { purchaseSummary, purchaseHistory } from '../src/purchase-store.ts';
import { routeV4 } from '../src/lookup-http.ts';
import { generationSimulator } from '../src/simulator-store.ts';
import { digits } from '../src/domain.ts';

test('MongoDB gerações: empresas, retomada, concorrência, conclusão conjunta e isolamento', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_generation_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'generation_test';
  resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  const viewer = {...actor, role: 'viewer'};
  const errorCode = (code: string) => (error: any) => error.code === code;
  const row = {document: '12345678900', name: 'Pessoa sintética', serviceDate: '2026-08-15', quantity: '2', grossCents: 10000, discountCents: 2000,
    accessoryCents: 999, freightCents: 500, abatementCents: 300, totalCents: 8200};
  try {
    const catalog = await importCatalog(actor, [{code: '936', name: 'Empresa A'}, {code: '937', name: 'Empresa B'}, {code: '938', name: 'Empresa C'}]);
    const [first, second, outside] = catalog.items.map((client: any) => client.id);
    const input = {generationId: randomUUID(), clientIds: [first, second], requiredReports: ['PURCHASES']};
    const id = input.generationId;
    await assert.rejects(createGeneration(viewer, input), errorCode('FORBIDDEN'));
    await assert.rejects(createGeneration(actor, {...input, clientIds: []}));
    await assert.rejects(createGeneration(actor, {...input, clientIds: [first, first]}));
    await assert.rejects(createGeneration(actor, {...input, clientIds: [randomUUID()]}));
    await assert.rejects(createGeneration(actor, {...input, clientIds: Array.from({length: 51}, () => randomUUID())}));
    const copies = await Promise.all([createGeneration(actor, input), createGeneration(actor, input)]);
    assert(copies.every(copy => copy._id === id && copy.status === 'MISSING' && copy.missingCount === 2));
    assert.equal(await (await collection('generations')).countDocuments(scope()), 1);
    assert.equal((await createGeneration(actor, {...input, clientIds: [second, first]}))._id, id);
    await assert.rejects(createGeneration(actor, {...input, clientIds: [first]}), errorCode('GENERATION_EXISTS'));
    await assert.rejects(createGeneration({...actor, _id: 'other'}, input), errorCode('GENERATION_EXISTS'));
    const attachInput = {clientId: first, importId: randomUUID(), fileName: 'compras-sinteticas.csv', expectedRows: 1};
    await assert.rejects(attachGenerationPurchase(viewer, id, attachInput), errorCode('FORBIDDEN'));
    await assert.rejects(attachGenerationPurchase(actor, id, {...attachInput, clientId: outside}), errorCode('GENERATION_CLIENT'));
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const held = withGeneration(id, async () => { acquired(); await unlock; });
    await locked;
    try { await assert.rejects(attachGenerationPurchase(actor, id, attachInput), errorCode('GENERATION_BUSY')); }
    finally { release(); await held; }
    const attached = await attachGenerationPurchase(actor, id, attachInput);
    assert.equal(attached.job.generationId, id);
    assert.equal(attached.generation.inProgressCount, 1);
    assert.equal(attached.generation.missingCount, 1);
    assert.equal(attached.generation.completedCount, 0);
    assert.equal(attached.generation.status, 'MISSING');
    const repeated = await attachGenerationPurchase(actor, id, attachInput);
    assert.equal(repeated.job._id, attached.job._id);
    assert.deepEqual(repeated.generation.companies[0].purchaseJobIds, [attached.job._id]);
    await assert.rejects(attachGenerationPurchase(actor, id, {...attachInput, expectedRows: 2}));
    const colleague = {...actor, _id: 'colleague', role: 'operator'};
    assert.equal((await attachGenerationPurchase(colleague, id, attachInput)).job._id, attached.job._id);
    await assert.rejects(attachGenerationPurchase(colleague, id, {...attachInput, fileName: 'outro.csv'}), errorCode('GENERATION_PURCHASE_EXISTS'));
    await assert.rejects(attachGenerationPurchase(colleague, id, {...attachInput, expectedRows: 2}), errorCode('GENERATION_PURCHASE_EXISTS'));
    await assert.rejects(attachGenerationPurchase(actor, id, {...attachInput, importId: randomUUID()}), errorCode('GENERATION_PURCHASE_EXISTS'));
    const another = await createGeneration(actor, {generationId: randomUUID(), clientIds: [first]});
    await assert.rejects(attachGenerationPurchase(actor, another._id, attachInput), errorCode('GENERATION_PURCHASE_EXISTS'));
    assert.equal((await getGeneration(another._id)).missingCount, 1);
    await uploadLookup(colleague, attached.job._id, {offset: 0, rows: [row]});
    await finalizeLookup(colleague, attached.job._id);
    assert.equal((await purchaseSummary(attached.job._id)).totals.totalCents, 8200);
    const partial = await getGeneration(id);
    assert.equal(partial.status, 'MISSING');
    assert.equal(partial.completedCount, 1);
    assert.equal(partial.companies[0].purchase.status, 'COMPLETED');
    await assert.rejects(attachGenerationPurchase(actor, id, {...attachInput, importId: randomUUID()}), errorCode('GENERATION_PURCHASE_EXISTS'));
    const secondInput = {...attachInput, clientId: second, importId: randomUUID()};
    const cancelled = await attachGenerationPurchase(actor, id, secondInput);
    await cancelLookup(actor, cancelled.job._id);
    assert.equal((await getGeneration(id)).missingCount, 1);
    const replacement = await attachGenerationPurchase(actor, id, {...secondInput, importId: randomUUID()});
    assert.deepEqual(replacement.generation.companies[1].purchaseJobIds, [cancelled.job._id, replacement.job._id]);
    assert.equal(replacement.generation.status, 'IN_PROGRESS');
    await assert.rejects(attachGenerationPurchase(actor, id, secondInput), errorCode('GENERATION_PURCHASE_EXISTS'));
    await uploadLookup(actor, replacement.job._id, {offset: 0, rows: [{...row, document: '00000000000191'}]});
    await finalizeLookup(actor, replacement.job._id);
    await (await collection('providerControl')).deleteMany({});
    await processLookup(actor, replacement.job._id, (async () => new Response('', {status: 404})) as typeof fetch);
    const complete = await getGeneration(id);
    assert.equal(complete.status, 'COMPLETED');
    assert.equal(complete.completedCount, 2);
    assert.equal(complete.missingCount, 0);
    assert.equal(complete.salesAvailable, true);
    assert.deepEqual(complete.requiredReports, ['PURCHASES']);
    assert.equal(complete.companies[1].purchase.generationId, id);
    assert.equal((await purchaseHistory(second, 1)).total, 2);
    const metrics = (await routeV4(actor, 'GET', new URL('https://test/api/v4/dashboard'), {}) as any).metrics;
    assert.equal(metrics.total, 1);
    assert.equal(metrics.unknown, 1);
    assert.equal(metrics.nonOptants, 0);
    assert.equal(metrics.reportingNonOptants, 1);
    assert.equal(metrics.reportingNonOptantsPercent, 100);
    assert.equal(metrics.coverage, 0);
    const visible = await routeV4(viewer, 'GET', new URL('https://test/api/v4/generations/' + id), {}) as any;
    assert.equal(visible._id, id);
    assert.equal(visible.leaseOwner, undefined);
    assert.equal(visible.workspaceId, undefined);
    await assert.rejects(routeV4(actor, 'POST', new URL('https://test/api/v4/generations/' + id + '/sales'), {}), errorCode('VALIDATION'));
    await assert.rejects(routeV4(actor, 'POST', new URL('https://test/api/v4/generations/' + id + '/purchases'), {...attachInput, type: 'SALES'}), errorCode('VALIDATION'));
    const oldClientId = complete.companies[0].clientId;
    await (await collection('lookupJobs')).updateOne(scope({_id: attached.job._id}), {$set: {clientId: outside}});
    await assert.rejects(getGeneration(id), errorCode('GENERATION_INCONSISTENT'));
    await (await collection('lookupJobs')).updateOne(scope({_id: attached.job._id}), {$set: {clientId: oldClientId}});
    const history = await generationHistory(1);
    assert.equal(history.total, 2);
    assert.equal(history.items.length, 2);
    assert.equal(history.pageSize, 20);
    assert.equal((await generationHistory(2)).items.length, 0);
    process.env.WORKSPACE_ID = 'another_workspace';
    await assert.rejects(getGeneration(id), errorCode('NOT_FOUND'));
    await assert.rejects(attachGenerationPurchase(actor, id, attachInput), errorCode('NOT_FOUND'));
    assert.equal((await generationHistory(1)).total, 0);
    await assert.rejects(createGeneration(actor, {generationId: randomUUID(), clientIds: [first]}));
    process.env.WORKSPACE_ID = 'generation_test';
    assert.equal(await (await collection('clients')).countDocuments(scope()), 3);
    assert.equal((await (await collection('lookupJobs')).findOne(scope({_id: cancelled.job._id})))?.status, 'CANCELLED');
  } finally {
    await (await database()).dropDatabase();
    await closeDatabase();
    resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});

test('MongoDB simulador: cinco campos vêm de snapshots conciliados, com CPF próprio e bloqueios de mistura/legado', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_simulator_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'simulator_test'; resetLookupIndexes();
  const actor = {_id:'tester',role:'admin',name:'Teste',email:'test@example.test'};
  const errorCode = (code: string) => (error: any) => error.code === code;
  const ids = ['000000000001', '111111110001', '222222220001'].map(base => base + digits(base));
  let calls = 0;
  const transport = (async (url: string | URL | Request) => {
    calls++; const cnpj = String(url).split('/').pop();
    if (cnpj === ids[2]) return new Response('', {status:404});
    return Response.json({cnpj,razao_social:'Empresa sintética',opcao_pelo_simples:cnpj===ids[0],opcao_pelo_mei:false});
  }) as typeof fetch;
  const rows = [[ids[0],10001],[ids[0],9],[ids[1],20000],[ids[2],9990],['12345678900',3000],['12345678900',1000],['123456789012',4000],['ABC',500],['',700]]
    .map(([document,totalCents]) => ({document,name:'Parceiro sintético',serviceDate:'2026-08-15',quantity:'1',totalCents,grossCents:Number(totalCents)+500,discountCents:600,accessoryCents:99,freightCents:150,abatementCents:50}));
  try {
    const catalog = await importCatalog(actor, [{code:'936',name:'Empresa A'},{code:'937',name:'Empresa B'}]);
    const [clientId, outside] = catalog.items.map((item:any)=>item.id);
    const generation = await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
    const id = generation._id;
    const url = new URL(`https://test/api/v4/generations/${id}/simulator?clientId=${clientId}`);
    await assert.rejects(generationSimulator(id,''),errorCode('VALIDATION'));
    await assert.rejects(generationSimulator(id,outside),errorCode('GENERATION_CLIENT'));
    await assert.rejects(generationSimulator(id,clientId),errorCode('SIMULATOR_INCOMPLETE'));
    const attachment = {clientId,importId:randomUUID(),fileName:'compras.csv',expectedRows:rows.length};
    const purchases = await attachGenerationPurchase(actor,id,attachment);
    const sales = await attachGenerationSale(actor,id,{...attachment,importId:randomUUID(),fileName:'vendas.csv'});
    for (const job of [purchases.job,sales.job]) {
      await uploadLookup(actor,job._id,{offset:0,rows}); await finalizeLookup(actor,job._id);
      await assert.rejects(generationSimulator(id,clientId),errorCode('SIMULATOR_INCOMPLETE'));
      await (await collection('providerControl')).deleteMany({}); await processLookup(actor,job._id,transport);
    }
    assert.equal(calls,6,'Somente CNPJs únicos de cada relatório vão à consulta.');
    const snapshot:any = await routeV4({...actor,role:'viewer'},'GET',url,{salesCpfCents:999999});
    assert.equal(snapshot.generationId,id); assert.equal(snapshot.clientId,clientId);
    assert.deepEqual(snapshot.company,{name:'Empresa A',code:'936'});
    assert.equal(snapshot.periodBasis,'COLUMN_H'); assert.equal(snapshot.reportMonths,1);
    assert.deepEqual(snapshot.fields,{salesOptantCents:10010,salesNonOptantCents:35190,salesCpfCents:4000,purchasesOptantCents:10010,purchasesNonOptantCents:39190});
    assert.equal(snapshot.purchases.totalCents,49200); assert.equal(snapshot.sales.totalCents,49200);
    assert.equal(snapshot.sales.jobId,sales.job._id); assert.equal(snapshot.sales.formula,'Q - Y + AA - AB');
    assert.equal(snapshot.sales.calculationVersion,'NET_V2'); assert(snapshot.sales.completedAt);
    assert.deepEqual(snapshot.classification,{purchases:{unconfirmedCount:1,unconfirmedCents:9990,nonCnpjCount:4,nonCnpjCents:9200},sales:{unconfirmedCount:1,unconfirmedCents:9990,otherDocumentsCount:3,otherDocumentsCents:5200}});
    assert(snapshot.warnings.some((message:string)=>message.includes('mesmas competências')));
    assert(snapshot.warnings.some((message:string)=>message.includes('CNPJs não confirmados')));
    await assert.rejects(routeV4(actor,'POST',url,{}),errorCode('NOT_FOUND'));
    const jobs = await collection('lookupJobs');
    await jobs.updateOne(scope({_id:sales.job._id}),{$set:{clientId:outside}});
    await assert.rejects(generationSimulator(id,clientId),errorCode('GENERATION_INCONSISTENT'));
    await jobs.updateOne(scope({_id:sales.job._id}),{$set:{clientId,generationId:randomUUID()}});
    await assert.rejects(generationSimulator(id,clientId),errorCode('GENERATION_INCONSISTENT'));
    await jobs.updateOne(scope({_id:sales.job._id}),{$set:{generationId:id}});
    await jobs.updateOne(scope({_id:purchases.job._id}),{$unset:{calculationVersion:''}});
    await assert.rejects(generationSimulator(id,clientId),errorCode('SIMULATOR_VERSION'));
    await jobs.updateOne(scope({_id:purchases.job._id}),{$set:{calculationVersion:'NET_V2'}});
    await jobs.updateOne(scope({_id:sales.job._id}),{$inc:{'purchaseInput.totalCents':1}});
    await assert.rejects(generationSimulator(id,clientId),errorCode('RESULT_COUNT'));
    await jobs.updateOne(scope({_id:sales.job._id}),{$inc:{'purchaseInput.totalCents':-1}});
    const lines = await collection('purchaseLines'), target = scope({jobId:sales.job._id,index:0});
    await lines.updateOne(target,{$inc:{grossCents:1}});
    await assert.rejects(generationSimulator(id,clientId),errorCode('PURCHASE_TOTAL'));
    await lines.updateOne(target,{$inc:{grossCents:-1}});
    process.env.WORKSPACE_ID='another_workspace';
    await assert.rejects(generationSimulator(id,clientId),errorCode('NOT_FOUND'));
    process.env.WORKSPACE_ID='simulator_test';
    assert.equal((await generationSimulator(id,clientId)).sales.totalCents,49200);
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});

test('MongoDB gerações: vendas e compras independentes, requisitos e histórico legado', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_generation_sales_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'generation_sales_test';
  resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Teste', email: 'test@example.test'};
  const colleague = {...actor, _id: 'colleague', role: 'operator'};
  const errorCode = (code: string) => (error: any) => error.code === code;
  const row = {document: '12345678900', name: 'Pessoa sintética', serviceDate: '2026-08-15', quantity: '2', grossCents: 10000, discountCents: 2000,
    accessoryCents: 999, freightCents: 500, abatementCents: 300, totalCents: 8200};
  const finish = async (job: any) => {
    await uploadLookup(actor, job._id, {offset: 0, rows: [row]});
    await finalizeLookup(actor, job._id);
  };
  const upload = (clientId: string, sales = false) => ({clientId, importId: randomUUID(), fileName: sales ? 'vendas.csv' : 'compras.csv', expectedRows: 1});
  try {
    const catalog = await importCatalog(actor, [{code: '936', name: 'Empresa A'}, {code: '937', name: 'Empresa B'}]);
    const [first, second] = catalog.items.map((client: any) => client.id);
    const id = randomUUID(), input = {generationId: id, clientIds: [first, second]};
    for (const requiredReports of [[], null, ['SALES', 'SALES'], ['OTHER'], ['PURCHASES', 'SALES', 'OTHER']]) {
      await assert.rejects(createGeneration(actor, {...input, requiredReports}), errorCode('VALIDATION'));
    }
    const generation = await createGeneration(actor, input);
    assert.deepEqual(generation.requiredReports, ['PURCHASES', 'SALES']);
    assert.equal(generation.salesAvailable, true);
    assert(generation.companies.every((company: any) => company.purchase === null && company.sales === null && company.salesJobIds.length === 0));
    assert.equal((await createGeneration(actor, {...input, requiredReports: ['SALES', 'PURCHASES']}))._id, id);
    await assert.rejects(createGeneration(actor, {...input, requiredReports: ['SALES']}), errorCode('GENERATION_EXISTS'));
    const salesInput = upload(first, true);
    await assert.rejects(attachGenerationSale({...actor, role: 'viewer'}, id, salesInput), errorCode('FORBIDDEN'));
    await assert.rejects(attachGenerationSale(actor, id, {...salesInput, type: 'PURCHASES'}), errorCode('VALIDATION'));
    const sales = await routeV4(actor, 'POST', new URL('https://test/api/v4/generations/' + id + '/sales'), salesInput) as any;
    assert.equal(sales.job.mode, 'SALES_V1');
    assert.deepEqual(sales.generation.companies[0].salesJobIds, [sales.job._id]);
    assert.equal(sales.generation.missingCount, 2);
    assert.equal((await attachGenerationSale(colleague, id, salesInput)).job._id, sales.job._id);
    await assert.rejects(attachGenerationSale(colleague, id, {...salesInput, fileName: 'diferente.csv'}), errorCode('GENERATION_SALES_EXISTS'));
    await assert.rejects(attachGenerationPurchase(actor, id, salesInput));
    await finish(sales.job);
    assert.equal((await getGeneration(id)).completedCount, 0);
    const purchases = await attachGenerationPurchase(actor, id, upload(first));
    await finish(purchases.job);
    assert.equal((await getGeneration(id)).completedCount, 1);
    const purchaseSecond = await attachGenerationPurchase(actor, id, upload(second));
    await finish(purchaseSecond.job);
    assert.equal((await getGeneration(id)).status, 'MISSING');
    const secondInput = upload(second, true);
    const cancelled = await attachGenerationSale(actor, id, secondInput);
    assert.equal(cancelled.generation.status, 'IN_PROGRESS');
    await cancelLookup(actor, cancelled.job._id);
    assert.equal((await getGeneration(id)).status, 'MISSING');
    const replacement = await attachGenerationSale(actor, id, {...secondInput, importId: randomUUID()});
    assert.deepEqual(replacement.generation.companies[1].salesJobIds, [cancelled.job._id, replacement.job._id]);
    await assert.rejects(attachGenerationSale(actor, id, secondInput), errorCode('GENERATION_SALES_EXISTS'));
    await finish(replacement.job);
    const completed = await getGeneration(id);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.completedCount, 2);
    assert(completed.companies.every((company: any) => company.purchase.mode === 'PURCHASES_V1' && company.sales.mode === 'SALES_V1'));
    await (await collection('lookupJobs')).updateOne(scope({_id: sales.job._id}), {$set: {mode: 'PURCHASES_V1'}});
    await assert.rejects(getGeneration(id), errorCode('GENERATION_INCONSISTENT'));
    await (await collection('lookupJobs')).updateOne(scope({_id: sales.job._id}), {$set: {mode: 'SALES_V1'}});

    const legacy = await createGeneration(actor, {generationId: randomUUID(), clientIds: [first], requiredReports: ['PURCHASES']});
    const legacyPurchase = await attachGenerationPurchase(actor, legacy._id, upload(first));
    await finish(legacyPurchase.job);
    await (await collection('generations')).updateOne(scope({_id: legacy._id}), {$unset: {requiredReports: '', 'companies.$[].salesJobId': '', 'companies.$[].salesJobIds': ''}});
    const legacyCompleted = await getGeneration(legacy._id);
    assert.equal(legacyCompleted.status, 'COMPLETED');
    assert.deepEqual(legacyCompleted.requiredReports, ['PURCHASES']);
    assert.equal(legacyCompleted.companies[0].sales, null);
    const legacySales = await attachGenerationSale(actor, legacy._id, upload(first, true));
    assert.deepEqual(legacySales.generation.requiredReports, ['PURCHASES', 'SALES']);
    assert.equal(legacySales.generation.status, 'IN_PROGRESS');
    assert.equal(legacySales.generation.companies[0].purchaseJobId, legacyPurchase.job._id);
    await finish(legacySales.job);
    assert.equal((await getGeneration(legacy._id)).status, 'COMPLETED');

    const salesOnly = await createGeneration(actor, {generationId: randomUUID(), clientIds: [second], requiredReports: ['SALES']});
    const only = await attachGenerationSale(actor, salesOnly._id, upload(second, true));
    await finish(only.job);
    const onlyComplete = await getGeneration(salesOnly._id);
    assert.equal(onlyComplete.status, 'COMPLETED');
    assert.equal(onlyComplete.companies[0].purchase, null);
    assert.deepEqual(onlyComplete.requiredReports, ['SALES']);
    const additionalPurchase = await attachGenerationPurchase(actor, salesOnly._id, upload(second));
    assert.equal(additionalPurchase.generation.status, 'IN_PROGRESS');
    assert.deepEqual(additionalPurchase.generation.requiredReports, ['PURCHASES', 'SALES']);
    await finish(additionalPurchase.job);
    assert.equal((await getGeneration(salesOnly._id)).status, 'COMPLETED');
    await (await collection('generations')).updateOne(scope({_id: salesOnly._id}), {$set: {requiredReports: []}});
    await assert.rejects(getGeneration(salesOnly._id), errorCode('GENERATION_INCONSISTENT'));
  } finally {
    await (await database()).dropDatabase();
    await closeDatabase();
    resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
  }
});

test('MongoDB exclusão de geração: purge exclusivo, leases, recibos e retomada sem recriação', {skip: !process.env.MONGODB_URI, timeout: 120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_generation_delete_test_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'generation_delete_test'; resetLookupIndexes();
  const actor = {_id:'deleter',role:'operator',name:'Operador',email:'delete@example.test'};
  const errorCode = (code: string) => (error: any) => error.code === code;
  const row = {document:'12345678900',name:'Pessoa sintética',serviceDate:'2026-08-15',quantity:'1',
    grossCents:10000,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:10000};
  try {
    const catalog = await importCatalog({...actor,role:'admin'}, [{code:'1',name:'Empresa sintética'},{code:'2',name:'Outra empresa'}]);
    const [clientId, otherClient] = catalog.items.map((client:any)=>client.id);
    const input = {generationId:randomUUID(),clientIds:[clientId]};
    const generation = await createGeneration(actor,input), id = generation._id;
    const importInput = {clientId,importId:randomUUID(),fileName:'compras-sinteticas.csv',expectedRows:1};
    const purchase = (await attachGenerationPurchase(actor,id,importInput)).job;
    await uploadLookup(actor,purchase._id,{offset:0,rows:[row]}); await finalizeLookup(actor,purchase._id);
    const cancelled = (await attachGenerationSale(actor,id,{...importInput,importId:randomUUID()})).job;
    await uploadLookup(actor,cancelled._id,{offset:0,rows:[row]}); await cancelLookup(actor,cancelled._id);
    const sale = (await attachGenerationSale(actor,id,{...importInput,importId:randomUUID()})).job;
    await uploadLookup(actor,sale._id,{offset:0,rows:[row]});
    const orphan = await createLookup(actor,{...importInput,importId:randomUUID()},PURCHASE_MODE);
    await (await collection('lookupJobs')).updateOne(scope({_id:orphan._id}),{$set:{generationId:id}});
    const independent = await createLookup(actor,{...importInput,importId:randomUUID()},PURCHASE_MODE);
    const otherGeneration = await createGeneration(actor,{generationId:randomUUID(),clientIds:[otherClient]});
    const otherJob = (await attachGenerationPurchase(actor,otherGeneration._id,{...importInput,clientId:otherClient,importId:randomUUID()})).job;
    const jobIds = [purchase._id,cancelled._id,sale._id,orphan._id];
    await (await collection('lookupItems')).insertOne({_id:purchase._id+':synthetic',...scope(),jobId:purchase._id,state:'DONE'});
    await (await collection('lookupItems')).insertOne({_id:'foreign-item',workspaceId:'other_workspace',jobId:purchase._id,state:'DONE'});
    await (await collection('chunks')).insertOne({_id:'lookup:'+purchase._id+':foreign',workspaceId:'other_workspace'});
    const snapshotId = randomUUID(), pdfId = randomUUID();
    await (await collection('simulations')).insertOne({_id:snapshotId,...scope(),generationId:id,frozen:true});
    await (await collection('simplesDocuments')).insertOne({_id:pdfId,...scope(),clientId});
    await (await collection('cnpjStates')).insertOne({_id:'shared-state',...scope(),cnpj:'00000000000191'});
    await (await collection('cnpjEntities')).insertOne({_id:'shared-entity',...scope(),cnpj:'00000000000191'});
    const url = new URL('https://test/api/v4/generations/'+id);
    await assert.rejects(routeV4({...actor,role:'viewer'},'DELETE',url,{}),errorCode('FORBIDDEN'));
    process.env.WORKSPACE_ID = 'other_workspace';
    await assert.rejects(deleteGeneration(actor,id),errorCode('NOT_FOUND'));
    process.env.WORKSPACE_ID = 'generation_delete_test';

    for (const kind of ['generation','job']) {
      let acquired!:()=>void, release!:()=>void;
      const ready = new Promise<void>(resolve=>{acquired=resolve;}), wait = new Promise<void>(resolve=>{release=resolve;});
      const held = kind==='generation'
        ? withGeneration(id,async()=>{acquired();await wait;})
        : withJob(sale._id,async()=>{acquired();await wait;});
      await ready;
      try {
        await assert.rejects(deleteGeneration(actor,id),errorCode('GENERATION_BUSY'));
        assert.equal(await generationDeletion(id),null);
        assert.equal(await (await collection('lookupJobs')).countDocuments(scope({_id:{$in:jobIds}})),4);
        assert.equal((await (await collection('generations')).findOne(scope({_id:id})))?.deletionStartedAt,undefined);
      } finally { release(); await held; }
    }

    // Failure before the reservation is durable must keep a visible, retryable generation.
    const events = await collection('audit'), eventProto = Object.getPrototypeOf(events), originalUpdateOne = eventProto.updateOne;
    eventProto.updateOne = function(...args:any[]) {
      if(this.collectionName==='audit'&&args[1]?.$setOnInsert?.action==='generation.delete')throw new Error('synthetic receipt interruption');
      return originalUpdateOne.apply(this,args);
    };
    try { await assert.rejects(deleteGeneration(actor,id),/synthetic receipt interruption/); }
    finally { eventProto.updateOne = originalUpdateOne; }
    assert.equal(await generationDeletion(id),null);
    assert.equal((await generationHistory(1)).items.some(item=>item._id===id),true);
    assert.equal((await (await collection('generations')).findOne(scope({_id:id})))?.deletionStartedAt,undefined);
    assert.equal(await (await collection('lookupJobs')).countDocuments(scope({_id:{$in:jobIds}})),4);

    // If per-job receipts fail, the durable generation receipt still fences every writer.
    const originalBulkWrite = eventProto.bulkWrite;
    eventProto.bulkWrite = function(...args:any[]) {
      if(this.collectionName==='audit')throw new Error('synthetic job receipt interruption');
      return originalBulkWrite.apply(this,args);
    };
    try { await assert.rejects(deleteGeneration(actor,id),/synthetic job receipt interruption/); }
    finally { eventProto.bulkWrite = originalBulkWrite; }
    assert(await generationDeletion(id));
    await assert.rejects(getJob(sale._id),errorCode('NOT_FOUND'));
    await assert.rejects(uploadLookup(actor,sale._id,{offset:0,rows:[row]}),errorCode('GENERATION_DELETED'));

    // A failed cleanup leaves reservations in place, then DELETE resumes using its owned IDs.
    const lines = await collection('purchaseLines'), proto = Object.getPrototypeOf(lines), originalDeleteMany = proto.deleteMany;
    let interrupted = false;
    proto.deleteMany = function(...args:any[]) {
      if(this.collectionName==='purchaseLines'&&!interrupted){interrupted=true;throw new Error('synthetic purge interruption');}
      return originalDeleteMany.apply(this,args);
    };
    try { await assert.rejects(deleteGeneration(actor,id),/synthetic purge interruption/); }
    finally { proto.deleteMany = originalDeleteMany; }
    assert.equal(interrupted,true);
    assert.equal((await generationHistory(1)).items.some(item=>item._id===id),false);
    await assert.rejects(getGeneration(id),errorCode('NOT_FOUND'));
    await assert.rejects(uploadLookup(actor,sale._id,{offset:0,rows:[row]}),errorCode('LOOKUP_DELETED'));
    const receiptBefore = await generationDeletion(id);
    assert.deepEqual((await routeV4(actor,'DELETE',url,{})),{deleted:true,id});
    assert.deepEqual(await deleteGeneration({...actor,_id:'another-operator'},id),{deleted:true,id});
    const receipt = await generationDeletion(id);
    assert.equal(receipt?.actor,'deleter');
    assert.equal(receipt?.createdAt.getTime(),receiptBefore?.createdAt.getTime());
    assert.deepEqual([...receipt!.jobIds].sort(),jobIds.sort());
    assert.deepEqual(Object.keys(receipt!).sort(),['_id','action','actor','createdAt','jobIds','target','workspaceId'].sort());
    assert.equal(await (await collection('generations')).countDocuments(scope({_id:id})),0);
    assert.equal(await (await collection('lookupJobs')).countDocuments(scope({_id:{$in:jobIds}})),0);
    for(const name of ['lookupStage','purchaseLines','lookupItems']){
      assert.equal(await (await collection(name)).countDocuments(scope({jobId:{$in:jobIds}})),0,name);
    }
    assert.equal(await (await collection('chunks')).countDocuments(scope({_id:{$regex:'^lookup:(?:'+jobIds.join('|')+'):'}})),0);
    assert.equal(await (await collection('lookupJobs')).countDocuments(scope({_id:{$in:[independent._id,otherJob._id]}})),2);
    assert.equal(await (await collection('simulations')).countDocuments(scope({_id:snapshotId})),1);
    assert.equal(await (await collection('simplesDocuments')).countDocuments(scope({_id:pdfId})),1);
    assert.equal(await (await collection('clients')).countDocuments(scope()),2);
    assert.equal(await (await collection('cnpjStates')).countDocuments(scope()),1);
    assert.equal(await (await collection('cnpjEntities')).countDocuments(scope()),1);
    assert.equal(await (await collection('lookupItems')).countDocuments({workspaceId:'other_workspace',jobId:purchase._id}),1);
    assert.equal(await (await collection('chunks')).countDocuments({_id:'lookup:'+purchase._id+':foreign'}),1);
    await assert.rejects(createGeneration(actor,input),errorCode('GENERATION_DELETED'));
    await assert.rejects(createLookup(actor,importInput,PURCHASE_MODE),errorCode('LOOKUP_DELETED'));
    await assert.rejects(attachGenerationPurchase(actor,id,{...importInput,importId:randomUUID()}),errorCode('NOT_FOUND'));
    await assert.rejects(getJob(purchase._id),errorCode('NOT_FOUND'));
    assert.equal((await getGeneration(otherGeneration._id))._id,otherGeneration._id);
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
