# Histórico de alterações

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
