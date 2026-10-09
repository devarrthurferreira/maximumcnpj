# Recuperação das consultas CNPJ — v0.20.1

## Problema observado

Em 09/10/2026, a consulta pública à Minha Receita retornou HTTP 503 com a mensagem de serviço temporariamente indisponível. A verificação de conectividade do GitHub Actions também registrou `FONTE_INDISPONIVEL`. O endpoint CNPJ da BrasilAPI retornou erro derivado do mesmo HTTP 503: ele depende da Minha Receita e não resolveria esta indisponibilidade.

O motor já preservava o status original `NAO_CONFIRMADO` após esgotar tentativas. Porém, o resumo guiado mostrava “CONSULTA CONCLUÍDA” com símbolo de sucesso e escondia os motivos e a ação de nova consulta. Como a regra gerencial agrupa não confirmados em Não optante, uma indisponibilidade geral podia parecer confirmação de que todas as empresas estavam fora do Simples.

O relatório informado pelo usuário não foi acessado nem alterado em produção. Os valores e volumes citados serviram para construir um teste sintético, sem importar documentos ou nomes reais de clientes.

## Consulta e classificação

1. O sistema consulta a Minha Receita pelo CNPJ completo validado.
2. Em falha de rede, timeout, HTTP 5xx sem `Retry-After` ou resposta inválida, tenta `https://api.opencnpj.org/<cnpj>?datasets=receita`.
3. A identidade retornada deve ser uma string e coincidir integralmente com o CNPJ solicitado, incluindo zeros iniciais.
4. Minha Receita exige booleanos explícitos; OpenCNPJ exige os indicadores documentados `S` ou `N`. Campo vazio, ausente ou conflitante continua não confirmado.
5. A fonte efetivamente usada acompanha o estado salvo, o resumo e as exportações. Falhas em ambas as APIs registram “Minha Receita / OpenCNPJ”.

Não há tentativa alternativa após 401/403/429, `Retry-After`, identidade divergente, CNPJ não encontrado ou resposta acima do limite. Uma resposta HTTP 200 sem indicador fiscal explícito também não aciona outra fonte para tentar forçar uma classificação.

O orçamento total por CNPJ permanece em 12 segundos, com até 6 segundos por fonte. O limite de 2 MB por resposta, os workers limitados, o intervalo global, as pausas e as tentativas limitadas permanecem ativos. CPF, CNO e documentos inválidos não são enviados às APIs.

Não há cache fiscal substituindo a consulta de um novo lote. A fonte pública não comprova o regime fiscal em uma data passada nem garante atualização em tempo real.

Referências primárias verificadas:

- [Minha Receita — uso da API](https://docs.minhareceita.org/como-usar/)
- [BrasilAPI — documentação do endpoint CNPJ](https://brasilapi.com.br/docs)
- [OpenCNPJ — contrato HTTP](https://github.com/Hitmasu/OpenCNPJ/blob/main/src/Page/assets/openapi.json)
- [OpenCNPJ — schema dos indicadores](https://github.com/Hitmasu/OpenCNPJ/blob/main/src/Worker/src/schema.ts)
- [OpenCNPJ — política de limites](https://github.com/Hitmasu/OpenCNPJ/blob/main/src/Page/src/pages/LimitsPage.tsx)

## Recuperação de relatórios existentes

Abra o relatório e use **Consultar CNPJs novamente**. O sistema copia as linhas já importadas, consulta novamente os CNPJs e inicia o processamento no novo relatório. Não é necessário reenviar a planilha.

O pedido leva um `importId` estável, conservado durante falhas de rede, timeout ou respostas temporárias. O backend reserva origem e autor, retoma cópias interrompidas sob lease e devolve o mesmo lote em um reenvio. Erros definitivos de cancelamento ou colisão permitem iniciar outro pedido. Leitores não podem iniciar a operação.

O novo relatório fica no histórico da empresa. O relatório anterior e sua geração permanecem imutáveis; simulações e gerações existentes **não são atualizadas automaticamente** para usar a nova consulta. Para criar uma geração com novos resultados, inicie outra geração e importe os arquivos correspondentes.

O resumo usa os resultados já salvos para mostrar **Consulta encerrada com pendências**, inclusive em históricos anteriores à v0.20.1. O acompanhamento expõe motivos agregados, contagens confirmadas, fontes e detalhes por CNPJ. Os valores e a regra de agrupamento gerencial não mudam.

## Arquivos e funções principais

| Área | Arquivos / funções |
| --- | --- |
| Provedores e validação | `src/lookup-provider.ts`: `lookupSource`, `lookupCnpj`, `SourceError`; `src/lookup-domain.ts`: `parseOpenCnpj`; `src/lookup-policy.ts`: orçamento por fonte |
| Processamento e diagnóstico | `src/lookup-engine.ts`: `processLookupBatch`, `lookupProgress` |
| Nova consulta idempotente | `src/lookup-jobs.ts`: `createLookupRecord`, `recheckLookup`, guardas de upload; `src/lookup-http.ts`: corpo do pedido |
| Resumo financeiro | `src/purchase-store.ts`: fontes dos itens reconciliados |
| Interface | `public/lookup-progress.js`, `public/purchases-ui.js`, `public/lookup-ui.js`, folhas de estilo correspondentes e versões dos assets em `index.html`/`purchases.html` |
| Relatórios | `reporting/core.py`: `snapshot_source`; `reporting/purchases.py`: metadados/PDF; `reporting/pdf.py`: fonte por resultado |
| Regressões | `tests/lookup-performance.test.ts`, `tests/lookup-performance-integration.test.ts`, `tests/lookup-recovery-integration.test.ts`, `tests/lookup-recheck-integration.test.ts`, `tests/purchase-integration.test.ts`, `tests/purchases_report_test.py`, `tests/reports_test.py`, `tests/deployment.test.mjs`, `tests/e2e/lookup-recovery.spec.ts` |
| Versão | `package.json`, `src/domain.ts`, `reporting/core.py`, `pyproject.toml`, `README.md`, `CHANGELOG.md` |

## Validação

Verificações locais aprovadas: versão/documentação, tipos, build, **144 testes Node**, **34 testes de integração MongoDB**, **87 testes Python/PDF com MongoDB e OCR habilitados** e **77 testes de navegador**. MongoDB e contas usados nos testes são descartáveis. A revisão independente não encontrou bloqueadores após a correção do tratamento de erros definitivos na reconsulta.

O teste financeiro sintético reproduz 551 linhas, 347 documentos distintos, 25 CNPJs válidos e R$ 427.855,98. Com a fonte principal simulando HTTP 503, todos os 25 CNPJs são consultados na alternativa; 12 retornam `S` e 13 retornam `N`. A soma continua R$ 427.855,98, CPFs não saem para a API e nenhuma linha é duplicada. Esses enquadramentos são fixtures, não resultados da empresa do usuário.

Também são cobertos: ambas as fontes indisponíveis, respostas sem indicador, identidade divergente, limites e `Retry-After`, orçamento total, cópia de compras/vendas com DIFAL, reenvio após resposta perdida, retomada após interrupção, colisões, isolamento de workspace, leitores, snapshots preservados, fontes nos PDFs e navegação em desktop/celular.

Consultas HTTP de baixo volume à OpenCNPJ com amostras públicas de sua documentação retornaram 200, incluindo um indicador explícito `N` e outra resposta sem indicador, mantida como desconhecida. O `fetch` Node direto do ambiente de desenvolvimento não resolveu o domínio (`EAI_AGAIN`); os testes HTTP públicos usaram o acesso de rede disponível, e os testes automatizados do motor usam transportes controlados. Isso não constitui uma reconsulta dos CNPJs do relatório nem verificação autenticada da produção após deploy.

Os erros anteriores de autenticação não foram reproduzidos no domínio principal: favicon respondeu 200, sessão anônima respondeu 200 e login vazio com origem canônica respondeu 400 de validação. `/api/auth/me` retorna 401 normalmente sem sessão. Nenhuma proteção de origem ou autenticação foi removida.
