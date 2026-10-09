import { collection, scope } from './store.ts';
import { need, integer, escapeRegex } from './security.ts';
import { normalizeCnpj, reportingStatus } from './domain.ts';
import { routePurchases } from './purchase-http.ts';
import { routeGenerations } from './generation-http.ts';
import { routeSimulations } from './simulation-http.ts';
import { PURCHASE_MODE, SALES_MODE, isFinancialMode } from './purchase-domain.ts';
import { ensureLookupIndexes, getJob } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { listCatalog, importCatalog } from './lookup-catalog.ts';
import { createLookup,uploadLookup,finalizeLookup,processLookup,cancelLookup,repeatLookup,recheckLookup } from './lookup-jobs.ts';
import { lookupProgress } from './lookup-engine.ts';
import { routeSimplesDocuments } from './blob-documents.ts';
async function items(id:string,page:number,status:string,search:string){
  const job=await getJob(id);need(job.status==='COMPLETED','Aguarde a conclusão para ver o resultado consolidado.',409);
  const q:any=scope({jobId:id});if(status){need(['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO'].includes(status),'Situação inválida.');q.status=status === 'NAO_OPTANTE' ? {$ne:'OPTANTE'} : status;}
  const stages:any[]=[{$match:q},{$lookup:{from:'cnpjStates',localField:'stateId',foreignField:'_id',as:'details'}},{$set:{details:{$arrayElemAt:['$details',0]}}}];
  if(search){const term=escapeRegex(search.slice(0,100));stages.push({$match:{$or:[{cnpj:{$regex:term,$options:'i'}},{submittedName:{$regex:term,$options:'i'}},{'details.name':{$regex:term,$options:'i'}}]}});}
  const [result]=await (await collection('lookupItems')).aggregate([...stages,{$facet:{items:[{$sort:{cnpj:1}},{$skip:(page-1)*100},{$limit:100},{$project:{workspaceId:0}}],count:[{$count:'total'}]}}],{maxTimeMS:20000}).toArray();
  return {items:(result?.items||[]).map((row:any)=>({...row,reportingStatus:reportingStatus(row.status)})),total:result?.count?.[0]?.total||0,page};
}
async function history(clientId:string,page:number,cnpj:string){
  const q:any=scope({...(clientId?{clientId}:{}),mode:{$nin:[PURCHASE_MODE,SALES_MODE]}});
  if(cnpj){const d=normalizeCnpj(cnpj);need(d.valid,'Informe CNPJ válido para o histórico.');const ids=await (await collection('lookupItems')).distinct('jobId',scope({cnpj:d.cnpj,...(clientId?{clientId}:{})}));q._id={$in:ids};}
  const c=await collection('lookupJobs');return {items:await c.find(q).sort({createdAt:-1}).skip((page-1)*30).limit(30).toArray(),total:await c.countDocuments(q),page};
}
async function dashboard(clientId:string){
  const q=scope(clientId?{clientId}:{});
  const values=await (await collection('lookupItems')).aggregate([{$match:{...q,state:'DONE'}},{$lookup:{from:'lookupJobs',localField:'jobId',foreignField:'_id',as:'job'}},{$match:{'job.status':'COMPLETED'}},{$sort:{cnpj:1,checkedAt:-1,jobId:-1}},{$group:{_id:'$cnpj',status:{$first:'$status'}}},{$group:{_id:'$status',count:{$sum:1}}}],{allowDiskUse:true,maxTimeMS:20000}).toArray();
  const get=(s:string)=>values.find(v=>v._id===s)?.count||0;const optants=get('OPTANTE'),nonOptants=get('NAO_OPTANTE'),unknown=get('NAO_CONFIRMADO'),reportingNonOptants=nonOptants+unknown,total=optants+nonOptants+unknown;
  const p=(v:number)=>total?Math.round(v/total*10000)/100:0;
  return {metrics:{total,optants,nonOptants,unknown,optantsPercent:p(optants),nonOptantsPercent:p(nonOptants),unknownPercent:p(unknown),coverage:p(optants+nonOptants),reportingNonOptants,reportingNonOptantsPercent:total?(10000-Math.round(p(optants)*100))/100:0,unknownIncludedInNonOptants:true},recent:(await history(clientId,1,'')).items.slice(0,8),entities:await (await collection('cnpjEntities')).countDocuments(scope()),clientCount:await (await collection('clients')).countDocuments(scope({active:true})),source:'Minha Receita',sourceReferenceDate:null};
}
export async function routeV4(actor:LookupActor,method:string,url:URL,input:any){
  await ensureLookupIndexes();
  if(url.pathname==='/api/v4/simples-documents' || url.pathname.startsWith('/api/v4/simples-documents/')) return routeSimplesDocuments(actor,method,url,input);
  if(url.pathname==='/api/v4/simulations' || url.pathname.startsWith('/api/v4/simulations/'))return routeSimulations(actor,method,url,input);
  if(url.pathname==='/api/v4/generations' || url.pathname.startsWith('/api/v4/generations/'))return routeGenerations(actor,method,url,input);
  if(/^\/api\/v4\/(?:purchases|sales)(?:\/|$)/.test(url.pathname))return routePurchases(actor,method,url,input);
  const path=url.pathname.replace('/api/v4',''),p=integer(url.searchParams.get('page')||1,1,100000),client=url.searchParams.get('clientId')||'';
  if(path==='/clients'&&method==='GET')return listCatalog();
  if(path==='/clients/import'&&method==='POST')return importCatalog(actor,input.rows);
  if(path==='/dashboard'&&method==='GET')return dashboard(client);
  if(path==='/history'&&method==='GET')return history(client,p,url.searchParams.get('cnpj')||'');
  if(path==='/lookups'&&method==='POST')return createLookup(actor,input);
  const match=path.match(/^\/lookups\/([a-f0-9-]{36})(?:\/(rows|finalize|process|cancel|repeat|results|progress|recheck))?$/);
  if(match){const id=match[1],action=match[2];
    const job=await getJob(id);
    // These two scoped actions serve cadastral, purchases and sales jobs alike.
    if(action==='progress'&&method==='GET')return {...await lookupProgress(id,p,url.searchParams.get('status')||'ALL',url.searchParams.get('summary')==='1'),canRecheck:['admin','operator'].includes(actor.role)};
    if(action==='recheck'&&method==='POST')return recheckLookup(actor,id);
    need(!isFinancialMode(job.mode),'Consulta não encontrada.',404,'NOT_FOUND');
    if(!action&&method==='GET')return getJob(id);
    if(action==='results'&&method==='GET')return items(id,p,url.searchParams.get('status')||'',url.searchParams.get('search')||'');
    if(method==='POST'){
      if(action==='rows')return uploadLookup(actor,id,input);
      if(action==='finalize')return finalizeLookup(actor,id);
      if(action==='process')return processLookup(actor,id);
      if(action==='cancel')return cancelLookup(actor,id);
      if(action==='repeat')return repeatLookup(actor,id);
    }
  }
  need(false,'Rota não encontrada.',404,'NOT_FOUND');
}
