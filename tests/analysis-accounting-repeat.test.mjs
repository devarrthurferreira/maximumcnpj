import test from 'node:test';
import assert from 'node:assert/strict';
import {planAccountingCopy,AccountingCopyError} from '../public/analysis-accounting-repeat.js';

const fields=['salariesCents','rentCents','cardExpensesCents','benefitsCents','adminExpensesCents'];
const row=(sourceMonth,values=[null,null,null,null,null])=>({sourceMonth,...Object.fromEntries(fields.map((field,index)=>[field,values[index]]))});
const ids=(count=9,year=2026)=>Array.from({length:count},(_,index)=>`${year}-${String(index+1).padStart(2,'0')}`);
const request=(sourceMonth='2026-01',targetMonths=['2026-02'],allowedMonths=['2026-01','2026-02'])=>({sourceMonth,targetMonths,allowedMonths});
const failure=code=>error=>error instanceof AccountingCopyError&&error.code===code;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('copia as cinco contas em centavos exatos e identifica somente substituições reais',()=>{
  const original=freeze([row('2026-01',[123456,78900,29,0,321]),row('2026-02',[7,null,0,200,321])]);
  const plan=planAccountingCopy(original,freeze(request()));
  assert.deepEqual(plan.months,[row('2026-01',[123456,78900,29,0,321]),row('2026-02',[123456,78900,29,0,321])]);
  assert.equal(plan.sourceMonth,'2026-01');assert.deepEqual(plan.targetMonths,['2026-02']);
  assert.equal(plan.totalCents,202706);assert.equal(plan.changedFields,4);assert.deepEqual(plan.overwrittenMonths,['2026-02']);
  assert.deepEqual(plan.changes,[
    {sourceMonth:'2026-02',field:'salariesCents',before:7,after:123456},
    {sourceMonth:'2026-02',field:'rentCents',before:null,after:78900},
    {sourceMonth:'2026-02',field:'cardExpensesCents',before:0,after:29},
    {sourceMonth:'2026-02',field:'benefitsCents',before:200,after:0}
  ]);
});

test('repetir janeiro a setembro preserva outubro e valores de outro ano',()=>{
  const allowed=ids(),source=row('2026-01',[10001,2500,0,99,140]);
  const outside=[row('2026-10',[1,2,3,4,5]),row('2027-01',[999,888,777,666,555])];
  const original=freeze([source,...allowed.slice(1).map(month=>row(month)),...outside]);
  const plan=planAccountingCopy(original,request('2026-01',allowed,allowed));
  assert.deepEqual(plan.targetMonths,allowed.slice(1));assert.equal(plan.changedFields,40);assert.deepEqual(plan.overwrittenMonths,[]);
  for(const month of allowed)assert.deepEqual(plan.months.find(entry=>entry.sourceMonth===month),row(month,[10001,2500,0,99,140]));
  assert.deepEqual(plan.months.slice(9),outside);assert.equal(plan.totalCents,12740);
  assert.equal(plan.months.slice(0,9).reduce((sum,entry)=>sum+fields.reduce((total,key)=>total+entry[key],0),0),114660);
  assert.deepEqual(original[1],row('2026-02'),'A prévia não preenche o rascunho original.');
});

test('competências legadas permitem doze meses quando todos estão no escopo explícito',()=>{
  const allowed=ids(12,2025),original=allowed.map(month=>row(month,month==='2025-07'?[0,0,0,0,0]:undefined));
  const plan=planAccountingCopy(original,request('2025-07',allowed,allowed));
  assert.equal(plan.targetMonths.length,11);assert.equal(plan.changedFields,55);assert.equal(plan.totalCents,0);
  assert.deepEqual(plan.overwrittenMonths,[]);
  assert.deepEqual(plan.months,allowed.map(month=>row(month,[0,0,0,0,0])));
  assert.deepEqual(original[0],row('2025-01'),'Zero explícito é copiado, sem confirmar o registro original.');
});

test('destinos repetidos são deduplicados e a própria origem nunca é alterada',()=>{
  const original=[row('2026-01',[1,2,3,4,5]),row('2026-02')];
  const plan=planAccountingCopy(original,request('2026-01',['2026-01','2026-02','2026-02']));
  assert.deepEqual(plan.targetMonths,['2026-02']);assert.equal(plan.changedFields,5);
  assert.ok(plan.changes.every(change=>change.sourceMonth==='2026-02'));assert.deepEqual(plan.months[0],original[0]);
});

test('cópia idêntica não cria alterações nem alerta de substituição',()=>{
  const original=[row('2026-01',[29,0,123456,100,200]),row('2026-02',[29,0,123456,100,200])];
  const plan=planAccountingCopy(original,request());
  assert.deepEqual(plan.months,original);assert.equal(plan.changedFields,0);assert.deepEqual(plan.changes,[]);assert.deepEqual(plan.overwrittenMonths,[]);
});

test('origem pendente bloqueia a cópia, sem transformar vazio em zero',()=>{
  for(const missing of [null,undefined]){
    const original=[row('2026-01',[10,20,missing,40,50]),row('2026-02',[101,202,303,404,505])],before=structuredClone(original);
    assert.throws(()=>planAccountingCopy(original,request()),failure('SOURCE_INCOMPLETE'));
    assert.deepEqual(original,before);
  }
  const source=row('2026-01',[0,0,0,0,0]);delete source.benefitsCents;
  assert.throws(()=>planAccountingCopy([source,row('2026-02')],request()),failure('SOURCE_INCOMPLETE'));
  assert.throws(()=>planAccountingCopy([row('2026-01'),row('2026-02')],request()),/cinco contas/);
});

test('valores inválidos ou acima do limite financeiro bloqueiam toda a cópia',()=>{
  for(const amount of [-1,0.1,NaN,Infinity,-Infinity,100_000_000_000_001,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,'0','1.00',false,{},[]]){
    const original=[row('2026-01',[10,amount,30,40,50]),row('2026-02',[101,202,303,404,505])],before=structuredClone(original);
    assert.throws(()=>planAccountingCopy(original,request()),failure('SOURCE_VALUE'),String(amount));
    assert.deepEqual(original,before);
  }
});

test('limite da API é aceito exatamente e a soma dos doze meses continua inteira e segura',()=>{
  const limit=100_000_000_000_000,allowed=ids(12),original=allowed.map((month,index)=>row(month,index===0?Array(5).fill(limit):undefined));
  const plan=planAccountingCopy(original,request('2026-01',allowed,allowed));
  assert.equal(plan.totalCents,500_000_000_000_000);
  assert.equal(plan.months.reduce((sum,entry)=>sum+fields.reduce((total,key)=>total+entry[key],0),0),6_000_000_000_000_000);
  assert.ok(Number.isSafeInteger(plan.totalCents*12));
});

test('origem fora do período ou ausente é recusada antes de copiar',()=>{
  const original=[row('2026-01',[1,2,3,4,5]),row('2026-02'),row('2026-10',[10,20,30,40,50])];
  for(const month of ['2026-10','2026-03','2027-01',null,undefined,'']){
    const before=structuredClone(original);
    assert.throws(()=>planAccountingCopy(original,{...request(),sourceMonth:month}),failure('SOURCE_MONTH'));
    assert.deepEqual(original,before);
  }
  assert.throws(()=>planAccountingCopy(original,request('2026-03',['2026-02'],['2026-01','2026-02','2026-03'])),failure('SOURCE_MONTH'));
});

test('destino ausente ou fora do período bloqueia também os destinos válidos da mesma operação',()=>{
  const original=freeze([row('2026-01',[1,2,3,4,5]),row('2026-02'),row('2026-10',[10,20,30,40,50])]);
  for(const month of ['2026-10','2026-03','2027-01','2026-1','2026-13','',null,undefined]){
    assert.throws(()=>planAccountingCopy(original,request('2026-01',['2026-02',month])),failure('TARGET_MONTH'));
    assert.deepEqual(original[1],row('2026-02'));
  }
  assert.throws(()=>planAccountingCopy(original,request('2026-01',['2026-03'],['2026-01','2026-02','2026-03'])),failure('TARGET_MONTH'));
});

test('é preciso selecionar pelo menos um destino distinto da origem',()=>{
  const original=[row('2026-01',[1,2,3,4,5]),row('2026-02')];
  for(const targets of [[],null,undefined,'2026-02',['2026-01'],['2026-01','2026-01']])
    assert.throws(()=>planAccountingCopy(original,{sourceMonth:'2026-01',targetMonths:targets,allowedMonths:['2026-01','2026-02']}),failure('TARGET_REQUIRED'));
});

test('registros ambíguos e períodos malformados são recusados',()=>{
  const original=[row('2026-01',[1,2,3,4,5]),row('2026-02')];
  assert.throws(()=>planAccountingCopy([...original,row('2026-02')],request()),failure('MONTH_DUPLICATE'));
  for(const entry of [null,{},[],row('2026-13'),row('1999-01'),row('2100-01')])
    assert.throws(()=>planAccountingCopy([...original,entry],request()),failure('MONTH_INVALID'));
  for(const allowedMonths of [undefined,null,[],['2026-13'],['2026-1'],['2026-01',null],'2026-01'])
    assert.throws(()=>planAccountingCopy(original,{...request(),allowedMonths}),failure('COPY_SCOPE'));
  for(const input of [undefined,null,{},'meses'])assert.throws(()=>planAccountingCopy(input,request()),failure('COPY_INPUT'));
  for(const options of [null,[],false])assert.throws(()=>planAccountingCopy(original,options),failure('COPY_INPUT'));
});

test('resultados são independentes do original e de outros destinos, inclusive metadados preservados',()=>{
  const original=freeze([row('2026-01',[1,2,3,4,5]),row('2026-02'),{...row('2026-03'),note:{text:'Preservado'}}]);
  const plan=planAccountingCopy(original,request('2026-01',['2026-02'],['2026-01','2026-02']));
  for(let index=0;index<original.length;index++)assert.notEqual(plan.months[index],original[index]);
  plan.months[1].salariesCents=999;plan.months[2].note.text='Editado depois';
  assert.equal(plan.months[0].salariesCents,1);assert.equal(original[1].salariesCents,null);assert.equal(original[2].note.text,'Preservado');
  const second=planAccountingCopy(original,request('2026-01',['2026-02','2026-03'],ids(3)));
  second.months[1].rentCents=777;assert.equal(second.months[2].rentCents,2);assert.equal(original[0].rentCents,2);
});
