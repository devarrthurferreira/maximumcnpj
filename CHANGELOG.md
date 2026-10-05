# Histórico de alterações

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
