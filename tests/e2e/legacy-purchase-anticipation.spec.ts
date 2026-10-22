import {test,expect} from '@playwright/test';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {processLookup} from '../../src/lookup-jobs.ts';
import {closeDatabase} from '../../src/store.ts';

test.afterAll(async()=>closeDatabase());

test('compras históricas derivam antecipação CPF no relatório e CSV sem alterar o snapshot',async({page,baseURL},info)=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use MongoDB descartável').toBeTruthy();
  const origin=new URL(baseURL!).origin;
  const post=async(path:string,data:unknown)=>{const response=await page.request.post(path,{data,headers:{Origin:origin}});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const get=async(path:string)=>{const response=await page.request.get(path);expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  const actor=(await get('/api/auth/session')).user;
  const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,10),16));
  const clientId=(await post('/api/v4/clients/import',{rows:[{code,name:'Empresa sintética histórico '+code}]})).items[0].id;
  const jobId=randomUUID();
  const line=(name:string,totalCents:number,extra:Record<string,unknown>={})=>({document:'12345678900',name,natureCode:'1102001',description:'Descrição sintética',recipientUf:'SP',serviceDate:'2025-01-15',quantity:'1',grossCents:totalCents,totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,...extra});
  const inputs=[line('CPF interestadual',100000),line('CNPJ interestadual',200000,{document:'11222333000181'}),line('Serviço CPF 8000',50000,{natureCode:'8000102'}),line('CPF mesma UF',30000,{recipientUf:'MG'}),line('Devolução de venda',10000,{natureCode:'1202'}),line('CPF sem UF',20000,{recipientUf:''})];
  await post('/api/v4/purchases',{importId:jobId,clientId,fileName:'compras-historicas-sinteticas.csv',expectedRows:inputs.length,issuerUf:'MG'});
  await post(`/api/v4/purchases/${jobId}/rows`,{offset:0,rows:inputs});await post(`/api/v4/purchases/${jobId}/finalize`,{});
  let providerCalls=0;
  const transport=(async(url:string|URL|Request)=>{providerCalls++;expect(String(url).split('/').pop()).toBe('11222333000181');return Response.json({cnpj:'11222333000181',razao_social:'CNPJ sintético',opcao_pelo_simples:false,opcao_pelo_mei:false});}) as typeof fetch;
  expect((await processLookup(actor,jobId,transport)).status).toBe('COMPLETED');expect(providerCalls).toBe(1);

  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  try{
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',filter={workspaceId,jobId};
    // Reproduce a completed NET_V2 report from before anticipation snapshots existed.
    // Nature and UF remain the original frozen source fields; no source value is changed.
    await db.collection<any>('lookupJobs').updateOne({_id:jobId,workspaceId},{$unset:{anticipationVersion:'','purchaseInput.anticipation':''}});
    await db.collection('purchaseLines').updateMany(filter,{$unset:{anticipation:''}});
    const frozen=async()=>({job:await db.collection<any>('lookupJobs').findOne({_id:jobId,workspaceId}),rows:await db.collection('purchaseLines').find(filter).sort({index:1}).toArray(),lookups:await db.collection('lookupItems').find(filter).sort({cnpj:1}).toArray()});
    const before=await frozen();
    expect(before.job.anticipationVersion).toBeUndefined();expect(before.rows.every(row=>!Object.hasOwn(row,'anticipation'))).toBe(true);

    const summary=await get(`/api/v4/purchases/${jobId}/summary`);
    expect(summary.anticipationOrigin).toBe('DERIVED_FROM_SNAPSHOT');
    expect(summary.anticipation).toMatchObject({version:'ICMS_ANTICIPATION_V2',ratePercent:7.32,issuerUf:'MG',baseCents:150000,amountCents:10980,eligibleLines:2,pendingLines:1});
    expect(summary.job.anticipationVersion).toBeUndefined();expect(summary.totals.totalCents).toBe(410000);
    const details=await get(`/api/v4/purchases/${jobId}/lines?status=ALL&page=1`);
    expect(details.items.map((row:any)=>row.anticipation.reason)).toEqual(['ELIGIBLE','NOT_CPF','ELIGIBLE','SAME_UF','NOT_PURCHASE','MISSING_RECIPIENT_UF']);

    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let processRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/process'))processRequests++;});
    await page.goto(`/purchases.html?client=${clientId}&job=${jobId}`);
    const panel=page.locator('#purchase-report-view .purchase-anticipation');
    await expect(panel.getByRole('heading',{name:'DIFAL de entrada — Antecipação de ICMS'})).toBeVisible();
    await expect(panel).toContainText('Calculado a partir dos dados já salvos neste relatório.');
    await expect(panel.locator('[data-anticipation-amount]')).toContainText('109,80');await expect(panel).toContainText('1.500,00');await expect(panel).toContainText('7,32%');await expect(panel).toContainText('1 linha(s) pendente(s)');
    await expect(panel).not.toContainText('Indisponível neste histórico');await expect(page.locator('#purchase-report-view .purchase-hero')).toContainText('4.100,00');
    await page.locator('#purchase-view-filter').selectOption('lines');
    const rows=page.locator('#purchase-result-list tbody tr');
    await expect(rows.filter({hasText:'CNPJ interestadual'})).toContainText('Fornecedor não identificado por CPF');await expect(rows.filter({hasText:'CNPJ interestadual'})).toContainText('2.000,00');
    await expect(rows.filter({hasText:'CPF interestadual'})).toContainText('73,20');await expect(rows.filter({hasText:'Serviço CPF 8000'})).toContainText('36,60');await expect(rows.filter({hasText:'CPF sem UF'})).toContainText('Pendente');
    const downloading=page.waitForEvent('download');await page.locator('#purchase-csv').click();const download=await downloading,stream=await download.createReadStream(),parts:Buffer[]=[];
    for await(const part of stream!)parts.push(Buffer.from(part));const workbook=XLSX.read(Buffer.concat(parts).toString('utf8'),{type:'string',raw:true});
    const csvRows=XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:''}),headers=csvRows[0],at=(row:string[],header:string)=>row[headers.indexOf(header)];
    const cnpj=csvRows.slice(1).find(row=>at(row,'Documento do fornecedor (A)')==='11222333000181')!;
    expect(at(cnpj,'Total calculado (R$)')).toBe('2000,00');expect(at(cnpj,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('0,00');expect(at(cnpj,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('0,00');expect(at(cnpj,'Situação DIFAL de entrada — Antecipação de ICMS')).toBe('NOT_CPF');
    expect(at(cnpj,'Versão DIFAL de entrada — Antecipação de ICMS')).toBe('ICMS_ANTICIPATION_V2');
    expect(at(cnpj,'Origem DIFAL de entrada')).toBe('DERIVED_FROM_SNAPSHOT');
    const pending=csvRows.slice(1).find(row=>at(row,'Razão social informada (I)')==='CPF sem UF')!;
    expect(at(pending,'Base DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('');expect(at(pending,'DIFAL de entrada — Antecipação de ICMS (R$)')).toBe('');expect(at(pending,'Situação DIFAL de entrada — Antecipação de ICMS')).toContain('Pendente');
    expect(csvRows.slice(1).reduce((sum,row)=>sum+Number(String(at(row,'DIFAL de entrada — Antecipação de ICMS (R$)')||'0').replace(',','.')),0)).toBeCloseTo(109.8,2);
    await page.reload();await expect(panel.locator('[data-anticipation-amount]')).toContainText('109,80');
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath('antecipacao-historico-mobile.png')});
    expect(await frozen()).toEqual(before);expect(providerCalls).toBe(1);expect(processRequests).toBe(0);expect(errors).toEqual([]);
  }finally{await mongo.close();}
});
