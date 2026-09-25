import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';
import { closeDatabase, collection, database, seed, scope } from '../src/store.ts';
import { digits } from '../src/domain.ts';
// Usa banco aleatório descartável. Não aponta para uma fonte fiscal nem banco de produção.
test('HTTP + MongoDB: 10.001 únicos, conflitos, retomada, exportação e permissões', {skip:!process.env.MONGODB_URI,timeout:120000}, async () => {
  const original={...process.env}; const dbName='maximum_test_'+randomUUID().replace(/-/g,'');
  process.env.MONGODB_DB=dbName;process.env.WORKSPACE_ID='test-a';process.env.APP_ORIGIN='http://localhost:3000';
  process.env.ADMIN_EMAIL='admin@example.test';process.env.ADMIN_NAME='Teste';process.env.ADMIN_PASSWORD='SenhaSintetica123!';
  let server:ReturnType<typeof startServer>|undefined;
  try {
    await seed();server=startServer(0);await new Promise<void>(r=>server!.listening?r():server!.once('listening',r));
    const base='http://127.0.0.1:'+(server.address() as any).port;let cookie='';
    const req=async(path:string,method='GET',data?:unknown)=>{
      const r=await fetch(base+path,{method,headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});
      const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return {status:r.status,data:await r.json() as any};
    };
    assert.equal((await req('/api/clients')).status,401);
    assert.equal((await req('/api/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})).status,200);
    const adminCookie=cookie,c=(await req('/api/clients','POST',{name:'Carteira sintética'})).data;
    const key=(i:number)=>{const b=String(80000000+i)+'0001';return b+digits(b);};
    const rows=Array.from({length:10001},(_,i)=>[key(i),'Empresa '+i,i%2?'Sim':'Não']);
    rows.push([...rows[0]]);rows.push([key(1),'Conflito','Não']);rows.push(['invalido','Inválida','Sim']);
    const id=randomUUID(),meta={importId:id,clientId:c.id,fileName:'sintetico.csv',headers:['CNPJ','Nome','Simples'],cnpjColumn:0,nameColumn:1,statusColumn:2,expectedRows:rows.length};
    assert.equal((await req('/api/batches','POST',meta)).status,201);
    assert.equal((await req('/api/batches','POST',{...meta,statusColumn:-1})).status,409);
    for(let offset=0;offset<rows.length;offset+=250){const r=await req(`/api/batches/${id}/rows`,'POST',{offset,rows:rows.slice(offset,offset+250)});assert.equal(r.status,200,JSON.stringify(r.data));}
    assert.equal((await req(`/api/batches/${id}/rows`,'POST',{offset:0,rows:rows.slice(0,250)})).data.uploaded,rows.length);
    assert.equal((await req(`/api/batches/${id}/rows`,'POST',{offset:0,rows:[[key(0),'Mudou','Não']]})).status,409);
    const ready=(await req(`/api/batches/${id}/finalize`,'POST',{})).data;
    assert.deepEqual(ready.summary,{lines:10004,unique:10001,invalid:1,duplicates:2});assert.equal(ready.status,'PROCESSING');
    assert.equal((await req(`/api/batches/${id}/results`)).status,409);
    assert.equal((await req(`/api/batches/${id}/estimate`,'POST',{})).status,404);
    let finished;
    for(let n=0;n<30;n++){const r=await req(`/api/batches/${id}/process`,'POST',{});assert.equal(r.status,200,JSON.stringify(r.data));finished=r.data;if(n===0){assert.equal(finished.received,500);assert.equal((await req('/api/dashboard')).data.metrics.total,0);}if(finished.status==='COMPLETED')break;}
    assert.equal(finished.status,'COMPLETED');assert.equal(finished.resultSummary.total,10001);assert.equal(finished.resultSummary.unknown,1);
    assert.equal((await req(`/api/batches/${id}/process`,'POST',{})).data.received,10001);
    assert.equal((await req('/api/dashboard')).data.metrics.total,10001);
    assert.equal((await req(`/api/batches/${id}/results`)).data.items.length,50);
    const conflict=(await req(`/api/batches/${id}/results?search=${key(1)}`)).data.items[0];assert.equal(conflict.reason,'CONFLITO_NA_PLANILHA');
    const exported=(await req(`/api/batches/${id}/export?offset=10000`)).data;assert.equal(exported.rows.length,4);assert.equal(exported.rows[1][5],'Sim');assert.equal(exported.rows[2][6],'Não confirmado');assert.ok(exported.rows[0][9].includes('planilha'));
    const id2=randomUUID();await req('/api/batches','POST',{...meta,importId:id2,expectedRows:1,statusColumn:-1});
    await req(`/api/batches/${id2}/rows`,'POST',{offset:0,rows:[rows[0]]});await req(`/api/batches/${id2}/finalize`,'POST',{});await req(`/api/batches/${id2}/process`,'POST',{});
    const metrics=(await req('/api/dashboard')).data.metrics;assert.equal(metrics.total,10001);assert.equal(metrics.unknown,2);
    const legacy=randomUUID();await (await collection('batches')).insertOne({_id:legacy,...scope(),clientId:c.id,status:'READY',createdAt:new Date()});
    assert.equal((await req(`/api/batches/${legacy}/finalize`,'POST',{})).status,409);assert.equal((await req(`/api/batches/${legacy}/cancel`,'POST',{})).status,200);
    const viewer=(await req('/api/users','POST',{name:'Leitura',email:'viewer@example.test',password:'ViewerSenha123!',role:'viewer'})).data;
    await (await collection('users')).updateOne(scope({_id:viewer.id}),{$set:{mustChangePassword:false}});
    await req('/api/auth/login','POST',{email:'viewer@example.test',password:'ViewerSenha123!'});
    assert.equal((await req('/api/clients','POST',{name:'Proibida'})).status,403);assert.equal((await req(`/api/batches/${id}/results`)).status,200);
    process.env.WORKSPACE_ID='other';assert.equal((await req('/api/clients')).status,401);process.env.WORKSPACE_ID='test-a';cookie=adminCookie;
    assert.equal((await req('/api/auth/logout','POST',{})).status,200);assert.equal((await req('/api/clients')).status,401);
  } finally {
    if(server)await new Promise<void>(r=>server!.close(()=>r()));
    try { const db=await database();assert.equal(db.databaseName,dbName);await db.dropDatabase(); } finally { await closeDatabase();for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original); }
  }
});
