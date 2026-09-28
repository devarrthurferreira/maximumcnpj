# Maximum CNPJ · v0.3.0

**Hotfix de implantação · static-api-v1 · 28/09/2026**

**Gestão de carteiras, importações e indicadores com Node.js + TypeScript e MongoDB.**

Correção de implantação em **28/09/2026**, identificada pelo SHA do commit e pelo header `X-Maximum-Deployment: static-api-v1`. A versão funcional 0.3.0 foi preservada: não houve alteração das regras do sistema. O escopo continua básico: login, carteiras, importação CSV/XLSX, deduplicação, indicadores declarados, histórico e exportação. Sem Google Cloud, BigQuery ou API fiscal externa.

> **Não há consulta automática ao Simples Nacional.** A informação vem da coluna opcional escolhida na planilha. Sem resposta explícita ou diante de conflito, o resultado é **Não confirmado**. Dados importados não são confirmação fiscal atual.

## 1. Correção do erro 500

Os logs de produção do deployment `dpl_2VzbhqSh51vgCmpbaCsd164RKUG7`, baseado no commit `2c56277568c45abf68f724fbf545a472c9e0ce80`, mostraram falhas em `/` e `/favicon.ico`:

```text
ReferenceError: document is not defined
at file:///var/task/app.js:118:1
```

A implantação estava usando o preset `node` e executando o JavaScript da interface como entrada de servidor. Esse erro ocorria antes de uma consulta ao banco. O objeto `document` pertence ao navegador; esconder o erro com um `typeof document` não entregaria corretamente o painel.

### O que esta versão altera

- `vercel.json` define **`framework: null` (Other)** explicitamente. Isso não remove Node.js: apenas desativa a detecção de um framework de servidor para a interface.
- `public` é o **diretório de saída estática**, não a raiz do projeto. HTML, CSS, JS, Worker e ícone são entregues como arquivos.
- Apenas **`api/index.ts`** é configurado como função Node; o código continua em `src/`.
- Somente `/api/:path*` é encaminhado à função. A raiz e os arquivos visuais não são reescritos para o servidor.
- `/favicon.ico` redireciona para o ícone existente `/favicon.svg`, sem criar outra função.
- O runtime foi restringido à linha **Node.js 22**, a partir de 22.16.0. Removida a definição fixa de memória da função; `maxDuration` permanece em 60 segundos.
- Os headers de segurança também cobrem a interface estática, e as respostas da API usam `no-store`.
- Há testes de regressão de configuração e um comando de verificação HTTP após a implantação.

Não foram alterados os registros do MongoDB, credenciais, senhas, regras fiscais ou permissões dos usuários.

## 2. Configuração exata na Vercel

Importe o repositório inteiro `devarrthurferreira/maximumCNPJ` e mantenha:

| Campo | Valor |
|---|---|
| Root Directory | Raiz do repositório, campo vazio ou `.`; **não usar `public` nem `src`** |
| Framework Preset | **Other**, também fixado no `vercel.json` por `null` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `public` |
| Node.js | 22.x, compatível com `package.json` |
| Production Branch | `main` |

O `vercel.json` precisa ser lido a partir da raiz. Se o projeto tiver sido configurado com Root Directory `public`, corrija esse campo nas configurações da Vercel e publique novamente: o JSON da raiz não consegue corrigir uma raiz externa que o exclui do build.

Em produção, defina no servidor:

```env
APP_ORIGIN=https://maximum-cnpj.vercel.app
MONGODB_URI=SUA_STRING_PRIVADA_DO_MONGODB
MONGODB_DB=maximum_cnpj
WORKSPACE_ID=maximum
NODE_ENV=production
```

`APP_ORIGIN` é a origem exata, sem barra final. Não adicione credenciais do MongoDB ao código, ao README ou a variáveis públicas de frontend. A conexão com o banco continua restrita ao backend. Uma URL de preview exige a origem correspondente para operações autenticadas de escrita.

Após o build, verifique a **nova implantação e seu SHA**, não apenas o estado Ready de uma implantação antiga. Ready indica que o build terminou; não comprova que a função responde corretamente.

## 3. Instalação local e primeiro acesso

Requisitos: Node.js 22.16.0 ou superior **dentro da linha 22**, npm e MongoDB acessível ao servidor.

```bash
npm install
cp .env.example .env
# Preencha a conexão e os dados de provisionamento no .env.
npm run seed
npm run build
npm start
```

Em PowerShell, use `Copy-Item .env.example .env`. Abra `http://localhost:3000`. Para desenvolver, execute `npm run dev`.

| Variável | Finalidade |
|---|---|
| `PORT` | Porta local; padrão 3000 |
| `APP_ORIGIN` | Origem exata; HTTPS em produção |
| `MONGODB_URI` | Conexão privada do banco |
| `MONGODB_DB` | Banco; padrão `maximum_cnpj` |
| `WORKSPACE_ID` | Identificador da instalação |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Apenas para o provisionamento inicial |
| `NODE_ENV` | `production` ativa cookie seguro e exigências de produção |

**Não existe senha padrão.** O seed exige senha de 12 a 128 caracteres e não altera contas existentes. Execute-o uma vez contra o banco correto e remova `ADMIN_PASSWORD` do ambiente após criar o administrador. Não coloque o seed no build de produção nem recrie usuários a cada deploy.

O leitor XLSX e o módulo compartilhado `domain.js` são copiados para `public` no build. Não são baixados de CDN enquanto o usuário usa o painel. O lockfile permanece pendente de versionamento: não mude para `npm ci` sem um `package-lock.json` validado.

## 4. Funcionalidades e fluxo

A navegação oferece **Visão geral**, **Empresas e carteiras**, **Nova importação**, **Bases e histórico** e **Configurações**.

| Área | Recursos atuais |
|---|---|
| Acesso | Login, sessão, logout e troca de senha |
| Equipe | Administrador, operador e visualizador; novo acesso com redefinição inicial |
| Carteiras | Cadastro, edição, observações, responsável opcional com CNPJ e arquivamento |
| Importação | CSV/XLSX, escolha de aba, cabeçalho, CNPJ, nome e Simples opcional |
| Revisão | Linhas, CNPJs únicos, repetições, inválidos e células numéricas |
| Processamento | Páginas locais de até 500 identidades, checkpoint e retomada |
| Indicadores | Última observação por CNPJ, percentuais e preenchimento declarado |
| Histórico | Lotes anteriores preservados; pesquisa, filtros e exportação CSV/XLSX |

```text
Login → cadastrar/escolher a responsável pela base
      → importar planilha e mapear as colunas
      → revisar repetições, inválidos e avisos
      → confirmar o armazenamento no MongoDB
      → processar páginas locais
      → acompanhar indicadores, filtrar e exportar
```

A pergunta **“De qual empresa ou carteira é esta base?”** é obrigatória. O CNPJ da responsável não substitui os documentos da planilha nem é adicionado à consulta silenciosamente.

O binário original não é salvo, mas os valores de **todas as colunas importadas** são armazenados após a confirmação para permitir conferência e exportação. Remova colunas sensíveis/desnecessárias antes de importar.

## 5. Enquadramento, duplicidade e percentuais

A coluna de enquadramento começa desativada. Selecioná-la é uma decisão explícita do usuário, não uma inferência pelo nome ou atividade da empresa.

| Valores reconhecidos, sem distinção de caixa/acentos | Resultado registrado |
|---|---|
| Sim, S, True, 1, Optante, Simples Nacional | Optante, conforme informado |
| Não, N, False, 0, Não optante, NAO_OPTANTE | Não optante, conforme informado |
| Vazio, coluna não escolhida ou outro valor | Não confirmado |

“Lucro real”, “Isento” ou “Talvez” não viram resposta negativa automaticamente. Duas classificações diferentes para o mesmo CNPJ produzem `CONFLITO_NA_PLANILHA` e **Não confirmado**, inclusive preenchido versus desconhecido. Os valores originais são preservados. Não há inferência de MEI em novos lotes.

A identidade é o **CNPJ completo normalizado como texto**, não a raiz de oito posições. Matriz e filial com documentos completos diferentes continuam distintas. Dígitos válidos não comprovam a existência de uma empresa. Zeros perdidos no Excel não são completados por hipótese.

Cada CNPJ válido conta uma vez. Inválidos ficam fora do denominador; linhas repetidas continuam disponíveis na exportação. Os percentuais de optantes, não optantes e não confirmados usam o mesmo total de CNPJs válidos únicos.

Exemplo hipotético: 12.000 linhas com 500 inválidas e 1.500 repetições adicionais correspondem a 10.000 CNPJs únicos. O total global usa a última observação por identidade, não soma reimportações. A mesma regra vale dentro de uma carteira selecionada.

Uma nova base sem enquadramento pode atualizar o indicador atual para Não confirmado: não herdamos dados antigos silenciosamente. A data da importação não é uma data de consulta fiscal. Preenchimento não significa conferência na Receita.

## 6. Arquitetura, limites e retenção

```text
Navegador (arquivos estáticos + Worker)
       ↓ API autenticada
Node.js / TypeScript
       ↓
MongoDB
```

`src/store.ts` concentra conexão e índices. Coleções: `users`, `sessions`, `limits`, `clients`, `batches`, `rows`, `chunks`, `results` e `audit`. Uma instalação atende um workspace; usuários autorizados compartilham suas carteiras. Não existe isolamento privado por carteira no painel.

```text
UPLOADING → PROCESSING → COMPLETED
          ↘ INVALID
Lotes não concluídos → CANCELLED
```

O upload usa posição e hash; reenvios iguais são idempotentes e conteúdos divergentes são recusados. O processamento grava resultados por chave única e checkpoint. Somente lotes completos e reconciliados entram nos indicadores. Reabra o lote para retomar o processamento; não há fila independente do navegador. Se a sessão do upload for perdida, cancele a base parcial e reimporte.

| Limite do código | Valor |
|---|---|
| Arquivo | CSV/XLSX até 10 MiB |
| Linhas / colunas | Até 50.000 / 80 |
| Célula / cabeçalho | 2.000 / 200 caracteres |
| Parte de upload | Até 250 linhas e aproximadamente 2 MB |
| Corpo HTTP | Até 2.800.000 bytes |
| Página de processamento / resultados | 500 / 50 identidades |

São limites configurados, não garantia de desempenho em produção. Linhas vazias são ignoradas; os índices de revisão representam a sequência importada. Fórmulas devem ser convertidas em valores. A proteção preventiva de XLSX recusa macros, proteção e vínculos externos, sem prometer detectar todo arquivo malicioso.

Exportações preservam todas as linhas, incluindo repetições e inválidos, com diagnóstico e origem acrescentados. CSV neutraliza fórmulas potenciais; XLSX escreve texto. Dados não expiram automaticamente. Defina retenção, backup e descarte antes de usar dados reais. Arquivar carteira não é apagar histórico.

## 7. API e segurança

A função `api/index.ts` encaminha para o handler Node em `src/server.ts`. O navegador nunca é importado pelo servidor.

| Rotas | Uso |
|---|---|
| `GET /api/health` | Processo HTTP e versão; não verifica MongoDB |
| `POST /api/auth/login`, `/api/auth/logout`, `/api/auth/password` | Acesso e senha |
| `GET /api/auth/me` | Usuário autenticado |
| `GET /api/dashboard?clientId=` | Indicadores |
| `GET/POST /api/clients`, `PATCH /api/clients/:id` | Carteiras |
| `GET/POST /api/batches` | Listar ou criar importação |
| `POST /api/batches/:id/rows`, `/finalize`, `/process`, `/cancel` | Etapas do lote |
| `GET /api/batches/:id`, `/results`, `/export` | Estado, resultados e exportação |
| `GET /api/settings` | Configuração sem segredos |
| `GET/POST /api/users`, `GET /api/audit` | Administração |

Exceto saúde e login, as rotas exigem sessão. Mutações exigem JSON, origem exata e autorização no servidor. Mantidos scrypt, hashes de tokens, cookies HttpOnly/SameSite/Secure e limites de tentativas/operações. Visualizadores não podem importar ou processar. MFA e recuperação por e-mail ainda não existem; contas podem ser desativadas por administrador do banco com `active=false`, preservando histórico.

## 8. Verificações e diagnóstico

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run smoke -- https://maximum-cnpj.vercel.app
```

`test:deployment` executa isoladamente os testes de configuração. Eles impedem a remoção acidental de `framework: null`, funções para a interface, rewrites globais e perda do ícone/headers. O teste de versão mantém os arquivos alinhados.

`smoke` faz **apenas leituras públicas**, sem senha e sem gravar dados: verifica `/`, JS, CSS, ícones, saúde na versão esperada e resposta 401 da sessão anônima. Ele verifica o header `static-api-v1` e a versão funcional, e falha quando falta o marcador da correção ou há HTML no lugar de JSON. **Não testa conexão com MongoDB, login real ou importação.**

| Evidência | Situação |
|---|---|
| Incidente original | Logs Vercel confirmam `document is not defined` em raiz e ícone |
| CI da base v0.3.0 | Execução `36148532158`, SHA `2c56277`, concluída com sucesso; consultada em 28/09/2026 |
| Testes desta correção | Regras de implantação adicionadas ao `npm test`; consultar também a CI do SHA corrigido |
| Dependências/build local | Registro npm inacessível neste ambiente; sem homologação completa local |
| MongoDB de produção | Não acessado nem alterado nesta correção |
| Aceite de deploy | Verificar nova implantação e executar o smoke no domínio, não reutilizar resultado de outra versão |

A CI anterior é evidência do commit anterior, não do patch. Testes integrados usam MongoDB efêmero; nunca use banco de produção. Uma execução só é aprovada quando o resultado do SHA correspondente confirma isso.

| Erro | Verificação |
|---|---|
| `document is not defined` | Preset e raiz do projeto; não executar `public/app.js` como servidor |
| HTML abre, mas `/api/health` falha | Verificar função `api/index.ts`, build e roteamento |
| `/api/auth/me` retorna 401 sem login | Comportamento esperado; não liberar acesso anônimo para esconder o erro |
| 503 em operação de banco | MongoDB, rede, credenciais e permissões; não é o mesmo erro da interface |
| `ORIGIN` / 403 | `APP_ORIGIN` com domínio e protocolo exatos |
| `LEGACY_BATCH` | Reimportar no fluxo básico; registro antigo não é convertido automaticamente |
| `IMPORT_CONFLICT`, `RESULT_COUNT`, `BATCH_BUSY` | Mapeamento divergente, reconciliação ou operação simultânea; conferir o lote antes de repetir |
| XLSX/`domain.js` ausente | Conferir `npm run build` e saída `public` |

## 9. Histórico, versionamento e próximos passos

O [manual v0.3.0](docs/archive/README-v0.3.0.md) foi preservado integralmente. O Git e o CHANGELOG conservam as entregas anteriores. Esta correção não apaga dados nem transforma lotes antigos incompletos. Cancelar localmente não encerra um eventual job legado em outro serviço.

Toda mudança relevante deve atualizar README, CHANGELOG, versão e testes no mesmo commit. Não fazer force-push nem substituir alterações concorrentes. A licença do código próprio não foi alterada.

Próximas etapas: confirmar o deploy corrigido, validar login e uma base real autorizada, medir tempo/memória na hospedagem e versionar o lockfile validado. Depois evoluir campos, filtros e comparação por CNPJ. Consulta externa, fila autônoma, recuperação/MFA, exclusão definitiva e calculadora tributária continuam fora do escopo básico.

Referência de implantação: [configuração oficial da Vercel](https://vercel.com/docs/project-configuration/vercel-json), especialmente `framework`, `outputDirectory`, `functions`, `rewrites` e `redirects`. A escolha de Other não impede funções Node.js em `api/`.
