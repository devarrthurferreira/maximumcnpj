import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDreSummary,buildDreEvolution} from '../public/simulator-dre-summary.js';
import {buildDrePresentation,unifiedDreRows,DRE_PRESENTATION_VERSION,dreDifalNotes} from '../public/simulator-dre.js';
import {calculateSimulation,calculateTax,draftToInput,defaultDifalPolicy} from '../public/simulator-engine.js';
import {annualizeReports,projectDifal} from '../public/simulator-projection.js';
import {buildMonthlyDre,dreRows} from '../public/simulator-calendar.js';
import {renderAnnualDre,renderCompleteMonthlyDre,renderDrePrintDocument} from '../public/simulator-dre-view.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildDreCsv} from '../public/simulator-dre-export.js';

const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const allRows=p=>[...p.sections.flatMap(section=>section.rows),...p.details.flatMap(section=>section.rows),...p.indicators];
const find=(p,key)=>allRows(p).find(row=>row.key===key);
function fixture(){
 const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:180000,values:{salesRevenue:12000,serviceRevenue:3000,simplePurchases:1000,regularPurchases:2000,salaries:300,benefits:10,adminExpenses:200,rent:100,cardExpenses:50}};
 const monthlyGroups={salesOptantCents:1000,salesNonOptantCents:3000,salesCpfCents:8000,purchasesOptantCents:1000,purchasesNonOptantCents:2000};
 const source={revenueSplit:{version:'SALES_SERVICES_V1'},fields:{salesOptantCents:300000,salesNonOptantCents:900000,salesCpfCents:2400000,purchasesOptantCents:300000,purchasesNonOptantCents:600000,serviceRevenueCents:600000}};
 const projection=annualizeReports(source.fields,3),difal=projectDifal({version:'DIFAL_ESTIMATE_V1',ratePercent:10,issuerUf:'MG',eligibleLines:3,baseCents:9000,amountCents:900,pendingLines:0},3,'synthetic-report');
 const result=calculateSimulation(draft,difal),engineInput=draftToInput(draft,difal);
 return {draft,result,engineInput,monthlyGroups,source,projection,reportMonths:3};
}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('apresentação preserva linhas e resultados, sem mutar entradas ou recalcular tributos',()=>{
 const input=fixture(),before=structuredClone(input);freeze(input);
 const p=buildDrePresentation(input);assert.equal(p.version,DRE_PRESENTATION_VERSION);assert.equal(p.sections.length,5);
 for(const r of input.result.regimes)for(const [key] of dreRows(input.result)){
  assert.equal(find(p,key).values[r.id],r.dre[key]);near(find(p,key).monthlyValues[r.id][0],r.dre[key]/12);
 }
 for(const row of allRows(p)){assert.equal(row.monthlyValues.actual.length,12);assert(Array.isArray(row.notes));assert(Array.isArray(row.sourceRefs));}
 assert.deepEqual(input,before);
});

test('DRE concilia antecipação de ICMS separada do DIFAL em anual, meses, subtotais e carga',()=>{
 const input=fixture(),baseline=structuredClone(input.result),projection={version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200,annualCents:878400};
 input.result=calculateSimulation(input.draft,{version:'DIFAL_DRE_V1',monthlyCents:300,annualCents:3600,sourceAmountCents:900,reportMonths:3,pendingLines:0},projection);
 input.calendar=buildMonthlyDre(input.result,2027);const before=structuredClone(input),p=buildDrePresentation(input);
 assert.equal(find(p,'icmsAnticipation').label,'− Antecipação de ICMS');assert.equal(find(p,'difal').label,'− DIFAL sobre vendas (10%)');
 for(const regime of input.result.regimes){
  const amount=['pure','hybrid'].includes(regime.id)?-8784:0;
  assert.equal(find(p,'icmsAnticipation').values[regime.id],amount);
  assert(find(p,'icmsAnticipation').monthlyValues[regime.id].every(value=>value===amount/12));
  near(find(p,'revenueDeductions').values[regime.id],regime.dre.netRevenue-regime.dre.revenue);
  near(find(p,'totalTaxes').values[regime.id],regime.totalTaxes);
  near(find(p,'totalTaxes').monthlyValues[regime.id][0],regime.totalTaxes/12);
  assert.equal(buildDreSummary(p,{id:regime.id,mode:'annual'}).reconciled,true);
 }
 assert.deepEqual(input,before);assert.equal(find(buildDrePresentation({result:baseline}),'icmsAnticipation'),undefined);
});

test('escolha de DIFAL e bloqueio ficam visíveis na DRE, CSV e impressão sem reinterpretar históricos',()=>{
 const input=fixture();input.draft.difalPolicy=defaultDifalPolicy();input.draft.difalPolicy.enabled.actual=false;
 input.draft.rbt12=3600000;
 input.result=calculateSimulation(input.draft,{version:'DIFAL_DRE_V1',monthlyCents:10000,annualCents:120000},
  {version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:73200,annualCents:878400});
 input.calendar=buildMonthlyDre(input.result,2027);
 const before=structuredClone(input);freeze(input);const p=buildDrePresentation(input);
 assert.deepEqual(p.difalPolicy,input.result.difalPolicy);assert.notEqual(p.difalPolicy,input.result.difalPolicy);
 assert.deepEqual(find(p,'difal').values,{pure:0,hybrid:0,presumed:-1200,actual:0});
 assert.equal(find(p,'icmsAnticipation').values.pure,0);
 const notes=dreDifalNotes(p);assert.equal(notes.length,4);
 assert.match(notes[0],/DIFAL: incluir.*Zerado automaticamente.*3.600.000/);
 assert.match(notes[3],/DIFAL: excluir.*escolha do usuário/);
 for(const output of [buildDreCsv({presentation:p}),renderAnnualDre({presentation:p,calendar:input.calendar,year:2027}),renderDrePrintDocument({presentation:p,calendar:input.calendar,year:2027})]){
  assert.match(output,/DIFAL nos cenários/);assert.match(output,/Zerado automaticamente/);assert.match(output,/escolha do usuário/);
 }
 assert.deepEqual(input,before);
 const legacy=structuredClone(input.result);delete legacy.difalPolicy;for(const regime of legacy.regimes)delete regime.difalApplication;
 const original=JSON.stringify(legacy),old=buildDrePresentation({result:legacy});
 assert.equal(Object.hasOwn(old,'difalPolicy'),false);assert.deepEqual(dreDifalNotes(old),[]);
 assert(!buildDreCsv({presentation:old}).includes('DIFAL nos cenários'));
 assert(!renderDrePrintDocument({presentation:old,year:2027}).includes('DIFAL nos cenários'));
 assert.equal(find(old,'difal').values.presumed,-1200);assert.equal(JSON.stringify(legacy),original);
});

test('DRE e impressão distinguem RBT12 por competência da referência fixa legada',()=>{
 const input=fixture(),calendar=buildMonthlyDre(input.result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:18000000});
 const fixed=buildDrePresentation({...input,calendar});
 assert.match(renderAnnualDre({presentation:fixed,calendar,year:2027}),/RBT12 fixa: R\$ 180.000,00/);
 calendar.version='DRE_CALENDAR_V3';calendar.method='REPORT_MONTHS_ROLLING_RBT12';
 calendar.rbt12Schedule={version:'RBT12_MONTHLY_SECTION_22_V1',source:'SIMPLES_SECTION_22',sourceSection:'2.2',pa:'02/2025',complete:true,rows:[
  {sourceMonth:'2025-01',status:'CONFIRMED',rbt12Cents:18000000,startMonth:'2024-01',endMonth:'2024-12',missingMonths:[],window:[]},
  {sourceMonth:'2025-02',status:'CONFIRMED',rbt12Cents:19000000,startMonth:'2024-02',endMonth:'2025-01',missingMonths:[],window:[]}]};
 calendar.months[0]={...calendar.months[0],sourceMonth:'2025-01',rbt12Cents:18000000};
 calendar.months[1]={...calendar.months[1],sourceMonth:'2025-02',rbt12Cents:19000000};
 const before=structuredClone(calendar),p=buildDrePresentation({...input,calendar});
 assert.deepEqual(p.rbt12Schedule,calendar.rbt12Schedule);assert.notEqual(p.rbt12Schedule,calendar.rbt12Schedule);
 assert.equal(p.months[1].rbt12Cents,19000000);
 for(const html of [renderAnnualDre({presentation:p,calendar,year:2027}),renderDrePrintDocument({presentation:p,calendar,year:2027,period:'monthly'})]){
  assert.match(html,/RBT12 por competência/);assert.match(html,/2025-01: R\$ 180.000,00/);assert.match(html,/2025-02: R\$ 190.000,00/);assert(!html.includes('RBT12 fixa'));
 }
 const monthly=renderCompleteMonthlyDre({presentation:p,calendar,year:2027,month:1});
 assert.match(monthly,/2025-02: R\$ 190.000,00 · receitas de 2024-02 a 2025-01/);assert.match(monthly,/12 meses anteriores do quadro 2.2/);assert(!monthly.includes('RBT12 permanece fixa'));
 assert.deepEqual(calendar,before);
});

test('mês Simples disponível continua consultável quando outra competência impede o total anual',()=>{
 const {draft}=fixture(),reports=[1,2].map(month=>({month,sourceMonth:`2025-0${month}`,salesLines:1,purchaseLines:1,
  fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:1_000_000,serviceRevenueCents:0,purchasesOptantCents:100_000,purchasesNonOptantCents:0},
  difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:10000,baseCents:100000,eligibleLines:1,pendingLines:0},
  anticipation:{version:'ICMS_ANTICIPATION_V1',ratePercent:7.32,issuerUf:'MG',amountCents:7320,baseCents:100000,eligibleLines:1,pendingLines:0}}));
 const schedule={version:'RBT12_MONTHLY_SECTION_22_V1',source:'SIMPLES_SECTION_22',sourceSection:'2.2',pa:'02/2026',complete:true,
  rows:reports.map((row,index)=>({sourceMonth:row.sourceMonth,status:'CONFIRMED',rbt12Cents:index?360000001:18000000,startMonth:`2024-0${index+1}`,endMonth:index?'2025-01':'2024-12',missingMonths:[],window:[]}))};
 const out=calculateMonthlySimulation(draft,reports,reports.map(row=>baselineMonth(row)),'source',schedule),calendar=buildMonthlyDre(out.result,2027),source={monthlyReports:reports};
 const input={result:out.result,calendar,source},before=structuredClone(input),p=buildDrePresentation(input);
 const notes=dreDifalNotes(p);assert.match(notes[0],/2025-01: Incluído:.*2025-02: Zerado automaticamente/);
 const januaryNotes=dreDifalNotes(p,{sourceMonth:'2025-01'});assert(!januaryNotes[0].includes('Zerado automaticamente'));
 assert.match(dreDifalNotes(p,{sourceMonth:'2025-02'})[0],/Zerado automaticamente/);
 assert.match(dreDifalNotes(p,{sourceMonth:'2025-03'})[0],/Sem decisão registrada/);
 assert.notEqual(p.regimes[0].difalApplication,input.result.regimes[0].difalApplication);
 const captured=out.result.monthlyResults[0].result.regimes.find(row=>row.id==='pure');
 assert.equal(out.result.regimes[0].available,false);assert.equal(calendar.regimes[0].available,false);
 assert.equal(calendar.regimes[0].rows.find(row=>row.key==='netProfit').annual,null);
 assert.equal(calendar.regimes[0].rows.find(row=>row.key==='netProfit').months[0],captured.dre.netProfit);
 assert.deepEqual(p.regimes[0].monthlyAvailability,[true,...Array(11).fill(false)]);
 for(const key of ['revenue','netRevenue','icmsAnticipation','netProfit','totalTaxes']){
  const row=find(p,key);assert.equal(row.values.pure,null,key);assert.equal(row.calendarAnnualValues.pure,null,key);
  near(row.monthlyValues.pure[0],key==='totalTaxes'?captured.totalTaxes:captured.dre[key]);assert(row.monthlyValues.pure.slice(1).every(value=>value===null));
 }
 assert.equal(buildDreSummary(p,{id:'pure',mode:'month',month:0}).reconciled,true);
 assert.equal(buildDreSummary(p,{id:'pure',mode:'annual'}).result,null);
 assert.equal(buildDreSummary(p,{id:'pure',mode:'month',month:1}).result,null);
 assert.equal(buildDreEvolution(p,calendar,'pure',0).months[0].netProfit,captured.dre.netProfit);
 assert.match(buildDreEvolution(p,calendar,'pure',1).reason,/indisponível na competência selecionada/);
 const monthly=renderCompleteMonthlyDre({presentation:p,calendar,year:2027,regimeId:'pure',month:0});
 assert.match(monthly,/<option value="pure" selected>Simples Puro<\/option>/);
 const expanded=renderCompleteMonthlyDre({presentation:p,calendar,year:2027,regimeId:'pure',month:0,monthView:false});
 assert(expanded.includes('data-dre-row="icmsAnticipation"'));assert.match(expanded,/>-R\$ 73,20<|>R\$ -73,20<|>R\$\s*73,20</);
 assert.match(renderAnnualDre({presentation:p,calendar,year:2027,regimeId:'pure'}),/Simples Puro · total anual indisponível/);
 const csv=buildDreCsv({presentation:p,period:'monthly'}),row=csv.split('\r\n').find(line=>line.startsWith('"Simples Puro"')&&line.includes('"Resultado líquido"')).split(';');
 assert.equal(row[6],captured.dre.netProfit.toLocaleString('pt-BR',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2}));assert.equal(row[7],'"Não disponível"');assert.equal(row[18],'"Não disponível"');
 const noCalendar=buildDrePresentation({result:out.result,source});assert.equal(find(noCalendar,'netProfit').monthlyValues.pure[0],captured.dre.netProfit);
 const invalidCalendar=buildDrePresentation({...input,calendar:{...calendar,version:'UNKNOWN'}});assert(find(invalidCalendar,'netProfit').monthlyValues.pure.every(value=>value===null));
 const missingRegime=structuredClone(out.result);missingRegime.monthlyResults[0].result.regimes=missingRegime.monthlyResults[0].result.regimes.filter(row=>row.id!=='pure');
 assert.equal(find(buildDrePresentation({result:missingRegime,calendar,source}),'netProfit').monthlyValues.pure[0],null);
 assert.deepEqual(input,before);
});

test('subtotais conciliam uma única vez CMV, pessoal, créditos, DIFAL e tributos sobre o lucro',()=>{
 const input=fixture(),p=buildDrePresentation(input);
 for(const r of input.result.regimes){const d=r.dre;
  near(find(p,'revenueDeductions').values[r.id],d.netRevenue-d.revenue);
  near(find(p,'cmvNetCredits').values[r.id],d.cmv+d.cbsUsed+d.ibsUsed);
  near(find(p,'operatingExpenses').values[r.id],d.personnel+d.administrative+d.rent+d.cards);
  near(find(p,'incomeTaxes').values[r.id],d.irpj+d.csll);
  near(find(p,'totalTaxes').values[r.id],r.totalTaxes);
  near(find(p,'cmvBurden').values[r.id],-d.cmv/d.revenue);
  near(find(p,'grossMargin').values[r.id],d.grossProfit/d.revenue);
  assert.equal(find(p,'netMargin').values[r.id],r.margin);
  assert.equal(find(p,'taxBurden').values[r.id],r.taxBurden);
 }
 const broken=structuredClone(input);broken.result.regimes[3].dre.personnel+=1;
 assert.equal(find(buildDrePresentation(broken),'operatingExpenses').values.actual,null);
});

test('composição usa grupos efetivos e base congelada de serviços, com ajustes assinados',()=>{
 const input=fixture(),p=buildDrePresentation(input);
 for(const r of input.result.regimes){
  near(['salesOptantCents','salesNonOptantCents','salesCpfCents'].reduce((sum,key)=>sum+find(p,key).values[r.id],0),r.dre.sales);
  assert.equal(find(p,'serviceReport').values[r.id],24000);assert.equal(find(p,'serviceAdjustment').values[r.id],12000);
 }
 input.draft.values.serviceRevenue=1000;input.result=calculateSimulation(input.draft);
 assert.equal(find(buildDrePresentation(input),'serviceAdjustment').values.actual,-12000);
 input.monthlyGroups.salesCpfCents+=1;
 assert.equal(find(buildDrePresentation(input),'salesCpfCents').values.actual,null);
 delete input.source.revenueSplit;
 assert.equal(find(buildDrePresentation(input),'serviceReport').values.actual,null);
});

test('créditos globais só aparecem nos regimes aplicáveis e nunca aumentam o lucro novamente',()=>{
 const input=fixture(),p=buildDrePresentation(input);
 assert.equal(find(p,'cbs.used').values.pure,null);assert.match(find(p,'cbs.used').reasonByRegime.pure,/DAS/);
 assert.equal(find(p,'icms.used').values.hybrid,null);
 for(const id of ['hybrid','presumed','actual'])near(find(p,'cbs.used').values[id],input.result.credits.cbs.used);
 near(find(p,'icms.used').values.actual,input.result.regimes[3].dre.icmsUsed);
 const outside={...input.engineInput,icmsOutside:true,salesRevenue:1000,regularPurchases:5000};
 outside.credits={...outside.credits,regular:{...outside.credits.regular,base:5000}};
 const result=calculateTax(outside),q=buildDrePresentation({result,engineInput:outside});
 assert.equal(result.regimes[0].dre.icmsNet,0);
 assert(find(q,'icms.used').values.pure>0,'ICMS líquido zero não significa ausência de crédito.');
 assert(find(q,'icms.balance').values.pure>0);
 assert.equal(find(q,'icms.used').informative,true);
 const broken=structuredClone(input);broken.result.credits.cbs.used+=1;
 assert.equal(find(buildDrePresentation(broken),'cbs.used').values.actual,null);
});

test('IRPJ normal/adicional usa somente memória anual única, válida e conciliada',()=>{
 const input=fixture(),engine={...input.engineInput,salesRevenue:120000,serviceRevenue:60000,rbt12:2160000};
 const result=calculateTax(engine),p=buildDrePresentation({result,engineInput:engine});
 for(const id of ['presumed','actual']){
  near(find(p,'irpjBasic').values[id]+find(p,'irpjAdditional').values[id],result.regimes.find(r=>r.id===id).dre.irpj);
  assert(find(p,'irpjAdditional').values[id]<0);
 }
 assert.equal(find(p,'irpjBasic').values.pure,null);
 for(const mutate of [
  r=>{r.memory=r.memory.filter(row=>row.id!=='actual.irBasic');},
  r=>{r.memory.push(structuredClone(r.memory.find(row=>row.id==='actual.irBasic')));},
  r=>{r.memory.find(row=>row.id==='actual.irBasic').unit='percent';},
  r=>{r.memory.find(row=>row.id==='actual.irBasic').value+=1;},
 ]){const broken=structuredClone(result);mutate(broken);const q=buildDrePresentation({result:broken});assert.equal(find(q,'irpjBasic').values.actual,null);assert.equal(find(q,'irpj').values.actual,broken.regimes[3].dre.irpj);}
});

test('legado sem DIFAL ou detalhes conserva totais e usa indisponível, sem zeros fabricados',()=>{
 const {draft}=fixture(),result=calculateSimulation(draft);delete result.memory;delete result.credits;
 const p=buildDrePresentation({result});assert.equal(find(p,'difal'),undefined);
 for(const key of ['serviceReport','serviceAdjustment','salesCpfCents','irpjBasic','cbs.used'])assert.equal(find(p,key).values.actual,null,key);
 assert.equal(find(p,'revenue').values.actual,result.regimes[3].dre.revenue);
 assert.notEqual(find(p,'revenueDeductions').values.actual,null);
});

test('receita zero, regime indisponível e campos ausentes não produzem percentuais ou detalhes indevidos',()=>{
 const input=fixture();input.draft.values.salesRevenue=0;input.draft.values.serviceRevenue=0;
 const zero=buildDrePresentation({result:calculateSimulation(input.draft)});
 for(const row of zero.indicators.filter(row=>row.unit==='percent'))assert.equal(row.values.actual,null);
 assert.equal(find(zero,'netProfit').percentValues.actual,null);assert(find(zero,'netProfit').values.actual<0);
 const unavailable=structuredClone(input.result);unavailable.regimes[0].available=false;
 const p=buildDrePresentation({...input,result:unavailable});for(const row of allRows(p))assert.equal(row.values.pure,null,row.key);
 delete unavailable.regimes[3].dre.cards;
 const broken=buildDrePresentation({result:unavailable});assert.equal(find(broken,'cards').values.actual,null);assert.equal(find(broken,'operatingExpenses').values.actual,null);
});

test('calendário salvo mantém meses e anuais distintos, subtotais derivados só usam linhas congeladas',()=>{
 const input=fixture(),calendar=buildMonthlyDre(input.result,2027);
 const saved=calendar.regimes.find(r=>r.id==='actual'),by=key=>saved.rows.find(row=>row.key===key);
 // Synthetic saved schedule intentionally differs from the annual comparison.
 for(const key of ['services','revenue','netRevenue','grossProfit','preTax','netProfit']){
  by(key).months[0]+=100;by(key).annual+=100;
 }
 const before=structuredClone(calendar),p=buildDrePresentation({...input,calendar});
 assert.equal(find(p,'services').values.actual,input.result.regimes[3].dre.services);
 assert.equal(find(p,'services').monthlyValues.actual[0],by('services').months[0]);
 assert.equal(find(p,'services').calendarAnnualValues.actual,by('services').annual);
 near(find(p,'operatingExpenses').monthlyValues.actual[0],by('preTax').months[0]-by('grossProfit').months[0]);
 assert.equal(find(p,'serviceReport').monthlyValues.actual[0],null);assert.equal(find(p,'serviceReport').calendarAnnualValues.actual,null);
 assert.equal(find(p,'serviceReport').values.actual,24000);
 near(find(p,'cards').monthlyPercentValues.actual[0],by('cards').months[0]/by('revenue').months[0]);
 near(find(p,'netMargin').monthlyValues.actual[0],by('netProfit').months[0]/by('revenue').months[0]);
 assert.deepEqual(calendar,before);
});

test('calendário incompleto, duplicado ou desconhecido não é reconstruído por média silenciosamente',()=>{
 const input=fixture();
 for(const mutate of [
  c=>{c.version='UNKNOWN';},
  c=>{c.regimes[3].rows=c.regimes[3].rows.filter(row=>row.key!=='sales');},
  c=>{c.regimes[3].rows.push(structuredClone(c.regimes[3].rows.find(row=>row.key==='sales')));},
  c=>{c.regimes[3].rows.find(row=>row.key==='sales').months[0]=null;},
 ]){
  const calendar=buildMonthlyDre(input.result,2027);mutate(calendar);
  const p=buildDrePresentation({...input,calendar});assert.equal(find(p,'sales').monthlyValues.actual[0],null);
  assert.equal(find(p,'sales').values.actual,input.result.regimes[3].dre.sales);
 }
});

test('avaliação vertical preserva sinais e percentuais já fracionários sem dividir novamente por 12',()=>{
 const input=fixture(),p=buildDrePresentation(input);
 assert(find(p,'cards').percentValues.actual<0);
 near(find(p,'cards').percentValues.actual,find(p,'cards').monthlyPercentValues.actual[0]);
 near(find(p,'netMargin').values.actual,find(p,'netMargin').monthlyValues.actual[0]);
 assert.equal(find(p,'netMargin').percentValues.actual,find(p,'netMargin').values.actual);
});

test('DRE única inclui cada linha uma vez, composição junto ao total e indicadores após o resultado',()=>{
 const input=fixture(),p=buildDrePresentation({...input,calendar:buildMonthlyDre(input.result,2027)}),before=structuredClone(p);
 freeze(p);const rows=unifiedDreRows(p),keys=rows.map(row=>row.key);
 assert.equal(rows.length,allRows(p).length);assert.equal(new Set(keys).size,rows.length);
 assert.deepEqual(rows.filter(row=>row.kind!=='detail'&&row.kind!=='indicator').map(row=>row.key),p.sections.flatMap(section=>section.rows.map(row=>row.key)));
 for(const group of p.details){const parent=keys.indexOf(group.parentKey);assert(parent>=0);assert.deepEqual(keys.slice(parent+1,parent+1+group.rows.length),group.rows.map(row=>row.key));}
 assert.deepEqual(rows.slice(-p.indicators.length),p.indicators);
 assert.equal(keys[keys.length-p.indicators.length-1],'netProfit');
 for(const row of rows)assert.equal(row,find(p,row.key),'A ordenação não copia nem transforma os valores anuais ou mensais.');
 assert.deepEqual(p,before);
});

test('DRE única mantém legado, detalhes indisponíveis e extensões sem repetir chaves',()=>{
 const {draft}=fixture(),p=buildDrePresentation({result:calculateSimulation(draft)});
 p.details.push(p.details[0]);
 const extension={...p.details[0].rows[0],key:'extraDetail',parentKey:'missingParent'};
 p.details.push({key:'extension',label:'Extensão',parentKey:'missingParent',rows:[extension]});
 const rows=unifiedDreRows(p),keys=rows.map(row=>row.key);
 assert.equal(keys.includes('difal'),false);assert.equal(keys.filter(key=>key==='salesCpfCents').length,1);
 assert.equal(rows.find(row=>row.key==='serviceReport').values.actual,null);
 assert.equal(rows.find(row=>row.key==='extraDetail'),extension);
 assert.equal(new Set(keys).size,keys.length);assert.deepEqual(rows.slice(-p.indicators.length),p.indicators);
});


test('resumo visual usa exatamente o quadro selecionado e não altera a apresentação',()=>{
 const input=fixture(),calendar=buildMonthlyDre(input.result,2027),p=buildDrePresentation({...input,calendar});
 const before=structuredClone(p);freeze(p);
 for(const id of ['pure','hybrid','presumed','actual'])for(const mode of ['annual','calendarAnnual','month']){
  const column={id,mode,month:0},summary=buildDreSummary(p,column),row=find(p,'netProfit');
  assert.equal(summary.result,mode==='month'?row.monthlyValues[id][0]:mode==='calendarAnnual'?row.calendarAnnualValues[id]:row.values[id]);
  assert.equal(summary.reconciled,true);near(summary.revenue-summary.deductions,summary.result);
  assert.equal(summary.movements.length,6);
 }
 assert.deepEqual(p,before);
});

test('resumo visual distingue total anual salvo, prejuízo, zero e indisponibilidade',()=>{
 const input=fixture(),calendar=buildMonthlyDre(input.result,2027);
 const saved=calendar.regimes[3];for(const key of ['services','revenue','netRevenue','grossProfit','preTax','netProfit'])saved.rows.find(row=>row.key===key).annual+=50;
 const p=buildDrePresentation({...input,calendar}),annual=buildDreSummary(p,{id:'actual',mode:'annual'}),captured=buildDreSummary(p,{id:'actual',mode:'calendarAnnual'});
 assert.equal(captured.revenue,annual.revenue+50);assert.equal(captured.result,annual.result+50);assert(captured.reconciled);
 input.draft.values.salesRevenue=0;input.draft.values.serviceRevenue=0;
 const loss=buildDreSummary(buildDrePresentation({result:calculateSimulation(input.draft)}),{id:'actual',mode:'annual'});
 assert.equal(loss.revenue,0);assert(loss.result<0);assert.equal(loss.margin,null);assert(loss.reconciled);
 input.result.regimes[0].available=false;
 const absent=buildDreSummary(buildDrePresentation(input),{id:'pure',mode:'annual'});
 assert.equal(absent.revenue,null);assert.equal(absent.result,null);assert.equal(absent.deductions,null);assert.equal(absent.reconciled,false);
});

test('composição divergente ou incompleta preserva o resultado e impede gráfico enganoso',()=>{
 const p=buildDrePresentation(fixture());find(p,'netProfit').values.actual+=1;
 const broken=buildDreSummary(p,{id:'actual',mode:'annual'});
 assert.equal(broken.complete,true);assert.equal(broken.reconciled,false);assert.equal(broken.deductions,null);
 assert.equal(broken.result,find(p,'netProfit').values.actual);
 find(p,'operatingExpenses').values.actual=null;
 assert.equal(buildDreSummary(p,{id:'actual',mode:'annual'}).complete,false);
 find(p,'revenue').monthlyValues.actual[1]=null;
 assert.equal(buildDreSummary(p,{id:'actual',mode:'month',month:1}).revenue,null);
});

function evolutionFixture(){
 const values={revenue:[100,150,0],netProfit:[-20,10,-5],netMargin:[-.2,10/150,null],difal:[-10,-15,0]};
 const presentation={method:'REPORT_MONTHS_V1',regimes:[{id:'actual',available:true}],sections:[{rows:Object.entries(values).map(([key,months])=>({key,monthlyValues:{actual:[...months,...Array(9).fill(null)]}}))}]};
 const calendar={version:'DRE_CALENDAR_V3',months:Array.from({length:12},(_,i)=>({label:String(i+1),sourceMonth:i<3?`2025-0${i+1}`:null}))};
 return {presentation,calendar};
}
test('evolução lê meses congelados, calcula pontos percentuais e mantém DIFAL como dedução sem alterar células',()=>{
 const {presentation,calendar}=evolutionFixture(),before=structuredClone({presentation,calendar});freeze(presentation);freeze(calendar);
 const data=buildDreEvolution(presentation,calendar,'actual',1),metric=key=>data.metrics.find(row=>row.key===key);
 assert.equal(data.importedCount,3);assert.equal(data.reason,'');assert.equal(data.months[3].revenue,null);
 assert.equal(metric('revenue').change,50);assert.equal(metric('revenue').ratio,.5);
 assert.equal(metric('netProfit').change,30);assert.equal(metric('netProfit').ratio,null,'Prejuízo anterior não é denominador de crescimento percentual.');
 near(metric('netMargin').change,10/150+.2);assert.equal(metric('netMargin').ratio,null);
 assert.equal(metric('difal').value,15);assert.equal(metric('difal').previous,10);assert.equal(metric('difal').change,5);
 assert.equal(data.months[1].difal,-15);assert.deepEqual({presentation,calendar},before);
});
test('evolução não compara projeção pela média, meses ausentes, janeiro ou origens não consecutivas',()=>{
 const {presentation,calendar}=evolutionFixture();
 assert.match(buildDreEvolution(presentation,calendar,'actual',0).reason,/fora deste calendário/);
 const missing=buildDreEvolution(presentation,calendar,'actual',3);assert.match(missing.reason,/Sem dados importados/);assert(missing.metrics.every(row=>row.change===null));
 calendar.months[0].sourceMonth=null;
 assert.match(buildDreEvolution(presentation,calendar,'actual',1).reason,/imediatamente anterior/);
 calendar.months[0].sourceMonth='2024-01';assert.match(buildDreEvolution(presentation,calendar,'actual',1).reason,/não são consecutivas/);
 delete presentation.method;assert.equal(buildDreEvolution(presentation,calendar,'actual',1).available,false);
 presentation.method='REPORT_MONTHS_V1';calendar.version='DRE_CALENDAR_V2';assert.equal(buildDreEvolution(presentation,calendar,'actual',1).available,false);
});
test('evolução distingue receita zero e DIFAL zero de ausentes e respeita regime indisponível',()=>{
 const {presentation,calendar}=evolutionFixture();
 const data=buildDreEvolution(presentation,calendar,'actual',2),metric=key=>data.metrics.find(row=>row.key===key);
 assert.equal(metric('revenue').value,0);assert.equal(metric('revenue').change,-150);assert.equal(metric('revenue').ratio,-1);
 assert.equal(metric('difal').value,0);assert.equal(metric('difal').change,-15);assert.equal(metric('netMargin').change,null);
 presentation.sections[0].rows= presentation.sections[0].rows.filter(row=>row.key!=='difal');
 assert(!buildDreEvolution(presentation,calendar,'actual',2).metrics.some(row=>row.key==='difal'));
 presentation.regimes[0].available=false;
 const unavailable=buildDreEvolution(presentation,calendar,'actual',1);assert.match(unavailable.reason,/indisponível/);assert(unavailable.metrics.every(row=>row.change===null&&row.value===null));
});
