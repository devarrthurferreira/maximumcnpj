export const MONTHLY_MODEL_VERSION: '1.3.0-report-months';
import type {ReportFields} from './simulator-projection.js';
export const MONTHLY_VERSION: 'REPORT_MONTHS_V1';
export const MONTHLY_FIELDS: readonly string[];
export type MonthlyReport = {sourceMonth:string;month:number;fields:ReportFields & {serviceRevenueCents:number};salesLines:number;purchaseLines:number;difal:any};
export function monthlyProjection(reports:MonthlyReport[]):any;
export function monthlyDifal(reports:MonthlyReport[],sourceJobId:string):any;
export function baselineMonth(row:MonthlyReport,expenses?:Record<string,number>):any;
export function calculateMonthlySimulation(draft:any,reports:MonthlyReport[],inputs:any[],sourceJobId:string):any;
