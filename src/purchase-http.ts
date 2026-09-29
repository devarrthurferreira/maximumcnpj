import { createLookup, uploadLookup, finalizeLookup, processLookup, cancelLookup } from './lookup-jobs.ts';
import { PURCHASE_MODE, SALES_MODE, financialLabel } from './purchase-domain.ts';
import { purchaseJob, purchaseSummary, purchaseHistory, purchaseRows, purchaseExport } from './purchase-store.ts';
import { need, integer } from './security.ts';
import { rateLimit, workspace } from './store.ts';
import type { LookupActor } from './lookup-db.ts';

/** Purchases and sales share validation, while their routes only accept jobs of the matching mode. */
export async function routePurchases(actor: LookupActor, method: string, url: URL, input: any) {
  const route = url.pathname.match(/^\/api\/v4\/(purchases|sales)(\/.*)?$/);
  need(route, 'Rota financeira não encontrada.', 404, 'NOT_FOUND');
  const sales = route[1] === 'sales', mode = sales ? SALES_MODE : PURCHASE_MODE, type = sales ? 'SALES' : 'PURCHASES';
  need(!input.type || input.type === type, 'Tipo de relatório divergente da rota.', 409, 'REPORT_TYPE');
  const path = route[2] || '', page = integer(url.searchParams.get('page') || 1, 1, 100000);
  if (!path && method === 'POST') return createLookup(actor, input, mode);
  if (!path && method === 'GET') return purchaseHistory(url.searchParams.get('clientId') || '', page, mode);
  const match = path.match(/^\/([a-f0-9-]{36})(?:\/(rows|finalize|process|cancel|summary|results|lines|csv))?$/);
  if (match) {
    const id = match[1], action = match[2];
    await purchaseJob(id, mode);
    if (method === 'POST') {
      if (action === 'rows') return uploadLookup(actor, id, input);
      if (action === 'finalize') return finalizeLookup(actor, id);
      if (action === 'process') return processLookup(actor, id);
      if (action === 'cancel') return cancelLookup(actor, id);
      if (action === 'csv') {
        await rateLimit(`financial-export:${workspace()}:${actor._id}`, 15, 1);
        return purchaseExport(id, typeof input.status === 'string' ? input.status : 'ALL', integer(input.part ?? 1, 1, 100000), mode);
      }
    }
    if (method === 'GET') {
      if (!action) return purchaseJob(id, mode);
      await rateLimit(`financial-read:${workspace()}:${actor._id}`, 120, 1);
      const status = url.searchParams.get('status') || 'ALL';
      if (action === 'summary') return purchaseSummary(id, true, mode);
      if (action === 'results') return purchaseRows(id, status, page, false, mode);
      if (action === 'lines') return purchaseRows(id, status, page, true, mode);
    }
  }
  need(false, `Rota de ${financialLabel(mode)} não encontrada.`, 404, 'NOT_FOUND');
}
