import type { Db, MongoClient, Document } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { AppError, email, hashPassword, text } from './security.ts';
export type Doc = Document & { _id: string };
let connection: Promise<Db> | undefined;
let client: MongoClient | undefined;
export const workspace = () => process.env.WORKSPACE_ID || 'maximum';
export async function database(): Promise<Db> {
  if (!process.env.MONGODB_URI) throw new AppError(503, 'DATABASE_NOT_CONFIGURED', 'Configure o MongoDB e execute a criação do primeiro administrador.');
  if (!connection) connection = (async () => {
    const { MongoClient: Driver } = await import('mongodb');
    client = new Driver(process.env.MONGODB_URI!, { maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'maximum_cnpj');
    await Promise.all([
      db.collection('users').createIndex({ workspaceId: 1, email: 1 }, { unique: true }),
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('clients').createIndex({ workspaceId: 1, cnpj: 1 }, { unique: true, partialFilterExpression: { cnpj: { $type: 'string' } } }),
      db.collection('batches').createIndex({ workspaceId: 1, clientId: 1, createdAt: -1 }),
      db.collection('rows').createIndex({ workspaceId: 1, batchId: 1, index: 1 }, { unique: true }),
      db.collection('rows').createIndex({ workspaceId: 1, batchId: 1, valid: 1, cnpj: 1 }),
      db.collection('results').createIndex({ workspaceId: 1, batchId: 1, cnpj: 1 }, { unique: true }),
      db.collection('results').createIndex({ workspaceId: 1, cnpj: 1, observedAt: -1 }),
      db.collection('audit').createIndex({ workspaceId: 1, createdAt: -1 })
    ]);
    return db;
  })().catch(async e => { connection = undefined; await client?.close().catch(() => {}); throw e; });
  return connection;
}
export async function collection(name: string) { return (await database()).collection<Doc>(name); }
export function scope(extra: Record<string, unknown> = {}) { return { ...extra, workspaceId: workspace() }; }
export async function audit(actor: string, action: string, target: string) {
  await (await collection('audit')).insertOne({ _id: randomUUID(), ...scope(), actor, action, target, createdAt: new Date() });
}
export async function rateLimit(key: string, max: number, minutes: number) {
  const bucket = Math.floor(Date.now() / (minutes * 60000));
  const record = await (await collection('limits')).findOneAndUpdate({ _id: `${key}:${bucket}` }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * minutes * 60000) } }, { upsert: true, returnDocument: 'after' });
  if (record!.count > max) throw new AppError(429, 'RATE_LIMIT', 'Limite temporário atingido. Tente novamente mais tarde.');
}
export async function seed() {
  const users = await collection('users');
  if (await users.countDocuments(scope())) throw new AppError(409, 'ADMIN_EXISTS', 'Já existem usuários. Nenhuma conta ou senha foi alterada.');
  const user = { _id: randomUUID(), ...scope(), name: text(process.env.ADMIN_NAME || 'Administrador'), email: email(process.env.ADMIN_EMAIL), passwordHash: await hashPassword(process.env.ADMIN_PASSWORD || ''), role: 'admin', active: true, mustChangePassword: false, createdAt: new Date() };
  await users.insertOne(user); return user.email;
}
export async function closeDatabase() { await client?.close(); client = undefined; connection = undefined; }
