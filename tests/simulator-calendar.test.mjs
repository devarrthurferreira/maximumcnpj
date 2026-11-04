import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyDre,DRE_ROWS,MONTH_NAMES,dreRows} from '../public/simulator-calendar.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {calculateTax,EXAMPLE_INPUT} from '../public/simulator-engine.js';
const result=()=>({regimes:[{id:'a',name:'Cenário A',available:true,dre:Object.fromEntries(DRE_ROWS.filter(([key])=>key!=='icmsAnticipation').map(([key],i)=>[key,i%2?-123.45:1200]))},{id:'b',name:'Revisar',available:false,dre:{}}]});
test('DIFAL aparece no calendárioV2, enquanto histórico sem valor capturado conserva calendárioV1 sem linha inventada',()=>{
 const current=result();current.regimes[0].dre.difal=-1200;
 const calendar=buildMonthlyDre(current,2027);
 assert.equal(calendar.version,'DRE_CALENDAR_V2');assert.equal(calendar.regimes[0].rows.find(row=>row.key==='difal').months[0],-100);
 delete current.regimes[0].dre.difal;
 const legacy=buildMonthlyDre(current,2027);
 assert.equal(legacy.version,'DRE_CALENDAR_V1');assert.equal(legacy.regimes[0].rows.some(row=>row.key==='difal'),false);
 assert.equal(dreRows(current).some(([key])=>key==='difal'),false);
});
test('antecipação tem linha própria apenas quando capturada, inclusive sem DIFAL',()=>{
 const current=result();current.regimes[0].dre.icmsAnticipation=-8784;
 const calendar=buildMonthlyDre(current,2027);
 assert.equal(calendar.version,'DRE_CALENDAR_V2');assert.equal(calendar.regimes[0].rows.find(row=>row.key==='icmsAnticipation').months[0],-732);
 assert.equal(calendar.regimes[1].rows.find(row=>row.key==='icmsAnticipation').annual,null);
 delete current.regimes[0].dre.difal;
 const independent=buildMonthlyDre(current,2027);
 assert.equal(independent.version,'DRE_CALENDAR_V2');assert.equal(independent.regimes[0].rows.some(row=>row.key==='difal'),false);
 assert.equal(independent.regimes[0].rows.find(row=>row.key==='icmsAnticipation').annual,-8784);
 delete current.regimes[0].dre.icmsAnticipation;
 assert.equal(buildMonthlyDre(current,2027).version,'DRE_CALENDAR_V1');assert.equal(dreRows(current).some(([key])=>key==='icmsAnticipation'),false);
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

test('calendário captura RBT12 móvel pela competência de origem e preserva janelas sem modificar a fonte',()=>{
 const priorRevenues=Array.from({length:13},(_,i)=>{const month=i<12?`2024-${String(i+1).padStart(2,'0')}`:'2025-01';return {month,period:`${month.slice(5)}/${month.slice(0,4)}`,internalCents:(i+1)*100,externalCents:0,totalCents:(i+1)*100,usedInRbt12:i>0};});
 const data=result();data.method='REPORT_MONTHS_V1';data.monthlyResults=[{sourceMonth:'2025-01',month:1,result:result()},{sourceMonth:'2025-02',month:2,result:result()}];
 data.rbt12Schedule=buildRbt12Schedule({parserVersion:'SIMPLES_SECTION_22_V2',sourceSection:'2.2',pa:'02/2025',priorRevenues},['2025-02','2025-01']);
 const before=structuredClone(data),calendar=buildMonthlyDre(data,2027);
 assert.equal(calendar.version,'DRE_CALENDAR_V3');assert.equal(calendar.method,'REPORT_MONTHS_ROLLING_RBT12');
 assert.equal(calendar.months[0].rbt12Cents,7800);assert.equal(calendar.months[1].rbt12Cents,9000);
 assert.equal(calendar.months[0].sourceMonth,'2025-01');assert.equal(calendar.months[0].period,'2027-01');
 assert(calendar.months.slice(2).every(row=>row.rbt12Cents===null&&row.sourceMonth===null));
 assert.deepEqual(calendar.rbt12Schedule,data.rbt12Schedule);assert.notEqual(calendar.rbt12Schedule,data.rbt12Schedule);assert.deepEqual(data,before);
 data.rbt12Schedule.rows[0].window[0].totalCents=99999;
 assert.notEqual(calendar.rbt12Schedule.rows[0].window[0].totalCents,99999);
 delete data.rbt12Schedule;
 const fixed=buildMonthlyDre(data,2027,{source:'MANUAL',confirmed:true,rbt12Cents:12300});
 assert.equal(fixed.method,'REPORT_MONTHS_FIXED_RBT12');assert.equal(Object.hasOwn(fixed,'rbt12Schedule'),false);assert.equal(Object.hasOwn(fixed.months[0],'rbt12Cents'),false);
});

test('RBT12 mensal ausente permanece sem valor e referência inválida não é apresentada como fixa',()=>{
 const data=result();data.method='REPORT_MONTHS_V1';data.monthlyResults=[{sourceMonth:'2025-01',month:1,result:result()}];
 data.rbt12Schedule={version:'RBT12_MONTHLY_SECTION_22_V1',source:'SIMPLES_SECTION_22',sourceSection:'2.2',pa:'01/2026',complete:false,rows:[{sourceMonth:'2025-01',status:'MISSING_MONTHS',rbt12Cents:null,startMonth:'2024-01',endMonth:'2024-12',missingMonths:['2024-01'],window:[]}]};
 const calendar=buildMonthlyDre(data,2027);
 assert.equal(calendar.months[0].rbt12Cents,null);assert.equal(calendar.rbt12Schedule.complete,false);assert.equal(calendar.method,'REPORT_MONTHS_ROLLING_RBT12');
 for(const mutate of [s=>s.version='UNKNOWN',s=>s.rows[0].rbt12Cents=0,s=>s.rows.push(structuredClone(s.rows[0])),s=>s.rows[0].sourceMonth='bad']){
  const invalid=structuredClone(data);mutate(invalid.rbt12Schedule);assert.throws(()=>buildMonthlyDre(invalid,2027),/RBT12 mensal/);
 }
});

test('uniform quarterly projection uses captured monthly provisions instead of dividing income taxes by twelve',()=>{
 const input=structuredClone(EXAMPLE_INPUT);input.serviceRevenue=100000;input.salesRevenue=0;
 const data=calculateTax(input),before=structuredClone(data),calendar=buildMonthlyDre(data,2027);
 const presumed=calendar.regimes.find(row=>row.id==='presumed'),row=key=>presumed.rows.find(entry=>entry.key===key);
 assert.deepEqual(row('irpj').months,Array.from({length:4},()=>[-4800,-5200,-8000]).flat());
 assert.equal(row('irpj').annual,-72000);
 for(const key of ['irpj','csll','netProfit'])assert(Math.abs(row(key).months.reduce((sum,value)=>sum+value,0)-row(key).annual)<1e-7);
 for(let i=0;i<12;i++)assert(Math.abs(row('netProfit').months[i]-(row('preTax').months[i]+row('irpj').months[i]+row('csll').months[i]))<1e-7);
 assert.deepEqual(data,before);assert.throws(()=>buildMonthlyDre(data,2028),/ano do cenário/);
 const legacy=structuredClone(data);delete legacy.incomeTaxAssessment;
 assert(buildMonthlyDre(legacy,2027).regimes.find(row=>row.id==='presumed').rows.find(row=>row.key==='irpj').months.every(value=>value===-6000));
});

test('a missing uniform monthly assessment is unavailable without fabricating a zero income tax',()=>{
 const data=calculateTax(EXAMPLE_INPUT);delete data.incomeTaxAssessment.monthlyAssessments['2027-02'];
 const calendar=buildMonthlyDre(data,2027),actual=calendar.regimes.find(row=>row.id==='actual');
 for(const key of ['irpj','csll','netProfit'])assert.equal(actual.rows.find(row=>row.key===key).months[1],null);
 assert.equal(typeof actual.rows.find(row=>row.key==='revenue').months[1],'number');
});
