/** Read-only purchase view. Raw imports, their hashes and source totals stay unchanged. */
import { normalizeCnpj } from './domain.ts';
import { documentKind } from './lookup-domain.ts';
import { classifyOperationNature, isPurchaseOperation, OPERATION_CATALOG_VERSION } from './operation-catalog.ts';

export const PURCHASE_SELECTION_VERSION = 'PURCHASE_NATURES_V1';
export type PurchaseSelectionOrigin = 'PREVIEW' | 'DERIVED_FROM_SNAPSHOT' | 'UNAVAILABLE';
const COMPONENTS = ['grossCents', 'discountCents', 'accessoryCents', 'freightCents', 'abatementCents', 'totalCents'] as const;
const STATUSES = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'] as const;
type SelectionRow = { totalCents: number; [key: string]: any };
function cents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Valor da seleção de compras inválido.');
  return value;
}
function add(left: number, right: number) { return cents(left + cents(right)); }
function percentage(value: number, total: number) {
  if (!total) return 0;
  const base = BigInt(total), numerator = BigInt(value) * 10000n;
  return Number((numerator * 2n + base) / (base * 2n)) / 100;
}
function hasNature(row: SelectionRow) { return typeof row.natureCode === 'string' && /^\d{4}$/.test(row.natureCode); }
export function selectPurchaseLine(row: SelectionRow, available = true) {
  cents(row.totalCents);
  const known = hasNature(row), operation: string = classifyOperationNature(row.natureCode);
  if (!available || !known) return { available: false, eligible: null, consideredCents: null, selectedLines: null, reason: 'MISSING_NATURE', operation };
  const eligible = isPurchaseOperation(row.natureCode);
  return { available: true, eligible, consideredCents: eligible ? row.totalCents : 0, selectedLines: eligible ? 1 : 0, reason: operation, operation };
}

/** Groups are opt-in: a parser preview has no reconciled provider statuses. */
export function summarizePurchaseSelection(rows: SelectionRow[], options: {
  origin?: Exclude<PurchaseSelectionOrigin, 'UNAVAILABLE'>;
  includeGroups?: boolean;
  calculationVersion?: 'NET_V2' | 'Q_V1';
} = {}) {
  const reportTotalCents = rows.reduce((sum, row) => add(sum, row.totalCents), 0);
  const available = rows.every(hasNature);
  const natureMap = new Map<string, { natureCode: string; operation: string; eligible: boolean | null; reason: string; lines: number; totalCents: number; consideredCents: number | null; excludedCents: number | null }>();
  for (const row of rows) {
    const line = selectPurchaseLine(row), natureCode = hasNature(row) ? row.natureCode : '';
    const audit = natureMap.get(natureCode) || { natureCode, operation: line.operation, eligible: line.eligible, reason: line.reason, lines: 0, totalCents: 0, consideredCents: line.available ? 0 : null, excludedCents: line.available ? 0 : null };
    audit.lines++; audit.totalCents = add(audit.totalCents, row.totalCents);
    if (line.available) { audit.consideredCents = add(audit.consideredCents!, line.consideredCents!); audit.excludedCents = add(audit.excludedCents!, row.totalCents - line.consideredCents!); }
    natureMap.set(natureCode, audit);
  }
  const common = { version: PURCHASE_SELECTION_VERSION, catalogVersion: OPERATION_CATALOG_VERSION, available,
    origin: (available ? options.origin || 'DERIVED_FROM_SNAPSHOT' : 'UNAVAILABLE') as PurchaseSelectionOrigin,
    reason: available ? 'CLASSIFIED' : 'MISSING_NATURE', reportTotalCents, reportLines: rows.length,
    natureTotals: [...natureMap.values()].sort((a, b) => a.natureCode.localeCompare(b.natureCode)) };
  if (!available) return { ...common, excludedTotalCents: null, excludedLines: null, totals: null, components: null, groups: null, reportingGroups: null, excluded: null };
  const selected = rows.filter(row => isPurchaseOperation(row.natureCode));
  const components = options.calculationVersion === 'Q_V1' ? null : Object.fromEntries(COMPONENTS.map(field => [field, 0]));
  const documents = new Map<string, { valid: boolean; documentKind: string; status: string | null; lines: number; totalCents: number }>();
  let totalCents = 0, cnpjCents = 0, cnpjLines = 0;
  for (const [index, row] of selected.entries()) {
    const normalized = normalizeCnpj(row.document), kind = documentKind(row.document);
    const document = String(row.document ?? '').trim().replace(/[.\/\-\s]/g, '').toUpperCase();
    const identity = normalized.valid ? normalized.cnpj : document ? `NON_CNPJ:${kind}:${document}` : `MISSING:${index}`;
    if (options.includeGroups && normalized.valid && !STATUSES.includes(row.status)) throw new Error('Situação de origem ausente na seleção de compras.');
    const status = normalized.valid && options.includeGroups ? row.status : null;
    const group = documents.get(identity) || { valid: normalized.valid, documentKind: kind, status, lines: 0, totalCents: 0 };
    if (group.status !== status) throw new Error('Situação divergente para o mesmo CNPJ na seleção de compras.');
    group.lines++; group.totalCents = add(group.totalCents, row.totalCents); documents.set(identity, group);
    totalCents = add(totalCents, row.totalCents);
    if (normalized.valid) { cnpjCents = add(cnpjCents, row.totalCents); cnpjLines++; }
    if (components) for (const field of COMPONENTS) components[field] = add(components[field], row[field]);
  }
  const valid = [...documents.values()].filter(group => group.valid), nonCnpj = [...documents.values()].filter(group => !group.valid);
  const totals = { lines: selected.length, uniqueCnpjs: valid.length, uniqueDocuments: documents.size, nonCnpjDocumentCount: nonCnpj.length,
    cnpjLines, nonCnpjLines: selected.length - cnpjLines, totalCents, cnpjCents, nonCnpjCents: totalCents - cnpjCents };
  const excludedMap = new Map<string, { documentKind: string; count: number; lines: number; totalCents: number }>();
  for (const group of nonCnpj) {
    const entry = excludedMap.get(group.documentKind) || { documentKind: group.documentKind, count: 0, lines: 0, totalCents: 0 };
    entry.count++; entry.lines += group.lines; entry.totalCents = add(entry.totalCents, group.totalCents); excludedMap.set(group.documentKind, entry);
  }
  const groups = options.includeGroups ? STATUSES.map(status => {
    const entries = valid.filter(group => group.status === status), value = entries.reduce((sum, entry) => add(sum, entry.totalCents), 0);
    return { status, count: entries.length, lines: entries.reduce((sum, entry) => sum + entry.lines, 0), totalCents: value,
      countPercent: percentage(entries.length, valid.length), valuePercent: percentage(value, cnpjCents) };
  }) : null;
  let reportingGroups = null;
  if (groups) {
    const optant = groups[0], unconfirmed = groups[2];
    const countPercent = percentage(optant.count, documents.size), valuePercent = percentage(optant.totalCents, totalCents);
    reportingGroups = [
      { ...optant, countPercent, valuePercent, unconfirmedCount: 0, unconfirmedCents: 0, nonCnpjCount: 0, nonCnpjCents: 0 },
      { status: 'NAO_OPTANTE', count: documents.size - optant.count, lines: selected.length - optant.lines, totalCents: totalCents - optant.totalCents,
        countPercent: documents.size ? (10000 - Math.round(countPercent * 100)) / 100 : 0, valuePercent: totalCents ? (10000 - Math.round(valuePercent * 100)) / 100 : 0,
        unconfirmedCount: unconfirmed.count, unconfirmedCents: unconfirmed.totalCents, nonCnpjCount: nonCnpj.length, nonCnpjCents: totals.nonCnpjCents }
    ];
  }
  return { ...common, excludedTotalCents: reportTotalCents - totalCents, excludedLines: rows.length - selected.length,
    totals, components, groups, reportingGroups, excluded: [...excludedMap.values()] };
}
export type PurchaseSelectionSummary = ReturnType<typeof summarizePurchaseSelection>;
