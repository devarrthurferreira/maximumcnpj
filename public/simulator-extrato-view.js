import {buildMonthlyDre} from './simulator-calendar.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const isSection22 = d => d?.parserVersion==='SIMPLES_SECTION_22_V2' && d?.sourceSection==='2.2' && Number.isSafeInteger(d?.rbt12Cents) && d.rbt12Cents>=0 && Array.isArray(d?.rbt12Window) && d.rbt12Window.length===12;
export function statementProcessingSummary(data) {
  if(data.extractionScope==='SECTION_22'||data.searchablePdfScope==='SELECTED_PAGES') {
    const pages=Array.isArray(data.processedPageNumbers)&&data.processedPageNumbers.length?' (páginas '+data.processedPageNumbers.join(', ')+')':'';
    return `Leitura da identificação e da seção 2.2: ${data.processedPages??'—'} de ${data.pageCount??'—'} páginas analisadas${pages}. `+
      (data.searchablePdfScope==='SELECTED_PAGES'?'O PDF mantém todas as páginas; as demais foram preservadas sem OCR adicional.':'O PDF completo está pesquisável.');
  }
  return `${data.ocrUsed?'OCR das páginas digitalizadas':'Texto nativo do PDF'} · ${data.processedPages||data.pageCount||'—'} página(s) processada(s).`;
}
export function renderSection22(data) {
  if(!isSection22(data))return '';
  return `<details class="sim-extrato-details"><summary>Conferir seção 2.2 · 12 competências · ${money(data.rbt12Cents/100)}</summary>
    <p><strong>${esc(data.companyName||'Empresa do extrato')}</strong> · CNPJ básico ${esc(data.cnpjBasico)} · PA ${esc(data.pa)}</p>
    <p class="sim-help">Somente 2.2.1 (Mercado Interno) e 2.2.2 (Mercado Externo). O mês do PA não entra na soma. Não foram utilizados valores da seção 2.1, do DAS ou da projeção anual.</p>
    <div class="sim-extrato-table-wrap" tabindex="0" role="region" aria-label="Doze receitas da seção 2.2 que compõem a RBT12"><table><thead><tr><th>Competência</th><th>Mercado interno</th><th>Mercado externo</th><th>Total</th></tr></thead><tbody>
    ${data.rbt12Window.map(row=>`<tr><th scope="row">${esc(row.period)}</th><td>${money(row.internalCents/100)}</td><td>${money(row.externalCents/100)}</td><td>${money(row.totalCents/100)}</td></tr>`).join('')}
    </tbody><tfoot><tr><th scope="row">RBT12 · soma das 12 competências</th><td>${money(data.rbt12Basis?.internalCents/100)}</td><td>${money(data.rbt12Basis?.externalCents/100)}</td><td>${money(data.rbt12Cents/100)}</td></tr></tfoot></table></div>
    <p class="sim-help">${esc(statementProcessingSummary(data))} Confira os valores reconhecidos na imagem original.</p>
    ${(data.warnings||[]).map(w=>`<p class="sim-extrato-warning">${esc(w)}</p>`).join('')}</details>`;
}
export function renderMonthlyDre({result,year,reference,period,regimeId,calendar}) {
  const data=calendar?.version==='DRE_CALENDAR_V1'?calendar:buildMonthlyDre(result,year,reference,period);
  const regime=data.regimes.find(r=>r.id===regimeId)||data.regimes.find(r=>r.available)||data.regimes[0];
  const source=data.rbt12Reference;
  return `<section class="card sim-dre sim-calendar"><div class="eyebrow">DRE · PROJEÇÃO MENSAL</div><div class="sim-calendar-heading"><div><h2>Janeiro a dezembro, mês a mês.</h2><p class="sim-help">Cenário ${data.year} · base dos relatórios: ${period?esc(period.startMonth)+' a '+esc(period.endMonth):'período confirmado no formulário'}.</p></div><label for="dre-regime">Regime para conferir<select id="dre-regime">${data.regimes.map(r=>`<option value="${esc(r.id)}" ${r.id===regime.id?'selected':''}>${esc(r.name)}${r.available?'':' · indisponível'}</option>`).join('')}</select></label></div>
    <div class="sim-extrato-reference">${source?`<span>RBT12 de referência · seção 2.2 · PA ${esc(source.pa)}</span><strong>${money(source.rbt12Cents/100)}</strong><small>Esta mesma RBT12 do extrato é mantida nos 12 meses do cenário. Não é uma nova RBT12 apurada para cada mês.</small>`:'<span>Versão histórica: valores originais preservados.</span><small>Esta versão não possui RBT12 validada pela seção 2.2. Para uma nova simulação, leia o extrato.</small>'}</div>
    <p class="sim-help">A média dos relatórios é replicada em janeiro, fevereiro e assim por diante até dezembro; não são lançamentos históricos. Serviços, despesas e ajustes mensais seguem os valores do cenário. Arraste para o lado ou deite o celular; Indicador permanece fixo.</p>
    <div class="sim-table-wrap" tabindex="0" role="region" aria-label="DRE de janeiro a dezembro com coluna Indicador fixa"><table><thead><tr><th scope="col">Indicador</th>${data.months.map(m=>`<th scope="col">${esc(m.label)}<small>${data.year}</small></th>`).join('')}<th scope="col">Total anual</th></tr></thead><tbody>
    ${regime.rows.map(row=>`<tr class="${['revenue','netRevenue','grossProfit','preTax','netProfit'].includes(row.key)?'total':''}" data-dre-row="${esc(row.key)}"><th scope="row">${esc(row.label)}</th>${row.months.map(v=>`<td>${money(v)}</td>`).join('')}<td class="sim-year-total">${money(row.annual)}</td></tr>`).join('')}</tbody></table></div><p class="sim-help sim-rounding-note">${esc(data.rounding)}</p></section>`;
}
