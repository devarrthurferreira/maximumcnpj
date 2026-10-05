import { collection, scope, workspace } from './store.ts';
import { digest, need } from './security.ts';

const receiptId = (kind: 'generation' | 'lookup', id: string) =>
  kind + '-delete:' + digest(JSON.stringify([workspace(), id]));

export async function generationDeletion(id: string) {
  return (await collection('audit')).findOne(scope({_id: receiptId('generation', id), action: 'generation.delete', target: id}));
}

export async function assertGenerationNotDeleted(id: string) {
  need(!await generationDeletion(id), 'Esta geração foi excluída. Inicie uma nova geração para importar outros relatórios.',
    409, 'GENERATION_DELETED');
}

export async function lookupDeleted(id: string) {
  return !!await (await collection('audit')).findOne(scope({_id: receiptId('lookup', id), action: 'lookup.delete', target: id}), {projection: {_id: 1}});
}

export async function assertLookupNotDeleted(id: string) {
  need(!await lookupDeleted(id), 'Este relatório foi excluído. Inicie uma nova importação.',
    409, 'LOOKUP_DELETED');
}

/** Only identifiers, the original actor and timestamp survive deletion. */
export async function reserveGenerationDeletion(id: string, jobIds: string[], actor: string) {
  const events = await collection('audit');
  await events.updateOne(scope({_id: receiptId('generation', id)}), {$setOnInsert: {
    ...scope(), actor, action: 'generation.delete', target: id, jobIds, createdAt: new Date()
  }}, {upsert: true});
  const receipt = (await generationDeletion(id))!;
  await reserveDeletedLookups(receipt.target, receipt.jobIds, receipt.actor, receipt.createdAt);
  return receipt;
}

/** Replaying the same receipt repairs an interrupted per-job reservation. */
export async function reserveDeletedLookups(generationId: string, jobIds: string[], actor: string, createdAt: Date) {
  if (!jobIds.length) return;
  await (await collection('audit')).bulkWrite(jobIds.map(id => ({updateOne: {
    filter: scope({_id: receiptId('lookup', id)}),
    update: {$setOnInsert: {...scope(), actor, action: 'lookup.delete', target: id, generationId, createdAt}},
    upsert: true
  }})), {ordered: false});
}
