import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { resetLookupIndexes, withJob } from '../src/lookup-db.ts';
import { importCatalog } from '../src/lookup-catalog.ts';
import { createLookup, uploadLookup, finalizeLookup, processLookup, repeatLookup, cancelLookup } from '../src/lookup-jobs.ts';
import { PURCHASE_MODE, SALES_MODE } from '../src/purchase-domain.ts';
import { purchaseSummary, purchaseRows, purchaseExport, purchaseHistory } from '../src/purchase-store.ts';
import { routeV4 } from '../src/lookup-http.ts';
import { digits } from '../src/domain.ts';

test('MongoDB compras e vendas: idempotência, isolamento, cálculos e PDF Python do snapshot real', {skip:!process.env.MONGODB_URI, timeout:120000}, async () => {
  const oldDb = process.env.MONGODB_DB, oldWs = process.env.WORKSPACE_ID;
  process.env.MONGODB_DB = 'maximum_purchase_test_' + randomUUID().replaceAll('-', ''); process.env.WORKSPACE_ID = 'purchases_test'; resetLookupIndexes();
  const actor = {_id:'tester',role:'admin',name:'Teste',email:'test@example.test'};
  const ids = ['000000000001', '111111110001', '222222220001'].map(base => base + digits(base));
  let calls = 0;
  const transport = (async (url: string | URL | Request) => {
    calls++; const cnpj = String(url).split('/').pop();
    if (cnpj === ids[2]) return new Response('', {status:404});
    return Response.json({cnpj,razao_social:'Fornecedor sintético',opcao_pelo_simples:cnpj===ids[0],opcao_pelo_mei:false});
  }) as typeof fetch;
  try {
    const catalog = await importCatalog(actor, [{code:'936',name:'Empresa A'}, {code:'937',name:'Empresa B'}]);
    const clientId = catalog.items[0].id;
    const rows = [
      {document:ids[0],name:'Fornecedor sintético',quantity:'99',totalCents:10001},
      {document:ids[0],name:'Fornecedor sintético',quantity:'2',totalCents:9},
      {document:ids[1],name:'Fornecedor sintético',quantity:'1',totalCents:20000},
      {document:ids[2],name:'Fornecedor sintético',quantity:'1',totalCents:9990},
      {document:'12345678900',name:'Pessoa sintética',quantity:'1',totalCents:3000}
    ].map((row,index)=>({...row,serviceDate:index < 2 ? '2026-07-15' : '2026-08-15',grossCents:row.totalCents+500,discountCents:600,accessoryCents:99,freightCents:150,abatementCents:50}));
    const input = {importId:randomUUID(),clientId,fileName:'sintetico.csv',expectedRows:rows.length};
    const job = await createLookup(actor, input, PURCHASE_MODE);
    assert.equal(job.calculationVersion,'NET_V2');
    assert.equal((await createLookup(actor, input, PURCHASE_MODE))._id, job._id);
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const held = withJob(job._id, async () => { acquired(); await unlock; });
    await locked;
    try { await assert.rejects(uploadLookup(actor, job._id, {offset:0,rows:[rows[0]]}), (error:any) => error.code === 'JOB_BUSY'); } finally { release(); await held; }
    await assert.rejects(createLookup(actor, input));
    await assert.rejects(uploadLookup(actor, job._id, {offset:1,rows:[rows[0]]}));
    await uploadLookup(actor, job._id, {offset:0,rows:rows.slice(0,2)});
    await uploadLookup(actor, job._id, {offset:0,rows:rows.slice(0,2)});
    await assert.rejects(uploadLookup(actor, job._id, {offset:0,rows:[{...rows[0],totalCents:1},rows[1]]}));
    await assert.rejects(finalizeLookup(actor,job._id));
    await uploadLookup(actor, job._id, {offset:2,rows:rows.slice(2)});
    const processing = await finalizeLookup(actor, job._id);
    assert.deepEqual(processing.summary, {lines:5,unique:3,invalid:1,duplicates:1});
    assert.equal(processing.purchaseInput.totalCents, 43000);
    assert.equal(await (await collection('lookupStage')).countDocuments(scope({jobId:job._id})), 0);
    await assert.rejects(purchaseSummary(job._id));
    await (await collection('providerControl')).deleteMany({});
    const complete = await processLookup(actor, job._id, transport);
    assert.equal(complete.status, 'COMPLETED'); assert.equal(calls, 3);
    // A report attributes each persisted lookup, even when the job still has the legacy source label.
    assert.deepEqual((await purchaseSummary(job._id)).sources, ['Minha Receita']);
    await (await collection('lookupItems')).updateOne(scope({jobId:job._id,cnpj:ids[1]}), {$set:{source:'OpenCNPJ.org'}});
    const summary = await purchaseSummary(job._id);
    assert.deepEqual(summary.sources, ['Minha Receita', 'OpenCNPJ.org']);
    assert.match(summary.source, /^Minha Receita, OpenCNPJ\.org —/);
    assert.deepEqual(summary.totals, {lines:5,uniqueCnpjs:3,uniqueDocuments:4,nonCnpjDocumentCount:1,cnpjLines:4,nonCnpjLines:1,totalCents:43000,cnpjCents:40000,nonCnpjCents:3000});
    assert.deepEqual(summary.groups.map(g=>[g.status,g.count,g.totalCents,g.countPercent,g.valuePercent]), [
      ['OPTANTE',1,10010,33.33,25.03], ['NAO_OPTANTE',1,20000,33.33,50], ['NAO_CONFIRMADO',1,9990,33.33,24.98]
    ]);
    assert.deepEqual(summary.components, {grossCents:45500,discountCents:3000,accessoryCents:495,freightCents:750,abatementCents:250,totalCents:43000});
    assert.equal(summary.calculationVersion,'NET_V2'); assert.equal(summary.formula,'Q - Y + AA - AB');
    assert.deepEqual(summary.period,{startDate:'2026-07-15',endDate:'2026-08-15',startMonth:'2026-07',endMonth:'2026-08',months:2,observedMonths:2,missingMonths:[]});
    assert.deepEqual(summary.reportingGroups.map(g=>[g.status,g.count,g.totalCents,g.countPercent,g.valuePercent,g.unconfirmedCount,g.unconfirmedCents]), [
      ['OPTANTE',1,10010,25,23.28,0,0], ['NAO_OPTANTE',3,32990,75,76.72,1,9990]
    ]);
    assert.equal(summary.reportingGroups.reduce((sum,g)=>sum+g.totalCents,0),summary.totals.totalCents);
    assert.equal(summary.reportingGroups.reduce((sum,g)=>sum+g.valuePercent,0),100);
    assert.equal(summary.reportingGroups.reduce((sum,g)=>sum+g.countPercent,0),100);
    assert.equal(summary.reportingGroups[1].nonCnpjCount,1); assert.equal(summary.reportingGroups[1].nonCnpjCents,3000);
    assert.equal((await purchaseRows(job._id,'NAO_OPTANTE',1)).total,3);
    assert.equal((await purchaseRows(job._id,'NAO_CONFIRMADO',1)).total,1);
    assert.equal((await purchaseRows(job._id,'NAO_OPTANTE',1,true)).total,3);
    const combinedCsv = await purchaseExport(job._id,'NAO_OPTANTE',1); assert.equal(combinedCsv.total,3); assert(combinedCsv.content.includes('"NAO_OPTANTE";"NAO_CONFIRMADO"'));
    assert(combinedCsv.content.includes('"NAO_OPTANTE";"NON_CNPJ"'));
    const cnpjs = await purchaseRows(job._id, 'ALL', 1); assert.equal(cnpjs.total, 4);
    assert.equal(cnpjs.items.reduce((sum:any,row:any)=>sum+row.totalCents,0),summary.totals.totalCents);
    const excluded = await purchaseRows(job._id, 'NON_CNPJ', 1); assert.equal(excluded.total, 1); assert.equal(excluded.items[0].documentKind, 'CPF');
    const csv = await purchaseExport(job._id, 'ALL', 1); assert.equal(csv.total, 5); assert(csv.content.includes('"99";"105,01";"6,00";"0,99";"1,50";"0,50";"100,01"')); assert.equal(csv.parts, 1);
    await assert.rejects(purchaseExport(job._id, 'ALL', 2));
    await assert.rejects(routeV4(actor,'GET',new URL('https://test/api/v4/purchases/'+job._id+'/csv'),{}));
    const exported:any = await routeV4(actor,'POST',new URL('https://test/api/v4/purchases/'+job._id+'/csv'),{status:'ALL',part:1}); assert.equal(exported.total,5);
    await assert.rejects(repeatLookup(actor,job._id)); await assert.rejects(cancelLookup(actor,job._id));
    assert.equal((await purchaseHistory(clientId, 1)).total, 1);
    const genericHistory:any = await routeV4(actor,'GET',new URL('https://test/api/v4/history?clientId='+clientId),{}); assert.equal(genericHistory.total,0); assert.equal((await purchaseHistory(catalog.items[1].id, 1)).total, 0);
    await assert.rejects(routeV4(actor,'POST',new URL('https://test/api/v4/purchases'),{...input,importId:randomUUID(),type:'SALES'}));
    await assert.rejects(routeV4({...actor,role:'viewer'},'POST',new URL('https://test/api/v4/purchases'),{...input,importId:randomUUID()}));
    // The same company can hold separate purchase and sales snapshots with independent provider lookups.
    const salesInput = {...input,importId:randomUUID(),fileName:'vendas-sinteticas.csv',type:'SALES'};
    const sales:any = await routeV4(actor,'POST',new URL('https://test/api/v4/sales'),salesInput);
    assert.equal(sales.mode,SALES_MODE); assert.equal(sales.calculationVersion,'NET_V2');
    assert.equal((await createLookup(actor,salesInput,SALES_MODE))._id,sales._id);
    await assert.rejects(createLookup(actor,salesInput,PURCHASE_MODE));
    const salesRows = rows.map(row=>({...row,name:'Comprador sintético',quantity:undefined,kind:'FORNECEDOR'}));
    for (const [prefix,id] of [['purchases',sales._id],['sales',job._id],['lookups',sales._id],['lookups',job._id]]) {
      await assert.rejects(routeV4(actor,'GET',new URL(`https://test/api/v4/${prefix}/${id}`),{}),(error:any)=>error.code==='NOT_FOUND');
      await assert.rejects(routeV4(actor,'POST',new URL(`https://test/api/v4/${prefix}/${id}/rows`),{offset:0,rows:salesRows}),(error:any)=>error.code==='NOT_FOUND');
    }
    await assert.rejects(routeV4(actor,'POST',new URL('https://test/api/v4/sales/'+sales._id+'/rows'),{type:'PURCHASES',offset:0,rows:salesRows}),(error:any)=>error.code==='REPORT_TYPE');
    await routeV4(actor,'POST',new URL('https://test/api/v4/sales/'+sales._id+'/rows'),{offset:0,rows:salesRows});
    await routeV4(actor,'POST',new URL('https://test/api/v4/sales/'+sales._id+'/finalize'),{});
    await (await collection('providerControl')).deleteMany({});
    assert.equal((await processLookup(actor,sales._id,transport)).status,'COMPLETED'); assert.equal(calls,6);
    const salesSummary:any = await routeV4(actor,'GET',new URL('https://test/api/v4/sales/'+sales._id+'/summary'),{});
    assert.deepEqual(salesSummary.totals,summary.totals); assert.deepEqual(salesSummary.components,summary.components);
    assert.deepEqual(salesSummary.reportingGroups.map((g:any)=>[g.status,g.count,g.lines,g.totalCents,g.countPercent,g.valuePercent]), [
      ['OPTANTE',1,2,10010,25,23.28], ['NAO_OPTANTE',2,2,29990,50,69.74], ['CPF',1,1,3000,25,6.98]
    ]);
    assert.equal(salesSummary.reportingGroups[1].unconfirmedCents,9990); assert.equal(salesSummary.reportingGroups[1].nonCnpjCents,0);
    assert.equal(salesSummary.reportingGroups[2].nonCnpjCents,3000); assert.match(salesSummary.source,/data da venda/);
    const cpfSales = await purchaseRows(sales._id,'CPF',1,false,SALES_MODE);
    assert.equal(cpfSales.total,1); assert.equal(cpfSales.items[0].reportingStatus,'CPF'); assert.equal(cpfSales.items[0].status,'NON_CNPJ');
    assert.equal((await purchaseRows(sales._id,'NAO_OPTANTE',1,false,SALES_MODE)).total,2);
    assert.equal((await purchaseRows(sales._id,'NAO_OPTANTE',1,true,SALES_MODE)).total,2);
    const cpfCsv = await purchaseExport(sales._id,'CPF',1,SALES_MODE);
    assert.equal(cpfCsv.total,1); assert(cpfCsv.content.includes('"CPF";"NON_CNPJ"'));
    assert(!(await purchaseExport(sales._id,'NAO_OPTANTE',1,SALES_MODE)).content.includes('12345678900'));
    await assert.rejects(purchaseRows(job._id,'CPF',1));
    const salesCnpjs:any = await routeV4(actor,'GET',new URL('https://test/api/v4/sales/'+sales._id+'/results?status=ALL'),{});
    assert.equal(salesCnpjs.total,4); assert(salesCnpjs.items.every((row:any)=>row.kind==='CLIENTE'));
    const salesLines:any = await routeV4(actor,'GET',new URL('https://test/api/v4/sales/'+sales._id+'/lines'),{});
    assert.equal(salesLines.total,5); assert(salesLines.items.every((row:any)=>row.quantity==='0'));
    const storedSalesLines = await (await collection('purchaseLines')).find(scope({jobId:sales._id})).toArray();
    assert.equal(storedSalesLines.length,salesRows.length);
    assert(storedSalesLines.every(row=>row.kind==='CLIENTE'), 'A projeção persistida deve preservar CLIENTE em todas as linhas de vendas, incluindo CPF.');
    // Read the exact documents written by the Node pipeline through Python's production report loader.
    // Independent Python fixtures would not detect a field discarded by the Node Mongo projection.
    const pythonPdf = spawnSync('python', ['-c', `
import json, os, sys
from pymongo import MongoClient
from reporting.purchases import purchase_metadata, render_purchase_pdf
connection = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000, tz_aware=True)
try:
    db, workspace = connection[os.environ['MONGODB_DB']], os.environ['WORKSPACE_ID']
    reports = []
    for job_id in sys.argv[1:]:
        job = db.lookupJobs.find_one({'_id': job_id, 'workspaceId': workspace})
        assert job is not None
        meta = purchase_metadata(db, job, workspace)
        pdf = render_purchase_pdf(meta)
        assert pdf.startswith(b'%PDF') and 1000 < len(pdf) <= 4_000_000
        reports.append({key: meta[key] for key in ('reportType', 'lineCount', 'uniqueSuppliers', 'uniqueDocuments', 'nonCnpjDocumentCount', 'totalCents', 'cnpjCents', 'components', 'reportingGroups', 'sources')})
    print(json.dumps(reports))
finally:
    connection.close()
`, job._id, sales._id], {encoding:'utf8', env:process.env, timeout:30000, maxBuffer:100000});
    assert.equal(pythonPdf.error,undefined, 'O processo Python dos PDFs deve executar.');
    assert.equal(pythonPdf.status,0, `O PDF deve aceitar o snapshot persistido pelo Node: ${pythonPdf.stderr}`);
    assert.deepEqual(JSON.parse(pythonPdf.stdout), ['PURCHASES','SALES'].map(reportType=>({reportType,lineCount:5,uniqueSuppliers:3,uniqueDocuments:4,nonCnpjDocumentCount:1,totalCents:43000,cnpjCents:40000,components:summary.components,reportingGroups:reportType==='SALES'?salesSummary.reportingGroups:summary.reportingGroups,sources:reportType==='SALES'?['Minha Receita']:['Minha Receita','OpenCNPJ.org']})));
    const salesCsv:any = await routeV4(actor,'POST',new URL('https://test/api/v4/sales/'+sales._id+'/csv'),{status:'ALL',part:1});
    assert.match(salesCsv.fileName,/^vendas-/); assert(salesCsv.content.includes('Comprador (I)'));
    assert.equal((await purchaseHistory(clientId,1,SALES_MODE)).total,1); assert.equal((await purchaseHistory(clientId,1)).total,1);
    const historyAfterSales:any = await routeV4(actor,'GET',new URL('https://test/api/v4/history?clientId='+clientId),{}); assert.equal(historyAfterSales.total,0);
    await assert.rejects(repeatLookup(actor,sales._id)); await assert.rejects(purchaseSummary(sales._id));
    const salesItem = await (await collection('lookupItems')).findOne(scope({jobId:sales._id,cnpj:ids[0]}));
    await (await collection('lookupItems')).updateOne(scope({_id:salesItem!._id}),{$set:{kind:'FORNECEDOR'}});
    await assert.rejects(purchaseSummary(sales._id,true,SALES_MODE));
    await (await collection('lookupItems')).updateOne(scope({_id:salesItem!._id}),{$set:{kind:'CLIENTE'}});
    await (await collection('lookupJobs')).updateOne(scope({_id:sales._id}),{$unset:{calculationVersion:''}});
    await assert.rejects(purchaseSummary(sales._id,true,SALES_MODE));
    await (await collection('lookupJobs')).updateOne(scope({_id:sales._id}),{$set:{calculationVersion:'NET_V2'}});
    assert.equal((await purchaseSummary(sales._id,true,SALES_MODE)).totals.totalCents,43000);
    await (await collection('lookupJobs')).updateOne(scope({_id:job._id}),{$inc:{'purchaseInput.totalCents':1}});
    await assert.rejects(purchaseSummary(job._id));
    await (await collection('lookupJobs')).updateOne(scope({_id:job._id}),{$inc:{'purchaseInput.totalCents':-1}});
    const target = await (await collection('lookupItems')).findOne(scope({jobId:job._id,cnpj:ids[0]}));
    await (await collection('lookupItems')).updateOne(scope({_id:target!._id}),{$inc:{totalCents:1}});
    await assert.rejects(purchaseSummary(job._id));
    await (await collection('lookupItems')).updateOne(scope({_id:target!._id}),{$inc:{totalCents:-1}});
    await (await collection('lookupItems')).updateOne(scope({_id:target!._id}),{$set:{stateId:'missing'}});
    await assert.rejects(purchaseExport(job._id,'ALL',1));
    await (await collection('lookupItems')).updateOne(scope({_id:target!._id}),{$set:{stateId:target!.stateId}});
    const purchaseLines = await collection('purchaseLines'), lineIdentity = scope({jobId:job._id,index:0});
    await purchaseLines.updateOne(lineIdentity,{$inc:{grossCents:1}}); await assert.rejects(purchaseSummary(job._id));
    await purchaseLines.updateOne(lineIdentity,{$inc:{grossCents:-1}});
    await purchaseLines.updateOne(lineIdentity,{$inc:{accessoryCents:1}}); await assert.rejects(purchaseSummary(job._id));
    await purchaseLines.updateOne(lineIdentity,{$inc:{accessoryCents:-1}});
    await purchaseLines.updateOne(lineIdentity,{$unset:{discountCents:''}}); await assert.rejects(purchaseSummary(job._id));
    await purchaseLines.updateOne(lineIdentity,{$set:{discountCents:600}});
    process.env.WORKSPACE_ID = 'another_workspace'; await assert.rejects(purchaseSummary(job._id)); process.env.WORKSPACE_ID = 'purchases_test';
    const allCpf = await createLookup(actor,{...input,importId:randomUUID(),expectedRows:1},PURCHASE_MODE);
    await uploadLookup(actor,allCpf._id,{offset:0,rows:[rows[4]]});
    assert.equal((await finalizeLookup(actor,allCpf._id)).status,'COMPLETED');
    const cpfSummary = await purchaseSummary(allCpf._id); assert.equal(cpfSummary.totals.cnpjCents,0); assert.equal(cpfSummary.totals.totalCents,3000); assert(cpfSummary.groups.every(g=>g.countPercent===0&&g.valuePercent===0));
    assert.equal(cpfSummary.totals.uniqueDocuments,1);
    assert.equal(cpfSummary.reportingGroups[1].totalCents,3000); assert.equal(cpfSummary.reportingGroups[1].countPercent,100); assert.equal(cpfSummary.reportingGroups[1].valuePercent,100);
    // Repeated CPF/CNO/invalid documents are identities; missing documents always remain separate rows.
    const nonCnpjInputs = ['123.456.789-00','12345678900','123456789012','123456789012','abc-123','ABC123','','']
      .map((document,index)=>({...rows[4],document,totalCents:(index+1)*100,grossCents:(index+1)*100+500}));
    const nonCnpjJob = await createLookup(actor,{...input,importId:randomUUID(),expectedRows:nonCnpjInputs.length},PURCHASE_MODE);
    await uploadLookup(actor,nonCnpjJob._id,{offset:0,rows:nonCnpjInputs});
    assert.equal((await finalizeLookup(actor,nonCnpjJob._id)).status,'COMPLETED');
    assert.equal(calls,6, 'CPF, CNO, inválidos e ausentes não são enviados ao provedor CNPJ.');
    const nonCnpjSummary = await purchaseSummary(nonCnpjJob._id);
    assert.equal(nonCnpjSummary.totals.uniqueCnpjs,0); assert.equal(nonCnpjSummary.totals.uniqueDocuments,5);
    assert.equal(nonCnpjSummary.totals.nonCnpjDocumentCount,5); assert.equal(nonCnpjSummary.totals.totalCents,3600);
    assert.deepEqual(nonCnpjSummary.reportingGroups.map(g=>[g.status,g.count,g.lines,g.totalCents,g.countPercent,g.valuePercent]),[
      ['OPTANTE',0,0,0,0,0], ['NAO_OPTANTE',5,8,3600,100,100]
    ]);
    const allNonOptants = await purchaseRows(nonCnpjJob._id,'NAO_OPTANTE',1);
    assert.equal(allNonOptants.total,5); assert.equal((await purchaseRows(nonCnpjJob._id,'ALL',1)).total,5);
    assert.equal((await purchaseRows(nonCnpjJob._id,'NON_CNPJ',1)).total,5);
    assert.equal((await purchaseRows(nonCnpjJob._id,'NAO_OPTANTE',1,true)).total,8);
    assert(allNonOptants.items.every((row:any)=>row.status==='NON_CNPJ'&&row.reportingStatus==='NAO_OPTANTE'));
    assert.equal(allNonOptants.items.filter((row:any)=>row.document==='').length,2);
    const cpf = allNonOptants.items.find((row:any)=>row.documentKind==='CPF'); assert.equal(cpf.occurrences,2); assert.equal(cpf.totalCents,300);
    assert.equal((await purchaseExport(nonCnpjJob._id,'NAO_OPTANTE',1)).total,8);
    const zeroJob = await createLookup(actor,{...input,importId:randomUUID(),expectedRows:1},PURCHASE_MODE);
    await uploadLookup(actor,zeroJob._id,{offset:0,rows:[{...rows[4],document:'',totalCents:0,grossCents:500}]});
    await finalizeLookup(actor,zeroJob._id); const zeroSummary = await purchaseSummary(zeroJob._id);
    assert.equal(zeroSummary.reportingGroups[1].countPercent,100); assert(zeroSummary.reportingGroups.every(g=>g.valuePercent===0));
    const legacy = await createLookup(actor,{...input,importId:randomUUID(),expectedRows:1},PURCHASE_MODE);
    await (await collection('lookupJobs')).updateOne(scope({_id:legacy._id}),{$unset:{calculationVersion:''}});
    await uploadLookup(actor,legacy._id,{offset:0,rows:[{document:'12345678900',name:'Legado',quantity:'1',totalCents:12345}]});
    await finalizeLookup(actor,legacy._id); const legacySummary = await purchaseSummary(legacy._id);
    assert.equal(legacySummary.calculationVersion,'Q_V1'); assert.equal(legacySummary.formula,'Q'); assert.equal(legacySummary.components,null); assert.equal(legacySummary.totals.totalCents,12345);
    assert(!(await purchaseLines.findOne(scope({jobId:legacy._id})))!.grossCents);
    assert.equal((await purchaseSummary(job._id)).totals.totalCents,43000); assert.equal(await (await collection('clients')).countDocuments(scope()),2);
  } finally {
    await (await database()).dropDatabase(); await closeDatabase(); resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
