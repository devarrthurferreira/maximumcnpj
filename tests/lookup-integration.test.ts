import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database,collection,scope,closeDatabase } from '../src/store.ts';
import { createLookup,uploadLookup,finalizeLookup,processLookup,repeatLookup } from '../src/lookup-jobs.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { resetLookupIndexes } from '../src/lookup-db.ts';
import { routeV4 } from '../src/lookup-http.ts';
test('MongoDB: códigos, consulta nova por lote, estados reutilizados e histórico imutável', {skip:!process.env.MONGODB_URI,timeout:120000},async()=>{
 const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;process.env.MONGODB_DB='maximum_lookup_test_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='lookup_test';resetLookupIndexes();
 const actor={_id:'tester',role:'admin',name:'Teste',email:'test@example.test'},cnpj='00000000000191';let calls=0,positive=true;
 const transport=(async()=>{calls++;return Response.json({cnpj,razao_social:'Empresa Sintetica',opcao_pelo_simples:positive,opcao_pelo_mei:false,qsa:[{nome:'não armazenar'}],logradouro:'não armazenar'});}) as typeof fetch;
 try{
  const cat=await importCatalog(actor,[{code:'00868',name:'Carteira A',cnpj:'',active:'Ativa'},{code:'869',name:'Carteira B',cnpj:'',active:'Ativa'},{code:'1',name:'Doméstica sintética',cnpj:'12345678900'}]);assert.equal(cat.success,3);await importCatalog(actor,[{code:'868',name:'Carteira A revisada'}]);assert.equal(await (await collection('clients')).countDocuments(scope()),3);
  const owner=cat.items[0].id,other=cat.items[1].id;
  async function fresh(clientId:string){const j=await createLookup(actor,{importId:randomUUID(),clientId,fileName:'sintetica.csv',expectedRows:3});const rows=[{cnpj,name:'Empresa Sintetica',extra:'descartar'},{cnpj,name:'Empresa Sintetica'},{cnpj:'12345678900',name:'CPF não consultar'}];await uploadLookup(actor,j._id,{offset:0,rows});await uploadLookup(actor,j._id,{offset:0,rows});const ready=await finalizeLookup(actor,j._id);assert.deepEqual(ready.summary,{lines:3,unique:1,invalid:1,duplicates:1});assert.equal(await (await collection('lookupStage')).countDocuments(scope({jobId:j._id})),0);await (await collection('providerControl')).deleteMany({});return processLookup(actor,j._id,transport);}
  const first=await fresh(owner),second=await fresh(other);assert.equal(first.status,'COMPLETED');assert.equal(second.status,'COMPLETED');assert.equal(calls,2);assert.equal(await (await collection('cnpjEntities')).countDocuments(scope()),1);assert.equal(await (await collection('cnpjStates')).countDocuments(scope()),1);
  const states=await (await collection('cnpjStates')).find(scope()).toArray();assert(!JSON.stringify(states).includes('não armazenar'));
  positive=false;const third=await fresh(owner);assert.equal(third.resultSummary.nonOptants,1);assert.equal(await (await collection('cnpjStates')).countDocuments(scope()),2);
  const firstItem=await (await collection('lookupItems')).findOne(scope({jobId:first._id}));const oldState=await (await collection('cnpjStates')).findOne(scope({_id:firstItem!.stateId}));assert.equal(oldState!.status,'OPTANTE');
  const dash=await routeV4(actor,'GET',new URL('https://test/api/v4/dashboard'),{});assert.equal((dash as any).metrics.total,1);assert.equal((dash as any).metrics.nonOptants,1);
  const repeated=await repeatLookup(actor,third._id);assert.equal(repeated.status,'PROCESSING');await (await collection('providerControl')).deleteMany({});await processLookup(actor,repeated._id,transport);assert.equal(calls,4);
  await assert.rejects(createLookup({...actor,role:'viewer'},{importId:randomUUID(),clientId:owner,fileName:'x',expectedRows:1}));
  const fail=await repeatLookup(actor,third._id);await (await collection('providerControl')).deleteMany({});const failed=await processLookup(actor,fail._id,(async()=>new Response('',{status:404}))as typeof fetch);assert.equal(failed.resultSummary.unknown,1);assert.equal(failed.resultSummary.nonOptants,0);assert.equal(failed.resultSummary.reportingNonOptants,1);
  const grouped:any=await routeV4(actor,'GET',new URL('https://test/api/v4/lookups/'+failed._id+'/results?status=NAO_OPTANTE'),{});assert.equal(grouped.total,1);assert.equal(grouped.items[0].status,'NAO_CONFIRMADO');assert.equal(grouped.items[0].reportingStatus,'NAO_OPTANTE');
  process.env.WORKSPACE_ID='another_workspace';await assert.rejects(routeV4(actor,'GET',new URL('https://test/api/v4/lookups/'+first._id),{}));process.env.WORKSPACE_ID='lookup_test';
 }finally{await (await database()).dropDatabase();await closeDatabase();resetLookupIndexes();if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;}
});
