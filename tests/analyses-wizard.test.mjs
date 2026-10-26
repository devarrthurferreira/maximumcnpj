import test from 'node:test';
import assert from 'node:assert/strict';
import {WIZARD_STEPS,wizardSteps,wizardStep,initialWizardStep,normalizeWizardStep} from '../public/analyses-wizard.js';

const ids=steps=>steps.map(step=>step.id);

test('fluxos reduzidos mantêm duas etapas na abertura e Fiscal e uma no Contábil e configuração',()=>{
  const expected={new:['company','setup'],fiscal:['documents','tax'],accounting:['values'],config:['choices']};
  assert.deepEqual(Object.keys(WIZARD_STEPS),Object.keys(expected));
  for(const [kind,steps] of Object.entries(expected)){
    assert.deepEqual(ids(wizardSteps(kind)),steps);
    assert.equal(wizardSteps(kind).every(step=>typeof step.label==='string'&&step.label.trim().length>0),true);
    assert.equal(wizardSteps(kind).every(step=>Object.keys(step).join(',')==='id,label'),true);
  }
});

test('retomada e consulta conservam as mesmas etapas, sem decidir permissões ou exigência de extrato',()=>{
  assert.deepEqual(ids(wizardSteps('new',{resume:true})),['company','setup']);
  assert.deepEqual(ids(wizardSteps('new',{resume:false})),['company','setup']);
  for(const kind of Object.keys(WIZARD_STEPS)){
    assert.deepEqual(wizardSteps(kind,{resume:true}),wizardSteps(kind));
    assert.deepEqual(wizardSteps(kind,{resume:true,canWrite:false}),wizardSteps(kind));
  }
  // A seleção dos regimes não remove a etapa de opções fiscais.
  assert.deepEqual(ids(wizardSteps('fiscal',{regimeSelection:{selected:['presumed','actual']}})),['documents','tax']);
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
  assert.equal(wizardStep('new','company',{resume:true}).next,'setup');
  assert.equal(wizardStep('new','setup',{resume:true}).previous,'company');
  for(const kind of ['accounting','config']){
    const descriptor=wizardStep(kind);
    assert.equal(descriptor.total,1);assert.equal(descriptor.isFirst,true);assert.equal(descriptor.isLast,true);
    assert.equal(descriptor.previous,null);assert.equal(descriptor.next,null);
  }
});

test('fluxos, IDs e índices desconhecidos são rejeitados sem coerção ou limite silencioso',()=>{
  for(const kind of ['','unknown','__proto__','constructor',null,undefined,{},1]){
    assert.throws(()=>wizardSteps(kind),Error);
    assert.throws(()=>wizardStep(kind),Error);
    assert.throws(()=>initialWizardStep(kind),Error);
    assert.throws(()=>normalizeWizardStep(kind,'review'),Error);
    assert.throws(()=>normalizeWizardStep(kind,null),Error);
  }
  for(const step of ['', '0',' company','COMPANY','documents',-1,2,0.5,NaN,Infinity,null,true,false,{},[]]){
    assert.throws(()=>wizardStep('new',step),Error);
  }
  assert.throws(()=>wizardStep('new','regimes',{resume:true}),Error);
  assert.throws(()=>wizardStep('new',2,{resume:true}),Error);
  assert.throws(()=>wizardStep('accounting',1),Error);
  assert.throws(()=>wizardStep('config',1),Error);
});

test('entrada inicial considera documentos no Fiscal e abre sempre os campos únicos nos outros setores',()=>{
  assert.equal(initialWizardStep('new').id,'company');
  assert.equal(initialWizardStep('new',{resume:true,hasDocuments:true,hasMonths:true}).id,'company');
  assert.equal(initialWizardStep('config',{hasDocuments:true,hasMonths:true}).id,'choices');
  assert.equal(initialWizardStep('fiscal').id,'documents');
  assert.equal(initialWizardStep('fiscal',{hasDocuments:true}).id,'tax');
  assert.equal(initialWizardStep('accounting').id,'values');
  assert.equal(initialWizardStep('accounting',{hasMonths:false}).id,'values');
  assert.equal(initialWizardStep('accounting',{hasMonths:true}).id,'values');
});

test('atalho explícito tem prioridade, incluindo índice zero, e permanece estrito na retomada',()=>{
  assert.equal(initialWizardStep('fiscal',{hasDocuments:true,preferredStep:0}).id,'documents');
  assert.equal(initialWizardStep('fiscal',{preferredStep:'tax'}).id,'tax');
  assert.equal(initialWizardStep('accounting',{preferredStep:'values'}).id,'values');
  assert.equal(initialWizardStep('new',{resume:true,preferredStep:'setup'}).id,'setup');
  assert.equal(initialWizardStep('new',{resume:true,preferredStep:1}).id,'setup');
  for(const step of ['sector','regimes','review',2,'1','',false]){
    assert.throws(()=>initialWizardStep('new',{resume:true,preferredStep:step}),Error);
  }
  assert.throws(()=>initialWizardStep('accounting',{preferredStep:'months'}),Error);
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

test('voltar nos fluxos de duas etapas não exige dados nem altera um rascunho',()=>{
  const draft=Object.freeze({rbt12:null,months:Object.freeze([])});
  const options=Object.freeze({resume:false,draft});
  const setup=wizardStep('new','setup',options),tax=wizardStep('fiscal','tax',options);
  assert.equal(wizardStep('new',setup.previous,options).id,'company');
  assert.equal(wizardStep('fiscal',tax.previous,options).id,'documents');
  assert.deepEqual(draft,{rbt12:null,months:[]});
});

test('normalização aceita IDs atuais e converte somente os aliases legados do respectivo fluxo',()=>{
  const aliases={new:{sector:'setup',regimes:'setup',review:'setup'},fiscal:{review:'tax'},
    accounting:{months:'values',review:'values'},config:{review:'choices'}};
  for(const [kind,legacy] of Object.entries(aliases)){
    for(const {id} of wizardSteps(kind))assert.equal(normalizeWizardStep(kind,id),id);
    for(const [oldId,currentId] of Object.entries(legacy)){
      assert.equal(normalizeWizardStep(kind,oldId),currentId);
      assert.equal(wizardStep(kind,normalizeWizardStep(kind,oldId)).id,currentId);
      assert.throws(()=>wizardStep(kind,oldId),Error);
    }
  }
});

test('normalização devolve null para entradas desconhecidas, sem converter índices ou herdar propriedades',()=>{
  for(const kind of Object.keys(WIZARD_STEPS)){
    for(const step of [undefined,null,0,1,false,true,{},[],new String('review'),'',' review','REVIEW','0','__proto__','constructor','toString']){
      assert.equal(normalizeWizardStep(kind,step),null);
    }
  }
  for(const [kind,step] of [['new','months'],['fiscal','setup'],['accounting','regimes'],['config','documents']]){
    assert.equal(normalizeWizardStep(kind,step),null);
  }
});
