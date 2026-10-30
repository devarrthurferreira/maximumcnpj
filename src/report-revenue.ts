import {collection, scope, type Doc} from './store.ts';
import {jobCollection} from './mongo-storage.ts';
import {need} from './security.ts';
import {assertGenerationNotDeleted} from './generation-deletion.ts';
import {PURCHASE_MODE, SALES_MODE, reportPeriod, exactCents, exactSignedCents, type FinancialMode} from './purchase-domain.ts';
import {sameReportCompetences} from './report-competence.ts';
import {classifyOperationNature, normalizeOperationNature} from './operation-catalog.ts';
import {reconcileRevenueMonths, unavailableRevenueReconciliation, type RevenueMetadata, type RevenueReconciliation} from '../public/revenue-reconciliation.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const slots = {PURCHASES_V1: ['purchaseJobId', 'purchaseJobIds'], SALES_V1: ['salesJobId', 'salesJobIds']} as const;
type Summary = {job: Doc; calculationVersion: string; totals: {lines:number;totalCents:number}};
export type RevenueSummaryReader = (id:string, mode:FinancialMode) => Promise<Summary>;

function checkedCompany(generation:Doc, clientId:string) {
  need(generation.workspaceId === scope().workspaceId && !generation.deletionStartedAt && Array.isArray(generation.companies),
    'A geração deste fechamento está indisponível.', 409, 'GENERATION_INCONSISTENT');
  const companies = generation.companies.filter((company:any) => company?.clientId === clientId);
  need(companies.length === 1, 'A empresa não pertence de forma única à geração.', 409, 'GENERATION_INCONSISTENT');
  return companies[0];
}
function checkedOwner(generation:Doc, company:Doc, jobId:string, mode:FinancialMode) {
  const owners = generation.companies.flatMap((candidate:any) => Object.values(slots).flatMap(([, history]) =>
    Array.isArray(candidate?.[history]) ? candidate[history].filter((id:unknown) => id === jobId).map(() => ({candidate, history})) : []));
  need(UUID.test(jobId) && owners.length === 1 && owners[0].candidate === company && owners[0].history === slots[mode][1],
    'Os relatórios do fechamento não pertencem ao histórico da empresa.', 409, 'GENERATION_INCONSISTENT');
}
async function readGeneration(id:string) {
  need(UUID.test(id), 'Vínculo do fechamento com a geração inconsistente.', 409, 'GENERATION_INCONSISTENT');
  await assertGenerationNotDeleted(id);
  const generation = await (await collection('generations')).findOne(scope({_id:id}));
  need(generation, 'A geração deste fechamento está indisponível.', 409, 'GENERATION_INCONSISTENT');
  return generation;
}

/** This view only accepts the exact current pair; a recheck never borrows a newer purchases report. */
export async function reportRevenueReconciliation(summary:Summary, read:RevenueSummaryReader):Promise<RevenueReconciliation> {
  const job = summary.job;
  need(job.workspaceId === scope().workspaceId && Object.hasOwn(slots, job.mode),
    'Relatório fora do workspace ou tipo financeiro.', 409, 'GENERATION_INCONSISTENT');
  if (!Object.hasOwn(job, 'generationId')) return unavailableRevenueReconciliation(
    'Este relatório não conserva um par de compras e vendas vinculado à mesma geração.', {clientId:job.clientId});
  const generation = await readGeneration(job.generationId), company = checkedCompany(generation, job.clientId);
  checkedOwner(generation, company, job._id, job.mode);
  const ids = {generationId:generation._id, clientId:job.clientId,
    purchaseJobId:company.purchaseJobId, salesJobId:company.salesJobId};
  if (company[slots[job.mode as FinancialMode][0]] !== job._id) return unavailableRevenueReconciliation(
    'Este relatório pertence a uma versão anterior; o par original completo não está registrado para este fechamento.',
    {generationId:generation._id, clientId:job.clientId});
  return companyRevenue(generation, company, read, summary, ids);
}

/** Kept separate from generation hydration/history: read only when a company closing is requested. */
export async function generationRevenueReconciliation(id:string, clientId:string, read:RevenueSummaryReader):Promise<RevenueReconciliation> {
  need(UUID.test(clientId), 'Selecione a empresa para conferir a receita.');
  const generation = await readGeneration(id), company = checkedCompany(generation, clientId);
  return companyRevenue(generation, company, read);
}

async function companyRevenue(generation:Doc, company:Doc, read:RevenueSummaryReader, existing?:Summary, metadata?:RevenueMetadata):Promise<RevenueReconciliation> {
  const ids = metadata || {generationId:generation._id, clientId:company.clientId,
    purchaseJobId:company.purchaseJobId, salesJobId:company.salesJobId};
  const required = generation.requiredReports || ['PURCHASES'];
  need(Array.isArray(required) && required.length >= 1 && required.length <= 2 && new Set(required).size === required.length &&
    required.every((type:unknown) => type === 'PURCHASES' || type === 'SALES'), 'Tipos da geração inconsistentes.', 409, 'GENERATION_INCONSISTENT');
  if (!required.includes('PURCHASES') || !required.includes('SALES')) return unavailableRevenueReconciliation(
    'O fechamento exige compras e vendas selecionadas na mesma geração.', ids);
  if (!company.purchaseJobId || !company.salesJobId) return unavailableRevenueReconciliation(
    'Adicione e conclua os relatórios de compras e vendas desta empresa para conferir as devoluções.', ids, 'PENDING');
  for (const mode of [PURCHASE_MODE, SALES_MODE] as const) checkedOwner(generation, company, company[slots[mode][0]], mode);
  const jobs = await (await collection('lookupJobs')).find(scope({_id:{$in:[company.purchaseJobId, company.salesJobId]}})).limit(3).toArray();
  need(jobs.length === 2, 'Um relatório vinculado ao fechamento está indisponível.', 409, 'GENERATION_INCONSISTENT');
  for (const mode of [PURCHASE_MODE, SALES_MODE] as const) {
    const job = jobs.find(value => value._id === company[slots[mode][0]]);
    need(job && job.workspaceId === scope().workspaceId && job.clientId === company.clientId && job.generationId === generation._id && job.mode === mode,
      'Os relatórios do fechamento não correspondem à empresa, geração ou tipo.', 409, 'GENERATION_INCONSISTENT');
  }
  if (jobs.some(job => job.status !== 'COMPLETED')) return unavailableRevenueReconciliation(
    'Conclua os dois relatórios para conferir a receita bruta e as devoluções do período.', ids, 'PENDING');
  const [purchases, sales] = await Promise.all(([PURCHASE_MODE, SALES_MODE] as const).map(mode => {
    const id = company[slots[mode][0]];
    return existing?.job._id === id ? Promise.resolve(existing!) : read(id, mode);
  }));
  return revenueFromPair(purchases, sales, ids);
}

async function revenueFromPair(purchases:Summary, sales:Summary, ids:RevenueMetadata):Promise<RevenueReconciliation> {
  if (purchases.calculationVersion !== 'NET_V2' || sales.calculationVersion !== 'NET_V2') return unavailableRevenueReconciliation(
    'Os relatórios precisam conservar a base Q − Y + AA − AB para este fechamento.', ids);
  const read = async (summary:Summary) => {
    const rows = await (await jobCollection('purchaseLines',summary.job)).find(scope({jobId:summary.job._id}))
      .project({index:1, serviceDate:1, natureCode:1, totalCents:1, balanceCents:1}).sort({index:1}).maxTimeMS(20000).toArray();
    need(rows.length === summary.totals.lines && rows.every((row,index) => row.index === index) &&
      rows.reduce((total,row) => exactCents(total + exactCents(row.totalCents)), 0) === summary.job.purchaseInput.totalCents &&
      rows.reduce((total,row) => exactSignedCents(total + (summary.job.mode === SALES_MODE ? row.balanceCents ?? row.totalCents : row.totalCents)), 0) === summary.totals.totalCents,
      'Linhas ou valores do fechamento divergem do relatório conciliado.', 409, 'REVENUE_INCONSISTENT');
    return rows;
  };
  const [purchaseRows, salesRows] = await Promise.all([read(purchases), read(sales)]);
  if ([...purchaseRows, ...salesRows].some(row => !row.serviceDate || normalizeOperationNature(row.natureCode).length !== 4)) {
    return unavailableRevenueReconciliation('As linhas salvas não conservam natureza e competência suficientes para conferir todas as devoluções.', ids);
  }
  let pp, sp;
  try { pp = reportPeriod(purchaseRows.map(row => row.serviceDate)); sp = reportPeriod(salesRows.map(row => row.serviceDate)); }
  catch { return unavailableRevenueReconciliation('As competências dos relatórios não permitem um fechamento mensal confiável.', ids); }
  if (!sameReportCompetences(pp, sp)) return unavailableRevenueReconciliation(
    'Compras e vendas cobrem competências diferentes. Use o mesmo mês/ano inicial e final para conferir as devoluções.', ids);
  const [year, month] = pp.startMonth.split('-').map(Number);
  const monthly = Array.from({length:pp.months}, (_, index) => ({sourceMonth:new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0,7),
    grossSalesCents:0, serviceSalesCents:0, salesReturnsCents:0}));
  const byMonth = new Map(monthly.map(row => [row.sourceMonth, row]));
  for (const [rows, mode] of [[purchaseRows,PURCHASE_MODE], [salesRows,SALES_MODE]] as const) {
    for (const row of rows) {
      const target = byMonth.get(row.serviceDate.slice(0,7))!, operation = classifyOperationNature(row.natureCode);
      const field = mode === SALES_MODE ? operation === 'VENDA' ? 'grossSalesCents' : operation === 'SERVICO_VENDA' ? 'serviceSalesCents' : null :
        operation === 'DEVOLUCAO_VENDA' ? 'salesReturnsCents' : null;
      if (field) target[field] = exactCents(target[field] + row.totalCents);
    }
  }
  return reconcileRevenueMonths(monthly, ids);
}
