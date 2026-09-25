# Histórico de alterações

## [0.3.0] — 2026-09-25

### Simplificado
- Node.js/TypeScript e MongoDB, sem dependência de Google Cloud.
- Removidos BigQuery, Google Auth, inspeção de fonte, variáveis do provedor e rotas estimate/start/advance.
- Navegação básica: visão geral, carteiras, importação, bases/histórico e configurações.
- Removidos modo demonstrativo e telas de estimativa externa; calculadora fica fora do escopo ativo.

### Adicionado e preservado
- Coluna opcional de enquadramento declarado na planilha; ausências e conflitos ficam não confirmados.
- Processamento local de até 500 identidades por chamada, checkpoint e resultados idempotentes.
- Validação de reenvio e de reutilização de identificador com mesmo mapeamento.
- Indicadores somente com lotes completos, última informação por CNPJ e exportação das linhas originais.
- Histórico existente preservado; lotes antigos incompletos precisam ser reimportados.
- README, regras de desenvolvimento, arquitetura e testes atualizados no mesmo incremento.

### Verificação e limites
- 15 testes locais de regras/HTTP aprovados, 0 falhas; sintaxe e versão verificadas.
- Instalação npm falhou por EAI_AGAIN; build/tipos completos não validados.
- Integração ignorada por falta de MongoDB; navegador bloqueou servidor local. E2E não concluído.
- Sem consulta externa, acesso a banco de produção ou deploy nesta entrega.
- O programa antigo mencionado pelo usuário não foi recebido como novo anexo.

## [0.2.0] — 2026-09-24

Primeira versão com integração externa e gestão de lotes. Histórico integral preservado em `docs/archive/CHANGELOG-v0.2.0.md` e no Git. A antiga dependência de BigQuery não é requisito da versão atual.

## [0.1.0] — 2026-09-24

Planejamento inicial preservado em `docs/planejamento-v0.1.0.md`, hoje histórico.
