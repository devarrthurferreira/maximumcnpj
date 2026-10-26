import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { AppError, need, text, digest, escapeRegex, integer } from './security.ts';
import { write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { VERSION } from './domain.ts';
import {baselineMonth, calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {readRbt12Reference, rbt12InputSource} from './simulation-extrato.ts';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import { generationSimulator } from './simulator-store.ts';
import { assertGenerationNotDeleted, assertLookupNotDeleted } from './generation-deletion.ts';
import { CALCULATOR_SOURCE_COMMIT, TAX_SOURCES,
  SIMULATION_VALUE_FIELDS, parseDifalPolicy, upgradeDifalPolicy } from '../public/simulator-engine.js';
import type { SimulationDraft } from '../public/simulator-engine.js';
import {parseRegimeSelection,requiresSimplesReference} from '../public/regime-selection.js';
import {withLegacyAnalysisDeletion} from './analysis-store.ts';

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
function signedSalesMoney(value: unknown) {
  need(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= VALUE_LIMIT &&
    value === Math.round(value * 100) / 100,
  'Informe os grupos de vendas entre menos um trilhão e um trilhão, com no máximo duas casas decimais.');
  return Math.round(value * 100) / 100;
}

export function validateSimulationRequest(input: unknown) {
  object(input, ['simulationId', 'generationId', 'clientId', 'reportMonths', 'periodConfirmed', 'monthlyGroups', 'draft'], ['title', 'parentSimulationId', 'rbt12ExtractionId', 'rbt12Source', 'rbt12ManualConfirmed', 'monthlyInputs']);
  const simulationId = uuid(input.simulationId), generationId = uuid(input.generationId), clientId = uuid(input.clientId);
  const parentSimulationId = input.parentSimulationId == null ? null : uuid(input.parentSimulationId);
  const rbt12ExtractionId = input.rbt12ExtractionId == null ? null : uuid(input.rbt12ExtractionId);
  need(parentSimulationId !== simulationId, 'A nova simulação precisa de um identificador próprio.');
  need(typeof input.reportMonths === 'number' && Number.isInteger(input.reportMonths) && input.reportMonths >= 1 && input.reportMonths <= 12,
    'Informe de 1 a 12 meses nos relatórios.');
  need(input.periodConfirmed === true, 'Confirme que os relatórios correspondem ao mesmo período.');
  const title = input.title === undefined ? null : text(input.title, 160);
  object(input.monthlyGroups, GROUPS);
  const monthlyGroups = Object.fromEntries(GROUPS.map((key, index) => [key, index < 3 ? signedSalesMoney(input.monthlyGroups[key]) : money(input.monthlyGroups[key])])) as MonthlyGroups;
  object(input.draft, ['year', 'salesAnnex', 'serviceAnnex', 'values'], ['rbt12', 'difalPolicy', 'icmsOutside','regimeSelection']);
  need([2027, 2028].includes(input.draft.year) && [1, 2].includes(input.draft.salesAnnex) && [3, 4, 5].includes(input.draft.serviceAnnex),
    'Ano ou anexo inválido para o modelo da calculadora.');
  object(input.draft.values, SIMULATION_VALUE_FIELDS);
  if (Object.hasOwn(input.draft, 'icmsOutside')) {
    need(typeof input.draft.icmsOutside === 'boolean', 'Informe se o ICMS/ISS está dentro ou fora do DAS neste cenário.');
  }
  let difalPolicy: SimulationDraft['difalPolicy'];
  let regimeSelection: SimulationDraft['regimeSelection'];
  if(Object.hasOwn(input.draft,'regimeSelection')){
    try{regimeSelection=parseRegimeSelection(input.draft.regimeSelection);}
    catch(error){throw new AppError(400,'VALIDATION',error instanceof Error?error.message:'Seleção de regimes inválida.');}
  }
  if (Object.hasOwn(input.draft, 'difalPolicy')) {
    try { difalPolicy = parseDifalPolicy(input.draft.difalPolicy); }
    catch (error) { throw new AppError(400, 'VALIDATION', error instanceof Error ? error.message : 'Opções de DIFAL inválidas.'); }
  }
  const draft: SimulationDraft = {year: input.draft.year, salesAnnex: input.draft.salesAnnex, serviceAnnex: input.draft.serviceAnnex,
    ...(Object.hasOwn(input.draft, 'rbt12') ? {rbt12: input.draft.rbt12===null && !requiresSimplesReference(regimeSelection)?null:money(input.draft.rbt12)} : {}),
    ...(Object.hasOwn(input.draft, 'icmsOutside') ? {icmsOutside: input.draft.icmsOutside} : {}),
    // Keep omission and the normalized request hash unchanged for historical retries.
    ...(difalPolicy ? {difalPolicy} : {}),
    ...(regimeSelection ? {regimeSelection} : {}),
    values: Object.fromEntries(SIMULATION_VALUE_FIELDS.map(key => [key, money(input.draft.values[key])])) as SimulationDraft['values']};
  need(!rbt12ExtractionId || draft.rbt12 != null, 'A extração de RBT12 precisa acompanhar o valor usado na simulação.');
  const rbt12Source = rbt12InputSource(input.rbt12Source, input.rbt12ManualConfirmed, rbt12ExtractionId, draft.rbt12,draft.regimeSelection);
  need(Math.round(draft.values.salesRevenue * 100) === GROUPS.slice(0, 3).reduce((sum, key) => sum + Math.round(monthlyGroups[key] * 100), 0) &&
    draft.values.simplePurchases === monthlyGroups.purchasesOptantCents && draft.values.regularPurchases === monthlyGroups.purchasesNonOptantCents,
    'Os totais de vendas e compras devem corresponder aos cinco grupos preenchidos.', 400, 'SIMULATION_TOTAL');
  return {simulationId, generationId, clientId, title, reportMonths: input.reportMonths as number, periodConfirmed: true as const,
    monthlyGroups, draft, parentSimulationId, rbt12ExtractionId,
    ...(input.monthlyInputs === undefined ? {} : {monthlyInputs: input.monthlyInputs}),
    // Preserve the previous normalized OCR request and hash for retries after an upgrade.
    ...(rbt12Source === 'MANUAL' ? {rbt12Source, rbt12ManualConfirmed: true as const} : rbt12Source==='NOT_REQUIRED'?{rbt12Source}:{})};
}

async function simulations() {
  const c = await collection('simulations');
  await Promise.all([
    c.createIndex({workspaceId: 1, createdAt: -1, _id: -1}),
    c.createIndex({workspaceId: 1, clientId: 1, createdAt: -1, _id: -1}),
    c.createIndex({workspaceId: 1, year: 1, createdAt: -1, _id: -1}),
    c.createIndex({workspaceId: 1, parentSimulationId: 1, createdAt: -1, _id: -1})
  ]);
  return c;
}

function visible(record: Doc) {
  const {workspaceId: _workspace, requestHash: _hash, ...snapshot} = record;
  return snapshot;
}

function deletionAuditId(id: string) {
  return 'simulation-delete:' + digest(JSON.stringify([scope().workspaceId, id]));
}

async function deletionReceipt(id: string) {
  return (await collection('audit')).findOne(scope({_id: deletionAuditId(id), action: 'simulation.delete', target: id}));
}

async function requireUnremovedId(id: string) {
  need(!await deletionReceipt(id), 'Esta simulação foi excluída. Use um novo identificador para salvar outra simulação.',
    409, 'SIMULATION_DELETED');
}

/** Read the frozen result: no source hydration, provider request or recalculation. */
export async function getSimulation(id: string) {
  const c = await simulations();
  const record = await c.findOne(scope({_id: uuid(id), deletedAt: {$exists: false}}));
  need(record && !await deletionReceipt(id), 'Simulação não encontrada.', 404, 'NOT_FOUND');
  if(record.analysisPublication==='PENDING')need(await(await collection('analyses')).findOne(scope({_id:record.analysisId,'currentSimulation.id':id})),
    'Esta versão ainda não foi publicada pela análise.',404,'NOT_FOUND');
  const parentDeleted = record.parentSimulationId && !await c.findOne(scope({
    _id: record.parentSimulationId, deletedAt: {$exists: false}
  }), {projection: {_id: 1}});
  const snapshot = visible(record);
  if (parentDeleted) snapshot.parentSimulationDeleted = true;
  return snapshot;
}

/** Permanently remove only this snapshot; the minimal audit receipt reserves its ID. */
export async function deleteSimulation(actor: LookupActor, id: string) {
  write(actor);
  const simulationId = uuid(id), c = await simulations();
  const managed=await c.findOne(scope({_id:simulationId,analysisId:{$exists:true}}),{projection:{_id:1}});
  need(!managed,'As versões de uma análise são preservadas. Edite os setores e gere uma nova versão para registrar alterações.',409,'ANALYSIS_VERSION_PROTECTED');
  return withLegacyAnalysisDeletion(simulationId,actor,()=>removeSimulationSnapshot(actor,simulationId));
}
async function removeSimulationSnapshot(actor:LookupActor,simulationId:string){
  const c=await simulations();
  const claimed = await c.findOneAndUpdate(scope({_id: simulationId, deletedAt: {$exists: false}}), {
    $set: {deletedAt: new Date(), deletedBy: {id: actor._id, name: actor.name}}
  }, {returnDocument: 'after', projection: {_id: 1, workspaceId: 1, deletedAt: 1, deletedBy: 1, reprocessing: 1}});
  const deleted = claimed || await c.findOne(scope({_id: simulationId, deletedAt: {$exists: true}}), {
    projection: {_id: 1, workspaceId: 1, deletedAt: 1, deletedBy: 1, reprocessing: 1}
  });
  if (deleted) {
    // Save the receipt before removal, so retries can finish an interrupted deletion without retaining fiscal data.
    await (await collection('audit')).updateOne(scope({_id: deletionAuditId(simulationId)}), {$setOnInsert: {
      ...scope(), actor: deleted.deletedBy.id, action: 'simulation.delete', target: simulationId, createdAt: deleted.deletedAt
    }}, {upsert: true});
  } else need(await deletionReceipt(simulationId), 'Simulação não encontrada.', 404, 'NOT_FOUND');
  await c.deleteOne(scope({_id: simulationId}));
  const reprocessingItems = await collection('simulationReprocessItems');
  await reprocessingItems.deleteMany(scope({originalId: simulationId}));
  await reprocessingItems.updateMany(scope({$or:[{childId:simulationId},...(deleted?.reprocessing?.originalId ? [{originalId:deleted.reprocessing.originalId}] : [])]}),
    {$set:{childId:null,status:'PENDING',code:'REPROCESS_CHILD_DELETED',message:'A versão corrigida foi excluída e não será recriada automaticamente.',updatedAt:new Date()}});
  return {deleted: true, id: simulationId};
}

/** Append only. Repeated network requests with the same ID never create a second result. */
type ReprocessingContext = {
  version: string; originalId: string; source: Source; rbt12Extraction: any; rbt12Manual: any;
  serviceRevenueMigration?: {revision:string;policy:'ADDITIONAL_TO_REPORT';unit:'CENTS';sourceJobId:string;reportMonths:number;
    sourceServiceTotalCents:number;reportMonthlyServiceCents:number;priorMonthlyServiceCents:number;appliedMonthlyServiceCents:number;warning:string} | null;
};

export async function createSimulation(actor: LookupActor, input: unknown) {
  return createSimulationSnapshot(actor, input);
}

/** Server-only path. HTTP request validation never accepts source or migration context. */
export async function createReprocessedSimulation(actor: LookupActor, input: unknown, context: ReprocessingContext) {
  return createSimulationSnapshot(actor, input, context);
}

type AnalysisContext={analysisId:string;analysisRevision:number;source:Source;beforeInsert:()=>Promise<void>;evidence:Record<string,unknown>};
/** Server-only: the HTTP contract never accepts a source, computed result or analysis linkage. */
export async function createAnalysisSimulation(actor:LookupActor,input:unknown,context:AnalysisContext){
  return createSimulationSnapshot(actor,input,undefined,context);
}

async function createSimulationSnapshot(actor: LookupActor, input: unknown, reprocessing?: ReprocessingContext,analysis?:AnalysisContext) {
  write(actor);
  const validated = validateSimulationRequest(input), {simulationId, generationId, clientId, draft: submittedDraft, reportMonths, monthlyGroups, parentSimulationId, rbt12ExtractionId} = validated;
  const requestHash = digest(JSON.stringify(validated));
  const c = await simulations();
  const repeated = async (record: Doc) => {
    await requireUnremovedId(simulationId);
    need(!Object.hasOwn(record, 'deletedAt'), 'Esta simulação foi excluída. Use um novo identificador para salvar outra simulação.',
      409, 'SIMULATION_DELETED');
    const sameReprocessing = reprocessing && record.reprocessing?.version === reprocessing.version && record.reprocessing?.originalId === reprocessing.originalId;
    const sameAnalysis=analysis && record.analysisId===analysis.analysisId && record.analysisRevision===analysis.analysisRevision;
    need((record.createdBy.id === actor._id || sameReprocessing || sameAnalysis) && record.requestHash === requestHash,
      'Este identificador já pertence a outra simulação. Gere uma nova versão para guardar alterações.', 409, 'SIMULATION_EXISTS');
    return visible(record);
  };
  await requireUnremovedId(simulationId);
  const existing = await c.findOne(scope({_id: simulationId}));
  if (existing) return repeated(existing);
  await assertGenerationNotDeleted(generationId);
  let parent:any=null;
  if (parentSimulationId) {
    parent = await getSimulation(parentSimulationId);
    need(parent.clientId === clientId && (analysis || parent.generationId === generationId),
      'A simulação original precisa pertencer à mesma empresa e geração.', 409, 'SIMULATION_PARENT');
  }
  const source = analysis?.source || reprocessing?.source || await generationSimulator(generationId, clientId);
  if(analysis)need(source.generationId===generationId && source.clientId===clientId,'A origem da análise não corresponde à empresa.',409,'ANALYSIS_SOURCE_CHANGED');
  if (reprocessing) need(parentSimulationId === reprocessing.originalId && source.generationId === generationId && source.clientId === clientId,
    'A origem do recálculo não corresponde ao histórico.', 409, 'REPROCESS_SOURCE');
  // Match a retry against its original request before normalizing the effective
  // policy. New snapshots always describe the directions actually calculated;
  // omitted preferences inherit this company's selection, never another company.
  const draft: SimulationDraft = {...submittedDraft,
    difalPolicy: upgradeDifalPolicy(submittedDraft.difalPolicy ?? source.difalPolicy)};
  if (source.periodBasis === 'COLUMN_H') {
    need(source.reportMonths === reportMonths && source.period && reportMonths === source.period.months,
      'O período da simulação deve corresponder ao intervalo identificado na coluna H dos relatórios.', 409, 'SIMULATION_PERIOD');
  }
  const rbt12Source = 'rbt12Source' in validated?validated.rbt12Source:'SIMPLES_SECTION_22';
  const rbt12Extraction = rbt12Source === 'MANUAL' || rbt12Source==='NOT_REQUIRED' ? null : reprocessing?.rbt12Extraction || await readRbt12Reference(rbt12ExtractionId, clientId, draft.rbt12);
  const createdAt = new Date();
  const rbt12Manual = rbt12Source === 'MANUAL' ? reprocessing?.rbt12Manual || {source: 'MANUAL' as const, confirmed: true,
    rbt12Cents: Math.round(draft.rbt12! * 100), confirmedAt: createdAt,
    confirmedBy: {id: actor._id, name: actor.name}} : null;
  need(source.monthlyReports, 'Este relatório não conserva as competências da coluna H. Reimporte compras e vendas para usar valores mensais; o histórico anterior permanece disponível.',409,'SIMULATION_MONTHS');
  need(reportMonths===source.monthlyReports.length,'O período precisa corresponder às competências dos relatórios.',409,'SIMULATION_PERIOD');
  need(Array.isArray(validated.monthlyInputs), 'Atualize a página para enviar os valores de cada competência.',409,'SIMULATION_MONTHS');
  const rbt12Schedule=rbt12Extraction?buildRbt12Schedule(rbt12Extraction,source.monthlyReports.map(row=>row.sourceMonth)):null;
  need(!rbt12Schedule||rbt12Schedule.complete,`O quadro 2.2 não cobre todas as competências. ${rbt12Schedule?.rows.filter(row=>row.status!=='CONFIRMED').map(row=>`${row.sourceMonth}: faltam ${row.missingMonths.join(', ')}`).join('; ')||''}. Importe um extrato com o histórico necessário.`,409,'RBT12_MONTHS_MISSING');
  const computed=(()=>{try{return calculateMonthlySimulation(draft,source.monthlyReports!,validated.monthlyInputs,source.sales.jobId,rbt12Schedule);}catch(error){throw new AppError(400,'VALIDATION',error instanceof Error?error.message:'Valores mensais inválidos.');}})();
  const {difalProjection,anticipationProjection,engineInput,result,projection,monthlyInputs}=computed;
  const first=baselineMonth(source.monthlyReports[0]);
  const baselineMonthlyGroups=first.groups,baselineServiceRevenue=first.values.serviceRevenue;
  const allAdjustments=computed.adjustments;
  const best = result.regimes.find((regime: any) => regime.id === result.bestRegimeId);
  const snapshot = {_id: simulationId, ...scope(), requestHash, generationId, clientId,
    title: validated.title || `${source.company.name} · ${draft.year}`, company: source.company,
    createdAt, createdBy: {id: actor._id, name: actor.name}, appVersion: VERSION,
    ...(analysis?{analysisId:analysis.analysisId,analysisRevision:analysis.analysisRevision,analysisPublication:'PENDING',analysisEvidence:analysis.evidence}:{}),
    ...(reprocessing && parent?.analysisId?{analysisId:parent.analysisId,analysisRevision:parent.analysisRevision,analysisPublication:'PUBLISHED',analysisEvidence:parent.analysisEvidence}:{}),
    ...(reprocessing ? {reprocessing: {version: reprocessing.version, originalId: reprocessing.originalId, completedAt: createdAt,
      ...(reprocessing.serviceRevenueMigration ? {serviceRevenueMigration:reprocessing.serviceRevenueMigration} : {})}} : {}),
    modelVersion: result.version, calculatorSourceCommit: CALCULATOR_SOURCE_COMMIT, taxSources: TAX_SOURCES,
    source, projection, difalProjection, anticipationProjection, monthlyInputs, reportMonths, reportPeriod: source.period || null, periodBasis: source.periodBasis, periodConfirmed: true,
    monthlyGroups, monthlyGroupsUnit: 'BRL', baselineMonthlyGroups,
    ...(baselineServiceRevenue === null ? {} : {baselineServiceRevenue}),
    manuallyAdjusted: allAdjustments.length > 0, adjustments: allAdjustments, draft, engineInput, result, parentSimulationId,
    rbt12Source, rbt12Extraction, ...(rbt12Schedule ? {rbt12Schedule} : {}), ...(rbt12Manual ? {rbt12Manual} : {}),
    monthlyDre: buildMonthlyDre(result, draft.year, rbt12Extraction || rbt12Manual, source.period || null),
    year: draft.year, annualRevenue: result.annualRevenue, bestRegimeId: result.bestRegimeId,
    bestRegimeName: best?.name || null, bestAnnualProfit: best?.annualProfit ?? null};
  const requireSources = async () => {
    await requireUnremovedId(simulationId);
    await assertGenerationNotDeleted(generationId);
    if (reprocessing) await Promise.all([assertLookupNotDeleted(source.purchases.jobId), assertLookupNotDeleted(source.sales.jobId)]);
    if (parentSimulationId) await getSimulation(parentSimulationId);
  };
  await requireSources();
  if(analysis)await analysis.beforeInsert();
  try { await c.insertOne(snapshot); }
  catch (error: any) {
    if (error.code !== 11000) throw error;
    await requireUnremovedId(simulationId);
    const concurrent = await c.findOne(scope({_id: simulationId}));
    need(concurrent, 'Identificador de simulação indisponível. Gere um novo identificador.', 409, 'SIMULATION_EXISTS');
    return repeated(concurrent);
  }
  // Deletion can win while this request hydrates its sources or waits to insert.
  // Discard a late insert before returning or auditing it as a new simulation.
  try { await requireSources(); }
  catch (error: any) {
    if (['SIMULATION_DELETED', 'GENERATION_DELETED', 'LOOKUP_DELETED', 'NOT_FOUND'].includes(error.code)) {
      await c.deleteOne(scope({_id: simulationId}));
    }
    throw error;
  }
  await audit(actor._id, 'simulation.create', simulationId);
  return visible(snapshot);
}

export async function simulationHistory(page: number, filters: {clientId?: string; search?: string; year?: string} = {}) {
  page = integer(page, 1, 100000);
  const query: Record<string, any> = scope({deletedAt: {$exists: false},analysisPublication:{$ne:'PENDING'}});
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
    annualRevenue: 1, bestRegimeId: 1, bestRegimeName: 1, bestAnnualProfit: 1, manuallyAdjusted: 1, reportMonths: 1, parentSimulationId: 1,
    reportPeriod: 1, periodBasis: 1, modelVersion: 1, analysisId:1,analysisRevision:1,'result.method': 1, 'projection.version': 1,
    'reprocessing.version': 1, 'reprocessing.originalId': 1, 'reprocessing.completedAt': 1};
  const [items, total] = await Promise.all([
    c.find(query).project(projection).sort({createdAt: -1, _id: -1}).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).maxTimeMS(20000).toArray(),
    c.countDocuments(query, {maxTimeMS: 20000})
  ]);
  // The original remains immutable. Expose where its completed revision can be
  // opened instead of presenting the old projection as though it were updated.
  // Scope both sides by workspace, company and generation; no snapshot hydration.
  const parentIds = [...new Set(items.map(item => item.parentSimulationId).filter(Boolean))];
  const [revisions, parents] = await Promise.all([
    items.length ? c.aggregate([
      {$match: scope({deletedAt: {$exists: false}, 'reprocessing.version': {$exists: true},
        $or: items.map(item => ({parentSimulationId: item._id, clientId: item.clientId, generationId: item.generationId})),
        $expr: {$eq: ['$reprocessing.originalId', '$parentSimulationId']}})},
      {$sort: {createdAt: -1, _id: -1}},
      {$group: {_id: '$parentSimulationId', simulationId: {$first: '$_id'}}}
    ], {maxTimeMS: 20000}).toArray() : [],
    parentIds.length ? c.find(scope({_id: {$in: parentIds}, deletedAt: {$exists: false}}))
      .project({_id: 1, clientId: 1, generationId: 1, analysisId:1}).maxTimeMS(20000).toArray() : []
  ]);
  const revisionsByParent = new Map(revisions.map(row => [row._id, row.simulationId]));
  const parentsById = new Map(parents.map(row => [row._id, row]));
  const analysisIds=[...new Set(items.map(item=>item.analysisId).filter(id=>typeof id==='string'&&UUID.test(id)))];
  const analyses=items.length?await(await collection('analyses')).find(scope({$or:[
    {'currentSimulation.id':{$in:items.map(item=>item._id)}},...(analysisIds.length?[{_id:{$in:analysisIds}}]:[])
  ]})).project({_id:1,clientId:1,activated:1,'currentSimulation.id':1}).toArray():[];
  const analysesById=new Map(analyses.map(row=>[row._id,row]));
  const currentById=new Map(analyses.filter(row=>row.currentSimulation?.id).map(row=>[row.currentSimulation.id,row]));
  const summaries = items.map(item => {
    const {result, projection: sourceProjection, ...summary} = item;
    const calculationMethod = result?.method === 'REPORT_MONTHS_V1' ? result.method :
      ['AVERAGE_X12_V1', 'AVERAGE_X12_V2'].includes(sourceProjection?.version) ? sourceProjection.version : null;
    const parent = parentsById.get(item.parentSimulationId);
    const analysis=currentById.get(item._id);
    // A managed revision can use a new import. Its parent may be the adopted legacy snapshot.
    const canonicalParent=!!item.analysisId && analysesById.get(item.analysisId)?.clientId===item.clientId &&
      (!parent?.analysisId || parent.analysisId===item.analysisId);
    return {...summary, calculationMethod, updatedSimulationId: revisionsByParent.get(item._id) || null,
      currentAnalysisId:analysis?._id||null,analysisProtected:!!item.analysisId || analysis?.activated===true,
      ...(item.parentSimulationId ? {parentSimulationDeleted: !parent || parent.clientId !== item.clientId ||
        (parent.generationId !== item.generationId && !canonicalParent)} : {})};
  });
  return {items: summaries, total, page, pageSize: PAGE_SIZE};
}
