const FINANCIAL_CODES=new Set(['negative-sales','negative-revenue','purchases-above-revenue','costs-above-revenue','icms-sales-base-floor']);
const SOURCE_PREFIX='Conferência financeira · ';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Show financial differences without requiring acknowledgement or disabling actions. */
export function renderFinancialAlerts({source=null,result=null}={}) {
  const warnings=result?((result.warnings||[]).filter(warning=>FINANCIAL_CODES.has(warning.code))):
    (source?.warnings||[]).filter(detail=>typeof detail==='string'&&detail.startsWith(SOURCE_PREFIX))
      .map(detail=>({code:'source',title:'Documentos importados',detail:detail.slice(SOURCE_PREFIX.length)}));
  const unique=[...new Map(warnings.map(warning=>[warning.detail,warning])).values()];
  if(!unique.length)return '';
  return `<aside class="financial-alerts" data-financial-alerts role="status" aria-label="Alertas financeiros"><h3>Valores para conferência</h3><p>Você pode continuar a análise. Os valores e eventuais saldos negativos serão preservados.</p><ul>${unique.map(warning=>`<li data-financial-alert-code="${esc(warning.code)}"><strong>${esc(warning.title)}</strong><span>${esc(warning.detail)}</span></li>`).join('')}</ul></aside>`;
}
