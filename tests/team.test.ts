import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAXIMUM_ADMIN, MAXIMUM_TEAM, matchesMaximumInitialCredential, maximumProvisioningConfig, provisionMaximumTeam } from '../src/team.ts';
import { AppError, hashInitialTeamPassword, hashPassword, verifyPassword } from '../src/security.ts';

test('Equipe Maximum contém exatamente os dezoito endereços autorizados e seus nomes', () => {
  assert.equal(MAXIMUM_TEAM.length, 18);
  assert.deepEqual(MAXIMUM_TEAM.map(member => member.email).sort(), Array.from({ length: 18 }, (_, i) => `tributario${i + 1}@maximumcontabil.com.br`).sort());
  assert.equal(MAXIMUM_TEAM.find(member => member.email === 'tributario18@maximumcontabil.com.br')?.name, 'Ana Carolina Lage');
  assert.equal(MAXIMUM_TEAM.find(member => member.email === 'tributario2@maximumcontabil.com.br')?.name, 'Ana Caroline');
  assert.equal(MAXIMUM_ADMIN.email, 'programacao@maximumcontabil.com.br');
  assert.ok(Object.isFrozen(MAXIMUM_TEAM));
  assert.ok(MAXIMUM_TEAM.every(member => Object.isFrozen(member)));
});

test('Provisionamento só usa variáveis privadas e não reutiliza a senha de outro administrador', () => {
  assert.deepEqual(maximumProvisioningConfig({}), { teamPassword: undefined, adminPassword: undefined });
  assert.equal(maximumProvisioningConfig({ ADMIN_EMAIL: 'other@example.test', ADMIN_PASSWORD: 'Synthetic!10' }).adminPassword, undefined);
  assert.equal(maximumProvisioningConfig({ ADMIN_EMAIL: ' PROGRAMACAO@maximumcontabil.com.br ', ADMIN_PASSWORD: 'Synthetic!10' }).adminPassword, 'Synthetic!10');
  assert.equal(maximumProvisioningConfig({ MAXIMUM_ADMIN_INITIAL_PASSWORD: 'Primary!1234', ADMIN_EMAIL: MAXIMUM_ADMIN.email, ADMIN_PASSWORD: 'Synthetic!10' }).adminPassword, 'Primary!1234');
  const config = { teamPassword: 'Team!123', adminPassword: 'Synthetic!10' };
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_TEAM[0].email, config.teamPassword, config), true);
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_ADMIN.email, config.adminPassword, config), true);
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_ADMIN.email, config.teamPassword, config), false);
  assert.equal(matchesMaximumInitialCredential('tributario19@maximumcontabil.com.br', config.teamPassword, config), false);
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_TEAM[0].email, config.teamPassword.toLowerCase(), config), false);
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_TEAM[0].email, { $ne: '' }, config), false);
  assert.equal(matchesMaximumInitialCredential(MAXIMUM_TEAM[0].email, undefined, config), false);
});

test('Senha temporária aceita oito caracteres, usa sal aleatório e não reduz a política regular', async () => {
  const password = 'Team!123'; // Synthetic fixture only.
  const first = await hashInitialTeamPassword(password), second = await hashInitialTeamPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password + ' ', first), false);
  for (const value of ['', 'x'.repeat(7), 'x'.repeat(129), {}, null]) {
    await assert.rejects(() => hashInitialTeamPassword(value as string), error => error instanceof AppError && error.code === 'PASSWORD_POLICY');
  }
  await assert.rejects(() => hashPassword(password), error => error instanceof AppError && error.code === 'PASSWORD_POLICY');
});

test('Ausência ou erro de configuração é recusado antes de acessar o banco e sem expor segredo', async () => {
  await assert.rejects(() => provisionMaximumTeam({}), error => error instanceof AppError && error.code === 'TEAM_PROVISIONING_CONFIG');
  await assert.rejects(() => provisionMaximumTeam({ teamPassword: 'short' }), error => error instanceof AppError && error.code === 'TEAM_PROVISIONING_CONFIG' && !error.message.includes('short'));
  await assert.rejects(() => provisionMaximumTeam({ teamPassword: 'Team!123', adminPassword: 'short' }), error => error instanceof AppError && error.code === 'TEAM_PROVISIONING_CONFIG' && !error.message.includes('short'));
});
