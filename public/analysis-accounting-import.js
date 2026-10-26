/**
 * Accounting paste is a preview only: no DOM, storage, network or mutation.
 *
 * Money is converted from decimal strings through BigInt, never rounded from a
 * floating-point amount. A comma is a decimal separator (one or two digits).
 * A single dot with one or two final digits is also decimal. Complete groups of
 * three digits are Brazilian thousands: "1.234" means R$ 1.234,00, not 1.234
 * reais. Dots and spaces cannot be mixed as thousands separators. A period with
 * a thousands grouping and another period for decimals is rejected.
 *
 * Empty cells stay null. totalCents means the sum of filled cells, not a claim
 * that all expenses are complete. Applying a replacement replaces all five
 * expense cells, including blanks; the controller must obtain confirmation.
 */

export const ACCOUNTING_IMPORT_COLUMNS=Object.freeze([
  {key:'sourceMonth',label:'Competência'},
  {key:'salariesCents',label:'Salários e pró-labore'},
  {key:'rentCents',label:'Aluguéis'},
  {key:'cardExpensesCents',label:'Taxas de cartões'},
  {key:'benefitsCents',label:'Benefícios'},
  {key:'adminExpensesCents',label:'Outras despesas'}
].map(column=>Object.freeze(column)));
export const ACCOUNTING_IMPORT_MAX_MONTHS=12;
export const ACCOUNTING_IMPORT_MAX_CELL_CENTS=100_000_000_000_000;
export const CSV_TEMPLATE=ACCOUNTING_IMPORT_COLUMNS.map(column=>column.label).join(';')+'\n01/2026;;;;;\n';
export const ACCOUNTING_IMPORT_CSV_TEMPLATE=CSV_TEMPLATE;

const fields=ACCOUNTING_IMPORT_COLUMNS.slice(1).map(column=>column.key);
const maxCell=BigInt(ACCOUNTING_IMPORT_MAX_CELL_CENTS),maxTotal=BigInt(Number.MAX_SAFE_INTEGER);
const edgeSpaces=/^[ \u00a0\u202f]*$/;
const canonicalMonth=/^20\d{2}-(0[1-9]|1[0-2])$/;
const headerAliases=[
  ['competencia','mes','mes/ano'],
  ['salarios e pro-labore','salarios/pro-labore','salarios + pro-labore','salarios'],
  ['alugueis','aluguel'],
  ['taxas de cartoes','taxas de cartao','taxas cartoes','taxas cartao'],
  ['beneficios'],
  ['outras despesas','despesas administrativas']
].map((aliases,index)=>new Set(index?[...aliases,...aliases.map(alias=>alias+' (r$)')]:aliases));
const normalizeHeader=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[\u2010-\u2015]/g,'-').replace(/[ \u00a0\u202f]+/g,' ').trim().replace(/\s*\/\s*/g,'/');

export class AccountingImportError extends Error {
  constructor(code,message,{line=null,column=null,input='text'}={}){
    const field=column?ACCOUNTING_IMPORT_COLUMNS[column-1]?.key||null:null;
    const label=column?ACCOUNTING_IMPORT_COLUMNS[column-1]?.label:null;
    const origin=input==='currentMonths'?'Dados atuais · ':'';
    const location=line===null?'':`Linha ${line}${column===null?'':`, coluna ${column}${label?` (${label})`:''}`}: `;
    super(origin+location+message);
    this.name='AccountingImportError';this.code=code;this.line=line;this.column=column;this.field=field;this.input=input;
  }
}
function fail(code,message,location){throw new AccountingImportError(code,message,location);}

function delimiterFor(line,lineNumber){
  const tabs=line.includes('\t'),semicolons=line.includes(';');
  if(tabs&&semicolons)fail('MIXED_DELIMITERS','Use somente TAB ou somente ponto-e-vírgula para separar as seis colunas.',{line:lineNumber,column:1});
  if(!tabs&&!semicolons)fail('COLUMN_COUNT','São necessárias seis colunas separadas por TAB ou ponto-e-vírgula.',{line:lineNumber,column:1});
  return tabs?'\t':';';
}
/** Standard double-quoted cells are allowed; embedded line breaks are not. */
function cellsFor(line,delimiter,lineNumber){
  const cells=[];let cell='',quoted=false,closed=false;
  const location=()=>({line:lineNumber,column:cells.length+1});
  for(let index=0;index<line.length;index++){
    const character=line[index];
    if(quoted){
      if(character==='"'){
        if(line[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}
      }else cell+=character;
      continue;
    }
    if(character===delimiter){cells.push(cell);cell='';closed=false;continue;}
    if(character==='\t'||character===';')fail('MIXED_DELIMITERS','A linha usa um separador diferente do início da colagem.',location());
    if(closed){
      if(!edgeSpaces.test(character))fail('QUOTED_CELL','Há conteúdo depois do fechamento das aspas.',location());
      continue;
    }
    if(character==='"'){
      if(!edgeSpaces.test(cell))fail('QUOTED_CELL','As aspas devem envolver a célula inteira.',location());
      cell='';quoted=true;
    }else cell+=character;
  }
  if(quoted)fail('QUOTED_CELL','Feche as aspas na mesma linha; não use quebras de linha dentro de uma célula.',location());
  cells.push(cell);
  if(cells.length!==ACCOUNTING_IMPORT_COLUMNS.length)fail('COLUMN_COUNT',`A linha tem ${cells.length} colunas; informe exatamente seis, mantendo os separadores dos campos vazios.`,
    {line:lineNumber,column:Math.min(cells.length+1,ACCOUNTING_IMPORT_COLUMNS.length+1)});
  return cells;
}
function parseMonth(value,location){
  const trimmed=value.trim();
  if(canonicalMonth.test(trimmed))return trimmed;
  const match=/^(0[1-9]|1[0-2])\/(20\d{2})$/.exec(trimmed);
  if(match)return `${match[2]}-${match[1]}`;
  fail('MONTH_FORMAT','Informe a competência como AAAA-MM ou MM/AAAA, entre 2000 e 2099; não use datas com dia.',location);
}
function parseMoney(value,location){
  let amount=value.replace(/[\u00a0\u202f]/g,' ').trim();
  if(amount==='')return null;
  if(/^r\$/i.test(amount))amount=amount.slice(2).trim();
  if(!amount || !/^[0-9., ]+$/.test(amount))fail('MONEY_FORMAT','Informe um valor não negativo, sem fórmulas, sinais, expressões ou notação exponencial.',location);
  // Bound work before BigInt conversion, including pathological leading zeros.
  if(amount.length>64)fail('MONEY_LIMIT','O valor ultrapassa o tamanho permitido para uma célula.',location);
  amount=amount.replace(/ +/g,' ');
  let integral=amount,fraction='';
  if(amount.includes(',')){
    const match=/^([^,]+),([0-9]{1,2})$/.exec(amount);
    if(!match)fail('MONEY_FORMAT','Use uma vírgula decimal e no máximo duas casas; não misture formatos brasileiro e americano.',location);
    [,integral,fraction]=match;
  }else if(amount.includes('.') && !/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(amount)){
    const match=/^([0-9 ]+)\.([0-9]{1,2})$/.exec(amount);
    if(!match)fail('MONEY_FORMAT','Use até duas casas decimais ou grupos completos de três dígitos para milhares. Exemplo: 1.234 = R$ 1.234,00.',location);
    [,integral,fraction]=match;
  }
  if(!/^[0-9]+$/.test(integral) && !/^[0-9]{1,3}(?:\.[0-9]{3})+$/.test(integral) && !/^[0-9]{1,3}(?: [0-9]{3})+$/.test(integral)){
    fail('MONEY_FORMAT','O agrupamento de milhares está incorreto. Use 1.234,56, 1234,56 ou 1234.56, sem separadores misturados.',location);
  }
  const cents=BigInt(integral.replace(/[. ]/g,''))*100n+BigInt(fraction.padEnd(2,'0')||'0');
  if(cents>maxCell || cents>maxTotal)fail('MONEY_LIMIT','O limite por despesa é R$ 1.000.000.000.000,00.',location);
  return Number(cents);
}
function summary(months){
  let total=0n,blankCount=0;
  for(const row of months)for(const field of fields){
    if(row[field]===null)blankCount++;else total+=BigInt(row[field]);
  }
  if(total>maxTotal)fail('TOTAL_LIMIT','A soma dos valores ultrapassa o limite seguro de centavos inteiros.');
  return {blankCount,totalCents:Number(total),monthCount:months.length};
}
function headerCandidate(cells){
  const labels=cells.map(normalizeHeader);
  return labels.some(label=>headerAliases.some(aliases=>aliases.has(label))) || labels.every(label=>/[a-z]/.test(label)&&!/[0-9]/.test(label));
}

export function parseAccountingPaste(text){
  if(typeof text!=='string')fail('PASTE_TYPE','Cole o conteúdo da planilha como texto.',{line:1,column:1});
  if(text.length>50_000)fail('PASTE_LIMIT','A colagem é grande demais. Envie no máximo 12 competências e seis colunas.',{line:1,column:1});
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').map((value,index)=>({value,line:index+1}));
  while(lines.length&&edgeSpaces.test(lines[0].value))lines.shift();
  while(lines.length&&edgeSpaces.test(lines.at(-1).value))lines.pop();
  if(!lines.length)fail('EMPTY_PASTE','Cole pelo menos uma competência com as seis colunas.',{line:1,column:1});
  const delimiter=delimiterFor(lines[0].value,lines[0].line);
  const first=cellsFor(lines[0].value,delimiter,lines[0].line),firstMonth=first[0].trim();
  const hasHeader=!canonicalMonth.test(firstMonth) && !/^(0[1-9]|1[0-2])\/20\d{2}$/.test(firstMonth) && headerCandidate(first);
  if(hasHeader){
    for(let index=0;index<first.length;index++)if(!headerAliases[index].has(normalizeHeader(first[index]))){
      fail('HEADER_FORMAT',`Cabeçalho incompatível. A coluna ${index+1} deve ser “${ACCOUNTING_IMPORT_COLUMNS[index].label}”; mantenha a ordem do modelo.`,{line:lines[0].line,column:index+1});
    }
    lines.shift();
  }
  if(!lines.length)fail('EMPTY_PASTE','Inclua pelo menos uma competência abaixo do cabeçalho.',{line:hasHeader?2:1,column:1});
  if(lines.length>ACCOUNTING_IMPORT_MAX_MONTHS)fail('MONTH_LIMIT','A colagem pode conter no máximo 12 competências.',{line:lines[ACCOUNTING_IMPORT_MAX_MONTHS].line,column:1});
  const seen=new Map();
  const months=lines.map(({value,line})=>{
    const cells=cellsFor(value,delimiter,line),sourceMonth=parseMonth(cells[0],{line,column:1});
    if(seen.has(sourceMonth))fail('DUPLICATE_MONTH',`A competência ${sourceMonth} já foi informada na linha ${seen.get(sourceMonth)}.`,{line,column:1});
    seen.set(sourceMonth,line);
    return {sourceMonth,...Object.fromEntries(fields.map((field,index)=>[field,parseMoney(cells[index+1],{line,column:index+2})]))};
  }).sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));
  return {months,...summary(months),delimiter,hasHeader};
}

function checkedMonths(value,input,{allowEmpty=false}={}){
  if(!Array.isArray(value) || (!allowEmpty&&!value.length))fail('MONTHS_INPUT','Informe uma lista válida de competências.',{input,line:1,column:1});
  if(value.length>ACCOUNTING_IMPORT_MAX_MONTHS)fail('MONTH_LIMIT','São permitidas no máximo 12 competências.',{input,line:13,column:1});
  const seen=new Set(),keys=ACCOUNTING_IMPORT_COLUMNS.map(column=>column.key);
  return Array.from(value,(row,index)=>{
    const location={input,line:index+1,column:1};
    if(!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).length!==keys.length || keys.some(key=>!Object.hasOwn(row,key))){
      fail('MONTH_SHAPE','Cada competência precisa conter os cinco campos de despesas, sem campos adicionais.',location);
    }
    if(typeof row.sourceMonth!=='string' || !canonicalMonth.test(row.sourceMonth))fail('MONTH_FORMAT','A competência dos dados preparados deve usar AAAA-MM entre 2000 e 2099.',location);
    if(seen.has(row.sourceMonth))fail('DUPLICATE_MONTH',`A competência ${row.sourceMonth} está repetida.`,location);
    seen.add(row.sourceMonth);
    const copy={sourceMonth:row.sourceMonth};
    for(const [fieldIndex,field] of fields.entries()){
      const amount=row[field];
      if(amount!==null && (typeof amount!=='number' || !Number.isSafeInteger(amount) || amount<0 || amount>ACCOUNTING_IMPORT_MAX_CELL_CENTS)){
        fail('CENTS_VALUE','O valor preparado deve ser um inteiro de centavos não negativo dentro do limite ou null para um campo vazio.',{...location,column:fieldIndex+2});
      }
      copy[field]=amount===0?0:amount;
    }
    return copy;
  });
}

export function planAccountingPaste(currentMonths,parsedMonths){
  const current=checkedMonths(currentMonths,'currentMonths',{allowEmpty:true}),pasted=checkedMonths(parsedMonths,'parsedMonths');
  const byMonth=new Map(current.map(row=>[row.sourceMonth,row])),addedMonths=[],replacedMonths=[];
  for(const row of pasted){
    (byMonth.has(row.sourceMonth)?replacedMonths:addedMonths).push(row.sourceMonth);
    byMonth.set(row.sourceMonth,row);
  }
  if(byMonth.size>ACCOUNTING_IMPORT_MAX_MONTHS)fail('MONTH_LIMIT','Os dados atuais e a colagem juntos ultrapassam 12 competências. Revise os meses antes de aplicar.',{input:'parsedMonths',line:1,column:1});
  const months=[...byMonth.values()].sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));
  return {months,addedMonths:addedMonths.sort(),replacedMonths:replacedMonths.sort(),...summary(months)};
}
