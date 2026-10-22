import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOperationAudit,renderRbt12Schedule,renderAnticipationSource} from '../public/simulator-source-view.js';
import {renderSection22} from '../public/simulator-extrato-view.js';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {section22Year2025} from './fixtures/section22.ts';

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
  const reports=[{sourceMonth:'2025-01',anticipation:{version:'ICMS_ANTICIPATION_V3',issuerUf:'MG',baseCents:320_000,amountCents:23424,eligibleLines:2,pendingLines:0}},
    {sourceMonth:'2025-02',anticipation:{version:'ICMS_ANTICIPATION_V3',issuerUf:'MG',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:1}}];
  const html=renderAnticipationSource({reports,row:reports[1],adjusted:true});
  assert.match(html,/data-anticipation-monthly>Pendente/);assert.match(html,/Estimativa do período importado/);
  assert.match(html,/R\$\s234,24/);assert.match(html,/Simples puro e híbrido/);assert.match(html,/sublimite alcançado/);
  assert.match(html,/Estimativa parcial: 1 linhas aguardam UF/);assert.match(html,/data-anticipation-adjusted/);
  assert.match(html,/compras interestaduais com CPF ou CNPJ válido/);
  const cpf=renderAnticipationSource({reports:reports.map(row=>({...row,anticipation:{...row.anticipation,version:'ICMS_ANTICIPATION_V2'}}))});
  assert.match(cpf,/compras interestaduais com CPF,/);assert.doesNotMatch(cpf,/CPF ou CNPJ/);
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
