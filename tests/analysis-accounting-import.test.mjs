import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountingPaste,planAccountingPaste,AccountingImportError,ACCOUNTING_IMPORT_COLUMNS,
  ACCOUNTING_IMPORT_MAX_CELL_CENTS,CSV_TEMPLATE,ACCOUNTING_IMPORT_CSV_TEMPLATE} from '../public/analysis-accounting-import.js';

const expenseFields=ACCOUNTING_IMPORT_COLUMNS.slice(1).map(column=>column.key);
const pasted=(month='01/2026',values=['','','','',''],delimiter=';')=>[month,...values].join(delimiter);
const row=(sourceMonth,values=[null,null,null,null,null])=>({sourceMonth,...Object.fromEntries(expenseFields.map((field,index)=>[field,values[index]]))});
const failure=(code,line,column)=>error=>error instanceof AccountingImportError && error.code===code &&
  (line===undefined||error.line===line) && (column===undefined||error.column===column);
const freeze=rows=>Object.freeze(rows.map(value=>Object.freeze(value)));

test('colagem TAB reconhece as seis colunas, ordena meses e preserva os centavos exatos',()=>{
  const text=[pasted('02/2026',['0,29','1.234,56','1234.56','7',''], '\t'),pasted('2026-01',['0.01','0,10','0.20','0','0'], '\t')].join('\r\n');
  const result=parseAccountingPaste(text);
  assert.deepEqual(result.months,[row('2026-01',[1,10,20,0,0]),row('2026-02',[29,123456,123456,700,null])]);
  assert.equal(result.totalCents,247672);assert.equal(result.blankCount,1);assert.equal(result.monthCount,2);
  assert.equal(result.delimiter,'\t');assert.equal(result.hasHeader,false);
});

test('modelo CSV contém cabeçalho e cinco valores vazios, sem zeros implícitos',()=>{
  assert.equal(CSV_TEMPLATE,ACCOUNTING_IMPORT_CSV_TEMPLATE);
  assert.equal(ACCOUNTING_IMPORT_COLUMNS.length,6);
  assert.ok(Object.isFrozen(ACCOUNTING_IMPORT_COLUMNS));assert.ok(ACCOUNTING_IMPORT_COLUMNS.every(Object.isFrozen));
  const parsed=parseAccountingPaste(CSV_TEMPLATE);
  assert.equal(parsed.hasHeader,true);assert.equal(parsed.delimiter,';');assert.equal(parsed.blankCount,5);assert.equal(parsed.totalCents,0);
  assert.deepEqual(parsed.months,[row('2026-01')]);
});

test('cabeçalhos aceitam aliases portugueses explícitos e acentos sem adivinhar outra ordem',()=>{
  for(const header of [
    'Competência;Salários e pró-labore;Aluguéis;Taxas de cartões;Benefícios;Outras despesas',
    'MES/ANO;SALÁRIOS / PRÓ-LABORE;ALUGUEL;TAXAS CARTAO;BENEFICIOS;DESPESAS ADMINISTRATIVAS',
    'Mês;Salários (R$);Aluguéis (R$);Taxas de cartão (R$);Benefícios (R$);Outras despesas (R$)'
  ])assert.equal(parseAccountingPaste(header+'\n'+pasted()).hasHeader,true);
  assert.throws(()=>parseAccountingPaste('Competência;Aluguéis;Salários;Taxas de cartão;Benefícios;Outras despesas\n'+pasted()),failure('HEADER_FORMAT',1,2));
  assert.throws(()=>parseAccountingPaste('Período;Salários;Aluguéis;Taxas de cartão;Benefícios;Outras despesas\n'+pasted()),failure('HEADER_FORMAT',1,1));
  assert.throws(()=>parseAccountingPaste(CSV_TEMPLATE.split('\n')[0]),failure('EMPTY_PASTE',2,1));
  assert.throws(()=>parseAccountingPaste(pasted('01/2026',['Salários','','','',''])),failure('MONEY_FORMAT',1,2),
    'Uma competência válida não vira cabeçalho só porque uma despesa contém texto.');
});

test('vazio permanece null, zero é explícito e moeda/espaços NBSP são aceitos',()=>{
  const result=parseAccountingPaste(pasted(' 01/2026 ',['  R$\u00a01.234,56  ','R$\u202f0,00','\u00a0','1\u00a0234,56','0']));
  assert.deepEqual(result.months,[row('2026-01',[123456,0,null,123456,0])]);
  assert.equal(result.totalCents,246912);assert.equal(result.blankCount,1);
  assert.deepEqual(parseAccountingPaste(pasted('01/2026',['0','0,0','0.00','',' '])).months,[row('2026-01',[0,0,0,null,null])]);
});

test('ponto com três dígitos é milhar BR e um ou dois dígitos são decimais, sem arredondar',()=>{
  const cases=new Map([
    ['1.234',123400],['1.234.567',123456700],['1234.56',123456],['1234.5',123450],
    ['1234,56',123456],['1.234,5',123450],['1 234,56',123456],['1 234.56',123456],
    ['0001,01',101],['0.001',100],['0,01',1],['0.29',29],['12.345.678,91',1234567891]
  ]);
  for(const [value,expected] of cases)assert.equal(parseAccountingPaste(pasted('01/2026',[value,'','','',''])).months[0].salariesCents,expected,value);
  for(const invalid of ['1234.567','1.2345','1.23.456','1.234.56','12,345','1,234.56','1.234,567','1 23','12 34','1.234 567','1 234.567','1234,','1234.','.29',',29']){
    assert.throws(()=>parseAccountingPaste(pasted('01/2026',[invalid,'','','',''])),failure('MONEY_FORMAT',1,2),invalid);
  }
});

test('limite monetário é exato, inclusive centavo imediatamente abaixo e acima',()=>{
  assert.equal(parseAccountingPaste(pasted('01/2026',['1.000.000.000.000,00','','','',''])).totalCents,ACCOUNTING_IMPORT_MAX_CELL_CENTS);
  assert.equal(parseAccountingPaste(pasted('01/2026',['999.999.999.999,99','','','',''])).totalCents,ACCOUNTING_IMPORT_MAX_CELL_CENTS-1);
  for(const amount of ['1.000.000.000.000,01','1000000000001','90071992547409,92','9'.repeat(100)]){
    assert.throws(()=>parseAccountingPaste(pasted('01/2026',[amount,'','','',''])),failure('MONEY_LIMIT',1,2));
  }
  const months=Array.from({length:12},(_,index)=>pasted(`2026-${String(index+1).padStart(2,'0')}`,Array(5).fill('1000000000000'))).join('\n');
  const full=parseAccountingPaste(months);assert.equal(full.totalCents,6_000_000_000_000_000);assert.ok(Number.isSafeInteger(full.totalCents));
});

test('sinais, negativos, exponenciais, fórmulas e expressões são rejeitados com localização',()=>{
  for(const value of ['-1','-0','+1','1e3','1E-2','=SUM(A1:A2)','=1+2','@A1','1+2','10/2','(12)','NaN','Infinity','R$ -2','R$','R$ R$ 1','1 R$','−1',"'12",'1\u200b00','0x10']){
    assert.throws(()=>parseAccountingPaste(pasted('01/2026',['',value,'','',''])),failure('MONEY_FORMAT',1,3),value);
  }
  try{parseAccountingPaste('Competência;Salários;Aluguéis;Taxas de cartão;Benefícios;Outras despesas\n'+pasted('01/2026',['','=A1','','','']));}
  catch(error){assert.equal(error.line,2);assert.equal(error.column,3);assert.equal(error.field,'rentCents');assert.match(error.message,/Linha 2, coluna 3 \(Aluguéis\)/);assert.match(error.message,/fórmulas/);}
});

test('competências são somente AAAA-MM ou MM/AAAA no intervalo de 2000 a 2099',()=>{
  assert.deepEqual(parseAccountingPaste([pasted('12/2099'),pasted('2000-01')].join('\n')).months.map(value=>value.sourceMonth),['2000-01','2099-12']);
  for(const value of ['2026-1','1/2026','01/26','2026/01','01-2026','01/02/2026','2026-01-01','1999-12','2100-01','2026-00','2026-13','01/20260','Jan/2026','=2026-01','']){
    assert.throws(()=>parseAccountingPaste(pasted(value)),failure('MONTH_FORMAT',1,1),value);
  }
});

test('colunas extras, ausentes e separadores misturados são recusados; vazios finais são preservados',()=>{
  assert.throws(()=>parseAccountingPaste('01/2026;1;2;3;4'),failure('COLUMN_COUNT',1,6));
  assert.throws(()=>parseAccountingPaste('01/2026;1;2;3;4;5;'),failure('COLUMN_COUNT',1,7));
  assert.throws(()=>parseAccountingPaste('01/2026\t1;2;3;4;5'),failure('MIXED_DELIMITERS',1,1));
  assert.throws(()=>parseAccountingPaste(pasted()+'\n'+pasted('02/2026',['','','','',''],'\t')),failure('MIXED_DELIMITERS',2,1));
  assert.throws(()=>parseAccountingPaste('01/2026,1,2,3,4,5'),failure('COLUMN_COUNT',1,1));
  assert.equal(parseAccountingPaste('01/2026;;;;;').blankCount,5);
  assert.throws(()=>parseAccountingPaste('\t\t\t\t\t'),failure('MONTH_FORMAT',1,1));
});

test('BOM, CRLF e linhas vazias nas bordas não mudam dados nem a linha real do erro',()=>{
  assert.equal(parseAccountingPaste('\uFEFF\n '+ '\n'+pasted()+'\r\n\u00a0').monthCount,1);
  assert.throws(()=>parseAccountingPaste('\n\n'+pasted('01/2026',['-1','','','',''])),failure('MONEY_FORMAT',3,2));
  assert.throws(()=>parseAccountingPaste(pasted()+'\n\n'+pasted('02/2026')),failure('COLUMN_COUNT',2,2));
  for(const value of ['', ' \n\u00a0\r\n'])assert.throws(()=>parseAccountingPaste(value),failure('EMPTY_PASTE',1,1));
  for(const value of [null,undefined,[],{}])assert.throws(()=>parseAccountingPaste(value),failure('PASTE_TYPE',1,1));
  assert.throws(()=>parseAccountingPaste(' '.repeat(50_001)),failure('PASTE_LIMIT',1,1));
});

test('células CSV entre aspas são aceitas integralmente, sem multiline ou fechamento parcial',()=>{
  const text='"Competência";"Salários";"Aluguéis";"Taxas de cartão";"Benefícios";"Outras despesas"\n"01/2026";"1.234,56";"0";"";"";""';
  assert.deepEqual(parseAccountingPaste(text).months,[row('2026-01',[123456,0,null,null,null])]);
  for(const invalid of ['01/2026;"1;0;0;0;0','01/2026;"1"x;0;0;0;0','01/2026;1"2";0;0;0;0']){
    assert.throws(()=>parseAccountingPaste(invalid),failure('QUOTED_CELL',1,2));
  }
  assert.throws(()=>parseAccountingPaste('01/2026;"1\n2";0;0;0;0'),failure('QUOTED_CELL',1,2));
});

test('meses repetidos são detectados após normalização e a colagem nunca excede 12',()=>{
  assert.throws(()=>parseAccountingPaste(pasted('2026-01')+'\n'+pasted('01/2026')),failure('DUPLICATE_MONTH',2,1));
  const months=Array.from({length:12},(_,index)=>pasted(`2026-${String(index+1).padStart(2,'0')}`));
  assert.equal(parseAccountingPaste(months.join('\n')).monthCount,12);
  assert.throws(()=>parseAccountingPaste([...months,pasted('2027-01')].join('\n')),failure('MONTH_LIMIT',13,1));
});

test('plano mantém meses externos e substitui todos os campos do mês colado, inclusive null',()=>{
  const current=freeze([row('2026-03',[300,0,null,1,2]),row('2026-01',[100,200,300,400,500])]);
  const pastedMonths=freeze([row('2026-02',[200,0,0,0,0]),row('2026-01',[null,0,null,0,1])]);
  const before=structuredClone({current,pastedMonths});
  const plan=planAccountingPaste(current,pastedMonths);
  assert.deepEqual(plan.months,[row('2026-01',[null,0,null,0,1]),row('2026-02',[200,0,0,0,0]),row('2026-03',[300,0,null,1,2])]);
  assert.deepEqual(plan.addedMonths,['2026-02']);assert.deepEqual(plan.replacedMonths,['2026-01']);
  assert.equal(plan.blankCount,3);assert.equal(plan.totalCents,504);assert.equal(plan.monthCount,3);
  assert.deepEqual({current,pastedMonths},before);assert.notEqual(plan.months[2],current[0]);assert.notEqual(plan.months[0],pastedMonths[1]);
  plan.months[2].salariesCents=999;plan.months[0].salariesCents=777;
  assert.equal(current[0].salariesCents,300);assert.equal(pastedMonths[1].salariesCents,null);
});

test('plano informa sobreposição mesmo quando valores iguais, sem confirmar a substituição automaticamente',()=>{
  const months=freeze([row('2026-01',[0,0,0,0,0])]);
  assert.deepEqual(planAccountingPaste(months,months).replacedMonths,['2026-01']);
  const empty=planAccountingPaste([],months);assert.deepEqual(empty.addedMonths,['2026-01']);assert.deepEqual(empty.replacedMonths,[]);
  assert.equal(empty.blankCount,0);assert.equal(empty.totalCents,0);
});

test('falha do merge é atômica: união com 13 meses não muda nenhuma entrada',()=>{
  const current=freeze(Array.from({length:12},(_,index)=>row(`2026-${String(index+1).padStart(2,'0')}`)));
  const incoming=freeze([row('2027-01',[1,2,3,4,5])]),before=structuredClone({current,incoming});
  assert.throws(()=>planAccountingPaste(current,incoming),failure('MONTH_LIMIT',1,1));
  assert.deepEqual({current,incoming},before);
  assert.equal(planAccountingPaste(current,[row('2026-02')]).monthCount,12);
});

test('merge valida forma, meses, centavos, duplicatas e limites também nos dados atuais',()=>{
  const valid=[row('2026-01')];
  for(const invalid of [undefined,null,{},''])assert.throws(()=>planAccountingPaste(invalid,valid),failure('MONTHS_INPUT'));
  assert.throws(()=>planAccountingPaste([],[]),failure('MONTHS_INPUT'));
  for(const amount of [undefined,'1',-1,.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,ACCOUNTING_IMPORT_MAX_CELL_CENTS+1]){
    assert.throws(()=>planAccountingPaste([row('2026-01',[amount,null,null,null,null])],valid),failure('CENTS_VALUE',1,2));
    assert.throws(()=>planAccountingPaste([],[row('2026-01',[amount,null,null,null,null])]),failure('CENTS_VALUE',1,2));
  }
  for(const invalid of [{...row('2026-01'),extra:1},{sourceMonth:'2026-01'},null,[]])assert.throws(()=>planAccountingPaste([],[invalid]),failure('MONTH_SHAPE',1,1));
  assert.throws(()=>planAccountingPaste([],[row('01/2026')]),failure('MONTH_FORMAT',1,1));
  assert.throws(()=>planAccountingPaste(valid,[row('2026-02'),row('2026-02')]),failure('DUPLICATE_MONTH',2,1));
  assert.throws(()=>planAccountingPaste([row('2026-01'),row('2026-01')],valid),error=>error.code==='DUPLICATE_MONTH'&&error.input==='currentMonths');
  assert.throws(()=>planAccountingPaste(Array(1),valid),failure('MONTH_SHAPE',1,1));
  assert.throws(()=>planAccountingPaste([],Array(1)),failure('MONTH_SHAPE',1,1));
});
