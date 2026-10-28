# Histórico de alterações

## [0.47.0] — 2026-10-28

- Contábil oferece preenchimento individual, cópia de uma competência para outra e repetição dos valores em todos os meses exibidos.
- Apresenta origem, destinos e aviso de substituição antes de aplicar; mantém edição por mês, rascunho e ação para desfazer a última cópia.
- Exige as cinco contas da origem preenchidas, aceita zero explícito e preserva competências fora do período.
- Mantém persistência mensal, permissões, revisões concorrentes, histórico e seleção dos meses fiscais disponíveis para a DRE.

## [0.46.0] — 2026-10-28

- Atualiza a premissa padrão de CBS para 11,3% nos novos cálculos e créditos do regime regular.
- Memória e relatórios mostram as taxas efetivamente usadas; identifica a referência do TCU como premissa sujeita à definição normativa.
- Versiona o motor e o lote de atualização de simulações; novas revisões usam a CBS atual, preservando snapshots, fontes e valores históricos.
- Mantém IBS, partilhas do DAS, créditos específicos do Simples e a seleção das competências disponíveis.

## [0.45.4] — 2026-10-28

- Finalização financeira em partes retomáveis, com cópia idempotente e conferência antes de disponibilizar o resumo.
- Retoma documentos totalmente enviados sem selecionar o arquivo novamente; interface acompanha o progresso e limita tentativas de erros transitórios.
- RBT12 em PDF diretamente na etapa de Entradas e Saídas, com leitura automática pela seção 2.2.
- Diagnóstico seguro de timeout, conexão e capacidade, sem expor dados privados; preserva o código da requisição na interface.

## [0.45.3] — 2026-10-28

- Seleção ou arrastar de arquivos diretamente nos cartões de Entradas e Saídas, com leitura, envio e progresso na própria análise.
- Preparação automática após validar o primeiro documento; segundo arquivo preserva a geração e o relatório já enviado.
- Retomada idempotente de falhas de conexão, com o mesmo identificador e sem duplicar linhas.
- UF compartilhada, erros junto do arquivo e opções de substituição recolhidas; preserva rascunhos e controles de acesso.

## [0.45.2] — 2026-10-28

- Entradas e Saídas passam a oferecer Adicionar documento desde a primeira abertura do Fiscal, preparando a importação quando necessário e abrindo o tipo correto.
- Reutiliza a geração válida para adicionar o documento faltante, preservando o relatório já enviado; substituições continuam explícitas.
- Mantém autorização, vínculo da empresa, proteção de rascunhos e recuperação de documentos indisponíveis.
- Verifica navegação pelo tipo e vínculo dos documentos, sem depender da ordem dos parâmetros na URL.

## [0.45.1] — 2026-10-28

- Corrige “Geração não encontrada” ao salvar rascunhos do Fiscal quando a análise conserva um vínculo com relatórios indisponíveis; DIFAL e RBT12 podem ser salvos antes da nova importação.
- Apresenta recuperação explícita para preparar novos relatórios na mesma análise, preservando Contábil, extrato, configuração e versões anteriores.
- Links antigos de geração, entradas e saídas apresentam retorno ao Fiscal ou ao histórico; falhas temporárias continuam exibindo o erro real, sem recriar documentos automaticamente.
- Mantém validação estrita da fonte na conclusão e geração, proteção contra vínculos novos inexistentes ou de outra empresa/workspace e controle de revisões concorrentes.
- Acrescenta regressões com geração realmente excluída ou ausente, incluindo salvamento, substituição da fonte e preservação do histórico.

## [0.45.0] — 2026-10-28

- Adiciona dashboard com consultas dos últimos sete dias, uso MongoDB e saldo quando o orçamento do banco estiver configurado, empresas recentes e histórico completo paginado e filtrável.
- Empresas ganha acessos FISCAL, CONTÁBIL e HISTÓRICO, busca por CNPJ formatado e paginação sem truncar a carteira em 200 registros. Fiscal abre documentos e atalho RBT12; Contábil abre imediatamente os nove meses, criando ou retomando o trabalho da empresa com autorização.
- Análises abre pela empresa, seguida do setor; Fiscal separa regimes, DIFAL por Simples, RBT12/OCR seção 2.2 e entradas/saídas.
- Aceita uma a nove competências disponíveis entre janeiro e setembro; meses contábeis vazios são excluídos e meses iniciados exigem contas completas. O relatório único usa a interseção validada, sem extrapolação.
- Captura os meses efetivos no resultado e ajusta DRE, DIFAL, calendário, CSV e PDF para competências parciais ou não consecutivas, preservando snapshots históricos e a janela própria de 12 meses da RBT12.
- Melhora apresentação, filtros e estados de Relatórios e Versões salvas.
- Atualiza motor mensal para `1.12.0-available-months` e alinha versões Node/Python; inclui a declaração TypeScript RBT12 ausente na entrega anterior.

## [0.44.1] — 2026-10-27

- Abertura da análise em uma única etapa (empresa, setor e regimes); links legados para a etapa antiga continuam válidos.
- Contábil oferece preenchimento opcional dos campos vazios com R$ 0,00 mediante confirmação, sem alterar valores já informados nem salvar automaticamente.

- RBT12 mensal da análise limitada a janeiro–setembro (9 competências) com base móvel de 12 meses anteriores obtidos da seção 2.2, preservando as receitas históricas requeridas.
- Mensagem de falha discrimina os meses históricos faltantes, evitando tratar falta de RBT12 como erro dos documentos de entradas e saídas já lidos.
- Fiscal atualiza o status de cada arquivo assim que seus metadados estão disponíveis, sem esperar a reconciliação completa nem a leitura do extrato.
- Leitura de PDF indica quando terminou de extrair e quando está salvando a referência no Fiscal.
- Adiciona regressões para as nove RBT12 e para a confirmação rápida de entradas e saídas com a conciliação propositalmente lenta.

## [0.44.0] — 2026-10-27

- Simplifica a carteira para empresa, situação e um acesso à análise, retirando atalhos e indicadores repetidos.
- Reorganiza a empresa em dois acessos compactos, Fiscal e Contábil, e uma ação de resultado; mantém configuração, histórico e exclusão acessíveis.
- Recolhe a conferência de cobertura Jan–Set e a composição dos documentos, com pendências explícitas, hosts estáveis e rascunhos preservados.
- Compacta a identificação da versão salva e aproxima lucro, impostos e tabela resumida do início da DRE. Reúne período e referências e mantém o seletor de regime junto da DRE completa, fora do conteúdo montado sob demanda.
- Remove a chamada promocional repetida do menu, preservando links, preferências de navegação, teclado e controle de acesso.
- Mantém cálculos, dados, calendário, DIFAL, autenticação, exportações completas e motor mensal `1.11.0-jan-sep`.
- Validação: tipos, build, versão/documentação, **371 regras**, **36 integrações**, **172 Python/PDF/OCR** e **38 cenários de navegador** aprovados. Desktop, 390 × 650 e 320 × 568 conferidos; lucro visível na abertura móvel, cifras completas, rascunhos/foco/exclusão preservados e Contábil sem releitura fiscal.

## [0.43.0] — 2026-10-27

- Reúne preparação e resultado em uma área de trabalho por empresa, com acesso direto Fiscal/Contábil/Resultado na carteira, próximo passo principal e links para a etapa da pendência.
- Compacta a faixa Jan–Set nos modais e conserva a cobertura completa na visão geral, inclusive após atualizações parciais da fonte. Os setores continuam independentes e os campos permanecem estáveis.
- Substitui os cabeçalhos repetidos da versão salva por uma identificação única com data, responsável, edição e histórico; aproxima a DRE do início e mantém parâmetros capturados depois da comparação.
- Apresenta os resultados dos regimes imediatamente após os controles de período, distinguindo base dos documentos e cenário tributário. Aproxima o seletor de regime dos detalhes da DRE completa e mantém cifras em uma linha sem truncamento.
- Organiza percentuais junto da tabela e exportações em uma faixa própria. Recolhe composição dos documentos com valores e B2B/B2C no resumo, mantendo avisos de pendências, documentos não identificados e saldos negativos visíveis.
- Preserva salvamento e recuperação no fluxo de geração, permissões de edição, impressão completa, versões legadas e motor mensal `1.11.0-jan-sep`.
- Validação local: tipos, build, versão/documentação, **371 testes de regras**, **36 testes de integração**, **172 testes Python/PDF/OCR** e **32 cenários de navegador** aprovados. Após compactar o período, o aviso de ano pendente foi mantido explícito e seu cenário de metadados tardios passou novamente. Conferência visual em desktop, 390 × 650 e 320 × 568 verifica cifras, acessos diretos, foco, modais e ausência de rolagem horizontal na página; a carteira usa ícones acima dos rótulos em telas de até 600 px.

## [0.42.0] — 2026-10-27

- Refina carteira e análise com paleta neutra, contraste de títulos/valores, indicadores com ícones e cartões dos setores e resultado com hierarquia clara.
- Compacta cabeçalhos, alternância Fiscal/Contábil, faixa Jan–Set e ações dos modais, preservando áreas de toque, foco, avisos, rascunhos e exclusão.
- Destaca lucro, impostos e margem nos cartões da DRE; diferencia maior resultado disponível, prejuízo e indisponibilidade e reforça a linha final da comparação.
- Organiza ações de CSV/PDF, orientação de rolagem e primeira coluna fixa no celular; alinha apresentação de receita/compras e percentuais por público/enquadramento.
- Aproxima a DRE do início das versões salvas e reúne parâmetros no detalhe existente Dados usados no cálculo. Conserva documentos, valores, calendário, motor mensal `1.11.0-jan-sep` e versões anteriores.
- Remove a animação repetida da DRE ao alternar a apresentação e mantém ações de confirmação da exclusão visíveis em telas baixas.
- Validação local com Node 22 e MongoDB descartável: tipos, build, versão/documentação, **369 testes de regras**, **36 testes de integração** e **172 testes Python/PDF/OCR** aprovados. Os **28 cenários direcionados de navegador** cobrem Fiscal/Contábil, rascunhos, colagem, DIFAL, exclusão, fontes indisponíveis, DRE nova e histórica, detalhes sob demanda e CSV/PDF. Conferência visual adicional em desktop, 390 × 650 e 320 × 568 verifica área útil dos modais, foco dos campos, ações de confirmação, navegação e rolagem própria da tabela.

## [0.41.0] — 2026-10-27

- Fixa novas análises em janeiro a setembro, com nove competências efetivas, seleção por interseção da cobertura das entradas/saídas e exclusão de outubro a dezembro dos totais. Mantém documentos completos e auditoria original para conferência.
- Aceita relatórios de nove ou doze meses e intervalos originais diferentes com a mesma janela Jan–Set. Cobertura parcial fica explícita e bloqueia conclusão Fiscal/geração; nenhum mês sem suporte vira zero.
- Captura a política `JAN_SEP_V1` em fontes, confirmação, entrada, resultado e projeção; usa `1.11.0-jan-sep` somente nos cálculos novos. Conserva modelos, hashes e calendários dos snapshots legados e separa a referência RBT12 de doze meses.
- Mostra composição congelada da receita por B2B/B2C e do enquadramento de clientes/fornecedores, com devoluções abatidas, valores, percentuais e denominadores. Não confirmados e documentos sem identificação ficam explícitos, sem nova consulta ou mudança nos grupos do motor.
- Apresenta uma DRE resumida com quatro regimes, receita, compras, despesas, impostos e resultado destacado; mantém acesso aos detalhes e aos nove meses. Agrega informação de créditos utilizados sem contar o benefício duas vezes ou reintroduzir as linhas individuais de crédito potencial/utilizado de CBS/IBS.
- Adapta CSV, JSON, impressão, calendário e rótulos auxiliares ao período capturado; histórico de doze meses conserva sua apresentação. Composição dos documentos permanece distinguida dos ajustes manuais do cenário.
- Prepara os nove meses contábeis em um clique, gera modelo CSV Jan–Set e aceita colagem anual com Q4 guardado fora do subtotal. Campos em branco no período seguem pendentes; despesas e ajustes fora da janela ficam salvos, sem entrar no cálculo.
- Expõe cobertura mensal nos setores e na visão geral e mostra os controles de DIFAL de entrada/saída ao selecionar Sim. Preserva rascunhos, consultas leves, detalhes sob demanda e exclusão por carteira/modais.

- Validação: tipos, build e versão/documentação; **369 testes de regras**, **146 verificações de integração/projeção/competências**, **172 testes Python/PDF/OCR** e **38 cenários direcionados de navegador** aprovados. A conferência inclui importação de 12 meses com recorte para 9, cobertura parcial bloqueada, despesas/ajustes Q4 preservados, RBT12 própria, receita de R$ 3,3 milhões, devoluções, ICMS e DIFAL, histórico imutável, CSV/PDF completos, recuperação de rascunhos e metadados tardios. Desktop e telas de 320/390 px inspecionados; os dois casos finais de histórico foram repetidos em base nova após a conta sintética atingir o limite de logins das rodadas locais.

## [0.40.1] — 2026-10-26

- Expõe **Excluir análise** na carteira e no rodapé de todos os modais de uma análise existente, além da visão geral, com a mesma confirmação da empresa e permissão de escrita.
- Permite alcançar a exclusão durante o preenchimento e na recuperação de documentos ausentes, inclusive em rascunhos sem DRE. Cancelar ou Esc conserva etapa, foco e campos, sem salvar nem validar o formulário.
- Usa a revisão do resumo para excluir pela carteira sem novas leituras fiscais. Conflitos exigem atualizar os dados e confirmar novamente; a resposta é validada e leituras pendentes são canceladas ao concluir.
- Esclarece que a exclusão remove a análise, os dados dos setores e as versões vinculadas; preserva cadastro e documentos existentes e permite começar uma análise vazia. Motor fiscal mantido em `1.10.0-regime-selection`.

- Validação: tipos, build e versão/documentação; 342 testes de regras, 28 testes de integração de análises, 172 Python/PDF/OCR e 15 cenários direcionados de navegador aprovados. Documentos ausentes/corrompidos, rascunho inválido, conflito com recarga lenta, foco, permissões e reabertura vazia cobertos; desktop e celular inspecionados.

## [0.40.0] — 2026-10-26

- Abre carteira, seleção de empresa, visão geral e Contábil por consultas leves dos dados salvos. O modo opcional `summary=1` identifica a situação salva e conserva validação estrita na conclusão Fiscal e na geração.
- Carrega as evidências do Fiscal em paralelo e sob demanda, reutilizando a fonte da validação em `includeSource=1`. Fechar, reabrir ou trocar de setor conserva o rascunho e não duplica uma leitura em andamento.
- Trata falha de documento localmente, com nova tentativa explícita e acesso à importação. A resposta tardia atualiza evidências sem reconstruir os campos digitados.
- Evita reconstruir a visão geral a cada tecla; atualiza o resumo contábil quando aberto, agrupa atualizações por quadro e reutiliza cronograma RBT12 e índice de busca de empresas.
- Identifica competências contábeis pelos metadados de relatórios concluídos e compatíveis, mesmo antes da conclusão Fiscal, sem reler itens ou preencher despesas. A chegada da fonte atualiza os atalhos sem substituir campos/colagem. Reaproveita o extrato recém-salvo e conserva seu aviso de confirmação.
- Reutiliza a apresentação da DRE nas trocas de visualização, monta gráficos/memória sob demanda e mantém CSV, JSON e impressão completos. A escolha do conteúdo do relatório não remonta a DRE; novo resultado invalida os dados de apresentação anteriores.
- Prepara índices uma vez por conexão, projeta apenas vínculos na travessia de versões e reduz o retorno da geração leve à referência do resultado. Reutiliza a conferência final comprovada sob leases/CAS, mantendo as barreiras de publicação e exclusão.
- Acrescenta testes de performance no MongoDB e no navegador para leituras fiscais ausentes na navegação, fontes inválidas, respostas lentas, rascunhos, doze competências, exportações e impressão. Motor fiscal mantido em `1.10.0-regime-selection`.
- Validação local: tipos, build, versão/documentação, 342 testes de regras, 140 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 35 cenários únicos de navegador aprovados. A rodada final de análises passou os 12 casos; os 23 casos de DRE/simulador incluem a conferência final de gráficos sob demanda. Desktop e celular inspecionados.

## [0.39.0] — 2026-10-26

- Acrescenta a pergunta explícita Terá DIFAL? Sim/Não na criação com Simples e nos dois passos do Fiscal, fora das opções avançadas. A criação exige escolha sem adicionar etapa; retomadas conservam a política salva.
- Mantém escolhas independentes de Puro/Híbrido e entrada/saída, com resumo da seleção e preservação das direções ao alternar Sim/Não. A escolha Não exclui o DIFAL dos dois cenários na próxima geração, sem alterar documentos ou resultados históricos.
- Permite excluir o trabalho pela visão geral, com identificação da empresa, confirmação e permissões de administrador/operador. Remove dados dos setores e versões vinculadas; preserva cadastro, fontes fiscais, outros trabalhos e versões avulsas independentes.
- Protege a exclusão com revisão, lease, recibo idempotente e controles contra gravações tardias. Uma nova análise da empresa começa vazia e não recupera automaticamente históricos antigos; repetição da exclusão anterior não atinge a nova análise.
- Trata conflito, erro, cancelamento, foco e navegação durante exclusão. Acrescenta verificações reais de interface/API/Mongo, DIFAL aplicado na DRE/CSV, sessão nova, permissões e preservação das fontes. Motor fiscal mantido em `1.10.0-regime-selection`.

- Validação: tipos, build e versão/documentação; 342 testes de regras, 132 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 15 cenários únicos de navegador aprovados. A última conferência do DIFAL respeita os rótulos e a proteção de texto do CSV; valores e exportação não exigiram alteração. Escolha inicial, Fiscal e confirmação de exclusão conferidos visualmente em desktop e celular.

## [0.38.0] — 2026-10-26

- Reduz a abertura a Empresa → Setor e regimes e o Fiscal a Documentos → Dados fiscais; Contábil e configuração passam a ter uma tela cada, com gravação direta e sem conferência repetida.
- Consolida a visão geral em situação, dois setores e um único ponto de resultado. Detalhes das pendências e versões ficam recolhidos, sem repetir acessos e instruções.
- Permite alternar Fiscal/Contábil dentro do mesmo modal, preservando rascunhos. No Contábil, competências, colagem opcional, meses individuais e resumo ficam juntos, com os campos sempre montados.
- Padroniza ações em Salvar rascunho e Salvar e concluir, mostra o estado de gravação discretamente e reduz o espaço de títulos/progresso. A escolha confirmada da empresa avança automaticamente, com proteção para respostas atrasadas.
- Impede gravação implícita por Enter nos campos finais, mantém a colagem pendente como bloqueio de conclusão e revela blocos/campos que exigem correção. Links antigos de etapas são normalizados sem alterar o contrato fiscal.
- Preserva cadastro único, revisões, documentos, versões imutáveis, cálculos e permissões; atualiza os testes do assistente e os fluxos reais de navegador.
- Validação local: tipos, build, versão/documentação, 342 testes de regras, 124 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 11 cenários direcionados de navegador aprovados; os cinco cenários de análise foram repetidos após os ajustes finais. Setup, visão geral, setores e colagem conferidos visualmente em desktop e 320/390 px.

## [0.37.0] — 2026-10-26

- Organiza abertura, Fiscal, Contábil e configuração em modais com etapas, progresso, Voltar/Continuar e conferência antes das ações finais. A empresa passa a ter uma visão geral compacta com setores, pendências, resultado e versões.
- Nova análise percorre empresa, setor, regimes/ano e conferência. A retomada usa as escolhas já salvas e pula a etapa de nova configuração. Campos e validações permanecem vinculados à empresa selecionada.
- Fiscal separa documentos, opções/referência e conferência; Contábil separa competências/colagem, despesas e conferência. Aplicar a colagem abre as despesas, e dados já existentes orientam o passo inicial.
- Avançar, voltar e fechar não salvam nem concluem implicitamente. Os campos permanecem montados ao navegar ou fechar; salvar registra apenas o setor escolhido, e concluir retorna à visão geral.
- Move avisos e erros para o modal ativo, revela a etapa do campo pendente, bloqueia fechamento durante operações e conserva foco, teclado e leitura em telas pequenas. Restrições de consulta e controles concorrentes do servidor permanecem.
- Adiciona helper de navegação com definições imutáveis e oito testes; adapta os fluxos reais de navegador para conferir passos, preservação de rascunhos, fechamento, leitura de PDF, centavos e resultados salvos.
- Validação local: tipos, build, versão/documentação, 340 testes de regras, 124 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 11 cenários de navegador aprovados. Corrige o ciclo de foco por teclado e confere a reabertura rápida do mesmo modal, além da apresentação em desktop e 320/390 px.

## [0.36.0] — 2026-10-26

- Simplifica a carteira e o detalhe da análise com próxima ação, progresso Fiscal/Contábil, pendências com atalhos e distinção entre resultado atual e trabalho pronto para gerar. Alterações locais ficam identificadas e bloqueiam geração até serem salvas e conferidas.
- A abertura confere a empresa e apresenta ano/regimes já salvos antes de continuar uma análise existente. Editar a busca limpa a seleção anterior; respostas atrasadas não substituem a escolha mais recente.
- Troca de setor mantém os dois rascunhos na mesma página, sem PATCH automático. Salvar um setor preserva o outro; importação fiscal aguarda o salvamento de despesas locais para evitar descarte do preenchimento.
- Colagem de despesas com seis colunas, TAB ou ponto e vírgula, prévia antes de aplicar e confirmação para substituir integralmente meses existentes. Conversão exata em centavos, validação de cabeçalho/competência/valor e união máxima de 12 meses; campos vazios continuam nulos e meses fora da colagem são preservados.
- Modelo CSV e resumo contábil durante o preenchimento, com totais por categoria e mês, campos pendentes e cobertura fiscal. A prévia expira quando os dados mudam; aplicar não salva no servidor, e nenhum valor mensal é inferido por média.
- Melhora a organização em telas pequenas e preserva painéis de conferência abertos durante edições. Mantém documentos, revisões concorrentes, histórico imutável e o motor fiscal `1.10.0-regime-selection`.
- Acrescenta testes de parser/orientação e dois fluxos de navegador com Node e Mongo reais para retomada, colagem, preservação de rascunhos, bloqueios e valores do resultado gerado.
- Validação local: tipos, build, versão/documentação, 332 testes de regras, 124 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 11 cenários de navegador aprovados. Prévia e formulário conferidos em 320/390 px; colagem ainda não aplicada recebe proteção própria antes de importar, gerar ou sair.

## [0.35.0] — 2026-10-26

- Nova área Análises com empresa, setor Fiscal/Contábil, ano e seleção de um a quatro regimes. Carteira única por empresa e navegação Visão geral, Empresas, Análises, Relatórios e Versões salvas.
- Persiste os setores separadamente com revisões, autor, data e confirmação. Contábil reúne salários/pró-labore, aluguéis, taxas de cartões, benefícios e outras despesas por competência; campos vazios não viram zero nem médias automáticas.
- Geração exige ambos os setores concluídos, cobertura exata das competências e fontes da mesma empresa. O servidor calcula com dados salvos e valida revisões/fingerprint novamente antes da publicação, com proteção contra edições concorrentes e repetição idempotente.
- Um resultado corrente por empresa e versões anteriores imutáveis. Editar marca o resultado como desatualizado; recalcular cria versão vinculada. Histórico e DRE oferecem retorno ao trabalho da empresa, sem permitir exclusão das versões geridas.
- Extrato e RBT12 são exigidos somente quando Puro ou Híbrido fazem parte da análise. LP/LR usam `NOT_REQUIRED`, sem extração, cronograma, diagnóstico ou memória de RBT12 fabricados. PDF e referência manual confirmada permanecem disponíveis quando há Simples.
- Contrato `REGIME_SELECTION_V1` e motor mensal `1.10.0-regime-selection`: cálculo, ranking, gráficos, DRE anual/mensal, CSV e PDF contêm apenas os regimes escolhidos, inclusive uma única coluna. Os valores financeiros dos mesmos regimes são preservados.
- Importação fiscal captura a política de DIFAL efetiva dos regimes selecionados, mantendo preferências no rascunho. Documentos históricos conservam suas escolhas; novas simulações usam a seleção atual confirmada. Naturezas 8000, ICMS por UF/devoluções e conciliações permanecem.
- Adoção explícita preserva simulações legadas, ajustes mensais e fontes originais. Snapshots sem distribuição mensal suficiente ficam consultáveis e deixam os setores pendentes. GET não migra dados; fluxo antigo conserva retries e compatibilidade antes da ativação da análise.
- Formulários preservam valores em falhas de validação e conflitos. Importador avança de entradas para saídas e retorna ao Fiscal, com retomada entre sessões e sem etapa de extrato para LP/LR.
- Acrescenta integração Mongo de análises, matriz das 15 seleções de regimes e fluxo real de navegador com dois setores, histórico, conflito, CSV/PDF e telas móveis. Mantém os gates existentes e inclui a nova integração no CI.
- Validação: tipos, build, versão/documentação, 308 testes de regras, 124 verificações de integração/projeção/competências e 172 Python/PDF/OCR aprovados. Rodada ampla com 173 casos de navegador, duas expectativas dos novos rótulos corrigidas e conferência final direcionada de 19 casos; cobertura total passa a 174, incluindo vínculo/retomada do PDF na nova tela. PDFs com um e dois regimes e telas móveis conferidos visualmente.

## [0.34.1] — 2026-10-23

- Retira da DRE as quatro linhas de composição de crédito potencial e utilizado de CBS e IBS, conforme as imagens indicadas. A mesma apresentação atende anual, mensal, CSV e PDF, inclusive para históricos.
- Preserva as linhas principais de créditos, os valores efetivos do resultado, as demais composições, a memória capturada e o quadro final de ICMS. A alteração visual não recalcula tributos nem modifica snapshots.
- Sincroniza o teste de nova tentativa do histórico com a conclusão da atualização automática, corrigindo a corrida confirmada no trace do CI; mantém a produção e as verificações de erro, clique explícito, escape de título e sessão.
- Valida tipos, build e versão/documentação, 295 testes de regras, 172 de Python/PDF/OCR, 64 verificações de integração/projeção e 27 casos direcionados de navegador, sem saltos.

## [0.34.0] — 2026-10-23

- Exclui todas as naturezas de prefixo 8000 da antecipação e do crédito de ICMS, preservando seus custos. Antecipação V4 conserva 7,32% nas demais compras elegíveis e valida exatamente as regras históricas V1/V2/V3.
- Acrescenta composição de ICMS por competência, natureza e UF, derivada somente das linhas conciliadas no servidor: premissas de 18% interna e 12% interestadual nas vendas, compras elegíveis e devoluções de venda. Não presume UF ausente nem localização pela natureza.
- Separa crédito de compras e crédito de devoluções de venda, usando débito sobre vendas brutas para não duplicar o efeito da devolução já abatida na receita. Crédito utilizado reduz o ICMS líquido uma única vez; excedente não aumenta lucro nem é compensado entre meses.
- Move a apuração do crédito para o final da DRE, retirando o detalhamento das deduções; anual, mensal, PDF e CSV mantêm os mesmos valores. Composição nova só aparece quando capturada e conciliada; históricos não recebem valores inventados.
- Ajustes de receita usam as bases de UF da origem, evitando ampliar arredondamentos de notas pequenas. Ajustes de custos não criam créditos de documentos. Ausência de UF ou de composição suficiente deixa pendentes os regimes com ICMS fora do DAS, seu diagnóstico e a memória fiscal.
- Versiona `ICMS_OPERATIONS_V1`, motores `1.9.0-icms-operations` e revisão vinculada `ICMS_OPERATIONS_2026_10_V9`; preserva snapshots originais, enquadramento consultado e opções de DIFAL. Acrescenta referências oficiais e identifica 12% como premissa gerencial, sem declarar alíquota legal universal.
- Corrige a divergência do contrato de reprocessamento entre servidor e navegador, compartilhando a revisão atual. Resposta desconhecida interrompe antes do POST; tentativa explícita retoma quando a versão estiver confirmada, sem alterar a revisão registrada nos históricos.
- Validação: 295 testes de regras, 113 verificações de integração/projeção/competências, 172 Python/PDF/OCR e 171 testes na rodada completa de navegador aprovados, sem saltos; tipos, build, versão e diff conferidos. Fluxo autenticado real confirma crédito de R$ 156,00 e ICMS líquido de R$ 264,00 após reabertura, CSV/PDF e preservação das fontes. Inspeção visual confere anual/mensal/completo e 320/390 px; avisos móveis se limitam ao regime selecionado.

## [0.33.0] — 2026-10-23

- Corrige o bloqueio do Simples em meses sazonais: a verificação usa a soma das competências do cenário, sem comparar mês × 12 ao limite. RBT12, receita do período, limite federal e sublimite passam a ter diagnóstico separado.
- Acrescenta a escolha explícita de ICMS/ISS dentro ou fora do DAS, validada e preservada entre rascunho, servidor, histórico e nova versão. A prévia de DIFAL acompanha essa condição sem alterar as escolhas das operações.
- Identifica apurações não suportadas com causas e orientações próprias, sem declarar exclusão fiscal. Totais anuais de regimes com competências pendentes não apresentam soma parcial como resultado confirmado; os meses disponíveis permanecem consultáveis.
- Memória de cálculo e painel de DIFAL respeitam a disponibilidade do regime, sem apresentar parcelas ou valores intermediários como totais confirmados. Operações explicitamente excluídas conservam seu zero salvo, mesmo ao consultar uma competência ausente.
- Evita o falso acréscimo dos coeficientes do Lucro Presumido quando um mês extrapolado supera R$ 5 milhões, mas a soma efetiva não. O rateio gerencial acima da referência fica identificado como estimativa, separado da apuração trimestral.
- DRE abre em Anual e conserva a alternância Mensal. PDF e CSV oferecem relatório completo, somente anual ou somente mensal, sempre para os quatro regimes; completo traz anual primeiro, meses, fechamento da receita, diagnósticos, premissas, memória e referências capturadas.
- Mostra cobertura parcial, competências de origem e ano do cenário, sem inventar meses nem recalcular históricos. Motores `1.8.0-simples-revenue-context` e revisão vinculada `SIMPLES_REVENUE_CONTEXT_2026_10_V8` preservam os originais.
- Validação: 278 testes de regras, 112 verificações de integração/projeção/competências e 171 Python/PDF/OCR aprovados. Navegador: 166 testes na rodada completa e 21 na conferência final direcionada, incluindo a nova regressão da memória histórica. Fluxo real de R$ 3,3 milhões, três PDFs, CSV, nova sessão e versões dentro/fora do DAS conferidos; tipos, build, versão e inspeção visual aprovados.
- Fixa os jobs de navegador no Ubuntu 24.04, compatível com o Playwright 1.55.1 instalado. Corrige a falha de preparação do Chromium causada pela migração de `ubuntu-latest` para Ubuntu 26.04, mantendo as verificações obrigatórias.

## [0.32.2] — 2026-10-23

- Fechamento visível da receita bruta de vendas e serviços, devoluções de venda e receita após devoluções, por competência e no período. A DRE apresenta a composição ao final, com ajustes manuais e receita utilizada separados; celular recebe valores empilhados para o regime e período selecionados.
- Corrige os rótulos que chamavam a receita já reduzida pelas devoluções de receita bruta. Campos editáveis e denominadores dos percentuais identificam a base usada, preservando os cálculos e o abatimento único.
- Relatórios distinguem saldo original do arquivo e receita considerada. Fechamento derivado exige o par confiável de compras e vendas da mesma empresa e geração; devoluções de compra e outras operações não viram uma segunda dedução da receita.
- CSV específico de fechamento, PDFs individuais/consolidados e impressão mantêm a mesma composição. O novo CSV conserva valores negativos numéricos para conferência em planilha, com textos e metadados escapados. CSV de linhas, totais e evidências originais preservados.
- Histórico usa apenas a composição capturada e conciliável com os valores salvos. Ausência de evidência fica indisponível, sem inventar devoluções em zero ou misturar relatórios atuais com versões antigas. Regras e escolhas de DIFAL preservadas.
- Validação: 261 testes de regras, 111 verificações de integração/projeção/competências, 171 Python/PDF/OCR e 164 no navegador aprovados; tipos, build, versão e inspeção visual conferidos. Regressão real cobre dois meses, reabertura autenticada, nova versão com ajuste manual e preservação das fontes.

## [0.32.1] — 2026-10-23

- Corrige DIFAL sobre vendas aparecendo como incluído na prévia e nos resumos, mesmo após desmarcar a saída. Os indicadores do simulador também passam a respeitar a escolha e os bloqueios por competência.
- Apresentação compartilhada por direção identifica quais cenários do Simples incluem entrada ou saída. Não incluir saída preserva a entrada selecionada e vice-versa; nenhum valor é duplicado por selecionar os dois cenários.
- Política do relatório resolvida no servidor pela geração, empresa e consulta vinculadas; resumos, linhas, CSV e PDFs individuais/consolidados respeitam a seleção. Reconsultas novas conservam a política de origem; antigas usam a linhagem válida somente em leitura e identificam a ausência de escolha quando a origem não está disponível.
- Estimativa bruta preservada como evidência explicitamente identificada e recolhida nos cartões; a impressão não expande nem inclui esses detalhes. Cálculos da DRE, totais, snapshots e históricos permanecem imutáveis; a consulta de uma simulação salva usa a aplicação registrada. Consolidados contam cada empresa uma única vez e separam relatórios sem escolha histórica da soma selecionada.
- Regressão do problema reproduzida no navegador antes da correção, com saída desmarcada mostrando R$ 15,00. Novos testes cobrem prévia, resumo, opções mistas, persistência, vínculo por empresa e exportações.
- Validação com Node 22.16.0: tipos, build, release e diff aprovados; 248 testes de regras, 161 Python/PDF/OCR e a rodada final completa de 150 testes de navegador passaram sem saltos. Todos os comandos de integração, projeção, competências e reprocessamento passaram com MongoDB descartável. Fluxo real confirmou saída zerada e entrada preservada após importação, CSV, salvamento e novo login; PDFs e layouts desktop/320/390 px conferidos visualmente.

## [0.32.0] — 2026-10-23

- DIFAL selecionável somente para Simples Puro e Híbrido, após a escolha da empresa, nos fluxos individual e multiempresa. Entrada e saída têm controles independentes por cenário; ambas ou nenhuma também são permitidas.
- Contrato `DIFAL_SCENARIOS_V2` e motores `1.7.0-difal-directions`: entrada afeta somente antecipação de compras; saída afeta somente DIFAL de vendas. Presumido e Real ficam zerados nas novas simulações; DIFAL não reduz a base de IRPJ/CSLL do Real. Os bloqueios mensais de RBT12/sublimite e ICMS fora do DAS permanecem.
- Opções acompanham geração, fonte, rascunho, salvamento, cópia e revisão, sem mistura entre empresas. Pedidos de simulação sem política explícita herdam a escolha da empresa; políticas V2 inválidas são rejeitadas no servidor.
- DRE, memória, JSON, CSV e impressão exibem cenário, entrada, saída e motivo de aplicação por competência. Os relatórios de origem mantêm seus valores para conferência.
- Histórico V1 conserva valores e escolhas originais. Nova revisão `DIFAL_DIRECTIONS_2026_10_V7` cria versões vinculadas, preserva opções reconciliáveis e verifica fontes/UF apenas para a direção aplicável. Reenvios incertos V1 ou sem política preservam o hash original e retornam o snapshot existente.
- Classificação de naturezas, percentuais gerenciais de 10% e 7,32%, valores mensais e leitura do extrato permanecem preservados.
- Validação com Node 22.16.0: tipos, build, release e diff aprovados; 241 testes de regras, 155 Python/PDF/OCR e 137 testes de navegador passaram sem saltos. Todos os comandos de integração, projeção, competências e reprocessamento passaram com MongoDB descartável; compras reexecutadas com 21/21 após atualizar a expectativa do novo filho de uma simulação V1. Matriz de 384 configurações/limites e 1.536 resultados de regimes; telas desktop/320/390 px e exportações conferidas.

## [0.31.0] — 2026-10-23

- Resumo de compras/entradas considera somente naturezas classificadas como COMPRAS e serviços 8000; exclui devoluções, outras operações e naturezas não classificadas.
- Classificação usa os quatro primeiros dígitos do campo Natureza do relatório de entradas, preservando o catálogo de 619 códigos fornecido e a fórmula financeira original.
- Visão derivada `purchaseSelection` (`PURCHASE_NATURES_V1`) concilia total bruto, selecionado e excluído por natureza. Totais e percentuais do resumo identificam sua base selecionada; todas as linhas permanecem na consulta e no CSV, com seleção, motivo e valor considerado, sem modificar o snapshot. Legado sem evidência de natureza suficiente fica indisponível, sem zero confirmado.
- Opções de DIFAL dos quatro regimes aparecem em modal após escolher a empresa e antes dos relatórios. A política é salva por empresa em `generation.companies[].difalPolicy` e encaminhada em `source.difalPolicy` ao simulador; retomadas mantêm a política original e históricos sem o campo preservam sua ausência.
- Relatórios de vendas, composição atual da DRE e dados originais preservados. Documentos e dados reais de clientes não são versionados.
- Validação: tipos, build, versão e diff conferidos; 237 testes de regras, 155 Python/PDF/OCR e todos os comandos de integração com MongoDB descartável aprovados. Navegador: 135 casos únicos aprovados, incluindo reexecução de 10 casos após corrigir a leitura de uma resposta de navegação no teste. Paridade Node/Python em 1.454 casos e 16.122 linhas; PDFs e telas desktop/mobile conferidos. Revisão corrigiu paginação do consolidado, precedência de opções na cópia de legado e bloqueio de identidade documental divergente.

## [0.30.0] — 2026-10-22

- Opção independente de DIFAL para Simples puro, Simples híbrido, Lucro Presumido e Lucro Real, persistida em `draft.difalPolicy` com o contrato `DIFAL_SCENARIOS_V1` e mapa booleano `enabled`.
- Nos cenários Simples, a escolha inclui ou exclui o DIFAL das vendas e a antecipação aplicável às compras. Ambos ficam zerados automaticamente na competência com RBT12 igual ou superior a R$ 3,6 milhões ou ICMS fora do DAS, prevalecendo sobre a opção marcada.
- Lucro Presumido e Real permitem incluir ou excluir o DIFAL das vendas sem os bloqueios do Simples; antecipação de compras permanece zero.
- Tela, memória, CSV e impressão apresentam a aplicação e os motivos por competência. Relatórios importados, fontes, bases elegíveis e estimativas originais permanecem preservados.
- Motores `1.6.0-difal-scenarios` e revisão `DIFAL_SCENARIOS_2026_10_V6`: novas versões vinculadas conservam escolhas existentes sem sobrescrever históricos; retomadas de salvamento preservam pedidos legados sem o campo de opções.
- Conferência da seção 2.2 começa pelo histórico completo de receitas, aberto, com os dois mercados; RBT12 por competência inicia aberta e detalha as 12 receitas anteriores de cada mês, sem repetir o total do PA nem misturar receita mensal, quadro 2.1 ou projeção por 12.
- Validador compartilhado `reconcileSection22Extraction` concilia total, janela, base e histórico no navegador e no servidor antes da confirmação; divergências bloqueiam a leitura.
- PDF fornecido conferido privadamente: as 23 competências dos dois mercados coincidiram com o leitor existente. Versão do parser preservada; nova regressão sintética cobre receitas em queda e mercado externo não zero, sem incluir documentos ou dados reais no repositório.
- Validação: tipos, build, versão e diff conferidos; 232 testes de regras, 98 de integração, 150 Python/PDF/OCR e 127 casos únicos de navegador aprovados, incluindo reexecuções após corrigir uma expectativa de centavos e a fixture legada. Tabelas reconferidas em 320 e 390 px. Os 65 testes dirigidos após a nova conciliação e a matriz independente de 2.112 resultados também passaram. PDF fornecido conferido privadamente, sem incluir seus dados no repositório.

## [0.29.0] — 2026-10-22

- DIFAL de vendas inclui CPF e CNPJ válido nas naturezas elegíveis entre UFs diferentes, mantendo 10%.
- DIFAL de entrada — Antecipação de ICMS inclui CPF e CNPJ válido em compras e serviços 8000 interestaduais, mantendo 7,32%. Documentos inválidos, CNO e ausência de documento permanecem excluídos.
- Prévia, linhas, resumo, CSV, PDF e DRE usam os novos contratos. Relatórios anteriores podem exibir a estimativa atual derivada das linhas salvas, após conciliação da regra original e com origem identificada, sem modificar os dados históricos.
- Simples puro/híbrido e bloqueio pelo sublimite preservados; nova revisão vinculada atualiza simulações sem sobrescrever originais.

- Validação: 223 testes de regras, 76 casos de integração/reprocessamento, 149 testes Python/PDF/OCR e 123 casos únicos de navegador conferidos, incluindo reexecuções após ajustar fixtures e expectativas para CNPJ. Paridade Node/Python em 1.470 cálculos e revisão visual dos relatórios.

## [0.28.2] — 2026-10-22

- Compras/entradas identificam explicitamente o DIFAL de entrada — Antecipação de ICMS na tela, prévia, CSV e PDF.
- Relatórios NET_V2 antigos sem versão da antecipação calculam 7,32% sobre compras interestaduais elegíveis com CPF ao abrir, quando as evidências necessárias já estão salvas. Não é preciso reimportar esses relatórios.
- O cálculo derivado informa sua origem e não altera snapshots, totais, enquadramentos, consultas ou retomadas. Dados não armazenados continuam indisponíveis; UFs vazias ficam pendentes.
- Resumo, linhas, exportações e fonte mensal da DRE mantêm a mesma base e UF das compras. Nova revisão vinculada preserva os históricos anteriores.

- Validação: 220 testes de regras, 71 de integração/reprocessamento e 145 Python/PDF/OCR aprovados; 118 fluxos únicos de navegador conferidos após corrigir a leitura de células vazias no teste de CSV.

## [0.28.1] — 2026-10-22

- Antecipação de ICMS de compras restrita a CPF nas operações interestaduais elegíveis, mantendo 7,32% e serviços 8000. CNPJ, CNO e documentos ausentes ou fora do formato CPF não geram valor nem pendência de UF.
- Prévia, linhas, resumo, CSV e PDF de compras mostram a antecipação e sua base, confirmadas no servidor. Custos de compras sem CPF permanecem preservados.
- DRE usa a mesma restrição, somente no Simples puro/híbrido e abaixo do sublimite. UF ausente nas compras continua pendente; não é substituída silenciosamente pela UF das vendas. DIFAL sobre vendas continua em 10%.
- Contrato V2 para novos cálculos; V1 explícita conserva sua regra histórica. Relatórios sem versão mantêm retomada e conferência originais e indicam estimativa indisponível. Nova revisão cria versões vinculadas sem modificar snapshots anteriores.

- Validação: 220 testes de regras, 69 de integração/reprocessamento, 141 Python/PDF/OCR e 114 de navegador aprovados. PDF e layouts desktop/mobile conferidos.

## [0.28.0] — 2026-10-22

- Catálogo completo da coluna D: 619 naturezas, quatro dígitos, sem inferência pela descrição; compras preservam natureza e UF na importação.
- Receita selecionada por vendas e serviços, com devoluções de venda do relatório de compras; custos selecionados por COMPRAS e serviços 8000, com auditoria de exclusões.
- DIFAL sobre vendas V3 em 10% das vendas interestaduais a CPF; versões V1/V2 preservadas.
- Antecipação de ICMS de 7,32% separada, somente Simples puro/híbrido, bloqueada no sublimite inclusivo; sem duplicação nem crédito adicional.
- RBT12 móvel por competência a partir de todo o histórico explícito do quadro 2.2; ausência de meses bloqueia o cálculo e valor do PA deixa de ser repetido automaticamente.
- Tela, memória, calendário, CSV/PDF e snapshots incluem conferências de naturezas e RBT12; competências disponíveis permanecem consultáveis quando outro mês impede o consolidado do regime.
- Nova revisão idempotente cria versões vinculadas e exige reimportação quando fontes antigas perderam evidências necessárias.
- Regressões de catálogo, fontes, tributos, limites, persistência, isolamento, relatórios e fluxo completo no navegador, com dados sintéticos.

## [0.27.0] — 2026-10-22

- Histórico distingue soma mensal e projeção legada, identifica o período e oferece acesso direto à revisão existente no mesmo workspace.
- Progresso da revisão e atualização parcial da lista preservam a visibilidade das versões já concluídas após interrupções.
- Comparação entre competências na DRE com valores salvos, variações absolutas e margens em pontos percentuais; dados ausentes não viram zero.
- Validação direciona ao campo incompleto de outra competência; edição de resultado gerado informa a necessidade de atualizar a simulação.
- Regressões do fluxo guiado alinhadas à soma mensal e aos controles atuais; fórmulas fiscais e originais preservados.

## [0.26.1] — 2026-10-20

- Alternância Mensal/Anual dentro da DRE, com período ativo destacado e competência antes do resumo.
- Visão mensal inicia em um mês por vez; calendário completo continua opcional. Seletores duplicados removidos.
- Troca de período preserva mês, regime e valores salvos; total anual soma as competências, sem média.
- Conferência no navegador de navegação, teclado, totais distintos, meses sem dados e ausência de novas gravações.

## [0.26.0] — 2026-10-20

- DRE como apresentação principal do resultado, com comparação de regimes recolhida e evidências de origem abaixo no histórico.
- Resumo visual de receita, deduções, resultado e margem por regime/período; gráfico conciliado com as células da tabela, sem recalcular tributos.
- Tabela única com hierarquia visual, destaque de regime anual e atalhos acessíveis entre linhas.
- Estados explícitos de prejuízo, valores indisponíveis e composição divergente; layouts para celular e desktop.
- Regressões de conciliação, valores salvos, seleção de mês/regime, teclado, exportações e impressão completa.

## [0.25.1] — 2026-10-20

- Interface mensal com navegação entre competências, resumo dos valores e origem visível nas seções.
- Restauração de receitas e compras do mês selecionado, mantendo despesas e outros meses.
- DIFAL com hierarquia de valor mensal, base e total, pendências explícitas e detalhes preservados durante a edição.
- Seletor mensal nos indicadores sincronizado com a consulta da DRE; navegação preserva resultados já salvos.
- Layout responsivo, navegação por teclado e cabeçalhos fixos da tabela; impressão, exportação e cálculo preservados.

## [0.25.0] — 2026-10-20

- DRE passa a usar compras, vendas, serviços e DIFAL reais de cada competência da coluna H, com total anual pela soma dos meses importados.
- Seletor mensal, despesas e ajustes individuais, memória, gráficos, impressão e exportações seguem a mesma série, sem média mensal nem projeção de meses ausentes.
- DIFAL V2 derivado das vendas/saídas por mês, inclusive ao reutilizar relatórios V1 conciliados.
- Revisão idempotente em novas versões preserva os históricos, RBT12 e ajustes; relatórios e competências insuficientes ficam pendentes.
- Regressões de sazonalidade, período parcial, meses sem movimento, centavos, validação, isolamento, salvamento e navegador.

## [0.24.1] — 2026-10-20

- DIFAL gerencial reconhece vendas 5102 a CPF de outra UF em todas as competências, incluindo sufixos do Questor e descrição de produto.
- Regra V2 compartilhada entre prévia, servidor e PDF, com cálculo e exportação V1 preservados para relatórios antigos e importações retomadas.
- Novos cenários derivados de relatórios V1 usam a estimativa atual sobre as linhas originais conciliadas, sem alterar a fonte.
- Novo lote idempotente de revisão das simulações inclui originais já revisados, cria versões vinculadas e preserva as anteriores.
- Regressões de 12 meses, CPF repetido, centavos, exclusões, persistência, DRE, exportações e navegador.

## [Não lançado] — 2026-10-19

- Regressão de serviços e DIFAL em todos os regimes na DRE única, tela e CSV, com 12 meses e total anual.
- Reabertura do histórico conferida sem gravações pela API; exportação JSON preserva resultados e calendário. Complemento de testes da v0.24.0, sem alteração funcional.

## [0.24.0] — 2026-10-19

- Leitura da seção 2.2 com separação determinística de valor e competência colados pelo OCR, identificação com espaços e cabeçalhos de continuação.
- Validação de confiança cobre dados críticos e cabeçalhos divididos em linhas; períodos malformados e valores ambíguos continuam bloqueados.
- Ordem de leitura de texto nativo rotacionado e duplicatas exatas corrigidas, preservando as páginas originais; telemetria do runtime OCR desativada antes da inicialização.
- Recuperação do PDF do rascunho após recarga, invalidação durante releitura e mensagens específicas para interrupções de upload/processamento.
- Ciclo de processamento protege resultados concluídos contra falhas de transporte, reprocessamentos inválidos e tentativas concorrentes; escrita restrita aos perfis autorizados.
- Regressões com PDFs sintéticos, API, armazenamento e navegador; histórico e apresentação da DRE preservados.

## [0.23.1] — 2026-10-19

- DRE única com composição de receitas, créditos, IRPJ e indicadores integrados à tabela principal.
- Removidas as divisões visuais em blocos, os painéis de detalhamento da DRE e a separação da impressão em semestres.
- CSV acompanha a ordem contínua; botão de impressão inclui apenas o demonstrativo e sua identificação, com cabeçalhos repetidos na paginação.
- Impressão anual em A4 horizontal e mensal em A3 horizontal, com ano abaixo do mês e referência da RBT12 preservada.
- Resultados, calendário, cálculos e histórico preservados, com regressões de apresentação e exportação.

## [0.23.0] — 2026-10-19

- DRE anual e mensal organizada em blocos, com subtotais e análise percentual opcional sobre a receita bruta.
- Composição de receitas, créditos e IRPJ, com indicadores gerenciais e conciliação contra os valores salvos; detalhes permanecem recolhidos por padrão.
- Apresentação compartilhada por tela, CSV e JSON, preservando resultados, calendário histórico e ausência de dados sem recalcular cenários.
- Impressão do calendário em dois semestres, com regime identificado e restauração do estado da tela após imprimir.
- Regressões de históricos, percentuais, indisponibilidade, conciliação, exportação, calendário, celular e impressão.

## [0.22.1] — 2026-10-19

- Corrigido bloqueio indevido de simulações antigas que possuem serviços manuais e importados: a migração conserva o serviço manual como adicional mensal, conforme a orientação da tela antiga, e reclassifica os serviços importados sem duplicar mercadorias.
- Memória da migração com valores importado, manual e total; originais, despesas, RBT12 e ajustes reconciliáveis preservados.
- Retomada única das pendências antigas desse motivo, no mesmo lote e com os mesmos identificadores; versões já atualizadas não são duplicadas.
- Regressões de receita combinada, retomada, isolamento e acompanhamento automático no navegador.

## [0.22.0] — 2026-10-19

- Detalhes financeiros recolhidos por padrão, com escolha preservada ao alternar abas/períodos e expansão temporária na impressão.
- Revisão automática do histórico por workspace ao abrir Simulações com acesso de escrita; acompanhamento disponível também para visualização.
- Recálculo retomável e idempotente em novas versões vinculadas, conservando originais, fontes armazenadas, RBT12 comprovada, despesas e ajustes manuais reconciliáveis.
- Estados OK, Pendente e Falhou por simulação; ausência de fonte ou ambiguidade de serviços impede confirmação automática.
- Regressões de concorrência, isolamento, exclusão, proveniência, impressão e fluxo no navegador.

## [0.21.0] — 2026-10-19

- Vendas de serviços 9000 visíveis no resumo guiado e relatório, com natureza de quatro dígitos e descrição para conferência.
- Serviços separados por grupo gerencial no servidor e preenchidos automaticamente no simulador, sem duplicar mercadorias; projeção em centavos reconcilia a receita combinada.
- DIFAL estimado da origem projetado pelo período importado e incluído uma única vez na DRE, tributos e resultado antes de IRPJ/CSLL; memória mensal/anual e pendências explícitas.
- Seções financeiras abertas por padrão e expandidas na impressão; origem, cálculo e parâmetros salvos disponíveis sem abrir informações recolhidas.
- Modelo e projeções versionados, ajustes de serviços auditados e históricos preservados sem recálculo.
- Regressões sintéticas de classificação, integração com MongoDB, motor/DRE, arredondamento, PDF e navegador.

## [0.20.3] — 2026-10-16

- Suporte ao cabeçalho de declaração PGDAS-D, CNPJ Matriz e PA em intervalo de datas, com verificação de identificação única e período válido.
- RBT12 preservada na seção 2.2, com regressões para os dois modelos de documento e bloqueio de valores monetários fragmentados/ambíguos.
- Leitura e reprocessamento do modelo enviado aproveitam texto digital nativo; OCR de páginas em imagem, limite de execução, autenticação e vínculo com a empresa preservados.
- Validação com o PDF fornecido e testes sintéticos, sem versionar documentos de clientes.

## [0.20.2] — 2026-10-14

- Redesign da navegação compartilhada com superfícies claras, cabeçalho compacto, grupos de trabalho e seleção em bordô.
- Rótulos Visão geral e Nova análise; nomes visíveis por padrão no primeiro acesso desktop, preservando a preferência de recolher existente.
- Atalho contextual para análise ou histórico conforme o acesso, com ocultação em telas baixas.
- Navegação responsiva, foco, tooltips, redução de movimento e isolamento do drawer móvel preservados.
- Regressões para expansão, preferências, teclado, perfil de visualização e larguras de 320/390/1440 px. Sem alteração fiscal ou de dados.

## [0.20.1] — 2026-10-09

- Alternativa OpenCNPJ para indisponibilidade da Minha Receita, com orçamento total de 12 segundos, validação de identidade e indicadores explícitos por provedor.
- Bloqueios, limites, Retry-After e divergência de identidade preservados; fontes e motivos de falha registrados sem dados de clientes nos logs.
- Diagnósticos agregados também no acompanhamento guiado e nos históricos, distinguindo consulta encerrada com pendências de confirmação completa.
- Nova consulta acessível no resumo, retomada automática para operadores e pedido idempotente que conserva linhas, totais, CFOP e DIFAL sem modificar snapshots anteriores.
- Fonte efetiva no resumo, CSV e PDF; testes de indisponibilidade, recuperação, limites, dados ausentes, isolamento, conciliação financeira e navegador.

## [0.20.0] — 2026-10-09

- DIFAL gerencial estimado em 10% para vendas de mercadorias a CPF de outra UF, com lista explícita de naturezas elegíveis.
- UF do emitente preservada no relatório e UF do destinatário importada da coluna J; ausência de dados indicada como pendência.
- Cálculo isolado, em centavos, compartilhado entre prévia e backend, reconciliado em relatórios e exportações.
- Exibição separada em prévia, resumos, linhas, CSV, PDF e contexto do simulador; sem alterar totais ou os demais impostos.
- Recálculo na prévia e em nova importação, reenvios idempotentes e histórico anterior preservado sem cálculo retroativo.
- Testes sintéticos de elegibilidade, arredondamento, recálculo, adulteração de valores, isolamento e navegador.

## [0.19.1] — 2026-10-09

- Consulta CNPJ com admissão coordenada por lote, menos operações no controle Mongo e persistência independente paralela.
- Padrão de 4 workers/300 ms, mantendo limite global compartilhado, timeout e orçamento de execução.
- Falhas pontuais não interrompem outros CNPJs; limitações/bloqueios/indisponibilidade HTTP preservam cooldown e Retry-After.
- Continuação sem pausa fixa quando há trabalho pronto; próxima tentativa futura respeitada sem polling vazio.
- Navegador reaproveita o job retornado, conserva o painel durante a leitura e usa acompanhamento resumido no fluxo guiado.
- Benchmarks sintéticos e regressões de concorrência, retry, isolamento, progresso e single-flight; sem cache fiscal ou alteração nos resultados financeiros.

## [0.19.0] — 2026-10-09

- Navbar compacta com trilho de ícones, expansão para rótulos e drawer móvel acessível; removidos o dock exagerado e seus efeitos de brilho.
- Busca, seleção de relatórios, importação e campos do simulador reorganizados com controles consistentes e indicação clara de seleção e valores.
- Formulários recuperáveis após rejeição definitiva da geração, mantendo identidade e payload em reenvios incertos.
- Compatibilidade de vendas legadas sem saldo explícito restaurada; percentuais conciliados com o arredondamento do PDF.
- Regressões de validação, histórico, teclado, menu, armazenamento indisponível e larguras de 320/390 px. Autenticação, regras fiscais, snapshots e isolamento preservados.

## [0.18.1] — 2026-10-08

- Navbar transformada em dock flutuante, com padding em relação às bordas, borda arredondada, sombra em camadas e ícones centralizados.
- Áreas dos ícones, item ativo e ação **Iniciar** refinados com novos estados de hover, foco, profundidade e contraste Maximum.
- Botão de recolhimento redesenhado com painel e chevron animados, tooltip, rótulo dinâmico e estado persistente no desktop.
- Drawer móvel recebe margem externa, overlay com desfoque e fechamento por overlay, link ou tecla Esc sem overflow horizontal.
- Teste visual cobre posição do dock, centralização, cantos, recolhimento, estados do botão e comportamento móvel.
- Regras fiscais, APIs, autenticação, permissões e contratos de importação permanecem inalterados.

## [0.18.0] — 2026-10-07

- Vendas passam a separar **Venda, Serviço, Devolução e Outras**, com resumo por operação e detalhamento no relatório.
- Natureza/CFOP normalizada sempre pelos **4 primeiros dígitos numéricos**; `900001` passa a `9000`, classificado como Serviço.
- Devoluções mantêm o valor original para auditoria, mas entram com sinal negativo no saldo líquido.
- KPIs por Simples/Não optante/CPF, simulador, CSV e PDF usam o saldo líquido das vendas, preservando a classificação fiscal original.
- Validação duplicada no navegador e servidor impede que natureza completa ou sinal enviado pelo cliente alterem o resultado.
- Compatibilidade mantida para históricos anteriores sem os novos campos.

## [0.17.0] — 2026-10-05

- Iniciar simplificado: busca por código/nome/CNPJ e seleção dos relatórios em diálogo; seleção múltipla preservada separadamente.
- Compras e vendas em cards centrais com reconhecimento do modelo e leitura/envio/consulta automáticos, sem etapa de conferência de colunas e valores.
- Resumos guiados só com KPIs; classificação detalhada, tabelas e downloads acessíveis no relatório completo. Continuação respeita os tipos e a empresa selecionados.
- Extrato opcional antes dos demais campos: PDF inicia OCR da seção 2.2 ao selecionar; alternativa manual exige RBT12 explícita e confirmação, com origem registrada e sem estimativas automáticas.
- Simulador preenchido com grupos e RBT12, mantendo dados complementares obrigatórios e criação explícita da simulação. Restauração de rascunho não cria novos snapshots.
- Validações, isolamento, reenvios, histórico, exclusão definitiva e fórmulas preservados; regressões de arquivos, fontes RBT12 e fluxo completo.

## [0.16.0] — 2026-10-05

- Botão vermelho **Excluir** na aba Histórico (gerações), separado do link do registro, e no detalhe da geração; botão de simulações também mais visível.
- Confirmação explícita **Excluir definitivamente**, com identificação do alvo e impacto, cancelamento, bloqueio de duplicatas e nova tentativa após falhas.
- Remoção física da geração e dos relatórios financeiros exclusivamente vinculados; clientes, dados CNPJ compartilhados, extratos e simulações independentes preservados.
- Exclusão de simulações passa de lógica para física. Recibos mínimos de auditoria impedem reutilização de IDs e permitem repetir a operação sem guardar os valores excluídos.
- Leases e guardas contra criação concorrente/reenvios evitam que a cascata repovoe dados removidos; autenticação, origem, papéis e workspace mantidos.
- Cobertura de MongoDB e navegador para remoção definitiva, corridas, isolamento, cancelamento, falha/retry, paginação e acesso às simulações preservadas.

## [0.15.0] — 2026-10-05

- Exclusão individual no histórico de simulações, com confirmação identificando empresa/cenário e opção de cancelar.
- Permissão limitada a administradores/operadores, com validação de sessão, origem, UUID e workspace no servidor.
- Exclusão lógica auditada, sem apagar relatórios, extratos ou outras versões; registros excluídos saem da listagem, contagem e leitura direta.
- Reenvios idempotentes não duplicam a exclusão nem ressuscitam o snapshot. Versões filhas indicam a origem excluída.
- Estado de envio, falha e nova tentativa no diálogo; filtros e paginação preservados após a exclusão.
- Testes de navegador e integração para cancelamento, erros, concorrência, permissões e isolamento.

## [0.14.0] — 2026-10-05

- Simulador com cabeçalho e resumo de projeção compactos; extrato/RBT12 no primeiro bloco e explicações de cálculo sob demanda.
- Campos e orientações encurtados, período automático recolhido e confirmação manual mantida visível.
- Seção 2.2 com PA/total resumidos, tabela recolhida e avisos de extração sempre visíveis.
- Comparação de regimes priorizada; gráficos, metodologia da DRE e dados capturados do histórico em detalhes expansíveis.
- Estado dos detalhes preservado ao salvar e alternar a apresentação dos resultados; navegação por teclado e responsividade conferidas com dados sintéticos.
- Fórmulas, OCR, validações fiscais, isolamento e versões históricas preservados.

## [0.13.2] — 2026-10-05

- Leitor web direcionado à identificação e à seção 2.2: encerra OCR após a próxima seção explícita e a validação dos dois mercados; processa continuações quando necessário.
- Páginas posteriores preservadas sem OCR. Metadados e histórico distinguem quantidade total, páginas processadas, preservadas e escopo pesquisável; interface não apresenta uma conversão parcial como integral.
- Correção do timeout em extrato de três páginas autorizado, com seção 2.2 inteira na primeira página. Resultado direcionado conferido contra a leitura integral e o documento; dados reais não versionados.
- Limites alinhados entre Python (180 s), navegador (285 s no POST do extrato) e Vercel (300 s); margem para transporte Blob e banco.
- Conversor local integral preservado. Testes de tabela dividida, conflitos posteriores, texto nativo adicional, confiança, meses ausentes, preservação das páginas e espera do navegador.

## [0.13.1] — 2026-10-05

- Corrigida assinatura Blob sem `access`, que gerava host de leitura inválido, e removidos casts que escondiam a incompatibilidade com o SDK.
- Upload usa a API oficial `https://vercel.com/api/blob/`; CSP e validador Python deixam de tratá-lo como leitura no host privado. Caminho, origem e parâmetros assinados continuam validados.
- Reprocessamento permite sobrescrever a cópia pesquisável, preservando o original, e diferencia falha de upload de falha de OCR na interface.
- PDF misto com corpo digitalizado e texto parcial no cabeçalho/rodapé passa por OCR para não ignorar a imagem da seção 2.2.
- Datas completas de emissão em rodapés não são tratadas como competências; páginas vazias não inicializam o OCR e respostas incompletas do motor são rejeitadas.
- Lockfile Node completo e regressões de assinatura real, URLs, HTTP/Blob, PDF misto, isolamento e navegador.
- Ambiente Vercel conectado ao Blob privado do projeto; configuração de armazenamento que estava ausente passa a ser injetada no próximo deploy.
- Versão 0.13.1; valores fiscais, autenticação e resultados históricos preservados.

## [0.13.0] — 2026-10-02

- Extratos do Simples passam a ser armazenados em Vercel Private Blob antes do OCR, com original e versão pesquisável separados.
- Upload direto do navegador por URL assinada; credencial do store não é exposta ao cliente.
- Python recupera somente o objeto autorizado, processa OCR/seção 2.2 e grava o PDF pesquisável por URL temporária específica.
- MongoDB mantém metadados/status/hashes/vínculos, sem armazenar PDF ou texto OCR integral.
- Reprocessamento usa o original persistido, sem exigir novo upload após falha do OCR.
- Visualização autenticada de original/pesquisável e estados AWAITING_UPLOAD, PROCESSING, READY e OCR_FAILED.
- Limite do fluxo Blob elevado a 8 MiB; fluxo direto antigo de 4 MiB preservado apenas para compatibilidade.
- Versão 0.13.0; RBT12, DRE e regras fiscais da seção 2.2 permanecem inalteradas.


## [0.12.2] — 2026-10-01

- Corrigida a falha 503 em PDFs somente imagem na Vercel: o runtime importava OpenCV desktop e falhava por ausência de `libxcb.so.1` antes do OCR.
- Dependências Python migradas para `pyproject.toml`/uv; `opencv-python` transitivo é excluído e substituído por `opencv-python-headless`, mantendo o pacote da função abaixo do limite da Vercel.
- CI passa a resolver o mesmo ambiente headless, instanciar RapidOCR e executar a regressão real de PDF-imagem.
- Mensagem genérica de PDF ilegível não mascara mais falhas de inicialização do OCR; detalhes técnicos ficam somente nos logs.
- Mantidas RBT12 exclusiva da seção 2.2, validação das 12 competências, DRE janeiro–dezembro, históricos e fórmulas existentes.


## [0.12.1] — 2026-10-01

- OCR integral em páginas de imagem e conversão para PDF pesquisável, com processamento de todas as páginas e limites explícitos sem truncamento.
- RBT12 exclusiva da seção 2.2: 12 competências anteriores ao PA, mercados interno e externo; rejeição de ausência, conflito e OCR numérico de baixa confiança, sem fallback para 2.1, DAS ou estimativa.
- Novas simulações exigem extrato validado e vínculo por empresa/workspace; reconciliação das 12 linhas no servidor. Campo não editável e reidratação autenticada dos rascunhos.
- DRE mensal janeiro–dezembro + total anual, seletor de regime, Indicador fixo e RBT12 fixa identificada pelo PA. Ano do cenário e período dos relatórios exibidos separadamente.
- Snapshots anteriores preservados sem recalcular; memória mensal versionada nas novas simulações. Fórmulas tributárias e projeção pela média dos relatórios mantidas.
- Conversor Python local com saídas PDF/TXT/JSON; nenhum PDF original, OCR integral ou base64 é persistido no banco.
- Testes de OCR real com PDF imagem sintético, seção 2.2, autenticação, valores e calendário. Sem dados reais de contribuintes no repositório.


## [0.12.0] — 2026-10-01

- Projeção explícita e permanente: total importado ÷ competências (1–12) × 12, em todos os cinco grupos de compras/vendas.
- Regra compartilhada em centavos inteiros entre navegador e servidor, arredondamento conciliado entre grupos e horizonte fixo de 12 meses, nunca N + 12.
- Memória `AVERAGE_X12_V1` salva pelo servidor com totais, divisor, médias, projeções e cenário mensal editado separado da base original.
- Redesign com três cartões de cálculo, alternância Compras/Vendas, 12 meses iguais, tabela de conferência por grupo, seções e responsividade.
- Serviços e despesas permanecem mensais, multiplicados por 12 uma vez; RBT12 manual/PDF permanece independente da projeção.
- Históricos não recalculados; rascunho com divisor diferente não sobrescreve médias automáticas atuais.
- Conservadas a comparação mensal da coluna H e a consulta concorrente da v0.11.1; revalidação financeira mantém o período original.
- Testes de precisão, contratos, integração MongoDB, histórico e navegador adicionados. Atualizados testes antigos de rotas Python, fixtures com coluna H e detalhes da RBT12, sem relaxar autenticação ou conciliação.


## [0.12.0] — correção de competências em 2026-10-01

- Corrigido o bloqueio do simulador quando compras e vendas possuem primeiros/últimos lançamentos em dias diferentes dentro dos mesmos meses.
- Comparação passa a utilizar mês/ano inicial e final e quantidade inclusiva de competências, com validação de intervalo entre 1 e 12 meses.
- Abril a agosto de 2026 é aceito como cinco competências nos dois arquivos, inclusive quando um começa no dia 02/04 e outro no dia 01/04.
- Meses sem movimento dentro do intervalo não reduzem o divisor. Meses/anos realmente diferentes continuam bloqueados, mesmo com a mesma duração.
- Datas originais da coluna H preservadas, sem normalização destrutiva para o primeiro/último dia do mês. Conciliação individual do snapshot continua exata.
- Mensagem de erro e aviso do simulador esclarecem a regra mensal. Fórmulas, valores, Simples/CPF, RBT12, permissões e históricos não foram alterados.
- Seis testes unitários e integração com MongoDB descartável adicionados: caso informado, dias finais diferentes, um mês, virada de ano, divergências reais, integridade e isolamento.
- Correção aplicada à branch de período/RBT12, sem substituir a linha de consultas da main. Versão de aplicação 0.12.0 e dependências mantidas.

## Entrega inicial [0.12.0] e versões anteriores

O histórico integral anterior foi preservado em [CHANGELOG v0.12.0 inicial](CHANGELOG-v0.12.0-inicial.md). A exigência antiga de dias idênticos na comparação entre compras e vendas foi substituída pela regra de competências desta correção.
