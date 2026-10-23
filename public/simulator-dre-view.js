import {unifiedDreRows,dreDifalNotes} from './simulator-dre.js';
import {readDreValue,buildDreSummary,buildDreEvolution} from './simulator-dre-summary.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null||!Number.isFinite(value)?'—':value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const percent=value=>value==null||!Number.isFinite(value)?'—':(value*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const TOTALS=new Set(['revenue','netRevenue','grossProfit','preTax','netProfit','revenueAfterReturns','revenueUsed']);
const annualColumn=regime=>({id:regime.id,label:regime.name,mode:'annual'});
function cell(row,column,{showPercent,highlightId}){
  const value=readDreValue(row,column),reason=column.mode==='month'?row.monthlyReasonByRegime?.[column.id]?.[column.month]??row.calendarReasonByRegime?.[column.id]:(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
  const ratio=column.mode==='month'?row.monthlyPercentValues?.[column.id]?.[column.month]:column.mode==='calendarAnnual'?row.calendarAnnualPercentValues?.[column.id]:row.percentValues?.[column.id];
  return `<td class="${column.mode==='calendarAnnual'?'sim-year-total ':''}${column.id===highlightId&&column.mode==='annual'?'dre-active-column ':''}${row.key==='netProfit'?(value===null?'dre-unavailable-cell':value<0?'dre-loss-cell':''):''}"><span class="dre-amount${value<0?' dre-negative':''}"${value===null&&reason?` title="${esc(reason)}" aria-label="${esc(reason)}"`:''}>${row.unit==='percent'?percent(value):money(value)}</span>${showPercent&&row.unit!=='percent'?`<small class="dre-percent" aria-label="Percentual da receita utilizada">${percent(ratio)}</small>`:''}</td>`;
}
function tableRow(row,columns,options){
  const total=TOTALS.has(row.key),kind=row.kind||'line';
  return `<tr class="dre-row dre-${esc(kind)}${total?' total':''}${row.informative?' dre-informative':''}" data-dre-row="${esc(row.key)}"><th scope="row"><span>${esc(row.label)}</span>${row.kind==='detail'?'<small class="dre-composition-label">Composição</small>':''}</th>${columns.map(column=>cell(row,column,options)).join('')}</tr>`;
}
function table({presentation,columns,showPercent,label='DRE comparativa com rolagem horizontal',className='',highlightId=null,rows=null}){
  const reconciliationKeys=new Set((presentation.revenueReconciliation?.rows||[]).map(row=>row.key));
  const displayed=rows||unifiedDreRows(presentation).filter(row=>!reconciliationKeys.has(row.key));
  return `<div class="sim-table-wrap dre-table-wrap ${className}" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr><th scope="col">Indicador</th>${columns.map(column=>`<th scope="col"${column.id===highlightId&&column.mode==='annual'?' class="dre-active-column"':''}>${esc(column.label)}${column.year?`<small>${esc(column.year)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${displayed.map(row=>tableRow(row,columns,{presentation,showPercent,highlightId})).join('')}</tbody></table></div>`;
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
function toolbar(showPercent){
  return `<div class="dre-toolbar"><label class="dre-percent-control"><input id="dre-show-percent" type="checkbox" ${showPercent?'checked':''}>Mostrar % da receita utilizada</label><div class="dre-export-actions"><button type="button" id="export-dre-csv">Baixar DRE CSV</button><button type="button" id="print-dre">Imprimir / salvar PDF</button></div></div>`;
}
function methodology({calendar,year}){
  const period=calendar?.reportPeriod;
  const rolling=calendar?.method==='REPORT_MONTHS_ROLLING_RBT12'&&calendar?.rbt12Schedule;
  return `<p class="dre-method-note">${calendar?.version==='DRE_CALENDAR_V3'?'Valores de cada competência dos relatórios, associados ao mesmo mês do cenário '+esc(year)+'. Meses fora do período importado ficam sem dados. Total anual = soma das competências.':'Projeção de janeiro a dezembro de '+esc(year)+', sem lançamentos históricos.'} ${period?'Base dos relatórios: '+esc(period.startMonth)+' a '+esc(period.endMonth)+'. ':''}${rolling?'A RBT12 de cada competência soma os 12 meses anteriores do quadro 2.2 do extrato.':'A RBT12 permanece fixa no cenário.'} ${esc(calendar?.rounding||'Valores completos preservados; a soma dos meses exibidos pode diferir por centavos do total anual.')}</p>`;
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
function referenceLine(calendar,sourceMonth=null){
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
function contextFooter(presentation,calendar,year,sourceMonth=null){return `<footer class="dre-reading-footer"><h3>Referências deste demonstrativo</h3>${referenceLine(calendar,sourceMonth)}${difalNotes(presentation,sourceMonth)}${footnotes(presentation)}${calendar?methodology({calendar,year}):''}</footer>`;}
export function renderAnnualDre({presentation,calendar,year,regimeId,showPercent=false}){
  const columns=presentation.regimes.map(annualColumn),regime=selectRegime(presentation,regimeId);
  return `<section class="card sim-dre dre-complete dre-visual" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE anual</h2><p>Consolidado de ${esc(year)} · ${presentation.method==='REPORT_MONTHS_V1'?'soma das competências importadas':'projeção anual salva'}</p></div>${regimeControl(presentation,regime,true)}</div>
  ${periodControl({calendar,year})}
  ${visualSummary(presentation,annualColumn(regime),'Total anual · '+year,regime)}
  ${annualEvolution(presentation,calendar,regime.id)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>Todos os regimes lado a lado. A coluna do regime selecionado fica em destaque.</p></div>${toolbar(showPercent)}</div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,highlightId:regime.id})}${contextFooter(presentation,calendar,year)}${revenueReconciliation({presentation,columns,showPercent,summaryColumn:annualColumn(regime),summaryLabel:`${regime.name} · Total anual / ${year}`})}</section>`;
}
function monthlyContext({presentation,calendar,year,regimeId,monthView=false,month=0}){
  const months=presentation.months||calendar?.months||[];
  const selectedMonth=Math.max(0,Math.min(11,Number(month)||0));
  const regime=selectRegime(presentation,regimeId,selectedMonth);
  const columns=months.flatMap((item,index)=>!monthView||index===selectedMonth?[{id:regime.id,label:item.label,year,mode:'month',month:index}]:[]);
  columns.push({id:regime.id,label:'Total anual',mode:'calendarAnnual'});
  return {regime,months,columns,selectedMonth};
}
export function renderCompleteMonthlyDre({presentation,calendar,year,regimeId,showPercent=false,monthView=true,month=0}){
  const {regime,months,columns,selectedMonth}=monthlyContext({presentation,calendar,year,regimeId,monthView,month});
  const selected=months[selectedMonth],summaryColumn={id:regime.id,mode:'month',month:selectedMonth};
  return `<section class="card sim-dre sim-calendar dre-complete dre-visual${monthView?' dre-single-month':''}" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE mensal</h2><p>Cenário ${esc(year)} · ${calendar?.version==='DRE_CALENDAR_V3'?'valores por competência dos relatórios':'projeção pela média mensal salva'}</p></div>${regimeControl(presentation,regime,false,selectedMonth)}</div>
  ${periodControl({monthly:true,calendar,year,months,selectedMonth})}
  ${visualSummary(presentation,summaryColumn,selected?.label+' / '+year,regime)}
  ${monthlyEvolution(presentation,calendar,regime.id,selectedMonth)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>${monthView?'Mês selecionado e total anual.':'Janeiro a dezembro e total anual.'} Todas as composições na mesma tabela.</p></div>${toolbar(showPercent)}</div>
  <div class="dre-calendar-controls"><div role="group" aria-label="Visualização do calendário"><button type="button" data-dre-month-view="single" aria-pressed="${monthView}">Um mês por vez</button><button type="button" data-dre-month-view="all" aria-pressed="${!monthView}">12 meses</button></div></div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,className:'dre-calendar-screen',label:monthView?'DRE do mês selecionado e total anual':'DRE de janeiro a dezembro com coluna Indicador fixa'})}
  ${contextFooter(presentation,calendar,year,monthView?calendar?.months?.[selectedMonth]?.sourceMonth:null)}${revenueReconciliation({presentation,columns,showPercent,summaryColumn,summaryLabel:`${regime.name} · ${selected?.label} / ${year}`})}</section>`;
}
/** Printing always includes all twelve captured months in one continuous table. */
export function renderDrePrintCalendar({presentation,calendar,year,regimeId,showPercent=false}){
  year=calendar?.year??year;
  const {regime,columns}=monthlyContext({presentation,calendar,year,regimeId});
  return `<div class="dre-print-calendar"><h3>${esc(regime.name)} · Janeiro a dezembro de ${esc(year)}</h3>${table({presentation,columns,showPercent,label:'DRE mensal completa'})}${revenueReconciliation({presentation,columns,showPercent})}</div>`;
}
/** Temporary standalone print document; reads the same presentation as the screen. */
export function renderDrePrintDocument({presentation,calendar,year,regimeId,showPercent=false,period='annual',company={}}){
  const monthly=period==='monthly';year=monthly?(calendar?.year??year):year;
  const context=monthly?monthlyContext({presentation,calendar,year,regimeId}):null;
  const columns=monthly?context.columns:presentation.regimes.map(annualColumn);
  const regimeLabel=monthly?context.regime.name:presentation.regimes.map(regime=>regime.name).join(' · ');
  return `<section id="dre-print-document" class="sim-dre dre-complete dre-print-document ${monthly?'dre-print-monthly':'dre-print-annual'}"><header class="dre-print-identification"><div class="eyebrow">MAXIMUM CNPJ · DRE</div><h1>Demonstração do Resultado</h1><h2>${esc(company.name||'Empresa')}</h2><p>${company.code?'Código '+esc(company.code)+' · ':''}${company.cnpj?'CNPJ '+esc(company.cnpj)+' · ':''}Cenário ${esc(year)} · ${monthly?'Janeiro a dezembro':'Comparação anual'}</p><p>${esc(regimeLabel)}</p>${referenceLine(calendar)}</header>${legend()}${showPercent?'<p class="dre-denominator">Percentuais sobre a receita utilizada no mesmo regime e período; sem receita positiva, o percentual não se aplica.</p>':''}${table({presentation,columns,showPercent,label:monthly?'DRE mensal completa':'DRE anual completa'})}${difalNotes(presentation)}${footnotes(presentation)}${monthly?methodology({calendar,year}):''}${revenueReconciliation({presentation,columns,showPercent})}</section>`;
}
