# Maximum CNPJ · v0.45.2

## Adicionar documentos diretamente no Fiscal — v0.45.2

Os cartões **Entradas** e **Saídas** oferecem **Adicionar documento** mesmo quando a análise ainda não possui uma importação preparada. O botão prepara a primeira importação ao clicar e abre o envio do tipo selecionado, para a empresa da análise. Compras e vendas usam a mesma geração; adicionar o segundo documento conserva o primeiro.

Gerações existentes são conferidas antes da navegação. Relatórios já concluídos continuam acessíveis para conferência, leituras incompletas podem ser retomadas e a substituição de documentos indisponíveis mantém a confirmação explícita. Usuários com acesso somente de consulta não recebem controles de envio. Rascunhos e revisões concorrentes conservam as proteções existentes.

A tela de envio aceita CSV, XLSX e XLS nos formatos fiscais já suportados. Nenhuma migração ou mudança de cálculo é necessária.

Verificação: tipos, build e versões, 382 testes de regras, 9 integrações de gerações, 172 Python/PDF/OCR e 13 cenários de navegador aprovados. Os quatro novos cenários verificam o primeiro acesso pela empresa, envio real de CSV nas duas ordens, preservação do primeiro relatório, metadados atrasados e acesso somente de consulta. Os controles foram conferidos em desktop e celular. As verificações de navegação conferem o caminho e os parâmetros do envio, respeitando a normalização da ordem da URL pela tela fiscal.

## Recuperação de geração indisponível — v0.45.1

Uma análise pode continuar existindo depois que os relatórios vinculados foram excluídos. Esse vínculo antigo não impede mais salvar rascunhos do Fiscal, escolhas de DIFAL ou a referência RBT12. A interface identifica a indisponibilidade e oferece preparar novos relatórios de entradas e saídas para a mesma empresa.

A recuperação mantém o Contábil, a referência do extrato, a configuração e as versões salvas. A nova importação substitui somente o vínculo dos documentos e limpa os ajustes fiscais dependentes da fonte anterior, após a ação explícita do usuário. Nenhum relatório excluído é recriado nem recebe valores estimados. Concluir Fiscal ou gerar uma nova versão continua exigindo documentos válidos da mesma empresa e workspace; links novos inexistentes ou de outra empresa continuam bloqueados.

Não há migração nem alteração automática de dados existentes. O motor de cálculo permanece em `1.12.0-available-months` e a regra de competências disponíveis de janeiro a setembro continua vigente.

Verificação: tipos, build e versões conferidos; 382 testes de regras, 36 de análises, 9 de gerações, 51 de simulações/reprocessamento, 172 Python/PDF/OCR e 26 cenários de navegador aprovados com dados sintéticos. As regressões exercitam exclusão real, ausência do registro, salvamento da RBT12, recuperação até uma nova versão, links antigos, permissões e preservação dos valores históricos.

## Dashboard, setores e competências disponíveis — v0.45.0

A visão geral reúne consultas realizadas nos últimos sete dias (incluindo hoje, no horário de Brasília), atividade diária, empresas recentes, análises, versões e acesso ao histórico completo paginado. O histórico pode ser filtrado por empresa, tipo ou busca e reúne consultas, entradas, saídas, revisões dos setores e versões salvas, mantendo o isolamento por workspace.

O cartão MongoDB usa `dbStats` para medir dados e índices alocados no banco. O saldo depende de `MONGODB_STORAGE_LIMIT_BYTES`, um orçamento em bytes confirmado para esse banco. Sem limite configurado, mostra o uso conhecido e informa que o saldo ainda não pode ser calculado; sem permissão de estatísticas, informa indisponibilidade. Não presume plano Atlas ou disco livre do cluster como cota. A medição abrange o banco e não muda com o filtro de empresa.

### Empresas e abertura da análise

Cada empresa oferece **FISCAL | CONTÁBIL | HISTÓRICO**. A busca aceita código, nome e CNPJ formatado; a paginação mantém toda a carteira acessível. Pela lista de empresas, Fiscal abre diretamente os documentos de entradas/saídas, com atalho para a etapa RBT12. Contábil abre imediatamente os nove meses de janeiro a setembro para preenchimento das contas existentes, inclusive quando o trabalho ainda não foi iniciado. Abrir um setor retoma a análise existente sem substituir suas escolhas; somente operadores/administradores podem iniciar uma análise. Histórico abre os registros da empresa escolhida.

Análises inicia na busca da empresa; a segunda etapa é escolher o setor. No Fiscal, os quatro regimes podem ser selecionados para a DRE. O DIFAL tem uma etapa própria e, para cada Simples selecionado, três controles independentes: **Incluir DIFAL neste regime**, **ENTRADA - antecipação das compras** e **SAÍDAS - vendas**. A etapa RBT12 contém somente a referência do Simples, com leitura do extrato pela seção 2.2; entradas e saídas ficam na etapa seguinte.

### Regra comum de janeiro a setembro

- O máximo são nove competências do mesmo ano, de janeiro a setembro; podem ser usadas de uma a nove competências disponíveis, inclusive não consecutivas.
- A fonte Fiscal usa apenas a interseção comprovada das entradas e saídas. Os Simples também precisam de RBT12 confirmada para cada competência incluída. Meses sem cobertura não recebem receita ou compra zero por falta de documento.
- No Contábil, meses inteiramente vazios ficam fora do cálculo. Um mês iniciado exige as contas completas; zero significa ausência de despesa explicitamente informada. Rascunhos continuam permitidos.
- O relatório único usa os meses com fonte Fiscal e Contábil completo. A quantidade, a lista de meses incluídos e as exclusões acompanham a análise, o calendário e as exportações. O consolidado soma os meses efetivos, sem extrapolar para nove ou doze meses.
- RBT12 conserva o significado de receita dos **12 meses anteriores** a cada competência, lida na seção 2.2 do PGDAS-D. Reduzir o número de meses simulados não reduz a janela histórica da RBT12.

O motor mensal passa a `1.12.0-available-months`; a política mantém `JAN_SEP_V1` e captura `includedMonths` exatos em cada nova versão. Versões históricas preservam os valores e o calendário que já tinham; nenhuma migração recalcula snapshots antigos. Relatórios e versões salvas recebem cabeçalhos, filtros, estados vazios e ações mais claros.

### Operação e reversão

Nenhuma migração destrutiva é necessária. Índices de leitura são criados pela inicialização existente; documentos originais e históricos permanecem preservados. Para reverter a interface e novas gerações, publique o commit anterior, mantendo os dados. Versões de competências parciais exigem o leitor desta versão ou posterior para reprodução e exportação completas; não devem ser recalculadas em um motor anterior que exigia nove meses.

### Verificação desta entrega

Tipos, build e versões conferidos. Com Node 22.16, MongoDB 7 descartável e Python 3.12, passaram 382 testes de regras, 148 verificações de integração/projeção/competências e 172 testes Python/PDF/OCR. Os 196 cenários de navegador foram verificados: 194 na regressão completa e suas repetições direcionadas, mais dois novos casos de acesso direto por empresa. Cinco expectativas antigas de apresentação/versão foram adaptadas, preservando as verificações independentes de valores. A cobertura inclui empresa → setor, leitura/persistência do extrato, DIFAL por regime, competências não consecutivas, DRE única, histórico, permissões e visualização em 320/390 px. Dados sintéticos são usados na verificação; nenhuma conta ou documento real é alterado pelos testes.

## Registro das entregas anteriores

As descrições abaixo documentam o comportamento das versões anteriores. A regra vigente de competências disponíveis e o novo fluxo estão descritos acima.

**Fluxo de abertura mais rápido (refinamento de 27/10/2026):** escolha da empresa, setor e regimes agora aparece numa única etapa; o setor Fiscal vem pré-selecionado e pode ser trocado. No Contábil, uma ação opcional permite preencher com R$ 0,00 somente os campos vazios das competências visíveis, após confirmação explícita; não altera valores lançados, dados de outros anos ou salva automaticamente.

## RBT12 de janeiro a setembro e status dos arquivos — v0.44.1

A análise MaximumCNPJ apresenta **somente nove RBT12 mensais, de janeiro a setembro do ano de origem**. Cada competência utiliza obrigatoriamente as **12 receitas anteriores** registradas no quadro 2.2 do PGDAS-D, inclusive meses do ano anterior. Não é correto calcular RBT12 somando apenas nove meses ou zerando competências ausentes. As receitas históricas são preservadas para auditoria, mas outubro–dezembro não geram linhas de análise.

No Fiscal, entradas e saídas exibem a confirmação de leitura assim que o status dos relatórios chega, sem aguardar a reconciliação mais demorada nem o processamento do extrato. A leitura RBT12 é mostrada separadamente; erro de extrato não invalida visualmente documentos de compras e vendas concluídos. Histórico ausente passa a indicar os **meses da receita histórica que faltam**, sem estimativas. O PDF é sinalizado como lido antes da etapa de persistência, que continua obrigatória.

## Fluxo simplificado: empresa, dados e resultado — 27/10/2026

A carteira passa a mostrar cada empresa em uma linha, com identificação, situação e **Abrir análise**. Dentro da empresa, os dois acessos principais são **Fiscal** e **Contábil**, seguidos de uma ação de resultado. Saem os atalhos repetidos, cartões de indicadores e barras que repetiam a mesma situação. Regimes, histórico e exclusão permanecem acessíveis como ações secundárias.

O período de janeiro a setembro fica compacto, com cobertura detalhada ao expandir e pendências sempre identificadas. Os formulários mantêm suas etapas e os dados digitados; explicações e composição dos documentos ficam junto de suas conferências. Não há preenchimento, gravação ou conclusão automática ao fechar ou trocar de setor.

No resultado salvo, a identificação da empresa ocupa menos espaço e a edição fica em um botão discreto. A DRE Jan–Set aproxima os valores dos regimes da primeira tela, reúne os controles de período e mantém a tabela resumida à vista. O regime da DRE completa, referências e demais conferências ficam nos detalhes, com as indisponibilidades sinalizadas. O menu deixa de repetir a chamada promocional para iniciar uma análise.

Cálculos, valores capturados, calendário, DIFAL, autenticação, permissões, histórico e exportações completas permanecem com os mesmos contratos. Motor mensal `1.11.0-jan-sep`.

Validação com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **371 testes de regras**, **36 testes de integração**, **172 testes Python/PDF/OCR** e **38 cenários de navegador** aprovados. A conferência visual em desktop, 390 × 650 e 320 × 568 verifica valores inteiros, ausência de rolagem horizontal na página, acesso aos campos e ações dos modais. O primeiro lucro aparece na primeira tela nos dois tamanhos móveis; a abertura empresa → Contábil não relê a fonte fiscal. Os testes de apresentação acompanham a retirada dos indicadores da carteira e a mudança dos créditos para a DRE completa, preservando as verificações de valores, vínculos e exportações.

## Uma área de trabalho por empresa, com o resultado à frente — 27/10/2026

A carteira oferece acesso direto ao **Fiscal, Contábil e Resultado** de cada empresa e destaca uma ação principal para continuar. Pendências de documentos, extrato, despesas e configuração abrem a etapa correspondente. A visão da empresa reúne preparação e resultado em um único painel, com situação de cada setor e pendência principal acionável. Fiscal e Contábil continuam independentes: os dois trabalhos precisam ser conferidos para gerar, sem impor uma ordem de preenchimento. Uma busca sem resultados oferece a opção de limpar a pesquisa.

Nos modais, a faixa de janeiro a setembro mostra ano, cobertura e os nove meses em uma apresentação compacta. A visão geral conserva a conferência completa. Atualizações de fonte e status substituem somente seus blocos, preservando campos, foco, rascunhos e a variante compacta do período.

A versão salva abre com um único cabeçalho de empresa, identificação, data, responsável e acesso à edição. Os links de retorno e histórico aparecem uma vez. A DRE vem em seguida, com os resultados dos regimes logo após os controles de período; **Base dos documentos** e **Cenário tributário** ficam identificados separadamente. O seletor **Regime da DRE completa** fica junto dos detalhes e não representa um filtro dos quatro cartões. Os valores monetários ficam juntos, com tipografia ajustada ao espaço e rolagem interna na tabela.

A composição dos documentos pode ser expandida depois do demonstrativo. Seu resumo mantém receita após devoluções, compras e percentuais B2B/B2C; enquadramentos não confirmados, documentos não identificados, saldos negativos e ausência de base positiva permanecem sinalizados mesmo recolhidos. A DRE completa, a memória, as exportações e os parâmetros capturados continuam disponíveis. A confirmação de salvamento e a tentativa de recuperação permanecem no fluxo de geração; a versão somente de leitura não oferece abrir a própria página novamente.

Esta entrega modifica apresentação e navegação, com o motor mensal em `1.11.0-jan-sep` e os contratos de cálculo, fonte, histórico e autorização preservados.

Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **371 testes de regras**, **36 testes de integração**, **172 testes Python/PDF/OCR** e **32 cenários de navegador** aprovados. A conferência inclui setores, rascunhos, foco, metadados tardios, DIFAL, exclusão, reabertura de versões, recuperação de salvamento, impressão e exportações. O aviso de ano ainda não identificado foi preservado após a compactação. Inspeção visual em desktop, 390 × 650 e 320 × 568 confirma cifras completas, três acessos legíveis na carteira, controles dos modais visíveis e acesso direto ao Contábil sem reconciliação fiscal. Revisão independente não identificou bloqueios no diff final.

## Design das análises e da comparação tributária — 27/10/2026

A carteira e a análise por empresa usam superfícies neutras, títulos com maior contraste e o vinho da Maximum nas ações principais. Os indicadores, os dois setores e o resultado têm hierarquia própria: Fiscal e Contábil mostram o conteúdo de cada setor, a situação salva e o acesso ao formulário. A faixa de janeiro a setembro reúne a cobertura dos nove meses em menos espaço, mantendo pendências explícitas.

Os modais organizam título e troca de setor no mesmo cabeçalho quando houver espaço. O rodapé reúne navegação, rascunho e conclusão com áreas de toque de pelo menos 44 px. A exclusão ganha ícone e continua disponível na carteira, na análise e nos formulários. No celular, cabeçalho, etapas e ações ocupam menos altura; os campos, avisos e a confirmação de exclusão conservam sua rolagem e o funcionamento pelo teclado.

A DRE destaca o **resultado por regime**, com o maior resultado disponível em evidência e impostos e margem logo abaixo. Prejuízo e indisponibilidade têm estilos próprios, inclusive quando o maior resultado ainda é negativo. A tabela tem primeira coluna fixa na rolagem horizontal, resultado final destacado e orientação de leitura no celular. Ações de CSV/PDF ficam agrupadas. Receita, compras, valores e percentuais B2B/B2C e enquadramentos usam a mesma linguagem visual.

Nas versões salvas, a comparação aparece antes das conferências detalhadas de DIFAL. Os parâmetros da versão ficam em **Dados usados no cálculo**, junto dos valores capturados; a identificação do cenário e o acesso a editar continuam visíveis. Cálculos, limites, calendário Jan–Set, referência RBT12, valores dos documentos, exportações completas e histórico não são modificados por esta atualização de apresentação. O motor mensal permanece em `1.11.0-jan-sep`. A DRE não repete a animação de entrada ao alternar a visualização.

Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **369 testes de regras**, **36 testes de integração** e **172 testes Python/PDF/OCR** aprovados. Os **28 cenários direcionados de navegador** cobrem Fiscal/Contábil, rascunhos, colagem, DIFAL, exclusão, fontes indisponíveis, DRE nova e histórica, detalhes sob demanda e CSV/PDF. Conferência visual adicional em desktop, 390 × 650 e 320 × 568 verifica área útil dos modais, foco dos campos, ações de confirmação, navegação e rolagem própria da tabela.

## Janeiro a setembro e comparação resumida dos regimes — 27/10/2026

As novas análises usam **janeiro a setembro, nove competências do mesmo ano**, tanto quando os documentos têm nove meses quanto quando contêm o ano completo. Outubro a dezembro permanecem nos documentos e na auditoria da importação, mas ficam fora das receitas, compras, despesas, tributos, DIFAL e resultado desta comparação. O consolidado soma os valores efetivos dos nove meses; não multiplica uma média mensal e não extrapola para doze meses.

O ano dos documentos é separado do ano do cenário tributário. A faixa de período na visão geral e nos dois setores mostra janeiro a setembro e a cobertura das entradas e saídas. Os relatórios podem ter extensões originais diferentes, desde que ambos cubram os nove meses do mesmo ano. A cobertura é a interseção dos períodos reconciliados: um mês ausente em uma das fontes permanece pendente. Intervalos internos sem movimento seguem a conciliação já existente; meses fora do intervalo de um relatório não viram zero. A conclusão Fiscal e a geração exigem cobertura completa.

### Receita, compras e resultado à vista

A composição dos documentos apresenta **receita por B2B (CNPJ) e B2C (CPF)**, com valores e percentuais após abater as devoluções de venda. Documentos sem identificação válida ficam separados. O enquadramento dos clientes pode ser expandido: optantes do Simples, fora do Simples, CPF, enquadramento não confirmado e outros documentos. A composição das compras mostra esses mesmos enquadramentos, com o denominador dos percentuais visível. As consultas e classificações já salvas são reaproveitadas; abrir a análise não dispara uma nova consulta cadastral.

A composição conserva a origem dos documentos: vendas de mercadorias e serviços entram na receita; devoluções de venda nas entradas reduzem a receita; mercadorias e serviços de compra entram nas compras. Ela não altera os grupos financeiros ou as bases do motor. Ajustes manuais de receita e compras são refletidos no DRE, sem redistribuir artificialmente valores entre clientes ou fornecedores. Percentuais de grupos com saldo negativo conservam o sinal; sem denominador positivo a participação fica indisponível.

A DRE abre com uma comparação resumida de **Simples Puro, Simples Híbrido, Lucro Presumido e Lucro Real**, respeitando os regimes escolhidos. Receita, devoluções, impostos sobre receita, receita líquida, compras, despesas, tributos sobre o lucro e resultado podem ser conferidos lado a lado. Impostos, lucro/prejuízo e margem ficam destacados. Os créditos utilizados aparecem em uma informação agregada, já considerados nos tributos ou no custo correspondente, sem serem somados novamente ao lucro nem apresentados como promessa de restituição. As linhas individuais de crédito potencial/utilizado de CBS e IBS continuam fora da DRE.

O consolidado recebe a indicação **Jan–Set**, com acesso aos nove meses e à DRE completa. Detalhes continuam sob demanda. CSV, JSON e impressão usam o calendário capturado no resultado: nove meses no modelo novo e o calendário original nas versões antigas. Valores indisponíveis continuam identificados; a apresentação não preenche resultados fiscais pendentes com zero.

### Preenchimento e histórico

No Contábil, **Preparar janeiro a setembro** adiciona os nove meses de uma vez, com campos em branco e preservando valores existentes do mesmo ano. O modelo CSV traz as nove competências. A colagem aceita o ano completo, conserva outubro a dezembro e mostra o subtotal Jan–Set; dados fora do período não impedem a conclusão por estarem em branco. Trocar explicitamente o ano de um rascunho com despesas anteriores exige confirmar a retirada dessas competências do trabalho atual; versões já geradas permanecem salvas.

A pergunta **Terá DIFAL?** permanece no Fiscal, com os controles de entrada e saída visíveis ao escolher Sim e independentes para Puro e Híbrido. A exclusão continua disponível na carteira, visão geral e modais. O carregamento dos metadados e da composição atualiza somente os blocos correspondentes, conservando foco, campos e rascunhos.

O período novo é registrado como `JAN_SEP_V1` na fonte, confirmação Fiscal, entrada do cálculo, resultado e projeção. Novas análises geridas e a interface avulsa enviam essa política; chamadas legadas sem a opção mantêm o comportamento anterior. O modelo mensal novo é `1.11.0-jan-sep`. Snapshots anteriores preservam versão, hash, valores e calendário; a análise solicita nova conferência Fiscal antes de gerar sua próxima versão no período fixo.

**RBT12 continua sendo uma referência própria de doze meses**, capturada do extrato ou informada e confirmada conforme o fluxo existente. O período de nove meses da comparação não substitui essa referência, não redefine limites do Simples e não altera silenciosamente as regras tributárias dos históricos. As regras fiscais continuam sujeitas à homologação do modelo e à situação de cada empresa.

Validação local com Node 22 e MongoDB descartável: tipos, build e versão/documentação; **369 testes de regras**, **146 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **38 cenários direcionados de navegador** aprovados. A conferência inclui importação de 12 meses com recorte para 9, cobertura parcial bloqueada, despesas/ajustes Q4 preservados, RBT12 própria, receita de R$ 3,3 milhões, devoluções, ICMS e DIFAL, histórico imutável, CSV/PDF completos, recuperação de rascunhos e metadados tardios. Desktop e telas de 320/390 px inspecionados; os dois casos finais de histórico foram repetidos em base nova após a conta sintética atingir o limite de logins das rodadas locais.

## Excluir análises pela carteira e pelos modais — 26/10/2026

**Excluir análise** aparece em cada cartão da carteira, na visão geral da empresa e no rodapé dos modais Fiscal, Contábil e Regimes e ano. O acesso permanece disponível em qualquer etapa, inclusive nos rascunhos sem simulação gerada e quando os documentos fiscais vinculados estão indisponíveis.

A confirmação identifica empresa, CNPJ, código e ano, e informa que serão excluídos os dados dos setores e as versões de simulação vinculadas. O cadastro e os documentos existentes permanecem, e a empresa pode iniciar uma nova análise vazia. Cancelar ou pressionar Esc conserva o modal, a etapa e os campos ainda não salvos; abrir a confirmação não exige validar ou salvar esse rascunho.

A carteira usa a revisão já carregada no resumo, sem consultar a fonte fiscal. Atualizações concorrentes exigem conferir o trabalho atualizado e confirmar novamente. A exclusão continua restrita a administradores e operadores, com revisão, recibo idempotente e resposta validada pelo servidor. Ao confirmar a exclusão, leituras pendentes são canceladas antes de voltar à carteira. O motor fiscal permanece em `1.10.0-regime-selection`.

Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **342 testes de regras**, **28 testes de integração de análises**, **172 testes Python/PDF/OCR** e **15 cenários de navegador** aprovados. Os dois casos novos de Fiscal/carteira foram repetidos após corrigir somente o cadastro sintético para usar administrador; a exclusão continuou sendo exercitada por operador. A recuperação de documentos, os cartões e os controles de exclusão foram inspecionados em desktop e 390 px.

## Abertura leve das análises e DRE sob demanda — 26/10/2026

A carteira, a busca de empresa, a visão geral, o Contábil e a configuração usam os dados salvos da análise, sem reler todos os itens dos relatórios fiscais para montar a tela. A situação apresentada identifica o trabalho salvo; a conferência dos documentos continua obrigatória no servidor para concluir o Fiscal e gerar um novo resultado.

Ao abrir o Fiscal, a fonte reconciliada, os vínculos dos relatórios e o extrato são carregados em paralelo. A espera fica no próprio setor: é possível fechar o modal ou continuar no Contábil enquanto a leitura termina. Reabrir o Fiscal durante a mesma consulta reutiliza o trabalho em andamento. A resposta atualiza os blocos de evidência, conservando os campos digitados. Uma fonte indisponível oferece nova tentativa e acesso aos documentos, sem repetir consultas automaticamente nem impedir o preenchimento do outro setor.

A digitação mantém os campos e os componentes da visão geral estáveis. O resumo detalhado do Contábil é atualizado quando aberto, com as alterações agrupadas por quadro do navegador. A busca reutiliza um índice dos nomes, códigos e CNPJs, e respostas de seleções anteriores não substituem a empresa atual. O cronograma do extrato é reaproveitado enquanto sua referência e competências permanecem iguais.

Mesmo antes de concluir o Fiscal, o Contábil identifica competências pelos metadados dos relatórios concluídos, desde que empresa, geração, vínculos e períodos de entradas/saídas correspondam. Essa consulta não relê os itens nem informa despesas automaticamente. A chegada dos meses atualiza apenas o aviso e o atalho existente, preservando digitação, seleção de texto e colagem. A fonte fiscal reconciliada prevalece sobre a indicação dos metadados. O extrato recém-lido e salvo é reaproveitado na mesma sessão, mantendo a confirmação visível.

Na DRE, mudar mês, regime ou percentuais reaproveita a apresentação do resultado. Gráficos e memória de cálculo são montados quando seus detalhes são abertos. Escolher o conteúdo de exportação atualiza somente essa escolha. CSV, JSON e impressão continuam usando a versão completa; a impressão materializa os detalhes necessários e restaura a tela depois. Editar valores ou gerar outro resultado invalida a apresentação anterior. O motor fiscal permanece em `1.10.0-regime-selection`.

### Consultas leves e validação das fontes

`summary=1` é opcional nas rotas de análises e retorna `readiness.verification: "SAVED"`. O resumo serve à navegação, sem autorizar geração nem substituir a validação fiscal. Sem esse parâmetro, o contrato completo e estrito permanece. `GET /api/v4/analyses/:id?includeSource=1` devolve `{analysis, source, sourceError}` reutilizando uma única reconciliação. Se somente a referência do Simples estiver pendente, a fonte continua disponível para preencher o formulário e a pendência impede a conclusão.

`POST /api/v4/analyses/:id/generate?summary=1` conserva toda a validação e retorna a referência da simulação (`_id`, `analysisId`, `createdAt`, `modelVersion`), evitando transmitir a mesma DRE completa antes de navegar para ela. Os índices de análises, gerações e simulações são preparados uma vez por conexão. A travessia das versões anteriores consulta apenas seus vínculos, em vez de transferir cada DRE ancestral. Revisões, leases, isolamento, recibos de exclusão e verificações de fonte antes e depois da gravação permanecem ativos.

Os testes de desempenho cobrem a ausência de consultas fiscais na navegação, fonte única no Fiscal, documentos ausentes/corrompidos, concorrência, leitura lenta sem bloquear os campos, preservação de rascunhos, DRE com doze competências, invalidação de cache e exportação/impressão completas.

Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **342 testes de regras**, **140 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **35 cenários únicos de navegador** aprovados. A rodada final de análises passou os 12 casos, incluindo respostas retidas, 100 eventos de digitação, metadados incompatíveis, PDF retomado em nova sessão, DIFAL e exclusão. Os 23 casos de DRE/simulador passaram, com o teste de gráficos ajustado para expandir os detalhes antes de consultar seu conteúdo. Recuperação de documentos e preenchimento foram conferidos visualmente em desktop e celular.

## Escolha de DIFAL e exclusão da simulação — 26/10/2026

**Terá DIFAL? Sim ou Não** passa a fazer parte da abertura de uma nova análise, depois dos regimes e sem acrescentar uma etapa. Quando houver Simples Puro ou Híbrido, a escolha precisa ser informada. Sem esses regimes, a pergunta fica dispensada. Retomar uma empresa conserva as opções já salvas.

No Fiscal, a pergunta fica visível tanto nos documentos quanto na tributação. **Sim** permite conferir os regimes e escolher entrada, saída ou ambas, de forma independente. A seleção mista é respeitada. **Não** desabilita o DIFAL para Puro e Híbrido, conservando as direções para uma eventual nova escolha; a geração usa a política atual salva no Fiscal. Estimativas dos documentos e versões anteriores continuam sendo evidências próprias, sem recálculo ou alteração silenciosa. O resumo mostra o que está selecionado, e os detalhes ficam recolhidos quando não são necessários.

**Excluir simulação** aparece na visão geral da empresa para administradores e operadores. A confirmação identifica empresa, CNPJ e cenário e explica o alcance: dados Fiscal/Contábil e resultados vinculados à análise são excluídos definitivamente. Cadastro, documentos fiscais, relatórios de origem e análises de outras empresas permanecem. Versões avulsas que não pertencem à análise continuam no histórico geral.

A confirmação usa a revisão que estava aberta. Uma atualização concorrente exige conferir novamente antes de excluir; geração ou importação em andamento bloqueia a operação. Um recibo mínimo registra identificação, revisão, autor e data e permite conferir uma repetição da mesma exclusão sem atingir um novo trabalho. Se uma exclusão confirmada for interrompida, abrir novamente a empresa retoma sua finalização antes de criar outro trabalho. Após a exclusão, abrir a empresa cria uma análise vazia com outro identificador, sem recuperar os resultados apagados ou adotar automaticamente históricos restantes.

A API aceita `difalPolicy` opcional em `POST /api/v4/analyses` somente para uma criação nova e conserva o contrato anterior quando o campo é omitido. `DELETE /api/v4/analyses/:id` exige `{expectedRevision, confirmed: true}`, sessão e permissão de escrita. A confirmação só fecha após o servidor validar a exclusão; Cancelar e Esc não enviam DELETE. O motor de cálculo continua em `1.10.0-regime-selection`.

Validação local com Node 22 e MongoDB descartável: tipos, build e versão/documentação aprovados; **342 testes de regras**, **132 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **15 cenários únicos de navegador** aprovados. A conferência final do DIFAL foi repetida após alinhar no teste os rótulos do CSV e seu prefixo de proteção para Excel. Os valores, a política mista, a ausência de gravação implícita, a persistência em nova sessão, a exclusão com revisão concorrente e a preservação das fontes foram verificados. A escolha inicial, Fiscal e confirmação de exclusão foram inspecionados em desktop e celular.

## Preenchimento direto, com menos etapas — 26/10/2026

A análise reúne a situação da empresa, os dois setores e o resultado em uma visão única. Fiscal e Contábil têm um acesso cada; o resultado concentra Gerar, Atualizar ou Ver DRE conforme o estado do trabalho. Pendências detalhadas e versões anteriores ficam disponíveis em blocos recolhidos.

| Fluxo | Organização |
| --- | --- |
| Abrir ou retomar uma análise | Empresa → Setor e regimes; uma seleção confirmada da empresa avança para as escolhas. A análise existente conserva ano e regimes salvos. |
| Fiscal | Documentos → Dados fiscais. O extrato aparece somente quando há Simples; demais opções e ajustes ficam reunidos no mesmo modal. |
| Contábil | Uma tela para competências, colagem opcional, despesas e resumo. Os meses abrem individualmente, com todos os campos preservados. |
| Regimes e ano | Uma tela com gravação direta das escolhas. |

Não há uma etapa adicional repetindo os campos para conferência. **Salvar rascunho** permite continuar depois; **Salvar e concluir** valida os dados e confirma o setor. As duas ações permanecem distintas. O estado de gravação fica no rodapé, sem repetir um aviso grande a cada digitação. Fiscal e Contábil podem ser alternados dentro do modal, mantendo o rascunho e a colagem.

As validações continuam nas ações de gravação e no servidor. Uma despesa ausente revela seu mês e campo; uma colagem ainda não aplicada bloqueia a conclusão do Contábil. Pressionar Enter em um campo final não salva implicitamente; no campo de competência, Enter adiciona o mês. Fechar e reabrir conserva os valores nesta página; dados precisam ser salvos para retomar em outra sessão.

Links com etapas da versão anterior são traduzidos para o novo fluxo. O cadastro único por empresa, a conferência dos dois setores, o tratamento de campos vazios e zeros, as revisões concorrentes, os documentos e o histórico imutável permanecem. O motor fiscal continua em `1.10.0-regime-selection`.

Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **342 testes de regras**, **124 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **11 cenários direcionados de navegador** aprovados. Os cinco fluxos de análise foram repetidos após os ajustes finais de foco e apresentação. Foram conferidos o setup completo em 1280×720, a visão geral, Fiscal e Contábil, além das despesas e colagem em 320/390 px. Enter sem gravação, colagem pendente, troca interna de setor, abertura do campo inválido e valores gerados fazem parte da verificação.

## Análises em modais por etapas — 26/10/2026

O preenchimento passa a acontecer em **um modal por vez**, com título, indicação da etapa atual, **Voltar**, **Continuar** e conferência antes das ações finais. A página da empresa reúne a visão geral, os setores, as pendências, o resultado e as versões salvas. Regimes e ano também são editados em um modal próprio.

| Fluxo | Etapas |
| --- | --- |
| Nova análise | Empresa → Setor → Regimes e ano → Conferência |
| Retomar empresa com análise | Empresa → Setor → Conferência das escolhas já salvas |
| Fiscal | Documentos → Opções fiscais e referência do Simples quando necessária → Conferência |
| Contábil | Competências e colagem → Despesas por competência → Conferência |
| Regimes e ano | Escolhas → Conferência |

Avançar e voltar apenas navegam. **Salvar trabalho** registra o rascunho do setor; **Concluir** envia sua conferência e retorna à visão geral. A geração continua exigindo os dois setores concluídos e as validações do servidor. O modal Fiscal abre nas opções quando os relatórios já estão disponíveis; o Contábil abre nas despesas quando já existem competências. Atalhos de pendências conduzem à etapa correspondente.

Os painéis permanecem montados ao avançar, voltar ou fechar. **Fechar** e **Esc** preservam inclusive o texto ainda não aplicado da planilha e campos temporariamente inválidos nesta página. Antes de sair ou atualizar, salve os dados; o aviso de alterações locais permanece. Alternar para outro formulário captura o rascunho e solicita corrigir um valor inválido, sem gravar automaticamente. A prévia e a substituição explícita da colagem continuam funcionando; aplicar leva à etapa de despesas.

Erros e avisos aparecem dentro do modal ativo. Uma tentativa de concluir com despesa ausente retorna à etapa e ao campo pendentes. Leitura de PDF, abertura e salvamento em andamento bloqueiam o fechamento. O diálogo nativo mantém o foco dentro do preenchimento, restaura o foco ao acionador ao fechar e adapta corpo e ações a telas de 320/390 px. O acesso de consulta permite percorrer os passos e conserva as restrições de escrita.

O cadastro único por empresa, os documentos originais, as revisões dos setores, o histórico imutável e o motor `1.10.0-regime-selection` permanecem. A importação de entradas/saídas conserva seu fluxo de leitura e retorna ao Fiscal da análise. `analyses-wizard.js` contém somente a sequência de passos; a navegação não substitui a prontidão fiscal decidida pelo servidor.

Validação local com Node 22 e MongoDB descartável: tipos, build e versão/documentação conferidos; **340 testes de regras**, **124 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **11 cenários direcionados de navegador** aprovados. O cenário de teclado foi repetido após corrigir o ciclo de foco nas bordas do modal, incluindo fechamento e reabertura antes do evento nativo de fechamento. As telas de despesas e colagem foram conferidas visualmente em desktop, 320 e 390 px.

## Preenchimento orientado e despesas por planilha — 26/10/2026

A carteira separa **Em andamento**, **Pronta para gerar/atualizar** e **Resultado atual**, com a próxima ação de cada empresa. Dentro da análise, o progresso dos dois setores e os atalhos das pendências orientam o preenchimento. Uma análise com resultado já correspondente aos dados conferidos oferece **Ver DRE atual**; alterações ainda não salvas bloqueiam a geração e aparecem como trabalho local.

Na abertura, selecionar a empresa confere se já existe uma análise. Quando existe, a tela apresenta o ano e os regimes salvos e oferece **Continuar análise existente**, preservando os valores e a revisão. Alterar o texto da busca limpa a empresa selecionada, e uma resposta atrasada não pode trocar a seleção mais recente.

Alternar entre **Fiscal** e **Contábil** mantém os dois rascunhos nesta tela, sem recarregar a página nem salvar automaticamente. **Salvar trabalho** persiste somente o setor escolhido; **Concluir** registra sua conferência. Dados ainda locais precisam ser salvos antes de sair ou abrir uma nova importação fiscal. Os controles de revisão do servidor continuam protegendo o trabalho de outras abas e pessoas.

### Colar despesas de uma planilha

No Contábil, **Colar despesas de uma planilha** aceita seis colunas nesta ordem:

| Competência | Salários e pró-labore | Aluguéis | Taxas de cartão | Benefícios | Outras despesas |
| --- | --- | --- | --- | --- | --- |
| `01/2026` | `1.234,56` | `800,00` | `120,00` | `300,00` | `0,00` |

Copie as células do Excel com TAB ou use ponto e vírgula. O cabeçalho é opcional; a competência aceita `MM/AAAA` ou `AAAA-MM`. Os valores são convertidos para centavos exatos. `1.234` é milhar; `1234.56` é decimal. Fórmulas, negativos, formatos ambíguos e competências duplicadas são rejeitados com indicação do campo. A análise aceita até 12 competências, incluindo as que já estavam preenchidas. O botão **Baixar modelo CSV** oferece um modelo com os campos financeiros vazios.

**Conferir colagem** mostra meses, valores, pendências e o total dos campos informados. **Aplicar ao formulário** exige confirmação para substituir meses existentes, inclusive seus campos vazios; as demais competências permanecem. Alterar o texto ou os valores do formulário invalida a prévia anterior. Aplicar modifica somente o rascunho local: salvar ou concluir continua sendo uma ação explícita.

O resumo do Contábil acompanha a digitação, com totais por categoria e competência, cobertura dos meses fiscais e contagem de campos pendentes. Um campo vazio continua sem informação, distinto de zero. Subtotais disponíveis não são apresentados como total anual confirmado; despesas nunca são distribuídas por média ou copiadas automaticamente.

Esta versão melhora a navegação e o preenchimento. O contrato de geração, os documentos originais, as versões imutáveis e o motor `1.10.0-regime-selection` permanecem. Os testes de colagem e orientação complementam dois fluxos reais de navegador com autenticação, ingestão fiscal, MongoDB, retomada, edição dos setores e geração dos valores mensais.

Validação local com Node 22 e MongoDB descartável: tipos, build e versão/documentação conferidos; **332 testes de regras**, **124 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **11 cenários direcionados de navegador** aprovados. Os dois fluxos novos também conferem prévia e formulário em 320/390 px. Colagem ainda não aplicada bloqueia importação e geração e participa do aviso de saída; **Limpar colagem** permite descartá-la explicitamente.

## Análises compartilhadas entre Fiscal e Contábil — 26/10/2026

A entrada principal passa a ser **Análises**. Ao abrir um trabalho, escolha a empresa, o setor **Fiscal** ou **Contábil**, o ano do cenário e um ou mais regimes: **Simples Nacional Puro**, **Simples Nacional Híbrido**, **Lucro Presumido** e **Lucro Real**. Se a empresa já tiver uma análise, o sistema retoma o mesmo trabalho sem substituir seus dados e escolhas. A navegação reúne Visão geral, Empresas, Análises, Relatórios e Versões salvas.

Cada empresa tem **uma análise corrente**, garantida por índice único no workspace. Os setores salvam rascunhos independentes no servidor, com revisão, autor e data. O setor escolhido indica onde a pessoa vai trabalhar; as permissões de administrador, operador e consulta continuam vigentes. É possível começar pelo Contábil e continuar o Fiscal em outra sessão. A geração exige que os dois setores estejam concluídos e que as competências coincidam exatamente.

| Setor | Dados e conclusão |
| --- | --- |
| Fiscal | Relatórios de entradas e saídas, conferência da receita e dos ajustes por competência, opções fiscais e extrato do Simples quando aplicável. Os documentos pertencem à mesma empresa e geração. |
| Contábil | Salários e pró-labore, aluguéis, taxas de cartões, benefícios e outras despesas em cada competência. Campos vazios permanecem pendentes; zero exige informação ou confirmação explícita. |

Os valores contábeis são próprios de cada mês, sem distribuir médias nem repetir despesas automaticamente. Salvar permite retomar o preenchimento; concluir registra a conferência do setor. Alterar regimes ou ano exige conferir os setores novamente. Editar os dados mantém o último resultado disponível e sinaliza a atualização pendente até a nova geração.

### Regimes e extrato condicional

`REGIME_SELECTION_V1` registra de um a quatro regimes e acompanha o cálculo, o ranking, os gráficos, a DRE, o CSV e o PDF. Somente os regimes escolhidos aparecem na comparação; com apenas um, a apresentação identifica o resultado individual. O motor e o adaptador mensal passam a `1.10.0-regime-selection`, preservando os valores dos mesmos regimes quando calculados na comparação completa.

Sem Puro ou Híbrido, o Fiscal não solicita extrato nem RBT12. O contrato registra `NOT_REQUIRED`, não busca uma extração, não fabrica um cronograma e mantém a RBT12 efetiva nula. Com Simples selecionado, permanecem a leitura da seção 2.2 do PDF e a alternativa manual expressamente confirmada; o extrato deve cobrir as competências usadas. Retirar Simples ou trocar PDF por referência manual limpa os vínculos ativos correspondentes, sem apagar documentos ou versões históricas.

As preferências de DIFAL ficam salvas no Fiscal. Cada nova importação captura uma política efetiva somente para os regimes selecionados; retirar temporariamente um regime não perde suas preferências. Os relatórios antigos conservam as opções da própria importação, e o novo cálculo usa as escolhas atuais após a conclusão do Fiscal. As regras de naturezas 8000, créditos por UF, devoluções, fechamento da receita e abatimento único dos créditos permanecem.

### Resultado atual e versões preservadas

Recalcular a análise cria uma versão imutável ligada à anterior e atualiza o resultado corrente. O histórico permite consultar a DRE e exportar os dados que realmente foram salvos em cada versão. Repetir a mesma solicitação ou gerar novamente sem alteração não duplica o resultado. As versões geridas e a versão corrente adotada são protegidas contra exclusão no histórico comum.

A primeira abertura explícita de uma empresa pode incorporar a última simulação legada. Snapshots mensais conservam ajustes de grupos, serviços e despesas de cada competência. Registros antigos sem dados mensais suficientes continuam legíveis; seus setores aguardam preenchimento, sem inventar a distribuição dos valores. Consultar um GET não migra nem reescreve snapshots. O fluxo avulso anterior continua compatível enquanto a empresa ainda não tiver ativado a análise compartilhada; depois disso, novas escritas passam pelo trabalho dos setores.

Revisões independentes impedem que um setor sobrescreva alterações concorrentes do outro. Um conflito no mesmo setor preserva os campos digitados e oferece recarregar o trabalho salvo. A geração recompõe os dados no servidor e confere novamente revisões, identidades e fingerprint das fontes antes de publicar o resultado. Um cálculo interrompido não aparece como versão concluída.

### API e verificação

`/api/v4/analyses` oferece carteira paginada e abertura por empresa. As rotas de cada análise permitem consultar, salvar configuração, salvar/concluir Fiscal e Contábil, preparar importação, gerar o resultado e consultar versões. Todas conservam autenticação, workspace e controles de escrita existentes. A evidência da versão inclui revisão da análise, revisões dos setores, autores, confirmações e fingerprint das fontes.

Os testes dedicados estão em `tests/analysis-integration.test.ts`, `tests/regime-selection.test.mjs`, `tests/e2e/analyses-workflow.spec.ts` e `tests/e2e/analyses-extrato.spec.ts`. Cobrem unicidade, concorrência, meses efetivos, zeros explícitos, referências condicionais, seleção dos regimes, reabertura em outra sessão, versões imutáveis, CSV/PDF e navegação móvel, além dos gates existentes do projeto.

Validação com Node 22 e MongoDB descartável: tipos, build e versão/documentação conferidos; **308 testes de regras**, **124 verificações de integração/projeção/competências** e **172 testes Python/PDF/OCR** aprovados. A rodada ampla de navegador executou 173 casos; duas expectativas de rótulos foram atualizadas para a nova navegação, e a conferência final direcionada reúne 19 casos, incluindo o novo fluxo do PDF. A suíte passa a ter 174 cenários. PDFs anual/mensal com um e dois regimes e telas de 320/390 px foram inspecionados visualmente. No teste de vinculação do extrato, Node e Mongo são reais e somente as fronteiras Blob/Python são simuladas com registros sintéticos coerentes; o parser e OCR são verificados pela suíte Python.

## DRE: retirada das composições de crédito de CBS e IBS — 23/10/2026

As quatro linhas informativas **Crédito potencial de CBS**, **Crédito utilizado de CBS**, **Crédito potencial de IBS** e **Crédito utilizado de IBS**, identificadas como composição, deixam de aparecer na DRE. A alteração vale para anual, mensal e os três formatos de CSV e PDF, inclusive ao consultar simulações já salvas.

A apresentação compartilhada retira somente esses quatro detalhes. As linhas principais de crédito de CBS/IBS, os débitos, valores líquidos, saldos e o quadro final de ICMS continuam conciliados. Valores, percentuais, lucro, fontes e memória capturada permanecem preservados; não há recálculo nem criação de nova revisão fiscal por essa alteração visual.

Validação da v0.34.1 com Node 22 e MongoDB descartável: tipos, build e versão/documentação conferidos; **295 testes de regras**, **64 verificações de integração/projeção**, **172 testes Python/PDF/OCR** e **27 casos direcionados de navegador** aprovados, sem saltos. Os cenários cobrem DRE anual/mensal, três formatos de exportação, reabertura do histórico e o fluxo real de ICMS. O teste de nova tentativa do histórico aguarda a conclusão da atualização automática antes de simular recuperação manual, eliminando a corrida identificada no trace do CI sem alterar a produção.

Os PDFs anual, mensal e completo foram renderizados e conferidos visualmente: as quatro composições saíram das tabelas, os créditos principais e o quadro final de ICMS permaneceram, e cabeçalhos, valores e quebras de página conservaram a diagramação.

## ICMS por natureza, UF e devoluções — 23/10/2026

O crédito potencial de ICMS passa a usar a composição das operações importadas de cada competência, em vez de multiplicar todo o custo de compras por 18%. Serviços de prefixo **8000**, incluindo naturezas com sufixos, continuam nos custos da DRE, mas não geram **antecipação nem crédito de ICMS**. A classificação das compras e da receita permanece a do catálogo pela coluna D, aplicada aos quatro primeiros dígitos da natureza dos relatórios.

- **Antecipação:** `ICMS_ANTICIPATION_V4` exclui 8000 antes da avaliação de UF; uma linha excluída também não cria pendência tributária. A premissa de 7,32% das demais compras elegíveis, as opções de entrada/saída e a aplicação somente aos cenários Simples permanecem. As versões V1/V2/V3 conservam suas regras para validar os snapshots antigos; a visão atual derivada usa V4 sem alterar as linhas originais.
- **UF e alíquota do cenário:** operações elegíveis na mesma UF usam a premissa interna de 18%; operações com UFs brasileiras confirmadas e diferentes usam **12%**, conforme solicitado. A regra considera as UFs efetivas do relatório, sem inferir localização pelos primeiros dígitos da natureza. Os percentuais são premissas gerenciais, não consulta de tributação da nota.
- **Créditos separados:** compras classificadas como COMPRAS no grupo gerencial de não optantes compõem o crédito de compras. As DEVOLUÇÕES DE VENDA identificadas nas entradas compõem crédito separado, independentemente do grupo do comprador. Devoluções de compra não são convertidas em crédito positivo. O enquadramento original e os grupos gerenciais, incluindo não confirmados e outros documentos, permanecem disponíveis para conferência; o grupo, por si só, não comprova direito fiscal ao crédito.
- **Sem duplicação:** a receita continua após devoluções. Na apuração do ICMS, o débito parte das vendas brutas elegíveis e os créditos incluem compras e devoluções de venda, com as mesmas premissas de UF. Somente `débito − crédito utilizado`, limitado a zero, entra na dedução da DRE. Crédito excedente permanece como saldo informativo e não aumenta o lucro nem é compensado automaticamente entre competências.
- **DRE e exportações:** a apuração do crédito de ICMS sai do detalhamento das deduções e aparece em quadro próprio ao final, depois do fechamento da receita. Mostra débito, potencial, composição compras/devoluções quando capturada, utilizado, líquido e saldo; o crédito já aplicado não é somado novamente. Anual, mensal, PDF e CSV usam os mesmos valores preservados. Históricos sem a composição nova mantêm os valores que realmente foram salvos.
- **Ajustes manuais:** o ajuste de vendas usa a proporção das bases internas e interestaduais das vendas brutas de origem; nunca amplifica impostos já arredondados. Sem ajuste, o tributo conserva o arredondamento por linha; com ajuste, a nova base ponderada é arredondada no total da competência. Alterações manuais de compras modificam custos, sem criar ou excluir crédito de documentos. Para modificar esse crédito, é necessário corrigir a origem.
- **Pendências reais:** UF ausente em operação elegível não vira operação interna ou interestadual por suposição. Os cenários com ICMS fora do DAS aguardam a conferência, inclusive no diagnóstico do Simples, nos totais anuais e na memória. Simples com ICMS no DAS mantém seu cálculo. Receita adicionada sem qualquer composição de vendas de origem também exige conferência da base de ICMS.
- **Origem e histórico:** `ICMS_OPERATIONS_V1` é derivado no servidor a partir de linhas conciliadas, por competência, empresa e geração; não pode ser enviado como verdade no rascunho. Motores `1.9.0-icms-operations` e revisão vinculada `ICMS_OPERATIONS_2026_10_V9` preservam as versões anteriores. A versão nova do reprocessamento recupera as operações da origem, sem consultar novamente CNPJs nem reescrever o histórico. Servidor e navegador compartilham a mesma versão do contrato, corrigindo a divergência que interrompia a atualização; respostas de versões desconhecidas continuam bloqueadas antes de qualquer escrita.

Exemplo de conferência: vendas internas R$ 1.000 + interestaduais R$ 2.000; devoluções internas R$ 100 + interestaduais R$ 200; compras elegíveis internas R$ 300 + interestaduais R$ 500; serviços 8000 de R$ 600. A receita utilizada é **R$ 2.700**, o custo permanece **R$ 1.400**, o débito de ICMS é **R$ 420**, o crédito de compras é **R$ 114** e o de devoluções **R$ 42**. O crédito potencial/utilizado é **R$ 156** e o ICMS líquido é **R$ 264**. A antecipação de origem é **R$ 36,60**, somente sobre os R$ 500 de compras interestaduais elegíveis; sua aplicação depende do cenário Simples selecionado.

As alíquotas e bases efetivas da nota exigem conferência: a [Resolução do Senado 22/1989](https://legis.senado.leg.br/norma/586152/publicacao/15646891) distingue operações interestaduais de 12% e 7%, e o [Convênio ICMS 54/2000](https://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/8200000054.pdf) determina preservar base e alíquota da operação anterior na devolução interestadual. O modelo não recebe CST, origem de importação ou a nota original vinculada para decidir todas as hipóteses legais. O percentual fixo de 12% está identificado como a premissa solicitada para esta simulação.

Validação da v0.34.0 com Node 22 e MongoDB descartável: tipos, build, versão/documentação e diff conferidos; **295 testes de regras**, **113 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **171 testes na rodada completa de navegador** aprovados, sem saltos. A matriz mensal também confirma antecipações V1/V2/V3/V4. O fluxo real do exemplo acima importou oito linhas, salvou a simulação, reabriu em uma sessão nova e conciliou MongoDB, tela, CSV e PDF, preservando integralmente as fontes e rejeitando composição de ICMS enviada pelo cliente. A revisão visual dos relatórios anual/mensal/completo e das telas em 320/390 px conferiu o quadro final; os avisos móveis acompanham o regime e a competência selecionados.

## Simples Nacional, receita do período e relatório completo — 23/10/2026

A DRE inicia na visão **Anual**, consolidando as competências importadas, e mantém a alternância **Mensal** para consultar cada mês. O relatório oferece **Completo · anual + mensal** como padrão, **Somente anual** e **Somente mensal**, tanto no PDF por impressão quanto no CSV. Os três formatos incluem os quatro regimes. O completo apresenta a comparação anual primeiro e os calendários mensais depois, seguidos de situação dos regimes, escolhas de DIFAL, premissas, memória consolidada e referências capturadas na versão.

### Correção da receita usada nos limites

O adaptador mensal reaproveitava um motor de projeção de doze meses. Um mês de R$ 550 mil era tratado como R$ 6,6 milhões na verificação do Simples, mesmo com receita total de R$ 3,3 milhões nas doze competências. Agora o contexto de receita vem da soma dos valores efetivos do cenário, após devoluções e ajustes, sem extrapolar o mês. A mesma correção evita acionar o acréscimo dos coeficientes do Lucro Presumido acima de R$ 5 milhões quando apenas a extrapolação de um mês ultrapassa essa referência.

- **Bases distintas:** receita das competências importadas, RBT12 usada nas alíquotas, limite federal de referência de R$ 4,8 milhões e sublimite de ICMS/ISS de R$ 3,6 milhões aparecem separadamente. A receita do período não é declarada como RBA fiscal confirmada. RBA/RBAA, início de atividade, mercados interno e externo, vedações e efeitos de excesso continuam dependendo da conferência fiscal da empresa.
- **ICMS/ISS explícito:** o cenário permite informar dentro ou fora do DAS. A situação fora do DAS não é ativada automaticamente pela RBT12. A escolha acompanha o rascunho, a nova versão, o cálculo no servidor e a memória, e atualiza também a prévia de DIFAL.
- **Pendência específica:** RBT12 acima da faixa suportada, receita acima da referência ou cálculo de ICMS/ISS dentro do DAS na sexta faixa recebem causas e orientações próprias. Esses estados significam que falta uma apuração suportada pelo modelo, e não uma declaração de exclusão do Simples. O cenário da sexta faixa com ICMS/ISS fora do DAS explicitamente informado permanece calculável até a referência suportada de R$ 4,8 milhões.
- **Consolidado íntegro:** o anual soma os meses calculados. Se um regime tiver competências pendentes, seu total permanece sem valor confirmado; meses disponíveis continuam consultáveis. A apresentação não transforma a soma parcial em resultado anual nem usa esse regime no ranking. Cobertura inferior a doze meses é identificada como parcial; meses ausentes não viram zero.
- **Relatório auditável:** fechamento de receita bruta, devoluções, ajustes e receita utilizada preservado; nenhum abatimento duplicado. O relatório distingue o ano do cenário das competências de origem e conserva somente as fontes, avisos e valores da versão salva.

O simulador continua sendo o modelo gerencial de **2027/2028**, com premissas de CBS/IBS e demais limitações identificadas. O rateio do excedente anual do Lucro Presumido entre competências é uma estimativa do modelo, não a apuração dos limites e ajustes de cada trimestre. Esta entrega não transforma o modelo em PGDAS-D nem decide automaticamente enquadramento ou datas de exclusão.

### Contratos e histórico

Motores `1.8.0-simples-revenue-context`; revisão vinculada `SIMPLES_REVENUE_CONTEXT_2026_10_V8`; diagnóstico `SIMPLES_DIAGNOSTIC_V1`. `draft.icmsOutside` é booleano opcional e validado no servidor. O contexto de receita é derivado das competências validadas, nunca aceito como uma declaração do navegador. Reenvios de versões antigas conservam a omissão original do campo e seu hash. A revisão usa a estrutura já existente para criar novas versões vinculadas, preservando snapshots e escolhas anteriores.

### Validação da entrega

Com Node 22 e MongoDB descartável: tipos, build e versão/documentação conferidos; **278 testes de regras**, **112 verificações nas suítes de integração/projeção/competências** e **171 testes Python/PDF/OCR** aprovados, sem saltos. A rodada completa de navegador passou com **166 testes**. Após o último ajuste da memória histórica, uma rodada direcionada de **21 testes** também passou, incluindo uma regressão adicional e a repetição do fluxo real de R$ 3,3 milhões.

O fluxo real usa doze competências sintéticas: **R$ 3.310.000,00 de receita bruta − R$ 10.000,00 de devoluções = R$ 3.300.000,00**, incluindo janeiro de R$ 550 mil. Simples Puro e Híbrido permanecem disponíveis; o DAS puro é R$ 384.600,00; o anual concilia com a soma dos meses e o DIFAL desmarcado fica zerado. A verificação inclui autenticação, importação, salvamento, reabertura em nova sessão, versões com ICMS/ISS dentro e fora do DAS, CSV e os três formatos de PDF. O histórico pendente conserva todos os itens da memória na tela, mas oculta valores derivados sem confirmação, inclusive ao selecionar um mês válido. PDFs e tela de 320 px foram inspecionados visualmente.

Os jobs de navegador usam `ubuntu-24.04`, versão suportada pelo Playwright 1.55.1 fixado no projeto. A imagem móvel `ubuntu-latest` passou a selecionar Ubuntu 26.04 e impediu a instalação do Chromium no CI; a correção fixa o ambiente sem remover etapas de validação.

### Referências conferidas

- [LC 123/2006 — arts. 3º, 13-A, 18 e 20](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm).
- [Perguntas e Respostas do Simples Nacional — limites, sublimites e RBT12](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf), atualização parcial de 09/10/2026.
- [Manual do PGDAS-D e DEFIS](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgdas-d_2018_v4.pdf), definição das bases e exemplos de tributação.
- [Receita Federal — redução dos incentivos e benefícios tributários, versão 5](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios-v5-final.pdf), limites do Lucro Presumido e apuração por trimestre.

## Fechamento da receita bruta e das devoluções — 23/10/2026

O fechamento passa a demonstrar **receita bruta de vendas e serviços − devoluções de venda = receita após devoluções**. O saldo do arquivo de vendas e a receita considerada na simulação têm identificações distintas. No fluxo mensal atual, as devoluções já eram abatidas antes do motor; o valor resultante deixava de ser explicado e aparecia incorretamente como receita bruta.

- **Ao final do demonstrativo:** a DRE apresenta o fechamento de cada competência e do período. Ajustes manuais ficam em uma linha própria, seguida da receita efetivamente utilizada. As devoluções são deduzidas uma única vez; tributos e resultado preservam a base já calculada. No celular, os valores ficam empilhados para o regime e período selecionados; desktop e impressão conservam a tabela completa.
- **Base da receita bruta:** soma das operações VENDA e dos serviços de venda 9000, usando o valor financeiro de cada linha (`Q − Y + AA − AB`), antes das devoluções de venda. Não é a coluna Q isolada nem a soma de todas as operações do arquivo. Devoluções de compra e outras operações permanecem fora dessa base.
- **Devoluções:** as operações DEVOLUCAO_VENDA do relatório de compras reduzem a receita na competência da coluna H. A fonte conserva seus valores e enquadramentos originais; o fechamento mostra a dedução separadamente.
- **Edição e percentuais:** os campos de vendas deixam explícito que já estão após as devoluções. Diferenças informadas manualmente aparecem como ajustes da simulação. Margens, carga tributária e análise vertical continuam usando a receita utilizada, com o denominador identificado corretamente.
- **Relatórios e exportações:** o fechamento usa o par confiável de compras e vendas da mesma empresa e geração. O CSV específico de fechamento é separado do CSV das linhas originais, com valores monetários numéricos, inclusive devoluções negativas, e metadados protegidos contra fórmulas. PDFs individuais e consolidados apresentam a composição ao final, distinguindo dados disponíveis e pendentes; o consolidado soma cada empresa uma única vez.
- **Histórico:** simulações salvas usam somente a fonte capturada e a DRE preservada. Ausência de composição suficiente não vira devolução zero; relatórios avulsos ou sem par válido informam indisponibilidade. Totais originais, alíquotas, escolhas de DIFAL e contratos de cálculo permanecem preservados.

O contrato de apresentação `REVENUE_RECONCILIATION_V1` usa `AVAILABLE`, `PENDING` e `UNAVAILABLE`, sem valores monetários inventados nos dois últimos estados. O resumo financeiro acrescenta `revenueReconciliation`. `GET /api/v4/generations/{id}/revenue?clientId=...` consulta o fechamento de uma empresa sob demanda, sem ampliar a leitura do histórico. `POST /api/v4/{purchases|sales}/{jobId}/revenue-csv` exporta o fechamento em `{fileName, content, mimeType}`, com os mesmos controles de sessão, origem e workspace dos relatórios existentes.

O problema foi reproduzido no navegador com dados sintéticos: R$ 2.200,00 de receita bruta e R$ 400,00 de devoluções geravam corretamente R$ 1.800,00 na DRE, mas a tela chamava esse valor de receita bruta e não mostrava o fechamento. A regressão cobre importação de duas competências, salvamento, reabertura em sessão nova, CSV e criação de uma versão com ajuste manual de R$ 100,00. O cenário original, as linhas importadas e a escolha de excluir DIFAL permanecem preservados.

Validação da v0.32.2: tipos, build, versão/documentação e diff conferidos; **261 testes de regras**, **111 verificações nas suítes de integração/projeção/competências**, **171 testes Python/PDF/OCR** e **164 testes de navegador** aprovados, sem saltos. A regressão nova usa conta sintética própria, conservando os limites de login e a autenticação real nas duas sessões. Fechamentos em desktop, 390/320 px e páginas finais dos PDFs individual e consolidado também foram inspecionados visualmente.

## Correção: saída desmarcada respeitada em toda a apresentação — 23/10/2026

A opção de não incluir DIFAL sobre vendas passa a controlar também a prévia, os resumos dos relatórios e os indicadores do simulador. Antes desta correção, a DRE já respeitava as opções, mas esses painéis ainda exibiam a estimativa bruta da fonte como se estivesse incluída.

- **Escolhas independentes:** saída desmarcada nos dois cenários do Simples mostra `Não incluído por escolha`, sem valor positivo como imposto selecionado. A entrada continua conforme sua própria escolha. Quando somente um cenário inclui a operação, a apresentação identifica esse cenário.
- **Mesma empresa e relatório:** o servidor resolve a política a partir do vínculo original da consulta com a geração e a empresa. Resumo, linhas e exportações recebem essa política; parâmetros da página não substituem a escolha salva. Reconsultas novas conservam a escolha de origem. Reconsultas antigas recuperam a escolha pela linhagem válida, somente em leitura; se a origem já não estiver disponível, informam ausência de escolha registrada.
- **Conferência:** estimativas brutas continuam disponíveis como evidência identificada, separadas dos valores selecionados. Os snapshots, totais financeiros, alíquotas e fórmulas não são alterados. Históricos sem política mantêm sua condição de estimativa, sem inventar uma escolha.
- **Simulador:** indicadores acompanham as operações e os bloqueios da competência; a leitura de versões salvas conserva a aplicação registrada. Mudar uma escolha invalida o resultado aberto e solicita atualizar a simulação antes de exibir outra DRE.
- **Exportações:** CSV e PDF respeitam as escolhas de entrada e saída, inclusive no consolidado de várias empresas. Cada empresa entra uma única vez na soma selecionada. Um imposto desmarcado não é apresentado como incluído; a auditoria distingue a estimativa da origem. A impressão não expande nem inclui os detalhes de estimativa bruta dos cartões, mesmo quando estiverem abertos na tela.

O caso relatado foi reproduzido no navegador com dados sintéticos: saída desmarcada e prévia mostrando R$ 15,00 em vez de exclusão. A regressão correspondente integra os testes desta correção.

Validação da v0.32.1 com Node 22.16.0: **248 testes de regras, 161 Python/PDF/OCR e 150 testes de navegador aprovados, sem saltos**, além de todos os comandos de integração, projeção, competências e reprocessamento com MongoDB descartável. Tipos, build, versão e diff conferidos. O fluxo real importou compras e vendas, manteve saída em zero e entrada em R$ 36,60, conferiu CSV e dados persistidos, salvou a DRE e reabriu em outra sessão autenticada. PDFs e telas desktop/320/390 px foram inspecionados visualmente. A validação usa dados sintéticos; publicação em produção acompanha o processo de integração do PR.

## DIFAL de entrada e saída no Simples, compras por natureza e RBT12 mensal — 23/10/2026

Esta seção registra o contrato introduzido na v0.32.0. As mudanças de cálculo e relatório da v0.33.0 estão descritas na seção inicial; as entregas abaixo conservam o histórico das versões anteriores.

- **Naturezas:** catálogo de 619 códigos idêntico ao fornecido, classificado pela coluna **D — OPERAÇÃO**, sem alterações nesta entrega. No relatório de entradas, a classificação lê os quatro primeiros dígitos do campo **Natureza** (coluna L no modelo conhecido). Descrições e sufixos não mudam a classificação. A coluna D do cadastro não é uma coluna monetária: a base financeira continua **Q − Y + AA − AB**, com Z apenas informativa.
- **Receita:** somente operações VENDA e serviços de venda 9000, abatendo as DEVOLUÇÕES DE VENDA encontradas no relatório de compras, na competência da coluna H. Devoluções de compra e outras operações do relatório de vendas ficam fora dessa base. O enquadramento do documento permanece o capturado na consulta.
- **Compras consideradas:** o resumo de compras/entradas usa somente operações classificadas como **COMPRAS** e serviços de natureza **8000**, inclusive `8000002` e `8000102`. Devoluções de compra e de venda, outras operações e naturezas não classificadas ficam fora desse resumo. Totais e percentuais usam a base selecionada, identificada na apresentação; a auditoria separa o total bruto importado, o total selecionado e o total excluído, com conciliação por natureza. A seleção é uma visão derivada das linhas salvas (`purchaseSelection`, versão `PURCHASE_NATURES_V1`), calculada depois de conciliar o snapshot bruto, sem apagar linhas nem substituir seus totais originais. Todas as linhas continuam disponíveis na consulta e no CSV, com indicação de seleção, motivo e valor considerado. Se um relatório legado não conservar a natureza necessária à classificação de todas as linhas, a seleção fica explicitamente indisponível (`UNAVAILABLE`), sem apresentar zero como resultado confirmado. A composição atual da DRE permanece preservada, inclusive o abatimento das devoluções de venda na receita uma única vez. Relatórios de vendas mantêm seu comportamento.
- **DIFAL sobre vendas:** 10% por linha VENDA com CPF ou CNPJ válido, com UFs brasileiras confirmadas e diferentes. A versão `DIFAL_ESTIMATE_V4` mantém as naturezas de venda do catálogo. Serviços 9000, devoluções e demais operações não geram DIFAL. CNPJ numérico e alfanumérico usam a validação já existente; o enquadramento consultado não é alterado.
- **Antecipação de ICMS:** 7,32% das compras interestaduais com CPF ou CNPJ válido, incluindo serviços 8000. CNO, documentos inválidos ou ausentes não geram valor nem pendência de UF. O campo **DIFAL de entrada — Antecipação de ICMS** aparece na prévia, nas linhas, no resumo, no CSV e no PDF de compras/entradas, conforme a escolha da entrada. A evidência de origem conserva base elegível e UFs pendentes; o cálculo é confirmado no servidor. Compras com outros documentos continuam nos custos quando a natureza é elegível. Na DRE, a antecipação pode ser deduzida uma única vez somente no Simples puro e híbrido, conforme a opção e os bloqueios do cenário descritos abaixo. Não cria crédito adicional e permanece zerada no Lucro Presumido/Real. UFs ausentes ficam pendentes e as compras preservam sua própria UF, sem herdar a UF das vendas. Ajustes manuais do cenário não reescrevem a base importada.
- **Escolha após selecionar a empresa:** somente **Simples Puro** e **Simples Híbrido** oferecem DIFAL. Cada cenário tem um controle de inclusão e duas opções independentes: **entrada (compras)** e **saída (vendas)**. É possível selecionar Puro, Híbrido ou ambos, com entrada, saída, ambas ou nenhuma. Desmarcar o cenário desativa suas operações, preservando as opções para quando ele for reativado. A política fica salva individualmente por empresa, tanto no fluxo guiado quanto na seleção múltipla, e acompanha a geração até o simulador.
- **Aplicação na DRE:** entrada deduz somente a antecipação de compras e saída deduz somente o DIFAL de vendas, uma vez por competência. **Lucro Presumido e Lucro Real permanecem com ambas as linhas zeradas nas novas simulações**, inclusive quando o pedido usa o formato V1 antigo. O DIFAL também deixa de reduzir a base de IRPJ/CSLL do Lucro Real. A comparação dos quatro regimes continua disponível; a escolha controla as deduções de DIFAL nos dois cenários do Simples.
- **Bloqueios por competência:** no Simples, as duas operações ficam zeradas quando a RBT12 da competência alcança R$ 3.600.000 ou o ICMS está fora do DAS. A seleção do usuário é conservada e o motivo do bloqueio aparece na tela, memória, DRE, CSV e impressão. Os valores e as pendências dos relatórios de origem permanecem disponíveis como evidência de auditoria identificada, separados da operação selecionada ou excluída.
- **RBT12 móvel:** todas as receitas explícitas do quadro 2.2 são conservadas. Cada competência usa seus 12 meses anteriores, somando mercados interno e externo. A RBT12 do PA é uma referência identificada e não é repetida nas demais competências; o ano projetado não desloca as competências de origem. A receita mensal da DRE permanece separada da receita acumulada usada para determinar a RBT12. Ausência de um mês bloqueia o cálculo, sem usar quadro 2.1, médias, multiplicação de receita por 12 ou zeros inventados. A alternativa manual existente continua explícita e identificada como fixa.
- **Conferência da seção 2.2:** a lista completa de receitas do histórico aparece primeiro e aberta, com mercados interno e externo separados. A conferência de RBT12 por competência também inicia aberta e oferece o detalhe das 12 receitas que compõem cada mês. O validador compartilhado `reconcileSection22Extraction`, usado pelo navegador e pelo servidor, concilia o valor total, a janela de 12 meses, a base declarada e o histórico antes de aceitar a leitura. Divergências bloqueiam a confirmação e orientam nova leitura, sem corrigir valores silenciosamente.
- **Histórico:** os dados originais continuam imutáveis. Ao abrir relatórios de compras e vendas de versões anteriores, a estimativa atual é calculada a partir das linhas salvas quando há evidência suficiente de natureza e UF. A conciliação valida primeiro os valores históricos com sua versão original, e a nova estimativa informa a origem `DERIVED_FROM_SNAPSHOT`. Resumo, linhas, CSV e PDF usam a mesma regra atual, sem alterar jobs, hashes, enquadramentos ou consultas externas. UF vazia permanece pendente; natureza ou UF não armazenada impede a derivação e exige reimportação. Retomadas conservam seu contrato original. Simulações salvas preservam seus valores, inclusive quando o campo `difalPolicy` não existe no registro legado. Novas tentativas do mesmo salvamento mantêm o payload original, sem injetar opções em pedidos antigos. A revisão `DIFAL_DIRECTIONS_2026_10_V7` cria uma versão vinculada com a regra atual, preserva as escolhas de Puro/Híbrido e de entrada/saída e não sobrescreve originais. Políticas V1 são convertidas somente para cálculos novos: mantêm a seleção dos cenários Simples e começam com entrada e saída selecionadas; Presumido/Real ficam desativados. Fontes ou UFs ausentes impedem a confirmação automática apenas quando a operação correspondente é aplicável.
- **Contratos:** catálogo `NATURE_OPERATIONS_2026_10_V1`, seleção de compras `PURCHASE_NATURES_V1`, DIFAL de vendas `DIFAL_ESTIMATE_V4`, antecipação `ICMS_ANTICIPATION_V3`, leitura do extrato `SIMPLES_SECTION_22_V2` preservada, RBT12 `RBT12_MONTHLY_SECTION_22_V1`, opções de cenário `DIFAL_SCENARIOS_V2` e motores `1.7.0-difal-directions`. As versões fiscais anteriores continuam disponíveis para conferir suas evidências originais. JSON, CSV, PDF, tela e calendário preservam as competências correspondentes.


Na v0.30.0, a conferência privada do PDF fornecido confirmou as 23 competências disponíveis nos dois mercados com o leitor Python existente, sem encontrar inflação dos valores extraídos. Aquela entrega reforçou a conciliação e a apresentação, sem alterar a versão do parser. A regressão sintética cobre 23 meses, quatro pares de competência e valor por linha, receitas em queda e mercado externo não zero, no texto e no pipeline de PDF nativo. O documento, a identificação da empresa e os valores reais não integram o repositório.

A escolha atual é persistida em `draft.difalPolicy`, com versão obrigatória, dois cenários selecionáveis e operações independentes. Exemplo: **entrada apenas no Puro; saída apenas no Híbrido**.

```json
{
  "version": "DIFAL_SCENARIOS_V2",
  "enabled": {"pure": true, "hybrid": true, "presumed": false, "actual": false},
  "operations": {
    "pure": {"entry": true, "exit": false},
    "hybrid": {"entry": false, "exit": true}
  }
}
```

`pure` corresponde ao Simples Puro, `hybrid` ao Simples Híbrido, `entry` à entrada e `exit` à saída. Novos cenários apresentam Puro e Híbrido com as duas operações selecionadas, para revisão explícita após escolher a empresa. No contrato V2, `presumed` e `actual` devem ser `false`; o servidor rejeita tentativas de habilitá-los, campos extras, direções ausentes e valores não booleanos.

No `POST /api/v4/generations`, `companyDifalPolicies` contém itens `{clientId, difalPolicy}` para as empresas selecionadas. A geração guarda a escolha em `companies[].difalPolicy` e a fonte do simulador a expõe em `source.difalPolicy`. Repetir a criação com a mesma identidade exige conservar a política explícita original. Gerações antigas sem a política continuam sem esse campo. Na edição, a prioridade é o rascunho próprio, depois a escolha do snapshot de origem, a fonte da geração e o padrão inicial. Se um novo pedido de simulação omitir a política, o servidor usa a escolha da empresa antes do padrão.

A consulta de uma simulação salva exibe seu snapshot imutável, inclusive opções V1 de Presumido/Real que existiam na versão histórica. **Criar nova versão** aplica V2. A validação do hash e a busca do registro existente ocorrem antes dessa conversão: reenvios de pedidos V1 ou sem política devolvem exatamente o resultado já salvo, sem conflito causado pela atualização. Entrada e saída permanecem no rascunho, na cópia, no JSON, nas notas da DRE e nas versões revisadas.

Os percentuais de 10% e 7,32% são premissas gerenciais solicitadas, não uma consulta de alíquotas legais por operação. A composição do quadro 2.2 segue a descrição do [Manual PGDAS-D da Receita Federal](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf). O bloqueio gerencial de DIFAL e antecipação nos cenários Simples por RBT12 não substitui a apuração legal dos efeitos do sublimite por RBA/RBAA. A publicação e a revisão de dados de produção são etapas separadas desta entrega de código.

Validação da v0.32.0: Node 22.16.0; tipos, build, versão e diff conferidos; **241 testes de regras, 155 Python/PDF/OCR e 137 testes de navegador aprovados**, sem saltos. Todos os comandos de integração, reprocessamento, projeção e competências passaram com MongoDB descartável. O teste legado de reprocessamento de 5102 foi atualizado para esperar DIFAL somente no Puro/Híbrido no novo filho, mantendo as verificações do original; a suíte de compras foi reexecutada com 21/21 aprovados. A matriz de regras cobre 384 combinações de cenários, direções e bloqueios (1.536 resultados de regimes). Foram verificados entrada no Puro e saída no Híbrido, nenhuma operação, salvamento, herança por empresa, rascunhos, retries, versões V1, CSV, JSON e impressão. Modal e simulador conferidos visualmente em desktop e telas de 320/390 px. Nenhum dado real de cliente foi incluído; esta entrega não publica a aplicação nem executa a revisão sobre dados de produção.

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
