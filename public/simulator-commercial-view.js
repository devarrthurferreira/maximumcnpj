/** Display the captured commercial composition. Financial results are calculated elsewhere. */
const VERSION='COMMERCIAL_COMPOSITION_V1';
const CUSTOMERS=['B2B','B2C','UNIDENTIFIED'];
const STATUSES=['OPTANTE','NAO_OPTANTE','CPF','NAO_CONFIRMADO','OUTROS'];
const labels={B2B:'B2B · CNPJ',B2C:'B2C · CPF',UNIDENTIFIED:'Não identificado',
  OPTANTE:'Optantes do Simples',NAO_OPTANTE:'Fora do Simples',CPF:'CPF',NAO_CONFIRMADO:'Enquadramento não confirmado',OUTROS:'Outros documentos'};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const shareFormat=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const money=value=>currency.format(value/100);
const share=value=>value===null?'—':shareFormat.format(value)+'%';
const amount=(value,signed=false)=>Number.isSafeInteger(value)&&(signed||value>=0);
const add=(groups,key)=>groups.reduce((sum,group)=>sum+group[key],0);
function groupsValid(groups,keys,total,revenue=false){
  return Array.isArray(groups)&&groups.length===keys.length&&groups.every((group,index)=>group&&group.key===keys[index]&&
    amount(group.totalCents,revenue)&&(!revenue||amount(group.grossCents)&&amount(group.returnsCents)&&group.grossCents-group.returnsCents===group.totalCents)&&
    (total>0?typeof group.percent==='number'&&Number.isFinite(group.percent)&&Math.abs(group.percent-group.totalCents/total*100)<=.011:group.percent===null))&&
    add(groups,'totalCents')===total;
}
function valid(value){
  const revenue=value?.revenue,purchases=value?.purchases;
  return value?.version===VERSION&&value.unit==='CENTS'&&Array.isArray(value.sourceMonths)&&value.sourceMonths.length>0&&
    value.sourceMonths.every(month=>typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month))&&new Set(value.sourceMonths).size===value.sourceMonths.length&&
    revenue&&purchases&&amount(revenue.grossCents)&&amount(revenue.returnsCents)&&amount(revenue.totalCents,true)&&
    revenue.grossCents-revenue.returnsCents===revenue.totalCents&&revenue.percentDenominatorCents===revenue.totalCents&&
    amount(purchases.totalCents)&&purchases.percentDenominatorCents===purchases.totalCents&&
    groupsValid(revenue.byCustomerType,CUSTOMERS,revenue.totalCents,true)&&groupsValid(revenue.byTaxStatus,STATUSES,revenue.totalCents,true)&&
    add(revenue.byCustomerType,'grossCents')===revenue.grossCents&&add(revenue.byCustomerType,'returnsCents')===revenue.returnsCents&&
    add(revenue.byTaxStatus,'grossCents')===revenue.grossCents&&add(revenue.byTaxStatus,'returnsCents')===revenue.returnsCents&&
    groupsValid(purchases.byTaxStatus,STATUSES,purchases.totalCents);
}
const active=group=>group.totalCents!==0||(group.grossCents??0)!==0||(group.returnsCents??0)!==0;
function rows(groups,{customers=false}={}){
  return groups.filter(group=>customers?group.key!=='UNIDENTIFIED'||active(group):!['NAO_CONFIRMADO','OUTROS'].includes(group.key)||active(group)).map(group=>{
    const bar=group.percent!==null&&group.percent>=0&&group.percent<=100;
    return `<div class="commercial-breakdown-row${group.totalCents<0?' is-negative':''}" data-commercial-group="${esc(group.key)}"><div class="commercial-breakdown-label"><span>${esc(labels[group.key])}</span><span class="commercial-share" data-commercial-percent>${esc(share(group.percent))}</span></div><strong data-commercial-value>${esc(money(group.totalCents))}</strong>${bar?`<div class="commercial-share-track" aria-hidden="true"><span style="width:${group.percent}%"></span></div>`:''}</div>`;
  }).join('');
}
function sourceLabel(months){
  const names=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const format=month=>names[Number(month.slice(5))-1]+'/'+month.slice(0,4),sorted=[...months].sort();
  return sorted.length===1?format(sorted[0]):`${sorted.length} competências · ${format(sorted[0])} a ${format(sorted.at(-1))}`;
}

/** Pass a month composition for the monthly view, or the already aggregated selected period. */
export function renderCommercialComposition(composition,{periodLabel='',title='Receitas e compras'}={}){
  if(composition==null)return '';
  if(!valid(composition))return '<section class="commercial-composition commercial-unavailable" data-commercial-unavailable role="status"><strong>Composição comercial indisponível</strong><p>Os dados desta versão não permitem conferir a distribuição de receitas e compras.</p></section>';
  const {revenue,purchases}=composition;
  const negative=revenue.byCustomerType.some(group=>group.totalCents<0)||revenue.byTaxStatus.some(group=>group.totalCents<0);
  const pending=[...revenue.byTaxStatus,...purchases.byTaxStatus].some(group=>group.key==='NAO_CONFIRMADO'&&active(group));
  const revenueBase=revenue.totalCents>0?`Percentuais sobre ${money(revenue.totalCents)} de receita após devoluções.`:'A receita após devoluções não tem saldo positivo para calcular participações.';
  const purchaseBase=purchases.totalCents>0?`Percentuais sobre ${money(purchases.totalCents)} de compras selecionadas.`:'Sem compras selecionadas para calcular participações.';
  return `<section class="commercial-composition" data-commercial-composition aria-label="${esc(title)}"><div class="commercial-composition-heading"><h2>${esc(title)}</h2><span>${esc(periodLabel||sourceLabel(composition.sourceMonths))}</span></div><div class="commercial-composition-grid">
    <article class="commercial-card" data-commercial-side="revenue"><header><span class="commercial-card-label">Receita após devoluções</span><strong class="commercial-card-total${revenue.totalCents<0?' is-negative':''}" data-commercial-total>${esc(money(revenue.totalCents))}</strong><p class="commercial-denominator">${esc(revenueBase)}</p></header><div class="commercial-breakdown" data-commercial-audience>${rows(revenue.byCustomerType,{customers:true})}</div>
      <details class="commercial-tax-details"><summary>Enquadramento dos clientes</summary><div class="commercial-breakdown" data-commercial-tax-status>${rows(revenue.byTaxStatus)}</div></details>
      <dl class="commercial-revenue-bridge"><div><dt>Vendas e serviços antes das devoluções</dt><dd>${esc(money(revenue.grossCents))}</dd></div><div><dt>Devoluções de venda abatidas</dt><dd>${esc(money(-revenue.returnsCents))}</dd></div></dl>
    </article>
    <article class="commercial-card" data-commercial-side="purchases"><header><span class="commercial-card-label">Compras selecionadas</span><strong class="commercial-card-total" data-commercial-total>${esc(money(purchases.totalCents))}</strong><p class="commercial-denominator">${esc(purchaseBase)}</p></header><div class="commercial-breakdown" data-commercial-tax-status>${rows(purchases.byTaxStatus)}</div><p class="commercial-card-note">Mercadorias e serviços incluídos nas compras. Devoluções de venda são abatidas da receita.</p></article>
    </div><div class="commercial-composition-notes"><p>Valores dos documentos selecionados. B2B e B2C usam o documento do cliente: CNPJ em B2B e CPF em B2C. Os demais documentos ficam em Não identificado.</p>${pending?'<p>Enquadramentos não confirmados aparecem separadamente conforme a consulta salva.</p>':''}${negative?'<p>As devoluções geraram saldo negativo em um ou mais grupos. Os valores e percentuais mantêm esse sinal.</p>':''}</div></section>`;
}
