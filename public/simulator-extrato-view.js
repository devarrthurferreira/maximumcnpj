import {buildMonthlyDre} from './simulator-calendar.js';
import {buildDrePresentation} from './simulator-dre.js';
import {renderCompleteMonthlyDre} from './simulator-dre-view.js';
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
export function renderMonthlyDre({result,year,reference,period,regimeId,calendar,presentation,showPercent=false,monthView=false,month=0}) {
  const data=['DRE_CALENDAR_V1','DRE_CALENDAR_V2'].includes(calendar?.version)?calendar:buildMonthlyDre(result,year,reference,period);
  return renderCompleteMonthlyDre({presentation:presentation||buildDrePresentation({result,calendar:data}),calendar:data,year:data.year,regimeId,showPercent,monthView,month});
}
