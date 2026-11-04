/** Show the captured IRPJ components; never recalculate or rewrite a saved tax. */
export function withIrpjBreakdown(presentation,captured) {
  const labels={
    irpj:'IRPJ total (normal + adicional)',
    irpjBasic:'− IRPJ normal (15% da base)',
    irpjAdditional:'− Adicional de IRPJ (10% do excedente)'
  };
  const descriptions={
    irpj:'IRPJ total = IRPJ normal + adicional. As linhas de composição já estão incluídas neste total; não somar novamente.',
    irpjBasic:'IRPJ normal: 15% da base tributável. Esta parcela não é o adicional de IRPJ.',
    irpjAdditional:'Adicional: 10% somente sobre a parcela positiva da base acima do limite do período. No modelo mensal, o limite equivale a R$ 20.000 por competência; o consolidado soma os adicionais mensais, sem fechamento trimestral.'
  };
  const explain=row=>labels[row.key]?{...row,label:labels[row.key],
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
  return rows;
}
