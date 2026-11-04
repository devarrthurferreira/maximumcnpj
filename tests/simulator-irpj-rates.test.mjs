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
test('presumed base of 28000 per month closes 2400 of additional tax in each quarter',()=>{
  const input=zero();input.serviceRevenue=87500;
  const result=calculateTax(input);
  const months=[1,2,3].map(month=>result.incomeTaxAssessment.monthlyAssessments[`2027-0${month}`].regimes.presumed);
  assert.deepEqual(months.map(row=>row.bases.irpjBase),[28000,56000,84000]);
  assert.deepEqual(months.map(row=>row.movement.irpjNormalCents),[420000,420000,420000]);
  assert.deepEqual(months.map(row=>row.movement.irpjAdditionalCents),[0,0,240000]);
  assert.equal(months[2].provision.irpjTotalCents,1500000);
  close(memory(result,'presumed.irAdditional'),9600);close(memory(result,'presumed.irTotal'),60000);
});
test('actual estimated base of 28000 per month uses captured quarterly additional movements',()=>{
  const input=zero();input.salesRevenue=28000;
  for(const rate of ['cbs','ibs','icms','iss','payroll'])input.rates[rate]=0;
  const result=calculateTax(input);
  const months=[1,2,3].map(month=>result.incomeTaxAssessment.monthlyAssessments[`2027-0${month}`].regimes.actual);
  assert.deepEqual(months.map(row=>row.bases.irpjBase),[28000,56000,84000]);
  assert.deepEqual(months.map(row=>row.movement.irpjAdditionalCents),[0,0,240000]);
  assert.equal(months[2].provision.irpjNormalCents,1260000);assert.equal(months[2].provision.irpjAdditionalCents,240000);
  close(memory(result,'actual.irAdditional'),9600);
});
test('additional remains zero when three monthly bases total exactly 60000',()=>{
  const input=zero();input.serviceRevenue=62500;
  const result=calculateTax(input);
  close(memory(result,'presumed.irAdditional'),0);
  assert(result.incomeTaxAssessment.regimes.presumed.periods.every(period=>period.bases.irpjBase===60000&&period.provision.irpjAdditionalCents===0));
  assert(Object.values(result.incomeTaxAssessment.monthlyAssessments).every(month=>month.regimes.presumed.movement.irpjAdditionalCents===0));
});
test('quarterly additional tax keeps a projected average distinct from the recognised monthly movements',()=>{
  const input=zero();input.serviceRevenue=101968.75;
  const result=calculateTax(input);
  const months=[1,2,3].map(month=>result.incomeTaxAssessment.monthlyAssessments[`2027-0${month}`].regimes.presumed);
  assert.deepEqual(months.map(row=>row.bases.irpjBase),[32630,65260,97890]);
  assert.deepEqual(months.map(row=>row.movement.irpjAdditionalCents),[0,52600,326300]);
  assert.equal(months[2].provision.irpjAdditionalCents,378900);
  // R$1,263 is the annual projection's monthly average, not a captured month.
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
    const rows=unifiedDreRows(presentation),index=rows.findIndex(row=>row.key==='irpjBasic');
    assert(index>=0);
    assert.deepEqual(rows.slice(index,index+2).map(row=>row.key),['irpjBasic','irpjAdditional']);
    assert.equal(rows.filter(row=>row.key==='irpj').length,1,'O IRPJ está incluído no resultado da DRE.');
    assert(!rows.some(row=>row.key==='totalTaxes'),'O total de imposto é conferência fora da DRE.');
    assert.equal(rows.filter(row=>row.key==='taxesDeduction').length,1);
    for(const key of ['irpjBasic','irpjAdditional']){
      const saved=captured.find(row=>row.key===key),shown=rows.find(row=>row.key===key);
      assert.deepEqual(shown.values,saved.values);
      assert.deepEqual(shown.monthlyValues,saved.monthlyValues);
      assert.deepEqual(shown.reasonByRegime,saved.reasonByRegime);
      assert.equal(shown.informative,true);
    }
    for(const key of ['irpj','totalTaxes']){
      const saved=captured.find(row=>row.key===key),shown=presentation.taxStatement.rows.filter(row=>row.key===key);
      assert.equal(shown.length,1);
      const display=value=>key==='irpj'&&value!==null&&value!==0?-value:value;
      for(const field of ['values','calendarAnnualValues'])assert.deepEqual(shown[0][field],Object.fromEntries(Object.entries(saved[field]).map(([id,value])=>[id,display(value)])));
      assert.deepEqual(shown[0].monthlyValues,Object.fromEntries(Object.entries(saved.monthlyValues).map(([id,values])=>[id,values.map(display)])));
      for(const field of ['reasonByRegime','calendarReasonByRegime','monthlyReasonByRegime'])assert.deepEqual(shown[0][field],saved[field]);
    }
    assert.deepEqual(presentation,savedPresentation);
    assert.deepEqual(snapshot,before);
  }
});

test('CSV distinguishes monthly movements from the accumulated IRPJ components and their rates',()=>{
  const snapshot=drePdfFixture();
  const presentation=buildDrePresentation({...snapshot,calendar:snapshot.monthlyDre});
  const csv=buildDreCsv({presentation,period:'complete',visibleRegimeIds:['presumed','actual'],showPercent:false});
  const taxRows=csv.split('\r\n').filter(line=>line.includes('"Impostos";"Impostos";"IRPJ";"line";"BRL";'));
  assert.equal(taxRows.length,3,'Um IRPJ consolidado e os movimentos mensais dos dois regimes visíveis.');
  assert(taxRows[0].startsWith('"Impostos";'));assert(taxRows[1].startsWith('"Lucro Presumido";'));assert(taxRows[2].startsWith('"Lucro Real";'));
  assert.match(csv,/IRPJ normal · movimento do período/);
  assert.match(csv,/Adicional de IRPJ · movimento do período/);
  assert.match(csv,/IRPJ normal · 15% por trimestre/);
  assert.match(csv,/Adicional de IRPJ · 10% por trimestre/);
  const rows=unifiedDreRows(presentation);
  assert.equal(rows.filter(row=>row.key==='irpj').length,1);
  for(const key of ['irpjBasic','irpjAdditional'])assert.equal(rows.filter(row=>row.key===key).length,1);
  assert.equal(presentation.taxStatement.rows.filter(row=>row.key==='irpj').length,1);
});
