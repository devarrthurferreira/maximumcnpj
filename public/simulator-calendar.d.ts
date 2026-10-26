export const CALENDAR_VERSION: 'DRE_CALENDAR_V2';
export const MONTH_NAMES: readonly string[];
export const DRE_ROWS: readonly (readonly string[])[];
export function dreRows(result: any): readonly (readonly string[])[];
export type MonthlyDre = {
  version: string; year: number; unit: string; method: string; reportPeriod: unknown;
  regimeSelection?: import('./regime-selection.js').RegimeSelection;
  rbt12Reference: any; rbt12Schedule?: import('./simulator-rbt12.js').Rbt12Schedule;
  months: Array<{number:number;label:string;period:string;sourceMonth?:string|null;rbt12Cents?:number|null}>; rounding:string;
  regimes:Array<{id:string;name:string;available:boolean;rows:Array<{key:string;label:string;annual:number|null;months:(number|null)[]}>}>;
};
export function buildMonthlyDre(result: any, year: number, reference?: any, reportPeriod?: unknown): MonthlyDre;
