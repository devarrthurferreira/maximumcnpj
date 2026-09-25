import type { Status } from './domain.ts';
export const IMPORT_MODE = 'LOCAL_IMPORT_V1';
/** Somente valores explícitos da coluna escolhida. Não faz consulta nem inferência fiscal. */
export function importedStatus(value: unknown): Status {
  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (['S', 'SIM', 'TRUE', '1', 'OPTANTE', 'SIMPLES NACIONAL'].includes(text)) return 'OPTANTE';
  if (['N', 'NAO', 'FALSE', '0', 'NAO OPTANTE', 'NAO_OPTANTE'].includes(text)) return 'NAO_OPTANTE';
  return 'NAO_CONFIRMADO';
}
export function mergeImportedStatuses(values: unknown[]): { status: Status; reason: string | null } {
  const statuses = new Set(values.map(value => ['OPTANTE','NAO_OPTANTE'].includes(String(value)) ? String(value) as Status : 'NAO_CONFIRMADO'));
  if (statuses.size > 1) return { status: 'NAO_CONFIRMADO', reason: 'CONFLITO_NA_PLANILHA' };
  const status = [...statuses][0] || 'NAO_CONFIRMADO';
  return { status, reason: status === 'NAO_CONFIRMADO' ? 'SEM_ENQUADRAMENTO' : null };
}
