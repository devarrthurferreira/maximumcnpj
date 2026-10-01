# Validação do simulador anual — v0.12.0

Entrega de 01/10/2026: total importado dividido pelas competências e multiplicado por 12, com redesign e memória da projeção.

## Código e verificações

Código verificado: `3fb4c5fa606903da0ed83abc7666c61c045aff62`.
Integração do PR #3 na main: `318d81d9284208a33b54a537cd9289642033bb12`.

A [verificação completa #55](https://github.com/devarrthurferreira/maximumCNPJ/actions/runs/36904919447) concluiu com sucesso antes da integração. Foram aprovadas as etapas de versão/documentação, TypeScript/build, regras/HTTP, integrações MongoDB, consultas, compras/vendas, gerações, simulações históricas, projeção/competências, Python/PDF e navegador/CSV/XLSX.

A [verificação de competências](https://github.com/devarrthurferreira/maximumCNPJ/actions/runs/36904919441) também foi aprovada.

## Casos cobertos

- Quatro competências com vendas de R$ 400.000: média mensal de R$ 100.000 e projeção de R$ 1.200.000 em 12 meses no total.
- Compras de R$ 240.000 em quatro competências: média de R$ 60.000 e projeção de R$ 720.000.
- Todos os divisores de 1 a 12, zero, centavos residuais conciliados, entradas inválidas e limites monetários.
- Comparação por mês/ano da coluna H, sem exigir igualdade de dias, preservando conciliação exata de cada relatório.
- Base importada separada de ajustes manuais, despesas/serviços mensais e RBT12 independente.
- Salvamento e reabertura sem recalcular os resultados históricos; nova versão preserva a original.
- Layout em computador e celular, memória dos cinco grupos, 12 meses projetados e DRE com Indicador fixo.
- Permissões, sessão, origem, isolamento por workspace e rejeição de projeção enviada pelo navegador.

## Limites

Os testes usam dados sintéticos e MongoDB descartável. Não foram usados relatórios reais de clientes para homologar a projeção. A linha mensal uniforme é uma premissa gerencial, não um histórico de lançamentos ou previsão de sazonalidade. A aprovação da CI não comprova atualização fiscal de uma fonte externa.

Nenhuma migração destrutiva ou variável obrigatória nova. Os cenários já salvos conservam os resultados originais. Consulte o [README](../README.md) para a regra, precisão e operação.
