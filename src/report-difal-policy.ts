import {collection, scope} from './store.ts';
import type {Doc} from './store.ts';
import {AppError, need} from './security.ts';
import {assertGenerationNotDeleted} from './generation-deletion.ts';
import {parseDifalPolicy} from '../public/simulator-engine.js';
import type {DifalPolicy} from '../public/simulator-engine.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const slots = {PURCHASES_V1:'purchaseJobIds', SALES_V1:'salesJobIds'} as const;
function checkedPolicy(value: unknown): DifalPolicy {
  try { return parseDifalPolicy(value); }
  catch { throw new AppError(409, 'GENERATION_INCONSISTENT', 'Opções de DIFAL do relatório inconsistentes.'); }
}

/** Resolve only trusted, scoped ownership. The source estimate itself is immutable. */
export async function reportDifalPolicy(job: Doc): Promise<DifalPolicy | undefined> {
  return resolvePolicy(job, new Set());
}

async function resolvePolicy(job: Doc, visited: Set<string>): Promise<DifalPolicy | undefined> {
  need(job.workspaceId === scope().workspaceId && typeof job._id === 'string' && !visited.has(job._id) && visited.size < 32,
    'Linhagem das opções de DIFAL inconsistente.', 409, 'GENERATION_INCONSISTENT');
  visited.add(job._id);
  if (!Object.hasOwn(job, 'generationId')) {
    if (!Object.hasOwn(job, 'repeatedFrom')) {
      need(!Object.hasOwn(job, 'difalPolicy') && !Object.hasOwn(job, 'difalPolicyOrigin'),
        'Origem das opções de DIFAL inconsistente.', 409, 'GENERATION_INCONSISTENT');
      return undefined;
    }
    need(typeof job.repeatedFrom === 'string' && UUID.test(job.repeatedFrom) && Object.hasOwn(slots, job.mode),
      'Origem das opções de DIFAL inconsistente.', 409, 'GENERATION_INCONSISTENT');
    if (Object.hasOwn(job, 'difalPolicy')) {
      need(job.difalPolicyOrigin === 'RECHECK_SOURCE', 'Origem das opções de DIFAL inconsistente.', 409, 'GENERATION_INCONSISTENT');
      return checkedPolicy(job.difalPolicy);
    }
    need(!Object.hasOwn(job, 'difalPolicyOrigin'), 'Origem das opções de DIFAL inconsistente.', 409, 'GENERATION_INCONSISTENT');
    // Older rechecks did not capture the choice. Resolve their intact lineage
    // without modifying the job, its lines, or any prior report snapshot.
    const original = await (await collection('lookupJobs')).findOne(scope({_id:job.repeatedFrom}));
    if (!original) return undefined;
    need(original.clientId === job.clientId && original.mode === job.mode,
      'A origem da reconsulta está indisponível ou pertence a outro relatório.', 409, 'GENERATION_INCONSISTENT');
    return resolvePolicy(original, visited);
  }
  need(typeof job.generationId === 'string' && UUID.test(job.generationId) && Object.hasOwn(slots, job.mode),
    'Vínculo do relatório com a geração inconsistente.', 409, 'GENERATION_INCONSISTENT');
  await assertGenerationNotDeleted(job.generationId);
  const generation = await (await collection('generations')).findOne(scope({_id:job.generationId}));
  need(generation && !generation.deletionStartedAt && Array.isArray(generation.companies),
    'A geração deste relatório está indisponível.', 409, 'GENERATION_INCONSISTENT');
  const companies = generation.companies.filter((company: any) => company?.clientId === job.clientId);
  const historySlot = slots[job.mode as keyof typeof slots];
  const owners = generation.companies.flatMap((company: any) => Object.values(slots).flatMap(slot =>
    Array.isArray(company?.[slot]) ? company[slot].filter((id: unknown) => id === job._id).map(() => ({company, slot})) : []));
  need(companies.length === 1 && owners.length === 1 && owners[0].company === companies[0] && owners[0].slot === historySlot,
    'O relatório não pertence ao histórico desta empresa e geração.', 409, 'GENERATION_INCONSISTENT');
  const company = companies[0];
  return Object.hasOwn(company, 'difalPolicy') ? checkedPolicy(company.difalPolicy) : undefined;
}
