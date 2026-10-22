import {isPurchaseOperation} from './operation-catalog.ts';
import {normalizeUf} from './difal.ts';

/** Fixed managerial purchase rule requested by Maximum. Not a statutory rate lookup. */
export const ANTICIPATION_VERSION = 'ICMS_ANTICIPATION_V2';
export const ANTICIPATION_LEGACY_VERSION = 'ICMS_ANTICIPATION_V1';
export type AnticipationVersion = typeof ANTICIPATION_VERSION | typeof ANTICIPATION_LEGACY_VERSION;
export type AnticipationOrigin = 'IMPORTED' | 'DERIVED_FROM_SNAPSHOT' | 'UNAVAILABLE';
export function isAnticipationVersion(value:unknown):value is AnticipationVersion {
  return value===ANTICIPATION_VERSION||value===ANTICIPATION_LEGACY_VERSION;
}
export const ANTICIPATION_RATE_PERCENT = 7.32;
export type AnticipationReason = 'ELIGIBLE' | 'NOT_PURCHASE' | 'NOT_CPF' | 'MISSING_ISSUER_UF' | 'MISSING_RECIPIENT_UF' | 'SAME_UF' | 'INVALID_TOTAL';
export type AnticipationResult = {eligible:boolean; baseCents:number; amountCents:number; reason:AnticipationReason};
export type AnticipationInput = {totalCents:unknown; natureCode?:unknown; document?:unknown; issuerUf?:unknown; recipientUf?:unknown};
export function calculateAnticipation(input:AnticipationInput,version:AnticipationVersion=ANTICIPATION_VERSION):AnticipationResult {
  if(!isAnticipationVersion(version))throw new TypeError('Versão da antecipação de ICMS desconhecida.');
  const rejected = (reason:AnticipationReason):AnticipationResult => ({eligible:false,baseCents:0,amountCents:0,reason});
  if (typeof input.totalCents !== 'number' || !Number.isSafeInteger(input.totalCents) || input.totalCents < 0) return rejected('INVALID_TOTAL');
  if (!isPurchaseOperation(input.natureCode)) return rejected('NOT_PURCHASE');
  const document=String(input.document??'').trim().replace(/[.\/\-\s]/g,'');
  if(version===ANTICIPATION_VERSION&&!/^\d{11}$/.test(document))return rejected('NOT_CPF');
  const issuerUf=normalizeUf(input.issuerUf), recipientUf=normalizeUf(input.recipientUf);
  if (!issuerUf) return rejected('MISSING_ISSUER_UF');
  if (!recipientUf) return rejected('MISSING_RECIPIENT_UF');
  if (issuerUf===recipientUf) return rejected('SAME_UF');
  // 7.32% = 732/10000. Round half up per imported line in integer cents.
  const amountCents=Number((BigInt(input.totalCents)*732n+5000n)/10000n);
  return {eligible:true,baseCents:input.totalCents,amountCents,reason:'ELIGIBLE'};
}
export function isPendingAnticipation(result:Pick<AnticipationResult,'reason'>):boolean {
  return result.reason==='MISSING_ISSUER_UF'||result.reason==='MISSING_RECIPIENT_UF';
}
export type AnticipationSummary = {version:AnticipationVersion; ratePercent:typeof ANTICIPATION_RATE_PERCENT; issuerUf:string; eligibleLines:number; baseCents:number; amountCents:number; pendingLines:number};
export function summarizeAnticipation(rows:Iterable<Omit<AnticipationInput,'issuerUf'>>,issuerUf:unknown,version:AnticipationVersion=ANTICIPATION_VERSION):AnticipationSummary {
  if(!isAnticipationVersion(version))throw new TypeError('Versão da antecipação de ICMS desconhecida.');
  const summary:AnticipationSummary={version,ratePercent:ANTICIPATION_RATE_PERCENT,issuerUf:normalizeUf(issuerUf),eligibleLines:0,baseCents:0,amountCents:0,pendingLines:0};
  for (const row of rows) {
    const result=calculateAnticipation({...row,issuerUf},version);
    summary.eligibleLines+=Number(result.eligible);
    summary.pendingLines+=Number(isPendingAnticipation(result));
    summary.baseCents+=result.baseCents; summary.amountCents+=result.amountCents;
    if (!Number.isSafeInteger(summary.baseCents)||!Number.isSafeInteger(summary.amountCents)) throw new RangeError('Soma da antecipação de ICMS acima do limite seguro.');
  }
  return summary;
}
