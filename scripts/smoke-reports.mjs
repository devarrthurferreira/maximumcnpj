import assert from 'node:assert/strict';
const origin=(process.env.SMOKE_ORIGIN||'https://maximumcnpj.vercel.app').replace(/\/+$/,'');
let last;
for(let i=0;i<18;i++){
 try{
  const page=await fetch(origin+'/reports.html',{signal:AbortSignal.timeout(10000)});assert.equal(page.status,200);
  const r=await fetch(origin+'/api/reports',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({action:'jobs'}),signal:AbortSignal.timeout(10000)});
  assert.equal(r.headers.get('X-Report-Engine'),'python');assert.equal(r.status,401);
  assert.equal((await r.json()).error,'UNAUTHORIZED');console.log('Página e Python acessíveis; download sem sessão bloqueado.');process.exit(0);
 }catch(e){last=e;await new Promise(r=>setTimeout(r,4000));}
}
throw last;
