/** Display choices never change the fiscal regimes or the saved calculation. */
import {regimeWarningApplies} from './regime-selection.js';

export const DRE_REGIME_OPTIONS = Object.freeze([
  Object.freeze({id:'pure',name:'Simples Puro'}),
  Object.freeze({id:'hybrid',name:'Simples Híbrido'}),
  Object.freeze({id:'presumed',name:'Lucro Presumido'}),
  Object.freeze({id:'actual',name:'Lucro Real'})
]);

export function resolveDreVisibleRegimeIds(presentation,requested) {
  const generated=new Set((presentation?.regimes||[]).map(regime=>regime.id));
  const available=DRE_REGIME_OPTIONS.map(regime=>regime.id).filter(id=>generated.has(id));
  if(!Array.isArray(requested))return available;
  const selected=new Set(requested),visible=available.filter(id=>selected.has(id));
  // Keep one captured regime visible, including when an old view preference no
  // longer exists in the opened version. Missing regimes never acquire values.
  return visible.length?visible:available.slice(0,1);
}

export function filterDreVisibleRegimes(presentation,requested) {
  const ids=resolveDreVisibleRegimeIds(presentation,requested);
  const report=presentation.report&&ids.length?{...presentation.report,
    warnings:(presentation.report.warnings||[]).filter(warning=>regimeWarningApplies(warning.code,{version:'REGIME_SELECTION_V1',selected:ids}))}:presentation.report;
  return {...presentation,regimes:ids.map(id=>presentation.regimes.find(regime=>regime.id===id)),...(report?{report}:{})};
}
