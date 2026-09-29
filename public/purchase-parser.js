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

export function amountCents(value) {
  const canonical = decimal(value, 2, 'Valor Total (Q)');
  const [whole, fraction = ''] = canonical.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100000000000) throw new Error('Valor Total (Q): valor acima do limite por linha.');
  return cents;
}

export function parsePurchaseMatrix(matrix, headerIndex = 0) {
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex > 20) throw new Error('Escolha a linha de cabeçalho entre 1 e 21.');
  if ((matrix[headerIndex]?.length || 0) < 17) throw new Error('O relatório precisa conter as colunas de A até Q. Confira a aba e o cabeçalho.');
  const rows = [], errors = [], unique = new Set();
  let nonCnpjLines = 0, ignored = 0, totalCents = 0;
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const raw = matrix[index];
    if (!raw.some(v => String(v ?? '').trim())) { ignored++; continue; }
    if (rows.length + errors.length >= MAX_ROWS) throw new Error('O relatório aceita até 50.000 linhas de dados. Divida o arquivo.');
    try {
      if (raw.length > MAX_COLUMNS) throw new Error('Máximo de 80 colunas por linha.');
      const document = String(raw[0] ?? '').trim(), name = String(raw[8] ?? '').trim();
      if (document.length > 40 || name.length > 200) throw new Error('Documento ou razão social acima do limite.');
      if (!name) throw new Error('Razão social (I): preenchimento obrigatório.');
      if ([raw[0], raw[8], raw[15], raw[16]].some(v => String(v).includes('[FORMULA_NAO_SUPORTADA]'))) throw new Error('Cole as fórmulas como valores antes de importar.');
      const quantity = decimal(raw[15], 6, 'Quantidade (P)');
      if (quantity.split('.')[0].length > 9) throw new Error('Quantidade (P): use até 9 dígitos inteiros.');
      const cents = amountCents(raw[16]);
      totalCents += cents;
      if (!Number.isSafeInteger(totalCents)) throw new Error('A soma dos valores excede o limite de precisão.');
      const kind = documentKind(document);
      if (kind === 'CNPJ') unique.add(normalizeCnpj(document).cnpj); else nonCnpjLines++;
      rows.push({document, name, quantity, totalCents:cents});
    } catch (error) { errors.push({line:index + 1, message:error.message}); }
  }
  return {rows, errors, ignored, uniqueCnpjs:unique.size, nonCnpjLines, totalCents};
}

export function decodePurchaseCsv(buffer, encoding = 'auto') {
  let text, usedEncoding = encoding;
  if (encoding === 'auto') {
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(buffer); usedEncoding = 'utf-8'; }
    catch { text = new TextDecoder('windows-1252').decode(buffer); usedEncoding = 'windows-1252'; }
  } else text = new TextDecoder(encoding).decode(buffer);
  return {matrix:csvParse(text), encoding:usedEncoding};
}
