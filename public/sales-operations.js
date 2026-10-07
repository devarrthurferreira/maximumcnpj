// Shared sales-operation rule used by browser preview and server validation.
export const SALES_OPERATION_VERSION = 'CFOP_BALANCE_V1';
export const SALES_OPERATION = Object.freeze({
  REVENUE: 'VENDA_SERVICO',
  RETURN: 'DEVOLUCAO',
  OTHER: 'OUTRAS'
});
export const SALES_OPERATION_LABELS = Object.freeze({
  VENDA_SERVICO: 'Vendas e Serviços',
  DEVOLUCAO: 'Devoluções',
  OUTRAS: 'Outras'
});

// Explicit operation from the table supplied for this delivery always wins over wording.
const RETURN_CFOPS = new Set([
  '5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556',
  '5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413',
  '6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556'
]);
const OTHER_CFOPS = new Set([
  '5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930'
]);

const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function salesCfop(value) {
  const natureCode = String(value ?? '').trim();
  if (!/^\d{4,10}$/.test(natureCode)) throw new Error('Natureza/CFOP (L): informe um código numérico de 4 a 10 dígitos.');
  return natureCode.slice(0, 4);
}
export function classifySalesOperation(natureCode, description) {
  const cfop = salesCfop(natureCode);
  const text = normalized(description);
  if (OTHER_CFOPS.has(cfop)) return SALES_OPERATION.OTHER;
  if (RETURN_CFOPS.has(cfop)) return SALES_OPERATION.RETURN;
  if (/\bdevoluc(?:ao|oes)\b/.test(text)) return SALES_OPERATION.RETURN;
  if (/\b(?:vendas?|servicos?|prestacao)\b/.test(text)) return SALES_OPERATION.REVENUE;
  return SALES_OPERATION.OTHER;
}
export function salesBalanceCents(totalCents, operation) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || totalCents > 100_000_000_000) throw new Error('Valor de vendas inválido para o saldo.');
  if (operation === SALES_OPERATION.RETURN) return -totalCents;
  if (operation === SALES_OPERATION.REVENUE) return totalCents;
  if (operation === SALES_OPERATION.OTHER) return 0;
  throw new Error('Operação de vendas inválida.');
}
