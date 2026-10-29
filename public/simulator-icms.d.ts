export const ICMS_OPERATIONS_VERSION:'ICMS_OPERATIONS_V1';
export const ICMS_INTERNAL_RATE_PERCENT:18;
export const ICMS_INTERSTATE_RATE_PERCENT:12;
export type IcmsOperationBucket={internalBaseCents:number;interstateBaseCents:number;pendingBaseCents:number;internalTaxCents:number;interstateTaxCents:number;totalBaseCents:number;taxCents:number;eligibleLines:number;pendingLines:number};
export type IcmsOperations={version:'ICMS_OPERATIONS_V1';sourceMonth:string;issuerUf:string;purchaseIssuerUf:string;internalRatePercent:18;interstateRatePercent:12;
  sales:IcmsOperationBucket;purchases:IcmsOperationBucket;salesReturns:IcmsOperationBucket;excludedServicePurchasesCents:number;excludedSimplePurchasesCents:number;sourceRegularPurchasesCents:number};
export function summarizeIcmsOperations(input:{sourceMonth:string;purchases:ReadonlyArray<{natureCode?:unknown;totalCents:number;recipientUf?:unknown;creditGroup?:unknown}>;
  sales:ReadonlyArray<{natureCode?:unknown;totalCents:number;recipientUf?:unknown}>;issuerUf?:unknown;purchaseIssuerUf?:unknown}):IcmsOperations;
export function parseIcmsOperations(value:unknown):IcmsOperations;
export function projectIcmsOperations(value:unknown,input:{salesRevenueCents:number;regularPurchasesCents:number}):{
  source:IcmsOperations;available:boolean;status:string;pendingLines:number;missingSalesMix:boolean;grossSalesCents:number;unflooredGrossSalesCents:number;grossSalesFloorApplied:boolean;sourceNetSalesCents:number;salesAdjustmentCents:number;purchaseAdjustmentCents:number;
  debitCents:number;purchaseCreditCents:number;salesReturnCreditCents:number;potentialCents:number;usedCents:number;dueCents:number;balanceCents:number};
