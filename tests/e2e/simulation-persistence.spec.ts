import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// This flow uses the running application and disposable MongoDB throughout.
// CPF-only reports finish locally, without mocking an API or consulting a provider.
async function post(request: APIRequestContext, baseURL: string, path: string, data: unknown) {
  const response = await request.post(path, { data, headers: { Origin: new URL(baseURL).origin } });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}

async function get(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}

async function signIn(request: APIRequestContext, baseURL: string) {
  expect(process.env.ADMIN_EMAIL, 'Run with the disposable MongoDB/seed environment').toBeTruthy();
  expect(process.env.ADMIN_PASSWORD, 'Run with the disposable MongoDB/seed environment').toBeTruthy();
  await post(request, baseURL, '/api/auth/login', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const session = await get(request, '/api/auth/session');
  expect(session.user.role).toBe('admin');
  expect(session.user.mustChangePassword).toBe(false);
}

async function generate(page: Page) {
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/v4/simulations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Gerar simulação', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  const snapshot = await response.json();
  await expect(page.locator('#simulation-save-status')).toContainText('Simulação salva');
  await expect(page.locator('#saved-simulation-link')).toHaveAttribute('href', `/simulator.html?simulation=${snapshot._id}`);
  await expect(page.locator('.sim-regime')).toHaveCount(4);
  return snapshot;
}

test('Real saved simulation survives a fresh login and a new version preserves every original detail', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const origin = baseURL!;
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await signIn(page.request, origin);

  const code = String(Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16));
  const companyName = `Empresa sintética persistência ${code}`;
  const catalog = await post(page.request, origin, '/api/v4/clients/import', {
    rows: [{ code, name: companyName }],
  });
  expect(catalog.success).toBe(1);
  const clientId = catalog.items[0].id;
  const generationId = randomUUID();
  await post(page.request, origin, '/api/v4/generations', {
    generationId, clientIds: [clientId], requiredReports: ['PURCHASES', 'SALES'],
  });

  const jobIds: Record<string, string> = {};
  for (const [kind, totalCents] of [['purchases', 450_000], ['sales', 1_200_000]] as const) {
    const attached = await post(page.request, origin, `/api/v4/generations/${generationId}/${kind}`, {
      clientId, importId: randomUUID(), fileName: `${code}-${kind}.csv`, expectedRows: 1,
    });
    jobIds[kind] = attached.job._id;
    await post(page.request, origin, `/api/v4/${kind}/${attached.job._id}/rows`, {
      offset: 0,
      rows: [{
        document: '12345678900', name: 'Pessoa sintética', serviceDate: '2026-08-15', quantity: '1',
        grossCents: totalCents + 2_000, discountCents: 2_500, accessoryCents: 999,
        freightCents: 800, abatementCents: 300, totalCents,
      }],
    });
    const completed = await post(page.request, origin, `/api/v4/${kind}/${attached.job._id}/finalize`, {});
    expect(completed.status).toBe('COMPLETED');
    expect(completed.summary.unique).toBe(0);
  }

  await page.goto(`/simulator.html?generation=${generationId}&client=${clientId}`);
  await expect(page.locator('#salesCpfCents')).toHaveValue('12000.00');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('4500.00');
  await expect(page.locator('#period-months')).toBeDisabled();
  await expect(page.locator('#period-months')).toHaveValue('1');
  await expect(page.locator('#period-confirm')).toBeChecked();
  await expect(page.locator('#salesRevenue')).toHaveValue('12000.00');
  await expect(page.locator('#purchasesNonOptantCents')).toHaveValue('4500.00');
  await page.locator('#rbt12').fill('150000');
  const manual = { serviceRevenue: 1250.50, salaries: 900, benefits: 150, adminExpenses: 99.95, rent: 800, cardExpenses: 60 };
  for (const [id, value] of Object.entries(manual)) await page.locator(`#${id}`).fill(String(value));
  await page.locator('#simulation-year').selectOption('2028');
  await page.locator('#sales-annex').selectOption('2');
  await page.locator('#service-annex').selectOption('5');

  const first = await generate(page);
  expect(first).toMatchObject({
    generationId, clientId, company: { code, name: companyName },
    reportMonths: 1, periodBasis: 'COLUMN_H', periodConfirmed: true, monthlyGroupsUnit: 'BRL', parentSimulationId: null,
    monthlyGroups: { salesOptantCents: 0, salesNonOptantCents: 0, salesCpfCents: 12000, purchasesOptantCents: 0, purchasesNonOptantCents: 4500 },
    draft: { year: 2028, salesAnnex: 2, serviceAnnex: 5, rbt12: 150000, values: { ...manual, salesRevenue: 12000, simplePurchases: 0, regularPurchases: 4500 } },
    source: { purchases: { jobId: jobIds.purchases, totalCents: 450_000 }, sales: { jobId: jobIds.sales, totalCents: 1_200_000 } },
    result: { annualRevenue: 159_006 },
  });
  expect(first.result.regimes).toHaveLength(4);
  expect(first.result.memory.length).toBeGreaterThan(0);
  expect(first.createdAt).toBeTruthy();
  expect(first.createdBy.id).toBeTruthy();
  expect(first.modelVersion).toBe(first.result.version);
  const original = await get(page.request, `/api/v4/simulations/${first._id}`);
  expect(original).toEqual(first);
  // Compare cells consistently: innerText adds table separators and CSS uppercase,
  // while Playwright's default toHaveText reads the underlying textContent.
  const originalDre = await page.locator('.sim-dre tbody tr > *').allTextContents();
  // One detected month: (R$ 12,000 in sales + R$ 1,250.50 in monthly services) x 12.
  await expect(page.locator('.sim-dre tr').filter({hasText: 'Receita bruta total'}).locator('td')).toHaveText([
    'R$ 159.006,00', 'R$ 159.006,00', 'R$ 159.006,00', 'R$ 159.006,00',
  ]);

  // A new context has no cookies or sessionStorage from the original tab.
  // Reopening through history must therefore fetch the immutable server snapshot.
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    await signIn(fresh.request, origin);
    const reopened = await fresh.newPage();
    reopened.on('pageerror', error => browserErrors.push(error.message));
    await reopened.goto('/simulations.html');
    await reopened.locator('#simulation-search').fill(code);
    await reopened.locator('#history-filters').getByRole('button', { name: 'Buscar', exact: true }).click();
    const permalink = `/simulator.html?simulation=${first._id}`;
    const historyLink = reopened.locator(`a[href="${permalink}"]`).first();
    await expect(historyLink).toBeVisible();
    await historyLink.click();
    await expect(reopened).toHaveURL(new RegExp(`simulation=${first._id}$`));
    await expect(reopened.locator('#simulation-snapshot')).toBeVisible();
    await expect(reopened.locator('#simulator-form')).toHaveCount(0);
    await expect(reopened.locator('#simulation-snapshot .sim-detail-grid strong')).toHaveText([
      'R$ 150.000,00', 'R$ 1.250,50', 'R$ 12.000,00', 'R$ 0,00', 'R$ 0,00', 'R$ 12.000,00', 'R$ 0,00',
      'R$ 4.500,00', 'R$ 900,00', 'R$ 150,00', 'R$ 99,95', 'R$ 800,00', 'R$ 60,00',
    ]);
    await expect(reopened.locator('.sim-snapshot-meta')).toContainText('2028 · Vendas: Anexo II');
    await expect(reopened.locator('.sim-snapshot-meta')).toContainText('Serviços: Anexo V');
    await expect(reopened.locator('.sim-dre tbody tr > *')).toHaveText(originalDre);
    expect(await get(fresh.request, `/api/v4/simulations/${first._id}`)).toEqual(original);

    await reopened.locator('#create-version').click();
    await expect(reopened.locator('#simulator-form')).toBeVisible();
    await expect(reopened.locator('#period-months')).toHaveValue('1');
    await expect(reopened.locator('#period-months')).toBeDisabled();
    await expect(reopened.locator('#serviceRevenue')).toHaveValue('1250.50');
    await expect(reopened.locator('#purchasesNonOptantCents')).toHaveValue('4500.00');
    await expect(reopened.locator('#sales-annex')).toHaveValue('2');
    await expect(reopened.locator('#service-annex')).toHaveValue('5');
    await expect(reopened.locator('#simulation-year')).toHaveValue('2028');
    await expect(reopened.locator('#period-confirm')).toBeChecked();
    await expect(reopened.locator('#period-confirm')).toBeDisabled();
    await expect(reopened.locator('#rbt12')).toHaveValue('150000.00');
    await reopened.locator('#serviceRevenue').fill('1750.50');
    const second = await generate(reopened);
    expect(second._id).not.toBe(first._id);
    expect(second.parentSimulationId).toBe(first._id);
    expect(second.draft.values.serviceRevenue).toBe(1750.50);
    expect(second.result.annualRevenue).toBe(165_006);
    expect(second.source).toEqual(first.source);
    expect(second.result.regimes).not.toEqual(first.result.regimes);
    expect(await get(fresh.request, `/api/v4/simulations/${first._id}`)).toEqual(original);
    const history = await get(fresh.request, `/api/v4/simulations?clientId=${clientId}`);
    expect(history.total).toBe(2);
    expect(history.items.map((item: { _id: string }) => item._id).sort()).toEqual([first._id, second._id].sort());

    await reopened.goto(permalink);
    await expect(reopened.locator('#simulation-snapshot')).toBeVisible();
    await expect(reopened.locator('.sim-dre tbody tr > *')).toHaveText(originalDre);
    expect(browserErrors).toEqual([]);
  } finally {
    await fresh.close();
  }
});
