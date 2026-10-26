/** Types for the shared, dependency-free calculator used by browser and server. */
import type {RegimeId,RegimeSelection} from './regime-selection.js';
export const MODEL_VERSION: string;
export const SIMPLES_DIAGNOSTIC_VERSION:'SIMPLES_DIAGNOSTIC_V1';
export const REVENUE_CONTEXT_VERSION:'SIMPLES_REVENUE_CONTEXT_V1';
/** Derived by the monthly calculation from validated rows; never accepted in a draft. */
export type SimplesRevenueContext={version:'SIMPLES_REVENUE_CONTEXT_V1';method:'ACTUAL_REPORT_MONTHS';revenueCents:number;sourceMonths:string[]};
export type SimplesDiagnostic={
  version:'SIMPLES_DIAGNOSTIC_V1';available:boolean;
  statusCode:'READY'|'ZERO_REVENUE'|'MISSING_RBT12'|'RATE_TABLE_EXCEEDED'|'LOCAL_TAX_REVIEW_REQUIRED'|'REVENUE_REVIEW_REQUIRED'|'ICMS_OPERATIONS_PENDING'|'MULTIPLE_MONTH_STATUSES';
  message:string;action:string;rbt12:number|null;rbt12Min?:number;rbt12Max?:number;
  federalLimit:number;sublimit:number;revenueReference:number;revenueBasis:'ACTUAL_REPORT_MONTHS'|'AVERAGE_X12';
  sourceMonths:string[];coveredMonths:number;completeYear:boolean;icmsOutside:boolean;eligibilityVerified:false;assumptions:string[];
  months?:Array<SimplesDiagnostic & {sourceMonth:string}>;
};
export const ICMS_ANTICIPATION_VERSION: 'ICMS_ANTICIPATION_DRE_V1';
export const DIFAL_POLICY_VERSION: 'DIFAL_SCENARIOS_V2';
export type SimulationRegimeId = RegimeId;
export type DifalOperations = {entry:boolean;exit:boolean};
export type LegacyDifalPolicy = {version:'DIFAL_SCENARIOS_V1';enabled:Record<SimulationRegimeId,boolean>};
export type CurrentDifalPolicy = {version:'DIFAL_SCENARIOS_V2';enabled:{pure:boolean;hybrid:boolean;presumed:false;actual:false};operations:Record<'pure'|'hybrid',DifalOperations>};
export type DifalPolicy = LegacyDifalPolicy | CurrentDifalPolicy;
export type DifalApplication = {
  version:'DIFAL_SCENARIOS_V1'|'DIFAL_SCENARIOS_V2'; enabled:boolean; blocked:boolean;
  /** V1 historical applications predate independent directions. */
  operations?:DifalOperations;
  reason:'SUBLIMIT'|'ICMS_OUTSIDE_DAS'|'USER_EXCLUDED'|'ENABLED'|'NOT_APPLICABLE'|'NO_OPERATIONS'; message:string;
  rbt12:number|null; icmsOutside:boolean;
  /** Potential permission, independent of missing sources, pending lines or zero amounts. */
  salesDifal:boolean; purchaseAnticipation:boolean;
};
export function defaultDifalPolicy(): CurrentDifalPolicy;
export function parseDifalPolicy(value:unknown): DifalPolicy;
export function upgradeDifalPolicy(value?:unknown): CurrentDifalPolicy;
export function resolveDifalApplication(input:{policy?:DifalPolicy;regimeId:SimulationRegimeId;rbt12:number|null;icmsOutside?:boolean}): DifalApplication & {version:'DIFAL_SCENARIOS_V2';operations:DifalOperations};
export const CALCULATOR_SOURCE_COMMIT: string;
export const TAX_SOURCES: ReadonlyArray<{label: string; url: string}>;
export const SIMULATION_VALUE_FIELDS: readonly SimulationValueField[];
export type SimulationValueField = 'serviceRevenue' | 'salesRevenue' | 'simplePurchases' | 'regularPurchases' |
  'salaries' | 'benefits' | 'adminExpenses' | 'rent' | 'cardExpenses';
export type SimulationDraft = {
  year: 2027 | 2028;
  salesAnnex: 1 | 2;
  serviceAnnex: 3 | 4 | 5;
  /** Required for an explicit selection containing Simples; unnecessary for LP/LR alone. */
  rbt12?: number|null;
  /** Omission preserves the four historical regimes. New analyses store an explicit selection. */
  regimeSelection?: RegimeSelection;
  /** User-confirmed local tax treatment. Absence preserves the historical inside-DAS premise. */
  icmsOutside?: boolean;
  difalPolicy?: DifalPolicy;
  values: Record<SimulationValueField, number>;
};
/** Server-owned estimate from confirmed interstate purchases; never inferred from edited CMV. */
export type IcmsAnticipationProjection = {
  version: 'ICMS_ANTICIPATION_DRE_V1'; monthlyCents: number; annualCents: number;
  sourceBaseCents?: number; sourceAmountCents?: number; reportMonths?: number;
  pendingLines?: number; eligibleLines?: number; ratePercent?: 7.32;
  sourceJobId?: string; sourceVersion?: string; issuerUf?: string;
};
export type SimulationRegime = {
  id: string; name: string; available: boolean; status: string; annualProfit: number; monthlyProfit: number;
  margin: number | null; totalTaxes: number; taxBurden: number | null; dre: Record<string, number>;
  difalApplication?: DifalApplication | {version:'DIFAL_SCENARIOS_V1'|'DIFAL_SCENARIOS_V2';enabled:boolean;operations?:DifalOperations;months:Array<DifalApplication & {sourceMonth:string}>};
};
export type SimulationResult = {
  version: string; annualRevenue: number; regimes: SimulationRegime[];
  credits: Record<string, Record<string, number>>;
  warnings: Array<{code: string; severity: string; title: string; detail: string}>;
  memory: Array<{id: string; section: string; label: string; formula: string; value: number | string; unit: string;availability?:'UNAVAILABLE'}>;
  bestRegimeId: string | null; difference: number;
  difalPolicy?: DifalPolicy;
  simplesDiagnostic?: SimplesDiagnostic;
  /** Omitted only in snapshots created before regime selection. */
  regimeSelection?: RegimeSelection;
};
export function draftToInput(draft: SimulationDraft, difalProjection?: import('./simulator-projection.js').DifalProjection | null, anticipationProjection?: IcmsAnticipationProjection | null, revenueContext?: SimplesRevenueContext|null,icmsOperations?:import('./simulator-icms.js').IcmsOperations|null): Record<string, unknown> | null;
export function calculateSimulation(draft: SimulationDraft, difalProjection?: import('./simulator-projection.js').DifalProjection | null, anticipationProjection?: IcmsAnticipationProjection | null, revenueContext?: SimplesRevenueContext|null,icmsOperations?:import('./simulator-icms.js').IcmsOperations|null): SimulationResult;
