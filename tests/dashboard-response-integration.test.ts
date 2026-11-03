import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection,database,closeDatabase,scope} from '../src/store.ts';
import {ensureLookupIndexes,resetLookupIndexes} from '../src/lookup-db.ts';
import {routeV4} from '../src/lookup-http.ts';
import {storageDatabases,STORAGE_VERSION} from '../src/mongo-storage.ts';

const actor={_id:'dashboard-reader',role:'viewer',name:'Leitura sintética',email:'dashboard@example.test'};
const read=(path:string):Promise<any>=>routeV4(actor,'GET',new URL('https://example.test/api/v4'+path),{});

test('dashboard overview avoids all-time classification and lazy details preserve complete results and workspace scope',
  {skip:!process.env.MONGODB_URI,timeout:60000},async t=>{
  const keys=['MONGODB_DB','WORKSPACE_ID','MONGODB_URI_2','MONGODB_URI_3'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  process.env.MONGODB_DB='dashboard_response_'+randomUUID().replaceAll('-','');
  process.env.WORKSPACE_ID='dashboard-response';delete process.env.MONGODB_URI_2;delete process.env.MONGODB_URI_3;
  resetLookupIndexes();
  try{
    await ensureLookupIndexes();
    const clientId=randomUUID(),otherClientId=randomUUID(),now=new Date(),old=new Date(now.getTime()-86400000*60);
    await(await collection('clients')).insertMany([
      {_id:clientId,...scope(),code:'991',name:'Empresa principal',active:true,createdAt:now},
      {_id:otherClientId,...scope(),code:'992',name:'Outra empresa',active:true,createdAt:now},
      {_id:randomUUID(),workspaceId:'hidden',code:'993',name:'Empresa isolada',active:true,createdAt:now}
    ]);
    const jobs=[
      {_id:randomUUID(),...scope(),clientId,status:'COMPLETED',createdAt:old},
      {_id:randomUUID(),...scope(),clientId,status:'COMPLETED',createdAt:now},
      {_id:randomUUID(),...scope(),clientId,status:'PROCESSING',createdAt:now},
      {_id:randomUUID(),...scope(),clientId:otherClientId,status:'COMPLETED',createdAt:now},
      {_id:randomUUID(),workspaceId:'hidden',clientId,status:'COMPLETED',createdAt:now}
    ].map(job=>({...job,mode:'LOOKUP',fileName:'Exemplo sintético.csv'}));
    await(await collection('lookupJobs')).insertMany(jobs);
    await(await collection('lookupItems')).insertMany([
      {_id:randomUUID(),...scope(),clientId,jobId:jobs[0]._id,cnpj:'00000000000191',state:'DONE',status:'NAO_OPTANTE',checkedAt:old},
      {_id:randomUUID(),...scope(),clientId,jobId:jobs[1]._id,cnpj:'00000000000191',state:'DONE',status:'OPTANTE',checkedAt:now},
      {_id:randomUUID(),...scope(),clientId,jobId:jobs[1]._id,cnpj:'11222333000181',state:'DONE',status:'NAO_CONFIRMADO',checkedAt:now},
      {_id:randomUUID(),...scope(),clientId,jobId:jobs[2]._id,cnpj:'04252011000110',state:'DONE',status:'OPTANTE',checkedAt:now},
      {_id:randomUUID(),...scope(),clientId:otherClientId,jobId:jobs[3]._id,cnpj:'00000000000191',state:'DONE',status:'NAO_OPTANTE',checkedAt:new Date(now.getTime()+1)},
      {_id:randomUUID(),workspaceId:'hidden',clientId,jobId:jobs[4]._id,cnpj:'00000000000191',state:'DONE',status:'NAO_OPTANTE',checkedAt:new Date(now.getTime()+2)}
    ]);
    const calls:{collection:string;method:string;args:any[]}[]=[];
    const patches=['find','aggregate','countDocuments'].map(method=>{
      const original=(Collection.prototype as any)[method];
      return t.mock.method(Collection.prototype,method,function(this:Collection,...args:any[]){
        calls.push({collection:this.collectionName,method,args});return original.apply(this,args);
      });
    });
    let summary:any;
    try{summary=await read(`/dashboard?summary=1&clientId=${clientId}`);}
    finally{patches.forEach(patch=>patch.mock.restore());}
    assert.equal(summary.classificationDeferred,true);
    for(const key of ['metrics','entities','recent'])assert.equal(Object.hasOwn(summary,key),false,`${key} must be deferred, never zero-filled.`);
    assert.equal(summary.clientCount,2);assert.equal(summary.activity.queriesLast7Days,3);
    assert.equal(summary.historyCount,3);assert.equal(summary.recentActivity.length,3);
    assert.equal(calls.filter(call=>call.collection==='cnpjEntities').length,0);
    assert.equal(calls.filter(call=>call.collection==='lookupJobs'&&call.method==='find'&&call.args[0]?.status==='COMPLETED').length,0);
    const itemReads=calls.filter(call=>call.collection==='lookupItems');
    assert.equal(itemReads.length,1,'Overview reads only the seven-day activity, not all historical CNPJ observations.');
    assert.equal(itemReads[0].method,'aggregate');
    assert(itemReads[0].args[0][0].$match.checkedAt.$gte instanceof Date);
    assert(itemReads[0].args[0][0].$match.checkedAt.$lte instanceof Date);
    const activityStages=calls.find(call=>call.collection==='lookupJobs'&&call.method==='aggregate'&&call.args[0].some((stage:any)=>stage.$facet))?.args[0];
    assert(activityStages,'The overview must include its scoped activity history.');
    assert.equal(activityStages.filter((stage:any)=>stage.$lookup?.from==='clients').length,0,
      'An unfiltered history must not enrich every event with a company lookup.');
    const pageStages=activityStages.find((stage:any)=>stage.$facet).$facet.items;
    assert(pageStages.findIndex((stage:any)=>stage.$lookup?.from==='clients')>pageStages.findIndex((stage:any)=>stage.$limit),
      'Company enrichment is bounded by the displayed page.');
    assert(activityStages.findIndex((stage:any)=>stage.$lookup?.from==='audit')<activityStages.findIndex((stage:any)=>stage.$facet),
      'Deletion receipts must filter totals and pagination before company enrichment.');
    const detail=await read(`/dashboard/classification?clientId=${clientId}`);
    const complete=await read(`/dashboard?clientId=${clientId}`);
    assert.deepEqual(detail.metrics,complete.metrics);
    assert.equal(detail.metrics.total,2);assert.equal(detail.metrics.optants,1);assert.equal(detail.metrics.nonOptants,0);
    assert.equal(detail.metrics.unknown,1);assert.equal(detail.metrics.reportingNonOptants,1);
    assert.equal(detail.metrics.optantsPercent,50);assert.equal(detail.metrics.reportingNonOptantsPercent,50);
    assert.equal(complete.clientCount,summary.clientCount);assert.equal(complete.historyCount,summary.historyCount);
    assert.equal(complete.entities,0);assert.equal(complete.recent.length,3);
    const other=await read(`/dashboard/classification?clientId=${otherClientId}`);
    assert.equal(other.metrics.total,1);assert.equal(other.metrics.optants,0);assert.equal(other.metrics.nonOptants,1);
    process.env.WORKSPACE_ID='empty-dashboard-workspace';
    const empty=await read('/dashboard/classification');assert.equal(empty.metrics.total,0);
    const emptySummary=await read('/dashboard?summary=1');assert.equal(emptySummary.clientCount,0);assert.equal(emptySummary.historyCount,0);
    assert.equal(await(await collection('lookupJobs')).countDocuments({workspaceId:'dashboard-response'}),4,'Reading dashboard keeps source jobs intact.');
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('lazy classification reconciles duplicate CNPJs across storage banks and agrees with the complete dashboard',
  {skip:!process.env.MONGODB_URI||!process.env.MONGODB_TEST_URI_2||!process.env.MONGODB_TEST_URI_3,timeout:60000},async()=>{
  const keys=['MONGODB_DB','MONGODB_URI_2','MONGODB_URI_3','MONGODB_DB_2','MONGODB_DB_3','WORKSPACE_ID'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),suffix=randomUUID().replaceAll('-','');
  process.env.MONGODB_DB='dashboard_classification_1_'+suffix;process.env.MONGODB_DB_2='dashboard_classification_2_'+suffix;
  process.env.MONGODB_DB_3='dashboard_classification_3_'+suffix;process.env.WORKSPACE_ID='dashboard-classification-pool';
  process.env.MONGODB_URI_2=process.env.MONGODB_TEST_URI_2;process.env.MONGODB_URI_3=process.env.MONGODB_TEST_URI_3;
  resetLookupIndexes();let sources:Awaited<ReturnType<typeof storageDatabases>>=[];
  try{
    await ensureLookupIndexes();sources=await storageDatabases();
    const clientId=randomUUID(),now=new Date();
    await(await collection('clients')).insertOne({_id:clientId,...scope(),code:'997',name:'Par distribuído sintético',active:true,createdAt:now});
    const jobs=sources.map(({slot})=>({_id:`00000000-0000-4000-8000-00000000000${slot}`,...scope(),clientId,
      storageVersion:STORAGE_VERSION,storageSlot:slot,mode:'LOOKUP',status:'COMPLETED',createdAt:now,fileName:`Banco ${slot}.csv`}));
    await(await collection('lookupJobs')).insertMany(jobs);
    await(await collection('storageControl')).insertOne({_id:'mongo-storage-pool-v1',activeSlot:3});
    for(const {slot,db} of sources){
      const job=jobs.find(item=>item.storageSlot===slot)!;
      await db.collection('lookupItems').insertOne({_id:randomUUID(),...scope(),clientId,jobId:job._id,
        cnpj:'00000000000191',state:'DONE',status:slot===3?'OPTANTE':'NAO_OPTANTE',checkedAt:now});
    }
    const detail=await read(`/dashboard/classification?clientId=${clientId}`);
    assert.equal(detail.metrics.total,1);assert.equal(detail.metrics.optants,1);assert.equal(detail.metrics.nonOptants,0);
    const complete=await read(`/dashboard?clientId=${clientId}`);
    assert.deepEqual(detail.metrics,complete.metrics);assert.equal(complete.activity.queriesLast7Days,3);
    const summary=await read(`/dashboard?summary=1&clientId=${clientId}`);
    assert.equal(summary.classificationDeferred,true);assert.equal(summary.activity.queriesLast7Days,3);
    assert.equal(summary.storage.configuredSlots,3);assert.equal(Object.hasOwn(summary,'metrics'),false);
  }finally{
    await Promise.all(sources.map(({db})=>db.dropDatabase()));await closeDatabase();resetLookupIndexes();
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
