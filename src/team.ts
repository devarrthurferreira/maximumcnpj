import { randomUUID } from 'node:crypto';
import { AppError, digest, hashInitialAdminPassword, hashInitialTeamPassword } from './security.ts';
import { audit, collection, scope } from './store.ts';

/** Fixed, explicitly authorized roster; no addresses are accepted from a public request. */
export const MAXIMUM_TEAM = Object.freeze([
  { name: 'Adria Cristina', email: 'tributario17@maximumcontabil.com.br' },
  { name: 'Alessandra Oliveira', email: 'tributario1@maximumcontabil.com.br' },
  { name: 'Ana Caroline', email: 'tributario2@maximumcontabil.com.br' },
  { name: 'Ana Carolina Lage', email: 'tributario18@maximumcontabil.com.br' },
  { name: 'Beatriz Barra', email: 'tributario9@maximumcontabil.com.br' },
  { name: 'Bruna Vieira', email: 'tributario16@maximumcontabil.com.br' },
  { name: 'Claudia Santos', email: 'tributario5@maximumcontabil.com.br' },
  { name: 'Felipe Lima', email: 'tributario11@maximumcontabil.com.br' },
  { name: 'Glenda Alves', email: 'tributario13@maximumcontabil.com.br' },
  { name: 'Henrique Sabião', email: 'tributario14@maximumcontabil.com.br' },
  { name: 'Janaina Borges', email: 'tributario3@maximumcontabil.com.br' },
  { name: 'Karoline Faria', email: 'tributario15@maximumcontabil.com.br' },
  { name: 'Marcela Geronimo', email: 'tributario12@maximumcontabil.com.br' },
  { name: 'Maria Fonseca', email: 'tributario4@maximumcontabil.com.br' },
  { name: 'Marta Mendes', email: 'tributario6@maximumcontabil.com.br' },
  { name: 'Maximum Contabil', email: 'tributario7@maximumcontabil.com.br' },
  { name: 'Mônica Lima', email: 'tributario8@maximumcontabil.com.br' },
  { name: 'Raíssa Ferreira', email: 'tributario10@maximumcontabil.com.br' }
].map(account => Object.freeze(account)));
export const MAXIMUM_ADMIN = Object.freeze({ name: 'Programação Maximum', email: 'programacao@maximumcontabil.com.br' });

export type MaximumProvisioningConfig = { teamPassword?: string; adminPassword?: string };
export function maximumProvisioningConfig(env: NodeJS.ProcessEnv = process.env): MaximumProvisioningConfig {
  return {
    teamPassword: env.MAXIMUM_TEAM_INITIAL_PASSWORD || undefined,
    adminPassword: env.MAXIMUM_ADMIN_INITIAL_PASSWORD ||
      (env.ADMIN_EMAIL?.trim().toLowerCase() === MAXIMUM_ADMIN.email ? env.ADMIN_PASSWORD : undefined) || undefined
  };
}

/** Only check eligibility here: the existing stored hash always decides login. */
export function matchesMaximumInitialCredential(account: string, password: unknown, config = maximumProvisioningConfig()): boolean {
  if (typeof password !== 'string' || password.length > 128) return false;
  const expected = account === MAXIMUM_ADMIN.email ? config.adminPassword :
    MAXIMUM_TEAM.some(member => member.email === account) ? config.teamPassword : undefined;
  return Boolean(expected && digest(password) === digest(expected));
}

function validateConfiguredPassword(password: string | undefined, minimum: number, variable: string) {
  if (password !== undefined && (typeof password !== 'string' || password.length < minimum || password.length > 128)) {
    throw new AppError(503, 'TEAM_PROVISIONING_CONFIG', `Configure ${variable} com ${minimum} a 128 caracteres no ambiente privado do servidor.`);
  }
}

export async function provisionMaximumTeam(config = maximumProvisioningConfig()) {
  // Validate the whole configuration before changing anything; never log credentials.
  validateConfiguredPassword(config.teamPassword, 8, 'MAXIMUM_TEAM_INITIAL_PASSWORD');
  validateConfiguredPassword(config.adminPassword, 10, 'MAXIMUM_ADMIN_INITIAL_PASSWORD');
  if (!config.teamPassword && !config.adminPassword) {
    throw new AppError(503, 'TEAM_PROVISIONING_CONFIG', 'Configure MAXIMUM_TEAM_INITIAL_PASSWORD e/ou MAXIMUM_ADMIN_INITIAL_PASSWORD no ambiente privado do servidor.');
  }
  const accounts = [
    ...(config.teamPassword ? MAXIMUM_TEAM.map(member => ({ ...member, role: 'operator', mustChangePassword: true, password: config.teamPassword! })) : []),
    ...(config.adminPassword ? [{ ...MAXIMUM_ADMIN, role: 'admin', mustChangePassword: false, password: config.adminPassword }] : [])
  ];
  const users = await collection('users');
  let created = 0, preserved = 0;
  for (const account of accounts) {
    const filter = scope({ email: account.email });
    // Avoid hashing again on routine execution. $setOnInsert also protects races.
    if (await users.findOne(filter, { projection: { _id: 1 } })) { preserved++; continue; }
    const { password, ...details } = account;
    const passwordHash = account.mustChangePassword ? await hashInitialTeamPassword(password) : await hashInitialAdminPassword(password);
    const id = randomUUID();
    try {
      const result = await users.updateOne(filter, { $setOnInsert: {
        _id: id, ...scope(), ...details, passwordHash, active: true, createdAt: new Date(), provisioningSource: 'maximum-team-v1'
      } }, { upsert: true });
      if (result.upsertedCount) {
        created++;
        await audit('system:maximum-team', 'user.provision', id);
      } else { preserved++; }
    } catch (error: any) {
      if (error?.code !== 11000 || !await users.findOne(filter, { projection: { _id: 1 } })) throw error;
      preserved++;
    }
  }
  return { created, preserved, total: accounts.length, configured: { team: Boolean(config.teamPassword), admin: Boolean(config.adminPassword) } };
}

export async function provisionMaximumForLogin(account: string, password: unknown): Promise<void> {
  if (!matchesMaximumInitialCredential(account, password)) return;
  if (await (await collection('users')).findOne(scope({ email: account }), { projection: { _id: 1 } })) return;
  await provisionMaximumTeam();
}
