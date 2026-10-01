/** Display calendar only: the reviewed tax engine is not run again for each month. */
export const CALENDAR_VERSION = 'DRE_CALENDAR_V1';
export const MONTH_NAMES = Object.freeze(['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']);
export const DRE_ROWS = Object.freeze([['services','Receita de serviços'],['sales','Receita de vendas'],['revenue','Receita bruta total'],['das','− DAS'],['cbsDebit','− Débito de CBS'],['ibsDebit','− Débito de IBS'],['icmsNet','− ICMS líquido fora do DAS'],['iss','− ISS fora do DAS'],['netRevenue','Receita líquida'],['cmvSimple','− Compras do Simples'],['cmvRegular','− Compras fora do Simples'],['cmv','CMV total'],['cbsUsed','+ Crédito CBS utilizado'],['ibsUsed','+ Crédito IBS utilizado'],['grossProfit','Lucro bruto'],['salaries','− Salários e pró-labore'],['benefits','− Benefícios'],['payroll','− Encargos adicionais'],['personnel','Pessoal e encargos'],['administrative','− Outras despesas'],['rent','− Aluguel'],['cards','− Taxas de cartão'],['preTax','Resultado antes de IRPJ/CSLL'],['irpj','− IRPJ e adicional'],['csll','− CSLL'],['netProfit','Resultado líquido']]);
export function buildMonthlyDre(result, year, reference=null, reportPeriod=null) {
  if (!Number.isInteger(year) || year<2000 || year>2100 || !Array.isArray(result?.regimes)) throw new Error('Calendário da DRE inválido.');
  const months=MONTH_NAMES.map((label,i)=>({number:i+1,label,period:`${year}-${String(i+1).padStart(2,'0')}`}));
  const rbt12=reference?.sourceSection==='2.2'&&reference?.parserVersion==='SIMPLES_SECTION_22_V2' ? {
    sourceSection:'2.2',parserVersion:reference.parserVersion,id:reference.id||reference.extractionId,
    pa:reference.pa,rbt12Cents:reference.rbt12Cents,basis:reference.rbt12Basis
  }:null;
  return {version:CALENDAR_VERSION,year,unit:'BRL',method:'AVERAGE_X12_FIXED_STATEMENT_RBT12',
    reportPeriod,rbt12Reference:rbt12,months,
    rounding:'Valores completos preservados. Exibição com duas casas; somas de células exibidas podem diferir por centavos do total anual.',
    regimes:result.regimes.map(regime=>({id:regime.id,name:regime.name,available:regime.available,
      rows:DRE_ROWS.map(([key,label])=>{
        const annual=regime.available?regime.dre[key]:null;
        if(annual!==null&&(!Number.isFinite(annual)))throw new Error('A DRE possui um valor não confirmado.');
        return {key,label,annual,months:months.map(()=>annual===null?null:annual/12)};
      })}))};
}
