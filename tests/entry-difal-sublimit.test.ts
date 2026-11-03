import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAnticipation, summarizeAnticipation, ANTICIPATION_VERSION, ANTICIPATION_SERVICE_EXCLUSION_VERSION} from '../src/icms-anticipation.ts';
import {calculateTax, EXAMPLE_INPUT, TAX_BANDS, defaultDifalPolicy} from '../public/simulator-engine.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildAnalysisPeriod} from '../public/analysis-period.js';
import {selectOperationMonths} from '../src/simulation-monthly-source.ts';

const near=(a:number,b:number)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const cnpj='11222333000181',cpf='12345678901';
const purchase={totalCents:100_000,natureCode:'2102',document:cnpj,issuerUf:'MG',recipientUf:'SP'};

test('entrada atual: CNPJ interestadual calcula R$ 73,20, CPF não calcula e documentos/valores não são apagados',()=>{
 const snapshot=structuredClone(purchase);
 assert.deepEqual(calculateAnticipation(purchase),{eligible:true,baseCents:100000,amountCents:7320,reason:'ELIGIBLE'});
 for(const document of [cpf,'123.456.789-01'])for(const issuerUf of ['MG',''])for(const recipientUf of ['MG','SP','']){
  const input={...purchase,document,issuerUf,recipientUf};
  assert.deepEqual(calculateAnticipation(input),{eligible:false,baseCents:0,amountCents:0,reason:'CPF_EXCLUDED'});
  assert.equal(summarizeAnticipation([input],issuerUf).pendingLines,0);
 }
 assert.equal(calculateAnticipation({...purchase,document:cpf},ANTICIPATION_SERVICE_EXCLUSION_VERSION).amountCents,7320,'V4 histórica continua reproduzível.');
 assert.equal(calculateAnticipation({...purchase,recipientUf:''}).reason,'MISSING_RECIPIENT_UF');
 assert.equal(calculateAnticipation({...purchase,document:'123456789012'}).reason,'NOT_CNPJ');
 assert.equal(calculateAnticipation({...purchase,recipientUf:'MG'}).amountCents,0);
 assert.equal(calculateAnticipation({...purchase,natureCode:'8000102'}).amountCents,0);
 assert.deepEqual(purchase,snapshot);
});

test('3,6 milhões não é trava: entrada permanece positiva na DRE, saída zero e opção explícita continua respeitada',()=>{
 for(const rbt12 of [3599999.99,3600000,3600000.01,4000000,4800000]){
  const input={...structuredClone(EXAMPLE_INPUT),rbt12,icmsOutside:false,
   icmsAnticipation:{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:7320},difalMonthly:17431.97};
  const out=calculateTax(input),base=calculateTax({...input,icmsAnticipation:{version:'ICMS_ANTICIPATION_DRE_V1',monthlyCents:0}});
  for(const id of ['pure','hybrid']){
   const regime=out.regimes.find(x=>x.id===id)!,reference=base.regimes.find(x=>x.id===id)!;
   assert.equal(regime.available,true);assert.equal(regime.difalApplication!.blocked,false);
   assert.equal(regime.dre.difal,0);near(regime.dre.icmsAnticipation,-878.4);
   near(regime.totalTaxes,reference.totalTaxes+878.4);near(regime.annualProfit,reference.annualProfit-878.4);
  }
  const outside=calculateTax({...input,icmsOutside:true});
  for(const id of ['pure','hybrid'])assert.equal(outside.regimes.find(x=>x.id===id)!.dre.icmsAnticipation,0);
 }
});

test('sexta faixa não perde ICMS/ISS interno: parcelas locais da quinta faixa, federais da sexta, sem duplicação',()=>{
 for(const salesAnnex of [1,2])for(const serviceAnnex of [3,4,5]){
  const input={...structuredClone(EXAMPLE_INPUT),rbt12:4000000,salesRevenue:10000,serviceRevenue:20000,salesAnnex,serviceAnnex,icmsOutside:false};
  const out=calculateTax(input),rate=(annex:number,index:number)=>{
   const band=TAX_BANDS[annex][index];return (input.rbt12*band.nominal-band.deduction)/input.rbt12;
  };
  const icms=rate(salesAnnex,4)*TAX_BANDS[salesAnnex][4].localShare;
  const iss=Math.min(.05,rate(serviceAnnex,4)*TAX_BANDS[serviceAnnex][4].localShare);
  const expected=120000*(rate(salesAnnex,5)+icms)+240000*(rate(serviceAnnex,5)+iss);
  near(out.regimes[0].dre.das,-expected);
  near(Number(out.memory.find(x=>x.id==='simples.sales.icms')!.value),icms);
  near(Number(out.memory.find(x=>x.id==='simples.services.iss')!.value),iss);
  const outside=calculateTax({...input,icmsOutside:true});
  near(outside.regimes[0].dre.das,-(120000*rate(salesAnnex,5)+240000*rate(serviceAnnex,5)));
 }
});

test('Jan–Set: cada mês recebe somente sua entrada elegível, CPF mantém custos e saída zero em todos os regimes',()=>{
 const raw=(month:number,natureCode:string,totalCents:number,document:string)=>({natureCode,totalCents,serviceDate:`2025-${String(month).padStart(2,'0')}-15`,
  document,documentKind:document===cnpj?'CNPJ':'CPF',cnpj:document===cnpj?cnpj:'',valid:document===cnpj,recipientUf:'SP',description:'Fixture sintética'});
 const months=Array.from({length:9},(_,i)=>i+1);
 const incoming=months.flatMap(m=>[raw(m,'2102',100000,cnpj),raw(m,'2102',50000,cpf)]);
 const outgoing=months.map(m=>raw(m,'6102',1000000,cpf));
 const reports=selectOperationMonths({rows:incoming,statuses:new Map([[cnpj,'NAO_OPTANTE']])},{rows:outgoing,statuses:new Map()},'MG')!;
 const period=buildAnalysisPeriod({startMonth:'2025-01',endMonth:'2025-09',months:9},{startMonth:'2025-01',endMonth:'2025-09',months:9});
 const draft={year:2027 as const,salesAnnex:1 as const,serviceAnnex:3 as const,rbt12:4000000,difalPolicy:defaultDifalPolicy(),
  values:{serviceRevenue:0,salesRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
 const frozen=structuredClone({incoming,outgoing,reports});
 const result=calculateMonthlySimulation(draft,reports,reports.map(row=>baselineMonth(row)),'source',null,period).result;
 assert.equal(result.monthlyResults!.length,9);
 for(const row of reports){assert.equal(row.anticipation.version,ANTICIPATION_VERSION);assert.equal(row.anticipation.amountCents,7320);assert.equal(row.fields.purchasesNonOptantCents,150000);}
 for(const regime of result.regimes){
  assert.equal(regime.dre.difal,0);near(regime.dre.icmsAnticipation,['pure','hybrid'].includes(regime.id)?-658.8:0);
  near(regime.dre.cmvRegular,-13500);near(regime.dre.sales,90000);
 }
 for(const month of result.monthlyResults!)for(const regime of month.result.regimes){
  assert.equal(regime.dre.difal,0);near(regime.dre.icmsAnticipation,['pure','hybrid'].includes(regime.id)?-73.2:0);
 }
 assert.deepEqual({incoming,outgoing,reports},frozen);
});
