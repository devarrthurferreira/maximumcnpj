import test from 'node:test';
import assert from 'node:assert/strict';
import {drePdfFixture} from './fixtures/dre-pdf.mjs';
import {buildAnalysisPeriod} from '../public/analysis-period.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,capturedDreRows,unifiedDreRows,dreReportMemory} from '../public/simulator-dre.js';
import {buildDreSummary,readDreValue} from '../public/simulator-dre-summary.js';
import {buildDreCsv,buildDreExportPayload} from '../public/simulator-dre-export.js';
import {filterDreVisibleRegimes} from '../public/simulator-dre-visibility.js';

const near=(actual,expected)=>assert(Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(1e-7,Math.abs(expected)*1e-12),`${actual} != ${expected}`);
const sum=values=>values.reduce((total,value)=>total+value,0);
const presentation=snapshot=>buildDrePresentation({...snapshot,calendar:snapshot.monthlyDre});
const find=(p,key)=>unifiedDreRows(p).find(row=>row.key===key);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

test('DRE atual apresenta tributos apurados e preserva todos os componentes capturados para conferência',()=>{
  const snapshot=drePdfFixture(),before=structuredClone(snapshot);freeze(snapshot);
  const p=presentation(snapshot),rows=unifiedDreRows(p),keys=rows.map(row=>row.key);
  assert.equal(p.statement.version,'DRE_STATEMENT_V1');
  assert.deepEqual(p.statement.sections[0].rows.map(row=>row.label),['Receita de serviços','Receita de vendas utilizada','Receita Total utilizada']);
  assert.deepEqual(p.statement.sections.find(section=>section.key==='taxes').rows.map(row=>row.key),
    ['das','icmsNet','cbsIbsNet','irpj','csll','icmsAnticipation','difal','payroll','iss','totalTaxes','taxBurden']);
  assert.deepEqual(p.statement.sections.at(-1).rows.map(row=>row.key),['netProfit','netMargin']);
  assert.equal(new Set(keys).size,keys.length);
  for(const key of ['cbsDebit','ibsDebit','cbsUsed','ibsUsed','cbs.debit','ibs.debit'])assert(!keys.includes(key),key);
  for(const key of ['cbsDebit','ibsDebit','cbsUsed','ibsUsed'])assert(capturedDreRows(p).some(row=>row.key===key),key);
  near(p.statement.taxRates.cbs,.113);near(p.statement.taxRates.ibs,.001);near(p.statement.taxRates.combined,.114);
  assert.equal(p.statement.taxRates.monthly.length,9);
  assert.deepEqual(snapshot,before);
});

test('impostos, despesas e resultado fecham uma única vez no consolidado e em cada competência',()=>{
  for(const variant of ['complete','partial','loss','purchases-above-revenue']){
    const snapshot=drePdfFixture({variant}),p=presentation(snapshot);
    for(const regime of p.regimes)for(const month of [null,...p.months.map((_,index)=>index)]){
      const column={id:regime.id,mode:month===null?'annual':'month',...(month===null?{}:{month})};
      const captured=month===null?snapshot.result.regimes.find(row=>row.id===regime.id):snapshot.result.monthlyResults[month].result.regimes.find(row=>row.id===regime.id);
      const value=key=>readDreValue(find(p,key),column),d=captured.dre;
      near(value('cbsIbsNet'),d.cbsDebit+d.ibsDebit+d.cbsUsed+d.ibsUsed);
      near(value('operatingExpensesBeforePayroll'),d.salaries+d.benefits+d.administrative+d.rent+d.cards);
      const taxComponents=p.statement.sections.find(section=>section.key==='taxes').rows.filter(row=>!['totalTaxes','taxBurden'].includes(row.key));
      near(-sum(taxComponents.map(row=>readDreValue(row,column))),captured.totalTaxes);
      near(value('totalTaxes'),captured.totalTaxes);
      near(value('revenue')+value('cmv')+value('operatingExpensesBeforePayroll')-value('totalTaxes'),d.netProfit);
      near(value('netProfit'),d.netProfit);near(value('taxBurden'),captured.totalTaxes/d.revenue);near(value('netMargin'),d.netProfit/d.revenue);
      assert.equal(buildDreSummary(p,column).reconciled,true);
      assert.equal(find(p,'taxBurden').unit,'percent');assert.equal(find(p,'netMargin').unit,'percent');
    }
  }
});

test('CBS/IBS consolida apuração mensal sem compensar crédito excedente entre competências',()=>{
  const imported={startMonth:'2026-01',endMonth:'2026-02',months:2},analysisPeriod=buildAnalysisPeriod(imported,imported);
  const reports=[1,2].map(month=>({sourceMonth:`2026-0${month}`,month,salesLines:1,purchaseLines:month===1?1:0,
    fields:{salesOptantCents:0,salesNonOptantCents:1000000,salesCpfCents:0,serviceRevenueCents:0,purchasesOptantCents:0,purchasesNonOptantCents:month===1?2000000:0}}));
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:180000,values:{salesRevenue:0,serviceRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const calculated=calculateMonthlySimulation(draft,reports,reports.map(row=>baselineMonth(row)),'synthetic-credit-period',null,analysisPeriod);
  const p=buildDrePresentation({...calculated,calendar:buildMonthlyDre(calculated.result,2027),source:{monthlyReports:reports}});
  for(const id of ['hybrid','presumed','actual']){
    const row=find(p,'cbsIbsNet');near(row.monthlyValues[id][0],0);near(row.monthlyValues[id][1],-1140);near(row.values[id],-1140);
    const unusedFirstMonth=calculated.result.monthlyResults[0].result.credits;
    assert(unusedFirstMonth.cbs.balance+unusedFirstMonth.ibs.balance>0);
  }
  assert.equal(find(p,'cbsIbsNet').values.pure,0);
});

test('receita zero ou negativa mantém valores e deixa percentuais indisponíveis; ausência não vira zero',()=>{
  for(const variant of ['zero','negative-revenue','without-rbt12']){
    const snapshot=drePdfFixture({variant}),p=presentation(snapshot);
    for(const regime of p.regimes){
      const original=snapshot.result.regimes.find(row=>row.id===regime.id);
      if(!original.available){
        for(const key of ['cbsIbsNet','operatingExpensesBeforePayroll','totalTaxes','taxBurden','netProfit','netMargin']){
          assert.equal(find(p,key).values[regime.id],null,key);assert(find(p,key).monthlyValues[regime.id].every(value=>value===null),key);
        }
      }else{
        near(find(p,'netProfit').values[regime.id],original.dre.netProfit);
        if(original.dre.revenue<=0){assert.equal(find(p,'taxBurden').values[regime.id],null);assert.equal(find(p,'netMargin').values[regime.id],null);}
      }
    }
  }
  const snapshot=drePdfFixture();delete snapshot.result.regimes.find(row=>row.id==='actual').dre.cbsUsed;
  const p=presentation(snapshot);assert.equal(find(p,'cbsIbsNet').values.actual,null);assert.equal(find(p,'totalTaxes').values.actual,null);
  assert(Number.isFinite(find(p,'cbsIbsNet').monthlyValues.actual[0]),'Uma ausência consolidada não apaga uma competência completa.');
});

test('alíquota composta depende somente de captura válida e homogênea, nunca de fallback para taxa atual',()=>{
  const withoutRates=drePdfFixture();
  for(const entry of withoutRates.result.monthlyResults){
    delete entry.engineInput.rates.cbs;entry.result.memory=entry.result.memory.filter(item=>item.id!=='rate.cbs');
  }
  const missing=presentation(withoutRates).statement.taxRates;
  assert.equal(missing.cbs,null);near(missing.ibs,.001);assert.equal(missing.combined,null);
  assert(missing.monthly.every(row=>row.cbs===null&&row.combined===null));
  for(const mode of ['different','invalid','duplicate']){
    const snapshot=drePdfFixture(),entry=snapshot.result.monthlyResults[0],rate=entry.result.memory.find(item=>item.id==='rate.cbs');
    if(mode==='different')rate.value=.08;
    if(mode==='invalid')rate.unit='currency';
    if(mode==='duplicate')entry.result.memory.push({...rate});
    const rates=presentation(snapshot).statement.taxRates;
    assert.equal(rates.cbs,null);assert.equal(rates.combined,null);assert.equal(rates.monthly[0].combined,null);
    near(rates.monthly[1].combined,.114);
  }
});

test('CSV exporta os regimes visíveis e mantém os percentuais essenciais sem AV opcional',()=>{
  const snapshot=drePdfFixture(),p=presentation(snapshot),before=structuredClone(p);freeze(p);
  const csv=buildDreCsv({presentation:p,period:'complete',visibleRegimeIds:['actual','pure'],showPercent:false});
  const header=csv.split('\r\n').find(line=>line.startsWith('"Escopo";'));
  assert.match(header,/"Simples Puro";"Lucro Real"/);assert.doesNotMatch(header,/Lucro Presumido|Simples Híbrido/);
  const monthly=csv.split('\r\n').filter(line=>line.includes(';"CBS/IBS (D − C) apurado";'));
  assert.equal(monthly.length,3,'Uma linha consolidada e uma para cada regime nos meses.');
  assert.match(csv,/CBS 11,30% \+ IBS 0,10% = CBS\/IBS 11,40%/);
  assert.match(csv,/"% sobre a receita · tributos";"indicator";"%"/);
  assert.match(csv,/"% sobre a receita · resultado";"indicator";"%"/);
  const memory=dreReportMemory(filterDreVisibleRegimes(p,['actual']),{includeDre:true});
  assert(!memory.some(item=>/^(?:presumed\.|dre\.pure\.|summary\.hybrid\.)/.test(item.id)));
  const exported=buildDreExportPayload(snapshot,p);assert.equal(exported.result,snapshot.result);assert.equal(exported.result.regimes.length,4);
  assert.deepEqual(p,before);
});
