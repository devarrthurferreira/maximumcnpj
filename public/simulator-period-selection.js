import {JAN_SEP_POLICY} from './analysis-period.js';
import {buildRbt12Schedule} from './simulator-rbt12.js';

/** Preserve fiscal competences independently of the optional Simples reference. */
export function selectAvailableRbt12Months(source,monthlyInputs,extraction){
  const schedule=buildRbt12Schedule(extraction,source.monthlyReports.map(row=>row.sourceMonth));
  if(!schedule.complete&&source.analysisPeriod?.version!==JAN_SEP_POLICY)throw new Error('O quadro 2.2 não contém uma janela RBT12 completa para as competências selecionadas. Confira as receitas anteriores.');
  return {source,monthlyInputs,schedule,omittedMonths:[]};
}
