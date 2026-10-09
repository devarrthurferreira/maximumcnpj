import { DIFAL_VERSION, normalizeUf } from './difal.ts';
import { randomUUID } from 'node:crypto';
import { collection, scope, audit } from './store.ts';
import { need, text, integer, digest } from './security.ts';
import { VERSION, MAX_ROWS } from './domain.ts';
import { LOOKUP_MODE, compactLine, SOURCE_NAME } from './lookup-domain.ts';
import { ensureLookupIndexes, withJob, getJob, write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { PURCHASE_MODE, SALES_MODE, isFinancialMode, PURCHASE_CALCULATION_VERSION, calculationVersion, compactPurchaseLine } from './purchase-domain.ts';
import { finalizePurchaseUpload, purchaseSummary } from './purchase-store.ts';
import { processLookupBatch } from './lookup-engine.ts';
import { assertLookupNotDeleted, assertGenerationNotDeleted } from './generation-deletion.ts';
export async function createLookup(actor:LookupActor,input:any,mode=LOOKUP_MODE){
  return createLookupRecord(actor,input,mode);
}
/** The source is reserved before copying, so retries cannot adopt an ordinary upload. */
async function createLookupRecord(actor:LookupActor,input:any,mode:string,repeatedFrom?:string){
  need([LOOKUP_MODE,PURCHASE_MODE,SALES_MODE].includes(mode),'Tipo de consulta inválido.');
  write(actor);await ensureLookupIndexes();
  const id=text(input.importId);need(/^[a-f0-9-]{36}$/.test(id),'Identificador inválido.');
  await assertLookupNotDeleted(id);
  const c=await (await collection('clients')).findOne(scope({_id:text(input.clientId),active:true}));need(c,'Escolha uma empresa/carteira ativa.');
  const issuerUf=mode===SALES_MODE?normalizeUf(input.issuerUf === undefined ? c.uf : input.issuerUf):'';
  const expected=integer(input.expectedRows,1,MAX_ROWS),fileName=text(input.fileName,200);
  const jobs=await collection('lookupJobs'),old=await jobs.findOne(scope({_id:id}));
  const sameInput=async(existing:NonNullable<typeof old>)=>{
    if(existing.generationId)await assertGenerationNotDeleted(existing.generationId);
    need(existing.mode===mode&&existing.clientId===c._id&&existing.expectedRows===expected&&existing.fileName===fileName&&existing.createdBy===actor._id&&existing.repeatedFrom===repeatedFrom&&(!repeatedFrom||!existing.generationId)&&(mode!==SALES_MODE||input.issuerUf===undefined||(existing.issuerUf||'')===issuerUf),'Identificador já utilizado por outro lote.',409,'LOOKUP_EXISTS');
    return existing;
  };
  if(old)return sameInput(old);
  const job={_id:id,...scope(),mode,...(repeatedFrom?{repeatedFrom}:{}),...(isFinancialMode(mode)?{calculationVersion:PURCHASE_CALCULATION_VERSION}:{}),...(mode===SALES_MODE?{difalVersion:DIFAL_VERSION,issuerUf}:{}),clientId:c._id,clientCode:c.code||null,clientName:c.name,fileName,expectedRows:expected,uploaded:0,status:'UPLOADING',createdAt:new Date(),createdBy:actor._id,version:VERSION,source:SOURCE_NAME,received:0};
  try{await jobs.insertOne(job);}catch(error:any){
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
    const lines=input.rows.map((row:any)=>isFinancialMode(j.mode)?compactPurchaseLine(row,calculationVersion(j),j.mode,{issuerUf:j.issuerUf,difalVersion:j.difalVersion}):compactLine(row)),hash=digest(JSON.stringify(lines)),chunks=await collection('chunks'),key=`lookup:${id}:${offset}`;
    const old=await chunks.findOne(scope({_id:key}));if(old){need(old.hash===hash,'Parte já enviada com outros dados.',409);if(old.complete)return {uploaded:j.uploaded};}
    need(offset===j.uploaded || (old && offset+lines.length===j.uploaded),'Retome a próxima parte esperada.',409,'UPLOAD_OFFSET');
    await chunks.updateOne(scope({_id:key}),{$setOnInsert:{...scope(),hash,complete:false,createdAt:new Date()}},{upsert:true});
    await (await collection('lookupStage')).bulkWrite(lines.map((line:any,i:number)=>({updateOne:{filter:scope({_id:`${id}:${offset+i}`}),update:{$setOnInsert:{...line,...scope(),jobId:id,index:offset+i,expiresAt:new Date(Date.now()+7*86400000)}},upsert:true}})),{ordered:false});
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{uploaded:offset+lines.length}});
    await chunks.updateOne(scope({_id:key}),{$set:{complete:true}});
    return {uploaded:offset+lines.length};
  });
}
export async function finalizeLookup(actor:LookupActor,id:string){
  write(actor);return withJob(id,async j=>{
    if(j.status!=='UPLOADING')return j;
    need(!j.repeatedFrom,'Retome a reconsulta pelo relatório de origem.',409,'RECHECK_SOURCE');
    if(isFinancialMode(j.mode))return finalizePurchaseUpload(actor,j);
    const stage=await collection('lookupStage');const count=await stage.countDocuments(scope({jobId:id}));need(count===j.expectedRows&&j.uploaded===count,'Envio incompleto ou expirado. Reenvie a planilha.',409);
    const unique=await stage.aggregate([{$match:scope({jobId:id,valid:true})},{$sort:{index:1}},{$group:{_id:'$cnpj',name:{$first:'$name'},kind:{$first:'$kind'},uf:{$first:'$uf'},occurrences:{$sum:1}}}],{allowDiskUse:true,maxTimeMS:20000}).toArray();
    const invalid=await stage.countDocuments(scope({jobId:id,valid:false}));
    const errors=await stage.find(scope({jobId:id,valid:false})).project({index:1,reason:1,documentHint:1}).limit(100).toArray();
    const items=await collection('lookupItems');
    for(let p=0;p<unique.length;p+=500)await items.bulkWrite(unique.slice(p,p+500).map(r=>({updateOne:{filter:scope({_id:`${id}:${r._id}`}),update:{$setOnInsert:{...scope(),jobId:id,clientId:j.clientId,cnpj:r._id,submittedName:r.name,kind:r.kind,uf:r.uf,occurrences:r.occurrences,state:'PENDING',attempts:0,createdAt:new Date()}},upsert:true}})),{ordered:false});
    const summary={lines:count,unique:unique.length,invalid,duplicates:count-invalid-unique.length};
    await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{summary,diagnostics:errors,status:unique.length?'PROCESSING':'INVALID',received:0,startedAt:new Date()}});
    await stage.deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.validated',id);return getJob(id);
  });
}
export async function processLookup(actor:LookupActor,id:string,transport:typeof fetch=fetch){
  return processLookupBatch(actor,id,transport);
}
export async function cancelLookup(actor:LookupActor,id:string){write(actor);return withJob(id,async j=>{need(j.status!=='COMPLETED','Consulta concluída fica preservada.',409);await (await collection('lookupJobs')).updateOne(scope({_id:id}),{$set:{status:'CANCELLED',updatedAt:new Date()}});await (await collection('lookupStage')).deleteMany(scope({jobId:id}));await audit(actor._id,'lookup.cancel',id);return getJob(id);});}
export async function repeatLookup(actor:LookupActor,id:string){
  write(actor);const old=await getJob(id);
  need(!isFinancialMode(old.mode),'Para novo relatório financeiro, importe novamente as linhas e os valores.',409,'PURCHASE_REIMPORT');
  return recheckLookup(actor,id);
}
/** Revalidation creates an independent snapshot, with an optional stable ID for uncertain responses. */
export async function recheckLookup(actor: LookupActor, id: string, input: any = {}) {
  write(actor);
  need(input && typeof input === 'object' && !Array.isArray(input), 'Pedido de reconsulta inválido.');
  const importId = input.importId === undefined ? randomUUID() : text(input.importId, 36);
  need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(importId), 'Identificador inválido.');
  need(importId !== id, 'A reconsulta precisa de um novo identificador.', 409, 'LOOKUP_EXISTS');
  await getJob(id);
  // Holding the source lease prevents deletion halfway through a recoverable copy.
  return withJob(id, async old => {
    need(old.status === 'COMPLETED', 'A consulta anterior precisa estar concluída.', 409);
    const financial = isFinancialMode(old.mode);
    const count = financial ? (await purchaseSummary(id, true, old.mode)).totals.uniqueCnpjs
      : await (await collection('lookupItems')).countDocuments(scope({jobId: id}));
    need(count > 0, 'Este relatório não tem CNPJs consultáveis.');
    const fresh = await createLookupRecord(actor, {importId, clientId: old.clientId,
      fileName: 'Reconsulta · ' + old.fileName.slice(0,170), expectedRows: financial ? old.expectedRows : count,
      issuerUf: old.issuerUf}, old.mode, id);
    // A lost HTTP response must return the same job, including one already processed.
    if (['PROCESSING', 'COMPLETED'].includes(fresh.status)) return fresh;
    return withJob(fresh._id, async locked => {
      need(locked.status === 'UPLOADING', 'Esta reconsulta foi cancelada ou alterada. Inicie outra reconsulta.', 409, 'RECHECK_CANCELLED');
      if (financial) await (await collection('purchaseLines')).aggregate([
        {$match: scope({jobId: id})},
        {$set: {_id: {$concat: [fresh._id, ':', {$toString: '$index'}]}, jobId: {$literal: fresh._id}}},
        {$merge: {into: 'purchaseLines', on: '_id', whenMatched: 'keepExisting', whenNotMatched: 'insert'}}
      ], {maxTimeMS: 20000}).toArray();
      await (await collection('lookupItems')).aggregate([
        {$match: scope({jobId: id})},
        {$project: {_id: {$concat: [fresh._id, ':', '$cnpj']}, workspaceId: 1, jobId: {$literal: fresh._id}, clientId: 1,
          cnpj: 1, submittedName: 1, kind: 1, uf: 1, occurrences: financial ? 1 : {$literal: 1}, ...(financial ? {totalCents: 1} : {}),
          state: {$literal: 'PENDING'}, attempts: {$literal: 0}, createdAt: '$$NOW'}},
        {$merge: {into: 'lookupItems', on: '_id', whenMatched: 'keepExisting', whenNotMatched: 'insert'}}
      ], {maxTimeMS: 20000}).toArray();
      const rows = financial ? await (await collection('purchaseLines')).countDocuments(scope({jobId: fresh._id})) : count;
      const items = await (await collection('lookupItems')).countDocuments(scope({jobId: fresh._id}));
      need(rows === fresh.expectedRows && items === count, 'Revalidação incompleta. Tente novamente para retomar o mesmo lote.', 409, 'RESULT_COUNT');
      await (await collection('lookupJobs')).updateOne(scope({_id: fresh._id}), {$set: {uploaded: rows,
        summary: financial ? old.summary : {lines: count, unique: count, duplicates: 0, invalid: 0},
        ...(financial ? {purchaseInput: old.purchaseInput, calculationVersion: calculationVersion(old)} : {}),
        ...(old.reportPeriod ? {reportPeriod: old.reportPeriod} : {}),
        ...(old.mode === SALES_MODE && old.difalVersion ? {difalVersion: old.difalVersion, issuerUf: old.issuerUf} : {}),
        status: 'PROCESSING', startedAt: new Date()}, ...(old.mode === SALES_MODE && old.difalVersion === undefined ? {$unset: {difalVersion: '', issuerUf: ''}} : {})});
      await audit(actor._id, 'lookup.recheck', fresh._id);
      return getJob(fresh._id);
    });
  });
}
