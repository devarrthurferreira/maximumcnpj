/** Small, conservative defaults. Rate limits are shared in MongoDB, not per browser. */
export const LOOKUP_TIMEOUT_MS = 12_000;
export const LOOKUP_BATCH_MS = 24_000;
export const LOOKUP_BATCH_SIZE = 40;
export function lookupPolicy(env: Record<string, string | undefined> = process.env) {
  const bounded = (value: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(value);
    return value && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
  };
  return {
    concurrency: bounded(env.LOOKUP_CONCURRENCY, 3, 1, 4),
    intervalMs: bounded(env.LOOKUP_INTERVAL_MS, 500, 300, 10_000)
  };
}
/** Drain in-flight work before rejecting: the caller must not release its job lease early. */
export async function boundedWorkers(count: number, work: () => Promise<void>) {
  const results = await Promise.allSettled(Array.from({length: count}, work));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
