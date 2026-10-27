import {classifyOperationNature, normalizeOperationNature} from './operation-catalog.ts';
import {reconciledSignedPercentages} from './purchase-domain.ts';
import {need} from './security.ts';

/** Commercial presentation only. This contract never changes the tax engine's report groups. */
export const COMMERCIAL_COMPOSITION_VERSION = 'COMMERCIAL_COMPOSITION_V1';
export const COMMERCIAL_CUSTOMER_KEYS = ['B2B','B2C','UNIDENTIFIED'] as const;
export const COMMERCIAL_TAX_KEYS = ['OPTANTE','NAO_OPTANTE','CPF','NAO_CONFIRMADO','OUTROS'] as const;
export type CommercialCustomerKey = typeof COMMERCIAL_CUSTOMER_KEYS[number];
export type CommercialTaxKey = typeof COMMERCIAL_TAX_KEYS[number];
export type CommercialRow = {
  serviceDate: string|null; natureCode?: string; totalCents: number;
  documentKind: string; valid: boolean; status?: unknown;
};
export type CommercialRevenueGroup<K extends string> = {
  key: K; grossCents: number; returnsCents: number; totalCents: number; percent: number|null;
};
export type CommercialPurchaseGroup = {key: CommercialTaxKey; totalCents: number; percent: number|null};
export type CommercialComposition = {
  version: typeof COMMERCIAL_COMPOSITION_VERSION; unit: 'CENTS'; sourceMonths: string[];
  revenue: {
    grossCents: number; returnsCents: number; totalCents: number; percentDenominatorCents: number;
    byCustomerType: CommercialRevenueGroup<CommercialCustomerKey>[];
    byTaxStatus: CommercialRevenueGroup<CommercialTaxKey>[];
  };
  purchases: {totalCents: number; percentDenominatorCents: number; byTaxStatus: CommercialPurchaseGroup[]};
};

const ERROR = 'SIMULATION_COMMERCIAL_COMPOSITION';
function assert(condition: unknown, message: string): asserts condition { need(condition, message, 409, ERROR); }
function cents(value: unknown, signed=false): number {
  assert(typeof value==='number'&&Number.isSafeInteger(value)&&(signed||value>=0),'Valor monetário inválido na composição comercial.');
  return value;
}
const sum = (values: readonly number[], signed=false) => values.reduce((total,value)=>cents(total+cents(value,signed),signed),0);
function month(value: unknown): string {
  assert(typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value),'Competência inválida na composição comercial.');
  return value;
}
function blankRevenue<K extends string>(keys: readonly K[]): CommercialRevenueGroup<K>[] {
  return keys.map(key=>({key,grossCents:0,returnsCents:0,totalCents:0,percent:null}));
}
/** A zero/negative net denominator has no meaningful participation percentage. */
function percentages(values: number[], denominator: number): (number|null)[] {
  return denominator>0?reconciledSignedPercentages(values,denominator):values.map(()=>null);
}
function revenueGroups<K extends string>(groups: CommercialRevenueGroup<K>[]) {
  const values=groups.map(group=>cents(group.grossCents-group.returnsCents,true));
  const shares=percentages(values,sum(values,true));
  return groups.map((group,index)=>({...group,totalCents:values[index],percent:shares[index]}));
}
function finish(sourceMonths: string[], customers: CommercialRevenueGroup<CommercialCustomerKey>[],
  taxStatuses: CommercialRevenueGroup<CommercialTaxKey>[], purchases: CommercialPurchaseGroup[]): CommercialComposition {
  const byCustomerType=revenueGroups(customers),byTaxStatus=revenueGroups(taxStatuses);
  const grossCents=sum(byCustomerType.map(group=>group.grossCents)),returnsCents=sum(byCustomerType.map(group=>group.returnsCents));
  const totalCents=cents(grossCents-returnsCents,true),purchaseTotal=sum(purchases.map(group=>group.totalCents));
  assert(sum(byTaxStatus.map(group=>group.grossCents))===grossCents&&sum(byTaxStatus.map(group=>group.returnsCents))===returnsCents,
    'Os agrupamentos comerciais não conciliam com a receita selecionada.');
  const purchaseShares=percentages(purchases.map(group=>group.totalCents),purchaseTotal);
  return {version:COMMERCIAL_COMPOSITION_VERSION,unit:'CENTS',sourceMonths:[...sourceMonths],
    revenue:{grossCents,returnsCents,totalCents,percentDenominatorCents:totalCents,byCustomerType,byTaxStatus},
    purchases:{totalCents:purchaseTotal,percentDenominatorCents:purchaseTotal,
      byTaxStatus:purchases.map((group,index)=>({...group,percent:purchaseShares[index]}))}};
}
function classify(row: CommercialRow): {customer:CommercialCustomerKey;tax:CommercialTaxKey} {
  assert(typeof row.valid==='boolean'&&typeof row.documentKind==='string','Identificação documental ausente na composição comercial.');
  if(row.valid&&row.documentKind==='CNPJ'){
    assert(typeof row.status==='string'&&['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO'].includes(row.status),
      'O CNPJ não conserva o enquadramento consultado para a composição comercial.');
    return {customer:'B2B',tax:row.status as 'OPTANTE'|'NAO_OPTANTE'|'NAO_CONFIRMADO'};
  }
  if(!row.valid&&row.documentKind==='CPF')return {customer:'B2C',tax:'CPF'};
  return {customer:'UNIDENTIFIED',tax:'OUTROS'};
}

/** Input rows and their status must come from the same reconciled, frozen report snapshot. */
export function summarizeCommercialMonth(sourceMonth: string, purchases: readonly CommercialRow[], sales: readonly CommercialRow[]): CommercialComposition {
  month(sourceMonth);
  const customers=blankRevenue(COMMERCIAL_CUSTOMER_KEYS),taxStatuses=blankRevenue(COMMERCIAL_TAX_KEYS);
  const purchaseGroups:CommercialPurchaseGroup[]=COMMERCIAL_TAX_KEYS.map(key=>({key,totalCents:0,percent:null}));
  const revenue = (row: CommercialRow, field:'grossCents'|'returnsCents',value:number) => {
    const classification=classify(row),customer=customers.find(group=>group.key===classification.customer)!;
    const tax=taxStatuses.find(group=>group.key===classification.tax)!;
    customer[field]=cents(customer[field]+value);tax[field]=cents(tax[field]+value);
  };
  for(const [side,rows] of [['PURCHASES',purchases],['SALES',sales]] as const){
    for(const row of rows){
      assert(typeof row.serviceDate==='string'&&row.serviceDate.slice(0,7)===sourceMonth,
        'A composição comercial recebeu uma linha de outra competência.');
      const nature=normalizeOperationNature(row.natureCode);
      assert(nature.length===4,'Natureza ausente na composição comercial. Reimporte o relatório.');
      const operation=classifyOperationNature(nature),value=cents(row.totalCents);
      if(side==='SALES'){
        if(operation==='VENDA'||operation==='SERVICO_VENDA')revenue(row,'grossCents',value);
      }else if(operation==='DEVOLUCAO_VENDA')revenue(row,'returnsCents',value);
      else if(operation==='COMPRAS'||operation==='SERVICO_COMPRA'){
        const tax=classify(row).tax,group=purchaseGroups.find(group=>group.key===tax)!;
        group.totalCents=cents(group.totalCents+value);
      }
    }
  }
  return finish([sourceMonth],customers,taxStatuses,purchaseGroups);
}

function validateRevenueGroups<K extends string>(groups: CommercialRevenueGroup<K>[], keys: readonly K[], gross:number, returns:number, total:number) {
  assert(Array.isArray(groups)&&groups.length===keys.length,'Agrupamento comercial incompleto.');
  for(const [index,key] of keys.entries()){
    const group=groups[index];
    assert(group?.key===key&&cents(group.grossCents)-cents(group.returnsCents)===cents(group.totalCents,true),
      'Saldo de grupo comercial divergente.');
  }
  assert(sum(groups.map(group=>group.grossCents))===gross&&sum(groups.map(group=>group.returnsCents))===returns&&
    sum(groups.map(group=>group.totalCents),true)===total,'Agrupamento comercial divergente do total.');
}

/** Recompute shares from the selected month totals. Never average percentages or include an unselected month. */
export function aggregateCommercialComposition(parts: readonly CommercialComposition[]): CommercialComposition {
  assert(Array.isArray(parts)&&parts.length>0,'Selecione as competências para compor receitas e compras.');
  const sourceMonths:string[]=[],seen=new Set<string>();
  const customers=blankRevenue(COMMERCIAL_CUSTOMER_KEYS),taxStatuses=blankRevenue(COMMERCIAL_TAX_KEYS);
  const purchases:CommercialPurchaseGroup[]=COMMERCIAL_TAX_KEYS.map(key=>({key,totalCents:0,percent:null}));
  for(const part of parts){
    assert(part?.version===COMMERCIAL_COMPOSITION_VERSION&&part.unit==='CENTS'&&Array.isArray(part.sourceMonths)&&part.sourceMonths.length>0,
      'Versão da composição comercial indisponível.');
    for(const item of part.sourceMonths){
      const key=month(item);assert(!seen.has(key),'Competência duplicada na composição comercial.');seen.add(key);sourceMonths.push(key);
    }
    assert(part.revenue&&part.purchases,'Totais da composição comercial ausentes.');
    const gross=cents(part.revenue.grossCents),returns=cents(part.revenue.returnsCents),total=cents(part.revenue.totalCents,true);
    assert(gross-returns===total&&part.revenue.percentDenominatorCents===total,'Receita comercial divergente das devoluções.');
    validateRevenueGroups(part.revenue.byCustomerType,COMMERCIAL_CUSTOMER_KEYS,gross,returns,total);
    validateRevenueGroups(part.revenue.byTaxStatus,COMMERCIAL_TAX_KEYS,gross,returns,total);
    const purchaseTotal=cents(part.purchases.totalCents),purchaseGroups=part.purchases.byTaxStatus;
    assert(Array.isArray(purchaseGroups)&&purchaseGroups.length===COMMERCIAL_TAX_KEYS.length&&part.purchases.percentDenominatorCents===purchaseTotal,
      'Agrupamento de compras incompleto.');
    assert(purchaseGroups.every((group,index)=>group?.key===COMMERCIAL_TAX_KEYS[index])&&
      sum(purchaseGroups.map(group=>cents(group.totalCents)))===purchaseTotal,'Agrupamento de compras divergente do total.');
    for(const [source,target] of [[part.revenue.byCustomerType,customers],[part.revenue.byTaxStatus,taxStatuses]] as const){
      for(const [index,group] of source.entries()){
        target[index].grossCents=cents(target[index].grossCents+group.grossCents);
        target[index].returnsCents=cents(target[index].returnsCents+group.returnsCents);
      }
    }
    for(const [index,group] of purchaseGroups.entries())purchases[index].totalCents=cents(purchases[index].totalCents+group.totalCents);
  }
  assert(sourceMonths.length<=12,'A composição comercial excede doze competências.');
  return finish(sourceMonths.sort(),customers,taxStatuses,purchases);
}
