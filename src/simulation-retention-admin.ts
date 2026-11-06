import {collection,scope} from './store.ts';
import {need} from './security.ts';
import {cleanupAnalysisVersions,openAnalysis} from './analysis-store.ts';
import {resolveRegimeSelection} from '../public/regime-selection.js';
import type {LookupActor} from './lookup-db.ts';

/** Explicit workspace migration; leaves each company's editable sectors and imports intact. */
export async function cleanupSavedVersions(actor:LookupActor,input:unknown){
  need(actor.role==='admin','Somente a Diretoria pode limpar todas as versões salvas.',403,'FORBIDDEN');
  need(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>key==='confirmed')&&(input as any).confirmed===true,
    'Confirme a limpeza das versões antigas. Os dados atuais serão preservados.',400,'RETENTION_CONFIRMATION');
  const companies=await(await collection('simulations')).distinct('clientId',scope({deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}}));
  const analyses=await(await collection('analyses')).find(scope({deletionStartedAt:{$exists:false}})).project({_id:1,clientId:1,activated:1,config:1}).toArray();
  const known=new Map(analyses.map(row=>[row.clientId,row]));
  const result={companies:0,removed:0,removedRevisions:0,failed:[] as Array<{clientId:string;code:string}>};
  for(const clientId of [...new Set([...companies,...known.keys()])]){
    if(typeof clientId!=='string')continue;
    try{
      const before=await(await collection('simulations')).countDocuments(scope({clientId}));
      const revisionsBefore=await(await collection('analysisRevisions')).countDocuments(scope({clientId}));
      const existing=known.get(clientId);let id=existing?._id;
      if(existing&&existing.activated===false){
        // The legacy bridge must adopt the last monthly inputs before its pointer is advanced and old rows removed.
        const opened=await openAnalysis(actor,{clientId,year:existing.config.year,regimeSelection:existing.config.regimeSelection},{summary:true});
        id=opened.analysis.id;
      }
      if(!id){
        const latest=await(await collection('simulations')).find(scope({clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}}))
          .project({_id:1,year:1,'draft.regimeSelection':1}).sort({createdAt:-1,_id:-1}).limit(1).next();
        if(!latest)continue;
        // Opening the legacy bridge preserves its last monthly inputs before pruning other results.
        const opened=await openAnalysis(actor,{clientId,year:latest.year===2028?2028:2027,regimeSelection:resolveRegimeSelection(latest.draft?.regimeSelection)}, {summary:true});
        id=opened.analysis.id;
      }
      await cleanupAnalysisVersions(actor,id);
      result.companies++;
      result.removed+=Math.max(0,before-await(await collection('simulations')).countDocuments(scope({clientId})));
      result.removedRevisions+=Math.max(0,revisionsBefore-await(await collection('analysisRevisions')).countDocuments(scope({clientId})));
    }catch(error:any){result.failed.push({clientId,code:typeof error?.code==='string'?error.code:'RETENTION_FAILED'});}
  }
  return result;
}
