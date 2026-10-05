import {section22} from './fixtures/section22.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createGeneration, attachGenerationPurchase, attachGenerationSale } from '../src/generation-store.ts';
import { uploadLookup, finalizeLookup, processLookup } from '../src/lookup-jobs.ts';
import { routeV4 } from '../src/lookup-http.ts';
import { createSimulation, deleteSimulation, getSimulation, simulationHistory } from '../src/simulation-history.ts';
import { calculateSimulation, draftToInput, MODEL_VERSION, CALCULATOR_SOURCE_COMMIT, TAX_SOURCES } from '../public/simulator-engine.js';
import { digits } from '../src/domain.ts';
import { digest, token } from '../src/security.ts';
import { handler } from '../src/server.ts';

test('MongoDB histórico de simulações: validação, snapshot completo, concorrência, versões e isolamento',
  {skip: !process.env.MONGODB_URI, timeout: 120000}, async t => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID, oldOrigin = process.env.APP_ORIGIN;
  process.env.MONGODB_DB = 'maximum_sim_history_' + randomUUID().replaceAll('-', '');
  process.env.WORKSPACE_ID = 'simulation_history_test'; resetLookupIndexes();
  const actor = {_id: 'tester', role: 'admin', name: 'Pessoa de teste', email: 'test@example.test'};
  const operator = {...actor, _id: 'operator', role: 'operator', name: 'Operador de teste'};
  const viewer = {...actor, _id: 'viewer', role: 'viewer'};
  const code = (value: string) => (error: any) => error.code === value;
  const ids = ['000000000001', '111111110001'].map(base => base + digits(base));
  let providerCalls = 0;
  const transport = (async (url: string | URL | Request) => {
    providerCalls++;
    const cnpj = String(url).split('/').pop();
    return Response.json({cnpj, razao_social: 'Fornecedor sintético', opcao_pelo_simples: cnpj === ids[0], opcao_pelo_mei: false});
  }) as typeof fetch;
  const reportRows = [[ids[0], 10001], [ids[1], 20001], ['12345678900', 30001]].map(([document, totalCents], index) => ({
    document, name: 'Parceiro sintético', serviceDate: ['2026-06-15','2026-07-15','2026-08-15'][index], quantity: '1', totalCents,
    grossCents: totalCents, discountCents: 0, accessoryCents: 0, freightCents: 0, abatementCents: 0
  }));
  let server: http.Server | undefined;
  try {
    const catalog = await importCatalog(actor, [{code: '936', name: 'Empresa A'}, {code: '937', name: 'Empresa B'}]);
    const [clientId, outside] = catalog.items.map((client: any) => client.id);
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const generationId = generation._id;
    const monthlyGroups = {salesOptantCents: 33.34, salesNonOptantCents: 66.67, salesCpfCents: 100,
      purchasesOptantCents: 33.34, purchasesNonOptantCents: 166.67};
    const draft: any = {year: 2027, salesAnnex: 1, serviceAnnex: 3, rbt12: 500000, values: {
      serviceRevenue: 5000, salesRevenue: 200.01, simplePurchases: 33.34, regularPurchases: 166.67,
      salaries: 100, benefits: 5.25, adminExpenses: 0, rent: 10, cardExpenses: .29
    }};
    const input = {simulationId: randomUUID(), rbt12ExtractionId: randomUUID(), generationId, clientId, reportMonths: 3,
      periodConfirmed: true, monthlyGroups, draft};
    await assert.rejects(createSimulation(actor, input), code('SIMULATOR_INCOMPLETE'));
    const jobs: any[] = [];
    for (const [attach, fileName] of [[attachGenerationPurchase, 'compras.csv'], [attachGenerationSale, 'vendas.csv']] as const) {
      const {job} = await attach(actor, generationId, {clientId, importId: randomUUID(), fileName, expectedRows: reportRows.length});
      jobs.push(job);
      await uploadLookup(actor, job._id, {offset: 0, rows: reportRows});
      await finalizeLookup(actor, job._id);
      await (await collection('providerControl')).deleteMany({});
      await processLookup(actor, job._id, transport);
    }
    assert.equal(providerCalls, 4);
    await (await collection('simplesExtractions')).insertOne({...scope(),_id:input.rbt12ExtractionId,clientId,parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result:section22(50000000)});
    let saved: any;

    await t.test('campos obrigatórios, precisão monetária e somas dos grupos', async () => {
      await assert.rejects(createSimulation(viewer, input), code('FORBIDDEN'));
      for (const bad of [null, [], {}, {...input, simulationId: 'invalid'}, {...input, periodConfirmed: false},
        {...input, reportMonths: '3'}, {...input, reportMonths: 0}, {...input, reportMonths: 13}, {...input, reportMonths: 1.2},
        {...input, title: ''}, {...input, title: 'x'.repeat(161)}, {...input, result: {bestRegimeId: 'evil'}},
        {...input, source: {company: {name: 'Fabricated'}}}, {...input, manuallyAdjusted: false}]) {
        await assert.rejects(createSimulation(actor, bad), code('VALIDATION'));
      }
      for (const bad of [null, '', -1, '0', NaN, Infinity, .001, 1_000_000_000_001]) {
        await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, salaries: bad}}}), code('VALIDATION'));
        await assert.rejects(createSimulation(actor, {...input, monthlyGroups: {...monthlyGroups, salesCpfCents: bad}}), code('VALIDATION'));
      }
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, year: '2027'}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, year: 2029}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, salesAnnex: 3}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, serviceAnnex: 1}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, extra: true}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, monthlyGroups: {...monthlyGroups, extra: 0}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, salesRevenue: 201}}}), code('SIMULATION_TOTAL'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, simplePurchases: 34}}}), code('SIMULATION_TOTAL'));
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, regularPurchases: 34}}}), code('SIMULATION_TOTAL'));
      // The monthly input limit is independent from the explicit historical RBT12.
      await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, serviceRevenue: 1_000_000_000_001}}}), code('VALIDATION'));
      await assert.rejects(createSimulation(actor, {...input, clientId: outside}), code('GENERATION_CLIENT'));
      assert.equal(await (await collection('simulations')).countDocuments(scope()), 0);
    });

    await t.test('calcula no servidor, congela todas as premissas e arredonda sem falsos ajustes', async () => {
      saved = await routeV4(actor, 'POST', new URL('https://test/api/v4/simulations'), input);
      assert.equal(saved._id, input.simulationId);
      assert.equal(saved.title, 'Empresa A · 2027');
      assert.deepEqual(saved.createdBy, {id: actor._id, name: actor.name});
      assert.deepEqual(saved.company, {name: 'Empresa A', code: '936'});
      assert.deepEqual(saved.result, calculateSimulation(draft));
      assert.deepEqual(saved.engineInput, draftToInput(draft));
      assert.deepEqual(saved.taxSources, TAX_SOURCES);
      assert.deepEqual(saved.draft, draft);
      assert.deepEqual(saved.monthlyGroups, monthlyGroups);
      assert.deepEqual(saved.baselineMonthlyGroups, monthlyGroups);
      assert.equal(saved.monthlyGroupsUnit, 'BRL');
      assert.equal(saved.modelVersion, MODEL_VERSION);
      assert.equal(saved.calculatorSourceCommit, CALCULATOR_SOURCE_COMMIT);
      assert.equal(saved.manuallyAdjusted, false);
      assert.deepEqual(saved.adjustments, []);
      assert.equal(saved.source.sales.totalCents, 60003);
      assert.equal(saved.source.purchases.totalCents, 60003);
      assert.equal(saved.source.sales.jobId, jobs[1]._id);
      assert.equal(saved.periodBasis, 'COLUMN_H'); assert.equal(saved.reportMonths, 3);
      assert.deepEqual(saved.reportPeriod, {startDate:'2026-06-15',endDate:'2026-08-15',startMonth:'2026-06',endMonth:'2026-08',months:3,observedMonths:3,missingMonths:[]});
      assert.equal(saved.rbt12Source, 'SIMPLES_SECTION_22');
      assert.equal(saved.monthlyDre.months.length,12);assert.equal(saved.monthlyDre.rbt12Reference.rbt12Cents,50000000);
      assert.equal(saved.parentSimulationId, null);
      assert.equal(saved.workspaceId, undefined);
      assert.equal(saved.requestHash, undefined);
      assert.equal(providerCalls, 4, 'Simular não faz consulta externa adicional.');
    });

    await t.test('RBT12 obrigatória, imutável e isolada pela seção 2.2', async () => {
      const fresh={...input,simulationId:randomUUID()};
      await assert.rejects(createSimulation(actor,{...fresh,rbt12ExtractionId:undefined}),code('RBT12_REQUIRED'));
      await assert.rejects(createSimulation(actor,{...fresh,draft:{...draft,rbt12:500001}}),code('RBT12_EXTRACTION'));
      await assert.rejects(createSimulation(actor,{...fresh,rbt12ExtractionId:randomUUID()}),code('RBT12_EXTRACTION'));
      const records=await collection('simplesExtractions');
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{'result.rbt12Window.0.totalCents':0}});
      await assert.rejects(createSimulation(actor,fresh),code('RBT12_EXTRACTION'));
      assert.deepEqual(await getSimulation(saved._id),saved,'O histórico não é recalculado com a fonte alterada.');
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{result:section22(50000000)}});
    });

    await t.test('reenvio idempotente, concorrência e conflito sem alteração da versão anterior', async () => {
      const repeated = await createSimulation(actor, structuredClone(input));
      assert.deepEqual(repeated, saved);
      const concurrentInput = {...input, simulationId: randomUUID(), title: 'Concorrente'};
      const copies = await Promise.all([createSimulation(actor, concurrentInput), createSimulation(actor, concurrentInput)]);
      assert.deepEqual(copies[0], copies[1]);
      assert.equal(await (await collection('simulations')).countDocuments(scope({_id: concurrentInput.simulationId})), 1);
      assert.equal(await (await collection('audit')).countDocuments(scope({action: 'simulation.create', target: concurrentInput.simulationId})), 1);
      await assert.rejects(createSimulation(operator, input), code('SIMULATION_EXISTS'));
      await assert.rejects(createSimulation(actor, {...input, title: 'Alterado'}), code('SIMULATION_EXISTS'));
      await assert.rejects(createSimulation(actor, {...input, reportMonths: 2}), code('SIMULATION_EXISTS'));
      assert.deepEqual(await getSimulation(input.simulationId), saved);
    });

    await t.test('nova versão vinculada identifica ajustes e não modifica a original', async () => {
      const revised = await createSimulation(operator, {...input, simulationId: randomUUID(), parentSimulationId: saved._id,
        title: 'Revisão 2028', monthlyGroups: {...monthlyGroups, salesCpfCents: 150},
        draft: {...draft, year: 2028, values: {...draft.values, salesRevenue: 250.01, rent: 15}}});
      assert.equal(revised.parentSimulationId, saved._id);
      assert.equal(revised.manuallyAdjusted, true);
      assert.deepEqual(revised.adjustments, [{field: 'salesCpfCents', reportMonthlyValue: 100, simulatedMonthlyValue: 150}]);
      assert.equal(revised.createdBy.id, operator._id);
      assert.deepEqual(await getSimulation(saved._id), saved);
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID(), parentSimulationId: randomUUID()}), code('NOT_FOUND'));
      await assert.rejects(createSimulation(actor, {...input, parentSimulationId: input.simulationId}), code('VALIDATION'));
      const another = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID(), generationId: another._id,
        parentSimulationId: saved._id}), code('SIMULATION_PARENT'));
    });

    await t.test('histórico paginado, metadados, busca literal e filtro por empresa/ano', async () => {
      const list: any = await routeV4(viewer, 'GET', new URL('https://test/api/v4/simulations?year=2028&search=Revis%C3%A3o'), {});
      assert.equal(list.total, 1);
      assert.equal(list.page, 1);
      assert.equal(list.pageSize, 20);
      assert.equal(list.items[0].company.name, 'Empresa A');
      assert.equal(list.items[0].createdBy.id, operator._id);
      assert.equal(list.items[0].year, 2028);
      assert.equal(list.items[0].source, undefined);
      assert.equal(list.items[0].result, undefined);
      assert.equal(list.items[0].workspaceId, undefined);
      assert.equal(typeof list.items[0].bestAnnualProfit, 'number');
      assert.equal((await simulationHistory(1, {clientId})).total, 3);
      assert.equal((await simulationHistory(1, {clientId: outside})).total, 0);
      assert.equal((await simulationHistory(1, {search: '936'})).total, 3);
      assert.equal((await simulationHistory(1, {search: 'Operador'})).total, 1);
      assert.equal((await simulationHistory(1, {search: '.*'})).total, 0);
      assert.equal((await simulationHistory(1, {year: '2027'})).total, 2);
      assert.equal((await simulationHistory(2)).items.length, 0);
      await assert.rejects(simulationHistory(1, {year: '0'}), code('VALIDATION'));
      await assert.rejects(simulationHistory(1, {clientId: 'invalid'}), code('VALIDATION'));
      await assert.rejects(simulationHistory(1, {search: 'x'.repeat(101)}), code('VALIDATION'));
      await assert.rejects(simulationHistory(0), code('VALIDATION'));
      // Seed additional immutable records solely to exercise the page boundary.
      const original = await (await collection('simulations')).findOne(scope({_id: saved._id}));
      await (await collection('simulations')).insertMany(Array.from({length: 19}, (_, index) => ({
        ...original!, _id: randomUUID(), createdAt: new Date(1_000_000 + index), title: `Página ${index}`
      })));
      const firstPage = await simulationHistory(1), secondPage = await simulationHistory(2);
      assert.equal(firstPage.total, 22); assert.equal(firstPage.items.length, 20); assert.equal(secondPage.items.length, 2);
      assert.equal(new Set([...firstPage.items, ...secondPage.items].map(item => item._id)).size, 22);
      await (await collection('simulations')).deleteMany(scope({title: {$regex: '^Página '}}));
    });

    await t.test('leitura histórica não depende dos relatórios nem recalcula resultados', async () => {
      const lines = await collection('purchaseLines');
      await lines.updateOne(scope({jobId: jobs[1]._id, index: 0}), {$inc: {grossCents: 1}});
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID()}), code('PURCHASE_TOTAL'));
      assert.deepEqual(await getSimulation(saved._id), saved);
      assert.deepEqual(await createSimulation(actor, input), saved, 'Retentativa idempotente retorna o snapshot mesmo que a fonte mude.');
      await lines.updateOne(scope({jobId: jobs[1]._id, index: 0}), {$inc: {grossCents: -1}});
      const oldName = 'Empresa A';
      await (await collection('clients')).updateOne(scope({_id: clientId}), {$set: {name: 'Nome atual'}});
      await (await collection('lookupJobs')).updateOne(scope({_id: jobs[0]._id}), {$set: {status: 'CANCELLED'}});
      const historic = await getSimulation(saved._id);
      assert.equal(historic.company.name, oldName);
      assert.deepEqual(historic.result, saved.result);
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID()}), code('SIMULATOR_INCOMPLETE'));
      await (await collection('lookupJobs')).updateOne(scope({_id: jobs[0]._id}), {$set: {status: 'COMPLETED'}});
      assert.equal(providerCalls, 4);
      await assert.rejects(routeV4(actor, 'PATCH', new URL(`https://test/api/v4/simulations/${saved._id}`), {}), code('NOT_FOUND'));
    });

    await t.test('todo acesso respeita workspace, inclusive reenvio e vínculo de versão', async () => {
      process.env.WORKSPACE_ID = 'another_workspace';
      try {
        await assert.rejects(getSimulation(saved._id), code('NOT_FOUND'));
        await assert.rejects(deleteSimulation(actor, saved._id), code('NOT_FOUND'));
        assert.equal((await simulationHistory(1)).total, 0);
        await assert.rejects(createSimulation(actor, input), code('NOT_FOUND'));
        await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID(), parentSimulationId: saved._id}), code('NOT_FOUND'));
      } finally { process.env.WORKSPACE_ID = 'simulation_history_test'; }
      assert.deepEqual(await getSimulation(saved._id), saved);
    });

    await t.test('exclusão lógica concorrente reserva o ID, audita uma vez e preserva outras versões e fontes', async () => {
      const parentInput = {...input, simulationId: randomUUID(), title: 'Origem para excluir'};
      const parent = await createSimulation(actor, parentInput);
      const child = await createSimulation(operator, {...input, simulationId: randomUUID(), parentSimulationId: parent._id,
        title: 'Filha preservada'});
      const c = await collection('simulations'), logs = await collection('audit');
      const original = await c.findOne(scope({_id: parent._id}));
      const childRecord = await c.findOne(scope({_id: child._id}));
      const preservedCollections = ['generations', 'clients', 'lookupJobs', 'lookupItems', 'purchaseLines', 'simplesExtractions'];
      const sources = await Promise.all(preservedCollections.map(async name => (await collection(name)).find(scope()).sort({_id: 1}).toArray()));
      const before = await simulationHistory(1);
      assert.equal(Object.hasOwn(await getSimulation(child._id), 'parentSimulationDeleted'), false);
      await assert.rejects(deleteSimulation(viewer, parent._id), code('FORBIDDEN'));
      await assert.rejects(deleteSimulation(actor, 'invalid'), code('VALIDATION'));
      await assert.rejects(routeV4(actor, 'DELETE', new URL(`https://test/api/v4/simulations/${'-'.repeat(36)}`), {}), code('VALIDATION'));
      await assert.rejects(deleteSimulation(actor, randomUUID()), code('NOT_FOUND'));
      assert.deepEqual(await getSimulation(parent._id), parent);

      const deleted = {deleted: true, id: parent._id};
      const copies = await Promise.all([
        routeV4(actor, 'DELETE', new URL(`https://test/api/v4/simulations/${parent._id}`), {}),
        deleteSimulation(operator, parent._id), deleteSimulation(actor, parent._id)
      ]);
      assert.deepEqual(copies, [deleted, deleted, deleted]);
      const tombstone = await c.findOne(scope({_id: parent._id}));
      assert.ok(tombstone!.deletedAt instanceof Date);
      assert.ok([actor._id, operator._id].includes(tombstone!.deletedBy.id));
      const {deletedAt, deletedBy, ...frozen} = tombstone!;
      assert.deepEqual(frozen, original, 'A exclusão mantém o snapshot e a reserva do identificador.');
      const deletionAudits = await logs.find(scope({action: 'simulation.delete', target: parent._id})).toArray();
      assert.equal(deletionAudits.length, 1, 'As exclusões concorrentes registram um único evento.');
      assert.equal(deletionAudits[0].actor, deletedBy.id);
      assert.deepEqual(deletionAudits[0].createdAt, deletedAt);
      await assert.rejects(getSimulation(parent._id), code('NOT_FOUND'));
      await assert.rejects(createSimulation(actor, parentInput), code('SIMULATION_DELETED'));
      await assert.rejects(createSimulation(operator, parentInput), code('SIMULATION_DELETED'));
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID(), parentSimulationId: parent._id}), code('NOT_FOUND'));
      const after = await simulationHistory(1);
      assert.equal(after.total, before.total - 1);
      assert.equal(after.items.some(item => item._id === parent._id), false);
      assert.equal((await simulationHistory(1, {clientId, search: parentInput.title})).total, 0);
      assert.deepEqual(await getSimulation(child._id), {...child, parentSimulationDeleted: true});
      assert.deepEqual(await c.findOne(scope({_id: child._id})), childRecord, 'O sinal da origem excluída é derivado, sem alterar a filha.');
      assert.deepEqual(await getSimulation(saved._id), saved);
      assert.equal(Object.hasOwn(await getSimulation(saved._id), 'parentSimulationDeleted'), false);
      for (let index = 0; index < preservedCollections.length; index++) {
        assert.deepEqual(await (await collection(preservedCollections[index])).find(scope()).sort({_id: 1}).toArray(), sources[index],
          `${preservedCollections[index]} deve permanecer intacta.`);
      }
      assert.equal(providerCalls, 4, 'Excluir não faz consulta ao provedor.');
      assert.deepEqual(await deleteSimulation(operator, parent._id), deleted);
      assert.deepEqual(await c.findOne(scope({_id: parent._id})), tombstone, 'Repetir a exclusão mantém a primeira data e autoria.');
      assert.equal(await logs.countDocuments(scope({action: 'simulation.delete', target: parent._id})), 1);
      // Simulate an unavailable audit write after the tombstone was saved; a retry repairs exactly the original event.
      await logs.deleteOne(scope({_id: deletionAudits[0]._id}));
      await deleteSimulation(deletedBy.id === actor._id ? operator : actor, parent._id);
      assert.deepEqual(await logs.find(scope({action: 'simulation.delete', target: parent._id})).toArray(), deletionAudits);
      process.env.WORKSPACE_ID = 'another_workspace';
      try { await assert.rejects(deleteSimulation(actor, parent._id), code('NOT_FOUND')); }
      finally { process.env.WORKSPACE_ID = 'simulation_history_test'; }
      // Even a malformed cross-workspace parent link cannot reveal a foreign tombstone.
      const isolatedChildId = randomUUID();
      await c.insertOne({...childRecord!, _id: isolatedChildId, workspaceId: 'another_workspace'});
      process.env.WORKSPACE_ID = 'another_workspace';
      try { assert.equal(Object.hasOwn(await getSimulation(isolatedChildId), 'parentSimulationDeleted'), false); }
      finally { process.env.WORKSPACE_ID = 'simulation_history_test'; }
      assert.equal(await c.countDocuments(scope({_id: parent._id})), 1);
    });

    await t.test('HTTP exige sessão, origem válida e permissão de escrita; viewer pode reabrir', async () => {
      server = http.createServer(handler);
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as any).port}`; process.env.APP_ORIGIN = base;
      const raw = token();
      await (await collection('users')).insertOne({...viewer, ...scope(), active: true, mustChangePassword: false});
      await (await collection('sessions')).insertOne({_id: digest(raw), ...scope(), userId: viewer._id, expiresAt: new Date(Date.now() + 60_000)});
      const cookieName = process.env.NODE_ENV === 'production' ? '__Host-maximum_session' : 'maximum_session';
      const headers = {Cookie: `${cookieName}=${raw}`, Origin: base, 'Content-Type': 'application/json'};
      const savedUrl = base + `/api/v4/simulations/${saved._id}`;
      assert.equal((await fetch(base + '/api/v4/simulations')).status, 401);
      assert.equal((await fetch(base + `/api/v4/simulations/${saved._id}`)).status, 401);
      assert.equal((await fetch(savedUrl, {method: 'DELETE', headers: {Origin: base, 'Content-Type': 'application/json'}, body: '{}'})).status, 401);
      const detail = await fetch(base + `/api/v4/simulations/${saved._id}`, {headers});
      assert.equal(detail.status, 200); assert.equal(detail.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await detail.json(), JSON.parse(JSON.stringify(saved)));
      const forbidden = await fetch(base + '/api/v4/simulations', {method: 'POST', headers, body: JSON.stringify({...input, simulationId: randomUUID()})});
      assert.equal(forbidden.status, 403); assert.equal((await forbidden.json()).error, 'FORBIDDEN');
      const forbiddenDelete = await fetch(savedUrl, {method: 'DELETE', headers, body: '{}'});
      assert.equal(forbiddenDelete.status, 403); assert.equal((await forbiddenDelete.json()).error, 'FORBIDDEN');
      assert.equal((await fetch(base + '/api/v4/simulations', {method: 'POST', headers: {...headers, Origin: 'https://evil.example'}, body: '{}'})).status, 403);

      const operatorRaw = token();
      await (await collection('users')).insertOne({...operator, email: 'operator@example.test', ...scope(), active: true, mustChangePassword: false});
      await (await collection('sessions')).insertOne({_id: digest(operatorRaw), ...scope(), userId: operator._id, expiresAt: new Date(Date.now() + 60_000)});
      const operatorHeaders = {...headers, Cookie: `${cookieName}=${operatorRaw}`};
      const candidateInput = {...input, simulationId: randomUUID(), title: 'Excluir via HTTP'};
      const candidate = await createSimulation(operator, candidateInput), deleteUrl = base + `/api/v4/simulations/${candidate._id}`;
      const badOrigin = await fetch(deleteUrl, {method: 'DELETE', headers: {...operatorHeaders, Origin: 'https://evil.example'}, body: '{}'});
      assert.equal(badOrigin.status, 403); assert.equal((await badOrigin.json()).error, 'ORIGIN');
      assert.equal((await fetch(deleteUrl, {headers})).status, 200);
      for (let attempt = 0; attempt < 2; attempt++) {
        const deleted = await fetch(deleteUrl, {method: 'DELETE', headers: operatorHeaders, body: '{}'});
        assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), {deleted: true, id: candidate._id});
      }
      assert.equal((await fetch(deleteUrl, {headers})).status, 404);
      const retry = await fetch(base + '/api/v4/simulations', {method: 'POST', headers: operatorHeaders, body: JSON.stringify(candidateInput)});
      assert.equal(retry.status, 409); assert.equal((await retry.json()).error, 'SIMULATION_DELETED');
      assert.equal(await (await collection('audit')).countDocuments(scope({action: 'simulation.delete', target: candidate._id})), 1);
      assert.deepEqual(await getSimulation(saved._id), saved);
      await (await collection('users')).updateOne(scope({_id: viewer._id}), {$set: {mustChangePassword: true}});
      assert.equal((await fetch(base + `/api/v4/simulations/${saved._id}`, {headers})).status, 403);
      assert.equal((await fetch(savedUrl, {method: 'DELETE', headers, body: '{}'})).status, 403);
      await (await collection('users')).updateOne(scope({_id: viewer._id}), {$set: {mustChangePassword: false, active: false}});
      assert.equal((await fetch(base + `/api/v4/simulations/${saved._id}`, {headers})).status, 401);
      assert.equal((await fetch(savedUrl, {method: 'DELETE', headers, body: '{}'})).status, 401);
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = oldOrigin;
  }
});
