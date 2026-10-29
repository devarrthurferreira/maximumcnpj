import {baselineMonth,calculateMonthlySimulation,MONTHLY_MODEL_VERSION} from '../public/simulator-monthly.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {generationSimulator} from '../src/simulator-store.ts';
import {section22Year2025} from './fixtures/section22.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Collection } from 'mongodb';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createGeneration, deleteGeneration, attachGenerationPurchase, attachGenerationSale } from '../src/generation-store.ts';
import { uploadLookup, finalizeLookup, processLookup } from '../src/lookup-jobs.ts';
import { routeV4 } from '../src/lookup-http.ts';
import { createSimulation, deleteSimulation, getSimulation, simulationHistory } from '../src/simulation-history.ts';
import { calculateSimulation, draftToInput, MODEL_VERSION, CALCULATOR_SOURCE_COMMIT, TAX_SOURCES, defaultDifalPolicy, upgradeDifalPolicy } from '../public/simulator-engine.js';
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
    document, name: 'Parceiro sintético', serviceDate: ['2025-06-15','2025-07-15','2025-08-15'][index], quantity: '1', totalCents,recipientUf:'SP',
    grossCents: totalCents, discountCents: 0, accessoryCents: 0, freightCents: 0, abatementCents: 0
  }));
  let server: http.Server | undefined;
  try {
    const catalog = await importCatalog(actor, [{code: '936', name: 'Empresa A',uf:'SP'}, {code: '937', name: 'Empresa B',uf:'SP'}]);
    const [clientId, outside] = catalog.items.map((client: any) => client.id);
    const generation = await createGeneration(actor, {generationId: randomUUID(), clientIds: [clientId]});
    const generationId = generation._id;
    const monthlyGroups = {salesOptantCents: 33.34, salesNonOptantCents: 66.67, salesCpfCents: 100,
      purchasesOptantCents: 33.34, purchasesNonOptantCents: 166.67};
    const draft: any = {year: 2027, salesAnnex: 1, serviceAnnex: 3, rbt12: 210000, values: {
      serviceRevenue: 5000, salesRevenue: 200.01, simplePurchases: 33.34, regularPurchases: 166.67,
      salaries: 100, benefits: 5.25, adminExpenses: 0, rent: 10, cardExpenses: .29
    }};
    const input: any = {simulationId: randomUUID(), rbt12ExtractionId: randomUUID(), generationId, clientId, reportMonths: 3,
      periodConfirmed: true, monthlyGroups, draft};
    await assert.rejects(createSimulation(actor, input), code('SIMULATOR_INCOMPLETE'));
    const jobs: any[] = [];
    for (const [attach, fileName] of [[attachGenerationPurchase, 'compras.csv'], [attachGenerationSale, 'vendas.csv']] as const) {
      const {job} = await attach(actor, generationId, {clientId, importId: randomUUID(), fileName, expectedRows: reportRows.length});
      jobs.push(job);
      await uploadLookup(actor, job._id, {offset: 0, rows: reportRows.map(row=>({...row,natureCode:attach===attachGenerationPurchase?'1102':'5102'}))});
      await finalizeLookup(actor, job._id);
      await (await collection('providerControl')).deleteMany({});
      await processLookup(actor, job._id, transport);
    }
    const monthlySource=await generationSimulator(generationId,clientId);
    input.monthlyInputs=monthlySource.monthlyReports!.map(row=>{const entry=baselineMonth(row,draft.values);entry.values.serviceRevenue=5000;return entry;});
    const extraction=section22Year2025(),rbt12Schedule=buildRbt12Schedule(extraction,monthlySource.monthlyReports!.map(row=>row.sourceMonth));
    const expected=(d:any,entries=input.monthlyInputs,schedule:ReturnType<typeof buildRbt12Schedule>|null=rbt12Schedule)=>calculateMonthlySimulation({...d,difalPolicy:upgradeDifalPolicy(d.difalPolicy)},monthlySource.monthlyReports!,entries,monthlySource.sales.jobId,schedule);
    assert.equal(providerCalls, 4);
    await (await collection('simplesExtractions')).insertOne({...scope(),_id:input.rbt12ExtractionId,clientId,parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result:extraction});
    let saved: any;

    await t.test('campos obrigatórios, precisão monetária e somas dos grupos', async () => {
      await assert.rejects(createSimulation(viewer, input), code('FORBIDDEN'));
      for (const bad of [null, [], {}, {...input, simulationId: 'invalid'}, {...input, periodConfirmed: false},
        {...input, reportMonths: '3'}, {...input, reportMonths: 0}, {...input, reportMonths: 13}, {...input, reportMonths: 1.2},
        {...input, title: ''}, {...input, title: 'x'.repeat(161)}, {...input, result: {bestRegimeId: 'evil'}},
        {...input, source: {company: {name: 'Fabricated'}}}, {...input, manuallyAdjusted: false},
        {...input,rbt12Schedule:{...rbt12Schedule,rows:[]}}]) {
        await assert.rejects(createSimulation(actor, bad), code('VALIDATION'));
      }
      for (const bad of [null, '', -1, '0', NaN, Infinity, .001, 1_000_000_000_001]) {
        await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, salaries: bad}}}), code('VALIDATION'));
      }
      for (const bad of [null, '', '0', NaN, Infinity, .001, 1_000_000_000_001]) {
        await assert.rejects(createSimulation(actor, {...input, monthlyGroups: {...monthlyGroups, salesCpfCents: bad}}), code('VALIDATION'));
      }
      for (const bad of [null, '', '0', NaN, Infinity, -.001, -1_000_000_000_001]) {
        await assert.rejects(createSimulation(actor, {...input, draft: {...draft, values: {...draft.values, salesRevenue: bad}}}), code('VALIDATION'));
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
      assert.deepEqual(saved.result, expected(draft).result);
      assert.deepEqual(saved.engineInput, expected(draft).engineInput);
      assert.deepEqual(saved.taxSources, TAX_SOURCES);
      assert.deepEqual(saved.draft, {...draft,difalPolicy:defaultDifalPolicy()});
      assert.deepEqual(saved.monthlyGroups, monthlyGroups);
      assert.deepEqual(saved.baselineMonthlyGroups, baselineMonth(monthlySource.monthlyReports![0]).groups);
      assert.equal(saved.monthlyGroupsUnit, 'BRL');
      assert.equal(saved.modelVersion, MONTHLY_MODEL_VERSION);
      assert.equal(saved.calculatorSourceCommit, CALCULATOR_SOURCE_COMMIT);
      assert.equal(saved.manuallyAdjusted, true);
      assert.deepEqual(saved.adjustments, monthlySource.monthlyReports!.map(row=>({sourceMonth:row.sourceMonth,field:'serviceRevenue',reportMonthlyValue:0,simulatedMonthlyValue:5000})));
      assert.equal(saved.source.sales.totalCents, 60003);
      assert.equal(saved.source.purchases.totalCents, 60003);
      assert.equal(saved.source.sales.jobId, jobs[1]._id);
      assert.equal(saved.periodBasis, 'COLUMN_H'); assert.equal(saved.reportMonths, 3);
      assert.deepEqual(saved.reportPeriod, {startDate:'2025-06-15',endDate:'2025-08-15',startMonth:'2025-06',endMonth:'2025-08',months:3,observedMonths:3,missingMonths:[]});
      assert.equal(saved.rbt12Source, 'SIMPLES_SECTION_22');
      const originalNormalized = {simulationId:input.simulationId,generationId,clientId,title:null,reportMonths:3,periodConfirmed:true,
        monthlyGroups,draft,parentSimulationId:null,rbt12ExtractionId:input.rbt12ExtractionId,monthlyInputs:input.monthlyInputs};
      assert.equal((await (await collection('simulations')).findOne(scope({_id:saved._id})))!.requestHash,digest(JSON.stringify(originalNormalized)),
        'O formato de hash OCR anterior permanece idêntico após adicionar a opção manual.');
      assert.equal(saved.rbt12Manual, undefined);
      assert.equal(saved.monthlyDre.months.length,12);assert.equal(saved.monthlyDre.rbt12Reference.rbt12Cents,21000000);
      assert.equal(saved.monthlyDre.method,'REPORT_MONTHS_ROLLING_RBT12');
      assert.equal(saved.rbt12Extraction.priorRevenues.length,23);
      assert.deepEqual(saved.rbt12Schedule,rbt12Schedule);assert.deepEqual(saved.result.rbt12Schedule,rbt12Schedule);
      assert.deepEqual(saved.engineInput.months.map((row:any)=>row.input.rbt12),[138000,150000,162000]);
      assert.equal(saved.engineInput.rbt12,undefined,'O PA de dezembro não vira uma RBT12 fixa para junho a agosto.');
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
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{result:extraction}});
      const incomplete=structuredClone(extraction);incomplete.priorRevenues.splice(5,1);
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{result:incomplete}});
      await assert.rejects(createSimulation(actor,fresh),(error:any)=>error.code==='RBT12_MONTHS_MISSING'&&error.message.includes('2024-06'));
      assert.deepEqual(await getSimulation(saved._id),saved,'Receitas removidas da fonte não apagam a composição móvel congelada.');
      const changed=structuredClone(extraction);changed.priorRevenues[5].internalCents+=100;changed.priorRevenues[5].totalCents+=100;
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{result:changed}});
      assert.deepEqual(await getSimulation(saved._id),saved,'Uma receita histórica alterada não recalcula os meses salvos.');
      await records.updateOne(scope({_id:input.rbt12ExtractionId}),{$set:{result:extraction}});
      assert.deepEqual(await createSimulation(actor,{...input,rbt12Source:'SIMPLES_SECTION_22'}),saved,
        'A fonte OCR explícita normaliza para o mesmo pedido legado.');
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
        title: 'Revisão 2028', monthlyInputs:input.monthlyInputs.map((row:any,index:number)=>index===2?{...row,groups:{...row.groups,salesCpfCents:350.01}}:row),monthlyGroups: {...monthlyGroups, salesCpfCents: 150},
        draft: {...draft, year: 2028, values: {...draft.values, salesRevenue: 250.01, rent: 15}}});
      assert.equal(revised.parentSimulationId, saved._id);
      assert.equal(revised.manuallyAdjusted, true);
      assert.deepEqual(revised.adjustments, [...saved.adjustments.slice(0,2),{sourceMonth:'2025-08',field:'salesCpfCents',reportMonthlyValue:300.01,simulatedMonthlyValue:350.01},saved.adjustments[2]]);
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
      assert.equal(list.items[0].projection, undefined);
      assert.equal(list.items[0].workspaceId, undefined);
      assert.equal(list.items[0].calculationMethod, 'REPORT_MONTHS_V1');
      assert.deepEqual(list.items[0].reportPeriod, saved.reportPeriod);
      assert.equal(list.items[0].parentSimulationDeleted, false);
      assert.equal(list.items[0].updatedSimulationId, null);
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

    await t.test('histórico identifica o método salvo e somente a última correção viva da mesma origem', async () => {
      const c = await collection('simulations'), original = (await c.findOne(scope({_id: saved._id})))!;
      const parentId = randomUUID(), unknownId = randomUUID(), oldId = randomUUID(), currentId = randomUUID();
      const completedAt = new Date('2026-10-20T10:00:00Z');
      const corrected = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) => ({
        ...original, _id: id, parentSimulationId: parentId, title: 'Metadados revisão', createdAt,
        reprocessing: {version: 'REPORT_MONTHS_2026_10_V1', originalId: parentId, completedAt,
          serviceRevenueMigration: {privateEvidence: 'Not part of history summaries'}}, ...extra
      });
      const records = [
        {...original, _id: parentId, title: 'Metadados original', result: {...original.result, method: undefined},
          projection: {version: 'AVERAGE_X12_V2'}, createdAt: new Date('2026-10-19T10:00:00Z')},
        {...original, _id: unknownId, title: 'Metadados desconhecido', result: {}, projection: {version: 'UNKNOWN'}},
        corrected(oldId, new Date('2026-10-20T10:00:00Z')),
        corrected(currentId, new Date('2026-10-21T10:00:00Z')),
        corrected(randomUUID(), new Date('2026-10-22T10:00:00Z'), {deletedAt: new Date()}),
        corrected(randomUUID(), new Date('2026-10-22T11:00:00Z'), {clientId: outside}),
        corrected(randomUUID(), new Date('2026-10-22T12:00:00Z'), {generationId: randomUUID()}),
        corrected(randomUUID(), new Date('2026-10-22T13:00:00Z'), {workspaceId: 'outside_history'}),
        corrected(randomUUID(), new Date('2026-10-22T14:00:00Z'), {reprocessing: {version: 'OTHER', originalId: unknownId}}),
        corrected(randomUUID(), new Date('2026-10-22T15:00:00Z'), {reprocessing: undefined})
      ];
      try {
        await c.insertMany(records);
        const list = await simulationHistory(1, {search: 'Metadados'}), parent = list.items.find(row => row._id === parentId)!;
        assert.equal(parent.calculationMethod, 'AVERAGE_X12_V2');
        assert.equal(parent.updatedSimulationId, currentId, 'Versões excluídas, manuais ou de outra empresa/geração/workspace não substituem a correção.');
        assert.equal(list.items.find(row => row._id === unknownId)!.calculationMethod, null);
        const current = list.items.find(row => row._id === currentId)!;
        assert.equal(current.calculationMethod, 'REPORT_MONTHS_V1');
        assert.equal(current.parentSimulationDeleted, false);
        assert.deepEqual(current.reprocessing, {version: 'REPORT_MONTHS_2026_10_V1', originalId: parentId, completedAt});
        assert.equal(current.result, undefined); assert.equal(current.projection, undefined); assert.equal(current.source, undefined);
        await c.updateOne(scope({_id: currentId}), {$set: {deletedAt: new Date()}});
        assert.equal((await simulationHistory(1, {search: 'Metadados original'})).items[0].updatedSimulationId, oldId);
        await c.updateOne(scope({_id: oldId}), {$set: {deletedAt: new Date()}});
        assert.equal((await simulationHistory(1, {search: 'Metadados original'})).items[0].updatedSimulationId, null);
        await c.deleteOne(scope({_id: parentId}));
        const orphan = (await simulationHistory(1, {search: 'Metadados'})).items.find(row => row.parentSimulationId === parentId)!;
        assert.equal(orphan.parentSimulationDeleted, true);
        assert.deepEqual(await getSimulation(saved._id), saved, 'A consulta da listagem preserva os valores congelados.');
        assert.equal(providerCalls, 4, 'A listagem não consulta fontes externas.');
      } finally { await c.deleteMany({_id: {$in: records.map(row => row._id)}}); }
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

    await t.test('exclusão permanente concorrente reserva apenas recibo mínimo e preserva outras versões e fontes', async () => {
      const parentInput = {...input, simulationId: randomUUID(), title: 'Origem para excluir'};
      const parent = await createSimulation(actor, parentInput);
      const child = await createSimulation(operator, {...input, simulationId: randomUUID(), parentSimulationId: parent._id,
        title: 'Filha preservada'});
      const c = await collection('simulations'), logs = await collection('audit');
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
      assert.equal(await c.findOne(scope({_id: parent._id})), null, 'O snapshot fiscal é removido fisicamente.');
      const deletionAudits = await logs.find(scope({action: 'simulation.delete', target: parent._id})).toArray();
      assert.equal(deletionAudits.length, 1, 'As exclusões concorrentes registram um único evento.');
      assert.ok([actor._id, operator._id].includes(deletionAudits[0].actor));
      assert.ok(deletionAudits[0].createdAt instanceof Date);
      assert.deepEqual(Object.keys(deletionAudits[0]).sort(), ['_id', 'action', 'actor', 'createdAt', 'target', 'workspaceId'],
        'O recibo não armazena valores, empresas, anexos, premissas ou resultados fiscais.');
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
      assert.equal(await c.findOne(scope({_id: parent._id})), null);
      assert.deepEqual(await logs.find(scope({action: 'simulation.delete', target: parent._id})).toArray(), deletionAudits);
      process.env.WORKSPACE_ID = 'another_workspace';
      try { await assert.rejects(deleteSimulation(actor, parent._id), code('NOT_FOUND')); }
      finally { process.env.WORKSPACE_ID = 'simulation_history_test'; }
      // A missing local origin is indicated without returning any foreign record or receipt.
      const isolatedChildId = randomUUID();
      await c.insertOne({...childRecord!, _id: isolatedChildId, workspaceId: 'another_workspace'});
      process.env.WORKSPACE_ID = 'another_workspace';
      try { assert.equal((await getSimulation(isolatedChildId)).parentSimulationDeleted, true); }
      finally { process.env.WORKSPACE_ID = 'simulation_history_test'; }
      assert.equal(await c.countDocuments(scope({_id: parent._id})), 0);
    });

    await t.test('remove legado lógico somente por ID e retoma falha sem perder autoria', async t => {
      const c = await collection('simulations'), logs = await collection('audit');
      const existing = await c.findOne(scope({_id: saved._id}));
      const legacyId = randomUUID(), untouchedId = randomUUID(), legacyAt = new Date('2026-01-02T03:04:05Z');
      const legacy = {...existing!, _id: legacyId, deletedAt: legacyAt, deletedBy: {id: actor._id, name: actor.name}};
      const untouched = {...legacy, _id: untouchedId};
      await c.insertMany([legacy, untouched]);
      await assert.rejects(getSimulation(legacyId), code('NOT_FOUND'));
      assert.deepEqual(await deleteSimulation(operator, legacyId), {deleted: true, id: legacyId});
      assert.equal(await c.findOne(scope({_id: legacyId})), null);
      const legacyReceipt = await logs.findOne(scope({action: 'simulation.delete', target: legacyId}));
      assert.equal(legacyReceipt!.actor, actor._id); assert.deepEqual(legacyReceipt!.createdAt, legacyAt);
      assert.deepEqual(await c.findOne(scope({_id: untouchedId})), untouched, 'Não há limpeza em massa de registros antigos.');

      const interruptedInput = {...input, simulationId: randomUUID(), title: 'Exclusão interrompida'};
      await createSimulation(actor, interruptedInput);
      const updateOne = Collection.prototype.updateOne;
      const failure = t.mock.method(Collection.prototype, 'updateOne', async function(this: Collection, filter: any, update: any, options: any) {
        if (this.collectionName === 'audit' && update.$setOnInsert?.target === interruptedInput.simulationId &&
          update.$setOnInsert?.action === 'simulation.delete') throw new Error('audit temporarily unavailable');
        return updateOne.call(this, filter, update, options);
      });
      try { await assert.rejects(deleteSimulation(actor, interruptedInput.simulationId), /audit temporarily unavailable/); }
      finally { failure.mock.restore(); }
      const interrupted = await c.findOne(scope({_id: interruptedInput.simulationId}));
      assert.ok(interrupted!.deletedAt instanceof Date);
      await assert.rejects(getSimulation(interruptedInput.simulationId), code('NOT_FOUND'));
      await assert.rejects(createSimulation(actor, interruptedInput), code('SIMULATION_DELETED'));
      await deleteSimulation(operator, interruptedInput.simulationId);
      assert.equal(await c.findOne(scope({_id: interruptedInput.simulationId})), null);
      const repaired = await logs.findOne(scope({action: 'simulation.delete', target: interruptedInput.simulationId}));
      assert.equal(repaired!.actor, actor._id); assert.deepEqual(repaired!.createdAt, interrupted!.deletedAt);
      assert.deepEqual(await c.findOne(scope({_id: untouchedId})), untouched);
    });

    await t.test('uma criação atrasada concorrente à exclusão não ressuscita o snapshot', async t => {
      const raceInput = {...input, simulationId: randomUUID(), title: 'Corrida criar e excluir'};
      const insertOne = Collection.prototype.insertOne;
      let release!: () => void, reached!: () => void, held = false;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const blocked = new Promise<void>(resolve => { reached = resolve; });
      const delayed = t.mock.method(Collection.prototype, 'insertOne', async function(this: Collection, record: any, options: any) {
        if (this.collectionName === 'simulations' && record._id === raceInput.simulationId && !held) {
          held = true; reached(); await gate;
        }
        return insertOne.call(this, record, options);
      });
      const slow = createSimulation(actor, raceInput);
      const rejected = assert.rejects(slow, code('SIMULATION_DELETED'));
      try {
        await blocked;
        await createSimulation(actor, raceInput);
        await deleteSimulation(operator, raceInput.simulationId);
        release();
        await rejected;
      } finally { release(); await slow.catch(() => {}); delayed.mock.restore(); }
      assert.equal(await (await collection('simulations')).countDocuments(scope({_id: raceInput.simulationId})), 0);
      await assert.rejects(getSimulation(raceInput.simulationId), code('NOT_FOUND'));
      await assert.rejects(createSimulation(actor, raceInput), code('SIMULATION_DELETED'));
      assert.equal((await simulationHistory(1, {search: raceInput.title})).total, 0);
      assert.equal(await (await collection('audit')).countDocuments(scope({action: 'simulation.delete', target: raceInput.simulationId})), 1);
      assert.equal(await (await collection('audit')).countDocuments(scope({action: 'simulation.create', target: raceInput.simulationId})), 1);
    });

    await t.test('RBT12 manual exige opção, confirmação e valor explícitos, e mantém a proveniência no histórico', async () => {
      const manualInput = {...input,simulationId:randomUUID(),rbt12ExtractionId:undefined,rbt12Source:'MANUAL',rbt12ManualConfirmed:true,
        draft:{...draft,rbt12:123456.29}};
      await assert.rejects(createSimulation(viewer,manualInput),code('FORBIDDEN'));
      await assert.rejects(createSimulation(actor,{...manualInput,clientId:outside}),code('GENERATION_CLIENT'));
      await assert.rejects(createSimulation(actor,{...manualInput,rbt12Source:undefined}),code('RBT12_SOURCE'));
      await assert.rejects(createSimulation(actor,{...manualInput,rbt12Source:'ESTIMATED'}),code('RBT12_SOURCE'));
      await assert.rejects(createSimulation(actor,{...manualInput,rbt12ExtractionId:input.rbt12ExtractionId}),code('RBT12_SOURCE'));
      for(const confirmed of [undefined,false,'true'])await assert.rejects(createSimulation(actor,{...manualInput,rbt12ManualConfirmed:confirmed}),code('RBT12_CONFIRMATION'));
      const {rbt12:_omitted,...withoutRbt12}=draft;
      await assert.rejects(createSimulation(actor,{...manualInput,draft:withoutRbt12}),code('RBT12_REQUIRED'));
      for(const rbt12 of [null,'',-1,'0',NaN,Infinity,.001,1_000_000_000_001])await assert.rejects(createSimulation(actor,{...manualInput,draft:{...draft,rbt12}}),code('VALIDATION'));
      // Supplying a forged PDF declaration never falls back to the manual branch.
      await assert.rejects(createSimulation(actor,{...input,simulationId:randomUUID(),rbt12Source:'SIMPLES_SECTION_22',draft:manualInput.draft}),code('RBT12_EXTRACTION'));
      const manual=await createSimulation(operator,manualInput);
      assert.equal(manual.rbt12Source,'MANUAL'); assert.equal(manual.rbt12Extraction,null);
      assert.deepEqual(manual.rbt12Manual,{source:'MANUAL',confirmed:true,rbt12Cents:12345629,
        confirmedAt:manual.createdAt,confirmedBy:{id:operator._id,name:operator.name}});
      assert.deepEqual(manual.result,expected(manualInput.draft,input.monthlyInputs,null).result);
      assert.equal(manual.engineInput.rbt12,123456.29);
      assert.equal(manual.rbt12Schedule,undefined);assert.equal(manual.result.rbt12Schedule,undefined);
      assert.deepEqual(manual.engineInput.months.map((row:any)=>row.input.rbt12),[123456.29,123456.29,123456.29]);
      assert.notEqual(manual.engineInput.rbt12,manual.result.annualRevenue,'A RBT12 não é substituída pela projeção.');
      assert.deepEqual(manual.monthlyDre.rbt12Reference,{source:'MANUAL',rbt12Cents:12345629});
      assert.equal(manual.monthlyDre.method,'REPORT_MONTHS_FIXED_RBT12');
      assert.deepEqual(await getSimulation(manual._id),manual);
      assert.deepEqual(await createSimulation(operator,manualInput),manual);
      await assert.rejects(createSimulation(operator,{...manualInput,draft:{...manualInput.draft,rbt12:123457}}),code('SIMULATION_EXISTS'));
      process.env.WORKSPACE_ID='another_workspace';
      try {
        await assert.rejects(getSimulation(manual._id),code('NOT_FOUND'));
        await assert.rejects(createSimulation(operator,{...manualInput,simulationId:randomUUID()}),code('NOT_FOUND'));
      } finally {process.env.WORKSPACE_ID='simulation_history_test';}
      const zero=await createSimulation(actor,{...manualInput,simulationId:randomUUID(),draft:{...draft,rbt12:0}});
      assert.equal(zero.engineInput.rbt12,0);assert.equal(zero.rbt12Manual.rbt12Cents,0);
      assert.deepEqual(zero.result,expected({...draft,rbt12:0},input.monthlyInputs,null).result,'Zero explícito conserva avisos e restrições do motor.');
      assert.equal(providerCalls,4,'A entrada manual não dispara consultas externas.');
      assert.deepEqual(await getSimulation(saved._id),saved,'O histórico OCR anterior permanece imutável.');
    });

    await t.test('receita negativa e compras maiores geram alertas, salvam e reabrem sem alterar fontes nem versões anteriores', async () => {
      const negativeGroups={salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:-2000,purchasesOptantCents:0,purchasesNonOptantCents:3500};
      const negativeDraft={...draft,values:{...draft.values,serviceRevenue:0,salesRevenue:-2000,simplePurchases:0,regularPurchases:3500,rent:6000}};
      const entries=monthlySource.monthlyReports!.map((row,index)=>{
        const entry=baselineMonth(row,negativeDraft.values);
        if(index===0)entry.groups={...negativeGroups};
        return entry;
      });
      const request={...input,simulationId:randomUUID(),parentSimulationId:saved._id,title:'Devoluções acima das vendas',
        monthlyGroups:negativeGroups,draft:negativeDraft,monthlyInputs:entries};
      const signed=await routeV4(actor,'POST',new URL('https://test/api/v4/simulations'),request) as any;
      assert.equal(signed.draft.values.salesRevenue,-2000);
      assert.equal(signed.monthlyInputs[0].groups.salesCpfCents,-2000);
      assert.equal(Math.round(signed.result.annualRevenue*100),-149998);
      assert.equal(signed.projection.scenario.annual.revenueCents,-149998);
      assert.equal(signed.result.bestRegimeId,null);assert.equal(signed.bestRegimeName,null);assert.equal(signed.bestAnnualProfit,null);
      for(const regime of signed.result.regimes){
        assert.equal(regime.available,true);assert.equal(regime.margin,null);assert.equal(regime.taxBurden,null);
        assert.equal(Math.round(regime.dre.revenue*100),-149998);assert(regime.annualProfit<0);
        for(const value of Object.values(regime.dre))assert(Number.isFinite(value));
      }
      for(const warning of ['negative-sales','negative-revenue','purchases-above-revenue','costs-above-revenue'])assert(signed.result.warnings.some((row:any)=>row.code===warning));
      const negativeMonth=signed.result.monthlyResults[0].result;
      assert.equal(negativeMonth.annualRevenue,-2000);assert.equal(negativeMonth.credits.cbs.debit,0);
      assert.equal(negativeMonth.credits.cbs.used,0);assert.equal(negativeMonth.credits.cbs.due,0);
      assert.equal(signed.result.credits.cbs.debit,signed.result.monthlyResults.slice(1).reduce((sum:number,row:any)=>sum+row.result.credits.cbs.debit,0));
      for(const regime of signed.monthlyDre.regimes){
        const revenue=regime.rows.find((row:any)=>row.key==='revenue');
        assert.equal(revenue.months[5],-2000);assert.equal(Math.round(revenue.annual*100),-149998);
      }
      assert.deepEqual(signed.source,monthlySource);
      assert.deepEqual(await routeV4(viewer,'GET',new URL(`https://test/api/v4/simulations/${signed._id}`),{}),signed);
      assert.deepEqual(await createSimulation(actor,request),signed,'Retentativa preserva o snapshot assinado e seus alertas.');
      assert.deepEqual(await getSimulation(saved._id),saved);
      assert.deepEqual(await generationSimulator(generationId,clientId),monthlySource);
      assert.equal(providerCalls,4);
    });

    await t.test('situação do ICMS/ISS é validada, salva e revisada sem inventar receita anual nem alterar históricos', async () => {
      const localInput={...input,simulationId:randomUUID(),rbt12ExtractionId:undefined,rbt12Source:'MANUAL',rbt12ManualConfirmed:true,
        draft:{...draft,rbt12:4_000_000,icmsOutside:false}};
      for(const icmsOutside of [null,'true',1,{},[]]){
        await assert.rejects(createSimulation(actor,{...localInput,draft:{...localInput.draft,icmsOutside}}),code('VALIDATION'));
      }
      await assert.rejects(createSimulation(actor,{...localInput,draft:{...localInput.draft,revenueContext:{annualRevenue:1}}}),code('VALIDATION'));
      const pending=await createSimulation(actor,localInput);
      assert.equal(pending.draft.icmsOutside,false);
      assert.equal(pending.result.simplesDiagnostic.statusCode,'LOCAL_TAX_REVIEW_REQUIRED');
      assert.equal(pending.result.simplesDiagnostic.eligibilityVerified,false);
      assert.equal(pending.result.simplesDiagnostic.revenueReference,pending.result.annualRevenue);
      assert.equal(pending.result.simplesDiagnostic.coveredMonths,3);
      assert.equal(pending.result.simplesDiagnostic.completeYear,false);
      const outsideInput={...localInput,simulationId:randomUUID(),parentSimulationId:pending._id,
        draft:{...localInput.draft,icmsOutside:true}};
      const confirmed=await createSimulation(operator,outsideInput);
      assert.equal(confirmed.draft.icmsOutside,true);
      assert(confirmed.result.regimes.filter((r:any)=>['pure','hybrid'].includes(r.id)).every((r:any)=>r.available));
      assert(confirmed.engineInput.months.every((row:any)=>row.input.icmsOutside===true));
      assert(confirmed.result.monthlyResults.every((row:any)=>row.result.regimes.filter((r:any)=>['pure','hybrid'].includes(r.id)).every((r:any)=>r.dre.icmsNet<=0&&r.dre.iss===-250)));
      assert.deepEqual(await getSimulation(pending._id),pending);
      assert.deepEqual(await getSimulation(confirmed._id),confirmed);
      assert.deepEqual(await createSimulation(operator,outsideInput),confirmed);
      await assert.rejects(createSimulation(operator,{...outsideInput,draft:{...outsideInput.draft,icmsOutside:false}}),code('SIMULATION_EXISTS'));
      assert.deepEqual(await getSimulation(saved._id),saved);
    });

    await t.test('opções de DIFAL estritas, idempotentes e preservadas em nova versão sem alterar o hash legado', async () => {
      const policy = {version:'DIFAL_SCENARIOS_V1', enabled:{pure:false, hybrid:true, presumed:false, actual:true}};
      const records = await collection('simulations'), count = await records.countDocuments(scope());
      const original = await records.findOne(scope({_id:saved._id}));
      const directions = defaultDifalPolicy();
      for (const bad of [undefined, null, [], {}, true,
        {...policy,version:'UNKNOWN'}, {...policy,extra:true}, {...policy,enabled:null},
        {...policy,enabled:{pure:false,hybrid:true,presumed:false}},
        {...policy,enabled:{...policy.enabled,other:true}},
        ...['false', 0, 1, null, undefined].map(pure => ({...policy,enabled:{...policy.enabled,pure}})),
        {...directions, enabled:{...directions.enabled,presumed:true}},
        {...directions, enabled:{...directions.enabled,actual:true}},
        {...directions, operations:undefined},
        {...directions, operations:{...directions.operations,pure:{entry:true}}},
        {...directions, operations:{...directions.operations,hybrid:{entry:false,exit:'true'}}},
        {...directions, operations:{...directions.operations,actual:{entry:false,exit:false}}}]) {
        await assert.rejects(createSimulation(actor,{...input,simulationId:randomUUID(),draft:{...draft,difalPolicy:bad}}),code('VALIDATION'));
      }
      assert.equal(await records.countDocuments(scope()),count);
      const requested = {...input,simulationId:randomUUID(),draft:{...draft,difalPolicy:{
        enabled:{actual:true,presumed:false,hybrid:true,pure:false},version:policy.version
      }}};
      const before = structuredClone(requested);
      const [configured,concurrent] = await Promise.all([createSimulation(actor,requested),createSimulation(actor,requested)]);
      assert.deepEqual(configured,concurrent);assert.deepEqual(requested,before);
      assert.deepEqual(configured.draft.difalPolicy,upgradeDifalPolicy(policy));
      assert.equal(JSON.stringify(configured.draft.difalPolicy),JSON.stringify(upgradeDifalPolicy(policy)),'O snapshot registra a política efetiva atual, sem mudar o hash do pedido legado.');
      assert.deepEqual(configured.result,expected({...draft,difalPolicy:policy}).result);
      assert.deepEqual(configured.engineInput,expected({...draft,difalPolicy:policy}).engineInput);
      assert.deepEqual(await createSimulation(actor,{...requested,draft:{...draft,difalPolicy:policy}}),configured);
      assert.equal(await records.countDocuments(scope({_id:configured._id})),1);
      await assert.rejects(createSimulation(actor,{...requested,draft:{...draft,difalPolicy:{...policy,enabled:{...policy.enabled,pure:true}}}}),code('SIMULATION_EXISTS'));
      await assert.rejects(createSimulation(actor,{...requested,draft}),code('SIMULATION_EXISTS'));
      const revision = await createSimulation(operator,{...input,simulationId:randomUUID(),parentSimulationId:configured._id,
        draft:{...draft,difalPolicy:structuredClone(configured.draft.difalPolicy)}});
      assert.equal(revision.parentSimulationId,configured._id);assert.deepEqual(revision.draft.difalPolicy,upgradeDifalPolicy(policy));
      assert.deepEqual(await getSimulation(configured._id),configured);
      assert.deepEqual(await getSimulation(saved._id),saved);assert.deepEqual(await createSimulation(actor,input),saved);
      assert.deepEqual(await records.findOne(scope({_id:saved._id})),original,'A escolha nova não reescreve o snapshot nem o hash anterior.');
      assert.deepEqual(saved.draft.difalPolicy,defaultDifalPolicy(),'Novos snapshots registram a política efetiva mesmo quando o pedido a omitiu.');
    });

    await t.test('leituras e retries V1 ou sem política devolvem o snapshot histórico sem recalcular', async () => {
      const records = await collection('simulations');
      for (const policy of [undefined, {version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:true}}]) {
        const legacyRequest = {...input,simulationId:randomUUID(),draft:{...draft,...(policy ? {difalPolicy:policy} : {})}};
        await createSimulation(actor,legacyRequest);
        const legacy = (await records.findOne(scope({_id:legacyRequest.simulationId})))!;
        legacy.modelVersion='1.6.0-difal-scenarios';
        if (policy) legacy.draft.difalPolicy=structuredClone(policy); else delete legacy.draft.difalPolicy;
        legacy.result.version='1.6.0-difal-scenarios';
        legacy.result.difalPolicy=policy || {version:'DIFAL_SCENARIOS_V1',enabled:{pure:true,hybrid:true,presumed:true,actual:true}};
        legacy.result.regimes.find((regime:any)=>regime.id==='actual').dre.difal=-42.25;
        await records.replaceOne(scope({_id:legacy._id}),legacy);
        const frozen=await getSimulation(legacy._id);
        assert.equal(frozen.result.regimes.find((regime:any)=>regime.id==='actual').dre.difal,-42.25);
        assert.deepEqual(await createSimulation(actor,legacyRequest),frozen,'Reenvio depois da atualização não normaliza o snapshot existente.');
        assert.deepEqual(await records.findOne(scope({_id:legacy._id})),legacy);
      }
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
      assert.equal(await (await collection('simulations')).countDocuments(scope({_id: candidate._id})), 0);
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

    await t.test('excluir a geração durante uma criação impede snapshot novo e mantém simulações já salvas', async t => {
      const raceInput = {...input, simulationId: randomUUID(), title: 'Geração excluída durante criação'};
      const insertOne = Collection.prototype.insertOne;
      let release!: () => void, reached!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const blocked = new Promise<void>(resolve => { reached = resolve; });
      const delayed = t.mock.method(Collection.prototype, 'insertOne', async function(this: Collection, record: any, options: any) {
        if (this.collectionName === 'simulations' && record._id === raceInput.simulationId) {
          reached(); await gate;
        }
        return insertOne.call(this, record, options);
      });
      const slow = createSimulation(actor, raceInput);
      const rejected = assert.rejects(slow, code('GENERATION_DELETED'));
      try {
        await blocked;
        await deleteGeneration(actor, generationId);
        release(); await rejected;
      } finally { release(); await slow.catch(() => {}); delayed.mock.restore(); }
      assert.equal(await (await collection('simulations')).countDocuments(scope({_id: raceInput.simulationId})), 0);
      assert.deepEqual(await getSimulation(saved._id), saved);
      assert.deepEqual(await createSimulation(actor, input), saved, 'Reenviar uma simulação já salva não depende da geração removida.');
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID()}), code('GENERATION_DELETED'));
      await assert.rejects(createSimulation(actor, {...input, simulationId: randomUUID(), parentSimulationId: saved._id}), code('GENERATION_DELETED'));
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if (oldDb === undefined) delete process.env.MONGODB_DB; else process.env.MONGODB_DB = oldDb;
    if (oldWs === undefined) delete process.env.WORKSPACE_ID; else process.env.WORKSPACE_ID = oldWs;
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = oldOrigin;
  }
});
