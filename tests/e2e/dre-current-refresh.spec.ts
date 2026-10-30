import {test,expect,type Page} from '@playwright/test';
import {legacyOutgoingDreFixture} from '../fixtures/dre-outgoing-legacy.mjs';
import {OUTGOING_DIFAL_MESSAGE} from '../../public/simulator-engine.js';
import {calculateMonthlySimulation} from '../../public/simulator-monthly.js';
import {buildMonthlyDre} from '../../public/simulator-calendar.js';
import {REPROCESS_VERSION} from '../../public/simulation-reprocess-contract.js';

const analysisId='96969696-9696-4696-8696-969696969606';
const correctedId='96969696-9696-4696-8696-969696969607';
const otherClientId='96969696-9696-4696-8696-969696969608';
const previousModel='1.17.0-dre-sales-difal-sync-available-months';
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');

function snapshots(){
  const original:any=legacyOutgoingDreFixture();
  original.analysisId=analysisId;original.analysisRevision=4;
  expect(original.modelVersion).toBe(previousModel);
  const corrected=structuredClone(original);
  corrected._id=correctedId;corrected.parentSimulationId=original._id;
  corrected.reprocessing={version:REPROCESS_VERSION,originalId:original._id,completedAt:'2026-10-30T14:00:00Z'};
  for(const report of corrected.source.monthlyReports){
    report.difal={...report.difal,version:'DIFAL_ESTIMATE_V6',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0};
  }
  Object.assign(corrected,calculateMonthlySimulation(corrected.draft,corrected.source.monthlyReports,
    corrected.monthlyInputs,corrected.source.sales.jobId,null,corrected.analysisPeriod));
  corrected.source.sales.difal={...corrected.source.monthlyReports[0].difal};
  corrected.source.projection=corrected.projection;
  corrected.modelVersion=corrected.result.version;corrected.annualRevenue=corrected.result.annualRevenue;
  corrected.bestRegimeId=corrected.result.bestRegimeId;
  corrected.monthlyDre=buildMonthlyDre(corrected.result,corrected.year,corrected.rbt12Manual,corrected.source.period);
  return {original,corrected};
}

type Reply={status?:number;json:unknown};
type Routes={role?:'operator'|'viewer';analysis?:any;refresh?:(attempt:number)=>Reply|Promise<Reply>};
async function mockApi(page:Page,pair:ReturnType<typeof snapshots>,options:Routes={}){
  const requests:{method:string;path:string;body:string|null}[]=[],errors:string[]=[];
  let refreshCount=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),path=url.pathname+url.search;
    requests.push({method,path,body:request.postData()});
    if(url.pathname==='/api/auth/session'&&method==='GET'){
      await route.fulfill({json:{user:{_id:'synthetic-reader',role:options.role||'operator',name:'Conferência sintética'}}});return;
    }
    if(method==='GET'&&url.pathname==='/api/v4/simulations/'+pair.original._id){await route.fulfill({json:pair.original});return;}
    if(method==='GET'&&url.pathname==='/api/v4/simulations/'+pair.corrected._id){await route.fulfill({json:pair.corrected});return;}
    if(method==='POST'&&url.pathname==='/api/v4/simulations/'+pair.original._id+'/refresh'){
      const response=options.refresh?await options.refresh(++refreshCount):{status:405,json:{message:'Esta navegação não permite recalcular.'}};
      await route.fulfill(response);return;
    }
    if(method==='GET'&&url.pathname==='/api/v4/analyses/'+analysisId&&url.searchParams.get('summary')==='1'&&options.analysis){
      await route.fulfill({json:{analysis:options.analysis}});return;
    }
    await route.fulfill({status:404,json:{message:'Rota fora da fixture sintética.'}});
  });
  return {requests,errors};
}

const savedUrl=(id:string,mode:'current'|'historical')=>'/simulator.html?'+new URLSearchParams({simulation:id,[mode]:'1'});
const writes=(requests:{method:string;path:string}[])=>requests.filter(request=>!['GET','HEAD'].includes(request.method));
async function expectStatement(page:Page,snapshot:any){
  await expect(page.locator('#dre-demonstrativo')).toBeVisible();
  for(const key of ['difal','icmsAnticipation','netProfit']){
    await expect(page.locator(`.dre-complete > .dre-table-wrap [data-dre-row="${key}"] td .dre-amount`))
      .toHaveText(snapshot.result.regimes.map((regime:any)=>money(regime.dre[key])));
  }
}
function currentAnalysis(pair:ReturnType<typeof snapshots>){
  return {id:analysisId,clientId:pair.original.clientId,revision:4,
    currentSimulation:{id:pair.corrected._id,analysisRevision:4,modelVersion:pair.corrected.modelVersion,stale:false}};
}

test('DRE atual oculta resultado antigo durante falha 503 e nova tentativa abre a revisão zerada',async({page})=>{
  const pair=snapshots();let releaseFailure!:()=>void;
  const pendingFailure=new Promise<void>(resolve=>{releaseFailure=resolve;});
  const api=await mockApi(page,pair,{refresh:async attempt=>{
    if(attempt===1){await pendingFailure;return {status:503,json:{message:'Origem fiscal temporariamente indisponível.'}};}
    return {json:{originalId:pair.original._id,updated:true,simulation:pair.corrected}};
  }});
  await page.goto(savedUrl(pair.original._id,'current'));
  await expect(page.locator('[data-simulation-refresh="loading"]')).toBeVisible();
  await expect(page.locator('#dre-demonstrativo,[data-dre-row]')).toHaveCount(0);
  releaseFailure();
  await expect(page.locator('[data-simulation-refresh="failed"]')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Origem fiscal temporariamente indisponível.');
  await expect(page.locator('#dre-demonstrativo,[data-dre-row]')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Consultar versão histórica'})).toHaveAttribute('href',savedUrl(pair.original._id,'historical'));
  await page.locator('#retry-current-simulation').click();
  await expect(page).toHaveURL(new RegExp(`${pair.corrected._id}&current=1$`));
  await expectStatement(page,pair.corrected);
  await expect(page.locator('[data-simulation-revision="updated"]')).toContainText('A versão anterior continua no histórico.');
  await expect(page.locator('#simulator-difal [data-difal-disabled]').first()).toHaveText(OUTGOING_DIFAL_MESSAGE);
  // A client may have retained the old directional policy in its audited draft;
  // the read-only current view must explain the applied policy from the result.
  expect(pair.corrected.draft.difalPolicy.operations.pure.exit).toBe(true);
  expect(pair.corrected.result.difalPolicy.operations.pure.exit).toBe(false);
  await expect(page.locator('[data-difal-option="pure"] .sim-difal-scope')).toHaveText('entrada (compras)');
  await expect(page.locator('[data-difal-option="hybrid"] .sim-difal-scope')).toHaveText('entrada (compras)');
  await expect(page.getByRole('link',{name:'Consultar versão anterior'})).toHaveAttribute('href',savedUrl(pair.original._id,'historical'));
  expect(writes(api.requests)).toEqual(Array.from({length:2},()=>({method:'POST',path:`/api/v4/simulations/${pair.original._id}/refresh`,body:'{}'})));
  expect(api.errors).toEqual([]);
});

for(const mismatch of ['client','model'] as const)test(`resposta de atualização com ${mismatch==='client'?'outra empresa':'modelo antigo'} não exibe DRE como atual`,async({page})=>{
  const pair=snapshots(),invalid=structuredClone(pair.corrected);
  if(mismatch==='client')invalid.clientId=otherClientId;
  else{invalid.modelVersion=previousModel;invalid.result.version=previousModel;}
  const api=await mockApi(page,pair,{refresh:()=>({json:{originalId:pair.original._id,updated:true,simulation:invalid}})});
  await page.goto(savedUrl(pair.original._id,'current'));
  await expect(page.locator('[data-simulation-refresh="failed"]')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('O servidor não confirmou uma versão atualizada desta empresa.');
  await expect(page.locator('#dre-demonstrativo,[data-dre-row]')).toHaveCount(0);
  await expect(page.locator('#retry-current-simulation')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${pair.original._id}&current=1$`));
  expect(writes(api.requests)).toHaveLength(1);expect(api.errors).toEqual([]);
});

test('histórico usa apenas GET e mantém o DIFAL e o resultado originalmente capturados',async({page})=>{
  const pair=snapshots(),api=await mockApi(page,pair);
  expect(pair.original.result.regimes[0].dre.difal).toBeLessThan(0);
  await page.goto(savedUrl(pair.original._id,'historical'));
  await expectStatement(page,pair.original);
  await expect(page.locator('[data-simulation-revision="historical"]')).toContainText('Versão histórica.');
  await expect(page.locator('[data-current-simulation]')).toHaveAttribute('href',savedUrl(pair.original._id,'current'));
  await expect(page.locator('#simulator-difal [data-difal-empty]')).toHaveCount(0);
  await expect(page.locator('[data-simulation-refresh]')).toHaveCount(0);
  expect(writes(api.requests)).toEqual([]);
  expect(api.requests.filter(request=>request.path.startsWith('/api/v4/')).map(request=>request.path))
    .toEqual(['/api/v4/simulations/'+pair.original._id]);
  expect(api.errors).toEqual([]);
});

test('viewer consulta o resumo da análise e segue a DRE atual indicada sem enviar POST',async({page})=>{
  const pair=snapshots(),api=await mockApi(page,pair,{role:'viewer',analysis:currentAnalysis(pair)});
  await page.goto(savedUrl(pair.original._id,'current'));
  await expect(page).toHaveURL(new RegExp(`${pair.corrected._id}&current=1$`));
  await expectStatement(page,pair.corrected);
  await expect(page.locator('#simulator-difal [data-difal-disabled]').first()).toHaveText(OUTGOING_DIFAL_MESSAGE);
  await expect(page.locator('[data-simulation-refresh],#retry-current-simulation,[data-simulation-revision="historical"]')).toHaveCount(0);
  expect(writes(api.requests)).toEqual([]);
  expect(api.requests.filter(request=>request.path.startsWith('/api/v4/')).map(request=>request.path)).toEqual([
    '/api/v4/simulations/'+pair.original._id,'/api/v4/analyses/'+analysisId+'?summary=1','/api/v4/simulations/'+pair.corrected._id,
  ]);
  expect(api.errors).toEqual([]);
});

for(const stale of ['flag','revision'] as const)test(`viewer recebe aviso quando ${stale==='flag'?'a DRE está desatualizada':'os setores têm revisão posterior'}, sem atualizar nem mostrar o valor antigo`,async({page})=>{
  const pair=snapshots(),analysis=currentAnalysis(pair);
  if(stale==='flag')analysis.currentSimulation.stale=true;else analysis.revision++;
  const api=await mockApi(page,pair,{role:'viewer',analysis});
  await page.goto(savedUrl(pair.original._id,'current'));
  await expect(page.locator('[data-simulation-refresh="failed"]')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('A DRE atual precisa ser gerada com os dados salvos dos setores.');
  await expect(page.locator('#dre-demonstrativo,[data-dre-row],#retry-current-simulation')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Consultar versão histórica'})).toHaveAttribute('href',savedUrl(pair.original._id,'historical'));
  expect(writes(api.requests)).toEqual([]);
  expect(api.requests.filter(request=>request.path.startsWith('/api/v4/')).map(request=>request.path))
    .toEqual(['/api/v4/simulations/'+pair.original._id,'/api/v4/analyses/'+analysisId+'?summary=1']);
  expect(api.errors).toEqual([]);
});
