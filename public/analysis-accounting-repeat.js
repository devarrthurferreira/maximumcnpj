import {ACCOUNTING_FIELDS} from './analyses-guidance.js';
import {ACCOUNTING_IMPORT_MAX_CELL_CENTS} from './analysis-accounting-import.js';

const monthPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
const validMonth=value=>typeof value==='string'&&monthPattern.test(value);
const validCents=value=>Number.isSafeInteger(value)&&value>=0&&value<=ACCOUNTING_IMPORT_MAX_CELL_CENTS;

export class AccountingCopyError extends Error {
  constructor(code,message){super(message);this.name='AccountingCopyError';this.code=code;}
}
const fail=(code,message)=>{throw new AccountingCopyError(code,message);};

/** Preview only. The caller supplies the visible period and explicitly applies the returned draft. */
export function planAccountingCopy(months,options={}) {
  if(!Array.isArray(months)||months.length>12||!options||typeof options!=='object'||Array.isArray(options))
    fail('COPY_INPUT','Confira os meses contábeis antes de copiar os valores.');
  const {sourceMonth,targetMonths,allowedMonths}=options;
  const byMonth=new Map();
  for(const row of months){
    if(!row||typeof row!=='object'||Array.isArray(row)||!validMonth(row.sourceMonth))
      fail('MONTH_INVALID','Informe cada competência no formato AAAA-MM.');
    if(byMonth.has(row.sourceMonth))fail('MONTH_DUPLICATE','Cada competência deve aparecer uma única vez antes da cópia.');
    byMonth.set(row.sourceMonth,row);
  }
  if(!Array.isArray(allowedMonths)||!allowedMonths.length||allowedMonths.length>12||!allowedMonths.every(validMonth))
    fail('COPY_SCOPE','Confira o período exibido antes de copiar os valores.');
  const allowed=new Set(allowedMonths),source=byMonth.get(sourceMonth);
  if(!source||!allowed.has(sourceMonth))fail('SOURCE_MONTH','Escolha um mês de origem exibido no período da análise.');
  const missing=ACCOUNTING_FIELDS.filter(([field])=>source[field]===null||source[field]===undefined);
  if(missing.length)fail('SOURCE_INCOMPLETE','Preencha as cinco contas do mês de origem. Use R$ 0,00 nas categorias sem despesa.');
  const invalid=ACCOUNTING_FIELDS.find(([field])=>!validCents(source[field]));
  if(invalid)fail('SOURCE_VALUE',`Confira ${invalid[1]} no mês de origem. Informe um valor válido entre R$ 0,00 e R$ 1.000.000.000.000,00.`);
  if(!Array.isArray(targetMonths)||!targetMonths.length)
    fail('TARGET_REQUIRED','Escolha pelo menos um mês de destino diferente da origem.');
  if(targetMonths.some(month=>!validMonth(month)||!allowed.has(month)||!byMonth.has(month)))
    fail('TARGET_MONTH','Escolha somente meses de destino exibidos no período da análise.');
  const targets=[...new Set(targetMonths)].filter(month=>month!==sourceMonth);
  if(!targets.length)fail('TARGET_REQUIRED','Escolha pelo menos um mês de destino diferente da origem.');

  const copied=structuredClone(months),targetSet=new Set(targets),changes=[],overwritten=new Set();
  for(const row of copied){
    if(!targetSet.has(row.sourceMonth))continue;
    for(const [field] of ACCOUNTING_FIELDS){
      const before=row[field],after=source[field];
      if(before===after)continue;
      changes.push({sourceMonth:row.sourceMonth,field,before,after});
      if(before!==null&&before!==undefined)overwritten.add(row.sourceMonth);
      row[field]=after;
    }
  }
  return {months:copied,changes,sourceMonth,targetMonths:targets,
    overwrittenMonths:targets.filter(month=>overwritten.has(month)),changedFields:changes.length,
    totalCents:ACCOUNTING_FIELDS.reduce((total,[field])=>total+source[field],0)};
}
