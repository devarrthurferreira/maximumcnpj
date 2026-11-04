import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateTax,EXAMPLE_INPUT,IRPJ_RATE,IRPJ_ADDITIONAL_RATE} from '../public/simulator-engine.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);
const memory=(result,id)=>{const item=result.memory.find(row=>row.id===id);assert.ok(item,`Missing ${id}`);return item.value;};
function zero(){
  const input=structuredClone(EXAMPLE_INPUT);
  for(const key of ['serviceRevenue','salesRevenue','simplePurchases','regularPurchases','simpleRegularPurchases','salaries','benefits','adminExpenses','rent','cardExpenses','extraPayroll','rbt12'])input[key]=0;
  for(const group of Object.values(input.credits))group.base=0;
  return input;
}
test('IRPJ normal stays at 15% and additional stays at 10%',()=>{
  assert.equal(IRPJ_RATE,.15);assert.equal(IRPJ_ADDITIONAL_RATE,.10);
});
test('presumed monthly base 28000 produces additional 800, not 1200',()=>{
  const input=zero();input.serviceRevenue=87500;
  const result=calculateTax(input);
  close(memory(result,'presumed.irTotalBase')/12,28000);
  close(memory(result,'presumed.irBasic')/12,4200);
  close(memory(result,'presumed.irAdditional')/12,800);
  close(memory(result,'presumed.irTotal')/12,5000);
});
test('actual monthly estimated base 28000 produces additional 800',()=>{
  const input=zero();input.salesRevenue=28000;
  for(const rate of ['cbs','ibs','icms','iss','payroll'])input.rates[rate]=0;
  const result=calculateTax(input);
  close(memory(result,'actual.base')/12,28000);
  close(memory(result,'actual.irBasic')/12,4200);
  close(memory(result,'actual.irAdditional')/12,800);
});
test('additional is zero at the monthly equivalent threshold',()=>{
  const input=zero();input.serviceRevenue=62500;
  close(memory(calculateTax(input),'presumed.irAdditional'),0);
});
test('1263 can be correct at 10% when the monthly base is 32630',()=>{
  const input=zero();input.serviceRevenue=101968.75;
  const result=calculateTax(input);
  close(memory(result,'presumed.irTotalBase')/12,32630);
  close(memory(result,'presumed.irAdditional')/12,1263);
});

// Exercise the public DRE entry point and the project's existing monthly fixture.
import {drePdfFixture} from './fixtures/dre-pdf.mjs';
import {buildDrePresentation,capturedDreRows,unifiedDreRows} from '../public/simulator-dre.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';

test('public DRE exposes reconciled components without changing monthly or saved totals',()=>{
  for(const variant of ['complete','partial','loss','without-rbt12']){
    const snapshot=drePdfFixture({variant}),before=structuredClone(snapshot);
    const presentation=buildDrePresentation({...snapshot,calendar:snapshot.monthlyDre});
    const savedPresentation=structuredClone(presentation),captured=capturedDreRows(presentation);
    const rows=unifiedDreRows(presentation),index=rows.findIndex(row=>row.key==='irpj');
    assert(index>=0);
    assert.deepEqual(rows.slice(index,index+3).map(row=>row.key),['irpj','irpjBasic','irpjAdditional']);
    for(const key of ['irpj','irpjBasic','irpjAdditional','totalTaxes']){
      const saved=captured.find(row=>row.key===key),shown=rows.find(row=>row.key===key);
      assert.deepEqual(shown.values,saved.values);
      assert.deepEqual(shown.monthlyValues,saved.monthlyValues);
      assert.deepEqual(shown.reasonByRegime,saved.reasonByRegime);
    }
    assert.deepEqual(presentation,savedPresentation);
    assert.deepEqual(snapshot,before);
  }
});

test('CSV includes the two IRPJ components with explicit rates and no duplicate rows',()=>{
  const snapshot=drePdfFixture();
  const presentation=buildDrePresentation({...snapshot,calendar:snapshot.monthlyDre});
  const csv=buildDreCsv({presentation,period:'complete',visibleRegimeIds:['presumed','actual'],showPercent:false});
  assert.match(csv,/IRPJ total \(normal \+ adicional\)/);
  assert.match(csv,/IRPJ normal \(15% da base\)/);
  assert.match(csv,/Adicional de IRPJ \(10% do excedente\)/);
  const rows=unifiedDreRows(presentation);
  for(const key of ['irpj','irpjBasic','irpjAdditional'])assert.equal(rows.filter(row=>row.key===key).length,1);
});
