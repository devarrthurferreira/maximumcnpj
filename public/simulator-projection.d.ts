export const PROJECTION_VERSION: 'AVERAGE_X12_V2';
export const DIFAL_PROJECTION_VERSION: 'DIFAL_DRE_V1';
export const PROJECTION_MONTHS: 12;
export type ReportGroup = 'salesOptantCents' | 'salesNonOptantCents' | 'salesCpfCents' | 'purchasesOptantCents' | 'purchasesNonOptantCents';
export const REPORT_GROUPS: readonly ReportGroup[];
export type ProjectionAmount = {totalCents: number; monthlyCents: number; annualCents: number};
export type ReportFields = Record<ReportGroup, number> & {serviceRevenueCents?: number};
export type DifalProjection = {
  version: 'DIFAL_DRE_V1'; sourceJobId: string; sourceVersion: string; sourceAmountCents: number; sourceBaseCents: number;
  reportMonths: number; ratePercent: 10; pendingLines: number; eligibleLines: number; issuerUf: string;
  monthlyCents: number; annualCents: number;
};
export type ReportProjection = {
  version: string; method: string; unit: 'CENTS'; reportMonths: number; projectionMonths: 12; rounding: string;
  monthlyGroupsCents: ReportFields; annualGroupsCents: ReportFields;
  groups: Array<ProjectionAmount & {key: ReportGroup | 'serviceRevenueCents'}>;
  totals: {sales: ProjectionAmount; purchases: ProjectionAmount};
  timeline: Array<{month: number; salesCents: number; purchasesCents: number}>;
};
export type ScenarioAmounts = {salesCents: number; servicesCents: number; revenueCents: number; purchasesCents: number; expensesCents: number};
export type ScenarioProjection = {
  unit: 'CENTS'; projectionMonths: 12; monthlyGroupsCents: Record<ReportGroup, number>;
  annualGroupsCents: Record<ReportGroup, number>; monthly: ScenarioAmounts; annual: ScenarioAmounts;
};
export function annualizeReports(fields: ReportFields, reportMonths: number): ReportProjection;
export function projectDifal(summary: {version: string; ratePercent: number; issuerUf: string; amountCents: number; baseCents: number; pendingLines: number; eligibleLines: number} | null | undefined, reportMonths: number, sourceJobId: string): DifalProjection | null;
export function projectScenario(monthlyGroups: Record<ReportGroup, number>, values: Record<string, number>): ScenarioProjection;
