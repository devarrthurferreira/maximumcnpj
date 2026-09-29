import { randomUUID } from 'node:crypto';
import { collection, scope, audit } from './store.ts';
import type { Doc } from './store.ts';
import { need, text, integer } from './security.ts';
import { VERSION, MAX_ROWS } from './domain.ts';
import { write } from './lookup-db.ts';
import type { LookupActor } from './lookup-db.ts';
import { createLookup } from './lookup-jobs.ts';
import { PURCHASE_MODE, SALES_MODE } from './purchase-domain.ts';

const PAGE_SIZE = 20;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const JOB_PROJECTION = {
  _id: 1, clientId: 1, mode: 1, generationId: 1, status: 1, fileName: 1,
  expectedRows: 1, uploaded: 1, received: 1, summary: 1, purchaseInput: 1,
  resultSummary: 1, createdAt: 1, updatedAt: 1, completedAt: 1, nextPollMs: 1,
  calculationVersion: 1
};
const REPORT_TYPES = ['PURCHASES', 'SALES'] as const;
type ReportType = typeof REPORT_TYPES[number];
type GenerationCompany = {clientId: string; code: string | null; name: string; purchaseJobId: string | null; purchaseJobIds: string[];
  salesJobId: string | null; salesJobIds: string[]};

function requiredReports(value: unknown, legacy = false): ReportType[] {
  if (value === undefined) return legacy ? ['PURCHASES'] : [...REPORT_TYPES];
  need(Array.isArray(value) && value.length >= 1 && value.length <= 2 &&
    value.every(type => REPORT_TYPES.includes(type)) && new Set(value).size === value.length,
  'Selecione compras, vendas ou ambos.');
  return REPORT_TYPES.filter(type => value.includes(type));
}

function validateRecord(generation: Doc) {
  try { generation.requiredReports = requiredReports(generation.requiredReports, true); }
  catch { need(false, 'Tipos de relatório inconsistentes.', 409, 'GENERATION_INCONSISTENT'); }
  need(Array.isArray(generation.companies) && generation.companies.length >= 1 && generation.companies.length <= 50 &&
    generation.companies.every((company: any) => company && typeof company === 'object' && UUID.test(company.clientId)) &&
    new Set(generation.companies.map((company: GenerationCompany) => company.clientId)).size === generation.companies.length,
  'Geração com empresas inconsistentes.', 409, 'GENERATION_INCONSISTENT');
  const linkedIds: string[] = [];
  for (const company of generation.companies as GenerationCompany[]) {
    // v0.7 generations only persisted purchase slots.
    if (company.salesJobId === undefined && company.salesJobIds === undefined) {
      company.salesJobId = null;
      company.salesJobIds = [];
    }
    for (const type of REPORT_TYPES) {
      const id = type === 'PURCHASES' ? company.purchaseJobId : company.salesJobId;
      const ids = type === 'PURCHASES' ? company.purchaseJobIds : company.salesJobIds;
      need(Array.isArray(ids) && ids.every(value => typeof value === 'string' && UUID.test(value)) && new Set(ids).size === ids.length &&
        (id === null || (typeof id === 'string' && UUID.test(id) && ids.includes(id))),
      'Geração com vínculos inconsistentes.', 409, 'GENERATION_INCONSISTENT');
      linkedIds.push(...ids);
      need(!id || generation.requiredReports.includes(type), 'Relatório vinculado fora dos tipos desta geração.', 409, 'GENERATION_INCONSISTENT');
    }
  }
  need(new Set(linkedIds).size === linkedIds.length, 'Relatório vinculado mais de uma vez.', 409, 'GENERATION_INCONSISTENT');
  return generation;
}

function reportStatus(job: {status?: string} | null | undefined) {
  return !job || ['CANCELLED', 'INVALID'].includes(job.status || '') ? 'MISSING' : job.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS';
}

function uuid(value: unknown) {
  const id = text(value, 36);
  need(UUID.test(id), 'Identificador inválido.');
  return id;
}

async function generations() {
  const c = await collection('generations');
  await c.createIndex({workspaceId: 1, createdAt: -1, _id: -1});
  return c;
}

async function record(id: string) {
  const generation = await (await generations()).findOne(scope({_id: uuid(id)}));
  need(generation, 'Geração não encontrada.', 404, 'NOT_FOUND');
  return validateRecord(generation);
}

async function hydrate(records: Doc[]) {
  records.forEach(validateRecord);
  const ids = records.flatMap(g => g.companies.flatMap((c: GenerationCompany) => [c.purchaseJobId, c.salesJobId]).filter(Boolean));
  const jobs = ids.length ? await (await collection('lookupJobs')).find(scope({_id: {$in: ids}})).project(JOB_PROJECTION).toArray() : [];
  const byId = new Map(jobs.map(job => [job._id, job]));
  return records.map(generation => {
    const companies = generation.companies.map((company: GenerationCompany) => {
      const purchase = company.purchaseJobId ? byId.get(company.purchaseJobId) : null;
      need(!company.purchaseJobId || (purchase && purchase.clientId === company.clientId && purchase.generationId === generation._id && purchase.mode === PURCHASE_MODE),
        'O relatório vinculado não corresponde à empresa desta geração.', 409, 'GENERATION_INCONSISTENT');
      const sales = company.salesJobId ? byId.get(company.salesJobId) : null;
      need(!company.salesJobId || (sales && sales.clientId === company.clientId && sales.generationId === generation._id && sales.mode === SALES_MODE),
        'O relatório vinculado não corresponde à empresa desta geração.', 409, 'GENERATION_INCONSISTENT');
      const statuses = (generation.requiredReports as ReportType[]).map(type => reportStatus(type === 'PURCHASES' ? purchase : sales));
      const status = statuses.every(value => value === 'COMPLETED') ? 'COMPLETED' : statuses.includes('MISSING') ? 'MISSING' : 'IN_PROGRESS';
      return {...company, purchase: purchase || null, sales: sales || null, status};
    });
    const completedCount = companies.filter((company: any) => company.status === 'COMPLETED').length;
    const missingCount = companies.filter((company: any) => company.status === 'MISSING').length;
    const inProgressCount = companies.length - completedCount - missingCount;
    const status = completedCount === companies.length ? 'COMPLETED' : missingCount ? 'MISSING' : 'IN_PROGRESS';
    return {_id: generation._id, createdBy: generation.createdBy, createdAt: generation.createdAt, updatedAt: generation.updatedAt,
      version: generation.version, companies, status, companyCount: companies.length, completedCount, missingCount, inProgressCount, requiredReports: generation.requiredReports, salesAvailable: true};
  });
}

export async function getGeneration(id: string) {
  return (await hydrate([await record(id)]))[0];
}

export async function generationHistory(page: number) {
  const c = await generations(), query = scope();
  const records = await c.find(query).sort({createdAt: -1, _id: -1}).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray();
  return {items: await hydrate(records), total: await c.countDocuments(query), page, pageSize: PAGE_SIZE};
}

export async function createGeneration(actor: LookupActor, input: any) {
  write(actor);
  const id = uuid(input.generationId), reports = requiredReports(input.requiredReports);
  need(Array.isArray(input.clientIds) && input.clientIds.length >= 1 && input.clientIds.length <= 50, 'Selecione de 1 a 50 empresas.');
  const clientIds = input.clientIds.map(uuid) as string[];
  need(new Set(clientIds).size === clientIds.length, 'A mesma empresa não pode ser selecionada duas vezes.');
  const c = await generations();
  const sameInput = (old: Doc) => {
    validateRecord(old);
    need(old.createdBy === actor._id && old.requiredReports.join(',') === reports.join(',') && old.companies.length === clientIds.length && old.companies.every((company: GenerationCompany) => clientIds.includes(company.clientId)),
      'Identificador já utilizado por outra geração.', 409, 'GENERATION_EXISTS');
  };
  const existing = await c.findOne(scope({_id: id}));
  if (existing) { sameInput(existing); return getGeneration(id); }
  const clients = await (await collection('clients')).find(scope({_id: {$in: clientIds}, active: true})).project({_id: 1, code: 1, name: 1}).toArray();
  need(clients.length === clientIds.length, 'Selecione somente empresas ativas deste ambiente.');
  const companyById = new Map(clients.map(client => [client._id, client]));
  const now = new Date();
  const generation = {_id: id, ...scope(), createdBy: actor._id, createdAt: now, updatedAt: now, version: VERSION, requiredReports: reports,
    companies: clientIds.map(clientId => {
      const client = companyById.get(clientId)!;
      return {clientId, code: client.code || null, name: client.name, purchaseJobId: null, purchaseJobIds: [], salesJobId: null, salesJobIds: []};
    })};
  try { await c.insertOne(generation); }
  catch (error: any) {
    if (error.code !== 11000) throw error;
    const concurrent = await c.findOne(scope({_id: id}));
    need(concurrent, 'Identificador de geração indisponível.', 409, 'GENERATION_EXISTS');
    sameInput(concurrent);
    return getGeneration(id);
  }
  await audit(actor._id, 'generation.create', id);
  return getGeneration(id);
}

/** Serializes attachments without requiring MongoDB replica-set transactions. */
export async function withGeneration<T>(id: string, action: (generation: Doc, owner: string) => Promise<T>): Promise<T> {
  const c = await generations(), owner = randomUUID(), now = new Date();
  await record(id);
  const generation = await c.findOneAndUpdate(scope({_id: id, $or: [{leaseUntil: {$exists: false}}, {leaseUntil: {$lt: now}}]}),
    {$set: {leaseOwner: owner, leaseUntil: new Date(Date.now() + 120000)}}, {returnDocument: 'after'});
  need(generation, 'Geração ocupada. Tente novamente em instantes.', 409, 'GENERATION_BUSY');
  try { return await action(validateRecord(generation), owner); }
  finally { await c.updateOne(scope({_id: id, leaseOwner: owner}), {$unset: {leaseOwner: '', leaseUntil: ''}}); }
}

export async function attachGenerationPurchase(actor: LookupActor, id: string, input: any) {
  return attachGenerationReport(actor, id, input, 'PURCHASES');
}

export async function attachGenerationSale(actor: LookupActor, id: string, input: any) {
  return attachGenerationReport(actor, id, input, 'SALES');
}

async function attachGenerationReport(actor: LookupActor, id: string, input: any, type: ReportType) {
  write(actor);
  const clientId = uuid(input.clientId), importId = uuid(input.importId);
  need(input.type === undefined || input.type === type, 'Tipo de relatório diferente da rota selecionada.');
  const mode = type === 'PURCHASES' ? PURCHASE_MODE : SALES_MODE;
  const slot = type === 'PURCHASES' ? 'purchaseJobId' : 'salesJobId';
  const historySlot = type === 'PURCHASES' ? 'purchaseJobIds' : 'salesJobIds';
  const conflict = type === 'PURCHASES' ? 'GENERATION_PURCHASE_EXISTS' : 'GENERATION_SALES_EXISTS';
  const fileName = text(input.fileName, 200), expectedRows = integer(input.expectedRows, 1, MAX_ROWS);
  return withGeneration(id, async (generation, owner) => {
    const company = generation.companies.find((item: GenerationCompany) => item.clientId === clientId) as GenerationCompany | undefined;
    need(company, 'Esta empresa não pertence à geração.', 409, 'GENERATION_CLIENT');
    const jobs = await collection('lookupJobs');
    if (company[slot]) {
      const current = await jobs.findOne(scope({_id: company[slot]}));
      need(current && current.clientId === clientId && current.generationId === id && current.mode === mode,
        'Vínculo do relatório inconsistente.', 409, 'GENERATION_INCONSISTENT');
      if (current._id === importId) {
        need(current.fileName === fileName && current.expectedRows === expectedRows,
          'O arquivo e a quantidade de linhas devem corresponder ao relatório já vinculado.', 409, conflict);
        return {generation: await getGeneration(id), job: current};
      }
      if (current._id !== importId) need(['CANCELLED', 'INVALID'].includes(current.status),
        'Esta empresa já tem um relatório. Retome o existente ou cancele a importação antes de reenviar.', 409, conflict);
    }
    need(!company[historySlot].includes(importId) || company[slot] === importId,
      'Este identificador pertence a um relatório anterior. Inicie uma nova importação.', 409, conflict);
    const lookupInput = {clientId, importId, fileName, expectedRows};
    let job: Doc;
    try { job = await createLookup(actor, lookupInput, mode); }
    catch (error: any) {
      if (error.code !== 11000) throw error;
      // A simultaneous request may have inserted the same ID. Revalidate ownership and metadata.
      job = await createLookup(actor, lookupInput, mode);
    }
    const bound = await jobs.updateOne(scope({_id: importId, clientId, mode,
      $or: [{generationId: {$exists: false}}, {generationId: id}]}), {$set: {generationId: id}});
    need(bound.matchedCount === 1, 'O relatório já está vinculado a outra geração.', 409, conflict);
    if (company[slot] !== importId) {
      const updated = await (await generations()).updateOne(scope({_id: id, leaseOwner: owner, leaseUntil: {$gt: new Date()}, 'companies.clientId': clientId}),
        {$set: {[`companies.$.${slot}`]: importId, requiredReports: REPORT_TYPES.filter(report => report === type || generation.requiredReports.includes(report)),
          updatedAt: new Date()}, $addToSet: {[`companies.$.${historySlot}`]: importId}});
      need(updated.matchedCount === 1, 'Geração ocupada. Repita o envio para recuperar o vínculo.', 409, 'GENERATION_BUSY');
      await audit(actor._id, `generation.${type === 'PURCHASES' ? 'purchase' : 'sales'}.attach`, id);
    }
    return {generation: await getGeneration(id), job: {...job, generationId: id}};
  });
}
