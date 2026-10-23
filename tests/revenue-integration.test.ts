import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration, attachGenerationPurchase, attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup, finalizeLookup} from '../src/lookup-jobs.ts';
import {purchaseSummary, purchaseExport, generationRevenue, revenueExport, reconciledPurchaseSummary} from '../src/purchase-store.ts';
import {reportRevenueReconciliation} from '../src/report-revenue.ts';
import {routePurchases} from '../src/purchase-http.ts';
import {routeGenerations} from '../src/generation-http.ts';
import {SALES_MODE, PURCHASE_MODE} from '../src/purchase-domain.ts';

test('MongoDB: fechamento bruto menos devoluções usa par exato, preserva arquivos e exporta separado', {skip:!process.env.MONGODB_URI,timeout:120000}, async()=>{
  const oldDb=process.env.MONGODB_DB, oldWorkspace=process.env.WORKSPACE_ID;
  const testDb='max_revenue_'+randomUUID().replaceAll('-','');
  process.env.MONGODB_DB=testDb;process.env.WORKSPACE_ID='revenue_synthetic';resetLookupIndexes();
  const actor={_id:'tester',role:'admin',name:'Teste sintético',email:'test@example.test'};
  const row=(natureCode:string,totalCents:number,serviceDate='2026-08-15')=>({document:'12345678900',name:'Parceiro sintético',quantity:'1',
    natureCode,description:'Descrição preservada',serviceDate,recipientUf:'SP',grossCents:totalCents+1000,discountCents:1100,
    accessoryCents:99000,freightCents:200,abatementCents:100,totalCents});
  try {
    const catalog=await importCatalog(actor,[{code:'986',name:'Empresa sintética A',uf:'MG'},{code:'987',name:'Empresa sintética B',uf:'SP'}]);
    const clientId=catalog.items[0].id, otherClient=catalog.items[1].id;
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId,otherClient],requiredReports:['PURCHASES','SALES']});
    const purchases=[row('2102',40000),row('1202',15000),row('2102',5000,'2026-09-25'),row('1202',25000,'2026-09-25')];
    const sales=[row('6102',100000),row('9000102',20000),row('6202',10000),row('5901',5000),row('6102',100000,'2026-09-02')];
    const purchase=(await attachGenerationPurchase(actor,generation._id,{clientId,importId:randomUUID(),fileName:'compras.csv',expectedRows:purchases.length,issuerUf:'MG'})).job;
    await uploadLookup(actor,purchase._id,{offset:0,rows:purchases});await finalizeLookup(actor,purchase._id);
    const pending=(await purchaseSummary(purchase._id)).revenueReconciliation;
    assert.equal(pending.status,'PENDING');assert.equal(Object.hasOwn(pending,'salesReturnsCents'),false);
    const sale=(await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),fileName:'vendas.csv',expectedRows:sales.length,issuerUf:'MG'})).job;
    await uploadLookup(actor,sale._id,{offset:0,rows:sales});await finalizeLookup(actor,sale._id);
    const jobs=await collection('lookupJobs'),gens=await collection('generations'),lines=await collection('purchaseLines');
    const beforeJobs=await jobs.find(scope({_id:{$in:[purchase._id,sale._id]}})).sort({_id:1}).toArray();
    const beforeLines=await lines.find(scope({jobId:{$in:[purchase._id,sale._id]}})).sort({_id:1}).toArray();
    const summary=await purchaseSummary(sale._id,true,SALES_MODE),closing=summary.revenueReconciliation;
    assert.equal(summary.totals.totalCents,215000);assert.equal(summary.components?.totalCents,235000);
    assert.equal(closing.available,true);assert.equal(closing.version,'REVENUE_RECONCILIATION_V1');
    assert.equal(closing.grossSalesCents,200000);assert.equal(closing.serviceSalesCents,20000);
    assert.equal(closing.grossRevenueCents,220000);assert.equal(closing.salesReturnsCents,40000);assert.equal(closing.revenueAfterReturnsCents,180000);
    assert.deepEqual(closing.monthly.map(month=>month.revenueAfterReturnsCents),[105000,75000]);
    assert.deepEqual([closing.generationId,closing.clientId,closing.purchaseJobId,closing.salesJobId],[generation._id,clientId,purchase._id,sale._id]);
    assert.deepEqual((await purchaseSummary(purchase._id)).revenueReconciliation,closing);
    assert.deepEqual(await generationRevenue(generation._id,clientId),closing);
    assert.deepEqual(await routeGenerations(actor,'GET',new URL(`https://local/api/v4/generations/${generation._id}/revenue?clientId=${clientId}`),{}),closing);
    const fromRoute=await routePurchases(actor,'GET',new URL(`https://local/api/v4/sales/${sale._id}/summary?clientId=${otherClient}`),{});
    assert.deepEqual((fromRoute as any).revenueReconciliation,closing);
    const csv=await revenueExport(sale._id,SALES_MODE);
    assert(csv.content.includes('"Receita bruta (vendas + serviços)";2200,00'));
    assert(csv.content.includes('"Receita após devoluções";1800,00'));
    assert(csv.content.includes('"(-) Devoluções de venda no relatório de compras";-400,00'));
    assert(csv.content.includes('"2026-08";1000,00;200,00;1200,00;-150,00;1050,00'));
    assert(!csv.content.includes("'-150,00"));assert(!csv.content.includes("'-400,00"));
    assert.equal(csv.content.match(/"Receita após devoluções";/g)?.length,1);
    const routeCsv=await routePurchases(actor,'POST',new URL(`https://local/api/v4/sales/${sale._id}/revenue-csv`),{clientId:otherClient,salesReturnsCents:0});
    assert.deepEqual(routeCsv,csv);
    const originalCsv=await purchaseExport(sale._id,'ALL',1,SALES_MODE);
    assert.equal(originalCsv.content.trim().split('\r\n').length,sales.length+1);
    assert(!originalCsv.content.includes('Fechamento da receita'));
    assert.deepEqual(await jobs.find(scope({_id:{$in:[purchase._id,sale._id]}})).sort({_id:1}).toArray(),beforeJobs);
    assert.deepEqual(await lines.find(scope({jobId:{$in:[purchase._id,sale._id]}})).sort({_id:1}).toArray(),beforeLines);
    await jobs.updateOne(scope({_id:sale._id}),{$set:{clientName:'=HYPERLINK("https://example.test")'}});
    const escaped=await revenueExport(sale._id,SALES_MODE);
    assert(escaped.content.includes('"Empresa";"\'=HYPERLINK(""https://example.test"")"'));
    assert(escaped.content.includes('"(-) Devoluções de venda no relatório de compras";-400,00'));
    await jobs.updateOne(scope({_id:sale._id}),{$set:{clientName:summary.job.clientName}});
    // Frozen legacy recheck: a lineage alone is not a recorded purchases/sales pair.
    const {generationId:oldGeneration,...oldSale}=beforeJobs.find(job=>job._id===sale._id)!;
    const repeated={...oldSale,_id:randomUUID(),repeatedFrom:sale._id};
    await jobs.insertOne(repeated);
    await lines.insertMany(beforeLines.filter(line=>line.jobId===sale._id).map(line=>({...line,_id:`${repeated._id}:${line.index}`,jobId:repeated._id})));
    assert.equal((await purchaseSummary(repeated._id,true,SALES_MODE)).revenueReconciliation.status,'UNAVAILABLE');
    assert.equal((await generationRevenue(generation._id,otherClient)).status,'PENDING');

    // An old completed report can be viewed without borrowing the current pair.
    const current=await gens.findOne(scope({_id:generation._id})),replacement=randomUUID();
    await gens.updateOne(scope({_id:generation._id}),{$set:{'companies.0.salesJobId':replacement},$push:{'companies.0.salesJobIds':replacement}});
    assert.equal((await purchaseSummary(sale._id,true,SALES_MODE)).revenueReconciliation.status,'UNAVAILABLE');
    await gens.replaceOne(scope({_id:generation._id}),current!);
    await jobs.updateOne(scope({_id:purchase._id}),{$set:{clientId:otherClient}});
    await assert.rejects(purchaseSummary(sale._id,true,SALES_MODE),(error:any)=>error.code==='GENERATION_INCONSISTENT');
    await jobs.updateOne(scope({_id:purchase._id}),{$set:{clientId}});
    await gens.updateOne(scope({_id:generation._id}),{$push:{'companies.1.purchaseJobIds':purchase._id}});
    await assert.rejects(generationRevenue(generation._id,clientId),(error:any)=>error.code==='GENERATION_INCONSISTENT');
    await gens.replaceOne(scope({_id:generation._id}),current!);
    await assert.rejects(reportRevenueReconciliation({...summary,job:{...summary.job,workspaceId:'foreign'}},(id,mode)=>reconciledPurchaseSummary(id,true,mode)),
      (error:any)=>error.code==='GENERATION_INCONSISTENT');

    // Legacy missing evidence is not confirmed as zero and never mutates the import.
    await jobs.updateOne(scope({_id:purchase._id}),{$unset:{operationVersion:'',anticipationVersion:'',reportPeriod:''}});
    await lines.updateMany(scope({jobId:purchase._id}),{$unset:{natureCode:'',serviceDate:''}});
    const legacy=(await purchaseSummary(sale._id,true,SALES_MODE)).revenueReconciliation;
    assert.equal(legacy.available,false);assert.equal(Object.hasOwn(legacy,'salesReturnsCents'),false);
  } finally {
    const disposable=await database();assert.equal(disposable.databaseName,testDb);await disposable.dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWorkspace===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWorkspace;
  }
});
