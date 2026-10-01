# Histórico de alterações

## [0.11.1] — 2026-10-01

- Motor de consultas com concorrência limitada e intervalo global no MongoDB; até 3 requisições simultâneas por padrão, fila de candidatos em blocos e drenagem antes de liberar a exclusão do lote.
- Mantida a distinção estrita entre OPTANTE, NAO_OPTANTE e NAO_CONFIRMADO. CNPJ com máscara na resposta é aceito somente se corresponder à identidade completa validada.
- Indicador ausente/conflitante recebe nova tentativa; erros transitórios têm repetição limitada. Pausas Retry-After compartilhadas e estados pendentes nunca viram negativas fiscais.
- Progresso parcial autenticado e paginado em consultas, compras e vendas, com filtros por situação original e motivos legíveis. A confirmação negativa é exibida separadamente das falhas, sem mudar os grupos financeiros finais.
- Revalidação em novo lote, inclusive para linhas financeiras já reconciliadas, preservando valores, fórmula e histórico. A nova consulta financeira é independente e não sobrescreve gerações/simulações anteriores.
- Inserções compartilhadas toleram corridas de unicidade da mesma identidade, sem esconder divergências. Atualização do cadastro não regride a data da última verificação.
- Inclusão de testes unitários, MongoDB descartável e navegador para concorrência, classificação, limites, isolamento, valores financeiros, dados parciais e responsividade.
- README e histórico anteriores preservados integralmente no arquivo de documentação. Versões Node/Python/lockfile alinhadas; dependências e regras do simulador mantidas.

## [0.11.0] e anteriores

O histórico integral até 30/09/2026 foi preservado, sem alteração, em [CHANGELOG v0.11.0](CHANGELOG-v0.11.0.md). A documentação operacional anterior está em [README v0.11.0](README-v0.11.0.md).
