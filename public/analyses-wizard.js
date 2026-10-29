/** Navigation metadata only. Moving between steps never validates or saves a draft. */
const freezeSteps = steps => Object.freeze(steps.map(([id,label]) => Object.freeze({id,label})));

export const WIZARD_STEPS = Object.freeze({
  new:freezeSteps([['company','Empresa'],['sector','Setor']]),
  fiscal:freezeSteps([['regimes','Regimes'],['difal','DIFAL'],['rbt12','RBT12 (opcional)'],['documents','Entradas e saídas']]),
  accounting:freezeSteps([['values','Despesas']]),
  config:freezeSteps([['choices','Regimes e ano']])
});

const LEGACY_STEPS = Object.freeze({
  new:Object.freeze({setup:'company',regimes:'sector',review:'sector'}),
  fiscal:Object.freeze({tax:'rbt12',review:'documents'}),
  accounting:Object.freeze({months:'values',review:'values'}),
  config:Object.freeze({review:'choices'})
});

/** Resumed analyses use the same steps; the controller preserves their saved choices. */
export function wizardSteps(kind,{resume=false}={}) {
  if(typeof kind !== 'string' || !Object.hasOwn(WIZARD_STEPS,kind)) {
    throw new Error('Fluxo de etapas desconhecido.');
  }
  return WIZARD_STEPS[kind];
}

/** Normalize legacy link IDs at the boundary, without weakening strict navigation. */
export function normalizeWizardStep(kind,step) {
  const steps=wizardSteps(kind);
  if(typeof step !== 'string')return null;
  if(steps.some(item=>item.id === step))return step;
  return Object.hasOwn(LEGACY_STEPS[kind],step) ? LEGACY_STEPS[kind][step] : null;
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

/** Existing documents choose the Fiscal entry point; accounting always has one screen. */
export function initialWizardStep(kind,{resume=false,hasDocuments=false,hasMonths=false,preferredStep=null}={}) {
  const initial={new:'company',fiscal:'regimes',
    accounting:'values',config:'choices'};
  return wizardStep(kind,preferredStep === null ? initial[kind] : preferredStep,{resume});
}
