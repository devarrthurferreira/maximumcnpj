import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyDre,DRE_ROWS,MONTH_NAMES,dreRows} from '../public/simulator-calendar.js';
const result=()=>({regimes:[{id:'a',name:'Cenário A',available:true,dre:Object.fromEntries(DRE_ROWS.map(([key],i)=>[key,i%2?-123.45:1200]))},{id:'b',name:'Revisar',available:false,dre:{}}]});
test('DIFAL aparece no calendárioV2, enquanto histórico sem valor capturado conserva calendárioV1 sem linha inventada',()=>{
 const current=result();current.regimes[0].dre.difal=-1200;
 const calendar=buildMonthlyDre(current,2027);
 assert.equal(calendar.version,'DRE_CALENDAR_V2');assert.equal(calendar.regimes[0].rows.find(row=>row.key==='difal').months[0],-100);
 delete current.regimes[0].dre.difal;
 const legacy=buildMonthlyDre(current,2027);
 assert.equal(legacy.version,'DRE_CALENDAR_V1');assert.equal(legacy.regimes[0].rows.some(row=>row.key==='difal'),false);
 assert.equal(dreRows(current).some(([key])=>key==='difal'),false);
});
test('DRE contém janeiro a dezembro, total anual e RBT12 fixa do PA em campo separado',()=>{
 const data=result(),before=structuredClone(data),reference={id:'abc',sourceSection:'2.2',parserVersion:'SIMPLES_SECTION_22_V2',pa:'08/2026',rbt12Cents:15000000,rbt12Basis:{startMonth:'2025-08',endMonth:'2026-07'}};
 const calendar=buildMonthlyDre(data,2027,reference,{startMonth:'2026-04',endMonth:'2026-07',months:4});
 assert.equal(calendar.months.length,12);assert.deepEqual(calendar.months.map(v=>v.label),MONTH_NAMES);
 assert.equal(calendar.months[0].period,'2027-01');assert.equal(calendar.months[11].period,'2027-12');
 assert.equal(calendar.rbt12Reference.rbt12Cents,15000000);assert.equal(calendar.rbt12Reference.pa,'08/2026');
 for(const row of calendar.regimes[0].rows){assert.equal(row.months.length,12);assert(row.months.every(v=>v===row.annual/12));assert(Math.abs(row.months.reduce((a,b)=>a+b,0)-row.annual)<1e-8);}
 assert.deepEqual(data,before);assert.equal(calendar.reportPeriod.months,4);
});
test('Cenário indisponível mantém traços, nunca zeros ou NaN; legado não ganha proveniência',()=>{
 const calendar=buildMonthlyDre(result(),2028,{rbt12Cents:10,sourceSection:'2.1'});
 assert.equal(calendar.rbt12Reference,null);assert(calendar.regimes[1].rows.every(row=>row.annual===null&&row.months.every(v=>v===null)));
 assert.throws(()=>buildMonthlyDre(result(),NaN));
 const broken=result();broken.regimes[0].dre.services=Infinity;assert.throws(()=>buildMonthlyDre(broken,2027));
});
test('RBT12 manual confirmada fica identificada sem inventar PA ou competências do extrato',()=>{
 for(const rbt12Cents of [0,29,98765432]){
  const calendar=buildMonthlyDre(result(),2027,{source:'MANUAL',confirmed:true,rbt12Cents});
  assert.deepEqual(calendar.rbt12Reference,{source:'MANUAL',rbt12Cents});
  assert.equal(calendar.method,'AVERAGE_X12_FIXED_MANUAL_RBT12');
  assert.equal(calendar.months.length,12);
 }
 for(const source of [{source:'MANUAL',rbt12Cents:29},{source:'MANUAL',confirmed:true,rbt12Cents:-1},
  {source:'MANUAL',confirmed:true,rbt12Cents:1.1},{source:'MANUAL',confirmed:true,rbt12Cents:Infinity}]){
  assert.equal(buildMonthlyDre(result(),2027,source).rbt12Reference,null);
 }
});
