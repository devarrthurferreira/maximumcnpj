import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { MAX_SIMPLES_PDF_BYTES, signedUrl } from '../src/blob-documents.ts';

test('Blob SDK signs private reads and constrained control-plane uploads, including OCR retries', async () => {
  const dispatcher = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect();
  const envNames = ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'VERCEL_OIDC_TOKEN', 'VERCEL_BLOB_API_URL', 'NEXT_PUBLIC_VERCEL_BLOB_API_URL'];
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const issued: any[] = [];
  try {
    for (const name of envNames) delete process.env[name];
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_synthetic';
    setGlobalDispatcher(mock);
    mock.get('https://vercel.com').intercept({ method: 'POST', path: '/api/blob/signed-token' }).reply(200, options => {
      const payload = JSON.parse(String(options.body));
      issued.push(payload);
      return { delegationToken: Buffer.from(JSON.stringify({ ...payload, storeId: 'store_teststore' })).toString('base64url') + '.synthetic',
        clientSigningToken: 'synthetic-signing-key', validUntil: payload.validUntil };
    }).times(3);
    const path = 'simples/test/company/document/original.pdf';
    const read = new URL(await signedUrl(path, 'get'));
    assert.equal(read.origin, 'https://teststore.private.blob.vercel-storage.com');
    assert.equal(read.pathname, '/' + path);
    assert.equal(read.searchParams.get('cache'), '0');
    for (const [target, overwrite] of [[path, false], [path.replace('original', 'pesquisavel'), true]] as const) {
      const upload = new URL(await signedUrl(target, 'put', overwrite));
      assert.equal(upload.origin, 'https://vercel.com');
      assert.equal(upload.pathname, '/api/blob/');
      assert.equal(upload.searchParams.get('pathname'), target);
      assert.equal(upload.searchParams.get('vercel-blob-allow-overwrite'), String(overwrite));
      assert.equal(upload.searchParams.get('vercel-blob-add-random-suffix'), 'false');
      assert.equal(upload.searchParams.get('vercel-blob-maximum-size-in-bytes'), String(MAX_SIMPLES_PDF_BYTES));
      assert.equal(upload.searchParams.get('vercel-blob-allowed-content-types'), 'application/pdf');
      assert.ok(upload.searchParams.get('vercel-blob-signature'));
      assert.ok(upload.searchParams.get('vercel-blob-delegation'));
      assert.ok(!upload.href.includes(process.env.BLOB_READ_WRITE_TOKEN));
    }
    assert.deepEqual(issued.map(value => value.operations), [['get'], ['put'], ['put']]);
    assert.ok(issued.every(value => value.pathname !== '*'));
    assert.ok(issued.slice(1).every(value => value.maximumSizeInBytes === MAX_SIMPLES_PDF_BYTES && value.allowedContentTypes[0] === 'application/pdf'));
    mock.assertNoPendingInterceptors();
  } finally {
    setGlobalDispatcher(dispatcher);
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await mock.close();
  }
});

test('Static and Node CSP allow the actual signed upload endpoint with a path restriction', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const policy = config.headers.find((entry: any) => entry.source === '/(.*)').headers.find((entry: any) => entry.key === 'Content-Security-Policy').value;
  const connect = policy.split(';').find((entry: string) => entry.trim().startsWith('connect-src')).trim().split(/\s+/);
  assert.ok(connect.includes('https://vercel.com/api/blob/'));
  assert.ok(!connect.includes('https:') && !connect.includes('*') && !connect.includes('https://vercel.com'));
  assert.ok(readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8').includes(policy));
});
