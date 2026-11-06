import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,database,scope,closeDatabase} from '../src/store.ts';
import {cleanupSavedVersions} from '../src/simulation-retention-admin.ts';

test('limpeza do workspace preserva os dois setores e os arquivos, remove só versões substituídas e pode repetir',
  {skip:!process.env.MONGODB_URI,timeout:60000},async()=>{
  const previousDb=process.env.MONGODB_DB,previousWorkspace=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_retention_admin_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='retention-admin';
  const actor={_id:'administrator',name:'Administrador sintético',role:'admin',email:'admin@example.test'};
  try{
    const c=await collection('analyses'),s=await collection('simulations'),r=await collection('analysisRevisions');
    const ids=[];
    for(let index=0;index<2;index++){
      const analysisId=randomUUID(),clientId=randomUUID(),oldId=randomUUID(),currentId=randomUUID();ids.push({analysisId,clientId,currentId,oldId});
      await c.insertOne({_id:analysisId,...scope(),clientId,activated:true,revision:7,
        currentSimulation:{id:currentId,analysisRevision:7},fiscal:{data:{generationId:'real-source-'+index}},accounting:{data:{months:[{sourceMonth:'2026-01',salariesCents:12345}]}}});
      await s.insertMany([{_id:oldId,...scope(),clientId,analysisId,analysisPublication:'PUBLISHED',createdAt:new Date(2020,0,1)},
        {_id:currentId,...scope(),clientId,analysisId,analysisRevision:7,analysisPublication:'PUBLISHED',createdAt:new Date(2026,0,1)}]);
      await r.insertOne({_id:randomUUID(),...scope(),clientId,analysisId,revision:1,data:{sensitiveDuplicate:'old'}});
    }
    await s.insertOne({_id:randomUUID(),workspaceId:'another-workspace',clientId:ids[0].clientId,createdAt:new Date()});
    await(await collection('generations')).insertOne({_id:randomUUID(),...scope(),sentinel:'source'});
    const before=await c.find(scope()).sort({_id:1}).toArray();
    await assert.rejects(cleanupSavedVersions({...actor,role:'operator'},{confirmed:true}),(error:any)=>error.code==='FORBIDDEN');
    await assert.rejects(cleanupSavedVersions(actor,{confirmed:false}),(error:any)=>error.code==='RETENTION_CONFIRMATION');
    assert.equal(await s.countDocuments(scope()),4);
    assert.deepEqual(await cleanupSavedVersions(actor,{confirmed:true}),{companies:2,removed:2,removedRevisions:2,failed:[]});
    assert.equal(await s.countDocuments(scope()),2);assert.equal(await s.countDocuments({workspaceId:'another-workspace'}),1);
    assert.equal(await(await collection('generations')).countDocuments(scope()),1);
    const after=await c.find(scope()).sort({_id:1}).toArray();
    for(let i=0;i<before.length;i++){
      assert.deepEqual(after[i].fiscal,before[i].fiscal);assert.deepEqual(after[i].accounting,before[i].accounting);
      assert.deepEqual(after[i].currentSimulation,before[i].currentSimulation);
    }
    assert.deepEqual(await cleanupSavedVersions(actor,{confirmed:true}),{companies:2,removed:0,removedRevisions:0,failed:[]});
    assert.equal(await(await collection('audit')).countDocuments(scope({action:'simulation.delete',reason:'SUPERSEDED'})),2);
  }finally{
    await(await database()).dropDatabase();await closeDatabase();
    if(previousDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=previousDb;
    if(previousWorkspace===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=previousWorkspace;
  }
});
