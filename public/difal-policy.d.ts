export type DifalDirectionSelection={direction:'entry'|'exit';enabled:boolean;regimeIds:Array<'pure'|'hybrid'>;regimeNames:string[];label:string};
export function difalDirectionSelection(policy:unknown,direction:'entry'|'exit'):DifalDirectionSelection|null;
