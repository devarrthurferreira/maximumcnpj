import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BigQuerySource, buildQuery } from '../src/provider.ts';
import type { Config } from '../src/provider.ts';
import { AppError } from '../src/security.ts';
import { digits } from '../src/domain.ts';
const config:Config={project:'test-project',table:'source-project.public.receita',location:'US',maxBytes:'1099511627776',referenceDate:null,yes:['S'],no:['N']};
const schema=['cnpj','razao_social','opcao_simples','opcao_mei','data_opcao_simples','data_opcao_mei'].map(name=>({name,type:'STRING'}));
test('Um parâmetro ARRAY contém mais de 10 mil documentos, sem interpolação de IDs',()=>{
 const values=Array.from({length:10001},(_,i)=>{const base=String(80000000+i)+'0001';return base+digits(base);});
 const query=buildQuery(config,[...values,values[0]]);assert.equal(query.queryParameters[0].parameterValue.arrayValues.length,10001);assert.ok(query.query.includes('LEFT JOIN'));assert.ok(!query.query.includes(values[0]));assert.equal(query.maximumBytesBilled,config.maxBytes);
 assert.throws(()=>buildQuery(config,["' OR 1=1"]));
});
test('Dry run inspeciona a fonte e aplica o teto de bytes',async()=>{
 const calls:any[]=[];const source=new BigQuerySource({...config,maxBytes:'100'},async(method,path,data:any)=>{calls.push({method,path,data});return method==='GET'?{schema:{fields:schema},location:'US',etag:'test'}:{statistics:{query:{totalBytesProcessed:'101'}}};});
 const estimate=await source.estimate(['00000000000191']);assert.equal(estimate.withinLimit,false);assert.equal(calls[1].data.configuration.dryRun,true);assert.equal(calls.length,2);
});
test('Schema e localização incompatíveis bloqueiam consultas',async()=>{
 const missing=new BigQuerySource(config,async()=>({schema:{fields:[]},location:'US'}));await assert.rejects(()=>missing.inspect(),/Schema/);
 const wrong=new BigQuerySource(config,async()=>({schema:{fields:schema},location:'EU'}));await assert.rejects(()=>wrong.inspect(),/Localização/);
});
test('Colisão de job ID retoma o mesmo job, não cria uma segunda consulta',async()=>{
 let inserts=0,reads=0;const source=new BigQuerySource(config,async method=>{if(method==='POST'){inserts++;throw new AppError(409,'CONFLICT','exists');}reads++;return {jobReference:{jobId:'same'}};});
 await source.start('maximum_'+'a'.repeat(32),['00000000000191']);assert.equal(inserts,1);assert.equal(reads,1);
});
test('Paginação preserva ausentes, positivos e negativos explicitamente',async()=>{
 const fields=['cnpj','simples','mei','sourceCount'];const rows=[['00000000000191','S','N','1'],['123','N','N','1'],['456',null,null,'0']];
 const source=new BigQuerySource(config,async()=>({jobComplete:true,schema:{fields:fields.map(name=>({name}))},rows:rows.map(r=>({f:r.map(v=>({v}))})),pageToken:'next-page',totalRows:'10001'}));
 const page=await source.page('job');assert.equal(page.next,'next-page');assert.equal(page.total,10001);assert.deepEqual(page.results.map(r=>r.status),['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO']);
});
test('Job não concluído não inventa progresso nem resultado',async()=>{
 const source=new BigQuerySource(config,async()=>({jobComplete:false}));const page=await source.page('job');assert.equal(page.running,true);assert.deepEqual(page.results,[]);
});
