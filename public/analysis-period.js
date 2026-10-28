export const JAN_SEP_POLICY='JAN_SEP_V1';
export const JAN_SEP_MODEL_VERSION='1.12.0-available-months';

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
  return {version:JAN_SEP_POLICY,sourceYear,startMonth:includedMonths[0]||expectedMonths[0],endMonth:includedMonths.at(-1)||expectedMonths[8],months:includedMonths.length,
    expectedMonths,includedMonths,excludedMonths:all.filter(month=>!expected.has(month)),missingMonths,complete:includedMonths.length>0};
}
/** Restrict the calculation to explicitly usable months, retaining source coverage for audit. */
export function selectAnalysisPeriod(period,sourceMonths){
  assertCompleteAnalysisPeriod(period);
  check(Array.isArray(sourceMonths)&&sourceMonths.length>=1&&sourceMonths.length<=9&&
    new Set(sourceMonths).size===sourceMonths.length&&sourceMonths.every(month=>period.includedMonths.includes(month)),
    'Selecione somente competências disponíveis entre janeiro e setembro.');
  const includedMonths=[...sourceMonths].sort();
  if(JSON.stringify(includedMonths)===JSON.stringify(period.includedMonths))return structuredClone(period);
  return {...structuredClone(period),availableMonths:[...(period.availableMonths||period.includedMonths)],includedMonths,
    startMonth:includedMonths[0],endMonth:includedMonths.at(-1),months:includedMonths.length,
    missingMonths:period.expectedMonths.filter(month=>!includedMonths.includes(month)),complete:true};
}
export function assertCompleteAnalysisPeriod(period,reports){
  check(period?.version===JAN_SEP_POLICY,'A análise precisa identificar a janela de janeiro a setembro.');
  const expected=analysisMonthsForYear(period.sourceYear),included=period.includedMonths;
  check(JSON.stringify(period.expectedMonths)===JSON.stringify(expected),'A janela da análise é inválida.');
  check(Array.isArray(included)&&included.length>=1&&included.length<=9&&new Set(included).size===included.length&&
    included.every((month,index)=>expected.includes(month)&&(!index||month>included[index-1]))&&
    period.months===included.length&&period.startMonth===included[0]&&period.endMonth===included.at(-1)&&period.complete===true,
    'A análise precisa de pelo menos uma competência confirmada entre janeiro a setembro.');
  check(JSON.stringify(period.missingMonths)===JSON.stringify(expected.filter(month=>!included.includes(month))),
    'A lista de competências não incluídas diverge do período da análise.');
  check(period.availableMonths===undefined||(Array.isArray(period.availableMonths)&&new Set(period.availableMonths).size===period.availableMonths.length&&
    period.availableMonths.every((month,index)=>expected.includes(month)&&(!index||month>period.availableMonths[index-1]))&&included.every(month=>period.availableMonths.includes(month))),
    'A cobertura original da análise é inválida.');
  check(Array.isArray(period.excludedMonths)&&new Set(period.excludedMonths).size===period.excludedMonths.length&&
    period.excludedMonths.every(month=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)&&!expected.includes(month)),
    'As competências excluídas da análise são inválidas.');
  if(reports!==undefined)check(Array.isArray(reports)&&JSON.stringify(reports.map(row=>row.sourceMonth))===JSON.stringify(included),
    'O cálculo deve conter exatamente as competências incluídas entre janeiro a setembro do ano de origem.');
  return period;
}
