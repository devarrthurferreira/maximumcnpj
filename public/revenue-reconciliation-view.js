import {buildRevenueReconciliation} from './revenue-reconciliation.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

/** Present the server's reconciled report pair; absence is never a confirmed zero. */
export function renderRevenueReconciliation(value,{heading='Fechamento da receita',headingLevel=2,csvAction=false}={}){
  value=value==null?null:buildRevenueReconciliation({source:value});
  const valid=value?.available===true&&value.status==='AVAILABLE';
  const pending=!valid&&value?.status==='PENDING',state=valid?'available':pending?'pending':'unavailable';
  const titleLevel=headingLevel===3?3:2;
  const reason=valid?'Receita dos relatórios vinculados desta empresa, após as devoluções e antes dos tributos e dos ajustes da simulação.':
    typeof value?.reason==='string'&&value.reason.trim()?value.reason:value?.available===true?'Os valores da receita não estão conciliados. Atualize a situação dos relatórios para conferir.':'Não há um par confirmado de compras e vendas para demonstrar a receita e suas devoluções neste relatório.';
  return `<section class="card revenue-reconciliation${valid?'':' is-unavailable'}" data-revenue-reconciliation data-revenue-status="${state}" aria-label="${esc(heading)}"><header><div><div class="eyebrow">CONFERÊNCIA FINAL</div><h${titleLevel}>${esc(heading)}</h${titleLevel}></div><span class="revenue-reconciliation-state">${valid?'Valores conciliados':pending?'Aguardando relatórios':'Indisponível'}</span></header><dl class="revenue-reconciliation-values">${[
    ['grossRevenueCents','Receita bruta · vendas e serviços'],
    ['salesReturnsCents','(−) Devoluções de venda'],
    ['revenueAfterReturnsCents','(=) Receita após devoluções']
  ].map(([key,label])=>`<div${key==='revenueAfterReturnsCents'?' class="revenue-reconciliation-total"':''}><dt>${label}</dt><dd data-revenue-value="${key}">${valid?`${key==='salesReturnsCents'&&value[key]>0?'− ':''}${money(value[key])}`:'—'}</dd></div>`).join('')}</dl><p class="revenue-reconciliation-note" data-revenue-reason>${esc(reason)}</p>${valid?`<details class="revenue-reconciliation-details"><summary>Composição da receita bruta</summary><dl><div><dt>Vendas de mercadorias</dt><dd data-revenue-component="grossSalesCents">${money(value.grossSalesCents)}</dd></div><div><dt>Serviços</dt><dd data-revenue-component="serviceSalesCents">${money(value.serviceSalesCents)}</dd></div></dl><p>Somente vendas e serviços compõem a receita bruta. As devoluções de venda vêm do relatório de compras; devoluções de compra e outras operações ficam fora desta receita.</p></details>`:''}${csvAction?`<div class="revenue-reconciliation-actions"><button type="button" id="purchase-revenue-csv" ${valid?'':'disabled'}>Baixar fechamento CSV</button><p id="purchase-revenue-download-status" role="status" aria-live="polite"></p></div>`:''}</section>`;
}
