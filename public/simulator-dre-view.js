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
  return `<tr class="dre-row dre-${esc(kind)}${total?' total':''}${row.informative?' dre-informative':''}" data-dre-row="${esc(row.key)}"><th scope="row"><span>${esc(row.label)}</span>${row.informative?'<small>Informativo · não somar ao resultado</small>':''}</th>${columns.map(column=>cell(row,column,options)).join('')}</tr>`;
}
function table({presentation,columns,showPercent,sections=presentation.sections,label='DRE comparativa com rolagem horizontal',className=''}){
  return `<div class="sim-table-wrap dre-table-wrap ${className}" tabindex="0" role="region" aria-label="${esc(label)}"><table><thead><tr><th scope="col">Indicador</th>${columns.map(column=>`<th scope="col">${esc(column.label)}${column.year?`<small>${esc(column.year)}</small>`:''}</th>`).join('')}</tr></thead>${sections.map((section,index)=>`<tbody data-dre-section="${esc(section.key)}">${section.label?`<tr class="dre-section-row"><th scope="rowgroup" colspan="${columns.length+1}"><span>${String(index+1).padStart(2,'0')}</span> ${esc(section.label)}</th></tr>`:''}${section.rows.map(row=>tableRow(row,columns,{presentation,showPercent})).join('')}</tbody>`).join('')}</table></div>`;
}
function toolbar(showPercent){
  return `<div class="dre-toolbar"><label class="dre-percent-control"><input id="dre-show-percent" type="checkbox" ${showPercent?'checked':''}>Mostrar % da receita</label><div class="dre-export-actions"><button type="button" id="export-dre-csv">Baixar DRE CSV</button><button type="button" id="print-dre">Imprimir / salvar PDF</button></div></div>`;
}
function details({presentation,columns,showPercent}){
  const groups=[...(presentation.details||[]),...(presentation.indicators?.length?[{key:'indicators',label:'Indicadores da DRE',rows:presentation.indicators}]:[])];
  return `<div class="dre-details">${groups.map(group=>`<details class="dre-breakdown" data-state-key="dre-${esc(group.key)}"><summary>${esc(group.label)}<span aria-hidden="true">⌄</span></summary><div class="dre-breakdown-content">${group.notes?.length?group.notes.map(note=>`<p class="sim-help">${esc(note)}</p>`).join(''):''}${table({presentation,columns,showPercent,sections:[{key:group.key,rows:group.rows}],label:group.label})}${[...new Set(group.rows.flatMap(row=>row.notes||[]))].map(note=>`<p class="dre-detail-note">${esc(note)}</p>`).join('')}</div></details>`).join('')}</div>`;
}
function methodology({calendar,year}){
  const reference=calendar?.rbt12Reference,period=calendar?.reportPeriod;
  return `<details class="sim-dre-method" data-state-key="dre-method"><summary>Como esta projeção foi calculada</summary><div><p class="sim-help">Base dos relatórios: ${period?esc(period.startMonth)+' a '+esc(period.endMonth):'período confirmado no formulário'}. A média mensal é repetida de janeiro a dezembro de ${esc(year)}; não são lançamentos históricos. Serviços, despesas e ajustes seguem os valores mensais do cenário.</p>${reference?`<p class="sim-help">A RBT12 ${reference.source==='MANUAL'?'informada manualmente':'do extrato'} permanece fixa nos 12 meses. Não é uma nova RBT12 apurada para cada mês.</p>`:''}<p class="sim-help sim-rounding-note">${esc(calendar?.rounding||'Valores completos preservados. Exibição com duas casas; somas das células exibidas podem diferir por centavos do total anual.')}</p></div></details>`;
}
export function renderAnnualDre({presentation,year,showPercent=false}){
  const columns=presentation.regimes.map(annualColumn);
  return `<section class="card sim-dre dre-complete"><div class="eyebrow">DRE · PROJEÇÃO ANUAL</div><h2>DRE comparativa</h2><p class="sim-help">Receitas, custos, despesas e resultado de ${esc(year)}. Subtotais conferem as linhas do bloco; não são novas deduções.</p>${toolbar(showPercent)}<p class="dre-denominator">${showPercent?'Percentuais sobre a receita bruta do mesmo regime e período. Sem receita positiva, o percentual não se aplica.':'Valores em reais (R$). Os valores negativos representam deduções.'}</p><p class="sim-help sim-table-hint">Arraste a tabela para comparar os regimes. A coluna Indicador permanece fixa.</p>${table({presentation,columns,showPercent})}${details({presentation,columns,showPercent})}</section>`;
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
  const detailColumns=monthView?columns:[{id:regime.id,label:'Total anual',mode:'calendarAnnual'}];
  return `<section class="card sim-dre sim-calendar dre-complete${monthView?' dre-single-month':''}"><div class="eyebrow">DRE MENSAL</div><div class="sim-calendar-heading"><div><h2>Janeiro a dezembro</h2><p class="sim-help">Cenário ${esc(year)} · projeção pela média mensal dos relatórios.</p><p class="dre-selected-regime">${esc(regime.name)}${regime.available?'':' · indisponível'}</p></div><label for="dre-regime">Regime tributário<select id="dre-regime">${presentation.regimes.map(item=>`<option value="${esc(item.id)}" ${item.id===regime.id?'selected':''}>${esc(item.name)}${item.available?'':' · indisponível'}</option>`).join('')}</select></label></div>
  <div class="sim-extrato-reference">${reference?`<span>RBT12 fixa nos 12 meses<small>${reference.source==='MANUAL'?'Informada manualmente · sem validação por OCR':'PA '+esc(reference.pa)+' · seção 2.2'}</small></span><strong>${money(reference.rbt12Cents/100)}</strong>`:'<span>Histórico sem RBT12 validada pela seção 2.2.<small>Valores originais preservados. Leia o extrato para criar uma nova simulação.</small></span>'}</div>
  ${toolbar(showPercent)}<div class="dre-calendar-controls"><div role="group" aria-label="Visualização do calendário"><button type="button" data-dre-month-view="all" aria-pressed="${!monthView}">12 meses</button><button type="button" data-dre-month-view="single" aria-pressed="${monthView}">Um mês por vez</button></div>${monthView?`<label for="dre-month">Mês<select id="dre-month">${months.map((item,index)=>`<option value="${index}" ${index===selectedMonth?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>`:''}</div>
  <p class="dre-denominator">${showPercent?'Percentuais sobre a receita bruta do mesmo regime e período. Sem receita positiva, o percentual não se aplica.':'Valores em reais (R$). Subtotais conferem as linhas do bloco; não são novas deduções.'}</p><p class="sim-help sim-table-hint">${monthView?'Selecione cada mês para conferir os valores e o total anual.':'Arraste para ver janeiro a dezembro. No celular, você também pode consultar um mês por vez.'}</p>
  ${table({presentation,columns,showPercent,className:'dre-calendar-screen',label:monthView?'DRE do mês selecionado e total anual':'DRE de janeiro a dezembro com coluna Indicador fixa'})}
  ${details({presentation,columns:detailColumns,showPercent})}${methodology({calendar,year})}</section>`;
}
/** Printing uses all twelve captured months even when the screen shows one month. */
export function renderDrePrintCalendar({presentation,calendar,year,regimeId,showPercent=false}){
  year=calendar?.year??year;
  const {regime,months}=monthlyContext({presentation,calendar,year,regimeId});
  return `<div class="dre-print-calendar">${[0,6].map(start=>{const columns=months.slice(start,start+6).map((item,index)=>({id:regime.id,label:item.label,year,mode:'month',month:start+index}));columns.push({id:regime.id,label:'Total anual',mode:'calendarAnnual'});return `<section class="dre-print-semester"><h3>${esc(regime.name)} · ${start?'Julho a dezembro':'Janeiro a junho'} de ${esc(year)}</h3>${table({presentation,columns,showPercent,label:'DRE '+(start?'segundo':'primeiro')+' semestre'})}</section>`;}).join('')}</div>`;
}
