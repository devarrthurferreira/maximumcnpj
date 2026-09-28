import type { IncomingHttpHeaders } from 'node:http';
/** Never derive the allowlist from Host/X-Forwarded-Host supplied by a request. */
function canonical(value: string | undefined, platform = false): string | null {
  if (!value?.trim()) return null;
  try {
    const u = new URL(platform ? `https://${value.trim()}` : value.trim());
    if (u.username || u.password || u.search || u.hash || !['','/'].includes(u.pathname)) return null;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}
export function allowedOrigins(): string[] {
  const values = [canonical(process.env.APP_ORIGIN)];
  if (process.env.VERCEL === '1') {
    for (const key of ['VERCEL_URL','VERCEL_BRANCH_URL','VERCEL_PROJECT_PRODUCTION_URL']) values.push(canonical(process.env[key], true));
  }
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1' && !process.env.APP_ORIGIN) values.push('http://localhost:3000');
  return [...new Set(values.filter((s): s is string => Boolean(s)))];
}
export function appOrigin() { return allowedOrigins()[0] || 'https://maximum-cnpj.vercel.app'; }
export function permittedOrigin(headers: IncomingHttpHeaders): boolean {
  const raw = headers.origin;
  if (typeof raw !== 'string' || raw === 'null') return false;
  const value = canonical(raw);
  return Boolean(value && raw === value && allowedOrigins().includes(value) && headers['sec-fetch-site'] !== 'cross-site');
}
