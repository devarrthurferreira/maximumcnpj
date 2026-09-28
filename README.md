# Maximum CNPJ · v0.5.1

**Node.js + TypeScript + MongoDB para consultas e histórico. Python para relatórios PDF/CSV por empresa, consulta e enquadramento. Sem Google Cloud.**

> Os resultados são observações salvas da API Minha Receita. Um relatório não consulta novamente a fonte nem certifica o enquadramento atual. Erro, ausência e campo desconhecido nunca são automaticamente “não optante”.

| Controle | Estado desta entrega |
|---|---|
| Versão | **0.5.1 · 28/09/2026** |
| Repositório | `devarrthurferreira/maximumCNPJ` |
| Novo módulo | `/reports.html` e função Python `/api/reports` |
| Base da atualização | v0.4.1, correção do primeiro administrador preservada |
| Testes Python | 7 locais e 4 de integração MongoDB/HTTP aprovados na CI da primeira revisão |
| Inspeção visual | PDF sintético renderizado e páginas revisadas |
| Validação completa | CI 36461983028 aprovou build, Python/MongoDB, regras e navegador; smoke de versão corrigido nesta revisão |
| Banco de produção | Nenhuma importação, exclusão ou troca de senha feita por esta atualização |

O README e o CHANGELOG completos da v0.4.1 foram preservados em `docs/archive/`. A versão anterior descreve a fundação e suas evidências; este documento é a referência operacional vigente. Nenhum relatório demonstrativo é resultado fiscal real.

### Validação e revisão da implantação

A etapa `verify` da CI **36461983028**, commit `edbd0239f5685d172e544bfe3a225c434d633c08`, aprovou os testes Python/MongoDB, build, regras, autenticação em banco descartável e navegador. A implantação desse código respondeu com a versão 0.5.0, página de relatórios disponível e runtime Python identificado.

O smoke antigo ainda exigia literalmente 0.4.0 e por isso não reconhecia a atualização. Esta revisão lê a versão diretamente de `package.json`, impõe timeout nas requisições e adiciona regressão dessa regra. Confira a nova CI associada ao SHA final para os smokes de produção. Isso não representa login com a conta real do usuário nem homologação fiscal.

## Identidade Maximum · v0.5.1

Esta revisão aplica a identidade solicitada ao login, navegação, indicadores, importação, histórico, painel legado, central de relatórios e PDFs. Não modifica senhas, permissões, MongoDB, fonte de consulta, dados históricos, contagens ou critérios fiscais.

| Elemento | Aplicação |
|---|---|
| Bordô principal | `#750207`, ações principais, áreas da marca e cabeçalhos PDF |
| Bordô escuro | `#6F0000`, fundo do login e interações |
| Branco / fundo suave | `#FFFFFF` / `#F7F3F3` |
| Bordas / apoio | `#EAD5D6` / `#B2797B` |
| Texto / texto secundário | `#222222` / `#666666` |

Logo oficial de origem: https://maximum-club.vercel.app/img/logo-maximum-white.png. A cópia versionada preserva os bytes originais, a transparência e a proporção 512 × 107. O SHA Git do PNG é `25967ce7f55a9058f45733a79536a9eb092f4b2a`. O símbolo compacto do menu/favicon é um recorte do M da mesma imagem, não uma nova marca.

`public/img/logo-maximum-white.png` atende o navegador e `reporting/assets/logo-maximum-white.png` atende o Python. Os PDFs incorporam a imagem local: nenhuma consulta ao MaximumClub é necessária para abrir a interface, construir o aplicativo ou emitir um relatório. O navegador continua restrito aos próprios ativos; nenhuma ampliação de CORS/CSP foi necessária.

As classes de status continuam identificadas por texto. Bordô, grafite e tons claros da marca substituem a antiga paleta violeta; o significado de optante, não optante e não confirmado permanece o mesmo. O login possui marca visível também no celular, e o menu recolhido usa o símbolo compacto. A logo branca sempre fica sobre fundo bordô, sem filtros de cor ou distorção.

O PDF reserva espaço para a faixa da marca em todas as páginas, mantendo rodapé, paginação, filtros, datas e avisos de origem. Novos testes verificam a integridade do PNG, incorporação no PDF, contraste da ação principal, logo carregada e layout responsivo. As evidências usam dados fictícios e banco descartável. A aprovação da versão deve ser conferida na CI correspondente ao SHA publicado; existência dos testes não equivale a homologação de dados reais.

## 1. O que foi acrescentado

A central **Relatórios por empresa** permite selecionar a empresa pelo Código/ID e uma consulta concluída, visualizar grupos separados e gerar arquivos em Python. Também há um acesso direto **Ver separado / Relatório Python** nos resultados concluídos do painel principal.

| Separação | Regra |
|---|---|
| Empresa | Responsável escolhida explicitamente; não mistura carteiras |
| Consulta | Snapshot específico, com arquivo, ID e conclusão visíveis |
| Enquadramento | Todos, optantes, não optantes e não confirmados |
| Tipo informado | Todos, clientes, fornecedores, ambos ou tipo não identificado |
| Pesquisa na tela | CNPJ, nome informado ou nome retornado pela API |
| Downloads | Resumo PDF, listagem PDF paginada em partes e CSV do grupo |

O histórico oferece consultas anteriores com paginação. O módulo não soma lotes nem apresenta a emissão do arquivo como nova verificação fiscal. A visualização geral anterior continua disponível no painel principal.

## 2. Passo a passo dos relatórios

1. Entre normalmente no Maximum CNPJ.
2. Abra **Relatórios por empresa** na navegação, ou use o botão de relatório dentro de uma consulta concluída.
3. Escolha **Código · Empresa**, depois o relatório/consulta desejado.
4. Escolha o tipo e clique no grupo: optantes, não optantes, não confirmados ou todos.
5. Confira as quantidades, os percentuais e os CNPJs na tabela.
6. Use **Baixar resumo PDF**, **Baixar PDF detalhado** ou **Baixar CSV**.
7. Quando houver mais de uma parte, selecione e baixe todas as partes para obter a relação completa.

A busca textual restringe **somente a tabela da tela**. Os arquivos exportam o grupo e o tipo completos, identificados no relatório. Não existe filtro textual oculto no download. Ao trocar de grupo, a busca é limpa.

## 3. Conteúdo dos PDFs

O resumo contém empresa, código, ID da consulta, arquivo de origem, data da conclusão e emissão, total de linhas, documentos consultáveis únicos, repetições adicionais, documentos não consultáveis, distribuição por enquadramento e tipo, cobertura de respostas explícitas e quantidade de nomes semelhantes/divergentes para revisão.

A listagem detalhada inclui CNPJ, enquadramento, nome informado, razão social e nome fantasia quando retornados, tipo/UF, ocorrências, conferência de nome, motivo de não confirmação, situação cadastral, MEI e datas de opção/exclusão disponíveis. Cada registro conserva sua própria data de consulta. A referência fiscal não homologada continua aparecendo como **Não informada**.

Os horários são apresentados em Brasília. As datas puramente fiscais (YYYY-MM-DD) não recebem deslocamento de fuso. Campos indisponíveis são explicitamente identificados; nenhum dado é preenchido por suposição.

## 4. Quantidades, percentuais e limites

O **denominador do tipo** é a quantidade de CNPJs válidos distintos naquele tipo dentro do lote. Inclui os não confirmados. A coluna adicional **% no lote completo** permite comparar com todos os CNPJs do snapshot, independentemente do tipo. O grupo selecionado restringe a listagem, não transforma a própria quantidade em um denominador que sempre resultaria em 100%.

Repetições não aumentam a quantidade; matriz e filial com CNPJ completo diferente são distintas. Os totais de linhas, inválidos e repetições sempre se referem ao arquivo completo, com esse rótulo. Um grupo vazio gera resumo com zero e mensagem de ausência, não erro nem negativa fiscal.

**Limitação de origem do tipo:** a v0.4.1 guarda o primeiro tipo informado para cada CNPJ no lote. Se o mesmo CNPJ apareceu como cliente e fornecedor em linhas distintas, os relatórios não conseguem reconstruir o segundo tipo a partir dos dados reduzidos. “Ambos” significa que o texto de tipo armazenado indica as duas funções. A interface/PDF deixam essa regra explícita.

| Saída | Limite por resposta |
|---|---|
| Tabela na tela | 100 CNPJs por página |
| Resumo PDF | Totais completos da consulta/tipo; sem relação nominal |
| PDF detalhado | **500 CNPJs por parte**, páginas numeradas e cabeçalho repetido |
| CSV | **2.000 CNPJs por parte**, UTF-8 com BOM e ponto e vírgula |
| Arquivo gerado | Até 4.000.000 bytes; acima disso, erro explícito em vez de resposta cortada |
| Pedido à função Python | Até 4.096 bytes; recebe filtros/IDs, nunca uma planilha inteira |

O nome do arquivo inclui código, ID da consulta, tipo, grupo e parte. Não há ZIP de todos os relatórios nem envio de arquivos por e-mail nesta versão. As partes evitam concentrar um lote de dezenas de milhares de empresas em uma única resposta serverless. A lista completa exige baixar todas elas; o resumo já apresenta a quantidade integral.

## 5. Arquitetura e armazenamento

```text
Navegador
  ├── painel principal → API Node.js → MongoDB / Minha Receita
  └── relatórios       → função Python → MongoDB → PDF/CSV em memória
```

O backend principal permanece Node.js/TypeScript. Python é restrito ao módulo de relatórios: utiliza `PyMongo` para ler o mesmo MongoDB e `ReportLab` para produzir PDFs. Não precisa de Google Cloud, API de IA, chave fiscal adicional ou programa na máquina do usuário para gerar relatórios na Vercel.

A função lê `sessions`, `users`, `lookupJobs`, `lookupItems` e os estados compartilhados de `cnpjStates`. Não cria coleção de PDFs, não copia a carteira e não altera a classificação. Apenas contadores temporários de limite são gravados em `limits`, com expiração; o índice TTL já é criado pela aplicação principal.

Consultas concluídas são imutáveis para o relatório. Antes de publicar os totais, a função compara a quantidade de itens concluídos com `summary.unique`. Divergência bloqueia a emissão. Associação com estados é filtrada por workspace, identidade e ID, sem juntar dados de outra instalação.

A memória/conexão Python tem pool de até cinco conexões. Consultas MongoDB usam limites de tempo. Isso não torna armazenamento ou processamento ilimitados: histórico, backups, retenção e consumo de hospedagem continuam sendo responsabilidade operacional.

## 6. Segurança e acesso

A função Python exige a **mesma sessão já criada pela API Node.js**: lê apenas o hash do token no banco, verifica expiração, usuário ativo, workspace e perfil. Administrador, operador e visualizador podem ler e exportar os dados da instalação, como no painel existente. Conta que precisa trocar a senha não gera relatórios até concluir essa etapa.

Downloads são `POST` com JSON, origem exata e cookie de sessão; tokens não vão na URL. Origem vem de `APP_ORIGIN` e dos domínios de sistema confiáveis da Vercel, não de Host arbitrário. Ausência de sessão retorna 401, origem inválida 403 e lote incompleto 409. Requisições `GET /api/reports` retornam 405.

Há limite por usuário/workspace: 120 leituras e 15 arquivos por minuto. Respostas têm `Cache-Control: no-store`. Texto do banco é escapado antes de entrar no PDF, sem HTML remoto. O CSV neutraliza células que poderiam ser executadas como fórmulas. Credenciais, cookies, arquivos de clientes e senhas não integram os commits nem os logs.

Nenhuma política de senha foi modificada. O primeiro administrador continua aceitando de 10 a 128 caracteres pelo provisionamento autorizado; cadastro e alteração regular continuam de 12 a 128. Alterar variáveis de provisionamento não redefine uma conta existente.

## 7. Fluxo de consulta preservado

Importe a relação de empresas em **Empresas e códigos**, mapeando `ID → Código`, nome, CNPJ, ativa e UF. Depois, em **Nova consulta**, escolha a responsável e importe clientes/fornecedores com CNPJ e nome. A coluna antiga de resposta não determina o enquadramento.

Somente CNPJs completos válidos são consultados; CPF/CNO/inválidos são diagnosticados e excluídos dos percentuais. O nome confere a identidade, mas não substitui o CNPJ nem determina enquadramento por semelhança na internet. Cada lote novo chama novamente a Minha Receita; conteúdo igual reaproveita estados no MongoDB, sem apresentar cache antigo como nova chamada.

A fonte usa respostas de sua própria base, sem promessa de atualização em tempo real. As consultas mantêm pausas, tratamento de 429 e tentativas; mais de 10 mil CNPJs constituem lote lógico, não processamento instantâneo. A tela aberta conduz a fila; fechar pausa a continuidade, e reabrir permite retomar. Gerar relatório não inicia nem retoma a consulta externa.

## 8. Instalação e configuração

Requisitos: Node.js 22 dentro de `>=22.16.0 <23`, Python 3.12 para o módulo de relatórios e MongoDB. As variáveis privadas permanecem as mesmas:

```env
APP_ORIGIN=https://maximum-cnpj.vercel.app
MONGODB_URI=SUA_CONEXAO_PRIVADA
MONGODB_DB=maximum_cnpj
WORKSPACE_ID=maximum
```

O administrador inicial usa `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` somente no provisionamento. Nunca coloque valores reais no README, frontend ou repositório.

```bash
npm install
python -m pip install -r requirements.txt
# Preencher .env privado e provisionar somente quando ainda não há usuários:
npm run seed
npm run build
npm start
```

**Node local:** `npm start`/`npm run dev` atendem o painel/API Node, não executam automaticamente a função Python. Para testar o aplicativo de duas linguagens com as mesmas rotas localmente, use `npx vercel dev` com o ambiente de desenvolvimento configurado. Não aponte testes destrutivos para produção.

**Vercel:** `api/index.ts` permanece isolada do frontend; `api/reports.py` é a função Python. `requirements.txt` e `.python-version` definem as dependências/runtime. O roteamento explícito de `/api/reports` precede o encaminhamento geral para Node. O build da função deve instalar as dependências Python; não se resolve uma falha de runtime removendo a autenticação.

O `vercel.json` mantém saída `public`, framework Other, favicon e headers. A função Python exclui arquivos de desenvolvimento/ativos do pacote para reduzir tamanho. O módulo não necessita de nova variável de segredo.

## 9. API dos relatórios

`POST /api/reports`, usando a sessão do navegador. Corpo JSON:

```json
{
  "action": "pdf",
  "jobId": "UUID_DA_CONSULTA_CONCLUIDA",
  "clientId": "UUID_INTERNO_DA_EMPRESA",
  "status": "OPTANTE",
  "kind": "ALL",
  "layout": "detailed",
  "part": 1
}
```

A empresa conserva o Código/ID de origem para exibição, mas a API continua usando seu UUID interno; não confundir os dois.

| action | Retorno |
|---|---|
| `jobs` | Consultas concluídas por empresa; `page`, 30 por página |
| `summary` | Totais completos, percentuais e metadados do snapshot/tipo |
| `rows` | Página de CNPJs; admite `search`, `page`, grupo e tipo |
| `pdf` | PDF: `layout=summary` ou `detailed`; `part` quando detalhado |
| `csv` | CSV dos campos essenciais; `part` |

`status`: ALL, OPTANTE, NAO_OPTANTE ou NAO_CONFIRMADO. `kind`: ALL, CLIENTE, FORNECEDOR, AMBOS ou OUTROS. Identificadores, enums, páginas e tamanho de pesquisa são validados. Não há endpoint que aceite consultas MongoDB arbitrárias.

## 10. Estrutura acrescentada

```text
api/reports.py               Entrada HTTP, autenticação, limites e download
reporting/core.py           Contratos, origem/cookie, datas e CSV seguro
reporting/service.py        Leitura MongoDB e reconciliação do snapshot
reporting/pdf.py            Resumo e listagem PDF paginados
public/reports.html         Central de relatórios
public/reports-ui.js        Empresas, consultas, abas e partes
public/report-links.js      Acessos no painel e no resultado concluído
public/reports.css          Estilos da central e acessos
requirements.txt           ReportLab e PyMongo
.python-version            Python 3.12
scripts/smoke-reports.mjs   Verificação pública sem credenciais
tests/reports_test.py       Unidade, HTTP e integração MongoDB
tests/e2e/reports.spec.ts   Grupos, partes, download e acesso no navegador
```

## 11. Testes e evidências

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npm run test:lookup-integration
npm run test:reports
npx playwright install chromium
npm run test:e2e
```

Na preparação local, sete testes Python passaram: validação, origem, sessão, datas/percentuais, CSV seguro, PDF vazio/resumo e PDF de 500 registros com textos longos. Os PDFs foram renderizados para inspeção. Quatro testes de MongoDB são pulados localmente quando `REPORT_TEST_MONGO` não está habilitado; eles foram executados e aprovados na CI 36461983028, junto com a etapa de navegador. Essa referência é do commit descrito acima; consulte a execução do SHA final para as verificações subsequentes.

A CI instala Python, executa `REPORT_TEST_MONGO=1 npm run test:reports` em MongoDB descartável e preserva todos os testes Node, bootstrap, consulta e navegador anteriores. Os novos testes de integração cobrem filtros, reconciliação, isolamento, sessão, respostas PDF/CSV e proteção HTTP. O E2E usa respostas sintéticas do serviço para testar navegação, grupos, partes, download e layout móvel; não é prova de consulta fiscal real.

O smoke de produção verifica a página pública e o serviço Python recusando ausência de sessão. Não utiliza senha do usuário nem confirma o download autenticado da sua conta real. Build, CI, deploy e uso autenticado em produção são evidências diferentes. Sempre confira o resultado vinculado ao SHA entregue.

## 12. Diagnóstico

| Sintoma | Ação |
|---|---|
| 401 UNAUTHORIZED | Entre no painel; sessão expirada ou ausente |
| 403 ORIGIN | Conferir origem exata/domínios confiáveis; não liberar `*` |
| 403 PASSWORD_CHANGE_REQUIRED | Concluir redefinição obrigatória antes de exportar |
| 409 INCOMPLETE | Terminar a consulta; parcial não é relatório consolidado |
| 409 RESULT_COUNT | Conferir integridade do lote; não substituir contagem por zero |
| 400 PART_RANGE | Selecionar uma parte existente do grupo |
| 429 RATE_LIMIT | Aguardar um minuto; não aumentar concorrência para contornar |
| 413 REPORT_TOO_LARGE | Usar grupo/tipo menor; nenhuma lista foi cortada |
| 503 REPORT_UNAVAILABLE | Conferir MongoDB, rede, permissões e logs pelo requestId |
| Página funciona, Python não | Conferir deploy de api/reports.py, dependências e ordem das rotas |

## 13. Versionamento e próximas etapas

README, CHANGELOG, versão e testes acompanham os commits. Histórico, senha inicial e consultas existentes não são removidos. A v0.4.1 foi arquivada apenas como documentação; não houve migração destrutiva do banco.

Próximas evoluções propostas: PDF único assíncrono para lotes muito grandes, ZIP por empresa com armazenamento temporário e expiração, distribuição por múltiplos tipos de origem, referência fiscal verificada e fila independente da aba. Ainda não há envio automático de relatórios, comparador fiscal oficial ou calculadora tributária. Cada módulo precisa de especificação, testes e documentação própria.

## Referências de integração

Documentação técnica verificada para o desenho do módulo em 28/09/2026:
- Runtime Python: https://vercel.com/docs/functions/runtimes/python
- Limites de funções: https://vercel.com/docs/functions/limitations
- MongoDB Python: https://www.mongodb.com/docs/languages/python/pymongo-driver/current/
- ReportLab: https://www.reportlab.com/docs/reportlab-userguide.pdf
- Minha Receita: https://docs.minhareceita.org/como-usar/

Os limites locais são políticas deste aplicativo, não promessa de gratuidade ou disponibilidade ilimitada da hospedagem/fonte.
