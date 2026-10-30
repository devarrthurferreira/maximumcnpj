import { collection, scope } from './store.ts';
import { need } from './security.ts';
import { randomUUID } from 'node:crypto';
import type { Doc } from './store.ts';
import { assertLookupNotDeleted, lookupDeleted, assertGenerationNotDeleted, generationDeletion } from './generation-deletion.ts';
import {ensureJobDataIndexes} from './mongo-storage.ts';
import {database} from './store.ts';
let ready:Promise<void>|undefined;
export function ensureLookupIndexes() {
  if (!ready) ready=(async()=>{
    await Promise.all([
      (await collection('clients')).createIndex({workspaceId:1,code:1},{unique:true,partialFilterExpression:{code:{$type:'string'}}}),
      (await collection('lookupJobs')).createIndex({workspaceId:1,clientId:1,createdAt:-1}),
      (await collection('audit')).createIndex({workspaceId:1,action:1,target:1}),
      ensureJobDataIndexes(await database()),
      (await collection('cnpjEntities')).createIndex({workspaceId:1,cnpj:1},{unique:true})
    ]);
  })().catch(e=>{ready=undefined;throw e;});
  return ready;
}
export function resetLookupIndexes(){ready=undefined;}
export type LookupActor={_id:string;role:string;name:string;email:string};
export function write(actor:LookupActor){need(['admin','operator'].includes(actor.role),'Acesso somente de leitura.',403,'FORBIDDEN');}
export function admin(actor:LookupActor){need(actor.role==='admin','Ação exclusiva do administrador.',403,'FORBIDDEN');}
export async function getJob(id:string){const j=await (await collection('lookupJobs')).findOne(scope({_id:id}));need(j,'Consulta não encontrada.',404,'NOT_FOUND');need(!await lookupDeleted(id)&&(!j.generationId||!await generationDeletion(j.generationId)),'Consulta não encontrada.',404,'NOT_FOUND');return j;}
export async function withJob<T>(id:string, action:(job:Doc)=>Promise<T>):Promise<T>{
  await assertLookupNotDeleted(id);
  const c=await collection('lookupJobs'),owner=randomUUID(),now=new Date();
  const job=await c.findOneAndUpdate(scope({_id:id,$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:now}}]}),{$set:{leaseOwner:owner,leaseUntil:new Date(Date.now()+120000)}},{returnDocument:'after'});
  need(job,'Consulta ocupada. Tente novamente em instantes.',409,'JOB_BUSY');
  try{await assertLookupNotDeleted(id);if(job.generationId)await assertGenerationNotDeleted(job.generationId);return await action(job);}finally{await c.updateOne(scope({_id:id,leaseOwner:owner}),{$unset:{leaseUntil:'',leaseOwner:''}});}
}
