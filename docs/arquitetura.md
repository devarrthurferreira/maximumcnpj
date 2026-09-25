# Arquitetura vigente · v0.3.0

Atualizada em 25/09/2026. Substitui o desenho operacional da v0.2.0.

Navegador → API Node.js/TypeScript → MongoDB. A leitura/exportação CSV/XLSX ocorre em Web Worker. O servidor valida novamente as linhas. Não há adaptador fiscal externo ativo.

## Componentes
- src/domain.ts: identidade, deduplicação, estatísticas e CSV.
- src/imported.ts: enquadramento explícito e conflitos da planilha.
- src/service.ts: carteiras, partes de upload, páginas de processamento, resultados e exportação.
- src/store.ts: conexão, índices e provisionamento inicial.
- src/server.ts: HTTP, sessão, origem e autorização.
- public/app.js: interface básica e retomada enquanto o operador acompanha.

## Persistência e publicação
Carteiras e lotes pertencem ao workspace. Linhas preservam valores originais. Resultados únicos por lote/CNPJ registram fonte PLANILHA. O dashboard exige lote COMPLETED e usa a última observação por CNPJ completo. Fontes de registros históricos são preservadas.

Upload exige posição e hash coerentes. A finalização confere totais; chamadas seguintes organizam até 500 identidades por página. Checkpoint usa ordenação canônica do CNPJ. Upserts e índices únicos permitem reenvio. A contagem precisa coincidir com os únicos antes da publicação. Travas temporárias protegem operações simultâneas.

Não há cron nem fila independente do navegador. O limite de 50.000 linhas não substitui carga real: o desempenho das agregações no MongoDB e da hospedagem ainda precisa de medição.

## Migração
Nenhum dado é removido. Lotes anteriores concluídos podem ser lidos/exportados. Incompletos exigem nova importação; não são convertidos automaticamente. Cancelamento local não cancela eventual job antigo em outro serviço.

README contém variáveis, limites, segurança e testes pendentes.
