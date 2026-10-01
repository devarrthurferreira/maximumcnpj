import {test, expect} from '@playwright/test';
const id = '11111111-1111-4111-8111-111111111111';
const fixture = '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/lookup-progress.css"></head><body><main id="content"><section><h1>Consulta sintética</h1></section></main><script type="module" src="/lookup-progress.js"></script></body></html>';
test('Acompanhamento distingue pendências, não optantes e Simples sem aguardar todo o lote', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/lookup-fixture', route => route.fulfill({contentType: 'text/html', body: fixture}));
  await page.route('**/api/v4/lookups/*/progress?*', route => {
    const filter = new URL(route.request().url()).searchParams.get('status');
    const items = [{cnpj: '00000000000191', submittedName: '<b>Texto externo</b>', state: 'DONE', status: 'OPTANTE', attempts: 1}, {cnpj: '11222333000181', submittedName: 'Pendente', state: 'PENDING', attempts: 0}];
    return route.fulfill({json: {job: {_id: id, status: 'PROCESSING'}, partial: true, canRecheck: true, metrics: {total: 2, completed: 1, optants: 1, nonOptants: 0, unconfirmed: 0, pending: 1, retrying: 0}, items: filter === 'PENDING' ? items.slice(1) : items, total: filter === 'PENDING' ? 1 : 2, page: 1, pageSize: 25}});
  });
  await page.goto('/lookup-fixture#job/' + id);
  const panel = page.locator('#lookup-live'); await expect(panel).toBeVisible();
  await expect(panel.getByText('Simples — confirmado', {exact: true})).toBeVisible();
  await expect(panel.getByText('Aguardando consulta', {exact: true})).toBeVisible();
  await expect(panel.getByText('<b>Texto externo</b>', {exact: true})).toBeVisible();
  await expect(panel.locator('tbody b')).toHaveCount(0);
  await expect(panel.locator('[data-recheck]')).toBeHidden();
  await panel.locator('[data-filter]').selectOption('PENDING');
  await expect(panel.locator('tbody tr')).toHaveCount(1); await expect(panel.locator('tbody')).toContainText('Pendente');
  await page.setViewportSize({width: 390, height: 844}); await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.screenshot({path: 'test-results/lookup-progress-mobile.png', fullPage: true});
  expect(errors).toEqual([]);
});
