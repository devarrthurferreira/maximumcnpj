import {need,integer} from './security.ts';
import {rateLimit,workspace} from './store.ts';
import type {LookupActor} from './lookup-db.ts';
import {analysisHistory,openAnalysis,getAnalysis,updateAnalysisConfig,updateAnalysisSector,importAnalysisGeneration,generateAnalysis,analysisVersions,deleteAnalysis} from './analysis-store.ts';

export async function routeAnalyses(actor:LookupActor,method:string,url:URL,input:unknown){
  const path=url.pathname.replace('/api/v4/analyses','');
  if(method==='GET')await rateLimit(`analysis-read:${workspace()}:${actor._id}`,120,1);
  const page=()=>integer(url.searchParams.get('page')||1,1,100000);
  if(!path && method==='GET')return analysisHistory(page(),{clientId:url.searchParams.get('clientId')||undefined,search:url.searchParams.get('search')||undefined});
  if(!path && method==='POST')return openAnalysis(actor,input);
  const match=path.match(/^\/([a-f0-9-]{36})(?:\/(config|fiscal|accounting|fiscal\/import|generate|versions))?$/);
  if(match){const id=match[1],action=match[2];
    if(!action && method==='GET')return getAnalysis(id);
    if(!action && method==='DELETE')return deleteAnalysis(actor,id,input);
    if(action==='config' && method==='PATCH')return updateAnalysisConfig(actor,id,input);
    if((action==='fiscal'||action==='accounting') && method==='PATCH')return updateAnalysisSector(actor,id,action,input);
    if(action==='fiscal/import' && method==='POST')return importAnalysisGeneration(actor,id,input);
    if(action==='generate' && method==='POST')return generateAnalysis(actor,id,input);
    if(action==='versions' && method==='GET')return analysisVersions(id,page());
  }
  need(false,'Rota de análise não encontrada.',404,'NOT_FOUND');
}
