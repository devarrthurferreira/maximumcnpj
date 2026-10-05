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
  return `<div class="sim-extrato-review"><details class="sim-extrato-details"><summary><span>Conferir seção 2.2<small>12 competências · PA ${esc(data.pa)}</small></span><strong>${money(data.rbt12Cents/100)}</strong></summary>
    <div class="sim-extrato-content"><p class="sim-extrato-company"><strong>${esc(data.companyName||'Empresa do extrato')}</strong><small>CNPJ básico ${esc(data.cnpjBasico)}</small></p>
    <p class="sim-help">Soma dos mercados interno e externo nas 12 competências anteriores ao PA. O mês do PA, a seção 2.1, o DAS e a projeção anual não entram neste valor.</p>
    <div class="sim-extrato-table-wrap" tabindex="0" role="region" aria-label="Doze receitas da seção 2.2 que compõem a RBT12"><table><thead><tr><th>Competência</th><th>Mercado interno</th><th>Mercado externo</th><th>Total</th></tr></thead><tbody>
    ${data.rbt12Window.map(row=>`<tr><th scope="row">${esc(row.period)}</th><td>${money(row.internalCents/100)}</td><td>${money(row.externalCents/100)}</td><td>${money(row.totalCents/100)}</td></tr>`).join('')}
    </tbody><tfoot><tr><th scope="row">RBT12 · soma das 12 competências</th><td>${money(data.rbt12Basis?.internalCents/100)}</td><td>${money(data.rbt12Basis?.externalCents/100)}</td><td>${money(data.rbt12Cents/100)}</td></tr></tfoot></table></div>
    <p class="sim-help">${esc(statementProcessingSummary(data))} Confira os valores na imagem original.</p></div></details>
    ${(data.warnings||[]).map(w=>`<p class="sim-extrato-warning" role="note">${esc(w)}</p>`).join('')}</div>`;
}
export function renderMonthlyDre({result,year,reference,period,regimeId,calendar}) {
  const data=calendar?.version==='DRE_CALENDAR_V1'?calendar:buildMonthlyDre(result,year,reference,period);
  const regime=data.regimes.find(r=>r.id===regimeId)||data.regimes.find(r=>r.available)||data.regimes[0];
  const source=data.rbt12Reference;
  return `<section class="card sim-dre sim-calendar"><div class="eyebrow">DRE MENSAL</div><div class="sim-calendar-heading"><div><h2>Janeiro a dezembro</h2><p class="sim-help">Cenário ${data.year} · projeção pela média mensal dos relatórios.</p></div><label for="dre-regime">Regime tributário<select id="dre-regime">${data.regimes.map(r=>`<option value="${esc(r.id)}" ${r.id===regime.id?'selected':''}>${esc(r.name)}${r.available?'':' · indisponível'}</option>`).join('')}</select></label></div>
    <div class="sim-extrato-reference">${source?`<span>RBT12 fixa nos 12 meses<small>${source.source==='MANUAL'?'Informada manualmente · sem validação por OCR':'PA '+esc(source.pa)+' · seção 2.2'}</small></span><strong>${money(source.rbt12Cents/100)}</strong>`:'<span>Histórico sem RBT12 validada pela seção 2.2.<small>Valores originais preservados. Leia o extrato para criar uma nova simulação.</small></span>'}</div>
    <p class="sim-help sim-table-hint">Arraste para o lado ou deite o celular. Indicador permanece fixo.</p>
    <div class="sim-table-wrap" tabindex="0" role="region" aria-label="DRE de janeiro a dezembro com coluna Indicador fixa"><table><thead><tr><th scope="col">Indicador</th>${data.months.map(m=>`<th scope="col">${esc(m.label)}<small>${data.year}</small></th>`).join('')}<th scope="col">Total anual</th></tr></thead><tbody>
    ${regime.rows.map(row=>`<tr class="${['revenue','netRevenue','grossProfit','preTax','netProfit'].includes(row.key)?'total':''}" data-dre-row="${esc(row.key)}"><th scope="row">${esc(row.label)}</th>${row.months.map(v=>`<td>${money(v)}</td>`).join('')}<td class="sim-year-total">${money(row.annual)}</td></tr>`).join('')}</tbody></table></div>
    <details class="sim-dre-method"><summary>Como esta projeção foi calculada</summary><div>
    <p class="sim-help">Base dos relatórios: ${period?esc(period.startMonth)+' a '+esc(period.endMonth):'período confirmado no formulário'}. A média mensal é repetida nos 12 meses; não são lançamentos históricos. Serviços, despesas e ajustes seguem os valores mensais do cenário.</p>
    ${source?`<p class="sim-help">A RBT12 ${source.source==='MANUAL'?'informada manualmente':'do extrato'} é a mesma referência em todo o cenário. Não é uma nova RBT12 apurada para cada mês.</p>`:''}
    <p class="sim-help sim-rounding-note">${esc(data.rounding)}</p></div></details></section>`;
}
