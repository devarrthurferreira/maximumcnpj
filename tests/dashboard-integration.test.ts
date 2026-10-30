import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,database,closeDatabase,scope} from '../src/store.ts';
import {activityHistory,dashboardDetails} from '../src/dashboard.ts';
import {PURCHASE_MODE,SALES_MODE} from '../src/purchase-domain.ts';
import {storageDatabases,STORAGE_VERSION} from '../src/mongo-storage.ts';

test('dashboard history paginates all types, searches companies, scopes data, and counts days without merging repeated lookups',{skip:!process.env.MONGODB_URI},async()=>{
 const previous={db:process.env.MONGODB_DB,workspace:process.env.WORKSPACE_ID,limit:process.env.MONGODB_STORAGE_LIMIT_BYTES};
 process.env.MONGODB_DB='dashboard_test_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='dashboard-test';process.env.MONGODB_STORAGE_LIMIT_BYTES='1000000000';
 try {
  const clientId=randomUUID(),otherId=randomUUID(),now=new Date('2026-10-28T15:00:00Z'),createdAt=new Date('2026-10-27T12:00:00Z');
  await(await collection('clients')).insertMany([
   {_id:clientId,...scope(),code:'0042',name:'Empresa Busca',cnpj:'00000000000191',active:true,createdAt},
   {_id:otherId,...scope(),code:'0043',name:'Outra',active:true,createdAt:new Date('2026-01-01')}
  ]);
  const jobs=Array.from({length:32},(_,i)=>({_id:randomUUID(),...scope(),clientId,clientName:'Empresa Busca',clientCode:'0042',mode:i===0?PURCHASE_MODE:i===1?SALES_MODE:'LOOKUP',fileName:'Arquivo '+i,createdAt,status:'COMPLETED'}));
  await(await collection('lookupJobs')).insertMany([...jobs,{...jobs[0],_id:randomUUID(),workspaceId:'hidden',fileName:'Segredo'}]);
  await(await collection('lookupItems')).insertMany([
   ...jobs.slice(0,2).map(j=>({_id:randomUUID(),...scope(),jobId:j._id,clientId,state:'DONE',cnpj:'00000000000191',checkedAt:new Date('2026-10-28T03:00:00Z')})),
   {_id:randomUUID(),...scope(),jobId:jobs[2]._id,clientId,state:'DONE',checkedAt:new Date('2026-10-22T03:00:00Z')},
   {_id:randomUUID(),...scope(),jobId:jobs[3]._id,clientId,state:'DONE',checkedAt:new Date('2026-10-22T02:59:59Z')},
   {_id:randomUUID(),...scope(),jobId:jobs[4]._id,clientId,state:'RETRY',checkedAt:now},
   {_id:randomUUID(),workspaceId:'hidden',jobId:jobs[5]._id,clientId,state:'DONE',checkedAt:now}
  ]);
  const simulationId=randomUUID();await(await collection('simulations')).insertMany([
   {_id:simulationId,...scope(),clientId,createdAt,title:'DRE preservada'},
   {_id:randomUUID(),...scope(),clientId,createdAt,title:'Não publicado',analysisPublication:'PENDING'},
   {_id:randomUUID(),...scope(),clientId,createdAt,title:'Excluído',deletedAt:createdAt}
  ]);
  const analysisId=randomUUID();await(await collection('analysisRevisions')).insertOne({_id:randomUUID(),...scope(),clientId,analysisId,createdAt,kind:'accounting',revision:2,data:{status:'COMPLETE',months:['private snapshot']}});
  const history=await activityHistory({clientId});assert.equal(history.total,34);assert.equal(history.items.length,30);assert.equal((await activityHistory({clientId,page:2})).items.length,4);
  assert.equal((await activityHistory({search:'00.000.000/0001-91'})).total,34);assert.equal((await activityHistory({search:'0042'})).total,34);assert.equal((await activityHistory({search:'Empresa Busca',kind:'SALES'})).total,1);
  assert.equal((await activityHistory({clientId:otherId})).total,0);assert.equal((await activityHistory({search:'.*'})).total,0);
  assert(!JSON.stringify(history).includes('private snapshot'));assert(!JSON.stringify(history).includes('Segredo'));
  const dashboard=await dashboardDetails(clientId,now);assert.equal(dashboard.activity.queriesLast7Days,3);assert.equal(dashboard.activity.days[6].count,2);assert.equal(dashboard.activity.batchesLast7Days,32);assert.equal(dashboard.simulationCount,1);assert.equal(dashboard.storage.status,'AVAILABLE');
  assert.equal(dashboard.recentCompanies[0]._id,clientId);
  await(await collection('audit')).insertOne({_id:randomUUID(),...scope(),action:'lookup.delete',target:jobs[0]._id,createdAt});
  assert.equal((await activityHistory({clientId,kind:'PURCHASES'})).total,0);
 } finally {
  await(await database()).dropDatabase();await closeDatabase();
  for(const [key,value] of Object.entries({MONGODB_DB:previous.db,WORKSPACE_ID:previous.workspace,MONGODB_STORAGE_LIMIT_BYTES:previous.limit})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('dashboard rejects a missing persisted active bank even with a warm single-bank storage cache',
 {skip:!process.env.MONGODB_URI},async()=>{
 const keys=['MONGODB_DB','MONGODB_URI_2','MONGODB_URI_3','WORKSPACE_ID','MONGODB_STORAGE_LIMIT_BYTES'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 process.env.MONGODB_DB='dashboard_missing_bank_'+randomUUID().replaceAll('-','');
 process.env.WORKSPACE_ID='dashboard-missing-bank';process.env.MONGODB_STORAGE_LIMIT_BYTES='1000000000';
 delete process.env.MONGODB_URI_2;delete process.env.MONGODB_URI_3;
 try {
  const legacy=await dashboardDetails();
  assert.equal(legacy.storage.status,'AVAILABLE');assert.equal('mode' in legacy.storage,false);
  const controls=await collection('storageControl');
  for(const activeSlot of [2,3]){
   await controls.updateOne({_id:'mongo-storage-pool-v1'},{$set:{activeSlot}},{upsert:true});
   // All previously used destinations are required; the first missing one can
   // precede the latest active slot (for example both2 and3 are unconfigured).
   await assert.rejects(dashboardDetails(),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED'&&/MongoDB [23]/.test(error.message));
   assert.equal((await controls.findOne({_id:'mongo-storage-pool-v1'}))?.activeSlot,activeSlot);
  }
 } finally {
  await(await database()).dropDatabase();await closeDatabase();
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('dashboard counts lookup activity in every used bank while history and company filters stay on the control bank',
 {skip:!process.env.MONGODB_URI||!process.env.MONGODB_TEST_URI_2||!process.env.MONGODB_TEST_URI_3},async()=>{
 const keys=['MONGODB_DB','MONGODB_URI_2','MONGODB_URI_3','MONGODB_DB_2','MONGODB_DB_3','WORKSPACE_ID',
  'MONGODB_STORAGE_LIMIT_BYTES','MONGODB_STORAGE_LIMIT_BYTES_2','MONGODB_STORAGE_LIMIT_BYTES_3'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),suffix=randomUUID().replaceAll('-','');
 process.env.MONGODB_DB='dashboard_pool_1_'+suffix;process.env.MONGODB_DB_2='dashboard_pool_2_'+suffix;process.env.MONGODB_DB_3='dashboard_pool_3_'+suffix;
 process.env.MONGODB_URI_2=process.env.MONGODB_TEST_URI_2;process.env.MONGODB_URI_3=process.env.MONGODB_TEST_URI_3;
 process.env.WORKSPACE_ID='dashboard-pool-test';
 for(const key of ['MONGODB_STORAGE_LIMIT_BYTES','MONGODB_STORAGE_LIMIT_BYTES_2','MONGODB_STORAGE_LIMIT_BYTES_3'])process.env[key]='1000000000';
 let sources:Awaited<ReturnType<typeof storageDatabases>>=[];
 try {
  sources=await storageDatabases();
  const clientId=randomUUID(),otherId=randomUUID(),now=new Date('2026-10-30T15:00:00Z'),createdAt=new Date('2026-10-30T12:00:00Z');
  await(await collection('clients')).insertMany([
   {_id:clientId,...scope(),code:'0301',name:'Empresa com histórico nos três bancos',active:true,createdAt},
   {_id:otherId,...scope(),code:'0302',name:'Outra empresa',active:true,createdAt}
  ]);
  const jobs=sources.map(({slot})=>({_id:randomUUID(),...scope(),clientId,clientName:'Empresa com histórico nos três bancos',clientCode:'0301',
   storageSlot:slot,storageVersion:STORAGE_VERSION,mode:SALES_MODE,fileName:`Saídas ${slot}.csv`,status:'COMPLETED',createdAt}));
  await(await collection('lookupJobs')).insertMany(jobs);
  await(await collection('storageControl')).insertOne({_id:'mongo-storage-pool-v1',activeSlot:3});
  for(const {slot,db} of sources){
   const job=jobs.find(item=>item.storageSlot===slot)!;
   await db.collection('lookupItems').insertMany([
    {_id:randomUUID(),...scope(),jobId:job._id,clientId,state:'DONE',cnpj:'00000000000191',checkedAt:createdAt},
    {_id:randomUUID(),...scope(),jobId:randomUUID(),clientId,state:'RETRY',cnpj:'00000000000191',checkedAt:createdAt},
    {_id:randomUUID(),workspaceId:'hidden',jobId:randomUUID(),clientId,state:'DONE',cnpj:'00000000000191',checkedAt:createdAt},
    {_id:randomUUID(),...scope(),jobId:randomUUID(),clientId,state:'DONE',cnpj:'00000000000191',checkedAt:new Date('2026-10-01T12:00:00Z')},
    ...(slot===2?[{_id:randomUUID(),...scope(),jobId:randomUUID(),clientId:otherId,state:'DONE',cnpj:'00000000000191',checkedAt:createdAt}]:[])
   ]);
   // Shared CNPJ states are snapshots, never an additional lookup in the activity counter.
   await db.collection('cnpjStates').insertOne({_id:randomUUID(),...scope(),cnpj:'00000000000191',checkedAt:createdAt});
  }
  const analysisId=randomUUID();
  await(await collection('analysisRevisions')).insertOne({_id:randomUUID(),...scope(),clientId,analysisId,createdAt,kind:'accounting',revision:1,data:{status:'COMPLETE'}});
  await(await collection('simulations')).insertOne({_id:randomUUID(),...scope(),clientId,createdAt,title:'DRE preservada no controle'});
  const originalJobs=await(await collection('lookupJobs')).find(scope()).sort({_id:1}).toArray();
  const dashboard=await dashboardDetails(clientId,now),storage=dashboard.storage;
  assert.equal(dashboard.activity.queriesLast7Days,3,'One CNPJ in three distinct jobs must count three completed lookups.');
  assert.equal(dashboard.activity.days[6].count,3);assert.equal(dashboard.activity.batchesLast7Days,3);
  assert.equal(dashboard.historyCount,5);assert.equal(dashboard.simulationCount,1);assert.equal(dashboard.recentCompanies[0]._id,clientId);
  assert('mode' in storage);assert.equal(storage.mode,'POOL');assert.equal(storage.activeSlot,3);assert.equal(storage.configuredSlots,3);
  assert.deepEqual(storage.slots.map(item=>item.slot),[1,2,3]);
  assert(storage.slots.every(item=>item.usedBytes!==null&&item.usedBytes>0));
  assert.equal((await dashboardDetails(otherId,now)).activity.queriesLast7Days,1);
  assert.equal((await dashboardDetails('',now)).activity.queriesLast7Days,4);
  const history=await activityHistory({clientId});assert.equal(history.total,5);
  assert.equal(history.items.filter(item=>item.kind==='SALES').length,3);
  assert.deepEqual(await(await collection('lookupJobs')).find(scope()).sort({_id:1}).toArray(),originalJobs);
  const serialized=JSON.stringify(storage);
  for(const secret of [process.env.MONGODB_URI,process.env.MONGODB_URI_2,process.env.MONGODB_URI_3,process.env.MONGODB_DB,process.env.MONGODB_DB_2,process.env.MONGODB_DB_3])assert(!serialized.includes(secret!));
 } finally {
  await Promise.all(sources.map(({db})=>db.dropDatabase()));await closeDatabase();
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
