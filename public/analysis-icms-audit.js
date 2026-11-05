const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const number = value => value.toLocaleString('pt-BR');
const safe = value => Number.isSafeInteger(value) && value >= 0;

/** Resumo dos documentos, sem incorporar ajustes manuais nem créditos. */
export function renderIcmsSalesAudit(source) {
  const months=source?.monthlyReports;
  if(!Array.isArray(months)||!months.length)return '';
  const totals={nfceLines:0,nfceBaseCents:0,missingLines:0,internalBase:0,internalTax:0,
    interstateBase:0,interstateTax:0,returnBase:0,returnTax:0,pendingLines:0,debit:0};
  const unavailable='<section class="analysis-icms-audit is-warning" role="status"><strong>ICMS das vendas a conferir</strong><p>Não foi possível conferir a espécie das vendas e a composição de ICMS dos documentos. Reimporte as saídas e confira as UFs.</p></section>';
  for(const month of months){
    const species=month?.salesSpecies,icms=month?.icmsOperations,sales=icms?.sales,returns=icms?.salesReturns;
    const values=[species?.nfceLines,species?.nfceBaseCents,species?.missingLines,
      sales?.internalBaseCents,sales?.internalTaxCents,sales?.interstateBaseCents,sales?.interstateTaxCents,
      returns?.totalBaseCents,returns?.taxCents,sales?.pendingLines,returns?.pendingLines];
    if(species?.version!=='SALES_SPECIES_V1'||icms?.version!=='ICMS_OPERATIONS_V1'||
      icms.internalRatePercent!==18||icms.interstateRatePercent!==12||!values.every(safe))return unavailable;
    const keys=['nfceLines','nfceBaseCents','missingLines','internalBase','internalTax',
      'interstateBase','interstateTax','returnBase','returnTax'];
    keys.forEach((key,index)=>{totals[key]+=values[index];});
    totals.pendingLines+=sales.pendingLines+returns.pendingLines;
    // O simulador limita o débito a zero por competência, antes de somar os meses.
    totals.debit+=Math.max(0,sales.internalTaxCents+sales.interstateTaxCents-returns.taxCents);
    if(!Object.values(totals).every(safe))return unavailable;
  }
  const notice=totals.missingLines?`${number(totals.missingLines)} venda(s) sem espécie na coluna D. Reimporte o relatório de saídas para identificar todas as NFC-e.`:
    totals.pendingLines?`${number(totals.pendingLines)} operação(ões) sem UF confirmada. Confira a UF da empresa e dos documentos.`:'';
  const facts=`<p>Vendas NFC-e identificadas: <strong>${number(totals.nfceLines)} linhas · ${money(totals.nfceBaseCents)}</strong>. Elas são tratadas como internas, mesmo que a UF do cliente seja diferente.</p>`;
  if(notice)return `<section class="analysis-icms-audit is-warning" role="status" data-analysis-icms-audit="pending"><strong>ICMS das vendas a conferir</strong>${facts}<p>${notice}</p></section>`;
  return `<section class="analysis-icms-audit" data-analysis-icms-audit="ready" aria-label="Conferência de ICMS das vendas"><h3>Conferência de ICMS das vendas</h3>${facts}
    <dl><div><dt>Vendas internas · 18%</dt><dd>Base ${money(totals.internalBase)} · ICMS ${money(totals.internalTax)}</dd></div>
    <div><dt>Vendas interestaduais · 12%</dt><dd>Base ${money(totals.interstateBase)} · ICMS ${money(totals.interstateTax)}</dd></div>
    <div><dt>Devoluções de vendas</dt><dd>Base ${money(totals.returnBase)} · redução ${money(totals.returnTax)}</dd></div>
    <div class="analysis-icms-debit"><dt>Débito de ICMS após devoluções</dt><dd>${money(totals.debit)}</dd></div></dl>
    <p>Valores dos documentos, antes dos créditos de compras e de ajustes manuais. O ICMS é arredondado por linha e o débito não fica negativo em cada competência.</p></section>`;
}
