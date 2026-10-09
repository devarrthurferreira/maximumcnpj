/**
 * Reproducible lookup benchmark: synthetic source, real disposable local MongoDB.
 * Run with Node 22 and MONGODB_URI=mongodb://127.0.0.1:27017.
 * Optional BENCH_*: COUNT (2–40), PROVIDER_MS (0–2000), DB_RTTS (0–150 comma
 * separated), REPEATS (1–3), CONCURRENCY (1–4), INTERVAL_MS (300–1000),
 * POLL_MODE (server|none), OUTPUT (JSON filename), REPO (source checkout).
 * Setup is excluded; elapsed time includes server-requested pauses between batches.
 * Mongo RTT is a simulation around actual driver commands, not measured cloud RTT.
 */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const sourceRoot = resolve(process.env.BENCH_REPO || dirname(fileURLToPath(import.meta.url)), process.env.BENCH_REPO ? '.' : '..');
const require = createRequire(resolve(sourceRoot, 'package.json'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (name, fallback, min, max) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}.`);
  return value;
};
assert(/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?\/?(?:\?[^#]*)?$/.test(process.env.MONGODB_URI || ''),
  'Use a disposable local MongoDB URI without credentials or a database path.');
const count = bounded('BENCH_COUNT', 30, 2, 40);
const providerMs = bounded('BENCH_PROVIDER_MS', 500, 0, 2000);
const repeats = bounded('BENCH_REPEATS', 2, 1, 3);
const scenarios = (process.env.BENCH_DB_RTTS || '0,40').split(',').map(Number);
assert(scenarios.length >= 1 && scenarios.length <= 4 && scenarios.every(n => Number.isInteger(n) && n >= 0 && n <= 150),
  'BENCH_DB_RTTS must contain one to four integer delays from 0 to 150 ms.');
const pollMode = process.env.BENCH_POLL_MODE || 'server';
assert(['server', 'none'].includes(pollMode), 'BENCH_POLL_MODE must be server or none.');

const imported = file => import(pathToFileURL(resolve(sourceRoot, 'src', file)).href);
const {database, collection, scope, closeDatabase} = await imported('store.ts');
const {digits} = await imported('domain.ts');
const {createLookup, uploadLookup, finalizeLookup, processLookup} = await imported('lookup-jobs.ts');
const {importCatalog} = await imported('lookup-catalog.ts');
const {resetLookupIndexes} = await imported('lookup-db.ts');
const {lookupPolicy} = await imported('lookup-policy.ts');
const defaults = lookupPolicy({});
process.env.LOOKUP_CONCURRENCY = String(bounded('BENCH_CONCURRENCY', defaults.concurrency, 1, 4));
process.env.LOOKUP_INTERVAL_MS = String(bounded('BENCH_INTERVAL_MS', defaults.intervalMs, 300, 1000));
const benchmarkDb = 'maximum_lookup_benchmark_' + randomUUID().replaceAll('-', '');
process.env.MONGODB_DB = benchmarkDb;
process.env.WORKSPACE_ID = 'synthetic-benchmark';
resetLookupIndexes();

// Instrument one wire command, including cursor reads. No source or driver files change.
// This hook is intentionally scoped to the repository's pinned mongodb 6.x driver.
const {Connection} = require('mongodb/lib/cmap/connection.js');
const baseConnectionCommand = Connection.prototype.command;
assert.equal(typeof baseConnectionCommand, 'function', 'MongoDB driver instrumentation must be reviewed after a driver upgrade.');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External HTTP is forbidden in this synthetic benchmark.'); };
let measuring = false, dbRttMs = 0, commands = {};
Connection.prototype.command = async function(ns, command, ...args) {
  const measure = measuring && String(ns.db) === benchmarkDb;
  if (measure) {
    const name = Object.keys(command)[0], collectionName = typeof command[name] === 'string' ? command[name] : '';
    const key = `${name}:${collectionName}`;
    commands[key] = (commands[key] || 0) + 1;
    if (dbRttMs) await sleep(dbRttMs / 2);
  }
  try { return await baseConnectionCommand.call(this, ns, command, ...args); }
  finally { if (measure && dbRttMs) await sleep(dbRttMs / 2); }
};

const actor = {_id: 'benchmark', role: 'admin', name: 'Synthetic benchmark', email: 'benchmark@example.test'};
const doc = n => { const base = '12345678' + String(n).padStart(4, '0'); return base + digits(base); };
const output = {
  engineSha256: createHash('sha256').update(readFileSync(resolve(sourceRoot, 'src/lookup-engine.ts'))).digest('hex'),
  node: process.version, policy: lookupPolicy(), count, providerMs, pollMode,
  rttModel: 'half before and half after Mongo driver Connection.command; real local MongoDB; setup excluded; synthetic source only',
  runs: []
};
let db;
try {
  db = await database();
  assert.equal(db.databaseName, benchmarkDb);
  assert.match(db.databaseName, /^maximum_lookup_benchmark_[a-f0-9]{32}$/);
  const catalog = await importCatalog(actor, [{code: '99991', name: 'Synthetic benchmark only'}]);
  for (const rtt of scenarios) for (let repetition = 1; repetition <= repeats; repetition++) {
    measuring = false; dbRttMs = rtt;
    const rows = Array.from({length: count}, (_, i) => ({cnpj: doc(i + 1), name: 'Empresa sintética'}));
    let job = await createLookup(actor, {importId: randomUUID(), clientId: catalog.items[0].id, fileName: 'synthetic-benchmark.csv', expectedRows: count});
    await uploadLookup(actor, job._id, {offset: 0, rows});
    await finalizeLookup(actor, job._id);
    await (await collection('providerControl')).deleteMany({});
    const starts = [], calls = [], batches = [];
    let active = 0, peak = 0, processingMs = 0, pollWaitMs = 0;
    const provider = async url => {
      const cnpj = String(url).split('/').at(-1);
      calls.push(cnpj); starts.push(performance.now()); active++; peak = Math.max(peak, active);
      try { await sleep(providerMs); return Response.json({cnpj, razao_social: 'Empresa sintética', opcao_pelo_simples: true}); }
      finally { active--; }
    };
    commands = {}; measuring = true;
    const started = performance.now();
    while (job.status !== 'COMPLETED') {
      assert(batches.length < 12, 'Bounded benchmark cannot make progress.');
      const batchStarted = performance.now(), previousCalls = calls.length;
      job = await processLookup(actor, job._id, provider);
      const durationMs = performance.now() - batchStarted;
      processingMs += durationMs;
      batches.push({durationMs: Math.round(durationMs), calls: calls.length - previousCalls, received: job.received, status: job.status, nextPollMs: job.nextPollMs});
      if (job.status !== 'COMPLETED' && pollMode === 'server') {
        const hint = Number(job.nextPollMs), gap = Number.isFinite(hint) && hint >= 0 ? hint : 1200;
        assert(gap <= 60_000, 'Unexpected server pause in a healthy synthetic run.');
        await sleep(gap); pollWaitMs += gap;
      }
    }
    const elapsedMs = performance.now() - started;
    measuring = false;
    assert.equal(calls.length, count);
    assert.equal(new Set(calls).size, count);
    assert.equal(job.resultSummary.optants, count);
    assert.equal(await (await collection('lookupItems')).countDocuments(scope({jobId: job._id, state: 'DONE'})), count);
    assert(peak <= output.policy.concurrency);
    const gaps = starts.slice(1).map((v, i) => v - starts[i]).sort((a, b) => a - b);
    const commandCount = Object.values(commands).reduce((a, b) => a + b, 0);
    const result = {
      dbRttMs: rtt, repetition, elapsedMs: Math.round(elapsedMs), processingMs: Math.round(processingMs), pollWaitMs,
      cnpjsPerSecond: Number((count / (elapsedMs / 1000)).toFixed(3)), mongoCommands: commandCount,
      commandsPerCnpj: Number((commandCount / count).toFixed(2)), providerCalls: calls.length, peakProviderConcurrency: peak,
      sourceGapMs: {minimum: Math.round(Math.min(...gaps)), median: Math.round(gaps[Math.floor(gaps.length / 2)]), maximum: Math.round(Math.max(...gaps))},
      batches, commands: Object.fromEntries(Object.entries(commands).sort((a, b) => b[1] - a[1]))
    };
    output.runs.push(result);
    console.log(JSON.stringify(result));
    if (process.env.BENCH_OUTPUT) writeFileSync(process.env.BENCH_OUTPUT, JSON.stringify(output, null, 2) + '\n');
  }
} finally {
  measuring = false;
  try {
    if (db) {
      assert.equal(db.databaseName, benchmarkDb, 'Cleanup must target only this disposable benchmark database.');
      await db.dropDatabase();
    }
  } finally {
    await closeDatabase(); resetLookupIndexes();
    Connection.prototype.command = baseConnectionCommand;
    globalThis.fetch = originalFetch;
  }
}
