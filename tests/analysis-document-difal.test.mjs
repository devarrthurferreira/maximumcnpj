import test from 'node:test';
import assert from 'node:assert/strict';
import {documentDifalSummary,loadDocumentDifal} from '../public/analysis-document-difal.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';

function options(type='SALES') {
  const entry=type==='PURCHASES',version=entry?'ICMS_ANTICIPATION_V4':'DIFAL_ESTIMATE_V6';
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
  if(type==='SALES')assert.match(summary.note,/Não possui DIFAL de saída. Cálculo de saída desativado nesta análise/);
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
 assert.equal(documentDifalSummary(entry),null);
});

test('escolha não oculta entrada e preserva confirmação da saída desativada',()=>{
 for(const choice of ['no',null])for(const type of ['PURCHASES','SALES']){
  const input=options(type);input.choice=choice;const before=structuredClone(input);
  if(type==='PURCHASES')assert.equal(documentDifalSummary(input),null);
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
    assert.match(summary.note,type==='PURCHASES'?/Sem operações elegíveis/:/Não possui DIFAL de saída/);
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

test('resumo histórico reconhecido mantém a sua própria versão e cifra',()=>{
  for(const type of ['PURCHASES','SALES']){
    const input=options(type),version=type==='PURCHASES'?'ICMS_ANTICIPATION_V1':'DIFAL_ESTIMATE_V1';
    source(input).version=version;source(input).amountCents=987654321;
    input.job[type==='PURCHASES'?'anticipationVersion':'difalVersion']=version;
    const before=structuredClone(input);
    if(type==='PURCHASES')assert.equal(documentDifalSummary(input).amountCents,987654321);
    else assert.equal(documentDifalSummary(input).state,'unavailable');
    assert.deepEqual(input,before);
  }
});

test('política inválida é rejeitada e ausência de escolha não reativa a saída',()=>{
 for(const policy of [null,{version:'unknown'}]){
  const input=options();input.policy=policy;assert.equal(documentDifalSummary(input),null);
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
