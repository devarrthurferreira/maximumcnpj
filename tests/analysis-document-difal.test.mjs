import test from 'node:test';
import assert from 'node:assert/strict';
import {documentDifalSummary,loadDocumentDifal} from '../public/analysis-document-difal.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';

function options(type='SALES') {
  const entry=type==='PURCHASES',version=entry?'ICMS_ANTICIPATION_V5':'DIFAL_ESTIMATE_V6';
  return {type,jobId:'job',clientId:'client',generationId:'generation',choice:'yes',
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']},policy:defaultDifalPolicy(),
    job:{_id:'job',clientId:'client',generationId:'generation',mode:entry?'PURCHASES_V1':'SALES_V1',status:'COMPLETED',
      [entry?'anticipationVersion':'difalVersion']:version,reportPeriod:{startMonth:'2026-01',endMonth:'2026-09',months:9},
      purchaseInput:{[entry?'anticipation':'difal']:{version,ratePercent:entry?7.32:10,issuerUf:'MG',
        amountCents:entry?3660:0,baseCents:entry?50000:0,eligibleLines:entry?1:0,pendingLines:0}}}};
}
const source=input=>input.job.purchaseInput[input.type==='PURCHASES'?'anticipation':'difal'];

test('entrada conserva centavos capturados e saída V6 confirma cálculo desativado sem alterar a fonte',()=>{
 for(const type of ['PURCHASES','SALES']){
  const input=options(type),before=structuredClone(input),summary=documentDifalSummary(input);
  assert.equal(summary.amountCents,type==='PURCHASES'?3660:0);assert.equal(summary.state,'ready');
  assert.equal(summary.label,type==='PURCHASES'?'DIFAL de entrada':'DIFAL de saída');
  assert.match(summary.context,type==='PURCHASES'?/Antecipação de ICMS/:/desativado.*janeiro a setembro/);
  if(type==='SALES')assert.match(summary.note,/Não aplicado pela regra desta análise/);
  assert.deepEqual(input,before);
  source(input).amountCents=12345;
  if(type==='PURCHASES')assert.equal(documentDifalSummary(input).amountCents,12345);
  else assert.equal(documentDifalSummary(input).state,'unavailable','V6 positiva é inconsistente e não autoriza cobrança.');
 }
});

test('saída desativada permanece visível em qualquer seleção; escolhas continuam controlando somente a entrada',()=>{
 const input=options();
 for(const selected of [['pure','hybrid'],['pure'],['presumed','actual']]){
  input.regimeSelection.selected=selected;input.policy.operations.pure.exit=true;input.policy.enabled.hybrid=false;
  assert.equal(documentDifalSummary(input).amountCents,0);
 }
 const entry=options('PURCHASES');entry.policy.operations.pure.entry=false;entry.policy.operations.hybrid.entry=false;
 assert.equal(documentDifalSummary(entry).amountCents,3660);
});

test('escolha não oculta entrada e preserva confirmação da saída desativada',()=>{
 for(const choice of ['no',null])for(const type of ['PURCHASES','SALES']){
  const input=options(type);input.choice=choice;const before=structuredClone(input);
  if(type==='PURCHASES')assert.equal(documentDifalSummary(input).amountCents,3660);
  else assert.equal(documentDifalSummary(input).amountCents,0);
  assert.deepEqual(input,before);
 }
});

test('valor só aparece depois da conclusão e para o documento vinculado à empresa e geração',()=>{
  for(const change of [{status:'UPLOADING'},{status:'PROCESSING'},{status:'CANCELLED'},
    {_id:'previous-job'},{clientId:'other-client'},{generationId:'previous-generation'},{mode:'PURCHASES_V1'}]){
    const input=options();Object.assign(input.job,change);
    assert.equal(documentDifalSummary(input),null,JSON.stringify(change));
  }
  for(const key of ['job','jobId','clientId','generationId']){
    const input=options();delete input[key];assert.equal(documentDifalSummary(input),null,key);
  }
});

test('zero registrado sem operações elegíveis é exibido como zero',()=>{
  for(const type of ['PURCHASES','SALES']){
    const input=options(type);Object.assign(source(input),{amountCents:0,baseCents:0,eligibleLines:0});
    const summary=documentDifalSummary(input);
    assert.equal(summary.state,'ready');assert.equal(summary.amountCents,0);
    assert.match(summary.note,type==='PURCHASES'?/Sem operações elegíveis/:/Não aplicado pela regra/);
  }
});

test('pendência de UF não vira zero e cálculo parcial conserva somente o valor capturado',()=>{
  for(const type of ['PURCHASES']){
    const input=options(type);source(input).pendingLines=2;
    let summary=documentDifalSummary(input);
    assert.equal(summary.state,'partial');assert.equal(summary.amountCents,source(input).amountCents);
    assert.match(summary.note,/Valor parcial/);assert.match(summary.note,/2 linhas com UF pendente/);
    Object.assign(source(input),{amountCents:0,baseCents:0,eligibleLines:0,pendingLines:1});
    summary=documentDifalSummary(input);
    assert.equal(summary.state,'pending');assert.equal(summary.amountCents,null);
    assert.match(summary.note,/1 linha com UF pendente/);
  }
});

test('resumos ausentes, inválidos ou divergentes permanecem indisponíveis',()=>{
  for(const type of ['PURCHASES','SALES']){
    const changes=[{amountCents:undefined},{amountCents:'0'},{amountCents:-1},{amountCents:NaN},
      {amountCents:Number.MAX_SAFE_INTEGER+1},{baseCents:null},{eligibleLines:undefined},{pendingLines:-1},
      {version:'FUTURE_VERSION'},{ratePercent:null}];
    for(const change of changes){
      const input=options(type);Object.assign(source(input),change);
      const summary=documentDifalSummary(input);
      assert.equal(summary.state,'unavailable',JSON.stringify(change));assert.equal(summary.amountCents,null);
    }
    const input=options(type);delete input.job.purchaseInput;
    assert.equal(documentDifalSummary(input).state,'unavailable');
    const mismatched=options(type);mismatched.job[type==='PURCHASES'?'anticipationVersion':'difalVersion']='other';
    assert.equal(documentDifalSummary(mismatched).state,'unavailable');
  }
});

test('cartão atual não apresenta cifra de regra antiga, mas preserva o resumo histórico',()=>{
  for(const type of ['PURCHASES','SALES']){
    const input=options(type),version=type==='PURCHASES'?'ICMS_ANTICIPATION_V1':'DIFAL_ESTIMATE_V1';
    source(input).version=version;source(input).amountCents=987654321;
    input.job[type==='PURCHASES'?'anticipationVersion':'difalVersion']=version;
    const before=structuredClone(input);
    assert.equal(documentDifalSummary(input).state,'unavailable');
    assert.deepEqual(input,before);
  }
});

test('preferências não são usadas como evidência e ausência de escolha não reativa a saída',()=>{
 for(const policy of [null,{version:'unknown'}]){
  const input=options();input.policy=policy;assert.equal(documentDifalSummary(input).amountCents,0);
 }
 const input=options();input.policy=undefined;assert.equal(documentDifalSummary(input).amountCents,0);
});

test('carrega DIFAL desativado Jan–Set fora do status dos documentos, verifica identidade e reutiliza a resposta',async()=>{
  const input=options();input.job._id=input.jobId='legacy-load';input.job.difalVersion='DIFAL_ESTIMATE_V4';source(input).version='DIFAL_ESTIMATE_V4';Object.assign(source(input),{amountCents:10000,baseCents:100000,eligibleLines:1});
  const generation={_id:'generation',companies:[{clientId:'client',salesJobId:input.jobId,sales:input.job}]};
  let calls=0,updates=0;
  const result={jobId:input.jobId,clientId:'client',generationId:'generation',
    difal:{...source(input),version:'DIFAL_ESTIMATE_V6',amountCents:0,baseCents:0,eligibleLines:0},
    period:{version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']}};
  const request=async path=>{calls++;assert.equal(path,'/api/v4/sales/legacy-load/difal-period');return result;};
  await loadDocumentDifal(generation,{clientId:'client',request,onUpdate:()=>updates++});
  await loadDocumentDifal(generation,{clientId:'client',request,onUpdate:()=>updates++});
  assert.equal(calls,1);assert.equal(updates,2);assert.equal(documentDifalSummary(input).amountCents,0);
  assert.match(documentDifalSummary(input).context,/janeiro a setembro de 2026/);
  assert.equal(source(input).amountCents,10000,'Resumo original V4 não foi substituído.');
  input.job._id=input.jobId='wrong-source';generation.companies[0].salesJobId=input.jobId;
  await loadDocumentDifal(generation,{clientId:'client',request:async()=>({...result,jobId:'other'})});
  assert.equal(documentDifalSummary(input).state,'unavailable');
});

test('arquivo só do quarto trimestre não recebe zero como se houvesse dados Jan–Set',()=>{
  const input=options();input.job.reportPeriod={startMonth:'2026-10',endMonth:'2026-12',months:3};
  Object.assign(source(input),{amountCents:0,baseCents:0,eligibleLines:0});
  assert.equal(documentDifalSummary(input).state,'unavailable');assert.equal(documentDifalSummary(input).amountCents,null);
});

test('regra de saída desativada não confirma período ausente, amplo ou incompleto',()=>{
 const changes=[
  input=>delete input.job.reportPeriod,
  input=>input.job.reportPeriod={startMonth:'2026-01',endMonth:'2026-12',months:12},
  input=>input.job.reportPeriod={startMonth:'2026-10',endMonth:'2026-12',months:3},
  input=>{input.job.currentDifal=structuredClone(source(input));input.job.currentDifalPeriod={version:'JAN_SEP_V1',sourceYear:2026,complete:false,includedMonths:['2026-01']};}
 ];
 for(const change of changes){
  const input=options();change(input);const before=structuredClone(input),summary=documentDifalSummary(input);
  assert.equal(summary.applicationState,'disabled');assert.equal(summary.applicationLabel,'Saída não aplicada pela regra da análise');
  assert.equal(summary.state,'unavailable');assert.equal(summary.amountCents,null);
  assert.match(summary.note,/Não foi possível confirmar as competências/);assert.doesNotMatch(summary.context,/janeiro a setembro/);
  assert.deepEqual(input,before);
 }
 const entry=options('PURCHASES');delete entry.job.reportPeriod;
 assert.equal(documentDifalSummary(entry).state,'unavailable');assert.equal(documentDifalSummary(entry).amountCents,null);
 assert.equal(documentDifalSummary(entry).applicationState,undefined);
});

test('adoção de saída Jan–Dez dispara uma conferência deduplicada mesmo com regra desativada',async()=>{
 const input=options();input.jobId=input.job._id='new-sales-full-year';
 input.job.reportPeriod={startMonth:'2026-01',endMonth:'2026-12',months:12};
 const original=structuredClone(input.job),company={clientId:input.clientId},generation={_id:input.generationId,companies:[company]};
 const hold=gate();let calls=0;
 const request=async()=>{calls++;await hold.promise;return {jobId:input.jobId,clientId:input.clientId,generationId:input.generationId,
  difal:structuredClone(source(input)),period:{version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']}};};
 await loadDocumentDifal(generation,{clientId:input.clientId,request});assert.equal(calls,0);
 company.salesJobId=input.jobId;company.sales=input.job;
 const first=loadDocumentDifal(generation,{clientId:input.clientId,request});
 const second=loadDocumentDifal(generation,{clientId:input.clientId,request});
 const reading=documentDifalSummary(input);assert.equal(reading.applicationState,'disabled');assert.equal(reading.state,'reading');assert.equal(reading.amountCents,null);
 await Promise.resolve();assert.equal(calls,1);hold.release();await Promise.all([first,second]);
 const ready=documentDifalSummary(input);assert.equal(ready.state,'ready');assert.equal(ready.amountCents,0);assert.equal(ready.applicationState,'disabled');
 assert.match(ready.context,/janeiro a setembro de 2026/);
 await loadDocumentDifal(generation,{clientId:input.clientId,request});assert.equal(calls,1);
 assert.deepEqual(input.job.purchaseInput,original.purchaseInput);assert.deepEqual(input.job.reportPeriod,original.reportPeriod);
});

test('saída desativada com resposta sem período validado não entra no cache e pode recuperar',async()=>{
 const input=options();input.jobId=input.job._id='sales-invalid-period';
 input.job.reportPeriod={startMonth:'2026-01',endMonth:'2026-12',months:12};
 const generation={_id:input.generationId,companies:[{clientId:input.clientId,salesJobId:input.jobId,sales:input.job}]};
 let calls=0;
 const request=async()=>({jobId:input.jobId,clientId:input.clientId,generationId:input.generationId,difal:structuredClone(source(input)),
  period:{version:'JAN_SEP_V1',sourceYear:2026,complete:++calls!==1,includedMonths:['2026-01']}});
 await loadDocumentDifal(generation,{clientId:input.clientId,request});
 const failed=documentDifalSummary(input);assert.equal(failed.applicationState,'disabled');assert.equal(failed.state,'unavailable');assert.equal(failed.amountCents,null);
 assert.equal(failed.error.code,'DIFAL_SUMMARY_INVALID');
 await loadDocumentDifal(generation,{clientId:input.clientId,request});assert.equal(calls,2);
 assert.equal(documentDifalSummary(input).state,'ready');assert.equal(documentDifalSummary(input).amountCents,0);
});

test('falha transitória no resumo permite nova tentativa e nunca confirma zero indevido',async()=>{
  const input=options();input.job._id=input.jobId='retry-load';input.job.difalVersion='DIFAL_ESTIMATE_V4';source(input).version='DIFAL_ESTIMATE_V4';Object.assign(source(input),{amountCents:10000,baseCents:100000,eligibleLines:1});
  const generation={_id:'generation',companies:[{clientId:'client',salesJobId:input.jobId,sales:input.job}]};
  let calls=0;
  const request=async()=>{calls++;if(calls===1)throw new Error('Temporário');return {
    jobId:input.jobId,clientId:'client',generationId:'generation',difal:{...source(input),version:'DIFAL_ESTIMATE_V6',amountCents:0,baseCents:0,eligibleLines:0,pendingLines:0},
    period:{version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']}};};
  await loadDocumentDifal(generation,{clientId:'client',request});
  assert.equal(documentDifalSummary(input).state,'unavailable');assert.equal(documentDifalSummary(input).amountCents,null);
  await loadDocumentDifal(generation,{clientId:'client',request});
  assert.equal(calls,2);assert.equal(documentDifalSummary(input).amountCents,0);
});

test('entrada antiga é atualizada pelo servidor sem reusar CPF histórico nem alterar a origem',async()=>{
 const input=options('PURCHASES');input.job._id=input.jobId='entry-v4-reload';
 input.job.anticipationVersion=source(input).version='ICMS_ANTICIPATION_V4';
 Object.assign(source(input),{baseCents:300000,amountCents:21960,eligibleLines:2});
 const original=structuredClone(source(input));
 const generation={_id:'generation',companies:[{clientId:'client',purchaseJobId:input.jobId,purchase:input.job}]};
 let calls=0;
 const request=async path=>{calls++;assert.equal(path,'/api/v4/purchases/entry-v4-reload/difal-period');return {
  jobId:input.jobId,clientId:'client',generationId:'generation',
  anticipation:{version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',baseCents:200000,amountCents:14640,eligibleLines:1,pendingLines:0},
  period:{version:'JAN_SEP_V1',sourceYear:2025,complete:true,includedMonths:['2025-01']}};};
 assert.equal(documentDifalSummary(input).state,'unavailable');
 await Promise.all([loadDocumentDifal(generation,{clientId:'client',request}),loadDocumentDifal(generation,{clientId:'client',request})]);
 assert.equal(calls,1);assert.equal(documentDifalSummary(input).amountCents,14640);
 assert.deepEqual(source(input),original);
});

test('falha de entrada não impede saída zero nem fabrica um valor confirmado de compras',async()=>{
 const entry=options('PURCHASES'),sale=options('SALES');entry.job._id=entry.jobId='entry-fails';sale.job._id=sale.jobId='exit-works';
 entry.job.anticipationVersion=source(entry).version='ICMS_ANTICIPATION_V4';
 sale.job.difalVersion=source(sale).version='DIFAL_ESTIMATE_V4';
 const generation={_id:'generation',companies:[{clientId:'client',purchaseJobId:entry.jobId,purchase:entry.job,salesJobId:sale.jobId,sales:sale.job}]};
 const request=async path=>{if(path.includes('/purchases/'))throw new Error('Temporário');return {
  jobId:sale.jobId,clientId:'client',generationId:'generation',difal:{...source(sale),version:'DIFAL_ESTIMATE_V6'},
  period:{version:'JAN_SEP_V1',sourceYear:2025,complete:true,includedMonths:['2025-01']}};};
 await loadDocumentDifal(generation,{clientId:'client',request});
 assert.equal(documentDifalSummary(entry).state,'unavailable');assert.equal(documentDifalSummary(entry).amountCents,null);
 assert.equal(documentDifalSummary(sale).amountCents,0);
});

function legacyEntry(id) {
 const input=options('PURCHASES');input.jobId=input.job._id=id;
 const result={jobId:id,clientId:input.clientId,generationId:input.generationId,anticipation:structuredClone(source(input)),
  period:{version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']}};
 input.job.anticipationVersion=source(input).version='ICMS_ANTICIPATION_V4';
 return {input,result,generation:{_id:input.generationId,companies:[{clientId:input.clientId,purchaseJobId:id,purchase:input.job}]}};
}
function gate(){let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};}

test('consulta pendente informa leitura e compartilha a mesma requisição mesmo com force',async()=>{
 const f=legacyEntry('reading-pending'),hold=gate();let calls=0;
 const request=async()=>{calls++;await hold.promise;return f.result;};
 const first=loadDocumentDifal(f.generation,{clientId:f.input.clientId,request});
 const second=loadDocumentDifal(f.generation,{clientId:f.input.clientId,request,force:true});
 assert.equal(documentDifalSummary(f.input).state,'reading');assert.equal(documentDifalSummary(f.input).amountCents,null);
 await Promise.resolve();assert.equal(calls,1);hold.release();await Promise.all([first,second]);
 assert.equal(documentDifalSummary(f.input).state,'ready');assert.equal(documentDifalSummary(f.input).amountCents,3660);
});

test('erro de origem preserva mensagem, status e código seguro e não impede nova tentativa',async()=>{
 const f=legacyEntry('error-detail'),requestId='11111111-1111-4111-8111-111111111111';let calls=0;
 const request=async()=>{if(++calls===1)throw Object.assign(new Error('Banco de origem temporariamente indisponível. Tente novamente.'),{status:503,code:'SOURCE_UNAVAILABLE',requestId});return f.result;};
 await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request});
 const failed=documentDifalSummary(f.input);assert.equal(failed.state,'unavailable');assert.equal(failed.amountCents,null);
 assert.match(failed.note,/Banco de origem temporariamente indisponível/);assert.match(failed.note,new RegExp(requestId));
 assert.equal(failed.error.status,503);assert.equal(failed.error.code,'SOURCE_UNAVAILABLE');assert.equal(failed.error.retryable,true);
 await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request,force:true});
 assert.equal(calls,2);assert.equal(documentDifalSummary(f.input).amountCents,3660);
});

test('resposta incompleta, taxa incompatível ou período inválido nunca envenena o cache',async()=>{
 const invalid=[result=>delete result.anticipation.amountCents,result=>result.anticipation.ratePercent=10,
  result=>result.anticipation.amountCents=result.anticipation.baseCents+1,
  result=>result.period.includedMonths=['2026-10'],result=>result.period.includedMonths=['2026-01','2026-01'],
  result=>result.period.complete=false,result=>result.period.months=2];
 for(const [index,change] of invalid.entries()){
  const f=legacyEntry('invalid-response-'+index),broken=structuredClone(f.result);change(broken);let calls=0;
  const request=async()=>++calls===1?broken:f.result;
  await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request});
  assert.equal(documentDifalSummary(f.input).state,'unavailable');assert.equal(documentDifalSummary(f.input).amountCents,null);
  await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request});
  assert.equal(calls,2);assert.equal(documentDifalSummary(f.input).amountCents,3660);
 }
});

test('resumo inline incompleto consulta o servidor; resumo válido evita leitura adicional',async()=>{
 const f=legacyEntry('invalid-inline');f.input.job.anticipationVersion='ICMS_ANTICIPATION_V5';source(f.input).version='ICMS_ANTICIPATION_V5';
 delete source(f.input).amountCents;let calls=0;
 await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request:async()=>{calls++;return f.result;}});
 assert.equal(calls,1);assert.equal(documentDifalSummary(f.input).amountCents,3660);
 const valid=options('PURCHASES');
 await loadDocumentDifal({_id:valid.generationId,companies:[{clientId:valid.clientId,purchaseJobId:valid.jobId,purchase:valid.job}]},
  {clientId:valid.clientId,request:async()=>{throw new Error('Não deve consultar um resumo inline válido.');}});
 assert.equal(documentDifalSummary(valid).state,'ready');
});

test('force substitui cache concluído sem duplicar a nova consulta pendente',async()=>{
 const f=legacyEntry('force-cache'),hold=gate();let calls=0;
 const request=async()=>{if(++calls>1)await hold.promise;return {...f.result,anticipation:{...f.result.anticipation,amountCents:calls===1?3660:7320}};};
 await loadDocumentDifal(f.generation,{clientId:f.input.clientId,request});
 const first=loadDocumentDifal(f.generation,{clientId:f.input.clientId,request,force:true});
 const second=loadDocumentDifal(f.generation,{clientId:f.input.clientId,request,force:true});
 await Promise.resolve();assert.equal(calls,2);assert.equal(documentDifalSummary(f.input).amountCents,null);
 hold.release();await Promise.all([first,second]);assert.equal(documentDifalSummary(f.input).amountCents,7320);
});

test('escopos de sessão não compartilham cache nem deixam resposta antiga sobrescrever a nova',async()=>{
 const f=legacyEntry('session-scopes'),hold=gate();let calls=0;
 const old=loadDocumentDifal(f.generation,{clientId:f.input.clientId,cacheScope:'workspace/user-a',request:async()=>{calls++;await hold.promise;return f.result;}});
 await loadDocumentDifal(f.generation,{clientId:f.input.clientId,cacheScope:'workspace/user-b',request:async()=>{calls++;return {...f.result,anticipation:{...f.result.anticipation,amountCents:7320}};}});
 assert.equal(calls,2);assert.equal(documentDifalSummary(f.input).amountCents,7320);
 hold.release();await old;assert.equal(documentDifalSummary(f.input).amountCents,7320);
});
