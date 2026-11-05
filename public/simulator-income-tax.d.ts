export const INCOME_TAX_ASSESSMENT_VERSION: 'INCOME_TAX_ASSESSMENT_V2';
export const INCOME_TAX_METHOD: 'QUARTERLY_CUMULATIVE_PROVISION';
export const INCOME_TAX_MODEL_VERSION: '1.23.0-quarterly-income-tax-nfce-interna';
export type ExactAmount = {numerator:string;denominator:string};
export type IncomeTaxAmounts = {irpjNormalCents:number;irpjAdditionalCents:number;irpjTotalCents:number;csllCents:number};
export type IncomeTaxMonthInput = {sourceMonth:string;month:number;salesRevenue:number;serviceRevenue:number;preTax:number|null;preTaxExact?:ExactAmount;actualAvailable?:boolean;actualReason?:string};
export type IncomeTaxBases = {
  salesRevenue:number;serviceRevenue:number;revenue:number;preTax:number|null;
  irpjBaseWithoutIncrease:number;csllBaseWithoutIncrease:number;irpjIncrease:number;csllIncrease:number;
  irpjBase:number;csllBase:number;irpjAdditionalLimit:number;irpjBaseWithinLimit:number;irpjExcessBase:number;
};
export type IncomeTaxClosure = {available:boolean;status:'CONFIRMED'|'UNAVAILABLE';reason:string;taxes:IncomeTaxAmounts|null};
export type IncomeTaxLc224 = {
  applicable:boolean;scenarioYear:number;quarterLimit:number;annualLimit:number;priorHistoryComplete:boolean;
  carryIn:number|null;allowance:number|null;excessRevenue:number|null;carryOut:number|null;
  annualAdjustmentApplied:boolean;originalExcessRevenue?:number|null;
};
export type IncomeTaxPeriod = {
  regimeId:'presumed'|'actual';quarter:1|2|3|4;periodId:string;sourceQuarter:string|null;throughMonth:number;
  expectedMonths:number[];observedMonths:number[];missingMonths:number[];sourceMonths:string[];
  inputs:IncomeTaxMonthInput[];complete:boolean;available:boolean;status:'CONFIRMED'|'PROVISIONAL'|'UNAVAILABLE';reason:string;
  bases:IncomeTaxBases|null;exactBases:Record<'irpjBase'|'irpjExcessBase'|'csllBase'|'preTax',ExactAmount|null>|null;
  provision:IncomeTaxAmounts|null;closure:IncomeTaxClosure;lc224:IncomeTaxLc224|null;
};
export type IncomeTaxAssessment = {
  available:boolean;status:'CONFIRMED'|'PROVISIONAL'|'UNAVAILABLE';reason:string;
  scope:'QUARTER'|'PERIOD'|'ANNUAL_ADJUSTMENT';complete:boolean;periods:IncomeTaxPeriod[];
  bases:IncomeTaxBases|null;provision:IncomeTaxAmounts|null;previousProvision:IncomeTaxAmounts|null;movement:IncomeTaxAmounts|null;
  closure:IncomeTaxClosure;annualAdjustmentApplied:boolean;
};
export type IncomeTaxAssessmentContainer = {
  version:'INCOME_TAX_ASSESSMENT_V2';method:'QUARTERLY_CUMULATIVE_PROVISION';frame:'CONSOLIDATED'|'MONTH';
  scenarioYear:2027|2028;sourceMonths:string[];rounding:'HALF_UP_COMPONENT_CENTS';
  presumptionRates:{irSales:number;irServices:number;csSales:number;csServices:number};
  basis:'ACTUAL_REPORT_MONTHS'|'UNIFORM_PROJECTION';realAnnualLossZero?:'JAN_SEP_MANAGERIAL_V1';regimes:Partial<Record<'presumed'|'actual',IncomeTaxAssessment>>;
  /** Only uniform projections capture their monthly movements here. */
  monthlyAssessments?:Record<string,IncomeTaxAssessmentContainer>;
};
/** Exact decimal half-up; the returned number is an integer number of cents. */
export function incomeTaxRoundCents(value:number|string|ExactAmount):number;
/** Decimal operands captured by the existing model; no income-tax computation. */
export function incomeTaxPreTaxExact(input:any,icmsDueCents?:number|null):ExactAmount;
export function assessQuarterlyIncomeTaxes(input:{year:2027|2028;months:IncomeTaxMonthInput[];rates?:{irSales:number;irServices:number;csSales:number;csServices:number};regimeIds?:Array<'presumed'|'actual'>;basis?:'ACTUAL_REPORT_MONTHS'|'UNIFORM_PROJECTION';annualLossZeroForReal?:boolean}):{
  incomeTaxAssessment:IncomeTaxAssessmentContainer;
  monthlyAssessments:Record<string,IncomeTaxAssessmentContainer>;
};
