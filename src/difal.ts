import {classifyOperationNature, normalizeOperationNature} from './operation-catalog.ts';
import {normalizeCnpj} from './domain.ts';
/** Managerial outgoing DIFAL is disabled for current calculations. Keep this module browser-safe. */
export const DIFAL_VERSION = 'DIFAL_ESTIMATE_V6';
/** Historical interstate CPF rule, retained only to reproduce frozen estimates. */
export const DIFAL_CPF_ONLY_VERSION = 'DIFAL_ESTIMATE_V5';
/** Historical CPF/CNPJ rule, retained only to validate immutable snapshots. */
export const DIFAL_CPF_CNPJ_VERSION = 'DIFAL_ESTIMATE_V4';
export const DIFAL_CATALOG_VERSION = 'DIFAL_ESTIMATE_V3';
export const DIFAL_PREVIOUS_VERSION = 'DIFAL_ESTIMATE_V2';
export const DIFAL_LEGACY_VERSION = 'DIFAL_ESTIMATE_V1';
export type DifalVersion = typeof DIFAL_VERSION | typeof DIFAL_CPF_ONLY_VERSION | typeof DIFAL_CPF_CNPJ_VERSION | typeof DIFAL_CATALOG_VERSION | typeof DIFAL_PREVIOUS_VERSION | typeof DIFAL_LEGACY_VERSION;
export type DifalOrigin = 'IMPORTED' | 'DERIVED_FROM_SNAPSHOT' | 'UNAVAILABLE';
export function isDifalVersion(value: unknown): value is DifalVersion {
  return value === DIFAL_VERSION || value === DIFAL_CPF_ONLY_VERSION || value === DIFAL_CPF_CNPJ_VERSION || value === DIFAL_CATALOG_VERSION || value === DIFAL_PREVIOUS_VERSION || value === DIFAL_LEGACY_VERSION;
}
export const DIFAL_RATE_PERCENT = 10;
/** Explicit conservative sale-purpose configuration; an initial 6 alone is never sufficient. */
const LEGACY_CFOPS = ['6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108'] as const;
// Questor also exports merchandise sales as 5102 with buyers in other UFs.
// Actual stored UFs, not the first CFOP digit, decide interstate eligibility.
export const DIFAL_ELIGIBLE_CFOPS = ['5102', ...LEGACY_CFOPS] as const;
function eligibleNature(code: string, version: DifalVersion): boolean {
  if (!isDifalVersion(version)) throw new TypeError('Versão do DIFAL desconhecida.');
  if (version === DIFAL_VERSION || version === DIFAL_CPF_ONLY_VERSION || version === DIFAL_CPF_CNPJ_VERSION || version === DIFAL_CATALOG_VERSION) return classifyOperationNature(code) === 'VENDA';
  return (version === DIFAL_LEGACY_VERSION ? LEGACY_CFOPS : DIFAL_ELIGIBLE_CFOPS).some(value => value === code);
}
export const BRAZIL_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const;
export function normalizeUf(value: unknown): string {
  const uf = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return BRAZIL_UFS.includes(uf as typeof BRAZIL_UFS[number]) ? uf : '';
}
export type SalesOperation = 'VENDA' | 'SERVICO' | 'DEVOLUCAO' | 'OUTRAS';
const SALES_RETURN_CFOPS = new Set(['5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556','5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413','6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556']);
const SALES_OTHER_CFOPS = new Set(['5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930']);
const SALES_SERVICE_CFOPS = new Set(['9000']);
export const normalizeNatureCode = normalizeOperationNature;
function normalizedOperationText(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function salesOperation(natureCode: unknown, description: unknown, configuredSales = true, version: DifalVersion = DIFAL_VERSION): SalesOperation {
  const code = normalizeNatureCode(natureCode);
  if (version === DIFAL_VERSION || version === DIFAL_CPF_ONLY_VERSION || version === DIFAL_CPF_CNPJ_VERSION || version === DIFAL_CATALOG_VERSION) {
    const operation = classifyOperationNature(code);
    return operation === 'VENDA' ? 'VENDA' : operation === 'SERVICO_VENDA' ? 'SERVICO' : operation === 'DEVOLUCAO_COMPRA' ? 'DEVOLUCAO' : 'OUTRAS';
  }
  if (SALES_SERVICE_CFOPS.has(code)) return 'SERVICO';
  if (SALES_OTHER_CFOPS.has(code)) return 'OUTRAS';
  if (SALES_RETURN_CFOPS.has(code)) return 'DEVOLUCAO';
  const text = normalizedOperationText(description);
  if (text.includes('devolucao')) return 'DEVOLUCAO';
  if (text.includes('servico') || text.includes('prestacao')) return 'SERVICO';
  const purpose = String(description ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (configuredSales && /^(?:remessa|transferencia|bonificacao|doacao|brinde|amostra|conserto|consignacao)(?:\s|$)/.test(purpose)) return 'OUTRAS';
  if (configuredSales && eligibleNature(code, version)) return 'VENDA';
  if (text.includes('venda') || text.includes('faturamento')) return 'VENDA';
  return 'OUTRAS';
}

export type DifalReason = 'OUTGOING_DISABLED' | 'ELIGIBLE' | 'NOT_SALE' | 'INELIGIBLE_NATURE' | 'NOT_CPF' | 'NOT_CPF_OR_CNPJ' | 'MISSING_ISSUER_UF' | 'MISSING_RECIPIENT_UF' | 'SAME_UF' | 'INVALID_TOTAL';
export type DifalResult = {eligible: boolean; baseCents: number; amountCents: number; reason: DifalReason};
export type DifalInput = {totalCents: unknown; natureCode?: unknown; description?: unknown; operation?: unknown; document?: unknown; issuerUf?: unknown; recipientUf?: unknown};
export function calculateDifal(input: DifalInput, version: DifalVersion = DIFAL_VERSION): DifalResult {
  if (!isDifalVersion(version)) throw new TypeError('Versão do DIFAL desconhecida.');
  const rejected = (reason: DifalReason): DifalResult => ({eligible: false, baseCents: 0, amountCents: 0, reason});
  if (typeof input.totalCents !== 'number' || !Number.isSafeInteger(input.totalCents) || input.totalCents < 0) return rejected('INVALID_TOTAL');
  if (version === DIFAL_VERSION) return rejected('OUTGOING_DISABLED');
  if (salesOperation(input.natureCode, input.description, true, version) !== 'VENDA' || (input.operation !== undefined && input.operation !== 'VENDA')) return rejected('NOT_SALE');
  if (!eligibleNature(normalizeNatureCode(input.natureCode), version)) return rejected('INELIGIBLE_NATURE');
  const document = String(input.document ?? '').trim().replace(/[.\/\-\s]/g, '');
  // Follow the application's document identification contract; CPF is never sent to the CNPJ provider.
  if (!/^\d{11}$/.test(document) && (version !== DIFAL_CPF_CNPJ_VERSION || !normalizeCnpj(input.document).valid))
    return rejected(version === DIFAL_CPF_CNPJ_VERSION ? 'NOT_CPF_OR_CNPJ' : 'NOT_CPF');
  const issuerUf = normalizeUf(input.issuerUf), recipientUf = normalizeUf(input.recipientUf);
  if (!issuerUf) return rejected('MISSING_ISSUER_UF');
  if (!recipientUf) return rejected('MISSING_RECIPIENT_UF');
  if (issuerUf === recipientUf) return rejected('SAME_UF');
  // Integer half-up rounding per sale avoids floating-point ties and duplicate tax application.
  const amountCents = Number((BigInt(input.totalCents) + 5n) / 10n);
  return {eligible: true, baseCents: input.totalCents, amountCents, reason: 'ELIGIBLE'};
}
export function isPendingDifal(result: Pick<DifalResult, 'reason'>): boolean {
  return result.reason === 'MISSING_ISSUER_UF' || result.reason === 'MISSING_RECIPIENT_UF';
}
export type DifalSummary = {version: DifalVersion; ratePercent: typeof DIFAL_RATE_PERCENT; issuerUf: string; eligibleLines: number; baseCents: number; amountCents: number; pendingLines: number};
export function summarizeDifal(rows: Iterable<Omit<DifalInput, 'issuerUf'>>, issuerUf: unknown, version: DifalVersion = DIFAL_VERSION): DifalSummary {
  if (!isDifalVersion(version)) throw new TypeError('Versão do DIFAL desconhecida.');
  const summary: DifalSummary = {version, ratePercent: DIFAL_RATE_PERCENT, issuerUf: normalizeUf(issuerUf), eligibleLines: 0, baseCents: 0, amountCents: 0, pendingLines: 0};
  for (const row of rows) {
    const result = calculateDifal({...row, issuerUf}, version);
    summary.eligibleLines += Number(result.eligible);
    summary.pendingLines += Number(isPendingDifal(result));
    summary.baseCents += result.baseCents;
    summary.amountCents += result.amountCents;
    if (!Number.isSafeInteger(summary.baseCents) || !Number.isSafeInteger(summary.amountCents)) throw new RangeError('Soma DIFAL acima do limite seguro.');
  }
  return summary;
}
