import test from 'node:test';
import assert from 'node:assert/strict';
import {drePdfFixture} from './fixtures/dre-pdf.mjs';
import {buildDrePresentation} from '../public/simulator-dre.js';
import {resolveDreVisibleRegimeIds,filterDreVisibleRegimes} from '../public/simulator-dre-visibility.js';
import {renderAnnualDre,renderCompleteMonthlyDre,renderDrePrintDocument} from '../public/simulator-dre-view.js';

function fixture(variant='complete'){
  const snapshot=drePdfFixture({variant});
  const presentation=buildDrePresentation({...snapshot,calendar:snapshot.monthlyDre,reportMonths:snapshot.reportMonths});
  return {snapshot,presentation,calendar:snapshot.monthlyDre,year:snapshot.year};
}
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const row=(html,key)=>html.match(new RegExp(`data-dre-row="${key}"[^>]*>([\\s\\S]*?)<\\/tr>`))?.[1];

test('visibilidade usa somente regimes gerados, mantém um e preserva dados fiscais e valores capturados',()=>{
  const input=fixture(),before=structuredClone(input);freeze(input);
  assert.deepEqual(resolveDreVisibleRegimeIds(input.presentation),['pure','hybrid','presumed','actual']);
  assert.deepEqual(resolveDreVisibleRegimeIds(input.presentation,['actual','presumed','actual','unknown']),['presumed','actual']);
  assert.deepEqual(resolveDreVisibleRegimeIds(input.presentation,[]),['pure']);
  const shown=filterDreVisibleRegimes(input.presentation,['actual']);
  assert.deepEqual(shown.regimes.map(regime=>regime.id),['actual']);
  assert.equal(shown.regimeSelection,input.presentation.regimeSelection);
  assert.equal(shown.sections,input.presentation.sections);
  assert.equal(shown.statement,input.presentation.statement);
  assert.equal(shown.taxStatement,input.presentation.taxStatement);
  assert.deepEqual(input,before);
  const partial=fixture('without-rbt12-only-simples');
  assert.deepEqual(resolveDreVisibleRegimeIds(partial.presentation,['actual','hybrid']),['hybrid']);
  assert.deepEqual(resolveDreVisibleRegimeIds(partial.presentation,['actual']),['pure']);
});

test('DRE e Impostos separados compartilham regimes e permanecem no consolidado mesmo ao receber visualização mensal',()=>{
  const input=fixture(),before=structuredClone(input);freeze(input);
  const visibleRegimeIds=['presumed','actual'];
  for(const monthly of [false,true]){
    const html=monthly?renderCompleteMonthlyDre({...input,month:8,visibleRegimeIds}):renderAnnualDre({...input,visibleRegimeIds});
    assert.equal((html.match(/data-dre-visible-regime=/g)||[]).length,4);
    assert.equal((html.match(/data-dre-regime-result=/g)||[]).length,2);
    assert.equal((row(html,'revenue').match(/<td /g)||[]).length,2);
    assert.equal((row(html,'totalTaxes').match(/<td /g)||[]).length,2);
    const expected=input.snapshot.result.regimes.find(regime=>regime.id==='actual');
    const [dre,taxes]=html.split('id="tax-demonstrativo"');
    assert(taxes,'Impostos é um card separado.');
    for(const key of ['das','icmsNet','cbsIbsNet','irpj','csll','icmsAnticipation','difal','payroll','totalTaxes','taxBurden']){
      assert.equal(row(dre,key),undefined,key+' não aparece na tabela da DRE.');
      assert.equal((row(taxes,key).match(/<td /g)||[]).length,2);
    }
    assert(row(dre,'taxesDeduction'));assert.equal((row(taxes,'irpj').match(/<td /g)||[]).length,2);
    assert(!dre.includes('data-irpj-reconciliation'));assert(taxes.includes('data-irpj-reconciliation'));
    assert(!dre.includes('data-dre-combined-rate'));assert(taxes.includes('data-dre-combined-rate'));
    assert.equal((html.match(/data-tax-statement="DRE_TAX_STATEMENT_V1"/g)||[]).length,1);
    assert(row(html,'netProfit').includes(expected.dre.netProfit.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ')));
    assert(row(html,'taxBurden').includes('%'));assert(row(html,'netMargin').includes('%'));
    assert.doesNotMatch(html,/id="dre-regime"|id="dre-show-percent"|id="dre-display-period"|Período da DRE|class="sim-period-toggle"|class="dre-quick-nav"|<h3>Demonstrativo completo/);
    assert.match(html,/11,40%/);assert.match(html,/CBS 11,30% \+ IBS 0,10%/);
    assert.match(html,/Jan–Set \/ 2025/);assert.match(html,/data-dre-period="annual"/);assert.match(html,/data-tax-period="annual"/);
  }
  assert.deepEqual(input,before);
});

test('regime pendente continua visível sem zeros fictícios e opções não geradas permanecem desabilitadas',()=>{
  const input=fixture('without-rbt12-only-simples'),html=renderAnnualDre({...input,visibleRegimeIds:['hybrid']});
  assert.match(html,/data-dre-visible-regime="actual"[^>]* disabled/);
  assert.match(html,/data-dre-visible-regime="presumed"[^>]* disabled/);
  assert.match(html,/data-dre-visible-regime="hybrid"[^>]* checked disabled/);
  assert.match(html,/Não gerado nesta versão/);assert.match(html,/Cálculo pendente/);
  assert.equal((row(html,'netProfit').match(/<td /g)||[]).length,1);
  assert.match(row(html,'netProfit'),/—/);assert.doesNotMatch(row(html,'netProfit'),/R\$ 0,00/);
});

test('impressão respeita regimes visíveis e mantém todas as competências reais do período',()=>{
  const input=fixture('partial'),before=structuredClone(input);freeze(input);
  const html=renderDrePrintDocument({...input,period:'complete',visibleRegimeIds:['actual']});
  assert.equal((html.match(/data-report-part="monthly"/g)||[]).length,1);
  assert.match(html,/data-report-regime="actual"/);assert.doesNotMatch(html,/data-report-regime="pure"|data-report-regime="hybrid"|data-report-regime="presumed"/);
  const monthly=html.split('data-report-part="monthly"')[1];
  assert.match(monthly,/Janeiro/);assert.match(monthly,/Março/);assert.match(monthly,/Setembro/);
  assert.equal((html.match(/data-tax-statement="DRE_TAX_STATEMENT_V1"/g)||[]).length,2);
  assert.match(monthly,/data-tax-period="monthly"/);
  assert(row(monthly,'irpj').includes((-input.snapshot.result.monthlyResults[0].result.regimes.find(regime=>regime.id==='actual').dre.irpj).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ')));
  assert.doesNotMatch(monthly,/Origem: 2025-02|Origem: 2025-10/);
  assert.deepEqual(input,before);
});
