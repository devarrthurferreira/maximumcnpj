import {classifyOperationNature} from './operation-catalog.js';
import {normalizeUf} from './difal.js';

/** Maximum's managerial ICMS premise; invoice-specific legal rates are not inferred. */
export const ICMS_OPERATIONS_VERSION='ICMS_OPERATIONS_V1';
export const ICMS_INTERNAL_RATE_PERCENT=18;
export const ICMS_INTERSTATE_RATE_PERCENT=12;
const BUCKET_FIELDS=['internalBaseCents','interstateBaseCents','pendingBaseCents','internalTaxCents','interstateTaxCents','totalBaseCents','taxCents','eligibleLines','pendingLines'];
const GROUPS=['sales','purchases','salesReturns'];
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const cents=value=>Number.isSafeInteger(value)&&value>=0;
const add=(a,b)=>{const value=a+b;check(cents(value),'Base de ICMS acima do limite seguro.');return value;};
const roundRatio=(value,numerator,denominator)=>{
  check(cents(value)&&cents(numerator)&&Number.isSafeInteger(denominator)&&denominator>0,'Proporção de ICMS inválida.');
  const result=Number((BigInt(value)*BigInt(numerator)+BigInt(denominator)/2n)/BigInt(denominator));
  check(cents(result),'Valor de ICMS acima do limite seguro.');return result;
};
const emptyBucket=()=>Object.fromEntries(BUCKET_FIELDS.map(key=>[key,0]));
function addOperation(bucket,row,issuerUf){
  const total=row.totalCents;
  check(cents(total),'A operação de ICMS exige centavos inteiros não negativos.');
  bucket.totalBaseCents=add(bucket.totalBaseCents,total);
  const recipientUf=normalizeUf(row.recipientUf);
  // A zero-valued operation cannot create tax or an artificial pending tax amount.
  if(!total)return;
  if(!issuerUf||!recipientUf){
    bucket.pendingBaseCents=add(bucket.pendingBaseCents,total);bucket.pendingLines++;return;
  }
  const interstate=issuerUf!==recipientUf,prefix=interstate?'interstate':'internal';
  const tax=roundRatio(total,interstate?ICMS_INTERSTATE_RATE_PERCENT:ICMS_INTERNAL_RATE_PERCENT,100);
  bucket[prefix+'BaseCents']=add(bucket[prefix+'BaseCents'],total);
  bucket[prefix+'TaxCents']=add(bucket[prefix+'TaxCents'],tax);
  bucket.taxCents=add(bucket.taxCents,tax);bucket.eligibleLines++;
}

/** Reads only reconciled imported rows; does not change the financial cost or revenue selection. */
export function summarizeIcmsOperations({sourceMonth,purchases,sales,issuerUf,purchaseIssuerUf=issuerUf}){
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(sourceMonth),'Competência de ICMS inválida.');
  const result={version:ICMS_OPERATIONS_VERSION,sourceMonth,issuerUf:normalizeUf(issuerUf),purchaseIssuerUf:normalizeUf(purchaseIssuerUf),
    internalRatePercent:ICMS_INTERNAL_RATE_PERCENT,interstateRatePercent:ICMS_INTERSTATE_RATE_PERCENT,
    sales:emptyBucket(),purchases:emptyBucket(),salesReturns:emptyBucket(),
    excludedServicePurchasesCents:0,excludedSimplePurchasesCents:0,sourceRegularPurchasesCents:0};
  for(const row of sales){
    if(classifyOperationNature(row.natureCode)==='VENDA')addOperation(result.sales,row,result.issuerUf);
  }
  for(const row of purchases){
    const operation=classifyOperationNature(row.natureCode);
    if(operation==='DEVOLUCAO_VENDA'){
      // A sales return reverses the company's own sales debit, regardless of the buyer's group.
      addOperation(result.salesReturns,row,result.purchaseIssuerUf);continue;
    }
    if(!['COMPRAS','SERVICO_COMPRA'].includes(operation))continue;
    check(cents(row.totalCents),'A compra exige centavos inteiros não negativos.');
    check(['OPTANTE','NAO_OPTANTE'].includes(row.creditGroup),'Grupo gerencial da compra não conciliado.');
    if(row.creditGroup==='NAO_OPTANTE')result.sourceRegularPurchasesCents=add(result.sourceRegularPurchasesCents,row.totalCents);
    // Prefix 8000 is a cost but never an ICMS purchase credit, even without a known UF.
    if(operation==='SERVICO_COMPRA'){
      result.excludedServicePurchasesCents=add(result.excludedServicePurchasesCents,row.totalCents);continue;
    }
    if(row.creditGroup==='OPTANTE'){
      result.excludedSimplePurchasesCents=add(result.excludedSimplePurchasesCents,row.totalCents);continue;
    }
    addOperation(result.purchases,row,result.purchaseIssuerUf);
  }
  return parseIcmsOperations(result);
}

export function parseIcmsOperations(value){
  const keys=['version','sourceMonth','issuerUf','purchaseIssuerUf','internalRatePercent','interstateRatePercent',...GROUPS,
    'excludedServicePurchasesCents','excludedSimplePurchasesCents','sourceRegularPurchasesCents'];
  check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),
    'Composição de ICMS ausente ou não reconhecida.');
  check(value.version===ICMS_OPERATIONS_VERSION&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value.sourceMonth),'Versão ou competência de ICMS inválida.');
  check(value.internalRatePercent===ICMS_INTERNAL_RATE_PERCENT&&value.interstateRatePercent===ICMS_INTERSTATE_RATE_PERCENT,'Premissas das alíquotas de ICMS inválidas.');
  for(const key of ['issuerUf','purchaseIssuerUf'])check(typeof value[key]==='string'&&normalizeUf(value[key])===value[key],'UF da composição de ICMS inválida.');
  check(!value.issuerUf||!value.purchaseIssuerUf||value.issuerUf===value.purchaseIssuerUf,'As UFs da empresa divergem na composição de ICMS.');
  for(const group of GROUPS){
    const bucket=value[group];
    check(bucket&&typeof bucket==='object'&&!Array.isArray(bucket)&&Object.keys(bucket).length===BUCKET_FIELDS.length&&BUCKET_FIELDS.every(key=>cents(bucket[key])),
      'Base de ICMS incompleta ou inválida.');
    check(add(add(bucket.internalBaseCents,bucket.interstateBaseCents),bucket.pendingBaseCents)===bucket.totalBaseCents&&
      add(bucket.internalTaxCents,bucket.interstateTaxCents)===bucket.taxCents&&bucket.taxCents<=bucket.totalBaseCents&&
      (bucket.internalBaseCents>0||bucket.internalTaxCents===0)&&(bucket.interstateBaseCents>0||bucket.interstateTaxCents===0)&&
      (bucket.pendingBaseCents>0)===(bucket.pendingLines>0),'A composição de ICMS não concilia.');
    const knownBase=add(bucket.internalBaseCents,bucket.interstateBaseCents),issuer=group==='sales'?value.issuerUf:value.purchaseIssuerUf;
    check((knownBase>0)===(bucket.eligibleLines>0)&&bucket.eligibleLines<=knownBase&&bucket.pendingLines<=bucket.pendingBaseCents&&
      (!knownBase||!!issuer),'A composição de ICMS não conserva UF e contagem elegível coerentes.');
    for(const [prefix,rate] of [['internal',ICMS_INTERNAL_RATE_PERCENT],['interstate',ICMS_INTERSTATE_RATE_PERCENT]]){
      const difference=BigInt(bucket[prefix+'TaxCents'])*100n-BigInt(bucket[prefix+'BaseCents'])*BigInt(rate);
      const absolute=difference<0n?-difference:difference;
      check(absolute<=BigInt(bucket.eligibleLines)*50n,'O ICMS não corresponde à alíquota e ao arredondamento das operações.');
    }
  }
  for(const key of keys.filter(key=>key.endsWith('Cents')))check(cents(value[key]),'Conferência de compras de ICMS inválida.');
  check(value.purchases.totalBaseCents<=value.sourceRegularPurchasesCents,'A base creditável supera as compras do grupo.');
  return structuredClone(value);
}

/** A manual revenue delta uses the captured gross-sales mix; credits remain tied to invoices. */
export function projectIcmsOperations(value,{salesRevenueCents,regularPurchasesCents}){
  const source=parseIcmsOperations(value);
  check(Number.isSafeInteger(salesRevenueCents)&&cents(regularPurchasesCents),'Valores do cenário de ICMS inválidos.');
  const unflooredGrossSalesCents=salesRevenueCents+source.salesReturns.totalBaseCents;
  check(Number.isSafeInteger(unflooredGrossSalesCents),'Base ajustada de ICMS acima do limite seguro.');
  const grossSalesFloorApplied=unflooredGrossSalesCents<0,grossSalesCents=Math.max(0,unflooredGrossSalesCents);
  const sourceNetSalesCents=source.sales.totalBaseCents-source.salesReturns.totalBaseCents;
  const salesAdjustmentCents=salesRevenueCents-sourceNetSalesCents;
  const purchaseAdjustmentCents=regularPurchasesCents-source.sourceRegularPurchasesCents;
  check(Number.isSafeInteger(salesAdjustmentCents)&&Number.isSafeInteger(purchaseAdjustmentCents),'Ajuste de ICMS acima do limite seguro.');
  const pendingLines=GROUPS.reduce((total,key)=>total+source[key].pendingLines,0);
  const missingSalesMix=grossSalesCents>0&&source.sales.totalBaseCents===0;
  const available=!pendingLines&&!missingSalesMix;
  let debitCents=source.sales.taxCents;
  if(salesAdjustmentCents!==0){
    // Weight the original BASES, never the already-rounded line taxes. Scaling a
    // rounded one-cent invoice can otherwise turn an 18% rate into 0% or 33%.
    const denominator=BigInt(source.sales.totalBaseCents)*100n;
    const weightedBase=BigInt(source.sales.internalBaseCents)*18n+BigInt(source.sales.interstateBaseCents)*12n;
    debitCents=denominator?Number((weightedBase*BigInt(grossSalesCents)+denominator/2n)/denominator):0;
    check(cents(debitCents),'Débito ajustado de ICMS acima do limite seguro.');
  }
  const purchaseCreditCents=source.purchases.taxCents,salesReturnCreditCents=source.salesReturns.taxCents;
  const potentialCents=add(purchaseCreditCents,salesReturnCreditCents);
  const usedCents=Math.min(debitCents,potentialCents),dueCents=debitCents-usedCents,balanceCents=potentialCents-usedCents;
  const status=pendingLines?`ICMS pendente: ${pendingLines} operação(ões) elegível(is) sem UF confirmada. Revise as UFs nos relatórios de origem.`:
    missingSalesMix?'ICMS pendente: o ajuste de receita não possui vendas de origem com composição de UFs para determinar a alíquota.':'ICMS calculado por natureza e UF nas operações importadas.';
  return {source,available,status,pendingLines,missingSalesMix,grossSalesCents,unflooredGrossSalesCents,grossSalesFloorApplied,sourceNetSalesCents,salesAdjustmentCents,purchaseAdjustmentCents,
    debitCents,purchaseCreditCents,salesReturnCreditCents,potentialCents,usedCents,dueCents,balanceCents};
}
