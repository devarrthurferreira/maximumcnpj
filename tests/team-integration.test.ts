import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { collection, database, scope, closeDatabase } from '../src/store.ts';
import { startServer } from '../src/server.ts';
import { MAXIMUM_ADMIN, MAXIMUM_TEAM, provisionMaximumTeam } from '../src/team.ts';
import { hashPassword, verifyPassword } from '../src/security.ts';

test('Equipe Maximum: provisionamento aditivo, isolamento, login e troca obrigatória', { skip: !process.env.MONGODB_URI, timeout: 60000 }, async () => {
  const original = { ...process.env }, dbName = `maximum_team_test_${randomUUID().replaceAll('-', '')}`;
  const teamPassword = 'Team!123', adminPassword = 'Admin!12345', replacement = 'NewSynthetic!123';
  Object.assign(process.env, { MONGODB_DB: dbName, WORKSPACE_ID: 'team-test', APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'test', MAXIMUM_TEAM_INITIAL_PASSWORD: teamPassword, MAXIMUM_ADMIN_INITIAL_PASSWORD: adminPassword });
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  let server: ReturnType<typeof startServer> | undefined;
  try {
    const db = await database();
    assert.equal(db.databaseName, dbName);
    const users = await collection('users');
    const existing = { _id: randomUUID(), ...scope(), ...MAXIMUM_TEAM[0], name: 'Nome preservado', role: 'viewer', active: false, mustChangePassword: false, passwordHash: await hashPassword('ExistingSynthetic!123'), createdAt: new Date() };
    const existingAdmin = { _id: randomUUID(), ...scope(), name: 'Administrador existente', email: 'existing@example.test', role: 'admin', active: true, mustChangePassword: false, passwordHash: await hashPassword('ExistingSynthetic!123'), createdAt: new Date() };
    const client = { _id: randomUUID(), ...scope(), name: 'Empresa existente', createdAt: new Date() };
    await users.insertMany([existing, existingAdmin]);
    await (await collection('clients')).insertOne(client);
    // Same address in another workspace must remain isolated.
    const other = { ...existing, _id: randomUUID(), workspaceId: 'other-workspace' };
    await users.insertOne(other);

    server = startServer(0);
    if (!server.listening) await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.APP_ORIGIN = origin;
    const request = async (path: string, method = 'GET', input?: unknown, cookie = '') => {
      const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: input === undefined ? undefined : JSON.stringify(input) });
      return { response, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';', 1)[0] || '' };
    };
    const member = MAXIMUM_TEAM[1];
    const bad = await request('/api/auth/login', 'POST', { email: member.email, password: 'Wrong!123' });
    assert.equal(bad.response.status, 401);
    assert.equal(await users.countDocuments(scope()), 2);
    const first = await request('/api/auth/login', 'POST', { email: member.email, password: teamPassword });
    assert.equal(first.response.status, 200);
    assert.ok(first.cookie);
    assert.equal(await users.countDocuments(scope()), 20);
    assert.deepEqual(await users.findOne(scope({ _id: existing._id })), existing);
    assert.deepEqual(await users.findOne({ _id: other._id }), other);
    assert.deepEqual(await (await collection('clients')).findOne(scope({ _id: client._id })), client);
    const account = await users.findOne(scope({ email: member.email }));
    assert.equal(account?.role, 'operator');
    assert.equal(account?.mustChangePassword, true);
    assert.equal(await verifyPassword(teamPassword, account!.passwordHash), true);
    const admin = await users.findOne(scope({ email: MAXIMUM_ADMIN.email }));
    assert.equal(admin?.role, 'admin');
    assert.equal(admin?.mustChangePassword, false);
    assert.equal(await verifyPassword(adminPassword, admin!.passwordHash), true);
    const hashes = (await users.find(scope({ provisioningSource: 'maximum-team-v1' })).toArray()).map(user => user.passwordHash);
    assert.equal(new Set(hashes).size, hashes.length);
    assert.equal(JSON.stringify(await users.find(scope()).toArray()).includes(teamPassword), false);
    const me = await request('/api/auth/me', 'GET', undefined, first.cookie);
    assert.equal(me.data.user.mustChangePassword, true);
    const blocked = await request('/api/clients', 'GET', undefined, first.cookie);
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.data.error, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await request('/api/auth/password', 'POST', { current: 'wrong', password: replacement }, first.cookie)).response.status, 400);
    assert.equal((await request('/api/auth/password', 'POST', { current: teamPassword, password: teamPassword }, first.cookie)).data.error, 'PASSWORD_REUSE');
    assert.equal((await request('/api/auth/password', 'POST', { current: teamPassword, password: 'New!1234' }, first.cookie)).data.error, 'PASSWORD_POLICY');
    assert.equal((await request('/api/auth/password', 'POST', { current: teamPassword, password: replacement }, first.cookie)).response.status, 200);
    assert.equal((await request('/api/auth/session', 'GET', undefined, first.cookie)).data.user, null);
    const newLogin = await request('/api/auth/login', 'POST', { email: member.email, password: replacement });
    assert.equal(newLogin.response.status, 200);
    assert.equal((await request('/api/clients', 'GET', undefined, newLogin.cookie)).response.status, 200);
    assert.equal((await request('/api/users/provision-maximum', 'POST', {}, newLogin.cookie)).response.status, 403);
    // Even an otherwise valid 12+ character current password cannot be reused.
    assert.equal((await request('/api/auth/password', 'POST', { current: replacement, password: replacement }, newLogin.cookie)).data.error, 'PASSWORD_REUSE');
    process.env.MAXIMUM_TEAM_INITIAL_PASSWORD = 'Different!123';
    process.env.MAXIMUM_ADMIN_INITIAL_PASSWORD = 'AnotherAdmin!123';
    assert.deepEqual(await provisionMaximumTeam(), { created: 0, preserved: 19, total: 19, configured: { team: true, admin: true } });
    assert.equal((await request('/api/auth/login', 'POST', { email: member.email, password: teamPassword })).response.status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: member.email, password: process.env.MAXIMUM_TEAM_INITIAL_PASSWORD })).response.status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: member.email, password: replacement })).response.status, 200);
    const adminLogin = await request('/api/auth/login', 'POST', { email: MAXIMUM_ADMIN.email, password: adminPassword });
    assert.equal(adminLogin.response.status, 200);
    const provision = await request('/api/users/provision-maximum', 'POST', {}, adminLogin.cookie);
    assert.equal(provision.response.status, 200);
    assert.equal(provision.data.created, 0);
    assert.equal(provision.data.preserved, 19);
    assert.deepEqual(await users.findOne(scope({ _id: existing._id })), existing);
    assert.equal(await users.countDocuments(scope()), 20);
    assert.equal((await request('/api/users/provision-maximum', 'POST', { teamPassword: null }, adminLogin.cookie)).response.status, 400);
    // Private passwords supplied by an authenticated administrator stay transient.
    const missingEmail = MAXIMUM_TEAM[2].email;
    await users.deleteOne(scope({ email: missingEmail }));
    const explicit = await request('/api/users/provision-maximum', 'POST', { teamPassword, adminPassword }, adminLogin.cookie);
    assert.equal(explicit.response.status, 200);
    assert.equal(explicit.data.created, 1);
    assert.equal(explicit.data.preserved, 18);
    assert.equal(await verifyPassword(teamPassword, (await users.findOne(scope({ email: missingEmail })))!.passwordHash), true);
    assert.equal(await verifyPassword(replacement, (await users.findOne(scope({ email: member.email })))!.passwordHash), true);
    assert.equal(await verifyPassword(adminPassword, (await users.findOne(scope({ email: MAXIMUM_ADMIN.email })))!.passwordHash), true);
    await users.deleteMany(scope({ email: { $in: [MAXIMUM_TEAM[3].email, MAXIMUM_TEAM[4].email] } }));
    const concurrent = await Promise.all([
      provisionMaximumTeam({ teamPassword, adminPassword }),
      provisionMaximumTeam({ teamPassword, adminPassword })
    ]);
    assert.equal(concurrent.reduce((total, result) => total + result.created, 0), 2);
    assert.equal(concurrent.reduce((total, result) => total + result.preserved, 0), 36);
    assert.equal(await users.countDocuments(scope()), 20);
    assert.deepEqual(await users.findOne(scope({ _id: existing._id })), existing);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    try {
      const db = await database();
      if (db.databaseName === dbName && /^maximum_team_test_[a-f0-9]{32}$/.test(dbName)) await db.dropDatabase();
    } finally {
      await closeDatabase();
      for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
      Object.assign(process.env, original);
    }
  }
});
