# Histórico de alterações

Cada entrada descreve uma entrega, não uma promessa de homologação fiscal.

## [0.2.0] — 2026-09-24

### Adicionado
- Interface própria clara, navegação recolhível, cartões e distribuição de enquadramento.
- Login, sessão persistida, perfis, criação de acessos e redefinição obrigatória de senha.
- Cadastro e edição de carteiras, responsável obrigatório na importação e filtro global.
- Importação CSV/XLSX em Worker, escolha de aba/colunas, revisão e upload em partes.
- CNPJ numérico e alfanumérico, deduplicação por identidade completa e preservação das linhas.
- Adaptador BigQuery: inspeção de schema, estimativa, teto, confirmação, ID reaproveitável e paginação.
- Persistência MongoDB para carteiras, lotes, linhas, checkpoints, observações e auditoria.
- Indicadores pela última observação de cada CNPJ, sem somar reimportações.
- Resultados pesquisáveis, exportação CSV/XLSX e histórico de snapshots.
- Demonstração identificada e isolada de consultas reais.
- Tela de planejamento da calculadora tributária, sem engine ou regras fiscais ativas.
- 17 testes locais de regras, transporte simulado, segurança e HTTP aprovados.
- Testes de integração com MongoDB e navegação CSV/XLSX preparados para CI.
- Documentação de arquitetura, roadmap, segurança, configuração, limites e critérios de aceite.
- Adaptador de implantação Vercel, ainda não publicado/homologado.

### Alterado
- O escopo sem banco da v0.1.0 evoluiu para MongoDB por causa do histórico e do gerenciamento de carteiras.
- README original preservado em `docs/planejamento-v0.1.0.md`.

### Publicação e verificação
- Código-fonte, documentação, configurações e testes reunidos no primeiro commit funcional da v0.2.0, após nova solicitação de publicação do responsável.
- A tentativa anterior foi interrompida antes de publicar um commit; objetos preparatórios não eram uma entrega na branch.
- Reexecutados localmente em 24/09/2026: `npm test` (17 aprovados, 0 falhas), `npm run check:release` e verificações de sintaxe de `public/app.js` e `public/import-worker.js`.
- O resultado da CI deve ser conferido na execução associada ao SHA publicado; testes locais não representam homologação completa.
- As quatro capturas PNG de demonstração e o manifesto SHA256 do pacote original continuam disponíveis no ZIP entregue, mas não integram o código-fonte deste commit.

### Limitações / validações pendentes
- Acesso autenticado à fonte pública, codificação dos campos e lote real >10.000 ainda não homologados.
- Build completo, MongoDB e browser contra servidor dependem da execução da CI e do ambiente configurado.
- Lockfile ainda depende de uma instalação completa validada.
- Não há processamento autônomo de páginas sem um operador acompanhando o lote, alertas, motor tributário ou implantação pública.

## [0.1.0] — 2026-09-24

- Planejamento inicial da consulta em lote com OpenCNPJ e BigQuery, sem persistência própria.
- Regras para não transformar ausência/falha em não optante e para manter documentação atualizada.
