# Histórico de alterações

## [0.6.0] — 2026-09-29

### Acessos Maximum
- Provisionamento aditivo de 18 operadores tributários e administrador de programação, sem redefinir contas existentes.
- Senha temporária de 8 caracteres aceita apenas no provisionamento da equipe; acesso bloqueado até redefinição para senha de 12–128 caracteres diferente da atual.
- Script, configuração privada opcional e endpoint exclusivo de administrador para provisionamento; nenhum segredo real versionado.

### Relatórios de compras
- Empresa existente obrigatória e importação CSV UTF-8/Windows-1252, XLS/XLSX com A/I/P/Q.
- Valores financeiros em centavos: soma de Q por linha, sem multiplicar quantidade P; consulta e contagem deduplicadas por CNPJ completo.
- Percentuais por fornecedores e valores com denominadores explícitos; não confirmados e CPF/outros documentos separados.
- Histórico financeiro por empresa, consulta externa reaproveitando pipeline existente, snapshot reconciliado e exports PDF Python/CSV em partes.
- Vendas desabilitada na interface e recusada pelo backend.
- Grades de importação responsivas mantêm tabelas extensas em contêineres próprios de rolagem no celular.
- Preservados cadastros, contas anteriores, consultas e relatórios cadastrais. README v0.5.1 arquivado, plano de ação atualizado.

### Validação
- Testes de parsing, valores, duplicidades, autenticação, troca obrigatória, isolamento, relatórios e navegação com dados sintéticos.
- Matcher do E2E de compras abrange subrotas de upload, consulta e download; evita que uma requisição simulada alcance o servidor sem sessão.
- CI com MongoDB descartável, Node 22 e Python; verificar execução do SHA final para evidência de aprovação.
- Arquivo real utilizado somente para conferir formato e totais, sem inclusão no repositório.

## [0.5.1] — 2026-09-28

### Identidade visual
- Paleta Maximum em bordô, branco e tons de apoio no painel atual, legado, login e relatórios.
- Logo oficial local, íntegra e proporcional; símbolo compacto derivado do próprio PNG.
- Marca no login móvel e no menu recolhido; sem dependência de imagem remota em produção.
- PDFs Python com logo branca em faixa bordô em todas as páginas, margens e contraste ajustados.
- Testes de integridade da imagem, PDF incorporado, contraste e navegação responsiva.
- README atualizado no mesmo incremento. Senhas, autenticação, dados e regras fiscais preservados.


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
