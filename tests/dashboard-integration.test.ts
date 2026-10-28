import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,database,closeDatabase,scope} from '../src/store.ts';
import {activityHistory,dashboardDetails} from '../src/dashboard.ts';
import {PURCHASE_MODE,SALES_MODE} from '../src/purchase-domain.ts';

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
