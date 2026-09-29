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

export function parsePurchaseMatrix(matrix, headerIndex = 0, options = {}) {
  const type = options.type || 'PURCHASES', version = options.calculationVersion || 'NET_V2';
  if (!['PURCHASES', 'SALES'].includes(type) || !['NET_V2', 'Q_V1'].includes(version)) throw new Error('Formato de relatório inválido.');
  if (type === 'SALES' && version !== 'NET_V2') throw new Error('Relatório de vendas requer a fórmula Q - Y + AA - AB.');
  const net = version === 'NET_V2';
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex > 20) throw new Error('Escolha a linha de cabeçalho entre 1 e 21.');
  const header = matrix[headerIndex] || [], required = net ? [0,8,16,24,25,26,27] : [0,8,16];
  if (header.length < (net ? 28 : 17) || required.some(index => !String(header[index] ?? '').trim())) throw new Error(`O relatório precisa conter cabeçalhos nas colunas ${net ? 'A, I, Q, Y, Z, AA e AB' : 'A, I e Q'}. Confira a aba e o cabeçalho.`);
  const lastHeader = header.findLastIndex(value => String(value ?? '').trim());
  const quantityRequired = type === 'PURCHASES';
  const components = net ? {grossCents:0, discountCents:0, accessoryCents:0, freightCents:0, abatementCents:0, totalCents:0} : null;
  const rows = [], errors = [], unique = new Set();
  let nonCnpjLines = 0, ignored = 0, totalCents = 0;
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const raw = matrix[index];
    if (!raw.some(v => String(v ?? '').trim())) { ignored++; continue; }
    if (rows.length + errors.length >= MAX_ROWS) throw new Error('O relatório aceita até 50.000 linhas de dados. Divida o arquivo.');
    try {
      if (raw.length > MAX_COLUMNS) throw new Error('Máximo de 80 colunas por linha.');
      if (raw.slice(lastHeader + 1).some(value => String(value ?? '').trim())) throw new Error('Colunas desalinhadas: há valores após o último cabeçalho. Revise separadores e campos com ponto e vírgula.');
      const document = String(raw[0] ?? '').trim(), name = String(raw[8] ?? '').trim();
      if (document.length > 40 || name.length > 200) throw new Error('Documento ou razão social acima do limite.');
      if (!name) throw new Error(`${type === 'SALES' ? 'Comprador' : 'Razão social'} (I): preenchimento obrigatório.`);
      if ([0,8,15,16,...(net ? [24,25,26,27] : [])].map(index => raw[index]).some(v => String(v).includes('[FORMULA_NAO_SUPORTADA]'))) throw new Error('Cole as fórmulas como valores antes de importar.');
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
      if (net) for (const field of Object.keys(components)) components[field] += financial[field];
      const kind = documentKind(document);
      if (kind === 'CNPJ') unique.add(normalizeCnpj(document).cnpj); else nonCnpjLines++;
      rows.push({document, name, quantity, ...financial});
    } catch (error) { errors.push({line:index + 1, message:error.message}); }
  }
  return {rows, errors, ignored, uniqueCnpjs:unique.size, nonCnpjLines, totalCents, components, reportType:type, calculationVersion:version, formula:net ? 'Q - Y + AA - AB' : 'Q'};
}

export function decodePurchaseCsv(buffer, encoding = 'auto') {
  let text, usedEncoding = encoding;
  if (encoding === 'auto') {
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(buffer); usedEncoding = 'utf-8'; }
    catch { text = new TextDecoder('windows-1252').decode(buffer); usedEncoding = 'windows-1252'; }
  } else text = new TextDecoder(encoding).decode(buffer);
  return {matrix:csvParse(text), encoding:usedEncoding};
}
