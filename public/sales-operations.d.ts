export const SALES_OPERATION_VERSION: 'CFOP_BALANCE_V1';
export const SALES_OPERATION: Readonly<{REVENUE:'VENDA_SERVICO';RETURN:'DEVOLUCAO';OTHER:'OUTRAS'}>;
export const SALES_OPERATION_LABELS: Readonly<Record<'VENDA_SERVICO'|'DEVOLUCAO'|'OUTRAS', string>>;
export type SalesOperation = 'VENDA_SERVICO'|'DEVOLUCAO'|'OUTRAS';
export function salesCfop(value: unknown): string;
export function classifySalesOperation(natureCode: unknown, description: unknown): SalesOperation;
export function salesBalanceCents(totalCents: number, operation: SalesOperation): number;
