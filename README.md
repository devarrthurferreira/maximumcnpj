# Maximum CNPJ · v0.13.2

Node.js 22 + TypeScript + MongoDB. Relatórios e leitura do Extrato do Simples em Python. Identidade Maximum, autenticação, permissões e isolamento por workspace preservados. Sem Google Cloud.

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

A regra aplica-se a todos os cinco grupos: vendas optantes, vendas não optantes/não confirmadas, vendas CPF, compras do Simples e compras fora do Simples. Vale para qualquer intervalo de **1 a 12 competências**. O simulador usa os totais conciliados pelo servidor; resultados financeiros enviados pelo navegador não substituem a origem.

### Competências, não dias com movimento

A coluna H (Data Escrituração/Serviço) determina o mês/ano inicial e final. Compras iniciadas em 02/04 e vendas iniciadas em 01/04 são compatíveis quando terminam no mesmo mês/ano. Meses internos sem lançamentos continuam no divisor. A ausência de uma competência nas extremidades não é inferida: arquivos de abril–agosto e maio–agosto continuam diferentes.

Cada relatório mantém suas datas originais. Sua conferência individual contra o snapshot é exata; somente a comparação entre relatórios distintos é mensal. Snapshots antigos sem coluna H permanecem utilizáveis mediante indicação/confirmação manual de 1 a 12 meses. A quantidade automática não pode ser alterada no navegador para salvar uma simulação com outro divisor.

### Precisão e memória da projeção

A regra compartilhada `public/simulator-projection.js` é usada pelo navegador e pelo Node. Calcula em centavos inteiros com BigInt e valida limites seguros. A média total de cada lado é arredondada em centavos; os centavos residuais são distribuídos entre seus grupos pelo maior resto, com desempate determinístico. Assim, os grupos fecham o total mensal. A projeção anual repete **essa média arredondada** 12 vezes, podendo diferir alguns centavos da divisão sem arredondamento intermediário.

A API do pré-preenchimento retorna `projection` quando há período automático. Cada nova simulação salva a versão `AVERAGE_X12_V1`, os totais importados, o divisor, as cinco médias, os valores anualizados e 12 meses projetados iguais. O servidor gera essa memória; o cliente não pode fornecer uma projeção arbitrária.

**A base importada e o cenário editado são separados.** Os cinco campos continuam editáveis. A conferência superior mantém a média original, sinaliza a edição e os resultados usam os valores mensais efetivamente informados. O histórico guarda `projection.scenario`, os ajustes e a base original. Reabrir um cenário não consulta novamente os CNPJs nem recalcula os resultados fiscais. Nos históricos sem a nova memória, a interface apresenta uma conferência derivada dos totais salvos, identificada como tal.

Serviços, salários, benefícios, despesas administrativas, aluguel e taxas de cartão são informados **por mês**, portanto não são divididos pelo número de meses dos arquivos e entram no cenário anual multiplicados por 12 uma única vez. As fórmulas tributárias existentes não foram alteradas nesta entrega.

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
