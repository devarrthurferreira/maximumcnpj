export const JAN_SEP_POLICY='JAN_SEP_V1';
export const JAN_SEP_MODEL_VERSION='1.11.0-jan-sep';

const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
export function analysisMonthsForYear(sourceYear){
  check(Number.isInteger(sourceYear)&&sourceYear>=2000&&sourceYear<=2099,'O ano dos relatórios deve estar entre 2000 e 2099.');
  return Array.from({length:9},(_,index)=>`${sourceYear}-${String(index+1).padStart(2,'0')}`);
}
export function isAnalysisMonth(sourceMonth,sourceYear){
  return typeof sourceMonth==='string'&&/^20\d{2}-0[1-9]$/.test(sourceMonth)&&
    (sourceYear===undefined||Number(sourceMonth.slice(0,4))===sourceYear);
}
/** A zero movement is supported only inside a reconciled report's own date range. */
export function reportMonthsInPeriod(period){
  check(period&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.startMonth)&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.endMonth),
    'Os relatórios precisam conservar o período da coluna H para selecionar janeiro a setembro.');
  const [year,month]=period.startMonth.split('-').map(Number),[endYear,endMonth]=period.endMonth.split('-').map(Number);
  const count=(endYear-year)*12+endMonth-month+1;
  check(count>=1&&count<=12&&count===period.months,'O intervalo original dos relatórios é inválido.');
  return Array.from({length:count},(_,index)=>new Date(Date.UTC(year,month-1+index,1)).toISOString().slice(0,7));
}
export function buildAnalysisPeriod(purchasesPeriod,salesPeriod){
  const purchases=reportMonthsInPeriod(purchasesPeriod),sales=reportMonthsInPeriod(salesPeriod);
  const all=[...new Set([...purchases,...sales])].sort(),purchased=new Set(purchases),sold=new Set(sales);
  const years=[...new Set(all.map(month=>Number(month.slice(0,4))))];
  const completeYears=years.filter(year=>analysisMonthsForYear(year).every(month=>purchased.has(month)&&sold.has(month)));
  check(years.length===1||completeYears.length===1,
    'Os relatórios abrangem anos diferentes sem uma única janela completa de janeiro a setembro. Importe os dois relatórios do mesmo ano.');
  const sourceYear=completeYears[0]??years[0],expectedMonths=analysisMonthsForYear(sourceYear),expected=new Set(expectedMonths);
  const includedMonths=expectedMonths.filter(month=>purchased.has(month)&&sold.has(month));
  const missingMonths=expectedMonths.filter(month=>!purchased.has(month)||!sold.has(month));
  return {version:JAN_SEP_POLICY,sourceYear,startMonth:expectedMonths[0],endMonth:expectedMonths[8],months:9,
    expectedMonths,includedMonths,excludedMonths:all.filter(month=>!expected.has(month)),missingMonths,complete:missingMonths.length===0};
}
export function assertCompleteAnalysisPeriod(period,reports){
  check(period?.version===JAN_SEP_POLICY,'A análise precisa identificar o período fixo de janeiro a setembro.');
  const expected=analysisMonthsForYear(period.sourceYear);
  check(period.months===9&&period.startMonth===expected[0]&&period.endMonth===expected[8]&&
    JSON.stringify(period.expectedMonths)===JSON.stringify(expected),'O período fixo da análise é inválido.');
  check(period.complete===true&&Array.isArray(period.missingMonths)&&period.missingMonths.length===0&&
    JSON.stringify(period.includedMonths)===JSON.stringify(expected),
    `Complete a cobertura de entradas e saídas de janeiro a setembro. Faltam: ${(period.missingMonths||expected).join(', ')}.`);
  check(Array.isArray(period.excludedMonths)&&new Set(period.excludedMonths).size===period.excludedMonths.length&&
    period.excludedMonths.every(month=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)&&!expected.includes(month)),
    'As competências excluídas da análise são inválidas.');
  if(reports!==undefined)check(Array.isArray(reports)&&JSON.stringify(reports.map(row=>row.sourceMonth))===JSON.stringify(expected),
    'O cálculo deve conter exatamente janeiro a setembro do ano de origem.');
  return period;
}
