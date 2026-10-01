export const CALENDAR_VERSION: 'DRE_CALENDAR_V1';
export const MONTH_NAMES: readonly string[];
export const DRE_ROWS: readonly (readonly string[])[];
export type MonthlyDre = {
  version: string; year: number; unit: string; method: string; reportPeriod: unknown;
  rbt12Reference: any; months: Array<{number:number;label:string;period:string}>; rounding:string;
  regimes:Array<{id:string;name:string;available:boolean;rows:Array<{key:string;label:string;annual:number|null;months:(number|null)[]}>}>;
};
export function buildMonthlyDre(result: any, year: number, reference?: any, reportPeriod?: unknown): MonthlyDre;
