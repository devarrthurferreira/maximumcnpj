import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateCommercialComposition, summarizeCommercialMonth, type CommercialRow} from '../src/simulation-commercial-composition.ts';

const row=(natureCode:string,totalCents:number,extra:Partial<CommercialRow>={}):CommercialRow=>({natureCode,totalCents,
  serviceDate:'2026-01-15',documentKind:'CPF',valid:false,...extra});
const cnpj=(status:'OPTANTE'|'NAO_OPTANTE'|'NAO_CONFIRMADO')=>({documentKind:'CNPJ',valid:true,status});
const code=(error:any)=>error.code==='SIMULATION_COMMERCIAL_COMPOSITION';

test('composição comercial separa documentos e enquadramento sem perder serviços ou devoluções',()=>{
  const purchases=[row('1102',40000,cnpj('OPTANTE')),row('2102',50000,cnpj('NAO_OPTANTE')),
    row('8000199',10000,cnpj('NAO_CONFIRMADO')),row('8000',5000),row('1102',1500,{documentKind:'CNO_OU_OUTRO'}),
    row('1202',10000,cnpj('OPTANTE')),row('2202',4000),row('1202',2000,{documentKind:'AUSENTE'}),row('1901',900)];
  const sales=[row('5102',100000,cnpj('OPTANTE')),row('6102',200000,cnpj('NAO_OPTANTE')),
    row('9000199',30000,cnpj('NAO_CONFIRMADO')),row('9000',50000),row('5102',20000),
    row('5102',10000,{documentKind:'CNO_OU_OUTRO'}),row('5102',4000,{documentKind:'INVALIDO'}),row('5102',1000,{documentKind:'AUSENTE'}),
    row('6202',9000),row('8888',111)];
  const before=structuredClone({purchases,sales}),result=summarizeCommercialMonth('2026-01',purchases,sales);
  assert.deepEqual(result.sourceMonths,['2026-01']);assert.equal(result.unit,'CENTS');
  assert.equal(result.revenue.grossCents,415000);assert.equal(result.revenue.returnsCents,16000);assert.equal(result.revenue.totalCents,399000);
  assert.equal(result.revenue.percentDenominatorCents,399000);
  assert.deepEqual(result.revenue.byCustomerType.map(group=>[group.key,group.totalCents,group.percent]),[
    ['B2B',320000,80.2],['B2C',66000,16.54],['UNIDENTIFIED',13000,3.26]
  ]);
  assert.deepEqual(result.revenue.byTaxStatus.map(group=>[group.key,group.totalCents]),[
    ['OPTANTE',90000],['NAO_OPTANTE',200000],['CPF',66000],['NAO_CONFIRMADO',30000],['OUTROS',13000]
  ]);
  assert.equal(result.purchases.totalCents,106500);assert.equal(result.purchases.percentDenominatorCents,106500);
  assert.deepEqual(result.purchases.byTaxStatus.map(group=>[group.key,group.totalCents]),[
    ['OPTANTE',40000],['NAO_OPTANTE',50000],['CPF',5000],['NAO_CONFIRMADO',10000],['OUTROS',1500]
  ]);
  assert.equal(result.purchases.byTaxStatus.reduce((sum,group)=>sum+Math.round(group.percent!*100),0),10000);
  assert.deepEqual({purchases,sales},before,'A apresentação não altera as linhas nem seus enquadramentos capturados.');
});

test('devoluções podem deixar um grupo negativo; base zero ou negativa não fabrica percentuais',()=>{
  const positive=summarizeCommercialMonth('2026-01',[row('1202',3000)],[row('5102',10000,cnpj('NAO_OPTANTE')),row('9000',1000)]);
  assert.equal(positive.revenue.totalCents,8000);
  assert.deepEqual(positive.revenue.byCustomerType.map(group=>[group.totalCents,group.percent]),[[10000,125],[-2000,-25],[0,0]]);
  for(const refund of [1000,2000]){
    const composition=summarizeCommercialMonth('2026-01',[row('1202',refund)],[row('9000',1000)]);
    assert.equal(composition.revenue.totalCents,1000-refund);
    assert(composition.revenue.byCustomerType.every(group=>group.percent===null));
    assert(composition.revenue.byTaxStatus.every(group=>group.percent===null));
    assert(composition.purchases.byTaxStatus.every(group=>group.percent===null));
  }
});

test('consolidado de janeiro a setembro soma só meses selecionados e recalcula participações ponderadas',()=>{
  const calendar=Array.from({length:12},(_,index)=>{
    const sourceMonth=`2026-${String(index+1).padStart(2,'0')}`,serviceDate=sourceMonth+'-15';
    const sales=index===0?[row('5102',100,{serviceDate})]:index===1?[row('9000',900,{...cnpj('OPTANTE'),serviceDate})]:
      index===9?[row('5102',999999,{...cnpj('NAO_OPTANTE'),serviceDate})]:[];
    const purchases=index===0?[row('1102',50,{serviceDate})]:index===1?[row('8000',50,{...cnpj('NAO_OPTANTE'),serviceDate})]:[];
    return summarizeCommercialMonth(sourceMonth,purchases,sales);
  });
  const before=structuredClone(calendar),selected=calendar.filter(part=>Number(part.sourceMonths[0].slice(5))<=9);
  const result=aggregateCommercialComposition(selected);
  assert.deepEqual(result.sourceMonths,Array.from({length:9},(_,index)=>`2026-${String(index+1).padStart(2,'0')}`));
  assert.equal(result.revenue.totalCents,1000);assert.equal(result.purchases.totalCents,100);
  assert.deepEqual(result.revenue.byCustomerType.map(group=>group.percent),[90,10,0]);
  assert.deepEqual(result.purchases.byTaxStatus.map(group=>group.percent),[0,50,50,0,0]);
  assert.deepEqual(aggregateCommercialComposition([calendar[0]]),calendar[0],'A seleção de um mês conserva o valor desse mês.');
  assert.equal(aggregateCommercialComposition(calendar).revenue.totalCents,1000999,'Outubro só entra quando explicitamente selecionado pelo chamador.');
  assert.deepEqual(calendar,before);
});

test('centavos e percentuais arredondados conciliam sem atribuir valores a grupos vazios',()=>{
  const result=summarizeCommercialMonth('2026-01',[],[
    row('5102',1,cnpj('OPTANTE')),row('9000',1),row('5102',1,{documentKind:'AUSENTE'})
  ]);
  assert.equal(result.revenue.totalCents,3);assert.deepEqual(result.revenue.byCustomerType.map(group=>group.percent),[33.34,33.33,33.33]);
  assert.equal(result.revenue.byTaxStatus.find(group=>group.key==='NAO_CONFIRMADO')!.percent,0);
  const zero=aggregateCommercialComposition([summarizeCommercialMonth('2026-01',[],[]),summarizeCommercialMonth('2026-02',[],[])]);
  assert.equal(zero.revenue.totalCents,0);assert(zero.revenue.byCustomerType.every(group=>group.percent===null));
});

test('origem inválida, ausência de enquadramento e agregados divergentes são recusados',()=>{
  assert.throws(()=>summarizeCommercialMonth('2026-01',[],[row('5102',100,{serviceDate:'2026-02-01'})]),code);
  assert.throws(()=>summarizeCommercialMonth('2026-01',[],[row('5102',100,{documentKind:'CNPJ',valid:true})]),code);
  assert.throws(()=>summarizeCommercialMonth('2026-01',[row('1102',-1)],[]),code);
  assert.throws(()=>summarizeCommercialMonth('2026-01',[],[row('',100)]),code);
  assert.throws(()=>summarizeCommercialMonth('2026-01',[],[row('5102',Number.MAX_SAFE_INTEGER),row('5102',1)]),code);
  const base=summarizeCommercialMonth('2026-01',[row('1102',100)],[row('5102',1000)]);
  assert.throws(()=>aggregateCommercialComposition([]),code);
  assert.throws(()=>aggregateCommercialComposition([base,base]),code);
  const damaged=structuredClone(base);damaged.revenue.byTaxStatus[2].totalCents++;
  assert.throws(()=>aggregateCommercialComposition([damaged]),code);
  const badPurchases=structuredClone(base);badPurchases.purchases.byTaxStatus[2].totalCents++;
  assert.throws(()=>aggregateCommercialComposition([badPurchases]),code);
});
