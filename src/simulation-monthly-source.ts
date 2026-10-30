import {scope} from './store.ts';
import {jobCollection} from './mongo-storage.ts';
import {need} from './security.ts';
import {exactCents, exactSignedCents, financialReportingStatus, SALES_MODE, PURCHASE_MODE, reportPeriod} from './purchase-domain.ts';
import {summarizeDifal, normalizeUf, salesOperation} from './difal.ts';
import {isAnticipationVersion,summarizeAnticipation} from './icms-anticipation.ts';
import {OPERATION_CATALOG_VERSION, classifyOperationNature, normalizeOperationNature, type CatalogOperation} from './operation-catalog.ts';
import {sameReportCompetences} from './report-competence.ts';
import {MONTHLY_FIELDS, type MonthlyReport} from '../public/simulator-monthly.js';
import {summarizeIcmsOperations, type IcmsOperations} from '../public/simulator-icms.js';
import {JAN_SEP_POLICY,reportMonthsInPeriod} from '../public/analysis-period.js';
import {summarizeCommercialMonth} from './simulation-commercial-composition.ts';

export type NatureAudit = {
  side: 'SALES' | 'PURCHASES'; natureCode: string; operation: CatalogOperation; lines: number;
  sourceCents: number; sourceBalanceCents: number; salesCents: number; purchasesCents: number; salesReturnsCents: number; excludedCents: number;
};
const AUDIT_FIELDS = ['grossSalesCents','serviceSalesCents','salesReturnsCents','purchaseGoodsCents','purchaseServicesCents',
  'excludedSalesCents','excludedPurchaseCents','unknownSalesLines','unknownPurchaseLines','reportSalesCents','reportPurchasesCents',
  'reportSalesGrossCents','reportSalesBalanceAdjustmentCents'] as const;
export type OperationAudit = Record<typeof AUDIT_FIELDS[number], number> & {natures: NatureAudit[]};
export type OperationMonthlyReport = MonthlyReport & {
  operationVersion: typeof OPERATION_CATALOG_VERSION; operationAudit: OperationAudit;
  anticipation: ReturnType<typeof summarizeAnticipation>;
  icmsOperations: IcmsOperations;
};
const emptyAudit = (): OperationAudit => ({...Object.fromEntries(AUDIT_FIELDS.map(key=>[key,0])) as Record<typeof AUDIT_FIELDS[number],number>,natures:[]});
const natureKey = (row: NatureAudit) => `${row.side}:${row.natureCode}`;

/** Audit sums retain the original reconciled report and a separate bridge to the selected scenario base. */
export function aggregateOperationAudit(reports: readonly OperationMonthlyReport[]): OperationAudit {
  const audit=emptyAudit(), natures=new Map<string,NatureAudit>();
  for(const row of reports){
    need(row.operationVersion===OPERATION_CATALOG_VERSION&&row.operationAudit,'Contrato de naturezas mensais desconhecido.',409,'SIMULATION_OPERATIONS');
    for(const key of AUDIT_FIELDS)audit[key]=exactSignedCents(audit[key]+row.operationAudit[key]);
    for(const source of row.operationAudit.natures){
      const key=natureKey(source),target=natures.get(key);
      if(!target)natures.set(key,{...source});
      else for(const field of ['lines','sourceCents','sourceBalanceCents','salesCents','purchasesCents','salesReturnsCents','excludedCents'] as const)
        target[field]=exactSignedCents(target[field]+source[field]);
    }
  }
  audit.natures=[...natures.values()].sort((a,b)=>natureKey(a).localeCompare(natureKey(b)));
  return audit;
}

type ReconciledRows = {rows: any[]; statuses: Map<string,unknown>};
export type MonthlySourceOptions={periodPolicy?:typeof JAN_SEP_POLICY};
/** Pure selection over frozen row values: descriptions and the old operation flag never override column D. */
export function selectOperationMonths(purchases: ReconciledRows, sales: ReconciledRows, issuerUf?: string, purchaseIssuerUf=issuerUf, options:MonthlySourceOptions={}): OperationMonthlyReport[] | null {
  if([...purchases.rows,...sales.rows].some(row=>!row.serviceDate))return null;
  const pp=reportPeriod(purchases.rows.map(row=>row.serviceDate)),sp=reportPeriod(sales.rows.map(row=>row.serviceDate));
  need(options.periodPolicy===JAN_SEP_POLICY||sameReportCompetences(pp,sp),`Compras e vendas cobrem competências diferentes pela coluna H (${pp.startMonth} a ${pp.endMonth} vs. ${sp.startMonth} a ${sp.endMonth}). Use arquivos com o mesmo mês/ano inicial e final.`,409,'SIMULATOR_PERIOD');
  const [year,month]=pp.startMonth.split('-').map(Number);
  const sourceMonths=options.periodPolicy===JAN_SEP_POLICY?[...new Set([...reportMonthsInPeriod(pp),...reportMonthsInPeriod(sp)])].sort():
    Array.from({length:pp.months},(_,index)=>new Date(Date.UTC(year,month-1+index,1)).toISOString().slice(0,7));
  const months: OperationMonthlyReport[]=sourceMonths.map(sourceMonth=>{
    const date=new Date(`${sourceMonth}-01T00:00:00.000Z`);
    return {sourceMonth:date.toISOString().slice(0,7),month:date.getUTCMonth()+1,
      fields:Object.fromEntries(MONTHLY_FIELDS.map(key=>[key,0])) as MonthlyReport['fields'],
      salesLines:0,purchaseLines:0,difal:null,operationVersion:OPERATION_CATALOG_VERSION,
      operationAudit:emptyAudit(),anticipation:summarizeAnticipation([],purchaseIssuerUf),
      icmsOperations:summarizeIcmsOperations({sourceMonth:date.toISOString().slice(0,7),purchases:[],sales:[],issuerUf,purchaseIssuerUf})};
  });
  const byMonth=new Map(months.map(row=>[row.sourceMonth,row]));
  const salesByMonth=new Map<string,any[]>(),purchasesByMonth=new Map<string,any[]>();
  const auditNatures=new Map<string,Map<string,NatureAudit>>(months.map(row=>[row.sourceMonth,new Map()]));
  for(const [data,mode] of [[purchases,PURCHASE_MODE],[sales,SALES_MODE]] as const){
    for(const row of data.rows){
      const target=byMonth.get(row.serviceDate?.slice(0,7));
      need(target,'Linha sem competência válida na coluna H. Reimporte o relatório.',409,'SIMULATION_MONTHS');
      const status=row.valid?data.statuses.get(row.cnpj):undefined;
      need(!row.valid||['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO'].includes(String(status)),'Enquadramento mensal não conciliado.',409,'SIMULATION_MONTHS');
      const natureCode=normalizeOperationNature(row.natureCode);
      need(natureCode.length===4,'O relatório não conserva os quatro dígitos da natureza em todas as linhas. Reimporte compras e vendas para aplicar o catálogo de operações; o histórico permanece disponível.',409,'SIMULATION_OPERATIONS');
      const operation=classifyOperationNature(natureCode),total=exactCents(row.totalCents),balance=exactSignedCents(row.balanceCents??total);
      const side=mode===SALES_MODE?'SALES':'PURCHASES',audit=target.operationAudit;
      const key=`${side}:${natureCode}`,natures=auditNatures.get(target.sourceMonth)!;
      const entry=natures.get(key)||{side,natureCode,operation,lines:0,sourceCents:0,sourceBalanceCents:0,salesCents:0,purchasesCents:0,salesReturnsCents:0,excludedCents:0};
      entry.lines++;entry.sourceCents=exactCents(entry.sourceCents+total);entry.sourceBalanceCents=exactSignedCents(entry.sourceBalanceCents+balance);natures.set(key,entry);
      const group=financialReportingStatus({...row,status},mode),salesGroup=financialReportingStatus({...row,status},SALES_MODE);
      const salesField=salesGroup==='CPF'?'salesCpfCents':salesGroup==='OPTANTE'?'salesOptantCents':'salesNonOptantCents';
      if(mode===SALES_MODE){
        target.salesLines++;
        audit.reportSalesCents=exactSignedCents(audit.reportSalesCents+balance);
        audit.reportSalesGrossCents=exactCents(audit.reportSalesGrossCents+total);
        audit.reportSalesBalanceAdjustmentCents=exactSignedCents(audit.reportSalesBalanceAdjustmentCents+balance-total);
        if(operation==='VENDA'||operation==='SERVICO_VENDA'){
          const field=operation==='SERVICO_VENDA'?'serviceRevenueCents':salesField;
          target.fields[field]=exactSignedCents(target.fields[field]+total);
          const auditField=operation==='SERVICO_VENDA'?'serviceSalesCents':'grossSalesCents';
          audit[auditField]=exactCents(audit[auditField]+total);entry.salesCents=exactCents(entry.salesCents+total);
        }else{
          audit.excludedSalesCents=exactCents(audit.excludedSalesCents+total);entry.excludedCents=exactCents(entry.excludedCents+total);
          if(operation==='NAO_CLASSIFICADA')audit.unknownSalesLines++;
        }
        const list=salesByMonth.get(target.sourceMonth)||[];list.push({...row,status});salesByMonth.set(target.sourceMonth,list);
      }else{
        target.purchaseLines++;
        audit.reportPurchasesCents=exactCents(audit.reportPurchasesCents+total);
        if(operation==='COMPRAS'||operation==='SERVICO_COMPRA'){
          const field=group==='OPTANTE'?'purchasesOptantCents':'purchasesNonOptantCents';
          target.fields[field]=exactCents(target.fields[field]+total);
          const auditField=operation==='SERVICO_COMPRA'?'purchaseServicesCents':'purchaseGoodsCents';
          audit[auditField]=exactCents(audit[auditField]+total);entry.purchasesCents=exactCents(entry.purchasesCents+total);
        }else if(operation==='DEVOLUCAO_VENDA'){
          target.fields[salesField]=exactSignedCents(target.fields[salesField]-total);
          audit.salesReturnsCents=exactCents(audit.salesReturnsCents+total);entry.salesReturnsCents=exactCents(entry.salesReturnsCents+total);
        }else{
          audit.excludedPurchaseCents=exactCents(audit.excludedPurchaseCents+total);entry.excludedCents=exactCents(entry.excludedCents+total);
          if(operation==='NAO_CLASSIFICADA')audit.unknownPurchaseLines++;
        }
        const list=purchasesByMonth.get(target.sourceMonth)||[];list.push({...row,status,creditGroup:group});purchasesByMonth.set(target.sourceMonth,list);
      }
    }
  }
  for(const month of months){
    if(options.periodPolicy===JAN_SEP_POLICY)month.commercialComposition=summarizeCommercialMonth(month.sourceMonth,
      purchasesByMonth.get(month.sourceMonth)||[],salesByMonth.get(month.sourceMonth)||[]);
    month.operationAudit.natures=[...auditNatures.get(month.sourceMonth)!.values()].sort((a,b)=>natureKey(a).localeCompare(natureKey(b)));
    month.difal=summarizeDifal((salesByMonth.get(month.sourceMonth)||[]).map(row=>({...row,operation:salesOperation(row.natureCode,'')})),issuerUf);
    month.anticipation=summarizeAnticipation(purchasesByMonth.get(month.sourceMonth)||[],purchaseIssuerUf);
    month.icmsOperations=summarizeIcmsOperations({sourceMonth:month.sourceMonth,purchases:purchasesByMonth.get(month.sourceMonth)||[],
      sales:salesByMonth.get(month.sourceMonth)||[],issuerUf,purchaseIssuerUf});
    const audit=month.operationAudit;
    need(exactSignedCents(audit.grossSalesCents+audit.serviceSalesCents+audit.excludedSalesCents+audit.reportSalesBalanceAdjustmentCents)===audit.reportSalesCents&&
      exactCents(audit.purchaseGoodsCents+audit.purchaseServicesCents+audit.salesReturnsCents+audit.excludedPurchaseCents)===audit.reportPurchasesCents,
    'A seleção das naturezas não concilia com os relatórios originais.',409,'SIMULATION_OPERATIONS');
  }
  return months;
}

/** Read only reconciled server snapshots; classification remains the lookup captured in each job. */
export async function monthlyReportSource(purchases: any, sales: any, _currentSalesRows?: any[], issuerUf?: string, options:MonthlySourceOptions={}): Promise<OperationMonthlyReport[] | null> {
  const read = async (summary: any): Promise<ReconciledRows> => {
    const [rows, items] = await Promise.all([
      (await jobCollection('purchaseLines',summary.job)).find(scope({jobId:summary.job._id})).sort({index:1}).maxTimeMS(20000).toArray(),
      (await jobCollection('lookupItems',summary.job)).find(scope({jobId:summary.job._id})).project({cnpj:1,status:1}).maxTimeMS(20000).toArray()
    ]);
    need(rows.length===summary.totals.lines&&rows.every((row,index)=>row.index===index),'Linhas mensais incompletas. Reimporte o relatório.',409,'SIMULATION_MONTHS');
    need(rows.reduce((total,row)=>exactSignedCents(total+(row.balanceCents??row.totalCents)),0)===summary.totals.totalCents,
      'O total mensal diverge do relatório conciliado.',409,'SIMULATION_MONTHS');
    return {rows,statuses:new Map(items.map(item=>[item.cnpj,item.status]))};
  };
  const [p,s]=await Promise.all([read(purchases),read(sales)]);
  const purchaseUf=normalizeUf(purchases.job.issuerUf),salesUf=normalizeUf(sales.job.issuerUf);
  need(!purchaseUf||!salesUf||purchaseUf===salesUf,'As UFs da empresa nos relatórios de compras e vendas divergem. Revise os arquivos.',409,'SIMULATION_OPERATIONS');
  // A versioned purchase estimate must retain its own confirmed UF, including
  // an explicitly missing UF. Sales cannot silently resolve its pending rows.
  const anticipationUf=isAnticipationVersion(purchases.anticipation?.version)||isAnticipationVersion(purchases.job.anticipationVersion)?purchaseUf:purchaseUf||normalizeUf(issuerUf)||salesUf;
  return selectOperationMonths(p,s,normalizeUf(issuerUf)||salesUf,anticipationUf,options);
}
