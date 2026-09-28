import { randomUUID } from 'node:crypto';
import { collection, scope, audit } from './store.ts';
import { need } from './security.ts';
import { mappedClient } from './lookup-domain.ts';
import { ensureLookupIndexes, admin } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
export async function importCatalog(actor:LookupActor,rows:any){
  admin(actor);need(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'Envie de 1 a 100 cadastros por parte.');
  await ensureLookupIndexes();const c=await collection('clients');const items:any[]=[];
  for(let i=0;i<rows.length;i++){
    try{
      const fields=mappedClient(rows[i]);
      const byCode=await c.findOne(scope({code:fields.code}));
      const byDoc=fields.cnpj?await c.findOne(scope({cnpj:fields.cnpj})):null;
      need(!byCode?.cnpj||!fields.cnpj||byCode.cnpj===fields.cnpj,'Código já vinculado a outro CNPJ. Revise o cadastro.',409,'CODE_CONFLICT');
      need(!(byCode&&byDoc&&byCode._id!==byDoc._id),'Código e CNPJ apontam para cadastros diferentes.',409,'CODE_CONFLICT');
      need(!byDoc?.code||byDoc.code===fields.code,'Este CNPJ já está vinculado a outro código.',409,'CNPJ_CONFLICT');
      const old=byCode||byDoc,id=old?old._id:randomUUID();
      if(!fields.cnpj&&old?.cnpj){fields.cnpj=old.cnpj;fields.documentKind='CNPJ';}
      await c.updateOne(scope({_id:id}),{$set:{...fields,updatedAt:new Date()},$setOnInsert:{...scope(),notes:'',createdAt:new Date(),createdBy:actor._id}},{upsert:true});
      items.push({index:i,code:fields.code,id,ok:true,action:old?'updated':'created',warning:fields.documentKind!=='CNPJ'?'CADASTRO_SEM_CNPJ_CONSULTAVEL':null});
    }catch(e:any){items.push({index:i,code:String(rows[i]?.code||'').slice(0,32),ok:false,error:e.code||'INVALID_CLIENT',message:e.message});}
  }
  await audit(actor._id,'catalog.import',`${items.filter(v=>v.ok).length}/${rows.length}`);
  return {items,success:items.filter(v=>v.ok).length,failed:items.filter(v=>!v.ok).length};
}
export async function listCatalog(){return {items:await (await collection('clients')).find(scope()).sort({active:-1,code:1,name:1}).limit(2000).toArray()};}
