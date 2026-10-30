import {test as base,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {hashPassword} from '../../src/security.ts';
import {csvParse} from '../../src/domain.ts';

type Company={clientId:string;code:string;email:string;password:string};
const test=base.extend<{company:Company}>({company:async({page,baseURL},use)=>{
  expect(process.env.MONGODB_URI,'Use somente MongoDB descartável').toBeTruthy();
  const mongo=new MongoClient(process.env.MONGODB_URI!);await mongo.connect();
  const db=mongo.db(process.env.MONGODB_DB),workspaceId=process.env.WORKSPACE_ID||'maximum',userId=randomUUID();
  const email=`financial-alerts-${userId}@example.test`,password=`Synthetic-${randomUUID()}`;
  const code=String(Number.parseInt(userId.replaceAll('-','').slice(0,11),16));
  try{
    await db.collection<any>('users').insertOne({_id:userId,workspaceId,email,passwordHash:await hashPassword(password),
      name:'Conferência financeira sintética',role:'admin',active:true,mustChangePassword:false,createdAt:new Date()});
    await api(page.request,baseURL!,'POST','/api/auth/login',{email,password});
    const imported=await api(page.request,baseURL!,'POST','/api/v4/clients/import',{
      rows:[{code,name:'Empresa sintética alertas '+code,uf:'MG'}]
    });
    await use({clientId:imported.items[0].id,code,email,password});
  }finally{
    await db.collection<any>('sessions').deleteMany({workspaceId,userId});
    await db.collection<any>('users').deleteOne({_id:userId,workspaceId});
    await mongo.close();
  }
}});

async function api(request:APIRequestContext,baseURL:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(path,{method,...(data===undefined?{}:{data}),headers:{Origin:new URL(baseURL).origin}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);return response.json();
}

// Real CSV upload and server reconciliation; CPF-only rows avoid external CNPJ queries.
function report(name:string,rows:{nature:string;cents:number}[]){
  const header=Array(28).fill('');
  for(const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[9,'Estado'],
    [11,'Natureza'],[14,'Descrição'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],
    [25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado']] as const)header[column]=label;
  const values=rows.map(item=>{
    const row=Array(28).fill('');row[0]='123.456.789-00';row[7]='15/01/2025';row[8]='Pessoa sintética';row[9]='MG';
    row[11]=item.nature;row[14]='Operação sintética';row[15]='1';row[16]=(item.cents/100).toFixed(2).replace('.',',');
    for(const column of [24,25,26,27])row[column]='0,00';return row;
  });
  return {name,mimeType:'text/csv',buffer:Buffer.from([header,...values].map(row=>row.join(';')).join('\r\n'),'latin1')};
}

async function importReports(page:Page,returnsCents:number){
  const purchases=[{nature:'1102001',cents:25_000},...(returnsCents?[{nature:'1202001',cents:returnsCents}]:[])];
  for(const [kind,rows] of [['PURCHASES',purchases],['SALES',[{nature:'5102001',cents:10_000}]]] as const){
    await page.locator(`[data-analysis-document-file="${kind}"]`).setInputFiles(report(`alertas-${kind}.csv`,[...rows]));
    await expect(page.locator(`[data-analysis-document="${kind}"]`)).toContainText('Leitura concluída');
    await expect(page.locator(`[data-analysis-document-error="${kind}"]`)).toHaveCount(0);
  }
}

async function completeSector(page:Page,id:string,sector:'fiscal'|'accounting'){
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/${sector}`&&response.request().method()==='PATCH');
  await page.locator('#analysis-wizard button[value=complete]').click();
  const response=await saving;expect(response.ok(),await response.text()).toBe(true);
  const result=await response.json();expect(result.analysis[sector].status).toBe('COMPLETE');
  await expect(page.locator('#analysis-wizard')).not.toBeVisible();return result.analysis;
}

async function accounting(page:Page,id:string){
  await page.goto(`/analyses.html?id=${id}&sector=accounting`);
  await expect(page.locator('[data-accounting-average=salariesCents]')).toBeVisible();
  await page.locator('[data-accounting-average=salariesCents]').fill('10');
  for(const field of ['rentCents','cardExpensesCents','benefitsCents','adminExpensesCents']){
    await page.locator(`[data-accounting-average=${field}]`).fill('0');
  }
  const saved=await completeSector(page,id,'accounting');expect(saved.readiness.ready).toBe(true);
  expect(saved.readiness.months).toEqual(['2025-01']);
  expect(saved.accounting.data.monthlyAverage.values.salariesCents).toBe(1000);
  expect(saved.accounting.data.months).toHaveLength(9);
  expect(saved.accounting.data.months.every((row:any)=>row.salariesCents===1000)).toBe(true);
}

async function generate(page:Page,baseURL:string,id:string){
  await expect(page.locator('#analysis-generate')).toBeEnabled();
  const generating=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v4/analyses/${id}/generate`&&response.request().method()==='POST');
  await page.locator('#analysis-generate').click();expect((await generating).status()).toBe(200);
  await expect(page.locator('#simulation-snapshot')).toBeVisible();
  const simulationId=new URL(page.url()).searchParams.get('simulation');expect(simulationId).toBeTruthy();
  return api(page.request,baseURL,'GET',`/api/v4/simulations/${simulationId}`);
}

for(const scenario of [
  {name:'devoluções maiores que as vendas',returnsCents:15_000,revenue:-50},
  {name:'compras e despesas maiores que a receita positiva',returnsCents:0,revenue:100}
]){
  test(`${scenario.name}: alerta permite concluir, salvar, exportar e reabrir a DRE`,async({page,browser,baseURL,company},info)=>{
    test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const analysis=(await api(page.request,baseURL!,'POST','/api/v4/analyses',{
      clientId:company.clientId,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['presumed','actual']}
    })).analysis;
    await page.goto(`/analyses.html?client=${company.clientId}&sector=fiscal&entry=company`);
    await expect(page.locator('#analysis-wizard')).toHaveAttribute('data-wizard-step','documents');
    await importReports(page,scenario.returnsCents);
    const sourceAlerts=page.locator('#analysis-commercial-composition [data-financial-alerts]');
    await expect(sourceAlerts).toBeVisible();await expect(sourceAlerts).toContainText('Você pode continuar a análise');
    await expect(sourceAlerts).toContainText('Compras de');
    if(scenario.revenue<0){
      await expect(sourceAlerts).toContainText('As devoluções superam as vendas');
      await page.locator('#analysis-fiscal-options > summary').click();
      await page.locator('#analysis-fiscal-adjustments > summary').click();
      await page.locator('#analysis-edit-adjustments').click();
      const sales=page.locator('[data-fiscal-month="2025-01"] [data-fiscal-field=salesCpfCents]');
      await expect(sales).toHaveValue('-50.00');
      expect(await sales.evaluate(node=>(node as HTMLInputElement).checkValidity())).toBe(true);
      // Saving the unchanged negative field exercises the signed editor/parser contract.
      await sales.fill('-50');
    }
    await expect(page.locator('#analysis-wizard button[value=complete]')).toBeEnabled();
    await sourceAlerts.scrollIntoViewIfNeeded();await sourceAlerts.screenshot({path:info.outputPath('fiscal-alerta.png')});
    await completeSector(page,analysis.id,'fiscal');await accounting(page,analysis.id);
    const saved=await generate(page,baseURL!,analysis.id);
    expect(saved.result.annualRevenue).toBe(scenario.revenue);
    expect(saved.source.fields.salesCpfCents).toBe(scenario.revenue*100);
    expect(saved.source.fields.purchasesNonOptantCents).toBe(25_000);
    expect(saved.source.operationAudit.salesReturnsCents).toBe(scenario.returnsCents);
    expect(saved.result.regimes.map((regime:any)=>regime.id)).toEqual(['presumed','actual']);
    for(const regime of saved.result.regimes){
      expect(regime.available).toBe(true);expect(regime.dre.revenue).toBe(scenario.revenue);
      expect(regime.dre.salaries).toBe(-10);expect(regime.dre.netProfit).toBeLessThan(0);
      expect(regime.totalTaxes).toBeGreaterThanOrEqual(0);
      if(scenario.revenue<0){expect(regime.margin).toBeNull();expect(regime.taxBurden).toBeNull();}
    }
    const alerts=page.locator('#simulation-notices [data-financial-alerts]');
    await expect(alerts).toBeVisible();
    await expect(alerts.locator('[data-financial-alert-code=purchases-above-revenue]')).toBeVisible();
    await expect(alerts.locator('[data-financial-alert-code=costs-above-revenue]')).toBeVisible();
    if(scenario.revenue<0)await expect(alerts.locator('[data-financial-alert-code=negative-revenue]')).toBeVisible();
    const revenueCells=page.locator('#dre-demonstrativo [data-dre-row=revenue] td');
    await expect(revenueCells).toHaveCount(2);
    await expect(revenueCells.first()).toHaveText(scenario.revenue<0?/-\s*R\$\s*50,00/:/R\$\s*100,00/);
    if(scenario.revenue<0){
      await expect(page.locator('[data-dre-regime-result].is-best')).toHaveCount(0);
      await expect(page.locator('#dre-demonstrativo')).not.toContainText('Maior resultado disponível');
    }

    await page.locator('#dre-report-period').selectOption('complete');
    const downloading=page.waitForEvent('download');await page.locator('#export-dre-csv').click();
    const stream=await(await downloading).createReadStream(),chunks:Buffer[]=[];
    for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
    const csv=Buffer.concat(chunks).toString('utf8'),rows=csvParse(csv,';');
    expect(rows.some(row=>row.some(value=>/Receita considerada|Receita utilizada/i.test(value))&&row.includes(scenario.revenue.toFixed(2).replace('.',',')))).toBe(true);
    if(scenario.returnsCents)expect(rows.some(row=>row.some(value=>/Devoluções de venda/i.test(value))&&row.includes('-150,00'))).toBe(true);

    for(const width of [1280,390]){
      await page.setViewportSize({width,height:850});await alerts.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:info.outputPath(`resultado-alertas-${width}.png`),fullPage:true});
    }
    const fresh=await browser.newContext({baseURL});
    try{
      await api(fresh.request,baseURL!,'POST','/api/auth/login',{email:company.email,password:company.password});
      const reopened=await fresh.newPage();reopened.on('pageerror',error=>errors.push(error.message));
      await reopened.goto(`/simulator.html?simulation=${saved._id}`);
      await expect(reopened.locator('#simulation-snapshot')).toBeVisible();
      await expect(reopened.locator('#simulation-notices [data-financial-alerts]')).toBeVisible();
      await expect(reopened.locator('#dre-demonstrativo [data-dre-row=revenue] td').first()).toHaveText(scenario.revenue<0?/-\s*R\$\s*50,00/:/R\$\s*100,00/);
      if(scenario.revenue<0){
        await expect(reopened.locator('[data-dre-regime-result].is-best')).toHaveCount(0);
        await expect(reopened.locator('#dre-demonstrativo')).not.toContainText('Maior resultado disponível');
      }
      expect(await api(fresh.request,baseURL!,'GET',`/api/v4/simulations/${saved._id}`)).toEqual(saved);
    }finally{await fresh.close();}
    expect(errors).toEqual([]);
  });
}
