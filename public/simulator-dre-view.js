import {unifiedDreRows} from './simulator-dre.js';
import {readDreValue,buildDreSummary} from './simulator-dre-summary.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null||!Number.isFinite(value)?'—':value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const percent=value=>value==null||!Number.isFinite(value)?'—':(value*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const TOTALS=new Set(['revenue','netRevenue','grossProfit','preTax','netProfit']);
const annualColumn=regime=>({id:regime.id,label:regime.name,mode:'annual'});
function cell(row,column,{showPercent,highlightId}){
  const value=readDreValue(row,column),reason=(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
  const ratio=column.mode==='month'?row.monthlyPercentValues?.[column.id]?.[column.month]:column.mode==='calendarAnnual'?row.calendarAnnualPercentValues?.[column.id]:row.percentValues?.[column.id];
  return `<td class="${column.mode==='calendarAnnual'?'sim-year-total ':''}${column.id===highlightId&&column.mode==='annual'?'dre-active-column ':''}${row.key==='netProfit'?(value===null?'dre-unavailable-cell':value<0?'dre-loss-cell':''):''}"><span class="dre-amount${value<0?' dre-negative':''}"${value===null&&reason?` title="${esc(reason)}" aria-label="${esc(reason)}"`:''}>${row.unit==='percent'?percent(value):money(value)}</span>${showPercent&&row.unit!=='percent'?`<small class="dre-percent" aria-label="Percentual da receita bruta">${percent(ratio)}</small>`:''}</td>`;
}
function tableRow(row,columns,options){
  const total=TOTALS.has(row.key),kind=row.kind||'line';
  return `<tr class="dre-row dre-${esc(kind)}${total?' total':''}${row.informative?' dre-informative':''}" data-dre-row="${esc(row.key)}"><th scope="row"><span>${esc(row.label)}</span>${row.kind==='detail'?'<small class="dre-composition-label">Composição</small>':''}</th>${columns.map(column=>cell(row,column,options)).join('')}</tr>`;
}
function table({presentation,columns,showPercent,label='DRE comparativa com rolagem horizontal',className='',highlightId=null}){
  return `<div class="sim-table-wrap dre-table-wrap ${className}" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr><th scope="col">Indicador</th>${columns.map(column=>`<th scope="col"${column.id===highlightId&&column.mode==='annual'?' class="dre-active-column"':''}>${esc(column.label)}${column.year?`<small>${esc(column.year)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${unifiedDreRows(presentation).map(row=>tableRow(row,columns,{presentation,showPercent,highlightId})).join('')}</tbody></table></div>`;
}
function toolbar(showPercent){
  return `<div class="dre-toolbar"><label class="dre-percent-control"><input id="dre-show-percent" type="checkbox" ${showPercent?'checked':''}>Mostrar % da receita</label><div class="dre-export-actions"><button type="button" id="export-dre-csv">Baixar DRE CSV</button><button type="button" id="print-dre">Imprimir / salvar PDF</button></div></div>`;
}
function methodology({calendar,year}){
  const period=calendar?.reportPeriod;
  return `<p class="dre-method-note">${calendar?.version==='DRE_CALENDAR_V3'?'Valores de cada competência dos relatórios, associados ao mesmo mês do cenário '+esc(year)+'. Meses fora do período importado ficam sem dados. Total anual = soma das competências.':'Projeção de janeiro a dezembro de '+esc(year)+', sem lançamentos históricos.'} ${period?'Base dos relatórios: '+esc(period.startMonth)+' a '+esc(period.endMonth)+'. ':''}A RBT12 permanece fixa no cenário. ${esc(calendar?.rounding||'Valores completos preservados; a soma dos meses exibidos pode diferir por centavos do total anual.')}</p>`;
}
function legend(){return '<p class="dre-legend">As linhas de composição detalham os valores já incluídos na DRE. Subtotais, créditos informativos e indicadores não devem ser somados novamente ao resultado. — indica informação indisponível ou não aplicável.</p>';}
function footnotes(presentation){
  const notes=[...new Set(unifiedDreRows(presentation).flatMap(row=>row.notes||[]))].filter(note=>note!=='Subtotal de conferência das linhas já incluídas no resultado; não somar novamente.');
  return notes.length?`<div class="dre-footnotes">${notes.map(note=>`<p>${esc(note)}</p>`).join('')}</div>`:'';
}
function referenceLine(calendar){
  const reference=calendar?.rbt12Reference;
  return reference?`<p>RBT12 fixa: ${money(reference.rbt12Cents/100)} · ${reference.source==='MANUAL'?'informada manualmente, sem validação por OCR':'PA '+esc(reference.pa)+' · extrato, seção 2.2'}</p>`:'';
}

function selectRegime(presentation,regimeId){return presentation.regimes.find(item=>item.id===regimeId)||presentation.regimes.find(item=>item.available)||presentation.regimes[0];}
function regimeControl(presentation,regime,annual=false){
  return `<label class="dre-regime-control" for="dre-regime">${annual?'Regime em destaque':'Regime tributário'}<select id="dre-regime">${presentation.regimes.map(item=>`<option value="${esc(item.id)}" ${item.id===regime.id?'selected':''}>${esc(item.name)}${item.available?'':' · indisponível'}</option>`).join('')}</select></label>`;
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
  const status=data.result===null?'Sem resultado disponível':negative?'Prejuízo estimado':data.result===0?'Resultado em equilíbrio':'Lucro estimado';
  const max=Math.max(1,...data.movements.map(row=>Math.abs(row.value||0)));
  const bars=data.reconciled?`<ol class="dre-flow-bars">${data.movements.map(row=>`<li class="dre-flow-${row.kind}${row.value<0?' is-negative':''}"><span class="dre-flow-label">${esc(row.label)}</span><span class="dre-flow-track" aria-hidden="true"><i style="width:${Math.abs(row.value)/max*50}%;left:${row.value<0?50-Math.abs(row.value)/max*50:50}%"></i></span><strong>${money(row.value)}</strong></li>`).join('')}</ol>`:`<p class="dre-visual-empty">${data.revenue===null&&data.result===null?'Sem dados suficientes para apresentar o gráfico deste período e regime.':'A composição está incompleta ou não concilia com o resultado salvo. Confira os valores na tabela.'}</p>`;
  return `<div class="dre-overview" aria-label="Resumo visual da DRE"><div class="dre-overview-heading"><span>LEITURA DO RESULTADO</span><p><strong>${esc(regime.name)}</strong> · ${esc(periodLabel)}</p></div>
    <div class="dre-summary-cards"><article><span>Receita bruta</span><strong data-dre-summary="revenue">${money(data.revenue)}</strong><small>Vendas + serviços</small></article><article><span>Deduções líquidas</span><strong data-dre-summary="deductions">${money(data.deductions)}</strong><small>Custos, despesas e tributos após créditos</small></article><article class="dre-result-card${negative?' is-loss':''}${data.result===null?' is-unavailable':''}"><span>Resultado líquido</span><strong data-dre-summary="result">${money(data.result)}</strong><small>${status} · margem <b data-dre-summary="margin">${percent(data.margin)}</b></small></article></div>
    <figure class="dre-result-flow"><figcaption><strong>Da receita ao resultado</strong><span>Receita + movimentos da DRE = resultado líquido</span></figcaption>${bars}</figure></div>`;
}
function quickNavigation(){return `<nav class="dre-quick-nav" aria-label="Ir para uma linha da DRE">${[['services','Receitas'],['das','Tributos'],['cmvSimple','Compras'],['salaries','Despesas'],['netProfit','Resultado']].map(([key,label])=>`<button type="button" data-dre-jump="${key}">${label}</button>`).join('')}</nav>`;}
function readingNote(showPercent){return `<p class="dre-reading-note">R$ · valores negativos são deduções · composições detalham valores já incluídos · — indica indisponível.${showPercent?' Percentuais sobre a receita bruta do mesmo período e regime.':''}</p>`;}
function contextFooter(presentation,calendar,year){return `<footer class="dre-reading-footer"><h3>Referências deste demonstrativo</h3>${referenceLine(calendar)}${footnotes(presentation)}${calendar?methodology({calendar,year}):''}</footer>`;}
export function renderAnnualDre({presentation,calendar,year,regimeId,showPercent=false}){
  const columns=presentation.regimes.map(annualColumn),regime=selectRegime(presentation,regimeId);
  return `<section class="card sim-dre dre-complete dre-visual" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE anual</h2><p>Consolidado de ${esc(year)} · ${presentation.method==='REPORT_MONTHS_V1'?'soma das competências importadas':'projeção anual salva'}</p></div>${regimeControl(presentation,regime,true)}</div>
  ${periodControl({calendar,year})}
  ${visualSummary(presentation,annualColumn(regime),'Total anual · '+year,regime)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>Todos os regimes lado a lado. A coluna do regime selecionado fica em destaque.</p></div>${toolbar(showPercent)}</div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,highlightId:regime.id})}${contextFooter(presentation,calendar,year)}</section>`;
}
function monthlyContext({presentation,calendar,year,regimeId,monthView=false,month=0}){
  const regime=selectRegime(presentation,regimeId);
  const months=presentation.months||calendar?.months||[];
  const selectedMonth=Math.max(0,Math.min(11,Number(month)||0));
  const columns=months.flatMap((item,index)=>!monthView||index===selectedMonth?[{id:regime.id,label:item.label,year,mode:'month',month:index}]:[]);
  columns.push({id:regime.id,label:'Total anual',mode:'calendarAnnual'});
  return {regime,months,columns,selectedMonth};
}
export function renderCompleteMonthlyDre({presentation,calendar,year,regimeId,showPercent=false,monthView=true,month=0}){
  const {regime,months,columns,selectedMonth}=monthlyContext({presentation,calendar,year,regimeId,monthView,month});
  const selected=months[selectedMonth],summaryColumn={id:regime.id,mode:'month',month:selectedMonth};
  return `<section class="card sim-dre sim-calendar dre-complete dre-visual${monthView?' dre-single-month':''}" id="dre-demonstrativo"><div class="dre-heading"><div><span class="eyebrow">DEMONSTRAÇÃO DO RESULTADO</span><h2>DRE mensal</h2><p>Cenário ${esc(year)} · ${calendar?.version==='DRE_CALENDAR_V3'?'valores por competência dos relatórios':'projeção pela média mensal salva'}</p></div>${regimeControl(presentation,regime)}</div>
  ${periodControl({monthly:true,calendar,year,months,selectedMonth})}
  ${visualSummary(presentation,summaryColumn,selected?.label+' / '+year,regime)}
  <div class="dre-table-heading"><div><h3>Demonstrativo completo</h3><p>${monthView?'Mês selecionado e total anual.':'Janeiro a dezembro e total anual.'} Todas as composições na mesma tabela.</p></div>${toolbar(showPercent)}</div>
  <div class="dre-calendar-controls"><div role="group" aria-label="Visualização do calendário"><button type="button" data-dre-month-view="single" aria-pressed="${monthView}">Um mês por vez</button><button type="button" data-dre-month-view="all" aria-pressed="${!monthView}">12 meses</button></div></div>
  ${quickNavigation()}${readingNote(showPercent)}${table({presentation,columns,showPercent,className:'dre-calendar-screen',label:monthView?'DRE do mês selecionado e total anual':'DRE de janeiro a dezembro com coluna Indicador fixa'})}
  ${contextFooter(presentation,calendar,year)}</section>`;
}
/** Printing always includes all twelve captured months in one continuous table. */
export function renderDrePrintCalendar({presentation,calendar,year,regimeId,showPercent=false}){
  year=calendar?.year??year;
  const {regime,columns}=monthlyContext({presentation,calendar,year,regimeId});
  return `<div class="dre-print-calendar"><h3>${esc(regime.name)} · Janeiro a dezembro de ${esc(year)}</h3>${table({presentation,columns,showPercent,label:'DRE mensal completa'})}</div>`;
}
/** Temporary standalone print document; reads the same presentation as the screen. */
export function renderDrePrintDocument({presentation,calendar,year,regimeId,showPercent=false,period='annual',company={}}){
  const monthly=period==='monthly';year=monthly?(calendar?.year??year):year;
  const context=monthly?monthlyContext({presentation,calendar,year,regimeId}):null;
  const columns=monthly?context.columns:presentation.regimes.map(annualColumn);
  const regimeLabel=monthly?context.regime.name:presentation.regimes.map(regime=>regime.name).join(' · ');
  return `<section id="dre-print-document" class="sim-dre dre-complete dre-print-document ${monthly?'dre-print-monthly':'dre-print-annual'}"><header class="dre-print-identification"><div class="eyebrow">MAXIMUM CNPJ · DRE</div><h1>Demonstração do Resultado</h1><h2>${esc(company.name||'Empresa')}</h2><p>${company.code?'Código '+esc(company.code)+' · ':''}${company.cnpj?'CNPJ '+esc(company.cnpj)+' · ':''}Cenário ${esc(year)} · ${monthly?'Janeiro a dezembro':'Comparação anual'}</p><p>${esc(regimeLabel)}</p>${referenceLine(calendar)}</header>${legend()}${showPercent?'<p class="dre-denominator">Percentuais sobre a receita bruta do mesmo regime e período; sem receita positiva, o percentual não se aplica.</p>':''}${table({presentation,columns,showPercent,label:monthly?'DRE mensal completa':'DRE anual completa'})}${footnotes(presentation)}${monthly?methodology({calendar,year}):''}</section>`;
}
