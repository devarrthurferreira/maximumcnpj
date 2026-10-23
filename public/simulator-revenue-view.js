import {buildRevenueReconciliation} from './revenue-reconciliation.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>Number.isSafeInteger(cents)?((cents===0?0:cents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' '):'—';

/** Explain the already-net editor fields without changing them or the captured source. */
export function renderRevenueReconciliationEditor({source,sourceMonth=null,scenarioRevenueCents=null,projected=false}={}){
  const reconciliation=projected?{status:'UNAVAILABLE',available:false,reason:'A separação entre receita bruta e devoluções não está comprovada nesta projeção histórica.'}:buildRevenueReconciliation({source,sourceMonth,scenarioRevenueCents});
  const available=reconciliation.available===true;
  const rows=[
    ['grossRevenueCents','Receita bruta de vendas e serviços',available?reconciliation.grossRevenueCents:null],
    ['salesReturnsCents','− Devoluções de vendas',available&&Number.isSafeInteger(reconciliation.salesReturnsCents)?-reconciliation.salesReturnsCents:null],
    ['revenueAfterReturnsCents','= Receita após devoluções',available?reconciliation.revenueAfterReturnsCents:null],
    ['manualAdjustmentCents','Ajustes manuais do cenário (+/−)',available?reconciliation.manualAdjustmentCents:null],
    ['usedRevenueCents','= Receita utilizada no mês',scenarioRevenueCents]
  ];
  return `<section class="sim-revenue-reconciliation" data-revenue-reconciliation="editor" data-revenue-status="${esc(reconciliation.status)}" aria-labelledby="editor-revenue-title"><header><h3 id="editor-revenue-title">Conferência da receita do mês</h3><p>${sourceMonth?`Competência de origem: ${esc(sourceMonth)}.`:'Valores mensais informados no cenário.'} ${available?'As devoluções da fonte já estão abatidas nos campos de vendas.':'A receita utilizada permanece separada da conferência de origem indisponível.'}</p></header><dl>${rows.map(([key,label,value])=>`<div${['revenueAfterReturnsCents','usedRevenueCents'].includes(key)?' class="revenue-reconciliation-total"':''}><dt>${label}</dt><dd data-revenue-value="${key}">${money(value)}</dd></div>`).join('')}</dl>${available?'':`<p class="revenue-reconciliation-unavailable" data-revenue-unavailable>${esc(reconciliation.reason||'Conferência da receita indisponível nesta versão.')}</p>`}<p class="revenue-reconciliation-note">Ao editar, informe as vendas após devoluções. A diferença em relação à fonte aparece como ajuste manual; nenhuma devolução será descontada novamente.</p></section>`;
}
