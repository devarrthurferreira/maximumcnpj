/** Shared by Node and the browser. Money in this module is always integer cents. */
export const PROJECTION_VERSION = 'AVERAGE_X12_V2';
export const DIFAL_PROJECTION_VERSION = 'DIFAL_DRE_V1';
export const PROJECTION_MONTHS = 12;
export const REPORT_GROUPS = Object.freeze([
  'salesOptantCents', 'salesNonOptantCents', 'salesCpfCents',
  'purchasesOptantCents', 'purchasesNonOptantCents'
]);
const SIDES = [REPORT_GROUPS.slice(0, 3), REPORT_GROUPS.slice(3)];
function cents(value, signed = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new TypeError(signed ? 'A projeção exige centavos inteiros válidos.' : 'A projeção exige valores não negativos em centavos inteiros.');
  }
  return value;
}
function safeBigInt(value) {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > limit || value < -limit) throw new RangeError('Valor da projeção acima do limite seguro.');
  return Number(value);
}
function sum(values, signed = false) { return safeBigInt(values.reduce((total, value) => total + BigInt(cents(value, signed)), 0n)); }
function annual(monthly, signed = false) { return safeBigInt(BigInt(cents(monthly, signed)) * BigInt(PROJECTION_MONTHS)); }
function roundedDivision(value, divisor) {
  const negative = value < 0n, absolute = negative ? -value : value;
  const rounded = (2n * absolute + divisor) / (2n * divisor);
  return negative ? -rounded : rounded;
}
function floorDivision(value, divisor) {
  let whole = value / divisor, remainder = value % divisor;
  if (remainder < 0n) { whole -= 1n; remainder += divisor; }
  return {whole, remainder};
}
function months(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new RangeError('Informe de 1 a 12 competências para calcular a média mensal.');
  }
  return value;
}
function allocate(values, divisor, target = null) {
  const parts = values.map((value, index) => ({index, ...floorDivision(BigInt(value), divisor)}));
  const roundedTotal = target ?? roundedDivision(values.reduce((total, value) => total + BigInt(value), 0n), divisor);
  const remainder = Number(roundedTotal - parts.reduce((subtotal, part) => subtotal + part.whole, 0n));
  if (!Number.isInteger(remainder) || remainder < 0 || remainder > parts.length) throw new RangeError('Não foi possível reconciliar a média mensal dos relatórios.');
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remainder; i++) ranked[i].whole++;
  return parts.map(part => part.whole);
}
/** Rounded total and group totals reconcile exactly, including recurring fractional cents. */
export function annualizeReports(fields, reportMonths) {
  months(reportMonths);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('Totais dos relatórios ausentes.');
  const split = Object.hasOwn(fields, 'serviceRevenueCents');
  if (split) cents(fields.serviceRevenueCents);
  const income = split ? [...SIDES[0], 'serviceRevenueCents'] : SIDES[0];
  const sides = [income, SIDES[1]], keysInReport = split ? [...REPORT_GROUPS, 'serviceRevenueCents'] : REPORT_GROUPS;
  const divisor = BigInt(reportMonths), monthlyGroupsCents = {}, annualGroupsCents = {};
  for (const [sideIndex, keys] of sides.entries()) {
    const signed = sideIndex === 0, values = keys.map(key => cents(fields[key], signed)), total = BigInt(sum(values, signed));
    if (signed && total < 0n) throw new RangeError('O saldo líquido total de vendas não pode ser negativo após as devoluções.');
    let parts;
    if (signed && split) {
      const goods = sum(values.slice(0, 3), true);
      if (goods < 0) throw new RangeError('O saldo líquido de mercadorias não pode ser negativo após separar os serviços.');
      // Allocate the income total to its two nonnegative activities first. Otherwise a
      // service rounding cent could leave offsetting goods/return groups below zero.
      const activities = allocate([goods, values[3]], divisor);
      parts = [...allocate(values.slice(0, 3), divisor, activities[0]), activities[1]];
    } else parts = allocate(values, divisor);
    keys.forEach((key, i) => {
      monthlyGroupsCents[key] = safeBigInt(parts[i]);
      annualGroupsCents[key] = annual(monthlyGroupsCents[key], signed);
    });
  }
  const groups = keysInReport.map(key => ({key, totalCents: fields[key], monthlyCents: monthlyGroupsCents[key], annualCents: annualGroupsCents[key]}));
  const totals = Object.fromEntries(sides.map((keys, i) => [i ? 'purchases' : 'sales', {
    totalCents: sum(keys.map(key => fields[key]), i === 0),
    monthlyCents: sum(keys.map(key => monthlyGroupsCents[key]), i === 0),
    annualCents: sum(keys.map(key => annualGroupsCents[key]), i === 0)
  }]));
  return {version: split ? PROJECTION_VERSION : 'AVERAGE_X12_V1', method: 'TOTAL_DIVIDED_BY_MONTHS_TIMES_12', unit: 'CENTS', reportMonths,
    projectionMonths: PROJECTION_MONTHS, rounding: split ? 'MONTHLY_CENTS_ACTIVITY_THEN_GROUP_LARGEST_REMAINDER' : 'MONTHLY_CENTS_LARGEST_REMAINDER',
    monthlyGroupsCents, annualGroupsCents, groups, totals,
    timeline: Array.from({length: PROJECTION_MONTHS}, (_, i) => ({month: i + 1,
      salesCents: totals.sales.monthlyCents, purchasesCents: totals.purchases.monthlyCents}))};
}
/** The source is the reconciled per-line estimate. Never derive eligibility from edited monthly sales. */
export function projectDifal(summary, reportMonths, sourceJobId) {
  if (summary == null) return null;
  months(reportMonths);
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) || !['DIFAL_ESTIMATE_V1','DIFAL_ESTIMATE_V2','DIFAL_ESTIMATE_V3'].includes(summary.version) || summary.ratePercent !== 10 ||
      typeof sourceJobId !== 'string' || !sourceJobId || typeof summary.issuerUf !== 'string') throw new TypeError('Referência do DIFAL inválida.');
  for (const key of ['amountCents', 'baseCents', 'pendingLines', 'eligibleLines']) cents(summary[key]);
  const monthlyCents = safeBigInt(roundedDivision(BigInt(summary.amountCents), BigInt(reportMonths)));
  return {version: DIFAL_PROJECTION_VERSION, sourceJobId, sourceVersion: summary.version,
    sourceAmountCents: summary.amountCents, sourceBaseCents: summary.baseCents, reportMonths,
    ratePercent: summary.ratePercent, pendingLines: summary.pendingLines, eligibleLines: summary.eligibleLines,
    issuerUf: summary.issuerUf, monthlyCents, annualCents: annual(monthlyCents)};
}
/** Manually entered amounts are monthly BRL, not totals for the imported period. RBT12 is never annualized. */
export function projectScenario(monthlyGroups, values) {
  const brl = (value, signed = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0) || value !== Math.round(value * 100) / 100) {
      throw new TypeError('Preencha os valores mensais com no máximo duas casas decimais.');
    }
    return cents(Math.round(value * 100), signed);
  };
  if (!monthlyGroups || !values) throw new TypeError('Valores mensais ausentes.');
  const monthlyGroupsCents = Object.fromEntries(REPORT_GROUPS.map((key, index) => [key, brl(monthlyGroups[key], index < 3)]));
  const salesCents = sum(SIDES[0].map(key => monthlyGroupsCents[key]), true);
  if (salesCents < 0) throw new RangeError('O saldo líquido mensal de vendas não pode ser negativo após as devoluções.');
  const purchasesCents = sum(SIDES[1].map(key => monthlyGroupsCents[key]));
  const servicesCents = brl(values.serviceRevenue);
  const expensesCents = sum(['salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses'].map(key => brl(values[key])));
  const monthly = {salesCents, servicesCents, revenueCents: sum([salesCents, servicesCents]), purchasesCents, expensesCents};
  return {unit: 'CENTS', projectionMonths: PROJECTION_MONTHS, monthlyGroupsCents,
    annualGroupsCents: Object.fromEntries(REPORT_GROUPS.map((key, index) => [key, annual(monthlyGroupsCents[key], index < 3)])),
    monthly, annual: Object.fromEntries(Object.entries(monthly).map(([key, value]) => [key, annual(value)]))};
}
