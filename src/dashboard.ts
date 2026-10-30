import {collection, database, scope, workspace} from './store.ts';
import {need, escapeRegex} from './security.ts';
import {PURCHASE_MODE, SALES_MODE} from './purchase-domain.ts';
import {storageDatabases, storagePoolStatus} from './mongo-storage.ts';

export const ACTIVITY_PAGE_SIZE = 30;
const TIMEZONE = 'America/Sao_Paulo';
const dayLabel = (date:Date) => new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
/** Seven calendar days including today, in the business timezone. */
export function dashboardWindow(now = new Date()) {
  const today = dayLabel(now), start = new Date(`${today}T00:00:00-03:00`);
  start.setUTCDate(start.getUTCDate()-6);
  return {start, end:now, timezone:TIMEZONE, days:Array.from({length:7},(_,i)=>dayLabel(new Date(start.getTime()+i*86400000)))};
}
const validBytes = (value:unknown):number|null => typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
/** The configured limit is a database budget, never inferred from disk or Atlas tier. */
export function storageSummary(stats:Record<string,unknown>|null, rawLimit=process.env.MONGODB_STORAGE_LIMIT_BYTES) {
  const parsed=rawLimit?.trim() ? Number(rawLimit) : null;
  const limitBytes=parsed!==null && Number.isSafeInteger(parsed) && parsed>0 ? parsed : null;
  const dataBytes=validBytes(stats?.dataSize), indexBytes=validBytes(stats?.indexSize), allocatedBytes=validBytes(stats?.totalSize) ??
    (validBytes(stats?.storageSize)!==null && indexBytes!==null ? Number(stats?.storageSize)+indexBytes : null);
  return {status:allocatedBytes===null?'UNAVAILABLE':limitBytes===null?'LIMIT_NOT_CONFIGURED':'AVAILABLE',
    scope:'DATABASE',measurement:'ALLOCATED_DATA_AND_INDEXES',allocatedBytes,dataBytes,indexBytes,limitBytes,
    remainingBytes:allocatedBytes!==null && limitBytes!==null ? Math.max(0,limitBytes-allocatedBytes) : null,
    overLimitBytes:allocatedBytes!==null && limitBytes!==null ? Math.max(0,allocatedBytes-limitBytes) : null,
    usedPercent:allocatedBytes!==null && limitBytes!==null ? Math.round(allocatedBytes/limitBytes*10000)/100 : null};
}
/** Explicit public projection: connection configuration and raw errors never reach the dashboard. */
export function storagePoolSummary(pool:Awaited<ReturnType<typeof storagePoolStatus>>) {
  const slots=pool.slots.map(item=>{
    const usedBytes=item.status==='AVAILABLE'?validBytes(item.usedBytes):null;
    const complete=usedBytes!==null&&item.scope==='CLUSTER';
    const rolloverBytes=Math.floor(item.limitBytes*pool.rolloverPercent/100);
    return {slot:item.slot,state:item.slot===pool.activeSlot?'ACTIVE':(pool.usedSlots?.includes(item.slot)??item.slot<pool.activeSlot)?'HISTORY':'RESERVE',
      status:usedBytes===null?'UNAVAILABLE':complete?'AVAILABLE':'PARTIAL',scope:item.scope,measurement:'UNCOMPRESSED_DATA_AND_INDEXES',
      usedBytes,dataBytes:usedBytes===null?null:validBytes(item.dataBytes),indexBytes:usedBytes===null?null:validBytes(item.indexBytes),limitBytes:item.limitBytes,
      remainingBytes:complete?Math.max(0,item.limitBytes-usedBytes):null,
      usedPercent:complete?Math.round(usedBytes/item.limitBytes*10000)/100:null,
      rolloverBytes,reserveBytes:item.limitBytes-rolloverBytes,
      beforeRolloverBytes:complete?Math.max(0,rolloverBytes-usedBytes):null,measuredAt:item.measuredAt};
  }).sort((a,b)=>a.slot-b.slot);
  const measuredSlots=slots.filter(item=>item.usedBytes!==null).length;
  const complete=slots.length>0&&slots.every(item=>item.status==='AVAILABLE');
  return {mode:'POOL',enabled:pool.enabled,status:complete?'AVAILABLE':measuredSlots?'PARTIAL':'UNAVAILABLE',
    scope:'POOL',measurement:'UNCOMPRESSED_DATA_AND_INDEXES',activeSlot:pool.activeSlot,rolloverPercent:pool.rolloverPercent,
    configuredSlots:slots.length,measuredSlots,slots,
    usedBytes:complete?slots.reduce((sum,item)=>sum+item.usedBytes!,0):null,
    limitBytes:slots.reduce((sum,item)=>sum+item.limitBytes,0),
    remainingBytes:complete?slots.reduce((sum,item)=>sum+item.remainingBytes!,0):null};
}
let storageCache:{key:string;until:number;value:ReturnType<typeof storageSummary>}|undefined;
async function storage() {
  const pool=await storagePoolStatus();
  if(pool.enabled)return storagePoolSummary(pool);
  const key=JSON.stringify([process.env.MONGODB_DB,process.env.MONGODB_STORAGE_LIMIT_BYTES,workspace()]);
  if(storageCache?.key===key && storageCache.until>Date.now())return storageCache.value;
  let stats:Record<string,unknown>|null=null;
  try {stats=await(await database()).command({dbStats:1,scale:1,maxTimeMS:4000});} catch { /* Stats permission is optional; the dashboard stays available. */ }
  const value=storageSummary(stats);storageCache={key,until:Date.now()+60000,value};return value;
}

async function dailyLookupActivity(filter:Record<string,unknown>,window:ReturnType<typeof dashboardWindow>) {
  // Jobs keep their payload in their original bank. Reserved banks need no activity query.
  // An unavailable bank with history must fail visibly rather than become a zero count.
  const sources=await storageDatabases({usedOnly:true});
  const results=await Promise.all(sources.map(({db})=>db.collection('lookupItems').aggregate([
    {$match:{...filter,state:'DONE',checkedAt:{$gte:window.start,$lte:window.end}}},
    {$group:{_id:{$dateToString:{date:'$checkedAt',format:'%Y-%m-%d',timezone:TIMEZONE}},count:{$sum:1}}}
  ],{maxTimeMS:10000}).toArray()));
  const counts=new Map<string,number>();
  for(const rows of results)for(const row of rows)counts.set(row._id,(counts.get(row._id)||0)+row.count);
  return counts;
}

/** Public history rows expose metadata only; snapshots/documents never leave this endpoint. */
export async function activityHistory({clientId='',page=1,search='',kind=''}:{clientId?:string;page?:number;search?:string;kind?:string}={}) {
  need(Number.isInteger(page)&&page>=1&&page<=100000,'Página inválida.');
  need(['','LOOKUP','PURCHASES','SALES','SIMULATION','FISCAL','ACCOUNTING','CONFIG','LEGACY'].includes(kind),'Tipo de histórico inválido.');
  const filter=scope(clientId?{clientId}:{});
  const jobs:any[]=[{$match:filter},{$project:{_id:1,workspaceId:1,clientId:1,createdAt:1,clientName:1,clientCode:1,status:1,title:'$fileName',generationId:1,
    kind:{$switch:{branches:[{case:{$eq:['$mode',PURCHASE_MODE]},then:'PURCHASES'},{case:{$eq:['$mode',SALES_MODE]},then:'SALES'}],default:'LOOKUP'}}}}];
  const branch=(coll:string,match:Record<string,unknown>,project:Record<string,unknown>)=>({$unionWith:{coll,pipeline:[{$match:match},{$project:{_id:1,workspaceId:1,clientId:1,createdAt:1,...project}}]}});
  const stages:any[]=[...jobs,
    branch('simulations',{...filter,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}},{kind:{$literal:'SIMULATION'},title:1,status:{$literal:'COMPLETED'},analysisId:1}),
    branch('analysisRevisions',filter,{analysisId:1,revision:1,title:{$concat:['Revisão ',{$toString:'$revision'}]},status:'$data.status',
      kind:{$switch:{branches:[{case:{$eq:['$kind','accounting']},then:'ACCOUNTING'},{case:{$eq:['$kind','config']},then:'CONFIG'}],default:'FISCAL'}}}),
    branch('batches',filter,{kind:{$literal:'LEGACY'},title:'$fileName',status:1,clientName:1}),
    {$lookup:{from:'clients',let:{client:'$clientId'},pipeline:[{$match:{...scope(),$expr:{$eq:['$_id','$$client']}}},{$project:{name:1,code:1,cnpj:1}}],as:'company'}},
    {$set:{company:{$arrayElemAt:['$company',0]}}},
    {$set:{clientName:{$ifNull:['$company.name','$clientName']},clientCode:{$ifNull:['$company.code','$clientCode']},clientCnpj:'$company.cnpj'}},
    // Deletion receipts also hide in-flight deletions before their physical cleanup finishes.
    {$lookup:{from:'audit',let:{target:'$_id',generation:'$generationId',analysis:'$analysisId'},pipeline:[{$match:{...scope(),$expr:{$or:[
      {$and:[{$eq:['$action','lookup.delete']},{$eq:['$target','$$target']}]},
      {$and:[{$eq:['$action','generation.delete']},{$eq:['$target','$$generation']}]},
      {$and:[{$eq:['$action','analysis.delete']},{$eq:['$target','$$analysis']}]},
      {$and:[{$eq:['$action','simulation.delete']},{$eq:['$target','$$target']}]}
    ]}}},{$limit:1},{$project:{_id:1}}],as:'deleted'}},{$match:{deleted:{$size:0}}}];
  if(kind)stages.push({$match:{kind}});
  if(search.trim()){
    const term=escapeRegex(search.trim().slice(0,100)),cnpjTerm=escapeRegex(search.replace(/[^a-zA-Z0-9]/g,'').slice(0,14));
    const choices:any[]=['clientName','clientCode','title'].map(field=>({[field]:{$regex:term,$options:'i'}}));
    if(cnpjTerm)choices.push({clientCnpj:{$regex:cnpjTerm,$options:'i'}});
    stages.push({$match:{$or:choices}});
  }
  stages.push({$facet:{items:[{$sort:{createdAt:-1,kind:1,_id:-1}},{$skip:(page-1)*ACTIVITY_PAGE_SIZE},{$limit:ACTIVITY_PAGE_SIZE},{$project:{workspaceId:0,company:0,deleted:0}}],count:[{$count:'total'}]}});
  const [result]=await(await collection('lookupJobs')).aggregate(stages,{maxTimeMS:20000,allowDiskUse:true}).toArray();
  const total=result?.count?.[0]?.total||0;
  return {items:result?.items||[],page,pageSize:ACTIVITY_PAGE_SIZE,total,totalPages:Math.max(1,Math.ceil(total/ACTIVITY_PAGE_SIZE))};
}

async function recentCompanies(clientId:string) {
  const filter=scope(clientId?{clientId}:{});
  const [result]=await(await collection('clients')).aggregate([
    {$match:scope(clientId?{_id:clientId}:{})},
    {$project:{clientId:'$_id',activityAt:{$ifNull:['$updatedAt','$createdAt']}}},
    ...['lookupJobs','analyses','simulations'].map(coll=>({$unionWith:{coll,pipeline:[{$match:{...filter,deletedAt:{$exists:false},...(coll==='simulations'?{analysisPublication:{$ne:'PENDING'}}:coll==='analyses'?{deletionStartedAt:{$exists:false}}:{})}},{$project:{clientId:1,activityAt:{$ifNull:['$updatedAt','$createdAt']}}}]}})),
    {$group:{_id:'$clientId',activityAt:{$max:'$activityAt'}}},{$sort:{activityAt:-1,_id:-1}},{$limit:6},
    {$lookup:{from:'clients',let:{id:'$_id'},pipeline:[{$match:{...scope(),$expr:{$eq:['$_id','$$id']}}},{$project:{_id:1,code:1,name:1,cnpj:1,active:1,updatedAt:1,createdAt:1}}],as:'company'}},
    {$unwind:'$company'},{$replaceRoot:{newRoot:{$mergeObjects:['$company',{activityAt:'$activityAt'}]}}},
    {$group:{_id:null,items:{$push:'$$ROOT'}}}
  ],{maxTimeMS:10000}).toArray();
  return result?.items||[];
}

export async function dashboardDetails(clientId='',now=new Date()) {
  const window=dashboardWindow(now),filter=scope(clientId?{clientId}:{});
  const [storageInfo,daily,recentActivity,companies,counts]=await Promise.all([
    storage(),
    dailyLookupActivity(filter,window),
    activityHistory({clientId,page:1}),
    recentCompanies(clientId),
    Promise.all([
      (await collection('lookupJobs')).countDocuments({...filter,createdAt:{$gte:window.start,$lte:window.end}}),
      (await collection('analyses')).countDocuments({...filter,deletionStartedAt:{$exists:false}}),
      (await collection('simulations')).countDocuments({...filter,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})
    ])
  ]);
  const days=window.days.map(date=>({date,count:daily.get(date)||0}));
  return {storage:storageInfo,activity:{from:window.start,to:window.end,timezone:TIMEZONE,days,queriesLast7Days:days.reduce((sum,row)=>sum+row.count,0),
    batchesLast7Days:counts[0],counting:'CNPJ_PER_LOOKUP_COMPLETED',includesToday:true},recentCompanies:companies,
    recentActivity:recentActivity.items.slice(0,8),historyCount:recentActivity.total,analysisCount:counts[1],simulationCount:counts[2]};
}
