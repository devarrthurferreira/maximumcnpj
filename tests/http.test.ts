import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.ts';
test('HTTP: saúde, headers, autenticação obrigatória e CSRF sem banco configurado',async()=>{
 const server=startServer(0);await new Promise<void>(r=>server.listening?r():server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 try {
  const health=await fetch(base+'/api/health');assert.equal(health.status,200);assert.ok(health.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  assert.equal((await fetch(base+'/api/clients')).status,401);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  const html=await fetch(base+'/');assert.equal(html.status,200);assert.ok((await html.text()).includes('Maximum CNPJ'));
 } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
