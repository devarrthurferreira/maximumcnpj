import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProvider, flagStatus} from '../src/lookup-domain.ts';
import {lookupCnpj, SourceError, retrySeconds} from '../src/lookup-provider.ts';
import {lookupPolicy, boundedWorkers} from '../src/lookup-policy.ts';
const cnpj = '00000000000191';
const transport = (payload: unknown) => (async () => Response.json(payload)) as typeof fetch;

test('Indicadores explícitos: verdadeiro, falso, ausência e conflito são distintos', () => {
  assert.equal(flagStatus(true), 'OPTANTE'); assert.equal(flagStatus(false), 'NAO_OPTANTE');
  for (const value of [null, undefined, '', 'true', 'false', 'Sim', 'Não', 0, 1, {}, []]) assert.equal(flagStatus(value), 'NAO_CONFIRMADO');
  assert.equal(parseProvider(cnpj, {cnpj, opcao_pelo_simples: false, opcao_pelo_mei: true}).reason, 'CONFLITO_NA_FONTE');
  assert.equal(parseProvider(cnpj, {cnpj, razao_social: 'EMPRESA SIMPLES MEI', porte: 'ME', opcao_pelo_simples: null}).status, 'NAO_CONFIRMADO');
});
test('CNPJ com máscara mantém a identidade completa sem inferir matriz ou filial', async () => {
  const result = await lookupCnpj('00.000.000/0001-91', transport({cnpj: '00.000.000/0001-91', opcao_pelo_simples: true}));
  assert.equal(result.cnpj, cnpj); assert.equal(result.status, 'OPTANTE');
  assert.throws(() => parseProvider(cnpj, {cnpj: 191, opcao_pelo_simples: true}), /SOURCE_IDENTITY/);
  await assert.rejects(lookupCnpj(cnpj, transport({cnpj: '11222333000181', opcao_pelo_simples: true})), (e: any) => e.code === 'IDENTIDADE_DIVERGENTE' && !e.retryable);
});
test('CPF e documentos inválidos nunca disparam consulta externa', async () => {
  let calls = 0; const mock = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  for (const document of ['', '12345678900', '123456789012', '00000000000000', '00000000000192']) await assert.rejects(lookupCnpj(document, mock), (e: any) => e.code === 'CNPJ_INVALIDO');
  assert.equal(calls, 0);
});
test('Consulta nova não reaproveita cache nem conteúdo cadastral desnecessário', async () => {
  let calls = 0;
  const mock = (async (url: any, options: any) => {
    calls++; assert.equal(url, `https://minhareceita.org/${cnpj}`); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    return Response.json({cnpj, opcao_pelo_simples: calls === 1, qsa: [{nome: 'descartar'}], ddd_telefone_1: 'descartar'});
  }) as typeof fetch;
  const first = await lookupCnpj(cnpj, mock), second = await lookupCnpj(cnpj, mock);
  assert.equal(first.status, 'OPTANTE'); assert.equal(second.status, 'NAO_OPTANTE'); assert.equal(calls, 2); assert(!JSON.stringify(first).includes('descartar'));
});
test('429 e 503 preservam Retry-After; HTML e JSON corrompido são falhas, não negativas', async () => {
  for (const status of [429, 503]) await assert.rejects(lookupCnpj(cnpj, (async () => new Response('', {status, headers: {'retry-after': '75'}})) as typeof fetch), (e: any) => e instanceof SourceError && e.retryable && e.retryAfter === 75);
  for (const response of [new Response('<html>Falha</html>', {headers: {'content-type': 'text/html'}}), new Response('{', {headers: {'content-type': 'application/json'}})])
    await assert.rejects(lookupCnpj(cnpj, (async () => response) as typeof fetch), (e: any) => e.code === 'RESPOSTA_INVALIDA' && e.retryable);
  await assert.rejects(lookupCnpj(cnpj, (async () => new Response('', {status: 404})) as typeof fetch), (e: any) => e.code === 'NAO_ENCONTRADO' && !e.retryable);
});
test('Retry-After aceita segundos e data HTTP sem encurtar pausas longas válidas', () => {
  const now = Date.UTC(2026, 9, 1);
  assert.equal(retrySeconds(new Date(now + 75000).toUTCString(), now), 75);
  assert.equal(retrySeconds('1209600'), 1209600); assert.equal(retrySeconds('inválido'), 60); assert.equal(retrySeconds('0'), 1);
});
test('Tamanho da resposta limitado, mesmo quando a fonte envia JSON excessivo', async () => {
  await assert.rejects(lookupCnpj(cnpj, transport({cnpj, opcao_pelo_simples: true, extra: 'x'.repeat(2_000_001)})), (e: any) => e.code === 'RESPOSTA_ACIMA_DO_LIMITE');
});
test('Paralelismo configurável permanece limitado e valores inválidos usam padrão', () => {
  assert.deepEqual(lookupPolicy({}), {concurrency: 3, intervalMs: 500});
  assert.deepEqual(lookupPolicy({LOOKUP_CONCURRENCY: '999', LOOKUP_INTERVAL_MS: '0'}), {concurrency: 4, intervalMs: 300});
  assert.deepEqual(lookupPolicy({LOOKUP_CONCURRENCY: 'NaN', LOOKUP_INTERVAL_MS: ''}), {concurrency: 3, intervalMs: 500});
  assert.deepEqual(lookupPolicy({LOOKUP_CONCURRENCY: '1', LOOKUP_INTERVAL_MS: '3000'}), {concurrency: 1, intervalMs: 3000});
});
test('Falha de um worker só libera o lote depois de drenar os demais', async () => {
  let started = 0, drained = 0;
  await assert.rejects(boundedWorkers(3, async () => {
    const index = started++;
    if (!index) throw new Error('Falha sintética');
    await new Promise(resolve => setTimeout(resolve, 30)); drained++;
  }), /Falha sintética/);
  assert.equal(started, 3); assert.equal(drained, 2);
});
