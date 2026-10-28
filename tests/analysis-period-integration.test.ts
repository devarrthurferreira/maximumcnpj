import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collection,scope,database,closeDatabase} from '../src/store.ts';
import {resetLookupIndexes} from '../src/lookup-db.ts';
import {importCatalog} from '../src/lookup-catalog.ts';
import {createGeneration,attachGenerationPurchase,attachGenerationSale} from '../src/generation-store.ts';
import {uploadLookup,finalizeLookup,processLookup} from '../src/lookup-jobs.ts';
import {generationSimulator} from '../src/simulator-store.ts';
import {openAnalysis,getAnalysis,updateAnalysisSector,generateAnalysis} from '../src/analysis-store.ts';
import {createSimulation,getSimulation} from '../src/simulation-history.ts';
import {rebuildSimulationSource} from '../src/simulation-reprocessing-source.ts';
import {planReprocessing} from '../src/simulation-reprocessing.ts';
import {baselineMonth,MONTHLY_MODEL_VERSION} from '../public/simulator-monthly.js';
import {JAN_SEP_POLICY,JAN_SEP_MODEL_VERSION,analysisMonthsForYear} from '../public/analysis-period.js';
import {section22} from './fixtures/section22.ts';
import {ACCOUNTING_FIELDS} from '../src/analysis-contract.ts';

test('MongoDB Jan–Set: recorte auditável, fontes diferentes, faltas explícitas, revisões e reprodução histórica',
  {skip:!process.env.MONGODB_URI,timeout:120000},async t=>{
  const oldDb=process.env.MONGODB_DB,oldWs=process.env.WORKSPACE_ID;
  process.env.MONGODB_DB='maximum_jansep_'+randomUUID().replaceAll('-','');process.env.WORKSPACE_ID='jansep_test';resetLookupIndexes();
  const actor={_id:'jansep-operator',role:'admin',name:'Período sintético',email:'jansep@example.test'};
  const regimeSelection={version:'REGIME_SELECTION_V1',selected:['presumed','actual']};
  const options={periodPolicy:JAN_SEP_POLICY},code=(expected:string)=>(error:any)=>error.code===expected;
  type Amount=[string,number];
  async function fixture(companyCode:string,purchases:Amount[],sales:Amount[]){
    const imported=await importCatalog(actor,[{code:companyCode,name:`Período ${companyCode}`,uf:'MG'}]);
    assert.equal(imported.failed,0,JSON.stringify(imported.items));const clientId=imported.items[0].id;
    const generation=await createGeneration(actor,{generationId:randomUUID(),clientIds:[clientId]});
    const jobs:string[]=[];
    for(const [attach,nature,values] of [[attachGenerationPurchase,'1102',purchases],[attachGenerationSale,'5102',sales]] as const){
      const {job}=await attach(actor,generation._id,{clientId,importId:randomUUID(),fileName:`${companyCode}-${nature}.csv`,expectedRows:values.length});jobs.push(job._id);
      await uploadLookup(actor,job._id,{offset:0,rows:values.map(([month,totalCents])=>({document:'12345678900',name:'Pessoa sintética',recipientUf:'MG',
        serviceDate:`${month}-15`,natureCode:nature,quantity:'1',totalCents,grossCents:totalCents,discountCents:0,accessoryCents:0,freightCents:0,abatementCents:0}))});
      await finalizeLookup(actor,job._id);await processLookup(actor,job._id,(async()=>{throw new Error('CPF sintético não consulta serviços externos.');}) as typeof fetch);
    }
    return {clientId,generationId:generation._id,jobs};
  }
  const input=(source:any,flag=false)=>{
    const monthlyInputs=source.monthlyReports.map((row:any)=>baselineMonth(row)),first=monthlyInputs[0],groups=first.groups;
    return {simulationId:randomUUID(),generationId:source.generationId,clientId:source.clientId,reportMonths:source.reportMonths,periodConfirmed:true,
      ...(flag?options:{}),monthlyGroups:groups,monthlyInputs,rbt12Source:'NOT_REQUIRED',draft:{year:2027,salesAnnex:1,serviceAnnex:3,regimeSelection,
        values:{...first.values,salesRevenue:groups.salesOptantCents+groups.salesNonOptantCents+groups.salesCpfCents,
          simplePurchases:groups.purchasesOptantCents,regularPurchases:groups.purchasesNonOptantCents}}};
  };
  try{
    await t.test('12 meses importados geram somente Jan–Set; fontes completas e snapshot legado permanecem intactos',async()=>{
      const ids=await fixture('99281',[['2026-01',10000],['2026-09',20000],['2026-10',40000],['2026-12',60000]],
        [['2026-01',100000],['2026-09',200000],['2026-10',400000],['2026-12',600000]]);
      const legacySource=await generationSimulator(ids.generationId,ids.clientId),legacyInput=input(legacySource);
      const legacy=await createSimulation(actor,legacyInput),original=structuredClone(legacy);
      assert.equal(legacy.modelVersion,MONTHLY_MODEL_VERSION);assert.equal(legacy.reportMonths,12);assert.equal(legacy.result.annualRevenue,13000);
      const lines=await collection('purchaseLines'),before=await lines.find(scope({jobId:{$in:ids.jobs}})).sort({jobId:1,index:1}).toArray();
      const source=await generationSimulator(ids.generationId,ids.clientId,options);
      assert.equal(source.analysisPeriod!.complete,true);assert.equal(source.reportMonths,9);assert.equal(source.monthlyReports.length,9);
      assert.deepEqual(source.analysisPeriod!.excludedMonths,['2026-10','2026-11','2026-12']);
      assert.equal(source.sales.totalCents,1300000);assert.equal(source.sales.selectedTotalCents,300000);
      assert.equal(source.importedOperationAudit!.reportSalesCents,1300000);assert.equal(source.operationAudit.reportSalesCents,300000);
      assert.equal(source.commercialComposition!.revenue.totalCents,300000);assert.equal(source.commercialComposition!.purchases.totalCents,30000);
      const saved=await createSimulation(actor,input(source,true));
      assert.equal(saved.reportMonths,9);assert.equal(saved.modelVersion,JAN_SEP_MODEL_VERSION);assert.equal(saved.result.annualRevenue,3000);
      assert.deepEqual(saved.analysisPeriod,source.analysisPeriod);assert.equal(saved.monthlyInputs.length,9);
      const rebuilt=await rebuildSimulationSource(saved);
      assert.deepEqual(rebuilt.fields,source.fields);assert.deepEqual(rebuilt.importedOperationAudit,source.importedOperationAudit);
      assert.deepEqual(rebuilt.commercialComposition,source.commercialComposition);
      assert.equal(planReprocessing(saved,rebuilt,scope().workspaceId).alreadyCurrent,true);
      const bad=structuredClone(saved);bad.source.importedOperationAudit.reportSalesCents++;
      await assert.rejects(rebuildSimulationSource(bad),code('REPROCESS_SOURCE'));
      assert.deepEqual(await getSimulation(legacy._id),original);assert.deepEqual(await createSimulation(actor,legacyInput),original);
      assert.deepEqual(await lines.find(scope({jobId:{$in:ids.jobs}})).sort({jobId:1,index:1}).toArray(),before);
    });

    await t.test('entradas Jan–Set e saídas Jan–Dez são compatíveis quando ambas cobrem os nove meses',async()=>{
      const ids=await fixture('99282',[['2026-01',10000],['2026-09',20000]],
        [['2026-01',100000],['2026-09',200000],['2026-12',900000]]);
      await assert.rejects(generationSimulator(ids.generationId,ids.clientId),code('SIMULATOR_PERIOD'));
      const source=await generationSimulator(ids.generationId,ids.clientId,options);
      assert.equal(source.analysisPeriod!.complete,true);assert.equal(source.fields.salesCpfCents,300000);
      assert.equal(source.importedPeriods!.purchases!.months,9);assert.equal(source.importedPeriods!.sales!.months,12);
      assert.equal((await createSimulation(actor,input(source,true))).result.annualRevenue,3000);
    });

    await t.test('ausência em um arquivo é excluída; Contábil incompleto reduz a DRE aos meses preenchidos',async()=>{
      const ids=await fixture('99283',[['2026-02',10000],['2026-09',20000]],
        [['2026-01',100000],['2026-09',200000],['2026-12',900000]]);
      const source=await generationSimulator(ids.generationId,ids.clientId,options);
      assert.equal(source.analysisPeriod!.complete,true);assert.deepEqual(source.analysisPeriod!.missingMonths,['2026-01']);
      assert.equal(source.reportMonths,8);assert.equal(source.monthlyReports.length,8);
      assert.ok(source.monthlyReports.every(row=>row.sourceMonth!=='2026-01'));
      const standalone=await createSimulation(actor,input(source,true));assert.equal(standalone.reportMonths,8);
      let analysis=(await openAnalysis(actor,{clientId:ids.clientId,year:2027,regimeSelection})).analysis;
      analysis=(await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{...analysis.fiscal.data,generationId:ids.generationId}})).analysis;
      const months=analysisMonthsForYear(2026).map(sourceMonth=>({sourceMonth,
        ...Object.fromEntries(ACCOUNTING_FIELDS.map(field=>[field,['2026-02','2026-09'].includes(sourceMonth)?100:null]))}));
      analysis=(await updateAnalysisSector(actor,analysis.id,'accounting',{expectedSectorRevision:analysis.accounting.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{months}})).analysis;
      assert.equal(analysis.readiness.ready,true);assert.deepEqual(analysis.readiness.months,['2026-02','2026-09']);
      const saved=(await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision})).simulation;
      assert.equal(saved.reportMonths,2);assert.equal(saved.monthlyInputs.length,2);assert.equal(saved.result.annualRevenue,2000);
      assert.deepEqual(saved.analysisPeriod.includedMonths,['2026-02','2026-09']);
      assert.equal(saved.monthlyDre.months.length,2);assert.equal(saved.result.regimes[0].dre.salaries,-2);
      const rebuilt=await rebuildSimulationSource(saved);assert.deepEqual(rebuilt.analysisPeriod,saved.analysisPeriod);
      assert.equal(planReprocessing(saved,rebuilt,scope().workspaceId).alreadyCurrent,true);
      const viewed=await getAnalysis(analysis.id,{includeSource:true});
      assert.deepEqual(viewed.analysis.readiness.months,['2026-02','2026-09']);
      assert.equal(viewed.analysis.accounting.data.months.length,9,'Campos vazios continuam disponíveis para editar.');
    });

    await t.test('OCR 2.2 parcial calcula apenas a competência com doze receitas históricas confirmadas',async()=>{
      const ids=await fixture('99285',[['2026-01',10000],['2026-08',30000],['2026-09',10000]],
        [['2026-01',100000],['2026-08',500000],['2026-09',200000]]);
      const extraction=section22(),extractionId=randomUUID();
      await(await collection('simplesExtractions')).insertOne({...scope(),_id:extractionId,clientId:ids.clientId,
        parserVersion:extraction.parserVersion,fileName:'extrato-sintetico.pdf',fileSha256:'synthetic',result:extraction});
      let analysis=(await openAnalysis(actor,{clientId:ids.clientId,year:2027,regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure']}})).analysis;
      analysis=(await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{...analysis.fiscal.data,generationId:ids.generationId,
          rbt12Source:'SIMPLES_SECTION_22',rbt12ExtractionId:extractionId,rbt12:extraction.rbt12Cents/100}})).analysis;
      assert.deepEqual(analysis.fiscal.confirmation!.months,['2026-08']);
      const months=analysisMonthsForYear(2026).map(sourceMonth=>({sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(field=>[field,sourceMonth==='2026-08'?0:null]))}));
      analysis=(await updateAnalysisSector(actor,analysis.id,'accounting',{expectedSectorRevision:analysis.accounting.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{months}})).analysis;
      assert.equal(analysis.readiness.ready,true);
      const saved=(await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision})).simulation;
      assert.equal(saved.reportMonths,1);assert.equal(saved.result.annualRevenue,5000);
      assert.deepEqual(saved.analysisPeriod.includedMonths,['2026-08']);
      assert.equal(saved.rbt12Schedule.rows.length,1);assert.equal(saved.rbt12Schedule.rows[0].window.length,12);
      assert.equal(saved.rbt12Schedule.rows[0].rbt12Cents,extraction.rbt12Cents);
      assert.match(saved.source.warnings.join(' '),/sem RBT12 mensal confirmada/);
      const rebuilt=await rebuildSimulationSource(saved);assert.deepEqual(rebuilt.analysisPeriod,saved.analysisPeriod);
      assert.equal(planReprocessing(saved,rebuilt,scope().workspaceId).alreadyCurrent,true);
    });

    await t.test('conclusão ignora despesas e ajustes Q4 preservados; revisões geram apenas nove competências',async()=>{
      const ids=await fixture('99284',[['2026-01',10000],['2026-09',20000],['2026-12',90000]],
        [['2026-01',100000],['2026-09',200000],['2026-12',900000]]);
      const legacySource=await generationSimulator(ids.generationId,ids.clientId);
      let analysis=(await openAnalysis(actor,{clientId:ids.clientId,year:2027,regimeSelection})).analysis;
      const monthlyOverrides=legacySource.monthlyReports.map(row=>{
        const entry=baselineMonth(row);return {sourceMonth:row.sourceMonth,groups:entry.groups,serviceRevenue:entry.values.serviceRevenue};
      });
      // First link the sources; a later explicit edit can restore their stored overrides.
      analysis=(await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
        expectedConfigRevision:analysis.config.revision,complete:false,data:{...analysis.fiscal.data,generationId:ids.generationId}})).analysis;
      analysis=(await updateAnalysisSector(actor,analysis.id,'fiscal',{expectedSectorRevision:analysis.fiscal.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{...analysis.fiscal.data,monthlyOverrides}})).analysis;
      const months=legacySource.monthlyReports.map(row=>({sourceMonth:row.sourceMonth,
        ...Object.fromEntries(ACCOUNTING_FIELDS.map(field=>[field,row.month<=9?(field==='salariesCents'?row.month*100:0):null]))}));
      analysis=(await updateAnalysisSector(actor,analysis.id,'accounting',{expectedSectorRevision:analysis.accounting.revision,
        expectedConfigRevision:analysis.config.revision,complete:true,data:{months}})).analysis;
      assert.equal(analysis.accounting.data.months.length,12);assert.equal(analysis.fiscal.data.monthlyOverrides!.length,12);
      assert.equal(analysis.readiness.ready,true);assert.equal(analysis.periodPolicy,JAN_SEP_POLICY);
      const saved=await generateAnalysis(actor,analysis.id,{requestId:randomUUID(),expectedRevision:analysis.revision});
      assert.equal(saved.simulation.monthlyInputs.length,9);assert.equal(saved.simulation.result.annualRevenue,3000);
      assert.equal(saved.simulation.monthlyInputs.reduce((sum:number,row:any)=>sum+row.values.salaries,0),45);
      const revisions=await(await collection('analysisRevisions')).find(scope({analysisId:analysis.id,kind:'accounting'})).toArray();
      assert.ok(revisions.some(row=>row.data.data.months.length===12));
    });
  }finally{
    await(await database()).dropDatabase();await closeDatabase();resetLookupIndexes();
    if(oldDb===undefined)delete process.env.MONGODB_DB;else process.env.MONGODB_DB=oldDb;
    if(oldWs===undefined)delete process.env.WORKSPACE_ID;else process.env.WORKSPACE_ID=oldWs;
  }
});
