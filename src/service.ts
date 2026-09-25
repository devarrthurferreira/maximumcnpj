import { randomUUID } from 'node:crypto';
import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { need, text, integer, digest, escapeRegex } from './security.ts';
import { prepareRows, statistics, VERSION, MAX_ROWS, normalizeCnpj, LABELS } from './domain.ts';
import type { Status } from './domain.ts';
import { IMPORT_MODE, importedStatus, mergeImportedStatuses } from './imported.ts';
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
  if (existing) {
    need(existing.mode === IMPORT_MODE && existing.clientId === clientId && existing.fileName === input.fileName && existing.expectedRows === input.expectedRows && JSON.stringify(existing.headers) === JSON.stringify(input.headers) && existing.cnpjColumn === input.cnpjColumn && existing.nameColumn === input.nameColumn && existing.statusColumn === (input.statusColumn ?? -1), 'Este identificador já pertence a outra importação ou mapeamento.', 409, 'IMPORT_CONFLICT');
    return existing;
  }
  need(Array.isArray(input.headers) && input.headers.length > 0 && input.headers.length <= 80 && input.headers.every((v: unknown) => typeof v === 'string' && v.length <= 200), 'Cabeçalhos inválidos.');
  const b: Doc = { _id: id, ...scope(), clientId, clientName: c.name, fileName: text(input.fileName, 200), headers: input.headers,
    expectedRows: integer(input.expectedRows, 1, MAX_ROWS), cnpjColumn: integer(input.cnpjColumn, 0, input.headers.length-1), nameColumn: integer(input.nameColumn, -1, input.headers.length-1),
    statusColumn: integer(input.statusColumn ?? -1, -1, input.headers.length-1), mode: IMPORT_MODE,
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
    need(b.mode === IMPORT_MODE, 'Importação antiga: cancele e reimporte no modo básico.', 409, 'LEGACY_BATCH');
    need(b.status === 'UPLOADING', 'Este lote não aceita mais linhas.', 409);
    need(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 250, 'Envie no máximo 250 linhas por parte.');
    const offset = integer(input.offset, 0, b.expectedRows-1); need(offset + input.rows.length <= b.expectedRows, 'Parte excede o total informado.');
    need(input.rows.every((row: unknown) => Array.isArray(row) && row.every(value => value == null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))), 'As células precisam ser valores simples, não objetos.');
    const rows = prepareRows(input.rows, b.cnpjColumn, b.nameColumn).map(r => ({ ...r, importedStatus: importedStatus(b.statusColumn >= 0 ? r.values[b.statusColumn] : null) }));
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
    need(b.mode === IMPORT_MODE, 'Importação antiga: cancele e reimporte no modo básico.', 409, 'LEGACY_BATCH');
    if (b.status !== 'UPLOADING') return b;
    const rows = await collection('rows'), count = await rows.countDocuments(scope({ batchId: id }));
    need(count === b.expectedRows && b.uploaded === count, 'O envio ainda não está completo.', 409);
    const unique = await rows.distinct('cnpj', scope({ batchId: id, valid: true }));
    const invalid = await rows.countDocuments(scope({ batchId: id, valid: false }));
    const summary = { lines: count, unique: unique.length, invalid, duplicates: count-invalid-unique.length };
    await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: unique.length ? 'PROCESSING' : 'INVALID', summary, received: 0, cursor: '', updatedAt: new Date() } });
    await audit(actor._id, 'batch.validated', id); return batch(id);
  });
}
/** Uma página limitada por execução. Checkpoint e upserts permitem retomada idempotente. */
export async function processBatch(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    need(b.mode === IMPORT_MODE, 'Lote antigo preservado. Reimporte para usar o modo básico.', 409, 'LEGACY_BATCH');
    if (b.status === 'COMPLETED') return b;
    need(b.status === 'PROCESSING', 'Finalize o envio antes de processar.', 409);
    const rows = await collection('rows');
    const page = await rows.aggregate([
      { $match: scope({ batchId: id, valid: true, cnpj: { $gt: b.cursor || '' } }) },
      { $group: { _id: '$cnpj' } }, { $sort: { _id: 1 } }, { $limit: 500 }
    ], { maxTimeMS: 20000 }).toArray();
    const keys = page.map(r => r._id as string);
    const grouped = keys.length ? await rows.aggregate([
      { $match: scope({ batchId: id, valid: true, cnpj: { $in: keys } }) },
      { $sort: { index: 1 } },
      { $group: { _id: '$cnpj', name: { $first: '$name' }, statuses: { $addToSet: '$importedStatus' }, lines: { $sum: 1 } } }
    ], { maxTimeMS: 20000 }).toArray() : [];
    const results = await collection('results');
    if (grouped.length) await results.bulkWrite(grouped.map(r => ({ updateOne: {
      filter: scope({ batchId: id, cnpj: r._id }),
      update: { $setOnInsert: {
        _id: `${id}:${r._id}`, ...scope(), batchId: id, clientId: b.clientId, cnpj: r._id, name: r.name || null,
        ...mergeImportedStatuses(r.statuses), mei: null, sourceCount: r.lines,
        source: { kind: 'PLANILHA', label: 'Informado na planilha; não verificado externamente', fileName: b.fileName },
        observedAt: b.createdAt, completed: false
      } }, upsert: true
    } })), { ordered: true });
    const received = await results.countDocuments(scope({ batchId: id }));
    need(received <= b.summary.unique && (keys.length > 0 || received === b.summary.unique), 'Contagem inconsistente. Os indicadores não foram publicados.', 409, 'RESULT_COUNT');
    if (received === b.summary.unique) {
      const summary = statistics(await results.find(scope({ batchId: id })).project({ cnpj:1, status:1, mei:1 }).toArray() as any);
      // Somente COMPLETED no lote publica as observações no dashboard.
      await results.updateMany(scope({ batchId: id }), { $set: { completed: true } });
      await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { status: 'COMPLETED', received, resultSummary: summary, completedAt: new Date(), updatedAt: new Date() }, $unset: { cursor: '' } });
      await audit(actor._id, 'batch.processed', id);
    } else {
      await (await collection('batches')).updateOne(scope({ _id: id }), { $set: { received, cursor: keys[keys.length-1], updatedAt: new Date() } });
    }
    return batch(id);
  });
}
export async function cancel(actor: Actor, id: string) {
  canWrite(actor);
  return locked(id, async b => {
    need(!['COMPLETED','CANCELLED'].includes(b.status), 'Lote finalizado não pode ser cancelado.', 409);
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
  if (status) { need(Object.hasOwn(LABELS, status), 'Status inválido.'); q.status = status; }
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
  return { headers:[...b.headers,'CNPJ_NORMALIZADO','VALIDACAO','DUPLICADO','SIMPLES','MEI','MOTIVO','FONTE','REFERENCIA_BASE','REGISTRADO_EM'], rows: rows.map(r => { const a=map.get(r.cnpj); return [...r.values, r.cnpj, r.valid?'Válido':'Inválido', r.valid && firstIndex.get(r.cnpj)!==r.index?'Sim':'Não', a?LABELS[a.status as Status]:'Não confirmado', a?.mei===true?'Sim':a?.mei===false?'Não':'Não confirmado', r.reason || a?.reason || (a?'':'SEM_ENQUADRAMENTO'), a?.source?.label || a?.source?.table || '', a?.source?.referenceDate || '', a?.observedAt?.toISOString() || '']; }), next: offset+rows.length < b.expectedRows ? offset+rows.length : null };
}
