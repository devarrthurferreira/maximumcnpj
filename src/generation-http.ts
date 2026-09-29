import { createGeneration, generationHistory, getGeneration, attachGenerationPurchase } from './generation-store.ts';
import { need, integer } from './security.ts';
import { rateLimit, workspace } from './store.ts';
import type { LookupActor } from './lookup-db.ts';

export async function routeGenerations(actor: LookupActor, method: string, url: URL, input: any) {
  const path = url.pathname.replace('/api/v4/generations', '');
  need(!path.endsWith('/sales') && (!input.type || input.type === 'PURCHASES'), 'O relatório de vendas ainda está indisponível.', 409, 'SALES_UNAVAILABLE');
  if (method === 'GET') await rateLimit(`generation-read:${workspace()}:${actor._id}`, 120, 1);
  if (!path && method === 'GET') return generationHistory(integer(url.searchParams.get('page') || 1, 1, 100000));
  if (!path && method === 'POST') return createGeneration(actor, input);
  const match = path.match(/^\/([a-f0-9-]{36})(?:\/(purchases))?$/);
  if (match) {
    if (!match[2] && method === 'GET') return getGeneration(match[1]);
    if (match[2] === 'purchases' && method === 'POST') return attachGenerationPurchase(actor, match[1], input);
  }
  need(false, 'Rota de geração não encontrada.', 404, 'NOT_FOUND');
}
