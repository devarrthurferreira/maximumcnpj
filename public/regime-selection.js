/** Shared selection contract. Omission alone preserves historical four-regime calculations. */
export const REGIME_SELECTION_VERSION = 'REGIME_SELECTION_V1';
export const REGIME_IDS = Object.freeze(['pure', 'hybrid', 'presumed', 'actual']);
export const REGIME_LABELS = Object.freeze({pure:'Simples Puro',hybrid:'Simples Híbrido',presumed:'Lucro Presumido',actual:'Lucro Real'});

function invalid(message) {
  const error = new TypeError(`regimeSelection: ${message}`);
  error.issues = [{path:['regimeSelection'],message}];
  throw error;
}
export function defaultRegimeSelection() {
  return {version:REGIME_SELECTION_VERSION,selected:[...REGIME_IDS]};
}
export function parseRegimeSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value,'version') || !Object.hasOwn(value,'selected') ||
      value.version !== REGIME_SELECTION_VERSION) invalid('Informe uma seleção de regimes válida.');
  if (!Array.isArray(value.selected) || value.selected.length < 1 || value.selected.length > REGIME_IDS.length ||
      Array.from(value.selected).some(id=>!REGIME_IDS.includes(id)) || new Set(value.selected).size !== value.selected.length) {
    invalid('Selecione ao menos um regime, sem duplicações ou opções desconhecidas.');
  }
  return {version:REGIME_SELECTION_VERSION,selected:REGIME_IDS.filter(id=>value.selected.includes(id))};
}
export function resolveRegimeSelection(value) {
  return value === undefined ? defaultRegimeSelection() : parseRegimeSelection(value);
}
export function requiresSimplesReference(value) {
  return resolveRegimeSelection(value).selected.some(id=>id === 'pure' || id === 'hybrid');
}

/** A stored memory entry must never expose calculations for an unselected regime. */
export function regimeMemoryApplies(id, selection) {
  const selected=resolveRegimeSelection(selection).selected,simples=selected.some(id=>id==='pure'||id==='hybrid');
  const regime=/^(?:(?:dre|summary)\.|difal\.(?:option|operations|status)\.)(pure|hybrid|presumed|actual)(?:\.|$)/.exec(id)?.[1];
  if(regime&&!selected.includes(regime))return false;
  if(/^presumed\./.test(id)&&!selected.includes('presumed'))return false;
  if(/^actual\./.test(id)&&!selected.includes('actual'))return false;
  if(!simples&&(/^(?:simples\.|difal\.|icmsAnticipation\.)/.test(id)||['rbt12','sublimit','simplesLimit','outside','payroll.simple'].includes(id)))return false;
  if(id==='simples.pureDas'&&!selected.includes('pure'))return false;
  if(['simples.hybridDas','simples.cbsRemoved','simples.ibsRemoved'].includes(id)&&!selected.includes('hybrid'))return false;
  if(/^rate\.(?:irSales|csSales|irServices|csServices)$/.test(id)&&!selected.includes('presumed'))return false;
  if(['rate.payroll','payroll.regular'].includes(id)&&!selected.some(id=>id==='presumed'||id==='actual'))return false;
  return true;
}

/** Filter regime-specific notices without changing warnings captured in old snapshots. */
export function regimeWarningApplies(code, selection) {
  const selected=resolveRegimeSelection(selection).selected,simples=selected.some(id=>id==='pure'||id==='hybrid');
  if(!simples&&['sublimit','simples-unavailable','service-annex','annex-iv-payroll','rbt12-source','estimated-rbt12','difal-estimate','difal-partial','icms-anticipation','icms-anticipation-partial'].includes(code))return false;
  if(!selected.includes('presumed')&&['presumed-eligibility','presumed-limit-reference','presumption-increase'].includes(code))return false;
  return true;
}
