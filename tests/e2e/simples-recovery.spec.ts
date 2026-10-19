import {test,expect,type Page} from '@playwright/test';
import {mockStatement,documentId,extractionId,attemptId} from './extrato-helper.ts';
import {section22} from '../fixtures/section22.ts';
import {calculateSimulation,draftToInput,TAX_SOURCES,CALCULATOR_SOURCE_COMMIT,MODEL_VERSION} from '../../public/simulator-engine.js';

const generation='00000000-0000-4000-8000-000000000001',client='00000000-0000-4000-8000-000000000002';
const source={generationId:generation,clientId:client,company:{code:'001',name:'EMPRESA SINTÉTICA',cnpj:'12345678000190'},
 purchases:{jobId:'00000000-0000-4000-8000-000000000003',fileName:'compras.csv',totalCents:450000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2'},
 sales:{jobId:'00000000-0000-4000-8000-000000000004',fileName:'vendas.csv',totalCents:1000000,formula:'Q - Y + AA - AB',calculationVersion:'NET_V2'},
 fields:{salesOptantCents:200000,salesNonOptantCents:500000,salesCpfCents:300000,purchasesOptantCents:100000,purchasesNonOptantCents:350000},warnings:[],periodBasis:'REPORT_TOTALS'};
const url=`/simulator.html?generation=${generation}&client=${client}`;
const key=`maximum-simulator:v1:operator:${generation}:${client}:${source.purchases.jobId}:${source.sales.jobId}`;
const readResult=(total=15000000)=>({extractionId,documentId,clientId:client,originalStored:true,searchableStored:true,...section22(total)});
const ready=()=>({documentId,clientId:client,status:'READY',extractionId,hasReadyExtraction:true,originalStored:true,retryable:true,error:null});
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};
async function savedDraft(page:Page){return page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null'),key);}
async function setup(page:Page){
 await mockStatement(page);
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{_id:'operator',role:'operator',name:'Teste'}}}));
 await page.route('**/api/v4/generations/*/simulator?*',r=>r.fulfill({json:source}));
 await page.route('**/api/v4/simulations',r=>{
  const body=r.request().postDataJSON();return r.fulfill({status:201,json:{_id:body.simulationId,source,company:source.company,generationId:generation,clientId:client,
   rbt12Source:'SIMPLES_SECTION_22',rbt12Extraction:readResult(),draft:body.draft,result:calculateSimulation(body.draft),engineInput:draftToInput(body.draft),taxSources:TAX_SOURCES,
   monthlyGroups:body.monthlyGroups,monthlyGroupsUnit:'BRL',reportMonths:body.reportMonths,periodConfirmed:true,adjustments:[],createdAt:'2026-10-19T12:00:00Z',createdBy:{id:'operator',name:'Teste'},modelVersion:MODEL_VERSION,calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT}});
 });
}
async function upload(page:Page){
 await page.locator('#rbt12-pdf').setInputFiles({name:'sintetico.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-transport-only')});
 await page.locator('#rbt12-read').click();
}
async function failAfterUpload(page:Page){
 await page.route('**/api/simples?*',r=>r.fulfill({status:504,json:{message:'Resposta da leitura interrompida.'}}));
 await upload(page);await expect(page.locator('#rbt12-status')).toContainText('ficou armazenado');
}

test('Ler novamente invalida a simulação antes da rede e não reaplica extração anterior após falha',async({page})=>{
 await setup(page);await page.goto(url);await upload(page);await expect(page.locator('#rbt12')).toHaveValue('150000.00');
 await page.locator('#period-confirm').check();
 for(const id of ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'])await page.locator('#'+id).fill('0');
 await page.locator('#generate-simulation').click();await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
 const pending=gate();
 await page.route('**/api/v4/simples-documents/*/process-urls',async r=>{await pending.promise;await r.fulfill({status:503,json:{message:'Não foi possível preparar a nova leitura.'}});});
 await page.getByRole('button',{name:'Ler novamente',exact:true}).click();
 await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('#simulation-result')).toBeEmpty();await expect(page.locator('#generate-simulation')).toBeDisabled();
 const draft=await savedDraft(page);expect(draft.rbt12ExtractionId).toBeNull();expect(draft.fields.rbt12).toBe('');expect(draft.rbt12Document.documentId).toBe(documentId);
 pending.release();await expect(page.locator('#rbt12-status')).toContainText('preparar a nova leitura');await expect(page.locator('#rbt12-view-original')).toBeVisible();
 let extractionGets=0;
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{...ready(),status:'OCR_FAILED',error:{code:'OCR_TIMEOUT',message:'A última tentativa falhou.'}}}));
 await page.route('**/api/simples?*',r=>{extractionGets++;return r.fulfill({json:readResult()});});
 await page.reload();await expect(page.locator('#rbt12-status')).toContainText('leitura anterior foi preservada');
 await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('#rbt12-details')).toBeEmpty();await expect(page.locator('#rbt12-reprocess')).toBeVisible();expect(extractionGets).toBe(0);
 // Defensive compatibility: a READY record carrying a failed latest attempt is not a new success.
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{...ready(),lastError:{message:'Última tentativa interrompida.'}}}));
 await page.locator('#rbt12-check-status').click();await expect(page.locator('#rbt12-status')).toContainText('não foi aplicada nesta tela');expect(extractionGets).toBe(0);
});

test('Timeout conserva o documento após PUT e recupera READY autenticado sem novo upload ou OCR',async({page})=>{
 await setup(page);await page.clock.install();let uploads=0,posts=0,gets=0;const pending=gate();
 await page.route('https://vercel.com/api/blob/**',r=>{uploads++;return r.fulfill({status:200,body:''});});
 await page.route('**/api/simples?*',async r=>{posts++;expect(r.request().postDataJSON().attemptId).toBe(attemptId);await pending.promise;await r.fulfill({json:readResult()}).catch(()=>{});});
 await page.goto(url);const reading=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/simples'&&r.method()==='POST');await upload(page);await reading;
 expect((await savedDraft(page)).rbt12Document.documentId).toBe(documentId);
 await page.clock.fastForward(285001);await expect(page.locator('#rbt12-status')).toContainText('leitura do PDF demorou');
 await expect(page.locator('#rbt12')).toHaveValue('');await expect(page.locator('#rbt12-check-status')).toBeVisible();pending.release();
 await page.evaluate(key=>{const draft=JSON.parse(sessionStorage.getItem(key)!);draft.fields.rbt12='999999.99';sessionStorage.setItem(key,JSON.stringify(draft));},key);
 const statusGate=gate();
 await page.route('**/api/v4/simples-documents/*/status',async r=>{await statusGate.promise;await r.fulfill({json:ready()});});
 await page.route('**/api/simples?*',r=>{expect(r.request().method()).toBe('GET');gets++;return r.fulfill({json:readResult(24000000)});});
 await page.reload();await expect(page.locator('#rbt12-status')).toContainText('Verificando');await expect(page.locator('#rbt12')).toHaveValue('');
 statusGate.release();await expect(page.locator('#rbt12')).toHaveValue('240000.00');await expect(page.locator('#rbt12-status')).toContainText('recuperada sem reenviar');
 expect(uploads).toBe(1);expect(posts).toBe(1);expect(gets).toBe(1);
});

test('PROCESSING espera verificação explícita e AWAITING_UPLOAD permite tentar o mesmo documento',async({page})=>{
 await setup(page);let uploads=0,posts=0;
 await page.route('https://vercel.com/api/blob/**',r=>{uploads++;return r.fulfill({status:200,body:''});});
 await page.goto(url);await failAfterUpload(page);
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{...ready(),status:'PROCESSING',retryable:false}}));
 await page.reload();await expect(page.locator('#rbt12-status')).toContainText('ainda está em andamento');
 await expect(page.locator('#rbt12-reprocess')).toBeHidden();await expect(page.locator('#rbt12')).toHaveValue('');
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{...ready(),status:'AWAITING_UPLOAD',originalStored:false,extractionId:null,hasReadyExtraction:false}}));
 await page.locator('#rbt12-check-status').click();await expect(page.locator('#rbt12-status')).toContainText('servidor ainda não confirmou');
 await expect(page.locator('#rbt12-view-original')).toBeHidden();await expect(page.locator('#rbt12-reprocess')).toBeVisible();
 await page.route('**/api/simples?*',r=>{posts++;const body=r.request().postDataJSON();expect(body.documentId).toBe(documentId);expect(body.attemptId).toBe(attemptId);return r.fulfill({json:readResult()});});
 await page.locator('#rbt12-reprocess').click();await expect(page.locator('#rbt12')).toHaveValue('150000.00');expect(uploads).toBe(1);expect(posts).toBe(1);
});

test('Retomada rejeita documento, empresa ou extração divergentes e não confia no rascunho local',async({page})=>{
 await setup(page);await page.goto(url);await failAfterUpload(page);let gets=0;
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:{...ready(),clientId:'00000000-0000-4000-8000-000000000099'}}));
 await page.route('**/api/simples?*',r=>{gets++;return r.fulfill({json:{...readResult(),documentId:'00000000-0000-4000-8000-000000000099'}});});
 await page.reload();await expect(page.locator('#rbt12-status')).toContainText('não corresponde');
 await expect(page.locator('#rbt12-view-original')).toBeHidden();await expect(page.locator('#rbt12-reprocess')).toBeHidden();expect(gets).toBe(0);
 await page.route('**/api/v4/simples-documents/*/status',r=>r.fulfill({json:ready()}));
 await page.locator('#rbt12-check-status').click();await expect(page.locator('#rbt12-status')).toContainText('leitura recuperada não corresponde');await expect(page.locator('#rbt12')).toHaveValue('');
 await page.route('**/api/simples?*',r=>r.fulfill({json:{...readResult(),cnpjBasico:'87654321'}}));
 await page.locator('#rbt12-check-status').click();await expect(page.locator('#rbt12-status')).toContainText('CNPJ básico');await expect(page.locator('#rbt12')).toHaveValue('');
 let statuses=0;
 await page.route('**/api/v4/simples-documents/*/status',r=>{statuses++;return r.fulfill({json:ready()});});
 await page.evaluate(key=>{const draft=JSON.parse(sessionStorage.getItem(key)!);draft.rbt12Document.sourceKey='outra geração ou empresa';draft.rbt12ExtractionId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';draft.fields.rbt12='999999.99';sessionStorage.setItem(key,JSON.stringify(draft));},key);
 await page.reload();await expect(page.locator('#simulator-form')).toBeVisible();await expect(page.locator('#rbt12')).toHaveValue('');expect(statuses).toBe(0);
});

test('Resposta antiga de verificação não substitui a escolha de outro PDF ou o modo manual',async({page})=>{
 await setup(page);await page.goto(url);await failAfterUpload(page);const pending=gate();let gets=0;
 await page.route('**/api/v4/simples-documents/*/status',async r=>{await pending.promise;await r.fulfill({json:ready()});});
 await page.route('**/api/simples?*',r=>{gets++;return r.fulfill({json:readResult()});});
 await page.reload();await expect(page.locator('#rbt12-status')).toContainText('Verificando');
 await page.locator('#rbt12-pdf').setInputFiles({name:'outro.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-other-synthetic')});
 await page.locator('#rbt12-manual').click();await page.locator('#rbt12').fill('123.45');
 const response=page.waitForResponse('**/api/v4/simples-documents/*/status');pending.release();await response;
 await expect(page.locator('#rbt12')).toHaveValue('123.45');await expect(page.locator('#rbt12')).not.toHaveAttribute('readonly','');
 await expect(page.locator('#rbt12-details')).toBeEmpty();expect(gets).toBe(0);expect((await savedDraft(page)).rbt12Document).toBeNull();
});
