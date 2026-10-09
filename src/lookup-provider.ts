import { parseProvider, parseOpenCnpj, SOURCE_NAME, FALLBACK_SOURCE_NAME } from './lookup-domain.ts';
import { normalizeCnpj, VERSION } from './domain.ts';
import { LOOKUP_TIMEOUT_MS, LOOKUP_SOURCE_TIMEOUT_MS } from './lookup-policy.ts';
export class SourceError extends Error {
  code: string; retryable: boolean; retryAfter: number; pauseProvider: boolean; source: string; fallbackAllowed: boolean;
  constructor(code: string, retryable = false, retryAfter = 5, pauseProvider = false, source = SOURCE_NAME, fallbackAllowed = false) {
    super(code); this.code = code; this.retryable = retryable; this.retryAfter = retryAfter; this.pauseProvider = pauseProvider;
    this.source = source; this.fallbackAllowed = fallbackAllowed;
  }
}
export function retrySeconds(value: string | null, now = Date.now()) {
  if (!value) return 60;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.min(2_147_483_647, Math.ceil(n)));
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(1, Math.min(2_147_483_647, Math.ceil((time - now) / 1000))) : 60;
}
async function lookupSource(cnpj: string, url: string, source: string, parse: typeof parseProvider, transport: typeof fetch, timeoutMs: number) {
  const fail = (code: string, retryable = false, retryAfter = 5, pauseProvider = false, fallbackAllowed = false) =>
    new SourceError(code, retryable, retryAfter, pauseProvider, source, fallbackAllowed);
  let response: Response;
  try {
    response = await transport(url, {headers: {Accept: 'application/json', 'User-Agent': `MaximumCNPJ/${VERSION}`},
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store'});
  } catch { throw fail('FONTE_INDISPONIVEL', true, 5, false, true); }
  if (response.status === 429) throw fail('LIMITE_DA_FONTE', true, retrySeconds(response.headers.get('retry-after')), true);
  if (response.status === 404) throw fail('NAO_ENCONTRADO');
  if (response.status >= 500) {
    const instructedPause = response.headers.has('retry-after');
    throw fail('FONTE_INDISPONIVEL', true, instructedPause ? retrySeconds(response.headers.get('retry-after')) : 5, true, !instructedPause);
  }
  if (response.status === 403 || response.status === 401) throw fail(`FONTE_HTTP_${response.status}`, true, 300, true);
  if (!response.ok) throw fail(`FONTE_HTTP_${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('json')) throw fail('RESPOSTA_INVALIDA', true, 5, false, true);
  const reader = response.body?.getReader();
  if (!reader) throw fail('RESPOSTA_INVALIDA', true, 5, false, true);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw fail('RESPOSTA_ACIMA_DO_LIMITE'); }
      chunks.push(value);
    }
  } catch (e) { if (e instanceof SourceError) throw e; throw fail('FONTE_INDISPONIVEL', true, 5, false, true); }
  finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const v of chunks) { bytes.set(v, offset); offset += v.length; }
    return parse(cnpj, JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e instanceof SourceError) throw e;
    const identity = e instanceof Error && e.message === 'SOURCE_IDENTITY';
    throw fail(identity ? 'IDENTIDADE_DIVERGENTE' : 'RESPOSTA_INVALIDA', !identity, 5, false, !identity);
  }
}
export async function lookupCnpj(cnpj: string, transport: typeof fetch = fetch) {
  const normalized = normalizeCnpj(cnpj);
  if (!normalized.valid) throw new SourceError('CNPJ_INVALIDO');
  cnpj = normalized.cnpj;
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  try {
    return await lookupSource(cnpj, `https://minhareceita.org/${encodeURIComponent(cnpj)}`, SOURCE_NAME, parseProvider, transport, LOOKUP_SOURCE_TIMEOUT_MS);
  } catch (primaryError) {
    // Do not route around authentication, a rate limit, Retry-After, or untrusted identity.
    if (!(primaryError instanceof SourceError) || !primaryError.fallbackAllowed) throw primaryError;
    const remaining = Math.min(LOOKUP_SOURCE_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) throw primaryError;
    try {
      return await lookupSource(cnpj, `https://api.opencnpj.org/${encodeURIComponent(cnpj)}?datasets=receita`, FALLBACK_SOURCE_NAME, parseOpenCnpj, transport, remaining);
    } catch (fallbackError) {
      if (!(fallbackError instanceof SourceError)) throw fallbackError;
      const invalidIdentityOrSize = ['IDENTIDADE_DIVERGENTE', 'RESPOSTA_ACIMA_DO_LIMITE'].includes(fallbackError.code);
      throw new SourceError(fallbackError.code, !invalidIdentityOrSize && (primaryError.retryable || fallbackError.retryable),
        Math.max(primaryError.retryAfter, fallbackError.retryAfter), primaryError.pauseProvider || fallbackError.pauseProvider,
        `${SOURCE_NAME} / ${FALLBACK_SOURCE_NAME}`);
    }
  }
}
