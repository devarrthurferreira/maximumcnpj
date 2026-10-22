import {isDeepStrictEqual} from 'node:util';
import {collection, scope} from './store.ts';
import type {Doc} from './store.ts';
import {need} from './security.ts';
import {purchaseSummary} from './purchase-store.ts';
import {PURCHASE_MODE, SALES_MODE, COMPONENT_FIELDS, exactCents, exactSignedCents} from './purchase-domain.ts';
import {normalizeNatureCode, normalizeUf, salesOperation} from './difal.ts';
import {monthlyProjection, monthlyDifal, MONTHLY_FIELDS} from '../public/simulator-monthly.js';
import {monthlyReportSource, aggregateOperationAudit, type OperationMonthlyReport} from './simulation-monthly-source.ts';
import {OPERATION_CATALOG_VERSION} from './operation-catalog.ts';
import type {generationSimulator} from './simulator-store.ts';

type Source = Awaited<ReturnType<typeof generationSimulator>>;
type Summary = Awaited<ReturnType<typeof purchaseSummary>>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SALES_GROUPS = ['OPTANTE', 'NAO_OPTANTE', 'CPF'] as const;
const SALES_FIELDS = ['salesOptantCents', 'salesNonOptantCents', 'salesCpfCents'] as const;
const check = (condition: unknown, message: string) => need(condition, message, 409, 'REPROCESS_SOURCE');
const groupValue = (summary: Summary, status: string) => {
  const group = summary.reportingGroups.find(group => group.status === status);
  check(group, 'A classificação original dos relatórios está incompleta.');
  return exactSignedCents(group!.totalCents);
};

async function originalSource(snapshot: Doc, purchases: Summary, sales: Summary) {
  const source = snapshot.source;
  check(source && source.generationId === snapshot.generationId && source.clientId === snapshot.clientId,
    'A origem congelada não corresponde à empresa e geração da simulação.');
  check(Number.isInteger(snapshot.reportMonths) && snapshot.reportMonths >= 1 && snapshot.reportMonths <= 12,
    'O histórico não conserva um período mensal válido.');
  for (const [name, summary] of [['purchases', purchases], ['sales', sales]] as const) {
    const saved = source[name], job = summary.job;
    check(saved?.jobId === job._id && job.clientId === snapshot.clientId && job.generationId === snapshot.generationId &&
      job.completedAt && saved.calculationVersion === 'NET_V2' && summary.calculationVersion === 'NET_V2',
    'Os relatórios originais não correspondem à empresa, geração e fórmula da simulação.');
    check(saved.totalCents === summary.totals.totalCents,
      'O total do relatório original diverge do total congelado na simulação.');
    if (saved.period) check(isDeepStrictEqual(saved.period, summary.period), 'O período fiscal original diverge do histórico.');
  }
  if (source.operationVersion === OPERATION_CATALOG_VERSION) {
    const months=await monthlyReportSource(purchases,sales,undefined,normalizeUf(source.sales.difal?.issuerUf));
    check(months,'O histórico não conserva as competências mensais originais.');
    const fields=monthlyProjection(months!).annualGroupsCents;
    check(MONTHLY_FIELDS.every(key=>source.fields?.[key]===fields[key]),'As bases congeladas por natureza divergem dos relatórios originais.');
    check(isDeepStrictEqual(source.operationAudit,aggregateOperationAudit(months!)),'A conferência congelada de naturezas diverge dos relatórios originais.');
    const evidence=(row: any)=>({sourceMonth:row?.sourceMonth,month:row?.month,fields:row?.fields,
      salesLines:row?.salesLines,purchaseLines:row?.purchaseLines,operationVersion:row?.operationVersion,operationAudit:row?.operationAudit});
    check(Array.isArray(source.monthlyReports)&&isDeepStrictEqual(source.monthlyReports.map(evidence),months!.map(evidence)),
      'As bases e evidências de cada competência divergem dos relatórios originais.');
  } else {
    check(source.operationVersion===undefined,'O histórico usa uma versão de naturezas desconhecida.');
    check(source.fields && source.fields.purchasesOptantCents === groupValue(purchases, 'OPTANTE') &&
      source.fields.purchasesNonOptantCents === groupValue(purchases, 'NAO_OPTANTE'),
    'As compras congeladas divergem dos relatórios originais.');
    const split = source.revenueSplit?.version === 'SALES_SERVICES_V1';
    SALES_GROUPS.forEach((status, index) => {
      const service = split ? sales.serviceGroups?.find(group => group.status === status)?.totalCents : 0;
      check(typeof service === 'number' && source.fields[SALES_FIELDS[index]] === groupValue(sales, status) - service,
        'Os grupos de receita congelados divergem do relatório original.');
    });
    if (split) check(source.fields.serviceRevenueCents === sales.servicesTotalCents,
      'Os serviços congelados divergem do relatório original.');
    if (source.monthlyReports!==undefined) {
      check(Array.isArray(source.monthlyReports)&&source.monthlyReports.length===snapshot.reportMonths,
        'O histórico não conserva todas as competências da base mensal.');
      let frozenProjection: ReturnType<typeof monthlyProjection>;
      try {frozenProjection=monthlyProjection(source.monthlyReports);}
      catch {check(false,'Os valores mensais congelados são inválidos.');}
      check(MONTHLY_FIELDS.every(key=>frozenProjection.annualGroupsCents[key]===source.fields[key]),
        'As bases mensais congeladas não conciliam com os totais originais.');
      const currentMonths=await monthlyReportSource(purchases,sales,undefined,normalizeUf(source.sales.difal?.issuerUf));
      check(currentMonths&&currentMonths.length===source.monthlyReports.length&&currentMonths.every((row,index)=>
        row.sourceMonth===source.monthlyReports[index].sourceMonth&&row.month===source.monthlyReports[index].month),
      'As competências mensais congeladas divergem das datas dos relatórios originais.');
      // Legacy financial fields keep their old classification; only their totals
      // and chronological evidence reconcile here, before preserving manual deltas.
    }
  }
  if (source.periodBasis === 'COLUMN_H') {
    check(source.period && source.reportMonths === snapshot.reportMonths && source.period.months === snapshot.reportMonths &&
      isDeepStrictEqual(source.period, purchases.period) && sales.period &&
      purchases.period?.startMonth === sales.period.startMonth && purchases.period?.endMonth === sales.period.endMonth,
    'As competências originais não correspondem ao período congelado.');
  }
  if (snapshot.reportPeriod) check(isDeepStrictEqual(snapshot.reportPeriod, source.period),
    'O período congelado na simulação diverge de sua origem.');
  return source;
}

/** Reclassify only after the original immutable jobs, sums and provider snapshots reconcile. */
export async function rebuildSimulationSource(snapshot: Doc): Promise<Source & {reprocessingSource: {
  version: string; originalSalesTotalCents: number; originalPurchasesTotalCents: number;
  recalculatedSalesTotalCents: number; salesBalanceChangeCents: number; reclassifiedLines: number;
  missingOperationEvidenceLines: number; issuerUfSource: string;
}}> {
  const old = snapshot.source;
  check(UUID.test(snapshot.generationId || '') && UUID.test(snapshot.clientId || '') &&
    UUID.test(old?.purchases?.jobId || '') && UUID.test(old?.sales?.jobId || '') && old.purchases.jobId !== old.sales.jobId,
  'O histórico não identifica os dois relatórios originais.');
  // This is deliberately before applying current classifiers: an unreconciled
  // archive cannot be repaired by treating the current calculation as its truth.
  const [purchases, sales] = await Promise.all([
    purchaseSummary(old.purchases.jobId, true, PURCHASE_MODE), purchaseSummary(old.sales.jobId, true, SALES_MODE)
  ]);
  const original = await originalSource(snapshot, purchases, sales);
  const rows=await (await collection('purchaseLines')).find(scope({jobId:sales.job._id})).sort({index:1}).maxTimeMS(20000).toArray();
  check(rows.length === sales.totals.lines && new Set(rows.map(row => row.index)).size === rows.length &&
    rows.every((row, index) => row.index === index), 'As linhas originais ficaram incompletas durante o recálculo.');
  const rawTotal = exactCents(rows.reduce((sum, row) => exactCents(sum + exactCents(row.totalCents)), 0));
  const oldBalance = exactSignedCents(rows.reduce((sum, row) => exactSignedCents(sum + exactSignedCents(row.balanceCents ?? row.totalCents)), 0));
  check(rawTotal === sales.job.purchaseInput.totalCents && oldBalance === sales.totals.totalCents,
    'As linhas originais mudaram durante a reconciliação.');
  for (const field of COMPONENT_FIELDS) check(exactCents(rows.reduce((sum, row) => exactCents(sum + exactCents(row[field])), 0)) === sales.components?.[field],
    'Os componentes originais mudaram durante a reconciliação.');
  const reclassifiedLines=rows.filter(row=>row.operation!==salesOperation(row.natureCode,row.description)||row.natureCode!==normalizeNatureCode(row.natureCode)).length;
  const originalIssuer = normalizeUf(sales.job.issuerUf), savedIssuer = normalizeUf(original.sales.difal?.issuerUf);
  check(!originalIssuer || !savedIssuer || originalIssuer === savedIssuer, 'As UFs congeladas do emitente são conflitantes.');
  const issuerUf = originalIssuer || savedIssuer;
  const monthlyReports=await monthlyReportSource(purchases,sales,undefined,issuerUf);
  check(monthlyReports,'Os relatórios originais não conservam as competências da coluna H. Reimporte-os para aplicar o catálogo de naturezas.');
  const projection=monthlyProjection(monthlyReports!);
  const fields=projection.annualGroupsCents as OperationMonthlyReport['fields'];
  const operationAudit=aggregateOperationAudit(monthlyReports!);
  const difalMonths=monthlyDifal(monthlyReports!,sales.job._id);
  const difal=difalMonths?{...monthlyReports![0].difal,amountCents:difalMonths.sourceAmountCents,baseCents:difalMonths.sourceBaseCents,
    eligibleLines:difalMonths.eligibleLines,pendingLines:difalMonths.pendingLines}:null;
  const goodsCents=exactSignedCents(fields.salesOptantCents+fields.salesNonOptantCents+fields.salesCpfCents);
  check(goodsCents>=0,'As devoluções de venda do relatório de compras superam as vendas de mercadorias reconstruídas.');
  const recalculatedSalesTotalCents=exactCents(goodsCents+fields.serviceRevenueCents);
  const selectedPurchasesTotalCents=exactCents(fields.purchasesOptantCents+fields.purchasesNonOptantCents);
  const salesBalanceChangeCents=exactSignedCents(recalculatedSalesTotalCents-sales.totals.totalCents);
  const warnings=[
    'Recálculo sobre as linhas originais: natureza, valores e enquadramento da consulta foram preservados. Nenhum CNPJ foi consultado novamente.',
    'Receita inclui somente operações de venda e serviços 9000, menos devoluções de venda do relatório de compras. Compras incluem somente operações de compra e serviços 8000. Os quatro primeiros dígitos da natureza da coluna L dos relatórios são classificados pela coluna D (OPERAÇÃO) do catálogo; valores seguem Q - Y + AA - AB.',
    'Totais originais dos relatórios e bases selecionadas do cenário estão separados na conferência por natureza.'
  ];
  if(salesBalanceChangeCents)warnings.push('A seleção atual das naturezas alterou a base de receita do cenário. A diferença está identificada na origem do recálculo; não é um ajuste manual.');
  const unknown=operationAudit.unknownSalesLines+operationAudit.unknownPurchaseLines;
  if(unknown)warnings.push(`${unknown} linhas com natureza não cadastrada foram excluídas das bases e permanecem identificadas para revisão na conferência.`);
  if(difal?.pendingLines)warnings.push(`${difal.pendingLines} vendas elegíveis dependem de UF histórica do emitente ou destinatário; nenhum endereço atual foi utilizado para preencher a ausência.`);
  const anticipationPending=monthlyReports!.reduce((sum,row)=>sum+row.anticipation.pendingLines,0);
  if(anticipationPending)warnings.push(`${anticipationPending} compras elegíveis dependem de UF histórica para confirmar a antecipação de ICMS.`);
  return {...original,generationId:snapshot.generationId,clientId:snapshot.clientId,
    company:structuredClone(snapshot.company||original.company),fields,revenueSplit:{version:'SALES_SERVICES_V1'},
    operationVersion:OPERATION_CATALOG_VERSION,operationAudit,projection,monthlyReports,
    purchases:{...original.purchases,totalCents:purchases.totals.totalCents,selectedTotalCents:selectedPurchasesTotalCents},
    sales:{...original.sales,totalCents:sales.totals.totalCents,selectedTotalCents:recalculatedSalesTotalCents,
      servicesTotalCents:sales.servicesTotalCents,operationTotals:sales.operationTotals,difal},
    classification:structuredClone(original.classification),warnings,
    reprocessingSource:{version:'FROZEN_LINES_CURRENT_RULES_V2',originalSalesTotalCents:sales.totals.totalCents,
      originalPurchasesTotalCents:purchases.totals.totalCents,recalculatedSalesTotalCents,salesBalanceChangeCents,
      reclassifiedLines,missingOperationEvidenceLines:0,issuerUfSource:originalIssuer?'ORIGINAL_JOB':savedIssuer?'ORIGINAL_SIMULATION':'UNAVAILABLE'}
  };
}
