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
    <header class="projection-header"><div><span class="projection-eyebrow">DO ARQUIVO AO ANO INTEIRO</span><h2 id="projection-title">A média do período.<br><span>O potencial de 12 meses.</span></h2><p>Uma única regra para todos os relatórios: somar, dividir pelos meses e projetar para um ano.</p></div><div class="projection-period"><span>BASE DA PROJEÇÃO</span><strong>${n}<small>${n === 1 ? 'mês' : 'meses'}</small></strong><span>${esc(range)}</span><em>${confirmed ? 'Período confirmado' : 'Confirme o período abaixo'}</em></div></header>
    <div class="projection-toolbar"><div class="projection-tabs" role="group" aria-label="Valores da projeção"><button type="button" data-projection-kind="sales" aria-pressed="${selected === 'sales'}">Vendas</button><button type="button" data-projection-kind="purchases" aria-pressed="${selected === 'purchases'}">Compras</button></div><span>Projeção-base dos relatórios · sem ajustes manuais</span></div>
    <div class="projection-flow">
      <article><span class="projection-step">01 <span>TOTAL IMPORTADO</span></span><strong data-projection-total>${money(amounts.totalCents)}</strong><p>${label} acumuladas em ${n} ${n === 1 ? 'mês' : 'meses'}</p></article>
      <article><span class="projection-step">02 <span>MÉDIA MENSAL</span></span><strong data-projection-monthly>${money(amounts.monthlyCents)}</strong><p>Total do arquivo ÷ ${n} <span class="projection-operation">÷ ${n}</span></p></article>
      <article class="projection-annual"><span class="projection-step">03 <span>PROJEÇÃO ANUAL</span></span><strong data-projection-annual>${money(amounts.annualCents)}</strong><p>Média mensal × 12 <span class="projection-operation">× 12</span></p></article>
    </div>
    <figure class="projection-timeline"><figcaption><span><strong>12 meses, a mesma média</strong><small>Não são ${n} + 12 meses. O horizonte total é de 12 meses.</small></span><span>${money(amounts.monthlyCents)} <small>/ mês</small></span></figcaption>
      <div class="projection-months" role="img" aria-label="${esc(label)}: ${esc(money(amounts.monthlyCents))} em cada um dos 12 meses projetados.">${projection.timeline.map(row => `<div class="projection-month ${amounts.monthlyCents === 0 ? 'is-zero' : ''}" title="Mês ${row.month}: ${money(amounts.monthlyCents)}"><i aria-hidden="true"></i><span>${String(row.month).padStart(2, '0')}</span></div>`).join('')}</div>
      <p>Meses 01 a 12 da projeção, não lançamentos reais de um calendário. Sem sazonalidade presumida.</p>
    </figure>
    ${edited ? '<p class="projection-adjusted" role="status"><strong>O cenário tem ajustes manuais.</strong> Esta conferência mantém a média original. Os campos editados e o resultado do cenário ficam identificados separadamente.</p>' : ''}
    ${!confirmed ? '<p class="projection-pending">Prévia: confirme quantos meses os arquivos representam antes de gerar a simulação.</p>' : ''}
    <details class="projection-memory"><summary>Conferir a conta dos cinco grupos <span>Total ÷ meses × 12 <span aria-hidden="true">⌄</span></span></summary><div class="projection-table-wrap" role="region" aria-label="Memória da projeção por grupo" tabindex="0"><table><thead><tr><th scope="col">Grupo do relatório</th><th scope="col">Total em ${n} ${n === 1 ? 'mês' : 'meses'}</th><th scope="col">Média mensal</th><th scope="col">Projeção de 12 meses</th></tr></thead><tbody>${projection.groups.map(row => `<tr><th scope="row">${LABELS[row.key]}</th><td>${money(row.totalCents)}</td><td>${money(row.monthlyCents)}</td><td>${money(row.annualCents)}</td></tr>`).join('')}</tbody></table></div><p>Arredondamento mensal em centavos, distribuído entre os grupos para fechar os totais. O anual repete a média arredondada 12 vezes; pode haver diferença de centavos em relação ao cálculo sem arredondamento.</p></details>
    <footer class="projection-footnote"><span aria-hidden="true">ⓘ</span><p>Serviços e despesas são informados <strong>por mês</strong> e entram no cenário anual multiplicados por 12. A <strong>RBT12 do extrato</strong> é uma informação separada e não é dividida nem multiplicada nesta projeção.${legacy ? ' Conferência derivada dos totais salvos; os resultados históricos não foram recalculados.' : ''}</p></footer>
  </section>`;
}
