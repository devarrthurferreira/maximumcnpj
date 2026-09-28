import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const config = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));

test('Vercel usa Other explicitamente e publica public como arquivos estáticos', () => {
  assert.ok(Object.hasOwn(config, 'framework'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(pkg.engines.node, '>=22.16.0 <23');
  assert.equal(config.builds, undefined, 'Não misturar builders legados com functions.');
});

test('Somente a entrada da API é função; raiz e assets não são reescritos para Node', () => {
  assert.deepEqual(Object.keys(config.functions), ['api/index.ts']);
  assert.deepEqual(config.rewrites, [{ source: '/api/:path*', destination: '/api' }]);
  assert.match(read('api/index.ts'), /from ['"]\.\.\/src\/server\.ts['"]/);
  assert.doesNotMatch(read('api/index.ts'), /public\/|document\.|window\./);
  assert.equal(config.functions['api/index.ts'].memory, undefined, 'Não impor memória incompatível com Fluid Compute.');
});

test('HTML carrega frontend somente no navegador e ícone legado tem destino estático', () => {
  const html = read('public/index.html');
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(html, /href="\/favicon\.svg"/);
  assert.match(read('public/favicon.svg'), /<svg/);
  assert.deepEqual(config.redirects, [{ source: '/favicon.ico', destination: '/favicon.svg', permanent: false }]);
});

test('Os headers protegem o HTML estático; respostas da API não são cacheadas', () => {
  const headers = new Map(config.headers.find(v => v.source === '/(.*)').headers.map(v => [v.key, v.value]));
  assert.equal(headers.get('X-Maximum-Deployment'), 'static-api-v1');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.match(headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  const api = config.headers.find(v => v.source === '/api/:path*');
  assert.ok(api.headers.some(v => v.key === 'Cache-Control' && v.value === 'no-store'));
});

test('A versão e os scripts de diagnóstico acompanham a correção', () => {
  assert.ok(read('src/domain.ts').includes(`VERSION = '${pkg.version}'`));
  assert.equal(pkg.scripts['test:deployment'], 'node --test tests/deployment.test.mjs');
  assert.equal(pkg.scripts.smoke, 'node scripts/smoke-deployment.mjs');
  assert.ok(pkg.scripts.test.includes('tests/deployment.test.mjs'));
  assert.equal(pkg.dependencies['google-auth-library'], undefined);
});
