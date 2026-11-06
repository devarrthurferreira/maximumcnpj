import test from 'node:test';
import assert from 'node:assert/strict';
import {accountingOnlyPeriod,partialAnalysisAvailability,partialAnalysisData} from '../src/analysis-partial.ts';
import {assertCompleteAnalysisPeriod} from '../public/analysis-period.js';

const row=(sourceMonth:string)=>({sourceMonth,salariesCents:10000,rentCents:0,cardExpensesCents:0,benefitsCents:0,adminExpensesCents:0,financialExpensesCents:0,financialIncomeCents:0});
test('Contábil sem Fiscal seleciona somente competências preenchidas de janeiro a setembro do mesmo ano',()=>{
  const period=accountingOnlyPeriod({months:[row('2026-03'),row('2026-01'),row('2026-10')]})!;
  assert.deepEqual(period.includedMonths,['2026-01','2026-03']);assert.equal(period.months,2);
  assert.equal(assertCompleteAnalysisPeriod(period),period);
  assert.equal(accountingOnlyPeriod({months:[row('2026-01'),row('2025-02')]}),null);
  assert.equal(accountingOnlyPeriod({months:[{...row('2026-01'),benefitsCents:null}]}),null);
  assert.equal(accountingOnlyPeriod({months:[]}),null);
});
test('um setor concluído só permite DRE parcial quando seus próprios dados são válidos',()=>{
  const accounting={status:'COMPLETE',data:{months:[row('2026-01')]}};
  assert.deepEqual(partialAnalysisAvailability({fiscal:{status:'DRAFT'},accounting},[{sector:'fiscal'}]),{allowed:true,missingSectors:['fiscal']});
  assert.deepEqual(partialAnalysisAvailability({fiscal:{status:'COMPLETE'},accounting:{...accounting,status:'DRAFT'}},[{sector:'accounting'}]),{allowed:true,missingSectors:['accounting']});
  assert.equal(partialAnalysisAvailability({fiscal:{status:'COMPLETE'},accounting:{...accounting,status:'DRAFT'}},[{sector:'fiscal'}]).allowed,false);
  assert.equal(partialAnalysisAvailability({fiscal:{status:'COMPLETE'},accounting},[{sector:'fiscal'}]).allowed,false);
  assert.equal(partialAnalysisAvailability({fiscal:{status:'DRAFT'},accounting:{...accounting,status:'DRAFT'}},[]).allowed,false);
});
test('a marca persistente da DRE parcial distingue ausência de setor de zero confirmado',()=>{
  assert.equal(partialAnalysisData([]),null);
  for(const sector of ['fiscal','accounting'] as const){
    const data=partialAnalysisData([sector])!;assert.equal(data.status,'INCOMPLETE');
    assert.match(data.warning,/confirmação do usuário/);assert.match(data.warning,/não representam dados confirmados/);
    assert.match(data.warning,new RegExp(sector==='fiscal'?'Fiscal':'Contábil'));
  }
});
test('Fiscal legível pendente de reconfirmação usa a fonte atual, inclusive se o Contábil ainda estiver em rascunho',()=>{
  const accounting={status:'COMPLETE',data:{months:[row('2026-01')]}};
  const fiscal={status:'COMPLETE'};
  assert.deepEqual(partialAnalysisAvailability({fiscal,accounting},[{sector:'fiscal',code:'FISCAL_SOURCE_CHANGED'}],{fiscalDataUsed:true}),
    {allowed:true,missingSectors:['fiscal'],fiscalDataUsed:true});
  assert.deepEqual(partialAnalysisAvailability({fiscal:{status:'DRAFT'},accounting:{...accounting,status:'DRAFT'}},
    [{sector:'fiscal',code:'FISCAL_NOT_CONFIRMED'},{sector:'accounting',code:'ACCOUNTING_NOT_CONFIRMED'}],{fiscalDataUsed:true}),
    {allowed:true,missingSectors:['fiscal','accounting'],fiscalDataUsed:true});
  assert.equal(partialAnalysisAvailability({fiscal,accounting},[{sector:'fiscal',code:'ANALYSIS_PERIOD_INCOMPLETE'}],{fiscalDataUsed:true}).allowed,false);
  assert.equal(partialAnalysisAvailability({fiscal,accounting},[{sector:'fiscal',code:'FISCAL_SOURCE_CHANGED'}]).allowed,false);
  assert.equal(partialAnalysisAvailability({fiscal,accounting},[{sector:'fiscal',code:'FISCAL_SOURCE_CHANGED'},{sector:'accounting',code:'ACCOUNTING_VALUES_MISSING'}],{fiscalDataUsed:true}).allowed,false);
  const current=partialAnalysisData(['fiscal'],{fiscalDataUsed:true})!;
  assert.equal(current.fiscalDataUsed,true);assert.match(current.warning,/documentos e as opções fiscais atuais disponíveis/);
  assert.doesNotMatch(current.warning,/consideradas zero|considerados zero/);
  const both=partialAnalysisData(['fiscal','accounting'],{fiscalDataUsed:true})!;
  assert.match(both.warning,/Contábil não foi concluído/);assert.match(both.warning,/despesas foram consideradas zero/);
});
