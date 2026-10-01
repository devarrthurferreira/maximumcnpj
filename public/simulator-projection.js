/** Shared by Node and the browser. Money in this module is always integer cents. */
export const PROJECTION_VERSION = 'AVERAGE_X12_V1';
export const PROJECTION_MONTHS = 12;
export const REPORT_GROUPS = Object.freeze([
  'salesOptantCents', 'salesNonOptantCents', 'salesCpfCents',
  'purchasesOptantCents', 'purchasesNonOptantCents'
]);
const SIDES = [REPORT_GROUPS.slice(0, 3), REPORT_GROUPS.slice(3)];
function cents(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('A projeção exige valores não negativos em centavos inteiros.');
  }
  return value;
}
function safeBigInt(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Valor da projeção acima do limite seguro.');
  return Number(value);
}
function sum(values) { return safeBigInt(values.reduce((total, value) => total + BigInt(cents(value)), 0n)); }
function annual(monthly) { return safeBigInt(BigInt(cents(monthly)) * BigInt(PROJECTION_MONTHS)); }
function months(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new RangeError('Informe de 1 a 12 competências para calcular a média mensal.');
  }
  return value;
}
/** Rounded total and group totals reconcile exactly, including recurring fractional cents. */
export function annualizeReports(fields, reportMonths) {
  months(reportMonths);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('Totais dos relatórios ausentes.');
  const divisor = BigInt(reportMonths), monthlyGroupsCents = {}, annualGroupsCents = {};
  for (const keys of SIDES) {
    const values = keys.map(key => cents(fields[key])), total = BigInt(sum(values));
    const parts = values.map((value, index) => ({index, whole: BigInt(value) / divisor, remainder: BigInt(value) % divisor}));
    const roundedTotal = (2n * total + divisor) / (2n * divisor);
    const remainder = Number(roundedTotal - parts.reduce((total, part) => total + part.whole, 0n));
    const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; i < remainder; i++) ranked[i].whole++;
    keys.forEach((key, i) => {
      monthlyGroupsCents[key] = safeBigInt(parts[i].whole);
      annualGroupsCents[key] = annual(monthlyGroupsCents[key]);
    });
  }
  const groups = REPORT_GROUPS.map(key => ({key, totalCents: fields[key], monthlyCents: monthlyGroupsCents[key], annualCents: annualGroupsCents[key]}));
  const totals = Object.fromEntries(SIDES.map((keys, i) => [i ? 'purchases' : 'sales', {
    totalCents: sum(keys.map(key => fields[key])),
    monthlyCents: sum(keys.map(key => monthlyGroupsCents[key])),
    annualCents: sum(keys.map(key => annualGroupsCents[key]))
  }]));
  return {version: PROJECTION_VERSION, method: 'TOTAL_DIVIDED_BY_MONTHS_TIMES_12', unit: 'CENTS', reportMonths,
    projectionMonths: PROJECTION_MONTHS, rounding: 'MONTHLY_CENTS_LARGEST_REMAINDER',
    monthlyGroupsCents, annualGroupsCents, groups, totals,
    timeline: Array.from({length: PROJECTION_MONTHS}, (_, i) => ({month: i + 1,
      salesCents: totals.sales.monthlyCents, purchasesCents: totals.purchases.monthlyCents}))};
}
/** Manually entered amounts are monthly BRL, not totals for the imported period. RBT12 is never annualized. */
export function projectScenario(monthlyGroups, values) {
  const brl = value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value !== Math.round(value * 100) / 100) {
      throw new TypeError('Preencha os valores mensais com no máximo duas casas decimais.');
    }
    return cents(Math.round(value * 100));
  };
  if (!monthlyGroups || !values) throw new TypeError('Valores mensais ausentes.');
  const monthlyGroupsCents = Object.fromEntries(REPORT_GROUPS.map(key => [key, brl(monthlyGroups[key])]));
  const salesCents = sum(SIDES[0].map(key => monthlyGroupsCents[key]));
  const purchasesCents = sum(SIDES[1].map(key => monthlyGroupsCents[key]));
  const servicesCents = brl(values.serviceRevenue);
  const expensesCents = sum(['salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses'].map(key => brl(values[key])));
  const monthly = {salesCents, servicesCents, revenueCents: sum([salesCents, servicesCents]), purchasesCents, expensesCents};
  return {unit: 'CENTS', projectionMonths: PROJECTION_MONTHS, monthlyGroupsCents,
    annualGroupsCents: Object.fromEntries(REPORT_GROUPS.map(key => [key, annual(monthlyGroupsCents[key])])),
    monthly, annual: Object.fromEntries(Object.entries(monthly).map(([key, value]) => [key, annual(value)]))};
}
