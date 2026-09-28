import assert from 'node:assert/strict';
const base='https://maximum-cnpj.vercel.app';
let ready=false;for(let i=0;i<12;i++){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(10000)});ready=r.ok&&(await r.json()).version==='0.4.0';}catch{}if(ready)break;await new Promise(r=>setTimeout(r,10000));}
assert(ready,'A produção ainda não publicou v0.4.0.');
const session=await fetch(base+'/api/auth/session');assert.equal(session.status,200);assert.equal((await session.json()).user,null);
for(const [origin,expected]of [[base,400],['https://evil.example',403]]){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,expected);console.log(`Login sem credenciais: origem ${origin===base?'legítima':'externa'} → ${r.status}`);}
console.log('Sessão e origem verificadas em produção. Nenhum login com credencial nem mutação de dados foi realizado.');
