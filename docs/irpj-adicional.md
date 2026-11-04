# IRPJ e CSLL: apuração trimestral e movimentos mensais

## Escopo do modelo 1.20

O modelo `1.20.0-quarterly-income-tax` calcula IRPJ e CSLL por trimestre civil. O Lucro Presumido utiliza as bases presumidas de cada atividade; o Lucro Real permanece uma estimativa gerencial do resultado capturado, sem afirmar que substitui uma apuração fiscal completa. Receitas, compras e despesas continuam por competência. Cada mês reconhece somente a diferença entre a provisão acumulada do trimestre e a provisão anteriormente reconhecida.

A legislação define o trimestre civil como período de apuração e admite, para o Lucro Real, a opção anual com pagamentos mensais por estimativa. O simulador novo adota a alternativa trimestral gerencial. Não implementa a opção fiscal anual do Real, balancetes de suspensão/redução, compensações ou pagamentos já recolhidos. Os quatro regimes são cenários comparativos; a disponibilidade de um cenário não comprova o enquadramento tributário da empresa. [Lei 9.430/1996, arts. 1º e 2º; referências 1 e 4.]

Os arquivos de origem e o ano do cenário são campos distintos. Uma receita originada em 2025 pode alimentar o cenário de 2027, mas o resultado então usa as premissas de 2027; não é o imposto efetivamente devido em 2025. O modelo mantém a premissa configurada de CBS + IBS e as demais premissas do cenário. Uma apuração efetiva de 2025 exigiria, entre outros elementos, os tributos e regras daquele ano, documentos fiscais, regime comprovado e ajustes próprios. [Referências 5–7.]

## Fórmulas e unidade de apuração

| Elemento | Regra aplicada pelo modelo |
| --- | --- |
| Base comum do Presumido para comércio | Receita líquida da atividade no trimestre × 8% para IRPJ; × 12% para CSLL |
| Base comum do Presumido para serviços | Receita líquida da atividade no trimestre × 32% para IRPJ e CSLL |
| Acréscimo de presunção | Acréscimo relativo de 10% aos coeficientes sobre a parcela alcançada pela LC 224/2025; 8% passa a 8,8%, 12% a 13,2% e 32% a 35,2% nessa parcela |
| Base gerencial do Real | Máximo entre zero e a soma assinada do resultado anterior a IRPJ/CSLL no trimestre |
| IRPJ normal | Base do IRPJ × 15% |
| Limite do adicional | R$ 60.000 por trimestre civil completo |
| Base dentro do limite | Menor valor entre a base acumulada e R$ 60.000 |
| Base excedente | Máximo entre zero e a base acumulada menos R$ 60.000 |
| Adicional de IRPJ | Base excedente × 10% |
| IRPJ acumulado | Normal + adicional |
| CSLL | Base da CSLL × 9% para a pessoa jurídica comum contemplada pelo cenário |
| Movimento do mês | Provisão acumulada atual − provisão anteriormente reconhecida |
| Valor na DRE | Sinal oposto ao movimento: provisão é dedução; reversão é valor positivo |

Os percentuais de presunção acima são os das atividades genéricas contempladas pelo produto. Atividades especiais, receitas financeiras, ganhos de capital, retenções e regimes específicos podem exigir outros tratamentos e informações. O cálculo não deve inferir atividade fiscal ou classificação de fornecedor a partir do nome. [Lei 9.249/1995, arts. 3º, 15 e 20; referências 2–4.]

### Provisão parcial e meses ausentes

O modelo usa o limite integral de R$ 60.000 na provisão de cada mês do trimestre, inclusive quando ainda faltam meses. Essa é a política gerencial escolhida para antecipar o fechamento trimestral. Não é uma afirmação de que o adicional mensal por estimativa tenha esse limite. Meses ausentes não reduzem o trimestre para fins dessa provisão e não recebem receitas, despesas ou impostos fictícios.

Uma provisão calculável pode ter `available: true`, `status: PROVISIONAL` e `closure.available: false`. O quadro então mostra os valores conhecidos e o motivo de fechamento pendente. Um trimestre com três competências conhecidas ainda pode ter fechamento pendente se faltar a informação anual necessária para o ajuste de encerramento do Presumido. Se a base ou a incidência do acréscimo não puder ser determinada, o valor fiscal permanece indisponível, em vez de virar zero.

### Centavos e arredondamento

As bases são conservadas sem arredondamento intermediário, com representação decimal racional para conferir os tributos. Cada provisão acumulada de IRPJ normal, adicional e CSLL é arredondada separadamente em centavos pelo critério `HALF_UP_COMPONENT_CENTS`: a metade do centavo é arredondada para cima em valor absoluto. O movimento é a diferença entre esses inteiros em centavos; por isso os movimentos conciliam exatamente com o fechamento. O consolidado soma os componentes de cada período já arredondados.

Esse critério é uma política explícita de cálculo e apresentação do produto. As fontes aqui citadas não são utilizadas para afirmar uma regra geral da Receita Federal de arredondamento ou truncamento que não foi comprovada. O quadro exibe bases com duas casas para leitura, mas confere os impostos contra a base racional capturada, não contra o texto arredondado da célula.

## Memória de nove linhas na DRE

| Chave | Conteúdo no mês |
| --- | --- |
| `irpjTaxBase` | Base acumulada nas competências conhecidas do trimestre |
| `irpjAdditionalLimit` | Limite de R$ 60.000 da provisão trimestral |
| `irpjBaseWithinLimit` | Parcela acumulada da base dentro desse limite |
| `irpjExcessBase` | Excedente positivo acumulado |
| `irpjNormalAssessed` | IRPJ normal acumulado, a 15% |
| `irpjAdditionalAssessed` | Adicional acumulado, a 10% |
| `irpjTotalAssessed` | Soma das duas parcelas acumuladas |
| `irpjPreviousProvision` | Provisão já reconhecida antes da competência atual |
| `irpjCurrentMovement` | Diferença reconhecida na DRE desta competência |

As sete primeiras linhas são acumulados, não valores a somar entre os meses. O consolidado utiliza o último acumulado de cada trimestre capturado; na ponte consolidada, a provisão anterior é zero e o movimento corresponde à soma dos movimentos reconhecidos. Um fechamento incompleto conserva sua condição provisória. O quadro não é outra dedução de tributos.

As linhas principais `irpjBasic` e `irpjAdditional` representam os movimentos de cada componente. Ambas já estão incluídas no total de IRPJ da DRE. Quando a provisão diminui, uma dessas parcelas pode aparecer positiva na DRE: é reversão contábil da estimativa, não restituição ou crédito fiscal confirmado.

No Simples Puro e Híbrido, a indicação “No DAS” exige cenário disponível, IRPJ externo igual a zero e motivo explícito de inclusão no DAS. Um erro de captura, uma competência inválida ou uma pendência de RBT12 não é escondido por esse rótulo.

### Exemplo sintético de reversão do Real

| Competência | Resultado antes de IRPJ/CSLL | Base acumulada positiva | IRPJ acumulado | Provisão anterior | Movimento do IRPJ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Janeiro | R$ 100.000 | R$ 100.000 | R$ 19.000 | R$ 0 | R$ 19.000 |
| Fevereiro | −R$ 80.000 | R$ 20.000 | R$ 3.000 | R$ 19.000 | −R$ 16.000 |
| Março | R$ 0 | R$ 20.000 | R$ 3.000 | R$ 3.000 | R$ 0 |

Janeiro inclui normal de R$ 15.000 e adicional de R$ 4.000. Em fevereiro, a provisão normal diminui R$ 12.000 e o adicional diminui R$ 4.000. O trimestre fecha em R$ 3.000, igual à soma de R$ 19.000 − R$ 16.000 + R$ 0. Somar apenas bases mensais positivas produziria outro resultado e perderia a reversão.

## LC 224/2025 e encerramento anual

Nos cenários de 2027 e 2028, o limite de referência é R$ 1.250.000 por trimestre, com o saldo não utilizado dos trimestres anteriores quando conhecido. O excedente alcançado é distribuído pelas atividades conforme a proporção da receita do trimestre. O motor captura limite, saldo anterior, excesso e bases acrescidas por período. Um conjunto incompleto de meses não comprova saldo anterior igual a zero. [Referências 5–7.]

O encerramento anual é distinto do adicional de IRPJ sobre a base tributável: trata-se do ajuste do acréscimo dos coeficientes de presunção. Quando a receita anual conhecida não ultrapassa R$ 5 milhões, o motor remove os acréscimos e reconhece a reversão correspondente. Quando o excesso anual é igual ou superior ao excesso já considerado nos trimestres anteriores, o quarto trimestre recebe o residual. O quadro de dezembro conserva os quatro períodos e a ponte com os valores reconhecidos até novembro.

O ramo em que `0 < excesso anual < soma dos excessos dos trimestres anteriores` permanece indisponível para fechamento automático. A redação reproduzida no Manual da ECF descreve uma proporção por excesso anterior, mas a etapa seguinte não é suficiente para certificar aqui a fórmula numérica completa de redistribuição. O produto informa a pendência e preserva os períodos originais para conferência; não estima esse rateio nem escolhe arbitrariamente um adicional. Essa restrição não altera os três trimestres de janeiro a setembro.

A entrada em vigor do acréscimo foi diferente para IRPJ e CSLL em 2026, inclusive com limite anual específico da CSLL naquele ano. O motor atual só admite cenários de 2027/2028; a origem de 2025 não desativa as regras do ano simulado. [Referência 6, perguntas 11 a 14.]

## Limites dos dados e da estimativa do Real

Compras não comprovam o CMV: uma apuração completa exige estoque inicial, aquisições/custos atribuíveis e estoque final, além dos ajustes aplicáveis. O resultado contábil precisa ser conciliado com adições e exclusões fiscais. Prejuízos fiscais de IRPJ e bases negativas de CSLL precisam de saldos separados e regras próprias de compensação; não são presumidos pelo simulador. [RIR/2018 e orientações da Receita, referências 4 e 8.]

Receitas e despesas não identificadas permanecem pendências ou premissas gerenciais. O modelo não cria despesas para aproximar um imposto desejado, não atribui a terceiros um regime sem prova e não transforma diferenças entre PGDAS e relatórios de vendas em receita de uma atividade arbitrária. A comparação gerencial com os quatro regimes depende da qualidade e da cobertura das informações capturadas.

## Histórico, integridade e exportações

`INCOME_TAX_ASSESSMENT_V2` guarda a apuração, os períodos, as bases exatas, provisões, movimentos, estados e motivos. `IRPJ_RECONCILIATION_V2` apenas confere e apresenta essa captura. A conferência valida identidade das competências, trimestre de origem e ano do cenário, componentes em centavos, bases racionais, soma assinada do Real, provisão anterior, movimento e ligação ao IRPJ/CSLL da DRE. Ela não executa novamente o motor para substituir o imposto salvo.

A ausência da captura V2 em um resultado identificado como modelo novo permanece indisponível. A apresentação não cai silenciosamente no método legado. Dados ausentes, duplicados ou divergentes conservam seus motivos e o total histórico capturado.

Os snapshots V1 continuam com seu método original, sete linhas, valores e calendário capturados. Nesse método histórico, a competência era anualizada e depois dividida por 12, produzindo estimativas mensais independentes com limite equivalente a R$ 20.000; projeções anuais guardavam o limite de R$ 240.000. Esses registros não são reescritos nem declarados apuração trimestral. A versão nova exige reprocessamento explícito, com origem e vínculo da versão anterior preservados.

Tela, impressão, CSV e PDF utilizam a mesma versão, os regimes selecionados e o período escolhido. A memória na tela apresenta as taxas da fórmula, sem misturar um segundo percentual sobre a receita em cada célula. No CSV, eventuais colunas de análise vertical são explicitamente nomeadas. As duas composições e as nove linhas de memória são informativas e não são somadas novamente aos tributos ou ao resultado.

## Referências primárias

1. [Lei nº 9.430/1996, arts. 1º e 2º — Câmara dos Deputados, texto atualizado](https://www2.camara.leg.br/legin/fed/lei/1996/lei-9430-27-dezembro-1996-367738-normaatualizada-pl.html): trimestre civil e alternativa anual do Real com estimativas.
2. [Lei nº 9.249/1995, arts. 3º, 15 e 20 — Câmara dos Deputados, texto atualizado](https://www2.camara.leg.br/legin/fed/lei/1995/lei-9249-26-dezembro-1995-349062-normaatualizada-pl.html): alíquotas, adicional e percentuais de presunção.
3. [Receita Federal — IRPJ](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IRPJ): 15%, adicional de 10% e limite proporcional ao período de apuração.
4. [Receita Federal — CSLL](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/CSLL): base, alíquotas e períodos de apuração.
5. [Lei Complementar nº 224/2025, art. 4º — Câmara dos Deputados](https://www2.camara.leg.br/legin/fed/leicom/2025/leicomplementar-224-26-dezembro-2025-798608-normaatualizada-pl.html): acréscimo relativo e limite anual.
6. [Receita Federal — Perguntas e respostas, versão 5, 30/07/2026, perguntas 11 a 14](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios-v5-final.pdf/view): incidência por trimestre, atividades e transição de 2026.
7. [SPED — Manual da ECF, Leiaute 12, edição atualizada em julho de 2026, Bloco P, item XII, páginas 324–326](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/ecf/manuais-e-documentos-tecnicos/manual_ecf_leiaute_12_20_05_2026_ac_2025_sit_esp_2026.pdf): saldo não utilizado e revisão anual da presunção, conforme IN RFB 2.305/2025 alterada pela IN RFB 2.306/2026.
8. [Decreto nº 9.580/2018 — Câmara dos Deputados, texto atualizado](https://www2.camara.leg.br/legin/fed/decret/2018/decreto-9580-22-novembro-2018-787360-normaatualizada-pe.html): resultado contábil, ajustes e estoques/CMV.
9. [Lei Complementar nº 214/2025 — Planalto, texto compilado](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm): regras e transição de CBS/IBS; não equipara uma simulação de 2027 à apuração efetiva de 2025.

Revisão das fontes: 4 de novembro de 2026. Os exemplos deste documento são sintéticos e não identificam uma empresa ou uma apuração fiscal real.
