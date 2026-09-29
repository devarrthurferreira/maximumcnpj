import { randomUUID } from 'node:crypto';
import { collection, scope, workspace, audit } from './store.ts';
import { need, text, integer, digest } from './security.ts';
import { statistics, VERSION, MAX_ROWS } from './domain.ts';
import { LOOKUP_MODE, compactLine, compareNames, SOURCE_NAME } from './lookup-domain.ts';
import { lookupCnpj, SourceError } from './lookup-provider.ts';
import { ensureLookupIndexes, withJob, getJob, write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { PURCHASE_MODE, compactPurchaseLine } from './purchase-domain.ts';
import { finalizePurchaseUpload, purchaseSummary } from './purchase-store.ts';
export async function createLookup(actor:LookupActor,input:any,mode=LOOKUP_MODE){
  need([LOOKUP_MODE,PURCHASE_MODE].includes(mode),'Tipo de consulta inválido.');
  write(actor);await ensureLookupIndexes();
  const id=text(input.importId);need(/^[a-f0-9-]{36}$/.test(id),'Identificador inválido.');
  const c=await (await collection('clients')).findOne(scope({_id:text(input.clientId),active:true}));need(c,'Escolha uma empresa/carteira ativa.');
  const expected=integer(input.expectedRows,1,MAX_ROWS),fileName=text(input.fileName,200);
  const jobs=await collection('lookupJobs'),old=await jobs.findOne(scope({_id:id}));
  if(old){need(old.mode===mode&&old.clientId===c._id&&old.expectedRows===expected&&old.fileName===fileName&&old.createdBy===actor._id,'Identificador já utilizado por outro lote.',409);return old;}
  const job={_id:id,...scope(),mode,clientId:c._id,clientCode:c.code||null,clientName:c.name,fileName,expectedRows:expected,uploaded:0,status:'UPLOADING',createdAt:new Date(),createdBy:actor._id,version:VERSION,source:SOURCE_NAME,received:0};
  await jobs.insertOne(job);await audit(actor._id,'lookup.create',id);return job;
}
export async function uploadLookup(actor:LookupActor,id:string,input:any){
  write(actor);return withJob(id,async j=>{
    need(j.status==='UPLOADING','Este lote não aceita novas linhas.',409);
    need(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=250,'Envie até 250 linhas por parte.');
    const offset=integer(input.offset,0,j.expectedRows-1);need(offset+input.rows.length<=j.expectedRows,'Linhas excedem o tamanho do lote.');
    const lines=input.rows.map(j.mode===PURCHASE_MODE?compactPurchaseLine:compactLine),hash=digest(JSON.stringify(lines)),chunks=await collection('chunks'),key=`lookup:${id}:${offset}`;
    const old=await chunks.findOne(scope({_id:key}));if(old){need(old.hash===hash,'Parte já enviada com outros dados.',409);if(old.complete)return {uploaded:j.uploaded};}
    need(offset===j.uploaded || (old && offset+lines.length===j.uploaded),'Retome a próxima parte esperada.',409,'UPLOAD_OFFSET');
    await chunks.updateOne(scope({_id:key}),{$setOnInsert:{...scope(),hash,complete:false,createdAt:new Date()}},{upsert:true});
    await (await collection('lookupStage')).bulkWrite(lines.map((line:any,i:number)=>({updateOne:{filter:scope({_id:`${id}:${offset+i}`}),update:{$setOnInsert:{...line,...scope(),jobId:id,index:offset+i,expiresAt:new Date(Date.now()+7*86400000)}},upsert:true}})));
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{uploaded:offset+lines.length}});
    await chunks.updateOne(scope({_id:key}),{$set:{complete:true}});
    return {uploaded:offset+lines.length};
  });
}
export async function finalizeLookup(actor:LookupActor,id:string){
  write(actor);return withJob(id,async j=>{
    if(j.status!=='UPLOADING')return j;
    if(j.mode===PURCHASE_MODE)return finalizePurchaseUpload(actor,j);
    const stage=await collection('lookupStage');const count=await stage.countDocuments(scope({jobId:id}));need(count===j.expectedRows&&j.uploaded===count,'Envio incompleto ou expirado. Reenvie a planilha.',409);
    const unique=await stage.aggregate([{$match:scope({jobId:id,valid:true})},{$sort:{index:1}},{$group:{_id:'$cnpj',name:{$first:'$name'},kind:{$first:'$kind'},uf:{$first:'$uf'},occurrences:{$sum:1}}}],{allowDiskUse:true,maxTimeMS:20000}).toArray();
    const invalid=await stage.countDocuments(scope({jobId:id,valid:false}));
    const errors=await stage.find(scope({jobId:id,valid:false})).project({index:1,reason:1,documentHint:1}).limit(100).toArray();
    const items=await collection('lookupItems');
    for(let p=0;p<unique.length;p+=500)await items.bulkWrite(unique.slice(p,p+500).map(r=>({updateOne:{filter:scope({_id:`${id}:${r._id}`}),update:{$setOnInsert:{...scope(),jobId:id,clientId:j.clientId,cnpj:r._id,submittedName:r.name,kind:r.kind,uf:r.uf,occurrences:r.occurrences,state:'PENDING',attempts:0,createdAt:new Date()}},upsert:true}})));
    const summary={lines:count,unique:unique.length,invalid,duplicates:count-invalid-unique.length};
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{summary,diagnostics:errors,status:unique.length?'PROCESSING':'INVALID',received:0,startedAt:new Date()}});
    await stage.deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.validated',id);return getJob(id);
  });
}
async function takeProviderSlot(owner:string){
  const c=await collection('providerControl');const id='minhareceita-global';
  await c.updateOne({_id:id},{$setOnInsert:{nextAt:new Date(0),leaseUntil:new Date(0)}},{upsert:true});
  const r=await c.findOneAndUpdate({_id:id,nextAt:{$lte:new Date()},leaseUntil:{$lte:new Date()}},{$set:{owner,leaseUntil:new Date(Date.now()+20000)}},{returnDocument:'after'});
  if(r)return {ok:true,wait:0};
  const s=await c.findOne({_id:id});return {ok:false,wait:Math.max(250,Math.max(s?.nextAt?.getTime()||0,s?.leaseUntil?.getTime()||0)-Date.now())};
}
async function releaseProviderSlot(owner:string,wait:number){await (await collection('providerControl')).updateOne({_id:'minhareceita-global',owner},{$set:{nextAt:new Date(Date.now()+wait),leaseUntil:new Date(0)},$unset:{owner:''}});}
export async function processLookup(actor:LookupActor,id:string,transport:typeof fetch=fetch){
  write(actor);return withJob(id,async j=>{
    if(j.status==='COMPLETED')return j;need(j.status==='PROCESSING','Finalize o envio antes de consultar.',409);
    const items=await collection('lookupItems'),deadline=Date.now()+24000;let handled=0;
    while(Date.now()<deadline-9500 && handled<10){
      const item=await items.findOne(scope({jobId:id,state:{$in:['PENDING','RETRY']},$or:[{nextAt:{$exists:false}},{nextAt:{$lte:new Date()}}]}),{sort:{cnpj:1}});
      if(!item)break;
      const owner=randomUUID(),slot=await takeProviderSlot(owner);
      if(!slot.ok){if(slot.wait>2000)break;await new Promise(r=>setTimeout(r,slot.wait));continue;}
      let pause=1100;
      try{
        // Every new job calls the provider again. Shared entities are never treated as a new verification.
        const data=await lookupCnpj(item.cnpj,transport),checkedAt=new Date();
        const fingerprint=digest(JSON.stringify(data)),stateId=`${workspace()}:${item.cnpj}:${fingerprint}`;
        await (await collection('cnpjStates')).updateOne(scope({_id:stateId}),{$setOnInsert:{...scope(),...data,fingerprint,firstSeenAt:checkedAt}},{upsert:true});
        await (await collection('cnpjEntities')).updateOne(scope({cnpj:item.cnpj}),{$set:{stateId,name:data.name,lastCheckedAt:checkedAt},$setOnInsert:{_id:`${workspace()}:${item.cnpj}`,...scope(),cnpj:item.cnpj,createdAt:checkedAt}},{upsert:true});
        await items.updateOne(scope({_id:item._id}),{$set:{state:'DONE',stateId,status:data.status,reason:data.reason,checkedAt,nameMatch:compareNames(item.submittedName,data.name,data.tradeName),source:SOURCE_NAME,sourceReferenceDate:null},$inc:{attempts:1},$unset:{nextAt:''}});
      }catch(error){
        if(!(error instanceof SourceError))throw error;
        const attempts=(item.attempts||0)+1,willRetry=error.retryable&&attempts<3;pause=error.retryable?Math.max(1100,error.retryAfter*1000):1100;
        await items.updateOne(scope({_id:item._id}),{$set:{state:willRetry?'RETRY':'DONE',status:'NAO_CONFIRMADO',reason:error.code,checkedAt:new Date(),source:SOURCE_NAME,...(willRetry?{nextAt:new Date(Date.now()+pause)}:{})},$inc:{attempts:1}});
        if(error.retryable)break;
      }finally{await releaseProviderSlot(owner,pause);}
      handled++;
    }
    const received=await items.countDocuments(scope({jobId:id,state:'DONE'}));need(received<=j.summary.unique,'Contagem inconsistente.',409,'RESULT_COUNT');
    const update:any={received,updatedAt:new Date()};
    const control=await (await collection('providerControl')).findOne({_id:'minhareceita-global'});
    update.nextPollMs=Math.max(1200,Math.min(60000,(control?.nextAt?.getTime()||0)-Date.now()));
    if(received===j.summary.unique){
      const docs=await items.find(scope({jobId:id})).project({cnpj:1,status:1}).toArray();
      if(j.mode===PURCHASE_MODE)await purchaseSummary(id,false);
      update.status='COMPLETED';update.completedAt=new Date();update.resultSummary=statistics(docs as any);
      await audit(actor._id,'lookup.completed',id);
    }
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:update});return getJob(id);
  });
}
export async function cancelLookup(actor:LookupActor,id:string){write(actor);return withJob(id,async j=>{need(j.status!=='COMPLETED','Consulta concluída fica preservada.',409);await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{status:'CANCELLED',updatedAt:new Date()}});await (await collection('lookupStage')).deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.cancel',id);return getJob(id);});}
export async function repeatLookup(actor:LookupActor,id:string){
  write(actor);const old=await getJob(id);need(old.mode!==PURCHASE_MODE,'Para novo relatório de compras, importe novamente as linhas e os valores.',409,'PURCHASE_REIMPORT');need(old.status==='COMPLETED','A consulta anterior precisa estar concluída.',409);
  const count=await (await collection('lookupItems')).countDocuments(scope({jobId:id}));need(count>0,'Sem CNPJs para reconsultar.');
  const j=await createLookup(actor,{importId:randomUUID(),clientId:old.clientId,fileName:'Reconsulta · '+old.fileName.slice(0,170),expectedRows:count});
  await (await collection('lookupItems')).aggregate([
    {$match:scope({jobId:id})},
    {$project:{_id:{$concat:[j._id,':','$cnpj']},workspaceId:1,jobId:{$literal:j._id},clientId:1,cnpj:1,submittedName:1,kind:1,uf:1,occurrences:{$literal:1},state:{$literal:'PENDING'},attempts:{$literal:0},createdAt:'$$NOW'}},
    {$merge:{into:'lookupItems',on:'_id',whenMatched:'keepExisting',whenNotMatched:'insert'}}
  ],{maxTimeMS:20000}).toArray();
  const copied=await (await collection('lookupItems')).countDocuments(scope({jobId:j._id}));need(copied===count,'Reconsulta incompleta: cancele e importe novamente.',409);
  await (await collection('lookupJobs')).updateOne(scope({_id:j._id}),{$set:{repeatedFrom:id,uploaded:count,status:'PROCESSING',summary:{lines:count,unique:count,duplicates:0,invalid:0},startedAt:new Date()}});
  return getJob(j._id);
}
