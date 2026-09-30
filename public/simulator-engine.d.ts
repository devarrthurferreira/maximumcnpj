/** Types for the shared, dependency-free calculator used by browser and server. */
export const MODEL_VERSION: string;
export const CALCULATOR_SOURCE_COMMIT: string;
export const TAX_SOURCES: ReadonlyArray<{label: string; url: string}>;
export const SIMULATION_VALUE_FIELDS: readonly SimulationValueField[];
export type SimulationValueField = 'serviceRevenue' | 'salesRevenue' | 'simplePurchases' | 'regularPurchases' |
  'salaries' | 'benefits' | 'adminExpenses' | 'rent' | 'cardExpenses';
export type SimulationDraft = {
  year: 2027 | 2028;
  salesAnnex: 1 | 2;
  serviceAnnex: 3 | 4 | 5;
  values: Record<SimulationValueField, number>;
};
export type SimulationRegime = {
  id: string; name: string; available: boolean; status: string; annualProfit: number; monthlyProfit: number;
  margin: number | null; totalTaxes: number; taxBurden: number | null; dre: Record<string, number>;
};
export type SimulationResult = {
  version: string; annualRevenue: number; regimes: SimulationRegime[];
  credits: Record<string, Record<string, number>>;
  warnings: Array<{code: string; severity: string; title: string; detail: string}>;
  memory: Array<{id: string; section: string; label: string; formula: string; value: number | string; unit: string}>;
  bestRegimeId: string | null; difference: number;
};
export function draftToInput(draft: SimulationDraft): Record<string, unknown> | null;
export function calculateSimulation(draft: SimulationDraft): SimulationResult;
