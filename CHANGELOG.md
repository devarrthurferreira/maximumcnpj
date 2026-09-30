# Histórico de alterações

## [0.11.0] — 2026-09-30

- Simulador com gráficos comparativos de resultado e composição financeira, mantendo os quatro regimes e fórmulas existentes.
- Histórico no MongoDB com pesquisa/filtros/paginação e link próprio para cada simulação; snapshots preservam entradas, relatórios, período, autor, parâmetros, resultado, avisos e memória.
- Cálculo autoritativo no servidor, validação dos cinco grupos, idempotência e isolamento por workspace; reabrir um histórico não consulta fontes nem recalcula valores.
- Nova versão cria outro cenário vinculado sem sobrescrever o anterior; falhas de gravação têm estado explícito e repetição segura.
- Avisos consolidados em uma única faixa expansível, exibindo todos os detalhes juntos.
- Navegação com Simulações, histórico responsivo, regressões de API/MongoDB e teste completo navegador → API → banco → reabertura em outra sessão.
- Smoke público atualizado para o painel atual, os novos arquivos do simulador e a proteção da API do histórico.

## [0.10.0] — 2026-09-30

- Etapas explícitas de empresas, compras, vendas e simulador; avanço após cada relatório e botão por empresa liberado somente com os dois tipos concluídos.
- Vendas com três grupos: Optantes SN, Não optantes SN e CPFs. Compras mantêm dois grupos; fonte original permanece intacta em todas as hipóteses.
- Endpoint de pré-preenchimento concilia cinco totais, valida vínculos e conclusão e rejeita dados parciais/divergentes ou base antiga Q_V1.
- Simulador integrado a partir de calculadora@d60e8bc, com mesmos quatro regimes/premissas, receitas/despesas mensais, ano e anexos. Receita anual estimada, sem fingir consulta à RBT12.
- Período explícito de 1–12 meses, arredondamento balanceado, edição/restauração dos campos importados, rascunho isolado por aba e exportação da memória JSON.
- DRE ao final com primeira coluna fixa e orientação para rolagem no celular. Alterações invalidam resultados anteriores.
- CSV/PDF individual e consolidado acompanham CPF separado nas vendas e os cinco subtotais; porcentagens fecham em 100% com base positiva.
- Regressões do motor original, cálculos dos grupos, conciliação Node/Python, isolamento de snapshots e navegação desktop/mobile.
- Corrigida a disposição dos cartões da central de relatórios no celular, evitando largura excedente.

## [0.9.0] — 2026-09-29

- Recuperação conservadora do CSV do modelo conhecido quando separadores sem aspas dividem a descrição O e deslocam o restante da linha. Cabeçalhos, código da empresa, chave e valores são conferidos; prévia indica as linhas recuperadas.
- Dois grupos gerenciais em compras, vendas e apresentações cadastrais: Simples somente para OPTANTE explícito; Não optante para todos os demais. Resposta original da fonte permanece disponível para auditoria.
- CPF, CNO, documentos inválidos/ausentes e não confirmados entram no total e nos percentuais financeiros de Não optante. Documentos repetidos são deduplicados na contagem; todas as linhas compõem os valores.
- Percentuais financeiros usam o total completo do arquivo; contagem usa documentos distintos, com linhas sem documento tratadas individualmente. Dois grupos somam 100% quando a base é positiva.
- Filtros, históricos, CSV e PDFs individuais/consolidados acompanham a regra, preservando empresas, usuários e componentes dos snapshots.
- Testes de leitura, totais, agrupamento, consulta isolada, Node/Mongo/Python e navegador; arquivos reais usados somente na conferência local.

## [0.8.1] — 2026-09-29

- Corrigida a cópia das linhas financeiras para conservar o tipo de parceiro e permitir a emissão do PDF de vendas criado pelo fluxo real Node/MongoDB.
- Compatibilidade específica para snapshots de vendas v0.8.0 sem esse campo redundante; tipos divergentes e erros de cálculo continuam bloqueados.
- Teste de integração cruza o lote criado pelo Node com a emissão do PDF em Python, além dos testes sintéticos.
- Documentada a correção de CSV com ponto e vírgula dentro de descrições. Nenhuma linha real é descartada nem corrigida silenciosamente.

## [0.8.0] — 2026-09-29

### Vendas disponível
- Importação de vendas por empresa com comprador em A/I e componentes Q, Y, Z, AA e AB. Quantidade P opcional; não multiplica os valores.
- Compras e vendas usam Q − Y + AA − AB. Z permanece informativa; validações em centavos e bloqueio de linhas desalinhadas preservados.
- Geração permite escolher compras, vendas ou ambos; histórico mostra os relatórios faltantes e permite retomar cada tipo.
- Gerações anteriores conservam compras como única exigência. Adicionar vendas amplia a exigência para todas as empresas da geração, preservando os snapshots anteriores.
- PDF Python individual e consolidado com totais de compras e vendas separados, memória de cálculo e agrupamento gerencial de não confirmados em não optantes.
- Endpoints isolam modos de compras/vendas; relatórios cadastrais não misturam lotes financeiros. Contas, empresas e senhas preservadas.
- Testes de regras, isolamento, fluxos de geração, PDFs e navegador ampliados para vendas; conferir a CI do commit final.

## [0.7.0] — 2026-09-29

### Geração e navegação
- Menu organizado em Navegação (Início, Empresas) e Geração (Iniciar, Histórico), com identidade Maximum e uso responsivo.
- Gerações salvas para múltiplas empresas, relatórios faltantes identificados, retomada e preservação dos registros anteriores.
- PDF Python consolidado com memória de cálculo por empresa, emitido apenas após conclusão e reconciliação das compras.

### Regra financeira
- Novas compras usam Q − Y + AA − AB, com componentes em centavos validados no servidor. Z fica disponível para conferência e fora da fórmula.
- Não confirmados integram o grupo gerencial de não optantes, mantendo situação original e subtotal identificados.
- CSV e PDF expõem componentes, fórmula, valores e denominadores. CPF e demais documentos não consultáveis continuam separados.
- Históricos da regra anterior preservam a soma de Q; nenhum ajuste ausente é inventado.
- Leitura do formato de vendas preparada, com importação e processamento ainda indisponíveis.

### Preservação e verificação
- Contas, senhas, empresas e consultas existentes preservadas. README anterior arquivado.
- Testes sintéticos de regras, gerações, autenticação/isolamento, PDF e navegador; conferir a CI do commit final.
- Arquivos reais usados somente em conferência local, sem inclusão no repositório.

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
