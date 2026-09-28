# Histórico de alterações

## [0.4.1] — 2026-09-28

### Corrigido
- Provisionamento do primeiro administrador aceita credencial privada de 10 a 128 caracteres, corrigindo PASSWORD_POLICY no primeiro login com senha de dez caracteres.
- A mesma correção atende npm run seed e a criação inicial autorizada no login.
- Hash scrypt, sal aleatório e comparação exata preservados; não existe senha fixa no código nem reset de usuários existentes.
- Cadastro de outros usuários e troca pelo painel conservam a política regular de 12 a 128 caracteres. A compatibilidade de dez caracteres é restrita ao seed inicial.

### Testes e documentação
- Cinco testes locais de segurança aprovados, incluindo mínimo/máximo, tipos inválidos, diferenças de caixa/espaço e preservação da política regular.
- Novo teste HTTP + MongoDB descartável para criação inicial, senha incorreta, hash, sessão, logout e impossibilidade de reset por alteração de ADMIN_PASSWORD; incluído em test:integration.
- README atualizado com causa, escopo, configuração e distinção entre PASSWORD_POLICY/400 e indisponibilidade 503.
- Versão alinhada em package.json e src/domain.ts. Build, CI, implantação e login real precisam de evidência do SHA correspondente; nenhum acesso real foi executado na preparação.
- Nenhuma credencial real, URI privada ou planilha adicionada ao repositório. Regras de CNPJ, histórico, interfaces e controles de origem mantidos.

## [0.4.0] — 2026-09-28

### Corrigido
- Login 403 ORIGIN: origens exatas configuradas e domínios da Vercel, sem confiar em Host ou remover CSRF.
- Sessão com user:null antes do login e suporte ao JSON já processado no serverless.
- Primeiro administrador apenas com credenciais privadas configuradas e apresentadas corretamente; sem reset de contas existentes.
- Limpeza de formulários de importação após fechar o modal, evitando IDs de coluna duplicados entre cadastro S3D e relatório.

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

### Verificações
- 15 testes puros/simulados passaram localmente.
- A CI 36441452492 da primeira revisão aprovou instalação, tipos/build, regras/HTTP, integração legada e integração de consultas com MongoDB descartável; a etapa de navegador falhou.
- Correção do ciclo do modal adicionada antes de publicar em produção; conferir a nova execução no SHA entregue, sem apresentar a execução anterior como aprovação completa.

### Preservado e limitado
- Node.js/TypeScript + MongoDB, sem Google Cloud; legado disponível em /legacy.html.
- Sem arquivos reais de clientes/CPF/senhas no Git. Anexos analisados localmente, não importados na produção pela preparação.
- Sem busca fiscal só pelo nome, sem confirmação em tempo real; referência da base ainda não homologada.
- Tela aberta conduz a fila; grandes lotes não são instantâneos.

## [0.3.0] — 2026-09-25 / implantação corrigida em 2026-09-28

Modo básico Node.js + MongoDB, dados declarados. Correção posterior do 500: frontend estático, framework Other, API isolada, favicon e headers. Histórico anterior preservado no Git e docs/archive.

## [0.2.0] — 2026-09-24

Primeiro incremento com BigQuery, posteriormente removido. Histórico em docs/archive.

## [0.1.0] — 2026-09-24

Planejamento em docs/planejamento-v0.1.0.md.
