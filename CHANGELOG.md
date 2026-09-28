# Histórico de alterações

## [0.5.0] — 2026-09-28

### Adicionado
- Central de relatórios por Código/empresa e consulta concluída, com seleção de snapshots anteriores.
- Visualização separada de todos, optantes, não optantes e não confirmados; filtros por tipo e pesquisa na tabela.
- Relatórios reais em Python/ReportLab: resumo de quantidades, percentuais e qualidade; listagem detalhada por grupo.
- PDF detalhado em partes de 500 CNPJs e CSV de 2.000, com nomes/partes explícitos e sem truncamento silencioso.
- Mesma sessão MongoDB do Node, usuário ativo/workspace, origem exata, limites por usuário e reconciliação das quantidades.
- Leitura mínima e geração em memória; nenhum arquivo ou cadastro duplicado armazenado.
- Testes Python, MongoDB/HTTP descartável, navegação e downloads; smoke público do runtime Python sem credenciais.

### Revisão da verificação de implantação
- Smoke de autenticação agora usa a versão de package.json, em vez de exigir a versão antiga 0.4.0.
- Timeout em todas as requisições do smoke e teste de regressão para impedir versão fixa.
- A etapa verify da CI 36461983028 aprovou a implementação inicial; conferir o SHA final para os smokes de produção.

### Preservado
- Node.js/TypeScript, MongoDB e integração Minha Receita, sem Google Cloud.
- Correção de senha inicial da v0.4.1, limites, CSRF, sessões e comportamento de contas existentes.
- Histórico, snapshots anteriores e exportações legadas; nenhum dado migrado ou removido.

### Evidências e limitações
- Sete testes locais Python aprovados; PDF sintético renderizado e revisado. Quatro testes integrados Python/MongoDB/HTTP e testes de navegador aprovados na CI 36461983028; revisão do smoke requer nova execução.
- Emitir arquivo não faz nova consulta fiscal. O tipo é o primeiro armazenado por CNPJ na importação.
- Pesquisa textual é somente da tabela; arquivos contêm o grupo/tipo completos.
- Listagem completa exige todas as partes; sem ZIP/envio por e-mail/agendamento nesta versão.
- Ambiente Node local não executa Python automaticamente; usar Vercel dev para testar as duas rotas.
- README v0.4.1 e CHANGELOG anterior preservados em docs/archive.

## [0.4.1] — 2026-09-28

Correção restrita ao provisionamento do primeiro administrador para aceitar a credencial privada de dez caracteres. Scrypt, contas existentes, sessões e política regular preservados. Detalhes originais em `docs/archive/CHANGELOG-v0.4.1.md`.

## [0.4.0] — 2026-09-28

Consulta Minha Receita, Código/ID, histórico mínimo por empresa/CNPJ, origem de login corrigida e deduplicação compartilhada. Documentação completa preservada no arquivo da v0.4.1.

## [0.3.0] — 2026-09-25

Modo básico Node.js e MongoDB; correção posterior de implantação estática/API, sem Google Cloud. Documentos em docs/archive.

## [0.2.0] e [0.1.0]

Fundação e planejamento inicial, preservados em docs/archive e docs/planejamento-v0.1.0.md.
