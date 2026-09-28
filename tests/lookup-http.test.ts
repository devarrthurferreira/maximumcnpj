import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handler } from '../src/server.ts';
test('Sessão pública e login de mesma origem sem remover proteção CSRF',async()=>{
 const server=http.createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;const old=process.env.APP_ORIGIN;process.env.APP_ORIGIN=base;
 try{const s=await fetch(base+'/api/auth/session');assert.equal(s.status,200);assert.equal((await s.json()).user,null);
  const me=await fetch(base+'/api/auth/me');assert.equal(me.status,401);
  const good=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(good.status,400);assert.notEqual((await good.json()).error,'ORIGIN');
  const evil=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(evil.status,403);
 }finally{if(old===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=old;await new Promise<void>(r=>server.close(()=>r()));}
});
