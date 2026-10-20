import {unifiedDreRows} from './simulator-dre.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null||!Number.isFinite(value)?'—':value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const percent=value=>value==null||!Number.isFinite(value)?'—':(value*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const TOTALS=new Set(['revenue','netRevenue','grossProfit','preTax','netProfit']);
const annualColumn=regime=>({id:regime.id,label:regime.name,mode:'annual'});
function rowValue(row,column){
  if(column.mode==='month')return row.monthlyValues?.[column.id]?.[column.month]??null;
  if(column.mode==='calendarAnnual')return row.calendarAnnualValues?.[column.id]??null;
  return row.values?.[column.id]??null;
}
function cell(row,column,{presentation,showPercent}){
  const value=rowValue(row,column),reason=(column.mode==='annual'?row.reasonByRegime:row.calendarReasonByRegime)?.[column.id];
  const ratio=column.mode==='month'?row.monthlyPercentValues?.[column.id]?.[column.month]:column.mode==='calendarAnnual'?row.calendarAnnualPercentValues?.[column.id]:row.percentValues?.[column.id];
  return `<td${column.mode==='calendarAnnual'?' class="sim-year-total"':''}><span class="dre-amount${value<0?' dre-negative':''}"${value===null&&reason?` title="${esc(reason)}" aria-label="${esc(reason)}"`:''}>${row.unit==='percent'?percent(value):money(value)}</span>${showPercent&&row.unit!=='percent'?`<small class="dre-percent" aria-label="Percentual da receita bruta">${percent(ratio)}</small>`:''}</td>`;
}
function tableRow(row,columns,options){
  const total=TOTALS.has(row.key),kind=row.kind||'line';
  return `<tr class="dre-row dre-${esc(kind)}${total?' total':''}${row.informative?' dre-informative':''}" data-dre-row="${esc(row.key)}"><th scope="row"><span>${esc(row.label)}</span>${row.kind==='detail'?'<small>Composição · informativo</small>':''}</th>${columns.map(column=>cell(row,column,options)).join('')}</tr>`;
}
function table({presentation,columns,showPercent,label='DRE comparativa com rolagem horizontal',className=''}){
  return `<div class="sim-table-wrap dre-table-wrap ${className}" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr><th scope="col">Indicador</th>${columns.map(column=>`<th scope="col">${esc(column.label)}${column.year?`<small>${esc(column.year)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${unifiedDreRows(presentation).map(row=>tableRow(row,columns,{presentation,showPercent})).join('')}</tbody></table></div>`;
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

export function renderAnnualDre({presentation,year,showPercent=false}){
  const columns=presentation.regimes.map(annualColumn);
  return `<section class="card sim-dre dre-complete"><div class="eyebrow">DRE · ${presentation.method==='REPORT_MONTHS_V1'?'TOTAL DAS COMPETÊNCIAS':'PROJEÇÃO ANUAL'}</div><h2>DRE comparativa</h2><p class="sim-help">Receitas, custos, despesas e resultado de ${esc(year)}. Composições e indicadores apresentados no mesmo demonstrativo.</p>${toolbar(showPercent)}<p class="dre-denominator">${showPercent?'Percentuais sobre a receita bruta do mesmo regime e período. Sem receita positiva, o percentual não se aplica.':'Valores em reais (R$). Os valores negativos representam deduções.'}</p><p class="sim-help sim-table-hint">Arraste a tabela para comparar os regimes. A coluna Indicador permanece fixa.</p>${legend()}${table({presentation,columns,showPercent})}${footnotes(presentation)}</section>`;
}
function monthlyContext({presentation,calendar,year,regimeId,monthView=false,month=0}){
  const regime=presentation.regimes.find(item=>item.id===regimeId)||presentation.regimes.find(item=>item.available)||presentation.regimes[0];
  const months=presentation.months||calendar?.months||[];
  const selectedMonth=Math.max(0,Math.min(11,Number(month)||0));
  const columns=months.flatMap((item,index)=>!monthView||index===selectedMonth?[{id:regime.id,label:item.label,year,mode:'month',month:index}]:[]);
  columns.push({id:regime.id,label:'Total anual',mode:'calendarAnnual'});
  return {regime,months,columns,selectedMonth};
}
export function renderCompleteMonthlyDre({presentation,calendar,year,regimeId,showPercent=false,monthView=false,month=0}){
  const context=monthlyContext({presentation,calendar,year,regimeId,monthView,month}),{regime,months,columns,selectedMonth}=context,reference=calendar?.rbt12Reference;
  return `<section class="card sim-dre sim-calendar dre-complete${monthView?' dre-single-month':''}"><div class="eyebrow">DRE MENSAL</div><div class="sim-calendar-heading"><div><h2>Janeiro a dezembro</h2><p class="sim-help">Cenário ${esc(year)} · ${calendar?.version==='DRE_CALENDAR_V3'?'valores por competência dos relatórios.':'projeção pela média mensal dos relatórios.'}</p><p class="dre-selected-regime">${esc(regime.name)}${regime.available?'':' · indisponível'}</p></div><label for="dre-regime">Regime tributário<select id="dre-regime">${presentation.regimes.map(item=>`<option value="${esc(item.id)}" ${item.id===regime.id?'selected':''}>${esc(item.name)}${item.available?'':' · indisponível'}</option>`).join('')}</select></label></div>
  <div class="sim-extrato-reference">${reference?`<span>RBT12 fixa nos 12 meses<small>${reference.source==='MANUAL'?'Informada manualmente · sem validação por OCR':'PA '+esc(reference.pa)+' · seção 2.2'}</small></span><strong>${money(reference.rbt12Cents/100)}</strong>`:'<span>Histórico sem RBT12 validada pela seção 2.2.<small>Valores originais preservados. Leia o extrato para criar uma nova simulação.</small></span>'}</div>
  ${toolbar(showPercent)}<div class="dre-calendar-controls"><div role="group" aria-label="Visualização do calendário"><button type="button" data-dre-month-view="all" aria-pressed="${!monthView}">12 meses</button><button type="button" data-dre-month-view="single" aria-pressed="${monthView}">Um mês por vez</button></div>${monthView?`<label for="dre-month">Mês<select id="dre-month">${months.map((item,index)=>`<option value="${index}" ${index===selectedMonth?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>`:''}</div>
  <p class="dre-denominator">${showPercent?'Percentuais sobre a receita bruta do mesmo regime e período. Sem receita positiva, o percentual não se aplica.':'Valores em reais (R$). Composições e indicadores apresentados no mesmo demonstrativo.'}</p><p class="sim-help sim-table-hint">${monthView?'Selecione cada mês para conferir os valores e o total anual.':'Arraste para ver janeiro a dezembro. No celular, você também pode consultar um mês por vez.'}</p>
  ${legend()}${table({presentation,columns,showPercent,className:'dre-calendar-screen',label:monthView?'DRE do mês selecionado e total anual':'DRE de janeiro a dezembro com coluna Indicador fixa'})}
  ${footnotes(presentation)}${methodology({calendar,year})}</section>`;
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
