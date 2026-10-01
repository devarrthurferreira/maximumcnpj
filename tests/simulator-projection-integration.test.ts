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

test('MongoDB: quatro competências -> média -> doze meses, histórico imutável e contrato protegido', {skip:!process.env.MONGODB_URI,timeout:120000},async()=>{
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
   await uploadLookup(actor,job._id,{offset:0,rows:dates.map(d=>row(d,cents))});await finalizeLookup(actor,job._id);
  }
  const lines=await collection('purchaseLines'),before=await lines.find(scope({jobId:{$in:jobIds}})).sort({_id:1}).toArray();
  const source=await generationSimulator(gen._id,clientId);assert.equal(source.reportMonths,4);
  assert.equal(source.projection!.totals.sales.annualCents,120000000);
  const groups=Object.fromEntries(REPORT_GROUPS.map(k=>[k,source.projection!.monthlyGroupsCents[k]/100]));
  const request={simulationId:randomUUID(),rbt12ExtractionId:randomUUID(),generationId:gen._id,clientId,reportMonths:4,periodConfirmed:true,monthlyGroups:groups,
   draft:{year:2027,salesAnnex:1,serviceAnnex:3,rbt12:888888.88,values:{serviceRevenue:2000,salesRevenue:100000,simplePurchases:0,regularPurchases:60000,salaries:15000,benefits:1000,adminExpenses:500,rent:3000,cardExpenses:400}}};
  await (await collection('simplesExtractions')).insertOne({...scope(),_id:request.rbt12ExtractionId,clientId,parserVersion:'SIMPLES_SECTION_22_V2',fileName:'sintetico.pdf',fileSha256:'synthetic',result:section22(88888888)});
  const saved=await createSimulation(actor,request);
  assert.equal(saved.projection.version,'AVERAGE_X12_V1');assert.equal(saved.projection.reportMonths,4);assert.equal(saved.projection.timeline.length,12);
  assert.equal(saved.projection.totals.sales.totalCents,40000000);assert.equal(saved.projection.totals.sales.monthlyCents,10000000);
  assert.equal(saved.projection.totals.sales.annualCents,120000000);assert.equal(saved.projection.scenario.annual.revenueCents,122400000);
  assert.equal(saved.result.annualRevenue,1224000);assert.equal(saved.engineInput.rbt12,888888.88);assert.equal(saved.manuallyAdjusted,false);
  assert.deepEqual(await getSimulation(saved._id),saved);assert.deepEqual(await createSimulation(actor,request),saved);
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),reportMonths:5}),(e:any)=>e.code==='SIMULATION_PERIOD');
  await assert.rejects(createSimulation(actor,{...request,simulationId:randomUUID(),projection:{projectionMonths:16}}),(e:any)=>e.code==='VALIDATION');
  const adjusted=await createSimulation(actor,{...request,simulationId:randomUUID(),parentSimulationId:saved._id,
   monthlyGroups:{...groups,salesCpfCents:100100},draft:{...request.draft,values:{...request.draft.values,salesRevenue:100100}}});
  assert.equal(adjusted.manuallyAdjusted,true);assert.equal(adjusted.projection.totals.sales.annualCents,120000000);
  assert.equal(adjusted.projection.scenario.annual.salesCents,120120000);assert.deepEqual(await getSimulation(saved._id),saved);
  assert.deepEqual(await lines.find(scope({jobId:{$in:jobIds}})).sort({_id:1}).toArray(),before);
  // Legacy snapshots continue to require explicit month confirmation; arithmetic stays the same.
  await(await collection('lookupJobs')).updateMany(scope({_id:{$in:jobIds}}),{$unset:{reportPeriod:''}});
  const legacy=await generationSimulator(gen._id,clientId);assert.equal(legacy.projection,null);
  const manual=await createSimulation(actor,{...request,simulationId:randomUUID()});assert.equal(manual.projection.totals.sales.annualCents,120000000);
  assert.deepEqual(annualizeReports(source.fields,4).totals,saved.projection.totals);
  process.env.WORKSPACE_ID='outside';await assert.rejects(getSimulation(saved._id));
 }finally{
  const db=await database();assert.equal(db.databaseName,testDb);await db.dropDatabase();await closeDatabase();resetLookupIndexes();
  if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
  if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
 }
});
