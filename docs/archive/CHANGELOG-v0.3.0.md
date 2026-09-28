# Histórico de alterações

## Hotfix da v0.3.0 — 2026-09-28 · static-api-v1

Correção de implantação identificada pelo SHA do commit, mantendo a versão funcional 0.3.0.

### Corrigido
- Erro 500 na interface: logs mostraram `document is not defined` com o frontend executado como servidor no preset Node.
- `framework: null` fixa o preset Other; `public` permanece saída estática e apenas `api/index.ts` é função Node.
- Mantido roteamento exclusivo de `/api/*`, sem enviar raiz ou arquivos da interface ao backend.
- `/favicon.ico` redireciona para `/favicon.svg`.
- Runtime limitado à linha Node.js 22 (>=22.16.0); removida configuração fixa de memória da função.
- Headers de segurança aplicados aos arquivos estáticos e `no-store` às respostas da API.

### Testes e documentação
- Header `X-Maximum-Deployment: static-api-v1` permite reconhecer a configuração corrigida.
- Cinco testes de regressão da implantação incluídos em `npm test` e `test:deployment`.
- Comando `npm run smoke -- URL` verifica HTML, assets, ícones, saúde/versão e sessão anônima, sem escrita ou credenciais.
- README detalha Root Directory na raiz, Other, build, saída, ambiente, diagnóstico e limites das verificações.
- README v0.3.0 preservado integralmente em `docs/archive/README-v0.3.0.md`.
- CI anterior `36148532158` confirmada como bem-sucedida no SHA `2c56277`; a CI da correção deve ser verificada separadamente.
- Sem mudanças em dados, segredos, contas, enquadramento ou dependências fiscais. Nenhum acesso ao banco de produção.

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
