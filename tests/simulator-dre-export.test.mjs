import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDreCsv, buildDreExportPayload} from '../public/simulator-dre-export.js';
import {buildDrePresentation} from '../public/simulator-dre.js';
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
    details:[{key:'salesBreakdown',label:'Composição das vendas',rows:[row('salesCpf','Vendas; "CPFs"\nClientes',600,{informative:true})]}],
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
  assert.deepEqual(data, before);
});

test('CSV mensal exporta doze meses e total de todos os regimes usando valores congelados, sem dividir o anual novamente', () => {
  const data = fixture();
  data.sections[1].rows[0].monthlyValues.a[0] = -99.75;
  data.sections[1].rows[0].calendarAnnualValues.a = -999;
  const rows = readCsv(buildDreCsv({presentation:data,period:'monthly',showPercent:false}));
  assert.deepEqual(rows.filter(row => row[0] === 'Regime tributário').map(row => row[1]), ['Regime A','Regime B']);
  const headers = rows.filter(row => row[0] === 'Escopo');
  assert.equal(headers.length, 2);assert.equal(headers[0].length, 20);
  assert.equal(headers[0][5], 'Janeiro');assert.equal(headers[0][16], 'Dezembro');assert.equal(headers[0][17], 'Total anual / indicador anual');
  const taxes = rows.filter(row => row[2] === 'DAS');
  assert.equal(taxes[0][5], '-99,75');assert.equal(taxes[0][6], '-10,00');assert.equal(taxes[0][17], '-999,00');
  assert(taxes[1].slice(5,18).every(value => value === 'Não disponível'));
  assert.match(taxes[1][18], /Calendário não disponível/);
  const indicators = rows.filter(row => row[2] === 'Margem líquida');
  assert(indicators[0].slice(5,18).every(value => value === '30,00'));
  assert.equal(rows.filter(row => ['DRE','Detalhamento informativo','Indicadores'].includes(row[0])).length, 8);
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
  const revenue = readCsv(csv).find(row => row[2] === 'Receita bruta total');
  assert(revenue.slice(5,17).every(value => value === 'Não disponível'));
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
  const header = rows.find(row => row[0] === 'Escopo');assert.equal(header.length,33);
  const revenue = rows.find(row => row[2] === 'Receita bruta total');
  assert.equal(revenue[5],'300,00');assert.equal(revenue[6],'100,00');assert.equal(revenue[29],'2400,00');assert.equal(revenue[30],'100,00');
  const sales = rows.find(row => row[2] === 'Receita de vendas');
  assert.equal(sales[5],'83,33');assert.equal(sales[6],'27,777778');
  const expectedRows = presentation.sections.reduce((n,section) => n+section.rows.length,0) + presentation.details.reduce((n,section) => n+section.rows.length,0) + presentation.indicators.length;
  assert.equal(rows.filter(row => ['DRE','Detalhamento informativo','Indicadores'].includes(row[0])).length,expectedRows);
  assert.deepEqual({result,calendar},before);
});
