# Maximum CNPJ · v0.7.0

Node.js + TypeScript + MongoDB para consultas e histórico. Python para PDFs. Identidade Maximum, empresas compartilhadas no mesmo workspace e acesso autenticado. Sem Google Cloud.

## Entrega de 29/09/2026 — geração por empresas

- [x] Navegação unificada: **Navegação → Início, Empresas**; **Geração → Iniciar, Histórico**.
- [x] Seleção de várias empresas e geração salva antes do envio, com acompanhamento das compras que faltam.
- [x] Histórico para abrir gerações, adicionar compras pendentes e retomar consultas.
- [x] Novo total financeiro: **Q − Y + AA − AB**, em centavos inteiros. Z é informação de conferência, fora da fórmula.
- [x] Não confirmados incluídos no grupo gerencial de não optantes; resposta original preservada nos detalhes e arquivos.
- [x] PDF Python com memória de cálculo por empresa e consolidado da geração concluída.
- [x] Formato de vendas preparado; importação e processamento permanecem indisponíveis.
- [x] Acessos da equipe, troca obrigatória, empresas existentes e relatórios anteriores preservados.

Os resultados refletem a resposta da base Minha Receita na data da consulta. A inclusão de não confirmados em não optantes é uma regra de agrupamento gerencial solicitada pela Maximum: a origem continua identificada como não confirmada, sem alterar o retorno da fonte. O enquadramento observado não comprova o regime na data da nota.

## Acesso da equipe

| Nome | E-mail | Perfil |
|---|---|---|
| Adria Cristina | tributario17@maximumcontabil.com.br | Operador |
| Alessandra Oliveira | tributario1@maximumcontabil.com.br | Operador |
| Ana Caroline | tributario2@maximumcontabil.com.br | Operador |
| Ana Carolina Lage | tributario18@maximumcontabil.com.br | Operador |
| Beatriz Barra | tributario9@maximumcontabil.com.br | Operador |
| Bruna Vieira | tributario16@maximumcontabil.com.br | Operador |
| Claudia Santos | tributario5@maximumcontabil.com.br | Operador |
| Felipe Lima | tributario11@maximumcontabil.com.br | Operador |
| Glenda Alves | tributario13@maximumcontabil.com.br | Operador |
| Henrique Sabião | tributario14@maximumcontabil.com.br | Operador |
| Janaina Borges | tributario3@maximumcontabil.com.br | Operador |
| Karoline Faria | tributario15@maximumcontabil.com.br | Operador |
| Marcela Geronimo | tributario12@maximumcontabil.com.br | Operador |
| Maria Fonseca | tributario4@maximumcontabil.com.br | Operador |
| Marta Mendes | tributario6@maximumcontabil.com.br | Operador |
| Maximum Contabil | tributario7@maximumcontabil.com.br | Operador |
| Mônica Lima | tributario8@maximumcontabil.com.br | Operador |
| Raíssa Ferreira | tributario10@maximumcontabil.com.br | Operador |
| Programação Maximum | programacao@maximumcontabil.com.br | Administrador |

A equipe pode consultar e importar nas empresas do workspace, visualizar histórico e exportar relatórios. Somente administradores gerenciam usuários. Senhas reais não fazem parte deste repositório, frontend, testes ou logs.

O provisionamento da equipe aceita senha temporária de 8–128 caracteres; todas as novas contas tributárias recebem `mustChangePassword=true`. Login permite entrar exclusivamente na tela de redefinição. A API Node e os relatórios Python bloqueiam as demais operações até a troca. A nova senha exige 12–128 caracteres, confirmação na tela e deve ser diferente da atual. A troca encerra as sessões anteriores e exige novo login.

O administrador inicial admite 10–128 caracteres. Usuários já existentes são preservados integralmente: nome, perfil, senha, ativo e estado da troca. Reexecutar o provisionamento ou alterar as variáveis de ambiente não redefine nenhuma conta. O bootstrap original `npm run seed` continua disponível apenas para uma instalação sem usuários.

### Como provisionar

1. **Instalação já em uso:** administrador autenticado faz `POST /api/users/provision-maximum` com JSON `{ "teamPassword": "<senha-temporaria-privada>", "adminPassword": "<senha-inicial-privada>" }`. A requisição deve incluir sessão e `Origin` autorizado. Os valores são transitórios e apenas hashes scrypt com sais independentes são persistidos.
2. **Via configuração privada:** defina `MAXIMUM_TEAM_INITIAL_PASSWORD` e, se necessário, `MAXIMUM_ADMIN_INITIAL_PASSWORD` no servidor e execute `npm run provision:team`. Também há provisionamento automático quando uma conta autorizada ainda ausente tenta entrar com a credencial inicial configurada corretamente.
3. `ADMIN_PASSWORD` pode atender o administrador Maximum somente quando `ADMIN_EMAIL` corresponde ao e-mail de programação. Não há senha embutida nem cadastro público.

O endpoint retorna quantas contas foram criadas e quantas foram preservadas. É possível omitir um dos grupos. Remova as variáveis iniciais após provisionar, quando não forem mais necessárias.

## Geração: uso e cálculos

1. Entre no sistema e conclua a redefinição quando solicitada.
2. Em **Geração → Iniciar**, pesquise e selecione de 1 a 50 empresas pelo código e nome.
3. Inicie a geração. O rascunho fica salvo com um espaço de compras para cada empresa selecionada.
4. Adicione o relatório de compras da empresa correspondente, confira aba/cabeçalho e prévia, depois confirme a importação. Vendas permanece marcada como **Em breve** e não bloqueia a etapa de compras.
5. Acompanhe as consultas. A página conduz a fila; fechar a aba pausa sua continuidade. No **Histórico**, abra a geração para adicionar compras faltantes ou retomar consultas em processamento.
6. Quando as compras de todas as empresas estiverem concluídas, baixe o **PDF Python da geração** com os cálculos de cada empresa. São até 10 empresas por parte, com partes numeradas quando necessário.
7. O detalhe de cada compra conserva PDF individual, fornecedores agrupados, linhas importadas e CSV em partes. O histórico anterior continua acessível.

| Coluna | Compras | Vendas (preparado) | Uso |
|---|---|---|---|
| A | CNPJ do fornecedor | CNPJ do comprador | Identidade completa, normalizada |
| I | Razão social | Comprador | Nome informado, sem inferir enquadramento |
| P | Quantidade | Opcional | Preservada; não multiplica os valores |
| Q | Valor Total | Valor Total | Valor bruto da linha |
| Y | Valor Desconto | Valor Desconto | Subtraído |
| Z | Despesa Acessória | Despesa Acessória | Conferência; não participa da fórmula |
| AA | Valor Frete | Valor Frete | Somado |
| AB | Abatimento não Tributado | Abatimento não Tributado | Subtraído |

**Novo Total = Q − Y + AA − AB.** A aplicação lê os componentes separadamente e recalcula no servidor. Ajustes vazios em colunas presentes equivalem a zero; colunas necessárias ausentes, valores inválidos e resultado negativo bloqueiam a linha para correção. Não há multiplicação por P nem redução silenciosa a zero.

Uma nota pode aparecer em várias linhas de produtos: todas as linhas e seus valores são preservados. O CNPJ é deduplicado somente para consulta e contagem de fornecedores. Matriz e filial com CNPJs completos diferentes contam separadamente.

| Indicador | Numerador | Denominador |
|---|---|---|
| % de fornecedores optantes | CNPJs distintos com resposta optante | Todos os CNPJs válidos distintos |
| % de fornecedores não optantes (grupo gerencial) | CNPJs distintos não optantes + não confirmados | A mesma base de CNPJs válidos distintos |
| % financeiro do grupo | Novo Total das linhas dos fornecedores do grupo | Novo Total de todas as linhas com CNPJ válido |
| Total importado | Novo Total de todas as linhas, inclusive CPF/outros documentos | Não se aplica |

A quantidade e o valor dos não confirmados ficam identificados dentro do grupo de não optantes. Os detalhes/CSV preservam a situação original. CPF, CNO e documentos inválidos não são enviados à API CNPJ nem entram nesses percentuais: seus valores ficam separados e permanecem no total importado. Uma base sem CNPJ válido admite relatório com denominador zero.

Novas importações usam `calculationVersion=NET_V2`. Relatórios anteriores sem essa marca continuam sob a regra `Q_V1` (soma de Q), com identificação da regra original. Seus descontos, fretes e abatimentos não eram armazenados; por isso, uma nova importação é necessária para obter a nova conta. Nenhum histórico é recalculado com valores inventados.

CSV admite UTF-8 e Windows-1252, separador ponto e vírgula e números brasileiros. Linhas completamente vazias são ignoradas. Cabeçalho, alinhamento e valores são conferidos antes do envio; separadores não escapados que desloquem campos precisam ser corrigidos na origem. Fórmulas nas colunas utilizadas devem ser convertidas para valores.

## Dados, segurança e limites

- Coleções `clients`, consultas antigas e estados existentes são mantidos. Nenhuma migração destrutiva.
- Compras usam `lookupJobs.mode=PURCHASES_V1`, `lookupItems` e `cnpjStates` compartilhados. `purchaseLines` conserva documento, nome, quantidade, componentes monetários selecionados e identidade da linha/importação; não armazena a planilha original. `generations` guarda as empresas selecionadas e os vínculos com as compras, sem duplicar linhas financeiras.
- Cada lote exige empresa ativa, workspace e usuário autenticado. Upload em partes de até 250 linhas, ordem validada, hash da parte e repetição idempotente.
- Até 50.000 linhas e 10 MiB de arquivo. Cada linha admite até R$ 1 bilhão, sem valores negativos; sinais e dados fora do contrato geram erro explícito.
- Conclusão e downloads conciliam linhas, CNPJs únicos, ocorrências, valores e estados da fonte. Divergência ou snapshot parcial bloqueia emissão.
- Relatórios usam apenas estados do mesmo workspace/empresa/consulta, com proteção de sessão, usuário ativo e origem. A conta com troca pendente não acessa dados.
- CSV financeiro: até 2.000 linhas por parte, BOM UTF-8, ponto e vírgula e proteção contra fórmulas. Cada parte é identificada; nenhuma truncagem silenciosa.
- A consulta respeita espaçamento/tentativas da Minha Receita. Não promete processamento instantâneo de grandes lotes ou operação independente da aba.
- Datas fiscais não são deslocadas por fuso; datas de operação são exibidas em Brasília. Referência fiscal desconhecida permanece não informada.

## Compatibilidade e identidade

As consultas cadastrais e a central `/reports.html` continuam acessíveis pelo histórico. Gerações e compras financeiras têm sua própria memória de cálculo. Cadastros, contas e snapshots anteriores são preservados, sem migração destrutiva ou redefinição de senhas.

A identidade usa bordô `#750207`, branco, superfícies claras e ícones na navegação. Logos e PDFs usam imagens locais. As documentações anteriores estão em [`docs/archive/README-v0.6.0.md`](docs/archive/README-v0.6.0.md) e [`docs/archive/README-v0.5.1.md`](docs/archive/README-v0.5.1.md).

## Configuração

Node.js 22 (`>=22.16.0 <23`), Python 3.12 e MongoDB. Copie `.env.example` para arquivo privado:

```env
APP_ORIGIN=https://maximum-cnpj.vercel.app
MONGODB_URI=<conexao-privada>
MONGODB_DB=maximum_cnpj
WORKSPACE_ID=maximum
```

```bash
npm install
python -m pip install -r requirements.txt
npm run build
npm start
```

Na Vercel, `api/index.ts` atende Node e `api/reports.py` atende Python, com rota explícita anterior ao catch-all. O servidor Node local não executa a função Python automaticamente; para as duas funções locais use Vercel dev. Não remova autenticação para corrigir erro de configuração.

## Verificação

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npm run test:lookup-integration
npm run test:purchases-integration
npm run test:generations-integration
REPORT_TEST_MONGO=1 npm run test:reports
npm run test:e2e
```

A validação desta entrega cobre componentes monetários, agrupamento gerencial, compatibilidade dos snapshots anteriores, isolamento das gerações, retomada, PDF Python e fluxo de navegador em computador/celular. Consulte a CI do SHA final para o resultado completo da execução.

Os testes financeiros usam dados sintéticos e fonte simulada. Testes com MongoDB devem usar banco descartável. A CI executa MongoDB 7, Node 22, Python 3.12 e Chromium, incluindo regras financeiras, autenticação, isolamento e navegação. Confira a execução vinculada ao commit entregue; existência de testes não significa aprovação em produção ou homologação fiscal. Arquivos reais de clientes não são versionados.

## Próximas etapas

- [ ] Homologar a importação de vendas com o formato preparado antes de habilitá-la.
- [ ] Definir a próxima etapa após a memória de cálculo consolidada.
- [ ] Fila independente da aba para lotes extensos.
- [ ] Relatórios assíncronos completos/ZIP para grandes volumes.
- [ ] Referência fiscal histórica verificada e futura calculadora tributária, com homologação própria.

README, CHANGELOG e versões Node/Python acompanham cada alteração. Não há envio automático de mensagens, notas ou relatórios a terceiros.
