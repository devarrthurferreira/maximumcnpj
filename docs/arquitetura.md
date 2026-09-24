# ADR-001 · Persistência e consulta em lote

Status: adotada no código v0.2.0, em homologação. Data: 24/09/2026.

## Contexto

O planejamento inicial dispensava banco próprio. O usuário passou a solicitar carteiras, histórico, indicadores sem duplicidade e preparação para futura calculadora. Sem persistência, não seria possível reabrir lotes e reconstruir observações com segurança.

## Decisão

Usar MongoDB para a aplicação e BigQuery para o cruzamento externo. Não espelhar a base completa da Receita no banco da aplicação. Arquivos são lidos no browser, e as linhas confirmadas são transmitidas em partes. O arquivo binário original não é armazenado nesta etapa.

Separar responsável pela base (carteira), documento importado (linha), identidade (CNPJ canônico), lote (execução) e observação (resposta datada). Cada resultado é único por lote/CNPJ. O snapshot de um lote concluído é preservado, e o painel global calcula a última observação por CNPJ completo.

Um workspace por instalação é configurado no servidor. Usuários compartilham as carteiras desse workspace conforme o papel; não existe propriedade privada de carteira por usuário. Toda consulta usa filtro de workspace.

## Confiabilidade

Upload em partes com hash, índice e reenvio seguro; leases para mutações concorrentes; job ID persistido antes da chamada externa; upsert de resultados por identidade; checkpoint de página; conferência de cardinalidade e pertencimento antes de publicar. O dashboard cruza as observações com o estado COMPLETED do lote para não publicar páginas parciais.

Não dependemos de uma promessa de execução após a resposta de uma função serverless. O BigQuery executa o SQL, mas um operador deve abrir/atualizar o lote para a aplicação receber páginas e publicar o resultado. Fila autônoma é evolução separada.

## Consequências e riscos

Há custo e responsabilidade de armazenamento, retenção e backup. O escopo v0.1.0 sem banco foi superado por necessidade explícita do produto. Ainda não há exclusão definitiva pela interface nem retomada do arquivo entre sessões. A coleção de resultados pode crescer com os snapshots; medir agregações e criar materializações/índices adicionais conforme volume real, preservando semântica de última observação.

Não utilizar a conexão MongoDB ou a tabela BigQuery em teste sintético como prova de homologação fiscal. Fonte, acesso e carga real precisam de evidência própria antes de produção.
