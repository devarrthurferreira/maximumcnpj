import {unifiedDreRows,dreDifalNotes,dreReportCoverage,dreRegimeStatuses,dreReportMemory} from './simulator-dre.js';
import {readDreValue,buildDreSummary,buildDreEvolution} from './simulator-dre-summary.js';
import {requiresSimplesReference} from './regime-selection.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null||!Number.isFinite(value)?'—':value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const percent=value=>value==null||!Number.isFinite(value)?'—':(value*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const TOTALS=new Set(['revenue','netRevenue','grossProfit','preTax','netProfit','revenueAfterReturns','revenueUsed']);
const annualColumn=regime=>({id:regime.id,label:regime.name,mode:'annual'});
const regimeScope=presentation=>presentation.regimes.length===4?'todos os regimes':presentation.regimes.length===1?'regime selecionado':'regimes selecionados';
const simplesApplies=(presentation,calendar)=>requiresSimplesReference(presentation?.regimeSelection??calendar?.regimeSelection);
function cell(row,column,{showPercent,highlightId}){
  const value=readDreValue(row,column),reason=column.mode==='month'?row.monthlyReasonByRegime?.[column.id]?.[column.month]??row.calendarReasonByRegime?.[column.id]:(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
  const ratio=column.mode==='month'?row.monthlyPercentValues?.[column.id]?.[column.month]:column.mode==='calendarAnnual'?row.calendarAnnualPercentValues?.[column.id]:row.percentValues?.[column.id];
  return `<td class="${column.mode==='calendarAnnual'?'sim-year-total ':''}${column.id===highlightId&&column.mode==='annual'?'dre-active-column ':''}${row.key==='netProfit'?(value===null?'dre-unavailable-cell':value<0?'dre-loss-cell':''):''}"><span class="dre-amount${value<0?' dre-negative':''}"${value===null&&reason?` title="${esc(reason)}" aria-label="${esc(reason)}"`:''}>${row.unit==='percent'?percent(value):money(value)}</span>${showPercent&&row.unit!=='percent'?`<small class="dre-percent" aria-label="Percentual da receita utilizada">${percent(ratio)}</small>`:''}</td>`;
}
function tableRow(row,columns,options){
  const total=TOTALS.has(row.key),kind=row.kind||'line';
  return `<tr class="dre-row dre-${esc(kind)}${total?' total':''}${row.informative?' dre-informative':''}" data-dre-row="${esc(row.key)}"><th scope="row"><span>${esc(row.label)}</span>${row.kind==='detail'?'<small class="dre-composition-label">Composição</small>':''}</th>${columns.map(column=>cell(row,column,options)).join('')}</tr>`;
}
function table({presentation,columns,showPercent,label='DRE comparativa com rolagem horizontal',className='',highlightId=null,rows=null,indicatorLabel='Indicador',indicatorNote=''}){
  const reconciliationKeys=new Set([...(presentation.revenueReconciliation?.rows||[]),...(presentation.icmsReconciliation?.rows||[])].map(row=>row.key));
  const displayed=rows||unifiedDreRows(presentation).filter(row=>!reconciliationKeys.has(row.key));
  return `<div class="sim-table-wrap dre-table-wrap ${className}" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr><th scope="col">${esc(indicatorLabel)}${indicatorNote?`<small>${esc(indicatorNote)}</small>`:''}</th>${columns.map(column=>`<th scope="col"${column.id===highlightId&&column.mode==='annual'?' class="dre-active-column"':''}>${esc(column.label)}${column.year?`<small>${esc(column.year)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${displayed.map(row=>tableRow(row,columns,{presentation,showPercent,highlightId})).join('')}</tbody></table></div>`;
}
function mobileRevenueReconciliation({rows,column,label,showPercent}){
  if(!column)return '';
  const monthly=column.mode==='month';
  return `<div class="dre-revenue-mobile" data-revenue-mobile><p class="revenue-reconciliation-mobile-title">${esc(label)}</p><dl>${rows.map(row=>{
    const value=readDreValue(row,column),annual=monthly?readDreValue(row,{id:column.id,mode:'calendarAnnual'}):null;
    const ratio=monthly?row.monthlyPercentValues?.[column.id]?.[column.month]:row.percentValues?.[column.id];
    return `<div data-revenue-mobile-row="${esc(row.key)}"${TOTALS.has(row.key)?' class="revenue-reconciliation-total"':''}><dt>${esc(row.label)}</dt><dd><strong data-revenue-mobile-value>${money(value)}</strong>${showPercent?`<small>${percent(ratio)} da receita utilizada</small>`:''}${monthly?`<small data-revenue-mobile-annual>Total anual: ${money(annual)}</small>`:''}</dd></div>`;
  }).join('')}</dl><p class="revenue-reconciliation-mobile-help">Acompanhe o regime e o período selecionados acima.</p></div>`;
}
function revenueReconciliation({presentation,columns,showPercent,summaryColumn=null,summaryLabel=''}){
  const reconciliation=presentation.revenueReconciliation;
  if(!reconciliation?.rows?.length)return '';
  const reasons=new Set();
  for(const row of reconciliation.rows)for(const column of columns){
    if(readDreValue(row,column)!==null)continue;
    const reason=column.mode==='month'?row.monthlyReasonByRegime?.[column.id]?.[column.month]:(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
    if(reason)reasons.add(reason);
  }
  return `<section class="dre-revenue-reconciliation${summaryColumn?' has-mobile-summary':''}" data-revenue-reconciliation="dre" aria-label="${esc(reconciliation.label)}"><header><span class="eyebrow">CONFERÊNCIA DA RECEITA</span><h3>${esc(reconciliation.label)}</h3><p>Da receita bruta da fonte ao valor utilizado nesta DRE.</p></header>${mobileRevenueReconciliation({rows:reconciliation.rows,column:summaryColumn,label:summaryLabel,showPercent})}${table({presentation,columns,showPercent,rows:reconciliation.rows,label:'Fechamento da receita por cenário e período',className:'dre-revenue-table'})}${reasons.size?`<p class="revenue-reconciliation-unavailable" data-revenue-unavailable>${[...reasons].map(esc).join(' ')}</p>`:''}<p class="revenue-reconciliation-note">${esc(reconciliation.note)}</p></section>`;
}
function icmsReconciliation({presentation,columns,showPercent,summaryColumn=null,summaryLabel=''}){
  const reconciliation=presentation.icmsReconciliation;
  if(!reconciliation?.rows?.length)return '';
  const reasonsFor=(selectedColumns,identifyRegime=false)=>{
    const reasons=new Set();
    for(const row of reconciliation.rows)for(const column of selectedColumns){
      if(readDreValue(row,column)!==null)continue;
      const reason=column.mode==='month'?row.monthlyReasonByRegime?.[column.id]?.[column.month]:(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
      const regime=presentation.regimes.find(item=>item.id===column.id)?.name||column.label||column.id;
      if(reason)reasons.add(identifyRegime?`${regime}: ${reason}`:reason);
    }
    return [...reasons];
  };
  const reasons=reasonsFor(columns,true),mobileReasons=summaryColumn?reasonsFor([summaryColumn]):[];
  const monthly=summaryColumn?.mode==='month';
  const mobile=summaryColumn?`<div class="dre-icms-mobile" data-icms-mobile><p class="dre-icms-mobile-title">${esc(summaryLabel)}</p><dl>${reconciliation.rows.map(row=>{
    const value=readDreValue(row,summaryColumn),annual=monthly?readDreValue(row,{id:summaryColumn.id,mode:'calendarAnnual'}):null;
    const ratio=monthly?row.monthlyPercentValues?.[summaryColumn.id]?.[summaryColumn.month]:row.percentValues?.[summaryColumn.id];
    return `<div data-icms-mobile-row="${esc(row.key)}"><dt>${esc(row.label)}</dt><dd><strong data-icms-mobile-value>${money(value)}</strong>${showPercent?`<small>${percent(ratio)} da receita utilizada</small>`:''}${monthly?`<small data-icms-mobile-annual>Total anual: ${money(annual)}</small>`:''}</dd></div>`;
  }).join('')}</dl>${mobileReasons.length?`<p class="dre-icms-unavailable" data-icms-unavailable="mobile">${mobileReasons.map(esc).join(' ')}</p>`:''}</div>`:'';
  return `<section class="dre-icms-reconciliation${summaryColumn?' has-mobile-summary':''}" data-icms-reconciliation="dre" aria-label="${esc(reconciliation.label)}"><header><span class="eyebrow">CONFERÊNCIA DO ICMS · INFORMATIVO</span><h3>${esc(reconciliation.label)}</h3><p>Débito, créditos e saldo do mesmo regime e período da DRE.</p></header>${mobile}${table({presentation,columns,showPercent,rows:reconciliation.rows,label:'Apuração do crédito de ICMS por cenário e período',className:'dre-icms-table'})}${reasons.length?`<p class="dre-icms-unavailable dre-icms-table-unavailable" data-icms-unavailable="table">${reasons.map(esc).join(' ')}</p>`:''}<p class="dre-icms-note">${esc(reconciliation.note)}</p></section>`;
}
function finalReconciliations(options){return revenueReconciliation(options)+icmsReconciliation(options);}
function toolbar(showPercent,reportPeriod='complete'){
  return `<div class="dre-toolbar"><label class="dre-percent-control"><input id="dre-show-percent" type="checkbox" ${showPercent?'checked':''}>Mostrar % da receita utilizada</label><label class="dre-report-control" for="dre-report-period">Conteúdo do relatório<select id="dre-report-period">${[['complete','Completo · anual + mensal'],['annual','Somente anual'],['monthly','Somente mensal']].map(([value,label])=>`<option value="${value}"${value===reportPeriod?' selected':''}>${label}</option>`).join('')}</select><small>PDF e CSV incluem os regimes escolhidos para esta análise.</small></label><div class="dre-export-actions"><button type="button" id="export-dre-csv">Baixar DRE CSV</button><button type="button" id="print-dre">Imprimir / salvar PDF</button></div></div>`;
}
function methodology({calendar,year,presentation}){
  const period=calendar?.reportPeriod;
  const rolling=calendar?.method==='REPORT_MONTHS_ROLLING_RBT12'&&calendar?.rbt12Schedule;
  return `<p class="dre-method-note">${calendar?.version==='DRE_CALENDAR_V3'?'Valores de cada competência dos relatórios, associados ao mesmo mês do cenário '+esc(year)+'. Meses fora do período importado ficam sem dados. Total anual = soma das competências.':'Projeção de janeiro a dezembro de '+esc(year)+', sem lançamentos históricos.'} ${period?'Base dos relatórios: '+esc(period.startMonth)+' a '+esc(period.endMonth)+'. ':''}${!simplesApplies(presentation,calendar)?'':rolling?'A RBT12 de cada competência soma os 12 meses anteriores do quadro 2.2 do extrato.':'A RBT12 permanece fixa no cenário.'} ${esc(calendar?.rounding||'Valores completos preservados; a soma dos meses exibidos pode diferir por centavos do total anual.')}</p>`;
}
function legend(){return '<p class="dre-legend">As linhas de composição detalham os valores já incluídos na DRE. Subtotais, créditos informativos e indicadores não devem ser somados novamente ao resultado. — indica informação indisponível ou não aplicável.</p>';}
function footnotes(presentation){
  const notes=[...new Set(unifiedDreRows(presentation).flatMap(row=>row.notes||[]))].filter(note=>note!=='Subtotal de conferência das linhas já incluídas no resultado; não somar novamente.');
  return notes.length?`<div class="dre-footnotes">${notes.map(note=>`<p>${esc(note)}</p>`).join('')}</div>`:'';
}
function difalNotes(presentation,sourceMonth=null){
  const notes=dreDifalNotes(presentation,{sourceMonth});
  return notes.length?`<div class="dre-difal-notes"><h3>DIFAL nos cenários</h3>${notes.map(note=>`<p>${esc(note)}</p>`).join('')}</div>`:'';
}
function referenceLine(calendar,sourceMonth=null,presentation=null){
  if(!simplesApplies(presentation,calendar))return '';
  const schedule=calendar?.method==='REPORT_MONTHS_ROLLING_RBT12'?calendar.rbt12Schedule:null;
  if(schedule){
    const rows=sourceMonth?schedule.rows.filter(row=>row.sourceMonth===sourceMonth):schedule.rows;
    return `<p>RBT12 por competência · extrato, quadro 2.2 · PA ${esc(schedule.pa)}</p><p>${rows.map(row=>`${esc(row.sourceMonth)}: ${row.status==='CONFIRMED'?money(row.rbt12Cents/100):'Não disponível'}${sourceMonth?' · receitas de '+esc(row.startMonth)+' a '+esc(row.endMonth):''}`).join(' · ')}</p>`;
  }
  const reference=calendar?.rbt12Reference;
  return reference?`<p>RBT12 fixa: ${money(reference.rbt12Cents/100)} · ${reference.source==='MANUAL'?'informada manualmente, sem validação por OCR':'PA '+esc(reference.pa)+' · extrato, seção 2.2'}</p>`:'';
}

const regimeAvailable=(regime,month=null)=>Number.isInteger(month)&&Array.isArray(regime.monthlyAvailability)?regime.monthlyAvailability[month]===true:regime.available;
function selectRegime(presentation,regimeId,month=null){return presentation.regimes.find(item=>item.id===regimeId)||presentation.regimes.find(item=>regimeAvailable(item,month))||presentation.regimes[0];}
function regimeControl(presentation,regime,annual=false,month=null){
  return `<label class="dre-regime-control" for="dre-regime">${annual?'Regime em destaque':'Regime tributário'}<select id="dre-regime">${presentation.regimes.map(item=>`<option value="${esc(item.id)}" ${item.id===regime.id?'selected':''}>${esc(item.name)}${regimeAvailable(item,month)?'':annual?' · total anual indisponível':' · indisponível nesta competência'}</option>`).join('')}</select></label>`;
}
function periodControl({monthly=false,calendar,year,months=[],selectedMonth=0}){
  const actual=calendar?.version==='DRE_CALENDAR_V3',sourceMonth=calendar?.months?.[selectedMonth]?.sourceMonth;
  const description=monthly?(actual?(sourceMonth?`Valores de ${months[selectedMonth]?.label} / ${year}. Origem: ${months[selectedMonth]?.label} / ${sourceMonth.slice(0,4)}. Resumo e comparação usam esta competência.`:'Sem dados importados para esta competência. Escolha outro mês para consultar seus valores.'):'Projeção mensal da simulação salva. Resumo e comparação acompanham o mês selecionado.'):(actual?'Total anual: soma das competências importadas.':'Total anual da simulação salva.');
  return `<div class="dre-period-panel"><div class="dre-period-field"><span id="dre-period-label">Visualizar DRE</span><div class="sim-period-toggle" role="group" aria-labelledby="dre-period-label"><button type="button" data-period="monthly" aria-pressed="${monthly}" aria-controls="dre-demonstrativo">Mensal</button><button type="button" data-period="annual" aria-pressed="${!monthly}" aria-controls="dre-demonstrativo">Anual</button></div></div>
    ${monthly?`<label class="dre-month-control" for="dre-month">Competência<select id="dre-month">${months.map((item,index)=>`<option value="${index}" ${index===selectedMonth?'selected':''}>${esc(item.label)} / ${esc(year)}${actual&&!calendar?.months?.[index]?.sourceMonth?' · sem dados':''}</option>`).join('')}</select></label>`:`<div class="dre-period-year"><span>Ano do cenário</span><strong>${esc(year)}</strong></div>`}
    <p id="dre-period-note" role="status">${esc(description)}</p></div>`;
}
function visualSummary(presentation,column,periodLabel,regime){
  const data=buildDreSummary(presentation,column),negative=data.result!==null&&data.result<0;
  const sourceRevenue=presentation.revenueReconciliation?.rows.find(row=>row.key==='revenueAfterReturns');
  const revenueDetail=readDreValue(sourceRevenue,column)!==null?'Vendas + serviços após devoluções e ajustes':'Valor preservado nesta DRE';
  const status=data.result===null?'Sem resultado disponível':negative?'Prejuízo estimado':data.result===0?'Resultado em equilíbrio':'Lucro estimado';
  const max=Math.max(1,...data.movements.map(row=>Math.abs(row.value||0)));
  const bars=data.reconciled?`<ol class="dre-flow-bars">${data.movements.map(row=>`<li class="dre-flow-${row.kind}${row.value<0?' is-negative':''}"><span class="dre-flow-label">${esc(row.label)}</span><span class="dre-flow-track" aria-hidden="true"><i style="width:${Math.abs(row.value)/max*50}%;left:${row.value<0?50-Math.abs(row.value)/max*50:50}%"></i></span><strong>${money(row.value)}</strong></li>`).join('')}</ol>`:`<p class="dre-visual-empty">${data.revenue===null&&data.result===null?'Sem dados suficientes para apresentar o gráfico deste período e regime.':'A composição está incompleta ou não concilia com o resultado salvo. Confira os valores na tabela.'}</p>`;
  return `<div class="dre-overview" aria-label="Resumo visual da DRE"><div class="dre-overview-heading"><span>LEITURA DO RESULTADO</span><p><strong>${esc(regime.name)}</strong> · ${esc(periodLabel)}</p></div>
    <div class="dre-summary-cards"><article><span>Receita utilizada</span><strong data-dre-summary="revenue">${money(data.revenue)}</strong><small>${revenueDetail}</small></article><article><span>Deduções líquidas</span><strong data-dre-summary="deductions">${money(data.deductions)}</strong><small>Custos, despesas e tributos após créditos</small></article><article class="dre-result-card${negative?' is-loss':''}${data.result===null?' is-unavailable':''}"><span>Resultado líquido</span><strong data-dre-summary="result">${money(data.result)}</strong><small>${status} · margem <b data-dre-summary="margin">${percent(data.margin)}</b></small></article></div>
    <figure class="dre-result-flow"><figcaption><strong>Da receita ao resultado</strong><span>Receita + movimentos da DRE = resultado líquido</span></figcaption>${bars}</figure></div>`;
}
function quickNavigation(){return `<nav class="dre-quick-nav" aria-label="Ir para uma linha da DRE">${[['services','Receitas'],['das','Tributos'],['cmvSimple','Compras'],['salaries','Despesas'],['netProfit','Resultado']].map(([key,label])=>`<button type="button" data-dre-jump="${key}">${label}</button>`).join('')}</nav>`;}
function monthlyEvolution(presentation,calendar,regimeId,month){
  const data=buildDreEvolution(presentation,calendar,regimeId,month);
  const context=data.available&&data.previous&&data.current?.sourceMonth&&data.previous.sourceMonth?`${data.current.label} / ${data.current.sourceMonth.slice(0,4)} em relação a ${data.previous.label} / ${data.previous.sourceMonth.slice(0,4)} (origem dos relatórios).`:data.reason;
  if(!data.available)return `<p class="dre-evolution-unavailable">${esc(data.reason)}</p>`;
  const change=metric=>metric.change===null?'—':metric.unit==='percent'?`${metric.change>0?'+':''}${(metric.change*100).toLocaleString('pt-BR',{maximumFractionDigits:2})} p.p.`:`${metric.change>0?'+':''}${money(metric.change)}`;
  const note=metric=>metric.reason|| (metric.unit==='percent'?'Diferença em pontos percentuais.':metric.ratio===null?'Variação em reais; base anterior zero ou negativa.':`${metric.ratio>0?'+':''}${percent(metric.ratio)} sobre o valor do mês anterior.`);
  return `<section class="dre-evolution" aria-label="Variação em relação ao mês anterior"><div class="dre-evolution-heading"><h3>O que mudou no mês</h3><p>${esc(context)}</p></div>
    <div class="dre-evolution-metrics">${data.metrics.map(metric=>`<article data-dre-change="${metric.key}"><span>${esc(metric.label)}</span><strong>${change(metric)}</strong><small>${esc(note(metric))}</small>${metric.key==='difal'&&!metric.reason?'<small>Variação do valor deduzido na DRE.</small>':''}</article>`).join('')}</div>
    ${data.reason&&context!==data.reason?`<p class="dre-evolution-unavailable">${esc(data.reason)}</p>`:''}</section>`;
}
function annualEvolution(presentation,calendar,regimeId){
  const data=buildDreEvolution(presentation,calendar,regimeId);
  if(!data.available)return '';
  return `<details id="dre-evolution-year" class="dre-evolution-year"><summary>Evolução por competência <span>${data.importedCount} de 12 meses com dados importados</span></summary>
    <p>Valores do regime selecionado, iguais aos da DRE mensal. A margem usa a receita utilizada na DRE de cada mês. Meses ausentes permanecem sem dados.</p>
    <ol class="dre-evolution-months">${data.months.map((month,index)=>`<li data-dre-evolution-month="${index}" class="${!month.sourceMonth?'is-missing':''}"><h4>${esc(month.label)}</h4>${month.sourceMonth?`<small>Origem: ${esc(month.sourceMonth)}</small><dl><div><dt>Receita</dt><dd>${money(month.revenue)}</dd></div><div><dt>Resultado</dt><dd class="${month.netProfit<0?'is-loss':''}">${money(month.netProfit)}</dd></div><div><dt>Margem</dt><dd>${percent(month.netMargin)}</dd></div></dl>`:'<p>Sem dados importados</p>'}</li>`).join('')}</ol></details>`;
}
function readingNote(showPercent){return `<p class="dre-reading-note">R$ · valores negativos são deduções · composições detalham valores já incluídos · — indica indisponível.${showPercent?' Percentuais sobre a receita utilizada no mesmo período e regime.':''}</p>`;}
function contextFooter(presentation,calendar,year,sourceMonth=null){return `<footer class="dre-reading-footer"><h3>Referências deste demonstrativo</h3>${referenceLine(calendar,sourceMonth,presentation)}${difalNotes(presentation,sourceMonth)}${footnotes(presentation)}${calendar?methodology({calendar,year,presentation}):''}</footer>`;}
function coverageNote(presentation){
  const coverage=dreReportCoverage(presentation);
  return `<div class="dre-report-coverage" data-report-coverage><strong>${esc(coverage.label)}</strong><p>${esc(coverage.detail)}</p></div>`;
}
function simplesDiagnostic(presentation,sourceMonth=null){
  const annual=presentation.simplesDiagnostic;
  if(annual?.version!=='SIMPLES_DIAGNOSTIC_V1')return '';
  const diagnostic=sourceMonth?annual.months?.find(row=>row.sourceMonth===sourceMonth)||annual:annual;
  const rbt12=diagnostic.rbt12===null&&Number.isFinite(diagnostic.rbt12Min)&&Number.isFinite(diagnostic.rbt12Max)?`${money(diagnostic.rbt12Min)} a ${money(diagnostic.rbt12Max)}`:money(diagnostic.rbt12);
  return `<section class="dre-simples-diagnostic${diagnostic.available?' is-available':' needs-review'}" data-simples-diagnostic="${esc(diagnostic.statusCode)}" aria-label="Conferência do Simples Nacional"><header><div><span class="eyebrow">BASES E CONDIÇÕES DO CÁLCULO</span><h3>Simples Nacional${sourceMonth?' · '+esc(sourceMonth):''}</h3></div><strong class="dre-diagnostic-status">${diagnostic.available?'Cálculo disponível':'Conferência necessária'}</strong></header><p data-simples-message>${esc(diagnostic.message)}</p><dl><div><dt>${diagnostic.revenueBasis==='ACTUAL_REPORT_MONTHS'?'Receita das competências importadas':'Receita anual projetada'}</dt><dd>${money(diagnostic.revenueReference)}</dd></div><div><dt>RBT12 · referência das alíquotas</dt><dd>${rbt12}</dd></div><div><dt>Limite federal de referência</dt><dd>${money(diagnostic.federalLimit)}</dd></div><div><dt>Sublimite de ICMS/ISS</dt><dd>${money(diagnostic.sublimit)}</dd></div></dl>${diagnostic.action?`<p class="dre-diagnostic-action"><strong>Orientação para o cenário:</strong> ${esc(diagnostic.action)}</p>`:''}<p class="dre-diagnostic-note">A disponibilidade indica que o cenário pode ser calculado com as premissas informadas. Não confirma, por si só, a opção ou a permanência legal no Simples Nacional.</p>${diagnostic.assumptions?.length?`<ul class="dre-diagnostic-assumptions">${diagnostic.assumptions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}</section>`;
}
export function renderAnnualDre({presentation,calendar,year,regimeId,showPercent=false,reportPeriod='complete'}){
  const columns=presentation.regimes.map(annualColumn),regime=selectRegime(presentation,regimeId);
  return `<section class="card sim-dre dre-complete dre-visual" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE anual</h2><p>Consolidado de ${esc(year)} · ${presentation.method==='REPORT_MONTHS_V1'?'soma das competências importadas':'projeção anual salva'}</p></div>${regimeControl(presentation,regime,true)}</div>
  ${periodControl({calendar,year})}
  ${coverageNote(presentation)}${simplesDiagnostic(presentation)}
  ${visualSummary(presentation,annualColumn(regime),'Total anual · '+year,regime)}
  ${annualEvolution(presentation,calendar,regime.id)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>${presentation.regimes.length===1?'Regime selecionado para esta análise.':presentation.regimes.length===4?'Todos os regimes lado a lado. A coluna do regime selecionado fica em destaque.':'Regimes selecionados lado a lado. A coluna do regime em destaque acompanha o resumo.'}</p></div>${toolbar(showPercent,reportPeriod)}</div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,highlightId:regime.id})}${contextFooter(presentation,calendar,year)}${finalReconciliations({presentation,columns,showPercent,summaryColumn:annualColumn(regime),summaryLabel:`${regime.name} · Total anual / ${year}`})}</section>`;
}
function monthlyContext({presentation,calendar,year,regimeId,monthView=false,month=0}){
  const months=presentation.months||calendar?.months||[];
  const selectedMonth=Math.max(0,Math.min(11,Number(month)||0));
  const regime=selectRegime(presentation,regimeId,selectedMonth);
  const columns=months.flatMap((item,index)=>!monthView||index===selectedMonth?[{id:regime.id,label:item.label,year,mode:'month',month:index}]:[]);
  columns.push({id:regime.id,label:'Total anual',mode:'calendarAnnual'});
  return {regime,months,columns,selectedMonth};
}
export function renderCompleteMonthlyDre({presentation,calendar,year,regimeId,showPercent=false,monthView=true,month=0,reportPeriod='complete'}){
  const {regime,months,columns,selectedMonth}=monthlyContext({presentation,calendar,year,regimeId,monthView,month});
  const selected=months[selectedMonth],summaryColumn={id:regime.id,mode:'month',month:selectedMonth};
  return `<section class="card sim-dre sim-calendar dre-complete dre-visual${monthView?' dre-single-month':''}" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE mensal</h2><p>Cenário ${esc(year)} · ${calendar?.version==='DRE_CALENDAR_V3'?'valores por competência dos relatórios':'projeção pela média mensal salva'}</p></div>${regimeControl(presentation,regime,false,selectedMonth)}</div>
  ${periodControl({monthly:true,calendar,year,months,selectedMonth})}
  ${coverageNote(presentation)}${calendar?.version==='DRE_CALENDAR_V3'&&!calendar?.months?.[selectedMonth]?.sourceMonth?'':simplesDiagnostic(presentation,calendar?.months?.[selectedMonth]?.sourceMonth)}
  ${visualSummary(presentation,summaryColumn,selected?.label+' / '+year,regime)}
  ${monthlyEvolution(presentation,calendar,regime.id,selectedMonth)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>${monthView?'Mês selecionado e total anual.':'Janeiro a dezembro e total anual.'} Apuração do crédito de ICMS ao final.</p></div>${toolbar(showPercent,reportPeriod)}</div>
  <div class="dre-calendar-controls"><div role="group" aria-label="Visualização do calendário"><button type="button" data-dre-month-view="single" aria-pressed="${monthView}">Um mês por vez</button><button type="button" data-dre-month-view="all" aria-pressed="${!monthView}">12 meses</button></div></div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,className:'dre-calendar-screen',label:monthView?'DRE do mês selecionado e total anual':'DRE de janeiro a dezembro com coluna Indicador fixa'})}
  ${contextFooter(presentation,calendar,year,monthView?calendar?.months?.[selectedMonth]?.sourceMonth:null)}${finalReconciliations({presentation,columns,showPercent,summaryColumn,summaryLabel:`${regime.name} · ${selected?.label} / ${year}`})}</section>`;
}
/** Printing always includes all twelve captured months in one continuous table. */
export function renderDrePrintCalendar({presentation,calendar,year,regimeId,showPercent=false}){
  year=calendar?.year??year;
  const {regime,columns}=monthlyContext({presentation,calendar,year,regimeId});
  return `<div class="dre-print-calendar"><h3>${esc(regime.name)} · Janeiro a dezembro de ${esc(year)}</h3>${table({presentation,columns,showPercent,label:'DRE mensal completa'})}${finalReconciliations({presentation,columns,showPercent})}</div>`;
}
/** Temporary standalone print document; reads the same presentation as the screen. */
export function renderDrePrintDocument({presentation,calendar,year,regimeId,showPercent=false,period='annual',company={}}){
  if(!['annual','monthly','complete'].includes(period))throw new TypeError('Conteúdo do relatório inválido.');
  const monthly=period==='monthly',complete=period==='complete',columns=presentation.regimes.map(annualColumn);
  const regimeLabel=presentation.regimes.map(regime=>regime.name).join(' · ');
  const modelWarning=presentation.report?.warnings?.find(item=>item.code==='model-period');
  const annual=monthly?'':`<h2 class="dre-print-part-heading" data-report-part="annual">DRE anual consolidada · ${regimeScope(presentation)}</h2>${table({presentation,columns,showPercent,label:'DRE anual completa',className:'dre-print-annual-table'})}${finalReconciliations({presentation,columns,showPercent})}`;
  const monthlies=period==='annual'?'':presentation.regimes.map((regime,index)=>{
    const context=monthlyContext({presentation,calendar,year:calendar?.year??year,regimeId:regime.id});
    context.columns=context.columns.map(column=>column.mode==='month'?{...column,year:calendar?.months?.[column.month]?.sourceMonth?`Origem: ${calendar.months[column.month].sourceMonth}`:presentation.method==='REPORT_MONTHS_V1'?'Sem dados importados':String(calendar?.year??year)}:column);
    return `<section class="dre-report-monthly-part${index===0?' is-first':''}" data-report-part="monthly" data-report-regime="${esc(regime.id)}"><h2>${esc(regime.name)} · DRE mensal</h2><p>Janeiro a dezembro do cenário ${esc(calendar?.year??year)} e total anual. ${presentation.method==='REPORT_MONTHS_V1'?'A origem de cada competência aparece no cabeçalho; meses ausentes permanecem sem dados.':'Valores mensais da projeção salva.'}</p>${table({presentation,columns:context.columns,showPercent,label:`DRE mensal completa · ${regime.name}`,className:'dre-print-monthly-table',indicatorLabel:`Indicador · ${regime.name}`,indicatorNote:`Cenário ${calendar?.year??year}`})}${finalReconciliations({presentation,columns:context.columns,showPercent})}</section>`;
  }).join('');
  return `<section id="dre-print-document" class="sim-dre dre-complete dre-print-document ${monthly?'dre-print-monthly':complete?'dre-print-complete':'dre-print-annual'}"><header class="dre-print-identification"><div class="eyebrow">MAXIMUM CNPJ · RELATÓRIO DA SIMULAÇÃO</div><h1>Demonstração do Resultado</h1><h2>${esc(company.name||'Empresa')}</h2><p>${company.code?'Código '+esc(company.code)+' · ':''}${company.cnpj?'CNPJ '+esc(company.cnpj)+' · ':''}Cenário ${esc(year)} · ${monthly?'DRE mensal · '+regimeScope(presentation):complete?'Relatório completo · DRE anual e mensal':presentation.regimes.length===1?'Demonstrativo anual':'Comparação anual'}</p><p>${esc(regimeLabel)}</p>${modelWarning?`<p class="dre-report-model-warning"><strong>${esc(modelWarning.title)}:</strong> ${esc(modelWarning.detail)}</p>`:''}${referenceLine(calendar,null,presentation)}</header>${coverageNote(presentation)}${monthly?'':printSummary(presentation)}${simplesDiagnostic(presentation)}${legend()}${showPercent?'<p class="dre-denominator">Percentuais sobre a receita utilizada no mesmo regime e período; sem receita positiva, o percentual não se aplica.</p>':''}${annual}${monthlies}${printAppendix(presentation,calendar,year)}</section>`;
}

function printSummary(presentation){
  const rows=unifiedDreRows(presentation),find=key=>rows.find(row=>row.key===key);
  return `<div class="dre-print-summary" style="--dre-regime-count:${Math.max(1,presentation.regimes.length)}" aria-label="Resumo anual por regime">${presentation.regimes.map(regime=>{
    const column=annualColumn(regime);
    return `<article><h3>${esc(regime.name)}</h3><p>${esc(regime.status||(regime.available?'Cálculo disponível':'Conferência necessária'))}</p><dl>${[['revenue','Receita utilizada'],['netProfit','Resultado líquido'],['totalTaxes','Tributos e encargos'],['netMargin','Margem líquida']].map(([key,label])=>`<div><dt>${label}</dt><dd>${key==='netMargin'?percent(readDreValue(find(key),column)):money(readDreValue(find(key),column))}</dd></div>`).join('')}</dl></article>`;
  }).join('')}</div>`;
}
function printAppendix(presentation,calendar,year){
  const statuses=dreRegimeStatuses(presentation),report=presentation.report;
  const memory=dreReportMemory(presentation);
  const amount=item=>typeof item.value!=='number'?esc(item.value):item.unit==='currency'?money(item.value):item.unit==='percent'?percent(item.value):Number.isFinite(item.value)?esc(item.value.toLocaleString('pt-BR',{maximumFractionDigits:8})):'—';
  const sources=(report?.sources||[]).map(source=>`<li><strong>${esc(source.label)}</strong><br>${/^https?:\/\//i.test(source.url)?`<a href="${esc(source.url)}">${esc(source.url)}</a>`:esc(source.url)}</li>`).join('');
  return `<section class="dre-report-appendix" data-report-part="references"><h2>Conferências, premissas e memória do cenário</h2><p>Versão do cálculo: ${esc(report?.modelVersion||'não registrada')}. A leitura deste relatório preserva os resultados da versão salva.</p><div class="dre-report-statuses"><h3>Situação dos regimes</h3>${statuses.map(status=>`<article data-report-status="${esc(status.id)}"><h4>${esc(status.name)} · ${status.available?'cálculo disponível':'conferência necessária'}</h4><p>${esc(status.status)}</p>${status.months.map(group=>`<p><strong>${esc(group.months.join(', '))}:</strong> ${esc(group.status)}</p>`).join('')}</article>`).join('')}</div>${difalNotes(presentation)}${footnotes(presentation)}${methodology({calendar,year,presentation})}${report?.warnings?.length?`<div class="dre-report-warnings"><h3>Premissas e observações do cálculo</h3>${report.warnings.map(warning=>`<article data-report-warning="${esc(warning.code)}"><h4>${esc(warning.title)}</h4><p>${esc(warning.detail)}</p></article>`).join('')}</div>`:''}${memory.length?`<div class="dre-report-memory"><h3>Memória consolidada de cálculo</h3><p>Fórmulas e valores capturados para o período. As linhas da DRE e seus subtotais já estão apresentados nos demonstrativos e não são repetidos nesta memória.</p><table><thead><tr><th scope="col">Seção / item</th><th scope="col">Fórmula e premissa</th><th scope="col">Valor</th></tr></thead><tbody>${memory.map(item=>`<tr data-report-memory="${esc(item.id)}"><th scope="row"><small>${esc(item.section)}</small>${esc(item.label)}</th><td>${esc(item.formula)}</td><td>${amount(item)}</td></tr>`).join('')}</tbody></table></div>`:''}${sources?`<div class="dre-report-sources"><h3>Referências normativas da versão</h3><ul>${sources}</ul></div>`:''}</section>`;
}
