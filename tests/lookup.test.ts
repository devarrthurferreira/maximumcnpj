import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLine,documentKind,mappedClient,compareNames,parseProvider,flagStatus } from '../src/lookup-domain.ts';
import { lookupCnpj,retrySeconds,SourceError } from '../src/lookup-provider.ts';
import { permittedOrigin,allowedOrigins } from '../src/origins.ts';
const cnpj='00000000000191';
test('Origem exata configurada e domínios injetados pela Vercel; sem confiar em Host',()=>{
 const keys=['NODE_ENV','APP_ORIGIN','VERCEL','VERCEL_URL','VERCEL_BRANCH_URL','VERCEL_PROJECT_PRODUCTION_URL'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.NODE_ENV='production';process.env.VERCEL='1';process.env.APP_ORIGIN='http://localhost:3000';process.env.VERCEL_PROJECT_PRODUCTION_URL='maximum-cnpj.vercel.app';process.env.VERCEL_URL='maximum-cnpj-abc-team.vercel.app';delete process.env.VERCEL_BRANCH_URL;
  assert(permittedOrigin({origin:'https://maximum-cnpj.vercel.app','sec-fetch-site':'same-origin'}));assert(permittedOrigin({origin:'https://maximum-cnpj-abc-team.vercel.app'}));
  for(const origin of ['null','https://evil.example','https://maximum-cnpj.vercel.app.evil.example','https://maximum-cnpj.vercel.app/','http://localhost:3000','https://a@maximum-cnpj.vercel.app'])assert.equal(permittedOrigin({origin,host:'maximum-cnpj.vercel.app'}),false,origin);
  assert.equal(permittedOrigin({origin:'https://maximum-cnpj.vercel.app','sec-fetch-site':'cross-site'}),false);
  process.env.VERCEL='0';process.env.NODE_ENV='development';delete process.env.APP_ORIGIN;assert.deepEqual(allowedOrigins(),['http://localhost:3000']);
 }finally{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
test('Projeção mínima descarta CPF, colunas não necessárias e nunca usa RESPOSTA',()=>{
 const row=compactLine({cnpj:'00.000.000/0001-91',name:'Empresa',kind:'CLIENTE',uf:'MG',RESPOSTA:'Não optante',address:'descartar'});assert.equal(row.cnpj,cnpj);assert.equal('address' in row,false);assert.equal('RESPOSTA' in row,false);
 const cpf=compactLine({cnpj:'123.456.789-00',name:'Pessoa'});assert.equal(cpf.cnpj,'');assert.equal(cpf.reason,'CPF');assert(!JSON.stringify(cpf).includes('123456789'));assert.equal(documentKind('123456789012'),'CNO_OU_OUTRO');
 assert.throws(()=>compactLine({cnpj:{$ne:null}}));
});
test('ID é código estável; cadastro de pessoa não vira consulta CNPJ',()=>{
 assert.equal(mappedClient({code:'00868',name:'Cliente',cnpj}).code,'868');assert.equal(mappedClient({code:1,name:'Pessoa',cnpj:'12345678900'}).cnpj,null);assert.equal(mappedClient({code:2,name:'Inativa',active:'Inativa'}).active,false);
 assert.throws(()=>mappedClient({code:'',name:'X'}));
});
test('Nome apenas confere identidade; indicadores dependem de boolean explícito',()=>{
 assert.equal(compareNames('EMPRESA ALFA LTDA','Empresa Alfa Ltda'),'COMPATIVEL');assert.equal(compareNames('Outra empresa','Empresa Alfa'),'DIVERGENTE_REVISAR');
 for(const v of [null,undefined,'false','Não','',0])assert.equal(flagStatus(v),'NAO_CONFIRMADO');assert.equal(flagStatus(false),'NAO_OPTANTE');assert.equal(flagStatus(true),'OPTANTE');
 const response=parseProvider(cnpj,{cnpj,razao_social:'Empresa',opcao_pelo_simples:true,qsa:[{nome:'privado'}],ddd_telefone_1:'privado'});assert.equal(response.status,'OPTANTE');assert.equal('qsa' in response,false);assert.equal('ddd_telefone_1'in response,false);
 assert.equal(parseProvider(cnpj,{cnpj,opcao_pelo_simples:false,opcao_pelo_mei:true}).status,'NAO_CONFIRMADO');assert.throws(()=>parseProvider(cnpj,{cnpj:'11111111111111'}));
});
test('API sem cache: URL fixa, timeout, respostas incompletas e limites',async()=>{
 let calls=0;const mock=async(url:any,opts:any)=>{calls++;assert.equal(url,`https://minhareceita.org/${cnpj}`);assert.equal(opts.cache,'no-store');return Response.json({cnpj,opcao_pelo_simples:false});};
 assert.equal((await lookupCnpj(cnpj,mock as typeof fetch)).status,'NAO_OPTANTE');await lookupCnpj(cnpj,mock as typeof fetch);assert.equal(calls,2);
 await assert.rejects(lookupCnpj(cnpj,(async()=>new Response('',{status:429,headers:{'retry-after':'75'}}))as typeof fetch),(e:any)=>e instanceof SourceError&&e.retryable&&e.retryAfter===75);
 await assert.rejects(lookupCnpj(cnpj,(async()=>new Response('',{status:404}))as typeof fetch),(e:any)=>e.code==='NAO_ENCONTRADO');
 await assert.rejects(lookupCnpj(cnpj,(async()=>{throw new Error('timeout');})as typeof fetch),(e:any)=>e.retryable);
 await assert.rejects(lookupCnpj(cnpj,(async()=>Response.json({cnpj:'outro'}))as typeof fetch),(e:any)=>e.code==='IDENTIDADE_DIVERGENTE');
 assert.equal(retrySeconds('120'),120);assert.equal(retrySeconds(null),60);
});
