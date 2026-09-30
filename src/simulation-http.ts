import { createSimulation, getSimulation, simulationHistory } from './simulation-history.ts';
import { need, integer } from './security.ts';
import { rateLimit, workspace } from './store.ts';
import type { LookupActor } from './lookup-db.ts';

export async function routeSimulations(actor: LookupActor, method: string, url: URL, input: unknown) {
  const path = url.pathname.replace('/api/v4/simulations', '');
  if (method === 'GET') await rateLimit(`simulation-read:${workspace()}:${actor._id}`, 120, 1);
  if (!path && method === 'GET') return simulationHistory(integer(url.searchParams.get('page') || 1, 1, 100000), {
    clientId: url.searchParams.get('clientId') || undefined,
    search: url.searchParams.get('search') || undefined,
    year: url.searchParams.get('year') || undefined
  });
  if (!path && method === 'POST') return createSimulation(actor, input);
  const match = path.match(/^\/([a-f0-9-]{36})$/);
  if (match && method === 'GET') return getSimulation(match[1]);
  need(false, 'Rota de simulação não encontrada.', 404, 'NOT_FOUND');
}
