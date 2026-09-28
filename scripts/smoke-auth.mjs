import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base='https://maximum-cnpj.vercel.app';
const expectedVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
assert.match(expectedVersion,/^\d+\.\d+\.\d+$/,'Versão do projeto inválida.');
const request=(path,options={})=>fetch(base+path,{...options,signal:AbortSignal.timeout(10000)});
let ready=false;
for(let i=0;i<12;i++){
 try{const r=await request('/api/health');ready=r.ok&&(await r.json()).version===expectedVersion;}catch{}
 if(ready)break;
 await new Promise(r=>setTimeout(r,10000));
}
assert(ready,`A produção ainda não publicou v${expectedVersion}.`);
const session=await request('/api/auth/session');
assert.equal(session.status,200);assert.equal((await session.json()).user,null);
for(const [origin,expected]of [[base,400],['https://evil.example',403]]){
 const r=await request('/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,expected);
 console.log(`Login sem credenciais: origem ${origin===base?'legítima':'externa'} → ${r.status}`);
}
console.log(`Sessão e origem verificadas em produção v${expectedVersion}. Nenhum login com credencial nem mutação de dados foi realizado.`);
