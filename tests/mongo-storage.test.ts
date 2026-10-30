import test from 'node:test';
import assert from 'node:assert/strict';
import {storageConfigs,rolloverPercent,measuredStorage,isStorageQuotaError,isAtlasConnection,DEFAULT_STORAGE_LIMIT} from '../src/mongo-connections.ts';
import {jobStorageSlot,jobStorageReservation,STORAGE_VERSION} from '../src/mongo-storage.ts';

const env={MONGODB_URI:'mongodb://127.0.0.1:27017',MONGODB_DB:'synthetic_primary'};
test('pool: one database remains compatible and extra database names inherit the primary',()=>{
  assert.deepEqual(storageConfigs(env),[{slot:1,uri:env.MONGODB_URI,database:'synthetic_primary',limitBytes:DEFAULT_STORAGE_LIMIT}]);
  const configs=storageConfigs({...env,MONGODB_URI_2:'mongodb://127.0.0.1:27018',MONGODB_URI_3:'mongodb://127.0.0.1:27019',MONGODB_DB_3:'synthetic_third',MONGODB_STORAGE_LIMIT_BYTES_2:'10000000'});
  assert.deepEqual(configs.map(({slot,database,limitBytes})=>({slot,database,limitBytes})),[
    {slot:1,database:'synthetic_primary',limitBytes:DEFAULT_STORAGE_LIMIT},{slot:2,database:'synthetic_primary',limitBytes:10000000},{slot:3,database:'synthetic_third',limitBytes:DEFAULT_STORAGE_LIMIT}]);
  assert.equal(rolloverPercent({}),85);assert.equal(rolloverPercent({MONGODB_ROLLOVER_PERCENT:'90'}),90);
});
test('pool: incomplete configuration, duplicate clusters and unsafe limits are rejected without exposing credentials',()=>{
  for(const addition of [
    {MONGODB_URI_3:'mongodb://127.0.0.1:27019'},
    {MONGODB_URI_2:'mongodb://example-user:example-password@127.0.0.1:27017/another_database'},
    {MONGODB_URI_2:'not-a-mongodb-uri'},
    {MONGODB_URI_2:'mongodb://127.0.0.1:27018',MONGODB_DB_2:'invalid/name'},
    {MONGODB_STORAGE_LIMIT_BYTES:'-1'}, {MONGODB_STORAGE_LIMIT_BYTES:'NaN'}, {MONGODB_STORAGE_LIMIT_BYTES:'0'}
  ])assert.throws(()=>storageConfigs({...env,...addition}),(error:any)=>error.code==='STORAGE_CONFIGURATION'&&!/example-password|example-user/.test(error.message));
  for(const [primary,secondary] of [
    ['mongodb://mongo.example','mongodb://mongo.example:27017/other'],
    ['mongodb://mongo.example:27017,replica.example:27017','mongodb://replica.example:27017,third.example:27017'],
    ['mongodb://[::1]','mongodb://[::1]:27017']
  ])assert.throws(()=>storageConfigs({...env,MONGODB_URI:primary,MONGODB_URI_2:secondary}),(error:any)=>error.code==='STORAGE_CONFIGURATION');
  for(const value of ['0','49','91','100','NaN'])assert.throws(()=>rolloverPercent({MONGODB_ROLLOVER_PERCENT:value}));
});
test('pool: a saved destination never silently falls back to the primary',()=>{
  assert.equal(jobStorageSlot({}),1);
  for(const slot of [1,2,3])assert.equal(jobStorageSlot({storageSlot:slot,storageVersion:STORAGE_VERSION}),slot);
  for(const data of [{storageSlot:2},{storageVersion:STORAGE_VERSION},{storageSlot:true,storageVersion:STORAGE_VERSION},{storageSlot:4,storageVersion:STORAGE_VERSION},{storageSlot:2,storageVersion:'future'}]){
    assert.throws(()=>jobStorageSlot(data),(error:any)=>error.code==='STORAGE_ROUTE');
  }
});
test('pool: capacity counts uncompressed data and indexes, including every Atlas database',()=>{
  const config=storageConfigs({...env,MONGODB_STORAGE_LIMIT_BYTES:'1000'})[0];
  const atlas=measuredStorage(config,{atlasSize:700,totals:{dataSize:600,indexSize:100,storageSize:30}},'CLUSTER');
  assert.equal(atlas.usedBytes,700);assert.equal(atlas.remainingBytes,300);assert.equal(atlas.usedPercent,70);assert.equal(atlas.scope,'CLUSTER');
  const local=measuredStorage(config,{dataSize:600,indexSize:100,storageSize:30,totalSize:130},'DATABASE');
  assert.equal(local.usedBytes,700);assert.equal(local.scope,'DATABASE');
  assert.equal(measuredStorage(config,null,'CLUSTER').usedBytes,null);
  assert.equal(measuredStorage(config,{atlasSize:NaN},'CLUSTER').status,'UNAVAILABLE');
  assert.equal(measuredStorage(config,{dataSize:0,indexSize:0},'DATABASE').usedBytes,0);
  assert.equal(isAtlasConnection({...config,uri:'mongodb+srv://user:example@cluster.mongodb.net/'}),true);
  assert.equal(isAtlasConnection(config),false);
});
test('pool: reservations include the temporary copy; quota is not inferred from code8000 or timeouts',()=>{
  assert(jobStorageReservation(1000)>1000*4096);
  assert.throws(()=>jobStorageReservation(0));assert.throws(()=>jobStorageReservation('1000'));
  assert.equal(isStorageQuotaError({code:8000,message:'bad auth : authentication failed'}),false);
  assert.equal(isStorageQuotaError({code:8000,message:'you are over your space quota, using 513 MB of 512 MB'}),true);
  assert.equal(isStorageQuotaError({name:'MongoNetworkTimeoutError',message:'connection timed out'}),false);
  assert.equal(isStorageQuotaError({writeErrors:[{code:8000,errmsg:'you are over your space quota'}]}),true);
});
test('pool: valid long UTF-8 descriptions are reserved by measured bytes and old clients get a conservative bound',()=>{
  const row={description:'漢'.repeat(2000)},bytes=Buffer.byteLength(JSON.stringify(row),'utf8')+1;
  assert(bytes>6000);
  const measured=jobStorageReservation(10000,bytes*10000),unmeasured=jobStorageReservation(10000);
  assert(measured>bytes*10000*2,'Both temporary and final copies must fit.');
  assert(unmeasured>measured,'A client without byte forecasting cannot receive a smaller reservation.');
  assert.throws(()=>jobStorageReservation(10,-1));assert.throws(()=>jobStorageReservation(10,'100'));
});
