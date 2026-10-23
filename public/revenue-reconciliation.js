/** A presentation bridge over reconciled, captured revenue. It never changes a tax input. */
export const REVENUE_RECONCILIATION_VERSION = 'REVENUE_RECONCILIATION_V1';
const INPUTS = ['grossSalesCents', 'serviceSalesCents', 'salesReturnsCents'];
const AMOUNTS = [...INPUTS, 'grossRevenueCents', 'revenueAfterReturnsCents'];
const SALES_FIELDS = ['salesOptantCents', 'salesNonOptantCents', 'salesCpfCents', 'serviceRevenueCents'];
const monthPattern = /^(?:19\d{2}|20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])$/;
const integer = value => typeof value === 'number' && Number.isSafeInteger(value);
const sum = values => {
  let result = 0;
  for (const value of values) {
    if (!integer(value) || !integer(result + value)) throw new TypeError('Valor de receita inconsistente.');
    result += value;
  }
  return result;
};
const monthIndex = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
const metadata = value => Object.fromEntries(['generationId', 'clientId', 'purchaseJobId', 'salesJobId']
  .filter(key => typeof value?.[key] === 'string').map(key => [key, value[key]]));

export function unavailableRevenueReconciliation(reason, data = {}, status = 'UNAVAILABLE') {
  return {version: REVENUE_RECONCILIATION_VERSION, status: status === 'PENDING' ? status : 'UNAVAILABLE',
    available: false, reason, ...metadata(data), monthly: []};
}

/** Input months must contain classified sales, services and returns from the matching purchases. */
export function reconcileRevenueMonths(rows, data = {}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 12) throw new TypeError('Competências da receita indisponíveis.');
  const monthly = rows.map(row => {
    if (!row || !monthPattern.test(row.sourceMonth || '') || !INPUTS.every(key => integer(row[key]) && row[key] >= 0)) {
      throw new TypeError('Evidência mensal de receita inconsistente.');
    }
    const values = Object.fromEntries(INPUTS.map(key => [key, row[key]]));
    const grossRevenueCents = sum([values.grossSalesCents, values.serviceSalesCents]);
    const revenueAfterReturnsCents = sum([grossRevenueCents, -values.salesReturnsCents]);
    if (row.grossRevenueCents !== undefined && row.grossRevenueCents !== grossRevenueCents ||
        row.revenueAfterReturnsCents !== undefined && row.revenueAfterReturnsCents !== revenueAfterReturnsCents) {
      throw new TypeError('O fechamento mensal diverge das suas origens.');
    }
    return {sourceMonth: row.sourceMonth, ...values, grossRevenueCents, revenueAfterReturnsCents};
  }).sort((a, b) => a.sourceMonth.localeCompare(b.sourceMonth));
  if (monthly.some((row, index) => index > 0 && monthIndex(row.sourceMonth) !== monthIndex(monthly[index - 1].sourceMonth) + 1)) {
    throw new TypeError('Competências duplicadas ou incompletas no fechamento.');
  }
  const values = Object.fromEntries(AMOUNTS.map(key => [key, sum(monthly.map(row => row[key]))]));
  return {version: REVENUE_RECONCILIATION_VERSION, status: 'AVAILABLE', available: true, reason: null,
    ...metadata(data), period: {startMonth: monthly[0].sourceMonth, endMonth: monthly.at(-1).sourceMonth, months: monthly.length},
    ...values, monthly};
}

function checkFields(fields, expected) {
  return fields && SALES_FIELDS.every(key => integer(fields[key])) &&
    sum(SALES_FIELDS.map(key => fields[key])) === expected;
}

/** Read frozen source evidence; an adjusted scenario is a separate bridge, never a second deduction. */
export function buildRevenueReconciliation({source, sourceMonth = null, scenarioRevenueCents = null} = {}) {
  const ids = {...metadata(source), purchaseJobId: source?.purchaseJobId ?? source?.purchases?.jobId,
    salesJobId: source?.salesJobId ?? source?.sales?.jobId};
  const unavailable = reason => unavailableRevenueReconciliation(reason, ids);
  if (!source || typeof source !== 'object') return unavailable('A versão salva não conserva o fechamento da receita de origem.');
  try {
    let result;
    const saved = source.version === REVENUE_RECONCILIATION_VERSION ? source : source.revenueReconciliation;
    if (saved) {
      if (saved.version !== REVENUE_RECONCILIATION_VERSION) return unavailable('Versão do fechamento de receita não reconhecida.');
      if (!saved.available || saved.status !== 'AVAILABLE') {
        return unavailableRevenueReconciliation(saved.reason || 'Fechamento da receita indisponível.', {...ids, ...metadata(saved)}, saved.status);
      }
      result = reconcileRevenueMonths(saved.monthly, {...ids, ...metadata(saved)});
      if (!AMOUNTS.every(key => saved[key] === result[key])) throw new TypeError('Total de receita divergente.');
    } else {
      const reports = source.monthlyReports;
      if (!Array.isArray(reports) || !reports.length || reports.some(row => !row.operationAudit ||
          row.operationVersion !== 'NATURE_OPERATIONS_2026_10_V1')) {
        return unavailable('A origem não conserva naturezas e competências suficientes para separar receita bruta e devoluções.');
      }
      result = reconcileRevenueMonths(reports.map(row => ({sourceMonth: row.sourceMonth, ...row.operationAudit})), ids);
      for (const row of reports) {
        const closing = result.monthly.find(value => value.sourceMonth === row.sourceMonth);
        if (!checkFields(row.fields, closing.revenueAfterReturnsCents)) throw new TypeError('Receita mensal divergente.');
      }
      if (source.operationAudit && !INPUTS.every(key => source.operationAudit[key] === result[key])) throw new TypeError('Auditoria total divergente.');
      if (source.fields && !checkFields(source.fields, result.revenueAfterReturnsCents)) throw new TypeError('Receita total divergente.');
      if (source.sales?.selectedTotalCents !== undefined && source.sales.selectedTotalCents !== result.revenueAfterReturnsCents) throw new TypeError('Seleção de receita divergente.');
    }
    if (sourceMonth !== null) {
      const row = result.monthly.find(value => value.sourceMonth === sourceMonth);
      if (!row) return unavailable('Esta competência não possui receita de origem conciliada.');
      result = reconcileRevenueMonths([row], result);
    }
    if (scenarioRevenueCents !== null && scenarioRevenueCents !== undefined) {
      if (!integer(scenarioRevenueCents)) return unavailable('A receita utilizada não está disponível em centavos válidos.');
      result = {...result, manualAdjustmentCents: sum([scenarioRevenueCents, -result.revenueAfterReturnsCents]), usedRevenueCents: scenarioRevenueCents};
    }
    return result;
  } catch {
    return unavailable('A receita de origem não concilia com os valores preservados nesta versão.');
  }
}
