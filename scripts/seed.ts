import { seed, closeDatabase } from '../src/store.ts';
try { const account = await seed(); console.log(`Administrador criado: ${account}. Remova ADMIN_PASSWORD do ambiente.`); }
catch (error) { console.error(error instanceof Error ? error.message : 'Falha ao criar administrador.'); process.exitCode = 1; }
finally { await closeDatabase(); }
