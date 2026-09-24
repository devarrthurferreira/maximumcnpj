# Consulta de Simples Nacional em Lote

> Plano de ação para consultar mais de 10.000 CNPJs em uma única importação, identificar a opção pelo Simples Nacional conforme uma base pública e exportar os resultados, sem manter banco de dados próprio de empresas.

| Controle do documento | Informação |
| --- | --- |
| Versão do README | **0.1.0 — planejamento inicial** |
| Última atualização | **24/09/2026** |
| Status do projeto | **Planejado; implementação e homologação pendentes** |
| Arquitetura proposta | Interface web + backend Node.js + OpenCNPJ no Google BigQuery |
| Restrição principal | Priorizar operação gratuita dentro dos limites efetivamente disponíveis |
| Banco próprio | Não previsto no escopo inicial |
| Repositório / implantação | Ainda não definidos para este projeto |
| Regra de manutenção | Atualizar este README no mesmo commit ou PR de cada mudança relevante |

**Esta entrega contém o planejamento, não um sistema já implementado.** Rotas, pastas, configurações, testes e exemplos abaixo são especificações para desenvolvimento. Nenhuma consulta autenticada foi executada no projeto Google Cloud do usuário, nenhum lote real foi homologado e nenhum ambiente foi publicado nesta etapa.

---

## Sumário

1. [Objetivo e critérios de sucesso](#1-objetivo-e-critérios-de-sucesso)
2. [Decisões e limites do escopo](#2-decisões-e-limites-do-escopo)
3. [Fonte de dados e verificação inicial](#3-fonte-de-dados-e-verificação-inicial)
4. [Fluxo do usuário](#4-fluxo-do-usuário)
5. [Importação e validação dos CNPJs](#5-importação-e-validação-dos-cnpjs)
6. [Classificação dos resultados](#6-classificação-dos-resultados)
7. [Arquitetura sem banco próprio](#7-arquitetura-sem-banco-próprio)
8. [Processamento de mais de 10.000 registros](#8-processamento-de-mais-de-10000-registros)
9. [Contrato dos dados](#9-contrato-dos-dados)
10. [API interna planejada](#10-api-interna-planejada)
11. [Consulta SQL de referência](#11-consulta-sql-de-referência)
12. [Gratuidade e controle de consumo](#12-gratuidade-e-controle-de-consumo)
13. [Segurança e privacidade](#13-segurança-e-privacidade)
14. [Interface e exportação](#14-interface-e-exportação)
15. [Preparação do ambiente](#15-preparação-do-ambiente)
16. [Configurações planejadas](#16-configurações-planejadas)
17. [Estrutura prevista do projeto](#17-estrutura-prevista-do-projeto)
18. [Plano de ação por fases](#18-plano-de-ação-por-fases)
19. [Plano de testes e homologação](#19-plano-de-testes-e-homologação)
20. [Operação e tratamento de falhas](#20-operação-e-tratamento-de-falhas)
21. [Riscos e decisões pendentes](#21-riscos-e-decisões-pendentes)
22. [Regra de atualização deste README](#22-regra-de-atualização-deste-readme)
23. [Histórico de alterações e próxima entrega](#23-histórico-de-alterações-e-próxima-entrega)
24. [Referências técnicas](#24-referências-técnicas)

---

## 1. Objetivo e critérios de sucesso

Construir uma ferramenta em que o usuário selecione uma planilha de fornecedores, identifique as colunas de CNPJ e nome, execute uma consulta em lote e receba uma planilha com o resultado de cada linha original.

O produto deve responder:

- **É optante pelo Simples Nacional, conforme a base consultada?**
- **A informação foi explicitamente negativa ou apenas não pôde ser confirmada?**
- **Qual fonte e atualização sustentam o resultado?**

### Critérios de sucesso do primeiro produto funcional

| Critério | Condição de aceite |
| --- | --- |
| Volume | Homologar pelo menos **10.001 CNPJs válidos e distintos** no mesmo lote lógico |
| Meta adicional | Testar até **50.000 linhas por importação**, sem anunciar capacidade antes da medição |
| Integridade | Toda linha de entrada deve reaparecer no resultado, inclusive inválidos e duplicados |
| Correção | Nenhuma ausência, falha ou informação desconhecida pode virar “não optante” automaticamente |
| Rastreabilidade | Exibir fonte, horário da consulta e referência temporal da base, quando disponível |
| Usabilidade | Importação, acompanhamento e exportação pelo navegador |
| Custo | Estimar o consumo antes da execução e aplicar limites de infraestrutura e de consulta |
| Segurança | Não expor credenciais do Google Cloud nem permitir consulta a lotes de outro usuário |
| Documentação | Cada entrega deve atualizar escopo, status, testes e histórico deste README |

**Consultar o lote inteiro não significa confirmar todos os CNPJs.** Um processamento pode terminar corretamente e ainda conter registros “não confirmados”, que precisam ser apresentados como pendências.

## 2. Decisões e limites do escopo

### Decisões propostas para a primeira versão

| Tema | Decisão |
| --- | --- |
| Entrada | Arquivos `.xlsx` e `.csv`, com seleção de aba e mapeamento de colunas |
| Interface | HTML, CSS, JavaScript e Bootstrap; processamento pesado de planilhas em Web Worker |
| Backend | Node.js para autenticação, validação e integração com BigQuery |
| Motor de consulta | Cruzamento em lote com a base pública do OpenCNPJ |
| Banco próprio | Não utilizar MongoDB, SQLite, PostgreSQL ou Redis no escopo inicial |
| Arquivo original | Ler no navegador; não enviar a planilha inteira ao backend por padrão |
| Dados enviados | Somente CNPJs válidos, normalizados e deduplicados, além dos metadados técnicos necessários |
| Saída | XLSX e CSV, preservando os dados de origem |
| Acesso | Restrito a usuários autorizados; não disponibilizar um proxy público de consultas |
| Implantação | Hospedagem compatível com Node.js; fornecedor e plano ainda serão definidos |

**“Sem banco próprio” não significa “sem nenhum processamento ou armazenamento externo”.** O BigQuery é o serviço analítico externo. Seus resultados temporários e metadados de jobs existem segundo as regras do Google. O produto não manterá uma base própria permanente de fornecedores.[^bq-results]

A interface pode ser apresentada como uma página única. Porém, a integração de produção não será apenas um HTML com credenciais embutidas: o backend deve intermediar os acessos privilegiados.

### Fora do escopo inicial

Não fazem parte desta entrega: emissão de notas, cobrança, Asaas, OCR, inteligência artificial, cadastro permanente de clientes, histórico fiscal completo, agendamento recorrente, contorno de CAPTCHA ou consulta individual massiva ao portal oficial.

Também não será prometida informação em tempo real. O OpenCNPJ declara publicação em ciclos, e a página da base Receita Federal informa periodicidade mensal.[^open-faq][^open-schema]

## 3. Fonte de dados e verificação inicial

### Fonte proposta

O próprio OpenCNPJ orienta o uso do BigQuery para cruzamentos de listas e enriquecimento em lote, em vez de consultar a API CNPJ por CNPJ.[^open-analytics]

A documentação do fornecedor define atualmente a referência:

```text
Projeto: opencnpj-bigquery
Dataset: public
Tabela: receita
Referência completa: opencnpj-bigquery.public.receita
```

Esse endereço foi identificado no código público da documentação. **Ainda precisa ser verificado por acesso autenticado antes de ser considerado operacional neste projeto.**[^open-table]

### Campos de interesse

A documentação da base menciona `cnpj`, `razao_social`, `opcao_simples`, `data_opcao_simples`, `opcao_mei` e `data_opcao_mei`. O schema efetivo do BigQuery, os tipos e a codificação dos indicadores serão homologados na fase 0.[^open-schema]

**Não presumir que o formato da API JSON seja idêntico ao da tabela analítica.** Datas de exclusão não estão garantidas por este plano: somente serão incluídas se o schema real e a documentação da fonte as disponibilizarem.

### Verificação obrigatória antes do desenvolvimento completo

1. Confirmar acesso de leitura à tabela e obter a localização do dataset.
2. Inspecionar schema, tipos, campos disponíveis e metadados da tabela.
3. Identificar os valores reais que representam opção positiva, negativa e desconhecida.
4. Verificar a existência de duplicidade por CNPJ e de registros alfanuméricos.
5. Identificar a referência temporal publicada; não confundir alteração técnica da tabela com atualização fiscal.
6. Executar uma consulta pequena e um `dryRun` do desenho de lote.
7. Registrar evidências, consumo estimado, limitações e decisão de prosseguir.

Os métodos de metadados do BigQuery permitem inspecionar tabelas e datasets. A localização usada na consulta deve corresponder à dos dados consultados; não será fixada como `US` ou Brasil por suposição.[^bq-table][^bq-dataset][^bq-parameters]

**Condição de bloqueio:** sem acesso, sem campo confiável de opção ou sem uma política de consumo aceitável, a integração não deve ser anunciada como pronta. A alternativa deve ser discutida e documentada, sem mudar silenciosamente para um serviço pago.

## 4. Fluxo do usuário

```text
Selecionar planilha
      ↓
Escolher aba, coluna de CNPJ e coluna de nome
      ↓
Visualizar prévia e corrigir mapeamento
      ↓
Normalizar, validar e identificar duplicados
      ↓
Apresentar totais e estimativa de consumo
      ↓
Confirmar a consulta do lote
      ↓
Criar job no BigQuery e acompanhar seu estado
      ↓
Receber todas as páginas do resultado
      ↓
Reconciliar os resultados com as linhas originais
      ↓
Filtrar, revisar pendências e exportar XLSX/CSV
```

O usuário deve poder excluir a importação antes de consultar, corrigir o mapeamento sem reenviar o arquivo e exportar uma prévia de inconsistências.

O progresso será verdadeiro: leitura da planilha, validação, consulta em execução, recebimento de resultados e preparação da exportação. Durante a execução do SQL, não inventar um percentual de “CNPJs já consultados” que o provedor não forneça.

## 5. Importação e validação dos CNPJs

### Regras de leitura

Preservar, por linha: arquivo, aba, número original da linha, nome informado, CNPJ original e CNPJ normalizado. Não alterar o arquivo de origem.

A coluna de CNPJ será tratada como **texto**. Células numéricas, notação científica e perda aparente de zeros devem gerar aviso ou pendência; não completar zeros automaticamente sem uma regra explícita de recuperação e confirmação do usuário.

A importação deverá aceitar separadores comuns de CSV, apresentar a codificação detectada e permitir correção quando houver caracteres ilegíveis. Fórmulas, macros e links externos não serão executados pelo importador.

### CNPJ numérico e alfanumérico

A Receita Federal já prevê o formato alfanumérico para novas inscrições, mantendo válidos os CNPJs anteriores. O validador deve contemplar os dois formatos.[^rfb-cnpj]

Regras de implementação:

- Remover apenas máscara e espaços permitidos; preservar letras válidas e convertê-las para maiúsculas.
- Validar estrutura de 14 caracteres e dígitos verificadores segundo a especificação oficial.
- Rejeitar caracteres estranhos, sequências proibidas e documentos com tamanho incorreto.
- Não usar `replace(/\D/g, '')`, pois apagaria letras de um CNPJ alfanumérico.
- Não converter documentos com `Number`, `parseInt` ou armazenamento numérico.
- Revalidar os CNPJs no backend; validação do navegador não é uma fronteira de segurança.

Uma verificação de formato ou dígito verificador não comprova que a empresa existe. A existência na base é uma etapa separada.

### Duplicidade e reconciliação

Consultar cada CNPJ válido e distinto uma vez dentro do lote. Depois, reaplicar o resultado a todas as linhas de origem correspondentes, mantendo sua ordem e seus nomes originais.

Filiais diferentes não serão descartadas apenas por compartilharem a raiz. A chave principal do cruzamento será o CNPJ completo. Não procurar uma empresa pelo nome para preencher o resultado de um documento inválido.

Registros inválidos permanecerão na exportação como “não confirmado”, acompanhados do motivo de validação. Um lote sem CNPJs válidos não deverá gerar consulta ao BigQuery.

## 6. Classificação dos resultados

### Situação fiscal apresentada pelo produto

| Valor interno | Texto na interface | Regra |
| --- | --- | --- |
| `OPTANTE` | Optante pelo Simples — conforme a base | Indicador positivo explícito e reconhecido pelo adaptador da fonte |
| `NAO_OPTANTE` | Não optante pelo Simples — conforme a base | Indicador negativo explícito e reconhecido pelo adaptador da fonte |
| `NAO_CONFIRMADO` | Não confirmado — revisar | Registro ausente, documento inválido, indicador desconhecido, conflito ou falha |

O adaptador manterá um mapa explícito de valores aceitos, versionado e testado. Não aplicar conversão genérica de “verdadeiro/falso”: textos como `"N"` também são valores verdadeiros em uma condição JavaScript ingênua.

### Qualidade e observações

Além da situação fiscal, o resultado terá motivos e avisos independentes:

| Código | Significado |
| --- | --- |
| `CNPJ_INVALIDO` | Falha de formato ou de dígito verificador |
| `NAO_ENCONTRADO` | CNPJ não localizado na base consultada |
| `CAMPO_AUSENTE` | Indicador necessário não disponibilizado |
| `VALOR_DESCONHECIDO` | Valor fora do mapeamento homologado |
| `CONFLITO_NA_FONTE` | Mais de um registro incompatível ou relação inconsistente |
| `FALHA_CONSULTA` | Não foi possível concluir a consulta |
| `BASE_DESATUALIZADA` | Referência temporal excedeu a política interna definida |
| `ATUALIZACAO_NAO_INFORMADA` | Não foi possível obter a referência temporal da base |
| `RESULTADO_INCOMPLETO` | Reconciliação ou paginação não finalizada |

Avisos de atualização não devem apagar o valor bruto da fonte. A tela deve deixar evidente que o indicador se refere à base consultada, sem transformá-lo em confirmação atual.

### Regras que não podem ser quebradas

Erro, campo vazio, `null`, ausência na base e HTTP 404 **não significam “não optante”**. “Não optante” também não autoriza classificar automaticamente a empresa como Lucro Real ou Lucro Presumido.

Simples Nacional, MEI e situação cadastral devem ser campos separados. Datas históricas isoladas não serão usadas para inventar a opção atual. Divergências entre indicadores serão encaminhadas à revisão, sem correção silenciosa.

Casos que exijam validação diretamente no portal devem oferecer acesso à Consulta Optantes oficial. O sistema não emitirá um comprovante oficial da Receita nem apresentará seu relatório como equivalente a esse comprovante.[^rfb-optantes]

## 7. Arquitetura sem banco próprio

```text
NAVEGADOR
  HTML / CSS / JavaScript / Bootstrap
  Importação e exportação em Web Worker
  Linhas originais mantidas localmente durante a sessão
              │
              │ HTTPS: CNPJs normalizados + sessão autenticada
              ▼
BACKEND NODE.JS
  Autorização e validação
  Verificação da fonte e prévia de consumo
  SQL fixo com parâmetros
  Emissão e verificação de comprovantes técnicos assinados do lote
              │
              │ Identidade de serviço, sem credenciais no navegador
              ▼
GOOGLE BIGQUERY
  Job de consulta
  Leitura da tabela pública do OpenCNPJ
  Resultados temporários e paginação
              │
              ▼
BACKEND → NAVEGADOR → RECONCILIAÇÃO → XLSX / CSV
```

### Responsabilidades

**Navegador:** importar, validar preliminarmente, mostrar a prévia, acompanhar o lote, reconstruir as linhas originais e exportar. Usar paginação ou virtualização visual, em vez de renderizar milhares de linhas simultaneamente.

**Backend:** autenticar, autorizar, impor limites, validar novamente, construir parâmetros, criar jobs, verificar erros e disponibilizar páginas somente ao dono do lote.

**BigQuery:** executar o processamento analítico. A função HTTP não deverá permanecer aberta aguardando todo o lote: ela cria o job, responde e permite consultas posteriores de estado.[^bq-jobs][^bq-insert]

### Estado e retenção

Não depender da memória de uma única instância Node.js para manter o processamento. O identificador do job, a localização e um token assinado vinculado ao usuário permitirão consultar seu estado.

O arquivo e os resultados montados permanecerão na memória do navegador por padrão. Fechar a página pode perder essa montagem local; o aviso deve aparecer antes da saída. Uma recuperação na mesma sessão poderá usar identificadores temporários e a reseleção da mesma planilha, validada por hash, sem armazenar a planilha no servidor.

O BigQuery documenta resultados temporários por até 24 horas após a consulta. Isso não constitui histórico permanente nem garante recuperação ilimitada. Metadados de jobs têm tratamento próprio e não devem ser confundidos com a retenção das linhas do resultado.[^bq-results]

## 8. Processamento de mais de 10000 registros

### Estratégia principal

Enviar os CNPJs distintos em um parâmetro `ARRAY<STRING>` e cruzá-los com a tabela pública em uma consulta SQL. O objetivo é evitar tanto 10.000 chamadas individuais quanto 10.000 parâmetros escalares separados.[^bq-parameters]

O BigQuery documenta limite de 10 MB para a requisição, incluindo parâmetros. O limite é de bytes e estrutura, não uma garantia de que qualquer quantidade de CNPJs caberá. O tamanho serializado deverá ser medido antes do envio.[^bq-quotas]

### Limites iniciais propostos do produto

**Os valores abaixo são escolhas de engenharia para homologação, não limites oficiais nem capacidade comprovada.**

| Item | Proposta inicial |
| --- | --- |
| Linhas por arquivo | Até 50.000 |
| Arquivo de entrada | Até 25 MiB, lido localmente |
| Conteúdo expandido de XLSX | Até 100 MiB, com validação de recursos do parser |
| Corpo JSON da API interna | Até 1 MiB |
| CNPJs por job | Até 50.000, condicionado ao tamanho real do payload |
| Resultados por página interna | Até 1.000 registros, com limite adicional por bytes |
| Consultas simultâneas na interface | Uma por sessão |
| Consulta de estado | Intervalo inicial de 3 segundos, com recuo progressivo até 15 segundos |
| Repetições transitórias | Até 3 tentativas, com atraso progressivo e aleatoriedade |

A restrição da interface não substitui controles de abuso e cotas no servidor/infraestrutura. Um contador em memória local não garante limites globais entre várias instâncias.

Não dividir automaticamente um lote grande em milhares de pequenas consultas: cada divisão pode voltar a ler a base e aumentar o consumo. Acima dos limites homologados, rejeitar com explicação ou implementar uma estratégia nova com nova estimativa de custo. Não truncar entradas silenciosamente.

### Processamento e entrega são etapas diferentes

Um job pode processar o lote inteiro e devolver os dados em várias páginas. A leitura deve continuar conforme `pageToken`, sem presumir que a primeira resposta contenha tudo.[^bq-results-api]

Antes de marcar o lote como concluído, verificar contagens, ausência de páginas pendentes, cobertura de CNPJs e correspondência com todas as linhas originais.

## 9. Contrato dos dados

O contrato abaixo é **proposto**, não uma reprodução do schema do OpenCNPJ.

```ts
type SituacaoSimples = 'OPTANTE' | 'NAO_OPTANTE' | 'NAO_CONFIRMADO';

type LinhaImportada = {
  idLinha: string;
  arquivo: string;
  aba: string | null;
  numeroLinha: number;
  nomeInformado: string | null;
  cnpjOriginal: string;
  cnpjNormalizado: string | null;
  valido: boolean;
  motivoValidacao: string | null;
};

type ResultadoConsulta = {
  cnpj: string;
  encontradoNaBase: boolean;
  razaoSocial: string | null;
  situacaoSimples: SituacaoSimples;
  opcaoSimplesOriginal: string | boolean | null;
  dataOpcaoSimples: string | null;
  opcaoMei: boolean | null;
  dataOpcaoMei: string | null;
  motivos: string[];
  avisos: string[];
  fonte: string;
  tabelaFonte: string;
  referenciaBase: string | null;
  dataReferenciaBase: string | null;
  modificacaoTecnicaTabela: string | null;
  consultadoEmUtc: string;
  versaoAdaptador: string;
};
```

### Regras do contrato

Datas de opção usarão `YYYY-MM-DD`, quando válidas. Horários técnicos usarão ISO 8601 em UTC, com apresentação também em `America/Sao_Paulo`. Valores não conhecidos serão `null`, não strings inventadas como “hoje”.

`consultadoEmUtc` é o horário da consulta. `dataReferenciaBase` é a referência fiscal/publicada, quando identificável. `modificacaoTecnicaTabela` é um metadado técnico e não substitui a referência fiscal.

Não enviar nomes internos de fornecedores ao BigQuery sem necessidade. A correspondência entre os nomes da planilha e os resultados poderá ser feita no navegador.

## 10. API interna planejada

**Estas rotas ainda não existem.** Os caminhos abaixo orientarão a implementação.

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/health` | Informar disponibilidade básica, sem segredos |
| `GET` | `/api/source` | Exibir metadados e capacidades da fonte para usuário autenticado |
| `POST` | `/api/batches/preview` | Revalidar entrada, estimar consumo e emitir autorização técnica da prévia |
| `POST` | `/api/batches` | Criar ou recuperar o mesmo job de uma tentativa repetida |
| `GET` | `/api/batches/:batchId` | Consultar estado, erro e métricas autorizadas |
| `GET` | `/api/batches/:batchId/results` | Ler uma página de resultados do lote |
| `POST` | `/api/batches/:batchId/cancel` | Solicitar cancelamento do job |

### Prévia e execução

A prévia deve devolver totais, tamanho do payload, fonte, estimativa em bytes e um token assinado de curta duração. Esse token ficará vinculado ao usuário, ao hash dos CNPJs, ao SQL/adaptador, à tabela e à política de consumo.

Na execução, o backend recalculará o hash e rejeitará prévias vencidas ou adulteradas. Alterar a lista ou a fonte exige nova prévia. O usuário não poderá enviar SQL, nomes arbitrários de tabelas ou um teto de consumo maior que o autorizado.

### Identidade e repetição segura

Gerar um `batchId` aleatório por operação intencional. Derivar o identificador do job de forma reproduzível a partir da identidade, do lote e do hash da entrada, usando assinatura no servidor. Uma repetição técnica recuperará o mesmo job; uma nova consulta intencional terá outro lote.

Nunca consultar resultados apenas porque alguém conhece um `jobId`. Cada rota deverá verificar usuário, assinatura, validade, projeto, localização e vínculo do lote. Tokens não serão colocados em URLs nem registrados em logs.

### Estados

```text
PREVIEW_READY → SUBMITTED → PENDING → RUNNING → FETCHING → COMPLETED
                    │          │         │         └── FAILED
                    └──────────┴─────────┴──────────── FAILED
                                         └── CANCEL_REQUESTED → CANCELLED
```

`CANCEL_REQUESTED` também pode terminar em `COMPLETED` ou `FAILED`, conforme a resposta efetiva do provedor.

No BigQuery, `DONE` significa que o job parou, não necessariamente que teve sucesso. Verificar o resultado de erro antes de liberar a leitura como concluída.[^bq-jobs]

A solicitação de cancelamento não é uma pausa com retomada garantida. Interromper a consulta de estado no navegador também não cancela o job remoto. O cancelamento precisa ser solicitado ao serviço e seu resultado confirmado.[^bq-cancel]

## 11. Consulta SQL de referência

**Template para homologação. Não executado nesta entrega.** Os nomes e tipos abaixo deverão ser confrontados com o schema real antes da implementação.

```sql
-- GoogleSQL. @cnpjs deve ser um único parâmetro ARRAY<STRING>.
WITH entrada AS (
  SELECT DISTINCT cnpj
  FROM UNNEST(@cnpjs) AS cnpj
)
SELECT
  entrada.cnpj AS cnpj_solicitado,
  receita.cnpj AS cnpj_encontrado,
  COUNT(receita.cnpj) OVER (
    PARTITION BY entrada.cnpj
  ) AS registros_encontrados,
  receita.razao_social,
  receita.opcao_simples,
  receita.data_opcao_simples,
  receita.opcao_mei,
  receita.data_opcao_mei
FROM entrada
LEFT JOIN `opencnpj-bigquery.public.receita` AS receita
  ON receita.cnpj = entrada.cnpj
ORDER BY entrada.cnpj;
```

A fonte e os campos pretendidos derivam da documentação do OpenCNPJ; a sintaxe de parâmetros em array é documentada pelo BigQuery.[^open-table][^open-schema][^bq-parameters]

### Regras de implementação do template

Manter `LEFT JOIN` para preservar CNPJs não encontrados. Não usar `INNER JOIN`, que ocultaria essas pendências. Selecionar apenas colunas necessárias e não aplicar um `LIMIT` que corte o resultado do usuário.

O indicador bruto será normalizado no adaptador, não presumido neste SQL. `registros_encontrados > 1` deve acionar reconciliação de duplicidade da fonte; não escolher arbitrariamente o primeiro registro. Se não houver regra homologada para a duplicidade, devolver “não confirmado”.

Um campo ausente deve bloquear a versão incompatível da consulta ou ser explicitamente tratado como capacidade não disponível. Não substituir falha de schema por valores fiscais negativos.

## 12. Gratuidade e controle de consumo

### O que está documentado

O sandbox do BigQuery permite experimentar o serviço sem cartão ou conta de faturamento e informa franquia de **1 TiB de dados processados por mês**. Ele possui limitações, incluindo ausência de DML, streaming e Data Transfer Service, além de expiração automática para determinados recursos criados.[^bq-sandbox]

A franquia é de processamento, não de quantidade de CNPJs. **Este projeto não promete consultas ilimitadas nem custo zero para qualquer frequência de uso.**

| Componente | Tratamento no plano |
| --- | --- |
| Dados do OpenCNPJ | O fornecedor informa uso gratuito, inclusive comercial[^open-faq] |
| Processamento BigQuery | Condicionado à franquia e à configuração real do projeto |
| Hospedagem Node.js | Custo e adequação de uso comercial ainda não verificados |
| Armazenamento próprio de planilhas | Não previsto |
| Domínio, monitoramento ou outros serviços | Não incluídos automaticamente na gratuidade |

### Controles obrigatórios

Realizar `dryRun` antes de executar e informar o volume estimado. Na consulta efetiva, aplicar `maximumBytesBilled` no servidor. O teto limitará a consulta individual, mas não será apresentado como controle mensal de toda a conta.[^bq-costs]

Configurar cotas apropriadas na infraestrutura e conferir o consumo acumulado no Google Cloud. A interface deverá informar “saldo não disponível” se não tiver uma fonte confiável para medir a franquia restante.

Não ativar faturamento, ampliar cotas ou contratar serviços automaticamente. No modo inicialmente proposto, eventual incompatibilidade com o sandbox deve bloquear a implantação e registrar a decisão pendente.

Alertas e estimativas da interface não serão tratados como um bloqueio financeiro absoluto. Se houver faturamento habilitado, os limites de cada serviço e o uso por outros sistemas precisam ser avaliados separadamente.

### Regras de eficiência

Deduplicar CNPJs, ler somente colunas necessárias e reutilizar o mesmo job em tentativas repetidas. Não contar com cache para garantir gratuidade. Não usar `LIMIT` como suposto teto de bytes: ele não é um controle confiável de leitura em tabelas não clusterizadas.[^bq-costs]

A homologação registrará bytes estimados, processados e faturáveis, quando fornecidos. A estimativa pode ser conservadora; ela não é uma medição de custo real nem uma promessa de duração.

## 13. Segurança e privacidade

### Requisitos de acesso

Adotar autenticação com provedor de identidade e lista de usuários autorizados, sem criar um cadastro de senhas em banco próprio. Validar o identificador e as declarações do usuário no servidor, não apenas o e-mail informado pelo navegador.

A identidade que acessa BigQuery terá somente as permissões necessárias. Não atribuir `Owner` como atalho de configuração. A documentação do Google recomenda federação de identidade para aplicações hospedadas fora do Google Cloud; a configuração concreta será escolhida conforme a hospedagem.[^bq-auth]

### Proteções de implementação

- Segredos somente no servidor; nenhuma chave privada em HTML, JavaScript público, Git ou exportações.
- Sessões protegidas, HTTPS, cookies seguros quando aplicáveis, validação de origem e proteção contra requisições indevidas.
- Limites de payload, tempo, tentativas e frequência aplicados fora da simples lógica visual.
- SQL parametrizado e tabela permitida definida no servidor.
- Isolamento entre usuários em todas as rotas de prévia, consulta, paginação e cancelamento.
- Tratamento seguro de textos na interface e de valores que possam virar fórmulas em planilhas.

A aplicação não registrará planilhas, listas completas de CNPJs, tokens ou chaves nos logs. Preferir contagens, códigos de erro e identificadores pseudonimizados. A política final de privacidade, retenção e acesso deverá ser revisada antes da operação; este plano não constitui uma certificação de conformidade jurídica.

## 14. Interface e exportação

### Organização da página

| Área | Conteúdo |
| --- | --- |
| Início | Objetivo, fonte, referência da base e instruções |
| Importação | Arquivo, aba, colunas, prévia e inconsistências |
| Consulta | Resumo do lote, estimativa de consumo e ação de iniciar |
| Resultados | Contadores, filtros, busca e tabela paginada |
| Ajuda | Explicação dos estados, limitações e validação oficial |

Priorizar visual limpo, textos claros e acesso por teclado. Não depender exclusivamente de cor para distinguir estados. Exibir os dados principais antes de gráficos; nenhum gráfico é necessário para a consulta funcionar.

### Indicadores

Mostrar linhas importadas, CNPJs válidos distintos, duplicados, inválidos, optantes, não optantes e não confirmados. Os contadores devem dizer claramente se representam **linhas da planilha** ou **CNPJs distintos**.

Oferecer filtros de resultado, motivos de pendência, documento e nome. O filtro da tela não deve limitar silenciosamente o arquivo completo: “exportar todos” e “exportar filtrados” serão ações diferentes.

### Estrutura da exportação

O XLSX deverá conter as abas `Resultados`, `Pendencias` e `Resumo`. O CSV terá os resultados tabulares, com codificação compatível com o uso previsto e aviso de que a abertura direta em alguns editores pode reinterpretar CNPJs; o XLSX com células de texto será a opção preferencial.

Colunas previstas:

```text
arquivo_origem | aba_origem | linha_origem | nome_informado
cnpj_original | cnpj_normalizado | validacao_cnpj | razao_social
situacao_simples | valor_original_simples | data_opcao_simples
opcao_mei | data_opcao_mei | motivos | avisos
fonte | tabela_fonte | referencia_base | data_referencia_base
modificacao_tecnica_tabela | consultado_em_utc | consultado_em_local
versao_aplicacao | versao_adaptador
```

Preservar zeros e letras no XLSX, exportar datas consistentemente e neutralizar conteúdo de entrada que possa ser interpretado como fórmula. Não exportar tokens, credenciais ou URLs privadas de administração.

Enquanto houver páginas pendentes, a saída disponível deverá ser identificada como **parcial**, sem alegar que representa o lote completo.

## 15. Preparação do ambiente

### Pré-requisitos

É necessário definir um repositório, um projeto Google Cloud autorizado, acesso à tabela pública, hospedagem do backend e um provedor de autenticação. Nada disso é considerado configurado nesta versão.

### Sequência de configuração

1. Criar ou selecionar o projeto de testes no Google Cloud e confirmar a situação real do faturamento.
2. Habilitar os serviços necessários, verificar cotas e acesso ao BigQuery.
3. Inspecionar tabela, localização, schema e atualização da fonte.
4. Configurar a identidade do backend e as permissões mínimas.
5. Definir autenticação do usuário e restrição de acesso ao painel.
6. Executar a prova técnica da fase 0 antes de ampliar a construção da interface.
7. Selecionar hospedagem e verificar condições comerciais, limites de função, payload e segredos.
8. Criar ambientes de teste e produção separados, com configuração documentada.

O usuário final não precisará executar scripts ou comandos para realizar cada consulta. A preparação inicial é uma atividade da equipe técnica.

**Ainda não há um `package.json` entregue nem comandos de instalação funcionais.** Quando o código existir, esta seção deverá passar a conter os comandos reais e testados de instalação, desenvolvimento, teste e implantação, em vez de instruções fictícias.

## 16. Configurações planejadas

Os nomes abaixo são uma proposta para o futuro `.env.example`. Não contêm segredos reais.

| Variável | Uso / regra |
| --- | --- |
| `APP_ORIGIN` | Origem HTTPS autorizada da aplicação |
| `AUTH_ALLOWED_USERS` | Lista restrita de usuários; validação no servidor |
| `AUTH_ISSUER` | Emissor confiável da identidade do usuário |
| `AUTH_CLIENT_ID` | Identificador do cliente de autenticação |
| `AUTH_CLIENT_SECRET` | Quando exigido pelo provedor; somente no servidor |
| `SESSION_SIGNING_KEY` | Segredo forte para a sessão, com estratégia de rotação |
| `BATCH_TOKEN_SIGNING_KEY` | Segredo distinto para vincular prévias e lotes |
| `GOOGLE_CLOUD_PROJECT` | Projeto que executará os jobs |
| `GOOGLE_APPLICATION_CREDENTIALS` | Configuração de credenciais do servidor quando aplicável; nunca arquivo público |
| `BQ_SOURCE_TABLE` | Inicialmente `opencnpj-bigquery.public.receita`, após validação |
| `BQ_LOCATION` | Localização confirmada do dataset; não presumir valor |
| `BQ_MAXIMUM_BYTES_BILLED` | Teto obrigatório definido após a medição do SQL |
| `MAX_IMPORT_ROWS` | Proposta inicial: `50000` |
| `MAX_IMPORT_FILE_BYTES` | Proposta inicial: `26214400` |
| `MAX_API_BODY_BYTES` | Proposta inicial: `1048576` |
| `RESULT_PAGE_SIZE` | Proposta inicial: `1000`, também respeitando limite em bytes |
| `SOURCE_MAX_AGE_DAYS` | Política interna de aviso; não representa prazo garantido pelo fornecedor |
| `APP_TIMEZONE` | `America/Sao_Paulo` |

O processo deverá recusar configuração sem teto de consumo, origem autorizada, autenticação ou credenciais válidas. Uma variável indicando “modo gratuito” não substitui a conferência real de faturamento e cotas no Google Cloud.

## 17. Estrutura prevista do projeto

**Estrutura futura; os arquivos abaixo não foram criados nesta entrega, exceto este README.**

```text
consulta-simples-lote/
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── public/
│   ├── index.html
│   └── assets/
├── src/
│   ├── client/
│   │   ├── importacao/
│   │   ├── resultados/
│   │   ├── exportacao/
│   │   └── workers/
│   ├── server/
│   │   ├── auth/
│   │   ├── routes/
│   │   ├── security/
│   │   └── services/
│   ├── providers/
│   │   └── opencnpj-bigquery/
│   └── shared/
│       ├── cnpj/
│       └── contracts/
├── sql/
│   └── consulta-simples.sql
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── homologacao.md
│   ├── operacao.md
│   └── decisoes/
└── .github/
    └── workflows/
```

As bibliotecas de leitura de XLSX/CSV, autenticação e testes serão escolhidas e fixadas em lockfile após verificar licença, manutenção e compatibilidade. Não incluir dependências pesadas sem uma necessidade concreta.

## 18. Plano de ação por fases

Todas as fases de implementação estão **pendentes**. Não há prazos de execução prometidos neste documento; a progressão depende dos critérios de aceite.

| Fase | Prioridade | Entrega | Critério de conclusão |
| --- | --- | --- | --- |
| 0 — Prova da fonte | P0 | Acesso, schema, flags, atualização e estimativa de consumo | Evidências de leitura e decisão de viabilidade registradas |
| 1 — Fundação | P0 | Repositório, dependências, configuração, autenticação e testes básicos | Ambiente de teste reproduzível e segredos protegidos |
| 2 — Importação | P0 | XLSX/CSV, mapeamento, validação e deduplicação | Todas as linhas preservadas; inválidos identificados |
| 3 — Consulta em lote | P0 | Prévia, limites, job idempotente, estado e paginação | Integração ponta a ponta sem chamadas por empresa |
| 4 — Resultados | P0 | Classificação, reconciliação, filtros e avisos | Nenhum falso “não optante”; contagens reconciliadas |
| 5 — Exportação | P0 | XLSX/CSV, pendências e resumo | Exportação integral, segura e compatível com a entrada |
| 6 — Homologação | P0 | Segurança, falhas, 10.001 CNPJs e meta de 50.000 linhas | Evidências de teste, consumo e limitações registradas |
| 7 — Publicação | P1 | Implantação, operação e documentação real | Teste de produção controlado e procedimento de reversão |

### Checklist de execução

- [x] Registrar objetivo, restrições e arquitetura proposta.
- [x] Elaborar este plano e a política de atualização do README.
- [x] Conferir a documentação pública citada nas referências.
- [ ] Confirmar acesso autenticado à tabela e sua localização.
- [ ] Homologar schema, indicadores e referência temporal da base.
- [ ] Medir o SQL e definir teto de consumo.
- [ ] Criar o repositório e o ambiente de desenvolvimento.
- [ ] Implementar autenticação, autorização e proteção dos lotes.
- [ ] Implementar importação, validação e deduplicação.
- [ ] Implementar prévia, criação de job e idempotência.
- [ ] Implementar estado, paginação e cancelamento.
- [ ] Implementar adaptador fiscal e reconciliação de linhas.
- [ ] Implementar interface, filtros e exportação.
- [ ] Executar testes automatizados e auditoria de segredos.
- [ ] Homologar 10.001 CNPJs válidos distintos.
- [ ] Testar a meta de 50.000 linhas e registrar limites reais.
- [ ] Publicar ambiente e executar teste controlado.
- [ ] Atualizar o README com instalação, uso e evidências reais.

### Ordem de prioridade

Primeiro comprovar fonte e consumo; depois integridade e segurança; por último acabamento visual e recursos adicionais. Não construir um painel extenso antes de saber que a consulta principal funciona dentro das restrições.

## 19. Plano de testes e homologação

| Grupo | Cenários obrigatórios | Resultado esperado |
| --- | --- | --- |
| CNPJ | Numérico válido, alfanumérico válido, letras minúsculas, máscara e espaços | Normalização correta, sem apagar letras |
| Dados ruins | Documento curto, DV incorreto, caractere estranho e notação científica ambígua | Pendência explícita; nenhuma correção silenciosa |
| Arquivos | XLSX, CSV com separadores diferentes, aba vazia e arquivo corrompido | Leitura correta ou erro compreensível |
| Segurança de arquivo | Conteúdo expandido excessivo, fórmulas e links externos | Limitação de recursos e nenhuma execução de conteúdo |
| Duplicados | Mesmo CNPJ repetido e filiais com raiz comum | Deduplicação só do documento completo; linhas preservadas |
| Situação | Positivo, negativo, nulo, desconhecido e ausência na fonte | Classificação conforme a matriz, sem falso negativo |
| Fonte | Schema alterado, duplicidade conflitante e atualização não informada | Bloqueio ou revisão explícita |
| Paginação | Várias páginas, falha intermediária e retomada da mesma página | Sem perdas, duplicações nem consulta nova desnecessária |
| Integridade | Resultado ausente, extra ou contagens incompatíveis | Impedir conclusão integral e registrar inconsistência |
| Volume mínimo | 10.001 documentos válidos distintos | Um lote lógico completo, reconciliado e exportável |
| Volume adicional | Até 50.000 linhas, incluindo duplicados e inválidos | Interface utilizável e limites medidos |
| Custo | Estimativa acima do teto e cota indisponível | Bloqueio antes de gasto não autorizado |
| Idempotência | Duplo clique, retransmissão e timeout ao criar job | Recuperação do mesmo job da tentativa |
| Autorização | Usuário não autorizado, token alterado e lote de terceiro | Acesso negado sem vazamento de dados |
| Falhas remotas | HTTP 429, falha temporária, timeout e credencial vencida | Recuo controlado e mensagem acionável |
| Cancelamento | Job em andamento, já finalizado e fechamento do navegador | Estado remoto verdadeiro, sem prometer pausa |
| Exportação | Zeros, letras, acentos, filtros e conteúdo com prefixo de fórmula | XLSX/CSV coerentes e seguros |

### Evidências mínimas de homologação

Registrar data, versão/commit, ambiente, arquivo de teste ou seu hash, totais de entrada e saída, duração observada, uso de memória, páginas recebidas, bytes estimados/processados e resultados dos testes.

Não fixar uma promessa de “consultar tudo em segundos”. Tempos deverão ser medidos e apresentados com o ambiente e o tamanho do lote. Amostras conferidas manualmente no portal não comprovam precisão absoluta de toda a base.

Antes da publicação, o responsável deve conseguir responder: quais funcionalidades passaram, quais não passaram, quais foram apenas simuladas e quais dependem do fornecedor.

## 20. Operação e tratamento de falhas

### Métricas previstas

Acompanhar lotes iniciados, concluídos e falhos; tamanho de importação; CNPJs distintos; proporção de não confirmados; duração; páginas recebidas; consumo de bytes; erros de autenticação; e idade conhecida da base.

A medição não exigirá registro da lista de fornecedores. Um painel de consumo só poderá mostrar saldo de franquia quando houver integração confiável com essa informação.

### Respostas operacionais

| Ocorrência | Comportamento previsto |
| --- | --- |
| Tabela não encontrada | Conferir referência e localização; bloquear consulta incompatível |
| Acesso negado | Informar pendência de permissão; não trocar de credencial ou projeto automaticamente |
| Campo alterado | Bloquear adaptador incompatível e atualizar testes/documentação |
| Limite de bytes excedido | Exibir estimativa e teto; não aumentar o teto automaticamente |
| Quota esgotada | Interromper novos jobs e orientar revisão do consumo |
| Timeout ao criar job | Consultar o identificador determinístico antes de reenviar |
| Falha na leitura de página | Repetir a leitura, não executar novamente o SQL |
| Resultado temporário expirado | Informar necessidade de nova consulta, com nova prévia de consumo |
| Base antiga ou sem referência | Exibir aviso; não mudar a data para o horário atual |
| Linha não reconciliada | Manter “não confirmado”; exportar como pendência |

### Mudança de versão e reversão

Uma versão nova do adaptador não deve reinterpretar silenciosamente um lote já iniciado. Tokens e metadados vincularão a versão usada. Manter a versão anterior pelo período de lotes suportados ou invalidar o lote com uma mensagem clara.

Em falha de implantação, reverter para a versão estável anterior e impedir novos jobs incompatíveis. Não apagar evidências técnicas úteis e não registrar dados sensíveis para compensar falta de observabilidade.

## 21. Riscos e decisões pendentes

| Risco / pendência | Tratamento |
| --- | --- |
| Dataset público indisponível | Verificar na fase 0; não depender de uma suposição de acesso |
| Schema diferente da documentação | Adaptador versionado, inspeção e testes de contrato |
| Mudança recente de opção não refletida | Mostrar referência temporal e permitir conferência oficial |
| Custo de leitura acima da expectativa | `dryRun`, teto e decisão de viabilidade antes da interface completa |
| Recursos incompatíveis com sandbox | Não ativar cobrança automaticamente; registrar o bloqueio |
| Hospedagem sem gratuidade comercial adequada | Verificar condições antes da escolha e não anunciar custo total zero |
| Perda da sessão do navegador | Avisar, exportar resultados e limitar promessas de recuperação |
| Abuso de um endpoint público | Autenticação, autorização e controles de infraestrutura |
| Necessidade futura de histórico permanente | Tratar como mudança de escopo; não adicionar banco próprio sem aprovação |

### Ainda não decidido

Nome definitivo do produto, repositório, hospedagem, domínio, usuários autorizados, biblioteca de planilhas, mecanismo exato de autenticação, teto de bytes por job e limite aceitável de idade da base.

Essas pendências não impedem a entrega do plano, mas algumas bloqueiam a implementação ou a publicação. Nenhuma delas deve ser preenchida com credenciais ou valores inventados.

## 22. Regra de atualização deste README

**Este README é o documento principal de acompanhamento do projeto. Deve evoluir junto com o código e refletir o que realmente existe.**

### Quando atualizar

Atualizar no mesmo commit ou PR sempre que houver mudança de funcionalidade, rota, contrato, dependência importante, configuração, fonte, limite, segurança, implantação ou operação. Uma correção que altere o comportamento do usuário também exige atualização.

### O que atualizar em cada entrega

| Parte do README | Ação obrigatória |
| --- | --- |
| Cabeçalho | Atualizar data, versão e estado geral |
| Escopo | Registrar o que entrou, saiu ou mudou |
| Arquitetura e API | Refletir o comportamento real da versão |
| Configuração | Incluir variáveis novas e remover instruções obsoletas |
| Plano de ação | Marcar somente tarefas realmente concluídas |
| Testes | Informar quais foram executados, resultado e limitações |
| Operação | Acrescentar erros conhecidos e procedimentos verificados |
| Histórico | Registrar mudança, impacto e referência de commit/PR quando existir |

### Modelo para registrar uma atualização

```markdown
### [VERSAO] — AAAA-MM-DD

Status: planejado | implementado | testado | publicado

Alterações:
Descrever o comportamento adicionado, corrigido ou removido.

Configuração / operação:
Informar variáveis, permissões, limites ou passos que mudaram.

Testes executados:
Registrar cenário, ambiente, resultado e evidência.

Limitações e pendências:
Dizer o que ainda falta ou depende de validação externa.

Referência:
Commit ou PR real, quando disponível.
```

### Critério de entrega concluída

Código escrito, código testado e código publicado são estados diferentes. Não marcar como concluído um item apenas porque foi descrito. Uma entrega só será encerrada quando seus critérios de aceite e sua documentação estiverem coerentes.

Uma verificação futura de CI poderá exigir mudança no README em PRs que alterem arquivos funcionais. Essa verificação será um apoio, não uma prova automática de que o texto está correto. **Nenhuma automação de atualização foi criada nesta entrega.**

O controle de versão utilizará Git quando o repositório existir. Até lá, a versão e a data deste arquivo são a referência documental, sem alegar commit ou PR inexistente.

## 23. Histórico de alterações e próxima entrega

### [0.1.0] — 2026-09-24

**Status: planejamento documentado.**

Criado o plano inicial para consulta em lote acima de 10.000 CNPJs, preservando a proposta de importação/exportação pela web e ausência de banco próprio. Definidos arquitetura proposta, regras de classificação, suporte alfanumérico, controle de consumo, segurança, contratos, fases, testes e manutenção do README.

**Validação realizada:** consulta à documentação pública indicada nas referências.

**Não realizado:** criação de aplicação, consulta autenticada ao BigQuery, validação do schema real, processamento de planilhas do usuário, teste de carga, configuração de faturamento, commit, PR ou implantação.

### Próxima entrega prevista no plano

**Fase 0 — prova técnica da fonte e do custo.**

A entrega dessa fase deverá trazer: acesso confirmado, localização e schema reais, mapa de indicadores, identificação da atualização da base, uma consulta pequena validada, estimativa de um lote representativo e decisão documentada sobre a viabilidade do modo gratuito.

Somente depois dessa prova deverão ser promovidos a requisitos definitivos os detalhes do adaptador e os limites operacionais.

## 24. Referências técnicas

Fontes públicas consultadas para este planejamento em **24/09/2026**. Endereços e condições externas devem ser revistos nas próximas entregas. A documentação consultada não substitui a homologação no projeto Google Cloud que efetivamente executará a aplicação.

[^open-analytics]: OpenCNPJ — documentação de consultas analíticas e cruzamento de listas: https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/pages/AnalyticsPage.tsx
[^open-table]: OpenCNPJ — configuração das referências de tabelas BigQuery: https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/data/bigquery.ts
[^open-schema]: OpenCNPJ — descrição, periodicidade e campos dos datasets: https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/data/datasets.ts
[^open-faq]: OpenCNPJ — gratuidade, atualização e uso em grande volume: https://raw.githubusercontent.com/Hitmasu/OpenCNPJ/main/src/Page/src/pages/FaqPage.tsx
[^bq-sandbox]: Google Cloud — BigQuery sandbox: https://docs.cloud.google.com/bigquery/docs/sandbox
[^bq-costs]: Google Cloud — estimativa e controle de custos: https://docs.cloud.google.com/bigquery/docs/best-practices-costs
[^bq-quotas]: Google Cloud — cotas e limites do BigQuery: https://docs.cloud.google.com/bigquery/quotas
[^bq-parameters]: Google Cloud — consultas parametrizadas e parâmetros em array: https://docs.cloud.google.com/bigquery/docs/parameterized-queries
[^bq-insert]: Google Cloud — API `jobs.insert`: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/insert
[^bq-jobs]: Google Cloud — execução programática e estados dos jobs: https://docs.cloud.google.com/bigquery/docs/running-jobs
[^bq-results-api]: Google Cloud — API `jobs.getQueryResults`: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/getQueryResults
[^bq-cancel]: Google Cloud — API `jobs.cancel`: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/cancel
[^bq-results]: Google Cloud — resultados de consulta e tabelas temporárias: https://docs.cloud.google.com/bigquery/docs/writing-results
[^bq-auth]: Google Cloud — autenticação no BigQuery: https://docs.cloud.google.com/bigquery/docs/authentication
[^bq-table]: Google Cloud — API `tables.get`: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/get
[^bq-dataset]: Google Cloud — API `datasets.get`: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/datasets/get
[^rfb-cnpj]: Receita Federal — CNPJ alfanumérico e materiais técnicos: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico
[^rfb-optantes]: Receita Federal — Consulta Optantes do Simples Nacional: https://www8.receita.fazenda.gov.br/SimplesNacional/aplicacoes.aspx?id=21

---

**Regra permanente do projeto:** o README deve mostrar o estado real da solução. Sempre que a implementação mudar, atualizar o plano, os procedimentos, os testes e o histórico na mesma entrega.
