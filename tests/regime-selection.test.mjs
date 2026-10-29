import test from 'node:test';
import assert from 'node:assert/strict';
import {REGIME_IDS,REGIME_SELECTION_VERSION,REGIME_LABELS,defaultRegimeSelection,parseRegimeSelection,resolveRegimeSelection,requiresSimplesReference} from '../public/regime-selection.js';
import {EXAMPLE_INPUT,calculateTax,calculateSimulation,createEmptyDraft,draftToInput,taxInputSchema} from '../public/simulator-engine.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {summarizeIcmsOperations} from '../public/simulator-icms.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,unifiedDreRows,dreReportMemory,dreDifalNotes} from '../public/simulator-dre.js';
import {buildDreCsv,buildDreExportPayload} from '../public/simulator-dre-export.js';
import {renderAnnualDre,renderCompleteMonthlyDre,renderDrePrintDocument} from '../public/simulator-dre-view.js';
import {renderSimulationCharts} from '../public/simulation-charts.js';

const selection=(...selected)=>({version:REGIME_SELECTION_VERSION,selected});
const draft=(selected=REGIME_IDS)=>({...createEmptyDraft(),rbt12:EXAMPLE_INPUT.rbt12,regimeSelection:selection(...selected),
  values:Object.fromEntries(Object.keys(createEmptyDraft().values).map(key=>[key,EXAMPLE_INPUT[key]]))});
const financial=regime=>Object.fromEntries(['id','name','available','annualProfit','monthlyProfit','totalTaxes','margin','taxBurden','dre'].map(key=>[key,regime[key]]));
const makeReport=(month,salesCents,servicesCents=0)=>({sourceMonth:`2026-${String(month).padStart(2,'0')}`,month,salesLines:1,purchaseLines:1,
  fields:{salesOptantCents:0,salesNonOptantCents:salesCents,salesCpfCents:0,purchasesOptantCents:10000,purchasesNonOptantCents:20000,serviceRevenueCents:servicesCents},
  difal:{version:'DIFAL_ESTIMATE_V2',ratePercent:10,issuerUf:'MG',amountCents:100,baseCents:1000,eligibleLines:1,pendingLines:0},
  anticipation:{version:'ICMS_ANTICIPATION_V4',ratePercent:7.32,issuerUf:'MG',amountCents:732,baseCents:10000,eligibleLines:1,pendingLines:0}});
function readCsv(csv){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=1;i<csv.length;i++){
    const char=csv[i];
    if(char==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&char===';'){row.push(cell);cell='';}
    else if(!quoted&&char==='\r'&&csv[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else cell+=char;
  }
  return rows;
}

test('seleção estrita: legado mantém quatro e explícita exige IDs únicos válidos em ordem canônica',()=>{
  assert.deepEqual(resolveRegimeSelection(),defaultRegimeSelection());
  const source=selection('actual','pure'),before=structuredClone(source);
  assert.deepEqual(parseRegimeSelection(source),selection('pure','actual'));assert.deepEqual(source,before);
  const defaults=defaultRegimeSelection();defaults.selected.pop();assert.equal(defaultRegimeSelection().selected.length,4);
  for(const value of [null,{},[],selection(),selection('unknown'),selection('pure','pure'),selection(undefined),{version:'old',selected:['pure']},{...selection('actual'),extra:true},{version:REGIME_SELECTION_VERSION,selected:Array(1)}]){
    assert.throws(()=>parseRegimeSelection(value),/regimeSelection/);
  }
  assert.equal(requiresSimplesReference(),true);
  for(const selected of [['pure'],['hybrid'],['actual','hybrid']])assert.equal(requiresSimplesReference(selection(...selected)),true);
  for(const selected of [['presumed'],['actual'],['presumed','actual']])assert.equal(requiresSimplesReference(selection(...selected)),false);
});

test('as 15 combinações preservam integralmente os valores calculados e restringem o ranking',()=>{
  for(const icmsOutside of [false,true]){
    const input={...structuredClone(EXAMPLE_INPUT),icmsOutside},full=calculateTax(input);
    for(let mask=1;mask<16;mask++){
      const selected=REGIME_IDS.filter((_,index)=>mask&(1<<index)),raw={...input,regimeSelection:selection(...selected.slice().reverse())};
      if(!requiresSimplesReference(raw.regimeSelection))delete raw.rbt12;
      const before=structuredClone(raw),result=calculateTax(raw);
      assert.deepEqual(result.regimeSelection,selection(...selected));assert.deepEqual(result.regimes.map(row=>row.id),selected);
      assert.deepEqual(result.regimes.map(financial),full.regimes.filter(row=>selected.includes(row.id)).map(financial));
      const expected=full.regimes.filter(row=>selected.includes(row.id)&&row.available).sort((a,b)=>b.annualProfit-a.annualProfit);
      assert.equal(result.bestRegimeId,expected[0]?.id??null);
      assert.equal(result.difference,expected.length>1?expected[0].annualProfit-expected.at(-1).annualProfit:0);
      assert.deepEqual(raw,before);
    }
  }
});

test('LP/LR sem extrato nem RBT12 usam referência nula e omitem diagnóstico e memória do Simples',()=>{
  for(const selected of [['presumed'],['actual'],['presumed','actual']]){
    const d=draft(selected);delete d.rbt12;
    const input=draftToInput(d),result=calculateSimulation(d);
    assert.equal(input.rbt12,null);assert.equal(Object.hasOwn(result,'simplesDiagnostic'),false);
    assert(!result.memory.some(row=>/^(simples\.|rbt12$|sublimit$|simplesLimit$|outside$|difal\.|icmsAnticipation\.)/.test(row.id)));
    assert(!result.warnings.some(row=>/^(rbt12|estimated-rbt12|simples-|sublimit|service-annex|annex-iv|difal-|icms-anticipation)/.test(row.code)));
    assert(result.regimes.every(row=>row.difalApplication.rbt12===null));
    const stale=calculateSimulation({...d,rbt12:9_999_999});
    assert.deepEqual(stale.regimes,result.regimes);assert.deepEqual(stale.memory,result.memory);
    assert.equal(buildMonthlyDre(result,2027).method,'AVERAGE_X12_NO_RBT12');
  }
});

test('seleção explícita de Simples permite referência ausente, sem produzir estimativa automática',()=>{
  for(const selected of [['pure'],['hybrid'],['hybrid','actual'],REGIME_IDS]){
    const d=draft(selected);delete d.rbt12;
    assert.equal(draftToInput(d).rbt12,null);
    const missing=calculateSimulation(d);
    assert.equal(missing.rbt12Source,'NOT_PROVIDED');assert.equal(missing.simplesDiagnostic.rbt12,null);
    assert(missing.regimes.every(row=>row.available===!['pure','hybrid'].includes(row.id)));
    assert(!missing.warnings.some(row=>row.code==='estimated-rbt12'));
    d.rbt12=null;assert.deepEqual(calculateSimulation(d),missing);
    d.rbt12=0;assert(draftToInput(d));assert.equal(calculateSimulation(d).simplesDiagnostic.statusCode,'MISSING_RBT12');
  }
  const legacy=draft();delete legacy.regimeSelection;delete legacy.rbt12;
  const result=calculateSimulation(legacy);
  assert.deepEqual(result.regimes.map(row=>row.id),REGIME_IDS);assert(result.warnings.some(row=>row.code==='estimated-rbt12'));
  assert.equal(taxInputSchema.safeParse({...EXAMPLE_INPUT,regimeSelection:null}).success,false);
});

test('seleção parcial filtra cálculo e memória de regimes excluídos, preservando a política DIFAL completa',()=>{
  for(const selected of [['pure'],['hybrid'],['presumed'],['actual'],['hybrid','actual']]){
    const result=calculateSimulation(draft(selected));
    for(const id of REGIME_IDS.filter(id=>!selected.includes(id))){
      assert(!result.memory.some(row=>row.id.startsWith(`dre.${id}.`)||row.id.startsWith(`summary.${id}.`)||row.id.startsWith(`difal.option.${id}`)));
      if(['presumed','actual'].includes(id))assert(!result.memory.some(row=>row.id.startsWith(id+'.')));
    }
    assert.deepEqual(Object.keys(result.difalPolicy.enabled),REGIME_IDS);
    if(!selected.includes('hybrid'))assert(!result.memory.some(row=>['simples.hybridDas','simples.cbsRemoved','simples.ibsRemoved'].includes(row.id)));
    if(!selected.includes('pure'))assert(!result.memory.some(row=>row.id==='simples.pureDas'));
    if(!selected.includes('presumed'))assert(!result.warnings.some(row=>row.code.startsWith('presum')));
  }
});

test('competências sazonais mantêm receitas e tributos dos regimes escolhidos sem depender do extrato',()=>{
  const reports=[makeReport(1,50_000_000),makeReport(2,140_000_000),makeReport(3,140_000_000)],inputs=reports.map(row=>baselineMonth(row));
  const all={...draft(),rbt12:3_300_000},before=structuredClone({reports,inputs,all}),full=calculateMonthlySimulation(all,reports,inputs,'sales');
  for(const selected of [['presumed'],['actual'],['presumed','actual']]){
    const d={...all,regimeSelection:selection(...selected)};delete d.rbt12;
    const out=calculateMonthlySimulation(d,reports,inputs,'sales');
    assert.equal(out.result.annualRevenue,3_300_000);assert.equal(out.engineInput.rbt12,null);
    assert.equal(Object.hasOwn(out.result,'simplesDiagnostic'),false);assert.equal(Object.hasOwn(out.result,'rbt12Schedule'),false);
    assert.deepEqual(out.result.regimes.map(financial),full.result.regimes.filter(row=>selected.includes(row.id)).map(financial));
    assert(out.engineInput.months.every(row=>row.input.rbt12===null));
    assert(!out.result.warnings.some(row=>row.code==='presumption-increase'));
    assert(!out.result.memory.some(row=>row.id.startsWith('simples.')||row.id==='rbt12'));
    assert.equal(out.result.memory.find(row=>row.id==='revenue.reference').value,3_300_000);
    for(const [index,month] of out.result.monthlyResults.entries())assert.deepEqual(month.result.regimes.map(financial),full.result.monthlyResults[index].result.regimes.filter(row=>selected.includes(row.id)).map(financial));
    assert.throws(()=>calculateMonthlySimulation(d,reports,inputs,'sales',{version:'RBT12_MONTHLY_SECTION_22_V1'}),/não se aplica/);
  }
  assert.deepEqual({reports,inputs,all},before);
});

test('regime único mantém mensal, anual, CSV e impressão sem colunas ou demonstrativos de excluídos',()=>{
  const reports=[makeReport(1,100_001,30_005),makeReport(3,400_009,10_003)],inputs=reports.map(row=>baselineMonth(row));
  for(const id of REGIME_IDS){
    const d=draft([id]);if(!requiresSimplesReference(d.regimeSelection))delete d.rbt12;
    const out=calculateMonthlySimulation(d,reports,inputs,'sales'),calendar=buildMonthlyDre(out.result,2027);
    const original=structuredClone(out),presentation=buildDrePresentation({result:out.result,calendar,engineInput:out.engineInput,projection:out.projection,source:{monthlyReports:reports}});
    assert.deepEqual(presentation.regimes.map(row=>row.id),[id]);assert.deepEqual(calendar.regimes.map(row=>row.id),[id]);
    for(const row of unifiedDreRows(presentation))assert.deepEqual(Object.keys(row.values),[id]);
    const profit=unifiedDreRows(presentation).find(row=>row.key==='netProfit');
    assert.equal(profit.monthlyValues[id][1],null);assert.equal(profit.values[id],out.result.regimes[0].annualProfit);
    for(const period of ['annual','monthly','complete']){
      const csvRows=readCsv(buildDreCsv({presentation,period,year:2027})),print=renderDrePrintDocument({presentation,calendar,year:2027,period});
      if(period!=='monthly'){
        const header=csvRows.find(row=>row[0]==='Escopo');assert.equal(header.length,8);assert.equal(header[5],REGIME_LABELS[id]);
        assert.match(print,/--dre-regime-count:1/);
      }
      if(period!=='annual'){
        assert.deepEqual([...new Set(csvRows.filter(row=>REGIME_IDS.some(id=>row[0]===REGIME_LABELS[id])).map(row=>row[0]))],[REGIME_LABELS[id]]);
        assert.deepEqual([...print.matchAll(/data-report-regime="([^"]+)"/g)].map(match=>match[1]),[id]);
      }
      for(const excluded of REGIME_IDS.filter(other=>other!==id))assert(!print.includes(`data-report-status="${excluded}"`));
      assert(!print.includes('NaN'));assert(!print.includes('Infinity'));
      if(!requiresSimplesReference(d.regimeSelection)){
        assert(!print.includes('data-simples-diagnostic'));assert(!print.includes('A RBT12 permanece fixa'));
        assert(!csvRows.some(row=>row[0]==='Simples Nacional'));assert.equal(calendar.rbt12Reference,null);
      }
    }
    const html=renderAnnualDre({presentation,calendar,year:2027,regimeId:'excluded'});
    assert.deepEqual([...html.matchAll(/<option value="(pure|hybrid|presumed|actual)"/g)].map(match=>match[1]),[id]);
    assert(renderCompleteMonthlyDre({presentation,calendar,year:2027,regimeId:id,month:0}).includes(REGIME_LABELS[id]));
    const charts=renderSimulationCharts({result:out.result});
    for(const excluded of REGIME_IDS.filter(other=>other!==id))assert(!charts.includes(REGIME_LABELS[excluded]));
    assert.deepEqual(out,original);
  }
});

test('apresentação e exportação filtram apenas a leitura, sem modificar resultados originais capturados',()=>{
  const result=calculateSimulation(draft()),calendar=buildMonthlyDre(result,2027,{source:'MANUAL',confirmed:true,rbt12Cents:50000000});
  result.regimeSelection=selection('actual');
  const payload={result,calendar,source:{extractionId:'original'}},before=structuredClone(payload);
  const presentation=buildDrePresentation({result,calendar}),exported=buildDreExportPayload(payload,presentation);
  assert.deepEqual(exported.result,before.result);assert.deepEqual(exported.calendar,before.calendar);assert.deepEqual(payload,before);
  assert.deepEqual(presentation.regimes.map(row=>row.id),['actual']);assert.equal(Object.hasOwn(presentation,'simplesDiagnostic'),false);
  assert.equal(presentation.calendarReference,null);assert.deepEqual(dreDifalNotes(presentation),[]);
  assert(!dreReportMemory(presentation,{includeDre:true}).some(row=>/^(simples\.|presumed\.|rbt12$|dre\.(pure|hybrid|presumed)\.)/.test(row.id)));
  const printed=renderDrePrintDocument({presentation,calendar,year:2027});assert(!printed.includes('RBT12 fixa:'));assert(!printed.includes('A RBT12 permanece fixa'));
  delete result.regimeSelection;delete calendar.regimeSelection;
  const legacy=buildDrePresentation({result,calendar});assert.deepEqual(legacy.regimes.map(row=>row.id),REGIME_IDS);
});

test('pendência de UF nos regimes selecionados mantém total anual indisponível e valores válidos por competência',()=>{
  const reports=[1,2].map(month=>{
    const source=summarizeIcmsOperations({sourceMonth:`2026-0${month}`,issuerUf:'MG',purchaseIssuerUf:'MG',
      sales:[{natureCode:'5102',totalCents:100000,recipientUf:month===1?'MG':'',creditGroup:'NAO_OPTANTE'}],purchases:[]});
    const row=makeReport(month,100000);row.fields.purchasesOptantCents=0;row.fields.purchasesNonOptantCents=0;row.icmsOperations=source;return row;
  });
  const d=draft(['actual']);delete d.rbt12;
  const out=calculateMonthlySimulation(d,reports,reports.map(row=>baselineMonth(row)),'sales');
  assert.equal(out.result.bestRegimeId,null);assert.equal(out.result.regimes.length,1);assert.equal(out.result.regimes[0].available,false);
  assert.equal(Object.hasOwn(out.result,'simplesDiagnostic'),false);assert(out.result.monthlyResults[0].result.regimes[0].available);
  const calendar=buildMonthlyDre(out.result,2027),presentation=buildDrePresentation({result:out.result,calendar,engineInput:out.engineInput});
  const net=unifiedDreRows(presentation).find(row=>row.key==='netProfit');
  assert.equal(net.values.actual,null);assert.equal(typeof net.monthlyValues.actual[0],'number');assert.equal(net.monthlyValues.actual[1],null);
  assert(dreReportMemory(presentation).filter(row=>row.id.startsWith('actual.')).every(row=>typeof row.value!=='number'));
  assert(!buildDreCsv({presentation,period:'complete'}).includes('NaN'));
});
