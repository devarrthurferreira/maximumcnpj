import {collection,scope} from './store.ts';
import {digest,need} from './security.ts';
import {write} from './lookup-db.ts';
import type {LookupActor} from './lookup-db.ts';

type RetentionInput={analysisId:string;clientId:string;currentId:string|null;leaseOwner:string;chooseLatest?:boolean};

/** Called while the analysis lease is held. Sector data and source imports are never removed. */
export async function retainLatestAnalysisSimulation(actor:LookupActor,input:RetentionInput){
  write(actor);
  const {analysisId,clientId,leaseOwner}=input,c=await collection('simulations'),analyses=await collection('analyses');
  const locked=()=>scope({_id:analysisId,clientId,leaseOwner,leaseUntil:{$gt:new Date()},deletionStartedAt:{$exists:false}});
  const item=await analyses.findOne(locked());
  need(item,'A análise mudou durante a limpeza. Abra a empresa e tente novamente.',409,'ANALYSIS_CONFLICT');
  let currentId=input.currentId;
  const canonical=item.currentSimulation?.id;
  if(canonical){
    // Publication is a second write after the authoritative analysis CAS. Repair an interrupted publication first.
    await c.updateOne(scope({_id:canonical,clientId,analysisId,analysisRevision:item.currentSimulation.analysisRevision,analysisPublication:'PENDING',deletedAt:{$exists:false}}),
      {$set:{analysisPublication:'PUBLISHED'}});
  }
  if(input.chooseLatest){
    // An unpromoted automatic recalculation can be newer by time while using old inputs. The managed pointer wins.
    const latest=await c.find(scope({clientId,...(item.activated?{_id:canonical||null}:{}),deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}}))
      .project({_id:1,analysisId:1,analysisRevision:1,createdAt:1,modelVersion:1}).sort({createdAt:-1,_id:-1}).limit(1).next();
    if(latest){
      need(!latest.analysisId||latest.analysisId===analysisId,'Há uma versão vinculada a outra análise. Confira a empresa antes da limpeza.',409,'ANALYSIS_INCONSISTENT');
      currentId=latest._id;
      if(item.currentSimulation?.id!==currentId){
        const changed=await analyses.updateOne({...locked(),revision:item.revision},{$set:{currentSimulation:{id:currentId,
          analysisRevision:latest.analysisRevision??null,createdAt:latest.createdAt,modelVersion:latest.modelVersion??null,legacy:!latest.analysisId}}});
        need(changed.matchedCount===1,'A análise mudou durante a limpeza.',409,'ANALYSIS_CONFLICT');
      }
    }
  }
  if(currentId){
    need(await c.findOne(scope({_id:currentId,clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}}),{projection:{_id:1}}),
      'A última DRE precisa estar salva antes da limpeza.',409,'ANALYSIS_CURRENT_UNAVAILABLE');
    need(await analyses.findOne({...locked(),'currentSimulation.id':currentId}),
      'A DRE atual mudou durante a limpeza.',409,'ANALYSIS_CONFLICT');
  }
  const obsolete={$or:[{analysisPublication:{$ne:'PENDING'}},{analysisId,analysisRevision:{$lte:item.revision}}]};
  const candidates=currentId?await c.find(scope({clientId,_id:{$ne:currentId},...obsolete}))
    .project({_id:1,analysisId:1,createdAt:1}).toArray():[];
  need(candidates.every(row=>!row.analysisId||row.analysisId===analysisId),
    'Há versões vinculadas a outra análise. A limpeza foi bloqueada.',409,'ANALYSIS_INCONSISTENT');
  const ids=candidates.map(row=>row._id);
  if(ids.length){
    need(!await analyses.findOne(scope({_id:{$ne:analysisId},$or:[{'currentSimulation.id':{$in:ids}},{'legacyReference.simulationId':{$in:ids}}]}),{projection:{_id:1}}),
      'Há uma versão compartilhada com outra análise. A limpeza foi bloqueada.',409,'ANALYSIS_INCONSISTENT');
    need(await analyses.findOne({...locked(),'currentSimulation.id':currentId}),
      'A análise mudou durante a limpeza.',409,'ANALYSIS_CONFLICT');
    // Normalize batch completions before deleting any obsolete child, independently of snapshot iteration order.
    await(await collection('simulationReprocessItems')).updateMany(scope({originalId:{$in:ids}}),{$set:{childId:currentId,status:'OK',code:'UPDATED',
      message:'Última DRE salva disponível; a versão anterior foi removida.',updatedAt:new Date()},$unset:{processingOwner:''}});
  }
  let removed=0;
  for(const row of candidates){
    need(await analyses.findOne({...locked(),'currentSimulation.id':currentId}),
      'A análise mudou durante a limpeza.',409,'ANALYSIS_CONFLICT');
    // The same compact receipt used by explicit deletion prevents delayed retries from recreating an old result.
    const receiptId='simulation-delete:'+digest(JSON.stringify([scope().workspaceId,row._id]));
    await(await collection('audit')).updateOne(scope({_id:receiptId}),{$setOnInsert:{...scope(),actor:actor._id,action:'simulation.delete',
      target:row._id,analysisId,reason:'SUPERSEDED',replacementId:currentId,createdAt:new Date()}},{upsert:true});
    removed+=(await c.deleteOne(scope({_id:row._id,clientId,...obsolete}))).deletedCount;
    const reprocessing=await collection('simulationReprocessItems');
    await reprocessing.deleteMany(scope({childId:row._id}));
    await(await collection('analysisGenerationRequests')).deleteMany(scope({analysisId,simulationId:row._id}));
  }
  // Current Fiscal and Accounting live in analyses; revisions no longer retain copies of their payloads.
  const revisions=await(await collection('analysisRevisions')).deleteMany(scope({analysisId,clientId}));
  return {analysisId,clientId,currentId,removed,removedRevisions:revisions.deletedCount};
}
