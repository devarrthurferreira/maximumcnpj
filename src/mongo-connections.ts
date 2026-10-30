import type {Db, MongoClient} from 'mongodb';
import {AppError} from './security.ts';

export type StorageSlot = 1 | 2 | 3;
export type StorageConfig = {slot:StorageSlot;uri:string;database:string;limitBytes:number};
export const DEFAULT_STORAGE_LIMIT = 512 * 1024 * 1024;
export const DEFAULT_ROLLOVER_PERCENT = 85;
const configError = (message:string) => new AppError(503,'STORAGE_CONFIGURATION',message);

/** These values never leave the server. A different database on one cluster is not extra capacity. */
export function storageConfigs(env:NodeJS.ProcessEnv=process.env):StorageConfig[] {
  const primary=env.MONGODB_URI?.trim();
  if(!primary)throw new AppError(503,'DATABASE_NOT_CONFIGURED','Configure o MongoDB e execute a criação do primeiro administrador.');
  if(env.MONGODB_URI_3?.trim()&&!env.MONGODB_URI_2?.trim())throw configError('Configure o MongoDB 2 antes de habilitar o MongoDB 3.');
  const configs:StorageConfig[]=[],endpoints=new Set<string>();
  for(const slot of [1,2,3] as const){
    const suffix=slot===1?'':`_${slot}`,uri=env[`MONGODB_URI${suffix}`]?.trim();
    if(!uri)continue;
    // Parse only the scheme and host list; never copy credentials into an error.
    const match=/^(mongodb(?:\+srv)?):\/\/([^/?#]+)(?:[/?]|$)/i.exec(uri);
    if(!match)throw configError(`A conexão do MongoDB ${slot} é inválida.`);
    const authority=match[2].slice(match[2].lastIndexOf('@')+1).toLowerCase();
    if(!authority)throw configError(`A conexão do MongoDB ${slot} é inválida.`);
    const hosts=authority.split(',').map(seed=>{
      const parsed=/^(\[[0-9a-f:]+\]|[^:[\]\s]+)(?::(\d+))?$/i.exec(seed);
      if(!parsed)throw configError(`A conexão do MongoDB ${slot} é inválida.`);
      const port=parsed[2]?Number(parsed[2]):27017;
      if(port<1||port>65535)throw configError(`A conexão do MongoDB ${slot} é inválida.`);
      return `${parsed[1].replace(/\.$/,'')}:${port}`;
    });
    if(hosts.some(host=>endpoints.has(host)))throw configError('Use clusters diferentes para os MongoDB 1, 2 e 3. Nomes de banco diferentes no mesmo cluster não ampliam a capacidade.');
    hosts.forEach(host=>endpoints.add(host));
    const database=(env[`MONGODB_DB${suffix}`]||env.MONGODB_DB||'maximum_cnpj').trim();
    if(!database||/[\/\\. "$*<>:|?\u0000]/.test(database))throw configError(`O nome do banco MongoDB ${slot} é inválido.`);
    const raw=env[`MONGODB_STORAGE_LIMIT_BYTES${suffix}`]?.trim(),limitBytes=raw?Number(raw):DEFAULT_STORAGE_LIMIT;
    if(!Number.isSafeInteger(limitBytes)||limitBytes<=0)throw configError(`O limite de armazenamento do MongoDB ${slot} deve ser um número inteiro de bytes maior que zero.`);
    configs.push({slot,uri,database,limitBytes});
  }
  return configs;
}

export function rolloverPercent(env:NodeJS.ProcessEnv=process.env){
  const value=env.MONGODB_ROLLOVER_PERCENT?.trim()?Number(env.MONGODB_ROLLOVER_PERCENT):DEFAULT_ROLLOVER_PERCENT;
  if(!Number.isFinite(value)||value<50||value>90)throw configError('O limite preventivo de troca do MongoDB deve ficar entre 50 e 90 por cento.');
  return value;
}

const connections=new Map<string,{client:MongoClient;ready:Promise<Db>}>();
export async function mongoDatabase(slot:StorageSlot=1):Promise<Db>{
  // Authentication and existing primary records must remain accessible while an
  // additional destination is being configured. Validate the whole pool only
  // for allocation/secondary access, not to open the primary connection.
  const config=slot===1?storageConfigs({MONGODB_URI:process.env.MONGODB_URI,MONGODB_DB:process.env.MONGODB_DB})[0]:storageConfigs().find(item=>item.slot===slot);
  if(!config)throw new AppError(503,'STORAGE_NOT_CONFIGURED',`O MongoDB ${slot} guarda dados desta consulta e precisa continuar configurado para acessá-los.`);
  const key=JSON.stringify([config.uri,config.database]);
  const existing=connections.get(key);if(existing)return existing.ready;
  const {MongoClient:Driver}=await import('mongodb');
  // Importing the driver yields; another request may have initialized the same pool.
  const concurrent=connections.get(key);if(concurrent)return concurrent.ready;
  const client=new Driver(config.uri,{maxPoolSize:slot===1?10:5,minPoolSize:0,serverSelectionTimeoutMS:8000,connectTimeoutMS:8000,socketTimeoutMS:25000});
  const ready=client.connect().then(()=>client.db(config.database)).catch(async error=>{
    if(connections.get(key)?.client===client)connections.delete(key);
    await client.close().catch(()=>{});throw error;
  });
  connections.set(key,{client,ready});return ready;
}

export async function closeMongoConnections(){
  const current=[...connections.values()];connections.clear();
  await Promise.allSettled(current.map(async item=>{await item.ready.catch(()=>{});await item.client.close();}));
}

export type StorageStats={slot:StorageSlot;status:'AVAILABLE'|'UNAVAILABLE';scope:'CLUSTER'|'DATABASE';measurement:'UNCOMPRESSED_DATA_AND_INDEXES';usedBytes:number|null;dataBytes:number|null;indexBytes:number|null;limitBytes:number;remainingBytes:number|null;usedPercent:number|null;measuredAt:Date};
const validBytes=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function measuredStorage(config:StorageConfig,stats:Record<string,any>|null,scope:'CLUSTER'|'DATABASE'):StorageStats{
  const totals=scope==='CLUSTER'?stats?.totals:stats;
  const dataBytes=validBytes(totals?.dataSize),indexBytes=validBytes(totals?.indexSize);
  const usedBytes=scope==='CLUSTER'?validBytes(stats?.atlasSize):dataBytes!==null&&indexBytes!==null?dataBytes+indexBytes:null;
  return {slot:config.slot,status:usedBytes===null?'UNAVAILABLE':'AVAILABLE',scope,measurement:'UNCOMPRESSED_DATA_AND_INDEXES',usedBytes,dataBytes,indexBytes,limitBytes:config.limitBytes,
    remainingBytes:usedBytes===null?null:Math.max(0,config.limitBytes-usedBytes),usedPercent:usedBytes===null?null:Math.round(usedBytes/config.limitBytes*10000)/100,measuredAt:new Date()};
}
export function isAtlasConnection(config:StorageConfig){return /^mongodb\+srv:/i.test(config.uri)||/\.mongodb\.net(?=[:/,?]|$)/i.test(config.uri);}

/** Atlas Free/Flex reports the entire cluster; dbStats is a labelled database-only fallback. */
export async function storageStats(config:StorageConfig):Promise<StorageStats>{
  try{
    const db=await mongoDatabase(config.slot);
    try{
      const stats=await db.command({atlasSize:1,maxTimeMS:4000});
      const measurement=measuredStorage(config,stats,'CLUSTER');
      if(measurement.status==='AVAILABLE')return measurement;
    }catch{ /* Unsupported on a local/dedicated MongoDB; do not infer zero. */ }
    const stats=await db.command({dbStats:1,scale:1,maxTimeMS:4000});
    return measuredStorage(config,stats,'DATABASE');
  }catch{return measuredStorage(config,null,'CLUSTER');}
}

/** Code 8000 alone also occurs for authentication failures. */
export function isStorageQuotaError(error:unknown):boolean{
  if(!error||typeof error!=='object')return false;
  const value=error as Record<string,any>;
  const own=typeof value.message==='string'?value.message:typeof value.errmsg==='string'?value.errmsg:'';
  if(/you are over your space quota/i.test(own))return true;
  const children=Array.isArray(value.writeErrors)?value.writeErrors:[];
  return children.some((item:any)=>/you are over your space quota/i.test(String(item?.errmsg||item?.err?.errmsg||item?.message||'')));
}
