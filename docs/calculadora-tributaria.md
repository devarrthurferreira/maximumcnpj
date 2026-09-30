# Simulador integrado · v0.10.0

## Origem e escopo

Motor portado da calculadora Maximum, repositório `devarrthurferreira/calculadora`, commit `d60e8bc3b2edcc2ebd4ff11cf584689f01d0d381`. Arquivos de referência: `src/lib/tax/{constants,engine,schema}.ts` e `src/lib/simulation.ts`. Fórmulas e premissas originais preservadas. O adaptador troca somente a descrição da referência anual: receita mensal × 12 é estimativa, não RBT12 real consultada.

O cálculo gerencial compara Simples Puro, Simples Híbrido, Lucro Presumido e Lucro Real para 2027/2028. A homologação fiscal é independente desta integração. Não há alteração de declarações, notas, consultas ou dados financeiros originais.

## Contrato de entrada dos relatórios

`GET /api/v4/generations/:id/simulator?clientId=...` exige sessão ativa, workspace, vínculos da mesma empresa/geração, ambos os jobs COMPLETED/NET_V2 e conciliação integral de linhas, componentes e snapshots. Não recebe totais enviados pelo cliente. Retorna metadados dos arquivos, avisos de classificação e:

| Campo em centavos do arquivo | Campo no simulador |
|---|---|
| salesOptantCents | Faturamento vendas Optantes SN |
| salesNonOptantCents | Faturamento vendas Não Optantes SN |
| salesCpfCents | Faturamento Vendas de CPFs |
| purchasesOptantCents | Compras de empresas do Simples Nacional |
| purchasesNonOptantCents | Compras de empresas fora do Simples |

Somente CNPJ válido com OPTANTE explícito entra em Simples. Não confirmados conservam a fonte e entram no grupo gerencial Não optante. CPF é separado apenas nas vendas. Todas as linhas financeiras são preservadas; deduplicação serve para pesquisa/contagem de documentos, não para eliminar valores.

O usuário confirma que os dois arquivos representam o mesmo período e seleciona 1–12 meses. Os valores são divididos pelo período e arredondados em centavos com distribuição pelos maiores restos, de modo que os três grupos de vendas e os dois de compras somem o total mensal arredondado. O conteúdo importado não contém competência fiscal validada pelo sistema, portanto essa conferência é explícita.

## Formulário e modelo

A soma dos três grupos de faturamento vira `salesRevenue`. Compras viram `simplePurchases` e `regularPurchases`. `serviceRevenue`, `salaries`, `benefits`, `adminExpenses`, `rent` e `cardExpenses` precisam ser preenchidos manualmente, com zero explícito se ausentes. Valores monetários em reais, não negativos e com duas casas; ano 2027/2028; vendas anexo I/II; serviços III/IV/V. Não repetir serviços já registrados no relatório de vendas.

`calculateSimulation(draft)` recebe `{year,salesAnnex,serviceAnnex,values}` e retorna regimes, DRE anual, créditos, avisos e memória. O cadastro do cliente vem da geração, sem pedir novo cadastro. Grupos de compradores apenas discriminam as receitas; não alteram as alíquotas do motor original.

Premissas mantidas: CBS 9,11%, IBS 0,10%, ICMS 18%, ISS 5%, encargos 27,8%, créditos SN 1,5%+0,02%; vendas comércio/indústria, serviços III/IV/V; base presumida vendas 8%/12% e serviços 32%, acréscimo relativo de 10% nos coeficientes sobre parcela anual acima de R$5 milhões. ICMS/ISS fora do DAS e encargos extras permanecem conforme o wizard original; cenários que exigem ajustes expõem os alertas/indisponibilidade originais.

Essas taxas/bases são hipóteses do simulador. Classificar um fornecedor como fora do Simples, inclusive CPF ou não confirmado, não comprova crédito fiscal; o modelo mantém sua premissa de crédito, com aviso visível para conferência nas notas. IBS/CBS efetivos, enquadramento da atividade, fator R, benefícios, sublimite e peculiaridades setoriais exigem validação própria.

## Referências e validação

Fontes normativas originais em `TAX_SOURCES`: LC214/2025 consolidada (anexos XVIII–XXII e arts.47/344/347), LC123/2006, LC87/1996, Lei9.249/1995, LC224/2025 e Lei9.718/1998. Conferência limitada em 30/09/2026 confirmou as tabelas 2027/28 e a regra de acréscimo de presunção; CBS9,11% e crédito SN1,5%+0,02% continuam premissas, sem homologação como taxas oficiais universais.

32 regressões do motor cobrem fixtures do original, faixas/limites, créditos, ISS, IRPJ, entrada inválida, determinismo e estimativa anual. Integrações conferem cinco totais, fonte, documentos repetidos, isolamento, snapshots divergentes e bloqueio de versão antiga. Navegador confere autofill, zero versus campo vazio, período, edição, restauração, exportação e DRE responsiva.

## Persistência e resultado

Rascunho no sessionStorage da aba com chave de usuário + geração + empresa + jobs. Não há persistência central da simulação nesta versão. Alterações limpam os resultados até gerar novamente. Exportação JSON conserva fonte, período, campos mensais editados, unidade BRL, entrada, resultados, memória e commit do motor. Os snapshots originais continuam no histórico.

DRE ao final, primeira coluna fixa, orientação de rolagem lateral no celular. Nenhum resultado é gerado para snapshots incompletos, totais divergentes, relatórios de empresas diferentes ou Q_V1 legado; reimportação é necessária neste último caso.
