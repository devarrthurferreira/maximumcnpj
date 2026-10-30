import test from 'node:test';
import assert from 'node:assert/strict';
import {documentDifalSummary,loadDocumentDifal} from '../public/analysis-document-difal.js';
import {defaultDifalPolicy} from '../public/simulator-engine.js';

function options(type='SALES') {
  const entry=type==='PURCHASES',version=entry?'ICMS_ANTICIPATION_V4':'DIFAL_ESTIMATE_V5';
  return {type,jobId:'job',clientId:'client',generationId:'generation',choice:'yes',
    regimeSelection:{version:'REGIME_SELECTION_V1',selected:['pure','hybrid','presumed','actual']},policy:defaultDifalPolicy(),
    job:{_id:'job',clientId:'client',generationId:'generation',mode:entry?'PURCHASES_V1':'SALES_V1',status:'COMPLETED',
      [entry?'anticipationVersion':'difalVersion']:version,reportPeriod:{startMonth:'2026-01',endMonth:'2026-09',months:9},
      purchaseInput:{[entry?'anticipation':'difal']:{version,ratePercent:entry?7.32:10,issuerUf:'MG',
        amountCents:entry?3660:10000,baseCents:entry?50000:100000,eligibleLines:1,pendingLines:0}}}};
}
const source=input=>input.job.purchaseInput[input.type==='PURCHASES'?'anticipation':'difal'];

test('mostra centavos capturados de cada documento sem somar regimes nem recalcular o imposto',()=>{
  for(const type of ['PURCHASES','SALES']){
    const input=options(type),before=structuredClone(input),summary=documentDifalSummary(input);
    assert.equal(summary.amountCents,source(input).amountCents);
    assert.equal(summary.label,type==='PURCHASES'?'DIFAL de entrada':'DIFAL de saída');
    assert.equal(summary.state,'ready');assert.match(summary.context,/estimativa do arquivo/i);
    if(type==='PURCHASES')assert.match(summary.context,/Antecipação de ICMS/);
    assert.deepEqual(input,before);
    // A display must retain captured cents even if a newer rule would produce another value.
    source(input).amountCents=12345;
    assert.equal(documentDifalSummary(input).amountCents,12345);
  }
});

test('respeita a direção por regime e apenas os regimes selecionados',()=>{
  const input=options();
  input.policy.operations.pure.exit=false;input.policy.enabled.hybrid=false;
  assert.equal(documentDifalSummary(input),null);
  input.policy.enabled.hybrid=true;
  assert.equal(documentDifalSummary(input).amountCents,10000);
  input.regimeSelection.selected=['pure','presumed','actual'];
  assert.equal(documentDifalSummary(input),null);
  input.regimeSelection.selected=['presumed','actual'];
  input.policy.operations.pure.exit=true;
  assert.equal(documentDifalSummary(input),null);
  const entry=options('PURCHASES');
  entry.policy.operations.pure.entry=false;entry.policy.operations.hybrid.entry=false;
  assert.equal(documentDifalSummary(entry),null);
});

test('escolha não ou ainda não confirmada oculta a estimativa sem alterar a origem',()=>{
  for(const choice of ['no',null]){
    const input=options();input.choice=choice;
    const before=structuredClone(input);
    assert.equal(documentDifalSummary(input),null);assert.deepEqual(input,before);
  }
  const input=options();input.policy.enabled.pure=input.policy.enabled.hybrid=false;
  assert.equal(documentDifalSummary(input),null);
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
    assert.match(summary.note,type==='PURCHASES'?/Sem operações elegíveis/:/Não possui vendas elegíveis para CPF de outro estado/);
  }
});

test('pendência de UF não vira zero e cálculo parcial conserva somente o valor capturado',()=>{
  for(const type of ['PURCHASES','SALES']){
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

test('política ausente ou inválida não é interpretada como autorização para exibir DIFAL',()=>{
  for(const policy of [undefined,null,{version:'unknown'}]){
    const input=options();input.policy=policy;assert.equal(documentDifalSummary(input),null);
  }
});

 test('cartão usa a leitura CPF atual fornecida pelo servidor sem modificar o resumo V4',()=>{
  const input=options();input.job.difalVersion='DIFAL_ESTIMATE_V4';source(input).version='DIFAL_ESTIMATE_V4';
  input.job.currentDifal={...source(input),version:'DIFAL_ESTIMATE_V5',baseCents:0,amountCents:0,eligibleLines:0};
  input.job.currentDifalPeriod={version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']};
  const before=structuredClone(input),summary=documentDifalSummary(input);
  assert.equal(summary.amountCents,0);assert.equal(summary.state,'ready');
  assert.match(summary.note,/Não possui vendas elegíveis para CPF de outro estado/);assert.deepEqual(input,before);
  input.job.currentDifal=null;assert.equal(documentDifalSummary(input).state,'unavailable');
});

test('carrega DIFAL CPF Jan–Set fora do status dos documentos, verifica identidade e reutiliza a resposta',async()=>{
  const input=options();input.job._id=input.jobId='legacy-load';input.job.difalVersion='DIFAL_ESTIMATE_V4';source(input).version='DIFAL_ESTIMATE_V4';
  const generation={_id:'generation',companies:[{clientId:'client',salesJobId:input.jobId,sales:input.job}]};
  let calls=0,updates=0;
  const result={jobId:input.jobId,clientId:'client',generationId:'generation',
    difal:{...source(input),version:'DIFAL_ESTIMATE_V5',amountCents:0,baseCents:0,eligibleLines:0},
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
  const input=options();input.job._id=input.jobId='retry-load';input.job.difalVersion='DIFAL_ESTIMATE_V4';source(input).version='DIFAL_ESTIMATE_V4';
  const generation={_id:'generation',companies:[{clientId:'client',salesJobId:input.jobId,sales:input.job}]};
  let calls=0;
  const request=async()=>{calls++;if(calls===1)throw new Error('Temporário');return {
    jobId:input.jobId,clientId:'client',generationId:'generation',difal:{...source(input),version:'DIFAL_ESTIMATE_V5'},
    period:{version:'JAN_SEP_V1',sourceYear:2026,complete:true,includedMonths:['2026-01']}};};
  await loadDocumentDifal(generation,{clientId:'client',request});
  assert.equal(documentDifalSummary(input).state,'unavailable');assert.equal(documentDifalSummary(input).amountCents,null);
  await loadDocumentDifal(generation,{clientId:'client',request});
  assert.equal(calls,2);assert.equal(documentDifalSummary(input).amountCents,10000);
});
