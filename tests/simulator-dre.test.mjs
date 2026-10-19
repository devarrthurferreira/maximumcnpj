import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDrePresentation,unifiedDreRows,DRE_PRESENTATION_VERSION} from '../public/simulator-dre.js';
import {calculateSimulation,calculateTax,draftToInput} from '../public/simulator-engine.js';
import {annualizeReports,projectDifal} from '../public/simulator-projection.js';
import {buildMonthlyDre,DRE_ROWS} from '../public/simulator-calendar.js';

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
 for(const r of input.result.regimes)for(const [key] of DRE_ROWS){
  assert.equal(find(p,key).values[r.id],r.dre[key]);near(find(p,key).monthlyValues[r.id][0],r.dre[key]/12);
 }
 for(const row of allRows(p)){assert.equal(row.monthlyValues.actual.length,12);assert(Array.isArray(row.notes));assert(Array.isArray(row.sourceRefs));}
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
