import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { getJob } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { need, integer } from './security.ts';
import { PURCHASE_MODE, SALES_MODE, isFinancialMode, financialKind, financialLabel, type FinancialMode, PURCHASE_STATUSES, COMPONENT_FIELDS, MAX_LINE_CENTS, calculationVersion, purchaseFormula, exactCents, percentage, reconciledPercentages, purchaseCsv, reportPeriod, sameReportPeriod } from './purchase-domain.ts';

const FINANCIAL_FIELDS = [...COMPONENT_FIELDS, 'totalCents'] as const;
// Stored documents are already normalized. An absent identifier represents its own row, never a shared person.
function documentIdentity() {
  return {$cond: ['$valid', '$cnpj', {$cond: [{$ne: ['$document', '']},
    {$concat: ['NON_CNPJ:', '$documentKind', ':', '$document']}, {$concat: ['MISSING:', {$toString: '$index'}]}]}]};
}
function validLineCents(field: string) {
  return {$cond: [{$isNumber: '$' + field}, {$and: [{$gte: ['$' + field, 0]}, {$lte: ['$' + field, MAX_LINE_CENTS]}, {$eq: ['$' + field, {$trunc: '$' + field}]}]}, false]};
}
async function financialGroups(name: string, id: string, job: Doc) {
  const net = calculationVersion(job) === 'NET_V2';
  const numeric = {$and: (net ? FINANCIAL_FIELDS : ['totalCents']).map(validLineCents)};
  const valid = net ? {$cond: [numeric, {$eq: ['$totalCents', {$subtract: [{$add: [{$subtract: ['$grossCents', '$discountCents']}, '$freightCents']}, '$abatementCents']}]}, false]} : numeric;
  const groups = await (await collection(name)).aggregate([
    {$match: scope({jobId: id})}, {$sort: {index: 1}},
    {$group: {_id: documentIdentity(), valid: {$first: '$valid'}, name: {$first: '$name'}, documentKind: {$first: '$documentKind'},
      lines: {$sum: 1}, invalidAmounts: {$sum: {$cond: [valid, 0, 1]}}, totalCents: {$sum: '$totalCents'},
      ...(net ? Object.fromEntries(COMPONENT_FIELDS.map(field => [field, {$sum: '$' + field}])) : {})}}
  ], {allowDiskUse: true, maxTimeMS: 20000}).toArray();
  need(groups.every(group => group.invalidAmounts === 0), 'Componentes ausentes, inválidos ou divergentes de Q - Y + AA - AB. Emissão bloqueada.', 409, 'PURCHASE_TOTAL');
  return groups;
}
function componentTotals(groups: any[]) {
  return Object.fromEntries(FINANCIAL_FIELDS.map(field => [field, exactCents(groups.reduce((sum, group) => sum + exactCents(group[field]), 0))]));
}
async function financialPeriod(name: string, id: string, job: Doc) {
  if (calculationVersion(job) !== 'NET_V2') return null;
  const rows = await (await collection(name)).find(scope({jobId: id})).project({serviceDate: 1}).sort({index: 1}).maxTimeMS(20000).toArray();
  need(rows.length === job.expectedRows, 'Período fiscal incompleto. Reimporte o relatório.', 409, 'REPORT_PERIOD');
  return reportPeriod(rows.map(row => row.serviceDate));
}
type DocumentTotals = {count: number; lines: number; totalCents: number};
function reportingGroups(groups: any[], unique: number, cents: number, nonCnpj: DocumentTotals, cpf: DocumentTotals, mode: FinancialMode) {
  const optant = groups.find(group => group.status === 'OPTANTE')!;
  const nonOptant = groups.find(group => group.status === 'NAO_OPTANTE')!;
  const unconfirmed = groups.find(group => group.status === 'NAO_CONFIRMADO')!;
  const countPercent = percentage(optant.count, unique), valuePercent = percentage(optant.totalCents, cents);
  const separateCpf = mode === SALES_MODE;
  const otherDocuments = {count: nonCnpj.count - (separateCpf ? cpf.count : 0), lines: nonCnpj.lines - (separateCpf ? cpf.lines : 0), totalCents: nonCnpj.totalCents - (separateCpf ? cpf.totalCents : 0)};
  const combined = {status: 'NAO_OPTANTE', count: nonOptant.count + unconfirmed.count + otherDocuments.count,
    lines: nonOptant.lines + unconfirmed.lines + otherDocuments.lines,
    totalCents: exactCents(nonOptant.totalCents + unconfirmed.totalCents + otherDocuments.totalCents),
    unconfirmedCount: unconfirmed.count, unconfirmedCents: unconfirmed.totalCents,
    nonCnpjCount: otherDocuments.count, nonCnpjCents: otherDocuments.totalCents};
  if (separateCpf) {
    const salesGroups = [
      {...optant, unconfirmedCount: 0, unconfirmedCents: 0, nonCnpjCount: 0, nonCnpjCents: 0}, combined,
      {status: 'CPF', count: cpf.count, lines: cpf.lines, totalCents: cpf.totalCents, unconfirmedCount: 0, unconfirmedCents: 0, nonCnpjCount: cpf.count, nonCnpjCents: cpf.totalCents}
    ];
    const counts = reconciledPercentages(salesGroups.map(group => group.count), unique);
    const values = reconciledPercentages(salesGroups.map(group => group.totalCents), cents);
    return salesGroups.map((group, index) => ({...group, countPercent: counts[index], valuePercent: values[index]}));
  }
  // Complement the second rounded percentage so the two displayed groups reconcile to exactly 100%.
  return [{...optant, countPercent, valuePercent, unconfirmedCount: 0, unconfirmedCents: 0, nonCnpjCount: 0, nonCnpjCents: 0},
    {...combined, countPercent: unique ? (10000 - Math.round(countPercent * 100)) / 100 : 0,
      valuePercent: cents ? (10000 - Math.round(valuePercent * 100)) / 100 : 0}];
}
export async function purchaseJob(id: string, mode: FinancialMode = PURCHASE_MODE) {
  const job = await getJob(id);
  need(isFinancialMode(mode) && job.mode === mode, `Relatório de ${financialLabel(mode)} não encontrado.`, 404, 'NOT_FOUND');
  return job;
}
/** Caller owns the same job lease used by upload and provider processing. */
export async function finalizePurchaseUpload(actor: LookupActor, job: Doc) {
  need(isFinancialMode(job.mode), 'Tipo de relatório inválido.');
  const id = job._id, stage = await collection('lookupStage'), rows = await collection('purchaseLines');
  const count = await stage.countDocuments(scope({jobId: id}));
  need(count === job.expectedRows && job.uploaded === count, 'Envio incompleto ou expirado. Reenvie a planilha.', 409, 'INCOMPLETE');
  const groups = await financialGroups('lookupStage', id, job);
  const period = calculationVersion(job) === 'NET_V2' ? await financialPeriod('lookupStage', id, job) : null;
  const valid = groups.filter(g => g.valid), invalid = groups.filter(g => !g.valid).reduce((sum, g) => sum + g.lines, 0);
  const totalCents = exactCents(groups.reduce((sum, g) => sum + exactCents(g.totalCents), 0));
  // Persist only approved financial components plus row/document identity. Never retain the uploaded workbook.
  await stage.aggregate([
    {$match: scope({jobId: id})},
    {$project: {_id: 1, workspaceId: 1, jobId: 1, index: 1, document: 1, documentKind: 1, cnpj: 1, name: 1, serviceDate: 1, quantity: 1, totalCents: 1, valid: 1, kind: 1, ...Object.fromEntries(COMPONENT_FIELDS.map(field => [field, 1]))}},
    {$merge: {into: 'purchaseLines', on: '_id', whenMatched: 'keepExisting', whenNotMatched: 'insert'}}
  ], {maxTimeMS: 20000}).toArray();
  need(await rows.countDocuments(scope({jobId: id})) === count, 'Cópia financeira incompleta.', 409, 'RESULT_COUNT');
  const items = await collection('lookupItems');
  for (let p = 0; p < valid.length; p += 500) {
    await items.bulkWrite(valid.slice(p, p + 500).map(g => ({updateOne: {filter: scope({_id: `${id}:${g._id}`}), update: {$setOnInsert: {
      ...scope(), jobId: id, clientId: job.clientId, cnpj: g._id, submittedName: g.name, kind: financialKind(job.mode), uf: '', occurrences: g.lines,
      totalCents: exactCents(g.totalCents), state: 'PENDING', attempts: 0, createdAt: new Date()
    }}, upsert: true}})));
  }
  need(await items.countDocuments(scope({jobId: id})) === valid.length, 'Quantidade de CNPJs inconsistente.', 409, 'RESULT_COUNT');
  const summary = {lines: count, unique: valid.length, invalid, duplicates: count - invalid - valid.length};
  const update: any = {summary, ...(period ? {reportPeriod: period} : {}), purchaseInput: {totalCents, cnpjCents: exactCents(valid.reduce((sum, g) => sum + g.totalCents, 0)), ...(calculationVersion(job) === 'NET_V2' ? {components: componentTotals(groups)} : {})}, status: 'PROCESSING', received: 0, startedAt: new Date()};
  // Non-CNPJ documents do not need provider lookups; sales CPF remains its own managerial group.
  if (!valid.length) { update.status = 'COMPLETED'; update.completedAt = new Date(); }
  await (await collection('lookupJobs')).updateOne(scope({_id: id}), {$set: update});
  await stage.deleteMany(scope({jobId: id}));
  await audit(actor._id, job.mode === SALES_MODE ? 'sales.validated' : 'purchases.validated', id);
  return getJob(id);
}

/** Reconcile against immutable stored lines and scoped provider snapshots before any report/download. */
export async function purchaseSummary(id: string, requireComplete = true, mode: FinancialMode = PURCHASE_MODE) {
  const job = await purchaseJob(id, mode);
  if (requireComplete) need(job.status === 'COMPLETED', `Conclua a consulta para emitir o relatório de ${financialLabel(mode)}.`, 409, 'INCOMPLETE');
  need(job.summary && job.purchaseInput, 'Resumo financeiro ausente.', 409, 'INCOMPLETE');
  const version = calculationVersion(job), formula = purchaseFormula(version);
  const grouped = await financialGroups('purchaseLines', id, job);
  const components = version === 'NET_V2' ? componentTotals(grouped) : null;
  const period = job.reportPeriod ? await financialPeriod('purchaseLines', id, job) : null;
  if (job.reportPeriod) need(!!period && sameReportPeriod(period, job.reportPeriod) && period?.observedMonths === job.reportPeriod.observedMonths &&
    JSON.stringify(period?.missingMonths) === JSON.stringify(job.reportPeriod.missingMonths),
    'Período fiscal divergente do snapshot. Emissão bloqueada.', 409, 'REPORT_PERIOD');
  if (components) need(FINANCIAL_FIELDS.every(field => job.purchaseInput.components?.[field] === components[field]), 'Componentes divergentes do snapshot. Emissão bloqueada.', 409, 'PURCHASE_TOTAL');
  const items = await (await collection('lookupItems')).aggregate([
    {$match: scope({jobId: id})},
    {$lookup: {from: 'cnpjStates', let: {state: '$stateId', identity: '$cnpj'}, pipeline: [{$match: {$expr: {$and: [{$eq: ['$_id', '$$state']}, {$eq: ['$cnpj', '$$identity']}, {$eq: ['$workspaceId', scope().workspaceId]}]}}}, {$project: {status: 1}}], as: 'sourceState'}},
    {$project: {cnpj: 1, clientId: 1, kind: 1, state: 1, stateId: 1, status: 1, occurrences: 1, totalCents: 1, sourceState: 1}}
  ], {maxTimeMS: 20000}).toArray();
  const valid = grouped.filter(g => g.valid), nonCnpj = grouped.filter(g => !g.valid);
  const excludedByKind = new Map<string, {documentKind: string; count: number; lines: number; totalCents: number}>();
  for (const group of nonCnpj) {
    const excluded = excludedByKind.get(group.documentKind) || {documentKind: group.documentKind, count: 0, lines: 0, totalCents: 0};
    excluded.count++; excluded.lines += group.lines; excluded.totalCents = exactCents(excluded.totalCents + exactCents(group.totalCents));
    excludedByKind.set(group.documentKind, excluded);
  }
  const excluded = [...excludedByKind.values()];
  const lines = grouped.reduce((sum, g) => sum + g.lines, 0), cnpjLines = valid.reduce((sum, g) => sum + g.lines, 0);
  const cnpjCents = exactCents(valid.reduce((sum, g) => sum + exactCents(g.totalCents), 0)), nonCnpjCents = exactCents(excluded.reduce((sum, g) => sum + g.totalCents, 0));
  const totalCents = exactCents(cnpjCents + nonCnpjCents);
  need(lines === job.expectedRows && lines === job.summary.lines && valid.length === job.summary.unique && items.length === valid.length &&
    lines - cnpjLines === job.summary.invalid && cnpjLines - valid.length === job.summary.duplicates && job.purchaseInput.totalCents === totalCents && job.purchaseInput.cnpjCents === cnpjCents,
    'Linhas, CNPJs ou valores divergentes do snapshot. Emissão bloqueada.', 409, 'RESULT_COUNT');
  const indexed = new Map(items.map(item => [item.cnpj, item]));
  const groups = PURCHASE_STATUSES.map(status => ({status, count: 0, lines: 0, totalCents: 0, countPercent: 0, valuePercent: 0}));
  for (const line of valid) {
    const item = indexed.get(line._id);
    need(item && item.clientId === job.clientId && item.kind === financialKind(mode) && item.state === 'DONE' && item.occurrences === line.lines && item.totalCents === line.totalCents && PURCHASE_STATUSES.includes(item.status),
      'Snapshot de CNPJ incompleto ou divergente.', 409, 'RESULT_COUNT');
    need(item.stateId ? item.sourceState.length === 1 && item.sourceState[0].status === item.status : item.status === 'NAO_CONFIRMADO',
      'Estado de origem ausente ou divergente.', 409, 'RESULT_COUNT');
    const group = groups.find(g => g.status === item.status)!;
    group.count++; group.lines += line.lines; group.totalCents = exactCents(group.totalCents + line.totalCents);
  }
  for (const group of groups) { group.countPercent = percentage(group.count, valid.length); group.valuePercent = percentage(group.totalCents, cnpjCents); }
  const uniqueDocuments = grouped.length, nonCnpjDocumentCount = nonCnpj.length;
  return {job, calculationVersion: version, formula, components, period,
    reportingGroups: reportingGroups(groups, uniqueDocuments, totalCents, {count: nonCnpjDocumentCount, lines: lines - cnpjLines, totalCents: nonCnpjCents}, excludedByKind.get('CPF') || {count: 0, lines: 0, totalCents: 0}, mode),
    totals: {lines, uniqueCnpjs: valid.length, uniqueDocuments, nonCnpjDocumentCount, cnpjLines, nonCnpjLines: lines - cnpjLines, totalCents, cnpjCents, nonCnpjCents}, groups, excluded,
    denominators: {count: 'Documentos distintos do relatório, incluindo CPF, CNO e inválidos. Cada linha sem documento conta separadamente.', value: `Soma de ${formula} de todas as linhas do relatório. Apenas optantes confirmados entram em Simples; ${mode === SALES_MODE ? 'CPF tem grupo próprio nas vendas; os demais, incluindo não confirmados e outros documentos, integram Não optantes.' : 'todo o restante integra Não optantes no agrupamento gerencial.'}`},
    source: `Minha Receita — enquadramento observado na consulta; não comprova o regime na data da ${mode === SALES_MODE ? 'venda' : 'compra'}.`};
}
export function purchaseFilter(value: string, mode: FinancialMode = PURCHASE_MODE) {
  need(['ALL', ...PURCHASE_STATUSES, 'NON_CNPJ', ...(mode === SALES_MODE ? ['CPF'] : [])].includes(value), 'Grupo financeiro inválido.'); return value;
}
export async function purchaseHistory(clientId: string, page: number, mode: FinancialMode = PURCHASE_MODE) {
  need(isFinancialMode(mode), 'Tipo de relatório inválido.');
  const query = scope({mode, ...(clientId ? {clientId} : {})});
  const jobs = await collection('lookupJobs');
  return {items: await jobs.find(query).sort({createdAt: -1, _id: 1}).skip((page - 1) * 30).limit(30).toArray(), total: await jobs.countDocuments(query), page};
}
async function financialPage(id: string, status: string, page: number, pageSize: number, grouped = false, mode: FinancialMode = PURCHASE_MODE) {
  const match: any = scope({jobId: id});
  if (status === 'NON_CNPJ') match.valid = false;
  else if (status === 'CPF') { match.valid = false; match.documentKind = 'CPF'; }
  else if (status === 'OPTANTE' || status === 'NAO_CONFIRMADO') match.valid = true;
  const stages: any[] = [{$match: match}];
  if (grouped) stages.push({$sort: {index: 1}}, {$group: {
    _id: documentIdentity(), index: {$first: '$index'}, document: {$first: '$document'}, documentKind: {$first: '$documentKind'},
    cnpj: {$first: '$cnpj'}, name: {$first: '$name'}, valid: {$first: '$valid'}, kind: {$first: '$kind'},
    occurrences: {$sum: 1}, totalCents: {$sum: '$totalCents'}
  }});
  stages.push({$lookup: {from: 'lookupItems', let: {identity: '$cnpj'}, pipeline: [
    {$match: {...scope({jobId: id}), $expr: {$eq: ['$cnpj', '$$identity']}}},
    {$project: {status: 1, checkedAt: 1, stateId: 1, reason: 1, source: 1}}
  ], as: 'lookup'}}, {$set: {
    status: {$cond: ['$valid', {$arrayElemAt: ['$lookup.status', 0]}, 'NON_CNPJ']},
    checkedAt: {$arrayElemAt: ['$lookup.checkedAt', 0]}, stateId: {$arrayElemAt: ['$lookup.stateId', 0]},
    reason: {$cond: ['$valid', {$arrayElemAt: ['$lookup.reason', 0]}, '$documentKind']},
    source: {$cond: ['$valid', {$arrayElemAt: ['$lookup.source', 0]}, 'Não consultado']}, submittedName: '$name'
  }}, {$set: {reportingStatus: {$cond: [{$and: [mode === SALES_MODE, {$eq: ['$documentKind', 'CPF']}]}, 'CPF', {$cond: [{$and: ['$valid', {$eq: ['$documentKind', 'CNPJ']}, {$eq: ['$status', 'OPTANTE']}]}, 'OPTANTE', 'NAO_OPTANTE']}]}}});
  if (status === 'OPTANTE' || status === 'NAO_OPTANTE' || status === 'CPF') stages.push({$match: {reportingStatus: status}});
  else if (status === 'NAO_CONFIRMADO') stages.push({$match: {status}});
  const pageStages: any[] = [{$sort: grouped ? {document: 1, index: 1} : {index: 1}}, {$skip: (page - 1) * pageSize}, {$limit: pageSize}];
  if (grouped) pageStages.push({$lookup: {from: 'cnpjStates', let: {state: '$stateId', identity: '$cnpj'}, pipeline: [
    {$match: {$expr: {$and: [{$eq: ['$_id', '$$state']}, {$eq: ['$cnpj', '$$identity']}, {$eq: ['$workspaceId', scope().workspaceId]}]}}}
  ], as: 'details'}}, {$set: {details: {$arrayElemAt: ['$details', 0]}}});
  pageStages.push({$project: {workspaceId: 0, lookup: 0}});
  const [result] = await (await collection('purchaseLines')).aggregate([
    ...stages, {$facet: {items: pageStages, count: [{$count: 'total'}]}}
  ], {allowDiskUse: true, maxTimeMS: 20000}).toArray();
  return {items: (result?.items || []).map((row: any) => grouped ? row : {...row, occurrences: 1}), total: result?.count?.[0]?.total || 0, page, pageSize};
}
export async function purchaseRows(id: string, status: string, page: number, lines = false, mode: FinancialMode = PURCHASE_MODE) {
  await purchaseSummary(id, true, mode); purchaseFilter(status, mode);
  return financialPage(id, status, page, 100, !lines, mode);
}
export async function purchaseExport(id: string, status: string, part: number, mode: FinancialMode = PURCHASE_MODE) {
  const summary = await purchaseSummary(id, true, mode); purchaseFilter(status, mode);
  const result = await financialPage(id, status, part, 2000, false, mode), parts = Math.max(1, Math.ceil(result.total / 2000));
  integer(part, 1, parts);
  const content = purchaseCsv(summary.job, result.items);
  need(Buffer.byteLength(content, 'utf8') <= 4_000_000, 'Arquivo acima do limite. Escolha um grupo menor.', 413, 'REPORT_TOO_LARGE');
  return {fileName: `${financialLabel(mode)}-${summary.job.clientCode || 'empresa'}-${id}-${status}-parte-${part}-de-${parts}.csv`, content, mimeType: 'text/csv;charset=utf-8', total: result.total, parts, part};
}
