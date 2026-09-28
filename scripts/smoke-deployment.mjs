// Somente leituras públicas, sem credenciais, login, escrita ou acesso aos dados dos clientes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Uso: npm run smoke -- https://seu-projeto.vercel.app');
  const base = new URL(input);
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)), 'Use HTTPS (ou HTTP local).');
  assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Informe apenas a origem, sem credenciais, caminho ou parâmetros.');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  async function get(path, status, contentType) {
    const response = await fetch(new URL(path, base), { redirect: 'follow', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    assert.equal(response.status, status, `${path}: HTTP ${response.status}, esperado ${status}`);
    assert.ok((response.headers.get('content-type') || '').includes(contentType), `${path}: Content-Type incorreto.`);
    console.log(`OK ${response.status} ${path}`);
    return response;
  }
  const page = await get('/', 200, 'text/html');
  assert.equal(page.headers.get('x-maximum-deployment'), 'static-api-v1', 'O domínio ainda não usa a configuração corrigida.');
  const html = await page.text();
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(html, /Maximum CNPJ/);
  await get('/app.js', 200, 'javascript');
  await get('/domain.js', 200, 'javascript');
  await get('/styles.css', 200, 'text/css');
  await get('/favicon.svg', 200, 'image/svg+xml');
  await get('/favicon.ico', 200, 'image/svg+xml');
  const health = await (await get('/api/health', 200, 'application/json')).json();
  assert.equal(health.ok, true);
  assert.equal(health.version, pkg.version, 'O domínio ainda está em outra versão.');
  const anonymous = await (await get('/api/auth/me', 401, 'application/json')).json();
  assert.equal(anonymous.error, 'UNAUTHORIZED');
  console.log(`Deploy ${pkg.version} respondeu corretamente. MongoDB, login real e importação não foram testados por este comando.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
