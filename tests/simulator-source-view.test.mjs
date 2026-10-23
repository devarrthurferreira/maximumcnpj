import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOperationAudit,renderRbt12Schedule,renderAnticipationSource,buildDifalApplicationView,difalApplicationSummary,renderDifalAppliedSource} from '../public/simulator-source-view.js';
import {difalDirectionSelection} from '../public/difal-policy.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';
import {renderSection22} from '../public/simulator-extrato-view.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {section22Year2025} from './fixtures/section22.ts';
import {renderRevenueReconciliationEditor} from '../public/simulator-revenue-view.js';

function editorRevenueSource(){
  return {monthlyReports:[{sourceMonth:'2025-01',operationVersion:'NATURE_OPERATIONS_2026_10_V1',
    operationAudit:{grossSalesCents:100000,serviceSalesCents:20000,salesReturnsCents:15000},
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:85000,serviceRevenueCents:20000}}]};
}

test('editor mostra receita após devoluções e ajuste em separado sem alterar a fonte',()=>{
  const source=editorRevenueSource(),before=structuredClone(source);
  for(const [used,adjusted] of [[105000,'R$ 0,00'],[115000,'R$ 100,00'],[95000,'-R$ 100,00']]){
    const html=renderRevenueReconciliationEditor({source,sourceMonth:'2025-01',scenarioRevenueCents:used});
    assert.match(html,/data-revenue-status="AVAILABLE"/);
    assert(html.includes('data-revenue-value="grossRevenueCents">R$ 1.200,00'));
    assert(html.includes('data-revenue-value="salesReturnsCents">-R$ 150,00'));
    assert(html.includes('data-revenue-value="revenueAfterReturnsCents">R$ 1.050,00'));
    assert(html.includes(`data-revenue-value="manualAdjustmentCents">${adjusted}`));
    assert(html.includes(`data-revenue-value="usedRevenueCents">${(used/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ')}`));
    assert.match(html,/informe as vendas após devoluções/);assert.match(html,/nenhuma devolução será descontada novamente/);assert(!html.includes('<details'));
  }
  assert.deepEqual(source,before);
});

test('editor distingue devolução zero confirmada de origem indisponível e projeção antiga',()=>{
  const source=editorRevenueSource();source.monthlyReports[0].operationAudit.salesReturnsCents=0;source.monthlyReports[0].fields.salesCpfCents=100000;
  const zero=renderRevenueReconciliationEditor({source,sourceMonth:'2025-01',scenarioRevenueCents:120000});
  assert(zero.includes('data-revenue-value="salesReturnsCents">R$ 0,00'));
  for(const input of [{source:null},{source,sourceMonth:'2025-02'},{source,projected:true}]){
    const html=renderRevenueReconciliationEditor({...input,scenarioRevenueCents:120000});
    assert.match(html,/data-revenue-status="UNAVAILABLE"/);
    assert(html.includes('data-revenue-value="grossRevenueCents">—'));
    assert(html.includes('data-revenue-value="salesReturnsCents">—'));
    assert(html.includes('data-revenue-value="manualAdjustmentCents">—'));
    assert(html.includes('data-revenue-value="usedRevenueCents">R$ 1.200,00'));
    assert.match(html,/data-revenue-unavailable/);assert(!html.includes('R$ 0,00'));
  }
});

test('reconciliation presents sales returns separately and does not include them in purchases',()=>{
  const html=renderOperationAudit({grossSalesCents:1_000_000,serviceSalesCents:50_000,salesReturnsCents:100_000,purchaseGoodsCents:300_000,purchaseServicesCents:20_000,excludedSalesCents:90_000,excludedPurchaseCents:10_000,unknownSalesLines:1,unknownPurchaseLines:0,
    natures:[{side:'PURCHASES',natureCode:'1202',operation:'DEVOLUCAO_VENDA',lines:1,sourceCents:100_000,salesCents:0,purchasesCents:0,salesReturnsCents:100_000,excludedCents:0}]});
  assert.match(html,/coluna D \(OPERAÇÃO\)/);
  assert.match(html,/Receita considerada · vendas \+ serviços − devoluções<\/span><strong>R\$\s9\.500,00/);
  assert.match(html,/Compras consideradas · compras \+ serviços<\/span><strong>R\$\s3\.200,00/);
  assert.match(html,/1 linhas de vendas e 0 linhas de compras/);
  assert.match(html,/Devolução de venda/);
  assert.equal(renderOperationAudit(null),'');
});

test('incomplete RBT12 window is explicitly pending and never displayed as zero',()=>{
  const html=renderRbt12Schedule({version:'RBT12_MONTHLY_SECTION_22_V1',complete:false,rows:[
    {sourceMonth:'2025-01',status:'CONFIRMED',rbt12Cents:7_800_000,startMonth:'2024-01',endMonth:'2024-12',missingMonths:[]},
    {sourceMonth:'2025-02',status:'MISSING_MONTHS',rbt12Cents:null,startMonth:'2024-02',endMonth:'2025-01',missingMonths:['2024-02']}
  ]});
  assert.match(html,/R\$\s78\.000,00/);assert.match(html,/Faltam: 02\/2024/);assert.doesNotMatch(html,/R\$\s0,00/);
  assert.match(html,/nenhuma lacuna será tratada como zero/);
  assert.equal(renderRbt12Schedule(null),'');
});

test('RBT12 composition exposes exactly twelve saved monthly revenues, including smaller and external amounts',()=>{
  const extraction=section22Year2025();
  Object.assign(extraction.priorRevenues[0],{internalCents:9,externalCents:11,totalCents:20});
  Object.assign(extraction.priorRevenues[1],{internalCents:1234567,externalCents:0,totalCents:1234567});
  const schedule=buildRbt12Schedule(extraction,['2025-01','2025-02']),before=structuredClone(schedule);
  const html=renderRbt12Schedule(schedule);
  assert.match(html,/sim-rbt12-schedule" open/);assert.match(html,/receita de um mês e a RBT12 acumulada são valores diferentes/);
  const january=html.split('data-rbt12-window="2025-01"')[1].split('data-rbt12-window="2025-02"')[0];
  assert.match(january,/Conferir 01\/2025 · 12 receitas mensais/);
  assert.match(january,/R\$\s0,09/);assert.match(january,/R\$\s0,11/);assert.match(january,/R\$\s0,20/);assert.match(january,/R\$\s12\.345,67/);
  assert.equal((january.match(/<tr><th scope="row">/g)||[]).length,12);
  assert.match(january,/O mês 01\/2025 não entra na própria RBT12/);
  const annual=(schedule.rows[0].rbt12Cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  assert(january.includes(annual));assert.deepEqual(schedule,before);
});

test('anticipation shows source estimate distinctly from the amount applied by regime and sublimit',()=>{
  const reports=[{sourceMonth:'2025-01',anticipation:{version:'ICMS_ANTICIPATION_V4',issuerUf:'MG',baseCents:320_000,amountCents:23424,eligibleLines:2,pendingLines:0}},
    {sourceMonth:'2025-02',anticipation:{version:'ICMS_ANTICIPATION_V4',issuerUf:'MG',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:1}}];
  const html=renderAnticipationSource({reports,row:reports[1],adjusted:true});
  assert.match(html,/data-anticipation-monthly>Pendente/);assert.match(html,/Estimativa do período importado/);
  assert.match(html,/R\$\s234,24/);assert.match(html,/Simples puro e híbrido/);assert.match(html,/sublimite alcançado/);
  assert.match(html,/Estimativa parcial: 1 linhas aguardam UF/);assert.match(html,/data-anticipation-adjusted/);
  assert.match(html,/compras interestaduais com CPF ou CNPJ válido/);
  assert.match(html,/Somente operações COMPRAS integram a base/);assert.match(html,/prefixo 8000, inclusive com sufixos, ficam fora da antecipação e permanecem nos custos/);
  const v3=renderAnticipationSource({reports:reports.map(row=>({...row,anticipation:{...row.anticipation,version:'ICMS_ANTICIPATION_V3'}}))});
  assert.match(v3,/regra histórica inclui naturezas classificadas como compras ou serviços 8000/);assert.match(v3,/CPF ou CNPJ válido/);
  const cpf=renderAnticipationSource({reports:reports.map(row=>({...row,anticipation:{...row.anticipation,version:'ICMS_ANTICIPATION_V2'}}))});
  assert.match(cpf,/compras interestaduais com CPF\./);assert.doesNotMatch(cpf,/CPF ou CNPJ/);
  const legacy=renderAnticipationSource({reports:reports.map(row=>({...row,anticipation:{...row.anticipation,version:'ICMS_ANTICIPATION_V1'}}))});
  assert.match(legacy,/regra histórica salva/);assert.doesNotMatch(legacy,/compras interestaduais com CPF/);
  assert.equal(renderAnticipationSource({reports:[{sourceMonth:'2025-01'}]}),'');
});

test('full section 2.2 history remains inspectable alongside the PA window',()=>{
  const extraction={...section22Year2025(),companyName:'Empresa <teste>'},before=structuredClone(extraction);
  const html=renderSection22(extraction);
  assert.match(html,/23 receitas mensais extraídas/);assert.match(html,/01\/2024/);assert.match(html,/11\/2025/);
  assert.match(html,/Receitas mensais do quadro 2.2/);assert.match(html,/RBT12 de referência do PA 12\/2025/);
  assert(html.indexOf('data-section22-history')<html.indexOf('sim-extrato-pa'));
  assert.equal((html.match(/data-section22-month=/g)||[]).length,23);
  assert.match(html,/Empresa &lt;teste&gt;/);assert.doesNotMatch(html,/<teste>/);
  assert.equal((html.match(/<th scope="row">/g)||[]).length,36);
  assert.deepEqual(extraction,before);
  const legacy={...extraction};delete legacy.priorRevenues;
  assert.match(renderSection22(legacy),/12 receitas mensais extraídas/);
  assert.match(renderSection22({...extraction,rbt12Cents:extraction.rbt12Cents+1}),/Não foi possível conferir esta leitura salva/);
  assert.equal(renderSection22(null),'');
});

const difalReports=()=>[1,2].map(month=>({sourceMonth:`2025-0${month}`,month,
  difal:{amountCents:10000*month,eligibleLines:1,pendingLines:0},
  anticipation:{amountCents:3660*month,eligibleLines:1,pendingLines:0}}));
const entryOnlyPolicy=()=>{const policy=defaultDifalPolicy();policy.operations.pure.exit=false;policy.operations.hybrid.exit=false;return policy;};
const sourceView=(direction,policy,reports=difalReports(),extra={})=>buildDifalApplicationView({direction,policy,reports,row:reports[0],rbt12ByMonth:{'2025-01':100000,'2025-02':100000},...extra});

test('direction selection distinguishes absent policy from invalid policy and keeps scenarios independent',()=>{
  assert.equal(difalDirectionSelection(undefined,'exit'),null);
  assert.throws(()=>difalDirectionSelection(null,'exit'));
  assert.throws(()=>difalDirectionSelection(defaultDifalPolicy(),'other'));
  const policy=entryOnlyPolicy();policy.enabled.pure=false;
  assert.deepEqual(difalDirectionSelection(policy,'exit').regimeIds,[]);
  assert.deepEqual(difalDirectionSelection(policy,'entry').regimeIds,['hybrid']);
  const legacy={version:'DIFAL_SCENARIOS_V1',enabled:{pure:false,hybrid:true,presumed:true,actual:true}},before=structuredClone(legacy);
  assert.deepEqual(difalDirectionSelection(legacy,'exit').regimeIds,['hybrid']);
  assert.deepEqual(difalDirectionSelection(legacy,'entry').regimeIds,['hybrid']);
  assert.deepEqual(legacy,before);
});

test('deselecting both sales directions zeros the summary while preserving purchases and raw estimates',()=>{
  const policy=entryOnlyPolicy(),reports=difalReports(),before=structuredClone({policy,reports});
  const exit=sourceView('exit',policy,reports),entry=sourceView('entry',policy,reports);
  assert.deepEqual(exit.values.map(row=>[row.current,row.total,row.excluded]),[[0,0,true],[0,0,true]]);
  assert.match(difalApplicationSummary(exit),/R\$\s0,00/);
  assert.deepEqual(entry.values.map(row=>[row.current,row.total,row.excluded]),[[36.6,109.8,false],[36.6,109.8,false]]);
  const html=renderDifalAppliedSource({view:exit,sourceHtml:'<section><strong data-difal-monthly>R$ 100,00</strong><strong data-difal-amount>R$ 300,00</strong></section>'});
  const [applied,audit]=html.split('<details class="sim-difal-source-audit"');
  assert.match(applied,/data-difal-application-status>Não incluído/);
  assert.match(applied,/data-difal-monthly>R\$\s0,00/);
  assert.doesNotMatch(applied,/100,00|300,00/);
  assert.match(audit,/data-difal-source-monthly>R\$ 100,00/);
  assert.match(audit,/data-difal-source-amount>R\$ 300,00/);
  assert.doesNotMatch(audit.split('>')[0],/open/);
  assert.deepEqual({policy,reports},before);
});

test('mixed scenario directions show individual amounts without summing alternatives',()=>{
  const policy=defaultDifalPolicy();policy.operations.pure.exit=false;policy.operations.hybrid.entry=false;
  const exit=sourceView('exit',policy),entry=sourceView('entry',policy);
  assert.deepEqual(exit.values.map(row=>[row.id,row.current,row.total]),[['pure',0,0],['hybrid',100,300]]);
  assert.deepEqual(entry.values.map(row=>[row.id,row.current,row.total]),[['pure',36.6,109.8],['hybrid',0,0]]);
  assert.equal(difalApplicationSummary(exit),'Por cenário');assert.equal(difalApplicationSummary(entry),'Por cenário');
  const html=renderDifalAppliedSource({view:exit});
  assert.match(html,/data-difal-applied-regime="pure"/);assert.match(html,/data-difal-applied-regime="hybrid"/);
  assert.match(html,/Os cenários são alternativas; seus valores não são somados/);
  assert.match(html,/sim-difal-selection-label">Simples híbrido/);
});

test('source display honors each month sublimit and leaves unimported months unavailable',()=>{
  const reports=difalReports(),policy=defaultDifalPolicy();
  const view=sourceView('exit',policy,reports,{row:reports[1],rbt12ByMonth:{'2025-01':100000,'2025-02':3600000}});
  assert.deepEqual(view.values.map(row=>[row.current,row.total,row.blocked]),[[0,100,true],[0,100,true]]);
  assert.match(renderDifalAppliedSource({view}),/Bloqueio por competência/);
  const missing=sourceView('exit',entryOnlyPolicy(),reports,{row:null});
  assert.deepEqual(missing.values.map(row=>[row.current,row.total]),[[null,0],[null,0]]);
  assert.equal(difalApplicationSummary(missing),'Indisponível');
  assert.doesNotMatch(renderDifalAppliedSource({view:missing}),/Conforme a versão salva/);
});

test('ICMS fora do DAS atualiza a prévia de entrada e saída sem alterar escolhas ou fontes',()=>{
  const reports=difalReports(),policy=defaultDifalPolicy(),before=structuredClone({reports,policy});
  for(const direction of ['entry','exit']){
    const inside=sourceView(direction,policy,reports);
    assert(inside.values.every(row=>row.current>0&&!row.blocked));
    const outside=sourceView(direction,policy,reports,{icmsOutside:true});
    assert(outside.values.every(row=>row.current===0&&row.total===0&&row.blocked));
    assert.match(renderDifalAppliedSource({view:outside}),/fora do DAS/);
  }
  const excluded=sourceView('exit',entryOnlyPolicy(),reports,{icmsOutside:true});
  assert(excluded.values.every(row=>row.excluded&&!row.blocked&&row.current===0));
  assert.deepEqual({reports,policy},before);
});

test('histórico com regime parcialmente calculado não apresenta a soma parcial de DIFAL como total confirmado',()=>{
  const policy=defaultDifalPolicy();
  const regimes=['pure','hybrid'].map(id=>({id,name:id,available:false,status:'Conferir fevereiro',dre:{difal:-100,icmsAnticipation:-36.6},difalApplication:{enabled:true,operations:policy.operations[id]}}));
  const first=regimes.map(row=>({...row,available:true,status:'Disponível',difalApplication:{...row.difalApplication,reason:'ENABLED'}}));
  const second=regimes.map(row=>({...row,dre:{difal:0,icmsAnticipation:0},difalApplication:{...row.difalApplication,blocked:true,reason:'SUBLIMIT'}}));
  const snapshot={draft:{difalPolicy:policy},result:{method:'REPORT_MONTHS_V1',regimes,monthlyResults:[{month:1,sourceMonth:'2025-01',result:{regimes:first}},{month:2,sourceMonth:'2025-02',result:{regimes:second}}]}};
  const original=structuredClone(snapshot);
  for(const direction of ['entry','exit']){
    const available=sourceView(direction,policy,difalReports(),{snapshot});
    assert(available.values.every(row=>row.current>0&&row.total===null&&row.pending));
    const pending=sourceView(direction,policy,difalReports(),{snapshot,monthIndex:1});
    assert(pending.values.every(row=>row.current===null&&row.total===null&&row.pending));
    const html=renderDifalAppliedSource({view:pending,sourceHtml:'<strong>Estimativa original R$ 999,00</strong>'});
    assert.match(html,/Conferir fevereiro/);
    assert.doesNotMatch(html.split('<details class="sim-difal-source-audit"')[0],/999,00/);
  }
  assert.deepEqual(snapshot,original);
  for(const row of [...regimes,...first,...second]){row.dre.difal=0;row.difalApplication.operations.exit=false;}
  const excluded=sourceView('exit',policy,difalReports(),{snapshot,monthIndex:1});
  assert(excluded.values.every(row=>row.current===0&&row.total===0&&row.excluded&&!row.pending));
  const absent=sourceView('exit',policy,difalReports(),{snapshot,monthIndex:2});
  assert(absent.values.every(row=>row.current===null&&row.total===0&&!row.excluded&&!row.pending));
  assert.equal(difalApplicationSummary(absent),'Indisponível');
  assert.match(difalApplicationSummary(absent,'total'),/R\$\s0,00/);
  assert(original.result.regimes.every(row=>row.dre.difal===-100));
});

test('missing or fully pending source cannot appear as a confirmed zero unless the direction is excluded',()=>{
  const reports=difalReports();delete reports[0].difal;delete reports[1].difal;
  const missing=sourceView('exit',defaultDifalPolicy(),reports);
  assert.equal(difalApplicationSummary(missing),'Indisponível');
  assert.equal(renderDifalAppliedSource({view:missing,sourceHtml:'<p>DIFAL indisponível</p>'}),'<p>DIFAL indisponível</p>');
  for(const row of reports)row.difal={amountCents:0,eligibleLines:0,pendingLines:1};
  const pending=sourceView('exit',defaultDifalPolicy(),reports);
  assert.equal(difalApplicationSummary(pending),'Pendente');assert.equal(difalApplicationSummary(pending,'total'),'Pendente');
  assert.deepEqual(pending.values.map(row=>row.current),[null,null]);
  const off=sourceView('exit',entryOnlyPolicy(),reports);
  assert.match(difalApplicationSummary(off),/R\$\s0,00/);assert(off.values.every(row=>!row.pending&&row.excluded));
  const legacy=buildDifalApplicationView({direction:'exit',policy:defaultDifalPolicy(),rbt12:100000,currentCents:0,totalCents:0,sourceEstimate:{pendingLines:2,eligibleLines:0}});
  assert.equal(difalApplicationSummary(legacy),'Pendente');
});

test('saved entry-only display reads directional choices and frozen DRE amounts without recalculating',()=>{
  const policy=entryOnlyPolicy(),reports=difalReports();
  const regimes=['pure','hybrid'].map(id=>({id,name:id,dre:{difal:0,icmsAnticipation:-109.8},difalApplication:{enabled:true,operations:policy.operations[id]}}));
  const current=regimes.map(regime=>({...regime,dre:{difal:0,icmsAnticipation:-36.6},difalApplication:{...regime.difalApplication,reason:'ENABLED',blocked:false,message:'Incluído: entrada. Saída não selecionada.'}}));
  const snapshot={draft:{difalPolicy:policy},result:{method:'REPORT_MONTHS_V1',regimes,monthlyResults:[{month:1,sourceMonth:'2025-01',result:{regimes:current}}]}};
  const before=structuredClone(snapshot);reports[0].difal.amountCents=999999;reports[0].anticipation.amountCents=888888;
  const exit=sourceView('exit',defaultDifalPolicy(),reports,{snapshot,rbt12ByMonth:{'2025-01':4000000}});
  const entry=sourceView('entry',defaultDifalPolicy(),reports,{snapshot,rbt12ByMonth:{'2025-01':4000000}});
  assert(exit.values.every(row=>row.excluded));assert.match(renderDifalAppliedSource({view:exit}),/data-difal-application-status>Não incluído/);
  assert.deepEqual(entry.values.map(row=>[row.current,row.total]),[[36.6,109.8],[36.6,109.8]]);
  assert.deepEqual(snapshot,before);
  const absent=sourceView('exit',policy,reports,{snapshot,monthIndex:2});
  assert.deepEqual(absent.values.map(row=>[row.current,row.total,row.excluded]),[[null,0,false],[null,0,false]]);
  for(const row of current)row.difalApplication={...row.difalApplication,reason:'SUBLIMIT',blocked:true};
  const stillOff=sourceView('exit',policy,reports,{snapshot});assert(stillOff.values.every(row=>!row.blocked&&row.excluded));
  for(const id of ['pure','hybrid'])policy.operations[id].exit=true;
  const blocked=sourceView('exit',policy,reports,{snapshot});assert(blocked.values.every(row=>row.blocked&&!row.excluded));
});

test('legacy historical values including other regimes and captured calendar cells remain unchanged',()=>{
  const legacy={version:'DIFAL_SCENARIOS_V1',enabled:{pure:true,hybrid:true,presumed:true,actual:true}};
  const regimes=['pure','hybrid','presumed','actual'].map((id,index)=>({id,name:id,dre:{difal:-(index+1)*120}}));
  const snapshot={draft:{difalPolicy:legacy},result:{regimes},monthlyDre:{regimes:[{id:'pure',rows:[{key:'difal',months:[-999]}]}]}};
  const before=structuredClone(snapshot),view=sourceView('exit',entryOnlyPolicy(),difalReports(),{snapshot});
  assert.deepEqual(view.values.map(row=>[row.id,row.current,row.total]),[['pure',999,120],['hybrid',20,240],['presumed',30,360],['actual',40,480]]);
  assert.deepEqual(snapshot,before);assert(view.historical);assert.equal(difalApplicationSummary(view),'Por cenário');
  delete snapshot.draft.difalPolicy;
  assert.equal(sourceView('exit',entryOnlyPolicy(),difalReports(),{snapshot}).values.length,4);
  for(const regime of snapshot.result.regimes)delete regime.dre.difal;
  assert.equal(sourceView('exit',defaultDifalPolicy(),difalReports(),{snapshot}),null);
});
