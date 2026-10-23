import {resolveDifalApplication} from './simulator-engine.js';
import {difalDirectionSelection} from './difal-policy.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>Number.isSafeInteger(cents)?(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
const month=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')?`${value.slice(5)}/${value.slice(0,4)}`:String(value||'—');
const operationLabels={VENDA:'Venda',COMPRAS:'Compra',DEVOLUCAO_VENDA:'Devolução de venda',DEVOLUCAO_COMPRA:'Devolução de compra',OUTRAS:'Outras operações',SERVICO_COMPRA:'Serviço de compra',SERVICO_VENDA:'Serviço de venda',NAO_CLASSIFICADA:'Não classificada'};
const appliedMoney=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Indisponível';
const difalRegimes=[['pure','Simples puro'],['hybrid','Simples híbrido']];
const summed=values=>values.every(value=>typeof value==='number'&&Number.isFinite(value))?values.reduce((sum,value)=>sum+Math.round(value*100),0)/100:null;

/** Amounts in BRL. Editing uses the selected source estimate; history reads saved DRE cells only. */
export function buildDifalApplicationView({direction,policy,reports=[],row=null,rbt12ByMonth={},rbt12=null,currentCents=null,totalCents=null,sourceEstimate=null,snapshot=null,monthIndex=0}) {
  if(!['entry','exit'].includes(direction))throw new TypeError('Direção do DIFAL inválida.');
  const field=direction==='exit'?'difal':'icmsAnticipation',sourceKey=direction==='exit'?'difal':'anticipation';
  const caption=direction==='exit'?'DIFAL de saída':'DIFAL de entrada';
  if(snapshot){
    const saved=snapshot.result;
    if(!saved?.regimes?.some(regime=>Number.isFinite(regime.dre?.[field])))return null;
    const monthly=saved.method==='REPORT_MONTHS_V1',selected=monthly?saved.monthlyResults?.find(item=>item.month===monthIndex+1):null;
    const currentPolicy=snapshot.draft?.difalPolicy||saved.difalPolicy;
    const ids=currentPolicy?.version==='DIFAL_SCENARIOS_V2'?difalRegimes.map(([id])=>id):saved.regimes.map(regime=>regime.id);
    const values=ids.map(id=>{
      const regime=saved.regimes.find(item=>item.id===id),periodValue=regime?.dre?.[field];
      const currentRegime=monthly?selected?.result?.regimes?.find(item=>item.id===id):regime;
      const calendar=snapshot.monthlyDre?.regimes?.find(item=>item.id===id)?.rows?.find(item=>item.key===field)?.months?.[monthIndex];
      const currentValue=monthly?currentRegime?.dre?.[field]:Number.isFinite(calendar)?calendar:Number.isFinite(periodValue)?periodValue/12:null;
      const application=currentRegime?.difalApplication;
      const current=Number.isFinite(currentValue)?currentValue===0?0:-currentValue:null,total=Number.isFinite(periodValue)?periodValue===0?0:-periodValue:null;
      const selectedOperation=application?.operations?.[direction]??regime?.difalApplication?.operations?.[direction]??currentPolicy?.operations?.[id]?.[direction];
      const selectedRegime=application?.enabled??regime?.difalApplication?.enabled??currentPolicy?.enabled?.[id];
      const excluded=current===0&&total===0&&(selectedRegime===false||selectedOperation===false||!application?.blocked&&['USER_EXCLUDED','NO_OPERATIONS','NOT_APPLICABLE'].includes(application?.reason));
      return {id,name:regime?.name||id,current,total,excluded,
        blocked:!!application?.blocked&&!excluded,pending:false,preview:false,message:excluded?`${caption} não incluído por escolha nesta versão.`:application?.message||'Valores preservados da versão salva.'};
    });
    return {direction,caption,values,historical:true,currentMonth:selected?.sourceMonth||row?.sourceMonth||null};
  }
  const selection=difalDirectionSelection(policy,direction);
  if(!selection)return null;
  const apply=(id,estimate,reference)=>{
    if(!selection.regimeIds.includes(id))return {value:0,excluded:true,blocked:false,pending:false,preview:false,message:`${caption} não incluído por escolha.`};
    const known=typeof reference==='number'&&Number.isFinite(reference);
    const application=known?resolveDifalApplication({policy,regimeId:id,rbt12:reference}):null;
    if(application?.blocked)return {value:0,excluded:false,blocked:true,pending:false,preview:false,message:application.message};
    const amount=estimate?.amountCents,pending=!!estimate?.pendingLines,onlyPending=pending&&!estimate.eligibleLines;
    return {value:Number.isSafeInteger(amount)&&!onlyPending?amount/100:null,excluded:false,blocked:false,pending,preview:!known,
      message:pending?'Estimativa parcial: confira as UFs pendentes.':!Number.isSafeInteger(amount)?'Estimativa de origem indisponível.':!known?'Prévia selecionada; confirme a RBT12 para aplicar os bloqueios.':`${caption} incluído neste cenário.`};
  };
  const values=difalRegimes.map(([id,name])=>{
    const current=reports.length?row?apply(id,row[sourceKey],rbt12ByMonth[row.sourceMonth]):{value:null,message:'Mês sem dados importados.'}:apply(id,{...sourceEstimate,amountCents:currentCents},rbt12);
    const period=reports.length?reports.map(item=>apply(id,item[sourceKey],rbt12ByMonth[item.sourceMonth])):[apply(id,{...sourceEstimate,amountCents:totalCents},rbt12)];
    return {id,name,...current,current:current.value,total:summed(period.map(item=>item.value)),pending:!!current.pending||period.some(item=>item.pending),preview:!!current.preview||period.some(item=>item.preview)};
  });
  return {direction,caption,values,historical:false,selection,currentMonth:row?.sourceMonth||null};
}

export function difalApplicationSummary(view,period='current') {
  if(!view?.values?.length)return 'Indisponível';
  const values=view.values.map(row=>row[period]);
  if(values.every(value=>value===null)&&view.values.some(row=>row.pending))return 'Pendente';
  return values.every(value=>Object.is(value,values[0])||value===values[0])?appliedMoney(values[0]):'Por cenário';
}

/** The collapsed source remains auditable, but is never presented as the applied amount. */
export function renderDifalAppliedSource({view,sourceHtml='',auditOpen=false}) {
  if(!view)return sourceHtml;
  if(view.values.every(row=>row.current===null&&row.total===null&&!row.pending&&!row.excluded))return sourceHtml;
  const exit=view.direction==='exit',prefix=exit?'difal':'anticipation',allExcluded=view.values.every(row=>row.excluded),blocked=view.values.some(row=>row.blocked),pending=view.values.some(row=>row.pending),preview=view.values.some(row=>row.preview);
  const status=allExcluded?'Não incluído':view.historical?'Valores da versão salva':blocked?'Bloqueio por competência':pending?'Estimativa parcial':preview?'Prévia selecionada':'Aplicação por cenário';
  const audit=sourceHtml.replaceAll(`data-${prefix}-`, `data-${prefix}-source-`).replaceAll(exit?'sim-difal-title':'sim-anticipation-title',exit?'sim-difal-source-title':'sim-anticipation-source-title');
  return `<section class="sim-difal-card sim-difal-application${allExcluded?' is-excluded':''}" data-difal-application-direction="${view.direction}" aria-labelledby="sim-${prefix}-title"><header class="sim-difal-header"><div><span class="eyebrow">${view.historical?'APLICAÇÃO SALVA NA DRE':'ESCOLHA DESTA SIMULAÇÃO'}</span><h3 id="sim-${prefix}-title">${view.caption}${exit?' — vendas':' — antecipação de compras'}</h3></div><span class="sim-state-badge" data-difal-application-status>${status}</span></header><div class="sim-difal-metrics"><article class="sim-difal-current"><span>${view.currentMonth?esc(month(view.currentMonth)):'Valor mensal por cenário'}</span><strong data-${prefix}-monthly>${difalApplicationSummary(view)}</strong><small>${allExcluded?'Desativado nos cenários Simples':'Aplicação conforme cada cenário abaixo'}</small></article><article><span>Total do período por cenário</span><strong data-${prefix}-${exit?'annual':'total'}${exit?' data-difal-amount':''}>${difalApplicationSummary(view,'total')}</strong><small>Os cenários são alternativas; seus valores não são somados.</small></article><article><span>Seleção</span><strong class="sim-difal-selection-label">${allExcluded?'Não incluir':view.historical?'Conforme a versão salva':view.selection?.label||'Não incluir'}</strong><small>${view.historical?'O histórico conserva os valores originalmente salvos.':'Entrada e saída são independentes.'}</small></article></div><div class="sim-difal-applied-regimes">${view.values.map(item=>`<article data-${prefix}-applied-regime="${esc(item.id)}"><h4>${esc(item.name)}</h4><dl><div><dt>Mês</dt><dd data-${prefix}-applied-month>${appliedMoney(item.current)}</dd></div><div><dt>Período</dt><dd data-${prefix}-applied-total>${appliedMoney(item.total)}</dd></div></dl><p>${esc(item.message)}</p></article>`).join('')}</div><p class="sim-difal-explanation">${allExcluded?`${view.caption} desativado. Nenhum valor desta direção é incluído nos cenários acima.`:view.historical?'Esta apresentação lê os valores salvos da DRE e não recalcula impostos.':'A prévia considera as opções selecionadas e os bloqueios conhecidos de cada competência.'}</p>${audit?`<details class="sim-difal-source-audit" data-${prefix}-audit ${auditOpen?'open':''}><summary>Conferir estimativa original do relatório <span aria-hidden="true">+</span></summary><p class="sim-help">Valores brutos de origem, antes das escolhas dos cenários. Estes valores não substituem a aplicação mostrada acima.</p>${audit}</details>`:''}</section>`;
}

/** Show the captured source reconciliation, independently of manual scenario adjustments. */
export function renderOperationAudit(audit) {
  if(!audit)return '';
  const revenue=Number.isSafeInteger(audit.grossSalesCents)&&Number.isSafeInteger(audit.serviceSalesCents)&&Number.isSafeInteger(audit.salesReturnsCents)?audit.grossSalesCents+audit.serviceSalesCents-audit.salesReturnsCents:null;
  const purchases=Number.isSafeInteger(audit.purchaseGoodsCents)&&Number.isSafeInteger(audit.purchaseServicesCents)?audit.purchaseGoodsCents+audit.purchaseServicesCents:null;
  return `<details class="sim-inline-help sim-operation-audit"><summary>Conferir naturezas e valores considerados</summary><p class="sim-help">A classificação usa a coluna D (OPERAÇÃO) do cadastro de naturezas e os quatro primeiros dígitos de cada código dos relatórios.</p><div class="sim-detail-grid">${[
    ['Vendas classificadas',audit.grossSalesCents],['Serviços de venda · 9000',audit.serviceSalesCents],['Devoluções de venda no relatório de compras',audit.salesReturnsCents],['Receita considerada · vendas + serviços − devoluções',revenue],['Compras classificadas',audit.purchaseGoodsCents],['Serviços de compra · 8000',audit.purchaseServicesCents],['Compras consideradas · compras + serviços',purchases],['Operações excluídas do relatório de vendas',audit.excludedSalesCents],['Operações excluídas do relatório de compras',audit.excludedPurchaseCents]
  ].map(([label,cents])=>`<article><span>${label}</span><strong>${money(cents)}</strong></article>`).join('')}</div><p class="sim-help">Devoluções de venda reduzem a receita e não integram as compras consideradas. Estes valores conferem os relatórios de origem; ajustes manuais do cenário são apresentados separadamente.</p>
    ${audit.unknownSalesLines||audit.unknownPurchaseLines?`<p class="sim-difal-warning" role="status">Naturezas não classificadas: ${esc(audit.unknownSalesLines||0)} linhas de vendas e ${esc(audit.unknownPurchaseLines||0)} linhas de compras. Os valores dessas linhas foram excluídos; confira o cadastro e os relatórios.</p>`:''}
    ${Array.isArray(audit.natures)&&audit.natures.length?`<div class="projection-table-wrap" role="region" aria-label="Conferência por natureza de operação" tabindex="0"><table><thead><tr><th scope="col">Relatório</th><th scope="col">Natureza</th><th scope="col">Operação</th><th scope="col">Linhas</th><th scope="col">Valor de origem</th><th scope="col">Vendas</th><th scope="col">Compras</th><th scope="col">Devoluções de venda</th><th scope="col">Excluído</th></tr></thead><tbody>${audit.natures.map(row=>`<tr><td>${row.side==='SALES'?'Vendas':'Compras'}</td><th scope="row">${esc(row.natureCode)}</th><td>${esc(operationLabels[row.operation]||row.operation)}</td><td>${esc(row.lines)}</td><td>${money(row.sourceCents)}</td><td>${money(row.salesCents)}</td><td>${money(row.purchasesCents)}</td><td>${money(row.salesReturnsCents)}</td><td>${money(row.excludedCents)}</td></tr>`).join('')}</tbody></table></div>`:''}</details>`;
}

export function renderRbt12Schedule(schedule) {
  if(schedule?.version!=='RBT12_MONTHLY_SECTION_22_V1'||!Array.isArray(schedule.rows))return '';
  const compositions=schedule.rows.filter(row=>Array.isArray(row.window)&&row.window.length).map(row=>`<details class="sim-inline-help" data-rbt12-window="${esc(row.sourceMonth)}"><summary>Conferir ${esc(month(row.sourceMonth))} · ${row.window.length} receitas mensais</summary><p class="sim-help">Receitas de ${esc(month(row.startMonth))} a ${esc(month(row.endMonth))}. O mês ${esc(month(row.sourceMonth))} não entra na própria RBT12.</p><div class="sim-extrato-table-wrap" role="region" aria-label="Composição da RBT12 de ${esc(month(row.sourceMonth))}" tabindex="0"><table><thead><tr><th scope="col">Mês da receita</th><th scope="col">Mercado interno</th><th scope="col">Mercado externo</th><th scope="col">Receita mensal total</th></tr></thead><tbody>${row.window.map(item=>`<tr><th scope="row">${esc(month(item.month))}</th><td>${money(item.internalCents)}</td><td>${money(item.externalCents)}</td><td>${money(item.totalCents)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row" colspan="3">RBT12 acumulada usada em ${esc(month(row.sourceMonth))}</th><td>${row.status==='CONFIRMED'?money(row.rbt12Cents):'Pendente: faltam receitas'}</td></tr></tfoot></table></div></details>`).join('');
  return `<details class="sim-extrato-details sim-rbt12-schedule" open><summary><span>RBT12 usada em cada competência<small>${schedule.complete?'Janelas completas':'Histórico incompleto'}</small></span></summary><div class="sim-extrato-content"><p class="sim-help">Cada competência usa a soma das 12 receitas mensais anteriores, dos mercados interno e externo do quadro 2.2. A receita de um mês e a RBT12 acumulada são valores diferentes. As competências são as dos relatórios de origem; o ano do cenário não desloca esse histórico.</p><div class="projection-table-wrap" role="region" aria-label="RBT12 por competência dos relatórios" tabindex="0"><table><thead><tr><th scope="col">Mês</th><th scope="col">RBT12 acumulada</th><th scope="col">Janela de receitas</th></tr></thead><tbody>${schedule.rows.map(row=>`<tr><th scope="row">${esc(month(row.sourceMonth))}</th><td>${row.status==='CONFIRMED'?money(row.rbt12Cents):`<strong>Pendente</strong><small>Faltam: ${row.missingMonths.map(value=>esc(month(value))).join(', ')}</small>`}</td><td>${esc(month(row.startMonth))} a ${esc(month(row.endMonth))}</td></tr>`).join('')}</tbody></table></div>${schedule.complete?'':'<p class="sim-difal-warning" role="status">O extrato não contém todas as receitas necessárias. Importe um extrato que inclua as competências faltantes; nenhuma lacuna será tratada como zero ou substituída pelo valor do quadro 2.1.</p>'}${compositions}</div></details>`;
}

export function renderAnticipationSource({reports,row,open=false,adjusted=false}) {
  if(!Array.isArray(reports)||!reports.some(item=>item.anticipation))return '';
  const available=reports.every(item=>item.anticipation),current=row?.anticipation;
  const total=available?reports.reduce((sum,item)=>sum+item.anticipation.amountCents,0):null;
  const pending=reports.reduce((sum,item)=>sum+(item.anticipation?.pendingLines||0),0);
  const cpfOnly=available&&reports.every(item=>item.anticipation.version==='ICMS_ANTICIPATION_V2');
  const cpfOrCnpj=available&&reports.every(item=>item.anticipation.version==='ICMS_ANTICIPATION_V3');
  const policy=cpfOrCnpj?'com CPF ou CNPJ válido':cpfOnly?'com CPF':'conforme a regra histórica salva';
  return `<section class="sim-difal-card${pending?' is-pending':''}" aria-labelledby="sim-anticipation-title"><header class="sim-difal-header"><div><span class="eyebrow">RELATÓRIO DE COMPRAS / ENTRADAS</span><h3 id="sim-anticipation-title">DIFAL de entrada — Antecipação de ICMS</h3></div><span class="sim-state-badge${pending?' is-adjusted':''}">${pending?'UFs pendentes':'Estimativa gerencial · 7,32%'}</span></header><div class="sim-difal-metrics"><article class="sim-difal-current"><span>${row?esc(month(row.sourceMonth)):'Mês sem dados importados'}</span><strong data-anticipation-monthly>${current?.pendingLines&&!current.eligibleLines?'Pendente':money(current?.amountCents)}</strong><small>Estimativa da base do mês · antes do sublimite</small></article><article><span>Compras interestaduais elegíveis</span><strong>${money(current?.baseCents)}</strong><small>${current?`${esc(current.eligibleLines)} linhas · emitente ${esc(current.issuerUf||'sem UF')}`:'Sem base disponível nesta competência'}</small></article><article><span>Estimativa do período importado</span><strong data-anticipation-total>${money(total)}</strong><small>O valor aplicado é conferido na DRE de cada mês</small></article></div><p class="sim-difal-explanation">7,32% sobre compras interestaduais ${policy}, classificadas como compras ou serviços 8000. Na DRE, a antecipação incide apenas no Simples puro e híbrido e fica zerada nas competências com sublimite alcançado.</p>${pending?`<p class="sim-difal-warning" data-anticipation-pending role="status">Estimativa parcial: ${esc(pending)} linhas aguardam UF. Confira e reimporte as compras.</p>`:''}<details data-anticipation-disclosure ${open?'open':''}><summary>Conferir antecipação de todos os meses<span aria-hidden="true">+</span></summary><div class="projection-table-wrap" role="region" aria-label="Antecipação de ICMS das competências" tabindex="0"><table><thead><tr><th scope="col">Competência</th><th scope="col">Base elegível</th><th scope="col">Estimativa de origem</th></tr></thead><tbody>${reports.map(item=>`<tr${item===row?' class="is-current"':''}><th scope="row">${esc(month(item.sourceMonth))}</th><td>${money(item.anticipation?.baseCents)}</td><td>${money(item.anticipation?.amountCents)}${item.anticipation?.pendingLines?' · parcial':''}</td></tr>`).join('')}</tbody></table></div></details>${adjusted?'<p class="sim-difal-explanation" data-anticipation-adjusted>A antecipação usa as linhas importadas. Para alterar sua base, corrija e reimporte as compras.</p>':''}</section>`;
}
