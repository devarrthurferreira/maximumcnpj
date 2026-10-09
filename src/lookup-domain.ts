import { normalizeCnpj } from './domain.ts';
import type { Status } from './domain.ts';
export const LOOKUP_MODE = 'API_MINIMAL_V1';
export const SOURCE_NAME = 'Minha Receita';
export const FALLBACK_SOURCE_NAME = 'OpenCNPJ';
export const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
export const cleanText = (v: unknown, max = 200) => String(v ?? '').trim().slice(0,max);
export function documentKind(v: unknown): string {
  const raw = cleanText(v,40).replace(/[.\/\-\s]/g,'').toUpperCase();
  if (!raw) return 'AUSENTE';
  if (/^\d{11}$/.test(raw)) return 'CPF';
  if (/^\d{12}$/.test(raw)) return 'CNO_OU_OUTRO';
  return normalizeCnpj(raw).valid ? 'CNPJ' : 'INVALIDO';
}
export function compactLine(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Linha inválida.');
  for (const key of ['cnpj','name','kind','uf']) if (input[key] != null && !['string','number'].includes(typeof input[key])) throw new Error('Campos devem ser textos.');
  const doc = normalizeCnpj(input.cnpj), kind = documentKind(input.cnpj);
  const name = cleanText(input.name);
  return { cnpj: doc.valid ? doc.cnpj : '', name, kind: cleanText(input.kind,30), uf: /^[A-Z]{2}$/.test(fold(input.uf)) ? fold(input.uf) : '', valid: doc.valid, reason: doc.valid ? null : kind, documentHint: doc.valid ? doc.cnpj : kind === 'CPF' ? 'CPF — não consultado' : 'Documento ausente/inválido — revisar na origem' };
}
export function compareNames(input: unknown, legal: unknown, trading?: unknown): string {
  const a=fold(input), b=fold(legal), c=fold(trading);
  if (!a || !b) return 'NAO_INFORMADO';
  if (a===b || a===c) return 'COMPATIVEL';
  const tokens=(s:string)=>s.split(' ').filter(w=>w.length>2 && !['LTDA','EIRELI','EMPRESA','ME','EPP'].includes(w));
  const x=tokens(a), y=new Set([...tokens(b),...tokens(c)]);
  if (x.length && x.filter(w=>y.has(w)).length/x.length>=0.8) return 'SEMELHANTE_REVISAR';
  return 'DIVERGENTE_REVISAR';
}
export function flagStatus(value: unknown): Status { return value === true ? 'OPTANTE' : value === false ? 'NAO_OPTANTE' : 'NAO_CONFIRMADO'; }
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t=Date.parse(value);return Number.isFinite(t) && new Date(t).toISOString().slice(0,10)===value ? value : null;
}
/** Match the entire normalized identifier; a numeric response cannot recover missing leading zeroes. */
export function parseProvider(cnpj: string, payload: any) {
  const expected = normalizeCnpj(cnpj);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.cnpj !== 'string' || !expected.valid) throw new Error('SOURCE_IDENTITY');
  const returned = normalizeCnpj(payload.cnpj);
  if (!returned.valid || returned.cnpj !== expected.cnpj) throw new Error('SOURCE_IDENTITY');
  cnpj = expected.cnpj;
  const status=flagStatus(payload.opcao_pelo_simples);
  const mei=typeof payload.opcao_pelo_mei === 'boolean' ? payload.opcao_pelo_mei : null;
  const conflict = status === 'NAO_OPTANTE' && mei === true;
  return { cnpj, name: cleanText(payload.razao_social), tradeName: cleanText(payload.nome_fantasia), uf: cleanText(payload.uf,2),
    status: conflict ? 'NAO_CONFIRMADO' as Status : status, mei: conflict ? null : mei,
    reason: conflict ? 'CONFLITO_NA_FONTE' : status === 'NAO_CONFIRMADO' ? 'INDICADOR_AUSENTE' : null,
    optionDate: isoDate(payload.data_opcao_pelo_simples), exclusionDate: isoDate(payload.data_exclusao_do_simples),
    registryStatus: cleanText(payload.descricao_situacao_cadastral,60), source: SOURCE_NAME };
}
/** OpenCNPJ's published schema uses only S/N/empty, not truthy strings or booleans. */
export function parseOpenCnpj(cnpj: string, payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('SOURCE_IDENTITY');
  const flag = (value: unknown) => value === 'S' ? true : value === 'N' ? false : null;
  const result = parseProvider(cnpj, {
    cnpj: payload.cnpj, razao_social: payload.razao_social, nome_fantasia: payload.nome_fantasia, uf: payload.uf,
    opcao_pelo_simples: flag(payload.opcao_simples), opcao_pelo_mei: flag(payload.opcao_mei),
    data_opcao_pelo_simples: payload.data_opcao_simples, data_exclusao_do_simples: payload.data_exclusao_simples,
    descricao_situacao_cadastral: payload.situacao_cadastral
  });
  return {...result, source: FALLBACK_SOURCE_NAME};
}
export function mappedClient(row: any) {
  const code=cleanText(row.code,32).replace(/^0+(?=\d)/,'');
  if (!/^\d{1,20}$/.test(code) || !cleanText(row.name)) throw new Error('Código/ID e razão social são obrigatórios.');
  const checked=normalizeCnpj(row.cnpj), dk=documentKind(row.cnpj);
  return { code, name:cleanText(row.name,160), cnpj:checked.valid?checked.cnpj:null, documentKind:dk, active: !['INATIVA','INATIVO','NAO','FALSE','0'].includes(fold(row.active)), uf:cleanText(row.uf,2).toUpperCase() };
}
