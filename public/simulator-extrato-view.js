import {buildMonthlyDre} from './simulator-calendar.js';
import {reconcileSection22Extraction} from './simulator-rbt12.js';
import {buildDrePresentation} from './simulator-dre.js';
import {renderCompleteMonthlyDre} from './simulator-dre-view.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function isSection22(data) {
  try { reconcileSection22Extraction(data);return true; } catch { return false; }
}
export function statementProcessingSummary(data) {
  if(data.extractionScope==='SECTION_22'||data.searchablePdfScope==='SELECTED_PAGES') {
    const pages=Array.isArray(data.processedPageNumbers)&&data.processedPageNumbers.length?' (páginas '+data.processedPageNumbers.join(', ')+')':'';
    return `Leitura da identificação e da seção 2.2: ${data.processedPages??'—'} de ${data.pageCount??'—'} páginas analisadas${pages}. `+
      (data.searchablePdfScope==='SELECTED_PAGES'?'O PDF mantém todas as páginas; as demais foram preservadas sem OCR adicional.':'O PDF completo está pesquisável.');
  }
  return `${data.ocrUsed?'OCR das páginas digitalizadas':'Texto nativo do PDF'} · ${data.processedPages||data.pageCount||'—'} página(s) processada(s).`;
}
export function renderSection22(data) {
  if(!data)return '';
  if(!isSection22(data))return '<p class="sim-extrato-warning" role="status">Não foi possível conferir esta leitura salva do quadro 2.2. Leia novamente o extrato ao criar uma nova versão. Os valores da DRE histórica permanecem preservados.</p>';
  const history=Array.isArray(data.priorRevenues)?data.priorRevenues:data.rbt12Window;
  return `<div class="sim-extrato-review"><section class="sim-extrato-monthly" aria-labelledby="section22-history-title">
    <header class="sim-extrato-monthly-heading"><div><h3 id="section22-history-title">Receitas mensais do quadro 2.2</h3><p>${history.length} receitas mensais extraídas · ${esc(history[0].period)} a ${esc(history.at(-1).period)}</p></div><span>Valores de cada mês</span></header>
    <p class="sim-extrato-company"><strong>${esc(data.companyName||'Empresa do extrato')}</strong><small>CNPJ básico ${esc(data.cnpjBasico)}</small></p>
    <p class="sim-help">Cada linha mostra a receita daquele mês, somando os mercados interno e externo. A RBT12 usada em cada competência reúne as 12 receitas mensais anteriores, detalhadas na conferência abaixo.</p>
    <div class="sim-extrato-table-wrap sim-extrato-history" data-section22-history tabindex="0" role="region" aria-label="Todas as receitas mensais extraídas do quadro 2.2"><table><thead><tr><th>Competência</th><th>Receita mensal total</th><th>Mercado interno</th><th>Mercado externo</th></tr></thead><tbody>
    ${history.map(row=>`<tr data-section22-month="${esc(row.month)}"${row.month.endsWith('-01')?' class="sim-extrato-year-start"':''}><th scope="row">${esc(row.period)}</th><td class="sim-extrato-month-total">${money(row.totalCents/100)}</td><td>${money(row.internalCents/100)}</td><td>${money(row.externalCents/100)}</td></tr>`).join('')}
    </tbody></table></div><p class="sim-help">${esc(statementProcessingSummary(data))} Confira as receitas com o PDF original.</p></section>
    <details class="sim-extrato-details sim-extrato-pa"><summary><span>RBT12 de referência do PA ${esc(data.pa)}<small>Soma das 12 receitas mensais anteriores ao PA</small></span><strong>${money(data.rbt12Cents/100)}</strong></summary>
    <div class="sim-extrato-content"><p class="sim-help">Esta é a janela do PA do extrato. O cálculo de outra competência usa seus próprios 12 meses anteriores. A seção 2.1, o DAS e a projeção anual ficam fora desta composição.</p>
    <div class="sim-extrato-table-wrap" tabindex="0" role="region" aria-label="Doze receitas da seção 2.2 que compõem a RBT12 do PA"><table><thead><tr><th>Competência</th><th>Mercado interno</th><th>Mercado externo</th><th>Receita mensal total</th></tr></thead><tbody>
    ${data.rbt12Window.map(row=>`<tr><th scope="row">${esc(row.period)}</th><td>${money(row.internalCents/100)}</td><td>${money(row.externalCents/100)}</td><td>${money(row.totalCents/100)}</td></tr>`).join('')}
    </tbody><tfoot><tr><th scope="row">RBT12 · soma das 12 competências</th><td>${money(data.rbt12Basis?.internalCents/100)}</td><td>${money(data.rbt12Basis?.externalCents/100)}</td><td>${money(data.rbt12Cents/100)}</td></tr></tfoot></table></div></div></details>
    ${(data.warnings||[]).map(w=>`<p class="sim-extrato-warning" role="note">${esc(w)}</p>`).join('')}</div>`;
}
export function renderMonthlyDre({result,year,reference,period,regimeId,calendar,presentation,showPercent=false,monthView=true,month=0,reportPeriod='complete'}) {
  const data=['DRE_CALENDAR_V1','DRE_CALENDAR_V2','DRE_CALENDAR_V3','DRE_CALENDAR_V4'].includes(calendar?.version)?calendar:buildMonthlyDre(result,year,reference,period);
  return renderCompleteMonthlyDre({presentation:presentation||buildDrePresentation({result,calendar:data}),calendar:data,year:data.year,regimeId,showPercent,monthView,month,reportPeriod});
}
