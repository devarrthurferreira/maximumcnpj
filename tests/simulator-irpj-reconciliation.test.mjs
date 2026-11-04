import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSimulation} from '../public/simulator-engine.js';
import {baselineMonth,calculateMonthlySimulation} from '../public/simulator-monthly.js';
import {buildAnalysisPeriod,selectAnalysisPeriod} from '../public/analysis-period.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {buildDrePresentation,capturedDreRows} from '../public/simulator-dre.js';
import {reconcileIrpj,IRPJ_RECONCILIATION_KEYS} from '../public/irpj-reconciliation.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,actual+' differs from '+expected);
const money=value=>value.toFixed(2);
const memory=(result,id)=>result.memory.find(entry=>entry.id===id);
const record=(result,id)=>result.regimes.find(regime=>regime.id===id);
const row=(presentation,key)=>capturedDreRows(presentation).find(entry=>entry.key===key);
const draft=()=>({year:2027,salesAnnex:1,serviceAnnex:3,rbt12:null,
  regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']},
  values:{serviceRevenue:0,salesRevenue:0,simplePurchases:0,regularPurchases:0,salaries:0,benefits:0,adminExpenses:0,rent:0,cardExpenses:0}});
function monthly(services,{months=services.map((_,index)=>index+1),rents=[],rbt12=null}={}){
  const reports=services.map((amount,index)=>({sourceMonth:'2025-'+String(months[index]).padStart(2,'0'),month:months[index],
    fields:{salesOptantCents:0,salesNonOptantCents:0,salesCpfCents:0,purchasesOptantCents:0,purchasesNonOptantCents:0,serviceRevenueCents:Math.round(amount*100)}}));
  const range={startMonth:'2025-01',endMonth:'2025-09',months:9};
  const analysisPeriod=selectAnalysisPeriod(buildAnalysisPeriod(range,range),reports.map(entry=>entry.sourceMonth));
  const computed=calculateMonthlySimulation({...draft(),rbt12},reports,reports.map((entry,index)=>baselineMonth(entry,{rent:rents[index]??0})),'synthetic-sales',null,analysisPeriod);
  return {...computed,source:{monthlyReports:reports,reportMonths:reports.length},reportMonths:reports.length,
    calendar:buildMonthlyDre(computed.result,2027)};
}

test('base mensal 28 mil explica normal 4.200, adicional 800 e total 5.000 nos dois regimes',()=>{
  const snapshot=monthly([87500],{rents:[45150]}),before=structuredClone(snapshot);
  const presentation=buildDrePresentation(snapshot);
  assert.equal(presentation.irpjReconciliation.version,'IRPJ_RECONCILIATION_V1');
  assert.deepEqual(presentation.irpjReconciliation.rows.map(entry=>entry.key),IRPJ_RECONCILIATION_KEYS);
  for(const id of ['presumed','actual']){
    const checked=reconcileIrpj(snapshot.result,id);
    assert.equal(checked.status,'CONFIRMED');
    const expected=[28000,20000,20000,8000,4200,800,5000];
    IRPJ_RECONCILIATION_KEYS.forEach((key,index)=>{
      close(checked.values[key],expected[index]);
      close(row(presentation,key).values[id],expected[index]);
      close(row(presentation,key).monthlyValues[id][0],expected[index]);
      assert.equal(row(presentation,key).informative,true);
    });
    close(row(presentation,'irpjAdditional').values[id],-800);
    close(row(presentation,'irpjBasic').values[id],-4200);
    close(row(presentation,'irpj').values[id],-5000);
  }
  assert.deepEqual(snapshot,before);
});

test('reprodução sintética dos três valores da imagem confirma adicional 1.263,73 a 10%',()=>{
  const snapshot=monthly([101991.56,...Array(8).fill(60949.15)]),checked=reconcileIrpj(snapshot.result,'presumed');
  assert.equal(checked.available,true);
  assert.equal(money(checked.values.irpjNormalAssessed),'28300.07');
  assert.equal(money(checked.values.irpjAdditionalAssessed),'1263.73');
  assert.equal(money(checked.values.irpjTotalAssessed),'29563.80');
  close(checked.values.irpjTaxBase,188667.1232);
  close(checked.values.irpjAdditionalLimit,180000);
  close(checked.values.irpjExcessBase,12637.2992);
  close(checked.values.irpjTaxBase,checked.values.irpjBaseWithinLimit+checked.values.irpjExcessBase);
  assert.notEqual(money(checked.values.irpjAdditionalAssessed),money(Math.max(0,checked.values.irpjTaxBase-checked.values.irpjAdditionalLimit)*.1));
  const presentation=buildDrePresentation(snapshot);
  assert.match(presentation.irpjReconciliation.note,/limite não utilizado em um mês não reduz o excedente de outro/);
  assert.deepEqual(row(presentation,'irpjAdditionalAssessed').monthlyValues.presumed.map(money),['1263.73',...Array(8).fill('0.00')]);
});

test('limite não utilizado não compensa outro mês e competências ausentes não são completadas',()=>{
  const first=monthly([87500,37500]);
  const checked=reconcileIrpj(first.result,'presumed');
  close(checked.values.irpjTaxBase,40000);close(checked.values.irpjAdditionalLimit,40000);
  close(checked.values.irpjBaseWithinLimit,32000);close(checked.values.irpjExcessBase,8000);
  close(checked.values.irpjAdditionalAssessed,800);
  const partial=monthly([87500,87500,87500],{months:[1,3,9]}),presentation=buildDrePresentation(partial);
  assert.deepEqual(presentation.months.map(entry=>entry.sourceMonth),['2025-01','2025-03','2025-09']);
  close(row(presentation,'irpjAdditionalLimit').values.presumed,60000);
  assert.deepEqual(row(presentation,'irpjAdditionalLimit').monthlyValues.presumed,[20000,20000,20000]);
  close(row(presentation,'irpjAdditionalAssessed').values.presumed,2400);
});

test('base no limite, abaixo dele e prejuízo do Real mantêm adicional zero confirmado',()=>{
  for(const [services,rent,base] of [[62500,32250,20000],[31250,16125,10000],[0,5000,0]]){
    const snapshot=monthly([services],{rents:[rent]});
    for(const id of ['presumed','actual']){
      const checked=reconcileIrpj(snapshot.result,id);
      assert.equal(checked.available,true);close(checked.values.irpjTaxBase,base);
      close(checked.values.irpjBaseWithinLimit,base);close(checked.values.irpjExcessBase,0);
      close(checked.values.irpjAdditionalAssessed,0);
    }
  }
});

test('projeção anual legada conserva limite 240 mil e visualização mensal proporcional',()=>{
  const input=draft();input.values.serviceRevenue=87500;input.values.rent=45150;
  const result=calculateSimulation(input),before=structuredClone(result),calendar=buildMonthlyDre(result,2027);
  const presentation=buildDrePresentation({result,calendar});
  for(const id of ['presumed','actual']){
    const checked=reconcileIrpj(result,id);
    close(checked.values.irpjTaxBase,336000);close(checked.values.irpjAdditionalLimit,240000);
    close(checked.values.irpjNormalAssessed,50400);close(checked.values.irpjAdditionalAssessed,9600);
    close(row(presentation,'irpjAdditionalLimit').monthlyValues[id][0],20000);
    close(row(presentation,'irpjAdditionalAssessed').monthlyValues[id][0],800);
    close(row(presentation,'irpjTotalAssessed').monthlyValues[id][0],5000);
  }
  assert.match(presentation.irpjReconciliation.note,/Projeção anual capturada/);
  assert.deepEqual(result,before);
});

test('componentes trocados com o mesmo total não certificam alíquotas falsas',()=>{
  const snapshot=monthly([87500],{rents:[45150]}),total=record(snapshot.result,'presumed').dre.irpj;
  memory(snapshot.result,'presumed.irBasic').value-=100;
  memory(snapshot.result,'presumed.irAdditional').value+=100;
  const presentation=buildDrePresentation(snapshot);
  assert.equal(reconcileIrpj(snapshot.result,'presumed').available,false);
  for(const key of [...IRPJ_RECONCILIATION_KEYS,'irpjBasic','irpjAdditional'])assert.equal(row(presentation,key).values.presumed,null,key);
  close(row(presentation,'irpj').values.presumed,total);
  assert.match(row(presentation,'irpjAdditionalAssessed').reasonByRegime.presumed,/não concilia/);
  assert.equal(reconcileIrpj(snapshot.result,'actual').available,true);
});

test('cada competência precisa conciliar mesmo se a memória consolidada continuar íntegra',()=>{
  const snapshot=monthly([87500,87500]),first=snapshot.result.monthlyResults[0].result;
  memory(first,'presumed.irBasic').value+=50;memory(first,'presumed.irAdditional').value-=50;
  const presentation=buildDrePresentation(snapshot);
  assert.equal(row(presentation,'irpjTotalAssessed').values.presumed,null);
  assert.equal(row(presentation,'irpjTotalAssessed').monthlyValues.presumed[0],null);
  close(row(presentation,'irpjTotalAssessed').monthlyValues.presumed[1],5000);
  close(row(presentation,'irpj').values.presumed,-10000);
});

test('base, parcelas e total exigem entradas únicas, monetárias, finitas e não negativas',()=>{
  const mutations=[
    result=>{result.memory=result.memory.filter(entry=>entry.id!=='presumed.irTotalBase');},
    result=>{result.memory.push(structuredClone(memory(result,'presumed.irBasic')));},
    result=>{memory(result,'presumed.irAdditional').unit='percent';},
    result=>{memory(result,'presumed.irTotal').value=NaN;},
    result=>{memory(result,'presumed.irBasic').value=-1;},
    result=>{memory(result,'presumed.irBasic').value='4200';},
    result=>{memory(result,'presumed.irTotalBase').availability='UNAVAILABLE';},
    result=>{memory(result,'presumed.irTotalBase').value+=1;},
    result=>{record(result,'presumed').dre.irpj-=1;},
    result=>{result.regimes.push(structuredClone(record(result,'presumed')));}
  ];
  for(const mutate of mutations){
    const {result}=monthly([87500]);mutate(result);
    const checked=reconcileIrpj(result,'presumed');
    assert.equal(checked.available,false);
    assert(IRPJ_RECONCILIATION_KEYS.every(key=>checked.values[key]===null));
  }
});

test('competências ausentes, duplicadas e sourceMonth incoerente ficam pendentes',()=>{
  const mutations=[
    result=>{result.monthlyResults.push(structuredClone(result.monthlyResults[0]));},
    result=>{result.monthlyResults.pop();},
    result=>{result.monthlyResults[0].sourceMonth='2025-03';},
    result=>{delete result.monthlyResults[0].sourceMonth;},
    result=>{result.monthlyResults[0].month=2;},
    result=>{result.monthlyResults[0].sourceMonth='2024-01';},
    result=>{result.monthlyResults=[];}
  ];
  for(const mutate of mutations){
    const snapshot=monthly([87500,87500]);mutate(snapshot.result);
    const presentation=buildDrePresentation(snapshot),detail=row(presentation,'irpjTotalAssessed');
    assert.equal(detail.values.presumed,null);
    assert.match(detail.reasonByRegime.presumed,/competências do IRPJ/);
  }
});

test('mesmas competências únicas fora de ordem física continuam conciliáveis por identidade',()=>{
  const snapshot=monthly([87500,37500,62500],{months:[1,3,9]});
  const before=buildDrePresentation(snapshot).irpjReconciliation;
  snapshot.result.monthlyResults.reverse();
  const after=buildDrePresentation(snapshot).irpjReconciliation;
  assert.deepEqual(after,before);
});

test('a memória consolidada é obrigatória e precisa coincidir com a soma das competências',()=>{
  const snapshot=monthly([87500,37500]);
  memory(snapshot.result,'presumed.irTotalBase').value+=1;
  assert.equal(reconcileIrpj(snapshot.result,'presumed').available,false);
  snapshot.result.memory=snapshot.result.memory.filter(entry=>!entry.id.startsWith('presumed.'));
  const checked=reconcileIrpj(snapshot.result,'presumed');
  assert.equal(checked.available,false);assert.match(checked.reason,/ausente ou incompleta/);
  const selected=reconcileIrpj(snapshot.result,'presumed',{sourceMonth:'2025-01'});
  assert.equal(selected.available,true);close(selected.values.irpjAdditionalAssessed,800);
});

test('calendário divergente não recebe composição confirmada nem muda a DRE histórica',()=>{
  const snapshot=monthly([87500]);
  const regime=snapshot.calendar.regimes.find(entry=>entry.id==='presumed');
  regime.rows.find(entry=>entry.key==='irpj').months[0]-=1;
  const presentation=buildDrePresentation(snapshot);
  assert.equal(row(presentation,'irpjAdditionalAssessed').monthlyValues.presumed[0],null);
  assert.equal(row(presentation,'irpjAdditional').monthlyValues.presumed[0],null);
  assert.match(row(presentation,'irpjAdditionalAssessed').monthlyReasonByRegime.presumed[0],/calendário salvo/);
  close(row(presentation,'irpjAdditionalAssessed').values.presumed,800);
  close(row(presentation,'irpj').values.presumed,-5000);
});

test('Simples disponível indica inclusão no DAS; pendência de RBT12 não vira inclusão confirmada',()=>{
  const ready=monthly([87500],{rbt12:500000}),pending=monthly([87500]);
  for(const id of ['pure','hybrid']){
    const included=reconcileIrpj(ready.result,id),unavailable=reconcileIrpj(pending.result,id);
    assert.equal(included.status,'INCLUDED_IN_DAS');assert.match(included.reason,/IRPJ incluído no DAS/);
    assert.equal(unavailable.status,'UNAVAILABLE');assert.doesNotMatch(unavailable.reason,/IRPJ incluído no DAS/);
    assert.equal(row(buildDrePresentation(ready),'irpjTotalAssessed').values[id],null);
    assert.equal(row(buildDrePresentation(pending),'irpjTotalAssessed').values[id],null);
  }
});

test('histórico sem memória conserva imposto salvo e não fabrica base, limite ou adicional',()=>{
  const input=draft();input.values.serviceRevenue=87500;
  const result=calculateSimulation(input),total=record(result,'presumed').dre.irpj;delete result.memory;
  const presentation=buildDrePresentation({result});
  for(const key of IRPJ_RECONCILIATION_KEYS)assert.equal(row(presentation,key).values.presumed,null,key);
  close(row(presentation,'irpj').values.presumed,total);
});

test('fórmulas da memória mensal usam a mesma base e limite que os valores apresentados',()=>{
  const {result}=monthly([87500],{rents:[45150]}),month=result.monthlyResults[0].result;
  for(const id of ['presumed','actual']){
    const basic=memory(month,id+'.irBasic'),additional=memory(month,id+'.irAdditional');
    assert.match(basic.formula,/competência × 15%/);
    assert.match(additional.formula,/R\$ 20\.000.*10%/);
    assert.doesNotMatch(basic.formula+' '+additional.formula,/240\.000|÷ 12/);
    close(additional.value,800);
  }
});
