import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { get, issueSignedToken, presignUrl } from '@vercel/blob';
import { collection, scope, workspace } from './store.ts';
import { AppError, integer, need, text } from './security.ts';
import type { LookupActor } from './lookup-db.ts';

export const MAX_SIMPLES_PDF_BYTES = 8 * 1024 * 1024;
const SIGNED_URL_MS = 15 * 60 * 1000;

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'maximum';

async function signedUrl(pathname: string, operation: 'get' | 'put', minutes = 15) {
  const validUntil = Date.now() + Math.max(1, Math.min(minutes, 60)) * 60 * 1000;
  try {
    const delegation = await issueSignedToken({
      pathname,
      operations: [operation],
      validUntil,
      ...(operation === 'put' ? { allowedContentTypes: ['application/pdf'], maximumSizeInBytes: MAX_SIMPLES_PDF_BYTES } : {})
    } as any);
    const { presignedUrl } = await presignUrl(delegation, { pathname, operation, validUntil, ...(operation === 'get' ? { useCache: false } : {}) } as any);
    return presignedUrl;
  } catch (error) {
    console.error(JSON.stringify({ code: 'BLOB_SIGN', errorType: (error as any)?.name || 'Error' }));
    throw new AppError(503, 'BLOB_NOT_CONFIGURED',
      'O armazenamento de documentos ainda não está conectado. Conecte um Vercel Blob privado ao projeto e tente novamente.');
  }
}

async function document(id: string) {
  need(/^[a-f0-9-]{36}$/.test(id), 'Documento inválido.', 400, 'DOCUMENT_ID');
  const value = await (await collection('simplesDocuments')).findOne(scope({ _id: id }));
  need(value, 'Documento não encontrado neste ambiente.', 404, 'NOT_FOUND');
  return value;
}

export async function routeSimplesDocuments(actor: LookupActor, method: string, url: URL, input: any) {
  const path = url.pathname.replace('/api/v4/simples-documents', '');
  if (!path && method === 'POST') {
    need(['admin','operator'].includes(actor.role), 'Seu perfil não pode anexar documentos.', 403, 'FORBIDDEN');
    const clientId = text(input.clientId, 80);
    need(/^[a-f0-9-]{36}$/.test(clientId), 'Selecione a empresa.', 400, 'CLIENT');
    const client = await (await collection('clients')).findOne(scope({ _id: clientId, active: true }), { projection: { _id: 1, name: 1, code: 1 } });
    need(client, 'Empresa não encontrada neste ambiente.', 404, 'CLIENT');
    const fileName = text(input.fileName, 200);
    need(/\.pdf$/i.test(fileName), 'Envie o Extrato do Simples em PDF.', 400, 'PDF_FILE');
    const sizeBytes = integer(input.sizeBytes, 1, MAX_SIMPLES_PDF_BYTES);
    const id = randomUUID(), prefix = `simples/${safeSegment(workspace())}/${clientId}/${id}`;
    const originalPath = `${prefix}/original.pdf`, searchablePath = `${prefix}/pesquisavel.pdf`;
    const [originalPutUrl, originalGetUrl, searchablePutUrl] = await Promise.all([
      signedUrl(originalPath, 'put'), signedUrl(originalPath, 'get'), signedUrl(searchablePath, 'put')
    ]);
    await (await collection('simplesDocuments')).insertOne({
      _id: id, ...scope(), clientId, fileName, sizeBytes, originalPath, searchablePath,
      status: 'AWAITING_UPLOAD', attempts: 0, createdAt: new Date(), createdBy: actor._id
    });
    return { documentId: id, status: 'AWAITING_UPLOAD', fileName, sizeBytes, originalPutUrl, originalGetUrl, searchablePutUrl };
  }
  const action = path.match(/^\/([a-f0-9-]{36})\/(process-urls|status)$/);
  if (action) {
    const value = await document(action[1]);
    if (action[2] === 'status' && method === 'GET') {
      return { documentId: value._id, fileName: value.fileName, status: value.status, attempts: value.attempts || 0,
        extractionId: value.extractionId || null, error: value.lastError || null, createdAt: value.createdAt, updatedAt: value.updatedAt || null };
    }
    if (action[2] === 'process-urls' && method === 'POST') {
      need(['admin','operator'].includes(actor.role), 'Seu perfil não pode reprocessar documentos.', 403, 'FORBIDDEN');
      const [originalGetUrl, searchablePutUrl] = await Promise.all([
        signedUrl(value.originalPath, 'get'), signedUrl(value.searchablePath, 'put')
      ]);
      await (await collection('simplesDocuments')).updateOne(scope({ _id: value._id }), {$set: { status: 'STORED', updatedAt: new Date() }});
      return { documentId: value._id, originalGetUrl, searchablePutUrl };
    }
  }
  need(false, 'Rota de documentos não encontrada.', 404, 'NOT_FOUND');
}

export async function serveSimplesDocument(actor: LookupActor, res: ServerResponse, id: string, kind: string) {
  const value = await document(id);
  const pathname = kind === 'original' ? value.originalPath : kind === 'searchable' ? value.searchablePath : '';
  need(pathname, 'Tipo de documento inválido.', 400, 'DOCUMENT_KIND');
  if (kind === 'searchable') need(value.status === 'READY' && value.searchableStored === true,
    'O PDF pesquisável ainda não está disponível.', 409, 'DOCUMENT_PROCESSING');
  try {
    const stored = await get(pathname, { access: 'private', useCache: false } as any);
    need(stored, 'Arquivo não encontrado no Blob.', 404, 'BLOB_NOT_FOUND');
    const stream: any = (stored as any).stream;
    const blob: any = (stored as any).blob || {};
    res.statusCode = 200;
    res.setHeader('Content-Type', blob.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${kind === 'original' ? 'extrato-original.pdf' : 'extrato-pesquisavel.pdf'}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (blob.size) res.setHeader('Content-Length', String(blob.size));
    Readable.fromWeb(stream as any).pipe(res);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'BLOB_UNAVAILABLE', 'Não foi possível abrir o documento armazenado.');
  }
}
