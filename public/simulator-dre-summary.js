import {unifiedDreRows} from './simulator-dre.js';

/** Read the exact table frame. Never use the tax engine or repair saved values here. */
export function readDreValue(row, {id,mode,month}) {
  const value=mode==='month'?row?.monthlyValues?.[id]?.[month]:mode==='calendarAnnual'?row?.calendarAnnualValues?.[id]:row?.values?.[id];
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}

export function buildDreSummary(presentation,column) {
  const rows=unifiedDreRows(presentation),get=key=>readDreValue(rows.find(row=>row.key===key),column);
  const movements=[
    ['revenue','Receita utilizada','revenue'],
    ['revenueDeductions','Tributos sobre a receita','deduction'],
    ['cmvNetCredits','Compras e custos após créditos','deduction'],
    ['operatingExpenses','Despesas operacionais','deduction'],
    ['incomeTaxes','IRPJ e CSLL','deduction'],
    ['netProfit','Resultado líquido','result']
  ].map(([key,label,kind])=>({key,label,kind,value:get(key)}));
  const complete=movements.every(row=>row.value!==null);
  const expected=complete?movements.slice(0,-1).reduce((sum,row)=>sum+row.value,0):null;
  const result=get('netProfit');
  const reconciled=complete&&Math.abs(expected-result)<=Math.max(1e-7,16*Number.EPSILON*Math.max(Math.abs(expected),Math.abs(result)));
  return {revenue:get('revenue'),result,margin:get('netMargin'),
    deductions:reconciled?-movements.slice(1,-1).reduce((sum,row)=>sum+row.value,0):null,
    movements,reconciled,complete};
}

/** A short comparison, using only reconciled cells of the complete DRE. */
export function buildDreExecutiveSummary(presentation,column) {
  const rows=unifiedDreRows(presentation),get=key=>readDreValue(rows.find(row=>row.key===key),column);
  const summary=buildDreSummary(presentation,column);
  return {...summary,taxes:get('totalTaxes'),creditsApplied:readDreValue(presentation.appliedCredits,column),
    rows:[
      ['revenueSourceGross','Receita bruta','composition'],
      ['revenueSalesReturns','− Devoluções de vendas','composition'],
      ['revenueManualAdjustment','Ajustes da receita (+/−)','composition'],
      ['revenue','Receita considerada','subtotal'],
      ['revenueDeductions','− Impostos sobre a receita','line'],
      ['netRevenue','Receita líquida','subtotal'],
      ['cmvNetCredits','− Compras líquidas de créditos','line'],
      ['operatingExpenses','− Despesas operacionais','line'],
      ['incomeTaxes','− IRPJ e CSLL','line'],
      ['netProfit','Resultado · lucro ou prejuízo','result']
    ].map(([key,label,kind])=>({key,label,kind,value:get(key),row:rows.find(row=>row.key===key)}))};
}

const evolutionMetrics = [
  ['revenue','Receita utilizada','currency'],
  ['netProfit','Resultado líquido','currency'],
  ['netMargin','Margem líquida','percent'],
  ['difal','DIFAL estimado','currency']
];
const monthOrdinal = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')
  ? Number(value.slice(0,4))*12+Number(value.slice(5,7)) : null;

/** Compare saved cells only. Missing months and legacy averages never become a trend. */
export function buildDreEvolution(presentation,calendar,regimeId,selectedMonth=0) {
  const actual=presentation?.method==='REPORT_MONTHS_V1'&&((calendar?.version==='DRE_CALENDAR_V3'&&calendar?.months?.length===12)||(calendar?.version==='DRE_CALENDAR_V4'&&presentation.analysisPeriod?.version==='JAN_SEP_V1'&&calendar?.months?.length>0&&calendar.months.length===presentation.analysisPeriod.includedMonths?.length));
  if(!actual)return {available:false,reason:'Esta simulação usa a projeção mensal salva. A evolução exige valores individuais por competência.',months:[],metrics:[]};
  const rows=unifiedDreRows(presentation),regime=presentation.regimes.find(item=>item.id===regimeId);
  const months=calendar.months.map((month,index)=>{
    const sourceMonth=monthOrdinal(month.sourceMonth)!==null?month.sourceMonth:null;
    const available=Array.isArray(regime?.monthlyAvailability)?regime.monthlyAvailability[index]===true:regime?.available===true;
    const values=Object.fromEntries(evolutionMetrics.map(([key])=>[key,sourceMonth&&available?readDreValue(rows.find(row=>row.key===key),{id:regimeId,mode:'month',month:index}):null]));
    return {label:month.label,sourceMonth,available,...values};
  });
  const index=Number.isInteger(selectedMonth)&&selectedMonth>=0&&selectedMonth<months.length?selectedMonth:0;
  const current=months[index],previous=index>0?months[index-1]:null;
  const reason=!current.sourceMonth?'Sem dados importados para o mês selecionado.':
    !current.available?'Este regime está indisponível na competência selecionada.':
    !previous?'O mês anterior está fora deste calendário.':
    !previous.sourceMonth?'O mês imediatamente anterior não tem dados importados.':
    !previous.available?'Este regime está indisponível na competência anterior.':
    monthOrdinal(current.sourceMonth)-monthOrdinal(previous.sourceMonth)!==1?'As competências de origem não são consecutivas.':'';
  const metrics=evolutionMetrics.filter(([key])=>key!=='difal'||rows.some(row=>row.key===key)).map(([key,label,unit])=>{
    // DIFAL is shown as an amount deducted; the original signed DRE cell stays untouched.
    const normalize=value=>value===null?null:value===0?0:key==='difal'?-value:value;
    const value=normalize(current[key]),base=normalize(previous?.[key]??null);
    const delta=!reason&&value!==null&&base!==null?value-base:null;
    const change=delta!==null&&Math.abs(delta)<1e-9?0:delta;
    return {key,label,unit,value,previous:base,change,
      ratio:unit==='currency'&&change!==null&&base>0?change/base:null,
      reason:reason|| (change===null?'Valor não disponível nos dois meses.':'')};
  });
  return {available:true,months,current,previous,metrics,reason,
    importedCount:months.filter(month=>month.sourceMonth).length};
}
