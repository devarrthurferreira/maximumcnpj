import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNTING_AVERAGE_VERSION,ACCOUNTING_FIELDS,accountingForYear,parseAccountingData} from '../src/analysis-contract.ts';
import {analysisMonthsForYear,JAN_SEP_POLICY} from '../public/analysis-period.js';

const average=(year=2026,changes:Record<string,number|null>={})=>{
  const values={salariesCents:100000,rentCents:20000,cardExpensesCents:3500,benefitsCents:0,adminExpensesCents:125,...changes};
  return {monthlyAverage:{version:ACCOUNTING_AVERAGE_VERSION,values},months:analysisMonthsForYear(year).map(sourceMonth=>({sourceMonth,...values}))};
};
test('média mensal 1000 é 1000 em cada mês e 9000 no total, com centavos exatos',()=>{
  const data=parseAccountingData(average(),true,{periodPolicy:JAN_SEP_POLICY});
  assert.equal(data.months.length,9);
  assert(data.months.every(row=>row.salariesCents===100000));
  assert.equal(data.months.reduce((sum,row)=>sum+row.salariesCents!,0),900000);
  assert.equal(data.months.reduce((sum,row)=>sum+row.adminExpensesCents!,0),1125);
});
test('média salva antes do Fiscal acompanha o ano da fonte sem modificar os dados de origem',()=>{
  const data=parseAccountingData(average(),true,{periodPolicy:JAN_SEP_POLICY}),before=structuredClone(data);
  const resolved=accountingForYear(data,2025);
  assert.deepEqual(resolved.months.map(row=>row.sourceMonth),analysisMonthsForYear(2025));
  assert(resolved.months.every(row=>row.salariesCents===100000));
  assert.deepEqual(data,before);
  assert.deepEqual(parseAccountingData(average(),true,{periodPolicy:JAN_SEP_POLICY,sourceYear:2025}),resolved);
});
test('rascunho preserva valores pendentes; concluir exige as cinco médias',()=>{
  const data=average(2026,{benefitsCents:null});
  assert.equal(parseAccountingData(data).monthlyAverage!.values.benefitsCents,null);
  assert.throws(()=>parseAccountingData(data,true,{periodPolicy:JAN_SEP_POLICY}),(error:any)=>error.code==='ANALYSIS_ACCOUNTING_INCOMPLETE');
});
test('média rejeita meses divergentes, Q4, anos misturados e valores adulterados',()=>{
  for(const mutate of [
    (data:any)=>{data.months[1].salariesCents=999;},
    (data:any)=>{data.months.pop();},
    (data:any)=>{data.months[8].sourceMonth='2026-10';},
    (data:any)=>{data.months[8].sourceMonth='2025-09';},
    (data:any)=>{data.monthlyAverage.values.rentCents=-1;},
    (data:any)=>{data.monthlyAverage.values.rentCents=1.2;},
    (data:any)=>{data.monthlyAverage.values.rentCents='1000';},
    (data:any)=>{data.monthlyAverage.unexpected=true;}
  ]){const data=average();mutate(data);assert.throws(()=>parseAccountingData(data));}
});
test('lançamentos mensais legados e seus meses originais continuam imutáveis ao ler',()=>{
  const legacy={months:analysisMonthsForYear(2024).map((sourceMonth,index)=>({sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(key=>[key,index*100]))}))};
  const parsed=parseAccountingData(legacy),before=structuredClone(parsed);
  assert.deepEqual(accountingForYear(parsed,2025),before);
  assert.equal(parsed.monthlyAverage,undefined);
});
