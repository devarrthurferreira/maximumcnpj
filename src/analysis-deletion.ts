import {collection,scope} from './store.ts';
import type {Doc} from './store.ts';
import {digest,need} from './security.ts';

export type AnalysisDeletionReceipt=Doc & {action:'analysis.delete';target:string;clientId:string;revision:number;
  actor:string;createdAt:Date;legacySimulationIds:string[]};
const receiptId=(id:string)=>'analysis-delete:'+digest(JSON.stringify([scope().workspaceId,id]));

export async function analysisDeletion(id:string):Promise<AnalysisDeletionReceipt|null>{
  return await(await collection('audit')).findOne(scope({_id:receiptId(id),action:'analysis.delete',target:id})) as AnalysisDeletionReceipt|null;
}

/** Also hide the short interval before the durable receipt has been written. */
export async function analysisDeletionStarted(id:string){
  return !!await analysisDeletion(id) || !!await(await collection('analyses')).findOne(
    scope({_id:id,deletionStartedAt:{$exists:true}}),{projection:{_id:1}});
}

export async function assertAnalysisNotDeleted(id:string){
  need(!await analysisDeletionStarted(id),'Esta análise foi excluída. Abra uma nova análise da empresa para continuar.',409,'ANALYSIS_DELETED');
}

/** Legacy adoption does not rewrite snapshots; follow only verified automatic-reprocessing lineage. */
export async function simulationAnalysisDeletionStarted(snapshot:Doc){
  const visited=new Set<string>();let current:Doc|null=snapshot;
  while(current && !visited.has(current._id)){
    visited.add(current._id);
    if(current.analysisId && await analysisDeletionStarted(current.analysisId))return true;
    if(await(await collection('audit')).findOne(scope({action:'analysis.delete',clientId:snapshot.clientId,legacySimulationIds:current._id}),{projection:{_id:1}}))return true;
    if(await(await collection('analyses')).findOne(scope({clientId:snapshot.clientId,deletionStartedAt:{$exists:true},
      $or:[{'currentSimulation.id':current._id},{'legacyReference.simulationId':current._id}]}),{projection:{_id:1}}))return true;
    if(!current.reprocessing || current.reprocessing.originalId!==current.parentSimulationId)break;
    const parentId:string=current.parentSimulationId;
    const removed=await(await collection('audit')).findOne(scope({_id:'simulation-delete:'+digest(JSON.stringify([scope().workspaceId,parentId])),
      action:'simulation.delete',target:parentId,analysisId:{$exists:true}}),{projection:{analysisId:1}});
    if(removed){const receipt=await analysisDeletion(removed.analysisId);if(receipt?.clientId===snapshot.clientId)return true;}
    current=await(await collection('simulations')).findOne(scope({_id:parentId,clientId:snapshot.clientId,generationId:current.generationId}),
      {projection:{_id:1,clientId:1,generationId:1,analysisId:1,parentSimulationId:1,'reprocessing.originalId':1}});
  }
  return false;
}

/** A new analysis must not silently adopt independent history left by a previous deletion. */
export async function companyHasAnalysisDeletion(clientId:string){
  return !!await(await collection('audit')).findOne(scope({action:'analysis.delete',clientId}),{projection:{_id:1}});
}

/** Only linkage, revision, authorship and time survive; no fiscal drafts or calculation results. */
export async function reserveAnalysisDeletion(value:{target:string;clientId:string;revision:number;actor:string;createdAt:Date;legacySimulationIds:string[]}){
  const c=await collection('audit');
  await c.updateOne(scope({_id:receiptId(value.target)}),{$setOnInsert:{...scope(),...value,action:'analysis.delete'}},{upsert:true});
  return (await analysisDeletion(value.target))!;
}
