/** Estimated managerial DIFAL, not a legal rate lookup. Keep this module browser-safe. */
export const DIFAL_VERSION = 'DIFAL_ESTIMATE_V1';
export const DIFAL_RATE_PERCENT = 10;
/** Explicit conservative sale-purpose configuration; an initial 6 alone is never sufficient. */
export const DIFAL_ELIGIBLE_CFOPS = ['6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108'] as const;
export const BRAZIL_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const;
export function normalizeUf(value: unknown): string {
  const uf = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return BRAZIL_UFS.includes(uf as typeof BRAZIL_UFS[number]) ? uf : '';
}
export type SalesOperation = 'VENDA' | 'SERVICO' | 'DEVOLUCAO' | 'OUTRAS';
const SALES_RETURN_CFOPS = new Set(['5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556','5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413','6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556']);
const SALES_OTHER_CFOPS = new Set(['5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930']);
const SALES_SERVICE_CFOPS = new Set(['9000']);
export function normalizeNatureCode(value: unknown): string { return String(value ?? '').replace(/\D/g, '').slice(0, 4); }
function normalizedOperationText(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function salesOperation(natureCode: unknown, description: unknown, configuredSales = true): SalesOperation {
  const code = normalizeNatureCode(natureCode);
  if (SALES_SERVICE_CFOPS.has(code)) return 'SERVICO';
  if (SALES_OTHER_CFOPS.has(code)) return 'OUTRAS';
  if (SALES_RETURN_CFOPS.has(code)) return 'DEVOLUCAO';
  const text = normalizedOperationText(description);
  if (text.includes('devolucao')) return 'DEVOLUCAO';
  if (text.includes('servico') || text.includes('prestacao')) return 'SERVICO';
  const purpose = String(description ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (configuredSales && /^(?:remessa|transferencia|bonificacao|doacao|brinde|amostra|conserto|consignacao)(?:\s|$)/.test(purpose)) return 'OUTRAS';
  if (configuredSales && DIFAL_ELIGIBLE_CFOPS.includes(code as typeof DIFAL_ELIGIBLE_CFOPS[number])) return 'VENDA';
  if (text.includes('venda') || text.includes('faturamento')) return 'VENDA';
  return 'OUTRAS';
}

export type DifalReason = 'ELIGIBLE' | 'NOT_SALE' | 'INELIGIBLE_NATURE' | 'NOT_CPF' | 'MISSING_ISSUER_UF' | 'MISSING_RECIPIENT_UF' | 'SAME_UF' | 'INVALID_TOTAL';
export type DifalResult = {eligible: boolean; baseCents: number; amountCents: number; reason: DifalReason};
export type DifalInput = {totalCents: unknown; natureCode?: unknown; description?: unknown; operation?: unknown; document?: unknown; issuerUf?: unknown; recipientUf?: unknown};
export function calculateDifal(input: DifalInput): DifalResult {
  const rejected = (reason: DifalReason): DifalResult => ({eligible: false, baseCents: 0, amountCents: 0, reason});
  if (typeof input.totalCents !== 'number' || !Number.isSafeInteger(input.totalCents) || input.totalCents < 0) return rejected('INVALID_TOTAL');
  if (salesOperation(input.natureCode, input.description) !== 'VENDA' || (input.operation !== undefined && input.operation !== 'VENDA')) return rejected('NOT_SALE');
  if (!DIFAL_ELIGIBLE_CFOPS.includes(normalizeNatureCode(input.natureCode) as typeof DIFAL_ELIGIBLE_CFOPS[number])) return rejected('INELIGIBLE_NATURE');
  const document = String(input.document ?? '').trim().replace(/[.\/\-\s]/g, '');
  // Follow the application's document identification contract; CPF is never sent to the CNPJ provider.
  if (!/^\d{11}$/.test(document)) return rejected('NOT_CPF');
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
export type DifalSummary = {version: typeof DIFAL_VERSION; ratePercent: typeof DIFAL_RATE_PERCENT; issuerUf: string; eligibleLines: number; baseCents: number; amountCents: number; pendingLines: number};
export function summarizeDifal(rows: Iterable<Omit<DifalInput, 'issuerUf'>>, issuerUf: unknown): DifalSummary {
  const summary: DifalSummary = {version: DIFAL_VERSION, ratePercent: DIFAL_RATE_PERCENT, issuerUf: normalizeUf(issuerUf), eligibleLines: 0, baseCents: 0, amountCents: 0, pendingLines: 0};
  for (const row of rows) {
    const result = calculateDifal({...row, issuerUf});
    summary.eligibleLines += Number(result.eligible);
    summary.pendingLines += Number(isPendingDifal(result));
    summary.baseCents += result.baseCents;
    summary.amountCents += result.amountCents;
    if (!Number.isSafeInteger(summary.baseCents) || !Number.isSafeInteger(summary.amountCents)) throw new RangeError('Soma DIFAL acima do limite seguro.');
  }
  return summary;
}
