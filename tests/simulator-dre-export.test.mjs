import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDreCsv, buildDreExportPayload} from '../public/simulator-dre-export.js';
import {buildDrePresentation, unifiedDreRows, dreReportCoverage, dreRegimeStatuses} from '../public/simulator-dre.js';
import {renderDrePrintDocument,renderAnnualDre} from '../public/simulator-dre-view.js';
import {buildMonthlyDre, DRE_ROWS} from '../public/simulator-calendar.js';

// A small independent CSV reader checks quoted separators/newlines and exact cell counts.
function readCsv(csv) {
  const rows = [];let row = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i+1] === '"') {cell += '"';i++;} else quoted = !quoted;
    } else if (!quoted && char === ';') {row.push(cell);cell = '';}
    else if (!quoted && char === '\r' && csv[i+1] === '\n') {row.push(cell);rows.push(row);row = [];cell = '';i++;}
    else cell += char;
  }
  return rows;
}

function fixture() {
  const row = (key, label, value, extra = {}) => ({key,label,kind:'line',unit:'currency',values:{a:value,b:null},
    monthlyValues:{a:Array(12).fill(value/12),b:Array(12).fill(null)},calendarAnnualValues:{a:value,b:null},
    percentValues:{a:value/1200,b:null},monthlyPercentValues:{a:Array(12).fill(value/1200),b:Array(12).fill(null)},
    calendarAnnualPercentValues:{a:value/1200,b:null},notes:[],reasonByRegime:{b:'Modelo não disponível'},calendarReasonByRegime:{b:'Calendário não disponível'},sourceRefs:['result.regimes.dre'],...extra});
  return {version:'DRE_PRESENTATION_V1',year:2027,percentBasis:'Receita bruta total do cenário',
    regimes:[{id:'a',name:'Regime A',available:true},{id:'b',name:'Regime B',available:false}],
    sections:[{key:'revenue',label:'Receitas',rows:[row('revenue','Receita bruta total',1200)]},
      {key:'taxes',label:'Tributos',rows:[row('das','DAS',-120)]}],
    details:[{key:'salesBreakdown',label:'Composição das vendas',parentKey:'revenue',rows:[row('salesCpf','Vendas; "CPFs"\nClientes',600,{kind:'detail',parentKey:'revenue',informative:true})]}],
    indicators:[row('netMargin','Margem líquida',0.3,{kind:'indicator',unit:'percent',monthlyValues:{a:Array(12).fill(0.3)},calendarAnnualValues:{a:0.3}})]};
}

test('CSV anual inclui DRE, detalhes e indicadores, BOM e números com sinais sem converter percentuais em moeda', () => {
  const data = fixture(), before = structuredClone(data);
  const csv = buildDreCsv({presentation:data,company:{name:'Empresa sintética',code:'001',cnpj:'00000000000000'},year:2027,showPercent:true});
  assert.equal(csv[0], '\uFEFF');assert(!csv.includes('NaN'));
  const rows = readCsv(csv), header = rows.find(row => row[0] === 'Escopo');
  assert.equal(header.length, 11);
  const money = rows.find(row => row[2] === 'DAS');
  assert.equal(money[5], '-120,00');assert.equal(money[6], '-10,00');assert.equal(money[7], 'Não disponível');
  assert(!csv.includes("'-120,00"));
  const detail = rows.find(row => row[2] === 'Vendas; "CPFs"\nClientes');
  assert.equal(detail[0], 'Detalhamento informativo');assert.match(detail[9], /não somar novamente/);
  const indicator = rows.find(row => row[2] === 'Margem líquida');
  assert.equal(indicator[4], '%');assert.equal(indicator[5], '30,00');assert.equal(indicator[6], '');
  assert.equal(rows.filter(row => ['DRE','Detalhamento informativo','Indicadores'].includes(row[0])).length, 4);
  assert.deepEqual(rows.filter(row => ['DRE','Detalhamento informativo','Indicadores'].includes(row[0])).map(row => row[2]), ['Receita bruta total','Vendas; "CPFs"\nClientes','DAS','Margem líquida']);
  assert.deepEqual(data, before);
});

test('CSV mensal mantém uma tabela e um cabeçalho com doze meses, total e todos os regimes na ordem unificada', () => {
  const data = fixture();
  data.sections[1].rows[0].monthlyValues.a[0] = -99.75;
  data.sections[1].rows[0].calendarAnnualValues.a = -999;
  const rows = readCsv(buildDreCsv({presentation:data,period:'monthly',showPercent:false}));
  const headers = rows.filter(row => row[0] === 'Regime');
  assert.equal(headers.length, 1);assert.equal(headers[0].length, 21);
  assert.equal(headers[0][6], 'Janeiro');assert.equal(headers[0][17], 'Dezembro');assert.equal(headers[0][18], 'Total anual / indicador anual');
  const taxes = rows.filter(row => row[3] === 'DAS');
  assert.equal(taxes[0][6], '-99,75');assert.equal(taxes[0][7], '-10,00');assert.equal(taxes[0][18], '-999,00');
  assert(taxes[1].slice(6,19).every(value => value === 'Não disponível'));
  assert.match(taxes[1][19], /Calendário não disponível/);
  const indicators = rows.filter(row => row[3] === 'Margem líquida');
  assert(indicators[0].slice(6,19).every(value => value === '30,00'));
  const dataRows = rows.filter(row => ['DRE','Detalhamento informativo','Indicadores','Conferência da receita','Apuração do crédito de ICMS'].includes(row[1]));
  assert.equal(dataRows.length, 8);
  assert.deepEqual([...new Set(dataRows.map(row => row[0]))], ['Regime A','Regime B']);
  for (const name of ['Regime A','Regime B']) assert.deepEqual(dataRows.filter(row => row[0] === name).map(row => row[3]), ['Receita bruta total','Vendas; "CPFs"\nClientes','DAS','Margem líquida']);
  assert(dataRows.every(row => row.length === headers[0].length));
});

test('CSV neutraliza fórmulas em nomes, rótulos e notas e mantém aspas, separadores e quebras de linha', () => {
  const data = fixture();data.regimes[0].name = '  =HYPERLINK("https://invalid")';
  data.sections[0].rows[0].label = '@SUM(A1:A2)';data.sections[0].rows[0].notes = ['\t+1'];
  const rows = readCsv(buildDreCsv({presentation:data,company:{name:'=1+1;"nome"\nsegundo',code:'-001',cnpj:'\r@x'}}));
  const company = rows.find(row => row[0] === 'Empresa');
  assert.equal(company[1], '\'=1+1;"nome"\nsegundo');assert.equal(company[3], "'-001");assert.equal(company[5], "'\r@x");
  assert.equal(rows.find(row => row[0] === 'Escopo')[5], '\'  =HYPERLINK("https://invalid")');
  const revenue = rows.find(row => row[2] === "'@SUM(A1:A2)");assert(revenue);assert(revenue[7].startsWith("'\t+1"));
});

test('Legado sem detalhe e sem DIFAL conserva ausência, valores não disponíveis e JSON original intacto', () => {
  const data = fixture();delete data.sections[0].rows[0].monthlyValues;data.details = [];
  const csv = buildDreCsv({presentation:data,period:'monthly'});
  assert(!csv.includes('DIFAL'));assert(!csv.includes('NaN'));assert(!csv.includes('undefined'));
  const revenue = readCsv(csv).find(row => row[3] === 'Receita bruta total');
  assert(revenue.slice(6,18).every(value => value === 'Não disponível'));
  const snapshot = Object.freeze({_id:'synthetic',modelVersion:'legacy',result:Object.freeze({captured:123}),monthlyDre:Object.freeze({version:'DRE_CALENDAR_V1'}),extra:{untouched:true}});
  const before = JSON.stringify(snapshot), exported = buildDreExportPayload(snapshot,data);
  assert.notEqual(exported,snapshot);assert.equal(exported.result,snapshot.result);assert.equal(exported.monthlyDre,snapshot.monthlyDre);
  assert.equal(exported.drePresentation,data);assert.equal(JSON.stringify(snapshot),before);
  const {drePresentation, ...original} = exported;assert.deepEqual(original,snapshot);
});

test('Integração com a apresentação compartilhada preserva calendário divergente e análise vertical do mesmo mês', () => {
  const dre = Object.fromEntries(DRE_ROWS.map(([key]) => [key,0]));
  Object.assign(dre,{services:200,sales:1000,revenue:1200,netRevenue:1200,grossProfit:1200,preTax:1200,netProfit:1200});
  const result = {regimes:[{id:'pure',name:'Cenário sintético',available:true,dre,margin:1,totalTaxes:0,taxBurden:0}],memory:[]};
  const calendar = buildMonthlyDre(result,2027);
  const savedRevenue = calendar.regimes[0].rows.find(row => row.key === 'revenue');
  savedRevenue.months[0] = 300;savedRevenue.annual = 2400;
  const before = structuredClone({result,calendar});
  const presentation = buildDrePresentation({result,calendar});
  const rows = readCsv(buildDreCsv({presentation,period:'monthly',showPercent:true}));
  const header = rows.find(row => row[0] === 'Regime');assert.equal(header.length,34);
  const revenue = rows.find(row => row[3] === 'Receita total utilizada');
  assert.equal(revenue[6],'300,00');assert.equal(revenue[7],'100,00');assert.equal(revenue[30],'2400,00');assert.equal(revenue[31],'100,00');
  const sales = rows.find(row => row[3] === 'Receita de vendas utilizada');
  assert.equal(sales[6],'83,33');assert.equal(sales[7],'27,777778');
  const dataRows = rows.filter(row => ['DRE','Detalhamento informativo','Indicadores','Conferência da receita','Apuração do crédito de ICMS'].includes(row[1]));
  // Spreadsheet text escaping changes only the protective prefix, never row order.
  assert.deepEqual(dataRows.map(row => row[3].replace(/^'/,'')), unifiedDreRows(presentation).map(row => row.label));
  assert.deepEqual({result,calendar},before);
});

test('relatório completo inclui anual antes dos meses de todos os regimes e preserva cobertura, causas e premissas',()=>{
  const data=fixture();data.method='REPORT_MONTHS_V1';
  data.months=Array.from({length:12},(_,index)=>({number:index+1,label:['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][index],sourceMonth:index<2?`2025-0${index+1}`:null}));
  Object.assign(data.regimes[1],{status:'RBT12 não registrada',monthlyAvailability:[true,false,...Array(10).fill(false)],monthlyStatuses:['Calculado','Informe a RBT12',...Array(10).fill('Sem dados importados')]});
  data.report={modelVersion:'synthetic',sourceMonths:['2025-01','2025-02'],warnings:[{code:'model-period',title:'Cenário de 2027/2028',detail:'CBS de 9,11% e IBS de 0,10% são hipóteses editáveis.'}],memory:[{id:'rbt12',section:'Premissas',label:'RBT12 de referência',formula:'Receitas dos 12 meses anteriores',value:3300000,unit:'currency'}],sources:[{label:'Fonte oficial capturada',url:'https://example.invalid/norma'}]};
  data.simplesDiagnostic={version:'SIMPLES_DIAGNOSTIC_V1',available:true,statusCode:'READY',message:'Cenário calculado com a receita das competências.',action:'Conferir enquadramento e premissas.',rbt12:3300000,federalLimit:4800000,sublimit:3600000,revenueReference:1200,revenueBasis:'ACTUAL_REPORT_MONTHS',assumptions:['RBT12 determina a faixa; não é a RBA.']};
  const before=structuredClone(data),calendar={version:'DRE_CALENDAR_V3',year:2027,months:data.months};
  const annual=renderDrePrintDocument({presentation:data,calendar,year:2027,period:'annual'});
  assert.match(annual,/DRE anual consolidada/);assert(!annual.includes('data-report-part="monthly"'));
  const monthly=renderDrePrintDocument({presentation:data,calendar,year:2027,period:'monthly'});
  assert(!monthly.includes('data-report-part="annual"'));assert.equal((monthly.match(/data-report-part="monthly"/g)||[]).length,2);
  const complete=renderDrePrintDocument({presentation:data,calendar,year:2027,period:'complete'});
  assert(complete.indexOf('data-report-part="annual"')<complete.indexOf('data-report-part="monthly"'));
  assert.equal((complete.match(/data-report-part="monthly"/g)||[]).length,2);
  assert.equal((complete.match(/data-report-memory="rbt12"/g)||[]).length,1);
  for(const phrase of ['2 de 12 competências','2025-01 a 2025-02','Origem: 2025-01','Cenário 2027','RBT12 não registrada','Informe a RBT12','CBS de 9,11%','Fonte oficial capturada','4.800.000,00','3.600.000,00'])assert(complete.includes(phrase),phrase);
  assert(!complete.includes('NaN'));assert(!complete.includes('undefined'));
  const csv=readCsv(buildDreCsv({presentation:data,period:'complete',year:2027}));
  assert.equal(csv.filter(row=>row[0]==='Escopo').length,1);assert.equal(csv.filter(row=>row[0]==='Regime').length,1);
  assert(csv.findIndex(row=>row[0]==='Escopo')<csv.findIndex(row=>row[0]==='Regime'));
  assert.equal(csv.filter(row=>row[0]==='DRE'&&row[2]==='DAS').length,1);
  assert.equal(csv.filter(row=>row[1]==='DRE'&&row[3]==='DAS').length,2);
  assert.equal(csv.filter(row=>row[0]==='Memória').length,1);
  assert.match(renderAnnualDre({presentation:data,calendar,year:2027}),/value="complete" selected/);
  assert.deepEqual(data,before);
});

test('cobertura só confirma exercício completo com doze meses do mesmo ano e diagnóstico não reinterpreta legado',()=>{
  const data=fixture();data.method='REPORT_MONTHS_V1';
  const months=Array.from({length:12},(_,index)=>`2025-${String(index+1).padStart(2,'0')}`);
  data.report={sourceMonths:months};assert.equal(dreReportCoverage(data).completeYear,true);
  data.report.sourceMonths=['2024-12',...months.slice(0,11)];assert.equal(dreReportCoverage(data).completeYear,false);
  data.report.sourceMonths=['2025-01','2025-01'];assert.equal(dreReportCoverage(data).count,1);
  data.report.sourceMonths=[];assert.match(dreReportCoverage(data).detail,/não está disponível/);
  const legacy=fixture();assert.equal(dreReportCoverage(legacy).actual,false);
  assert(!renderDrePrintDocument({presentation:legacy,year:2027}).includes('data-simples-diagnostic'));
  assert.equal(dreRegimeStatuses(legacy)[1].status,'Motivo não registrado nesta versão.');
});

test('relatório escapa texto e não transforma referência inválida em link executável',()=>{
  const data=fixture();data.report={warnings:[{code:'test',title:'<script>alert(1)</script>',detail:'Texto <b>não confiável</b>'}],sources:[{label:'@origem',url:'javascript:alert(1)'}]};
  const html=renderDrePrintDocument({presentation:data,year:2027,period:'complete',company:{name:'<img src=x onerror=alert(1)>'}});
  assert(!html.includes('<script>'));assert(!html.includes('<img '));assert(!html.includes('href="javascript:'));
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
  const csv=readCsv(buildDreCsv({presentation:data,period:'complete',company:{name:'=1+1'}}));
  assert.equal(csv.find(row=>row[0]==='Empresa')[1],"'=1+1");
  assert.equal(csv.find(row=>row[0]==='Referência normativa')[1],"'@origem");
});

test('memória histórica do Simples pendente não publica imposto não confirmado como valor calculado',()=>{
  const data=fixture();data.regimes[1].id='pure';
  data.report={memory:[{id:'simples.pureDas',section:'Simples Nacional',label:'DAS puro',formula:'Valor histórico não confirmado',value:98765.43,unit:'currency'},
    {id:'simples.sales.deduction',section:'Simples Nacional',label:'Parcela a deduzir da tabela',formula:'Parâmetro',value:87300,unit:'currency'}]};
  const before=structuredClone(data);
  const html=renderDrePrintDocument({presentation:data,year:2027,period:'annual'});
  assert(!html.includes('98.765,43'));assert.match(html,/Não disponível: o cálculo do Simples exige conferência/);assert.match(html,/87.300,00/);
  const rows=readCsv(buildDreCsv({presentation:data}));
  assert.match(rows.find(row=>row[0]==='Memória'&&row[2]==='DAS puro')[4],/Não disponível/);
  assert.equal(rows.find(row=>row[0]==='Memória'&&row[2]==='Parcela a deduzir da tabela')[4],'87300,00');
  assert.deepEqual(data,before);
});

test('CSV anual, mensal e completo terminam a DRE com apuração informativa de ICMS sem duplicar o abatimento',()=>{
  const dre=Object.fromEntries(DRE_ROWS.map(([key])=>[key,0]));
  Object.assign(dre,{sales:2700,revenue:2700,icmsNet:-264,netRevenue:2436,cmvRegular:-1400,cmv:-1400,grossProfit:1036,preTax:1036,netProfit:1036,icmsUsed:156,icmsBalance:0});
  const result={version:'histórico sintético',annualRevenue:2700,credits:{icms:{debit:420,potential:156,used:156,due:264,balance:0}},
    memory:[{id:'icms.purchaseCredit',section:'Apuração de ICMS',label:'Crédito das compras',formula:'Memória capturada',value:114,unit:'currency'},
      {id:'icms.returnCredit',section:'Apuração de ICMS',label:'Crédito das devoluções',formula:'Memória capturada',value:42,unit:'currency'}],
    regimes:[{id:'actual',name:'Lucro Real',available:true,dre,annualProfit:1036,totalTaxes:264,margin:1036/2700,taxBurden:264/2700}]};
  const presentation=buildDrePresentation({result,calendar:buildMonthlyDre(result,2027)}),before=structuredClone(presentation);
  const labels=presentation.icmsReconciliation.rows.map(row=>row.label),scope='Apuração do crédito de ICMS';
  for(const period of ['annual','monthly','complete']){
    const csv=readCsv(buildDreCsv({presentation,period,year:2027}));
    const annual=csv.filter(row=>row[0]===scope),monthly=csv.filter(row=>row[0]==='Lucro Real'&&row[1]===scope);
    assert.equal(annual.length,period==='monthly'?0:7);assert.equal(monthly.length,period==='annual'?0:7);
    if(annual.length){
      assert.deepEqual(annual.map(row=>row[2]),labels);assert.deepEqual(annual.map(row=>row[5]),['420,00','156,00','114,00','42,00','156,00','264,00','0,00']);
      assert(csv.indexOf(annual[0])>csv.findIndex(row=>row[0]==='Conferência da receita'&&row[2].includes('Receita utilizada')));
      assert.equal(csv.find(row=>row[0]==='DRE'&&row[2]==="'− ICMS líquido fora do DAS")[5],'-264,00');
      assert.equal(csv.find(row=>row[0]==='DRE'&&row[2]==='Resultado líquido')[5],'1036,00');
    }
    if(monthly.length){
      assert.deepEqual(monthly.map(row=>row[3]),labels);
      assert.deepEqual(monthly[1].slice(6,19),[...Array(12).fill('13,00'),'156,00']);
      assert.deepEqual(monthly[2].slice(6,19),[...Array(12).fill('9,50'),'114,00']);
      assert.deepEqual(monthly[3].slice(6,19),[...Array(12).fill('3,50'),'42,00']);
      assert(csv.indexOf(monthly[0])>csv.findIndex(row=>row[1]==='Conferência da receita'&&row[3].includes('Receita utilizada')));
    }
    for(const row of [...annual,...monthly])assert(row.at(-2).includes('não somar novamente'));
  }
  assert.deepEqual(presentation,before);
});
