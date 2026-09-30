import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { need, text, digest, escapeRegex, integer } from './security.ts';
import { write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { VERSION } from './domain.ts';
import { generationSimulator } from './simulator-store.ts';
import { calculateSimulation, draftToInput, MODEL_VERSION, CALCULATOR_SOURCE_COMMIT, TAX_SOURCES,
  SIMULATION_VALUE_FIELDS } from '../public/simulator-engine.js';
import type { SimulationDraft } from '../public/simulator-engine.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PAGE_SIZE = 20;
const VALUE_LIMIT = 1_000_000_000_000;
const GROUPS = ['salesOptantCents', 'salesNonOptantCents', 'salesCpfCents',
  'purchasesOptantCents', 'purchasesNonOptantCents'] as const;
type GroupKey = typeof GROUPS[number];
type MonthlyGroups = Record<GroupKey, number>;
type Source = Awaited<ReturnType<typeof generationSimulator>>;

function uuid(value: unknown) {
  need(typeof value === 'string' && UUID.test(value), 'Identificador inválido.');
  return value;
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, any> {
  need(value && typeof value === 'object' && !Array.isArray(value), 'Informe um objeto válido.');
  need(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'Campo não reconhecido na simulação.');
  need(required.every(key => Object.hasOwn(value, key)), 'Preencha todos os campos da simulação.');
}

function money(value: unknown) {
  need(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= VALUE_LIMIT &&
    value === Math.round(value * 100) / 100,
  'Informe valores entre zero e um trilhão, com no máximo duas casas decimais. Use 0 quando não houver valor.');
  return Math.round(value * 100) / 100;
}

/** Convert report cents into BRL using the same balanced rounding as the form. */
function baselineGroups(source: Source, months: number): MonthlyGroups {
  const result = {} as MonthlyGroups;
  for (const keys of [GROUPS.slice(0, 3), GROUPS.slice(3)]) {
    const exact = keys.map(key => source.fields[key] / months), base = exact.map(Math.floor);
    const remainder = Math.round(keys.reduce((sum, key) => sum + source.fields[key], 0) / months) - base.reduce((a, b) => a + b, 0);
    const order = exact.map((value, index) => ({index, fraction: value - base[index]}))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let i = 0; i < remainder; i++) base[order[i].index]++;
    keys.forEach((key, index) => { result[key] = base[index] / 100; });
  }
  return result;
}

function request(input: unknown) {
  object(input, ['simulationId', 'generationId', 'clientId', 'reportMonths', 'periodConfirmed', 'monthlyGroups', 'draft'], ['title', 'parentSimulationId']);
  const simulationId = uuid(input.simulationId), generationId = uuid(input.generationId), clientId = uuid(input.clientId);
  const parentSimulationId = input.parentSimulationId == null ? null : uuid(input.parentSimulationId);
  need(parentSimulationId !== simulationId, 'A nova simulação precisa de um identificador próprio.');
  need(typeof input.reportMonths === 'number' && Number.isInteger(input.reportMonths) && input.reportMonths >= 1 && input.reportMonths <= 12,
    'Informe de 1 a 12 meses nos relatórios.');
  need(input.periodConfirmed === true, 'Confirme que os relatórios correspondem ao mesmo período.');
  const title = input.title === undefined ? null : text(input.title, 160);
  object(input.monthlyGroups, GROUPS);
  const monthlyGroups = Object.fromEntries(GROUPS.map(key => [key, money(input.monthlyGroups[key])])) as MonthlyGroups;
  object(input.draft, ['year', 'salesAnnex', 'serviceAnnex', 'values']);
  need([2027, 2028].includes(input.draft.year) && [1, 2].includes(input.draft.salesAnnex) && [3, 4, 5].includes(input.draft.serviceAnnex),
    'Ano ou anexo inválido para o modelo da calculadora.');
  object(input.draft.values, SIMULATION_VALUE_FIELDS);
  const draft: SimulationDraft = {year: input.draft.year, salesAnnex: input.draft.salesAnnex, serviceAnnex: input.draft.serviceAnnex,
    values: Object.fromEntries(SIMULATION_VALUE_FIELDS.map(key => [key, money(input.draft.values[key])])) as SimulationDraft['values']};
  need(Math.round(draft.values.salesRevenue * 100) === GROUPS.slice(0, 3).reduce((sum, key) => sum + Math.round(monthlyGroups[key] * 100), 0) &&
    draft.values.simplePurchases === monthlyGroups.purchasesOptantCents && draft.values.regularPurchases === monthlyGroups.purchasesNonOptantCents,
    'Os totais de vendas e compras devem corresponder aos cinco grupos preenchidos.', 400, 'SIMULATION_TOTAL');
  return {simulationId, generationId, clientId, title, reportMonths: input.reportMonths as number, periodConfirmed: true as const,
    monthlyGroups, draft, parentSimulationId};
}

async function simulations() {
  const c = await collection('simulations');
  await Promise.all([
    c.createIndex({workspaceId: 1, createdAt: -1, _id: -1}),
    c.createIndex({workspaceId: 1, clientId: 1, createdAt: -1, _id: -1}),
    c.createIndex({workspaceId: 1, year: 1, createdAt: -1, _id: -1})
  ]);
  return c;
}

function visible(record: Doc) {
  const {workspaceId: _workspace, requestHash: _hash, ...snapshot} = record;
  return snapshot;
}

/** Read the frozen result: no source hydration, provider request or recalculation. */
export async function getSimulation(id: string) {
  const record = await (await simulations()).findOne(scope({_id: uuid(id)}));
  need(record, 'Simulação não encontrada.', 404, 'NOT_FOUND');
  return visible(record);
}

/** Append only. Repeated network requests with the same ID never create a second result. */
export async function createSimulation(actor: LookupActor, input: unknown) {
  write(actor);
  const validated = request(input), {simulationId, generationId, clientId, draft, reportMonths, monthlyGroups, parentSimulationId} = validated;
  const requestHash = digest(JSON.stringify(validated));
  const c = await simulations();
  const repeated = (record: Doc) => {
    need(record.createdBy.id === actor._id && record.requestHash === requestHash,
      'Este identificador já pertence a outra simulação. Gere uma nova versão para guardar alterações.', 409, 'SIMULATION_EXISTS');
    return visible(record);
  };
  const existing = await c.findOne(scope({_id: simulationId}));
  if (existing) return repeated(existing);
  if (parentSimulationId) {
    const parent = await getSimulation(parentSimulationId);
    need(parent.clientId === clientId && parent.generationId === generationId,
      'A simulação original precisa pertencer à mesma empresa e geração.', 409, 'SIMULATION_PARENT');
  }
  const source = await generationSimulator(generationId, clientId);
  const engineInput = draftToInput(draft);
  need(engineInput, 'Os valores ultrapassam os limites da calculadora. Confira as receitas mensais e a estimativa anual.');
  const result = calculateSimulation(draft);
  const baselineMonthlyGroups = baselineGroups(source, reportMonths);
  const adjustments = GROUPS.filter(key => monthlyGroups[key] !== baselineMonthlyGroups[key]).map(field => ({
    field, reportMonthlyValue: baselineMonthlyGroups[field], simulatedMonthlyValue: monthlyGroups[field]
  }));
  const best = result.regimes.find(regime => regime.id === result.bestRegimeId);
  const snapshot = {_id: simulationId, ...scope(), requestHash, generationId, clientId,
    title: validated.title || `${source.company.name} · ${draft.year}`, company: source.company,
    createdAt: new Date(), createdBy: {id: actor._id, name: actor.name}, appVersion: VERSION,
    modelVersion: MODEL_VERSION, calculatorSourceCommit: CALCULATOR_SOURCE_COMMIT, taxSources: TAX_SOURCES,
    source, reportMonths, periodConfirmed: true, monthlyGroups, monthlyGroupsUnit: 'BRL', baselineMonthlyGroups,
    manuallyAdjusted: adjustments.length > 0, adjustments, draft, engineInput, result, parentSimulationId,
    year: draft.year, annualRevenue: result.annualRevenue, bestRegimeId: result.bestRegimeId,
    bestRegimeName: best?.name || null, bestAnnualProfit: best?.annualProfit ?? null};
  try { await c.insertOne(snapshot); }
  catch (error: any) {
    if (error.code !== 11000) throw error;
    const concurrent = await c.findOne(scope({_id: simulationId}));
    need(concurrent, 'Identificador de simulação indisponível. Gere um novo identificador.', 409, 'SIMULATION_EXISTS');
    return repeated(concurrent);
  }
  await audit(actor._id, 'simulation.create', simulationId);
  return visible(snapshot);
}

export async function simulationHistory(page: number, filters: {clientId?: string; search?: string; year?: string} = {}) {
  page = integer(page, 1, 100000);
  const query: Record<string, any> = scope();
  if (filters.clientId) query.clientId = uuid(filters.clientId);
  if (filters.year) {
    need(['2027', '2028'].includes(filters.year), 'Ano inválido para filtrar as simulações.');
    query.year = Number(filters.year);
  }
  if (filters.search?.trim()) {
    const search = escapeRegex(text(filters.search, 100));
    query.$or = ['title', 'company.name', 'company.code', 'createdBy.name'].map(field => ({[field]: {$regex: search, $options: 'i'}}));
  }
  const c = await simulations();
  const projection = {_id: 1, generationId: 1, clientId: 1, title: 1, company: 1, year: 1, createdAt: 1, createdBy: 1,
    annualRevenue: 1, bestRegimeId: 1, bestRegimeName: 1, bestAnnualProfit: 1, manuallyAdjusted: 1, reportMonths: 1, parentSimulationId: 1};
  const [items, total] = await Promise.all([
    c.find(query).project(projection).sort({createdAt: -1, _id: -1}).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).maxTimeMS(20000).toArray(),
    c.countDocuments(query, {maxTimeMS: 20000})
  ]);
  return {items, total, page, pageSize: PAGE_SIZE};
}
