import { createLookup, uploadLookup, finalizeLookup, processLookup, cancelLookup } from './lookup-jobs.ts';
import { PURCHASE_MODE } from './purchase-domain.ts';
import { purchaseJob, purchaseSummary, purchaseHistory, purchaseRows, purchaseExport } from './purchase-store.ts';
import { need, integer } from './security.ts';
import { rateLimit, workspace } from './store.ts';
import type { LookupActor } from './lookup-db.ts';

export async function routePurchases(actor: LookupActor, method: string, url: URL, input: any) {
  need(!url.pathname.startsWith('/api/v4/sales') && (!input.type || input.type === 'PURCHASES'), 'O relatório de vendas ainda está indisponível.', 409, 'SALES_UNAVAILABLE');
  const path = url.pathname.replace('/api/v4/purchases', ''), page = integer(url.searchParams.get('page') || 1, 1, 100000);
  if (!path && method === 'POST') return createLookup(actor, input, PURCHASE_MODE);
  if (!path && method === 'GET') return purchaseHistory(url.searchParams.get('clientId') || '', page);
  const match = path.match(/^\/([a-f0-9-]{36})(?:\/(rows|finalize|process|cancel|summary|results|lines|csv))?$/);
  if (match) {
    const id = match[1], action = match[2];
    await purchaseJob(id);
    if (method === 'POST') {
      if (action === 'rows') return uploadLookup(actor, id, input);
      if (action === 'finalize') return finalizeLookup(actor, id);
      if (action === 'process') return processLookup(actor, id);
      if (action === 'cancel') return cancelLookup(actor, id);
      if (action === 'csv') {
        await rateLimit(`purchase-export:${workspace()}:${actor._id}`, 15, 1);
        return purchaseExport(id, typeof input.status === 'string' ? input.status : 'ALL', integer(input.part ?? 1, 1, 100000));
      }
    }
    if (method === 'GET') {
      if (!action) return purchaseJob(id);
      await rateLimit(`purchase-read:${workspace()}:${actor._id}`, 120, 1);
      const status = url.searchParams.get('status') || 'ALL';
      if (action === 'summary') return purchaseSummary(id);
      if (action === 'results') return purchaseRows(id, status, page);
      if (action === 'lines') return purchaseRows(id, status, page, true);
    }
  }
  need(false, 'Rota de compras não encontrada.', 404, 'NOT_FOUND');
}
