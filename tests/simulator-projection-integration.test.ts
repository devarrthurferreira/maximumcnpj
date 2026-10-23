import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {section22} from './fixtures/section22.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,collection,scope,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration,attachGenerationPurchase,attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {createSimulation,getSimulation} from '../src/simulation-history.ts';
import {annualizeReports,REPORT_GROUPS} from '../public/simulator-projection.js';
import {calculateSimulation} from '../public/simulator-engine.js';

test('MongoDB: quatro competências -> valores mensais -> soma do período, histórico imutável e contrato protegido', {skip:!process.env.MONGODB_URI,timeout:120000},async()=>{
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID,testDb='maximum_annual_test_'+randomUUID().replaceAll('-','');
 process.env.MONGODB_DB=testDb;process.env.WORKSPACE_ID='annual_test';resetLookupIndexes();
 const actor={_id:'annual-tester',role:'admin',name:'Teste sintético',email:'test@example.test'};
 const row=(serviceDate:string,cents:number)=>({document:'12345678900',name:'Pessoa sintética',serviceDate,quantity:'1',grossCents:cents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:cents});
 try{
  const clientId=(await importCatalog(actor,[{code:'991',name:'Empresa sintética'}])).items[0].id;
  const gen=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
  const jobIds:string[]=[];
  for(const [attach,dates,cents]of[[attachGenerationPurchase,['2026-04-02','2026-05-04','2026-06-17','2026-07-29'],6000000],[attachGenerationSale,['2026-04-01','2026-05-15','2026-06-30','2026-07-31'],10000000]]as const){
   const {job}=await attach(actor,gen._id,{clientId,importId:randomUUID(),fileName:'synthetic.csv',expectedRows:4});jobIds.push(job._id);
   await uploadLookup(actor,job._id,{offset:0,rows:dates.map(d=>({...row(d,cents),natureCode:attach===attachGenerationPurchase?'1102':'5102',recipientUf:'SP'}))});await finalizeLookup(actor,job._id);
  }
  const lines=await collection('purchaseLines'),before=await lines.find(scope({jobId:{$in:jobIds}})).sort({_id:1}).toArray();
  const source=await generationSimulator(gen._id,clientId);assert.equal(source.reportMonths,4);
  assert.equal(source.projection!.totals.sales.annualCents,40000000);
  const groups=Object.fromEntries(REPORT_GROUPS.map(k=>[k,source.monthlyReports![0].fields[k]/100]));
  const request={simulationId:randomUUID(),rbt12ExtractionId:randomUUID(),generationId:gen._id,clientId,reportMonths:4,periodConfirmed:true,monthlyGroups:groups,monthlyInputs:source.monthlyReports!.map(row=>({...baselineMonth(row,{salaries:15000,benefits:1000,adminExpenses:500,rent:3000,cardExpenses:400}),values:{...baselineMonth(row,{salaries:15000,benefits:1000,adminExpenses:500,rent:3000,cardExpenses:400}).values,serviceRevenue:2000}})),
   draft:{year:2027,salesAnnex:1,serviceAnnex:3,rbt12:888888.88,values:{serviceRevenue:2000,salesRevenue:100000,simplePurchases:0,regularPurchases:60000,salaries:15000,benefits:1000,adminExpenses:500,rent:3000,cardExpenses:400}}};
  const extraction=section22(88888888);
  extraction.priorRevenues=[...extraction.rbt12Window.slice(8).map(row=>({...row,month:row.month.replace('2026','2025'),period:row.period.replace('2026','2025'),usedInRbt12:false})),...extraction.priorRevenues];
  await (await collection('simplesExtractions')).insertOne({...scope(),_id:request.rbt12ExtractionId,clientId,parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result:extraction});
  const saved=await createSimulation(actor,request);
  assert.equal(saved.projection.version,'REPORT_MONTHS_V1');assert.equal(saved.projection.reportMonths,4);assert.equal(saved.projection.timeline.length,4);
  assert.equal(saved.projection.totals.sales.totalCents,40000000);assert.equal(saved.projection.timeline[0].salesCents,10000000);
  assert.equal(saved.projection.totals.sales.annualCents,40000000);assert.equal(saved.projection.scenario.annual.revenueCents,40800000);
  assert.equal(saved.result.annualRevenue,408000);assert(saved.engineInput.months.every((row:any)=>row.input.rbt12===888888.88));assert.equal(saved.engineInput.rbt12Method,'RBT12_MONTHLY_SECTION_22_V1');assert.equal(saved.manuallyAdjusted,true);
  assert.deepEqual(await getSimulation(saved._id),saved);assert.deepEqual(await createSimulation(actor,request),saved);
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),reportMonths:5}),(e:any)=>e.code==='SIMULATION_PERIOD');
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),projection:{projectionMonths:16}}),(e:any)=>e.code==='VALIDATION');
  const adjusted=await createSimulation(actor,{...request,simulationId:randomUUID(),parentSimulationId:saved._id,
   monthlyInputs:request.monthlyInputs.map((row,index)=>index?row:{...row,groups:{...row.groups,salesCpfCents:100100}}),monthlyGroups:{...groups,salesCpfCents:100100},draft:{...request.draft,values:{...request.draft.values,salesRevenue:100100}}});
  assert.equal(adjusted.manuallyAdjusted,true);assert.equal(adjusted.projection.totals.sales.annualCents,40000000);
  assert.equal(adjusted.projection.scenario.annual.revenueCents,40810000);assert.deepEqual(await getSimulation(saved._id),saved);
  assert.deepEqual(await lines.find(scope({jobId:{$in:jobIds}})).sort({_id:1}).toArray(),before);
  // Frozen dates also reconstruct the monthly series when old job metadata lacks a stored period.
  await(await collection('lookupJobs')).updateMany(scope({_id:{$in:jobIds}}),{$unset:{reportPeriod:''}});
  const legacy=await generationSimulator(gen._id,clientId);assert.equal(legacy.projection!.version,'REPORT_MONTHS_V1');
  const manual=await createSimulation(actor,{...request,simulationId:randomUUID()});assert.equal(manual.projection.totals.sales.annualCents,40000000);
  assert.deepEqual(source.projection!.totals,saved.projection.totals);
  process.env.WORKSPACE_ID='outside';await assert.rejects(getSimulation(saved._id));
 }finally{
  const db=await database();assert.equal(db.databaseName,testDb);await db.dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});

test('MongoDB: serviços9000 e mercadorias com devolução alimentam DRE/DIFAL sem duplicação e congelam origem', {skip:!process.env.MONGODB_URI,timeout:120000},async()=>{
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID,testDb='maximum_services_difal_'+randomUUID().replaceAll('-','');
 process.env.MONGODB_DB=testDb;process.env.WORKSPACE_ID='services_difal_test';resetLookupIndexes();
 const actor={_id:'services-tester',role:'admin',name:'Teste sintético',email:'test@example.test'};
 const row=(serviceDate:string,totalCents:number,natureCode:string)=>({document:'12345678900',name:'Pessoa sintética',description:'Venda',natureCode,recipientUf:'SP',serviceDate,quantity:'1',grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents});
 const close=(actual:number,expected:number)=>assert(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
 try{
  const clientId=(await importCatalog(actor,[{code:'992',name:'Empresa sintética mista',uf:'MG'}])).items[0].id;
  const gen=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
  const dates=['2026-06-01','2026-07-01','2026-08-01'];
  const salesRows=[...dates.map(date=>row(date,300000,'6102')), ...dates.map((date,index)=>row(date,100001,['900000','900001','9.000.0199'][index])), row(dates[2],90000,'6202')];
  const sales=await attachGenerationSale(actor,gen._id,{clientId,importId:randomUUID(),fileName:'mixed-synthetic.csv',expectedRows:salesRows.length,issuerUf:'MG'});
  await uploadLookup(actor,sales.job._id,{offset:0,rows:salesRows});await finalizeLookup(actor,sales.job._id);
  const purchases=await attachGenerationPurchase(actor,gen._id,{clientId,importId:randomUUID(),fileName:'purchases-synthetic.csv',expectedRows:4});
  await uploadLookup(actor,purchases.job._id,{offset:0,rows:[...dates.map(date=>row(date,20000,'1102')),row(dates[2],90000,'1202')]});await finalizeLookup(actor,purchases.job._id);
  const source=await generationSimulator(gen._id,clientId),p=source.projection!;
  assert.equal(source.fields.serviceRevenueCents,300003);assert.equal(source.fields.salesCpfCents,810000);
  assert.equal(source.sales.totalCents,1110003);assert.equal(p.timeline[0].salesCents,400001);
  assert.equal(p.timeline[0].fields.serviceRevenueCents,100001);
  const groups=Object.fromEntries(REPORT_GROUPS.map(key=>[key,p.timeline[0].fields[key]/100]));
  const draft:any={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:500000,values:{serviceRevenue:1000.01,salesRevenue:3000,simplePurchases:0,regularPurchases:200,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}};
  const request={simulationId:randomUUID(),generationId:gen._id,clientId,reportMonths:3,periodConfirmed:true,monthlyGroups:groups,monthlyInputs:source.monthlyReports!.map(row=>baselineMonth(row)),draft,rbt12Source:'MANUAL',rbt12ManualConfirmed:true};
  const saved=await createSimulation(actor,request),baseline=calculateMonthlySimulation(draft,source.monthlyReports!.map(row=>({...row,difal:null})),request.monthlyInputs,source.sales.jobId).result;
  assert.equal(saved.manuallyAdjusted,false);assert.deepEqual(saved.adjustments,[]);
  close(saved.result.annualRevenue,11100.03);assert.equal(saved.projection.scenario.annual.revenueCents,1110003);
  assert.equal(saved.difalProjection?.sourceJobId,sales.job._id);assert.equal(saved.difalProjection?.sourceAmountCents,90000);
  assert.equal(saved.difalProjection?.sourceBaseCents,900000);assert.equal(saved.difalProjection?.eligibleLines,3);
  assert(saved.difalProjection?.months.every((row:any)=>row.amountCents===30000));assert.equal(saved.difalProjection?.annualCents,90000);
  assert.equal(saved.engineInput.months[0].input.difalMonthly,300);
  for(const regime of saved.result.regimes){
   const prior=baseline.regimes.find(item=>item.id===regime.id)!;
   close(regime.dre.services,3000.03);close(regime.dre.sales,8100);close(regime.dre.difal,['pure','hybrid'].includes(regime.id)?-900:0);
   const applied=['pure','hybrid'].includes(regime.id)?900:0;
   close(regime.dre.netRevenue,prior.dre.netRevenue-applied);close(regime.dre.preTax,prior.dre.preTax-applied);
   close(regime.totalTaxes,prior.totalTaxes+applied);close(regime.annualProfit,prior.annualProfit-applied);
  }
  const actual=saved.result.regimes.find(item=>item.id==='actual')!;
  close(actual.dre.csll,-Math.max(0,actual.dre.preTax)*.09);
  close(saved.result.memory.find(item=>item.id==='actual.preTax')!.value as number,actual.dre.preTax);
  assert.deepEqual(saved.result.credits,baseline.credits);
  assert.equal(saved.monthlyDre.version,'DRE_CALENDAR_V3');
  assert(saved.monthlyDre.regimes.every((regime:any)=>regime.rows.find((row:any)=>row.key==='difal').months.slice(5,8).every((value:number)=>value===(['pure','hybrid'].includes(regime.id)?-300:0))));
  for(const addition of[{difalProjection:{monthlyCents:0}},{difalMonthly:0},{source:{sales:{difal:{amountCents:0}}}}]){
   await assert.rejects(createSimulation(actor,{...request,...addition,simulationId:randomUUID()}),(error:any)=>error.code==='VALIDATION');
  }
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),draft:{...draft,values:{...draft.values,difalMonthly:0}}}),(error:any)=>error.code==='VALIDATION');
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),draft:{...draft,values:{...draft.values,salesRevenue:3700.01}}}),(error:any)=>error.code==='SIMULATION_TOTAL');
  const edited=await createSimulation(actor,{...request,simulationId:randomUUID(),parentSimulationId:saved._id,
   monthlyInputs:request.monthlyInputs.map((row,index)=>index?row:{...row,groups:{...row.groups,salesCpfCents:2800},values:{...row.values,serviceRevenue:1100.01}}),monthlyGroups:{...groups,salesCpfCents:2800},draft:{...draft,values:{...draft.values,salesRevenue:2800,serviceRevenue:1100.01}}});
  assert.deepEqual(edited.difalProjection,saved.difalProjection);assert.equal(edited.manuallyAdjusted,true);
  assert(edited.adjustments.some(item=>item.field==='serviceRevenue'));
  assert.deepEqual(await createSimulation(actor,request),saved);
  await (await collection('lookupJobs')).updateOne(scope({_id:sales.job._id}),{$set:{'purchaseInput.difal.amountCents':1}});
  assert.deepEqual(await getSimulation(saved._id),saved,'Histórico não relê nem recalcula a origem alterada.');
  assert.deepEqual(await createSimulation(actor,request),saved,'Reenvio idempotente usa resultado já capturado.');
 }finally{
  const db=await database();assert.equal(db.databaseName,testDb);await db.dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});
