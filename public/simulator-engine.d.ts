/** Types for the shared, dependency-free calculator used by browser and server. */
export const MODEL_VERSION: string;
export const ICMS_ANTICIPATION_VERSION: 'ICMS_ANTICIPATION_DRE_V1';
export const DIFAL_POLICY_VERSION: 'DIFAL_SCENARIOS_V1';
export type SimulationRegimeId = 'pure' | 'hybrid' | 'presumed' | 'actual';
export type DifalPolicy = {version:'DIFAL_SCENARIOS_V1';enabled:Record<SimulationRegimeId,boolean>};
export type DifalApplication = {
  version:'DIFAL_SCENARIOS_V1'; enabled:boolean; blocked:boolean;
  reason:'SUBLIMIT'|'ICMS_OUTSIDE_DAS'|'USER_EXCLUDED'|'ENABLED'; message:string;
  rbt12:number; icmsOutside:boolean;
  /** Potential permission, independent of missing sources, pending lines or zero amounts. */
  salesDifal:boolean; purchaseAnticipation:boolean;
};
export function defaultDifalPolicy(): DifalPolicy;
export function parseDifalPolicy(value:unknown): DifalPolicy;
export function resolveDifalApplication(input:{policy?:DifalPolicy;regimeId:SimulationRegimeId;rbt12:number;icmsOutside?:boolean}): DifalApplication;
export const CALCULATOR_SOURCE_COMMIT: string;
export const TAX_SOURCES: ReadonlyArray<{label: string; url: string}>;
export const SIMULATION_VALUE_FIELDS: readonly SimulationValueField[];
export type SimulationValueField = 'serviceRevenue' | 'salesRevenue' | 'simplePurchases' | 'regularPurchases' |
  'salaries' | 'benefits' | 'adminExpenses' | 'rent' | 'cardExpenses';
export type SimulationDraft = {
  year: 2027 | 2028;
  salesAnnex: 1 | 2;
  serviceAnnex: 3 | 4 | 5;
  /** Opcional apenas para reabrir snapshots legados; novas simulações enviam RBT12 explícita. */
  rbt12?: number;
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
  difalApplication?: DifalApplication | {version:'DIFAL_SCENARIOS_V1';enabled:boolean;months:Array<DifalApplication & {sourceMonth:string}>};
};
export type SimulationResult = {
  version: string; annualRevenue: number; regimes: SimulationRegime[];
  credits: Record<string, Record<string, number>>;
  warnings: Array<{code: string; severity: string; title: string; detail: string}>;
  memory: Array<{id: string; section: string; label: string; formula: string; value: number | string; unit: string}>;
  bestRegimeId: string | null; difference: number;
  difalPolicy?: DifalPolicy;
};
export function draftToInput(draft: SimulationDraft, difalProjection?: import('./simulator-projection.js').DifalProjection | null, anticipationProjection?: IcmsAnticipationProjection | null): Record<string, unknown> | null;
export function calculateSimulation(draft: SimulationDraft, difalProjection?: import('./simulator-projection.js').DifalProjection | null, anticipationProjection?: IcmsAnticipationProjection | null): SimulationResult;
