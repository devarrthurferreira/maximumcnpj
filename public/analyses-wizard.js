/** Navigation metadata only. Moving between steps never validates or saves a draft. */
const freezeSteps = steps => Object.freeze(steps.map(([id,label]) => Object.freeze({id,label})));

export const WIZARD_STEPS = Object.freeze({
  new:freezeSteps([['company','Empresa'],['sector','Setor'],['regimes','Regimes e ano'],['review','Conferência']]),
  fiscal:freezeSteps([['documents','Documentos'],['tax','Opções fiscais'],['review','Conferência']]),
  accounting:freezeSteps([['months','Competências'],['values','Despesas'],['review','Conferência']]),
  config:freezeSteps([['choices','Regimes e ano'],['review','Conferência']])
});

const RESUME_STEPS = Object.freeze(WIZARD_STEPS.new.filter(step => step.id !== 'regimes'));

export function wizardSteps(kind,{resume=false}={}) {
  if(typeof kind !== 'string' || !Object.hasOwn(WIZARD_STEPS,kind)) {
    throw new Error('Fluxo de etapas desconhecido.');
  }
  return kind === 'new' && resume === true ? RESUME_STEPS : WIZARD_STEPS[kind];
}

/** IDs are exact; numeric indexes are zero-based and must be within this flow. */
export function wizardStep(kind,stepOrIndex=0,{resume=false}={}) {
  const steps=wizardSteps(kind,{resume});
  const index=typeof stepOrIndex === 'string' ? steps.findIndex(step => step.id === stepOrIndex) : stepOrIndex;
  if(!Number.isInteger(index) || index < 0 || index >= steps.length) {
    throw new Error('Etapa desconhecida ou índice fora do fluxo.');
  }
  const {id,label}=steps[index];
  return {id,label,index,number:index+1,total:steps.length,
    previous:steps[index-1]?.id ?? null,next:steps[index+1]?.id ?? null,
    isFirst:index === 0,isLast:index === steps.length-1,steps};
}

/** Existing local progress chooses an entry point, never a saved completion status. */
export function initialWizardStep(kind,{resume=false,hasDocuments=false,hasMonths=false,preferredStep=null}={}) {
  const initial={new:'company',fiscal:hasDocuments === true ? 'tax' : 'documents',
    accounting:hasMonths === true ? 'values' : 'months',config:'choices'};
  return wizardStep(kind,preferredStep === null ? initial[kind] : preferredStep,{resume});
}
