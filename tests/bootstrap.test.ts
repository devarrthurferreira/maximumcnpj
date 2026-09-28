import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { database, collection, scope, closeDatabase } from '../src/store.ts';
import { startServer } from '../src/server.ts';
import { verifyPassword } from '../src/security.ts';

test('Primeiro login com senha de dez caracteres; senha existente nunca é resetada', { skip: !process.env.MONGODB_URI }, async () => {
  const dbName = `maximum_bootstrap_test_${randomUUID().replaceAll('-', '')}`;
  const keys = ['MONGODB_DB', 'WORKSPACE_ID', 'APP_ORIGIN', 'NODE_ENV', 'ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const password = 'Init@12345'; // Synthetic fixture only.
  Object.assign(process.env, { MONGODB_DB: dbName, WORKSPACE_ID: 'bootstrap-test', APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'test', ADMIN_NAME: 'Bootstrap Test', ADMIN_EMAIL: 'bootstrap@example.test', ADMIN_PASSWORD: password });
  let server: ReturnType<typeof startServer> | undefined;
  try {
    const db = await database();
    assert.equal(db.databaseName, dbName);
    server = startServer(0);
    if (!server.listening) await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.APP_ORIGIN = origin;
    const login = (value: string) => fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: value }) });
    const users = await collection('users');
    const wrong = await login('NotThePass');
    assert.equal(wrong.status, 401);
    await wrong.arrayBuffer();
    assert.equal(await users.countDocuments(scope()), 0);
    const first = await login(password);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });
    const cookie = first.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    const account = await users.findOne(scope({ email: 'bootstrap@example.test' }));
    assert.ok(account);
    assert.equal(account.role, 'admin');
    assert.equal(account.mustChangePassword, false);
    assert.equal(await verifyPassword(password, account.passwordHash), true);
    assert.equal(JSON.stringify(account).includes(password), false);
    const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user._id, account._id);

    // Changing provisioning configuration must never replace an existing password.
    process.env.ADMIN_PASSWORD = 'Other@1234';
    const changedEnvironment = await login(process.env.ADMIN_PASSWORD);
    assert.equal(changedEnvironment.status, 401);
    await changedEnvironment.arrayBuffer();
    const again = await login(password);
    assert.equal(again.status, 200);
    await again.arrayBuffer();
    assert.equal(await users.countDocuments(scope()), 1);
    assert.equal((await users.findOne(scope({ _id: account._id })))?.passwordHash, account.passwordHash);

    const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(logout.status, 200);
    await logout.arrayBuffer();
    const session = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await session.json()).user, null);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    try {
      const db = await database();
      if (db.databaseName === dbName && /^maximum_bootstrap_test_[a-f0-9]{32}$/.test(dbName)) await db.dropDatabase();
    } finally {
      await closeDatabase();
      for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    }
  }
});
