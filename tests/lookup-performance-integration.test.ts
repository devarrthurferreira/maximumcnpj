import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database, collection, scope, closeDatabase} from '../src/store.ts';
import {digits} from '../src/domain.ts';
import {createLookup, uploadLookup, finalizeLookup, processLookup, recheckLookup} from '../src/lookup-jobs.ts';
import {lookupProgress} from '../src/lookup-engine.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {routeV4} from '../src/lookup-http.ts';
import {PURCHASE_MODE, SALES_MODE} from '../src/purchase-domain.ts';
import {purchaseSummary} from '../src/purchase-store.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const doc = (n: number) => { const base = '12345678' + String(n).padStart(4, '0'); return base + digits(base); };

test('MongoDB: concorrência limitada, progresso correto, retries, isolamento e revalidação imutável', {skip: !process.env.MONGODB_URI, timeout: 120000}, async t => {
  const keys = ['MONGODB_DB', 'WORKSPACE_ID', 'LOOKUP_CONCURRENCY', 'LOOKUP_INTERVAL_MS'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const testDatabase = 'maximum_performance_test_' + randomUUID().replaceAll('-', '');
  process.env.MONGODB_DB = testDatabase;
  process.env.WORKSPACE_ID = 'performance_test'; process.env.LOOKUP_CONCURRENCY = '3'; process.env.LOOKUP_INTERVAL_MS = '300'; resetLookupIndexes();
  const actor = {_id: 'performance-tester', role: 'admin', name: 'Teste sintético', email: 'test@example.test'};
  try {
    const catalog = await importCatalog(actor, [{code: '991', name: 'Carteira sintética A'}, {code: '992', name: 'Carteira sintética B'}]);
    const clientId = catalog.items[0].id;
    async function fresh(rows: any[], mode?: string) {
      const job = await createLookup(actor, {importId: randomUUID(), clientId, fileName: 'sintetico.csv', expectedRows: rows.length}, mode);
      for (let offset = 0; offset < rows.length; offset += 250) await uploadLookup(actor, job._id, {offset, rows: rows.slice(offset, offset + 250)});
      await finalizeLookup(actor, job._id); await (await collection('providerControl')).deleteMany({}); return job._id;
    }
    const cnpjs = Array.from({length: 6}, (_, i) => doc(i + 1));
    const id = await fresh([...cnpjs.map(cnpj => ({cnpj, name: 'Empresa sintética'})), {cnpj: cnpjs[0], name: 'Repetida'}, {cnpj: '12345678900', name: 'CPF'}]);
    const before = await lookupProgress(id); assert.equal(before.metrics.total, 6); assert.equal(before.metrics.pending, 6); assert.equal(before.metrics.nonOptants, 0);
    let active = 0, peak = 0; const calls: string[] = [], starts: number[] = [];
    const mock = (async (url: any) => {
      const cnpj = String(url).split('/').at(-1)!; calls.push(cnpj); starts.push(Date.now()); active++; peak = Math.max(peak, active);
      try { await sleep(800); return Response.json({cnpj, razao_social: 'Empresa sintética', opcao_pelo_simples: cnpjs.indexOf(cnpj) % 2 === 0}); }
      finally { active--; }
    }) as typeof fetch;
    const done = await processLookup(actor, id, mock);
    assert.equal(done.status, 'COMPLETED'); assert.equal(calls.length, 6); assert.equal(new Set(calls).size, 6); assert(peak >= 2 && peak <= 3, `concorrência ${peak}`);
    for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 250, 'Pausa global entre inícios deve ser respeitada.');
    const after = await lookupProgress(id); assert.equal(after.metrics.optants, 3); assert.equal(after.metrics.nonOptants, 3); assert.equal(after.metrics.unconfirmed, 0); assert.equal(after.metrics.pending, 0);
    assert.equal((await lookupProgress(id, 1, 'OPTANTE')).total, 3);
    const summary = await lookupProgress(id, 1, 'OPTANTE', true);
    assert.deepEqual(summary.metrics, after.metrics); assert.equal(summary.total, 3);
    assert.equal(summary.summaryOnly, true); assert.deepEqual(summary.items, []);
    assert(!JSON.stringify(after).includes('passwordHash'));
    const viewer: any = await routeV4({...actor, role: 'viewer'}, 'GET', new URL(`https://test/api/v4/lookups/${id}/progress`), {});
    assert.equal(viewer.canRecheck, false);
    await assert.rejects(routeV4({...actor, role: 'viewer'}, 'POST', new URL(`https://test/api/v4/lookups/${id}/recheck`), {}));
    process.env.WORKSPACE_ID = 'other'; await assert.rejects(lookupProgress(id)); process.env.WORKSPACE_ID = 'performance_test';

    const retryId = await fresh([{cnpj: doc(8), name: 'Indicador ausente'}]);
    let retryCalls = 0;
    const missing = (async () => Response.json({cnpj: doc(8), opcao_pelo_simples: ++retryCalls > 1 ? true : null})) as typeof fetch;
    const pending = await processLookup(actor, retryId, missing); assert.equal(pending.status, 'PROCESSING');
    const waiting = await lookupProgress(retryId); assert.equal(waiting.metrics.retrying, 1); assert.equal(waiting.metrics.nonOptants, 0); assert.equal(waiting.metrics.completed, 0);
    await (await collection('lookupItems')).updateMany(scope({jobId: retryId}), {$set: {nextAt: new Date(0)}});
    await (await collection('providerControl')).deleteMany({});
    assert.equal((await processLookup(actor, retryId, missing)).resultSummary.optants, 1); assert.equal(retryCalls, 2);

    process.env.LOOKUP_CONCURRENCY = '1';
    const limitedId = await fresh([{cnpj: doc(9), name: 'Limite'}, {cnpj: doc(10), name: 'Ainda não consultada'}]);
    const anotherLimitedId = await fresh([{cnpj: doc(13), name: 'Outro lote aguarda o limite global'}]);
    let limitedCalls = 0;
    const limited = (async () => { limitedCalls++; return new Response('', {status: 429, headers: {'retry-after': '75'}}); }) as typeof fetch;
    await processLookup(actor, limitedId, limited); await processLookup(actor, limitedId, limited);
    await processLookup(actor, anotherLimitedId, limited);
    assert.equal(limitedCalls, 1); const limitedProgress = await lookupProgress(limitedId);
    assert.equal(limitedProgress.metrics.nonOptants, 0); assert.equal(limitedProgress.metrics.pending, 1); assert.equal(limitedProgress.metrics.retrying, 1);
    const control = await (await collection('providerControl')).findOne({_id: 'minhareceita-global'}); assert(control!.nextAt.getTime() > Date.now() + 65000);
    assert.equal((await lookupProgress(anotherLimitedId)).metrics.pending, 1);
    // The provider cooldown also applies when the current item has exhausted its retries.
    await (await collection('lookupItems')).updateOne(scope({jobId:limitedId,cnpj:doc(9)}),{$set:{attempts:2,nextAt:new Date(0)}});
    await (await collection('providerControl')).updateOne({_id:'minhareceita-global'},{$set:{nextAt:new Date(0)}});
    await processLookup(actor,limitedId,limited);
    assert.equal(limitedCalls,2);
    assert.equal((await lookupProgress(limitedId)).metrics.unconfirmed,1);
    await processLookup(actor,anotherLimitedId,limited);
    assert.equal(limitedCalls,2,'Esgotar tentativas não autoriza ignorar Retry-After em outro lote.');

    const financialRow = (document: string) => ({document, name: 'Parceiro sintético', serviceDate: '2026-08-15', quantity: '1', grossCents: 10000, discountCents: 1000, accessoryCents: 300, freightCents: 2000, abatementCents: 500, totalCents: 10500});
    for (const mode of [PURCHASE_MODE, SALES_MODE]) {
      const financial = await fresh([financialRow(doc(11)), financialRow(doc(11)), financialRow('12345678900')], mode);
      await processLookup(actor, financial, (async () => Response.json({cnpj: doc(11), opcao_pelo_simples: true})) as typeof fetch);
      const oldSummary = await purchaseSummary(financial, true, mode);
      assert.equal(oldSummary.totals.totalCents, 31500);
      const renewed = await recheckLookup(actor, financial); assert.equal(renewed.repeatedFrom, financial); assert.notEqual(renewed._id, financial);
      assert.deepEqual(renewed.reportPeriod, oldSummary.period); assert.equal(renewed.mode, mode); assert.equal(renewed.status, 'PROCESSING'); assert.equal(renewed.generationId, undefined);
      assert.equal((await lookupProgress(renewed._id)).metrics.pending, 1);
      await (await collection('providerControl')).deleteMany({}); let renewedCalls = 0;
      await processLookup(actor, renewed._id, (async () => { renewedCalls++; return Response.json({cnpj: doc(11), opcao_pelo_simples: false}); }) as typeof fetch);
      assert.equal(renewedCalls, 1);
      const newSummary = await purchaseSummary(renewed._id, true, mode);
      assert.deepEqual(newSummary.totals, oldSummary.totals); assert.deepEqual(newSummary.components, oldSummary.components);
      assert.equal(newSummary.groups.find(g => g.status === 'OPTANTE')!.count, 0);
      assert.equal((await purchaseSummary(financial, true, mode)).groups.find(g => g.status === 'OPTANTE')!.count, 1);
      if (mode === SALES_MODE) assert.equal(newSummary.reportingGroups.find(g => g.status === 'CPF')!.totalCents, 10500);
      else assert.equal(newSummary.reportingGroups.find(g => g.status === 'NAO_OPTANTE')!.totalCents, 31500);
    }
    // Equal concurrent source snapshots are shared, but each job gets its own fresh verification.
    process.env.LOOKUP_CONCURRENCY = '3';
    const a = await fresh([{cnpj: doc(12), name: 'Compartilhada'}]), b = await fresh([{cnpj: doc(12), name: 'Compartilhada'}]);
    const shared = (async () => { await sleep(500); return Response.json({cnpj: doc(12), opcao_pelo_simples: true}); }) as typeof fetch;
    const concurrent = await Promise.all([processLookup(actor, a, shared), processLookup(actor, b, shared)]);
    assert(concurrent.every(j => j.status === 'COMPLETED'));
    assert.equal(await (await collection('cnpjStates')).countDocuments(scope({cnpj: doc(12)})), 1);
    assert.equal(await (await collection('lookupItems')).countDocuments(scope({cnpj: doc(12), state: 'DONE'})), 2);

    // A failed response belongs to its CNPJ; unrelated work keeps using the available slots.
    const isolated = await fresh([20,21,22].map(n=>({cnpj:doc(n),name:'Falha pontual sintética'})));
    const isolatedCalls:string[]=[];
    const isolatedResult = await processLookup(actor,isolated,(async (url:any)=>{
      const cnpj=String(url).split('/').at(-1)!; isolatedCalls.push(cnpj);
      if(cnpj===doc(20))throw new Error('Rede interrompida sintética');
      if(cnpj===doc(21))return new Response('{',{headers:{'content-type':'application/json'}});
      return Response.json({cnpj,opcao_pelo_simples:true});
    }) as typeof fetch);
    assert.equal(isolatedCalls.length,3); assert.equal(isolatedResult.received,1);
    const isolatedProgress=await lookupProgress(isolated,1,'PENDING',true);
    assert.equal(isolatedProgress.metrics.retrying,2); assert.equal(isolatedProgress.metrics.optants,1);
    assert.equal(isolatedProgress.metrics.nonOptants,0); assert.equal(isolatedProgress.total,2);
    assert(isolatedResult.nextPollMs>3000&&isolatedResult.nextPollMs<=5000,'Retoma na próxima tentativa, sem polling vazio a cada segundo.');
    await (await collection('lookupItems')).updateMany(scope({jobId:isolated,state:'RETRY'}),{$set:{nextAt:new Date(0)}});
    const recovered=await processLookup(actor,isolated,(async (url:any)=>{
      const cnpj=String(url).split('/').at(-1)!;isolatedCalls.push(cnpj);return Response.json({cnpj,opcao_pelo_simples:true});
    }) as typeof fetch);
    assert.equal(recovered.status,'COMPLETED'); assert.equal(isolatedCalls.length,5);
    assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:isolated,attempts:2,state:'DONE'})),2);

    const midBatchLimit=await fresh([60,61,62,63].map(n=>({cnpj:doc(n),name:'Limite com consulta em andamento'})));
    let inFlight=0;const admittedBeforeLimit:string[]=[];
    let secondStarted!:()=>void;const secondInFlight=new Promise<void>(resolve=>{secondStarted=resolve;});
    const limitedTogether=await processLookup(actor,midBatchLimit,(async(url:any)=>{
      const cnpj=String(url).split('/').at(-1)!;admittedBeforeLimit.push(cnpj);inFlight++;
      try{
        if(cnpj===doc(60)){await secondInFlight;return new Response('',{status:429,headers:{'retry-after':'30'}});}
        secondStarted();await sleep(200);return Response.json({cnpj,opcao_pelo_simples:true});
      }finally{inFlight--;}
    }) as typeof fetch);
    assert.equal(admittedBeforeLimit.length,2,'Um worker limitado impede os próximos inícios sem descartar a consulta já em andamento.');
    assert.equal(inFlight,0);assert.equal(limitedTogether.received,1);
    const limitedTogetherProgress=await lookupProgress(midBatchLimit);
    assert.equal(limitedTogetherProgress.metrics.retrying,1);assert.equal(limitedTogetherProgress.metrics.pending,2);
    assert(limitedTogether.nextPollMs>28000&&limitedTogether.nextPollMs<=30000);

    const waitingId=await fresh([{cnpj:doc(23),name:'Tentativa futura'}]);
    await(await collection('lookupItems')).updateOne(scope({jobId:waitingId}),{$set:{state:'RETRY',attempts:1,nextAt:new Date(Date.now()+30000)}});
    const waitingResult=await processLookup(actor,waitingId,(async()=>{throw new Error('Não deveria consultar a fonte');}) as typeof fetch);
    assert(waitingResult.nextPollMs>28000&&waitingResult.nextPollMs<=30000);
    assert.equal(await(await collection('providerControl')).countDocuments({}),0,'Fila futura não cria nem disputa slots.');

    // Independent jobs share both the global spacing and the same concurrency slots.
    const parallelA=await fresh([30,31,32,33].map(n=>({cnpj:doc(n),name:'Lote paralelo A'})));
    const parallelB=await fresh([40,41,42,43].map(n=>({cnpj:doc(n),name:'Lote paralelo B'})));
    let parallelActive=0,parallelPeak=0;const parallelStarts:number[]=[];
    const parallelTransport=(async(url:any)=>{
      parallelStarts.push(Date.now());parallelActive++;parallelPeak=Math.max(parallelPeak,parallelActive);
      try{await sleep(800);return Response.json({cnpj:String(url).split('/').at(-1),opcao_pelo_simples:true});}
      finally{parallelActive--;}
    }) as typeof fetch;
    const parallelResults=await Promise.all([processLookup(actor,parallelA,parallelTransport),processLookup(actor,parallelB,parallelTransport)]);
    assert(parallelResults.every(job=>job.status==='COMPLETED'));assert.equal(parallelStarts.length,8);
    assert(parallelPeak>=2&&parallelPeak<=3,`Concorrência global entre lotes: ${parallelPeak}`);
    parallelStarts.sort((a,b)=>a-b);
    for(let index=1;index<parallelStarts.length;index++)assert(parallelStarts[index]-parallelStarts[index-1]>=250,'Lotes distintos também respeitam o intervalo global.');

    // Parallel persistence must settle before the lease is released, even on failure.
    const drainingId=await fresh([{cnpj:doc(50),name:'Persistência interrompida'}]);
    const stateCollection=await collection('cnpjStates'),prototype=Object.getPrototypeOf(stateCollection),originalUpdate=prototype.updateOne;
    let entityStarted!:()=>void,releaseEntity!:()=>void,settled=false,drainingCalls=0;
    const started=new Promise<void>(resolve=>{entityStarted=resolve;}),entityReady=new Promise<void>(resolve=>{releaseEntity=resolve;});
    const identity=`performance_test:${doc(50)}`;
    const patched=t.mock.method(prototype,'updateOne',async function(this:any,...args:any[]){
      const[filter,update]=args;
      if(this.collectionName==='cnpjStates'&&String(filter._id).startsWith(identity+':')){await started;throw new Error('Falha sintética ao salvar estado');}
      if(this.collectionName==='cnpjEntities'&&filter._id===identity&&update.$setOnInsert){entityStarted();await entityReady;}
      return originalUpdate.apply(this,args);
    });
    const drainingTransport=(async()=>{drainingCalls++;return Response.json({cnpj:doc(50),opcao_pelo_simples:true});}) as typeof fetch;
    const drainingResult=processLookup(actor,drainingId,drainingTransport).then(()=>null,error=>error).finally(()=>{settled=true;});
    try{
      await started;await sleep(30);assert.equal(settled,false);
      const held=await(await collection('lookupJobs')).findOne(scope({_id:drainingId}));assert(held?.leaseOwner);
      await assert.rejects(processLookup(actor,drainingId,drainingTransport),(error:any)=>error.code==='JOB_BUSY');
      assert.equal(await(await collection('lookupItems')).countDocuments(scope({jobId:drainingId,state:'DONE'})),0);
      releaseEntity();assert.match((await drainingResult).message,/Falha sintética ao salvar estado/);
    }finally{releaseEntity();await drainingResult;patched.mock.restore();}
    assert.equal((await(await collection('lookupJobs')).findOne(scope({_id:drainingId})))?.leaseOwner,undefined);
    assert.equal((await(await collection('cnpjEntities')).findOne(scope({_id:identity})))?.stateId,undefined,'Falha ao salvar o estado não deixa referência pendente na entidade.');
    assert.equal((await processLookup(actor,drainingId,drainingTransport)).status,'COMPLETED');
    assert.equal(drainingCalls,2,'Retomada após falha de persistência consulta a fonte novamente.');
  } finally {
    const disposable = await database();
    assert.equal(disposable.databaseName, testDatabase, 'A limpeza só pode atuar no banco descartável deste teste.');
    await disposable.dropDatabase(); await closeDatabase(); resetLookupIndexes();
    for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  }
});
