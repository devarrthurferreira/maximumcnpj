export const PROJECTION_VERSION: 'AVERAGE_X12_V1';
export const PROJECTION_MONTHS: 12;
export type ReportGroup = 'salesOptantCents' | 'salesNonOptantCents' | 'salesCpfCents' | 'purchasesOptantCents' | 'purchasesNonOptantCents';
export const REPORT_GROUPS: readonly ReportGroup[];
export type ProjectionAmount = {totalCents: number; monthlyCents: number; annualCents: number};
export type ReportProjection = {
  version: string; method: string; unit: 'CENTS'; reportMonths: number; projectionMonths: 12; rounding: string;
  monthlyGroupsCents: Record<ReportGroup, number>; annualGroupsCents: Record<ReportGroup, number>;
  groups: Array<ProjectionAmount & {key: ReportGroup}>;
  totals: {sales: ProjectionAmount; purchases: ProjectionAmount};
  timeline: Array<{month: number; salesCents: number; purchasesCents: number}>;
};
export type ScenarioAmounts = {salesCents: number; servicesCents: number; revenueCents: number; purchasesCents: number; expensesCents: number};
export type ScenarioProjection = {
  unit: 'CENTS'; projectionMonths: 12; monthlyGroupsCents: Record<ReportGroup, number>;
  annualGroupsCents: Record<ReportGroup, number>; monthly: ScenarioAmounts; annual: ScenarioAmounts;
};
export function annualizeReports(fields: Record<ReportGroup, number>, reportMonths: number): ReportProjection;
export function projectScenario(monthlyGroups: Record<ReportGroup, number>, values: Record<string, number>): ScenarioProjection;
