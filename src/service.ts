import { randomUUID } from 'node:crypto';
import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { need, text, integer, digest, AppError, escapeRegex } from './security.ts';
import { prepareRows, statistics, VERSION, MAX_ROWS, normalizeCnpj, LABELS } from './domain.ts';
import type { Status } from './domain.ts';
import { BigQuerySource, configuration } from './provider.ts';
export type Actor = { _id: string; role: string; name: string; email: string };
export function canWrite(actor: Actor) { need(['admin','operator'].includes(actor.role), 'Seu perfil permite apenas leitura.', 403, 'FORBIDDEN'); }
export function canAdmin(actor: Actor) { need(actor.role === 'admin', 'Ação exclusiva do administrador.', 403, 'FORBIDDEN'); }
export async function batch(id: string) {
  const b = await (await collection('batches')).findOne(scope({ _id: id }));
  need(b, 'Lote não encontrado.', 404, 'NOT_FOUND'); return b;
}
export async function clients() { return (await collection('clients')).find(scope()).sort({ name: 1 }).limit(1000).toArray(); }
export async function saveClient(actor: Actor, input: any, id?: string) {
  canWrite(actor);
  const name = text(input.name), checked = input.cnpj ? normalizeCnpj(input.cnpj) : null;
  need(!checked || checked.valid, 'CNPJ da empresa inválido. Para carteira sem CNPJ, deixe vazio.');
  const fields = { name, cnpj: checked?.cnpj || null, notes: String(input.notes || '').slice(0,1000), active: input.active !== false, updatedAt: new Date() };
  const c = await collection('clients');
  if (id) { const r = await c.updateOne(scope({ _id: id }), { $set: fields }); need(r.matchedCount, 'Carteira não encontrada.', 404); }
  else { id = randomUUID(); await c.insertOne({ _id: id, ...scope(), ...fields, createdAt: new Date(), createdBy: actor._id }); }
  await audit(actor._id, 'client.save', id); return { id };
}
export async function createBatch(actor: Actor, input: any) {
  canWrite(actor);
  const clientId = text(input.clientId), c = await (await collection('clients')).findOne(scope({ _id: clientId, active: true }));
  need(c, 'Selecione a empresa ou carteira responsável pela base.');
  const id = text(input.importId); need(/^[a-f0-9-]{36}$/.test(id), 'Identificador da importação inválido.');
  const existing = await (await collection('batches')).findOne(scope({ _id: id, createdBy: actor._id }));
  if (existing) return existing;
  need(Array.isArray(input.headers) && input.headers.length > 0 && input.headers.length <= 80 && input.headers.every((v: unknown) => typeof v === 'string' && v.length <= 200), 'Cabeçalhos inválidos.');
  const b: Doc = { _id: id, ...scope(), clientId, clientName: c.name, fileName: text(input.fileName, 200), headers: input.headers,
    expectedRows: integer(input.expectedRows, 1, MAX_ROWS), cnpjColumn: integer(input.cnpjColumn, 0, input.headers.length-1), nameColumn: integer(input.nameColumn, -1, input.headers.length-1),
    createdBy: actor._id, createdAt: new Date(), updatedAt: new Date(), status: 'UPLOADING', uploaded: 0, version: VERSION, attempts: 0 };
  await (await collection('batches')).insertOne(b); await audit(actor._id, 'batch.create', id); return b;
}
/** Leases prevent simultaneous page/row mutations; expired leases are recoverable. */
async function locked<T>(id: string, action: (b: Doc, owner: string) => Promise<T>): Promise<T> {
  const batches = await collection('batches'), owner = randomUUID();
  const b = await batches.findOneAndUpdate(scope({ _id: id, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: new Date() } }] }), { $set: { lockOwner: owner, lockUntil: new Date(Date.now()+120000) } }, { returnDocument: 'after' });
  need(b, 'Lote em processamento. Aguarde a operação atual e tente novamente.', 409, 'BATCH_BUSY');
  try { return await action(b, owner); }
  finally { await batches.updateOne(scope({ _id: id, lockOwner: owner }), { $unset: { lockUntil: '', lockOwner: '' } }); }
}
export async function uploadRows(actor: Actor, id: string, input: any) {
  canWrite(actor);
  return locked(id, async b => {
    need(b.status === 'UPLOADING', 'Este lote não aceita mais linhas.', 409);
    need(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 250, 'Envie no máximo 250 linhas por parte.');
    const offset = integer(input.offset, 0, b.expectedRows-1); need(offset + input.rows.length <= b.expectedRows, 'Parte excede o total informado.');
    const rows = prepareRows(input.rows, b.cnpjColumn, b.nameColumn);
    need(rows.every(r => r.values.length === b.headers.length), 'A quantidade de colunas deve corresponder aos cabeçalhos.');
    const hash = digest(JSON.stringify(input.rows));
    const chunkId = `${id}:${offset}`;
    const previous = await (await collection('chunks')).findOne(scope({ _id: chunkId }));
    if (previous) {
      need(previous.hash === hash, 'O conteúdo desta parte diverge do envio anterior.', 409);
      if (previous.complete) return { uploaded: b.uploaded };
    }
    need(offset === b.uploaded || (previous && offset + rows.length === b.uploaded), 'Envie a próxima parte na ordem esperada.', 409, 'UPLOAD_OFFSET');
    await (await collection('chunks')).updateOne(scope({ _id: chunkId }), { $setOnInsert: { hash, length: rows.length, ...scope(), complete: false } }, { upsert: true });
    await (await collection('rows')).bulkWrite(rows.map(r => ({ updateOne: { filter: scope({ batchId: id, index: offset+r.index }), update: { $setOnInsert: { ...r, index: offset+r.index, _id: `${id}:${offset+r.index}`, ...scope(), batchId: id } }, upsert: true } })), { ordered: true });
    // Row upserts and fixed offsets make a interrupted part safe to resend.
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { uploaded: offset+rows.length, updatedAt: new Date() } });
    await (await collection('chunks')).updateOne(scope({ _id: chunkId }), { $set: { complete: true } });
    return { uploaded: offset+rows.length };
  });
}
export async function finishUpload(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    if (b.status !== 'UPLOADING') return b;
    const rows = await collection('rows'), count = await rows.countDocuments(scope({ batchId: id }));
    need(count === b.expectedRows, 'O envio ainda não está completo.', 409);
    const unique = await rows.distinct('cnpj', scope({ batchId: id, valid: true }));
    const invalid = await rows.countDocuments(scope({ batchId: id, valid: false }));
    const summary = { lines: count, unique: unique.length, invalid, duplicates: count-invalid-unique.length };
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: unique.length ? 'READY' : 'INVALID', summary, uploaded: count, updatedAt: new Date() } });
    await audit(actor._id, 'batch.validated', id); return batch(id);
  });
}
async function identifiers(id: string): Promise<string[]> { return (await collection('rows')).distinct('cnpj', scope({ batchId: id, valid: true })); }
export async function estimate(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    need(['READY','ESTIMATED'].includes(b.status), 'Valide a importação antes de estimar.', 409);
    const c = configuration(), estimate = await new BigQuerySource(c).estimate(await identifiers(id));
    const estimateId = randomUUID();
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { estimate: { ...estimate, id: estimateId, at: new Date(), config: c }, status: 'ESTIMATED', updatedAt: new Date() } });
    await audit(actor._id, 'query.estimate', id); return batch(id);
  });
}
export async function start(actor: Actor, id: string, input: any) {
  canWrite(actor);
  return locked(id, async b => {
    if (['RUNNING','FETCHING','COMPLETED'].includes(b.status)) return b;
    need(['ESTIMATED','STARTING'].includes(b.status), 'Gere uma estimativa antes de executar.', 409);
    need(input.estimateId === b.estimate?.id && input.accept === true, 'Confirme a estimativa apresentada.', 409);
    need(b.estimate.withinLimit, 'Estimativa acima do teto configurado.', 422, 'BUDGET_LIMIT');
    const config = configuration();
    if (b.status !== 'STARTING') {
      need(Date.now()-new Date(b.estimate.at).getTime() < 15*60000, 'Estimativa expirada. Estime novamente.', 409, 'ESTIMATE_EXPIRED');
      need(JSON.stringify(config) === JSON.stringify(b.estimate.config), 'Configuração alterada. Estime novamente.', 409);
      const source = await new BigQuerySource(config).inspect();
      need(source.etag === b.estimate.source.etag, 'A fonte mudou após a estimativa. Estime novamente.', 409);
    }
    const jobId = b.jobId || 'maximum_'+randomUUID().replace(/-/g,'');
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { jobId, status: 'STARTING', queryConfig: b.estimate.config, updatedAt: new Date() } });
    await new BigQuerySource(b.estimate.config).start(jobId, await identifiers(id));
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'RUNNING', startedAt: b.startedAt || new Date(), updatedAt: new Date() } });
    await audit(actor._id, 'query.start', id); return batch(id);
  });
}
export async function advance(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    if (!['RUNNING','FETCHING'].includes(b.status)) return b;
    const source = new BigQuerySource(b.queryConfig);
    const job = await source.job(b.jobId);
    if (job.status?.errorResult) {
      await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'FAILED', failure: 'QUERY_FAILED', updatedAt: new Date() } });
      return batch(id);
    }
    const page = await source.page(b.jobId, b.pageToken);
    if (page.running) return b;
    need(page.total === b.summary.unique, 'Total retornado diverge dos CNPJs únicos. Nenhum resultado publicado.', 502, 'RESULT_COUNT');
    const expected = new Set(await identifiers(id));
    need(page.results.every(r => expected.has(r.cnpj)), 'Resposta contém CNPJ fora do lote.', 502, 'RESULT_IDENTITY');
    const results = await collection('results');
    if (page.results.length) await results.bulkWrite(page.results.map(r => ({ updateOne: { filter: scope({ batchId: id, cnpj: r.cnpj }), update: { $setOnInsert: { _id: `${id}:${r.cnpj}`, ...scope(), ...r, batchId: id, clientId: b.clientId, observedAt: b.startedAt, source: b.estimate.source, completed: false } }, upsert: true } })), { ordered: true });
    const received = await results.countDocuments(scope({ batchId: id }));
    if (page.next) {
      need(page.next !== b.pageToken, 'O provedor repetiu a paginação.', 502, 'PAGE_LOOP');
      await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'FETCHING', pageToken: page.next, received, updatedAt: new Date() } });
    } else {
      need(received === b.summary.unique, 'Resultados incompletos; publicação bloqueada.', 502, 'RESULT_COUNT');
      const summary = statistics(await results.find(scope({ batchId: id })).project({ cnpj:1, status:1, mei:1 }).toArray() as any);
      // Dashboard joins batches in COMPLETED, so this flag alone never publishes partial results.
      await results.updateMany(scope({ batchId: id }), { $set: { completed: true } });
      await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'COMPLETED', received, resultSummary: summary, completedAt: new Date(), bytesProcessed: page.billed, bytesBilled: job.statistics?.query?.totalBytesBilled || null, updatedAt: new Date() }, $unset: { pageToken: '' } });
      await audit(actor._id, 'query.completed', id);
    }
    return batch(id);
  });
}
export async function cancel(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    need(!['COMPLETED','CANCELLED'].includes(b.status), 'Lote finalizado não pode ser cancelado.', 409);
    if (b.jobId) await new BigQuerySource(b.queryConfig).cancel(b.jobId);
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'CANCELLED', updatedAt: new Date() } });
    await audit(actor._id, 'batch.cancel', id); return batch(id);
  });
}
export async function dashboard(clientId?: string) {
  const f = scope(clientId ? { clientId } : {});
  const results = await (await collection('results')).aggregate([
    { $match: { ...f, completed: true } },
    { $lookup: { from: 'batches', localField: 'batchId', foreignField: '_id', as: 'batch' } },
    { $match: { 'batch.status': 'COMPLETED' } },
    { $sort: { cnpj: 1, observedAt: -1, batchId: -1 } },
    { $group: { _id: '$cnpj', status: { $first: '$status' }, mei: { $first: '$mei' } } },
    { $group: { _id: '$status', count: { $sum: 1 }, mei: { $sum: { $cond: ['$mei', 1, 0] } } } }
  ], { allowDiskUse: true, maxTimeMS: 20000 }).toArray();
  const sum = (status: Status) => results.find(r => r._id === status)?.count || 0;
  const optants = sum('OPTANTE'), nonOptants = sum('NAO_OPTANTE'), unknown = sum('NAO_CONFIRMADO'), total = optants+nonOptants+unknown;
  const p = (n: number) => total ? Math.round(n/total*10000)/100 : 0;
  const recent = await (await collection('batches')).find(f).sort({ createdAt: -1 }).limit(12).toArray();
  return { metrics: { total, optants, nonOptants, unknown, optantsPercent:p(optants), nonOptantsPercent:p(nonOptants), unknownPercent:p(unknown), coverage:p(optants+nonOptants), mei:results.find(r=>r._id==='OPTANTE')?.mei||0 }, recent, clientCount: await (await collection('clients')).countDocuments(scope({ active:true })), batchCount: await (await collection('batches')).countDocuments(f) };
}
export async function listBatches(clientId?: string, page = 1) {
  const q = scope(clientId ? { clientId } : {}), c = await collection('batches');
  return { items: await c.find(q).sort({ createdAt: -1 }).skip((page-1)*30).limit(30).toArray(), total: await c.countDocuments(q), page };
}
export async function listResults(id: string, page = 1, status = '', search = '') {
  const b = await batch(id); need(b.status === 'COMPLETED', 'Os resultados só são publicados depois da conferência completa do lote.', 409);
  const q: Record<string, unknown> = scope({ batchId: id });
  if (status) { need(status in LABELS, 'Status inválido.'); q.status = status; }
  if (search) q.$or = [{ cnpj: { $regex: escapeRegex(search.slice(0,100)), $options:'i' } }, { name: { $regex: escapeRegex(search.slice(0,100)), $options:'i' } }];
  const c = await collection('results');
  return { items: await c.find(q).sort({ cnpj:1 }).skip((page-1)*50).limit(50).toArray(), total: await c.countDocuments(q), page };
}
export async function exportRows(id: string, offset: number) {
  const b = await batch(id); need(['COMPLETED','INVALID','READY','ESTIMATED'].includes(b.status), 'Aguarde o processamento antes de exportar.', 409);
  // Bound both row count and bytes, including sheets with very wide cells.
  const candidates = await (await collection('rows')).find(scope({ batchId:id, index:{$gte:offset} })).sort({ index:1 }).limit(500).toArray();
  const rows: Doc[] = []; let bytes = 0;
  for (const r of candidates) { const size = Buffer.byteLength(JSON.stringify(r.values)); if (rows.length && bytes+size>1200000) break; rows.push(r); bytes+=size; }
  const results = await (await collection('results')).find(scope({ batchId:id, completed:true, cnpj:{$in:rows.map(r=>r.cnpj)} })).toArray();
  const map = new Map(results.map(r=>[r.cnpj,r]));
  const first = await (await collection('rows')).aggregate([{ $match: scope({ batchId:id, valid:true, cnpj:{$in:rows.map(r=>r.cnpj)} }) }, { $group:{ _id:'$cnpj', index:{$min:'$index'} } }]).toArray();
  const firstIndex = new Map(first.map(r=>[r._id,r.index]));
  return { headers:[...b.headers,'CNPJ_NORMALIZADO','VALIDACAO','DUPLICADO','SIMPLES','MEI','MOTIVO','FONTE','REFERENCIA_BASE','CONSULTADO_EM'], rows: rows.map(r => { const a=map.get(r.cnpj); return [...r.values, r.cnpj, r.valid?'Válido':'Inválido', r.valid && firstIndex.get(r.cnpj)!==r.index?'Sim':'Não', a?LABELS[a.status as Status]:'Não confirmado', a?.mei===true?'Sim':a?.mei===false?'Não':'Não confirmado', r.reason || a?.reason || (a?'':'NAO_CONSULTADO'), a?.source?.table || '', a?.source?.referenceDate || '', a?.observedAt?.toISOString() || '']; }), next: offset+rows.length < b.expectedRows ? offset+rows.length : null };
}
