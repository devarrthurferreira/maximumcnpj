# Maximum CNPJ · v0.11.1

Node.js 22 + TypeScript + MongoDB para consultas CNPJ, empresas, gerações e histórico. Python para relatórios. Identidade Maximum, sessão autenticada, permissões por perfil e isolamento por workspace. Sem Google Cloud.

## Entrega de 01/10/2026 — leitura e classificação do Simples

O processamento deixa de esperar cada resposta e sua pausa antes de iniciar o CNPJ seguinte. O novo motor trabalha com até **3 consultas simultâneas por padrão**, com intervalo global de **500 ms entre inícios**, controlado no MongoDB para todas as abas/instâncias. Não é uma promessa de tempo de conclusão: latência, indisponibilidade e limites da fonte continuam determinantes.

- [x] Fila de até 40 candidatos por chamada; orçamento de 24 segundos, timeout de 12 segundos por requisição e drenagem das chamadas iniciadas antes de liberar o lote.
- [x] Reutilização de snapshots idênticos sem reaproveitar uma consulta antiga como verificação nova; proteção contra inserções concorrentes e contra regressão da data do cadastro compartilhado.
- [x] CNPJ completo normalizado na entrada e na resposta: a máscara não invalida uma identidade correspondente. CPF, CNO e inválidos não vão à API.
- [x] Indicadores explicitamente booleanos continuam obrigatórios. `true` é OPTANTE, `false` é NAO_OPTANTE. Ausência, texto inesperado e conflito são NAO_CONFIRMADO, nunca uma negativa fiscal inventada.
- [x] Resposta sem indicador/conflictante recebe uma nova tentativa; falhas transitórias têm até três tentativas. HTTP 429 respeita Retry-After compartilhado, inclusive em formato de data HTTP. Não há rotação de IP ou tentativa de contornar bloqueios.
- [x] Painel **Classificação dos CNPJs** em consultas, compras e vendas: mostra resultados durante o processamento, confirmação positiva/negativa, falhas e aguardando/nova tentativa, com filtros, paginação e motivos legíveis.
- [x] Botão **Revalidar em novo lote** para consultas concluídas. O novo lote consulta novamente todos os CNPJs, sem sobrescrever o histórico. Em compras/vendas, copia apenas as linhas financeiras já reconciliadas, mantendo seus valores.
- [x] Testes de regressão de classificação, identidade, tratamento de falhas, concorrência, isolamento, snapshots financeiros e interface responsiva incluídos nas rotinas existentes de CI.

### Regra gerencial preservada

**Simples** recebe exclusivamente CNPJs com OPTANTE explícito. **Não optante** recebe os demais no resumo gerencial, inclusive não confirmados, com a situação original preservada. Em compras, CPF e outros documentos permanecem nesse grupo. Em vendas, **CPF é o terceiro grupo separado**.

O novo acompanhamento mostra **Não optante confirmado** separado de **Não confirmado / falha** apenas para conferência da resposta original. Isso não altera as fórmulas nem os grupos gerenciais do simulador, CSV ou PDF. Um CNPJ ainda na fila não é uma negativa da fonte. Relatórios finais continuam bloqueados até a conclusão e reconciliação do snapshot.

A API Minha Receita aceita indicadores nulos, conforme sua documentação. Uma nova tentativa pode recuperar falhas transitórias, mas não cria um dado que a fonte não possui. Nome, CNAE, porte, datas e indicação de MEI não são usados para inventar a opção pelo Simples. A data de consulta não comprova atualização da base nem o enquadramento na data da nota.

### Como usar após a atualização

1. Abra a consulta ou o relatório de compras/vendas no histórico e clique em **Consultar / retomar** quando estiver pausado. O novo motor também atende lotes que já estavam em processamento.
2. Acompanhe **Classificação dos CNPJs** sem esperar o fim do lote. Os filtros desse quadro mostram a situação original; os cartões financeiros finais mantêm o agrupamento gerencial acima.
3. Para conferir novamente um relatório concluído, use **Revalidar em novo lote**. O histórico anterior permanece intacto. A revalidação financeira aparece como relatório independente da mesma empresa, **não substitui o vínculo de uma geração ou simulação antiga**. Para alimentar uma nova geração/simulação, importe os arquivos no fluxo dessa nova geração.

A execução continua sendo acionada pela tela aberta. Pausar não aborta uma requisição já iniciada; as respostas concluídas são salvas. Fechar a aba não transforma o processamento em um worker 24/7. Após voltar, retome o mesmo lote. Exportações/PDFs não disparam consultas externas.

## Configuração

As instalações existentes não precisam de nova chave de API ou migração destrutiva. Os controles de concorrência são criados automaticamente. Preserve as variáveis privadas de MongoDB, workspace, domínio e autenticação já configuradas.

```dotenv
# Opcionais; padrões já aplicados quando ausentes
LOOKUP_CONCURRENCY=3
LOOKUP_INTERVAL_MS=500
```

`LOOKUP_CONCURRENCY` fica entre 1 e 4; `LOOKUP_INTERVAL_MS`, entre 300 e 10000 ms. Valores não numéricos usam o padrão. Para uma operação mais conservadora, utilize concorrência 1 e intervalo maior. O limite real do provedor sempre prevalece. Não aumente esses valores para tentar contornar HTTP 429/403.

Para instalação local, use `.env.example`, Node.js 22.16 ou superior da série 22, MongoDB e Python compatível com `requirements.txt`:

```sh
npm install
python -m pip install -r requirements.txt
npm run build
npm run seed
npm start
```

`npm run seed` é somente para instalação sem usuários. Não reconfigure a senha de usuários existentes nem remova autenticação para corrigir um deploy. As variáveis `MONGODB_URI`, `MONGODB_DB`, `WORKSPACE_ID`, `APP_ORIGIN` e as credenciais de bootstrap ficam no ambiente privado. Na Vercel, preserve a configuração de domínio/origem e o runtime Node/Python existentes.

## Contratos e funcionalidades anteriores

Continuam disponíveis: importação e cadastro de empresas/códigos, upload em partes idempotentes, deduplicação por CNPJ, gerações de várias empresas, compras/vendas, relatórios Python, histórico, cinco grupos de entrada do simulador, gráficos, DRE com Indicador fixo, avisos consolidados e simulações versionadas no MongoDB.

Compras/vendas preservam **Q − Y + AA − AB**, calculado em centavos inteiros; Z é informativo e P não multiplica os valores. Todas as linhas financeiras entram nos totais, mas documentos repetidos contam uma vez. CPFs são um grupo próprio nas vendas. Snapshots antigos Q_V1 continuam com a regra original; revalidar não converte silenciosamente a fórmula. Totais inconsistentes, ausência de snapshot, divergência de origem ou cruzamento de workspace continuam bloqueados.

A documentação detalhada anterior, incluindo provisionamento da equipe, permissões, etapas das gerações, relatórios, versões e limitações do simulador, foi preservada integralmente em [README v0.11.0](README-v0.11.0.md). Consulte também [a calculadora tributária](docs/calculadora-tributaria.md), [AGENTS.md](AGENTS.md) e [CHANGELOG.md](CHANGELOG.md).

## Verificação

```sh
npm run check:release
npm run check
npm run build
npm test
npm run test:lookup-integration
npm run test:purchases-integration
npm run test:generations-integration
npm run test:simulations-integration
npm run test:integration
npm run test:reports
npm run test:e2e
```

Os testes com MongoDB exigem `MONGODB_URI` apontando para ambiente de teste; os cenários novos criam e removem bancos descartáveis. Testes de processamento usam transporte simulado, sem enviar CNPJs sintéticos à fonte. A CI mantém testes de Python/PDF, permissões e navegador. Aprovação em teste simulado não equivale a homologação fiscal nem a medição de velocidade em produção. Confira o resultado da execução associado ao commit entregue.

## Plano de continuidade

- [x] Preservar classificação, valores, histórico, permissões e compatibilidade dos relatórios.
- [x] Reduzir espera serial e permitir conferência dos resultados parciais.
- [x] Adicionar regressões para falhas da fonte, limites compartilhados e revalidação.
- [ ] Medir throughput e taxa de confirmação com uma carteira real autorizada após o deploy.
- [ ] Homologar disponibilidade/atualização da fonte e, se necessário, avaliar uma fonte alternativa mediante contrato explícito e rastreabilidade nos relatórios.
- [ ] Avaliar worker externo para execução contínua sem a tela aberta; não incluído nesta correção.
