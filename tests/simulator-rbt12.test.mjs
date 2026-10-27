import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRbt12Schedule,buildJanSepRbt12Schedule,section22RevenueHistory,reconcileSection22Extraction,RBT12_SCHEDULE_VERSION} from '../public/simulator-rbt12.js';
import {section22,section22Year2025} from './fixtures/section22.ts';

const months2025=Array.from({length:12},(_,index)=>`2025-${String(index+1).padStart(2,'0')}`);
test('23 receitas explícitas do quadro 2.2 compõem 12 RBT12 móveis distintas, sem usar o escalar do PA',()=>{
 const source=section22Year2025(),copy=structuredClone(source),schedule=buildRbt12Schedule(source,months2025);
 assert.equal(schedule.version,RBT12_SCHEDULE_VERSION);assert.equal(schedule.sourceSection,'2.2');assert.equal(schedule.complete,true);
 assert.deepEqual(schedule.rows.map(row=>row.rbt12Cents),[7800000,9000000,10200000,11400000,12600000,13800000,15000000,16200000,17400000,18600000,19800000,21000000]);
 assert.equal(schedule.rows[0].startMonth,'2024-01');assert.equal(schedule.rows[0].endMonth,'2024-12');
 assert.equal(schedule.rows[11].startMonth,'2024-12');assert.equal(schedule.rows[11].endMonth,'2025-11');
 assert.ok(schedule.rows.every(row=>row.status==='CONFIRMED'&&row.window.length===12&&row.missingMonths.length===0));
 assert.equal(schedule.rows[0].window[0].period,'01/2024');assert.deepEqual(source,copy);
 assert.notEqual(schedule.rows[0].window[0],source.priorRevenues[0]);
});
test('Cada mercado entra no mês correto; a receita do próprio PA e campos do quadro 2.1 não completam a janela',()=>{
 const source=section22Year2025();source.priorRevenues[0].externalCents=12345;source.priorRevenues[0].totalCents+=12345;
 source.reportedRbt12Section21=99999999999;source.paRevenueCents=999999999;
 const schedule=buildRbt12Schedule(source,['2025-01','2025-02','2026-01']);
 assert.equal(schedule.rows[0].rbt12Cents,7812345);assert.equal(schedule.rows[1].rbt12Cents,9000000);
 assert.equal(schedule.rows[2].rbt12Cents,null);assert.deepEqual(schedule.rows[2].missingMonths,['2025-12']);
 assert.equal(schedule.complete,false);
});
test('Competência ausente permanece pendente; não vira zero, média nem RBT12 fixa',()=>{
 const source=section22Year2025();source.priorRevenues.splice(1,1);
 const schedule=buildRbt12Schedule(source,['2025-01','2025-12']);
 assert.equal(schedule.complete,false);assert.equal(schedule.rows[0].status,'MISSING_MONTHS');assert.equal(schedule.rows[0].rbt12Cents,null);
 assert.deepEqual(schedule.rows[0].missingMonths,['2024-02']);assert.equal(schedule.rows[0].window.length,11);
 assert.equal(schedule.rows[1].status,'CONFIRMED');assert.equal(schedule.rows[1].rbt12Cents,21000000);
});
test('Zero explicitamente informado é válido em todas as janelas',()=>{
 const source=section22Year2025();for(const row of source.priorRevenues){row.internalCents=0;row.externalCents=0;row.totalCents=0;}
 const schedule=buildRbt12Schedule(source,months2025);
 assert.equal(schedule.complete,true);assert.ok(schedule.rows.every(row=>row.rbt12Cents===0));
});
test('Extrato legado sem histórico adicional fornece somente suas competências conhecidas',()=>{
 const source=section22();delete source.priorRevenues;
 const schedule=buildRbt12Schedule(source,['2026-07','2026-08']);
 assert.deepEqual(schedule.rows[0].missingMonths,['2025-07']);assert.equal(schedule.rows[0].rbt12Cents,null);
 assert.equal(schedule.rows[1].rbt12Cents,15000000);assert.equal(schedule.rows[1].status,'CONFIRMED');
});
test('Meses inválidos, duplicados, valores inexatos e histórico conflitante são rejeitados',()=>{
 for(const sourceMonths of [[],['2025-13'],['2025-01','2025-01'],['01/2025'],[null]])
  assert.throws(()=>buildRbt12Schedule(section22Year2025(),sourceMonths),TypeError);
 for(const change of [
  source=>source.sourceSection='2.1',source=>source.priorRevenues=null,
  source=>source.priorRevenues[0].internalCents=.5,
  source=>source.priorRevenues[0].totalCents++,
  source=>source.priorRevenues[0].totalCents=Infinity,
  source=>source.priorRevenues.push({...source.priorRevenues.at(-1),month:'2025-12',period:'12/2025'}),
  source=>source.priorRevenues.reverse(),
 ]){const source=section22Year2025();change(source);assert.throws(()=>section22RevenueHistory(source),TypeError);}
 const source=section22Year2025();for(const row of source.priorRevenues){row.internalCents=100000000000000;row.totalCents=row.internalCents;}
 assert.throws(()=>buildRbt12Schedule(source,['2025-01']),/limite/);
});

test('conferência compartilhada concilia todas as receitas com janela e RBT12 do PA sem somar23meses',()=>{
 const source=section22Year2025(),before=structuredClone(source),checked=reconcileSection22Extraction(source);
 assert.equal(checked.priorRevenues.length,23);assert.equal(checked.rbt12Window.length,12);
 assert.equal(checked.rbt12Cents,21000000);assert.equal(checked.rbt12Cents,checked.rbt12Window.reduce((sum,row)=>sum+row.totalCents,0));
 assert.notEqual(checked.rbt12Cents,checked.priorRevenues.reduce((sum,row)=>sum+row.totalCents,0));
 assert.deepEqual(source,before);assert.notEqual(checked.priorRevenues[0],source.priorRevenues[0]);assert.notEqual(checked.rbt12Window[0],source.rbt12Window[0]);
 for(const total of [0,12345629]){
  const legacy=section22(total);delete legacy.priorRevenues;delete legacy.rbt12CalculatedCents;delete legacy.rbt12Reconciled;
  assert.equal(reconcileSection22Extraction(legacy).rbt12Cents,total);
 }
});
test('conferência não confirma valores multiplicados por12/100, somas de todo histórico ou janela deslocada',()=>{
 for(const change of [
  source=>source.rbt12Cents*=100,source=>source.rbt12Cents*=12,
  source=>source.rbt12Cents=source.priorRevenues.reduce((sum,row)=>sum+row.totalCents,0),
  source=>source.rbt12Window=source.priorRevenues.slice(0,12),
  source=>source.rbt12Window=source.rbt12Window.map((row,index)=>index?row:{...row,totalCents:row.totalCents*100}),
  source=>source.rbt12Basis.totalCents++,source=>source.rbt12Basis.internalCents++,
  source=>source.rbt12CalculatedCents*=100,source=>source.rbt12Reconciled=false,
  source=>source.rbt12Window.pop(),source=>source.rbt12Basis.startMonth='2024-01',
 ]){const source=section22Year2025();change(source);assert.throws(()=>reconcileSection22Extraction(source),TypeError);}
});

test('MaximumCNPJ gera somente nove RBT12 de janeiro a setembro, com janela móvel de doze meses',()=>{
  const source=section22Year2025(),schedule=buildJanSepRbt12Schedule(source,2025);
  assert.equal(schedule.rows.length,9);
  assert.deepEqual(schedule.rows.map(row=>row.sourceMonth),months2025.slice(0,9));
  assert.deepEqual(schedule.rows.map(row=>row.rbt12Cents),[7800000,9000000,10200000,11400000,12600000,13800000,15000000,16200000,17400000]);
  assert.equal(schedule.rows[0].startMonth,'2024-01');
  assert.equal(schedule.rows[8].endMonth,'2025-08');
  assert.equal(schedule.rows[8].window.length,12);
  assert.deepEqual(source.priorRevenues.map(row=>row.month).slice(0,2),['2024-01','2024-02']);
  assert.throws(()=>buildJanSepRbt12Schedule(source,2025.5),TypeError);
});

test('Histórico ausente bloqueia somente as janelas que dependem dele, sem fabricar meses zerados',()=>{
  const source=section22Year2025();source.priorRevenues.splice(0,1);
  const schedule=buildJanSepRbt12Schedule(source,2025);
  assert.equal(schedule.rows.length,9);assert.equal(schedule.complete,false);
  assert.deepEqual(schedule.rows[0].missingMonths,['2024-01']);
  assert.equal(schedule.rows[0].rbt12Cents,null);
  assert.equal(schedule.rows[1].status,'CONFIRMED');
});
