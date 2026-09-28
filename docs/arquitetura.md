# Arquitetura vigente · v0.4.0

Navegador (HTML/JS + Worker CSV/XLSX) → API Node.js/TypeScript → MongoDB.
A API também consulta o endpoint público Minha Receita, com documento válido, timeout, pausas e limite global. Não usa Google Cloud.

## Separação dos dados

clients representa a responsável identificada por Código/ID da exportação S3D. Não confundir com os fornecedores/clientes consultados dentro de uma planilha.

cnpjEntities é o cadastro compartilhado por workspace/CNPJ. cnpjStates conserva conteúdo mínimo imutável por fingerprint. lookupItems vincula uma verificação ao lote, CNPJ, nome informado, data da chamada e referência do estado. lookupJobs contém responsável, arquivo, datas e totais.

Não se usa cache como nova consulta. Cada lote distinto verifica novamente a fonte; respostas iguais reutilizam estado no banco. Os percentuais consideram somente lotes completos e a última observação por identidade, nunca a soma de reimportações.

## Compatibilidade

As coleções e APIs das importações declaradas anteriores permanecem, com interface /legacy.html. Não há migração destrutiva nem conversão de declarações em consultas externas. A nova interface usa /api/v4 e session pública sem retirar proteção de endpoints privados.

## Limites

Leases por lote e por fonte no MongoDB, upload compacto, staging temporário com TTL, CNPJs únicos, até três tentativas transitórias e Retry-After. Processamento é conduzido pela tela; fila autônoma é etapa futura.

Dados de sócios, telefones, endereços, honorários e arquivo binário não são persistidos no fluxo novo. ConsultadoEm não é atualização fiscal. A referência não homologada é indicada como Não informada.
