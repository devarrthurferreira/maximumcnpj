import {isDeepStrictEqual} from 'node:util';
import {collection, scope} from './store.ts';
import type {Doc} from './store.ts';
import {AppError, need} from './security.ts';
import {purchaseSummary} from './purchase-store.ts';
import {PURCHASE_MODE, SALES_MODE, COMPONENT_FIELDS, exactCents, exactSignedCents, financialReportingStatus} from './purchase-domain.ts';
import {normalizeNatureCode, normalizeUf, salesOperation, summarizeDifal} from './difal.ts';
import type {SalesOperation} from './difal.ts';
import {annualizeReports} from '../public/simulator-projection.js';
import type {generationSimulator} from './simulator-store.ts';

type Source = Awaited<ReturnType<typeof generationSimulator>>;
type Summary = Awaited<ReturnType<typeof purchaseSummary>>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SALES_GROUPS = ['OPTANTE', 'NAO_OPTANTE', 'CPF'] as const;
const SALES_FIELDS = ['salesOptantCents', 'salesNonOptantCents', 'salesCpfCents'] as const;
const check = (condition: unknown, message: string) => need(condition, message, 409, 'REPROCESS_SOURCE');
const groupValue = (summary: Summary, status: string) => {
  const group = summary.reportingGroups.find(group => group.status === status);
  check(group, 'A classificação original dos relatórios está incompleta.');
  return exactSignedCents(group!.totalCents);
};

function originalSource(snapshot: Doc, purchases: Summary, sales: Summary) {
  const source = snapshot.source;
  check(source && source.generationId === snapshot.generationId && source.clientId === snapshot.clientId,
    'A origem congelada não corresponde à empresa e geração da simulação.');
  check(Number.isInteger(snapshot.reportMonths) && snapshot.reportMonths >= 1 && snapshot.reportMonths <= 12,
    'O histórico não conserva um período mensal válido.');
  for (const [name, summary] of [['purchases', purchases], ['sales', sales]] as const) {
    const saved = source[name], job = summary.job;
    check(saved?.jobId === job._id && job.clientId === snapshot.clientId && job.generationId === snapshot.generationId &&
      job.completedAt && saved.calculationVersion === 'NET_V2' && summary.calculationVersion === 'NET_V2',
    'Os relatórios originais não correspondem à empresa, geração e fórmula da simulação.');
    check(saved.totalCents === summary.totals.totalCents,
      'O total do relatório original diverge do total congelado na simulação.');
    if (saved.period) check(isDeepStrictEqual(saved.period, summary.period), 'O período fiscal original diverge do histórico.');
  }
  check(source.fields && source.fields.purchasesOptantCents === groupValue(purchases, 'OPTANTE') &&
    source.fields.purchasesNonOptantCents === groupValue(purchases, 'NAO_OPTANTE'),
  'As compras congeladas divergem dos relatórios originais.');
  const split = source.revenueSplit?.version === 'SALES_SERVICES_V1';
  SALES_GROUPS.forEach((status, index) => {
    const service = split ? sales.serviceGroups?.find(group => group.status === status)?.totalCents : 0;
    check(typeof service === 'number' && source.fields[SALES_FIELDS[index]] === groupValue(sales, status) - service,
      'Os grupos de receita congelados divergem do relatório original.');
  });
  if (split) check(source.fields.serviceRevenueCents === sales.servicesTotalCents,
    'Os serviços congelados divergem do relatório original.');
  if (source.periodBasis === 'COLUMN_H') {
    check(source.period && source.reportMonths === snapshot.reportMonths && source.period.months === snapshot.reportMonths &&
      isDeepStrictEqual(source.period, purchases.period) && sales.period &&
      purchases.period?.startMonth === sales.period.startMonth && purchases.period?.endMonth === sales.period.endMonth,
    'As competências originais não correspondem ao período congelado.');
  }
  if (snapshot.reportPeriod) check(isDeepStrictEqual(snapshot.reportPeriod, source.period),
    'O período congelado na simulação diverge de sua origem.');
  return source;
}

/** Reclassify only after the original immutable jobs, sums and provider snapshots reconcile. */
export async function rebuildSimulationSource(snapshot: Doc): Promise<Source & {reprocessingSource: {
  version: string; originalSalesTotalCents: number; originalPurchasesTotalCents: number;
  recalculatedSalesTotalCents: number; salesBalanceChangeCents: number; reclassifiedLines: number;
  missingOperationEvidenceLines: number; issuerUfSource: string;
}}> {
  const old = snapshot.source;
  check(UUID.test(snapshot.generationId || '') && UUID.test(snapshot.clientId || '') &&
    UUID.test(old?.purchases?.jobId || '') && UUID.test(old?.sales?.jobId || '') && old.purchases.jobId !== old.sales.jobId,
  'O histórico não identifica os dois relatórios originais.');
  // This is deliberately before applying current classifiers: an unreconciled
  // archive cannot be repaired by treating the current calculation as its truth.
  const [purchases, sales] = await Promise.all([
    purchaseSummary(old.purchases.jobId, true, PURCHASE_MODE), purchaseSummary(old.sales.jobId, true, SALES_MODE)
  ]);
  const original = originalSource(snapshot, purchases, sales);
  const [rows, items] = await Promise.all([
    (await collection('purchaseLines')).find(scope({jobId: sales.job._id})).sort({index: 1}).maxTimeMS(20000).toArray(),
    (await collection('lookupItems')).find(scope({jobId: sales.job._id})).project({cnpj: 1, status: 1}).maxTimeMS(20000).toArray()
  ]);
  check(rows.length === sales.totals.lines && new Set(rows.map(row => row.index)).size === rows.length &&
    rows.every((row, index) => row.index === index), 'As linhas originais ficaram incompletas durante o recálculo.');
  const rawTotal = exactCents(rows.reduce((sum, row) => exactCents(sum + exactCents(row.totalCents)), 0));
  const oldBalance = exactSignedCents(rows.reduce((sum, row) => exactSignedCents(sum + exactSignedCents(row.balanceCents ?? row.totalCents)), 0));
  check(rawTotal === sales.job.purchaseInput.totalCents && oldBalance === sales.totals.totalCents,
    'As linhas originais mudaram durante a reconciliação.');
  for (const field of COMPONENT_FIELDS) check(exactCents(rows.reduce((sum, row) => exactCents(sum + exactCents(row[field])), 0)) === sales.components?.[field],
    'Os componentes originais mudaram durante a reconciliação.');
  const statuses = new Map(items.map(item => [item.cnpj, item.status]));
  const totals = new Map<string, number>(SALES_GROUPS.map(status => [status, 0]));
  const services = new Map<string, number>(SALES_GROUPS.map(status => [status, 0]));
  const operations = new Map<string, {operation: string; lines: number; totalCents: number; balanceCents: number}>();
  const unconfirmed = new Set<string>(), otherDocuments = new Set<string>();
  let unconfirmedCents = 0, otherDocumentsCents = 0, reclassifiedLines = 0, missingOperationEvidenceLines = 0;
  const currentRows = rows.map(row => {
    const status = row.valid ? statuses.get(row.cnpj) : undefined;
    check(!row.valid || ['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO'].includes(status), 'O enquadramento congelado está ausente.');
    const reportingStatus = financialReportingStatus({...row, status}, SALES_MODE);
    const natureCode = normalizeNatureCode(row.natureCode), description = typeof row.description === 'string' ? row.description : '';
    const missingEvidence = !natureCode && !description.trim();
    const operation = missingEvidence && ['VENDA','SERVICO','DEVOLUCAO','OUTRAS'].includes(row.operation)
      ? row.operation as SalesOperation : salesOperation(natureCode, description);
    const balanceCents = operation === 'DEVOLUCAO' ? -row.totalCents : row.totalCents;
    totals.set(reportingStatus, exactSignedCents(totals.get(reportingStatus)! + balanceCents));
    if (operation === 'SERVICO') services.set(reportingStatus, exactCents(services.get(reportingStatus)! + row.totalCents));
    const count = operations.get(operation) || {operation, lines: 0, totalCents: 0, balanceCents: 0};
    count.lines++; count.totalCents = exactCents(count.totalCents + row.totalCents); count.balanceCents = exactSignedCents(count.balanceCents + balanceCents);
    operations.set(operation, count);
    if (row.valid && status === 'NAO_CONFIRMADO') {unconfirmed.add(row.cnpj); unconfirmedCents = exactSignedCents(unconfirmedCents + balanceCents);}
    if (!row.valid && row.documentKind !== 'CPF') {
      otherDocuments.add(row.document ? `${row.documentKind}:${row.document}` : `MISSING:${row.index}`);
      otherDocumentsCents = exactSignedCents(otherDocumentsCents + balanceCents);
    }
    if (row.operation !== operation || row.natureCode !== natureCode || (row.balanceCents ?? row.totalCents) !== balanceCents) reclassifiedLines++;
    if (missingEvidence && row.totalCents > 0) missingOperationEvidenceLines++;
    return {...row, totalCents: row.totalCents, natureCode, description, operation, balanceCents, recipientUf: normalizeUf(row.recipientUf)};
  });
  const originalIssuer = normalizeUf(sales.job.issuerUf), savedIssuer = normalizeUf(original.sales.difal?.issuerUf);
  check(!originalIssuer || !savedIssuer || originalIssuer === savedIssuer, 'As UFs congeladas do emitente são conflitantes.');
  const issuerUf = originalIssuer || savedIssuer;
  const difal = summarizeDifal(currentRows, issuerUf);
  const fields = {
    salesOptantCents: exactSignedCents(totals.get('OPTANTE')! - services.get('OPTANTE')!),
    salesNonOptantCents: exactSignedCents(totals.get('NAO_OPTANTE')! - services.get('NAO_OPTANTE')!),
    salesCpfCents: exactSignedCents(totals.get('CPF')! - services.get('CPF')!),
    serviceRevenueCents: exactCents([...services.values()].reduce((sum, value) => exactCents(sum + value), 0)),
    purchasesOptantCents: exactCents(groupValue(purchases, 'OPTANTE')),
    purchasesNonOptantCents: exactCents(groupValue(purchases, 'NAO_OPTANTE'))
  };
  const recalculatedSalesTotalCents = exactSignedCents([...totals.values()].reduce((sum, value) => exactSignedCents(sum + value), 0));
  const salesBalanceChangeCents = exactSignedCents(recalculatedSalesTotalCents - sales.totals.totalCents);
  const projection = (() => {
    try {return annualizeReports(fields, snapshot.reportMonths);}
    catch (error) {throw new AppError(409, 'REPROCESS_SOURCE', error instanceof Error ? error.message : 'A receita reconstruída não permite uma projeção válida.');}
  })();
  const warnings = [...(Array.isArray(original.warnings) ? original.warnings : []),
    'Recálculo sobre as linhas originais: natureza, descrição, valores e enquadramento da consulta foram preservados. Nenhum CNPJ foi consultado novamente.',
    'Serviços identificados nas linhas originais foram separados das mercadorias antes de aplicar ajustes do cenário.'];
  if (salesBalanceChangeCents) warnings.push('A classificação atual das operações alterou o saldo líquido do relatório reconstruído. A diferença está identificada na origem do recálculo; não é um ajuste manual.');
  if (missingOperationEvidenceLines) warnings.push(`${missingOperationEvidenceLines} linhas não possuem natureza nem descrição para confirmar a classificação atual. O recálculo depende de revisão dessas evidências.`);
  if (difal.pendingLines) warnings.push(`${difal.pendingLines} linhas elegíveis dependem de UF histórica do emitente ou destinatário; nenhum endereço atual foi utilizado para preencher a ausência.`);
  return {...original, generationId: snapshot.generationId, clientId: snapshot.clientId,
    company: structuredClone(snapshot.company || original.company), fields, revenueSplit: {version: 'SALES_SERVICES_V1'},
    projection: original.periodBasis === 'COLUMN_H' ? projection : null,
    purchases: {...original.purchases, totalCents: purchases.totals.totalCents},
    sales: {...original.sales, totalCents: recalculatedSalesTotalCents, servicesTotalCents: fields.serviceRevenueCents,
      operationTotals: [...operations.values()].sort((a, b) => a.operation.localeCompare(b.operation)), difal},
    classification: {...original.classification, sales: {unconfirmedCount: unconfirmed.size, unconfirmedCents,
      otherDocumentsCount: otherDocuments.size, otherDocumentsCents}}, warnings,
    reprocessingSource: {version: 'FROZEN_LINES_CURRENT_RULES_V1', originalSalesTotalCents: sales.totals.totalCents,
      originalPurchasesTotalCents: purchases.totals.totalCents, recalculatedSalesTotalCents, salesBalanceChangeCents,
      reclassifiedLines, missingOperationEvidenceLines, issuerUfSource: originalIssuer ? 'ORIGINAL_JOB' : savedIssuer ? 'ORIGINAL_SIMULATION' : 'UNAVAILABLE'}
  };
}
