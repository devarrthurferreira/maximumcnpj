/** Presentation only: input and monthlyGroups are monthly BRL, engine results are annual BRL. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const money = value => finite(value) ? value.toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) : 'Não disponível';
const percent = value => finite(value) ? value.toLocaleString('pt-BR', {style:'percent', maximumFractionDigits:2}) : 'Não aplicável';
const number = value => Number(value.toFixed(4));
const colors = ['#780b24', '#18776b', '#bd778a', '#97b8af', '#b49658'];
const scaled = (value, factor) => finite(value) && finite(value * factor) ? value * factor : null;

function caption(eyebrow, title, detail, badge = '') {
  return `<figcaption class="sim-chart-caption"><div><span class="sim-chart-eyebrow">${escape(eyebrow)}</span><h3>${escape(title)}</h3><p>${escape(detail)}</p></div>${badge ? `<span class="sim-chart-unit">${escape(badge)}</span>` : ''}</figcaption>`;
}

/** A shared linear domain including zero also handles all-negative and all-zero comparisons. */
function domain(values) {
  const valid = values.filter(finite);
  let minimum = Math.min(0, ...valid), maximum = Math.max(0, ...valid);
  if (minimum === maximum) { minimum = -1; maximum = 1; }
  const scale = Math.max(Math.abs(minimum), Math.abs(maximum));
  return {minimum, maximum, position:value => (value / scale - minimum / scale) / (maximum / scale - minimum / scale)};
}

function horizontalBar(value, range, color, {showZero = true} = {}) {
  const left = 2, width = 496, zero = left + range.position(0) * width;
  const end = left + range.position(value) * width;
  return `<svg class="sim-chart-bar" viewBox="0 0 500 28" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="sim-chart-track" x="2" y="5" width="496" height="18" rx="5"/>${showZero ? `<line class="sim-chart-zero" x1="${number(zero)}" x2="${number(zero)}" y1="1" y2="27"/>` : ''}${value === 0 ? `<circle cx="${number(zero)}" cy="14" r="2" fill="${color}"/>` : `<rect x="${number(Math.min(zero, end))}" y="5" width="${number(Math.abs(end - zero))}" height="18" rx="4" fill="${color}"/>`}</svg>`;
}

function profitChart(regimes, result, factor, unit) {
  const values = regimes.filter(regime => regime.available === true).map(regime => scaled(regime.annualProfit, factor));
  const range = domain(values);
  const available = values.filter(finite);
  const allZero = available.length > 0 && available.every(value => value === 0);
  const zeroPosition = range.position(0);
  const tickValues = zeroPosition > .22 && zeroPosition < .78 ? [range.minimum, 0, range.maximum] : [range.minimum, range.maximum];
  const ticks = allZero ? [{value:0, position:.5}] : tickValues.filter((value,index,items) => items.indexOf(value) === index).map(value => ({value, position:range.position(value)}));
  return `<figure class="sim-chart-card sim-chart-profit">${caption('COMPARAÇÃO DE CENÁRIOS', 'Resultado líquido por regime', 'A linha vertical marca o zero: prejuízos à esquerda e resultados positivos à direita.', `R$ ${unit}`)}<ol class="sim-chart-rows">${regimes.map(regime => {
    const value = regime.available === true ? scaled(regime.annualProfit, factor) : null;
    const best = finite(value) && regime.id === result.bestRegimeId;
    const color = value < 0 ? '#bd778a' : best ? '#18776b' : '#780b24';
    return `<li class="sim-chart-row ${best ? 'is-best' : ''}"><div class="sim-chart-row-head"><span>${escape(regime.name)}${best ? '<small class="sim-chart-best">Maior resultado</small>' : ''}</span><strong class="${value < 0 ? 'is-negative' : ''}">${finite(value) ? escape(money(value)) : 'Indisponível'}</strong></div>${finite(value) ? horizontalBar(value, range, color) : `<p class="sim-chart-unavailable">${escape(regime.status || 'Este cenário não está disponível para comparação.')}</p>`}</li>`;
  }).join('')}</ol>${available.length ? `<div class="sim-chart-axis" aria-hidden="true">${ticks.map(tick => `<span style="left:${number(tick.position * 100)}%" class="${tick.position === 0 ? 'is-start' : tick.position === 1 ? 'is-end' : ''}">${escape(money(tick.value))}</span>`).join('')}</div>` : '<p class="sim-chart-empty">Nenhum resultado disponível para comparar.</p>'}<p class="sim-chart-footnote">${allZero ? 'Todos os resultados disponíveis são iguais a zero.' : `Valores ${unit === 'por ano' ? 'anuais projetados' : 'médios mensais'}. Cenários indisponíveis não participam do gráfico.`}</p></figure>`;
}

function burdenChart(regimes) {
  const usable = regimes.filter(regime => regime.available === true && finite(regime.taxBurden));
  const range = usable.every(regime => regime.taxBurden === 0) ? {position:value => value} : domain(usable.map(regime => regime.taxBurden));
  return `<figure class="sim-chart-card sim-chart-burden">${caption('TRIBUTOS E ENCARGOS', 'Carga sobre a receita', 'Participação dos tributos e encargos totais na receita bruta.', '% da receita')}<ol class="sim-chart-rows">${regimes.map(regime => {
    const available = regime.available === true && finite(regime.taxBurden);
    return `<li class="sim-chart-row"><div class="sim-chart-row-head"><span>${escape(regime.name)}</span><strong>${regime.available !== true ? 'Indisponível' : escape(percent(regime.taxBurden))}</strong></div>${available ? horizontalBar(regime.taxBurden, range, '#780b24') : `<p class="sim-chart-unavailable">${regime.available !== true ? escape(regime.status || 'Cenário indisponível.') : 'Sem receita positiva para calcular o percentual.'}</p>`}</li>`;
  }).join('')}</ol><p class="sim-chart-footnote">${usable.length ? 'O percentual é o mesmo na visão mensal e anual. A escala é compartilhada entre os regimes.' : 'Não há percentuais disponíveis para comparar.'}</p></figure>`;
}

function composition({eyebrow, title, detail, items, unit, className, consistent = true}) {
  const complete = consistent && items.every(item => finite(item.value) && item.value >= 0);
  const sum = complete ? items.reduce((total,item) => total + item.value, 0) : null;
  const total = finite(sum) ? sum : null;
  let offset = 0;
  const circles = complete && total > 0 ? items.map((item,index) => {
    const portion = item.value / total * 100;
    const segment = portion > 0 ? `<circle cx="64" cy="64" r="48" pathLength="100" fill="none" stroke="${colors[index]}" stroke-width="18" stroke-dasharray="${number(portion)} ${number(100 - portion)}" stroke-dashoffset="${number(-offset)}" transform="rotate(-90 64 64)"/>` : '';
    offset += portion;
    return segment;
  }).join('') : '';
  return `<figure class="sim-chart-card ${className}">${caption(eyebrow, title, detail, `R$ ${unit}`)}<div class="sim-chart-composition"><div class="sim-chart-donut" aria-hidden="true"><svg viewBox="0 0 128 128" focusable="false"><circle cx="64" cy="64" r="48" fill="none" stroke="#f0e8eb" stroke-width="18"/>${circles}</svg><span>${total > 0 ? '100%' : '—'}<small>${total > 0 ? 'do total' : 'sem dados'}</small></span></div><div class="sim-chart-composition-summary"><span>Total ${escape(unit)}</span><strong>${total === null ? 'Não disponível' : escape(money(total))}</strong><p>${total > 0 ? 'Distribuição dos valores informados' : total === 0 ? 'Sem valores positivos para compor o gráfico.' : 'Confira os valores para visualizar a composição completa.'}</p></div></div><ul class="sim-chart-legend">${items.map((item,index) => `<li><span class="sim-chart-legend-label"><i style="background:${colors[index]}" aria-hidden="true"></i>${escape(item.label)}</span><span class="sim-chart-legend-value"><strong>${escape(money(item.value))}</strong><small>${total > 0 ? escape(percent(item.value / total)) : '—'}</small></span></li>`).join('')}</ul></figure>`;
}

function expenseChart(values, factor, unit) {
  const items = [['salaries','Salários e pró-labore'],['benefits','Benefícios da equipe'],['adminExpenses','Outras despesas'],['rent','Aluguel'],['cardExpenses','Taxas de cartão']].map(([key,label]) => ({label, value:scaled(values[key], factor)}));
  const valid = items.every(item => finite(item.value) && item.value >= 0);
  const sum = valid ? items.reduce((total,item) => total + item.value, 0) : null;
  const total = finite(sum) ? sum : null;
  const range = total === 0 ? {position:value => value} : domain(items.map(item => item.value));
  return `<figure class="sim-chart-card sim-chart-expenses">${caption('ESTRUTURA OPERACIONAL', 'Onde estão as despesas?', 'Despesas informadas, antes dos tributos e encargos específicos de cada regime.', `R$ ${unit}`)}<div class="sim-chart-expense-total"><span>Total ${escape(unit)}</span><strong>${escape(money(total))}</strong></div><ol class="sim-chart-rows">${items.map((item,index) => `<li class="sim-chart-row"><div class="sim-chart-row-head"><span>${escape(item.label)}</span><strong>${escape(money(item.value))}</strong></div>${finite(item.value) && item.value >= 0 ? horizontalBar(item.value, range, colors[index], {showZero:false}) : '<p class="sim-chart-unavailable">Valor não disponível.</p>'}</li>`).join('')}</ol><p class="sim-chart-footnote">${total === 0 ? 'Despesas informadas iguais a zero.' : 'Compras aparecem em seu próprio gráfico. Encargos calculados por regime estão na DRE.'}</p></figure>`;
}

/**
 * Render accessible, dependency-free charts without changing the calculation model.
 * monthlyGroups uses the five report field names; despite their Cents suffix these
 * editable simulator values are BRL, matching monthlyGroupsUnit in saved simulations.
 */
export function renderSimulationCharts({input = {}, result = {}, monthlyGroups = {}, period = 'annual'} = {}) {
  const monthly = period === 'monthly';
  const inputFactor = monthly ? 1 : 12, resultFactor = monthly ? 1 / 12 : 1;
  const unit = monthly ? 'por mês' : 'por ano';
  const values = input?.values || input || {};
  const groups = monthlyGroups || {};
  const regimes = Array.isArray(result?.regimes) ? result.regimes.filter(regime => regime && typeof regime === 'object') : [];
  const revenue = [
    {label:'Receita de serviços', value:scaled(values.serviceRevenue,inputFactor)},
    {label:'Vendas a Optantes SN', value:scaled(groups.salesOptantCents,inputFactor)},
    {label:'Vendas a Não Optantes SN', value:scaled(groups.salesNonOptantCents,inputFactor)},
    {label:'Vendas a CPFs', value:scaled(groups.salesCpfCents,inputFactor)},
  ];
  const sales = revenue.slice(1).reduce((sum,item) => sum + (finite(item.value) ? item.value : 0),0);
  const expectedSales = scaled(values.salesRevenue, inputFactor);
  const consistent = finite(expectedSales) && Math.abs(sales - expectedSales) < .03 * inputFactor;
  return `<section class="sim-charts" aria-label="Gráficos da simulação: valores ${escape(unit)}"><div class="sim-chart-comparison">${profitChart(regimes,result || {},resultFactor,unit)}${burdenChart(regimes)}</div><div class="sim-chart-breakdown">${composition({eyebrow:'ORIGEM DO FATURAMENTO',title:'Composição da receita',detail:'Serviços e os três grupos de vendas.',items:revenue,unit,className:'sim-chart-revenue',consistent})}${composition({eyebrow:'PERFIL DOS FORNECEDORES',title:'Composição das compras',detail:'Compras agrupadas pelo enquadramento do fornecedor.',items:[{label:'Empresas do Simples',value:scaled(values.simplePurchases,inputFactor)},{label:'Empresas fora do Simples',value:scaled(values.regularPurchases,inputFactor)}],unit,className:'sim-chart-purchases'})}${expenseChart(values,inputFactor,unit)}</div></section>`;
}
