# Maximum CNPJ · v0.3.0

**Gestão básica de carteiras, importações e indicadores com Node.js + MongoDB.**

Esta revisão simplifica o sistema para começar com o essencial. Não exige Google Cloud, BigQuery, chave de API fiscal ou outro banco. Mantém login, carteiras, importação CSV/XLSX, identificação de repetições, indicadores, histórico e exportação.

> **Não há consulta automática ao Simples Nacional nesta versão.** O sistema organiza dados fornecidos na planilha. Sem uma coluna explícita de enquadramento, o resultado é **Não confirmado**. Informação importada não é confirmação fiscal atual.

| Controle | Situação |
|---|---|
| Versão | **0.3.0 — modo básico; validação integrada pendente** |
| Atualização | **25/09/2026** |
| Backend | Node.js + TypeScript |
| Banco | MongoDB |
| Interface | HTML/CSS/JavaScript, com leitura de planilhas em Web Worker |
| Consulta externa | Nenhuma |
| Testes locais | **15 aprovados, 0 falhas** |
| Build, MongoDB e E2E completos | Ainda não validados nesta entrega |
| Deploy | Não realizado nesta entrega |

## 1. Mudança de escopo

O responsável pediu Node.js e MongoDB com o básico, sem Google Cloud. Esta versão remove o adaptador externo em vez de substituí-lo silenciosamente por outra API. Os requisitos do planejamento v0.1.0 e da v0.2.0 que dependiam de BigQuery são históricos, não requisitos atuais.

O README e o CHANGELOG da publicação anterior foram preservados em `docs/archive/README-v0.2.0.md` e `docs/archive/CHANGELOG-v0.2.0.md`. Nenhum dado existente no MongoDB é apagado pela atualização.

O programa antigo mencionado na conversa não estava disponível como novo anexo. Esta revisão usa o código do Maximum CNPJ publicado; não afirma ter incorporado um arquivo legado não recebido.

## 2. O que está implementado

| Área | Recursos |
|---|---|
| Acesso | Login, sessão persistida, logout, perfis e troca de senha |
| Equipe | Administrador, operador e visualizador; novo acesso com redefinição obrigatória |
| Empresas e carteiras | Cadastro, edição, observações, CNPJ responsável opcional e arquivamento |
| Importação | CSV/XLSX, aba, cabeçalho, colunas de CNPJ, nome e Simples opcional |
| Revisão | Linhas, únicos, repetições, inválidos e avisos sobre células numéricas |
| Processamento | Validação no Node.js e páginas de até 500 CNPJs únicos no MongoDB |
| Indicadores | Último registro por identidade, percentuais e preenchimento do enquadramento |
| Histórico | Lotes anteriores preservados, filtrados por carteira e paginados |
| Resultados | Busca por CNPJ/nome, filtro de situação, exportação CSV/XLSX |

A navegação foi reduzida a **Visão geral**, **Empresas e carteiras**, **Nova importação**, **Bases e histórico** e **Configurações**. A permissão para escrever é verificada no servidor, não somente pelos botões.

Não estão implementados: consulta oficial ou de fornecedor, base completa da Receita, agendamento, alertas, comparação individual entre snapshots, recuperação de senha por e-mail, MFA, exclusão definitiva pelo painel, edição de enquadramento depois de concluir o lote e calculadora tributária. O modo fictício de demonstração anterior foi removido.

## 3. Fluxo do usuário

```text
Login → escolher/cadastrar carteira responsável
      → selecionar CSV/XLSX e mapear colunas
      → revisar únicos, repetições e inválidos
      → confirmar armazenamento no MongoDB
      → organizar os CNPJs em páginas
      → acompanhar, filtrar e exportar
```

**“De qual empresa ou carteira é esta base?”** é obrigatório antes de salvar. A responsável pode ser um cliente, grupo ou lista de fornecedores. Seu CNPJ cadastral não é adicionado silenciosamente às linhas consultáveis.

A confirmação envia os valores de **todas as colunas importadas** ao servidor. Remova colunas sensíveis/desnecessárias antes de importar. O binário original não é armazenado, mas seus valores são persistidos para preservar a exportação.

## 4. Enquadramento informado na planilha

A coluna de Simples é opcional e começa em **Não utilizar — manter não confirmado**. O usuário precisa selecioná-la explicitamente. Não inferimos enquadramento pelo nome, CNPJ, atividade ou situação cadastral.

| Valores aceitos, sem distinção de caixa/acentos | Resultado |
|---|---|
| Sim, S, True, 1, Optante, Simples Nacional | Optante, conforme informado |
| Não, N, False, 0, Não optante, NAO_OPTANTE | Não optante, conforme informado |
| Vazio, coluna não mapeada ou outro valor | Não confirmado |

Termos como “Lucro real”, “Isento” ou “Talvez” não viram resposta negativa. Padronize explicitamente outras convenções na origem.

Se duas linhas do mesmo CNPJ tiverem classificações diferentes, o resultado será **Não confirmado / CONFLITO_NA_PLANILHA**. Também há conflito entre uma linha preenchida e outra desconhecida. Concordâncias contam uma vez. Os valores originais continuam exportáveis. Novos lotes não inferem MEI.

## 5. Identidade, repetições e indicadores

A identidade é o **CNPJ completo**, normalizado como texto. Diferenças de máscara ou caixa não criam outra empresa. Matriz e filial com documentos completos diferentes continuam distintas. A validação numérica/alfanumérica existente foi mantida; dígito verificador correto não comprova existência da empresa.

Todas as linhas são preservadas. Inválidos ficam fora do denominador e repetições não aumentam o número de CNPJs. Os três percentuais usam o total de CNPJs válidos únicos, incluindo não confirmados.

Exemplo hipotético: 12.000 linhas, 500 inválidas e 1.500 repetições adicionais resultam em 10.000 CNPJs únicos para indicadores. O total global usa a última observação por CNPJ, não a soma dos lotes. O filtro por carteira aplica a mesma regra dentro dela.

Uma nova importação sem enquadramento pode tornar o indicador atual **Não confirmado**, mesmo quando o histórico anterior tinha “Sim”. Não herdamos uma resposta antiga silenciosamente. A data de registro é a data da importação, não uma data de verificação fiscal. A cobertura significa **enquadramento preenchido**, não conferência na Receita.

## 6. Arquitetura e processamento

```text
Navegador → API Node.js/TypeScript → MongoDB
    └─ leitura/exportação de planilhas em Web Worker
```

Coleções: `users`, `sessions`, `limits`, `clients`, `batches`, `rows`, `chunks`, `results` e `audit`. Uma instalação usa um `WORKSPACE_ID`. Os usuários autorizados desse workspace compartilham as carteiras; não existe isolamento privado por carteira na interface.

Há índices únicos para e-mail/workspace, CNPJ da responsável quando informado, linha por lote e resultado por lote/CNPJ. `src/store.ts` concentra a conexão; tokens de sessão são armazenados como hash e sessões/contadores têm expiração.

```text
UPLOADING → PROCESSING → COMPLETED
          ↘ INVALID
Lotes não concluídos → CANCELLED
```

O upload usa partes com posição e hash. Repetir a mesma parte é idempotente; mudar o conteúdo na mesma posição é recusado. Reutilizar o identificador do lote com outro mapeamento também é recusado.

Cada chamada de processamento organiza até 500 identidades e salva um checkpoint. Os resultados são gravados com chave única por lote/CNPJ. Somente um lote **COMPLETED**, com contagem reconciliada, entra no dashboard. Resultados parciais nunca são publicados como resultado completo.

O processamento avança enquanto um operador acompanha a tela. Reabrir o lote permite retomar; não há worker/cron independente do navegador. Se a tela de upload for perdida antes do fim do envio, cancele o lote parcial e reimporte. Uma falha não cria resultados negativos.

## 7. Limites e exportação

| Limite configurado | Valor |
|---|---|
| Arquivo | CSV/XLSX até 10 MiB |
| Linhas | Até 50.000 |
| Colunas | Até 80 |
| Célula / cabeçalho | 2.000 / 200 caracteres |
| Parte enviada | Até 250 linhas e aproximadamente 2 MB |
| Corpo HTTP | Até 2.800.000 bytes |
| Página de processamento / resultados | 500 / 50 CNPJs |

Esses são limites do código, **não homologação de desempenho em produção**. Testes de domínio cobrem 10.001 e 50.000 documentos sintéticos; MongoDB, arquivos reais e hospedagem ainda precisam de medição.

Linhas totalmente vazias são ignoradas. Índices de revisão indicam a sequência importada, não necessariamente a linha física original. Células numéricas geram aviso; zeros perdidos não são reconstruídos por suposição. Fórmulas precisam ser convertidas em valores; o pré-voo recusa macros, proteção e vínculos externos em XLSX, sem prometer proteção absoluta contra todo arquivo malicioso.

A exportação conserva repetições/invalidade e acrescenta CNPJ normalizado, validação, duplicidade, Simples registrado, MEI, motivo, fonte, referência histórica quando disponível e **REGISTRADO_EM**. CSV neutraliza valores que poderiam ser executados como fórmulas; XLSX escreve células de saída como texto.

## 8. Configuração e instalação

Requisitos do projeto: Node.js `>=22.16.0 <25`, npm e MongoDB acessível ao servidor. Não é necessária conta Google.

```bash
npm install
cp .env.example .env
# Preencha as variáveis privadas.
npm run seed
npm run build
npm start
```

Em PowerShell, `Copy-Item .env.example .env` é uma alternativa para copiar o modelo. Abra `http://localhost:3000`. Em desenvolvimento, use `npm run dev`.

| Variável | Finalidade |
|---|---|
| PORT | Porta HTTP, padrão 3000 |
| APP_ORIGIN | Origem exata, sem barra final; HTTPS em produção |
| MONGODB_URI | Conexão privada do MongoDB |
| MONGODB_DB | Banco, padrão maximum_cnpj |
| WORKSPACE_ID | Identificador da instalação |
| ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD | Provisionamento inicial com npm run seed |
| NODE_ENV | production ativa controles de produção |

**Não existe senha padrão.** O administrador inicial exige senha de 12 a 128 caracteres. O seed recusa alterar contas existentes. Depois do provisionamento, remova `ADMIN_PASSWORD` do ambiente. Nunca publique o `.env`, URI privada ou credenciais em commits.

O leitor XLSX é copiado para `public/vendor` no build. Não é carregado de CDN durante o uso. Alterações no domínio compartilhado requerem novo build para atualizar o módulo do navegador.

O lockfile ainda depende de uma instalação completa validada. Nesta entrega, o acesso ao npm falhou; não foi inventado um lockfile. Use `npm install` até versionar um lockfile válido, antes de mudar para `npm ci`.

## 9. Migração e hospedagem

A configuração Vercel anterior foi preservada, mas não houve deploy/homologação nesta revisão. O servidor também roda com `npm start`. Em produção, use HTTPS, origem exata, MongoDB restrito, backups e supervisão do processo. A URL de preview exige sua própria origem configurada.

As variáveis `GOOGLE_*`, `BQ_*` e `SOURCE_MAX_AGE_DAYS` não são usadas no modo básico. Remova os segredos antigos da hospedagem depois de confirmar que não são usados por outro componente.

Nenhum dado é removido: lotes antigos concluídos continuam disponíveis com a origem anterior. Lotes antigos incompletos não são convertidos automaticamente em informações declaradas; cancele o registro local e reimporte. **Cancelar localmente não cancela eventual job antigo em serviço externo.** Confira esse job naquele serviço, quando aplicável.

A rota `/api/health` verifica o processo HTTP, não a conexão MongoDB. Faça login e teste uma importação/exportação real autorizada antes de operar. Para rollback, utilize o commit anterior e backups; reverter código não desfaz dados novos.

## 10. API interna

Todas as rotas, exceto saúde/login, exigem sessão. Escritas exigem origem autorizada e JSON. Operações de carteira/lote exigem administrador ou operador.

| Rota | Uso |
|---|---|
| GET /api/health | Processo e versão |
| POST /api/auth/login, /logout, /password | Login, encerramento e senha |
| GET /api/auth/me | Conta atual |
| GET /api/dashboard?clientId= | Indicadores e recentes |
| GET/POST /api/clients; PATCH /api/clients/:id | Carteiras |
| GET /api/batches?page=&clientId= | Histórico, 30 por página |
| POST /api/batches | Criar lote; statusColumn padrão -1 |
| POST /api/batches/:id/rows | Parte com offset e linhas |
| POST /api/batches/:id/finalize | Validar total e preparar processamento |
| POST /api/batches/:id/process | Próxima página local |
| POST /api/batches/:id/cancel | Cancelar registro não concluído |
| GET /api/batches/:id | Situação |
| GET /api/batches/:id/results?page=&status=&search= | Resultados únicos |
| GET /api/batches/:id/export?offset= | Linhas de exportação |
| GET /api/settings | Configuração não secreta |
| GET/POST /api/users; GET /api/audit | Equipe/auditoria, administrador |

As rotas antigas `estimate`, `start` e `advance` foram removidas e não executam consulta externa.

## 11. Segurança e diagnóstico

Mantidos scrypt, tokens aleatórios, cookies HttpOnly/SameSite, Secure em produção, verificação de origem e limites de operações/login. Visualizadores não podem alterar carteiras, importar ou processar. Dados não expiram automaticamente: defina retenção, backup, restauração e descarte antes de uso real. Arquivamento não é exclusão definitiva.

503 indica verificar MongoDB/rede/permissões; ORIGIN/403 exige conferir APP_ORIGIN. LEGACY_BATCH exige reimportar no fluxo básico. IMPORT_CONFLICT impede reutilizar um lote com outro mapeamento. RESULT_COUNT bloqueia publicação de contagens inconsistentes. BATCH_BUSY indica operação simultânea e trava com expiração.

MFA, recuperação por e-mail e painel de revogação completo não estão implementados. Um administrador do banco pode desativar uma conta com `active=false`, preservando a referência histórica. Não apague usuários como mecanismo de revogação.

## 12. Testes desta revisão

```bash
npm run check:release
npm run check
npm run build
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

Executados: **15 testes locais aprovados**, incluindo regras, CNPJs sintéticos, conflitos declarados, deduplicação, CSV, senhas e HTTP. Verificações de sintaxe do frontend/Worker e consistência de versão também são feitas antes de publicar.

A integração foi invocada e **ignorada por ausência de MongoDB**; não está aprovada. A instalação falhou com `EAI_AGAIN` ao acessar o registro npm. Build e tipos completos dependem das dependências ausentes. O navegador disponível bloqueou o servidor local com `ERR_BLOCKED_BY_ADMINISTRATOR`; não há nova aprovação E2E/visual nesta entrega.

A CI foi ajustada para MongoDB efêmero, sem provedor fiscal, e inclui CSV/XLSX. Testes integrados usam banco aleatório descartável. Nunca use credenciais de produção nesses testes. A existência da workflow não comprova sua execução: confira o resultado associado ao SHA entregue.

## 13. Versionamento e próximas etapas

README e CHANGELOG devem ser atualizados **no mesmo commit de cada mudança relevante**. A versão deve coincidir em package.json, src/domain.ts e documentação. AGENTS.md e o template de PR registram a regra. Preserve o histórico; não faça force-push nem substitua mudanças concorrentes.

Prioridade seguinte: validar build/lockfile, integração MongoDB e E2E; depois importar uma base real autorizada e conferir todas as contagens/exportações. Novos campos, filtros e comparativos devem evoluir a partir desse uso. Consulta externa e calculadora são escopos futuros separados, com fontes, requisitos e testes próprios.

- [x] Remover integração Google do código ativo e ambiente de uso.
- [x] Manter Node.js + MongoDB, importações, carteira e histórico.
- [x] Explicitar enquadramento informado, sem consulta fiscal.
- [x] Testar regras locais e HTTP.
- [ ] Validar build, lockfile, integração e E2E no SHA entregue.
- [ ] Conferir base real, desempenho, exportação, segurança e backup.

A licença do leitor de planilhas é copiada pelo build. A política de licença do código próprio não foi alterada nesta etapa.
