# DIFAL estimado · v0.20.0

## Regra implementada

O percentual fixo de 10% é uma estimativa gerencial definida no requisito. Não há consulta de alíquotas legais, FCP ou recomposição de base.

O cálculo usa cada lançamento de venda importado e sua base já validada `totalCents = grossCents - discountCents + freightCents - abatementCents`. A quantidade não multiplica a base. `accessoryCents` permanece informativo. O DIFAL não altera esse total, o saldo líquido, os grupos Simples/Não optante/CPF ou os tributos do simulador.

São necessárias todas as condições:

1. Operação de venda de mercadoria; serviços, devoluções e finalidades incompatíveis têm precedência.
2. Natureza com quatro dígitos presente na configuração explícita: 6101, 6102, 6103, 6104, 6105, 6106, 6107 ou 6108.
3. Documento identificado como CPF pelo contrato existente do sistema (11 dígitos após normalização). Não é uma nova validação cadastral de CPF.
4. UF brasileira do emitente e do destinatário informadas e diferentes.

A lista configura naturezas de venda; não se habilitam automaticamente códigos iniciados por 6. As descrições da lista foram conferidas na [tabela da Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop). Códigos especiais adicionais dependem de validação e inclusão explícita, inclusive no espelho Python e nos testes.

O resultado por lançamento é `(totalCents + 5) / 10`, com divisão inteira, ou seja, 10% com arredondamento de meio centavo para cima. O resumo soma os resultados já arredondados; não reaplica 10% sobre o DIFAL. Dois lançamentos de um mesmo CPF continuam distintos; agrupar compradores não elimina vendas legítimas.

## Entrada, atualização e histórico

A UF do emitente é selecionada antes de importar; a UF cadastrada é reutilizada quando válida. O relatório salva essa informação como `issuerUf`. A coluna J — Estado fornece `recipientUf`. Não se consulta CPF para descobrir endereço.

O cálculo é derivado automaticamente da prévia. Mudanças na UF recalculam a prévia e arquivos alterados são processados novamente. No fluxo guiado, a seleção precede o arquivo porque a importação começa automaticamente.

Relatórios concluídos são snapshots imutáveis. Para corrigir valor, CPF, natureza ou UF de um relatório concluído, faça uma nova importação; a versão anterior permanece auditável. Reenvios de upload mantêm o mesmo identificador e os mesmos dados, sem acumular o imposto novamente. Reconsultar CNPJs preserva o contexto fiscal original do relatório.

Operações candidatas sem UF ficam pendentes; o resumo mostra o subtotal calculável e a quantidade de pendências. Um histórico sem `difalVersion` informa indisponibilidade e não é reclassificado retroativamente.

## Organização

| Área | Arquivos e responsabilidades |
| --- | --- |
| Regra compartilhada | `src/difal.ts`: `calculateDifal`, `summarizeDifal`, normalização de UF e configuração explícita das naturezas; `scripts/assets.mjs` publica o módulo no navegador. |
| Importação e persistência | `src/purchase-domain.ts`, `src/lookup-jobs.ts`, `src/generation-store.ts`: validação, contexto de UF, cálculo autoritativo, idempotência e snapshot. |
| Resumos e CSV | `src/purchase-store.ts`, `src/purchase-domain.ts`: reconciliação de linhas, agrupamentos, totais e exportação. |
| Interface | `public/purchase-parser.js`, `public/purchase-import-worker.js`, `public/purchases-ui.js`: coluna J, seletor de UF, prévia, resumos e detalhamento. |
| PDF | `reporting/difal.py`, `reporting/purchases.py`, `reporting/generations.py`: espelho da regra, reconciliação e exibição nos relatórios individual e consolidado. |
| Simulador | `src/simulator-store.ts`, `public/simulator-ui.js`: estimativa do relatório de origem, separada dos resultados tributários do cenário. |

## Validação

Os testes usam somente documentos, valores e respostas sintéticas. Cobrem os seis cenários do requisito: R$ 150 → R$ 15; CNPJ excluído; CPF na mesma UF excluído; serviço excluído; R$ 1.000 → R$ 100; valor alterado com recálculo. Também verificam naturezas não elegíveis, ausência de UF, arredondamento, valores enviados pelo navegador ignorados, soma sem duplicação, isolamento por workspace e compatibilidade do histórico.

Os gates de release incluem tipos/build, regras Node, integração com MongoDB descartável, Python/PDF e navegador. Os resultados executados desta entrega constam na descrição do pull request.
