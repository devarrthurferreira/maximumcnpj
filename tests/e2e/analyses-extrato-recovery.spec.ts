import {test,expect,type Page,type Route} from '@playwright/test';
import {defaultFiscalData} from '../../src/analysis-contract.ts';
import {statementHistory} from './extrato-helper.ts';

const clientId='19844444-4444-4444-8444-444444444441';
const analysisId='19844444-4444-4444-8444-444444444442';
const documentId='19844444-4444-4444-8444-444444444443';
const attemptId='19844444-4444-4444-8444-444444444444';
const extractionId='19844444-4444-4444-8444-444444444445';
const requestId='19844444-4444-4444-8444-444444444446';
const company={_id:clientId,code:'RECOVERY-1',name:'Empresa sintética da leitura RBT12',cnpj:'12345678000190',active:true,uf:'MG'};
const selection={version:'REGIME_SELECTION_V1' as const,selected:['pure' as const]};
const urls={documentId,attemptId,originalPutUrl:'https://vercel.com/api/blob/?pathname=synthetic-recovery-original',
  originalGetUrl:'https://synthetic.private.blob.vercel-storage.com/original.pdf?synthetic=1',
  searchablePutUrl:'https://vercel.com/api/blob/?pathname=synthetic-recovery-searchable'};
const reference=()=>({extractionId,documentId,clientId,fileName:'extrato-sintetico.pdf',originalStored:true,searchableStored:true,...statementHistory()});
const ready=()=>({documentId,clientId,status:'READY',attemptId,attempts:1,extractionId,hasReadyExtraction:true,originalStored:true,retryable:true,error:null});
const awaiting=()=>({documentId,clientId,status:'AWAITING_UPLOAD',attemptId:null,attempts:0,extractionId:null,hasReadyExtraction:false,originalStored:false,retryable:true,error:null});
const platformFailure=(route:Route,status=500)=>route.fulfill({status,contentType:'text/plain',headers:{'X-Request-Id':requestId},
  body:'FUNCTION_INVOCATION_FAILED\nSynthetic platform diagnostic https://private.invalid/?signature=hidden'});
function record(){
  return {id:analysisId,clientId,version:'ANALYSIS_SECTORS_V1',periodPolicy:'JAN_SEP_V1',revision:2,
    company:{code:company.code,name:company.name,cnpj:company.cnpj},config:{revision:1,year:2027,regimeSelection:selection},
    fiscal:{revision:1,status:'DRAFT',data:defaultFiscalData(selection)},accounting:{revision:1,status:'DRAFT',data:{months:[]}},
    readiness:{ready:false,verification:'SAVED',months:[],issues:[
      {code:'ANALYSIS_FISCAL_INCOMPLETE',sector:'fiscal',message:'Adicione os relatórios.'},
      {code:'ACCOUNTING_VALUES_MISSING',sector:'accounting',message:'Informe as despesas.'}
    ]},currentSimulation:null};
}
type Counts={tickets:number;uploads:number;posts:Record<string,unknown>[];statuses:number;reads:number;patches:number};
type Behavior={process?:(route:Route,counts:Counts)=>Promise<void>;status?:(route:Route,counts:Counts)=>Promise<void>;read?:(route:Route,counts:Counts)=>Promise<void>};
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}

/** Synthetic browser transport only. Storage, OCR and the real Fiscal PATCH
 * are independently covered by analyses-extrato.spec.ts and Python tests. */
async function setup(page:Page,behavior:Behavior={}){
  const saved=record(),counts:Counts={tickets:0,uploads:0,posts:[],statuses:0,reads:0,patches:0},errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota sintética não configurada.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',name:'Fiscal sintético',role:'operator'}}}));
  await page.route('**/api/v4/clients',route=>route.fulfill({json:{items:[company]}}));
  await page.route(`**/api/v4/analyses/${analysisId}?*`,route=>route.fulfill({json:{analysis:saved,source:null}}));
  await page.route(`**/api/v4/analyses/${analysisId}/fiscal?*`,async route=>{
    expect(route.request().method()).toBe('PATCH');const body=route.request().postDataJSON();
    expect(body.expectedSectorRevision).toBe(saved.fiscal.revision);expect(body.expectedConfigRevision).toBe(saved.config.revision);
    counts.patches++;saved.revision++;saved.fiscal={...saved.fiscal,revision:saved.fiscal.revision+1,data:body.data};
    await route.fulfill({json:{analysis:saved}});
  });
  await page.route('**/api/v4/simples-documents',async route=>{
    counts.tickets++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON().clientId).toBe(clientId);
    await route.fulfill({json:urls});
  });
  await page.route(urls.originalPutUrl,async route=>{counts.uploads++;expect(route.request().method()).toBe('PUT');await route.fulfill({status:200,body:''});});
  await page.route(`**/api/v4/simples-documents/${documentId}/status`,async route=>{
    counts.statuses++;if(behavior.status)return behavior.status(route,counts);await route.fulfill({json:ready()});
  });
  await page.route('**/api/simples?*',async route=>{
    const request=route.request(),url=new URL(request.url());expect(url.searchParams.get('clientId')).toBe(clientId);
    if(request.method()==='POST'){
      counts.posts.push(request.postDataJSON());
      expect(saved.fiscal.data).toMatchObject({rbt12DocumentId:documentId,rbt12ExtractionId:null,rbt12:null});
      if(behavior.process)return behavior.process(route,counts);
    }else{
      expect(request.method()).toBe('GET');expect(url.searchParams.get('extractionId')).toBe(extractionId);counts.reads++;
      if(behavior.read)return behavior.read(route,counts);
    }
    await route.fulfill({json:reference()});
  });
  return {saved,counts,errors};
}
async function upload(page:Page){
  await page.goto(`/analyses.html?id=${analysisId}&sector=fiscal&step=documents`);
  await expect(page.locator('#analysis-inline-rbt12-pdf')).toBeEnabled();
  await page.locator('#analysis-inline-rbt12-pdf').setInputFiles({name:'extrato-sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
}
async function confirmed(page:Page){
  await expect(page.locator('#analysis-inline-pdf-status')).toContainText('Leitura confirmada e salva');
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#analysis-inline-rbt12-view')).toContainText('extrato-sintetico.pdf');
  await expect(page.locator('#analysis-error')).toBeHidden();
}
async function options(page:Page){
  await page.locator('#analysis-inline-rbt12-view [data-analysis-action="reference"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','rbt12');
}

test('Fiscal mantém a leitura ativa após 55 s e salva somente a resposta confirmada',async({page})=>{
  await page.clock.install();const hold=gate();
  const {saved,counts,errors}=await setup(page,{process:async route=>{await hold.promise;await route.fulfill({json:reference()});}});
  try{
    await upload(page);await expect.poll(()=>counts.posts.length).toBe(1);
    await page.clock.fastForward(56_000);
    await expect(page.locator('#analysis-fiscal-form')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#analysis-busy-screen')).toBeVisible();
    await expect(page.locator('#analysis-inline-pdf-status')).toContainText('Lendo a seção 2.2');
    await expect(page.locator('#analysis-wizard-close')).toBeDisabled();
    expect(counts.statuses).toBe(0);expect(saved.fiscal.data.rbt12ExtractionId).toBeNull();
    hold.release();await confirmed(page);
    expect(saved.fiscal.data).toMatchObject({rbt12Source:'SIMPLES_SECTION_22',rbt12DocumentId:documentId,rbt12ExtractionId:extractionId,rbt12:150000});
    expect(counts).toMatchObject({tickets:1,uploads:1,statuses:0,reads:0,patches:2});expect(counts.posts).toHaveLength(1);expect(errors).toEqual([]);
  }finally{hold.release();}
});

test('Fiscal recupera resposta perdida e repete o GET transitório sem iniciar outro OCR',async({page})=>{
  const {saved,counts,errors}=await setup(page,{process:route=>platformFailure(route),
    read:(route,counts)=>counts.reads===1?platformFailure(route):route.fulfill({json:reference()})});
  await upload(page);await confirmed(page);
  expect(saved.fiscal.data).toMatchObject({rbt12DocumentId:documentId,rbt12ExtractionId:extractionId,rbt12:150000});
  expect(counts).toMatchObject({tickets:1,uploads:1,statuses:1,reads:2,patches:2});expect(counts.posts).toHaveLength(1);
  await options(page);await expect(page.locator('.analysis-reference > strong')).toHaveText('R$ 150.000,00');
  await page.locator('#analysis-extrato-manual').click();
  await expect(page.locator('#analysis-rbt12')).toHaveValue('');await expect(page.locator('#analysis-rbt12-confirm')).not.toBeChecked();
  await page.locator('#analysis-rbt12').fill('180000.25');
  await expect(page.locator('.analysis-reference')).toHaveCount(0);expect(counts.posts).toHaveLength(1);expect(counts.reads).toBe(2);expect(errors).toEqual([]);
});

test('Fiscal retoma uma única invocação não iniciada usando o mesmo documento e tentativa',async({page})=>{
  const {counts,errors}=await setup(page,{process:(route,counts)=>counts.posts.length===1?platformFailure(route,502):route.fulfill({json:reference()}),
    status:route=>route.fulfill({json:awaiting()})});
  await upload(page);await confirmed(page);
  expect(counts).toMatchObject({tickets:1,uploads:1,statuses:1,reads:0,patches:2});expect(counts.posts).toHaveLength(2);
  expect(counts.posts[1]).toEqual(counts.posts[0]);expect(counts.posts[0]).toEqual({documentId,attemptId,
    originalGetUrl:urls.originalGetUrl,searchablePutUrl:urls.searchablePutUrl});expect(errors).toEqual([]);
});

test('Fiscal mantém processamento pendente e mostra o motivo salvo ao verificar a leitura',async({page})=>{
  let failed=false;
  const {saved,counts,errors}=await setup(page,{process:route=>platformFailure(route),status:route=>route.fulfill({json:failed?
    {...ready(),status:'OCR_FAILED',error:{code:'SIMPLES_PDF',message:'A seção 2.2 está ilegível nesta página.',requestId}}:
    {...ready(),status:'PROCESSING',extractionId:null,hasReadyExtraction:false,retryable:false}})});
  await upload(page);
  await expect(page.locator('#analysis-inline-pdf-status')).toContainText('ainda está em andamento');
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  await options(page);await expect(page.locator('#analysis-extrato-retry')).toBeDisabled();
  failed=true;await page.locator('#analysis-extrato-status').click();
  await expect(page.locator('#analysis-pdf-status')).toContainText('A seção 2.2 está ilegível nesta página.');
  await expect(page.locator('#analysis-pdf-status')).toContainText(requestId);
  await expect(page.locator('#analysis-pdf-status')).toContainText('A leitura anterior foi preservada e não foi aplicada');
  await expect(page.locator('#analysis-extrato-retry')).toBeEnabled();
  await expect(page.locator('.analysis-reference')).toHaveCount(0);
  expect(saved.fiscal.data.rbt12ExtractionId).toBeNull();expect(saved.fiscal.data.rbt12).toBeNull();
  expect(counts).toMatchObject({tickets:1,uploads:1,statuses:2,reads:0,patches:1});expect(counts.posts).toHaveLength(1);expect(errors).toEqual([]);
});

test('Fiscal conserva a orientação de RBT12 quando a leitura e a consulta de estado falham',async({page})=>{
  const {saved,counts,errors}=await setup(page,{process:route=>platformFailure(route),status:route=>platformFailure(route,502)});
  await upload(page);
  await expect(page.locator('#analysis-inline-pdf-status')).toContainText('Também não foi possível conferir o estado do PDF');
  await expect(page.locator('#analysis-inline-pdf-status')).toContainText(requestId);
  await expect(page.locator('#analysis-error')).toContainText('serviço de leitura do RBT12');
  await expect(page.locator('#analysis-error')).not.toContainText('Não foi possível concluir esta operação');
  await expect(page.locator('#analysis-error')).not.toContainText('private.invalid');
  await expect(page.locator('#analyses-app')).toHaveAttribute('aria-busy','false');
  expect(saved.fiscal.data.rbt12ExtractionId).toBeNull();expect(saved.fiscal.data.rbt12DocumentId).toBe(documentId);
  expect(counts).toMatchObject({tickets:1,uploads:1,statuses:1,reads:0,patches:1});expect(counts.posts).toHaveLength(1);expect(errors).toEqual([]);
});
