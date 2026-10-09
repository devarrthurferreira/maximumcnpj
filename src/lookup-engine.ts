import { randomUUID } from 'node:crypto';
import { collection, scope, workspace, audit } from './store.ts';
import { need, digest, integer } from './security.ts';
import { statistics } from './domain.ts';
import { compareNames } from './lookup-domain.ts';
import { lookupCnpj, SourceError } from './lookup-provider.ts';
import { withJob, getJob, write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { isFinancialMode } from './purchase-domain.ts';
import { purchaseSummary } from './purchase-store.ts';
import { boundedWorkers, lookupPolicy, LOOKUP_TIMEOUT_MS, LOOKUP_BATCH_MS, LOOKUP_BATCH_SIZE } from './lookup-policy.ts';

const CONTROL = 'minhareceita-global';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const time = (value: any) => value instanceof Date ? value.getTime() : 0;

async function initializeSlots(concurrency: number) {
  const controls = await collection('providerControl');
  const ids = [CONTROL, ...Array.from({length: concurrency}, (_, i) => `minhareceita-slot-${i}`)];
  try {
    await controls.bulkWrite(ids.map(_id => ({updateOne: {filter: {_id}, update: {$setOnInsert: {nextAt: new Date(0), leaseUntil: new Date(0)}}, upsert: true}})), {ordered: false});
  } catch (error: any) {
    // Two independent jobs can initialize the same _id concurrently.
    const errors = error.writeErrors || [];
    if (error.code !== 11000 || (errors.length && errors.some((e: any) => e.code !== 11000))) throw error;
  }
}
async function takeSlot(owner: string, concurrency: number, intervalMs: number) {
  const controls = await collection('providerControl'), now = new Date();
  const ids = Array.from({length: concurrency}, (_, i) => `minhareceita-slot-${i}`);
  const slot = await controls.findOneAndUpdate({_id: {$in: ids}, leaseUntil: {$lte: now}},
    {$set: {owner, leaseUntil: new Date(Date.now() + 45_000)}}, {sort: {_id: 1}, returnDocument: 'after'});
  if (!slot) return {id: '', waitMs: 500};
  let admitted = false;
  try {
    // Refresh the clock after reserving the slot: MongoDB latency is not an extra rate limit.
    const admissionTime = new Date();
    // Honor both the previous deployment's exclusive lease and a shared Retry-After.
    const turn = await controls.findOneAndUpdate({_id: CONTROL, nextAt: {$lte: admissionTime}, leaseUntil: {$lte: admissionTime}},
      {$set: {nextAt: new Date(Date.now() + intervalMs)}}, {returnDocument: 'after'});
    if (turn) { admitted = true; return {id: slot._id, waitMs: 0}; }
    const current = await controls.findOne({_id: CONTROL});
    return {id: '', waitMs: Math.max(100, Math.max(time(current?.nextAt), time(current?.leaseUntil)) - Date.now())};
  } finally {
    if (!admitted) await releaseSlot(owner, slot._id);
  }
}
async function releaseSlot(owner: string, id: string) {
  await (await collection('providerControl')).updateOne({_id: id, owner},
    {$set: {leaseUntil: new Date(0)}, $unset: {owner: ''}});
}
async function sharedUpsert(name: string, filter: Record<string, unknown>, update: any) {
  const records = await collection(name);
  try { await records.updateOne(filter, update, {upsert: true}); }
  catch (error: any) {
    if (error.code !== 11000) throw error;
    // A concurrent job may have inserted exactly this identity. Do not swallow other conflicts.
    const result = await records.updateOne(filter, update);
    if (result.matchedCount !== 1) throw error;
  }
}
async function cooldown(seconds: number) {
  await (await collection('providerControl')).updateOne({_id: CONTROL}, {$max: {nextAt: new Date(Date.now() + seconds * 1000)}});
}

export async function lookupProgress(id: string, page = 1, filter = 'ALL', summaryOnly = false) {
  const job = await getJob(id);
  integer(page, 1, 100000);
  need(['ALL', 'OPTANTE', 'NAO_OPTANTE', 'NAO_CONFIRMADO', 'PENDING'].includes(filter), 'Filtro de acompanhamento inválido.');
  const items = await collection('lookupItems'), base = scope({jobId: id});
  const query: any = {...base};
  if (filter === 'PENDING') query.state = {$ne: 'DONE'};
  else if (filter !== 'ALL') { query.state = 'DONE'; query.status = filter; }
  const [groups, rows] = await Promise.all([
    items.aggregate([{$match: base}, {$group: {_id: {state: '$state', status: '$status'}, count: {$sum: 1}}}], {maxTimeMS: 15000}).toArray(),
    summaryOnly ? Promise.resolve([]) : items.aggregate([
      {$match: query}, {$sort: {cnpj: 1}}, {$skip: (page - 1) * 25}, {$limit: 25},
      {$lookup: {from: 'cnpjStates', let: {stateId: '$stateId', identity: '$cnpj'}, pipeline: [
        {$match: {$expr: {$and: [{$eq: ['$_id', '$$stateId']}, {$eq: ['$workspaceId', scope().workspaceId]}, {$eq: ['$cnpj', '$$identity']}]}}},
        {$project: {_id: 0, name: 1, status: 1, mei: 1, source: 1}}
      ], as: 'details'}},
      {$project: {_id: 0, cnpj: 1, submittedName: 1, state: 1, status: 1, reason: 1, checkedAt: 1, attempts: 1, nextAt: 1, source: 1, details: {$arrayElemAt: ['$details', 0]}}}
    ], {maxTimeMS: 15000}).toArray()
  ]);
  const metrics = {total: 0, completed: 0, optants: 0, nonOptants: 0, unconfirmed: 0, pending: 0, retrying: 0};
  for (const group of groups) {
    metrics.total += group.count;
    if (group._id.state === 'DONE') {
      metrics.completed += group.count;
      if (group._id.status === 'OPTANTE') metrics.optants += group.count;
      else if (group._id.status === 'NAO_OPTANTE') metrics.nonOptants += group.count;
      else metrics.unconfirmed += group.count;
    } else if (group._id.state === 'RETRY') metrics.retrying += group.count;
    else metrics.pending += group.count;
  }
  const total = filter === 'ALL' ? metrics.total : filter === 'PENDING' ? metrics.pending + metrics.retrying :
    groups.filter(group => group._id.state === 'DONE' && group._id.status === filter).reduce((sum, group) => sum + group.count, 0);
  return {job: {_id: job._id, status: job.status, mode: job.mode, clientId: job.clientId, clientName: job.clientName, expected: job.summary?.unique || 0},
    partial: job.status !== 'COMPLETED', metrics, items: rows, total, page, pageSize: 25, ...(summaryOnly ? {summaryOnly: true} : {})};
}

export async function processLookupBatch(actor: LookupActor, id: string, transport: typeof fetch = fetch) {
  write(actor);
  return withJob(id, async job => {
    if (job.status === 'COMPLETED') return job;
    need(job.status === 'PROCESSING', 'Finalize o envio antes de consultar.', 409);
    const {concurrency, intervalMs} = lookupPolicy();
    const items = await collection('lookupItems'), deadline = Date.now() + LOOKUP_BATCH_MS;
    const queue = await items.find(scope({jobId: id, state: {$in: ['PENDING', 'RETRY']}, $or: [{nextAt: {$exists: false}}, {nextAt: {$lte: new Date()}}]}))
      .sort({cnpj: 1}).limit(LOOKUP_BATCH_SIZE).toArray();
    if (queue.length) await initializeSlots(concurrency);
    let cursor = 0, stop = false;
    let admission = Promise.resolve(), nextAdmissionAt = 0;
    // Only admission is serialized locally. Source requests remain concurrent, and
    // every admitted request still owns a MongoDB slot and wins the shared rate gate.
    const admit = async (owner: string) => {
      const previous = admission;
      let release!: () => void;
      admission = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        while (!stop && Date.now() < deadline - LOOKUP_TIMEOUT_MS - 1000) {
          const delay = nextAdmissionAt - Date.now();
          if (delay > 2000) { stop = true; return ''; }
          if (delay > 0) { await wait(delay); continue; }
          const slot = await takeSlot(owner, concurrency, intervalMs);
          if (slot.id) { nextAdmissionAt = Date.now() + intervalMs; return slot.id; }
          if (slot.waitMs > 2000) { stop = true; return ''; }
          nextAdmissionAt = Date.now() + slot.waitMs;
        }
        return '';
      } finally { release(); }
    };
    await boundedWorkers(Math.min(concurrency, queue.length), async () => {
      while (!stop && cursor < queue.length && Date.now() < deadline - LOOKUP_TIMEOUT_MS - 1000) {
        const item = queue[cursor++], owner = randomUUID();
        let slotId = '';
        try {
          slotId = await admit(owner);
          if (!slotId || stop) return;
          try {
            const data = await lookupCnpj(item.cnpj, transport), checkedAt = new Date();
            const attempts = (item.attempts || 0) + 1;
            // Missing flags are not a negative response. Retry once without pausing unrelated CNPJs.
            const retry = data.status === 'NAO_CONFIRMADO' && attempts < 2;
            const fingerprint = digest(JSON.stringify(data)), stateId = `${workspace()}:${item.cnpj}:${fingerprint}`;
            const entityId = `${workspace()}:${item.cnpj}`;
            const persisted = await Promise.allSettled([
              sharedUpsert('cnpjStates', scope({_id: stateId}), {$setOnInsert: {...scope(), ...data, fingerprint, firstSeenAt: checkedAt}}),
              sharedUpsert('cnpjEntities', scope({_id: entityId, cnpj: item.cnpj}), {$setOnInsert: {...scope(), cnpj: item.cnpj, createdAt: checkedAt}})
            ]);
            const failed = persisted.find((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (failed) throw failed.reason;
            // Neither the latest entity nor a completed item may point at an unsaved state.
            await (await collection('cnpjEntities')).updateOne(scope({_id: entityId, $or: [{lastCheckedAt: {$exists: false}}, {lastCheckedAt: {$lte: checkedAt}}]}),
              {$set: {stateId, name: data.name, lastCheckedAt: checkedAt}});
            await items.updateOne(scope({_id: item._id}), {$set: {state: retry ? 'RETRY' : 'DONE', stateId, status: data.status, reason: data.reason, checkedAt,
              nameMatch: compareNames(item.submittedName, data.name, data.tradeName), source: data.source, sourceReferenceDate: null,
              ...(retry ? {nextAt: new Date(Date.now() + 5000)} : {})}, $inc: {attempts: 1}, ...(!retry ? {$unset: {nextAt: ''}} : {})});
          } catch (error) {
            if (!(error instanceof SourceError)) throw error;
            const attempts = (item.attempts || 0) + 1, retry = error.retryable && attempts < 3;
            const seconds = error.code === 'LIMITE_DA_FONTE' ? error.retryAfter : Math.max(5, error.retryAfter);
            if (error.pauseProvider) { stop = true; await cooldown(seconds); }
            await items.updateOne(scope({_id: item._id}), {$set: {state: retry ? 'RETRY' : 'DONE', status: 'NAO_CONFIRMADO', reason: error.code,
              checkedAt: new Date(), source: 'Minha Receita', ...(retry ? {nextAt: new Date(Date.now() + seconds * 1000)} : {})},
              $inc: {attempts: 1}, $unset: {stateId: '', nameMatch: '', ...(!retry ? {nextAt: ''} : {})}});
          }
        } catch (error) { stop = true; throw error; }
        finally { if (slotId) await releaseSlot(owner, slotId); }
      }
    });
    const [received, control, nextItem] = await Promise.all([
      items.countDocuments(scope({jobId: id, state: 'DONE'})),
      (await collection('providerControl')).findOne({_id: CONTROL}),
      items.findOne(scope({jobId: id, state: {$in: ['PENDING', 'RETRY']}}), {sort: {nextAt: 1}, projection: {nextAt: 1}})
    ]);
    need(received <= job.summary.unique, 'Contagem inconsistente.', 409, 'RESULT_COUNT');
    const nextAt = Math.max(time(control?.nextAt), time(control?.leaseUntil), time(nextItem?.nextAt));
    const update: any = {received, updatedAt: new Date(), nextPollMs: Math.max(0, Math.min(60000, nextAt - Date.now()))};
    if (received === job.summary.unique) {
      const docs = await items.find(scope({jobId: id})).project({cnpj: 1, status: 1}).toArray();
      if (isFinancialMode(job.mode)) await purchaseSummary(id, false, job.mode);
      update.status = 'COMPLETED'; update.completedAt = new Date(); update.resultSummary = statistics(docs as any);
      await audit(actor._id, 'lookup.completed', id);
    }
    await (await collection('lookupJobs')).updateOne(scope({_id: id}), {$set: update});
    return getJob(id);
  });
}
