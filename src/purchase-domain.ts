import { normalizeCnpj, csvEncode } from './domain.ts';
import { documentKind } from './lookup-domain.ts';
import { need } from './security.ts';

export const PURCHASE_MODE = 'PURCHASES_V1';
export const SALES_MODE = 'SALES_V1';
export type FinancialMode = typeof PURCHASE_MODE | typeof SALES_MODE;
export function isFinancialMode(mode: unknown): mode is FinancialMode { return mode === PURCHASE_MODE || mode === SALES_MODE; }
export function financialKind(mode: FinancialMode): 'FORNECEDOR' | 'CLIENTE' { return mode === SALES_MODE ? 'CLIENTE' : 'FORNECEDOR'; }
export function financialLabel(mode: FinancialMode) { return mode === SALES_MODE ? 'vendas' : 'compras'; }
/** Managerial grouping never overwrites the provider's original status. */
export function financialReportingStatus(row: {valid?: boolean; documentKind?: string; status?: unknown}, mode: FinancialMode = PURCHASE_MODE) {
  if (mode === SALES_MODE && row.documentKind === 'CPF') return 'CPF';
  return row.valid === true && row.documentKind === 'CNPJ' && row.status === 'OPTANTE' ? 'OPTANTE' : 'NAO_OPTANTE';
}
export const PURCHASE_STATUSES = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'] as const;
export const PURCHASE_CALCULATION_VERSION = 'NET_V2';
export const COMPONENT_FIELDS = ['grossCents', 'discountCents', 'accessoryCents', 'freightCents', 'abatementCents'] as const;
export type PurchaseComponents = Record<typeof COMPONENT_FIELDS[number], number> & {totalCents: number};
export type SalesOperation = 'VENDA' | 'SERVICO' | 'DEVOLUCAO' | 'OUTRAS';
const SALES_RETURN_CFOPS = new Set(['5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556','5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413','6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556']);
const SALES_OTHER_CFOPS = new Set(['5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930']);
const SALES_SERVICE_CFOPS = new Set(['9000']);
export function normalizeNatureCode(value: unknown): string { return String(value ?? '').replace(/\D/g, '').slice(0, 4); }
function normalizedOperationText(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function salesOperation(natureCode: unknown, description: unknown): SalesOperation {
  const code = normalizeNatureCode(natureCode);
  if (SALES_SERVICE_CFOPS.has(code)) return 'SERVICO';
  if (SALES_OTHER_CFOPS.has(code)) return 'OUTRAS';
  if (SALES_RETURN_CFOPS.has(code)) return 'DEVOLUCAO';
  const text = normalizedOperationText(description);
  if (text.includes('devolucao')) return 'DEVOLUCAO';
  if (text.includes('servico') || text.includes('prestacao')) return 'SERVICO';
  if (text.includes('venda') || text.includes('faturamento')) return 'VENDA';
  return 'OUTRAS';
}
export type PurchaseCalculationVersion = 'NET_V2' | 'Q_V1';
export function calculationVersion(job: any): PurchaseCalculationVersion {
  need(job.calculationVersion === undefined || ['NET_V2', 'Q_V1'].includes(job.calculationVersion), 'Versão de cálculo desconhecida.', 409, 'PURCHASE_VERSION');
  need(job.mode !== SALES_MODE || job.calculationVersion === 'NET_V2', 'Relatório de vendas requer a fórmula Q - Y + AA - AB.', 409, 'PURCHASE_VERSION');
  return job.calculationVersion || 'Q_V1';
}
export function purchaseFormula(version: PurchaseCalculationVersion) { return version === 'NET_V2' ? 'Q - Y + AA - AB' : 'Q'; }
export const MAX_LINE_CENTS = 100_000_000_000;
export type ReportPeriod = {startDate: string; endDate: string; startMonth: string; endMonth: string; months: number; observedMonths: number; missingMonths: string[]};
function canonicalFiscalDate(value: unknown) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Data Escrituração/Serviço (H) inválida.');
  const [year, month, day] = value.split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day));
  need(year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    'Data Escrituração/Serviço (H) inválida.');
  return value;
}
export function reportPeriod(values: unknown[]): ReportPeriod {
  need(values.length > 0, 'O relatório não possui datas na coluna H.');
  const dates = values.map(canonicalFiscalDate).sort();
  const startDate = dates[0], endDate = dates[dates.length - 1], [sy, sm] = startDate.split('-').map(Number), [ey, em] = endDate.split('-').map(Number);
  const months = (ey - sy) * 12 + em - sm + 1;
  need(months >= 1 && months <= 12, `O relatório cobre ${months} meses pela coluna H. Use um período entre 1 e 12 meses.`);
  const observed = new Set(dates.map(value => value.slice(0, 7))), missingMonths: string[] = [];
  for (let index = 0; index < months; index++) {
    const absolute = sy * 12 + (sm - 1) + index, year = Math.floor(absolute / 12), month = absolute % 12 + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!observed.has(key)) missingMonths.push(key);
  }
  return {startDate, endDate, startMonth: startDate.slice(0, 7), endMonth: endDate.slice(0, 7), months, observedMonths: observed.size, missingMonths};
}
export function sameReportPeriod(left: any, right: any) {
  return !!left && !!right && left.startDate === right.startDate && left.endDate === right.endDate && left.months === right.months;
}
export type PurchaseLine = Partial<Omit<PurchaseComponents, 'totalCents'>> & {
  document: string; documentKind: string; cnpj: string; name: string; serviceDate: string | null; quantity: string;
  totalCents: number; balanceCents?: number; natureCode?: string; description?: string; operation?: SalesOperation; valid: boolean; kind: 'FORNECEDOR' | 'CLIENTE'; uf: ''; reason: string | null; documentHint: string;
};
/** Browser parsing is only a convenience: the server validates the reduced financial payload. */
export function compactPurchaseLine(input: any, version: PurchaseCalculationVersion = PURCHASE_CALCULATION_VERSION, mode: FinancialMode = PURCHASE_MODE): PurchaseLine {
  need(isFinancialMode(mode), 'Tipo de relatório inválido.');
  need(mode !== SALES_MODE || version === 'NET_V2', 'Relatório de vendas requer a fórmula Q - Y + AA - AB.', 409, 'PURCHASE_VERSION');
  need(input && typeof input === 'object' && !Array.isArray(input), 'Linha financeira inválida.');
  need(typeof input.document === 'string' && input.document.length <= 40, 'Documento deve ser texto de até 40 caracteres.');
  need(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200, 'Razão social obrigatória, até 200 caracteres.');
  const serviceDate = version === 'NET_V2' ? canonicalFiscalDate(input.serviceDate) : null;
  const inputQuantity = mode === SALES_MODE && (input.quantity === undefined || input.quantity === null || input.quantity === '') ? '0' : input.quantity;
  need(typeof inputQuantity === 'string' && /^\d{1,9}(?:\.\d{1,6})?$/.test(inputQuantity), 'Quantidade P inválida. Envie decimal sem separador de milhar, com até 6 casas.');
  need(typeof input.totalCents === 'number' && Number.isSafeInteger(input.totalCents) && input.totalCents >= 0 && input.totalCents <= MAX_LINE_CENTS, `${version === 'NET_V2' ? 'Total calculado' : 'Valor Q'} inválido. Envie centavos inteiros não negativos.`);
  const components: Partial<PurchaseComponents> = {};
  if (version === 'NET_V2') {
    for (const field of COMPONENT_FIELDS) {
      need(typeof input[field] === 'number' && Number.isSafeInteger(input[field]) && input[field] >= 0 && input[field] <= MAX_LINE_CENTS,
        `Componente ${field} inválido. Envie centavos inteiros não negativos.`);
      components[field] = input[field];
    }
    const calculated = input.grossCents - input.discountCents + input.freightCents - input.abatementCents;
    need(calculated >= 0, 'Q - Y + AA - AB resulta em total negativo. Revise os valores da linha.');
    need(calculated === input.totalCents, 'Total divergente da fórmula Q - Y + AA - AB. A despesa Z não entra no cálculo.');
  }
  const salesFields: Partial<PurchaseLine> = {};
  if (mode === SALES_MODE) {
    const rawNatureCode = String(input.natureCode ?? '').trim(), natureCode = normalizeNatureCode(rawNatureCode), description = String(input.description ?? '').trim();
    need(rawNatureCode.length <= 80 && description.length <= 2000, 'Natureza/descrição acima do limite.');
    const operation = salesOperation(natureCode, description);
    const balanceCents = operation === 'DEVOLUCAO' ? -input.totalCents : input.totalCents;
    need(Number.isSafeInteger(balanceCents) && Math.abs(balanceCents) <= MAX_LINE_CENTS, 'Saldo da operação inválido.');
    Object.assign(salesFields, {natureCode, description, operation, balanceCents});
  }
  const document = input.document.trim().replace(/[.\/\-\s]/g, '').toUpperCase();
  const checked = normalizeCnpj(document), type = documentKind(document);
  const quantity = inputQuantity.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return { document, documentKind: type, cnpj: checked.valid ? checked.cnpj : '', name: input.name.trim(), serviceDate, quantity,
    ...components, totalCents: input.totalCents, ...salesFields, valid: checked.valid, kind: financialKind(mode), uf: '', reason: checked.valid ? null : type,
    documentHint: checked.valid ? checked.cnpj : type === 'CPF' ? 'CPF — não consultado' : 'Documento não consultável — revisar na origem' };
}
export function exactCents(value: unknown): number {
  need(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'Soma monetária inconsistente.', 409, 'PURCHASE_TOTAL');
  return value;
}
export function exactSignedCents(value: unknown): number {
  need(typeof value === 'number' && Number.isSafeInteger(value), 'Saldo monetário inconsistente.', 409, 'PURCHASE_TOTAL');
  return value;
}
export function percentage(value: number, denominator: number): number {
  if (!denominator) return 0;
  // Integer half-up rounding avoids binary floating-point ties (e.g. 25.025%).
  const numerator = BigInt(value) * 10000n, base = BigInt(denominator);
  return Number((numerator * 2n + base) / (base * 2n)) / 100;
}
/** Largest-remainder apportionment keeps three rounded sales percentages at exactly 100%. */
export function reconciledPercentages(values: number[], denominator: number): number[] {
  need(values.every(value => Number.isSafeInteger(value) && value >= 0) && exactCents(values.reduce((sum, value) => sum + value, 0)) === exactCents(denominator),
    'Grupos financeiros divergentes do total.', 409, 'PURCHASE_TOTAL');
  if (!denominator) return values.map(() => 0);
  const base = BigInt(denominator);
  const parts = values.map((value, index) => ({index, units: Number(BigInt(value) * 10000n / base), remainder: BigInt(value) * 10000n % base}));
  const remaining = 10000 - parts.reduce((sum, part) => sum + part.units, 0);
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) ranked[index].units++;
  return parts.map(part => part.units / 100);
}
export function moneyText(cents: number): string {
  need(typeof cents === 'number' && Number.isSafeInteger(cents), 'Valor monetário inconsistente.', 409, 'PURCHASE_TOTAL');
  const sign = cents < 0 ? '-' : '', value = Math.abs(cents);
  return `${sign}${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
}
export function purchaseCsv(job: any, rows: any[]): string {
  const version = calculationVersion(job), net = version === 'NET_V2', sales = job.mode === SALES_MODE;
  return csvEncode([
    ['Código da empresa', 'Empresa', 'Consulta', 'Arquivo', 'Conclusão', 'Linha importada', 'Data Escrituração/Serviço (H)', sales ? 'Documento do comprador (A)' : 'Documento do fornecedor (A)', 'Tipo de documento', sales ? 'Comprador (I)' : 'Razão social informada (I)', 'Natureza / CFOP', 'Descrição da operação', 'Operação', sales ? 'Quantidade (P) — opcional' : 'Quantidade (P)', 'Valor bruto Q (R$)', 'Desconto Y (R$)', 'Despesa acessória Z — informativa (R$)', 'Frete AA (R$)', 'Abatimento AB (R$)', 'Total calculado (R$)', 'Saldo da operação (R$)', 'Fórmula', 'Versão do cálculo', 'Grupo gerencial', 'Situação Simples na fonte', 'Data da consulta', 'Fonte'],
    ...rows.map(row => [job.clientCode || '', job.clientName, job._id, job.fileName, job.completedAt?.toISOString?.() || job.completedAt || '', row.index + 1, row.serviceDate || '',
      row.document, row.documentKind, row.name, row.natureCode || '', row.description || '', row.operation || '', row.quantity, moneyText(net ? row.grossCents : row.totalCents),
      ...['discountCents', 'accessoryCents', 'freightCents', 'abatementCents'].map(field => net ? moneyText(row[field]) : ''),
      moneyText(row.totalCents), moneyText(row.balanceCents ?? row.totalCents), purchaseFormula(version), version, financialReportingStatus(row, sales ? SALES_MODE : PURCHASE_MODE), row.status,
      row.checkedAt?.toISOString?.() || row.checkedAt || '', row.documentKind === 'CNPJ' ? 'Minha Receita' : 'Não consultado'])
  ]);
}
