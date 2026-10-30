import type {DifalPolicy} from '../public/simulator-engine.js';
import {parseDifalPolicy} from '../public/simulator-engine.js';
import {ANTICIPATION_VERSION} from './icms-anticipation.ts';
import { DIFAL_VERSION, normalizeUf } from './difal.ts';
import {OPERATION_CATALOG_VERSION} from './operation-catalog.ts';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { insertStoredJob, jobCollection } from './mongo-storage.ts';
import { need, text, integer, digest } from './security.ts';
import { VERSION, MAX_ROWS } from './domain.ts';
import { LOOKUP_MODE, compactLine, SOURCE_NAME } from './lookup-domain.ts';
import { ensureLookupIndexes, withJob, getJob, write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { PURCHASE_MODE, SALES_MODE, isFinancialMode, PURCHASE_CALCULATION_VERSION, calculationVersion, compactPurchaseLine } from './purchase-domain.ts';
import { finalizePurchaseUpload, reconciledPurchaseSummary as purchaseSummary } from './purchase-store.ts';
import { processLookupBatch } from './lookup-engine.ts';
import { assertLookupNotDeleted, assertGenerationNotDeleted } from './generation-deletion.ts';
export async function createLookup(actor:LookupActor,input:any,mode=LOOKUP_MODE){
  return createLookupRecord(actor,input,mode);
}
export function validateExpectedPayloadBytes(value:unknown):number|undefined {
  if(value===undefined)return undefined;
  need(typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=MAX_ROWS*65536,
    'Informe o tamanho previsto do arquivo em bytes inteiros, maior que zero e dentro do limite permitido.');
  return value;
}
/** The source is reserved before copying, so retries cannot adopt an ordinary upload. */
async function createLookupRecord(actor:LookupActor,input:any,mode:string,repeatedFrom?:string, sourceDifalPolicy?:DifalPolicy){
  need([LOOKUP_MODE,PURCHASE_MODE,SALES_MODE].includes(mode),'Tipo de consulta inválido.');
  write(actor);await ensureLookupIndexes();
  const id=text(input.importId);need(/^[a-f0-9-]{36}$/.test(id),'Identificador inválido.');
  await assertLookupNotDeleted(id);
  const c=await (await collection('clients')).findOne(scope({_id:text(input.clientId),active:true}));need(c,'Escolha uma empresa/carteira ativa.');
  const issuerUf=isFinancialMode(mode)?normalizeUf(input.issuerUf === undefined ? c.uf : input.issuerUf):'';
  const expected=integer(input.expectedRows,1,MAX_ROWS),fileName=text(input.fileName,200),expectedPayloadBytes=validateExpectedPayloadBytes(input.expectedPayloadBytes);
  const jobs=await collection('lookupJobs'),old=await jobs.findOne(scope({_id:id}));
  const sameInput=async(existing:NonNullable<typeof old>)=>{
    if(existing.generationId)await assertGenerationNotDeleted(existing.generationId);
    need(existing.mode===mode&&existing.clientId===c._id&&existing.expectedRows===expected&&existing.fileName===fileName&&existing.createdBy===actor._id&&existing.repeatedFrom===repeatedFrom&&(!repeatedFrom||!existing.generationId)&&(!isFinancialMode(mode)||input.issuerUf===undefined||(existing.issuerUf||'')===issuerUf),'Identificador já utilizado por outro lote.',409,'LOOKUP_EXISTS');
    return existing;
  };
  if(old)return sameInput(old);
  let job:Doc={_id:id,...scope(),mode,...(repeatedFrom?{repeatedFrom}:{}),...(repeatedFrom && sourceDifalPolicy !== undefined ? {difalPolicy:parseDifalPolicy(sourceDifalPolicy),difalPolicyOrigin:'RECHECK_SOURCE'} : {}),...(isFinancialMode(mode)?{calculationVersion:PURCHASE_CALCULATION_VERSION,operationVersion:OPERATION_CATALOG_VERSION,issuerUf}:{}),...(mode===SALES_MODE?{difalVersion:DIFAL_VERSION}:mode===PURCHASE_MODE?{anticipationVersion:ANTICIPATION_VERSION}:{}),clientId:c._id,clientCode:c.code||null,clientName:c.name,fileName,expectedRows:expected,...(expectedPayloadBytes===undefined?{}:{expectedPayloadBytes}),uploaded:0,status:'UPLOADING',createdAt:new Date(),createdBy:actor._id,version:VERSION,source:SOURCE_NAME,received:0};
  try{job=await insertStoredJob(job);}catch(error:any){
    if(error.code!==11000)throw error;
    const concurrent=await jobs.findOne(scope({_id:id}));
    need(concurrent,'Identificador de consulta indisponível.',409,'LOOKUP_EXISTS');
    return sameInput(concurrent);
  }
  try { await assertLookupNotDeleted(id); }
  catch (error) { await jobs.deleteOne(scope({_id:id})); throw error; }
  await audit(actor._id,'lookup.create',id);return job;
}
export async function uploadLookup(actor:LookupActor,id:string,input:any){
  write(actor);return withJob(id,async j=>{
    need(!j.repeatedFrom,'Uma reconsulta recebe somente as linhas do relatório de origem.',409,'RECHECK_SOURCE');
    need(j.status==='UPLOADING','Este lote não aceita novas linhas.',409);
    need(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=250,'Envie até 250 linhas por parte.');
    const offset=integer(input.offset,0,j.expectedRows-1);need(offset+input.rows.length<=j.expectedRows,'Linhas excedem o tamanho do lote.');
    const lines=input.rows.map((row:any)=>isFinancialMode(j.mode)?compactPurchaseLine(row,calculationVersion(j),j.mode,{issuerUf:j.issuerUf,difalVersion:j.difalVersion,operationVersion:j.operationVersion,anticipationVersion:j.anticipationVersion}):compactLine(row)),hash=digest(JSON.stringify(lines)),chunks=await collection('chunks'),key=`lookup:${id}:${offset}`;
    const old=await chunks.findOne(scope({_id:key}));if(old){need(old.hash===hash,'Parte já enviada com outros dados.',409);if(old.complete)return {uploaded:j.uploaded};}
    need(offset===j.uploaded || (old && offset+lines.length===j.uploaded),'Retome a próxima parte esperada.',409,'UPLOAD_OFFSET');
    const advances=offset===j.uploaded,uploadedPayloadBytes=j.uploadedPayloadBytes??0;
    need(Number.isSafeInteger(uploadedPayloadBytes)&&uploadedPayloadBytes>=0,
      'O contador de bytes deste relatório é inconsistente. Os dados foram preservados para conferência.',409,'STORAGE_RESERVATION');
    const partBytes=input.rows.reduce((sum:number,row:any)=>sum+Buffer.byteLength(JSON.stringify(row),'utf8')+1,0),
      nextBytes=uploadedPayloadBytes+(advances?partBytes:0);
    need(Number.isSafeInteger(nextBytes),'O tamanho deste relatório excede o limite de armazenamento.',503,'STORAGE_RESERVATION_EXCEEDED');
    if(j.expectedPayloadBytes!==undefined)need(nextBytes<=j.expectedPayloadBytes,
      'O tamanho enviado ultrapassa o espaço reservado para este relatório. Revise o tamanho informado e inicie uma nova importação. O progresso anterior foi preservado.',503,'STORAGE_RESERVATION_EXCEEDED');
    await chunks.updateOne(scope({_id:key}),{$setOnInsert:{...scope(),hash,complete:false,createdAt:new Date()}},{upsert:true});
    await (await jobCollection('lookupStage',j)).bulkWrite(lines.map((line:any,i:number)=>({updateOne:{filter:scope({_id:`${id}:${offset+i}`}),update:{$setOnInsert:{...line,...scope(),jobId:id,index:offset+i,expiresAt:new Date(Date.now()+7*86400000)}},upsert:true}})),{ordered:false});
    const jobs=await collection('lookupJobs'),now=new Date();
    const committed=await jobs.updateOne(scope({_id:id,status:'UPLOADING',uploaded:j.uploaded,leaseOwner:j.leaseOwner,leaseUntil:{$gt:now}}),
      {$set:{leaseUntil:new Date(now.getTime()+120000),...(advances?{uploaded:offset+lines.length,uploadedPayloadBytes:nextBytes}:{})}});
    need(committed.matchedCount===1,'Este envio foi atualizado por outra requisição. Retome o mesmo relatório para conferir o progresso salvo.',409,'JOB_BUSY');
    need(await jobs.findOne(scope({_id:id,status:'UPLOADING',uploaded:offset+lines.length,leaseOwner:j.leaseOwner,leaseUntil:{$gt:new Date()}}),{projection:{_id:1}}),
      'A posse deste envio expirou antes de confirmar a parte. Retome o mesmo relatório.',409,'JOB_BUSY');
    await chunks.updateOne(scope({_id:key}),{$set:{complete:true}});
    return {uploaded:offset+lines.length};
  });
}
export async function finalizeLookup(actor:LookupActor,id:string){
  write(actor);return withJob(id,async j=>{
    if(j.status!=='UPLOADING')return j;
    need(!j.repeatedFrom,'Retome a reconsulta pelo relatório de origem.',409,'RECHECK_SOURCE');
    if(isFinancialMode(j.mode))return finalizePurchaseUpload(actor,j);
    const stage=await jobCollection('lookupStage',j);const count=await stage.countDocuments(scope({jobId:id}));need(count===j.expectedRows&&j.uploaded===count,'Envio incompleto ou expirado. Reenvie a planilha.',409);
    const unique=await stage.aggregate([{$match:scope({jobId:id,valid:true})},{$sort:{index:1}},{$group:{_id:'$cnpj',name:{$first:'$name'},kind:{$first:'$kind'},uf:{$first:'$uf'},occurrences:{$sum:1}}}],{allowDiskUse:true,maxTimeMS:20000}).toArray();
    const invalid=await stage.countDocuments(scope({jobId:id,valid:false}));
    const errors=await stage.find(scope({jobId:id,valid:false})).project({index:1,reason:1,documentHint:1}).limit(100).toArray();
    const items=await jobCollection('lookupItems',j);
    for(let p=0;p<unique.length;p+=500)await items.bulkWrite(unique.slice(p,p+500).map(r=>({updateOne:{filter:scope({_id:`${id}:${r._id}`}),update:{$setOnInsert:{...scope(),jobId:id,clientId:j.clientId,cnpj:r._id,submittedName:r.name,kind:r.kind,uf:r.uf,occurrences:r.occurrences,state:'PENDING',attempts:0,createdAt:new Date()}},upsert:true}})),{ordered:false});
    const summary={lines:count,unique:unique.length,invalid,duplicates:count-invalid-unique.length};
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{summary,diagnostics:errors,status:unique.length?'PROCESSING':'INVALID',received:0,startedAt:new Date()}});
    await stage.deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.validated',id);return getJob(id);
  });
}
export async function processLookup(actor:LookupActor,id:string,transport:typeof fetch=fetch){
  return processLookupBatch(actor,id,transport);
}
export async function cancelLookup(actor:LookupActor,id:string){write(actor);return withJob(id,async j=>{need(j.status!=='COMPLETED','Consulta concluída fica preservada.',409);await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{status:'CANCELLED',updatedAt:new Date()}});await (await jobCollection('lookupStage',j)).deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.cancel',id);return getJob(id);});}
export async function repeatLookup(actor:LookupActor,id:string){
  write(actor);const old=await getJob(id);
  need(!isFinancialMode(old.mode),'Para novo relatório financeiro, importe novamente as linhas e os valores.',409,'PURCHASE_REIMPORT');
  return recheckLookup(actor,id);
}
const RECHECK_COPY_BATCH = 500;
async function recheckPayloadBytes(source:Doc,financial:boolean) {
  const sizes=await Promise.all((financial?['purchaseLines','lookupItems']:['lookupItems']).map(async name=>{
    const [size]=await(await jobCollection(name,source)).aggregate([
      {$match:scope({jobId:source._id})},{$group:{_id:null,bytes:{$sum:{$bsonSize:'$$ROOT'}}}}
    ],{maxTimeMS:20000}).toArray();
    return size?.bytes||0;
  }));
  return validateExpectedPayloadBytes(sizes.reduce((sum,size)=>sum+size,0))!;
}
async function renewRecheckLeases(source:Doc,target:Doc) {
  const jobs=await collection('lookupJobs'),now=new Date();
  for(const job of [source,target]){
    const result=await jobs.updateOne(scope({_id:job._id,leaseOwner:job.leaseOwner,leaseUntil:{$gt:now}}),
      {$set:{leaseUntil:new Date(Date.now()+120000)}});
    need(result.matchedCount===1,'A reconsulta está sendo atualizada. Retome o mesmo documento.',409,'JOB_BUSY');
  }
}
/** Copy between fixed destinations in bounded, idempotent batches; never run a cross-database $merge. */
async function copyRecheckData(source:Doc,target:Doc,financial:boolean,expectedItems:number) {
  if(financial){
    const from=await jobCollection('purchaseLines',source),to=await jobCollection('purchaseLines',target);
    let offset=0;
    while(offset<source.expectedRows){
      await renewRecheckLeases(source,target);
      const rows=await from.find(scope({jobId:source._id,index:{$gte:offset}})).sort({index:1}).limit(RECHECK_COPY_BATCH).maxTimeMS(20000).toArray();
      need(rows.length===Math.min(RECHECK_COPY_BATCH,source.expectedRows-offset)&&rows.every((row,index)=>row.index===offset+index),
        'As linhas originais da reconsulta estão incompletas.',409,'RESULT_COUNT');
      const copies=rows.map(row=>({...row,_id:`${target._id}:${row.index}`,jobId:target._id}));
      await to.bulkWrite(copies.map(row=>({updateOne:{filter:scope({_id:row._id}),update:{$setOnInsert:row},upsert:true}})),{ordered:false});
      const saved=await to.find(scope({jobId:target._id,index:{$gte:offset,$lt:offset+rows.length}})).sort({index:1}).maxTimeMS(20000).toArray();
      need(isDeepStrictEqual(saved,copies),'A cópia financeira da reconsulta diverge de sua origem. Os dados foram preservados para conferência.',409,'RESULT_COUNT');
      offset+=rows.length;
    }
  }
  const from=await jobCollection('lookupItems',source),to=await jobCollection('lookupItems',target);
  let after='',copied=0;
  while(copied<expectedItems){
    await renewRecheckLeases(source,target);
    const rows=await from.find(scope({jobId:source._id,...(after?{cnpj:{$gt:after}}:{})})).sort({cnpj:1}).limit(RECHECK_COPY_BATCH).maxTimeMS(20000).toArray();
    need(rows.length===Math.min(RECHECK_COPY_BATCH,expectedItems-copied)&&rows.every(row=>typeof row.cnpj==='string'&&row.cnpj>after),
      'Os CNPJs originais da reconsulta estão incompletos.',409,'RESULT_COUNT');
    const copies=rows.map(row=>({_id:`${target._id}:${row.cnpj}`,...scope(),jobId:target._id,
      ...Object.fromEntries(['clientId','cnpj','submittedName','kind','uf',...(financial?['totalCents']:[])].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),
      occurrences:financial?row.occurrences:1,state:'PENDING',attempts:0,createdAt:target.createdAt}));
    await to.bulkWrite(copies.map(row=>({updateOne:{filter:scope({_id:row._id}),update:{$setOnInsert:row},upsert:true}})),{ordered:false});
    const saved=await to.find(scope({_id:{$in:copies.map(row=>row._id)}})).sort({cnpj:1}).maxTimeMS(20000).toArray();
    // A resumable copy created by an earlier release may have used its batch time.
    need(saved.every(row=>row.createdAt instanceof Date)&&isDeepStrictEqual(saved.map(row=>({...row,createdAt:target.createdAt})),copies),
      'Os CNPJs copiados divergem da reconsulta. Os dados foram preservados para conferência.',409,'RESULT_COUNT');
    copied+=rows.length;after=rows.at(-1)!.cnpj;
  }
}
/** Revalidation creates an independent snapshot, with an optional stable ID for uncertain responses. */
export async function recheckLookup(actor: LookupActor, id: string, input: any = {}) {
  write(actor);
  need(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => key === 'importId'), 'Pedido de reconsulta inválido.');
  const importId = input.importId === undefined ? randomUUID() : text(input.importId, 36);
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(importId), 'Identificador inválido.');
  need(importId !== id, 'A reconsulta precisa de um novo identificador.', 409, 'LOOKUP_EXISTS');
  await getJob(id);
  // Holding the source lease prevents deletion halfway through a recoverable copy.
  return withJob(id, async old => {
    need(old.status === 'COMPLETED', 'A consulta anterior precisa estar concluída.', 409);
    const financial = isFinancialMode(old.mode);
    const sourceSummary = financial ? await purchaseSummary(id, true, old.mode) : null;
    const count = sourceSummary ? sourceSummary.totals.uniqueCnpjs
      : await (await jobCollection('lookupItems',old)).countDocuments(scope({jobId: id}));
    need(count > 0, 'Este relatório não tem CNPJs consultáveis.');
    const expectedPayloadBytes=await recheckPayloadBytes(old,financial);
    const fresh = await createLookupRecord(actor, {importId, clientId: old.clientId,
      fileName: 'Reconsulta · ' + old.fileName.slice(0,170), expectedRows: financial ? old.expectedRows : count,
      issuerUf: old.issuerUf,expectedPayloadBytes}, old.mode, id, sourceSummary?.difalPolicy);
    // A lost HTTP response must return the same job, including one already processed.
    if (['PROCESSING', 'COMPLETED'].includes(fresh.status)) return fresh;
    return withJob(fresh._id, async locked => {
      need(locked.status === 'UPLOADING', 'Esta reconsulta foi cancelada ou alterada. Inicie outra reconsulta.', 409, 'RECHECK_CANCELLED');
      await copyRecheckData(old,locked,financial,count);
      const rows = financial ? await (await jobCollection('purchaseLines',locked)).countDocuments(scope({jobId: fresh._id})) : count;
      const items = await (await jobCollection('lookupItems',locked)).countDocuments(scope({jobId: fresh._id}));
      need(rows === fresh.expectedRows && items === count, 'Revalidação incompleta. Tente novamente para retomar o mesmo lote.', 409, 'RESULT_COUNT');
      // A delayed copy must not publish over a cancellation or a replacement
      // writer that acquired either lease while the database was unavailable.
      await renewRecheckLeases(old,locked);
      const committed=await (await collection('lookupJobs')).updateOne(scope({_id: fresh._id,status:'UPLOADING',
        leaseOwner:locked.leaseOwner,leaseUntil:{$gt:new Date()}}), {$set: {uploaded: rows,
        summary: financial ? old.summary : {lines: count, unique: count, duplicates: 0, invalid: 0},
        ...(financial ? {purchaseInput: old.purchaseInput, calculationVersion: calculationVersion(old), ...(old.operationVersion ? {operationVersion:old.operationVersion} : {}), ...(old.issuerUf !== undefined ? {issuerUf:old.issuerUf} : {})} : {}),
        ...(old.reportPeriod ? {reportPeriod: old.reportPeriod} : {}),
        ...(old.mode === SALES_MODE && old.difalVersion ? {difalVersion: old.difalVersion, issuerUf: old.issuerUf} : {}),
        ...(old.mode === PURCHASE_MODE && old.anticipationVersion ? {anticipationVersion:old.anticipationVersion} : {}),
        status: 'PROCESSING', startedAt: new Date()}, ...(financial && (!old.operationVersion || old.issuerUf === undefined || old.mode === SALES_MODE && old.difalVersion === undefined || old.mode === PURCHASE_MODE && old.anticipationVersion === undefined) ? {$unset: {
          ...(!old.operationVersion ? {operationVersion:''} : {}), ...(old.issuerUf === undefined ? {issuerUf:''} : {}),
          ...(old.mode === SALES_MODE && old.difalVersion === undefined ? {difalVersion:''} : {}),
          ...(old.mode === PURCHASE_MODE && old.anticipationVersion === undefined ? {anticipationVersion:''} : {})}} : {})});
      need(committed.matchedCount===1,'A reconsulta foi atualizada por outra requisição. Retome o mesmo documento.',409,'JOB_BUSY');
      await audit(actor._id, 'lookup.recheck', fresh._id);
      return getJob(fresh._id);
    });
  });
}
