import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {retainLatestAnalysisSimulation} from '../src/simulation-retention.ts';
import {promoteReprocessedAnalysis} from '../src/analysis-store.ts';
import {assertSimulationNotDeleted} from '../src/simulation-history.ts';

const errorCode=(code:string)=>(error:any)=>error.code===code;
test('MongoDB retenção: publicação interrompida, revisão canônica, isolamento e promoção',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const savedDb=process.env.MONGODB_DB,savedWorkspace=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_retention_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='retention_test';
  const actor={_id:'retention-operator',role:'operator',name:'Operador sintético',email:'retention@example.test'};
  const analysisId=randomUUID(),clientId=randomUUID(),owner=randomUUID(),currentId=randomUUID(),now=new Date();
  const config={revision:2,year:2027},fiscal={revision:2,status:'COMPLETE',data:{generationId:randomUUID()}},
    accounting={revision:2,status:'COMPLETE',data:{months:[{sourceMonth:'2026-01',salariesCents:12345}]}};
  const current=(id:string)=>({id,analysisRevision:2,createdAt:now,modelVersion:'test-model',legacy:false});
  const base=(id:string,extra:any={})=>({_id:id,...scope(),clientId,analysisId,analysisRevision:2,analysisPublication:'PUBLISHED',
    createdAt:now,modelVersion:'test-model',...extra});
  const input=()=>({analysisId,clientId,currentId,leaseOwner:owner,chooseLatest:true});
  try{
    const analyses=await collection('analyses'),simulations=await collection('simulations');
    await analyses.insertOne({_id:analysisId,...scope(),clientId,activated:true,revision:2,config,fiscal,accounting,
      currentSimulation:current(currentId),leaseOwner:owner,leaseUntil:new Date(Date.now()+120000)});
    await t.test('recupera publicação após CAS e conserva resultado canônico diante de filho não promovido',async()=>{
      const oldId=randomUUID(),staleChildId=randomUUID(),stalePendingId=randomUUID(),futurePendingId=randomUUID();
      await simulations.insertMany([
        base(currentId,{analysisPublication:'PENDING'}),base(oldId,{analysisRevision:1,createdAt:new Date(now.getTime()-10000)}),
        base(staleChildId,{analysisRevision:1,createdAt:new Date(now.getTime()+10000),parentSimulationId:oldId,reprocessing:{originalId:oldId,version:'old-reprocess'}}),
        base(stalePendingId,{analysisRevision:1,analysisPublication:'PENDING'}),
        base(futurePendingId,{analysisRevision:3,analysisPublication:'PENDING'})
      ]);
      await(await collection('analysisRevisions')).insertOne({_id:randomUUID(),...scope(),analysisId,clientId,revision:1,data:{unneededCopy:true}});
      await(await collection('analysisGenerationRequests')).insertOne({_id:randomUUID(),...scope(),analysisId,simulationId:oldId});
      await(await collection('simulationReprocessItems')).insertOne({_id:randomUUID(),...scope(),originalId:oldId,childId:staleChildId});
      const result=await retainLatestAnalysisSimulation(actor,input());
      assert.equal(result.currentId,currentId);assert.equal(result.removed,3);assert.equal(result.removedRevisions,1);
      assert.equal((await simulations.findOne(scope({_id:currentId})))!.analysisPublication,'PUBLISHED');
      assert.equal((await analyses.findOne(scope({_id:analysisId})))!.currentSimulation.id,currentId);
      assert.ok(await simulations.findOne(scope({_id:futurePendingId})),'Uma revisão futura não comprovada não deve ser removida.');
      assert.equal(await(await collection('analysisGenerationRequests')).countDocuments(scope({analysisId})),0);
      const completion=await(await collection('simulationReprocessItems')).findOne(scope({originalId:oldId}));
      assert.equal(completion?.status,'OK');assert.equal(completion?.childId,currentId);
      for(const id of [oldId,staleChildId,stalePendingId]){
        assert.equal(await simulations.findOne(scope({_id:id})),null);
        await assert.rejects(assertSimulationNotDeleted(id),errorCode('SIMULATION_DELETED'));
      }
      await simulations.deleteOne(scope({_id:futurePendingId}));
      const saved=await analyses.findOne(scope({_id:analysisId}));
      assert.deepEqual(saved!.config,config);assert.deepEqual(saved!.fiscal,fiscal);assert.deepEqual(saved!.accounting,accounting);
    });
    await t.test('limpeza exige posse da análise e preserva fontes, outra empresa e outro workspace',async()=>{
      const otherId=randomUUID(),foreignId=randomUUID(),oldId=randomUUID(),generationId=fiscal.data.generationId;
      await simulations.insertMany([base(otherId,{clientId:randomUUID(),analysisId:randomUUID()}),
        base(foreignId,{workspaceId:'other_workspace'}),base(oldId,{analysisRevision:1})]);
      await(await collection('generations')).insertOne({_id:generationId,...scope(),clientId,source:'fixture'});
      await(await collection('lookupJobs')).insertOne({_id:randomUUID(),...scope(),clientId,generationId,source:'fixture'});
      const count=await simulations.countDocuments({});
      await assert.rejects(retainLatestAnalysisSimulation(actor,{...input(),leaseOwner:randomUUID()}),errorCode('ANALYSIS_CONFLICT'));
      await assert.rejects(retainLatestAnalysisSimulation({...actor,role:'viewer'},input()),errorCode('FORBIDDEN'));
      assert.equal(await simulations.countDocuments({}),count);
      const result=await retainLatestAnalysisSimulation(actor,input());assert.equal(result.removed,1);
      assert.ok(await simulations.findOne({_id:otherId}));assert.ok(await simulations.findOne({_id:foreignId}));
      assert.ok(await(await collection('generations')).findOne(scope({_id:generationId})));
      assert.equal(await(await collection('lookupJobs')).countDocuments(scope({clientId,generationId})),1);
    });
    await t.test('vínculo com outra análise bloqueia a remoção sem alterar os dados atuais',async()=>{
      const conflicting=randomUUID();await simulations.insertOne(base(conflicting,{analysisId:randomUUID(),analysisRevision:1}));
      await assert.rejects(retainLatestAnalysisSimulation(actor,input()),errorCode('ANALYSIS_INCONSISTENT'));
      assert.ok(await simulations.findOne(scope({_id:conflicting})));
      assert.equal((await analyses.findOne(scope({_id:analysisId})))!.currentSimulation.id,currentId);
      await simulations.deleteOne(scope({_id:conflicting}));
    });
    await t.test('promoção validada remove o resultado substituído e preserva setores',async()=>{
      await analyses.updateOne(scope({_id:analysisId}),{$unset:{leaseOwner:'',leaseUntil:''}});
      const child=base(randomUUID(),{createdAt:new Date(now.getTime()+20000),parentSimulationId:currentId,reprocessing:{originalId:currentId,version:'test-reprocess'}});
      await simulations.insertOne(child);await promoteReprocessedAnalysis(actor,currentId,child);
      const saved=await analyses.findOne(scope({_id:analysisId}));assert.equal(saved!.currentSimulation.id,child._id);
      assert.equal(await simulations.findOne(scope({_id:currentId})),null);assert.ok(await simulations.findOne(scope({_id:child._id})));
      assert.deepEqual(saved!.config,config);assert.deepEqual(saved!.fiscal,fiscal);assert.deepEqual(saved!.accounting,accounting);
      assert.equal(saved!.leaseOwner,undefined);await assert.rejects(assertSimulationNotDeleted(currentId),errorCode('SIMULATION_DELETED'));
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();
    if(savedDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=savedDb;
    if(savedWorkspace===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=savedWorkspace;
  }
});
