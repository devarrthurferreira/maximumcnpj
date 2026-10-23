import { getGeneration } from './generation-store.ts';
import { reconciledPurchaseSummary as purchaseSummary } from './purchase-store.ts';
import { PURCHASE_MODE, SALES_MODE, exactCents, exactSignedCents } from './purchase-domain.ts';
import { need } from './security.ts';
import {monthlyProjection, monthlyDifal} from '../public/simulator-monthly.js';
import {monthlyReportSource, aggregateOperationAudit, type OperationMonthlyReport} from './simulation-monthly-source.ts';
import {OPERATION_CATALOG_VERSION} from './operation-catalog.ts';
import { sameReportCompetences } from './report-competence.ts';

type FinancialSummary = Awaited<ReturnType<typeof purchaseSummary>>;

function sourceMetadata(summary: FinancialSummary) {
  return {jobId: summary.job._id, fileName: summary.job.fileName, totalCents: summary.totals.totalCents,
    formula: summary.formula, calculationVersion: summary.calculationVersion, completedAt: summary.job.completedAt, period: summary.period || null,
    ...(summary.job.mode === SALES_MODE ? {servicesTotalCents: summary.servicesTotalCents, operationTotals: summary.operationTotals} : {}),
    ...(summary.job.mode === SALES_MODE && summary.difal ? {difal: summary.difal} : {})};
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
  const monthlyReports = await monthlyReportSource(purchases, sales);
  need(monthlyReports, 'Os relatórios não conservam as competências da coluna H. Reimporte compras e vendas para aplicar as naturezas por mês; o histórico permanece disponível.',409,'SIMULATION_MONTHS');
  const projection = monthlyProjection(monthlyReports);
  const fields = projection.annualGroupsCents as OperationMonthlyReport['fields'];
  const operationAudit = aggregateOperationAudit(monthlyReports);
  const salesNetCents = exactSignedCents(fields.salesOptantCents + fields.salesNonOptantCents + fields.salesCpfCents);
  need(salesNetCents >= 0,
    'As devoluções de venda do relatório de compras superam as vendas de mercadorias no período. Revise os relatórios antes de simular.',409,'SIMULATOR_NEGATIVE_SALES');
  need(operationAudit.reportSalesCents===sales.totals.totalCents&&operationAudit.reportPurchasesCents===purchases.totals.totalCents,
    'A seleção das naturezas diverge dos relatórios conciliados.',409,'SIMULATOR_INCONSISTENT');
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
  warnings.push('Receita: somente operações de venda do catálogo na coluna D, menos devoluções de venda identificadas no relatório de compras. Compras: somente operações de compra e serviços de natureza 8000. A classificação usa os quatro primeiros dígitos; a base monetária permanece Q - Y + AA - AB.');
  if (operationAudit.salesReturnsCents) warnings.push('As devoluções de venda do relatório de compras foram abatidas da receita na competência da coluna H, preservando o enquadramento consultado de cada documento.');
  if (operationAudit.excludedSalesCents || operationAudit.excludedPurchaseCents) warnings.push('Operações fora das naturezas elegíveis foram excluídas das bases do cenário e permanecem detalhadas na conferência por natureza, junto aos totais originais dos relatórios.');
  if (operationAudit.unknownSalesLines || operationAudit.unknownPurchaseLines) warnings.push(`${operationAudit.unknownSalesLines + operationAudit.unknownPurchaseLines} linhas possuem natureza não cadastrada. Esses valores não entraram nas bases; revise as naturezas indicadas na conferência.`);
  const anticipationPending=monthlyReports.reduce((sum,row)=>sum+row.anticipation.pendingLines,0);
  if (anticipationPending) warnings.push(`${anticipationPending} compras elegíveis não possuem UF suficiente para confirmar a antecipação de ICMS; nenhum endereço foi presumido.`);
  warnings.push('ICMS: serviços de prefixo 8000 permanecem nos custos, sem antecipação ou crédito. As operações elegíveis usam as premissas de 18% na mesma UF e 12% entre UFs diferentes; o crédito de devolução de venda é separado do crédito de compras e considerado uma única vez.');
  const icmsPending=monthlyReports.reduce((total,row)=>total+row.icmsOperations.sales.pendingLines+row.icmsOperations.purchases.pendingLines+row.icmsOperations.salesReturns.pendingLines,0);
  if(icmsPending)warnings.push(`${icmsPending} operações elegíveis de ICMS dependem de UF confirmada. Os cenários com ICMS fora do DAS aguardam essa conferência.`);
  if (fields.serviceRevenueCents > 0) warnings.push('Vendas de serviços foram separadas das mercadorias e preenchem a receita de serviços pela competência de cada linha, sem duplicar o faturamento. Naturezas iniciadas por 9000 são serviços, independentemente do sufixo.');
  const difal = monthlyDifal(monthlyReports, sales.job._id);
  const selectedSalesTotalCents=exactCents(salesNetCents+fields.serviceRevenueCents);
  const selectedPurchasesTotalCents=exactCents(fields.purchasesOptantCents+fields.purchasesNonOptantCents);
  return {projection, monthlyReports, operationVersion:OPERATION_CATALOG_VERSION, operationAudit, revenueSplit: {version: 'SALES_SERVICES_V1'}, generationId: id, clientId, company: {name: company.name, code: company.code}, periodBasis, reportMonths, period,
    // This optional preference seeds a new draft; it does not change source amounts or historical drafts.
    ...(company.difalPolicy ? {difalPolicy: company.difalPolicy} : {}),
    purchases: {...sourceMetadata(purchases),selectedTotalCents:selectedPurchasesTotalCents},
    sales: {...sourceMetadata(sales),selectedTotalCents:selectedSalesTotalCents,difal:difal?{...monthlyReports[0].difal,amountCents:difal.sourceAmountCents,baseCents:difal.sourceBaseCents,eligibleLines:difal.eligibleLines,pendingLines:difal.pendingLines}:null},
    fields, classification, warnings};
}
