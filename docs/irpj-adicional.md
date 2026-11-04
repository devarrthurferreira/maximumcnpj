# IRPJ: base, parcela normal e adicional

## Escopo da versão 0.56.2

O motor utiliza 15% para o IRPJ normal e 10% para o adicional no Lucro Presumido e no Lucro Real. A DRE mostra o total como dedução e as duas parcelas como composição informativa. A memória completa permite conferir as bases e os valores capturados; seus valores não são somados novamente aos tributos ou ao resultado.

O detalhamento anterior, introduzido no PR #89, separava as parcelas mas não exibia seus operandos. A nova conferência também corrige a fórmula textual mensal, a categoria das parcelas no CSV e a diferença de validação entre tela e PDF.

## Modelo de cálculo preservado

| Etapa mensal | Fórmula |
| --- | --- |
| IRPJ normal | Base tributável × 15% |
| Base dentro do limite | Mínimo entre a base e R$ 20.000 |
| Excedente | Máximo entre zero e a base menos R$ 20.000 |
| Adicional | Excedente × 10% |
| IRPJ total | Normal + adicional |

No Presumido, a base é a base presumida total capturada no cálculo, incluindo os componentes previstos pelo modelo. No Real, é a base positiva estimada capturada pelo motor. O modelo do Real não contempla todos os ajustes fiscais ou compensações de uma apuração fiscal completa.

O motor original anualiza a competência e o adaptador divide os resultados por 12. O limite anual de R$ 240.000 corresponde a R$ 20.000 nessa competência. A memória mensal agora usa o limite e os valores mensais, eliminando a mistura de escalas no texto. Projeções anuais anteriores conservam a escala original e sua visualização mensal proporcional.

Janeiro a setembro consolida somente as competências com dados. Cada adicional é calculado no mês antes da soma. Assim, a soma dos adicionais pode diferir de aplicar 10% ao excedente da base agregada sobre a soma dos limites. O quadro mostra tanto o limite nominal quanto a parcela da base efetivamente dentro do limite. Meses ausentes não recebem bases, limites ou impostos inventados.

## Memória apresentada na DRE

| Linha | O que permite conferir |
| --- | --- |
| Base tributável do IRPJ | Base capturada para o regime e a competência |
| Limite do adicional | Limite do modelo para a competência ou soma dos limites dos meses disponíveis |
| Base dentro do limite | Parcela sem adicional; no consolidado, soma das parcelas mensais |
| Base excedente | Parcela positiva acima do limite em cada competência |
| IRPJ normal de 15% | Base multiplicada por 15% |
| Adicional de 10% | Excedente multiplicado por 10% |
| IRPJ total | Soma das parcelas, conciliada com a dedução da DRE |

A memória usa valores informativos positivos para facilitar a conta. O imposto continua como dedução na DRE. Simples Puro e Híbrido identificam o IRPJ dentro do DAS, sem criar uma parcela externa.

## Exemplos sintéticos

Uma base mensal de R$ 28.000 produz IRPJ normal de R$ 4.200, excedente de R$ 8.000, adicional de R$ 800 e IRPJ total de R$ 5.000.

O valor de uma linha de **IRPJ normal** não é a base tributável. Uma linha de imposto de R$ 28.300,07 não informa uma base de R$ 28 mil para calcular o adicional.

Também é possível reproduzir os três valores do Presumido da imagem relatada sem alterar a alíquota de 10%. Um conjunto exclusivamente sintético de serviços usa R$ 101.991,56 em janeiro e R$ 60.949,15 em cada mês de fevereiro a setembro. As bases do modelo são R$ 32.637,2992 em janeiro e R$ 19.503,728 nos demais meses. Somente janeiro apresenta excedente: R$ 12.637,2992. O consolidado exibe IRPJ normal de R$ 28.300,07, adicional de R$ 1.263,73 e total de R$ 29.563,80.

Essa reprodução demonstra que os totais da imagem são compatíveis com 10%; não identifica a empresa, as receitas ou as bases reais do usuário. A conferência do caso depende dos dados capturados em cada competência, apresentados pelo novo quadro.

## Integridade e histórico

A composição exige entradas de memória únicas, monetárias, finitas e não negativas. São conferidas a base multiplicada por 15%, o excedente multiplicado por 10%, a soma das parcelas, o total da memória e a dedução da DRE. O consolidado também precisa conciliar com as competências que o compõem.

Memória ausente, duplicada ou divergente não é convertida em zero nem certificada pelos rótulos de 15% e 10%. A apresentação informa a pendência e preserva o total histórico. A renderização não executa novamente o motor nem altera documentos ou simulações salvas.

Tela, impressão, CSV e PDF preservam o período e os regimes selecionados. O CSV identifica as composições por chave estável, sem depender da identidade do objeto de apresentação.

## Período fiscal e referências

O consolidado do sistema é uma soma gerencial de estimativas mensais. Ele não implementa fechamento fiscal trimestral ou o ajuste anual do Lucro Real. A legislação distingue a apuração trimestral e os pagamentos mensais por estimativa; janeiro a setembro não constitui, por si só, um novo período fiscal de nove meses.

- [Lei nº 9.249/1995, art. 3º, texto oficial atualizado](https://legis.senado.leg.br/norma/551125/publicacao/34619641): alíquota de 15%, adicional de 10% e limite proporcional ao período de apuração.
- [Lei nº 9.430/1996, arts. 1º e 2º, publicação oficial](https://legis.senado.leg.br/norma/551306/publicacao/15757825): apuração trimestral e pagamentos mensais por estimativa.
- [Receita Federal: IRPJ](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IRPJ): orientação sobre o imposto e o adicional.

As regressões cobrem esses exemplos, variação entre meses, períodos parciais, projeções anteriores, memória inconsistente, preservação do total e apresentação/exportação sem dupla dedução.
