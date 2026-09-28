# Histórico de alterações

## [0.4.0] — 2026-09-28

### Corrigido
- Login 403 ORIGIN: origens exatas configuradas e domínios da Vercel, sem confiar em Host ou remover CSRF.
- Sessão com user:null antes do login e suporte ao JSON já processado no serverless.
- Primeiro administrador apenas com credenciais privadas configuradas e apresentadas corretamente; sem reset de contas existentes.

### Adicionado
- Importação S3D/Excel: ID = Código, conflitos explícitos e UUID preservado.
- Consulta Minha Receita pelo CNPJ e comparação do nome informado/retornado.
- Timeout, resposta limitada, controle global MongoDB, pausas e novas tentativas.
- Campos mínimos, deduplicação, CPF/CNO fora da fila e dos percentuais.
- Cadastro CNPJ único, estados imutáveis compartilhados e vínculo mínimo por busca/empresa.
- Nova chamada à API por lote, sem apresentar cache antigo como nova verificação.
- Histórico por empresa/código/CNPJ, percentuais e exportação CSV.
- Modelo TIPO, CNPJ / CPF / CNO, Razão Social e Estado; RESPOSTA antiga ignorada.
- Testes de origem, adaptador, minimização, histórico, integração e browser.
- Smoke em produção sem credenciais e teste informativo de conectividade da fonte.

### Preservado e limitado
- Node.js/TypeScript + MongoDB, sem Google Cloud; legado disponível em /legacy.html.
- Sem arquivos reais de clientes/CPF/senhas no Git. Anexos analisados localmente, não importados na produção pela preparação.
- Sem busca fiscal só pelo nome, sem confirmação em tempo real; referência da base ainda não homologada.
- Tela aberta conduz a fila; grandes lotes não são instantâneos.
- 15 testes puros/simulados passaram localmente; resultados completos devem ser conferidos na CI do SHA.

## [0.3.0] — 2026-09-25 / implantação corrigida em 2026-09-28

Modo básico Node.js + MongoDB, dados declarados. Correção posterior do 500: frontend estático, framework Other, API isolada, favicon e headers. Histórico anterior preservado no Git e docs/archive.

## [0.2.0] — 2026-09-24

Primeiro incremento com BigQuery, posteriormente removido. Histórico em docs/archive.

## [0.1.0] — 2026-09-24

Planejamento em docs/planejamento-v0.1.0.md.
