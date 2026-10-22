import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, getGeneration, generationHistory, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup} from '../src/lookup-jobs.ts';
import {purchaseRows, purchaseExport} from '../src/purchase-store.ts';
import {OPERATION_CATALOG_VERSION} from '../src/operation-catalog.ts';

test('MongoDB: geração preserva catálogo, UF explícita e metadados das compras na retomada', {skip:!process.env.MONGODB_URI,timeout:120000}, async()=>{
  const oldDb=process.env.MONGODB_DB, oldWorkspace=process.env.WORKSPACE_ID;
  const testDb='max_gen_op_'+randomUUID().replaceAll('-','');
  process.env.MONGODB_DB=testDb; process.env.WORKSPACE_ID='generation_operation_test'; resetLookupIndexes();
  const actor={_id:'tester',role:'admin',name:'Teste sintético',email:'test@example.test'};
  try {
    const catalog=await importCatalog(actor,[{code:'985',name:'Empresa sintética',uf:'MG'}]);
    const clientId=catalog.items[0].id;
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
    const purchaseInput={clientId,importId:randomUUID(),fileName:'compras.csv',expectedRows:3,issuerUf:' pr '};
    const attached=await attachGenerationPurchase(actor,generation._id,purchaseInput);
    assert.equal(attached.job.issuerUf,'PR'); assert.equal(attached.job.operationVersion,OPERATION_CATALOG_VERSION);
    assert.equal(attached.generation.companies[0].purchase.operationVersion,OPERATION_CATALOG_VERSION);
    assert.equal(attached.generation.companies[0].purchase.issuerUf,'PR');
    assert.equal((await attachGenerationPurchase(actor,generation._id,purchaseInput)).job._id,attached.job._id);
    const {issuerUf,...withoutUf}=purchaseInput;
    assert.equal((await attachGenerationPurchase(actor,generation._id,withoutUf)).job.issuerUf,'PR');
    await assert.rejects(attachGenerationPurchase(actor,generation._id,{...purchaseInput,issuerUf:'MG'}),(error:any)=>error.code==='GENERATION_PURCHASE_EXISTS');
    const source=['2102001','1202001','8000102'].map(natureCode=>({document:'12345678900',name:'Parceiro sintético',serviceDate:'2026-08-15',quantity:'1',natureCode,
      description:'Descrição preservada',recipientUf:'sp',natureOperation:'VENDA',operationVersion:'FORGED',
      grossCents:10000,discountCents:1000,accessoryCents:50000,freightCents:200,abatementCents:100,totalCents:9100}));
    await uploadLookup(actor,attached.job._id,{offset:0,rows:source});
    // Hydrated generation is what the browser receives before a retry.
    const resume=(await getGeneration(generation._id)).companies[0].purchase;
    assert.equal(resume.operationVersion,OPERATION_CATALOG_VERSION); assert.equal(resume.issuerUf,'PR');
    await uploadLookup(actor,attached.job._id,{offset:0,rows:source});
    await finalizeLookup(actor,attached.job._id);
    const stored=await (await collection('purchaseLines')).find(scope({jobId:attached.job._id})).sort({index:1}).toArray();
    assert.deepEqual(stored.map(row=>row.natureCode),['2102','1202','8000']);
    assert.deepEqual(stored.map(row=>row.natureOperation),['COMPRAS','DEVOLUCAO_VENDA','SERVICO_COMPRA']);
    assert(stored.every(row=>row.operationVersion===OPERATION_CATALOG_VERSION&&row.recipientUf==='SP'&&row.totalCents===9100));
    const page=await purchaseRows(attached.job._id,'ALL',1,true);
    assert.deepEqual(page.items.map((row:any)=>row.natureOperation),stored.map(row=>row.natureOperation));
    const csv=await purchaseExport(attached.job._id,'ALL',1);
    assert(csv.content.includes('"1202";"Descrição preservada";"DEVOLUCAO_VENDA"'));
    assert(csv.content.includes('"8000";"Descrição preservada";"SERVICO_COMPRA"'));
    const sale=await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),fileName:'vendas.csv',expectedRows:1,issuerUf:'RJ'});
    assert.equal(sale.generation.companies[0].sales.operationVersion,OPERATION_CATALOG_VERSION);
    assert.equal(sale.generation.companies[0].sales.issuerUf,'RJ');
    const history=await generationHistory(1);
    assert.equal(history.items[0].companies[0].purchase.operationVersion,OPERATION_CATALOG_VERSION);
    assert.equal(history.items[0].companies[0].sales.operationVersion,OPERATION_CATALOG_VERSION);
  } finally {
    const disposable=await database(); assert.equal(disposable.databaseName,testDb);
    await disposable.dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWorkspace===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWorkspace;
  }
});
