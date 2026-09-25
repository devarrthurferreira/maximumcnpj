import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importedStatus, mergeImportedStatuses } from '../src/imported.ts';
import { prepareRows, statistics, digits } from '../src/domain.ts';
import { readFileSync, existsSync } from 'node:fs';
test('Coluna Simples: somente valores explícitos',()=>{
 for(const v of ['Sim',' s ',true,1,'OPTANTE','Simples Nacional'])assert.equal(importedStatus(v),'OPTANTE');
 for(const v of ['Não','n',false,0,'Não optante','NAO_OPTANTE'])assert.equal(importedStatus(v),'NAO_OPTANTE');
 for(const v of ['',null,undefined,'Lucro real','Isento','Talvez','Não confirmado',{},[]])assert.equal(importedStatus(v),'NAO_CONFIRMADO');
});
test('Repetições concordantes e conflitantes',()=>{
 assert.deepEqual(mergeImportedStatuses(['OPTANTE','OPTANTE']),{status:'OPTANTE',reason:null});
 assert.deepEqual(mergeImportedStatuses(['NAO_OPTANTE','NAO_OPTANTE']),{status:'NAO_OPTANTE',reason:null});
 for(const v of [['OPTANTE','NAO_OPTANTE'],['OPTANTE','NAO_CONFIRMADO'],['NAO_OPTANTE','NAO_CONFIRMADO']])assert.deepEqual(mergeImportedStatuses(v),{status:'NAO_CONFIRMADO',reason:'CONFLITO_NA_PLANILHA'});
 assert.deepEqual(mergeImportedStatuses([]),{status:'NAO_CONFIRMADO',reason:'SEM_ENQUADRAMENTO'});
});
test('10.001 identidades sintéticas sem rede, com conflito e repetição',()=>{
 const data=Array.from({length:10001},(_,i)=>{const b=String(70000000+i)+'0001';return[b+digits(b),'Sintética '+i,i%2?'Sim':'Não'];});
 data.push([...data[0]]);data.push([data[1][0],'Conflito','Não']);data.push(['invalido','Inválida','Sim']);
 const grouped=new Map<string,string[]>();for(const r of prepareRows(data,0,1).filter(r=>r.valid)){const v=grouped.get(r.cnpj)||[];v.push(importedStatus(r.values[2]));grouped.set(r.cnpj,v);}
 const m=statistics([...grouped].map(([cnpj,v])=>({cnpj,...mergeImportedStatuses(v)})));assert.equal(m.total,10001);assert.equal(m.unknown,1);assert.equal(m.optants,4999);assert.equal(m.nonOptants,5001);
});
test('Sem integração Google nem rotas de provedor externo no código ativo',()=>{
 const p=JSON.parse(readFileSync('package.json','utf8'));assert.equal(p.dependencies['google-auth-library'],undefined);assert.equal(existsSync('src/provider.ts'),false);assert.doesNotMatch(readFileSync('.env.example','utf8'),/GOOGLE_|BQ_/);assert.doesNotMatch(readFileSync('src/service.ts','utf8'),/BigQuery|configuration\(|fetch\(/);assert.doesNotMatch(readFileSync('src/server.ts','utf8'),/service\.(estimate|start|advance)/);assert.ok(readFileSync('public/app.js','utf8').includes('Sem consulta externa automática'));
});
