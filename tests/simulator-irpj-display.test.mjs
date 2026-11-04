import test from 'node:test';
import assert from 'node:assert/strict';
import {withIrpjBreakdown} from '../public/simulator-irpj-display.js';
// Captured rows are inputs to this pure presentation layer, not recalculated taxes.
const unifiedDreRows=p=>withIrpjBreakdown(p,[
  ...(p.sections||[]).flatMap(section=>section.rows||[]),
  ...(p.details||[]).flatMap(group=>group.rows||[]),
  ...(p.indicators||[]),
  ...(p.revenueReconciliation?.rows||[]),
  ...(p.icmsReconciliation?.rows||[])
]);
const row=(key,value)=>({key,label:key,kind:'line',unit:'currency',values:{presumed:value,actual:value},monthlyValues:{presumed:[value],actual:[value]},notes:[]});
function fixture(){
  const total=row('irpj',-5000),basic=row('irpjBasic',-4200),additional=row('irpjAdditional',-800),taxes=row('totalTaxes',7500);
  return {sections:[{rows:[total]}],details:[{key:'irpjBreakdown',parentKey:'irpj',rows:[basic,additional]}],
    indicators:[taxes],statement:{version:'DRE_STATEMENT_V1',sections:[{rows:[total,taxes]}]}};
}
test('IRPJ total is followed by its normal and additional components',()=>{
  const rows=unifiedDreRows(fixture());
  assert.deepEqual(rows.map(row=>row.key),['irpj','irpjBasic','irpjAdditional','totalTaxes']);
  assert.match(rows[1].label,/15% da base/);assert.match(rows[2].label,/10% do excedente/);
  assert.equal(rows[2].values.presumed,-800);
});
test('components never change the saved tax total or snapshot',()=>{
  const presentation=fixture(),before=structuredClone(presentation),rows=unifiedDreRows(presentation);
  assert.deepEqual(presentation,before);
  assert.equal(rows.find(row=>row.key==='irpj').values.presumed,-5000);
  assert.equal(rows.find(row=>row.key==='totalTaxes').values.presumed,7500);
  for(const key of ['irpjBasic','irpjAdditional']){
    const detail=rows.find(row=>row.key===key);assert.equal(detail.kind,'detail');assert.equal(detail.informative,true);
  }
});
test('missing detail is never fabricated as zero',()=>{
  const presentation=fixture();presentation.details=[];
  assert.deepEqual(unifiedDreRows(presentation).map(row=>row.key),['irpj','totalTaxes']);
});
test('unavailable additional preserves null and its explanation',()=>{
  const presentation=fixture(),detail=presentation.details[0].rows[1];
  detail.values.presumed=null;detail.reasonByRegime={presumed:'Memória não conciliada'};
  const saved=unifiedDreRows(presentation).find(row=>row.key==='irpjAdditional');
  assert.equal(saved.values.presumed,null);assert.equal(saved.reasonByRegime.presumed,'Memória não conciliada');
});
test('monthly values and missing months are preserved without recomputation',()=>{
  const presentation=fixture();presentation.details[0].rows[1].monthlyValues.presumed=[-800,null,-1263];
  const saved=unifiedDreRows(presentation).find(row=>row.key==='irpjAdditional');
  assert.deepEqual(saved.monthlyValues.presumed,[-800,null,-1263]);
});
test('existing composition rows are not duplicated',()=>{
  const presentation=fixture();presentation.statement.sections[0].rows.splice(1,0,...presentation.details[0].rows);
  const keys=unifiedDreRows(presentation).map(row=>row.key);
  assert.equal(keys.filter(key=>key==='irpjBasic').length,1);assert.equal(keys.filter(key=>key==='irpjAdditional').length,1);
});
test('legacy views retain their rows and clarified component labels',()=>{
  const presentation=fixture();delete presentation.statement;
  assert.deepEqual(unifiedDreRows(presentation).map(row=>row.key),['irpj','irpjBasic','irpjAdditional','totalTaxes']);
  assert.match(unifiedDreRows(presentation)[2].label,/10%/);
});
test('revenue and ICMS reconciliations are preserved',()=>{
  const presentation=fixture();presentation.revenueReconciliation={rows:[row('revenueUsed',123)]};presentation.icmsReconciliation={rows:[row('icmsUsed',456)]};
  const rows=unifiedDreRows(presentation);
  assert.deepEqual(rows.slice(-2).map(row=>row.key),['revenueUsed','icmsUsed']);
  assert.equal(rows.at(-1).values.presumed,456);
});
