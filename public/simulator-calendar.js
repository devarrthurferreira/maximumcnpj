/** Display only: reads captured annual or per-competence results without running the tax engine. */
export const CALENDAR_VERSION = 'DRE_CALENDAR_V2';
export const MONTH_NAMES = Object.freeze(['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']);
export const DRE_ROWS = Object.freeze([['services','Receita de serviços'],['sales','Receita de vendas'],['revenue','Receita bruta total'],['das','− DAS'],['cbsDebit','− Débito de CBS'],['ibsDebit','− Débito de IBS'],['icmsNet','− ICMS líquido fora do DAS'],['iss','− ISS fora do DAS'],['difal','− DIFAL estimado (10%)'],['netRevenue','Receita líquida'],['cmvSimple','− Compras do Simples'],['cmvRegular','− Compras fora do Simples'],['cmv','CMV total'],['cbsUsed','+ Crédito CBS utilizado'],['ibsUsed','+ Crédito IBS utilizado'],['grossProfit','Lucro bruto'],['salaries','− Salários e pró-labore'],['benefits','− Benefícios'],['payroll','− Encargos adicionais'],['personnel','Pessoal e encargos'],['administrative','− Outras despesas'],['rent','− Aluguel'],['cards','− Taxas de cartão'],['preTax','Resultado antes de IRPJ/CSLL'],['irpj','− IRPJ e adicional'],['csll','− CSLL'],['netProfit','Resultado líquido']]);
/** Saved results predating the DIFAL contract must never gain a fabricated zero row. */
export function dreRows(result) {
  const hasDifal = result?.regimes?.some(regime => regime.dre && Object.hasOwn(regime.dre, 'difal'));
  return hasDifal ? DRE_ROWS : DRE_ROWS.filter(([key]) => key !== 'difal');
}
export function buildMonthlyDre(result, year, reference=null, reportPeriod=null) {
  if (!Number.isInteger(year) || year<2000 || year>2100 || !Array.isArray(result?.regimes)) throw new Error('Calendário da DRE inválido.');
  const months=MONTH_NAMES.map((label,i)=>({number:i+1,label,period:`${year}-${String(i+1).padStart(2,'0')}`}));
  const manual=reference?.source==='MANUAL'&&reference?.confirmed===true&&Number.isSafeInteger(reference?.rbt12Cents)&&reference.rbt12Cents>=0&&reference.rbt12Cents<=100_000_000_000_000;
  const rbt12=manual ? {source:'MANUAL',rbt12Cents:reference.rbt12Cents} : reference?.sourceSection==='2.2'&&reference?.parserVersion==='SIMPLES_SECTION_22_V2' ? {
    sourceSection:'2.2',parserVersion:reference.parserVersion,id:reference.id||reference.extractionId,
    pa:reference.pa,rbt12Cents:reference.rbt12Cents,basis:reference.rbt12Basis
  }:null;
  const rows = dreRows(result);
  return {version:result.method==='REPORT_MONTHS_V1'?'DRE_CALENDAR_V3':rows === DRE_ROWS ? CALENDAR_VERSION : 'DRE_CALENDAR_V1',year,unit:'BRL',method:result.method==='REPORT_MONTHS_V1'?'REPORT_MONTHS_FIXED_RBT12':manual?'AVERAGE_X12_FIXED_MANUAL_RBT12':'AVERAGE_X12_FIXED_STATEMENT_RBT12',
    reportPeriod,rbt12Reference:rbt12,months:months.map(month=>({...month,...(result.method==='REPORT_MONTHS_V1'?{sourceMonth:result.monthlyResults.find(row=>row.month===month.number)?.sourceMonth||null}:{} )})),
    rounding:'Valores completos preservados. Exibição com duas casas; somas de células exibidas podem diferir por centavos do total anual.',
    regimes:result.regimes.map(regime=>({id:regime.id,name:regime.name,available:regime.available,
      rows:rows.map(([key,label])=>{
        const annual=regime.available?regime.dre[key]:null;
        if(annual!==null&&(!Number.isFinite(annual)))throw new Error('A DRE possui um valor não confirmado.');
        return {key,label,annual,months:months.map(month=>{
          if(result.method!=='REPORT_MONTHS_V1')return annual===null?null:annual/12;
          const entry=result.monthlyResults.find(row=>row.month===month.number)?.result.regimes.find(row=>row.id===regime.id);
          return entry?.available?entry.dre[key]:null;
        })};
      })}))};
}
