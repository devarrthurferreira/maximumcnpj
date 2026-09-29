# Maximum CNPJ · v0.6.0

Node.js + TypeScript + MongoDB para consultas e histórico. Python para PDFs. Identidade Maximum, empresas compartilhadas no mesmo workspace e acesso autenticado. Sem Google Cloud.

## Entrega de 29/09/2026

- [x] 18 operadores tributários Maximum e administrador de programação, por provisionamento aditivo.
- [x] Senha temporária da equipe com redefinição obrigatória antes de acessar dados, consultas ou relatórios.
- [x] Empresas existentes preservadas; seleção obrigatória de Código · Empresa antes de importar compras.
- [x] Compras em CSV, XLS e XLSX: fornecedor A, razão social I, quantidade P, valor total Q.
- [x] Consulta dos CNPJs únicos na Minha Receita, percentuais por fornecedor e por valor, histórico financeiro por empresa.
- [x] CPF/outros documentos e consultas não confirmadas separados dos optantes e não optantes.
- [x] PDF de compras e CSV em partes, gerados a partir do snapshot salvo.
- [x] Vendas indisponível na interface e bloqueada na API.

Os resultados refletem a resposta da base Minha Receita na data da consulta. Não comprovam o regime na data da nota e não constituem histórico fiscal oficial. Ausência, erro e resposta desconhecida nunca são classificados como “não optante”.

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

## Compras: uso e cálculos

1. Entre no sistema e conclua a redefinição quando solicitada.
2. Abra **Compras e vendas** (`/purchases.html`).
3. Selecione explicitamente a empresa pelo código e nome. O nome do arquivo não escolhe a responsável.
4. Deixe **Compras** selecionado. Vendas aparece indisponível nesta versão.
5. Envie o arquivo, confira a aba/cabeçalho, a prévia, os valores e os documentos não consultáveis.
6. Inicie a importação e acompanhe a consulta dos CNPJs. A página conduz a fila; fechar a aba pausa sua continuidade. O histórico permite retomar consultas que ainda estão em processamento.
7. Ao concluir, confira os grupos, a relação por fornecedor/linhas e baixe PDF ou CSV. Uma nova importação consulta a fonte novamente; abrir ou exportar o histórico não consulta novamente.

| Coluna | Conteúdo | Regra |
|---|---|---|
| A | Documento do fornecedor | CNPJ completo normalizado; não usar outra coluna com o mesmo cabeçalho |
| I | Razão social | Nome informado para conferência; não determina enquadramento |
| P | Quantidade | Decimal, até 6 casas; preservada por linha |
| Q | Valor Total | Valor da linha, convertido para centavos inteiros e somado uma única vez |

**Q não é multiplicado por P.** Uma nota pode aparecer em várias linhas de produtos. Não eliminamos essas linhas nem seus valores por repetição de fornecedor ou número da nota. O CNPJ é deduplicado somente na consulta e na contagem de fornecedores; matriz e filial com CNPJs completos diferentes contam separadamente.

| Indicador | Numerador | Denominador |
|---|---|---|
| % de fornecedores optantes | CNPJs distintos com resposta optante | Todos os CNPJs válidos distintos, inclusive não confirmados |
| % de fornecedores não optantes | CNPJs distintos com resposta não optante | A mesma base de CNPJs válidos distintos |
| % financeiro do grupo | Soma de Q das linhas dos fornecedores desse grupo | Soma de Q de todas as linhas com CNPJ válido, inclusive não confirmados |
| Valor total importado | Soma de Q de todas as linhas | Não se aplica; inclui CPF/outros documentos |

CPF, CNO e documentos inválidos não são enviados à API CNPJ e não entram nos percentuais de enquadramento. Seus valores permanecem no total importado e em um grupo separado. Uma base contendo apenas esses documentos gera relatório com denominador CNPJ zero, sem divisão por zero ou classificação inventada. Não confirmados permanecem com valor e contagem próprios.

CSV admite UTF-8 e Windows-1252, inclusive detecção automática, separador ponto e vírgula e números brasileiros. Linhas inteiramente vazias são ignoradas; linhas com conteúdo incompleto ou valores inválidos bloqueiam a importação, com indicação do erro. Fórmulas nas colunas usadas devem ser convertidas para valores antes do envio. Não há inferência pelo campo Contribuinte ICMS ou por coluna RESPOSTA.

## Dados, segurança e limites

- Coleções `clients`, consultas antigas e estados existentes são mantidos. Nenhuma migração destrutiva.
- Compras usam `lookupJobs.mode=PURCHASES_V1`, `lookupItems` e `cnpjStates` compartilhados. `purchaseLines` conserva apenas documento, nome, quantidade, centavos e identidade da linha/importação; não armazena a planilha original nem colunas adicionais.
- Cada lote exige empresa ativa, workspace e usuário autenticado. Upload em partes de até 250 linhas, ordem validada, hash da parte e repetição idempotente.
- Até 50.000 linhas e 10 MiB de arquivo. Cada linha admite até R$ 1 bilhão, sem valores negativos; sinais e dados fora do contrato geram erro explícito.
- Conclusão e downloads conciliam linhas, CNPJs únicos, ocorrências, valores e estados da fonte. Divergência ou snapshot parcial bloqueia emissão.
- Relatórios usam apenas estados do mesmo workspace/empresa/consulta, com proteção de sessão, usuário ativo e origem. A conta com troca pendente não acessa dados.
- CSV financeiro: até 2.000 linhas por parte, BOM UTF-8, ponto e vírgula e proteção contra fórmulas. Cada parte é identificada; nenhuma truncagem silenciosa.
- A consulta respeita espaçamento/tentativas da Minha Receita. Não promete processamento instantâneo de grandes lotes ou operação independente da aba.
- Datas fiscais não são deslocadas por fuso; datas de operação são exibidas em Brasília. Referência fiscal desconhecida permanece não informada.

## Módulos existentes

O painel principal mantém **Empresas e códigos**, **Nova consulta**, indicadores gerais e histórico cadastral. A central `/reports.html` mantém relatórios cadastrais por consulta, enquadramento e tipo informado, com PDF Python e CSV. Compras têm histórico e saída financeira próprios para não abrir um relatório financeiro como se fosse somente uma lista cadastral.

A identidade usa bordô `#750207`, branco e tons de apoio, com logo local e símbolo Maximum. PNGs e PDFs não dependem de imagem remota. A documentação operacional completa da v0.5.1 foi preservada em [`docs/archive/README-v0.5.1.md`](docs/archive/README-v0.5.1.md).

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
REPORT_TEST_MONGO=1 npm run test:reports
npm run test:e2e
```

As execuções de validação aprovaram as regras, o build e todas as integrações Node/Python com MongoDB. A revisão de navegador inclui subrotas de upload, downloads e verificação de largura móvel: tabelas extensas rolam dentro do próprio cartão de importação. Consulte a CI do SHA final para a verificação completa.

Os testes financeiros usam dados sintéticos e fonte simulada. Testes com MongoDB devem usar banco descartável. A CI executa MongoDB 7, Node 22, Python 3.12 e Chromium, incluindo regras financeiras, autenticação, isolamento e navegação. Confira a execução vinculada ao commit entregue; existência de testes não significa aprovação em produção ou homologação fiscal. Arquivos reais de clientes não são versionados.

## Próximas etapas

- [ ] Especificar e homologar o relatório de vendas antes de habilitá-lo.
- [ ] Fila independente da aba para lotes extensos.
- [ ] Relatórios assíncronos completos/ZIP para grandes volumes.
- [ ] Referência fiscal histórica verificada e futura calculadora tributária, com homologação própria.

README, CHANGELOG e versões Node/Python acompanham cada alteração. Não há envio automático de mensagens, notas ou relatórios a terceiros.
