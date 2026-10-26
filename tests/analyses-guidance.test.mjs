import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNTING_FIELDS,accountingSummary,analysisGuidance} from '../public/analyses-guidance.js';

const month=(sourceMonth,values)=>({sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(([key],index)=>[key,values[index]]))});
const readyAnalysis=()=>({
  id:'analysis',fiscal:{status:'COMPLETE',data:{generationId:'generation'}},
  accounting:{status:'COMPLETE',data:{months:[month('2026-08',[0,0,0,0,0])]}},
  readiness:{ready:true,issues:[],months:['2026-08']},currentSimulation:null
});

test('resultado atual não é contado como uma análise pronta para gerar novamente',()=>{
  const analysis=readyAnalysis();
  assert.equal(analysisGuidance(analysis).state,'ready');
  assert.equal(analysisGuidance(analysis).primaryAction.action,'generate');
  analysis.currentSimulation={id:'saved-result',stale:false,legacy:false};
  const current=analysisGuidance(analysis);
  assert.equal(current.state,'current');assert.equal(current.label,'Resultado atual');assert.equal(current.canGenerate,false);
  assert.equal(current.confirmedCount,2);assert.equal(current.primaryAction.action,'result');
  assert.equal(current.primaryAction.href,'/simulator.html?simulation=saved-result');
  analysis.currentSimulation.stale=true;
  const stale=analysisGuidance(analysis);
  assert.equal(stale.state,'ready');assert.equal(stale.canGenerate,true);assert.equal(stale.primaryAction.label,'Atualizar resultado');
});

test('alterações locais retiram a confirmação do setor e priorizam salvar antes de gerar',()=>{
  const analysis=readyAnalysis();analysis.currentSimulation={id:'saved-result',stale:false};
  const fiscal=analysisGuidance(analysis,{sector:'accounting',fiscalDirty:true});
  assert.equal(fiscal.state,'working');assert.equal(fiscal.confirmedCount,1);assert.equal(fiscal.sectors.fiscal.complete,false);
  assert.equal(fiscal.sectors.accounting.complete,true);assert.equal(fiscal.primaryAction.action,'save-fiscal');assert.equal(fiscal.canGenerate,false);
  const both=analysisGuidance(analysis,{sector:'accounting',fiscalDirty:true,accountingDirty:true});
  assert.equal(both.confirmedCount,0);assert.equal(both.primaryAction.action,'save-accounting');
  const config=analysisGuidance(analysis,{sector:'accounting',configDirty:true,accountingDirty:true});
  assert.equal(config.primaryAction.action,'config');assert.equal(config.confirmedCount,0);assert.equal(config.currentResult,false);
  assert.equal(analysis.fiscal.status,'COMPLETE');assert.equal(analysis.currentSimulation.stale,false);
});

test('colagem ainda não aplicada bloqueia geração sem alterar a confirmação dos dados salvos',()=>{
  const analysis=readyAnalysis();analysis.currentSimulation={id:'saved-result',stale:false};
  const before=structuredClone(analysis),guidance=analysisGuidance(analysis,{sector:'fiscal',pastePending:true});
  assert.equal(guidance.state,'working');assert.equal(guidance.hasUnsavedChanges,true);assert.equal(guidance.canGenerate,false);
  assert.equal(guidance.currentResult,false);assert.equal(guidance.confirmedCount,2);
  assert.equal(guidance.primaryAction.action,'accounting');assert.equal(guidance.primaryAction.label,'Conferir colagem do Contábil');
  assert.equal(guidance.issues[0].code,'UNSAVED_ACCOUNTING_PASTE');assert.equal(guidance.sectors.accounting.dirty,false);
  assert.deepEqual(analysis,before);
});

test('a orientação mantém o bloqueio do servidor e encaminha pendências concretas ao setor correto',()=>{
  const analysis=readyAnalysis();analysis.fiscal.status='DRAFT';analysis.fiscal.data.generationId=null;
  analysis.readiness={ready:false,issues:[
    {code:'FISCAL_NOT_CONFIRMED',sector:'fiscal',message:'Conclua o Fiscal.'},
    {code:'ANALYSIS_FISCAL_INCOMPLETE',sector:'fiscal',message:'Importe as entradas e saídas.'},
    {code:'ACCOUNTING_MONTHS_MISMATCH',sector:'accounting',message:'Confira as competências.'}
  ]};
  const initial=analysisGuidance(analysis);
  assert.equal(initial.primaryAction.action,'import');assert.equal(initial.primaryAction.label,'Adicionar entradas e saídas');
  assert.deepEqual(initial.issues.map(issue=>issue.code),['ANALYSIS_FISCAL_INCOMPLETE','ACCOUNTING_MONTHS_MISMATCH']);
  assert.equal(analysisGuidance(analysis,{sector:'accounting'}).primaryAction.action,'accounting-months');
  analysis.fiscal.data.generationId='generation';analysis.readiness.issues=[{code:'SIMULATOR_INCOMPLETE',sector:'fiscal',message:'Conclua as leituras.'}];
  assert.equal(analysisGuidance(analysis).primaryAction.label,'Retomar documentos fiscais');
  analysis.readiness.issues=[{code:'RBT12_MONTHS_MISSING',sector:'fiscal',message:'O extrato não cobre agosto.'}];
  assert.equal(analysisGuidance(analysis).primaryAction.action,'reference');
  analysis.fiscal.status='COMPLETE';analysis.readiness.issues=[];
  assert.equal(analysisGuidance(analysis).state,'working');assert.equal(analysisGuidance(analysis).canGenerate,false);
});

test('subtotal preenchido preserva centavos e distingue campos vazios de zero informado',()=>{
  const input=[month('2026-08',[123456,0,null,null,null])],before=structuredClone(input);
  const summary=accountingSummary(input);
  assert.equal(summary.enteredCents,123456);assert.equal(summary.totalCents,null);assert.equal(summary.complete,false);
  assert.equal(summary.filledFields,2);assert.equal(summary.missingFields,3);assert.equal(summary.completeMonths,0);
  assert.equal(summary.rows[0].enteredCents,123456);assert.equal(summary.rows[0].totalCents,null);
  assert.equal(summary.categories.find(item=>item.key==='rentCents').totalCents,0);
  assert.equal(summary.categories.find(item=>item.key==='cardExpensesCents').enteredCents,null);
  assert.deepEqual(input,before);
});

test('competência do Fiscal ausente acrescenta pendências sem inventar despesas zeradas',()=>{
  const summary=accountingSummary([month('2026-08',[0,0,0,0,0])],['2026-08','2026-09']);
  assert.equal(summary.enteredCents,0);assert.equal(summary.totalCents,null);assert.equal(summary.complete,false);
  assert.equal(summary.completeMonths,1);assert.equal(summary.monthCount,2);assert.equal(summary.missingFields,5);
  assert.deepEqual(summary.missingMonths,['2026-09']);
  assert.equal(summary.rows[1].present,false);assert.equal(summary.rows[1].enteredCents,null);assert.equal(summary.rows[1].filledFields,0);
  assert.deepEqual(summary.categories[0].missingMonths,['2026-09']);assert.equal(summary.categories[0].totalCents,null);
});

test('nenhuma competência ou nenhum valor não é apresentado como um total zero confirmado',()=>{
  const empty=accountingSummary([]);
  assert.equal(empty.complete,false);assert.equal(empty.enteredCents,null);assert.equal(empty.totalCents,null);assert.equal(empty.monthCount,0);
  const blank=accountingSummary([month('2026-08',[null,null,null,null,null])]);
  assert.equal(blank.enteredCents,null);assert.equal(blank.filledFields,0);assert.equal(blank.missingFields,5);
  assert.equal(blank.categories.every(category=>category.enteredCents===null),true);
});

test('total completo exige cobertura exata e soma os valores de cada competência sem médias',()=>{
  const input=[month('2026-08',[10001,20000,300,400,0]),month('2026-09',[25000,30000,700,900,50])];
  const summary=accountingSummary(input,['2026-08','2026-09']);
  assert.equal(summary.complete,true);assert.equal(summary.totalCents,87351);assert.equal(summary.missingFields,0);
  assert.equal(summary.completeMonths,2);assert.equal(summary.categories[0].totalCents,35001);
  assert.deepEqual(summary.rows.map(row=>row.totalCents),[30701,56650]);
  const mismatched=accountingSummary(input,['2026-08']);
  assert.equal(mismatched.complete,false);assert.equal(mismatched.totalCents,null);assert.equal(mismatched.enteredCents,87351);
  assert.deepEqual(mismatched.extraMonths,['2026-09']);
});
