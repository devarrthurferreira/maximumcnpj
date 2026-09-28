# Maximum CNPJ · v0.4.0

**Node.js + TypeScript + MongoDB. Consultas pela API Minha Receita, importação de empresas por Código/ID e histórico sem duplicar cadastros. Sem Google Cloud.**

> A resposta corresponde à base do fornecedor, não a uma consulta instantânea ao portal oficial. Data da requisição e atualização fiscal são diferentes. Ausência, erro e indicador desconhecido nunca significam automaticamente “não optante”.

| Controle | Situação |
|---|---|
| Versão / revisão | 0.4.0 · 28/09/2026 |
| Repositório | devarrthurferreira/maximumCNPJ |
| Plataforma | Interface estática + API Node.js, MongoDB externo |
| Fonte | Minha Receita, GET /CNPJ, sem chave de API ou Google |
| Cadastro da responsável | Código = ID da planilha S3D; UUID interno preservado |
| Testes locais desta preparação | 15 testes de domínio, segurança, origem e adaptador aprovados |
| Build, MongoDB e navegador | Testes incluídos; conferir a CI do SHA publicado |
| Banco de produção / login real | Não alterados/testados com credenciais pela preparação |
| Dados reais anexados | Analisados localmente; não versionados nem enviados em massa à fonte |

## 1. Correção do login

O log da produção confirmou `POST /api/auth/login → 403`, código `ORIGIN`: a origem do navegador não correspondia a `APP_ORIGIN`. Não era evidência de senha inválida.

`src/origins.ts` aceita somente origens exatas configuradas em `APP_ORIGIN` e, na Vercel, os domínios injetados pela plataforma em `VERCEL_URL`, `VERCEL_BRANCH_URL` e `VERCEL_PROJECT_PRODUCTION_URL`. Não usa Host/X-Forwarded-Host do pedido para autorizar acessos, não libera todos os domínios `.vercel.app` e não remove CSRF.

`GET /api/auth/session` retorna 200 com `user:null` antes de entrar. A nova interface usa essa rota e não trata ausência normal de sessão como erro de carregamento. As rotas privadas continuam respondendo 401 quando não autenticadas; credenciais incorretas continuam sendo recusadas.

Na primeira entrada, caso não exista usuário no workspace e as credenciais apresentadas correspondam exatamente a `ADMIN_EMAIL`/`ADMIN_PASSWORD` privadas do ambiente, o servidor pode provisionar o administrador pelo mesmo seed existente. Não cria senha padrão, não altera contas existentes e não reseta senhas. Depois de provisionar, remova `ADMIN_PASSWORD` da hospedagem.

## 2. Fluxo com os arquivos fornecidos

1. Entre com a conta autorizada.
2. Acesse **Empresas e códigos → Importar cadastro S3D** e selecione o CSV de empresas ou XLSX equivalente.
3. Confira: `ID → Código`, `Razão social → Nome`, `CNPJ → Documento`, `Ativa? → Situação` e `UF → UF`.
4. Revise e confirme. Cadastros com CPF/documento ausente podem ser responsáveis, mas o CPF não é armazenado nem consultado como CNPJ.
5. Abra **Nova consulta**, escolha a responsável e importe o relatório de clientes/fornecedores.
6. Mapeie documento e nome; confira contagens e confirme o envio dos campos essenciais.
7. Acompanhe o lote, os percentuais, os filtros e a exportação CSV.
8. Use **Consultar novamente na API** para nova verificação, preservando o histórico anterior.

Um arquivo começando por número, como `868-...`, sugere o Código correspondente. A seleção continua visível para confirmação; não vincula dados silenciosamente à empresa errada.

| Planilha de relatório | Destino |
|---|---|
| CNPJ / CPF / CNO, CNPJ | Identidade completa validada |
| Razão Social, Nome | Nome informado, conferido com a API |
| TIPO | Cliente/fornecedor, quando disponível |
| Estado, UF | UF informada |
| RESPOSTA, Regime, outras colunas | Não utilizadas para determinar o enquadramento |

É possível escolher aba, linha do cabeçalho e colunas. A detecção sugere, mas não substitui a revisão. A planilha não precisa trazer a resposta do Simples já preenchida.

### Análise estrutural dos anexos

O relatório fornecido tem 1.200 linhas de dados, 1.141 CNPJs válidos distintos e 59 repetições adicionais. O cadastro S3D contém 421 registros: 376 documentos com 14 posições, 41 CPFs e quatro vazios. Contagem de posições não substitui validação do dígito.

Esses números são de leitura/validação local, não resultados fiscais. Os arquivos completos não integram o Git e não foram carregados automaticamente no banco de produção. A interface permite importá-los com a sessão do administrador.

## 3. Identidade e nome

A chamada externa utiliza o **CNPJ completo**. O backend exige que a identidade retornada seja igual à solicitada e compara razão social/nome fantasia com o nome da linha. A resposta mostra nome informado, retornado e aviso de compatibilidade/divergência.

Não determina opção pelo nome, atividade, porte, resultado de mecanismo de busca ou resposta antiga. Homônimos podem ser empresas diferentes. Nome divergente é alerta, não substitui identidade nem altera silenciosamente o CNPJ. Sem CNPJ válido, a linha fica no diagnóstico para corrigir a origem; não há busca fiscal confiável somente por nome nesta versão.

CNPJs numéricos e alfanuméricos são validados localmente. A aceitação/cobertura de alfanuméricos pelo fornecedor depende da API; uma recusa não é negativa fiscal. CPF, CNO e inválidos não entram na fila CNPJ nem nos percentuais.

## 4. Percentuais

| Classificação | Regra |
|---|---|
| Optante | opcao_pelo_simples === true, identidade conferida, sem conflito |
| Não optante | opcao_pelo_simples === false, identidade conferida, sem conflito |
| Não confirmado | Nulo/inesperado, erro, ausência, identidade divergente ou conflito |

Só booleanos explícitos são aceitos. String `"false"` não vira negativa. MEI positivo com Simples negativo vira conflito.

Os percentuais usam **CNPJs válidos distintos**, incluindo não confirmados. Repetições não aumentam contagem; matriz/filial com CNPJ completo diferente continuam distintas. Cobertura = respostas explícitas / total válido distinto. Arredondamento pode variar a soma em 0,01 ponto.

O dashboard usa somente lotes concluídos e a última consulta por CNPJ, com filtro por responsável. Não soma reimportações nem mistura declarações antigas da v0.3.0 com respostas externas.

## 5. Fonte, limites e atualidade

`src/lookup-provider.ts` usa endpoint fixo `https://minhareceita.org/{cnpj}`, Node fetch, timeout de nove segundos, resposta limitada a 2 MB, sem cache HTTP da aplicação e conferência de identidade. Não há fallback pago ou scraping silencioso.

O controle compartilhado no MongoDB permite uma requisição por vez e intervalo mínimo de 1,1 segundo após cada resposta. Erro 429 e falhas transitórias aplicam pausa e até três tentativas, respeitando Retry-After. O limite local é uma política conservadora, não uma franquia garantida pelo fornecedor.

Mais de 10.000 CNPJs são um lote lógico, **não chamadas paralelas nem processamento instantâneo**. A hospedagem também tem consumo/limites; não há garantia de custo total zero. Não aumente concorrência para contornar bloqueios.

A cada novo lote/reconsulta, a API é chamada de novo para cada CNPJ distinto. Reutilizamos registros no MongoDB, não apresentamos resultado antigo como nova verificação. O fornecedor pode responder a partir da mesma base: nova chamada não garante atualização fiscal naquele dia.

A referência fiscal não é inferida do horário HTTP ou da data de opção. Enquanto esse metadado não for homologado, interface/exportação informa **Não informada**. `checkedAt` é apenas a data da requisição.

## 6. Armazenamento mínimo e histórico

| Coleção | Conteúdo |
|---|---|
| clients | Responsável: código, nome, CNPJ válido opcional, ativa, UF e IDs internos |
| cnpjEntities | Um cadastro por workspace/CNPJ, ponteiro ao estado atual |
| cnpjStates | Estado reduzido imutável, compartilhado quando igual |
| lookupJobs | Responsável/código, arquivo, datas, contagens, status e resumo |
| lookupItems | Um vínculo por lote/CNPJ, nome informado, tipo/UF, ocorrências, estado e data |
| lookupStage | Campos mínimos temporários; excluídos após validação; TTL sete dias para abandono |
| providerControl | Controle global de requisições da fonte |
| users/sessions/audit | Acesso e auditoria preservados |

O fingerprint não inclui o horário da chamada. Duas verificações iguais usam o mesmo estado, mas cada vínculo registra a nova data. Se o conteúdo muda, cria-se outro estado sem alterar snapshots anteriores.

Histórico exige vínculo por consulta/CNPJ; eliminar todos impediria reconstruir buscas. Não copiamos payload integral por lote, sócios, telefones, endereços ou colunas irrelevantes.

O arquivo binário não é salvo. A exportação nova tem **uma linha por CNPJ único e campos essenciais**, não reproduz todas as colunas/linhas originais. Guarde o arquivo original conforme política interna. Histórico e exportação antigos continuam em `/legacy.html`, sem migração destrutiva.

Históricos não expiram automaticamente nesta entrega. Defina retenção, backups e descarte antes de grandes volumes. Índices/reaproveitamento não tornam armazenamento ilimitado.

## 7. Processamento e retomada

```text
UPLOADING → PROCESSING → COMPLETED
           ↘ INVALID
Lotes abertos → CANCELLED
```

Upload em partes de até 250 linhas, offset e hash; reenvio igual é idempotente. Após consolidar, cada CNPJ tem item único. Chamadas limitadas mantêm PENDING/RETRY/DONE e gravam resposta antes de concluir.

Há lease por lote e controle global da fonte no banco. Indicadores só são publicados depois da contagem final. Reconsulta copia identidades mínimas no servidor e cria outro histórico, não copia respostas como novas.

A tela aberta conduz o processamento. Fechar pausa a continuidade após a chamada em curso; reabrir retoma. Não há cron/fila autônoma. Pausar não desfaz uma requisição já iniciada. Upload incompleto sem arquivo local deve ser cancelado e reimportado.

Limites: arquivo CSV/XLSX até 10 MiB, 50.000 linhas, 80 colunas; API recebe até 2,8 MB por chamada. São limites de código, não homologação de velocidade para qualquer lote real.

## 8. Instalação e variáveis

Node.js >=22.16.0 <23, npm e MongoDB. Consulta não exige chave Minha Receita ou Google.

```bash
npm install
cp .env.example .env
# Configure banco e administrador em segredo.
npm run seed
npm run build
npm start
```

```env
APP_ORIGIN=https://maximum-cnpj.vercel.app
MONGODB_URI=SUA_CONEXAO_PRIVADA
MONGODB_DB=maximum_cnpj
WORKSPACE_ID=maximum
```

Local: APP_ORIGIN=http://localhost:3000. Na Vercel, habilite exposição das variáveis de sistema quando usar os domínios automáticos. Domínio customizado exige APP_ORIGIN exata. ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD são para primeiro provisionamento; não publique valores reais. A senha precisa ter 12 a 128 caracteres e nenhuma conta existente é resetada.

`npm run dev` prepara os ativos. O build copia domain.js, lookup-domain.js e o leitor XLSX para public; nenhum segredo vai ao navegador. O leitor não depende de CDN durante uso. O lockfile deve ser versionado depois de uma instalação validada; não substituir npm install por npm ci sem lockfile válido.

Vercel mantém framework:null, saída public, função api/index.ts, segurança e roteamento /api/*. Assim preserva a correção anterior de `document is not defined`.

## 9. API nova

Sessão em /api/v4/*; escritas exigem origem/perfil. Cadastro por importação exige admin; consultas admin/operador; visualizador lê/exporta.

| Método / rota | Finalidade |
|---|---|
| GET /api/auth/session | Conta ou user:null antes do login |
| GET /api/v4/clients | Responsáveis e códigos |
| POST /api/v4/clients/import | Até 100 cadastros por parte |
| POST /api/v4/lookups | Criar consulta |
| POST /api/v4/lookups/:id/rows | Receber campos essenciais |
| POST /api/v4/lookups/:id/finalize | Consolidar identidades |
| POST /api/v4/lookups/:id/process | Próxima parcela de chamadas à API |
| POST /api/v4/lookups/:id/repeat | Reconsulta em novo lote |
| POST /api/v4/lookups/:id/cancel | Cancelar continuidade |
| GET /api/v4/lookups/:id | Estado e contagens |
| GET /api/v4/lookups/:id/results | Paginação e filtro de situação/CNPJ/nome |
| GET /api/v4/history | Histórico por responsável/CNPJ |
| GET /api/v4/dashboard | Indicadores de consultas completas |

As APIs legadas permanecem identificadas como dados declarados, não consulta fiscal nova.

## 10. Testes e validação

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npm run test:lookup-integration
npx playwright install chromium
npm run test:e2e
```

Localmente passaram 15 testes de domínio, segurança, origem e transporte simulado. Cobrem deduplicação sintética 10.001/50.000, nulos, identidade divergente, projeção mínima, ausência de cache, 429 e origens maliciosas. A sintaxe JavaScript também foi conferida. Isso não equivale a login real ou carga na produção.

A CI usa MongoDB descartável, legado, teste novo de compartilhamento/histórico, reconsulta e isolamento, e Chromium CSV/XLSX no painel novo e antigo. O browser intercepta a chamada externa: fixtures não vão ao provedor. Testes integrados usam banco aleatório, nunca credenciais de produção.

Após publicar em main, o smoke verifica sessão e login **sem credenciais**: domínio legítimo com JSON incompleto precisa retornar 400; origem externa precisa retornar 403. Isso verifica origem, não a senha de uma conta real. Há teste informativo separado com um CNPJ público da documentação da fonte; falha não é apresentada como aprovação nem negativa fiscal.

Confira o resultado associado ao SHA entregue. Existência de workflow não comprova sucesso. Deploy, CI, login real, base real e homologação fiscal são verificações distintas.

## 11. Diagnóstico

- ORIGIN/403: conferir APP_ORIGIN e domínios da Vercel; não liberar *.
- INVALID_LOGIN/401: conferir conta/senha e provisionamento; não há reset automático.
- 503: verificar MongoDB, rede e permissões. Não simular dados para esconder erro.
- CODE_CONFLICT/CNPJ_CONFLICT: código e documento apontam para registros distintos; corrigir sem sobrescrever.
- LIMITE_DA_FONTE/FONTE_INDISPONIVEL: respeitar pausa; não usar cache como atual.
- IDENTIDADE_DIVERGENTE: revisar fonte; fica não confirmado.

## 12. Versionamento e evolução

README, CHANGELOG, versão e testes acompanham toda mudança relevante. Sem force-push, sem apagar dados legados. Documentos antigos ficam em docs/archive e no Git; não representam requisitos atuais.

Prioridades seguintes: homologar amostras com fonte oficial, incorporar referência fiscal verificada, medir lote real, fila independente da aba e política de retenção. Busca nominal ambígua, automações e calculadora precisam de desenho/homologação próprios e não estão habilitadas.

## Referências técnicas

- Minha Receita: https://docs.minhareceita.org/como-usar/ e https://docs.minhareceita.org/dicionario/
- Vercel: https://vercel.com/docs/environment-variables/system-environment-variables

Documentação consultada em 28/09/2026. Gratuidade, disponibilidade e atualidade não são garantias permanentes.
