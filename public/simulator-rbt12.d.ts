export const RBT12_SCHEDULE_VERSION:'RBT12_MONTHLY_SECTION_22_V1';
export type Section22Revenue={period:string;month:string;internalCents:number;externalCents:number;totalCents:number;usedInRbt12:boolean};
export type Rbt12ScheduleRow={sourceMonth:string;status:'CONFIRMED'|'MISSING_MONTHS';rbt12Cents:number|null;startMonth:string;endMonth:string;missingMonths:string[];window:Section22Revenue[]};
export type Rbt12Schedule={version:typeof RBT12_SCHEDULE_VERSION;source:'SIMPLES_SECTION_22';sourceSection:'2.2';pa:string;complete:boolean;rows:Rbt12ScheduleRow[]};
export type Section22Reconciliation={priorRevenues:Section22Revenue[];rbt12Window:Section22Revenue[];rbt12Cents:number;
  rbt12Basis:{section:string;months:number;startMonth:string;endMonth:string;internalCents:number;externalCents:number;totalCents:number}};
export function section22RevenueHistory(extraction:any):Section22Revenue[];
export function reconcileSection22Extraction(extraction:any):Section22Reconciliation;
export function buildRbt12Schedule(extraction:any,sourceMonths:string[]):Rbt12Schedule;
