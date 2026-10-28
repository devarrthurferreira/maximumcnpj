import {test as base,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {MongoClient,type Db} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {drePdfFixture} from '../fixtures/dre-pdf.mjs';

type PdfWorkspace={db:Db;workspaceId:string;snapshot:any;accountId:string;pdfUrl:string;requests:any[]};

async function pythonServer(origin:string){
  const code=[
    'from http.server import ThreadingHTTPServer',
    'from api.reports import handler',
    "server=ThreadingHTTPServer(('127.0.0.1',0),handler)",
    "print('DRE_PDF_READY:'+str(server.server_port),flush=True)",
    'server.serve_forever()'
  ].join('\n');
  const child=spawn('python',['-u','-c',code],{cwd:process.cwd(),env:{...process.env,APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  try{
    const port=await new Promise<number>((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('O servidor Python de teste não iniciou. '+stderr)),15000);
      child.stdout!.on('data',chunk=>{output+=chunk;const match=output.match(/DRE_PDF_READY:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('O servidor Python terminou antes de iniciar: '+code+' '+stderr));});
    });
    return {child,url:`http://127.0.0.1:${port}/api/reports`};
  }catch(error){child.kill();throw error;}
}

async function stop(child:ChildProcess){
  if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
}

const test=base.extend<{pdfWorkspace:PdfWorkspace}>({
  pdfWorkspace:async({page,baseURL},use)=>{
    expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
    const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
    const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum';
    const accountId=randomUUID(),email='dre-pdf-'+randomUUID()+'@example.test',password='Synthetic-DRE-'+randomUUID();
    const snapshot={...drePdfFixture({simulationId:randomUUID(),clientId:randomUUID(),generationId:randomUUID()}),workspaceId};
    const server=await pythonServer(new URL(baseURL!).origin),requests:any[]=[];
    try{
      await db.collection<any>('users').insertOne({_id:accountId,workspaceId,email,name:'Leitura sintética PDF',role:'viewer',active:true,mustChangePassword:false,passwordHash:await hashPassword(password),createdAt:new Date()});
      await db.collection<any>('simulations').insertOne(structuredClone(snapshot));
      const login=await page.request.post('/api/auth/login',{headers:{Origin:new URL(baseURL!).origin},data:{email,password}});
      expect(login.ok(),await login.text()).toBe(true);
      // Local Node serves the app; this forwarding executes the actual Vercel Python handler.
      // Session, workspace, saved snapshot, HTTP headers and PDF bytes all remain real.
      await page.route('**/api/reports',async route=>{
        requests.push(route.request().postDataJSON());
        const response=await route.fetch({url:server.url});
        await route.fulfill({response});
      });
      await use({db,workspaceId,snapshot,accountId,pdfUrl:server.url,requests});
    }finally{
      await stop(server.child);
      await db.collection('sessions').deleteMany({workspaceId,userId:accountId});
      await db.collection<any>('users').deleteOne({_id:accountId,workspaceId});
      await db.collection<any>('simulations').deleteOne({_id:snapshot._id,workspaceId});
      await db.collection('limits').deleteMany({_id:{$regex:'^reports:'+workspaceId+':'+accountId+':'}});
      await mongo.close();
    }
  }
});

async function open(page:Page,workspace:PdfWorkspace){
  await page.goto('/simulator.html?simulation='+workspace.snapshot._id);
  await expect(page.locator('#download-dre-pdf')).toBeEnabled();
  await expect(page.locator('#dre-pdf-status')).toHaveAttribute('data-state','ready');
}
async function download(page:Page,path:string){
  const pending=page.waitForEvent('download');
  const responsePending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports'&&response.request().method()==='POST');
  await page.locator('#download-dre-pdf').click();
  const response=await responsePending;
  expect(response.status(),response.ok()?'':await response.text()).toBe(200);
  expect(response.headers()['x-report-engine']).toBe('python');
  const file=await pending;await file.saveAs(path);
  const data=await readFile(path);expect(data.subarray(0,5).toString()).toBe('%PDF-');
  expect(data.length).toBeGreaterThan(2000);expect(data.length).toBeLessThanOrEqual(4_000_000);
  return file;
}
function inspectPdf(path:string){
  const code='import pymupdf,json,sys;d=pymupdf.open(sys.argv[1]);print(json.dumps({"pages":len(d),"text":"\\n".join(p.get_text() for p in d),"images":sum(len(p.get_images()) for p in d),"vectors":sum(len(p.get_drawings()) for p in d)}))';
  return JSON.parse(execFileSync('python',['-c',code,path],{encoding:'utf8',maxBuffer:4_000_000}));
}

test('PDF Python único conserva snapshot, timbrado, comparativos e opções de período para viewer',async({page,pdfWorkspace},info)=>{
  const {db,workspaceId,snapshot,requests}=pdfWorkspace;
  const before=JSON.stringify(await db.collection<any>('simulations').findOne({_id:snapshot._id,workspaceId}));
  const errors:string[]=[],writes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method())&&!request.url().endsWith('/api/reports'))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  await open(page,pdfWorkspace);
  const modes=['complete','annual','monthly'] as const,pageCounts:Record<string,number>={};
  for(const period of modes){
    await page.locator('#dre-report-period').selectOption(period);
    if(period==='monthly'){
      await page.locator('#dre-show-percent').check();
      await page.locator('[data-simulation-detail="dre"] > summary').click();
      await page.locator('#dre-regime').selectOption('actual');
    }
    const path=info.outputPath('dre-python-'+period+'.pdf');
    const file=await download(page,path);
    expect(file.suggestedFilename()).toMatch(new RegExp('^dre-.*'+snapshot._id+'-'+period+'\\.pdf$'));
    const parsed=inspectPdf(path);pageCounts[period]=parsed.pages;
    expect(parsed.text).toContain(snapshot.company.name);expect(parsed.text).toContain('2025');expect(parsed.text).toContain('2027');
    expect(parsed.pages).toBeGreaterThan(1);expect(parsed.images).toBeGreaterThan(0);expect(parsed.vectors).toBeGreaterThan(10);
    if(period==='complete'){
      for(const regime of snapshot.result.regimes){expect(parsed.text).toContain(regime.name);expect(parsed.text).toContain(regime.dre.netProfit.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}));}
      await info.attach('DRE Python completa sintética',{path,contentType:'application/pdf'});
    }
    await expect(page.locator('#dre-pdf-status')).toContainText('PDF baixado:');
    expect(requests.at(-1)).toEqual({action:'dre-pdf',simulationId:snapshot._id,period,...(period==='monthly'?{regimeId:'actual'}:{}),showPercent:period==='monthly'});
    expect(await page.locator('#dre-print-document').count()).toBe(0);
  }
  expect(pageCounts.complete).toBeGreaterThan(pageCounts.annual);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  expect(JSON.stringify(await db.collection<any>('simulations').findOne({_id:snapshot._id,workspaceId}))).toBe(before);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#download-dre-pdf')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('falha de geração permite repetir o download sem criar ou alterar a simulação',async({page,pdfWorkspace},info)=>{
  let failed=false;
  await page.route('**/api/reports',async route=>{
    if(!failed){failed=true;return route.fulfill({status:503,json:{error:'REPORT_UNAVAILABLE',message:'Não foi possível gerar o PDF. Tente novamente.',requestId:'test-retry'}});}
    await route.fallback();
  });
  await open(page,pdfWorkspace);await page.locator('#download-dre-pdf').click();
  await expect(page.locator('#dre-pdf-status')).toHaveAttribute('data-state','error');
  await expect(page.locator('#dre-pdf-status')).toContainText('Tente novamente');
  await expect(page.locator('#download-dre-pdf')).toBeEnabled();
  await download(page,info.outputPath('dre-retry.pdf'));
  expect(pdfWorkspace.requests).toHaveLength(1);
  await expect(page.locator('#dre-pdf-status')).toHaveAttribute('data-state','ready');
  expect(await pdfWorkspace.db.collection('simulations').countDocuments({workspaceId:pdfWorkspace.workspaceId,_id:pdfWorkspace.snapshot._id})).toBe(1);
});

test('trocar as opções cancela um PDF pendente e não baixa uma resposta antiga',async({page,pdfWorkspace},info)=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  let block=true,downloads=0;
  page.on('download',()=>downloads++);
  await page.route('**/api/reports',async route=>{
    if(block){block=false;started();await gate;try{await route.fulfill({status:503,json:{message:'Resposta antiga descartada.'}});}catch{}return;}
    await route.fallback();
  });
  await open(page,pdfWorkspace);await page.locator('#download-dre-pdf').click();await waiting;
  try{
    await expect(page.locator('#download-dre-pdf')).toBeDisabled();
    await expect(page.locator('#download-dre-pdf')).toHaveAttribute('aria-busy','true');
    await page.locator('#dre-report-period').selectOption('annual');
    await expect(page.locator('#download-dre-pdf')).toBeEnabled();
    await expect(page.locator('#download-dre-pdf')).toHaveAttribute('aria-busy','false');
  }finally{release();}
  await download(page,info.outputPath('dre-current-choice.pdf'));
  expect(pdfWorkspace.requests).toHaveLength(1);expect(pdfWorkspace.requests[0].period).toBe('annual');
  expect(downloads).toBe(1);await expect(page.locator('#dre-pdf-status')).not.toHaveAttribute('data-state','error');
});
