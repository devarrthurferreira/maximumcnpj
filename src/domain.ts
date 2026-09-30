export const VERSION = '0.10.0';
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 80;
export type Status = 'OPTANTE' | 'NAO_OPTANTE' | 'NAO_CONFIRMADO';
export type Row = { index: number; values: string[]; original: string; name: string; cnpj: string; valid: boolean; reason: string | null; duplicate: boolean; warnings: string[] };
export type Result = { cnpj: string; name: string | null; status: Status; mei: boolean | null; reason: string | null; rawSimples: unknown; rawMei: unknown; sourceCount: number; optionDate: string | null; meiDate: string | null; uf: string | null };
export const LABELS: Record<Status, string> = { OPTANTE: 'Optante', NAO_OPTANTE: 'Não optante', NAO_CONFIRMADO: 'Não confirmado' };
export const REPORTING_LABELS = { OPTANTE: 'Simples', NAO_OPTANTE: 'Não optante' };
export function reportingStatus(status: unknown): 'OPTANTE' | 'NAO_OPTANTE' { return status === 'OPTANTE' ? 'OPTANTE' : 'NAO_OPTANTE'; }

/** Receita Federal: ASCII - 48 e módulo 11. Identificação não comprova existência. */
export function digits(base: string): string {
  if (!/^[A-Z0-9]{12}$/.test(base)) throw new Error('Base do CNPJ inválida.');
  const digit = (text: string, weights: number[]) => {
    const r = [...text].reduce((sum, char, i) => sum + (char.charCodeAt(0) - 48) * weights[i], 0) % 11;
    return String(r < 2 ? 0 : 11 - r);
  };
  const first = digit(base, [5,4,3,2,9,8,7,6,5,4,3,2]);
  return first + digit(base + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
export function normalizeCnpj(value: unknown) {
  const original = value == null ? '' : String(value).trim();
  const cnpj = original.toUpperCase().replace(/[.\/\-\s]/g, '');
  const valid = /^[A-Z0-9]{12}\d{2}$/.test(cnpj) && !/^(\d)\1{13}$/.test(cnpj) && !/^0{12}/.test(cnpj) && digits(cnpj.slice(0, 12)) === cnpj.slice(12);
  return { cnpj, valid, reason: valid ? null : original ? 'CNPJ_INVALIDO' : 'CNPJ_AUSENTE', warnings: typeof value === 'number' ? ['CELULA_NUMERICA_CONFERIR_ORIGEM'] : [] };
}
export function formatCnpj(value: string) { return value.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5'); }
export function prepareRows(data: unknown[][], cnpjColumn: number, nameColumn: number): Row[] {
  if (!data.length || data.length > MAX_ROWS) throw new Error('A importação deve ter de 1 a 50.000 linhas.');
  if (!Number.isInteger(cnpjColumn) || cnpjColumn < 0 || cnpjColumn >= MAX_COLUMNS) throw new Error('Escolha a coluna do CNPJ.');
  const seen = new Set<string>();
  return data.map((cells, index) => {
    if (!Array.isArray(cells) || cells.length > MAX_COLUMNS || cells.some(c => String(c ?? '').length > 2000)) throw new Error('Máximo de 80 colunas e 2.000 caracteres por célula.');
    const checked = normalizeCnpj(cells[cnpjColumn]);
    const duplicate = checked.valid && seen.has(checked.cnpj);
    if (checked.valid) seen.add(checked.cnpj);
    return { index, values: cells.map(c => String(c ?? '')), original: String(cells[cnpjColumn] ?? ''), name: String(cells[nameColumn] ?? ''), ...checked, duplicate };
  });
}
export function importSummary(rows: Row[]) {
  const unique = new Set(rows.filter(r => r.valid).map(r => r.cnpj)).size;
  const invalid = rows.filter(r => !r.valid).length;
  return { lines: rows.length, unique, invalid, duplicates: rows.length - invalid - unique };
}
export function flag(value: unknown, yes = ['S','SIM','TRUE','1'], no = ['N','NAO','NÃO','FALSE','0']): boolean | null {
  if (value == null) return null;
  const v = String(value).trim().toUpperCase();
  if (yes.includes(v)) return true;
  if (no.includes(v)) return false;
  return null;
}
function date(value: unknown): string | null {
  const v = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v ? v : null;
}
export function classify(input: Record<string, unknown>, yes?: string[], no?: string[]): Result {
  const simples = flag(input.simples, yes, no), mei = flag(input.mei, yes, no);
  const count = Number(input.sourceCount ?? 0);
  const reason = count === 0 ? 'NAO_ENCONTRADO' : count !== 1 ? 'CONFLITO_NA_FONTE' : simples === null ? 'VALOR_DESCONHECIDO' : mei === true && simples === false ? 'CONFLITO_NA_FONTE' : null;
  return { cnpj: String(input.cnpj), name: input.name == null ? null : String(input.name), status: reason ? 'NAO_CONFIRMADO' : simples ? 'OPTANTE' : 'NAO_OPTANTE', mei: reason ? null : mei, reason, rawSimples: input.simples ?? null, rawMei: input.mei ?? null, sourceCount: count, optionDate: date(input.optionDate), meiDate: date(input.meiDate), uf: input.uf == null ? null : String(input.uf) };
}
export function statistics(results: { cnpj: string; status: Status; mei?: boolean | null }[]) {
  const unique = [...new Map(results.map(r => [r.cnpj, r])).values()];
  const total = unique.length, optants = unique.filter(r => r.status === 'OPTANTE').length;
  const nonOptants = unique.filter(r => r.status === 'NAO_OPTANTE').length, unknown = total - optants - nonOptants;
  const percent = (n: number) => total ? Math.round(n * 10000 / total) / 100 : 0;
  return { total, optants, nonOptants, unknown, reportingNonOptants: total - optants, reportingNonOptantsPercent: total ? (10000 - Math.round(percent(optants) * 100)) / 100 : 0, unknownIncludedInNonOptants: true, mei: unique.filter(r => r.status === 'OPTANTE' && r.mei === true).length, optantsPercent: percent(optants), nonOptantsPercent: percent(nonOptants), unknownPercent: percent(unknown), coverage: percent(optants + nonOptants) };
}
export function safeCell(value: unknown): string {
  const text = String(value ?? '');
  return /^[\s]*[=+@\-\t\r]/.test(text) ? "'" + text : text;
}
export function csvEncode(rows: unknown[][]): string {
  return '\uFEFF' + rows.map(row => row.map(v => '"' + safeCell(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
}
/** Delimitador explícito ou detectado; aspas, BOM e quebras em células. */
export function csvParse(text: string, delimiter?: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  if (!delimiter) {
    const first = text.split(/\r?\n/, 1)[0];
    delimiter = [';', ',', '\t'].sort((a,b) => first.split(b).length - first.split(a).length)[0];
  }
  if (![';',',','\t'].includes(delimiter)) throw new Error('Separador inválido.');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const push = () => { row.push(cell); cell = ''; if (row.length > MAX_COLUMNS) throw new Error('Mais de 80 colunas.'); };
  const line = () => { push(); if (row.some(v => v !== '')) rows.push(row); row = []; if (rows.length > MAX_ROWS + 21) throw new Error('Mais de 50.000 linhas de dados.'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else if (!cell || quoted) quoted = !quoted; else cell += c; }
    else if (c === delimiter && !quoted) push();
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; line(); }
    else cell += c;
    if (cell.length > 2000) throw new Error('Célula maior que 2.000 caracteres.');
  }
  if (quoted) throw new Error('CSV com aspas não fechadas.');
  if (cell || row.length) line();
  return rows;
}
/** Pré-voo do ZIP: limitar expansão declarada, recusar ZIP64, macros e vínculos externos. */
export function inspectXlsxZip(buffer: ArrayBuffer): void {
  const v = new DataView(buffer); let eocd = -1;
  for (let p = buffer.byteLength - 22; p >= Math.max(0, buffer.byteLength - 65557); p--) if (v.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('XLSX inválido. Use .xlsx ou CSV.');
  const count = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true), size = 0;
  if (count > 10000 || count === 65535) throw new Error('Arquivo compactado acima do limite.');
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.byteLength || v.getUint32(p, true) !== 0x02014b50) throw new Error('Estrutura XLSX inválida.');
    if (v.getUint16(p + 8, true) & 1) throw new Error('Arquivo protegido não suportado.');
    const n = v.getUint16(p + 28, true), x = v.getUint16(p + 30, true), c = v.getUint16(p + 32, true);
    size += v.getUint32(p + 24, true);
    const path = new TextDecoder().decode(new Uint8Array(buffer, p + 46, n)).toLowerCase();
    if (size > 100 * 1024 * 1024 || /vbaproject|externallinks/.test(path)) throw new Error('XLSX acima de 100 MiB expandidos, com macros ou vínculos externos.');
    p += 46 + n + x + c;
  }
}
