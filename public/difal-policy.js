import {upgradeDifalPolicy} from './simulator-engine.js';

const regimes=[['pure','Simples puro'],['hybrid','Simples híbrido']];

/** Selection only. Source estimates and immutable historical results are never changed here. */
export function difalDirectionSelection(policy,direction) {
  if(!['entry','exit'].includes(direction))throw new TypeError('Direção do DIFAL inválida.');
  if(policy===undefined)return null;
  const current=upgradeDifalPolicy(policy);
  const selected=regimes.filter(([id])=>current.enabled[id]&&current.operations[id][direction]);
  return {direction,enabled:selected.length>0,regimeIds:selected.map(([id])=>id),
    regimeNames:selected.map(([,name])=>name),label:selected.map(([,name])=>name).join(' e ')};
}
