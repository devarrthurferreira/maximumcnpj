/** Project the existing two flags into one visible choice without rewriting untouched preferences. */
export function includesEntry(policy,id) {
  return policy?.enabled?.[id]===true&&policy?.operations?.[id]?.entry===true;
}
export function captureEntryInclusions(policy,choices) {
  const next=structuredClone(policy);
  for(const [id,checked] of choices){
    if(!['pure','hybrid'].includes(id)||typeof checked!=='boolean')throw new TypeError('Escolha de entrada inválida.');
    if(checked!==includesEntry(next,id)){next.enabled[id]=checked;next.operations[id].entry=checked;}
  }
  return next;
}
