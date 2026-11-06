import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {simulationHistory} from '../src/simulation-history.ts';

test('MongoDB histórico escolhe uma DRE atual por empresa antes de aplicar busca e ano',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_latest_history_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='latest_history_test';
  const companyA=randomUUID(),companyB=randomUUID(),companyC=randomUUID(),bridgeCompany=randomUUID(),analysisId=randomUUID();
  const make=(clientId:string,title:string,year:number,date:string,extra:Record<string,unknown>={})=>({_id:randomUUID(),...scope(),clientId,generationId:randomUUID(),title,company:{name:'Empresa '+clientId,code:'990'},
    year,createdAt:new Date(date),createdBy:{id:'operator',name:'Operador sintético'},reportMonths:1,annualRevenue:100,
    result:{method:'REPORT_MONTHS_V1'},partialData:{status:'INCOMPLETE',missingSectors:['accounting'],warning:'Fixture sintética'},...extra});
  try{
    const c=await collection('simulations'),analyses=await collection('analyses');
    const current=make(companyA,'Atual gerenciada',2027,'2026-10-01T12:00:00Z',{analysisId,analysisRevision:2,analysisPublication:'PUBLISHED'});
    const older=make(companyA,'Antiga gerenciada',2028,'2026-09-01T12:00:00Z',{analysisId,analysisPublication:'PUBLISHED'});
    const unpromoted=make(companyA,'Filha não promovida',2028,'2026-11-01T12:00:00Z',{analysisId,parentSimulationId:current._id,reprocessing:{version:'V_TEST',originalId:current._id}});
    const independentOld=make(companyB,'Anterior independente',2027,'2026-09-01T12:00:00Z');
    const latest=make(companyB,'Atual [independente]',2028,'2026-11-02T12:00:00Z');
    const bridgeOld=make(bridgeCompany,'Ponte antiga',2027,'2026-08-01T12:00:00Z'),bridgeLatest=make(bridgeCompany,'Ponte última',2028,'2026-11-03T12:00:00Z');
    const beingDeleted=make(companyC,'Em exclusão',2027,'2026-11-05T12:00:00Z');
    await c.insertMany([current,older,unpromoted,independentOld,latest,bridgeOld,bridgeLatest,beingDeleted,
      make(companyB,'Pendente',2027,'2026-11-03T12:00:00Z',{analysisPublication:'PENDING'}),
      make(companyB,'Excluída',2027,'2026-11-04T12:00:00Z',{deletedAt:new Date()}),
      make(companyA,'Outra organização',2028,'2026-11-05T12:00:00Z',{workspaceId:'outside'})]);
    await analyses.insertMany([
      {_id:analysisId,...scope(),clientId:companyA,activated:true,currentSimulation:{id:current._id,analysisRevision:2},revision:2},
      {_id:randomUUID(),...scope(),clientId:bridgeCompany,activated:false,currentSimulation:{id:bridgeOld._id}},
      {_id:randomUUID(),...scope(),clientId:companyC,activated:true,currentSimulation:{id:beingDeleted._id},deletionStartedAt:new Date()}
    ]);
    await t.test('antes da limpeza física, mostra atual canônica ou mais recente e mantém projeção leve',async()=>{
      const list=await simulationHistory(1);assert.equal(list.total,3);assert.equal(list.page,1);assert.equal(list.pageSize,20);
      assert.deepEqual(new Set(list.items.map(item=>item._id)),new Set([current._id,latest._id,bridgeLatest._id]));
      const managed=list.items.find(item=>item._id===current._id)!;assert.equal(managed.currentAnalysisId,analysisId);assert.equal(managed.analysisProtected,true);
      assert.equal(managed.updatedSimulationId,null,'A filha não promovida não ganha link no card atual.');
      assert.deepEqual(managed.partialData,current.partialData);assert.equal(managed.calculationMethod,'REPORT_MONTHS_V1');
      assert.equal(managed.result,undefined);assert.equal(managed.workspaceId,undefined);
      assert.equal(await c.countDocuments(scope()),10,'A listagem não apaga registros nem seus dados.');
    });
    await t.test('busca e ano não fazem versões antigas reaparecer',async()=>{
      assert.equal((await simulationHistory(1,{year:'2028'})).total,2);
      assert.equal((await simulationHistory(1,{year:'2027'})).items[0]._id,current._id);
      for(const search of ['Antiga gerenciada','Filha não promovida','Anterior independente','Ponte antiga','Em exclusão'])assert.equal((await simulationHistory(1,{search})).total,0,search);
      assert.equal((await simulationHistory(1,{search:'[independente]'})).items[0]._id,latest._id);
      assert.equal((await simulationHistory(1,{clientId:companyA,year:'2028'})).total,0);
      assert.equal((await simulationHistory(1,{clientId:companyA})).items[0]._id,current._id);
      assert.deepEqual((await simulationHistory(2)).items,[]);
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
