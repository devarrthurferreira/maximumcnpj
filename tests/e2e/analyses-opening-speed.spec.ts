import {test,expect,type Page} from '@playwright/test';
import {defaultFiscalData} from '../../src/analysis-contract.ts';

const clientId='19833333-3333-4333-8333-333333333331';
const analysisId='19833333-3333-4333-8333-333333333332';
const company={_id:clientId,code:'FAST-1',name:'Empresa sintética de abertura',active:true,uf:'MG'};
const selection={version:'REGIME_SELECTION_V1' as const,selected:['actual' as const]};
function record(){
  return {id:analysisId,clientId,version:'ANALYSIS_SECTORS_V1',periodPolicy:'JAN_SEP_V1',revision:2,
    company:{code:company.code,name:company.name,cnpj:null},config:{revision:1,year:2027,regimeSelection:selection},
    fiscal:{revision:1,status:'DRAFT',data:defaultFiscalData(selection)},
    accounting:{revision:1,status:'DRAFT',data:{months:[]}},
    readiness:{ready:false,verification:'SAVED',months:[],issues:[
      {code:'ANALYSIS_FISCAL_INCOMPLETE',sector:'fiscal',message:'Adicione os relatórios.'},
      {code:'ACCOUNTING_VALUES_MISSING',sector:'accounting',message:'Informe as despesas.'}
    ]},currentSimulation:null};
}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
const salary=(page:Page)=>page.locator('[data-accounting-average="salariesCents"]');
async function setup(page:Page,{exists=true}={}){
  const saved=record(),counts={catalog:0,list:0,summary:0,source:0,create:0};
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{message:'Rota sintética não configurada.'}}));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{user:{_id:'synthetic',name:'Equipe sintética',role:'operator'}}}));
  await page.route('**/api/v4/clients',route=>{counts.catalog++;return route.fulfill({json:{items:[company]}});});
  await page.route('**/api/v4/analyses?*',route=>{
    if(route.request().method()==='POST'){counts.create++;return route.fulfill({json:{analysis:saved,created:true}});}
    counts.list++;return route.fulfill({json:{items:exists?[saved]:[],pagination:{page:1,total:exists?1:0,totalPages:1}}});
  });
  await page.route(`**/api/v4/analyses/${analysisId}?*`,route=>{
    if(new URL(route.request().url()).searchParams.get('includeSource')==='1')counts.source++;
    else counts.summary++;
    return route.fulfill({json:{analysis:saved,source:null}});
  });
  return {saved,counts};
}
async function switchSector(page:Page,sector:'fiscal'|'accounting'){
  await page.locator('#analysis-wizard [data-analysis-sector="'+sector+'"]').click();
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-kind',sector);
}
async function documents(page:Page){
  for(let attempt=0;attempt<3;attempt++){
    if(await page.locator('#analysis-wizard').getAttribute('data-wizard-step')==='documents')return;
    await page.locator('#analysis-wizard-next').click();
  }
  await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
}

for(const exists of [true,false])test(`${exists?'Retomar':'Criar'} pelo Contábil usa o resumo recebido sem outro GET nem catálogo fiscal`,async({page})=>{
  const {counts}=await setup(page,{exists}),hold=gate();
  // A redundant read would block the form: the company response is sufficient.
  await page.route(`**/api/v4/analyses/${analysisId}?summary=1`,async route=>{counts.summary++;await hold.promise;await route.fulfill({json:{analysis:record()}});});
  try{
    await page.goto(`/analyses.html?client=${clientId}&sector=accounting`,{waitUntil:'domcontentloaded'});
    await expect(salary(page)).toBeVisible();
    expect(counts).toEqual({catalog:0,list:1,summary:0,source:0,create:exists?0:1});
    expect(new URL(page.url()).searchParams.get('id')).toBe(analysisId);
    await salary(page).fill('123.45');await page.locator('#analysis-wizard-close').click();
    await page.locator('[data-analysis-sector-card="accounting"]').click();
    await expect(salary(page)).toHaveValue('123.45');
    expect(counts.catalog).toBe(0);expect(counts.summary).toBe(0);
  }finally{hold.release();}
});

test('Catálogo pendente é compartilhado ao trocar setores e não substitui UF nem despesas editadas',async({page})=>{
  const {counts}=await setup(page),hold=gate(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v4/clients',async route=>{counts.catalog++;await hold.promise;await route.fulfill({json:{items:[company]}});});
  try{
    await page.goto(`/analyses.html?id=${analysisId}&sector=accounting`);
    await expect(salary(page)).toBeVisible();expect(counts.summary).toBe(1);expect(counts.catalog).toBe(0);
    await salary(page).fill('987.65');await switchSector(page,'fiscal');await documents(page);
    await expect.poll(()=>counts.catalog).toBe(1);
    await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('987.65');
    await switchSector(page,'fiscal');await documents(page);
    await page.locator('[data-analysis-document-uf]').selectOption('SP');
    expect(counts.catalog).toBe(1);
    const settled=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v4/clients');
    hold.release();await settled;
    await expect(page.locator('[data-analysis-document-uf]')).toHaveValue('SP');
    await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('987.65');
    expect(counts.catalog).toBe(1);expect(counts.source).toBe(1);expect(errors).toEqual([]);
  }finally{hold.release();}
});

test('Falha de catálogo é liberada para a próxima abertura do Fiscal',async({page})=>{
  const {counts}=await setup(page);
  await page.route('**/api/v4/clients',route=>{
    counts.catalog++;
    return counts.catalog===1?route.fulfill({status:503,json:{message:'Catálogo indisponível.'}}):route.fulfill({json:{items:[company]}});
  });
  await page.goto(`/analyses.html?id=${analysisId}&sector=fiscal&step=documents`);
  await expect(page.locator('[data-analysis-document-uf]')).toBeVisible();
  await expect.poll(()=>counts.catalog).toBe(1);
  await switchSector(page,'accounting');await salary(page).fill('10');await switchSector(page,'fiscal');
  await documents(page);await expect(page.locator('[data-analysis-document-uf]')).toHaveValue('MG');
  expect(counts.catalog).toBe(2);
  await switchSector(page,'accounting');await expect(salary(page)).toHaveValue('10');
});

test('Resumo de outra empresa é recusado antes de abrir o formulário',async({page})=>{
  const {counts}=await setup(page);
  await page.route('**/api/v4/analyses?*',route=>route.fulfill({json:{items:[{...record(),clientId:'19833333-3333-4333-8333-333333333399'}]}}));
  await page.goto(`/analyses.html?client=${clientId}&sector=accounting`);
  await expect(page.locator('#analysis-error')).toContainText('Não foi possível conferir a análise desta empresa');
  await expect(page.locator('#analysis-wizard')).toHaveCount(0);expect(counts.summary).toBe(0);expect(counts.catalog).toBe(0);
});
