const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => (cents / 100).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const LABELS = {
  salesOptantCents: 'Vendas · Optantes do Simples', salesNonOptantCents: 'Vendas · Não optantes e não confirmados',
  salesCpfCents: 'Vendas · CPF', purchasesOptantCents: 'Compras · Simples', purchasesNonOptantCents: 'Compras · Fora do Simples'
};
function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return '';
  const [year, value] = month.split('-');
  return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(value)-1]}/${year}`;
}
/** Pure presentation: all amounts are supplied by the shared projection rule. */
export function renderProjectionCard({projection, kind = 'sales', period = null, confirmed = true, edited = false, legacy = false}) {
  const selected = kind === 'purchases' ? 'purchases' : 'sales', amounts = projection.totals[selected];
  const label = selected === 'sales' ? 'Vendas' : 'Compras', n = projection.reportMonths;
  const range = period ? `${monthLabel(period.startMonth)} — ${monthLabel(period.endMonth)}` : `${n} ${n === 1 ? 'competência informada' : 'competências informadas'}`;
  return `<section class="sim-projection" aria-labelledby="projection-title">
    <header class="projection-header"><div><h2 id="projection-title">Base dos relatórios</h2><p class="projection-period">${period ? `${n} ${n === 1 ? 'mês' : 'meses'} · ` : ''}${esc(range)}</p></div><div class="projection-tabs" role="group" aria-label="Valores da projeção"><button type="button" data-projection-kind="sales" aria-pressed="${selected === 'sales'}">Vendas</button><button type="button" data-projection-kind="purchases" aria-pressed="${selected === 'purchases'}">Compras</button></div></header>
    <div class="projection-flow" aria-label="${label}: total, média mensal e projeção anual">
      <article><span class="projection-step">Total importado</span><strong data-projection-total>${money(amounts.totalCents)}</strong><p>${label} em ${n} ${n === 1 ? 'mês' : 'meses'}</p></article>
      <article><span class="projection-step">Média mensal</span><strong data-projection-monthly>${money(amounts.monthlyCents)}</strong><p>Total ÷ ${n} ${n === 1 ? 'mês' : 'meses'}</p></article>
      <article class="projection-annual"><span class="projection-step">Projeção anual</span><strong data-projection-annual>${money(amounts.annualCents)}</strong><p>Média mensal × 12</p></article>
    </div>
    ${edited ? '<p class="projection-adjusted" role="status">Cenário com ajustes manuais. A base mantém a média original.</p>' : ''}
    ${!confirmed ? '<p class="projection-pending">Prévia: confirme o período antes de simular.</p>' : ''}
    <details class="projection-memory"><summary>Como calculamos <span>Total ÷ meses × 12 <span class="projection-chevron" aria-hidden="true">⌄</span></span></summary>
    <div class="projection-method">
    <p class="projection-explanation">Somamos as ${label.toLowerCase()} dos arquivos, dividimos por <strong>${n} ${n === 1 ? 'mês' : 'meses'}</strong> e repetimos a média por <strong>12 meses</strong>. ${confirmed ? 'Período confirmado.' : 'Confirme quantos meses os arquivos representam para concluir a simulação.'} Esta é a projeção-base dos relatórios, sem ajustes manuais.${edited ? ' Os campos editados e o resultado do cenário ficam identificados separadamente.' : ''}</p>
    <figure class="projection-timeline"><figcaption><span><strong>12 meses, a mesma média</strong><small>Não são ${n} + 12 meses. O horizonte total é de 12 meses.</small></span><span>${money(amounts.monthlyCents)} <small>/ mês</small></span></figcaption>
      <div class="projection-months" role="img" aria-label="${esc(label)}: ${esc(money(amounts.monthlyCents))} em cada um dos 12 meses projetados.">${projection.timeline.map(row => `<div class="projection-month ${amounts.monthlyCents === 0 ? 'is-zero' : ''}" title="Mês ${row.month}: ${money(amounts.monthlyCents)}"><i aria-hidden="true"></i><span>${String(row.month).padStart(2, '0')}</span></div>`).join('')}</div>
      <p>Meses 01 a 12 da projeção, não lançamentos reais de um calendário. Sem sazonalidade presumida.</p>
    </figure>
    <div class="projection-table-wrap" role="region" aria-label="Memória da projeção por grupo" tabindex="0"><table><caption>Conferência dos cinco grupos</caption><thead><tr><th scope="col">Grupo do relatório</th><th scope="col">Total em ${n} ${n === 1 ? 'mês' : 'meses'}</th><th scope="col">Média mensal</th><th scope="col">Projeção de 12 meses</th></tr></thead><tbody>${projection.groups.map(row => `<tr><th scope="row">${LABELS[row.key]}</th><td>${money(row.totalCents)}</td><td>${money(row.monthlyCents)}</td><td>${money(row.annualCents)}</td></tr>`).join('')}</tbody></table></div><p class="projection-rounding">Arredondamento mensal em centavos, distribuído entre os grupos para fechar os totais. O anual repete a média arredondada 12 vezes; pode haver diferença de centavos em relação ao cálculo sem arredondamento.</p>
    <footer class="projection-footnote"><p>Serviços e despesas são informados <strong>por mês</strong> e entram no cenário anual multiplicados por 12. A <strong>RBT12 do extrato</strong> é uma informação separada e não é dividida nem multiplicada nesta projeção.${legacy ? ' Conferência derivada dos totais salvos; os resultados históricos não foram recalculados.' : ''}</p></footer>
    </div></details>
  </section>`;
}
