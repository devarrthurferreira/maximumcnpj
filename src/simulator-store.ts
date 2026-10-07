import { getGeneration } from './generation-store.ts';
import { purchaseSummary } from './purchase-store.ts';
import { PURCHASE_MODE, SALES_MODE, exactCents, exactSignedCents } from './purchase-domain.ts';
import { need } from './security.ts';
import { annualizeReports } from '../public/simulator-projection.js';
import { sameReportCompetences } from './report-competence.ts';

type FinancialSummary = Awaited<ReturnType<typeof purchaseSummary>>;

function valueFor(summary: FinancialSummary, status: string) {
  const group = summary.reportingGroups.find(group => group.status === status);
  need(group, 'Classificação financeira incompleta. Reimporte o relatório.', 409, 'SIMULATOR_INCONSISTENT');
  return summary.job.mode === SALES_MODE ? exactSignedCents(group.totalCents) : exactCents(group.totalCents);
}

function sourceMetadata(summary: FinancialSummary) {
  return {jobId: summary.job._id, fileName: summary.job.fileName, totalCents: summary.totals.totalCents,
    formula: summary.formula, calculationVersion: summary.calculationVersion, completedAt: summary.job.completedAt, period: summary.period || null};
}

/** Only reconciled server snapshots can prefill a simulator; the browser never supplies totals. */
export async function generationSimulator(id: string, clientId: string) {
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(clientId), 'Selecione a empresa para gerar o simulador.');
  const generation = await getGeneration(id);
  const company = generation.companies.find((company: any) => company.clientId === clientId);
  need(company, 'Esta empresa não pertence à geração.', 409, 'GENERATION_CLIENT');
  need(company.purchase && company.sales && company.purchase.status === 'COMPLETED' && company.sales.status === 'COMPLETED',
    'Conclua a leitura e a consulta de compras e vendas desta empresa para abrir o simulador.', 409, 'SIMULATOR_INCOMPLETE');
  need(company.purchase.calculationVersion === 'NET_V2' && company.sales.calculationVersion === 'NET_V2',
    'Reimporte compras e vendas com a fórmula Q - Y + AA - AB antes de abrir o simulador. O relatório antigo usa outra base.', 409, 'SIMULATOR_VERSION');
  const [purchases, sales] = await Promise.all([
    purchaseSummary(company.purchaseJobId, true, PURCHASE_MODE),
    purchaseSummary(company.salesJobId, true, SALES_MODE)
  ]);
  for (const [summary, linkedId] of [[purchases, company.purchaseJobId], [sales, company.salesJobId]] as const) {
    need(summary.job._id === linkedId && summary.job.clientId === clientId && summary.job.generationId === id &&
      summary.calculationVersion === 'NET_V2' && summary.job.completedAt,
    'Os relatórios não correspondem à empresa e à geração selecionadas.', 409, 'SIMULATOR_INCONSISTENT');
  }
  const fields = {
    salesOptantCents: valueFor(sales, 'OPTANTE'), salesNonOptantCents: valueFor(sales, 'NAO_OPTANTE'), salesCpfCents: valueFor(sales, 'CPF'),
    purchasesOptantCents: valueFor(purchases, 'OPTANTE'), purchasesNonOptantCents: valueFor(purchases, 'NAO_OPTANTE')
  };
  need(exactSignedCents(fields.salesOptantCents + fields.salesNonOptantCents + fields.salesCpfCents) === sales.totals.totalCents &&
    exactCents(fields.purchasesOptantCents + fields.purchasesNonOptantCents) === purchases.totals.totalCents,
  'Os campos do simulador divergem dos relatórios. Revise os arquivos.', 409, 'SIMULATOR_INCONSISTENT');
  const purchaseOther = purchases.reportingGroups.find(group => group.status === 'NAO_OPTANTE')!;
  const saleOther = sales.reportingGroups.find(group => group.status === 'NAO_OPTANTE')!;
  const classification = {
    purchases: {unconfirmedCount: purchaseOther.unconfirmedCount, unconfirmedCents: purchaseOther.unconfirmedCents,
      nonCnpjCount: purchaseOther.nonCnpjCount, nonCnpjCents: purchaseOther.nonCnpjCents},
    sales: {unconfirmedCount: saleOther.unconfirmedCount, unconfirmedCents: saleOther.unconfirmedCents,
      otherDocumentsCount: saleOther.nonCnpjCount, otherDocumentsCents: saleOther.nonCnpjCents}
  };
  let period = null, reportMonths = null, periodBasis = 'MANUAL';
  if (purchases.period && sales.period) {
    // Compare independent reports by competence; exact snapshot/date reconciliation remains in purchaseSummary.
    need(sameReportCompetences(purchases.period, sales.period),
      `Compras e vendas cobrem competências diferentes pela coluna H (${purchases.period.startMonth} a ${purchases.period.endMonth} vs. ${sales.period.startMonth} a ${sales.period.endMonth}). Use arquivos com o mesmo mês/ano inicial e final. Diferenças de dias no mesmo mês são permitidas.`, 409, 'SIMULATOR_PERIOD');
    period = purchases.period; reportMonths = period.months; periodBasis = 'COLUMN_H';
  }
  const warnings = [
    period ? `Período identificado automaticamente pela coluna H: ${period.startMonth} a ${period.endMonth} (${period.months} ${period.months === 1 ? 'mês' : 'meses'}). Compras e vendas têm as mesmas competências; dias sem movimento não alteram o período mensal.` :
      'Histórico anterior sem período fiscal persistido: confirme manualmente quantos meses os dois arquivos representam.',
    'O enquadramento é o observado na consulta, sem comprovação retroativa para a data de cada nota. Não confirmados permanecem identificados na fonte.'
  ];
  if ((purchases.period && !sales.period) || (!purchases.period && sales.period)) warnings.push('Somente um dos relatórios possui período automático. Para preservar compatibilidade histórica, confirme o período manualmente.');
  if (classification.purchases.unconfirmedCount || classification.sales.unconfirmedCount) {
    warnings.push('Há CNPJs não confirmados: seus valores estão em Não optantes, conforme a regra gerencial, e não equivalem a uma negativa fiscal.');
  }
  if (classification.purchases.nonCnpjCount) warnings.push('As compras de CPF e outros documentos não consultáveis estão em Compras de empresas fora do Simples, com subtotal disponível para conferência.');
  if (classification.sales.otherDocumentsCount) warnings.push('As vendas com CNO, documentos inválidos ou ausentes estão em Vendas Não Optantes SN. Vendas identificadas como CPF têm campo próprio.');
  if (sales.operationTotals?.some((item: any) => item.operation === 'DEVOLUCAO' && item.lines > 0)) warnings.push('Devoluções foram identificadas na aba de vendas e abatidas do saldo líquido antes do preenchimento dos campos do simulador.');
  const projection = reportMonths ? annualizeReports(fields, reportMonths) : null;
  return {projection, generationId: id, clientId, company: {name: company.name, code: company.code}, periodBasis, reportMonths, period,
    purchases: sourceMetadata(purchases), sales: sourceMetadata(sales), fields, classification, warnings};
}
