# Maximum CNPJ · v0.28.1

## Naturezas, antecipação de ICMS e RBT12 mensal — 22/10/2026

Esta seção descreve o contrato atual. As entregas datadas abaixo documentam o comportamento das versões anteriores.

- **Naturezas:** catálogo de 619 códigos da planilha fornecida, classificado pela coluna **D — OPERAÇÃO**. Nos relatórios financeiros, a natureza da coluna L é normalizada pelos quatro primeiros dígitos. Descrições e sufixos não mudam a classificação. A coluna D do cadastro não é uma coluna monetária: a base financeira continua **Q − Y + AA − AB**, com Z apenas informativa.
- **Receita:** somente operações VENDA e serviços de venda 9000, abatendo as DEVOLUÇÕES DE VENDA encontradas no relatório de compras, na competência da coluna H. Devoluções de compra e outras operações do relatório de vendas ficam fora dessa base. O enquadramento do documento permanece o capturado na consulta.
- **Compras consideradas:** operações COMPRAS e serviços de natureza 8000, inclusive `8000002` e `8000102`. Devoluções de venda reduzem a receita uma única vez e não integram as compras. A conferência discrimina inclusão, exclusão e conciliação com o total original por natureza.
- **DIFAL sobre vendas:** 10% por linha VENDA a CPF com UFs brasileiras confirmadas e diferentes. Nova versão `DIFAL_ESTIMATE_V3` usa todas as naturezas de venda do catálogo. V1/V2 continuam com suas regras salvas. Serviços 9000 não geram DIFAL.
- **Antecipação de ICMS:** 7,32% somente das compras interestaduais com CPF (11 dígitos), incluindo serviços 8000. CNPJ, CNO e documentos ausentes ou fora do formato CPF não geram antecipação. A prévia, os detalhes das linhas, o resumo, o CSV e o PDF de compras exibem a estimativa, a base elegível e eventuais UFs pendentes; o cálculo é confirmado no servidor. Compras sem CPF continuam nos custos quando a natureza é elegível. Linha separada na DRE, deduzida uma única vez somente no Simples puro e híbrido; zero quando a RBT12 da competência alcança R$ 3,6 milhões (inclusive) ou há ICMS fora do DAS, conforme a regra gerencial solicitada para este simulador. Não cria crédito adicional e não altera Lucro Presumido/Real. UFs ausentes ficam pendentes; novos relatórios de compras mantêm sua própria UF na DRE, sem herdar uma UF das vendas para eliminar a pendência. Ajustes manuais do cenário não reescrevem a base importada.
- **RBT12 móvel:** todas as receitas explícitas do quadro 2.2 são conservadas. Cada competência usa seus 12 meses anteriores, somando mercados interno e externo. O valor do PA é apenas referência; o ano projetado não desloca as competências de origem. Ausência de um mês bloqueia o cálculo, sem usar quadro 2.1, médias ou zeros inventados. A alternativa manual existente continua explícita e identificada como fixa.
- **Histórico:** snapshots antigos permanecem imutáveis. A revisão `CPF_ANTICIPATION_2026_10_V3` cria versões vinculadas com as novas bases e a restrição de CPF. Antecipação V1 conserva sua regra original; relatórios anteriores sem versão mostram a estimativa como indisponível, sem inventar zero. Compras antigas sem natureza/UF ou extratos sem meses suficientes ficam pendentes para reimportação. Relatórios brutos conservam seus totais; a DRE recebe `selectedTotalCents` e auditoria próprios.
- **Contratos:** catálogo `NATURE_OPERATIONS_2026_10_V1`, antecipação `ICMS_ANTICIPATION_V2`, RBT12 `RBT12_MONTHLY_SECTION_22_V1` e modelo mensal `1.4.1-cpf-anticipation`. JSON, CSV, PDF, tela e calendário preservam as evidências e competências correspondentes.

Os percentuais de 10% e 7,32% são premissas gerenciais solicitadas, não uma consulta de alíquotas legais por operação. A composição do quadro 2.2 segue a descrição do [Manual PGDAS-D da Receita Federal](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf). O bloqueio gerencial de antecipação por RBT12 não substitui a apuração legal dos efeitos do sublimite por RBA/RBAA. A publicação e a revisão de dados de produção são etapas separadas desta entrega de código.

Validação da v0.28.1: tipos, build, versão e diff conferidos; 220 testes de regras, 69 de integração/reprocessamento, 141 Python/PDF/OCR e 114 de navegador aprovados, sem skips. O fluxo com CPF e CNPJ confere custos preservados, antecipação restrita a CPF, relatório/CSV, DRE, sublimite e reabertura do histórico. Teste adicional garante a mesma pendência quando falta UF nas compras. Node e Python coincidem em 19.968 casos de antecipação. PDF e layouts desktop/mobile inspecionados. Runtime local Node 24.19.0; CI configurada para Node 22.

## Conferência e evolução das simulações — 22/10/2026

- O histórico identifica o método salvo: soma das competências importadas ou projeção mensal legada. Cada card mostra o período de origem; os totais continuam exatamente como foram salvos.
- Originais com revisão concluída oferecem acesso direto à versão atualizada, preservando a consulta e a exclusão independente de cada versão. Links só apontam para simulações existentes no mesmo workspace.
- O acompanhamento da revisão mostra progresso e diferencia versões concluídas de pendências. Versões já criadas passam a aparecer mesmo quando o restante do lote é interrompido.
- A DRE permite conferir a evolução entre competências usando seus valores salvos: receita, resultado, margem e DIFAL. Ausência de dados, referência anterior zero e projeções legadas recebem indicação própria; não se recalculam tributos ao navegar.
- Ao gerar, um campo incompleto de outra competência leva ao mês e ao campo que precisam de correção. Ao editar valores de um resultado já gerado, um aviso oferece atualizar a simulação; a versão anterior permanece no histórico.
- Correções de regressões do fluxo guiado validam despesas inicialmente em zero, total pela soma das competências e alternância anual com os controles atuais.

A revisão do histórico ainda precisa da página Simulações aberta e visível com perfil administrador ou operador. Esta entrega não executa um lote sobre o banco de produção. Cálculos gerenciais, regras de DIFAL e snapshots permanecem preservados.

## DRE mensal ou anual — 20/10/2026

- A escolha **Mensal / Anual** fica dentro da DRE, antes do resumo visual, com o período ativo em destaque.
- Mensal abre um mês por vez, com seletor único de competência para o resumo, a tabela e os indicadores. A consulta dos 12 meses lado a lado continua disponível.
- Anual apresenta o consolidado: nas simulações por competência, soma os meses importados. A troca conserva o mês, o regime e os percentuais escolhidos, sem recalcular ou gravar outra versão.
- Meses sem dados têm identificação no seletor e estado vazio. Simulações antigas conservam a indicação e os valores da projeção salva. Impressão e exportações completas permanecem disponíveis.

## DRE visual — 20/10/2026

- O resultado abre pela DRE. Comparações entre regimes ficam em uma seção recolhida, com gráficos complementares e memória abaixo do demonstrativo. Ao reabrir o histórico, a DRE vem antes da conferência dos relatórios de origem.
- Receita bruta, deduções líquidas e resultado recebem destaque, com margem e indicação de lucro, prejuízo ou equilíbrio. Um gráfico mostra os movimentos já contidos na DRE, sem somar composições ou créditos novamente.
- O resumo lê exatamente as células do regime e mês selecionados. Composição ausente ou divergente impede o gráfico, preservando os valores originais e indicando a necessidade de conferência. Meses sem dados e regimes indisponíveis continuam sem valores.
- A tabela permanece única, com todas as linhas e composições, hierarquia visual e atalhos para receitas, tributos, compras, despesas e resultado. O regime selecionado fica em destaque na comparação anual.
- Controles, resumo e gráfico adaptados a telas de 320 px, 390 px e desktop; foco de teclado e navegação entre competências preservados. Impressão conserva a tabela completa; CSV e JSON mantêm valores, ordem e conteúdo.

## Interface por competência — 20/10/2026

- Base importada com totais distintos de vendas e compras, período visível e conferência mês a mês.
- Seletor de competência com nome do mês, anterior/próxima e contexto fixo durante a edição. O resumo reúne receitas, compras, despesas e DIFAL do mês; as seções repetem a competência selecionada.
- Receitas e compras ajustadas recebem identificação própria. Restaurar um mês repõe somente suas receitas e compras, preservando despesas e os demais meses; a restauração do período inteiro tem rótulo explícito.
- DIFAL com valor mensal, base elegível e total do período separados. Pendências de UF ficam em destaque; a conferência de todos os meses conserva seu estado ao editar valores.
- Painel de resultados com seletor de mês sempre acessível, origem e ano do cenário distintos e atalho para a DRE. A seleção acompanha a consulta mensal da DRE; navegar entre competências preserva a simulação salva sem gravar outra versão.
- Layout adaptado para computador e celular, controles de teclado, cabeçalhos e indicadores fixos durante a rolagem da tabela. Impressão, exportações, valores e regras de cálculo preservados.

## Valores por competência — 20/10/2026

- Compras, vendas, serviços e DIFAL são agregados pela data da coluna H, usando os valores líquidos Q − Y + AA − AB e o enquadramento congelado na consulta. O mesmo CPF em vários meses conserva todas as suas linhas.
- O seletor de competência mostra e permite ajustar somente aquele mês. Despesas também são preenchidas por mês, inicialmente em zero. Rascunhos, simulações, gráficos, DRE, impressão, CSV e JSON conservam a série mensal.
- `REPORT_MONTHS_V1`, `DIFAL_MONTHS_V1` e `DRE_CALENDAR_V3`: o anual soma as competências importadas, sem multiplicação por 12. Meses sem movimento dentro do intervalo confirmado têm zero; meses fora do intervalo ficam sem dados. Cada mês do relatório é associado ao mesmo mês do ano do cenário, mantendo a competência de origem na memória.
- O modelo gerencial existente estima os tributos de cada competência separadamente; os valores anuais somam essas contribuições. A RBT12 permanece fixa e não é substituída pelas receitas. Não há transporte automático de saldo credor ou compensação entre meses; os limites e premissas mensais seguem o modelo existente, sem implementar apuração fiscal trimestral.
- A revisão cria novas versões a partir dos relatórios originais. Ajustes mensais antigos são preservados como diferenças aplicadas a cada mês; despesas antigas se repetem nas competências importadas. Versões já mensais conservam seus ajustes individuais. Datas ou evidências insuficientes e ajustes que tornam uma competência inválida ficam pendentes para revisão; não se inventa uma média.
- Simulações históricas continuam sendo abertas com os valores e o método que foram salvos. Somente novas versões usam o critério mensal. A publicação em produção é uma etapa separada do PR.

## Correção 20/10/2026 — DIFAL em todas as competências

- A estimativa gerencial de 10% inclui a natureza **5102** e seus sufixos (`5102001`, `5102090`), além das naturezas 6101–6108 já previstas. No relatório Questor, a descrição pode ser o nome do produto. O cálculo usa o CPF do comprador na coluna A e compara a UF do emitente com a UF da coluna J; o primeiro dígito da natureza não substitui essa comparação.
- Todas as linhas de todas as competências da coluna H entram na conferência. O mesmo CPF pode ter várias compras e vários meses: seus valores não são descartados por repetição do documento. Serviços 9000, devoluções, remessas, CNPJ e destinatários da mesma UF continuam excluídos; UFs ausentes continuam pendentes.
- A fórmula da base permanece **Q − Y + AA − AB**, com Z informativa. O DIFAL mantém o arredondamento em centavos por linha. A DRE usa as linhas de cada competência, sem média nem extrapolação. O total anual soma somente os meses importados.
- Novas importações usam `DIFAL_ESTIMATE_V2`. Prévia, servidor, CSV e PDF preservam também a leitura e a retomada de snapshots `DIFAL_ESTIMATE_V1`, com suas regras originais. Um cenário novo a partir de um relatório V1 recebe a estimativa atual derivada das linhas já conciliadas, sem nova consulta de CNPJs.
- Ao abrir **Simulações**, administradores e operadores iniciam a revisão `REPORT_MONTHS_2026_10_V1`, inclusive para originais já revisados no lote anterior. A correção cria versões vinculadas, preservando originais, versões anteriores, ajustes e RBT12. Reabrir a tela não duplica versões. O relatório original conserva seu valor histórico; uma nova importação emite o relatório atualizado.
- Regressões sintéticas cobrem 12 competências, CPF repetido, prefixos 5102, exclusões, retomada V1, reprocessamento, DRE e exportações. Nenhum relatório real de cliente é versionado.

## Verificação integrada da entrega

A regressão em `tests/e2e/dre-complete.spec.ts` confere serviços e DIFAL em todos os regimes, na DRE anual, nos 12 meses e no CSV. Repete a conferência após recarregar o histórico e verifica que a exportação JSON preserva os resultados e que a navegação não grava pela API. Os dados são sintéticos.

Este complemento de testes parte da v0.24.0, que já reúne as entregas dos PRs #27–#31 e a classificação de serviços 9000. Não altera fórmulas nem reprocessa dados de produção.

## Leitura do extrato 19/10/2026

- A seção 2.2 reconhece valores que o OCR juntou à competência seguinte, somente quando a separação entre centavos e mês/ano é inequívoca. Os dígitos originais são preservados.
- Cabeçalhos repetidos em páginas de continuação, identificação quebrada em linhas e espaços na pontuação do CNPJ são tratados sem confundir o PA com uma receita mensal. Os mercados interno e externo e as 12 competências continuam obrigatórios.
- Dados críticos com baixa confiança ou valores fragmentados bloqueiam a confirmação; a ausência de mês nunca é preenchida automaticamente com zero.
- Texto nativo com rotação cardinal uniforme tem a ordem corrigida para leitura; tokens idênticos na mesma posição não são contados duas vezes. As páginas visuais originais são preservadas.
- A telemetria do runtime OCR é desativada antes da sua inicialização, inclusive na CI. O reconhecimento usa os modelos locais.
- A releitura invalida o resultado do rascunho enquanto está em andamento. O arquivo armazenado pode ser recuperado após recarregar a tela, com conferência da empresa e do documento no servidor.
- Interrupções de conexão e falhas em novas tentativas preservam a última leitura concluída no servidor, sem apresentar uma tentativa com falha como sucesso. O original continua disponível para conferência.
- A validação usa PDFs sintéticos e comparação privada do PDF fornecido; nenhum arquivo real de cliente integra o repositório. DRE e simulações salvas permanecem preservadas.

## Ajuste 19/10/2026 — DRE única

- Todos os valores, composições e indicadores ficam na mesma tabela contínua, junto das respectivas linhas, sem separar a DRE em blocos ou painéis recolhidos.
- A visão mensal mantém os 12 meses e o total anual no mesmo demonstrativo; a exportação CSV segue a mesma ordem.
- O botão de impressão gera somente a DRE e sua identificação. O calendário não é separado em semestres; a paginação natural repete o cabeçalho para manter a leitura.
- A impressão usa A4 horizontal na comparação anual e A3 horizontal no calendário completo. O ano aparece abaixo do mês em cada cabeçalho; empresa, regime e referência da RBT12 acompanham o demonstrativo.
- Os valores, as fórmulas e as simulações salvas permanecem preservados.

## Entrega 19/10/2026 — DRE detalhada

- DRE organizada em receitas, deduções, custos e créditos, despesas operacionais e resultado, com subtotais de deduções tributárias, custos líquidos dos créditos, despesas operacionais e IRPJ/CSLL.
- Composição das receitas de vendas e serviços, créditos e IRPJ integrada à tabela única desde a v0.23.1. Os valores são apresentados somente quando conciliam com a simulação; dados ausentes não viram zero. Créditos informativos e saldos credores não são somados novamente ao resultado.
- Análise opcional de cada linha como percentual da receita bruta do mesmo regime e período, além de indicadores de margem e carga sobre a receita. Sem receita positiva ou regime disponível, percentuais não são calculados.
- Visões anual e mensal usam os resultados já salvos. O calendário histórico permanece a fonte dos meses; a nova apresentação não altera o motor fiscal nem grava outra simulação.
- Exportação da DRE em CSV e da simulação em JSON com a apresentação detalhada. Desde a v0.23.1, a impressão reúne os 12 meses na mesma tabela e inclui a identificação do regime, sem separar o calendário em semestres.

## Correção 19/10/2026 — simulações antigas com serviços manuais

- Na tela antiga, serviços manuais eram informados por mês, sem repetir os valores já incluídos nas vendas importadas. O recálculo respeita esse contrato: separa os serviços do relatório das mercadorias e soma a eles o serviço manual já salvo, sem alterar seu valor mensal.
- A nova versão registra a base importada, o adicional manual e o total de serviços. A receita combinada é preservada, ressalvadas correções de classificação/saldo e o rateio em centavos já registrado na memória.
- Pendências antigas por `SERVICE_REVENUE_AMBIGUOUS` são retomadas automaticamente uma única vez. Versões já concluídas, cenários originais e demais pendências permanecem preservados.

Node.js 22 + TypeScript + MongoDB. Relatórios e leitura do Extrato do Simples em Python. Identidade Maximum, autenticação, permissões e isolamento por workspace preservados. Sem Google Cloud.

## Entrega 19/10/2026 — detalhes recolhidos e recálculo do histórico

- Detalhes financeiros começam recolhidos e conservam a escolha do usuário ao alternar abas ou períodos. A impressão expande as informações e depois restaura o estado anterior; modais continuam abrindo apenas pela ação correspondente.
- Ao abrir **Simulações** com acesso de administrador ou operador, o sistema inicia ou retoma automaticamente a revisão das simulações salvas até o início do lote no workspace. O painel informa quantos registros estão na fila, em processamento, OK, pendentes ou com falha; usuários de visualização acompanham sem iniciar alterações.
- Cada simulação antiga com dados verificáveis recebe uma nova versão vinculada, incluindo a separação de serviços e o DIFAL na DRE. O registro original permanece disponível. Pedidos repetidos e acessos simultâneos não criam versões duplicadas.
- O recálculo usa os relatórios originais armazenados e preserva despesas, anexos, RBT12 comprovada e diferenças dos ajustes manuais em relação à base anterior. As operações são reclassificadas pelas regras atuais sobre as linhas congeladas; alterações no saldo, como devoluções antigas, ficam registradas na origem da nova versão. Não dispara novas consultas CNPJ nem OCR.
- Quando faltam fontes, dados de DIFAL ou RBT12 verificável, ou quando os valores armazenados não conciliam, o item fica **Pendente**, com o motivo para revisão. Nenhum desses casos recebe um OK automático.

## Entrega 19/10/2026 — serviços 9000 e DIFAL na DRE

- Naturezas são lidas pelos quatro primeiros dígitos: `900000`, `900001`, `90001234` e `9.000.01` são **9000 — Vendas de serviços**, mesmo com descrição ausente ou conflitante. O resumo guiado e o PDF mostram essa operação, e as tabelas de vendas exibem natureza e descrição.
- O servidor separa serviços em cada grupo gerencial, retira esses valores dos grupos de mercadorias e preenche **Receita de serviços**. Mercadorias + serviços conciliam com o saldo do relatório; a média mensal é rateada em centavos entre os quatro grupos de receita, sem duplicação. Ajustes manuais ficam registrados.
- Novas simulações incluem uma linha **DIFAL estimado (10%)** na DRE. O total elegível do relatório é dividido pelas competências importadas e arredondado em centavos; o anual é a média mensal × 12. A dedução entra uma única vez na receita líquida, no total de tributos e no resultado antes de IRPJ/CSLL, incluindo a base do Lucro Real.
- É a mesma estimativa gerencial nos regimes comparados, não uma determinação da alíquota legal de cada operação. Serviços continuam fora da elegibilidade do DIFAL. Alterações manuais no faturamento não alteram a base elegível importada; pendências de UF continuam explícitas.
- A origem, o total importado, as médias, a base elegível e a memória ficam visíveis. Desde a v0.22.0, seções financeiras começam recolhidas; a impressão continua expandindo todas elas.
- Modelo `1.2.0-services-difal`, projeção de receitas `AVERAGE_X12_V2` e referência `DIFAL_DRE_V1`. Os registros originais são reproduzidos pelos valores salvos, sem alterar sua versão nem inventar DIFAL zero quando a referência não existe. A v0.22.0 adiciona a revisão automática com novas versões vinculadas e pendências explícitas. Criar uma nova versão busca a base atual; na migração, valores importados são separados novamente e o serviço manual anterior fica visível para revisão, preservando despesas e RBT12.

Validação com dados sintéticos: prefixos 9000, separação por grupo, arredondamento, conciliação de receitas, DIFAL na DRE, persistência/isolamento, relatórios PDF e fluxo no navegador.

## Correção 16/10/2026 — leitura de declarações PGDAS-D

- O leitor aceita também o modelo **Programa Gerador do Documento de Arrecadação do Simples Nacional — Declaratório**, com **CNPJ Matriz** e período de apuração por intervalo de datas do mesmo mês. O modelo anterior de Extrato do Simples permanece aceito.
- A RBT12 continua calculada exclusivamente pelas 12 competências anteriores ao PA na seção 2.2, somando os mercados interno e externo. Identificações conflitantes, valores ilegíveis, meses ausentes e números monetários fragmentados bloqueiam a leitura.
- A leitura e o reprocessamento aproveitam o texto digital legível do PDF. O OCR continua reservado às páginas em imagem; isso evita introduzir ambiguidades de reconhecimento em documentos digitais válidos.
- O PDF de exemplo foi utilizado somente na validação local. Nenhum documento ou dado real de cliente integra os testes ou o repositório; os casos de regressão usam dados sintéticos.

## Entrega 14/10/2026 — navegação inspirada na referência visual

- Menu lateral claro com cabeçalho Maximum, grupos **Principal** e **Análises**, ícones discretos e destaque bordô somente na página ativa.
- **Visão geral** e **Nova análise** tornam os destinos mais claros. O menu abre com os nomes visíveis no primeiro acesso desktop; a preferência explícita de recolher continua preservada.
- Atalho inferior para começar uma análise; usuários de visualização recebem um acesso ao histórico. O atalho é ocultado em telas baixas para priorizar os controles da conta.
- O mesmo componente atende painel, gerações, compras, vendas, relatórios e simulações. O drawer móvel conserva Escape, fechamento externo, foco contido e bloqueio do conteúdo ao fundo.
- Marca oficial, rotas, permissões de servidor, consultas, cálculos e históricos permanecem preservados. Não há migração de dados nem alteração na publicação de produção.

Validação: regressões de navegação em `tests/e2e/branding.spec.ts`, incluindo preferência antiga, armazenamento indisponível, acessos de visualização e telas estreitas/baixas. A CI executa os gates de Node 22, MongoDB descartável, Python/PDF e navegador; consulte o resultado do commit para distinguir verificações aprovadas das ainda pendentes.

## Correção 09/10/2026 — recuperação das consultas CNPJ

- A indisponibilidade da Minha Receita pode produzir um relatório com todos os CNPJs não confirmados. O sistema agora tenta a API pública **OpenCNPJ** quando a fonte principal falha por rede, timeout, HTTP 5xx sem `Retry-After` ou resposta inválida. Não usa a BrasilAPI como alternativa porque seu endpoint CNPJ depende da própria Minha Receita.
- Cada consulta conserva a identidade completa, a fonte realmente consultada e os indicadores explícitos do Simples/MEI. Ausência, conflito ou falha continuam **Não confirmado**; não comprovam que a empresa está fora do Simples. Os grupos gerenciais e os valores importados permanecem iguais.
- O timeout total permanece em **12 segundos**, com até 6 segundos por fonte. Bloqueios, limites, `Retry-After`, identidade divergente e CNPJ não encontrado não acionam a alternativa. Permanecem as pausas compartilhadas e as tentativas limitadas.
- Resumos guiados e relatórios completos passam a indicar **Consulta encerrada com pendências**, exibindo contagem e motivos. A fonte efetiva também aparece no acompanhamento e nas exportações.
- **Consultar CNPJs novamente** reaproveita as linhas e os valores importados e abre uma nova consulta automaticamente. Reenvios do mesmo pedido não criam lotes duplicados. O relatório novo fica no histórico da empresa; o relatório e a geração anteriores ficam preservados e não são substituídos automaticamente.
- Não há alteração nas regras financeiras, no DIFAL ou na autenticação. CPF/CNO/documentos inválidos continuam fora das APIs de CNPJ.

Diagnóstico, arquivos alterados e validação: [`docs/CNPJ-RECOVERY-V0.20.1.md`](docs/CNPJ-RECOVERY-V0.20.1.md).

## Entrega 09/10/2026 — DIFAL estimado nas vendas

- **DIFAL = total da venda × 10%**, em centavos inteiros com arredondamento de meio centavo para cima. O percentual é uma média estimada solicitada para uso gerencial, não uma alíquota legal universal.
- A regra exige venda de mercadoria, CPF, UF brasileira do emitente diferente da UF do destinatário e natureza explicitamente habilitada. A configuração inicial contempla **6101, 6102, 6103, 6104, 6105, 6106, 6107 e 6108**. Outros CFOPs dependem de inclusão explícita após validação; o prefixo 6, sozinho, nunca habilita o cálculo. Serviços, devoluções, remessas, transferências e CNPJs ficam fora.
- Selecione a **UF do estabelecimento emitente** na importação; a UF cadastrada é reaproveitada quando disponível. A coluna **J — Estado** fornece a UF do destinatário. UF ausente/ inválida é indicada como pendência para operações candidatas, sem estimar localização pelo CPF.
- A base é o total já registrado pela fórmula **Q − Y + AA − AB**, preservando frete, descontos, abatimentos, a despesa Z informativa e os demais tributos. O DIFAL aparece separado e não altera o total da venda. A partir da v0.21.0, sua projeção mensal/anual integra os tributos e a DRE de novas simulações.
- Prévia, resumo guiado, relatório detalhado, CSV e PDF apresentam o DIFAL estimado. Alterar a UF na prévia recalcula o resultado; trocar o arquivo recalcula valores, destinatários e naturezas. Como os relatórios concluídos são snapshots imutáveis, correções posteriores exigem nova importação. Reenvios da mesma parte não duplicam valores.
- O servidor recalcula cada linha e reconcilia o total antes da emissão. Relatórios anteriores à regra permanecem legíveis e indicam DIFAL indisponível; não recebem cálculo retroativo. O simulador conserva a estimativa do relatório de origem separadamente dos ajustes manuais do cenário e projeta sua dedução na DRE de novas simulações.

Detalhes da regra, arquivos e validação: [`docs/DIFAL-V0.20.md`](docs/DIFAL-V0.20.md).

## Correção 09/10/2026 — consulta de CNPJs mais rápida

- O processamento coordena a entrada dos workers antes de consultar o controle global no MongoDB, reduzindo a disputa e as operações repetidas no banco. Gravações independentes ocorrem em paralelo; um item só fica concluído depois de persistir os dados necessários.
- O padrão passa a **4 consultas simultâneas e intervalo global mínimo de 300 ms**, dentro dos limites já suportados. `LOOKUP_CONCURRENCY` e `LOOKUP_INTERVAL_MS` continuam configuráveis; valores explícitos no ambiente prevalecem sobre o padrão.
- Falhas pontuais de rede ou resposta inválida tentam novamente somente o CNPJ afetado. Limites da fonte, bloqueios e indisponibilidade HTTP continuam pausando globalmente e respeitando `Retry-After`.
- Um lote com trabalho pronto continua sem a pausa fixa anterior. Quando só há tentativas futuras, a tela espera o prazo informado pelo servidor. A resposta do processamento é reaproveitada e o acompanhamento guiado solicita somente os indicadores, sem carregar tabelas invisíveis.
- Nenhum cache substitui uma nova consulta: cada novo lote continua verificando os CNPJs na fonte. CPFs/CNOs/inválidos não são consultados; dados financeiros, autenticação, isolamento e conciliação final são preservados.

O timeout da fonte (12 s), o orçamento do lote (24 s) e o máximo de 40 itens por chamada continuam os mesmos. O tempo real depende da fonte e do banco; os testes de desempenho usam CNPJs e respostas sintéticas, sem gerar carga em dados de clientes. Medições reproduzíveis e verificações estão em `docs/LOOKUP-PERFORMANCE-V0.19.1.md`.

## Entrega 09/10/2026 — navegação compacta e geração revisada

- Navegação com trilho de ícones de 72 px e painel expansível com nomes. O estado fica salvo no navegador; no celular, o menu abre em um drawer com fechamento por Escape/toque externo, foco contido e conteúdo de fundo indisponível enquanto estiver aberto.
- Busca de empresas e escolha de relatórios mais compactas, com hierarquia simples, resumo da seleção e controles acessíveis. Compras e vendas continuam selecionadas por padrão; um relatório isolado não exige o simulador.
- Importação e campos do simulador com espaçamento consistente, menos efeitos decorativos e indicação dos valores monetários, obrigatoriedade e origem dos campos.
- Rejeições definitivas de criação liberam novamente a empresa e os relatórios para correção. Falhas temporárias ou respostas incertas preservam a mesma identificação e os mesmos dados no reenvio, sem gerar outro pedido inadvertidamente.
- Vendas antigas sem saldo líquido explícito continuam usando seus totais originais, conforme o contrato histórico. Percentuais de vendas seguem o mesmo arredondamento do PDF, sem alterar valores, classificações ou fórmulas tributárias.
- Validações de naturezas/CFOP, devoluções, competências, RBT12, conciliação de snapshots e isolamento de empresas permanecem obrigatórias. Não há migração de dados nem recálculo dos históricos.

A verificação usa somente dados sintéticos: tipos/build, regras, integrações com MongoDB descartável, relatórios Python/PDF e navegação em desktop e celular. Consulte a CI do commit para o resultado dos gates. Detalhes em `docs/UI-NAVIGATION-V0.19.md`.

## Entrega 08/10/2026 — navbar flutuante, centralizada e com recolhimento refinado

- [x] A navegação lateral passa a funcionar como um **dock flutuante**, com respiro em todas as bordas, cantos amplos e acabamento em camadas, sem ficar colada à lateral da tela.
- [x] Todos os ícones ficam rigorosamente centralizados no eixo do dock e recebem áreas individuais com `border-radius`, estados ativo, hover e foco mais claros.
- [x] **Iniciar** continua sendo a ação principal, agora com halo, profundidade e contraste reforçados sem alterar a rota ou as permissões existentes.
- [x] O botão de recolher foi redesenhado com representação visual do painel, seta animada, tooltip e estados distintos para abrir, recolher e fechar no celular.
- [x] Desktop preserva a preferência de navegação recolhida. No celular, a barra abre sobre um overlay desfocado, fecha por toque externo, link ou tecla Esc e não cria rolagem horizontal.
- [x] Acessibilidade preservada com `aria-controls`, `aria-expanded`, rótulos dinâmicos, foco visível e redução de movimentos quando solicitada pelo sistema.
- [x] Nenhum endpoint, cálculo, importação, relatório, permissão ou dado fiscal foi alterado.

## Entrega 07/10/2026 — natureza em 4 dígitos, vendas, serviços, devoluções e outras

- [x] O relatório de vendas passa a classificar cada linha em **Venda**, **Serviço**, **Devolução** ou **Outras**, preservando o valor bruto e a descrição original para conferência.
- [x] A coluna **Natureza / CFOP** é normalizada sempre para os **4 primeiros dígitos numéricos** antes da classificação e antes de persistir. Exemplos: `900001 → 9000`, `520201 → 5202`, `5.202.01 → 5202`.
- [x] A natureza **9000** é tratada como **Serviço**. Venda/Serviço/Outras entram positivas; **Devolução sempre abate o saldo**, inclusive nos grupos gerenciais, CSV, PDF e campos enviados ao simulador.
- [x] CFOPs de devolução e outras fornecidos na tabela operacional têm precedência. Quando não houver regra explícita, a descrição complementa a identificação de venda/serviço/devolução/outras.
- [x] O backend recalcula a natureza de 4 dígitos e o sinal da operação; o navegador não é fonte de verdade. O valor original da linha permanece separado do impacto no saldo. Na emissão, **total bruto**, **subtotal bruto dos CNPJs** e **saldo líquido** são reconciliados separadamente; qualquer divergência bloqueia o relatório e o simulador.
- [x] A tela de vendas mostra o quadro **Vendas | Serviços | Devoluções | Outras**, quantidade de linhas, valor antes do sinal e impacto líquido. A listagem detalhada também exibe a operação e o saldo; quando um comprador agrupado possui operações diferentes, a coluna indica **Múltiplas** em vez de classificar incorretamente como Outras. Os metadados Natureza/Operação/Saldo são exclusivos do fluxo de **Vendas**, preservando o contrato anterior de **Compras**.
- [x] Os KPIs de Optantes SN, Não Optantes SN e CPF usam o **saldo líquido**; devoluções reduzem o grupo correspondente antes de preencher o simulador. Um grupo isolado pode ficar negativo quando suas devoluções superam as vendas daquele grupo; a projeção aceita esse saldo assinado e bloqueia somente quando o **total líquido das vendas** do período fica negativo.
- [x] Históricos anteriores continuam legíveis: snapshots sem operação/saldo usam o comportamento anterior como fallback e não são reclassificados retroativamente.
- [x] Testes cobrem `900001 → 9000 → SERVIÇO`, normalização de naturezas maiores que quatro dígitos e validação server-side.

## Entrega 05/10/2026 — início guiado, arquivos automáticos e RBT12 opcional por PDF

- [x] **Iniciar** abre uma busca por número/código, nome ou CNPJ. Ao selecionar uma empresa, um diálogo pergunta quais relatórios incluir. Compras e vendas vêm selecionados; é possível escolher somente um. A seleção de várias empresas continua disponível em um acesso separado.
- [x] Ao confirmar, o primeiro relatório escolhido abre em um card central com área para selecionar ou arrastar CSV/XLSX/XLS. A leitura identifica a aba e o cabeçalho do modelo padrão, valida os dados e inicia o envio e a consulta automaticamente.
- [x] O fluxo guiado não exige mapear colunas nem confirmar valores. Arquivos desconhecidos, ambíguos ou inconsistentes são bloqueados com uma mensagem antes do envio. As validações de valores, identidade, competências e limites continuam ativas.
- [x] Durante a consulta, a tela acompanha o progresso. Ao concluir, apresenta somente os KPIs de documentos, valores e enquadramento; tabelas de fornecedores/compradores, memória detalhada e downloads ficam no relatório completo, acessível por um link.
- [x] **Continuar** leva ao próximo relatório escolhido da mesma empresa. Compras e vendas concluídas abrem a etapa do extrato antes dos outros campos do simulador. Um relatório isolado pode ser concluído sem exigir o tipo não escolhido; o simulador requer os dois.
- [x] Selecionar o PDF inicia a leitura da seção 2.2 automaticamente. A RBT12 fica preenchida após validar a extração. Originais armazenados, reprocessamento, conferência dos 12 meses e mensagens de erro permanecem disponíveis.
- [x] **Não tenho o extrato agora** permite informar a RBT12 efetiva manualmente, com valor obrigatório e confirmação explícita. A origem manual fica indicada na tela, no histórico, no JSON e na DRE. Não há substituição automática por vendas × 12 nem fallback silencioso de um OCR que falhou.
- [x] Após essa etapa, o simulador traz os cinco grupos de compras/vendas e a RBT12. A partir da v0.21.0, serviços são preenchidos pelo relatório, separados das mercadorias. Despesas continuam exigindo informação, inclusive zero explícito quando não existem. **Gerar simulação** calcula e salva após a validação; avançar ou restaurar um rascunho não cria outra simulação.
- [x] Históricos, exclusão definitiva, permissões, relatórios completos e reenvios idempotentes permanecem disponíveis. Nenhuma fórmula fiscal foi alterada.

A verificação desta entrega cobre o percurso sintético da seleção à persistência no MongoDB, modelos de arquivo, erros e retomada, PDF automático e alternativa manual, além de navegação no computador/celular. Execute os gates indicados abaixo; os resultados finais ficam na CI da versão.

## Entrega 05/10/2026 — botão de exclusão definitiva no Histórico

- [x] A aba **Histórico** do menu abre as gerações. Cada geração agora tem um botão vermelho **Excluir**, separado do link que abre os relatórios. A ação também aparece no detalhe da geração e em **Simulações**.
- [x] A confirmação identifica empresas/data ou simulação/cenário, descreve os dados afetados e oferece **Cancelar** e **Excluir definitivamente**. Nada é removido apenas por abrir o diálogo.
- [x] `DELETE /api/v4/generations/:id` apaga a geração, seus jobs financeiros exclusivos e as linhas, itens, etapas e partes vinculadas. Clientes, estados CNPJ compartilhados, extratos/PDFs da empresa e simulações salvas permanecem disponíveis.
- [x] `DELETE /api/v4/simulations/:id` remove fisicamente o snapshot com seus dados e resultados. Outras versões continuam legíveis, inclusive quando a origem foi excluída. Esta versão substitui a exclusão lógica da v0.15.0; não executa migração ou limpeza em massa dos registros antigos.
- [x] As rotas exigem sessão, origem válida, administrador/operador e workspace correspondente. Recibos mínimos de auditoria guardam IDs, responsável e data, sem reter o conteúdo fiscal removido; reenvios não recriam registros excluídos.
- [x] A geração e seus jobs são bloqueados antes da cascata. Processamento ativo retorna conflito recuperável; uma limpeza interrompida pode ser repetida para o mesmo ID.
- [x] A interface impede envio duplicado, apresenta falhas para nova tentativa e ajusta a paginação após excluir o último item. A publicação disponibiliza a ação; não exclui registros existentes automaticamente.
- [x] Regressões com dados sintéticos conferem botão fora do link, confirmação/cancelamento, celular, falhas, concorrência, isolamento e remoção real no MongoDB, preservando uma simulação salva após apagar sua geração.

## Entrega 05/10/2026 — simulador mais simples

- [x] Cabeçalho compacto com a empresa e atalhos para extrato, faturamento, compras e despesas. PDF/RBT12 aparecem no primeiro bloco de preenchimento.
- [x] Resumo dos relatórios com total importado, média mensal e projeção anual; tabela, distribuição dos 12 meses e explicações ficam em **Como calculamos**.
- [x] Período identificado automaticamente fica em uma linha expansível. Quando precisa de confirmação manual, os controles continuam visíveis e obrigatórios.
- [x] Textos menores e sem repetição; campos obrigatórios continuam visíveis. O resultado da seção 2.2 mantém PA e total, com as competências nos detalhes. Avisos da extração permanecem visíveis mesmo com a tabela fechada.
- [x] Resultados priorizam os indicadores e a comparação por regime. **Ver gráficos** reúne as visualizações sob demanda; a DRE continua ao final e a memória de cálculo segue acessível.
- [x] Histórico com dados usados no cálculo recolhidos, sem recalcular versões antigas. Detalhes abertos no resultado são preservados ao trocar Mensal/Anual e ao concluir o salvamento.
- [x] Conferência em desktop e celular com dados sintéticos, teclado e rolagem interna das tabelas. Nenhuma mudança nas fórmulas, validação do extrato, autenticação ou persistência.

### Verificação desta entrega

Executar `check:release`, tipos/build, regras Node, Python/PDF, integrações com MongoDB descartável e navegador. As regressões do navegador conferem preenchimento, OCR, histórico, detalhes por teclado, avisos visíveis e larguras de 320/390 px. Consulte a CI do commit desta versão para o resultado final.

## Correção 05/10/2026 — leitura direcionada à seção 2.2

- [x] A leitura web reconhece identificação/PA e toda a seção **2.2) Receitas Brutas Anteriores**, com os mercados interno e externo. Interrompe o OCR ao encontrar a próxima seção e validar as tabelas; continua nas páginas seguintes quando a tabela está dividida. EOF só é aceito com a leitura completa.
- [x] Ter 12 linhas não encerra antecipadamente a leitura: competências adicionais, repetições e valores conflitantes antes do fim da seção continuam validados. Texto nativo nas páginas restantes é conferido para detectar outra identificação ou uma segunda seção 2.2.
- [x] As páginas restantes são preservadas no PDF sem reconhecimento adicional. A interface informa quais páginas foram processadas e distingue **PDF com seção 2.2 pesquisável** de conversão integral. Esse modo confere a seção selecionada, não faz OCR/auditoria de todas as páginas posteriores digitalizadas; envie um único extrato por arquivo.
- [x] Orçamentos coerentes: OCR web de até 180 s, POST no navegador de até 285 s e função Python com máximo de 300 s. Download/upload e banco têm margem própria; demais chamadas do sistema continuam com seu limite anterior.
- [x] Teste com um PDF autorizado de três páginas: seção 2.2 completa na página 1, resultado igual ao processamento integral, demais páginas preservadas. Leitura direcionada local em aproximadamente 7 s. Tempos de produção variam com carga/inicialização; não são uma garantia.
- [x] Regressões sintéticas cobrem seção dividida, conflito em continuação, valores ausentes, baixa confiança, EOF, preservação do PDF e navegador aguardando mais de 55 s. O documento real e seus valores não são versionados.

A RBT12 continua sendo a soma das 12 competências anteriores ao PA exclusivamente da seção 2.2. O conversor local abaixo mantém OCR integral por padrão. O original já armazenado pode ser usado novamente pelo botão **Reprocessar OCR**.

## Correção 05/10/2026 — upload e OCR de PDFs mistos

- [x] URLs assinadas usam explicitamente `access: 'private'`. A leitura é feita no domínio privado do store; o upload usa `https://vercel.com/api/blob/`, conforme o SDK `@vercel/blob` 2.8.0.
- [x] A CSP e a validação Python reconhecem o endpoint de upload correto. O Python confere o caminho exato do documento na query da URL de escrita, mantendo leitura e escrita limitadas aos endpoints oficiais e ao documento selecionado.
- [x] Reprocessar pode substituir somente a cópia pesquisável no mesmo caminho. O PDF original continua sem permissão de sobrescrita.
- [x] PDF digitalizado com cabeçalho/rodapé em texto recebe OCR quando o corpo em imagem não possui texto correspondente. Texto parcial deixa de impedir a leitura da seção 2.2.
- [x] O navegador distingue falha no upload de falha no OCR e oferece a retomada adequada. O arquivo só é apresentado como armazenado após confirmação do upload.
- [x] Datas completas de emissão em rodapés deixam de ser confundidas com competências da seção 2.2; validações de valores e confiança fiscal são preservadas.
- [x] Lockfile Node corrigido para incluir o SDK Blob e suas dependências; instalação limpa com `npm ci`.
- [x] Regressões para contrato real do SDK, URLs GET/PUT, upload rejeitado, reprocessamento, PDF misto e preservação do isolamento por empresa. PDFs e credenciais de clientes não são versionados.

A regra da RBT12 permanece exclusivamente na seção 2.2: valores ilegíveis, meses ausentes e conflitos continuam bloqueando a extração. O upload e a leitura não exigem uma nova chave além da configuração do Blob privado já prevista abaixo.

## Entrega 02/10/2026 — cofre de documentos fiscais no Blob

O Extrato do Simples deixa de depender de uma única requisição de OCR. O fluxo atual é **Blob privado → OCR Python → PDF pesquisável no Blob → seção 2.2 → RBT12 → simulador**.

- [x] O navegador recebe uma URL assinada de uso único e envia o PDF diretamente ao Vercel Private Blob. O token administrativo nunca é enviado ao navegador; a CSP libera o domínio privado oficial para leitura e o caminho oficial da API Blob para upload.
- [x] O original é preservado em caminho imutável por workspace, empresa e documento. O MongoDB guarda apenas metadados, status, hashes, vínculo da extração e RBT12.
- [x] O Python recebe URLs temporárias restritas ao próprio documento, recupera o original, aplica OCR integral e grava o PDF pesquisável em outro objeto privado.
- [x] Falha de OCR não exige novo upload: o documento fica em `OCR_FAILED` e pode ser reprocessado a partir do original armazenado.
- [x] O simulador oferece **Ver PDF original**, **Ver PDF pesquisável** e **Reprocessar OCR**. A leitura dos PDFs passa por rota autenticada do sistema.
- [x] A regra fiscal permanece: somente a seção 2.2, com as 12 competências anteriores ao PA, alimenta a RBT12. Blob é armazenamento, não fonte fiscal.
- [x] Limite do fluxo armazenado: 8 MiB por PDF; URLs temporárias expiram em minutos e são restritas ao pathname/operação.

### Configuração do Blob

O projeto `maximum-cnpj` foi conectado em 05/10/2026 ao armazenamento privado `maximum-cnpj-extratos`, na mesma região das funções (`iad1`). A conexão adiciona `BLOB_READ_WRITE_TOKEN` aos ambientes de produção, prévia e desenvolvimento. O deploy precisa ser refeito após conectar o store para carregar essa configuração.

Em uma instalação nova, crie/conecte um **Vercel Blob privado** ao projeto. Com autenticação OIDC, configure também `BLOB_STORE_ID`; apenas o token OIDC, sem identificar o store, não é suficiente. Se usar token estático, a variável é:

```dotenv
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

Nunca exponha esse token ao browser. O código usa URLs assinadas para upload e o leitor autenticado para visualização.

## Correção 01/10/2026 — PDF em imagem na Vercel

- [x] Corrigido o runtime do OCR em produção: o RapidOCR trazia `opencv-python` (desktop) como dependência transitiva e a função serverless falhava ao importar `libxcb.so.1` antes de processar a primeira imagem.
- [x] A Vercel passa a resolver as dependências Python por `pyproject.toml` + `uv`, excluindo a variante desktop e instalando somente `opencv-python-headless`. PDF sem camada de texto segue para OCR normalmente.
- [x] A CI usa a mesma resolução headless, instancia RapidOCR e executa a regressão real com PDF somente imagem.
- [x] Erros internos permanecem fora da resposta pública, mas o log registra o detalhe técnico junto do código da requisição.
- [x] A regra fiscal não mudou: RBT12 continua exclusivamente na seção 2.2; leitura não confirmada nunca é substituída por projeção.

## Entrega de 01/10/2026 — OCR integral, RBT12 da seção 2.2 e DRE de janeiro a dezembro

- [x] Python processa **todas as páginas** do extrato: preserva texto nativo legível e aplica RapidOCR nas páginas digitalizadas. Gera PDF pesquisável sem alterar a imagem original, além de texto integral no conversor local. Não encerra a leitura ao encontrar “RBT12” na primeira página.
- [x] RBT12 calculada **exclusivamente na seção 2.2) Receitas Brutas Anteriores**, somando Mercado Interno (2.2.1) e Mercado Externo (2.2.2) das 12 competências anteriores ao PA. A seção 2.1, valores de DAS e projeções não alimentam esse valor.
- [x] Identificação/PA únicos, duas tabelas, competências, valores, duplicidades e confiança do OCR validados. Valor ilegível, mês ausente ou conflito **bloqueiam**; nunca são tratados como zero. Empresas iniciadas há menos de 12 meses, extratos cortados ou modelos sem as duas tabelas completas exigem revisão, sem inventar meses.
- [x] Novas simulações exigem uma extração `SIMPLES_SECTION_22_V2` da mesma empresa/workspace. O servidor reconcilia as 12 linhas novamente e verifica a RBT12 usada. O campo é somente leitura; trocar o PDF ou falhar na leitura limpa o vínculo anterior.
- [x] A conferência mostra as 12 competências, mercados, total, empresa, CNPJ básico, PA e páginas processadas. O CNPJ cadastrado é comparado com a raiz do extrato; na ausência de cadastro, há aviso para conferência humana.
- [x] Em **Mensal**, a DRE tem **Janeiro a Dezembro + Total anual**, seletor de regime e Indicador fixo. Os meses usam a média dos relatórios e os ajustes mensais do cenário, mantendo a regra total ÷ competências × 12. Em **Anual**, permanece a comparação dos quatro regimes.
- [x] A RBT12 do PA do extrato é uma referência **fixa** para os 12 meses projetados. Não são fabricadas RBT12 móveis para janeiro, fevereiro etc. O ano das colunas é o ano escolhido no cenário; o intervalo dos relatórios de origem aparece separadamente.
- [x] Histórico imutável: simulações anteriores continuam com seus valores e sua origem original (inclusive manual/legada), sem recálculo. Criar uma nova versão exige extrato confirmado na regra atual. Memória mensal nova salva em `DRE_CALENDAR_V1`, junto da referência da seção 2.2.

### Operação do PDF

No simulador, selecione **Extrato do Simples Nacional (PDF)** e clique **Ler RBT12 do PDF**. Confira o quadro “Conferir seção 2.2”. Quando disponível, o botão **Baixar PDF pesquisável** entrega a cópia com texto selecionável. O PDF/base64/texto integral não são guardados no MongoDB; apenas o resultado estruturado, identificação, SHA-256 e vínculo são persistidos. Reabrir um rascunho consulta essa referência autenticada, sem confiar no valor monetário do armazenamento do navegador.

O fluxo atual pelo Blob aceita até 8 MiB; o envio direto legado aceita até 4 MiB. Ambos aceitam até 30 páginas. O leitor web usa até 180 segundos para localizar e validar a seção 2.2; o conversor local mantém conversão integral com orçamento próprio de 600 segundos. A seção 2.2 não é parcialmente aceita ao exceder os limites. No fluxo Blob, o PDF pesquisável fica armazenado e pode ser aberto pela rota autenticada. Somente no envio direto legado o retorno inclui o PDF até 2,5 milhões de bytes; acima disso, use o fluxo Blob ou o conversor local. Esses limites mantêm a resposta abaixo do teto de payload da Vercel. PDFs devem estar desbloqueados, orientados corretamente e legíveis. OCR não garante exatidão fiscal: confira as competências na imagem original.

Conversor local Python (até 8 MiB, 30 páginas; arquivos maiores devem ser otimizados previamente):

```sh
python -m pip install uv
uv sync --no-install-project
uv run --no-sync python scripts/extrato_ocr.py "extrato.pdf" --output "extrato-pesquisavel.pdf"
```

São criados PDF pesquisável, TXT integral e JSON da seção 2.2 ao lado do destino. Os originais não são sobrescritos. `--force-ocr` substitui a camada de texto em cópias com texto defeituoso, aplicando uma única passagem por página. O OCR usa modelos incluídos no pacote RapidOCR, sem enviar o PDF a um serviço externo.

### Verificação desta entrega

Regressões sintéticas: seções 2.1/2.3 com valores concorrentes, mercados interno/externo, mês do PA excluído, lacunas e números ilegíveis bloqueados, PDF imagem com OCR real, camada pesquisável, autenticação/origem/empresa, memória imutável e DRE janeiro–dezembro. Nenhum documento real de cliente é versionado. Consulte a execução de CI do commit entregue para os resultados de integração e navegador.

## Entrega anterior v0.12.0 — média mensal, projeção anual e novo visual

**A regra do simulador é sempre: total dos relatórios ÷ competências importadas = média mensal; média mensal × 12 = projeção anual.** O horizonte é de **12 meses no total**, nunca a quantidade importada somada a mais 12 meses.

| Exemplo | Total de 4 meses | Média mensal (÷ 4) | Projeção anual (× 12) |
| --- | ---: | ---: | ---: |
| Vendas | R$ 400.000,00 | R$ 100.000,00 | R$ 1.200.000,00 |
| Compras | R$ 240.000,00 | R$ 60.000,00 | R$ 720.000,00 |

A partir da v0.21.0, a regra inclui serviços importados separadamente e os cinco grupos: vendas optantes, vendas não optantes/não confirmadas, vendas CPF, compras do Simples e compras fora do Simples. Vale para qualquer intervalo de **1 a 12 competências**. O simulador usa os totais conciliados pelo servidor; resultados financeiros enviados pelo navegador não substituem a origem.

### Competências, não dias com movimento

A coluna H (Data Escrituração/Serviço) determina o mês/ano inicial e final. Compras iniciadas em 02/04 e vendas iniciadas em 01/04 são compatíveis quando terminam no mesmo mês/ano. Meses internos sem lançamentos continuam no divisor. A ausência de uma competência nas extremidades não é inferida: arquivos de abril–agosto e maio–agosto continuam diferentes.

Cada relatório mantém suas datas originais. Sua conferência individual contra o snapshot é exata; somente a comparação entre relatórios distintos é mensal. Snapshots antigos sem coluna H permanecem utilizáveis mediante indicação/confirmação manual de 1 a 12 meses. A quantidade automática não pode ser alterada no navegador para salvar uma simulação com outro divisor.

### Precisão e memória da projeção

A regra compartilhada `public/simulator-projection.js` é usada pelo navegador e pelo Node. Calcula em centavos inteiros com BigInt e valida limites seguros. A média total de cada lado é arredondada em centavos; os centavos residuais são distribuídos pelo maior resto, com desempate determinístico. Na projeção V2, o rateio ocorre primeiro entre mercadorias e serviços, depois entre os três grupos de mercadorias, preservando a receita líquida de cada atividade sem criar saldo negativo por arredondamento. Assim, os grupos fecham o total mensal. A projeção anual repete **essa média arredondada** 12 vezes, podendo diferir alguns centavos da divisão sem arredondamento intermediário.

A API do pré-preenchimento retorna `projection` quando há período automático. Cada nova simulação com serviços separados salva a versão `AVERAGE_X12_V2` (históricos conservam `AVERAGE_X12_V1`), os totais importados, o divisor, as seis médias, os valores anualizados e 12 meses projetados iguais. O servidor gera essa memória; o cliente não pode fornecer uma projeção arbitrária.

**A base importada e o cenário editado são separados.** Os cinco campos continuam editáveis. A conferência superior mantém a média original, sinaliza a edição e os resultados usam os valores mensais efetivamente informados. O histórico guarda `projection.scenario`, os ajustes e a base original. Reabrir um cenário não consulta novamente os CNPJs nem recalcula os resultados fiscais. Nos históricos sem a nova memória, a interface apresenta uma conferência derivada dos totais salvos, identificada como tal.

Serviços importados são divididos pelas competências junto às mercadorias. A receita de serviços pode ser ajustada **por mês**, com registro da alteração. Salários, benefícios, despesas administrativas, aluguel e taxas de cartão são informados **por mês**, sem divisão pelo período importado. Todos entram no cenário anual multiplicados por 12 uma única vez.

**RBT12 não é a projeção anual.** Na v0.12.1, o valor vem obrigatoriamente da seção 2.2 do extrato para novas simulações. Valores manuais anteriores ficam somente no histórico, com sua proveniência original. Não é dividido pelo período importado nem multiplicado por 12. A distribuição uniforme é uma premissa de projeção, não um histórico mensal real ou uma previsão de sazonalidade.

### Design do simulador

- [x] Cabeçalho e navegação por seções com identidade Maximum, contraste e hierarquia de leitura.
- [x] Painel “A média do período. O potencial de 12 meses.” com total importado, média e projeção anual.
- [x] Alternância entre Vendas e Compras, linha de 12 meses iguais e memória dos cinco grupos expansível.
- [x] Campos mensais identificados, RBT12 destacada como exceção, avisos reunidos e ajustes manuais visíveis.
- [x] Gráficos e comparação anual/mensal preservados; DRE ao final com coluna Indicador fixa.
- [x] Layout responsivo para computador e celular; tabelas largas rolam dentro do próprio quadro.
- [x] Rascunhos antigos com divisor diferente não sobrescrevem os valores importados do período automático atual.

### Consulta e dados existentes

Esta linha também conserva as melhorias de leitura da v0.11.1: concorrência limitada, intervalo global no MongoDB, novas tentativas e acompanhamento de confirmações/pendências. A revalidação financeira em novo lote preserva o período, as linhas e os valores. Não modifica automaticamente gerações ou simulações anteriores.

A fórmula dos relatórios continua **Q − Y + AA − AB**. Z é informativa. Todas as linhas financeiras compõem os totais; documentos repetidos não duplicam a contagem. Somente OPTANTE explícito entra em Simples; os demais entram no grupo gerencial Não optante com a situação da fonte preservada. Vendas CPF continuam em grupo próprio. Ausência ou erro da fonte não se torna negativa fiscal inventada.

## Uso e instalação

Reabra a geração no Histórico e use **Ir para o simulador**. Com a coluna H armazenada, a quantidade de meses é preenchida automaticamente. Confira a projeção, informe os campos mensais, leia a RBT12 da seção 2.2 do PDF e gere a simulação. Relatórios concluídos não precisam ser reconsultados para esse cálculo. Use uma nova versão para alterar um cenário salvo.

Não há migração destrutiva, nova chave de API ou nova variável obrigatória. Preserve os ambientes privados, banco, workspace, domínio e usuários existentes. Para instalação nova:

```sh
npm install
python -m pip install uv
uv sync --no-install-project
npm run build
npm run seed
npm start
```

Use `.env.example` somente como modelo. `npm run seed` é apenas para uma instalação sem usuários; nunca redefine as contas existentes. Não versione senhas, URIs ou relatórios reais.

## Testes e progresso

```sh
npm run check:release
npm run check
npm run build
npm test
npm run test:projection
npm run test:competences
npm run test:integration
npm run test:lookup-integration
npm run test:purchases-integration
npm run test:generations-integration
npm run test:simulations-integration
npm run test:reports
npm run test:e2e
```

Os testes de integração exigem MongoDB descartável. As novas regressões usam dados sintéticos e não consultam provedores externos. Cobrem 4 meses, todos os divisores de 1–12, centavos, zero, rejeição de campos inválidos, ajustes manuais, RBT12 independente, isolamento, persistência e reabertura. Testes de navegador verificam o fluxo e a responsividade; a CI publica evidências. Consulte o status do commit para distinguir testes locais, CI e publicação em produção.

- [x] Regra compartilhada e memória versionada no servidor.
- [x] Integração do período mensal e preservação das melhorias de consulta.
- [x] Redesign e testes de regressão automatizados.
- [ ] Homologação operacional da projeção com uma carteira real autorizada; dados sintéticos não substituem essa conferência.

Documentação anterior preservada em [README v0.12.0 inicial](README-v0.12.0-inicial.md) e [README v0.11.0](README-v0.11.0.md). Orientações antigas sobre igualdade dos dias foram substituídas pela comparação por competência. Consulte [AGENTS.md](AGENTS.md), [CHANGELOG.md](CHANGELOG.md) e [a memória técnica da calculadora](docs/calculadora-tributaria.md).
