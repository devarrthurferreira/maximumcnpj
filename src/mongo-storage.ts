import type {Collection,Db} from 'mongodb';
import {randomUUID} from 'node:crypto';
import {collection,database,scope,workspace,type Doc} from './store.ts';
import {AppError,need} from './security.ts';
import {mongoDatabase,storageConfigs,storageStats,rolloverPercent,isAtlasConnection,isStorageQuotaError,type StorageSlot,type StorageStats} from './mongo-connections.ts';

export const STORAGE_VERSION='MONGODB_POOL_V1';
export const JOB_DATA_COLLECTIONS=['lookupStage','purchaseLines','lookupItems','cnpjStates'] as const;
const DATA_NAMES=new Set<string>(JOB_DATA_COLLECTIONS);
const indexed=new WeakMap<Db,Promise<void>>();
let statusCache:{key:string;until:number;slots:StorageStats[]}|undefined;
const CONTROL_ID='mongo-storage-pool-v1';
const MIN_RESERVATION=2*1024*1024;
const METADATA_BYTES_PER_ROW=4096;
// Old API clients cannot predict UTF-8 payload sizes. Reserve for the supported
// string limits, including two copies of a 2,000-character financial description.
const UNMEASURED_BYTES_PER_ROW=32768;

function poolControlState(control:Doc|null,configuredSlots:StorageSlot[]){
  const activeSlot=control?control.activeSlot:1,highestSlot=control?.highestSlot??activeSlot;
  need([1,2,3].includes(activeSlot)&&[1,2,3].includes(highestSlot)&&highestSlot>=activeSlot,
    'A configuração salva de armazenamento é inválida.',503,'STORAGE_CONFIGURATION');
  for(let slot=1;slot<=highestSlot;slot++)if(!configuredSlots.includes(slot as StorageSlot)){
    throw new AppError(503,'STORAGE_NOT_CONFIGURED',`O MongoDB ${slot} já foi usado e precisa continuar configurado para preservar o acesso ao histórico.`);
  }
  const usedSlots=Array.isArray(control?.usedSlots)?control.usedSlots:Array.from({length:highestSlot},(_,i)=>i+1);
  need(usedSlots.every(slot=>[1,2,3].includes(slot)&&slot<=highestSlot),'A configuração salva de armazenamento é inválida.',503,'STORAGE_CONFIGURATION');
  return {activeSlot:activeSlot as StorageSlot,highestSlot,usedSlots:usedSlots as StorageSlot[]};
}

export function jobStorageSlot(job:Record<string,unknown>):StorageSlot{
  if(job.storageSlot===undefined&&job.storageVersion===undefined)return 1;
  need(job.storageVersion===STORAGE_VERSION&&[1,2,3].includes(job.storageSlot as number),'A localização salva do relatório é inválida. Os dados não foram alterados.',409,'STORAGE_ROUTE');
  return job.storageSlot as StorageSlot;
}

/** A conservative reservation includes temporary rows, their final copy, lookup states and indexes. */
export function jobStorageReservation(expectedRows:unknown,expectedPayloadBytes?:unknown){
  need(typeof expectedRows==='number'&&Number.isSafeInteger(expectedRows)&&expectedRows>0,'Quantidade de linhas inválida para reservar armazenamento.');
  if(expectedPayloadBytes!==undefined)need(typeof expectedPayloadBytes==='number'&&Number.isSafeInteger(expectedPayloadBytes)&&expectedPayloadBytes>0,'Tamanho previsto do arquivo inválido para reservar armazenamento.');
  const amount=expectedPayloadBytes===undefined?expectedRows*UNMEASURED_BYTES_PER_ROW+MIN_RESERVATION:
    (expectedPayloadBytes as number)*2+expectedRows*METADATA_BYTES_PER_ROW+MIN_RESERVATION;
  need(Number.isSafeInteger(amount),'Quantidade de linhas excede o armazenamento disponível.');
  return amount;
}

export function ensureJobDataIndexes(db:Db){
  let ready=indexed.get(db);
  if(!ready){
    ready=Promise.all([
      db.collection('lookupStage').createIndex({workspaceId:1,jobId:1,index:1},{unique:true}),
      db.collection('lookupStage').createIndex({workspaceId:1,jobId:1,valid:1,cnpj:1,index:1}),
      db.collection('lookupStage').createIndex({expiresAt:1},{expireAfterSeconds:0}),
      db.collection('purchaseLines').createIndex({workspaceId:1,jobId:1,index:1},{unique:true}),
      db.collection('purchaseLines').createIndex({workspaceId:1,jobId:1,cnpj:1}),
      db.collection('lookupItems').createIndex({workspaceId:1,jobId:1,cnpj:1},{unique:true}),
      db.collection('lookupItems').createIndex({workspaceId:1,jobId:1,state:1,nextAt:1}),
      db.collection('lookupItems').createIndex({workspaceId:1,cnpj:1,checkedAt:-1}),
      db.collection('lookupItems').createIndex({workspaceId:1,state:1,checkedAt:-1,clientId:1}),
      db.collection('cnpjStates').createIndex({workspaceId:1,cnpj:1,fingerprint:1},{unique:true})
    ]).then(()=>{}).catch(error=>{indexed.delete(db);throw error;});
    indexed.set(db,ready);
  }
  return ready;
}

async function storedJob(job:Doc|string):Promise<Doc>{
  const item=typeof job==='string'?await(await collection('lookupJobs')).findOne(scope({_id:job})):job;
  need(item&&item.workspaceId===workspace(),'Consulta não encontrada.',404,'NOT_FOUND');
  return item;
}

export async function jobDatabase(job:Doc|string):Promise<Db>{
  const item=await storedJob(job),slot=jobStorageSlot(item);
  return slot===1?database():mongoDatabase(slot);
}
export async function jobCollection(name:string,job:Doc|string):Promise<Collection<Doc>>{
  need(DATA_NAMES.has(name),'Coleção não autorizada para armazenamento de relatórios.',500,'STORAGE_COLLECTION');
  return (await jobDatabase(job)).collection<Doc>(name);
}

/** Read every referenced destination, never return a silently partial history. */
export async function storageDatabases({usedOnly=false}:{usedOnly?:boolean}={}):Promise<Array<{slot:StorageSlot;db:Db}>>{
  const configured=storageConfigs();let slots=configured.map(item=>item.slot);
  if(usedOnly){
    const used=await(await collection('lookupJobs')).distinct('storageSlot',scope());
    const needed=new Set<number>([1]);
    for(const slot of used){need([1,2,3].includes(slot),'A localização salva de uma consulta é inválida.',409,'STORAGE_ROUTE');needed.add(slot);}
    for(const slot of needed)if(!configured.some(item=>item.slot===slot))throw new AppError(503,'STORAGE_NOT_CONFIGURED',`O MongoDB ${slot} contém histórico e precisa continuar configurado.`);
    slots=slots.filter(slot=>needed.has(slot));
  }
  return Promise.all(slots.map(async slot=>({slot,db:slot===1?await database():await mongoDatabase(slot)})));
}

export async function storagePoolStatus(){
  const configs=storageConfigs(),enabled=configs.length>1;
  const control=await(await collection('storageControl')).findOne({_id:CONTROL_ID});
  const {activeSlot,usedSlots}=poolControlState(control,configs.map(config=>config.slot));
  const percent=rolloverPercent();
  if(!enabled)return {enabled,activeSlot,usedSlots,rolloverPercent:percent,slots:[] as StorageStats[]};
  const key=JSON.stringify(configs);
  if(statusCache?.key===key&&statusCache.until>Date.now())return {enabled,activeSlot,usedSlots,rolloverPercent:percent,slots:statusCache.slots};
  const slots=await Promise.all(configs.map(config=>storageStats(config)));
  statusCache={key,until:Date.now()+60000,slots};
  return {enabled,activeSlot,usedSlots,rolloverPercent:percent,slots};
}

async function pendingReservations(slot:StorageSlot){
  // Reservations belong to the whole database, including other workspaces using the same quota.
  const routes=slot===1?{$or:[{storageSlot:1},{storageSlot:{$exists:false}}]}:{storageSlot:slot};
  const rows=await(await collection('lookupJobs')).find({...routes,status:{$in:['UPLOADING','PROCESSING']}})
    .project({expectedRows:1,expectedPayloadBytes:1,storageReservedBytes:1}).toArray();
  return rows.reduce((sum,row)=>sum+(Number.isSafeInteger(row.storageReservedBytes)&&row.storageReservedBytes>0?row.storageReservedBytes:jobStorageReservation(row.expectedRows,row.expectedPayloadBytes)),0);
}

/** The single control lease serializes reservations across independent server instances. */
export async function insertStoredJob(job:Doc):Promise<Doc>{
  need(job.workspaceId===workspace(),'Consulta não autorizada.',403,'FORBIDDEN');
  const configs=storageConfigs(),jobs=await collection('lookupJobs'),controls=await collection('storageControl');
  // Do not change the long-standing one-database behavior when no extra connection is enabled.
  if(configs.length===1){
    const prior=await controls.findOne({_id:CONTROL_ID});
    poolControlState(prior,configs.map(config=>config.slot));
    await jobs.insertOne(job);return job;
  }
  const existing=await jobs.findOne({_id:job._id});
  if(existing){const error=Object.assign(new Error('Duplicate storage identity'),{code:11000});throw error;}
  const owner=randomUUID();
  try{await controls.updateOne({_id:CONTROL_ID},{$setOnInsert:{activeSlot:1,highestSlot:1,usedSlots:[1],leaseUntil:new Date(0),leaseOwner:''}},{upsert:true});}
  catch(error:any){if(error.code!==11000)throw error;}
  let locked:Doc|null=null;
  for(let attempt=0;attempt<30;attempt++){
    locked=await controls.findOneAndUpdate({_id:CONTROL_ID,leaseUntil:{$lte:new Date()}},{$set:{leaseOwner:owner,leaseUntil:new Date(Date.now()+120000)}},{returnDocument:'after'});
    if(locked)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  need(locked,'Outra importação está reservando espaço. Tente novamente em instantes.',409,'STORAGE_BUSY');
  try{
    const reservation=jobStorageReservation(job.expectedRows,job.expectedPayloadBytes),percent=rolloverPercent();
    const prior=poolControlState(locked,configs.map(config=>config.slot));
    // Temporary copies and cancelled reservations can release space. Reuse it
    // for a NEW job without changing the immutable destination of existing jobs.
    for(const config of configs){
      const stats=await storageStats(config);
      if(stats.usedBytes===null||(isAtlasConnection(config)&&stats.scope!=='CLUSTER'))throw new AppError(503,'STORAGE_MEASUREMENT_UNAVAILABLE',`Não foi possível conferir a capacidade completa do MongoDB ${config.slot}. Verifique a conexão e a permissão do comando atlasSize; nenhum destino foi trocado por essa falha.`);
      const reserved=await pendingReservations(config.slot),budget=Math.floor(config.limitBytes*percent/100);
      if(stats.usedBytes+reserved+reservation>budget)continue;
      const db=await mongoDatabase(config.slot);
      try{await ensureJobDataIndexes(db);}catch(error){
        // Only a new, still-empty unit may change destination after a proven quota failure.
        if(isStorageQuotaError(error))continue;
        throw error;
      }
      const renewed=await controls.updateOne({_id:CONTROL_ID,leaseOwner:owner,leaseUntil:{$gt:new Date()}},
        {$set:{activeSlot:config.slot,leaseUntil:new Date(Date.now()+120000)},$max:{highestSlot:Math.max(prior.highestSlot,config.slot)},$addToSet:{usedSlots:{$each:[...prior.usedSlots,config.slot]}}});
      need(renewed.matchedCount===1,'A reserva de espaço expirou. Tente novamente para retomar a operação.',409,'STORAGE_BUSY');
      const stored={...job,storageVersion:STORAGE_VERSION,storageSlot:config.slot,storageReservedBytes:reservation};
      await jobs.insertOne(stored);
      return stored;
    }
    throw new AppError(503,'STORAGE_POOL_FULL','Os bancos configurados não têm espaço reservado suficiente para concluir esta importação. Configure o próximo MongoDB ou amplie a capacidade. O histórico existente foi preservado.');
  }finally{
    // Releasing a lease must not turn an acknowledged insert into an apparent failure.
    await controls.updateOne({_id:CONTROL_ID,leaseOwner:owner},{$set:{leaseOwner:'',leaseUntil:new Date(0)}}).catch(()=>{});
  }
}
