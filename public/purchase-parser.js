/* Browser-only preview. The API validates every value again before persistence. */
import {csvParse, MAX_ROWS, MAX_COLUMNS, normalizeCnpj} from './domain.js';
import {documentKind} from './lookup-domain.js';

export function decimal(value, places, field) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field}: informe um número positivo ou zero.`);
    const scaled = value * 10 ** places;
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.00001) throw new Error(`${field}: use no máximo ${places} casas decimais.`);
    return value.toFixed(places).replace(/\.?0+$/, '') || '0';
  }
  let text = String(value ?? '').trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (!text) throw new Error(`${field}: valor ausente.`);
  if (text.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) throw new Error(`${field}: formato numérico inválido.`);
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${field}: formato numérico inválido.`);
  let [whole, fraction = ''] = text.split('.');
  fraction = fraction.replace(/0+$/, '');
  if (fraction.length > places) throw new Error(`${field}: use no máximo ${places} casas decimais.`);
  whole = whole.replace(/^0+(?=\d)/, '');
  return whole + (fraction ? '.' + fraction : '');
}

export function amountCents(value, field = 'Valor Total (Q)') {
  const canonical = decimal(value, 2, field);
  const [whole, fraction = ''] = canonical.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100000000000) throw new Error(`${field}: valor acima do limite por linha.`);
  return cents;
}

function canonicalDate(year, month, day, field) {
  const y=Number(year), m=Number(month), d=Number(day), date=new Date(Date.UTC(y,m-1,d));
  if (y < 1900 || y > 2200 || date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d)
    throw new Error(`${field}: data inválida.`);
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/** Normaliza a coluna H sem deslocar datas fiscais por fuso horário. */
export function fiscalDate(value, field='Data Escrituração/Serviço (H)') {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return canonicalDate(value.getUTCFullYear(), value.getUTCMonth()+1, value.getUTCDate(), field);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value >= 2958466) throw new Error(`${field}: data inválida.`);
    const date = new Date(Date.UTC(1899,11,30) + Math.floor(value) * 86400000);
    return canonicalDate(date.getUTCFullYear(), date.getUTCMonth()+1, date.getUTCDate(), field);
  }
  const text=String(value ?? '').trim();
  if (!text) throw new Error(`${field}: preenchimento obrigatório.`);
  let match=text.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})(?:\s+.*)?$/);
  if (match) return canonicalDate(match[3],match[2],match[1],field);
  match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (match) return canonicalDate(match[1],match[2],match[3],field);
  throw new Error(`${field}: use uma data válida (ex.: 31/08/2026).`);
}

export function fiscalPeriod(rows) {
  if (!rows.length) return null;
  const dates=rows.map(row=>row.serviceDate).filter(Boolean).sort();
  if (dates.length !== rows.length) throw new Error('Data Escrituração/Serviço (H): todas as linhas precisam ter uma data válida.');
  const startDate=dates[0], endDate=dates[dates.length-1], [sy,sm]=startDate.split('-').map(Number), [ey,em]=endDate.split('-').map(Number);
  const months=(ey-sy)*12 + em-sm + 1;
  if (months < 1 || months > 12) throw new Error(`O relatório cobre ${months} meses pela coluna H. Use um período entre 1 e 12 meses.`);
  const observed=new Set(dates.map(date=>date.slice(0,7))), missingMonths=[];
  for (let i=0;i<months;i++) {
    const absolute=sy*12+(sm-1)+i, year=Math.floor(absolute/12), month=absolute%12+1, key=`${year}-${String(month).padStart(2,'0')}`;
    if (!observed.has(key)) missingMonths.push(key);
  }
  return {startDate,endDate,startMonth:startDate.slice(0,7),endMonth:endDate.slice(0,7),months,observedMonths:observed.size,missingMonths};
}

// Recovery is limited to the known semicolon CSV export. Workbook columns are never shifted.
const EXPORT_SUFFIX = ['Descrição', 'Quantidade', 'Valor Total', 'CST ICMS', 'Base Cálculo ICMS',
  'Alíquota ICMS', 'Valor ICMS', 'Valor IPI', 'Valor ISS', 'Valor Substituição Tributária',
  'Valor Desconto', 'Valor Despesa Acessória', 'Valor Frete', 'Abatimento não Tributado', 'Codigo Empresa', 'Chave Lancamento'];
const EXPORT_PREFIX_ANCHORS = ['Estado', 'Contribuinte ICMS', 'Natureza', 'Classificação Fiscal', 'Produto'];
const normalizedHeader = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numericId = value => /^\d{1,18}$/.test(String(value ?? '').trim()) && /[1-9]/.test(String(value));

const SALES_RETURN_CFOPS = new Set(['5201','5202','5208','5209','5210','5410','5411','5412','5413','5503','5553','5555','5556','5660','5661','5662','5921','6201','6202','6208','6209','6210','6410','6411','6412','6413','6503','6553','6556','6660','6661','6662','7201','7202','7210','7211','7212','7553','7556']);
const SALES_OTHER_CFOPS = new Set(['5213','5214','5215','5216','5918','5919','6213','6214','6215','6216','6555','6918','6919','6921','7930']);
const SALES_SERVICE_CFOPS = new Set(['9000']);
const natureCode4 = value => String(value ?? '').replace(/\D/g, '').slice(0, 4);

function salesOperation(natureCode, description) {
  const code = natureCode4(natureCode);
  if (SALES_SERVICE_CFOPS.has(code)) return 'SERVICO';
  if (SALES_OTHER_CFOPS.has(code)) return 'OUTRAS';
  if (SALES_RETURN_CFOPS.has(code)) return 'DEVOLUCAO';
  const text = normalizedHeader(description);
  if (text.includes('devolucao')) return 'DEVOLUCAO';
  if (text.includes('servico') || text.includes('prestacao')) return 'SERVICO';
  if (text.includes('venda') || text.includes('faturamento')) return 'VENDA';
  return 'OUTRAS';
}
function isDescriptionText(value) {
  if (typeof value !== 'string' || !/\p{L}/u.test(value) || !value.trim()) return false;
  try { decimal(value, 6, 'Descrição'); return false; } catch { return true; }
}

function recoveryCompany(matrix, headerIndex, header, options) {
  if (options.sourceFormat !== 'CSV' || options.delimiter !== ';' || options.recoverDescriptionSeparators !== true ||
      options.calculationVersion === 'Q_V1' || header.findLastIndex(value => String(value ?? '').trim()) !== 29 ||
      EXPORT_SUFFIX.some((label, index) => normalizedHeader(header[index + 14]) !== normalizedHeader(label)) ||
      EXPORT_PREFIX_ANCHORS.some((label, index) => normalizedHeader(header[index + 9]) !== normalizedHeader(label))) return null;
  if (options.companyCode !== undefined && options.companyCode !== null && options.companyCode !== '') {
    const code = String(options.companyCode).trim();
    return numericId(code) ? code : null;
  }
  // Without a selected-company anchor, require a single code from already aligned rows.
  const codes = new Set();
  for (const row of matrix.slice(headerIndex + 1)) {
    if (!row.slice(30).some(value => String(value ?? '').trim()) && numericId(row[28]) && numericId(row[29])) {
      try { validateExportSuffix(row); codes.add(String(row[28]).trim()); } catch { /* Not an anchor. */ }
    }
  }
  return codes.size === 1 ? [...codes][0] : null;
}

function validateExportSuffix(row) {
  // Every original numerical field in P:AD must remain valid; no number is synthesized or rounded.
  const quantity = decimal(row[15], 6, 'Quantidade (P)');
  if (quantity.split('.')[0].length > 9) throw new Error('Quantidade fora do limite.');
  if (!/^\d{1,3}$/.test(String(row[17] ?? '').trim())) throw new Error('CST inválido.');
  if (decimal(row[19], 6, 'Alíquota ICMS (T)').split('.')[0].length > 9) throw new Error('Alíquota fora do limite.');
  for (const column of [16,18,20,21,22,23,24,25,26,27]) amountCents(row[column], 'Campo numérico do CSV');
  if (!numericId(row[28]) || !numericId(row[29])) throw new Error('Identificadores finais inválidos.');
}

function recoverDescription(raw, companyCode) {
  if (!companyCode) return null;
  // These untouched fields immediately before O rule out separators split inside an earlier name/field.
  if (!/^[A-Z]{2}$/.test(String(raw[9] ?? '').trim()) || !['sim','nao'].includes(normalizedHeader(raw[10])) ||
      !/^\d{4,10}$/.test(String(raw[11] ?? '').trim()) || !/^\d{4}\.?\d{2}\.?\d{2}$/.test(String(raw[12] ?? '').trim()) ||
      !numericId(raw[13])) return null;
  const surplus = raw.findLastIndex(value => String(value ?? '').trim()) - 29;
  if (surplus < 1) return null;
  const description = raw.slice(14, 15 + surplus);
  // A numerical fragment or blank extra field could be a displaced financial value, so it is ambiguous.
  if (description.length !== surplus + 1 || !description.every(isDescriptionText)) return null;
  const joined = description.join(';');
  if (joined.length > 2000) return null;
  const candidate = [...raw.slice(0, 14), joined, ...raw.slice(15 + surplus)];
  if (String(candidate[28] ?? '').trim() !== companyCode || candidate.slice(30).some(value => String(value ?? '').trim())) return null;
  try { validateExportSuffix(candidate); } catch { return null; }
  return {row:candidate, descriptionSeparators:surplus};
}

export function parsePurchaseMatrix(matrix, headerIndex = 0, options = {}) {
  const type = options.type || 'PURCHASES', version = options.calculationVersion || 'NET_V2';
  if (!['PURCHASES', 'SALES'].includes(type) || !['NET_V2', 'Q_V1'].includes(version)) throw new Error('Formato de relatório inválido.');
  if (type === 'SALES' && version !== 'NET_V2') throw new Error('Relatório de vendas requer a fórmula Q - Y + AA - AB.');
  const net = version === 'NET_V2';
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex > 20) throw new Error('Escolha a linha de cabeçalho entre 1 e 21.');
  const header = matrix[headerIndex] || [], required = net ? [0,7,8,16,24,25,26,27] : [0,8,16];
  if (header.length < (net ? 28 : 17) || required.some(index => !String(header[index] ?? '').trim())) throw new Error(`O relatório precisa conter cabeçalhos nas colunas ${net ? 'A, H, I, Q, Y, Z, AA e AB' : 'A, I e Q'}. Confira a aba e o cabeçalho.`);
  const lastHeader = header.findLastIndex(value => String(value ?? '').trim());
  const quantityRequired = type === 'PURCHASES';
  const components = net ? {grossCents:0, discountCents:0, accessoryCents:0, freightCents:0, abatementCents:0, totalCents:0} : null;
  const rows = [], errors = [], repairs = [], unique = new Set();
  const recoveryCode = recoveryCompany(matrix, headerIndex, header, options);
  let nonCnpjLines = 0, ignored = 0, totalCents = 0, balanceCents = 0;
  const operations = {VENDA:{lines:0,totalCents:0,balanceCents:0},SERVICO:{lines:0,totalCents:0,balanceCents:0},DEVOLUCAO:{lines:0,totalCents:0,balanceCents:0},OUTRAS:{lines:0,totalCents:0,balanceCents:0}};
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    let raw = matrix[index];
    const sourceLine = Number.isSafeInteger(options.sourceLines?.[index]) && options.sourceLines[index] > 0 ? options.sourceLines[index] : index + 1;
    let repaired = null;
    if (!raw.some(v => String(v ?? '').trim())) { ignored++; continue; }
    if (rows.length + errors.length >= MAX_ROWS) throw new Error('O relatório aceita até 50.000 linhas de dados. Divida o arquivo.');
    try {
      if (raw.length > MAX_COLUMNS) throw new Error('Máximo de 80 colunas por linha.');
      if (raw.slice(lastHeader + 1).some(value => String(value ?? '').trim())) {
        repaired = recoverDescription(raw, recoveryCode);
        if (!repaired) throw new Error('Colunas desalinhadas: não foi possível realinhar a descrição com segurança. Revise separadores e campos com ponto e vírgula.');
        raw = repaired.row;
      }
      const document = String(raw[0] ?? '').trim(), name = String(raw[8] ?? '').trim();
      const rawNatureCode = String(raw[11] ?? '').trim(), natureCode = natureCode4(rawNatureCode), description = String(raw[14] ?? '').trim();
      if (rawNatureCode.length > 80 || description.length > 2000) throw new Error('Natureza/descrição acima do limite.');
      if (document.length > 40 || name.length > 200) throw new Error('Documento ou razão social acima do limite.');
      if (!name) throw new Error(`${type === 'SALES' ? 'Comprador' : 'Razão social'} (I): preenchimento obrigatório.`);
      if ([0,8,15,16,...(net ? [7,24,25,26,27] : [])].map(index => raw[index]).some(v => String(v).includes('[FORMULA_NAO_SUPORTADA]'))) throw new Error('Cole as fórmulas como valores antes de importar.');
      const serviceDate = net ? fiscalDate(raw[7]) : null;
      const quantity = quantityRequired || String(raw[15] ?? '').trim() ? decimal(raw[15], 6, 'Quantidade (P)') : '0';
      if (quantity.split('.')[0].length > 9) throw new Error('Quantidade (P): use até 9 dígitos inteiros.');
      const grossCents = amountCents(raw[16]);
      const adjustments = net ? Object.fromEntries([['discountCents',24,'Desconto (Y)'],['accessoryCents',25,'Despesa acessória (Z)'],['freightCents',26,'Frete (AA)'],['abatementCents',27,'Abatimento (AB)']].map(([field,column,label]) => [field, String(raw[column] ?? '').trim() ? amountCents(raw[column], label) : 0])) : {};
      const cents = net ? grossCents - adjustments.discountCents + adjustments.freightCents - adjustments.abatementCents : grossCents;
      if (cents < 0) throw new Error('Q - Y + AA - AB resulta em total negativo. Revise os valores da linha.');
      if (cents > 100000000000) throw new Error('Total calculado acima do limite por linha.');
      if (!Number.isSafeInteger(totalCents + cents)) throw new Error('A soma dos valores excede o limite de precisão.');
      const financial = net ? {grossCents,...adjustments,totalCents:cents} : {totalCents:cents};
      if (net && Object.keys(components).some(field => !Number.isSafeInteger(components[field] + financial[field]))) throw new Error('A soma dos componentes excede o limite de precisão.');
      totalCents += cents;
      const operation = type === 'SALES' ? salesOperation(natureCode, description) : null;
      const lineBalanceCents = type === 'SALES' && operation === 'DEVOLUCAO' ? -cents : cents;
      if (!Number.isSafeInteger(balanceCents + lineBalanceCents)) throw new Error('O saldo das operações excede o limite de precisão.');
      balanceCents += lineBalanceCents;
      if (operation) { operations[operation].lines++; operations[operation].totalCents += cents; operations[operation].balanceCents += lineBalanceCents; }
      if (net) for (const field of Object.keys(components)) components[field] += financial[field];
      const kind = documentKind(document);
      if (kind === 'CNPJ') unique.add(normalizeCnpj(document).cnpj); else nonCnpjLines++;
      rows.push(type === 'SALES'
        ? {document, name, serviceDate, quantity, natureCode, description, operation, balanceCents:lineBalanceCents, ...financial}
        : {document, name, serviceDate, quantity, ...financial});
      if (repaired) repairs.push({line:sourceLine, descriptionSeparators:repaired.descriptionSeparators,
        reason:'Separadores extras da descrição (O) recompostos; colunas P a AD realinhadas com os valores originais.'});
    } catch (error) { errors.push({line:sourceLine, message:error.message}); }
  }
  let period = null;
  if (!errors.length && rows.length && net) {
    try { period = fiscalPeriod(rows); } catch (error) { errors.push({line:headerIndex + 1, message:error.message}); }
  }
  return {rows, errors, repairs, repairedCount:repairs.length, ignored, uniqueCnpjs:unique.size, nonCnpjLines, totalCents, balanceCents:type === 'SALES' ? balanceCents : totalCents, operations:type === 'SALES' ? operations : null, components, period, reportType:type, calculationVersion:version, formula:net ? 'Q - Y + AA - AB' : 'Q'};
}

export function decodePurchaseCsv(buffer, encoding = 'auto') {
  let text, usedEncoding = encoding;
  if (encoding === 'auto') {
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(buffer); usedEncoding = 'utf-8'; }
    catch { text = new TextDecoder('windows-1252').decode(buffer); usedEncoding = 'windows-1252'; }
  } else text = new TextDecoder(encoding).decode(buffer);
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const delimiter = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const matrix = csvParse(text, delimiter);
  return {matrix, encoding:usedEncoding, delimiter, sourceLines:csvSourceLines(text, delimiter)};
}

// Match csvParse's quote/empty-row handling, retaining physical row starts for diagnostics.
function csvSourceLines(input, delimiter) {
  const text = input.replace(/^\uFEFF/, ''), sourceLines = [];
  let cell = '', quoted = false, rowHasValue = false, physicalLine = 1, rowStart = 1;
  const finish = () => { if (rowHasValue || cell !== '') sourceLines.push(rowStart); cell = ''; rowHasValue = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\r' || (c === '\n' && text[i - 1] !== '\r')) physicalLine++;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (!cell || quoted) quoted = !quoted;
      else cell += c;
    } else if (c === delimiter && !quoted) { rowHasValue ||= cell !== ''; cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finish(); rowStart = physicalLine;
    } else cell += c;
  }
  if (cell || rowHasValue) finish();
  return sourceLines;
}
