import type {AnalysisPeriod} from './analysis-period.js';
export const REVENUE_RECONCILIATION_VERSION: 'REVENUE_RECONCILIATION_V1';
export type RevenueMonth = {sourceMonth:string;grossSalesCents:number;serviceSalesCents:number;salesReturnsCents:number;grossRevenueCents:number;revenueAfterReturnsCents:number};
export type RevenueMetadata = {analysisPeriod?:AnalysisPeriod;generationId?:string;clientId?:string;purchaseJobId?:string;salesJobId?:string};
export type RevenueReconciliation = RevenueMetadata & {
  version:typeof REVENUE_RECONCILIATION_VERSION; status:'AVAILABLE'|'PENDING'|'UNAVAILABLE'; available:boolean; reason:string|null;
  period?:{startMonth:string;endMonth:string;months:number};monthly:RevenueMonth[];
  grossSalesCents?:number;serviceSalesCents?:number;grossRevenueCents?:number;salesReturnsCents?:number;revenueAfterReturnsCents?:number;
  manualAdjustmentCents?:number;usedRevenueCents?:number;
};
export function unavailableRevenueReconciliation(reason:string,data?:RevenueMetadata,status?:string):RevenueReconciliation;
export function reconcileRevenueMonths(rows:({sourceMonth:string;grossSalesCents:number;serviceSalesCents:number;salesReturnsCents:number}&Partial<RevenueMonth>)[],data?:RevenueMetadata):RevenueReconciliation;
export function buildRevenueReconciliation(options?:{source?:any;sourceMonth?:string|null;scenarioRevenueCents?:number|null}):RevenueReconciliation;
