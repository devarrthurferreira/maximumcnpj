import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadingMarkup} from '../public/ui-loading.js';
import {includesEntry,captureEntryInclusions} from '../public/analysis-difal-inclusion.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';
globalThis.document={querySelector:()=>({})};
const {renderDifalChoice}=await import('../public/analyses-view.js');
delete globalThis.document;

test('carregamento acessível não inventa porcentagens nem interpreta HTML externo',()=>{
  const html=loadingMarkup({title:'<script>teste</script>',detail:'A & B'});
  assert.match(html,/role="status"/);assert.match(html,/aria-live="polite"/);assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; B/);
  assert.doesNotMatch(html,/<script>|aria-valuenow|\d+%/);
  assert.match(loadingMarkup({compact:true}),/is-compact/);
});
test('uma escolha por regime preserva exatamente as preferências não editadas',()=>{
  const original=defaultDifalPolicy();original.operations.pure.entry=false;original.enabled.hybrid=false;
  const before=structuredClone(original),result=captureEntryInclusions(original,[['pure',false],['hybrid',false]]);
  assert.deepEqual(result,before);assert.deepEqual(original,before);assert.notEqual(result,original);
});
test('alterar a inclusão atualiza somente a entrada do regime escolhido',()=>{
  const original=defaultDifalPolicy(),result=captureEntryInclusions(original,[['pure',false]]);
  assert.equal(includesEntry(result,'pure'),false);assert.equal(result.enabled.pure,false);assert.equal(result.operations.pure.entry,false);
  assert.deepEqual(result.operations.hybrid,original.operations.hybrid);assert.equal(result.operations.pure.exit,false);
  assert.equal(includesEntry(captureEntryInclusions(result,[['pure',true]]),'pure'),true);
  assert.throws(()=>captureEntryInclusions(original,[['actual',true]]));assert.throws(()=>captureEntryInclusions(original,[['pure','yes']]));
});
test('tela simplificada mantém uma opção por regime e não presume a escolha geral',()=>{
  const html=renderDifalChoice({version:'REGIME_SELECTION_V1',selected:['pure','hybrid']},defaultDifalPolicy(),{choice:null,
    assessment:{entry:{state:'available',amountCents:7320,baseCents:100000,eligibleLines:1},exit:{state:'disabled',amountCents:0}},reading:true});
  assert.equal((html.match(/data-difal-include=/g)||[]).length,2);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2);
  assert.doesNotMatch(html,/value="(?:yes|no)"[^>]*checked/);assert.match(html,/Conferindo os relatórios/);
  assert.doesNotMatch(html,/data-analysis-difal-operation="exit"/);
});
test('estilos de carregamento oferecem movimento reduzido',()=>{
  assert.match(readFileSync(new URL('../public/ui-loading.css',import.meta.url),'utf8'),/prefers-reduced-motion:reduce/);
});
