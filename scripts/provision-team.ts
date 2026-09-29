import { provisionMaximumTeam } from '../src/team.ts';
import { closeDatabase } from '../src/store.ts';

try {
  const result = await provisionMaximumTeam();
  console.log(`Maximum: ${result.created} conta(s) criada(s), ${result.preserved} conta(s) preservada(s).`);
  console.log(`Equipe tributária: ${result.configured.team ? 'configurada; contas novas exigem troca de senha' : 'senha inicial não configurada'}. Administrador: ${result.configured.admin ? 'configurado' : 'senha inicial não configurada'}.`);
  console.log('Nenhuma senha existente foi redefinida. Remova as variáveis de senha inicial depois de provisionar todas as contas.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao provisionar a equipe Maximum.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
