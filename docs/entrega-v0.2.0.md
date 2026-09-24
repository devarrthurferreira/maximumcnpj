# Entrega v0.2.0 · 24/09/2026

## Conteúdo do commit

Código-fonte Node.js/TypeScript, interface web, persistência MongoDB, adaptador BigQuery, testes, configuração de implantação, README, CHANGELOG, regras de desenvolvimento e planejamento da calculadora.

## Histórico de publicação

A preparação anterior foi entregue em ZIP porque a gravação final foi bloqueada pela ferramenta. Nenhum commit havia sido publicado naquela tentativa. Após nova solicitação explícita do responsável, a publicação foi retomada pelo conector GitHub autorizado, preservando como ancestral o commit anterior da branch `main` e sem force-push.

Esta revisão reúne código-fonte e documentação no mesmo commit. O SHA efetivo e o estado da branch devem ser conferidos no histórico do repositório; uma árvore Git preparatória, isoladamente, não confirma publicação. A execução da CI e o deploy são verificações separadas.

## Verificação local reexecutada antes da publicação

- `npm test`: 17 aprovados, 0 falhas, 0 ignorados.
- `npm run check:release`: aprovado.
- `node --check public/app.js` e `node --check public/import-worker.js`: aprovados.
- Os testes incluem 10.001 e 50.000 CNPJs sintéticos no domínio; não representam carga real do BigQuery.
- Nenhum `.env` real, credencial privada ou dependência instalada integra o código versionado.

## Evidências da preparação anterior

O pacote original inclui um relatório de testes locais e uma inspeção Chromium offline: oito áreas, revisão CSV com contadores 4/2/1/1, resultados e largura móvel de 390 px sem transbordamento horizontal; nenhum erro JavaScript observado naquela inspeção. O navegador offline usou um ambiente isolado com adaptações para demonstração, URLs de módulos e ausência de armazenamento local. Não houve conexão a dados reais.

As capturas `dashboard.png`, `importacao.png`, `resultados.png` e `mobile.png`, assim como o manifesto `SHA256SUMS.txt`, pertencem ao ZIP original entregue na conversa. São materiais suplementares de demonstração e não integram este commit de código-fonte. Não usar o manifesto do ZIP para conferir a documentação atualizada do repositório.

## Validações pendentes

Instalação completa das dependências, build completo, integração com MongoDB, testes de XLSX e de navegação contra servidor, consulta autenticada ao BigQuery, lote real de mais de 10 mil documentos e implantação em produção. Conferir a execução da workflow no SHA publicado antes de atualizar esses estados. O lockfile depende de uma instalação validada.

A consulta real permanece bloqueada até configuração e aprovação explícita da fonte. A calculadora tributária é uma etapa futura: nenhum cálculo fiscal é implementado nesta versão.
