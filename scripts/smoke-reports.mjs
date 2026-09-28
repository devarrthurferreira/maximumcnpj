import assert from 'node:assert/strict';
const origin='https://maximum-cnpj.vercel.app';
let last;
for(let i=0;i<18;i++){
 try{
  const page=await fetch(origin+'/reports.html');assert.equal(page.status,200);
  const r=await fetch(origin+'/api/reports',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({action:'jobs'})});
  assert.equal(r.headers.get('X-Report-Engine'),'python');assert.equal(r.status,401);
  assert.equal((await r.json()).error,'UNAUTHORIZED');console.log('Página e Python acessíveis; download sem sessão bloqueado.');process.exit(0);
 }catch(e){last=e;await new Promise(r=>setTimeout(r,4000));}
}
throw last;
