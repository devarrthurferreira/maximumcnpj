# Maximum CNPJ · v0.12.0

Node.js + TypeScript + MongoDB para consultas e histórico. Python para PDFs. Identidade Maximum, empresas compartilhadas no mesmo workspace e acesso autenticado. Sem Google Cloud.

## Entrega de 30/09/2026 — período fiscal pela coluna H e RBT12 do Simples

- [x] **Coluna H — Data Escrituração/Serviço** passou a fazer parte do contrato de compras e vendas nas novas importações NET_V2. A data é normalizada sem deslocamento de fuso e preservada em cada linha.
- [x] O sistema identifica automaticamente a primeira e a última data do arquivo e calcula o intervalo mensal inclusivo, aceitando de **1 a 12 meses**. Intervalos acima de 12 meses são bloqueados; meses sem movimento dentro do intervalo ficam sinalizados.
- [x] Compras e vendas precisam pertencer exatamente ao mesmo intervalo para abrir o simulador. Quando ambos os snapshots têm a coluna H, a quantidade de meses fica automática e não depende mais de digitação do usuário. Históricos antigos continuam com confirmação manual para compatibilidade.
- [x] CSV, prévia, histórico e PDF financeiro preservam/exibem o período fiscal. A fórmula financeira continua **Q − Y + AA − AB**; a coluna H só define o período.
- [x] Novo leitor Python para **Extrato do Simples Nacional (PGDAS-D)**: tenta texto nativo com PyMuPDF e, quando o PDF é digitalizado, usa OCR como fallback.
- [x] O leitor extrai PA, CNPJ básico, empresa, RPA, **RBT12**, RBA, RBAA, limite e receitas anteriores disponíveis. Quando as 12 competências anteriores ao PA estão legíveis, soma e concilia com a RBT12 impressa.
- [x] O PDF do Simples é processado em memória; o MongoDB guarda apenas resultado estruturado, referência da leitura e hash SHA-256, não o arquivo fiscal original.
- [x] O simulador ganhou campo de RBT12 com preenchimento manual ou pelo PDF. Novos cenários usam a RBT12 informada/extraída nas faixas do Simples; snapshots antigos continuam reproduzíveis com a estimativa histórica.
- [x] A leitura do PDF fica vinculada à empresa e ao valor utilizado. Se a RBT12 for editada manualmente depois da leitura, o vínculo é removido e o cenário passa a registrar origem manual.

### Período dos relatórios

Para novas importações, o período é derivado da **menor e da maior Data Escrituração/Serviço (H)** do próprio arquivo. A quantidade de meses é inclusiva: por exemplo, 15/06/2026 a 20/08/2026 representa 3 meses (junho, julho e agosto), mesmo que julho não tenha lançamentos; nesse caso julho aparece como mês sem movimento. A ausência de movimento não reduz artificialmente o divisor mensal.

| Coluna | Compras | Vendas | Uso |
|---|---|---|---|
| H | Data Escrituração/Serviço | Data Escrituração/Serviço | Define o período real do relatório (1–12 meses) |

Compras e vendas de uma mesma simulação devem ter a mesma data inicial, data final e quantidade de meses. Isso evita dividir totais por um período escolhido manualmente que não corresponda aos arquivos.

Na emissão e no simulador, o backend reconcilia novamente o período persistido com as datas das linhas; snapshot incompleto ou divergente é bloqueado em vez de seguir com um divisor incorreto.

### RBT12 pelo Extrato do Simples

No simulador, selecione o **Extrato do Simples Nacional em PDF** e use **Ler RBT12 do PDF**. O endpoint autenticado POST /api/simples?clientId=... recebe somente PDF de até 8 MiB, valida sessão/origem/empresa, extrai os dados e devolve a RBT12 em centavos. PDFs pesquisáveis usam texto nativo; documentos escaneados usam OCR.

A RBT12 usada no cálculo é a **receita bruta acumulada nos 12 meses anteriores ao PA**, separada da projeção de faturamento anual do cenário. A projeção continua mostrando receita mensal × 12 para leitura gerencial, mas não substitui a RBT12 quando esta foi informada ou extraída.
## Entrega de 30/09/2026 — gráficos e histórico completo do simulador

- [x] Painel visual do simulador com comparação dos regimes e composição de receitas, compras e despesas, em visualização anual ou mensal.
- [x] Histórico persistente de simulações no MongoDB, com busca por empresa/título e filtro por ano.
- [x] Cada simulação registra os campos informados, período, relatórios de origem, ajustes, premissas, versão do motor, resultados, gráficos reproduzíveis, avisos e memória de cálculo.
- [x] Reabertura por link próprio sem recalcular nem consultar novamente a fonte; nova versão preserva integralmente o cenário anterior.
- [x] Avisos reunidos em uma única faixa expansível que exibe todos os detalhes ao abrir.
- [x] Cálculo e validação no servidor; sessão, permissões, workspace, conciliação e repetição idempotente protegem o histórico.

### Importação e simulador preenchido

- [x] Fluxo guiado: empresas → compras → vendas → simulador, com retomada pelo histórico.
- [x] Botão **Ir para o simulador** abaixo de cada empresa, liberado após as duas consultas concluídas. Uma empresa pronta pode ser simulada enquanto outras continuam pendentes.
- [x] Cinco valores reconciliados no servidor: vendas Optantes SN, vendas Não Optantes SN, vendas de CPFs, compras do Simples e compras fora do Simples.
- [x] Não confirmados ficam em Não optantes; apenas CNPJs com opção confirmada ficam em Simples. CPF tem grupo próprio nas vendas. Todas as linhas financeiras continuam somadas.
- [x] Simulador da calculadora Maximum integrado: serviços, vendas, compras, salários/pró-labore, benefícios, despesas, aluguel, taxas, 2027/2028 e anexos I/II/III/IV/V.
- [x] Período confirmado pelo usuário; totais dos arquivos viram média mensal conforme a quantidade de meses. Receita anual estimada = mensal × 12.
- [x] Quatro cenários, memória de cálculo exportável e DRE no final com Indicador fixo na rolagem horizontal.
- [x] Motor original reproduzido com testes de regressão; documentação técnica em [docs/calculadora-tributaria.md](docs/calculadora-tributaria.md).

### Leitura e histórico preservados

- [x] Navegação unificada: **Navegação → Início, Empresas**; **Geração → Iniciar, Histórico, Simulações**.
- [x] Seleção de várias empresas e geração salva antes do envio, com escolha de compras, vendas ou ambos e acompanhamento dos relatórios que faltam.
- [x] Histórico para abrir gerações, adicionar compras e vendas pendentes e retomar consultas.
- [x] Novo total financeiro: **Q − Y + AA − AB**, em centavos inteiros. Z é informação de conferência, fora da fórmula.
- [x] Compras têm dois grupos: **Simples** somente para OPTANTE explícito e **Não optante** para os demais. Nas vendas, **CPFs** são um terceiro grupo separado. CNO, inválidos/ausentes e não confirmados permanecem em Não optante. A situação original continua preservada.
- [x] Recuperação automática de separadores extras na descrição do CSV do modelo conhecido, com validação do alinhamento e indicação das linhas recuperadas antes de confirmar.
- [x] PDF Python com memória de cálculo por empresa e consolidado da geração concluída.
- [x] Vendas disponível: importação, consultas de compradores, histórico, CSV e PDF com a mesma regra financeira de compras.
- [x] Acessos da equipe, troca obrigatória, empresas existentes e relatórios anteriores preservados.

Os resultados refletem a resposta da base Minha Receita na data da consulta. A inclusão de outros documentos e não confirmados em Não optante, e de CPF nesse grupo somente nas compras, é uma regra gerencial solicitada pela Maximum; ela não altera o retorno da fonte nem representa uma consulta fiscal de CPF. O enquadramento observado não comprova o regime na data da nota.

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
3. Escolha os relatórios de **Compras**, **Vendas** ou ambos e inicie a geração. O rascunho fica salvo com os espaços correspondentes para cada empresa selecionada.
4. Adicione cada relatório à empresa e ao tipo correspondente, confira aba/cabeçalho e prévia, depois confirme a importação. Compras consulta fornecedores; vendas consulta compradores.
5. Acompanhe as consultas. A página conduz a fila; fechar a aba pausa sua continuidade. No **Histórico**, abra a geração para adicionar relatórios faltantes ou retomar consultas em processamento.
6. Quando todos os relatórios escolhidos de todas as empresas estiverem concluídos, baixe o **PDF Python da geração** com os cálculos de cada empresa. São até 10 empresas por parte, com partes numeradas quando necessário.
7. O detalhe de cada relatório conserva PDF individual, fornecedores ou compradores agrupados, linhas importadas e CSV em partes. Compras e vendas têm totais separados. Com ambos concluídos, clique em **Ir para o simulador** para calcular cenários gerenciais a partir deles.
8. Gerações anteriores continuam exigindo somente compras. Ao adicionar vendas a uma delas, vendas passa a ser necessária para todas as empresas dessa geração antes de emitir o novo consolidado. Os PDFs individuais de compras continuam acessíveis.

| Coluna | Compras | Vendas | Uso |
|---|---|---|---|
| A | CNPJ do fornecedor | CNPJ do comprador | Identidade completa, normalizada |
| H | Data Escrituração/Serviço | Data Escrituração/Serviço | Período fiscal real da linha e do relatório |
| I | Razão social | Comprador | Nome informado, sem inferir enquadramento |
| P | Quantidade | Opcional | Preservada; não multiplica os valores |
| Q | Valor Total | Valor Total | Valor bruto da linha |
| Y | Valor Desconto | Valor Desconto | Subtraído |
| Z | Despesa Acessória | Despesa Acessória | Conferência; não participa da fórmula |
| AA | Valor Frete | Valor Frete | Somado |
| AB | Abatimento não Tributado | Abatimento não Tributado | Subtraído |

**Novo Total = Q − Y + AA − AB.** A aplicação lê os componentes separadamente e recalcula no servidor. Ajustes vazios em colunas presentes equivalem a zero; colunas necessárias ausentes, valores inválidos e resultado negativo bloqueiam a linha para correção. Não há multiplicação por P nem redução silenciosa a zero.

Uma nota pode aparecer em várias linhas de produtos: todas as linhas e seus valores são preservados. O CNPJ é deduplicado somente para consulta. Na contagem de compradores/fornecedores do relatório financeiro, cada documento normalizado conta uma vez, inclusive CPF. Cada linha sem documento tem identidade própria para não unir pessoas desconhecidas. Matriz e filial com CNPJs completos diferentes contam separadamente.

| Indicador | Numerador | Denominador |
|---|---|---|
| % de documentos Simples | CNPJs distintos com resposta OPTANTE | Todos os documentos distintos do arquivo; cada linha sem documento conta individualmente |
| % de documentos Não optante | Demais documentos e não confirmados; CPF incluso somente nas compras | A mesma base de documentos |
| % de documentos CPF (vendas) | CPFs distintos | A mesma base de documentos |
| % financeiro do grupo | Novo Total das linhas pertencentes ao grupo | Novo Total de todas as linhas do arquivo |
| Total importado | Novo Total de todas as linhas | Não se aplica |

Os grupos somam o valor integral do arquivo. Compras preservam dois grupos com complemento do percentual arredondado. Vendas têm três grupos (Simples, Não optante e CPF), com distribuição do resíduo de arredondamento pelos maiores restos. Percentuais somam 100% quando a base é positiva; com base zero são todos zero. O denominador inclui todos os documentos ou todo o valor do arquivo.

CPF, CNO e documentos inválidos não são enviados à API CNPJ. Nas compras todos integram Não optante, com subtotal de conferência; nas vendas CPF fica separado, e os demais continuam em Não optante. O retorno não confirmado da fonte também aparece nesse grupo. Detalhes e CSV conservam a situação original; os relatórios cadastrais anteriores continuam usando seu universo de CNPJs armazenados, sem reconstruir documentos descartados em versões anteriores.

Novas importações usam `calculationVersion=NET_V2`. Relatórios anteriores sem essa marca continuam sob a regra `Q_V1` (soma de Q), com identificação da regra original. Seus descontos, fretes e abatimentos não eram armazenados; por isso, uma nova importação é necessária para obter a nova conta. Nenhum histórico é recalculado com valores inventados.

CSV admite UTF-8 e Windows-1252, separador ponto e vírgula e números brasileiros. Linhas completamente vazias são ignoradas. No modelo conhecido com Descrição em O, Quantidade em P, Valor Total em Q, Código Empresa em AC e Chave Lançamento em AD, separadores extras dentro da descrição podem ser recuperados automaticamente quando o alinhamento é inequívoco, o código corresponde à empresa selecionada e os valores são válidos. A prévia identifica as linhas recuperadas; nenhuma venda é descartada. Planilhas XLS/XLSX e formatos diferentes não recebem essa recuperação de CSV. Casos ambíguos, campos faltantes, fórmulas ou valores incorretos continuam bloqueados.

O arquivo original permanece local. Para produzir um CSV já alinhado, a origem deve envolver descrições que contenham ponto e vírgula em aspas duplas. A exportação direta em XLSX com campos nas colunas correspondentes também é aceita.

## Como usar o simulador

1. Em **Geração → Iniciar**, selecione a empresa e mantenha Compras e Vendas marcadas.
2. Adicione compras, confira a prévia e conclua a consulta. Use **Continuar: importar vendas** para o segundo arquivo; cada arquivo é validado individualmente.
3. Ao concluir os dois arquivos, clique em **Ir para o simulador** no relatório ou abaixo da empresa na geração.
4. Em novas importações, confira o período identificado automaticamente pela coluna H; compras e vendas devem coincidir. Históricos sem essa informação mantêm a confirmação manual de 1 a 12 meses. Os cinco campos ficam preenchidos com totais/médias mensais e o arredondamento em centavos preserva a soma dos grupos.
5. Informe a RBT12 manualmente ou leia o Extrato do Simples Nacional em PDF. O sistema registra a origem do valor e, quando possível, concilia as 12 competências anteriores ao PA.
6. Informe receitas de serviços e despesas mensais; use zero explicitamente quando não houver. Não repita serviços já contidos nas vendas. Ajustes são permitidos sem alterar os relatórios de origem.
7. Escolha ano/anexos e gere a simulação. Os três grupos de vendas somam a Receita de vendas; o enquadramento do comprador não altera as alíquotas deste modelo.
8. Ao gerar, o sistema calcula e salva o cenário no servidor. Aguarde a confirmação de salvamento; se a rede falhar, use a opção de tentar novamente sem duplicar a simulação.
9. Confira os gráficos, os quatro cenários e a faixa única de avisos. A DRE fica ao final; Indicador permanece fixo na rolagem horizontal.
10. No menu **Simulações**, busque a empresa ou título, filtre o ano e use **Rever simulação**. Os detalhes refletem exatamente o cenário salvo. **Criar nova versão** abre uma cópia editável e conserva a original. A memória completa continua exportável em JSON.

O simulador usa o motor e as premissas da calculadora Maximum, não constitui apuração fiscal. Bases de crédito presumidas pelo modelo não comprovam direito a crédito. Serviços/despesas não são inferidos dos arquivos. Para novas simulações, a referência de RBT12 é informada manualmente ou extraída do Extrato do Simples; a receita anual projetada do painel continua sendo receita mensal × 12. Snapshots legados preservam a estimativa anterior para reprodução histórica. Rascunhos de edição continuam na aba, separados por usuário/empresa/geração/relatórios; resultados concluídos passam a ser salvos no MongoDB. Uma alteração exige gerar e salvar uma nova versão, sem modificar o resultado anterior. Simulações da v0.10.0 que nunca foram salvas no servidor não podem ser reconstruídas automaticamente; abra a geração e gere novamente para registrar o cenário no novo histórico.

O endpoint autenticado `GET /api/v4/generations/:id/simulator?clientId=...` deriva os cinco campos dos snapshots reconciliados no servidor. Ambos devem ser NET_V2 e pertencer à mesma empresa, workspace e geração. Relatórios antigos Q_V1 permanecem acessíveis, mas exigem nova importação para simular.

## Histórico do simulador

`POST /api/v4/simulations` aceita os campos de entrada, cinco grupos mensais e período confirmado. O servidor valida os vínculos, concilia os relatórios, calcula o resultado com o motor compartilhado e grava um snapshot imutável em `simulations`. Não aceita resultados ou fontes enviados pelo navegador como verdade.

`GET /api/v4/simulations` oferece paginação de 20 itens, busca e filtros de empresa/ano. `GET /api/v4/simulations/:id` recupera o snapshot original, incluindo autor, data, grupos originais/mensais, ajustes, parâmetros efetivos, versão e memória. Não reidrata a fonte nem recalcula históricos. Operadores/administradores podem gerar; visualizadores podem consultar. Nenhum endpoint sobrescreve ou exclui cenários.

A repetição do mesmo pedido com o mesmo UUID retorna o mesmo registro; mudanças nesse UUID geram conflito. Um cenário derivado recebe novo UUID e vínculo com a simulação anterior. As respostas e gravações permanecem isoladas por workspace.

## Dados, segurança e limites

- Coleções `clients`, consultas antigas e estados existentes são mantidos. Nenhuma migração destrutiva.
- Compras usam `lookupJobs.mode=PURCHASES_V1` e vendas `SALES_V1`, com `lookupItems` e `cnpjStates` compartilhados. `purchaseLines` conserva documento, nome, quantidade, componentes monetários selecionados e identidade da linha/importação; não armazena a planilha original. `generations` guarda as empresas selecionadas, os tipos exigidos e os vínculos com compras e vendas, sem duplicar linhas financeiras. Os endpoints validam o tipo do lote para impedir mistura entre compras e vendas.
- Cada lote exige empresa ativa, workspace e usuário autenticado. Upload em partes de até 250 linhas, ordem validada, hash da parte e repetição idempotente.
- Até 50.000 linhas e 10 MiB de arquivo. Cada linha admite até R$ 1 bilhão, sem valores negativos; sinais e dados fora do contrato geram erro explícito.
- Conclusão e downloads conciliam linhas, CNPJs únicos, ocorrências, valores e estados da fonte. Divergência ou snapshot parcial bloqueia emissão.
- Relatórios usam apenas estados do mesmo workspace/empresa/consulta, com proteção de sessão, usuário ativo e origem. A conta com troca pendente não acessa dados.
- CSV financeiro: até 2.000 linhas por parte, BOM UTF-8, ponto e vírgula e proteção contra fórmulas. Cada parte é identificada; nenhuma truncagem silenciosa.
- A consulta respeita espaçamento/tentativas da Minha Receita. Não promete processamento instantâneo de grandes lotes ou operação independente da aba.
- Datas fiscais não são deslocadas por fuso; datas de operação são exibidas em Brasília. Referência fiscal desconhecida permanece não informada.

## Compatibilidade e identidade

As consultas cadastrais e a central `/reports.html` continuam acessíveis pelo histórico. Gerações, compras e vendas financeiras têm sua própria memória de cálculo. PDFs de vendas da v0.8.0 sem o tipo redundante nas linhas continuam compatíveis, e novas gravações preservam esse campo. Cadastros, contas e snapshots anteriores são preservados, sem migração destrutiva ou redefinição de senhas.

A identidade usa bordô `#750207`, branco, superfícies claras e ícones na navegação. Logos e PDFs usam imagens locais. As documentações anteriores estão em [`docs/archive/README-v0.8.1.md`](docs/archive/README-v0.8.1.md), [`docs/archive/README-v0.7.0.md`](docs/archive/README-v0.7.0.md), [`docs/archive/README-v0.6.0.md`](docs/archive/README-v0.6.0.md) e [`docs/archive/README-v0.5.1.md`](docs/archive/README-v0.5.1.md).

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
npm run test:simulations-integration
REPORT_TEST_MONGO=1 npm run test:reports
npm run test:e2e
```

Após publicar, `npm run smoke -- https://maximum-cnpj.vercel.app` confere a versão, o painel, os arquivos do simulador/histórico e a exigência de login na API. São apenas leituras públicas, sem usar dados reais de clientes.

A validação desta entrega cobre os cinco campos do simulador, três grupos de vendas, documentos repetidos, conciliação entre Node/Python, rejeição de snapshots incompletos ou cruzados, conversão mensal, motor original, autenticação, retomada e fluxo de navegador em computador/celular. Consulte a CI do SHA final para o resultado completo da execução.

Os testes financeiros usam dados sintéticos e fonte simulada. Testes com MongoDB devem usar banco descartável. A CI executa MongoDB 7, Node 22, Python 3.12 e Chromium, incluindo regras financeiras, autenticação, isolamento e navegação. Confira a execução vinculada ao commit entregue; existência de testes não significa aprovação em produção ou homologação fiscal. Arquivos reais de clientes não são versionados.

## Próximas etapas

- [x] Integrar simulador e pré-preenchimento a partir de compras e vendas.
- [x] Persistência central de cenários, reabertura detalhada e novas versões sem sobrescrever as anteriores.
- [ ] Comparação direta entre diferentes versões/anos de uma mesma empresa.
- [ ] Fila independente da aba para lotes extensos.
- [ ] Relatórios assíncronos completos/ZIP para grandes volumes.
- [ ] Referência fiscal histórica verificada e homologação fiscal própria das premissas do simulador.

README, CHANGELOG e versões Node/Python acompanham cada alteração. Não há envio automático de mensagens, notas ou relatórios a terceiros.
