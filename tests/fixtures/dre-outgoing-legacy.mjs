import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

// Synthetic complete snapshot captured from commit 1a9edf8, model 1.17.0,
// before outgoing DIFAL was disabled. Keep every captured cell and memory item;
// historical tests must not recreate an old positive tax with the current engine.
const captured=JSON.parse(gunzipSync(readFileSync(new URL('./dre-outgoing-legacy.json.gz',import.meta.url))).toString('utf8'));
const withoutOutgoing=JSON.parse(gunzipSync(readFileSync(new URL('./dre-without-outgoing-legacy.json.gz',import.meta.url))).toString('utf8'));
/** Original 1.17 annual calculation with no imported DIFAL field or invented zero row. */
export function legacyWithoutOutgoingDreFixture(){return structuredClone(withoutOutgoing);}
export function legacyOutgoingDreFixture({simulationId=captured._id,clientId=captured.clientId,generationId=captured.generationId}={}){
  const snapshot=structuredClone(captured);
  snapshot._id=simulationId;snapshot.clientId=clientId;snapshot.generationId=generationId;
  snapshot.source.clientId=clientId;snapshot.source.generationId=generationId;
  return snapshot;
}
