import test from 'node:test';
import assert from 'node:assert/strict';
import {accountingAverage,accountingAverageMonths,accountingAverageInputValues,accountingAveragePreview} from '../public/analysis-accounting-average.js';

const fields=['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'];
const values=(...amounts)=>Object.fromEntries(fields.map((key,index)=>[key,amounts[index]??null]));
const row=(sourceMonth,...amounts)=>({sourceMonth,...values(...amounts)});

test('média de R$ 1.000 gera exatamente R$ 1.000 por mês e R$ 9.000 Jan–Set',()=>{
  const input=Object.freeze(values(100000,0,0,0,0)),preview=accountingAveragePreview(input,2025);
  assert.equal(preview.monthlyCents,100000);assert.equal(preview.totalCents,900000);assert.equal(preview.complete,true);
  assert.deepEqual(preview.months.map(entry=>entry.sourceMonth),['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09']);
  assert.ok(preview.months.every(entry=>entry.salariesCents===100000));
  preview.months[0].salariesCents=1;assert.equal(preview.months[1].salariesCents,100000);assert.equal(input.salariesCents,100000);
});

test('médias explícitas se conservam ao reconhecer outro ano fiscal, sem multiplicar duas vezes',()=>{
  const monthlyAverage={version:'MONTHLY_AVERAGE_V1',values:values(100000,29123,1,0,999)};
  const data={monthlyAverage,months:accountingAverageMonths(monthlyAverage.values,2026)},before=structuredClone(data);
  const result=accountingAverage(data,2025);assert.deepEqual(result.values,monthlyAverage.values);assert.equal(result.legacy,false);
  assert.deepEqual(data,before);assert.equal(accountingAveragePreview(result.values,2025).totalCents,1171107);
});

test('dados legados desiguais são apenas proposta, sem alterar valores nem perder outro ano',()=>{
  const data={months:[row('2026-01',10000,100,null,0,0),row('2026-02',20000,101,null,0,0),row('2026-10',990000,990000,990000,990000,990000)]};
  const before=structuredClone(data),result=accountingAverage(data,2025);
  assert.deepEqual(result.values,values(15000,101,null,0,0));assert.equal(result.legacy,true);assert.equal(result.varied,true);
  assert.equal(result.fromOtherYear,true);assert.equal(result.counts.salariesCents,2);assert.deepEqual(data,before);
});

test('vazio permanece pendente e zero só é replicado quando explicitamente informado',()=>{
  const input=values(null,0,null,null,null),preview=accountingAveragePreview(input,2026);
  assert.equal(preview.complete,false);assert.equal(preview.filledFields,1);assert.equal(preview.totalCents,0);
  assert.ok(preview.months.every(entry=>entry.rentCents===0&&entry.salariesCents===null));
  assert.equal(accountingAveragePreview(values(null,null,null,null,null),2026).totalCents,null);
});

test('digitação parcial é preservada pela prévia sem converter texto inválido ou vazio em zero',()=>{
  const original=values(100,200,300,400,500),raw={salariesCents:'',rentCents:'12.34',cardExpensesCents:'1.234',benefitsCents:'-1'};
  assert.deepEqual(accountingAverageInputValues(raw,original),values(null,1234,null,null,500));
  assert.deepEqual(original,values(100,200,300,400,500));
  for(const invalid of [NaN,Infinity,-1,0.01,'100',undefined]){
    const input=values(0,0,0,0,0);input.salariesCents=invalid;
    assert.throws(()=>accountingAverageMonths(input,2025),/média mensal/);
  }
});
