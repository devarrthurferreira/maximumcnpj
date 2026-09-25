# Maximum CNPJ · v0.2.0

**Central de consultas em lote, carteiras e indicadores do Simples Nacional.**

Uma base importada tem uma responsável. Um CNPJ válido tem uma identidade. Um indicador tem um denominador explícito. Um resultado tem fonte e referência temporal — e nunca é inventado quando a consulta falha.

| Controle | Situação |
|---|---|
| Versão do aplicativo | **0.2.0 — primeiro incremento funcional, em homologação** |
| Atualização deste documento | **24/09/2026** |
| Repositório | `devarrthurferreira/maximumCNPJ` |
| Stack | Node.js + TypeScript + MongoDB + interface web + BigQuery |
| Testes locais executados | **17 aprovados**, incluindo regras, carga sintética e HTTP; reexecutados antes desta publicação |
| Testes completos de banco, build e navegador | Workflow incluído; conferir o resultado da execução associada ao SHA deste commit |
| Consulta autenticada à base real | **Não homologada neste ambiente** |
| Entrega Git | Código-fonte, documentação, configurações e testes reunidos no primeiro commit funcional da v0.2.0 |
| Implantação pública | **Não realizada nesta entrega** |
| Calculadora tributária | **Planejada e bloqueada; nenhum cálculo fiscal implementado** |

> O código do primeiro incremento está implementado. Isso não equivale a uma homologação fiscal, a uma implantação pronta ou à validação do provedor no projeto Google Cloud do usuário. As consultas reais ficam bloqueadas até a configuração e a aprovação explícita da fonte.

### Estado da entrega

Este commit reúne o código-fonte da v0.2.0, a documentação atualizada e os testes. A primeira tentativa de publicação foi interrompida antes de criar um commit; após nova solicitação do responsável, a publicação foi retomada pelo conector autorizado, preservando o histórico e sem force-push. Consulte o histórico da branch `main` para identificar o SHA efetivamente publicado.

Publicação do código, aprovação da CI, homologação fiscal e implantação são etapas distintas. A workflow deve ser conferida na execução correspondente a este commit antes de marcar testes completos como aprovados. Os 17 testes locais, a checagem de versão e a sintaxe do frontend foram reexecutados em 24/09/2026. Consulte também `docs/entrega-v0.2.0.md`.

As quatro capturas PNG de demonstração e o manifesto SHA256 do pacote original são materiais suplementares disponíveis no ZIP entregue na conversa; não integram este commit de código-fonte. A documentação deste repositório foi atualizada depois da geração daquele pacote.

## 1. O que mudou desde o planejamento

O plano original v0.1.0 propunha uma ferramenta sem banco próprio. O novo escopo solicitado inclui empresas/carteiras, consultas salvas, indicadores e acompanhamento futuro. Por isso, esta versão usa **MongoDB para os dados da aplicação**. A base pública completa da Receita não é copiada para o MongoDB: armazenamos as linhas importadas e as observações retornadas para os CNPJs dessas bases.

O planejamento anterior foi preservado integralmente em [`docs/planejamento-v0.1.0.md`](docs/planejamento-v0.1.0.md). Ele é um registro histórico, não a configuração vigente. A decisão de persistência está detalhada em [`docs/arquitetura.md`](docs/arquitetura.md).

A referência visual solicitada foi o projeto Loanza no Behance. O endereço respondeu com bloqueio de acesso na consulta realizada; portanto, não houve verificação fiel da arte original. A interface entregue é uma composição própria: tema claro, tons violeta, navegação lateral, cartões, gráficos, tabelas e assistente de importação. Nenhuma imagem do Behance foi copiada.

## 2. Módulos desta versão

| Módulo | Implementação |
|---|---|
| Login | Senhas com scrypt, sessão no servidor, cookie HttpOnly, expiração e logout |
| Equipe | Perfis administrador, operador e visualizador; criação de acessos com troca obrigatória de senha |
| Empresas e carteiras | Cadastro, edição, observações, CNPJ responsável opcional e arquivamento |
| Importação | CSV/XLSX, seleção de aba, cabeçalho e colunas; leitura em Web Worker |
| Revisão | CNPJs únicos, repetições, inválidos, células numéricas e prévia das inconsistências |
| Upload | Partes limitadas por linhas e bytes, validação no servidor e reenvio idempotente |
| Consultas | Estimativa, confirmação, job BigQuery, retomada, paginação e cancelamento |
| Indicadores | Última observação por CNPJ único; percentuais de optantes, não optantes e não confirmados |
| Resultados | Paginação, busca por nome/CNPJ, filtro de enquadramento e exportação CSV/XLSX |
| Histórico | Snapshots de lotes concluídos, com carteira, totais, percentuais e data |
| Configurações | Fonte, limite por consulta, referência publicada, conta e auditoria |
| Ajuda | Guia no painel sobre fluxo, denominadores, custos e interpretação |
| Calculadora | Tela de evolução, sem botão que simule cálculos não implementados |
| Demonstração | Dados fictícios isolados do backend, com faixa de aviso persistente |

**Não estão implementados:** consulta oficial em tempo real, consulta em massa ao portal com CAPTCHA, agendamento automático, alertas de mudança, comparação individual entre dois snapshots, múltiplos workspaces administráveis na interface, recuperação de senha por e-mail, MFA, painel de revogação/edição de usuários, exclusão definitiva de bases pelo painel, engine de impostos, emissão fiscal ou cobrança.

A interface tem navegação recolhível no desktop, menu lateral no celular, estados de erro e de carregamento, foco visível e respeito à preferência de movimento reduzido. Não há dependência de fontes ou bibliotecas carregadas de CDN durante o uso; o leitor XLSX é copiado para `public/vendor` no build.

## 3. Fluxo do usuário

```text
Login
  ↓
Cadastrar / escolher empresa ou carteira responsável pela base
  ↓
Selecionar CSV ou XLSX → aba → cabeçalho → colunas
  ↓
Revisar únicos, repetidos, inválidos e avisos
  ↓
Confirmar o armazenamento das linhas e criar o lote
  ↓
Estimar consumo do BigQuery (dry run)
  ↓
Confirmar a consulta dentro do teto configurado
  ↓
Executar job → receber páginas → reconciliar identidades e totais
  ↓
Publicar o snapshot completo nos indicadores
  ↓
Filtrar, exportar e acompanhar o histórico
```

A pergunta **“De qual empresa ou carteira é esta base?” é obrigatória antes de confirmar a importação**. O CNPJ da responsável, quando cadastrado, não substitui os CNPJs das linhas nem é inserido silenciosamente na consulta.

Uma carteira pode representar, por exemplo, a lista de fornecedores de um cliente, um grupo comercial ou uma carteira de empresas do escritório. O filtro do cabeçalho seleciona a carteira nos indicadores e na listagem de lotes.

## 4. Identidade e duplicidade

A identidade canônica é o **CNPJ completo de 14 caracteres**, em maiúsculas e sem máscara. Matriz e filial com CNPJs completos diferentes continuam distintas: não fazemos deduplicação pelo CNPJ básico de oito posições.

A normalização aceita o formato numérico e o formato alfanumérico, verifica os dígitos pelo algoritmo de módulo 11 e não completa zeros perdidos por suposição. A referência oficial do CNPJ alfanumérico está no portal da Receita Federal.[^cnpj]

| Contexto | Regra |
|---|---|
| Linhas de origem | Todas as linhas importadas são preservadas, inclusive repetições e inválidos |
| Consulta do lote | Somente CNPJs válidos e distintos |
| Indicadores do lote | Uma observação por CNPJ válido distinto |
| Indicadores gerais | Última observação de cada CNPJ entre os lotes concluídos |
| Filtro por carteira | Última observação de cada CNPJ nos lotes concluídos daquela carteira |
| Histórico | Cada snapshot continua preservado; reimportar não apaga o anterior |

**Exemplo:** 12.000 linhas, 500 inválidas e 1.500 repetições válidas representam 10.000 CNPJs consultáveis. O denominador do lote é 10.000, não 12.000. Ao reimportar os mesmos CNPJs, eles não são somados novamente ao indicador global.

Na comparação entre carteiras, o mesmo CNPJ pode aparecer legitimamente em duas delas. O total global não é a soma cega dos totais das carteiras.

## 5. Indicadores e classificação

| Resultado | Condição |
|---|---|
| **Optante** | Indicador explicitamente positivo em uma linha única da fonte, sem conflito |
| **Não optante** | Indicador explicitamente negativo em uma linha única da fonte, sem conflito |
| **Não confirmado** | Ausência, valor desconhecido, duplicidade na fonte ou informação conflitante |
| **Inválido** | Documento não passa pela validação de entrada; não é consultado |

Uma falha do provedor deixa o lote em erro ou aguardando retomada. **Não cria resultados negativos.** Resultados parciais não são publicados nos indicadores.

As três porcentagens usam o total de CNPJs válidos únicos. A cobertura é `(optantes + não optantes) / total`. MEI é contado apenas entre os optantes, como subconjunto, nunca como uma quarta categoria somada às demais. Com denominador zero, os percentuais são exibidos como zero e o painel informa a ausência de consultas; isso não significa que todas as empresas sejam não optantes. Arredondamentos de duas casas podem produzir soma de 99,99% ou 100,01%.

Os snapshots registram o que a fonte retornou na consulta. A última consulta pode usar uma base fiscal mais antiga que outra consulta anterior; a data da observação não substitui a referência publicada. A tela do lote informa fonte e referência e alerta sobre defasagem configurada quando ela pode ser calculada.

## 6. Importação e proteção de dados de origem

| Limite | Valor |
|---|---|
| Arquivo | CSV ou XLSX; até 10 MiB |
| Linhas de dados | De 1 a 50.000 |
| Colunas | Até 80 |
| Conteúdo por célula | Até 2.000 caracteres |
| Cabeçalho | Até 200 caracteres por coluna |
| Parte enviada ao servidor | Até 250 linhas e aproximadamente 2 MB pelo cliente |
| Corpo JSON aceito pelo servidor | Até 2.800.000 bytes |
| Pré-voo XLSX | Até 100 MiB de expansão declarada e 10.000 entradas ZIP |
| Leitura no Worker | Interrompida pelo cliente após 45 segundos |

O arquivo original não é enviado como anexo. Após a confirmação, **os valores de todas as colunas importadas** são enviados em partes e persistidos para permitir exportação e auditoria. Remova colunas desnecessárias ou sensíveis antes de importar. O sistema não envia apenas os CNPJs ao seu próprio backend; apenas a lista deduplicada de CNPJs é enviada ao BigQuery.

As linhas totalmente vazias são ignoradas pelo leitor. Os índices mostrados na revisão são da sequência de dados importados, não uma garantia do número físico original da linha na planilha. A primeira versão não guarda o arquivo XLSX/CSV original em Blob.

Células numéricas geram aviso. Se o Excel já retirou um zero, não é possível reconstruir com certeza o identificador original; corrija pela fonte da informação. Fórmulas são marcadas como `[FORMULA_NAO_SUPORTADA]`; converta-as em valores antes de importar. Macros, arquivos protegidos e vínculos externos em XLSX são recusados no pré-voo. Essa inspeção é preventiva, não uma garantia absoluta contra todo arquivo compactado malicioso.

O CSV aceita ponto e vírgula, vírgula ou tabulação detectados na primeira linha, aspas e quebras de linha dentro de células. Para arquivos com formato atípico, reexporte com cabeçalho simples e ponto e vírgula. A leitura oferece UTF-8 e Windows-1252.

Na exportação, todas as linhas originais reaparecem, com as colunas de diagnóstico acrescentadas. O CSV neutraliza células potencialmente interpretadas como fórmula. O XLSX escreve valores como texto, preservando zeros e impedindo que conteúdo importado seja tratado como fórmula.

## 7. Arquitetura

```text
Navegador
  ├─ interface HTML / CSS / JavaScript
  ├─ Worker de leitura e exportação CSV/XLSX
  └─ API autenticada, em partes e páginas
          ↓
Node.js / TypeScript
  ├─ validação, autorização, sessões e limites
  ├─ orquestração persistida do lote
  ├─ estimativa e controle de consumo
  └─ adaptador BigQuery / Google Auth
       ↙                  ↘
MongoDB                 BigQuery
carteiras               consulta por ARRAY<STRING>
linhas                  join com base pública
lotes e checkpoints     job com ID reaproveitável
observações             resultados paginados
usuários e auditoria
```

O banco é obrigatório no ambiente real. O modo de demonstração (`/?demo=1`) não usa o MongoDB e não consulta CNPJs reais. Seu conjunto de dados é fixo, fictício e identificado visualmente.

Uma instalação atende um workspace definido por `WORKSPACE_ID`. As coleções são filtradas pelo workspace no servidor. Dentro dele, usuários autorizados compartilham as carteiras; **não há isolamento privado de carteiras por usuário nesta versão**.

### Estrutura principal

```text
api/index.ts                  Entrada para Vercel
src/domain.ts                 Identidade, classificação, indicadores e CSV
src/security.ts               Senhas, tokens, validação e erros
src/store.ts                  Conexão MongoDB e índices
src/provider.ts               Adaptador BigQuery e contrato de consulta
src/service.ts                Carteiras, lotes, estados, snapshots e exportação
src/server.ts                 API HTTP, autenticação, autorização e arquivos públicos
public/app.js                 Interface e fluxos
public/styles.css             Sistema visual responsivo
public/import-worker.js       Leitura e exportação fora da thread visual
public/demo.js                Fixtures isoladas; sem chamadas fiscais
scripts/seed.ts               Provisionamento do primeiro administrador
scripts/verify-source.ts      Inspeção autenticada de metadados da fonte
scripts/check-release.mjs     Consistência de versão e README
scripts/assets.mjs            Cópia dos ativos no build
tests/                        Regras, HTTP, integração e navegador
.github/workflows/ci.yml       Pipeline de verificação
AGENTS.md                     Regras para as próximas implementações
CHANGELOG.md                  Histórico de versões
```

## 8. Modelo persistido e estados

As coleções são `users`, `sessions`, `limits`, `clients`, `batches`, `rows`, `chunks`, `results` e `audit`.

Há índices únicos para usuário/e-mail/workspace, CNPJ da responsável quando informado, linha por lote/índice e resultado por lote/CNPJ. Sessões e contadores temporários usam TTL. A validade de sessão também é verificada na leitura, sem depender do instante em que o MongoDB remove um documento expirado.

```text
UPLOADING → READY → ESTIMATED → STARTING → RUNNING → FETCHING → COMPLETED
    └─ INVALID                         └─────────────── FAILED
Estados não concluídos ────────────────────────────── CANCELLED
```

`STARTING` é persistido antes da chamada de criação do job. O mesmo `jobId` é reaproveitado após uma resposta incerta; uma colisão devolvida pelo BigQuery leva à leitura do job existente, não à criação de outra consulta.

Cada operação crítica adquire um lease temporário no lote. Partes têm hash de conteúdo, e resultados são gravados por chave única. Antes de concluir, o servidor confere a quantidade de CNPJs esperada e que os identificadores recebidos pertencem ao lote. O dashboard só inclui observações cujo lote está em `COMPLETED`.

### Retomada e cancelamento

- **Durante o upload:** um envio interrompido pode ser retomado na mesma tela/sessão do navegador. Se o arquivo for perdido ao fechar ou recarregar a página, cancele o lote parcial e reimporte; seleção do arquivo para retomar em outra sessão fica para uma próxima versão.
- **Durante a consulta:** o job fica no BigQuery e o identificador está no MongoDB. Reabra o lote para retomar.
- **Durante a paginação:** o checkpoint é salvo. O recebimento continua enquanto um operador abre/atualiza o lote. Não existe worker ou cron autônomo da aplicação nesta versão.
- **Cancelamento:** o sistema solicita o cancelamento do job e exclui o lote dos indicadores. Cancelamento não garante estorno de processamento já consumido.

O progresso informa etapas reais. A execução do SQL não exibe um percentual inventado por CNPJ. Na recepção dos resultados, a contagem corresponde às observações efetivamente recebidas.

## 9. BigQuery e fonte pública

A documentação do OpenCNPJ orienta análises e cruzamentos de listas grandes pelas tabelas do BigQuery.[^open-analytics] A referência inicial do adaptador é:

```text
opencnpj-bigquery.public.receita
```

O adaptador requer campos planos: `cnpj`, `razao_social`, `opcao_simples`, `opcao_mei`, `data_opcao_simples` e `data_opcao_mei`. O campo CNPJ deve ser `STRING`. Schema, localização e versão técnica da tabela são conferidos antes da estimativa; divergências bloqueiam a consulta. A documentação publicada da fonte menciona esses dados, mas **isso não dispensa verificar a tabela efetivamente acessível no projeto do usuário**.[^open-schema]

O lote é enviado como um parâmetro nomeado `ARRAY<STRING>` e cruzado com a fonte em uma consulta SQL. Não são feitas 10 mil chamadas individuais. A resposta é paginada, portanto uma importação única não equivale a uma única resposta HTTP contendo todos os resultados.

O primeiro passo é `dryRun`. A aplicação apresenta bytes estimados e aplica `maximumBytesBilled` na consulta real. Ambos são mecanismos documentados do BigQuery.[^bq-jobs] Uma estimativa expira em 15 minutos; alteração de configuração ou da versão da tabela exige nova estimativa antes de uma execução nova.

### Homologação obrigatória

1. Confirmar projeto, credencial e acesso à tabela pública.
2. Executar `npm run verify:source` e conferir schema, localização e metadados.
3. Confirmar os valores reais que representam positivo, negativo e desconhecido; ajustar `BQ_FLAG_TRUE` e `BQ_FLAG_FALSE`.
4. Confirmar a referência fiscal publicada e preencher `BQ_SOURCE_REFERENCE_DATE`, quando identificável.
5. Configurar um teto de bytes coerente, quotas e orçamento no projeto.
6. Comparar uma amostra de controle com a fonte oficial, incluindo positivo, negativo, MEI, ausente e alteração recente.
7. Somente depois, definir `BQ_SOURCE_APPROVED=true`.
8. Homologar um lote real de **mais de 10.000 CNPJs válidos distintos**, verificando consumo, paginação e exportação.

`verify:source` lê metadados. Ele não executa uma consulta fiscal, não valida sozinho os valores dos indicadores e não ativa a fonte automaticamente. A localização pode ser descoberta sem preencher `BQ_LOCATION`; ela é obrigatória antes de estimar/executar uma consulta.

A data técnica de alteração de uma tabela (`lastModifiedTime`) não é apresentada como data de atualização fiscal. O etag ajuda a detectar mudança da tabela entre a estimativa e a execução, não comprova a atualidade do enquadramento.

## 10. Gratuidade e consumo

O BigQuery publica uma franquia de processamento por mês, e o consumo depende dos dados processados, não apenas do número de linhas retornadas. A situação da conta, as modalidades de cobrança, as quotas e o uso de outras consultas precisam ser verificados no projeto.[^bq-pricing][^bq-sandbox]

**Esta aplicação não promete custo zero, dados ilimitados ou uma franquia exclusiva de 10 mil CNPJs.**

O teto por consulta não equivale ao orçamento mensal. Para operação controlada, configure quotas do projeto, alertas de orçamento e limites coerentes. Alertas de orçamento, isoladamente, não substituem um bloqueio técnico de gasto. Não habilite faturamento ou eleve limites apenas para contornar uma falha sem a aprovação do responsável.

São registrados a estimativa, o teto, os bytes processados e os bytes faturados quando o provedor os informa. Nenhuma consulta paga alternativa é ativada automaticamente em caso de erro.

## 11. Ambiente e instalação

### Requisitos

Node.js compatível com `>=22.16.0 <25`, npm, MongoDB acessível pelo servidor e um projeto Google Cloud com acesso adequado ao BigQuery para as consultas reais. Use uma versão suportada e corrigida do Node em produção, dentro desse intervalo.

```bash
npm install
cp .env.example .env
# Preencher MongoDB, APP_ORIGIN e dados do administrador no .env.
npm run seed
npm run build
npm start
```

Abra `http://localhost:3000`. A interface demonstrativa fica em `http://localhost:3000/?demo=1`.

**Não existe senha padrão.** `npm run seed` exige uma senha com 12 a 128 caracteres e se recusa a alterar contas existentes. Depois do provisionamento, remova `ADMIN_PASSWORD` do ambiente. Não deixe essa senha em logs, commits ou arquivos compartilhados.

Para desenvolvimento:

```bash
npm run dev
```

O comando prepara os ativos e inicia o servidor observando os arquivos TypeScript. Alterações no domínio compartilhado com o navegador exigem novo build para atualizar `public/domain.js`. CSS e JavaScript públicos são lidos diretamente do diretório `public`.

Nesta entrega inicial, `npm install` é o procedimento documentado. O lockfile gerado deve ser validado e versionado assim que a instalação completa for executada; não substitua automaticamente por `npm ci` antes de existir um `package-lock.json` válido no commit.

### Variáveis de ambiente

| Variável | Finalidade |
|---|---|
| `PORT` | Porta do servidor Node; padrão 3000 |
| `APP_ORIGIN` | Origem exata da aplicação, sem barra final; HTTPS em produção |
| `MONGODB_URI` | String de conexão privada do servidor |
| `MONGODB_DB` | Banco da aplicação |
| `WORKSPACE_ID` | Identificador da instalação/workspace |
| `ADMIN_NAME` | Nome do primeiro administrador, apenas no provisionamento |
| `ADMIN_EMAIL` | E-mail do primeiro administrador |
| `ADMIN_PASSWORD` | Senha inicial temporariamente no ambiente de provisionamento |
| `GOOGLE_CLOUD_PROJECT` | Projeto que executa e controla o consumo dos jobs |
| `GOOGLE_APPLICATION_CREDENTIALS` | Caminho de credencial local; alternativa a ADC do ambiente |
| `GOOGLE_CREDENTIALS_JSON` | Alternativa de segredo JSON somente no servidor |
| `BQ_SOURCE_TABLE` | Referência completa da tabela pública |
| `BQ_LOCATION` | Localização real do dataset, conferida nos metadados |
| `BQ_MAXIMUM_BYTES_BILLED` | Teto obrigatório de bytes por consulta |
| `BQ_SOURCE_REFERENCE_DATE` | Data fiscal/publicada verificada, no formato YYYY-MM-DD |
| `BQ_FLAG_TRUE` / `BQ_FLAG_FALSE` | Arrays JSON explícitos de indicadores; sem sobreposição |
| `BQ_SOURCE_APPROVED` | `false` por padrão; liberação manual após homologação |
| `SOURCE_MAX_AGE_DAYS` | Limiar de aviso para referência antiga; padrão 60 |
| `NODE_ENV` | `production` para cookie seguro e exigência de HTTPS no servidor |

Nunca crie variáveis públicas de frontend para credenciais. Prefira identidade do ambiente/ADC quando suportada pela hospedagem. Ao usar conta de serviço, conceda apenas os acessos necessários a jobs no projeto de execução e leitura da fonte; não use uma conta proprietária do projeto como atalho.[^google-auth]

## 12. Implantação

### Servidor Node

Instale dependências, configure segredos, execute o provisionamento uma única vez, faça o build e inicie com `npm start`. Use HTTPS, supervisão do processo, MongoDB com acesso restrito, backups e monitoramento.

A rota `/api/health` confirma que o processo HTTP está ativo. Ela **não comprova** conexão com o MongoDB nem acesso à fonte. Faça também um login real e um lote de homologação antes de considerar a implantação operacional.

### Vercel

Há um adaptador `api/index.ts` e um `vercel.json` com build, arquivos públicos e encaminhamento de `/api/*`. Essa configuração foi preparada, **não publicada nem homologada na Vercel nesta entrega**.

Configure as mesmas variáveis privadas no projeto, use MongoDB externo e mantenha `APP_ORIGIN` igual ao domínio do ambiente. Uma URL de preview diferente exige configuração correspondente; o controle de origem não libera todos os previews por curinga. O processamento do SQL acontece no BigQuery, e a função HTTP só inicia ou acompanha o job.

Uploads e exportações são divididos para reduzir o tamanho por requisição/resposta. Ainda é necessário medir tempo, memória, limite de corpo e concorrência no plano real antes de homologar 50.000 linhas em produção. O parâmetro de duração do arquivo de implantação não elimina todos os limites do provedor.

## 13. API interna

Todas as rotas, exceto saúde e login, exigem sessão. Alterações exigem origem autorizada e JSON. Operações de escrita em carteiras/lotes exigem administrador ou operador.

| Método e rota | Uso |
|---|---|
| `GET /api/health` | Versão e saúde do processo HTTP |
| `POST /api/auth/login` | Criar sessão |
| `GET /api/auth/me` | Usuário autenticado |
| `POST /api/auth/logout` | Encerrar sessão |
| `POST /api/auth/password` | Alterar senha e revogar as sessões do usuário |
| `GET /api/dashboard?clientId=` | Indicadores e lotes recentes |
| `GET /api/clients` | Carteiras da instalação; limite atual de 1.000 |
| `POST /api/clients` | Cadastrar carteira |
| `PATCH /api/clients/:id` | Editar ou arquivar carteira |
| `POST /api/batches` | Criar lote com responsável, colunas e tamanho esperado |
| `POST /api/batches/:id/rows` | Enviar uma parte idempotente |
| `POST /api/batches/:id/finalize` | Conferir upload e validar o lote |
| `POST /api/batches/:id/estimate` | Inspecionar fonte e estimar consumo |
| `POST /api/batches/:id/start` | Confirmar estimativa e iniciar/retomar job |
| `POST /api/batches/:id/advance` | Consultar job e receber a próxima página |
| `POST /api/batches/:id/cancel` | Solicitar cancelamento |
| `GET /api/batches?page=&clientId=` | Listar lotes; 30 por página |
| `GET /api/batches/:id` | Estado e metadados do lote |
| `GET /api/batches/:id/results?page=&status=&search=` | Resultados únicos; 50 por página |
| `GET /api/batches/:id/export?offset=` | Linhas originais e diagnóstico; página limitada por bytes |
| `GET /api/settings` | Estado não secreto da configuração |
| `GET/POST /api/users` | Listar/criar usuários; administrador |
| `GET /api/audit` | Últimos 100 eventos; administrador |

Os campos de formulário passam por validação explícita. Nomes de tabelas SQL não vêm do navegador. Buscas textuais no MongoDB são escapadas como texto literal. Não são aceitos operadores de consulta MongoDB enviados como campos de e-mail ou texto.

## 14. Segurança, acesso e retenção

Senhas recebem sal aleatório e scrypt. Tokens de sessão são aleatórios; apenas o hash é armazenado. Cookies são HttpOnly, SameSite=Strict, com duração de 12 horas e flag Secure em produção. A origem é conferida nas mutações. Há limites de tentativas de login e de operações de escrita e headers de proteção para conteúdo, enquadramento e permissões do navegador.

| Perfil | Capacidades |
|---|---|
| Administrador | Tudo do operador; criar acessos, listar equipe e auditoria |
| Operador | Cadastrar/editar carteiras, importar, estimar, confirmar, retomar e cancelar consultas |
| Visualizador | Ver indicadores, carteiras, lotes concluídos, histórico e exportações; alterar a própria senha |

A senha inicial de novos acessos exige redefinição. A alteração da própria senha encerra todas as sessões desse usuário. Recuperação por e-mail e MFA ficam pendentes. Até existir painel de revogação, um administrador do banco pode desativar uma conta definindo `active=false`; a API verifica esse campo a cada autenticação. Não apague documentos de usuário para preservar a referência de auditoria.

Dados importados e resultados **não expiram automaticamente** nesta versão. Antes de uso com dados reais, defina política de retenção, responsáveis, backups e procedimento de exclusão. A exportação de uma base não a remove do servidor. Carteiras arquivadas preservam histórico.

Esta é uma aplicação interna, não um proxy público e ilimitado de BigQuery. Não exponha o MongoDB sem proteção e não publique o `.env`, credenciais JSON, tokens ou uma senha de demonstração no ambiente real. A senha existente na workflow de CI pertence somente ao banco efêmero de testes, não cria acesso em produção.

## 15. Testes e evidências

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

`test:integration` exige MongoDB e usa um banco aleatório exclusivo, descartado ao final. O provedor BigQuery é simulado. **Nunca aponte um teste destrutivo para um banco de produção**; o nome aleatório protege o banco escolhido pelo teste, mas permissões também devem ser restritas.

Os testes E2E usam as contas e o banco de teste configurados no ambiente. A CI cria uma conta efêmera para isso, instala Chromium e testa navegação, CSV/XLSX, exportação e upload autenticado com a fonte bloqueada.

| Verificação | Evidência desta preparação |
|---|---|
| Regras de CNPJ e alfanumérico | Executadas e aprovadas |
| 10.001 CNPJs válidos distintos + repetido + inválido | Executado e aprovado no domínio |
| 50.000 linhas válidas distintas | Executado e aprovado no domínio, sem truncamento |
| Indicadores e classificação conservadora | Executados e aprovados |
| Senhas, tokens e validação | Executados e aprovados |
| Adaptador com transporte simulado | Dry run, limites, schema, job idempotente e paginação aprovados |
| HTTP sem MongoDB | Saúde, exigência de sessão, CSRF e proteção de arquivo `.env` aprovados |
| Total local | **17 testes aprovados; 0 falhas; reexecutados antes da publicação** |
| Interface em Chromium isolado | Inspeção da preparação anterior: 8 áreas verificadas, revisão CSV 4/2/1/1, resultados e layout de 390 px sem overflow; nenhum erro JavaScript observado |
| Build com todas as dependências | Pendente de confirmação na CI; não validado nesta publicação local |
| Integração MongoDB com mais de 10 mil CNPJs sintéticos | Teste implementado, dependente da CI/ambiente com MongoDB |
| XLSX e navegação HTTP completa em Chromium | Testes implementados; verificar resultado da CI |
| BigQuery autenticado com dados reais | **Não executado** |
| Homologação fiscal e produção | **Não executadas** |

A inspeção visual local da preparação anterior usou um harness offline com o código gerado, sem conexão a sistemas externos. Ela não substitui os testes de browser contra o servidor, nem a verificação do deploy. As medições sintéticas não garantem tempo de resposta para arquivos reais, rede, Google Cloud ou hospedagem.

O relatório de uma execução da CI corresponde ao SHA daquela execução. Não apresentar um resultado de outro commit como prova da versão atual. O artifact `maximum-verification` conserva relatórios, screenshots e o lockfile gerado por sete dias, quando as etapas correspondentes executam.

## 16. Versionamento e README vivo

Toda alteração relevante deve manter **README, CHANGELOG, versão e testes coerentes no mesmo commit/PR**. A regra está também em `AGENTS.md` e no template de pull request.

- Use commits descritivos: `feat`, `fix`, `docs`, `test`, `refactor` ou `chore`.
- Incremente a versão do aplicativo para cada nova entrega funcional; mantenha `package.json`, `src/domain.ts`, README e CHANGELOG alinhados.
- Descreva o que foi implementado, como testar, o que não foi testado, quais variáveis mudaram e quais pendências permanecem.
- Nunca transforme tarefa planejada em concluída por existir uma tela de placeholder.
- Não marque consulta real, homologação ou implantação como feitas sem evidência.
- Preserve compatibilidade dos snapshots e registre migrações antes de mudar o modelo persistido.

O script `check:release` compara versões e, na CI, exige alteração do README quando o último commit muda código funcional/configuração relevante. É uma verificação estrutural: revisão humana continua necessária para garantir que a documentação explique corretamente a mudança.

## 17. Plano de ação e próximas versões

As versões abaixo são marcos propostos, não promessas de datas. Ajuste o plano no README conforme as evidências de cada etapa.

| Etapa | Situação / entrega | Critério de conclusão |
|---|---|---|
| **v0.1.0 — planejamento** | Preservado | Escopo inicial e cuidados de consulta documentados |
| **v0.2.0 — fundação** | Código implementado; homologação em curso | Login, carteiras, importação, estados, indicadores, histórico e testes básicos |
| **v0.3.0 — fonte real** | Próxima prioridade | Schema e valores homologados; lote real >10.000; bytes medidos; exportação reconciliada |
| **v0.4.0 — evolução por CNPJ** | Planejada | Comparar snapshots de bases equivalentes; entradas/saídas observadas e alterações por identificador |
| **v0.5.0 — operação assistida** | Planejada | Retomada de upload entre sessões, fila independente do navegador, quotas agregadas e relatórios |
| **v0.6.0 — governança** | Planejada | MFA/recuperação, gestão completa de acessos, retenção, exclusão, backups e restauração ensaiada |
| **v1.0.0 — operação homologada** | Planejada | SLOs, testes de carga reais, segurança revisada e implantação observada |
| **Motor tributário** | Planejado, sem versão fiscal ativa | Fontes normativas, competência, regras versionadas e homologação contábil própria |

### Próxima sessão de implementação

1. Ler este README, o CHANGELOG e o estado real do repositório antes de alterar código; confirmar o SHA publicado na branch.
2. Conferir a CI correspondente e resolver qualquer falha antes de avançar.
3. Versionar o lockfile resultante de uma instalação validada.
4. Configurar um ambiente de homologação com MongoDB e projeto Google Cloud autorizado.
5. Registrar schema, localização, referência, codificação dos indicadores e consumo real da consulta.
6. Importar uma base de controle, conferir todos os resultados e exportações e registrar as divergências.
7. Atualizar este README com evidências e status, sem apagar as limitações ainda existentes.

## 18. Preparação da calculadora tributária

A preparação desta versão é **estrutural**: identidade única, carteira, observações datadas e histórico auditável. Não existe ainda uma engine de cálculo, uma tabela de alíquotas ou um simulador válido para a reforma tributária.

Antes de habilitar o módulo será necessário especificar receitas e segregações por competência, dados de atividade, parâmetros complementares, base normativa, vigência de regras, arredondamentos, memória de cálculo e tratamento de exceções. O estado “optante pelo Simples” não determina sozinho um cálculo tributário correto.

A proposta de contrato está em [`docs/calculadora-tributaria.md`](docs/calculadora-tributaria.md). Taxas e regras não serão extraídas de valores ilustrativos da interface ou de uma base pública de CNPJ. Cada conjunto de regras deverá ter versão, fonte, vigência e casos de teste revisados por responsável fiscal.

## 19. Diagnóstico operacional

| Sintoma | Verificação / ação |
|---|---|
| `DATABASE_NOT_CONFIGURED` ou 503 | Conferir `MONGODB_URI`, banco, rede, usuário e permissões; executar o provisionamento em ambiente correto |
| Login incorreto | Conferir e-mail/senha; não existe usuário público padrão |
| `ORIGIN` / 403 | Conferir `APP_ORIGIN`, protocolo e domínio exatos, sem barra final |
| `SOURCE_NOT_APPROVED` | Homologar a fonte antes de liberar `BQ_SOURCE_APPROVED` |
| `SOURCE_CONFIG` | Projeto, localização, teto e arrays de valores precisam estar corretos |
| `SOURCE_SCHEMA` | Campo ausente, tipo incompatível ou estrutura diferente; adaptar com testes antes de liberar |
| `SOURCE_LOCATION` | Usar a localização real do dataset, não presumir `US` |
| `ESTIMATE_EXPIRED` | Gerar nova estimativa e confirmar novamente |
| `BUDGET_LIMIT` | Revisar o desenho da consulta e o orçamento; não elevar automaticamente o teto |
| `BATCH_BUSY` | Aguardar a operação atual; o lease expira caso ela seja interrompida |
| `UPLOAD_OFFSET` | Retomar a próxima parte na ordem indicada, na mesma sessão de importação |
| `RESULT_COUNT` / `RESULT_IDENTITY` | Bloqueio de publicação; conferir fonte e paginação antes de retomar |
| `BIGQUERY_403` | Conferir acesso, APIs habilitadas e limites do projeto |
| XLSX indisponível | Executar o build e confirmar que os ativos do SheetJS foram copiados |
| Cabeçalho incorreto | Selecionar a linha correta; reexportar planilhas com células mescladas ou títulos extras |

A resposta de erro inclui um `requestId` para correlacionar a operação com logs. Logs HTTP não imprimem senha, credencial ou linhas completas importadas.

## 20. Checklist antes de produção

- [ ] Build, tipos, regras, integração e E2E aprovados no commit entregue.
- [ ] Lockfile versionado e dependências revisadas.
- [ ] MongoDB de produção com acesso restrito e política de backup/retenção aprovada.
- [ ] Administrador provisionado com senha forte; segredo de provisionamento removido.
- [ ] HTTPS, origem correta e sessão verificados no domínio real.
- [ ] Fonte, indicadores e referência homologados com evidência.
- [ ] Lote real >10.000 CNPJs reconciliado, incluindo inválidos, duplicados e ausentes.
- [ ] Limites de bytes, quotas e controle de consumo aprovados pelo responsável.
- [ ] Exportações conferidas sem perda de linhas e sem fórmulas executáveis.
- [ ] Procedimentos de falha, cancelamento, retomada, revogação de acesso e exclusão definidos.
- [ ] Tempo e memória medidos na hospedagem escolhida.
- [ ] README atualizado com o que de fato foi homologado e publicado.

## Referências técnicas

Os endereços abaixo fundamentam o desenho da integração, não comprovam que o ambiente do usuário já tenha sido configurado. Referências registradas no planejamento de 24/09/2026; esta publicação não é uma nova homologação externa.

[^open-analytics]: [OpenCNPJ — consultas analíticas e joins de listas](https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/pages/AnalyticsPage.tsx).
[^open-schema]: [OpenCNPJ — documentação dos datasets](https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/data/datasets.ts).
[^bq-jobs]: [Google Cloud — Jobs: insert](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/insert) e [Job resource / query configuration](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/Job).
[^bq-pricing]: [Google Cloud — BigQuery pricing](https://cloud.google.com/bigquery/pricing).
[^bq-sandbox]: [Google Cloud — BigQuery sandbox](https://docs.cloud.google.com/bigquery/docs/sandbox).
[^google-auth]: [Google Auth Library for Node.js](https://github.com/googleapis/google-auth-library-nodejs).
[^cnpj]: [Receita Federal — CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/carrossel/cnpj-tera-letras-e-numeros-a-partir-de-julho-de-2026).

Leitor de planilhas: [SheetJS CE, distribuição oficial e versão 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/). Licença do leitor é copiada no build. O código original deste repositório não recebeu uma licença de código aberto nesta entrega; o titular deve decidir a política de distribuição.
