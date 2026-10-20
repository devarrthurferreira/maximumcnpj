import {collection, scope} from './store.ts';
import {need} from './security.ts';
import {exactCents, exactSignedCents, financialReportingStatus, SALES_MODE, PURCHASE_MODE, reportPeriod} from './purchase-domain.ts';
import {summarizeDifal, salesOperation} from './difal.ts';
import {sameReportCompetences} from './report-competence.ts';
import {MONTHLY_FIELDS, type MonthlyReport} from '../public/simulator-monthly.js';

/** Read only reconciled server snapshots; classification remains the lookup captured in the job. */
export async function monthlyReportSource(purchases: any, sales: any, currentSalesRows?: any[], issuerUf?: string): Promise<MonthlyReport[] | null> {
  const read = async (summary: any) => {
    const [rows, items] = await Promise.all([
      (await collection('purchaseLines')).find(scope({jobId:summary.job._id})).sort({index:1}).maxTimeMS(20000).toArray(),
      (await collection('lookupItems')).find(scope({jobId:summary.job._id})).project({cnpj:1,status:1}).maxTimeMS(20000).toArray()
    ]);
    need(rows.length === summary.totals.lines && rows.every((row,index)=>row.index===index), 'Linhas mensais incompletas. Reimporte o relatório.',409,'SIMULATION_MONTHS');
    need(exactSignedCents(rows.reduce((total,row)=>exactSignedCents(total+(row.balanceCents??row.totalCents)),0))===summary.totals.totalCents,
      'O total mensal diverge do relatório conciliado.',409,'SIMULATION_MONTHS');
    return {rows,statuses:new Map(items.map(item=>[item.cnpj,item.status]))};
  };
  const [p,s]=await Promise.all([read(purchases),read(sales)]);
  if([...p.rows,...s.rows].some(row=>!row.serviceDate))return null;
  const pp=reportPeriod(p.rows.map(row=>row.serviceDate)),sp=reportPeriod(s.rows.map(row=>row.serviceDate));
  if(!pp||!sp)return null;
  need(sameReportCompetences(pp,sp),'Compras e vendas precisam cobrir as mesmas competências.',409,'SIMULATOR_PERIOD');
  const [year,month]=pp.startMonth.split('-').map(Number);
  const months: MonthlyReport[]=Array.from({length:pp.months},(_,index)=>{
    const date=new Date(Date.UTC(year,month-1+index,1));
    return {sourceMonth:date.toISOString().slice(0,7),month:date.getUTCMonth()+1,
      fields:Object.fromEntries(MONTHLY_FIELDS.map(key=>[key,0])) as MonthlyReport['fields'],
      salesLines:0,purchaseLines:0,difal:null};
  });
  const byMonth=new Map(months.map(row=>[row.sourceMonth,row]));
  const salesByMonth=new Map<string,any[]>();
  for(const [data,mode] of [[p,PURCHASE_MODE],[s,SALES_MODE]] as const){
    const rows=mode===SALES_MODE&&currentSalesRows?currentSalesRows:data.rows;
    for(const row of rows){
      const target=byMonth.get(row.serviceDate?.slice(0,7));
      need(target,'Linha sem competência válida na coluna H. Reimporte o relatório.',409,'SIMULATION_MONTHS');
      const status=row.valid?data.statuses.get(row.cnpj):undefined;
      need(!row.valid||['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO'].includes(status),'Enquadramento mensal não conciliado.',409,'SIMULATION_MONTHS');
      const group=financialReportingStatus({...row,status},mode);
      if(mode===SALES_MODE){
        const field=row.operation==='SERVICO'?'serviceRevenueCents':group==='CPF'?'salesCpfCents':group==='OPTANTE'?'salesOptantCents':'salesNonOptantCents';
        target.fields[field]=exactSignedCents(target.fields[field]+(row.balanceCents??row.totalCents));target.salesLines++;
        const list=salesByMonth.get(target.sourceMonth)||[];list.push(row);salesByMonth.set(target.sourceMonth,list);
      }else{
        const field=group==='OPTANTE'?'purchasesOptantCents':'purchasesNonOptantCents';
        target.fields[field]=exactCents(target.fields[field]+row.totalCents);target.purchaseLines++;
      }
    }
  }
  // A missing legacy DIFAL contract stays unavailable; never invent a confirmed zero.
  if(sales.difal||currentSalesRows)for(const month of months)month.difal=summarizeDifal((salesByMonth.get(month.sourceMonth)||[]).map(row=>({...row,operation:salesOperation(row.natureCode,row.description)})),issuerUf??sales.job.issuerUf);
  return months;
}
