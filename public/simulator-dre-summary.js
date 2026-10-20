import {unifiedDreRows} from './simulator-dre.js';

/** Read the exact table frame. Never use the tax engine or repair saved values here. */
export function readDreValue(row, {id,mode,month}) {
  const value=mode==='month'?row?.monthlyValues?.[id]?.[month]:mode==='calendarAnnual'?row?.calendarAnnualValues?.[id]:row?.values?.[id];
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}

export function buildDreSummary(presentation,column) {
  const rows=unifiedDreRows(presentation),get=key=>readDreValue(rows.find(row=>row.key===key),column);
  const movements=[
    ['revenue','Receita bruta','revenue'],
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
