/** Show the captured IRPJ components; never recalculate or rewrite a saved tax. */
const IRPJ_ROWS=new Set(['irpj','irpjBasic','irpjAdditional','irpjTaxBase','irpjAdditionalLimit',
  'irpjBaseWithinLimit','irpjExcessBase','irpjNormalAssessed','irpjAdditionalAssessed','irpjTotalAssessed',
  'irpjPreviousProvision','irpjCurrentMovement']);
const INCLUDED_IN_DAS='IRPJ incluído no DAS; sem parcela externa neste regime.';

/** The selected frame changes the wording, never the captured amount. */
export function irpjRowLabel(row,presentation,monthly=false){
  if(presentation?.irpjReconciliation?.version!=='IRPJ_RECONCILIATION_V2')return row.label;
  const labels={
    irpj:'IRPJ do período (provisão/ajuste)',
    irpjBasic:'IRPJ normal · movimento do período',
    irpjAdditional:'Adicional de IRPJ · movimento do período',
    irpjTaxBase:monthly?'Base do IRPJ acumulada':'Base do IRPJ · soma dos períodos',
    irpjNormalAssessed:monthly?'IRPJ normal acumulado · 15% da base':'IRPJ normal · 15% por trimestre',
    irpjAdditionalAssessed:monthly?'Adicional acumulado · 10% do excedente':'Adicional de IRPJ · 10% por trimestre',
    irpjTotalAssessed:monthly?'IRPJ acumulado até a competência':'IRPJ total dos períodos',
    irpjCurrentMovement:monthly?'Movimento de IRPJ no mês':'IRPJ reconhecido na DRE'
  };
  return labels[row.key]||row.label;
}

/** A zero outside the DAS is not an unavailable calculation or a second tax. */
export function irpjIncludedInDas(presentation,row,column) {
  if(!IRPJ_ROWS.has(row?.key)||!['pure','hybrid'].includes(column?.id))return false;
  const regime=presentation?.regimes?.find(item=>item.id===column.id);
  const available=column.mode==='month'&&Array.isArray(regime?.monthlyAvailability)?
    regime.monthlyAvailability[column.month]===true:regime?.available===true;
  if(!available)return false;
  const total=(presentation?.sections||[]).flatMap(section=>section.rows||[]).find(item=>item.key==='irpj');
  const value=column.mode==='month'?total?.monthlyValues?.[column.id]?.[column.month]:
    column.mode==='calendarAnnual'?total?.calendarAnnualValues?.[column.id]:total?.values?.[column.id];
  // A valid zero alone cannot hide missing or conflicting period evidence.
  // The assessment supplies the explicit DAS reason only after validating the frame.
  const evidence=row.key==='irpj'?
    (presentation.irpjReconciliation?.rows?.find(item=>item.key==='irpjTotalAssessed')??
      presentation.details?.flatMap(group=>group.rows||[]).find(item=>item.key==='irpjAdditional')):row;
  const reason=column.mode==='month'?evidence?.monthlyReasonByRegime?.[column.id]?.[column.month]:
    (column.mode==='calendarAnnual'?evidence?.calendarReasonByRegime:evidence?.reasonByRegime)?.[column.id];
  return value===0&&reason===INCLUDED_IN_DAS;
}

export function withIrpjBreakdown(presentation,captured) {
  const quarterly=presentation?.irpjReconciliation?.version==='IRPJ_RECONCILIATION_V2';
  const labels={
    irpj:'IRPJ total (normal + adicional)',
    irpjBasic:'IRPJ normal (15% da base)',
    irpjAdditional:'Adicional de IRPJ (10% do excedente)'
  };
  const descriptions={
    irpj:quarterly?'Movimento de IRPJ = provisão acumulada − provisão anterior. Normal e adicional detalham esse movimento; não somar novamente. Reversão de provisão não é restituição automática.':'IRPJ total = IRPJ normal + adicional. As linhas de composição já estão incluídas neste total; não somar novamente.',
    irpjBasic:quarterly?'Movimento da parcela normal: diferença entre as provisões acumuladas de 15%. A base e o imposto acumulados estão na memória do IRPJ.':'IRPJ normal: 15% da base tributável. Esta parcela não é o adicional de IRPJ.',
    irpjAdditional:quarterly?'Movimento do adicional: diferença entre as provisões acumuladas de 10% sobre o excedente ao limite trimestral. Pode haver reversão; não é 10% da base isolada do mês.':'Adicional: 10% somente sobre a parcela positiva da base acima do limite do período. No modelo mensal, o limite equivale a R$ 20.000 por competência; o consolidado soma os adicionais mensais, sem fechamento trimestral.'
  };
  const explain=row=>labels[row.key]?{...row,label:quarterly?irpjRowLabel(row,presentation):labels[row.key],
    notes:[...new Set([...(Array.isArray(row.notes)?row.notes:[]),descriptions[row.key]])]}:row;
  if(presentation?.statement?.version!=='DRE_STATEMENT_V1')return captured.map(explain);
  const components=['irpjBasic','irpjAdditional'].map(key=>captured.find(row=>row.key===key)).filter(Boolean);
  const rows=[],seen=new Set();
  const append=row=>{
    if(!row||typeof row.key!=='string'||seen.has(row.key))return;
    seen.add(row.key);rows.push(explain(row));
  };
  for(const row of presentation.statement.sections.flatMap(section=>section.rows||[])){
    append(row);
    // Details retain the reconciled values/reasons from the saved presentation.
    // Missing components are not fabricated as zero. Total taxes stay unchanged.
    if(row.key==='irpj')for(const component of components)append({...component,kind:'detail',informative:true});
  }
  for(const row of presentation.revenueReconciliation?.rows||[])append(row);
  for(const row of presentation.icmsReconciliation?.rows||[])append(row);
  for(const row of presentation.irpjReconciliation?.rows||[])append(row);
  return rows;
}
