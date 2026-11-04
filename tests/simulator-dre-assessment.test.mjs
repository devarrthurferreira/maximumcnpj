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
const tax=(p,key)=>p.taxStatement.rows.find(row=>row.key===key);
const taxComponentKeys=['das','icmsNet','cbsIbsNet','irpj','csll','icmsAnticipation','difal','payroll','iss'];
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

test('DRE separa o quadro Impostos e preserva todos os componentes capturados para conferência',()=>{
  const snapshot=drePdfFixture(),before=structuredClone(snapshot);freeze(snapshot);
  const p=presentation(snapshot),rows=unifiedDreRows(p),keys=rows.map(row=>row.key);
  assert.equal(p.statement.version,'DRE_STATEMENT_V1');
  assert.equal(p.taxStatement.version,'DRE_TAX_STATEMENT_V1');assert.equal(p.taxStatement.label,'Impostos');
  assert.deepEqual(p.statement.sections.map(section=>section.key),['revenue','costs','expenses','profit']);
  assert.deepEqual(p.statement.sections[0].rows.slice(0,3).map(row=>row.label),['Receita de serviços','Receita de vendas utilizada','Receita Total utilizada']);
  assert.deepEqual(p.taxStatement.rows.map(row=>row.key),[...taxComponentKeys,'totalTaxes','taxBurden','netProfit','netMargin']);
  assert.deepEqual(p.taxStatement.rows.map(row=>row.label),['Simples','ICMS (D − C)','CBS/IBS (D − C)','IRPJ','CSLL','Antecipação','DIFAL','INSS','ISS fora do DAS','Total','% sobre a receita','Resultado','% sobre a receita']);
  assert.deepEqual(p.statement.sections.at(-1).rows.map(row=>row.key),['resultBeforeIncomeTaxes','irpj','csll','taxesDeduction','netProfit','netMargin']);
  assert.equal(new Set(keys).size,keys.length);
  for(const key of ['totalTaxes','taxBurden','cbsDebit','ibsDebit','cbs.debit','ibs.debit'])assert(!keys.includes(key),key);
  for(const key of ['das','icmsNet','cbsIbsNet','irpj','csll','icmsAnticipation','difal','payroll','revenueTaxes','netRevenueAfterTaxes','resultBeforeIncomeTaxes'])assert(keys.includes(key),key);
  for(const key of ['cbsDebit','ibsDebit','cbsUsed','ibsUsed'])assert(capturedDreRows(p).some(row=>row.key===key),key);
  near(p.taxStatement.taxRates.cbs,.113);near(p.taxStatement.taxRates.ibs,.001);near(p.taxStatement.taxRates.combined,.114);
  assert.equal(p.taxStatement.taxRates.monthly.length,9);
  assert.deepEqual(snapshot,before);
});

test('DRE distribui impostos sem duplicar o total nos regimes e períodos',()=>{
  for(const variant of ['complete','partial','loss','purchases-above-revenue']){
    const snapshot=drePdfFixture({variant}),before=structuredClone(snapshot),p=presentation(snapshot);
    const groups=p.statement.sections;
    assert.deepEqual(groups.map(section=>section.key),['revenue','costs','expenses','profit']);
    for(const [section,key] of [['revenue','cbsIbsNet'],['costs','icmsAnticipation'],['expenses','payroll'],['profit','irpj']])
      assert(groups.find(group=>group.key===section).rows.some(row=>row.key===key));
    assert(groups.at(-1).rows.find(row=>row.key==='taxesDeduction').informative);
    for(const regime of p.regimes)for(const frame of [{mode:'annual'},{mode:'calendarAnnual'},...p.months.map((_,month)=>({mode:'month',month}))]){
      const column={id:regime.id,...frame},get=key=>readDreValue(find(p,key),column),due=key=>readDreValue(tax(p,key),column);
      if(get('netProfit')===null)continue;
      near(get('revenueTaxes'),-(due('das')+due('icmsNet')+due('cbsIbsNet')+due('iss')+due('difal')));
      near(get('netRevenueAfterTaxes'),get('revenue')+get('revenueTaxes'));
      near(get('costsWithAnticipation'),get('cmv')-due('icmsAnticipation'));
      near(get('grossAfterCosts'),get('netRevenueAfterTaxes')+get('costsWithAnticipation'));
      near(get('operatingExpensesWithPayroll'),get('operatingExpensesBeforePayroll')-due('payroll'));
      near(get('resultBeforeIncomeTaxes'),get('grossAfterCosts')+get('operatingExpensesWithPayroll'));
      near(get('netProfit'),get('resultBeforeIncomeTaxes')-due('irpj')-due('csll'));
      near(get('taxesDeduction'),-due('totalTaxes'));
      near(due('totalTaxes'),due('das')+due('icmsNet')+due('cbsIbsNet')+due('iss')+due('difal')+
        due('icmsAnticipation')+due('payroll')+due('irpj')+due('csll'));
    }
    assert.deepEqual(snapshot,before);
  }
});

test('impostos, despesas e resultado fecham uma única vez no consolidado e em cada competência',()=>{
  for(const variant of ['complete','partial','loss','purchases-above-revenue']){
    const snapshot=drePdfFixture({variant}),p=presentation(snapshot);
    for(const regime of p.regimes)for(const frame of [{mode:'annual'},{mode:'calendarAnnual'},...p.months.map((_,month)=>({mode:'month',month}))]){
      const column={id:regime.id,...frame};
      const captured=frame.mode==='month'?snapshot.result.monthlyResults[frame.month].result.regimes.find(row=>row.id===regime.id):snapshot.result.regimes.find(row=>row.id===regime.id);
      const value=key=>readDreValue(find(p,key),column),assessed=key=>readDreValue(tax(p,key),column),d=captured.dre;
      near(assessed('cbsIbsNet'),-(d.cbsDebit+d.ibsDebit+d.cbsUsed+d.ibsUsed));
      near(value('operatingExpensesBeforePayroll'),d.salaries+d.benefits+d.administrative+d.rent+d.cards);
      const taxComponents=p.taxStatement.rows.filter(row=>taxComponentKeys.includes(row.key));
      near(sum(taxComponents.map(row=>readDreValue(row,column))),captured.totalTaxes);
      near(assessed('totalTaxes'),captured.totalTaxes);near(value('taxesDeduction'),-captured.totalTaxes);
      near(value('revenue')+value('cmv')+value('operatingExpensesBeforePayroll')+value('taxesDeduction'),d.netProfit);
      near(value('netProfit'),d.netProfit);near(assessed('netProfit'),d.netProfit);
      near(assessed('taxBurden'),captured.totalTaxes/d.revenue);near(assessed('netMargin'),d.netProfit/d.revenue);near(value('netMargin'),d.netProfit/d.revenue);
      assert.equal(buildDreSummary(p,column).reconciled,true);
      assert.equal(tax(p,'taxBurden').unit,'percent');assert.equal(tax(p,'netMargin').unit,'percent');
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
    const row=tax(p,'cbsIbsNet');near(row.monthlyValues[id][0],0);near(row.monthlyValues[id][1],1140);near(row.values[id],1140);
    const unusedFirstMonth=calculated.result.monthlyResults[0].result.credits;
    assert(unusedFirstMonth.cbs.balance+unusedFirstMonth.ibs.balance>0);
  }
  assert.equal(tax(p,'cbsIbsNet').values.pure,0);
});

test('receita zero ou negativa mantém valores e deixa percentuais indisponíveis; ausência não vira zero',()=>{
  for(const variant of ['zero','negative-revenue','without-rbt12']){
    const snapshot=drePdfFixture({variant}),p=presentation(snapshot);
    for(const regime of p.regimes){
      const original=snapshot.result.regimes.find(row=>row.id===regime.id);
      if(!original.available){
        for(const row of [...p.taxStatement.rows,find(p,'operatingExpensesBeforePayroll'),find(p,'taxesDeduction'),find(p,'netProfit'),find(p,'netMargin')]){
          assert.equal(row.values[regime.id],null,row.key);assert(row.monthlyValues[regime.id].every(value=>value===null),row.key);
        }
      }else{
        near(find(p,'netProfit').values[regime.id],original.dre.netProfit);
        if(original.dre.revenue<=0){assert.equal(tax(p,'taxBurden').values[regime.id],null);assert.equal(tax(p,'netMargin').values[regime.id],null);assert.equal(find(p,'netMargin').values[regime.id],null);}
      }
    }
  }
  const snapshot=drePdfFixture();delete snapshot.result.regimes.find(row=>row.id==='actual').dre.cbsUsed;
  const p=presentation(snapshot);assert.equal(tax(p,'cbsIbsNet').values.actual,null);assert.equal(tax(p,'totalTaxes').values.actual,null);assert.equal(find(p,'taxesDeduction').values.actual,null);
  assert(tax(p,'cbsIbsNet').reasonByRegime.actual);assert(find(p,'taxesDeduction').reasonByRegime.actual);
  assert(Number.isFinite(tax(p,'cbsIbsNet').monthlyValues.actual[0]),'Uma ausência consolidada não apaga uma competência completa.');
});

test('Impostos inverte somente os componentes devidos e conserva percentuais, razões e células indisponíveis em todos os períodos',()=>{
  for(const variant of ['complete','zero','without-rbt12']){
    const p=presentation(drePdfFixture({variant})),captured=capturedDreRows(p);
    const pairs=taxComponentKeys.filter(key=>key!=='cbsIbsNet'&&tax(p,key)).map(key=>[tax(p,key),captured.find(row=>row.key===key)]);
    pairs.push([find(p,'taxesDeduction'),tax(p,'totalTaxes')]);
    for(const [shown,original] of pairs){
      for(const field of ['values','calendarAnnualValues','percentValues','calendarAnnualPercentValues'])for(const regime of p.regimes){
        const before=original[field][regime.id],after=shown[field][regime.id];
        assert.equal(after,before===null?null:before===0?0:-before,`${shown.key}.${field}.${regime.id}`);
      }
      for(const field of ['monthlyValues','monthlyPercentValues'])for(const regime of p.regimes){
        assert.deepEqual(shown[field][regime.id],original[field][regime.id].map(value=>value===null?null:value===0?0:-value),`${shown.key}.${field}.${regime.id}`);
      }
      for(const field of ['reasonByRegime','calendarReasonByRegime','monthlyReasonByRegime'])assert.deepEqual(shown[field],original[field],`${shown.key}.${field}`);
    }
    for(const key of ['totalTaxes','taxBurden','netProfit','netMargin']){
      const original=captured.find(row=>row.key===key);
      for(const field of ['values','calendarAnnualValues','monthlyValues','percentValues','calendarAnnualPercentValues','monthlyPercentValues'])assert.deepEqual(tax(p,key)[field],original[field],`${key}.${field}`);
    }
  }
});

test('estorno trimestral permanece negativo em Impostos e reverte uma única dedução na DRE mensal',()=>{
  const imported={startMonth:'2026-01',endMonth:'2026-02',months:2},analysisPeriod=buildAnalysisPeriod(imported,imported);
  const reports=[100000,1000].map((sales,index)=>({sourceMonth:`2026-0${index+1}`,month:index+1,salesLines:1,purchaseLines:0,
    fields:{salesOptantCents:0,salesNonOptantCents:sales*100,salesCpfCents:0,serviceRevenueCents:0,purchasesOptantCents:0,purchasesNonOptantCents:0}}));
  const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:180000,values:{salesRevenue:0,serviceRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const calculated=calculateMonthlySimulation(draft,reports,reports.map((row,index)=>baselineMonth(row,{rent:index===1?100000:0})),'synthetic-quarter-reversal',null,analysisPeriod);
  const p=buildDrePresentation({...calculated,calendar:buildMonthlyDre(calculated.result,2027),source:{monthlyReports:reports}});
  const column={id:'actual',mode:'month',month:1},value=key=>readDreValue(find(p,key),column),assessed=key=>readDreValue(tax(p,key),column);
  assert.equal(assessed('irpj'),-11650);assert.equal(assessed('csll'),-6354);
  assert.equal(assessed('totalTaxes'),-17710);assert.equal(value('taxesDeduction'),17710);
  near(assessed('taxBurden'),-17.71);near(find(p,'taxesDeduction').monthlyPercentValues.actual[1],17.71);
  near(sum(p.taxStatement.rows.filter(row=>taxComponentKeys.includes(row.key)).map(row=>readDreValue(row,column))),assessed('totalTaxes'));
  near(value('revenue')+value('cmv')+value('operatingExpensesBeforePayroll')+value('taxesDeduction'),value('netProfit'));
  assert.equal(value('netProfit'),-81290);assert.equal(assessed('netProfit'),value('netProfit'));
  near(tax(p,'totalTaxes').values.actual,29694);near(find(p,'netProfit').values.actual,-28694);
  for(const key of ['irpj','csll','totalTaxes'])near(tax(p,key).values.actual,sum(tax(p,key).monthlyValues.actual));
  assert.equal(buildDreSummary(p,column).reconciled,true);
});

test('ISS fora do DAS permanece quando aplicado ou pendente e some somente quando zero está confirmado',()=>{
  assert(tax(presentation(drePdfFixture()),'iss'));
  assert.equal(tax(presentation(drePdfFixture({variant:'zero'})),'iss'),undefined);
  const missing=drePdfFixture({variant:'zero'});delete missing.result.monthlyResults[0].result.regimes.find(regime=>regime.id==='actual').dre.iss;
  missing.monthlyDre.regimes.find(regime=>regime.id==='actual').rows.find(row=>row.key==='iss').months[0]=null;
  const pending=presentation(missing),iss=tax(pending,'iss');
  assert(iss,'Uma competência sem confirmação exige a linha de ISS.');
  assert.equal(iss.monthlyValues.actual[0],null);assert(iss.monthlyReasonByRegime.actual[0]);
  assert.equal(tax(pending,'totalTaxes').monthlyValues.actual[0],null);assert.equal(find(pending,'taxesDeduction').monthlyValues.actual[0],null);
  assert.equal(iss.monthlyValues.actual[1],0);
  const missingAnnual=drePdfFixture({variant:'zero'});
  missingAnnual.monthlyDre.regimes.find(regime=>regime.id==='actual').rows.find(row=>row.key==='iss').annual=null;
  const annualPending=presentation(missingAnnual),annualIss=tax(annualPending,'iss');
  assert(annualIss,'A coluna de total do calendário também precisa explicar seu ISS pendente.');
  assert.equal(annualIss.calendarAnnualValues.actual,null);assert(annualIss.calendarReasonByRegime.actual);
  assert.equal(tax(annualPending,'totalTaxes').calendarAnnualValues.actual,null);assert.equal(find(annualPending,'taxesDeduction').calendarAnnualValues.actual,null);
  assert.equal(annualIss.values.actual,0);assert(annualIss.monthlyValues.actual.every(value=>value===0));
});

test('oito impostos permanecem na lista quando Antecipação ou DIFAL não foram capturados',()=>{
  const snapshot=drePdfFixture({variant:'zero'});
  for(const key of ['icmsAnticipation','difal']){
    for(const regime of snapshot.result.regimes)delete regime.dre[key];
    for(const month of snapshot.result.monthlyResults)for(const regime of month.result.regimes)delete regime.dre[key];
    for(const regime of snapshot.monthlyDre.regimes)regime.rows=regime.rows.filter(row=>row.key!==key);
  }
  const before=structuredClone(snapshot),p=presentation(snapshot);
  assert.deepEqual(p.taxStatement.rows.slice(0,8).map(row=>row.key),taxComponentKeys.slice(0,8));
  for(const key of ['icmsAnticipation','difal'])for(const regime of p.regimes){
    const row=tax(p,key);
    for(const field of ['values','calendarAnnualValues','percentValues','calendarAnnualPercentValues'])assert.equal(row[field][regime.id],null);
    for(const field of ['monthlyValues','monthlyPercentValues'])assert(row[field][regime.id].every(value=>value===null));
    assert(row.reasonByRegime[regime.id]);assert(row.notes.some(note=>note.includes('não representa zero confirmado')));
  }
  for(const regime of p.regimes){
    const captured=snapshot.result.regimes.find(item=>item.id===regime.id);
    assert.equal(tax(p,'totalTaxes').values[regime.id],captured.totalTaxes);near(captured.totalTaxes,0);
    assert.equal(find(p,'netProfit').values[regime.id],captured.dre.netProfit);near(captured.dre.netProfit,0);
  }
  assert.deepEqual(snapshot,before);
});

test('alíquota composta depende somente de captura válida e homogênea, nunca de fallback para taxa atual',()=>{
  const withoutRates=drePdfFixture();
  for(const entry of withoutRates.result.monthlyResults){
    delete entry.engineInput.rates.cbs;entry.result.memory=entry.result.memory.filter(item=>item.id!=='rate.cbs');
  }
  const missing=presentation(withoutRates).taxStatement.taxRates;
  assert.equal(missing.cbs,null);near(missing.ibs,.001);assert.equal(missing.combined,null);
  assert(missing.monthly.every(row=>row.cbs===null&&row.combined===null));
  for(const mode of ['different','invalid','duplicate']){
    const snapshot=drePdfFixture(),entry=snapshot.result.monthlyResults[0],rate=entry.result.memory.find(item=>item.id==='rate.cbs');
    if(mode==='different')rate.value=.08;
    if(mode==='invalid')rate.unit='currency';
    if(mode==='duplicate')entry.result.memory.push({...rate});
    const rates=presentation(snapshot).taxStatement.taxRates;
    assert.equal(rates.cbs,null);assert.equal(rates.combined,null);assert.equal(rates.monthly[0].combined,null);
    near(rates.monthly[1].combined,.114);
  }
});

test('CSV exporta os regimes visíveis e mantém os percentuais essenciais sem AV opcional',()=>{
  const snapshot=drePdfFixture(),p=presentation(snapshot),before=structuredClone(p);freeze(p);
  const csv=buildDreCsv({presentation:p,period:'complete',visibleRegimeIds:['actual','pure'],showPercent:false});
  const header=csv.split('\r\n').find(line=>line.startsWith('"Escopo";'));
  assert.match(header,/"Simples Puro";"Lucro Real"/);assert.doesNotMatch(header,/Lucro Presumido|Simples Híbrido/);
  const monthly=csv.split('\r\n').filter(line=>line.includes('"Impostos";"Impostos";"CBS/IBS (D − C)";'));
  assert.equal(monthly.length,3,'Uma linha consolidada e uma para cada regime nos meses.');
  assert(monthly[0].startsWith('"Impostos";'));assert(monthly[1].startsWith('"Simples Puro";'));assert(monthly[2].startsWith('"Lucro Real";'));
  assert(!csv.split('\r\n').some(line=>line.startsWith('"DRE";')&&line.includes('"CBS/IBS (D − C)";')));
  assert.equal(csv.split('\r\n').filter(line=>line.startsWith('"DRE";"IRPJ, CSLL e resultado";"(−) Total de impostos";"detail";')).length,1);
  assert.match(csv,/CBS 11,30% \+ IBS 0,10% = CBS\/IBS 11,40%/);
  assert.equal(csv.split('\r\n').filter(line=>line.startsWith('"Impostos";"Impostos";"% sobre a receita";"indicator";"%";')).length,2);
  assert.match(csv,/"% sobre a receita · resultado";"indicator";"%"/);
  const visible=filterDreVisibleRegimes(p,['actual']);assert.equal(visible.taxStatement,p.taxStatement);assert.deepEqual(visible.regimes.map(row=>row.id),['actual']);
  const memory=dreReportMemory(filterDreVisibleRegimes(p,['actual']),{includeDre:true});
  assert(!memory.some(item=>/^(?:presumed\.|dre\.pure\.|summary\.hybrid\.)/.test(item.id)));
  const exported=buildDreExportPayload(snapshot,p);assert.equal(exported.result,snapshot.result);assert.equal(exported.result.regimes.length,4);
  assert.deepEqual(p,before);
});
