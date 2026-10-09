import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProvider, parseOpenCnpj, flagStatus} from '../src/lookup-domain.ts';
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
  for (const status of [429, 503]) await assert.rejects(lookupCnpj(cnpj, (async () => new Response('', {status, headers: {'retry-after': '75'}})) as typeof fetch), (e: any) => e instanceof SourceError && e.retryable && e.retryAfter === 75 && e.pauseProvider);
  for (const response of [new Response('<html>Falha</html>', {headers: {'content-type': 'text/html'}}), new Response('{', {headers: {'content-type': 'application/json'}})])
    await assert.rejects(lookupCnpj(cnpj, (async () => response) as typeof fetch), (e: any) => e.code === 'RESPOSTA_INVALIDA' && e.retryable && !e.pauseProvider);
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
  assert.deepEqual(lookupPolicy({}), {concurrency: 4, intervalMs: 300});
  assert.deepEqual(lookupPolicy({LOOKUP_CONCURRENCY: '999', LOOKUP_INTERVAL_MS: '0'}), {concurrency: 4, intervalMs: 300});
  assert.deepEqual(lookupPolicy({LOOKUP_CONCURRENCY: 'NaN', LOOKUP_INTERVAL_MS: ''}), {concurrency: 4, intervalMs: 300});
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

// An isolated timeout must retry its document without pausing healthy CNPJs.
test('Falhas pontuais não pausam a fonte; limites e indisponibilidade HTTP preservam a pausa global', async () => {
  await assert.rejects(lookupCnpj(cnpj, (async () => { throw new TypeError('Network timeout'); }) as typeof fetch),
    (error: SourceError) => error.retryable && error.code === 'FONTE_INDISPONIVEL' && !error.pauseProvider);
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(lookupCnpj(cnpj, (async () => new Response('', {status})) as typeof fetch),
      (error: SourceError) => error.retryable && error.pauseProvider && error.retryAfter >= 5);
  }
});

test('Indisponibilidade da principal consulta OpenCNPJ uma vez, preservando fonte e projeção mínima', async () => {
  for (const failure of ['network', '503', 'invalid-json']) {
    const urls: string[] = [];
    const mock = (async (url: any, options: any) => {
      urls.push(String(url)); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      if (urls.length === 1) {
        if (failure === 'network') throw new TypeError('Network timeout');
        if (failure === '503') return new Response('', {status: 503});
        return new Response('{', {headers: {'content-type': 'application/json'}});
      }
      return Response.json({cnpj, razao_social: 'Empresa sintética', opcao_simples: 'S', opcao_mei: 'N',
        data_opcao_simples: '2020-01-01', data_exclusao_simples: '', situacao_cadastral: 'Ativa', QSA: ['descartar']});
    }) as typeof fetch;
    const result = await lookupCnpj(cnpj, mock);
    assert.deepEqual(urls, [`https://minhareceita.org/${cnpj}`, `https://api.opencnpj.org/${cnpj}?datasets=receita`]);
    assert.equal(result.source, 'OpenCNPJ'); assert.equal(result.status, 'OPTANTE'); assert.equal(result.mei, false);
    assert.equal(result.optionDate, '2020-01-01'); assert.equal(result.exclusionDate, null);
    assert.equal(result.registryStatus, 'Ativa'); assert(!JSON.stringify(result).includes('descartar'));
  }
});

test('OpenCNPJ exige S/N explícitos, identidade completa e não transforma ausência em negativa', () => {
  assert.equal(parseOpenCnpj(cnpj, {cnpj, opcao_simples: 'N', opcao_mei: 'N'}).status, 'NAO_OPTANTE');
  assert.equal(parseOpenCnpj(cnpj, {cnpj, opcao_simples: 'N', opcao_mei: 'S'}).reason, 'CONFLITO_NA_FONTE');
  for (const value of ['', null, undefined, false, true, 0, 1, 'false', 'Sim', 'Não', 's', 'n']) {
    const result = parseOpenCnpj(cnpj, {cnpj, opcao_simples: value, opcao_mei: value});
    assert.equal(result.status, 'NAO_CONFIRMADO'); assert.equal(result.reason, 'INDICADOR_AUSENTE'); assert.equal(result.mei, null);
  }
  for (const payload of [null, [], {cnpj: 191}, {cnpj: '11222333000181'}]) assert.throws(() => parseOpenCnpj(cnpj, payload), /SOURCE_IDENTITY/);
});

test('Nenhuma fonte adicional contorna limites, Retry-After, autenticação ou identidade divergente', async () => {
  for (const response of [
    () => new Response('', {status: 429, headers: {'retry-after': '75'}}),
    () => new Response('', {status: 503, headers: {'retry-after': '90'}}),
    () => new Response('', {status: 401}), () => new Response('', {status: 403}), () => new Response('', {status: 404}),
    () => Response.json({cnpj: '11222333000181', opcao_pelo_simples: true})
  ]) {
    let calls = 0;
    await assert.rejects(lookupCnpj(cnpj, (async () => { calls++; return response(); }) as typeof fetch),
      (error: SourceError) => error instanceof SourceError && error.source === 'Minha Receita');
    assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await lookupCnpj(cnpj, (async () => { calls++; return Response.json({cnpj, opcao_pelo_simples: null}); }) as typeof fetch);
  assert.equal(result.status, 'NAO_CONFIRMADO'); assert.equal(result.source, 'Minha Receita'); assert.equal(calls, 1);
});

test('Duas fontes com falha preservam causa, origem e maior pausa, sem inventar resultado fiscal', async () => {
  for (const [status, code, seconds] of [[503, 'FONTE_INDISPONIVEL', 5], [429, 'LIMITE_DA_FONTE', 120]] as const) {
    let calls = 0;
    await assert.rejects(lookupCnpj(cnpj, (async () => {
      calls++;
      return calls === 1 ? new Response('', {status: 503}) : new Response('', {status, headers: status === 429 ? {'retry-after': String(seconds)} : {}});
    }) as typeof fetch), (error: SourceError) => error.code === code && error.source === 'Minha Receita / OpenCNPJ'
      && error.retryable && error.pauseProvider && error.retryAfter === seconds);
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(lookupCnpj(cnpj, (async () => ++calls === 1 ? new Response('', {status: 503})
    : Response.json({cnpj: '11222333000181', opcao_simples: 'S'})) as typeof fetch),
  (error: SourceError) => error.code === 'IDENTIDADE_DIVERGENTE' && !error.retryable && error.source === 'Minha Receita / OpenCNPJ');
  assert.equal(calls, 2);
});

test('Consulta de contingência também informa indicador ausente sem reusar a falha como negativa', async () => {
  let calls = 0;
  const result = await lookupCnpj(cnpj, (async () => ++calls === 1 ? new Response('', {status: 503})
    : Response.json({cnpj, opcao_simples: '', opcao_mei: ''})) as typeof fetch);
  assert.equal(calls, 2); assert.equal(result.source, 'OpenCNPJ'); assert.equal(result.status, 'NAO_CONFIRMADO');
  assert.equal(result.reason, 'INDICADOR_AUSENTE');
});

test('Fonte alternativa recebe somente o orçamento restante e não inicia após o prazo total', async (context) => {
  let now = 100_000;
  context.mock.method(Date, 'now', () => now);
  const timeout = AbortSignal.timeout, budgets: number[] = [];
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { budgets.push(milliseconds); return timeout(milliseconds); });
  let calls = 0;
  const result = await lookupCnpj(cnpj, (async () => {
    if (++calls === 1) { now += 9_000; return new Response('', {status: 503}); }
    return Response.json({cnpj, opcao_simples: 'S'});
  }) as typeof fetch);
  assert.equal(result.status, 'OPTANTE'); assert.deepEqual(budgets, [6_000, 3_000]);
  calls = 0; budgets.length = 0;
  await assert.rejects(lookupCnpj(cnpj, (async () => { calls++; now += 12_000; return new Response('', {status: 503}); }) as typeof fetch),
    (error: SourceError) => error.code === 'FONTE_INDISPONIVEL' && error.source === 'Minha Receita');
  assert.equal(calls, 1); assert.deepEqual(budgets, [6_000]);
});
