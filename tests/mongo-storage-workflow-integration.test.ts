import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Collection} from 'mongodb';
import {collection,scope,closeDatabase,type Doc} from '../src/store.ts';
import {jobCollection,jobDatabase,storageDatabases} from '../src/mongo-storage.ts';
import {getJob,resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createLookup,uploadLookup,finalizeLookup,processLookup,recheckLookup,cancelLookup} from '../src/lookup-jobs.ts';
import {createGeneration,attachGenerationSale,attachGenerationPurchase,deleteGeneration} from '../src/generation-store.ts';
import {purchaseSummary,purchaseRows,purchaseExport,currentSalesDocumentDifal} from '../src/purchase-store.ts';
import {routeV4} from '../src/lookup-http.ts';
import {SALES_MODE} from '../src/purchase-domain.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {createSimulation,getSimulation} from '../src/simulation-history.ts';
import {rebuildSimulationSource} from '../src/simulation-reprocessing-source.ts';
import {baselineMonth} from '../public/simulator-monthly.js';
import {digits} from '../src/domain.ts';

const enabled=!!process.env.MONGODB_URI&&!!process.env.MONGODB_TEST_URI_2&&!!process.env.MONGODB_TEST_URI_3;
const actor={_id:'storage-workflow-admin',role:'admin',name:'Equipe sintética',email:'storage-workflow@example.test'};
const cnpj='00000000000191',otherCnpj='178654320001'+digits('178654320001');
const financialRow=(index:number,document=cnpj,natureCode='5102')=>({document,name:'Documento sintético',
  serviceDate:index===0?'2026-01-15':'2026-09-15',natureCode,description:'Mercadoria sintética',recipientUf:'SP',quantity:'1',
  totalCents:10000+index,grossCents:10000+index,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0});
const payloadBytes=(rows:any[])=>rows.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row),'utf8')+1,0);
const provider=(optant:(document:string)=>boolean)=>(async(url:string|URL|Request)=>{
  const document=String(url).split('/').pop();
  return Response.json({cnpj:document,razao_social:'Empresa sintética '+document,opcao_pelo_simples:optant(document!),opcao_pelo_mei:false});
}) as typeof fetch;

test('três MongoDB preservam importação, reconsulta parcial, histórico, DRE, agregados e exclusão',
  {skip:!enabled,timeout:180000},async t=>{
  const keys=['MONGODB_URI_2','MONGODB_URI_3','MONGODB_DB','MONGODB_DB_2','MONGODB_DB_3',
    'MONGODB_STORAGE_LIMIT_BYTES','MONGODB_STORAGE_LIMIT_BYTES_2','MONGODB_STORAGE_LIMIT_BYTES_3','MONGODB_ROLLOVER_PERCENT','WORKSPACE_ID'];
  const beforeEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const prefix='maximum_pool_workflow_'+randomUUID().replaceAll('-','');
  process.env.MONGODB_URI_2=process.env.MONGODB_TEST_URI_2;process.env.MONGODB_URI_3=process.env.MONGODB_TEST_URI_3;
  for(const slot of [1,2,3]){
    const suffix=slot===1?'':`_${slot}`;
    process.env['MONGODB_DB'+suffix]=prefix+'_'+slot;
    process.env['MONGODB_STORAGE_LIMIT_BYTES'+suffix]='100000000';
  }
  process.env.MONGODB_ROLLOVER_PERCENT='85';process.env.WORKSPACE_ID='pool_workflow';
  await closeDatabase();resetLookupIndexes();
  const upload=async(id:string,rows:any[])=>{
    for(let offset=0;offset<rows.length;offset+=250)await uploadLookup(actor,id,{offset,rows:rows.slice(offset,offset+250)});
  };
  const complete=async(id:string,optant:(document:string)=>boolean=()=>true)=>{
    let job=await finalizeLookup(actor,id);
    while(job.status==='UPLOADING')job=await finalizeLookup(actor,id);
    await(await collection('providerControl')).deleteMany({});
    return processLookup(actor,id,provider(optant));
  };
  const catalogLookup=async(clientId:string,slot:number,documents:string[])=>{
    const job=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'cadastro-sintetico.csv',expectedRows:documents.length});
    assert.equal(job.storageSlot,slot);
    await upload(job._id,documents.map(cnpj=>({cnpj,name:'Empresa sintética',kind:'CLIENTE',uf:'SP'})));
    return job;
  };
  try{
    const clientId=(await importCatalog(actor,[{code:'9771',name:'Empresa pool sintética',uf:'MG'}])).items[0].id;
    const unicodeRow={...financialRow(0,'12345678900'),description:'漢'.repeat(1998)+'😊'};
    await t.test('tamanho previsto aceita UTF-8 e bloqueia subdeclaração antes de gravar o chunk',async()=>{
      const bytes=payloadBytes([unicodeRow]),input={clientId,importId:randomUUID(),fileName:'unicode-sintetico.csv',expectedRows:1,issuerUf:'MG'};
      assert(bytes>JSON.stringify(unicodeRow).length+1);assert(bytes>4096);
      for(const invalid of [null,0,-1,1.5,'100',NaN,Infinity,50000*65536+1]){
        await assert.rejects(createLookup(actor,{...input,expectedPayloadBytes:invalid},SALES_MODE),(error:any)=>error.code==='VALIDATION');
      }
      const underestimated=await createLookup(actor,{...input,expectedPayloadBytes:bytes-1},SALES_MODE);
      await assert.rejects(uploadLookup(actor,underestimated._id,{offset:0,rows:[unicodeRow]}),(error:any)=>error.code==='STORAGE_RESERVATION_EXCEEDED'&&error.status===503);
      assert.equal(await(await jobCollection('lookupStage',underestimated)).countDocuments(scope({jobId:underestimated._id})),0);
      assert.equal(await(await collection('chunks')).countDocuments(scope({_id:`lookup:${underestimated._id}:0`})),0);
      assert.equal((await getJob(underestimated._id)).uploaded,0);
      const repeated=await createLookup(actor,{...input,expectedPayloadBytes:bytes*2},SALES_MODE);
      assert.equal(repeated.expectedPayloadBytes,bytes-1,'Uma repetição não altera silenciosamente a reserva original.');
    });
    for(const failure of ['partial-bulk','missing-receipt'] as const)await t.test('bytes não duplicam na retomada: '+failure,async()=>{
      const values=[unicodeRow,financialRow(1,'12345678900')],bytes=payloadBytes(values);
      const job=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'retomada-unicode.csv',expectedRows:2,expectedPayloadBytes:bytes,issuerUf:'MG'},SALES_MODE);
      let interrupted=false;
      const bulkWrite=Collection.prototype.bulkWrite,updateOne=Collection.prototype.updateOne;
      const patch=failure==='partial-bulk'?t.mock.method(Collection.prototype,'bulkWrite',async function(this:Collection,...args:any[]){
        if(!interrupted&&this.collectionName==='lookupStage'&&args[0]?.[0]?.updateOne?.update?.$setOnInsert?.jobId===job._id){
          interrupted=true;await bulkWrite.call(this,args[0].slice(0,1),args[1]);throw new Error('Interrupção sintética do payload');
        }
        return bulkWrite.apply(this,args as any);
      }):t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,...args:any[]){
        if(!interrupted&&this.collectionName==='chunks'&&args[0]?._id===`lookup:${job._id}:0`&&args[1]?.$set?.complete===true){
          interrupted=true;throw new Error('Interrupção sintética do recibo');
        }
        return updateOne.apply(this,args as any);
      });
      try{await assert.rejects(uploadLookup(actor,job._id,{offset:0,rows:values}),/Interrupção sintética/);}
      finally{patch.mock.restore();}
      assert(interrupted);
      const interruptedJob=await getJob(job._id);
      assert.equal(interruptedJob.uploaded,failure==='partial-bulk'?0:2);
      assert.equal(interruptedJob.uploadedPayloadBytes??0,failure==='partial-bulk'?0:bytes);
      await uploadLookup(actor,job._id,{offset:0,rows:values});
      await uploadLookup(actor,job._id,{offset:0,rows:values});
      const recovered=await getJob(job._id);
      assert.equal(recovered.uploaded,2);assert.equal(recovered.uploadedPayloadBytes,bytes);
      const stored=await(await jobCollection('lookupStage',recovered)).find(scope({jobId:job._id})).sort({index:1}).toArray();
      assert.equal(stored.length,2);assert.equal(stored[0].description,unicodeRow.description);
    });
    await t.test('upload atrasado não regride cursor ou bytes depois de perder a lease',async()=>{
      const values=[unicodeRow,financialRow(1,'12345678900')],bytes=payloadBytes(values);
      const job=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'concorrencia-unicode.csv',expectedRows:2,expectedPayloadBytes:bytes,issuerUf:'MG'},SALES_MODE);
      const jobs=await collection('lookupJobs'),bulkWrite=Collection.prototype.bulkWrite,updateOne=Collection.prototype.updateOne;
      let replaced=false,receipts=0;
      const countReceipts=t.mock.method(Collection.prototype,'updateOne',async function(this:Collection,...args:any[]){
        if(this.collectionName==='chunks'&&String(args[0]?._id).startsWith(`lookup:${job._id}:`)&&args[1]?.$set?.complete===true)receipts++;
        return updateOne.apply(this,args as any);
      });
      const patch=t.mock.method(Collection.prototype,'bulkWrite',async function(this:Collection,...args:any[]){
        const result=await bulkWrite.apply(this,args as any);
        if(!replaced&&this.collectionName==='lookupStage'&&args[0]?.[0]?.updateOne?.update?.$setOnInsert?.jobId===job._id){
          replaced=true;
          await jobs.updateOne(scope({_id:job._id}),{$set:{leaseUntil:new Date(0)}});
          await uploadLookup(actor,job._id,{offset:0,rows:values.slice(0,1)});
          await uploadLookup(actor,job._id,{offset:1,rows:values.slice(1)});
        }
        return result;
      });
      try{await assert.rejects(uploadLookup(actor,job._id,{offset:0,rows:values.slice(0,1)}),(error:any)=>error.code==='JOB_BUSY');}
      finally{patch.mock.restore();countReceipts.mock.restore();}
      assert(replaced);assert.equal(receipts,2,'O escritor atrasado não pode confirmar outro recibo.');
      const current=await getJob(job._id);assert.equal(current.uploaded,2);assert.equal(current.uploadedPayloadBytes,bytes);
      assert.equal(await(await jobCollection('lookupStage',job)).countDocuments(scope({jobId:job._id})),2);
    });
    await t.test('cancelamento depois do cursor salvo impede confirmação tardia do recibo',async()=>{
      const values=[unicodeRow,financialRow(1,'12345678900')],bytes=payloadBytes(values);
      const job=await createLookup(actor,{clientId,importId:randomUUID(),fileName:'cancelamento-unicode.csv',expectedRows:2,expectedPayloadBytes:bytes,issuerUf:'MG'},SALES_MODE);
      const jobs=await collection('lookupJobs'),findOne=Collection.prototype.findOne;let cancelled=false;
      const patch=t.mock.method(Collection.prototype,'findOne',async function(this:Collection,...args:any[]){
        if(!cancelled&&this.collectionName==='lookupJobs'&&args[0]?._id===job._id&&args[0]?.uploaded===2&&args[0]?.leaseOwner){
          cancelled=true;
          await jobs.updateOne(scope({_id:job._id}),{$set:{leaseUntil:new Date(0)}});
          await cancelLookup(actor,job._id);
        }
        return findOne.apply(this,args as any);
      });
      try{await assert.rejects(uploadLookup(actor,job._id,{offset:0,rows:values}),(error:any)=>error.code==='JOB_BUSY');}
      finally{patch.mock.restore();}
      assert(cancelled);const current=await getJob(job._id);
      assert.equal(current.status,'CANCELLED');assert.equal(current.uploadedPayloadBytes,bytes);
      assert.equal((await(await collection('chunks')).findOne(scope({_id:`lookup:${job._id}:0`})))?.complete,false);
    });
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
    const rows=Array.from({length:502},(_,index)=>financialRow(index,index===501?'12345678900':cnpj));
    const sales=(await attachGenerationSale(actor,generation._id,{clientId,importId:randomUUID(),fileName:'vendas-sinteticas.csv',expectedRows:rows.length,expectedPayloadBytes:payloadBytes(rows),issuerUf:'MG'})).job;
    assert.equal(sales.expectedPayloadBytes,payloadBytes(rows));
    assert.equal(sales.storageSlot,1);await upload(sales._id,rows);await complete(sales._id);
    assert.equal((await getJob(sales._id)).uploadedPayloadBytes,payloadBytes(rows));
    const firstCatalog=await catalogLookup(clientId,1,[otherCnpj]);await complete(firstCatalog._id);
    const oldRetry=await createLookup(actor,{clientId,importId:firstCatalog._id,fileName:firstCatalog.fileName,expectedRows:1,expectedPayloadBytes:1000});
    assert.equal(oldRetry.expectedPayloadBytes,undefined,'Retry de cabeçalho sem estimativa mantém a identidade e os dados legados.');
    const snapshot=async()=>({job:await getJob(sales._id),
      lines:await(await jobCollection('purchaseLines',sales)).find(scope({jobId:sales._id})).sort({index:1}).toArray(),
      items:await(await jobCollection('lookupItems',sales)).find(scope({jobId:sales._id})).sort({cnpj:1}).toArray(),
      states:await(await jobCollection('cnpjStates',sales)).find(scope()).sort({_id:1}).toArray()});
    const original=await snapshot(),totals=(await purchaseSummary(sales._id,true,SALES_MODE)).totals;
    let secondCatalog:Doc,thirdCatalog:Doc,rechecked:Doc;
    const recheckId=randomUUID();

    await t.test('cópia interrompida mantém o destino reservado depois de avançar para MongoDB 3',async()=>{
      process.env.MONGODB_STORAGE_LIMIT_BYTES='1';
      // A measured copy fits here; the legacy 32-KiB-per-row reservation would not.
      process.env.MONGODB_STORAGE_LIMIT_BYTES_2='16000000';
      const originalWrite=Collection.prototype.bulkWrite,copySizes:number[]=[];
      const patch=t.mock.method(Collection.prototype,'bulkWrite',async function(this:Collection,...args:any[]){
        const copies=args[0].filter((entry:any)=>entry.updateOne?.update?.$setOnInsert?.jobId===recheckId);
        if(this.collectionName==='purchaseLines'&&copies.length){
          copySizes.push(copies.length);
          if(copies.some((entry:any)=>entry.updateOne.update.$setOnInsert.index===500))throw new Error('Interrupção sintética no segundo lote');
        }
        return originalWrite.apply(this,args as any);
      });
      try{await assert.rejects(recheckLookup(actor,sales._id,{importId:recheckId}),/Interrupção sintética/);}
      finally{patch.mock.restore();}
      rechecked=await getJob(recheckId);assert.equal(rechecked.storageSlot,2);assert.equal(rechecked.status,'UPLOADING');
      assert(rechecked.expectedPayloadBytes>0);
      assert.deepEqual(copySizes,[500,2]);
      assert.equal(await(await jobCollection('purchaseLines',rechecked)).countDocuments(scope({jobId:recheckId})),500);
      secondCatalog=await catalogLookup(clientId,2,[otherCnpj]);await complete(secondCatalog._id);
      process.env.MONGODB_STORAGE_LIMIT_BYTES_2='1';
      thirdCatalog=await catalogLookup(clientId,3,[cnpj,otherCnpj]);
      rechecked=await recheckLookup(actor,sales._id,{importId:recheckId});
      assert.equal(rechecked.storageSlot,2);assert.equal(rechecked.status,'PROCESSING');
      await(await collection('providerControl')).deleteMany({});
      await processLookup(actor,recheckId,provider(()=>false));
      await complete(thirdCatalog._id,document=>document===cnpj);
      const checked=await purchaseSummary(recheckId,true,SALES_MODE);
      assert.deepEqual(checked.totals,totals);assert.equal(checked.groups.find(group=>group.status==='NAO_OPTANTE')?.count,1);
      assert.equal((await recheckLookup(actor,sales._id,{importId:recheckId})).storageSlot,2);
      assert.deepEqual(await snapshot(),original,'A reconsulta nunca altera dados e estados da origem.');
      for(const {slot,db} of await storageDatabases()){
        assert.equal(await db.collection('purchaseLines').countDocuments(scope({jobId:recheckId})),slot===2?502:0);
      }
    });

    await t.test('consulta e histórico unem os destinos sem duplicar o mesmo CNPJ',async()=>{
      const detail=await routeV4(actor,'GET',new URL('http://localhost/api/v4/lookups/'+thirdCatalog!._id+'/results'),{}) as any;
      assert.equal(detail.total,2);assert(detail.items.every((item:any)=>item.details?.name.startsWith('Empresa sintética')));
      const history=await routeV4(actor,'GET',new URL('http://localhost/api/v4/history?cnpj='+otherCnpj),{}) as any;
      assert.equal(history.total,3);assert.deepEqual(new Set(history.items.map((item:any)=>item._id)),new Set([firstCatalog._id,secondCatalog!._id,thirdCatalog!._id]));
      const dashboard=await routeV4(actor,'GET',new URL('http://localhost/api/v4/dashboard'),{}) as any;
      assert.equal(dashboard.metrics.total,2);assert.equal(dashboard.metrics.optants,1);assert.equal(dashboard.metrics.nonOptants,1);
      const entity=await(await collection('cnpjEntities')).findOne(scope({cnpj}));assert.equal(entity?.storageSlot,3);
      const details=await purchaseRows(recheckId,'ALL',1,false,SALES_MODE);
      assert.equal(details.total,2);assert.equal(details.items.find((item:any)=>item.cnpj===cnpj)?.details?.status,'NAO_OPTANTE');
      const exported=await purchaseExport(recheckId,'ALL',1,SALES_MODE);assert.equal(exported.total,502);assert(exported.content.includes(cnpj));
      const estimate=await currentSalesDocumentDifal(recheckId);assert.equal(estimate.difal.eligibleLines,0);assert.equal(estimate.difal.amountCents,0);assert.equal(estimate.period.months,9);
    });

    let savedSimulation:any,purchases:Doc;
    await t.test('compras no MongoDB 3 e vendas no 1 mantêm a DRE e o recálculo das fontes',async()=>{
      const values=[financialRow(0,'12345678900','1102'),financialRow(1,'12345678900','1102')];
      purchases=(await attachGenerationPurchase(actor,generation._id,{clientId,importId:randomUUID(),fileName:'compras-sinteticas.csv',expectedRows:2,expectedPayloadBytes:payloadBytes(values),issuerUf:'MG'})).job;
      assert.equal(purchases.expectedPayloadBytes,payloadBytes(values));
      assert.equal(purchases.storageSlot,3);
      await upload(purchases._id,values);await complete(purchases._id);
      const source=await generationSimulator(generation._id,clientId),months=source.monthlyReports!.map(row=>baselineMonth(row)),first=months[0];
      assert.equal(source.reportMonths,9);assert.equal(source.sales.totalCents,totals.totalCents);
      const draft={year:2027,salesAnnex:1,serviceAnnex:3,rbt12:null,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['presumed','actual']},
        values:{...first.values,salesRevenue:first.groups.salesOptantCents+first.groups.salesNonOptantCents+first.groups.salesCpfCents,
          simplePurchases:first.groups.purchasesOptantCents,regularPurchases:first.groups.purchasesNonOptantCents}};
      savedSimulation=await createSimulation(actor,{simulationId:randomUUID(),generationId:generation._id,clientId,reportMonths:9,periodConfirmed:true,
        monthlyGroups:first.groups,monthlyInputs:months,draft,rbt12Source:'NOT_REQUIRED'});
      const raw=await(await collection('simulations')).findOne(scope({_id:savedSimulation._id}));
      const rebuilt=await rebuildSimulationSource(raw!);assert.deepEqual(rebuilt.fields,source.fields);
      await closeDatabase();resetLookupIndexes();
      assert.deepEqual(await getSimulation(savedSimulation._id),savedSimulation);
      assert.deepEqual((await purchaseSummary(recheckId,true,SALES_MODE)).totals,totals);
    });

    await t.test('destino ausente não vira histórico vazio nem gravação no banco ativo',async()=>{
      const second=process.env.MONGODB_URI_2,third=process.env.MONGODB_URI_3;
      delete process.env.MONGODB_URI_2;delete process.env.MONGODB_URI_3;
      try{
        await assert.rejects(purchaseSummary(recheckId,true,SALES_MODE),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');
        await assert.rejects(routeV4(actor,'GET',new URL('http://localhost/api/v4/history?cnpj='+otherCnpj),{}),(error:any)=>error.code==='STORAGE_NOT_CONFIGURED');
      }finally{process.env.MONGODB_URI_2=second;process.env.MONGODB_URI_3=third;}
      assert.equal((await getJob(recheckId)).storageSlot,2);
    });

    await t.test('exclusão interrompida retoma em todos os destinos e conserva reconsulta e simulação',async()=>{
      const originalDelete=Collection.prototype.deleteMany;let interrupted=false;
      const thirdDb=await jobDatabase(purchases!);
      const patch=t.mock.method(Collection.prototype,'deleteMany',async function(this:Collection,...args:any[]){
        if(!interrupted&&this.dbName===thirdDb.databaseName&&this.collectionName==='purchaseLines'){
          interrupted=true;throw new Error('Interrupção sintética na exclusão do MongoDB 3');
        }
        return originalDelete.apply(this,args as any);
      });
      try{await assert.rejects(deleteGeneration(actor,generation._id),/Interrupção sintética/);}
      finally{patch.mock.restore();}
      assert(interrupted);assert.equal(await(await collection('lookupJobs')).countDocuments(scope({generationId:generation._id})),2);
      await deleteGeneration(actor,generation._id);await deleteGeneration(actor,generation._id);
      for(const {db} of await storageDatabases())for(const name of ['lookupStage','purchaseLines','lookupItems']){
        assert.equal(await db.collection(name).countDocuments(scope({jobId:{$in:[sales._id,purchases!._id]}})),0);
      }
      assert.equal(await(await collection('lookupJobs')).countDocuments(scope({generationId:generation._id})),0);
      assert.equal(await(await jobCollection('purchaseLines',recheckId)).countDocuments(scope({jobId:recheckId})),502);
      assert.deepEqual(await getSimulation(savedSimulation._id),savedSimulation);
    });
  }finally{
    for(const {db} of await storageDatabases()){
      assert(db.databaseName.startsWith(prefix));await db.dropDatabase();
    }
    await closeDatabase();resetLookupIndexes();
    for(const [key,value] of Object.entries(beforeEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
