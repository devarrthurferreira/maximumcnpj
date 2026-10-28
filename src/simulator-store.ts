import { getGeneration } from './generation-store.ts';
import { reconciledPurchaseSummary as purchaseSummary } from './purchase-store.ts';
import { PURCHASE_MODE, SALES_MODE, exactCents, exactSignedCents, type ReportPeriod } from './purchase-domain.ts';
import { AppError, need } from './security.ts';
import {monthlyProjection, monthlyDifal, MONTHLY_FIELDS} from '../public/simulator-monthly.js';
import {monthlyReportSource, aggregateOperationAudit, type OperationMonthlyReport} from './simulation-monthly-source.ts';
import {OPERATION_CATALOG_VERSION} from './operation-catalog.ts';
import { sameReportCompetences } from './report-competence.ts';
import {JAN_SEP_POLICY,buildAnalysisPeriod,selectAnalysisPeriod} from '../public/analysis-period.js';
import {aggregateCommercialComposition} from './simulation-commercial-composition.ts';

type FinancialSummary = Awaited<ReturnType<typeof purchaseSummary>>;

function sourceMetadata(summary: FinancialSummary) {
  return {jobId: summary.job._id, fileName: summary.job.fileName, totalCents: summary.totals.totalCents,
    formula: summary.formula, calculationVersion: summary.calculationVersion, completedAt: summary.job.completedAt, period: summary.period || null,
    ...(summary.job.mode === SALES_MODE ? {servicesTotalCents: summary.servicesTotalCents, operationTotals: summary.operationTotals} : {}),
    ...(summary.job.mode === SALES_MODE && summary.difal ? {difal: summary.difal} : {})};
}

/** Only reconciled server snapshots can prefill a simulator; the browser never supplies totals. */
export async function generationSimulator(id: string, clientId: string, options:{periodPolicy?:typeof JAN_SEP_POLICY}={}) {
  need(options.periodPolicy===undefined||options.periodPolicy===JAN_SEP_POLICY,'Política de período desconhecida.');
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
  const analysisPeriod=options.periodPolicy===JAN_SEP_POLICY?(()=>{
    try{return buildAnalysisPeriod(purchases.period,sales.period);}
    catch(error){throw new AppError(409,'ANALYSIS_PERIOD',error instanceof Error?error.message:'Confira o ano e a cobertura de janeiro a setembro dos relatórios.');}
  })():null;
  const importedMonthlyReports = await monthlyReportSource(purchases, sales, undefined, undefined, options);
  need(importedMonthlyReports, 'Os relatórios não conservam as competências da coluna H. Reimporte compras e vendas para aplicar as naturezas por mês; o histórico permanece disponível.',409,'SIMULATION_MONTHS');
  const importedOperationAudit=aggregateOperationAudit(importedMonthlyReports);
  need(importedOperationAudit.reportSalesCents===sales.totals.totalCents&&importedOperationAudit.reportPurchasesCents===purchases.totals.totalCents,
    'A seleção das naturezas diverge dos relatórios conciliados.',409,'SIMULATOR_INCONSISTENT');
  const included=analysisPeriod?new Set(analysisPeriod.includedMonths):null;
  const monthlyReports=included?importedMonthlyReports.filter(row=>included.has(row.sourceMonth)):importedMonthlyReports;
  const projection = monthlyReports.length?monthlyProjection(monthlyReports):null;
  if(projection&&analysisPeriod)projection.analysisPeriod=analysisPeriod;
  const fields = (projection?.annualGroupsCents||Object.fromEntries(MONTHLY_FIELDS.map(key=>[key,0]))) as OperationMonthlyReport['fields'];
  const operationAudit = aggregateOperationAudit(monthlyReports);
  const salesNetCents = exactSignedCents(fields.salesOptantCents + fields.salesNonOptantCents + fields.salesCpfCents);
  need(salesNetCents >= 0,
    'As devoluções de venda do relatório de compras superam as vendas de mercadorias no período. Revise os relatórios antes de simular.',409,'SIMULATOR_NEGATIVE_SALES');
  const purchaseOther = purchases.reportingGroups.find(group => group.status === 'NAO_OPTANTE')!;
  const saleOther = sales.reportingGroups.find(group => group.status === 'NAO_OPTANTE')!;
  const classification = {
    purchases: {unconfirmedCount: purchaseOther.unconfirmedCount, unconfirmedCents: purchaseOther.unconfirmedCents,
      nonCnpjCount: purchaseOther.nonCnpjCount, nonCnpjCents: purchaseOther.nonCnpjCents},
    sales: {unconfirmedCount: saleOther.unconfirmedCount, unconfirmedCents: saleOther.unconfirmedCents,
      otherDocumentsCount: saleOther.nonCnpjCount, otherDocumentsCents: saleOther.nonCnpjCents}
  };
  let period:ReportPeriod|null = null, reportMonths:number|null = null, periodBasis = 'MANUAL';
  if(analysisPeriod){
    period={startDate:`${analysisPeriod.startMonth}-01`,endDate:new Date(Date.UTC(Number(analysisPeriod.endMonth.slice(0,4)),Number(analysisPeriod.endMonth.slice(5)),0)).toISOString().slice(0,10),startMonth:analysisPeriod.startMonth,endMonth:analysisPeriod.endMonth,
      months:analysisPeriod.months,observedMonths:analysisPeriod.includedMonths.length,missingMonths:[...analysisPeriod.missingMonths]};
    reportMonths=analysisPeriod.months;periodBasis='COLUMN_H';
  } else if (purchases.period && sales.period) {
    // Compare independent reports by competence; exact snapshot/date reconciliation remains in purchaseSummary.
    need(sameReportCompetences(purchases.period, sales.period),
      `Compras e vendas cobrem competências diferentes pela coluna H (${purchases.period.startMonth} a ${purchases.period.endMonth} vs. ${sales.period.startMonth} a ${sales.period.endMonth}). Use arquivos com o mesmo mês/ano inicial e final. Diferenças de dias no mesmo mês são permitidas.`, 409, 'SIMULATOR_PERIOD');
    period = purchases.period; reportMonths = period.months; periodBasis = 'COLUMN_H';
  }
  const warnings = [
    analysisPeriod?`Período fixo: janeiro a setembro de ${analysisPeriod.sourceYear}. Cobertura comum das entradas e saídas: ${analysisPeriod.includedMonths.length}/9 competências. ${analysisPeriod.complete?'Os valores são a soma das competências disponíveis, sem preencher meses ausentes.':'Nenhuma competência comum disponível.'} Meses não incluídos: ${analysisPeriod.missingMonths.join(', ')||'nenhum'}.`:
      period ? `Período identificado automaticamente pela coluna H: ${period.startMonth} a ${period.endMonth} (${period.months} ${period.months === 1 ? 'mês' : 'meses'}). Compras e vendas têm as mesmas competências; dias sem movimento não alteram o período mensal.` :
      'Histórico anterior sem período fiscal persistido: confirme manualmente quantos meses os dois arquivos representam.',
    'O enquadramento é o observado na consulta, sem comprovação retroativa para a data de cada nota. Não confirmados permanecem identificados na fonte.'
  ];
  if(analysisPeriod?.excludedMonths.length)warnings.push(`Competências fora do período, preservadas nos relatórios originais e excluídas do cálculo: ${analysisPeriod.excludedMonths.join(', ')}.`);
  if ((purchases.period && !sales.period) || (!purchases.period && sales.period)) warnings.push('Somente um dos relatórios possui período automático. Para preservar compatibilidade histórica, confirme o período manualmente.');
  if (classification.purchases.unconfirmedCount || classification.sales.unconfirmedCount) {
    warnings.push('Há CNPJs não confirmados: seus valores estão em Não optantes, conforme a regra gerencial, e não equivalem a uma negativa fiscal.');
  }
  if (classification.purchases.nonCnpjCount) warnings.push(analysisPeriod?'A composição de compras separa CPF e outros documentos. O motor preserva o agrupamento gerencial de documentos não consultáveis, com os subtotais identificados para conferência.':'As compras de CPF e outros documentos não consultáveis estão em Compras de empresas fora do Simples, com subtotal disponível para conferência.');
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
  const difal = monthlyReports.length?monthlyDifal(monthlyReports, sales.job._id):null;
  const selectedSalesTotalCents=exactCents(salesNetCents+fields.serviceRevenueCents);
  const selectedPurchasesTotalCents=exactCents(fields.purchasesOptantCents+fields.purchasesNonOptantCents);
  return {projection, monthlyReports, operationVersion:OPERATION_CATALOG_VERSION, operationAudit, revenueSplit: {version: 'SALES_SERVICES_V1'}, generationId: id, clientId, company: {name: company.name, code: company.code}, periodBasis, reportMonths, period,
    ...(analysisPeriod?{analysisPeriod,periodPolicy:JAN_SEP_POLICY,importedOperationAudit,
      importedPeriods:{purchases:purchases.period,sales:sales.period},
      commercialComposition:monthlyReports.length?aggregateCommercialComposition(monthlyReports.map(row=>row.commercialComposition!)):null}:{}),
    // This optional preference seeds a new draft; it does not change source amounts or historical drafts.
    ...(company.difalPolicy ? {difalPolicy: company.difalPolicy} : {}),
    purchases: {...sourceMetadata(purchases),selectedTotalCents:selectedPurchasesTotalCents},
    sales: {...sourceMetadata(sales),selectedTotalCents:selectedSalesTotalCents,difal:difal?{...monthlyReports[0].difal,amountCents:difal.sourceAmountCents,baseCents:difal.sourceBaseCents,eligibleLines:difal.eligibleLines,pendingLines:difal.pendingLines}:null},
    fields, classification, warnings};
}

/** Narrow all financial evidence together; no missing accounting month becomes zero. */
export function selectAnalysisSourceMonths(source:Awaited<ReturnType<typeof generationSimulator>>,months:string[]){
  need(source.analysisPeriod,'A origem não identifica a janela de janeiro a setembro.',422,'ANALYSIS_PERIOD_INCOMPLETE');
  const analysisPeriod=selectAnalysisPeriod(source.analysisPeriod,months);
  const monthlyReports=source.monthlyReports.filter(row=>analysisPeriod.includedMonths.includes(row.sourceMonth));
  const projection=monthlyProjection(monthlyReports);projection.analysisPeriod=analysisPeriod;
  const fields=projection.annualGroupsCents as OperationMonthlyReport['fields'];
  const difal=monthlyDifal(monthlyReports,source.sales.jobId);
  const period={startDate:`${analysisPeriod.startMonth}-01`,endDate:new Date(Date.UTC(Number(analysisPeriod.endMonth.slice(0,4)),Number(analysisPeriod.endMonth.slice(5)),0)).toISOString().slice(0,10),startMonth:analysisPeriod.startMonth,
    endMonth:analysisPeriod.endMonth,months:analysisPeriod.months,observedMonths:analysisPeriod.months,missingMonths:[...analysisPeriod.missingMonths]};
  return {...source,analysisPeriod,monthlyReports,projection,fields,period,reportMonths:analysisPeriod.months,
    operationAudit:aggregateOperationAudit(monthlyReports),commercialComposition:aggregateCommercialComposition(monthlyReports.map(row=>row.commercialComposition!)),
    purchases:{...source.purchases,selectedTotalCents:exactCents(fields.purchasesOptantCents+fields.purchasesNonOptantCents)},
    sales:{...source.sales,selectedTotalCents:exactCents(fields.salesOptantCents+fields.salesNonOptantCents+fields.salesCpfCents+fields.serviceRevenueCents),
      difal:difal?{...monthlyReports[0].difal,amountCents:difal.sourceAmountCents,baseCents:difal.sourceBaseCents,eligibleLines:difal.eligibleLines,pendingLines:difal.pendingLines}:null},
    warnings:[...source.warnings,`Consolidado de ${months.length} competências: ${analysisPeriod.includedMonths.join(', ')}. Não incluídas: ${analysisPeriod.missingMonths.join(', ')||'nenhuma'}. Nenhum mês ausente foi preenchido com zero.`]};
}
