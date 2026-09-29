import { normalizeCnpj, csvEncode } from './domain.ts';
import { documentKind } from './lookup-domain.ts';
import { need } from './security.ts';

export const PURCHASE_MODE = 'PURCHASES_V1';
export const PURCHASE_STATUSES = ['OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO'] as const;
export const MAX_LINE_CENTS = 100_000_000_000;
export type PurchaseLine = {
  document: string; documentKind: string; cnpj: string; name: string; quantity: string;
  totalCents: number; valid: boolean; kind: 'FORNECEDOR'; uf: ''; reason: string | null; documentHint: string;
};
/** Browser parsing is only a convenience: the server validates the reduced financial payload. */
export function compactPurchaseLine(input: any): PurchaseLine {
  need(input && typeof input === 'object' && !Array.isArray(input), 'Linha de compras inválida.');
  need(typeof input.document === 'string' && input.document.length <= 40, 'Documento deve ser texto de até 40 caracteres.');
  need(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200, 'Razão social obrigatória, até 200 caracteres.');
  need(typeof input.quantity === 'string' && /^\d{1,9}(?:\.\d{1,6})?$/.test(input.quantity), 'Quantidade P inválida. Envie decimal sem separador de milhar, com até 6 casas.');
  need(typeof input.totalCents === 'number' && Number.isSafeInteger(input.totalCents) && input.totalCents >= 0 && input.totalCents <= MAX_LINE_CENTS, 'Valor Q inválido. Envie centavos inteiros não negativos.');
  const document = input.document.trim().replace(/[.\/\-\s]/g, '').toUpperCase();
  const checked = normalizeCnpj(document), type = documentKind(document);
  const quantity = input.quantity.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return { document, documentKind: type, cnpj: checked.valid ? checked.cnpj : '', name: input.name.trim(), quantity,
    totalCents: input.totalCents, valid: checked.valid, kind: 'FORNECEDOR', uf: '', reason: checked.valid ? null : type,
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
  return csvEncode([
    ['Código da empresa', 'Empresa', 'Consulta', 'Arquivo', 'Conclusão', 'Linha importada', 'Documento', 'Tipo de documento', 'Razão social informada', 'Quantidade (P)', 'Valor total Q (R$)', 'Situação Simples', 'Data da consulta', 'Fonte'],
    ...rows.map(row => [job.clientCode || '', job.clientName, job._id, job.fileName, job.completedAt?.toISOString?.() || job.completedAt || '', row.index + 1,
      row.document, row.documentKind, row.name, row.quantity, moneyText(row.totalCents), row.status,
      row.checkedAt?.toISOString?.() || row.checkedAt || '', row.documentKind === 'CNPJ' ? 'Minha Receita' : 'Não consultado'])
  ]);
}
