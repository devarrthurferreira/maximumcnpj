import test from 'node:test';
import assert from 'node:assert/strict';
import {WIZARD_STEPS,wizardSteps,wizardStep,initialWizardStep} from '../public/analyses-wizard.js';

const ids=steps=>steps.map(step=>step.id);

test('cada fluxo mantém suas etapas e rótulos em ordem fixa',()=>{
  const expected={new:['company','sector','regimes','review'],fiscal:['documents','tax','review'],
    accounting:['months','values','review'],config:['choices','review']};
  assert.deepEqual(Object.keys(WIZARD_STEPS),Object.keys(expected));
  for(const [kind,steps] of Object.entries(expected)){
    assert.deepEqual(ids(wizardSteps(kind)),steps);
    assert.equal(wizardSteps(kind).every(step=>typeof step.label==='string'&&step.label.trim().length>0),true);
    assert.equal(wizardSteps(kind).every(step=>Object.keys(step).join(',')==='id,label'),true);
  }
});

test('retomada omite regimes somente na abertura de uma análise existente',()=>{
  assert.deepEqual(ids(wizardSteps('new',{resume:true})),['company','sector','review']);
  assert.deepEqual(ids(wizardSteps('new',{resume:false})),['company','sector','regimes','review']);
  for(const kind of ['fiscal','accounting','config']){
    assert.deepEqual(wizardSteps(kind,{resume:true}),wizardSteps(kind));
  }
  // A seleção dos regimes não remove a etapa de opções fiscais.
  assert.deepEqual(ids(wizardSteps('fiscal',{regimeSelection:{selected:['presumed','actual']}})),['documents','tax','review']);
});

test('descritores conciliam IDs, índices, numeração e extremos de cada fluxo',()=>{
  for(const kind of Object.keys(WIZARD_STEPS))for(const resume of [false,true]){
    const steps=wizardSteps(kind,{resume});
    steps.forEach((step,index)=>{
      const descriptor=wizardStep(kind,index,{resume});
      assert.deepEqual(descriptor,wizardStep(kind,step.id,{resume}));
      assert.deepEqual(descriptor,{...step,index,number:index+1,total:steps.length,
        previous:steps[index-1]?.id??null,next:steps[index+1]?.id??null,
        isFirst:index===0,isLast:index===steps.length-1,steps});
    });
  }
  assert.equal(wizardStep('new').id,'company');
  assert.equal(wizardStep('new','sector',{resume:true}).next,'review');
  assert.equal(wizardStep('new','review',{resume:true}).previous,'sector');
});

test('fluxos, IDs e índices desconhecidos são rejeitados sem coerção ou limite silencioso',()=>{
  for(const kind of ['','unknown','__proto__','constructor',null,undefined,{},1]){
    assert.throws(()=>wizardSteps(kind),Error);
    assert.throws(()=>wizardStep(kind),Error);
    assert.throws(()=>initialWizardStep(kind),Error);
  }
  for(const step of ['', '0',' company','COMPANY','documents',-1,4,0.5,NaN,Infinity,null,true,false,{},[]]){
    assert.throws(()=>wizardStep('new',step),Error);
  }
  assert.throws(()=>wizardStep('new','regimes',{resume:true}),Error);
  assert.throws(()=>wizardStep('new',3,{resume:true}),Error);
});

test('entrada inicial usa apenas o progresso informado e não conclui nem pula conferência',()=>{
  assert.equal(initialWizardStep('new').id,'company');
  assert.equal(initialWizardStep('new',{resume:true,hasDocuments:true,hasMonths:true}).id,'company');
  assert.equal(initialWizardStep('config',{hasDocuments:true,hasMonths:true}).id,'choices');
  assert.equal(initialWizardStep('fiscal').id,'documents');
  assert.equal(initialWizardStep('fiscal',{hasDocuments:true}).id,'tax');
  assert.equal(initialWizardStep('accounting').id,'months');
  assert.equal(initialWizardStep('accounting',{hasMonths:true}).id,'values');
});

test('atalho explícito tem prioridade, incluindo índice zero, e permanece estrito na retomada',()=>{
  assert.equal(initialWizardStep('fiscal',{hasDocuments:true,preferredStep:0}).id,'documents');
  assert.equal(initialWizardStep('accounting',{preferredStep:'review'}).id,'review');
  assert.equal(initialWizardStep('new',{resume:true,preferredStep:'sector'}).id,'sector');
  assert.equal(initialWizardStep('new',{resume:true,preferredStep:2}).id,'review');
  for(const step of ['regimes',3,'2','',false]){
    assert.throws(()=>initialWizardStep('new',{resume:true,preferredStep:step}),Error);
  }
});

test('definições são profundamente imutáveis e descritores não compartilham estado editável',()=>{
  assert.equal(Object.isFrozen(WIZARD_STEPS),true);
  for(const kind of Object.keys(WIZARD_STEPS))for(const resume of [false,true]){
    const options=Object.freeze({resume,hasDocuments:true,hasMonths:true});
    const steps=wizardSteps(kind,options),descriptor=initialWizardStep(kind,options);
    assert.equal(Object.isFrozen(steps),true);
    assert.equal(steps.every(Object.isFrozen),true);
    assert.throws(()=>steps.push({id:'extra',label:'Extra'}),TypeError);
    assert.throws(()=>{steps[0].label='Alterado';},TypeError);
    descriptor.label='Rótulo local';descriptor.index=99;
    assert.notEqual(initialWizardStep(kind,options).label,'Rótulo local');
    assert.notEqual(initialWizardStep(kind,options).index,99);
    assert.deepEqual(options,{resume,hasDocuments:true,hasMonths:true});
  }
  assert.throws(()=>{WIZARD_STEPS.new=[];},TypeError);
});

test('voltar resolve somente o passo anterior, sem exigir dados ou alterar um rascunho',()=>{
  const draft=Object.freeze({rbt12:null,months:Object.freeze([])});
  const options=Object.freeze({resume:false,draft});
  const review=wizardStep('accounting','review',options);
  const values=wizardStep('accounting',review.previous,options);
  const months=wizardStep('accounting',values.previous,options);
  assert.equal(values.id,'values');assert.equal(months.id,'months');
  assert.deepEqual(draft,{rbt12:null,months:[]});
});
