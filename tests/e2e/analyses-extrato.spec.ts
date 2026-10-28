import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createHash,randomInt,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {digits} from '../../src/domain.ts';
import {hashPassword} from '../../src/security.ts';
import {statementHistory} from './extrato-helper.ts';

async function post(request:APIRequestContext,baseURL:string,path:string,data:unknown){
  const response=await request.post(path,{data,headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
}
async function get(request:APIRequestContext,path:string){
  const response=await request.get(path);expect(response.ok(),`${path}: ${await response.text()}`).toBe(true);return response.json();
}
async function fiscalStep(page:Page,step:'regimes'|'difal'|'rbt12'|'documents'){
  const wizard=page.locator('#analysis-wizard'),opener=page.locator('[data-analysis-sector="fiscal"]').first();
  await expect(opener).toBeAttached();
  if(await wizard.isVisible()){
    const current=await wizard.getAttribute('data-wizard-kind');
    if(current==='accounting')await wizard.locator('[data-analysis-sector="fiscal"]').click();
    else if(current!=='fiscal'){
      await page.locator('#analysis-wizard-close').click();await expect(wizard).not.toBeVisible();await opener.click();
    }
  }else{
    await opener.click();
  }
  await expect(wizard).toBeVisible();await expect(wizard).toHaveAttribute('data-wizard-kind','fiscal');
  const steps=['regimes','difal','rbt12','documents'];
  for(let attempt=0;attempt<steps.length;attempt++){
    const current=await wizard.getAttribute('data-wizard-step');expect(steps).toContain(current);
    if(current===step)return;
    await page.locator(steps.indexOf(current!)>steps.indexOf(step)?'#analysis-wizard-back':'#analysis-wizard-next').click();
    await expect(wizard).not.toHaveAttribute('data-wizard-step',current!);
  }
  await expect(wizard).toHaveAttribute('data-wizard-step',step);
}
async function completeFiscal(page:Page,id:string){
  await fiscalStep(page,'documents');
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/fiscal`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value="complete"]').click();
  const response=await saved;expect(response.ok(),await response.text()).toBe(true);
  const {analysis}=await response.json();await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  expect(analysis.fiscal.status).toBe('COMPLETE');expect(analysis.readiness.issues.filter((issue:any)=>issue.sector==='fiscal')).toEqual([]);
  await expect(page.locator('#analysis-wizard')).not.toBeVisible();
  return analysis;
}

test('Extrato da análise é salvo, retomado em nova sessão e desvinculado ao confirmar RBT12 manual',async({page,browser,baseURL})=>{
  test.setTimeout(90_000);page.setDefaultTimeout(15_000);
  expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
  const account={id:randomUUID(),email:`analysis-extrato-${randomUUID()}@example.test`,password:`Synthetic-extrato-${randomUUID()}`};
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let fresh:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  let releaseRead:()=>void=()=>{};
  try{
    await db.collection<any>('users').insertOne({_id:account.id,workspaceId,email:account.email,name:'Fiscal sintético do extrato',
      role:'admin',active:true,mustChangePassword:false,passwordHash:await hashPassword(account.password),createdAt:new Date()});
    const signIn=async(request:APIRequestContext)=>{
      await post(request,baseURL!,'/api/auth/login',{email:account.email,password:account.password});
      expect((await get(request,'/api/auth/session')).user.role).toBe('admin');
    };
    await signIn(page.request);
    const code=String(Number.parseInt(randomUUID().replaceAll('-','').slice(0,11),16));
    const cnpjBase=String(randomInt(10_000_000,100_000_000))+'0001',cnpj=cnpjBase+digits(cnpjBase);
    const catalog=await post(page.request,baseURL!,'/api/v4/clients/import',{
      rows:[{code,name:`Empresa sintética extrato ${code}`,cnpj,uf:'MG'}]
    });
    expect(catalog.success).toBe(1);const clientId=catalog.items[0].id;
    const opened=await post(page.request,baseURL!,'/api/v4/analyses',{
      clientId,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}
    });
    const id=opened.analysis.id;expect(opened.analysis.company.cnpj).toBe(cnpj);
    const prepared=await post(page.request,baseURL!,`/api/v4/analyses/${id}/fiscal/import`,{
      expectedSectorRevision:opened.analysis.fiscal.revision,expectedConfigRevision:opened.analysis.config.revision
    });
    // Real Node ingestion derives January–September 2025. statementHistory contains
    // each preceding twelve-month RBT12 window; the PDF keeps its own August 2026 PA.
    for(const [kind,totalCents] of [['purchases',450_000],['sales',1_200_000]] as const){
      const attached=await post(page.request,baseURL!,`/api/v4/generations/${prepared.generationId}/${kind}`,{
        clientId,importId:randomUUID(),fileName:`${code}-${kind}.csv`,expectedRows:9,issuerUf:'MG'
      });
      await post(page.request,baseURL!,`/api/v4/${kind}/${attached.job._id}/rows`,{offset:0,rows:Array.from({length:9},(_,index)=>({
        document:'12345678900',name:'Pessoa sintética',serviceDate:'2025-0'+(index+1)+'-15',quantity:'1',
        natureCode:kind==='sales'?'5102001':'1102001',description:'Operação sintética',recipientUf:'MG',
        grossCents:index===7?totalCents:0,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0,totalCents:index===7?totalCents:0
      }))});
      const completed=await post(page.request,baseURL!,`/api/v4/${kind}/${attached.job._id}/finalize`,{});
      expect(completed.status).toBe('COMPLETED');expect(completed.summary.unique).toBe(0);
    }

    const documentId=randomUUID(),extractionId=randomUUID(),attemptId=randomUUID(),totalCents=15_000_001;
    const fileName='extrato-sintetico.pdf',pdf=Buffer.from('%PDF-synthetic-analysis-transport-only');
    const fileSha256=createHash('sha256').update(pdf).digest('hex');
    const result={...statementHistory(totalCents),cnpjBasico:cnpj.slice(0,8)};
    const originalPath=`simples/${workspaceId}/${clientId}/${documentId}/original.pdf`;
    const searchablePath=originalPath.replace('/original.pdf',`/attempts/${attemptId}.pdf`);
    const originalPutUrl=`https://vercel.com/api/blob/?pathname=${encodeURIComponent(originalPath)}&vercel-blob-delegation=test&vercel-blob-signature=test`;
    const originalGetUrl=`https://store-fixture.private.blob.vercel-storage.com/${originalPath}?vercel-blob-signature=test`;
    const searchablePutUrl=`https://vercel.com/api/blob/?pathname=${encodeURIComponent(searchablePath)}&vercel-blob-delegation=test&vercel-blob-signature=test`;
    const counts={tickets:0,uploads:0,reads:0,loads:0};
    const readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
    const documentFilter={_id:documentId,workspaceId,clientId},extractionFilter={_id:extractionId,workspaceId,clientId};

    // Same transport boundary as extrato-helper: synthetic Blob signing/PUT and
    // Python responses only. Auth, reports, analysis PATCH/GET and confirmation
    // reach the running Node app. Matching Mongo records let the server validate
    // the document, extraction, hash, CNPJ and rolling window independently.
    async function mockPdfTransport(target:Page){
      await target.route('**/api/v4/simples-documents',async route=>{
        const request=route.request();if(request.method()!=='POST')return route.continue();
        counts.tickets++;expect(counts.tickets).toBe(1);
        expect(request.postDataJSON()).toEqual({clientId,fileName,sizeBytes:pdf.length});
        await db.collection<any>('simplesDocuments').insertOne({...documentFilter,fileName,sizeBytes:pdf.length,originalPath,searchablePath,
          originalBlobHost:new URL(originalGetUrl).hostname,status:'AWAITING_UPLOAD',attempts:0,createdAt:new Date(),createdBy:account.id});
        await route.fulfill({json:{documentId,attemptId,clientId,fileName,sizeBytes:pdf.length,status:'AWAITING_UPLOAD',originalPutUrl,originalGetUrl,searchablePutUrl}});
      });
      await target.route('https://vercel.com/api/blob/**',async route=>{
        counts.uploads++;expect(route.request().method()).toBe('PUT');expect(route.request().url()).toBe(originalPutUrl);
        expect(route.request().headers()['content-type']).toBe('application/pdf');expect(route.request().postDataBuffer()).toEqual(pdf);
        await db.collection<any>('simplesDocuments').updateOne(documentFilter,{$set:{originalStored:true,fileSha256}});
        await route.fulfill({status:200,body:''});
      });
      await target.route('**/api/simples?*',async route=>{
        const request=route.request(),url=new URL(request.url());expect(url.searchParams.get('clientId')).toBe(clientId);
        if(request.method()==='POST'){
          counts.reads++;expect(counts.reads).toBe(1);
          expect(request.postDataJSON()).toEqual({documentId,attemptId,originalGetUrl,searchablePutUrl});
          // The original is already bound by a real Fiscal PATCH before OCR starts.
          const pending=await db.collection<any>('analyses').findOne({_id:id,workspaceId,clientId});
          expect(pending?.fiscal).toMatchObject({status:'DRAFT',data:{rbt12Source:'SIMPLES_SECTION_22',
            rbt12DocumentId:documentId,rbt12ExtractionId:null,rbt12:null,rbt12ManualConfirmed:false}});
          expect(await db.collection<any>('simplesDocuments').findOne(documentFilter)).toMatchObject({originalStored:true,fileSha256});
          await readGate;
          await db.collection<any>('simplesExtractions').insertOne({...extractionFilter,documentId,attemptId,originalPath,searchablePath,
            parserVersion:'SIMPLES_SECTION_22_V2',fileName,fileSha256,result,createdBy:account.id,createdAt:new Date()});
          await db.collection<any>('simplesDocuments').updateOne(documentFilter,{$set:{status:'READY',attempts:1,
            extractionId,searchableStored:true,processingAttemptId:attemptId,updatedAt:new Date()}});
          return route.fulfill({json:{extractionId,documentId,clientId,fileName,originalStored:true,searchableStored:true,...result}});
        }
        expect(request.method()).toBe('GET');counts.loads++;
        expect(url.searchParams.get('extractionId')).toBe(extractionId);
        const stored=await db.collection<any>('simplesExtractions').findOne(extractionFilter);expect(stored).toBeTruthy();
        await route.fulfill({json:{extractionId:stored!._id,documentId:stored!.documentId,clientId:stored!.clientId,fileName:stored!.fileName,...stored!.result}});
      });
    }

    await mockPdfTransport(page);await page.goto(`/analyses.html?id=${id}&sector=fiscal`);await fiscalStep(page,'rbt12');
    await expect(page.locator('#analysis-rbt12-pdf')).toBeEnabled();
    const referenceSaved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/fiscal`&&
      response.request().method()==='PATCH'&&response.request().postDataJSON().data.rbt12ExtractionId===extractionId);
    await page.locator('#analysis-rbt12-pdf').setInputFiles({name:fileName,mimeType:'application/pdf',buffer:pdf});
    await expect.poll(()=>counts.reads).toBe(1);
    await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#analysis-wizard-close')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#analysis-wizard')).toBeVisible();
    await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','rbt12');
    releaseRead();
    const saved=await referenceSaved;expect(saved.ok(),await saved.text()).toBe(true);
    await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('#analysis-pdf-status')).toContainText('Leitura confirmada');
    await expect(page.locator('.analysis-reference')).toContainText('PA 08/2026');
    await expect(page.locator('.analysis-reference > strong')).toHaveText('R$ 150.000,01');
    const linked=(await get(page.request,`/api/v4/analyses/${id}`)).analysis;
    expect(linked.fiscal).toMatchObject({status:'DRAFT',data:{rbt12Source:'SIMPLES_SECTION_22',rbt12:150000.01,
      rbt12DocumentId:documentId,rbt12ExtractionId:extractionId,rbt12ManualConfirmed:false}});
    expect(linked.readiness.months).toEqual([]); // No accounting month has been filled yet.
    expect(linked.readiness.analysisPeriod.includedMonths).toEqual(Array.from({length:9},(_,index)=>'2025-0'+(index+1)));
    const confirmed=await completeFiscal(page,id);
    const storedDocument=await db.collection<any>('simplesDocuments').findOne(documentFilter);
    const storedExtraction=await db.collection<any>('simplesExtractions').findOne(extractionFilter);
    // The status endpoint is real too; only Blob transport and Python are mocked.
    expect(await get(page.request,`/api/v4/simples-documents/${documentId}/status`)).toMatchObject({
      documentId,clientId,status:'READY',extractionId,originalStored:true,hasReadyExtraction:true
    });

    fresh=await browser.newContext({baseURL});expect(await fresh.cookies()).toEqual([]);await signIn(fresh.request);
    const resumed=await fresh.newPage();resumed.on('pageerror',error=>errors.push(error.message));await mockPdfTransport(resumed);
    await resumed.goto(`/analyses.html?id=${id}&sector=fiscal`);await fiscalStep(resumed,'rbt12');
    await expect(resumed.locator('.analysis-reference > strong')).toHaveText('R$ 150.000,01');
    await expect(resumed.getByRole('link',{name:'Ver original',exact:true})).toHaveAttribute('href',`/api/v4/simples-documents/${documentId}/file?kind=original`);
    await expect(resumed.getByRole('link',{name:'Ver PDF pesquisável',exact:true})).toHaveAttribute('href',`/api/v4/simples-documents/${documentId}/file?kind=searchable`);
    expect((await get(resumed.request,`/api/v4/analyses/${id}`)).analysis.fiscal).toEqual(confirmed.fiscal);
    expect(counts).toEqual({tickets:1,uploads:1,reads:1,loads:1});

    await resumed.locator('#analysis-extrato-manual').click();
    await expect(resumed.locator('#analysis-rbt12')).toHaveValue('');await expect(resumed.locator('#analysis-rbt12-confirm')).not.toBeChecked();
    await expect(resumed.locator('.analysis-reference,#analysis-rbt12-pdf')).toHaveCount(0);
    await resumed.locator('#analysis-rbt12').fill('180000.25');await resumed.locator('#analysis-rbt12-confirm').check();
    const manual=await completeFiscal(resumed,id);
    expect(manual.fiscal.data).toMatchObject({rbt12Source:'MANUAL',rbt12:180000.25,rbt12ManualConfirmed:true,
      rbt12DocumentId:null,rbt12ExtractionId:null,generationId:prepared.generationId});
    expect((await get(resumed.request,`/api/v4/analyses/${id}`)).analysis.fiscal).toEqual(manual.fiscal);
    expect(await db.collection<any>('simplesDocuments').findOne(documentFilter)).toEqual(storedDocument);
    expect(await db.collection<any>('simplesExtractions').findOne(extractionFilter)).toEqual(storedExtraction);
    await resumed.reload();await fiscalStep(resumed,'rbt12');await expect(resumed.locator('#analysis-rbt12')).toHaveValue('180000.25');
    await expect(resumed.locator('#analysis-rbt12-confirm')).toBeChecked();
    await expect(resumed.locator('.analysis-reference,#analysis-rbt12-pdf')).toHaveCount(0);
    expect(counts).toEqual({tickets:1,uploads:1,reads:1,loads:1});expect(errors).toEqual([]);
  }finally{
    releaseRead();
    await fresh?.close();
    await db.collection('sessions').deleteMany({workspaceId,userId:account.id});
    await db.collection<any>('users').deleteOne({_id:account.id,workspaceId});await mongo.close();
  }
});
