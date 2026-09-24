import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';
import { closeDatabase, collection, database, seed, scope } from '../src/store.ts';
import { BigQuerySource } from '../src/provider.ts';
import { digits } from '../src/domain.ts';
// Uses an isolated random database and mocked BigQuery. Never consults a real CNPJ.
test('HTTP + Mongo: autenticação, carteira, upload, deduplicação, retomada e snapshots',{skip:!process.env.MONGODB_URI},async()=>{
 const original={...process.env};process.env.MONGODB_DB='maximum_test_'+randomUUID().replace(/-/g,'');process.env.WORKSPACE_ID='test-a';
 process.env.ADMIN_EMAIL='admin@example.test';process.env.ADMIN_NAME='Teste';process.env.ADMIN_PASSWORD='SenhaSintetica123!';process.env.APP_ORIGIN='http://localhost:3000';
 process.env.GOOGLE_CLOUD_PROJECT='test-project';process.env.BQ_SOURCE_TABLE='source-project.public.receita';process.env.BQ_LOCATION='US';process.env.BQ_MAXIMUM_BYTES_BILLED='1000000';process.env.BQ_SOURCE_APPROVED='true';
 await seed();const server=startServer(0);await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
 const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;let cookie='';
 const originalMethods={estimate:BigQuerySource.prototype.estimate,inspect:BigQuerySource.prototype.inspect,start:BigQuerySource.prototype.start,job:BigQuerySource.prototype.job,page:BigQuerySource.prototype.page};
 async function request(path:string,method='GET',data?:unknown,headers:Record<string,string>={}) {const res=await fetch(base+path,{method,headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:cookie,...headers},body:data===undefined?undefined:JSON.stringify(data)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie')!.split(';')[0];return {status:res.status,data:await res.json() as any};}
 try {
  assert.equal((await request('/api/clients')).status,401);
  assert.equal((await request('/api/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD},{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/api/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})).status,200);
  const c=(await request('/api/clients','POST',{name:'Carteira de teste'})).data;
  const cnpj=(i:number)=>{const b=String(80000000+i)+'0001';return b+digits(b);};
  const rows=Array.from({length:10001},(_,i)=>[cnpj(i),`Sintética ${i}`]);rows.push(rows[0]);rows.push(['invalido','Inválida']);
  const id=randomUUID();assert.equal((await request('/api/batches','POST',{importId:id,clientId:c.id,fileName:'carga.csv',headers:['CNPJ','NOME'],cnpjColumn:0,nameColumn:1,expectedRows:rows.length})).status,201);
  for(let offset=0;offset<rows.length;offset+=250){const r=await request(`/api/batches/${id}/rows`,'POST',{offset,rows:rows.slice(offset,offset+250)});assert.equal(r.status,200,JSON.stringify(r.data));}
  const repeated=await request(`/api/batches/${id}/rows`,'POST',{offset:0,rows:rows.slice(0,250)});assert.equal(repeated.data.uploaded,rows.length);
  const changed=await request(`/api/batches/${id}/rows`,'POST',{offset:0,rows:[[cnpj(0),'Outra linha']]});assert.equal(changed.status,409);
  const ready=await request(`/api/batches/${id}/finalize`,'POST',{});assert.equal(ready.data.summary.unique,10001);assert.equal(ready.data.summary.duplicates,1);assert.equal(ready.data.summary.invalid,1);
  assert.equal((await request(`/api/batches/${id}/results`)).status,409);
  BigQuerySource.prototype.inspect=async()=>({table:'source-project.public.receita',etag:'synthetic',location:'US',modifiedAt:'0',fields:[],referenceDate:null,adapter:'test'});
  BigQuerySource.prototype.estimate=async function(){return {bytes:'100',withinLimit:true,maximumBytesBilled:'1000000',source:await this.inspect()};};
  BigQuerySource.prototype.start=async()=>({});BigQuerySource.prototype.job=async()=>({status:{state:'DONE'},statistics:{query:{totalBytesBilled:'100'}}});
  BigQuerySource.prototype.page=async(_id,pageToken)=>{const offset=Number(pageToken||0),part=rows.slice(offset,Math.min(offset+1000,10001));return {running:false,results:part.map((r,i)=>({cnpj:r[0],name:r[1],status:(offset+i)%3===0?'NAO_CONFIRMADO':(offset+i)%2===0?'OPTANTE':'NAO_OPTANTE',mei:false,reason:null,rawSimples:null,rawMei:null,sourceCount:1,optionDate:null,meiDate:null,uf:null})),next:offset+1000<10001?String(offset+1000):null,total:10001,billed:'100'};};
  const estimated=(await request(`/api/batches/${id}/estimate`,'POST',{})).data;
  assert.equal((await request(`/api/batches/${id}/start`,'POST',{estimateId:estimated.estimate.id,accept:true})).status,200);
  let finished;for(let i=0;i<11;i++){const r=await request(`/api/batches/${id}/advance`,'POST',{});assert.equal(r.status,200,JSON.stringify(r.data));finished=r.data;if(i===0)assert.equal((await request('/api/dashboard')).data.metrics.total,0);}
  assert.equal(finished.status,'COMPLETED');assert.equal(finished.resultSummary.total,10001);
  assert.equal((await request('/api/dashboard')).data.metrics.total,10001);
  assert.equal((await request(`/api/batches/${id}/results`)).data.items.length,50);
  const exported=(await request(`/api/batches/${id}/export?offset=10000`)).data;assert.equal(exported.rows.length,3);assert.equal(exported.rows[1][4],'Sim');
  // A newer observation updates one entity rather than inflating global indicators.
  const other=randomUUID();await (await collection('batches')).insertOne({_id:other,...scope(),clientId:c.id,status:'COMPLETED',createdAt:new Date()});
  await (await collection('results')).insertOne({_id:other+':'+cnpj(0),...scope(),batchId:other,clientId:c.id,cnpj:cnpj(0),status:'OPTANTE',mei:true,completed:true,observedAt:new Date(Date.now()+1000)});
  const metrics=(await request('/api/dashboard')).data.metrics;assert.equal(metrics.total,10001);assert.equal(metrics.mei,1);
  process.env.WORKSPACE_ID='test-b';assert.equal((await request('/api/clients')).status,401);process.env.WORKSPACE_ID='test-a';
  assert.equal((await request('/api/auth/logout','POST',{})).status,200);assert.equal((await request('/api/clients')).status,401);
 } finally {Object.assign(BigQuerySource.prototype,originalMethods);await (await database()).dropDatabase();await closeDatabase();await new Promise<void>(resolve=>server.close(()=>resolve()));for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
