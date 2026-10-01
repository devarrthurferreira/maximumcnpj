import { parseProvider } from './lookup-domain.ts';
import { normalizeCnpj, VERSION } from './domain.ts';
import { LOOKUP_TIMEOUT_MS } from './lookup-policy.ts';
const BASE = 'https://minhareceita.org';
export class SourceError extends Error {
  code: string; retryable: boolean; retryAfter: number;
  constructor(code: string, retryable = false, retryAfter = 5) { super(code); this.code = code; this.retryable = retryable; this.retryAfter = retryAfter; }
}
export function retrySeconds(value: string | null, now = Date.now()) {
  if (!value) return 60;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.min(2_147_483_647, Math.ceil(n)));
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(1, Math.min(2_147_483_647, Math.ceil((time - now) / 1000))) : 60;
}
export async function lookupCnpj(cnpj: string, transport: typeof fetch = fetch) {
  const normalized = normalizeCnpj(cnpj);
  if (!normalized.valid) throw new SourceError('CNPJ_INVALIDO');
  cnpj = normalized.cnpj;
  let response: Response;
  try {
    response = await transport(`${BASE}/${encodeURIComponent(cnpj)}`, {headers: {Accept: 'application/json', 'User-Agent': `MaximumCNPJ/${VERSION}`},
      redirect: 'error', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), cache: 'no-store'});
  } catch { throw new SourceError('FONTE_INDISPONIVEL', true); }
  if (response.status === 429) throw new SourceError('LIMITE_DA_FONTE', true, retrySeconds(response.headers.get('retry-after')));
  if (response.status === 404) throw new SourceError('NAO_ENCONTRADO');
  if (response.status >= 500) throw new SourceError('FONTE_INDISPONIVEL', true, response.headers.has('retry-after') ? retrySeconds(response.headers.get('retry-after')) : 5);
  if (response.status === 403 || response.status === 401) throw new SourceError(`FONTE_HTTP_${response.status}`, true, 300);
  if (!response.ok) throw new SourceError(`FONTE_HTTP_${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('json')) throw new SourceError('RESPOSTA_INVALIDA', true);
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('RESPOSTA_INVALIDA', true);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new SourceError('RESPOSTA_ACIMA_DO_LIMITE'); }
      chunks.push(value);
    }
  } catch (e) { if (e instanceof SourceError) throw e; throw new SourceError('FONTE_INDISPONIVEL', true); }
  finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const v of chunks) { bytes.set(v, offset); offset += v.length; }
    return parseProvider(cnpj, JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e instanceof SourceError) throw e;
    const identity = e instanceof Error && e.message === 'SOURCE_IDENTITY';
    throw new SourceError(identity ? 'IDENTIDADE_DIVERGENTE' : 'RESPOSTA_INVALIDA', !identity);
  }
}
