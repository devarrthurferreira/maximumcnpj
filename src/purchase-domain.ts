import { normalizeCnpj, csvEncode } from './domain.ts';
import { documentKind } from './lookup-domain.ts';
import { need } from './security.ts';

export const PURCHASE_MODE = 'PURCHASES_V1';
export const SALES_MODE = 'SALES_V1';
export type FinancialMode = typeof PURCHASE_MODE | typeof SALES_MODE;
export function isFinancialMode(mode: unknown): mode is FinancialMode { return mode === PURCHASE_MODE || mode === SALES_MODE; }
export function financialKind(mode: FinancialMode): 'FORNECEDOR' | 'CLIENTE' { return mode === SALES_MODE ? 'CLIENTE' : 'FORNECEDOR'; }
export function financialLabel(mode: FinancialMode) { return mode === SALES_MODE ? 'vendas' : 'compras'; }
export const PURCHASE_STATUSES = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'] as const;
export const PURCHASE_CALCULATION_VERSION = 'NET_V2';
export const COMPONENT_FIELDS = ['grossCents', 'discountCents', 'accessoryCents', 'freightCents', 'abatementCents'] as const;
export type PurchaseComponents = Record<typeof COMPONENT_FIELDS[number], number> & {totalCents: number};
export type PurchaseCalculationVersion = 'NET_V2' | 'Q_V1';
export function calculationVersion(job: any): PurchaseCalculationVersion {
  need(job.calculationVersion === undefined || ['NET_V2', 'Q_V1'].includes(job.calculationVersion), 'Versão de cálculo desconhecida.', 409, 'PURCHASE_VERSION');
  need(job.mode !== SALES_MODE || job.calculationVersion === 'NET_V2', 'Relatório de vendas requer a fórmula Q - Y + AA - AB.', 409, 'PURCHASE_VERSION');
  return job.calculationVersion || 'Q_V1';
}
export function purchaseFormula(version: PurchaseCalculationVersion) { return version === 'NET_V2' ? 'Q - Y + AA - AB' : 'Q'; }
export const MAX_LINE_CENTS = 100_000_000_000;
export type PurchaseLine = Partial<Omit<PurchaseComponents, 'totalCents'>> & {
  document: string; documentKind: string; cnpj: string; name: string; quantity: string;
  totalCents: number; valid: boolean; kind: 'FORNECEDOR' | 'CLIENTE'; uf: ''; reason: string | null; documentHint: string;
};
/** Browser parsing is only a convenience: the server validates the reduced financial payload. */
export function compactPurchaseLine(input: any, version: PurchaseCalculationVersion = PURCHASE_CALCULATION_VERSION, mode: FinancialMode = PURCHASE_MODE): PurchaseLine {
  need(isFinancialMode(mode), 'Tipo de relatório inválido.');
  need(mode !== SALES_MODE || version === 'NET_V2', 'Relatório de vendas requer a fórmula Q - Y + AA - AB.', 409, 'PURCHASE_VERSION');
  need(input && typeof input === 'object' && !Array.isArray(input), 'Linha financeira inválida.');
  need(typeof input.document === 'string' && input.document.length <= 40, 'Documento deve ser texto de até 40 caracteres.');
  need(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200, 'Razão social obrigatória, até 200 caracteres.');
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
  const document = input.document.trim().replace(/[.\/\-\s]/g, '').toUpperCase();
  const checked = normalizeCnpj(document), type = documentKind(document);
  const quantity = inputQuantity.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return { document, documentKind: type, cnpj: checked.valid ? checked.cnpj : '', name: input.name.trim(), quantity,
    ...components, totalCents: input.totalCents, valid: checked.valid, kind: financialKind(mode), uf: '', reason: checked.valid ? null : type,
    documentHint: checked.valid ? checked.cnpj : type === 'CPF' ? 'CPF — não consultado' : 'Documento não consultável — revisar na origem' };
}
export function exactCents(value: unknown): number {
  need(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'Soma monetária inconsistente.', 409, 'PURCHASE_TOTAL');
  return value;
}
export function percentage(value: number, denominator: number): number {
  if (!denominator) return 0;
  // Integer half-up rounding avoids binary floating-point ties (e.g. 25.025%).
  const numerator = BigInt(value) * 10000n, base = BigInt(denominator);
  return Number((numerator * 2n + base) / (base * 2n)) / 100;
}
export function moneyText(cents: number): string { return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`; }
export function purchaseCsv(job: any, rows: any[]): string {
  const version = calculationVersion(job), net = version === 'NET_V2', sales = job.mode === SALES_MODE;
  return csvEncode([
    ['Código da empresa', 'Empresa', 'Consulta', 'Arquivo', 'Conclusão', 'Linha importada', sales ? 'Documento do comprador (A)' : 'Documento do fornecedor (A)', 'Tipo de documento', sales ? 'Comprador (I)' : 'Razão social informada (I)', sales ? 'Quantidade (P) — opcional' : 'Quantidade (P)', 'Valor bruto Q (R$)', 'Desconto Y (R$)', 'Despesa acessória Z — informativa (R$)', 'Frete AA (R$)', 'Abatimento AB (R$)', 'Total calculado (R$)', 'Fórmula', 'Versão do cálculo', 'Grupo gerencial', 'Situação Simples na fonte', 'Data da consulta', 'Fonte'],
    ...rows.map(row => [job.clientCode || '', job.clientName, job._id, job.fileName, job.completedAt?.toISOString?.() || job.completedAt || '', row.index + 1,
      row.document, row.documentKind, row.name, row.quantity, moneyText(net ? row.grossCents : row.totalCents),
      ...['discountCents', 'accessoryCents', 'freightCents', 'abatementCents'].map(field => net ? moneyText(row[field]) : ''),
      moneyText(row.totalCents), purchaseFormula(version), version, row.status === 'NAO_CONFIRMADO' ? 'NAO_OPTANTE' : row.status, row.status,
      row.checkedAt?.toISOString?.() || row.checkedAt || '', row.documentKind === 'CNPJ' ? 'Minha Receita' : 'Não consultado'])
  ]);
}
