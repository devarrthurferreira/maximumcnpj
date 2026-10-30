import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,collection,scope,closeDatabase} from '../src/store.ts';
import {mongoDatabase,storageConfigs,storageStats} from '../src/mongo-connections.ts';
import {insertStoredJob,jobCollection,jobDatabase,jobStorageReservation,storagePoolStatus,storageDatabases} from '../src/mongo-storage.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';

const enabled=Boolean(process.env.MONGODB_URI&&process.env.MONGODB_TEST_URI_2&&process.env.MONGODB_TEST_URI_3);
test('three disposable MongoDB servers: sequential capacity, restart, identity and existing history', {skip:!enabled,timeout:120000},async t=>{
  const keys=['MONGODB_DB','MONGODB_URI_2','MONGODB_URI_3','MONGODB_DB_2','MONGODB_DB_3','MONGODB_STORAGE_LIMIT_BYTES','MONGODB_STORAGE_LIMIT_BYTES_2','MONGODB_STORAGE_LIMIT_BYTES_3','MONGODB_ROLLOVER_PERCENT','WORKSPACE_ID'] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const name='maximum_pool_'+randomUUID().replaceAll('-','');
  Object.assign(process.env,{MONGODB_DB:name,MONGODB_DB_2:name,MONGODB_DB_3:name,
    MONGODB_URI_2:process.env.MONGODB_TEST_URI_2,MONGODB_URI_3:process.env.MONGODB_TEST_URI_3,
    MONGODB_STORAGE_LIMIT_BYTES:'100000000',MONGODB_STORAGE_LIMIT_BYTES_2:'100000000',MONGODB_STORAGE_LIMIT_BYTES_3:'100000000',MONGODB_ROLLOVER_PERCENT:'85',WORKSPACE_ID:'pool-test'});
  await closeDatabase();resetLookupIndexes();
  const fresh=()=>({_id:randomUUID(),...scope(),clientId:'synthetic-client',expectedRows:1,status:'UPLOADING',createdAt:new Date()});
  const primary=await database(),second=await mongoDatabase(2),third=await mongoDatabase(3);
  try{
    let first:any,secondJob:any,thirdJob:any;
    await t.test('first new payload stays in1 and immutable legacy data remains readable',async()=>{
      const legacy=fresh();await(await collection('lookupJobs')).insertOne(legacy);
      await(await jobCollection('purchaseLines',legacy)).insertOne({_id:'legacy-line',...scope(),jobId:legacy._id,totalCents:12345});
      first=await insertStoredJob(fresh());assert.equal(first.storageSlot,1);
      assert.equal((await(await jobCollection('purchaseLines',legacy._id)).findOne(scope({_id:'legacy-line'})))?.totalCents,12345);
      assert.equal((await(await collection('lookupJobs')).findOne({_id:legacy._id}))?.storageSlot,undefined);
    });
    await t.test('reservation and threshold advance1→2; reading the first source still uses1',async()=>{
      process.env.MONGODB_STORAGE_LIMIT_BYTES='1';
      secondJob=await insertStoredJob(fresh());assert.equal(secondJob.storageSlot,2);
      await(await jobCollection('purchaseLines',secondJob)).insertOne({_id:'second-line',...scope(),jobId:secondJob._id,totalCents:67890});
      assert.equal(await primary.collection('purchaseLines').countDocuments({_id:'second-line'}),0);
      assert.equal(await second.collection('purchaseLines').countDocuments({_id:'second-line'}),1);
      assert.equal(await jobDatabase(first),primary);
      assert.equal((await storagePoolStatus()).activeSlot,2);
    });
    await t.test('concurrent distinct imports cannot consume the same remaining reservation',async()=>{
      const config=storageConfigs()[1],stats=await storageStats(config),reservation=jobStorageReservation(1);
      assert.notEqual(stats.usedBytes,null);
      process.env.MONGODB_STORAGE_LIMIT_BYTES_2=String(Math.ceil((stats.usedBytes!+reservation*2.5)/.85));
      const allocated=await Promise.all([insertStoredJob(fresh()),insertStoredJob(fresh())]);
      assert.deepEqual(allocated.map(job=>job.storageSlot).sort(),[2,3]);
      assert.equal((await storagePoolStatus()).activeSlot,3);
    });
    await t.test('2→3 persists across closed connections; old values remain on their original destination',async()=>{
      process.env.MONGODB_STORAGE_LIMIT_BYTES_2='1';
      thirdJob=await insertStoredJob(fresh());assert.equal(thirdJob.storageSlot,3);
      await(await jobCollection('purchaseLines',thirdJob)).insertOne({_id:'third-line',...scope(),jobId:thirdJob._id,totalCents:24680});
      await closeDatabase();resetLookupIndexes();
      assert.equal((await(await jobCollection('purchaseLines',secondJob._id)).findOne(scope({_id:'second-line'})))?.totalCents,67890);
      assert.equal((await(await jobCollection('purchaseLines',thirdJob._id)).findOne(scope({_id:'third-line'})))?.totalCents,24680);
      process.env.MONGODB_STORAGE_LIMIT_BYTES='100000000';process.env.MONGODB_STORAGE_LIMIT_BYTES_2='100000000';
      assert.equal((await insertStoredJob(fresh())).storageSlot,1,'Capacity released in1 can serve a new job without moving older sources.');
      assert.equal((await(await jobCollection('purchaseLines',thirdJob._id)).findOne(scope({_id:'third-line'})))?.totalCents,24680);
      assert.deepEqual((await storagePoolStatus()).usedSlots,[1,2,3]);
    });
    await t.test('concurrent same-id inserts keep exactly one central route and do not clone identity',async()=>{
      const job=fresh(),results=await Promise.allSettled([insertStoredJob(job),insertStoredJob(job)]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(await(await collection('lookupJobs')).countDocuments({_id:job._id}),1);
      assert.equal(await(await mongoDatabase(2)).collection('lookupJobs').countDocuments({_id:job._id}),0);
      assert.equal(await(await mongoDatabase(3)).collection('lookupJobs').countDocuments({_id:job._id}),0);
    });
    await t.test('missing historical destination is an explicit error, never empty or primary data',async()=>{
      const uri=process.env.MONGODB_URI_3;delete process.env.MONGODB_URI_3;
      try{await assert.rejects(jobCollection('purchaseLines',thirdJob._id),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');
        await assert.rejects(storageDatabases({usedOnly:true}),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');}
      finally{process.env.MONGODB_URI_3=uri;}
    });
    await t.test('removing all secondary URIs after rollover cannot silently re-enable primary writes',async()=>{
      const secondUri=process.env.MONGODB_URI_2,thirdUri=process.env.MONGODB_URI_3,job=fresh();
      delete process.env.MONGODB_URI_2;delete process.env.MONGODB_URI_3;
      try{
        await assert.rejects(insertStoredJob(job),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');
        await assert.rejects(storagePoolStatus(),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');
        assert.equal(await(await collection('lookupJobs')).countDocuments({_id:job._id}),0);
      }finally{process.env.MONGODB_URI_2=secondUri;process.env.MONGODB_URI_3=thirdUri;}
    });
    await t.test('full pool rejects the new unit and preserves all existing sources',async()=>{
      process.env.MONGODB_STORAGE_LIMIT_BYTES='1';process.env.MONGODB_STORAGE_LIMIT_BYTES_2='1';process.env.MONGODB_STORAGE_LIMIT_BYTES_3='1';const job=fresh();
      await assert.rejects(insertStoredJob(job),(error:any)=>error.code==='STORAGE_POOL_FULL');
      assert.equal(await(await collection('lookupJobs')).countDocuments({_id:job._id}),0);
      assert.equal((await(await jobCollection('purchaseLines',thirdJob)).findOne(scope({_id:'third-line'})))?.totalCents,24680);
    });
    await t.test('local dbStats is labelled partial and uses logical BSON, never allocated compression',async()=>{
      const config=storageConfigs()[2],stats=await storageStats(config);
      assert.equal(stats.scope,'DATABASE');assert.equal(stats.status,'AVAILABLE');
      const raw=await(await mongoDatabase(3)).command({dbStats:1,scale:1});
      assert.equal(stats.usedBytes,raw.dataSize+raw.indexSize);
      assert(jobStorageReservation(1)>raw.dataSize);
    });
    await t.test('unavailable active server is not interpreted as empty or moved back to an old destination',async()=>{
      const saved=process.env.MONGODB_URI_3,job=fresh();
      process.env.MONGODB_URI_3='mongodb://127.0.0.1:27999';
      try{await assert.rejects(insertStoredJob(job),(error:any)=>error.code==='STORAGE_MEASUREMENT_UNAVAILABLE');
        assert.equal(await(await collection('lookupJobs')).countDocuments({_id:job._id}),0);}
      finally{process.env.MONGODB_URI_3=saved;}
    });
    await t.test('a malformed additional connection cannot block primary authentication or change stored data',async()=>{
      const saved=process.env.MONGODB_URI_3;process.env.MONGODB_URI_3='invalid-additional-uri';
      try{
        await closeDatabase();resetLookupIndexes();
        assert.equal(await(await collection('sessions')).countDocuments(scope()),0);
        assert.equal((await(await collection('lookupJobs')).findOne({_id:first._id}))?.storageSlot,1);
        await assert.rejects(insertStoredJob(fresh()),(error:any)=>error.code==='STORAGE_CONFIGURATION');
      }finally{process.env.MONGODB_URI_3=saved;}
    });
  }finally{
    // Cleanup is restricted to uniquely named disposable databases created by this test.
    for(const slot of [1,2,3] as const)await(await mongoDatabase(slot)).dropDatabase();
    await closeDatabase();resetLookupIndexes();
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
});
