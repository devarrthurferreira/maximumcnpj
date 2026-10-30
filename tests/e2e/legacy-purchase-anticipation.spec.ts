import {test as base,expect} from '@playwright/test';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {processLookup} from '../../src/lookup-jobs.ts';
import {closeDatabase} from '../../src/store.ts';
import {hashPassword} from '../../src/security.ts';

// Each real flow authenticates its own disposable account, avoiding shared-login
// rate limits without changing the application's authentication or security policy.
const test=base.extend<{historicalAccount:{email:string;password:string}}>({
  historicalAccount:async({},use)=>{
    expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',userId=randomUUID();
    const account={email:`historical-${userId}@example.test`,password:`Synthetic-history-${randomUUID()}`};
    try{
      await db.collection<any>('users').insertOne({_id:userId,workspaceId,email:account.email,name:'Administrador sintético histórico',role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
      await use(account);
    }finally{
      try{
        await db.collection('sessions').deleteMany({workspaceId,userId});
        await db.collection<any>('users').deleteOne({_id:userId,workspaceId});
      }finally{await mongo.close();}
    }
  }
});

test.afterAll(async()=>closeDatabase());

for(const historicalVersion of [undefined,'ICMS_ANTICIPATION_V2','ICMS_ANTICIPATION_V3'] as const)test(`compras históricas ${historicalVersion||'sem versão'} derivam antecipação sem serviços 8000 no relatório e CSV sem alterar o snapshot`,async({page,baseURL,historicalAccount},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin;
  const post=async(path:string,data:unknown)=>{const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const get=async(path:string)=>{const response=await page.request.get(path);expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/auth/login',historicalAccount);
  const actor=(await get('/api/auth/session')).user;
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const clientId=(await post('/api/v4/clients/import',{rows:[{code,name:'Empresa sintética histórico '+code}]})).items[0].id;
  const jobId=randomUUID();
  const line=(name:string,totalCents:number,extra:Record<string,unknown>={})=>({document:'12345678900',name,natureCode:'1102001',description:'Descrição sintética',recipientUf:'SP',serviceDate:'2025-01-15',quantity:'1',grossCents:totalCents,totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,...extra});
  const inputs=[line('CPF interestadual',100000),line('CNPJ interestadual',200000,{document:'11222333000181'}),line('Serviço CPF 8000',50000,{natureCode:'8000102'}),line('CPF mesma UF',30000,{recipientUf:'MG'}),line('Devolução de venda',10000,{natureCode:'1202'}),line('CPF sem UF',20000,{recipientUf:''})];
  await post('/api/v4/purchases',{importId:jobId,clientId,fileName:'compras-historicas-sinteticas.csv',expectedRows:inputs.length,issuerUf:'MG'});
  if(historicalVersion){
    // Upload using the original contract, including its persisted hashes and summaries.
    const seed=new MongoClient(process.env.MONGODB_URI!);await seed.connect();
    try{await seed.db(process.env.MONGODB_DB).collection<any>('lookupJobs').updateOne({_id:jobId,workspaceId:process.env.WORKSPACE_ID||'maximum'},{$set:{anticipationVersion:historicalVersion}});}finally{await seed.close();}
  }
  await post(`/api/v4/purchases/${jobId}/rows`,{offset:0,rows:inputs});await post(`/api/v4/purchases/${jobId}/finalize`,{});
  let providerCalls=0;
  const transport=(async(url:string|URL|Request)=>{providerCalls++;expect(String(url).split('/').pop()).toBe('11222333000181');return Response.json({cnpj:'11222333000181',razao_social:'CNPJ sintético',opcao_pelo_simples:false,opcao_pelo_mei:false});}) as typeof fetch;
  expect((await processLookup(actor,jobId,transport)).status).toBe('COMPLETED');expect(providerCalls).toBe(1);

  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  try{
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',filter={workspaceId,jobId};
    if(!historicalVersion){
      // Reproduce a completed NET_V2 report from before anticipation snapshots existed.
      // Nature and UF remain the original frozen source fields; no source value is changed.
      await db.collection<any>('lookupJobs').updateOne({_id:jobId,workspaceId},{$unset:{anticipationVersion:'','purchaseInput.anticipation':''}});
      await db.collection('purchaseLines').updateMany(filter,{$unset:{anticipation:''}});
    }
    const frozen=async()=>({job:await db.collection<any>('lookupJobs').findOne({_id:jobId,workspaceId}),rows:await db.collection('purchaseLines').find(filter).sort({index:1}).toArray(),lookups:await db.collection('lookupItems').find(filter).sort({cnpj:1}).toArray()});
    const before=await frozen();
    expect(before.job.anticipationVersion).toBe(historicalVersion);
    if(historicalVersion){expect(before.job.purchaseInput.anticipation.amountCents).toBe(historicalVersion==='ICMS_ANTICIPATION_V2'?10980:25620);expect(before.rows[1].anticipation.reason).toBe(historicalVersion==='ICMS_ANTICIPATION_V2'?'NOT_CPF':'ELIGIBLE');expect(before.rows[2].anticipation.amountCents).toBe(3660);}
    else expect(before.rows.every(row=>!Object.hasOwn(row,'anticipation'))).toBe(true);

    const summary=await get(`/api/v4/purchases/${jobId}/summary`);
    expect(summary.anticipationOrigin).toBe('DERIVED_FROM_SNAPSHOT');
    expect(summary.anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V4',ratePercent:7.32,issuerUf:'MG',baseCents:300000,amountCents:21960,eligibleLines:2,pendingLines:1});
    expect(summary.job.anticipationVersion).toBe(historicalVersion);expect(summary.totals.totalCents).toBe(410000);
    expect(summary.purchaseSelection).toMatchObject({version:'PURCHASE_NATURES_V1',available:true,origin:'DERIVED_FROM_SNAPSHOT',reportLines:6,reportTotalCents:410000,excludedLines:1,excludedTotalCents:10000,totals:{lines:5,totalCents:400000}});
    const details=await get(`/api/v4/purchases/${jobId}/lines?status=ALL&page=1`);
    expect(details.items.map((row:any)=>row.anticipation.reason)).toEqual(['ELIGIBLE','ELIGIBLE','SERVICE_PURCHASE_EXCLUDED','SAME_UF','NOT_PURCHASE','MISSING_RECIPIENT_UF']);

    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let processRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/process'))processRequests++;});
    await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
    const panel=page.locator('#purchase-report-view .purchase-anticipation');
    await expect(panel.getByRole('heading',{name:'DIFAL de entrada — Antecipação de ICMS'})).toBeVisible();
    await expect(panel).toContainText('Calculado a partir dos dados já salvos neste relatório.');
    await expect(panel.locator('[data-anticipation-amount]')).toContainText('219,60');await expect(panel).toContainText('3.000,00');await expect(panel).toContainText('7,32%');await expect(panel).toContainText('1 linha(s) pendente(s)');
    await expect(panel).not.toContainText('Indisponível neste histórico');
    await expect(page.locator('#purchase-report-view [data-purchase-considered-total]')).toContainText('4.000,00');
    await expect(page.locator('#purchase-report-view [data-purchase-original-total]')).toContainText('4.100,00');
    await expect(page.locator('#purchase-report-view [data-purchase-excluded-total]')).toContainText('100,00');
    await page.locator('#purchase-view-filter').selectOption('lines');
    const rows=page.locator('#purchase-result-list tbody tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({hasText:'Devolução de venda'}).locator('[data-purchase-considered-cell]')).toContainText('0,00');
    await expect(rows.filter({hasText:'Devolução de venda'}).locator('[data-purchase-considered-cell]')).toContainText('Excluída das compras');
    await expect(rows.filter({hasText:'Serviço CPF 8000'}).locator('[data-purchase-considered-cell]')).toContainText('500,00');
    await expect(rows.filter({hasText:'CNPJ interestadual'})).toContainText('146,40');await expect(rows.filter({hasText:'CNPJ interestadual'})).toContainText('2.000,00');
    await expect(rows.filter({hasText:'CPF interestadual'})).toContainText('73,20');await expect(rows.filter({hasText:'Serviço CPF 8000'})).toContainText('Serviço de prefixo 8000 excluído da antecipação');await expect(rows.filter({hasText:'Serviço CPF 8000'})).not.toContainText('36,60');await expect(rows.filter({hasText:'CPF sem UF'})).toContainText('Pendente');
    const downloading=page.waitForEvent('download');await page.locator('#purchase-csv').click();const download=await downloading,stream=await download.createReadStream(),parts:Buffer[]=[];
    for await(const part of stream!)parts.push(Buffer.from(part));const workbook=XLSX.read(Buffer.concat(parts).toString('utf8'),{type:'string',raw:true});
    const csvRows=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:''}),headers=csvRows[0],at=(row:string[],header:string)=>row[headers.indexOf(header)];
    const cnpj=csvRows.slice(1).find(row=>at(row,'Documento do fornecedor (A)')==='11222333000181')!;
    expect(at(cnpj,'Total calculado (R$)')).toBe('2000,00');expect(at(cnpj,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('2000,00');expect(at(cnpj,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('146,40');expect(at(cnpj,'Situação DIFAL de entrada — Antecipação de ICMS')).toBe('ELIGIBLE');
    expect(at(cnpj,'Versão DIFAL de entrada — Antecipação de ICMS')).toBe('ICMS_ANTICIPATION_V4');
    expect(at(cnpj,'Origem DIFAL de entrada')).toBe('DERIVED_FROM_SNAPSHOT');
    expect(at(cnpj,'Compras consideradas (R$)')).toBe('2000,00');expect(at(cnpj,'Versão da seleção de compras')).toBe('PURCHASE_NATURES_V1');
    expect(csvRows.slice(1)).toHaveLength(6);
    expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(at(row,'Total calculado (R$)').replace(',','.')),0)).toBe(4100);
    expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(at(row,'Compras consideradas (R$)').replace(',','.')),0)).toBe(4000);
    const returned=csvRows.slice(1).find(row=>at(row,'Razão social informada (I)')==='Devolução de venda')!;
    expect(at(returned,'Total calculado (R$)')).toBe('100,00');expect(at(returned,'Compras consideradas (R$)')).toBe('0,00');expect(at(returned,'Motivo da seleção de compras')).toBe('DEVOLUCAO_VENDA');
    const service=csvRows.slice(1).find(row=>at(row,'Razão social informada (I)')==='Serviço CPF 8000')!;
    expect(at(service,'Compras consideradas (R$)')).toBe('500,00');expect(at(service,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('0,00');expect(at(service,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('0,00');expect(at(service,'Situação DIFAL de entrada — Antecipação de ICMS')).toBe('SERVICE_PURCHASE_EXCLUDED');
    const pending=csvRows.slice(1).find(row=>at(row,'Razão social informada (I)')==='CPF sem UF')!;
    expect(at(pending,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('');expect(at(pending,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('');expect(at(pending,'Situação DIFAL de entrada — Antecipação de ICMS')).toContain('Pendente');
    expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(String(at(row,'DIFAL de entrada — Antecipação de ICMS (R$)')||'0').replace(',','.')),0)).toBeCloseTo(219.6,2);
    await page.reload();await expect(panel.locator('[data-anticipation-amount]')).toContainText('219,60');
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath('antecipacao-historico-mobile.png')});
    expect(await frozen()).toEqual(before);expect(providerCalls).toBe(1);expect(processRequests).toBe(0);expect(errors).toEqual([]);
  }finally{await mongo.close();}
});

test('vendas históricas V3 geram saída atual zero no relatório e CSV sem substituir o snapshot positivo original',async({page,baseURL,historicalAccount},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin;
  const post=async(path:string,data:unknown)=>{const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const get=async(path:string)=>{const response=await page.request.get(path);expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/auth/login',historicalAccount);
  const actor=(await get('/api/auth/session')).user;
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const clientId=(await post('/api/v4/clients/import',{rows:[{code,name:'Empresa sintética vendas históricas '+code}]})).items[0].id;
  const jobId=randomUUID(),cnpj='11222333000181';
  const line=(name:string,totalCents:number,extra:Record<string,unknown>={})=>({document:'12345678900',name,natureCode:'6108001',description:'Descrição sintética',recipientUf:'SP',serviceDate:'2025-01-15',quantity:'1',grossCents:totalCents,totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,...extra});
  const inputs=[line('CPF interestadual',100000),line('CNPJ interestadual',200000,{document:cnpj}),line('Serviço CPF 9000',50000,{natureCode:'9000002'}),line('CNPJ mesma UF',30000,{document:cnpj,recipientUf:'MG'}),line('Remessa',10000,{natureCode:'6949'}),line('CNPJ sem UF',20000,{document:cnpj,recipientUf:''})];
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  try{
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',filter={workspaceId,jobId};
    await post('/api/v4/sales',{importId:jobId,clientId,fileName:'vendas-historicas-sinteticas.csv',expectedRows:inputs.length,issuerUf:'MG'});
    // The old importer stores the CPF-only estimate. The current view must reconcile it first.
    await db.collection<any>('lookupJobs').updateOne({_id:jobId,workspaceId},{$set:{difalVersion:'DIFAL_ESTIMATE_V3'}});
    await post(`/api/v4/sales/${jobId}/rows`,{offset:0,rows:inputs});await post(`/api/v4/sales/${jobId}/finalize`,{});
    let providerCalls=0;
    const transport=(async(url:string|URL|Request)=>{providerCalls++;expect(String(url).split('/').pop()).toBe(cnpj);return Response.json({cnpj,razao_social:'CNPJ sintético',opcao_pelo_simples:false,opcao_pelo_mei:false});}) as typeof fetch;
    expect((await processLookup(actor,jobId,transport)).status).toBe('COMPLETED');expect(providerCalls).toBe(1);
    const frozen=async()=>({job:await db.collection<any>('lookupJobs').findOne({_id:jobId,workspaceId}),rows:await db.collection('purchaseLines').find(filter).sort({index:1}).toArray(),lookups:await db.collection('lookupItems').find(filter).sort({cnpj:1}).toArray()});
    const before=await frozen();expect(before.job.difalVersion).toBe('DIFAL_ESTIMATE_V3');expect(before.job.purchaseInput.difal.amountCents).toBe(10000);expect(before.rows[1].difal.reason).toBe('NOT_CPF');

    const summary=await get(`/api/v4/sales/${jobId}/summary`);
    expect(summary.difalOrigin).toBe('DERIVED_FROM_SNAPSHOT');
    expect(summary.difal).toMatchObject({version:'DIFAL_ESTIMATE_V6',ratePercent:10,issuerUf:'MG',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0});
    expect(summary.job.difalVersion).toBe('DIFAL_ESTIMATE_V3');expect(summary.totals.totalCents).toBe(410000);
    const details=await get(`/api/v4/sales/${jobId}/lines?status=ALL&page=1`);
    expect(details.items.map((row:any)=>row.difal.reason)).toEqual(Array(6).fill('OUTGOING_DISABLED'));
    const grouped=await get(`/api/v4/sales/${jobId}/results?status=ALL&page=1`);
    expect(grouped.items.find((row:any)=>row.document===cnpj).difal).toMatchObject({baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0});

    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let processRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/process'))processRequests++;});
    await page.goto(`/purchases.html?type=SALES&client=${clientId}&job=${jobId}`);
    const panel=page.locator('#purchase-report-view .purchase-difal');
    await expect(panel.getByRole('heading',{name:'DIFAL de saída'})).toBeVisible();
    await expect(panel).toContainText('Não possui DIFAL de saída');
    await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');await expect(panel).not.toContainText('10%');await expect(panel).not.toContainText('pendente(s)');
    await page.locator('#purchase-view-filter').selectOption('lines');
    const rows=page.locator('#purchase-result-list tbody tr');
    for(const name of ['CNPJ interestadual','CPF interestadual','CNPJ sem UF'])await expect(rows.filter({hasText:name}).locator('[data-tax-cell-amount]')).toContainText('0,00');
    const downloading=page.waitForEvent('download');await page.locator('#purchase-csv').click();const download=await downloading,stream=await download.createReadStream(),parts:Buffer[]=[];
    for await(const part of stream!)parts.push(Buffer.from(part));const workbook=XLSX.read(Buffer.concat(parts).toString('utf8'),{type:'string',raw:true});
    const csvRows=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:''}),headers=csvRows[0],at=(row:string[],header:string)=>row[headers.indexOf(header)];
    const legalEntity=csvRows.slice(1).find(row=>at(row,'Comprador (I)')==='CNPJ interestadual')!;
    expect(at(legalEntity,'Base DIFAL (R$)')).toBe('0,00');expect(at(legalEntity,'DIFAL estimado (R$)')).toBe('0,00');expect(at(legalEntity,'Situação DIFAL')).toBe('OUTGOING_DISABLED');expect(at(legalEntity,'Versão DIFAL')).toBe('DIFAL_ESTIMATE_V6');
    expect(at(legalEntity,'Origem DIFAL')).toBe('DERIVED_FROM_SNAPSHOT');
    const pending=csvRows.slice(1).find(row=>at(row,'Comprador (I)')==='CNPJ sem UF')!;
    expect(at(pending,'Base DIFAL (R$)')).toBe('0,00');expect(at(pending,'DIFAL estimado (R$)')).toBe('0,00');expect(at(pending,'Situação DIFAL')).toBe('OUTGOING_DISABLED');
    expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(String(at(row,'DIFAL estimado (R$)')||'0').replace(',','.')),0)).toBe(0);
    await page.reload();await expect(panel.locator('[data-difal-amount]')).toContainText('0,00');
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath('difal-vendas-historico-mobile.png')});
    expect(await frozen()).toEqual(before);expect(providerCalls).toBe(1);expect(processRequests).toBe(0);expect(errors).toEqual([]);
  }finally{await mongo.close();}
});
