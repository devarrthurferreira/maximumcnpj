# IRPJ normal e adicional na DRE

## Escopo

O motor existente utiliza `IRPJ_RATE = 0.15` e `IRPJ_ADDITIONAL_RATE = 0.1` para Lucro Presumido e Lucro Real. Esta alteração não muda essas alíquotas, bases, períodos, documentos nem resultados históricos.

A DRE unificada mostrava o IRPJ total, mas omitia os componentes conciliados que já estavam em `presentation.details`. Agora mostra, nesta ordem:

1. IRPJ total (normal + adicional).
2. IRPJ normal (15% da base), como composição informativa.
3. Adicional de IRPJ (10% do excedente), como composição informativa.

As parcelas não são novamente somadas em `totalTaxes` nem no resultado. Valores indisponíveis, motivos e competências ausentes permanecem preservados. Os consumidores de `unifiedDreRows`, incluindo a tela e o CSV, usam o mesmo detalhamento.

## Organização

O módulo anterior de apresentação foi preservado integralmente em `public/simulator-dre-core.js` (blob original `07756275ab609ef51c64333ca9babe92504ae46a`). `public/simulator-dre.js` mantém a API pública e delega somente a composição das linhas ao módulo puro `simulator-irpj-display.js`. O núcleo de cálculo não é alterado.

## Exemplos sintéticos do modelo mensal existente

- Base mensal de R$ 28.000: IRPJ normal = R$ 4.200; adicional = (R$ 28.000 − R$ 20.000) × 10% = R$ 800; total = R$ 5.000.
- Base mensal de R$ 32.630: adicional = (R$ 32.630 − R$ 20.000) × 10% = R$ 1.263.

O motor anualiza uma competência e o adaptador divide o resultado por 12; o consolidado soma as competências. Este PR não implementa fechamento trimestral nem ajustes fiscais completos do Lucro Real. Não reduz valores artificialmente para R$ 800 e não confirma o resultado esperado do caso real sem sua base, regime e período.

## Testes

`npm run test:irpj` executa oito testes da composição visual e sete testes do motor, integração com a DRE e CSV. Ambos os arquivos também fazem parte de `npm test`.

Os testes cobrem as alíquotas distintas, os exemplos de R$ 800 e R$ 1.263, o limite mensal equivalente, a preservação do histórico, ausência de zeros inventados, ausência de duplicação e as competências do demonstrativo. A validação completa inclui `npm run check`, `npm run build` e a CI do repositório; o status de execução deve ser consultado no PR.
