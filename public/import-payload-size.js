const encoder = new TextEncoder();

/** Match the server's per-row JSON byte count without serializing the whole file. */
export function estimatePayloadBytes(rows) {
  if (!Array.isArray(rows)) throw new TypeError('As linhas do arquivo devem formar uma lista.');
  let bytes = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Cada linha do arquivo deve ser um objeto.');
    const serialized = JSON.stringify(row);
    if (typeof serialized !== 'string' || !serialized.startsWith('{')) throw new TypeError('A linha do arquivo não pode ser serializada como objeto.');
    bytes += encoder.encode(serialized).byteLength + 1;
    if (!Number.isSafeInteger(bytes)) throw new RangeError('O arquivo excede o tamanho permitido para medição.');
  }
  return bytes;
}
