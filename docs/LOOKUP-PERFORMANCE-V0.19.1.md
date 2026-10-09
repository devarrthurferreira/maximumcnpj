# Desempenho das consultas CNPJ · v0.19.1

## Resultado medido

Comparação com a v0.19.0 (`ce3024b7039795ffc9e92d1296b74251d6ecca8e`), em Node 22.16.0 e MongoDB 7 local. Cada rodada consulta 30 CNPJs sintéticos distintos, com resposta simulada de 500 ms por CNPJ. São duas rodadas por cenário, com a preparação do lote fora da medição. O tempo inclui processamento, persistência, conciliação final e as pausas entre lotes solicitadas pelo servidor.

| Latência adicional por comando Mongo | Antes, 3 workers / 500 ms | Depois, 3 workers / 500 ms | Depois, novo padrão 4 workers / 300 ms | Redução do tempo com novo padrão |
| --- | ---: | ---: | ---: | ---: |
| 0 ms | 16,12 s | 15,18 s | 9,35 s | 42,0% |
| 40 ms | 19,95 s | 18,83 s | 13,21 s | 33,8% |

Os valores são médias. Tempos individuais, em segundos:

| Cenário | Rodada 1 | Rodada 2 |
| --- | ---: | ---: |
| Antes · 0 ms | 16,138 | 16,105 |
| Depois, mesma política · 0 ms | 15,199 | 15,167 |
| Depois, novo padrão · 0 ms | 9,360 | 9,330 |
| Antes · 40 ms | 19,950 | 19,955 |
| Depois, mesma política · 40 ms | 18,858 | 18,808 |
| Depois, novo padrão · 40 ms | 13,225 | 13,200 |

Mantendo a política antiga, os comandos Mongo caíram de **464 para 236 por rodada**, redução de **49,1%**. Os comandos do controle compartilhado da fonte caíram de 324 para 94. Com o novo padrão, o cenário sem latência adicional terminou em um lote e usou 224 comandos; o cenário com 40 ms usou dois lotes e 236 comandos.

Em todas as rodadas, houve exatamente 30 chamadas à fonte simulada, 30 CNPJs distintos e 30 resultados concluídos e conciliados. O ganho de tempo combina a remoção de esperas com o novo intervalo padrão; a comparação com a mesma política separa esse efeito da redução de trabalho no banco.

**Isto é um benchmark sintético, não uma medição em produção.** Os 40 ms são adicionados ao redor de cada comando real do driver (20 ms antes e 20 ms depois). A Minha Receita não recebe chamadas do benchmark. Latência da fonte, indisponibilidade, limites, volume, outros lotes ativos e distância do banco afetam o tempo real. Leitura do arquivo, rede navegador/servidor, polling de progresso e geração de PDF não integram esses tempos.

## Alterações

- A entrada dos workers de cada lote é coordenada antes de disputar o banco. Toda consulta continua exigindo um slot Mongo e admissão pelo intervalo global, inclusive entre usuários, workspaces e lotes que compartilham o banco.
- O relógio da admissão é atualizado após reservar o slot. A liberação identifica o slot e seu dono, sem varrer todos os slots do worker.
- Gravação do estado CNPJ e criação da entidade ocorrem em paralelo. Ambos os caminhos terminam antes de atualizar a referência da entidade e concluir o item. Uma falha drena as gravações em andamento antes de liberar o lote.
- Falha pontual de rede ou resposta inválida agenda a nova tentativa do CNPJ afetado. HTTP 429, bloqueios e erros HTTP da fonte mantêm a pausa global; `Retry-After` continua obrigatório mesmo se o item esgotou suas tentativas.
- A próxima chamada espera o prazo real do controle global e das tentativas futuras. Quando há trabalho pronto, não existe a antiga pausa fixa de um segundo. Uma fila somente com tentativas futuras não inicializa nem disputa slots.
- A interface reaproveita a resposta do processamento, atualiza contadores durante o lote e mantém o painel montado. O fluxo guiado lê somente métricas, sem buscar as linhas da tabela que não apresenta.

## Configuração e invariantes

O padrão é `LOOKUP_CONCURRENCY=4` e `LOOKUP_INTERVAL_MS=300`. Configurações explícitas do ambiente continuam prevalecendo: se um deployment já fixa `3` e `500`, ele mantém esses limites até que sejam alterados. Os intervalos configuráveis permanecem de 1 a 4 workers e de 300 a 10000 ms.

Timeout da fonte de 12 s, orçamento do lote de 24 s e limite de 40 itens por chamada são preservados. Não há migração nem cache que substitua a fonte em novas consultas. CPF/CNO/documentos inválidos continuam fora da API; erros continuam `NAO_CONFIRMADO`. Autenticação, isolamento, vínculos históricos, cálculos financeiros e bloqueio de snapshots incompletos permanecem obrigatórios.

## Reprodução

Com dependências instaladas, Node 22 e um MongoDB local descartável em execução:

```sh
MONGODB_URI=mongodb://127.0.0.1:27017 npm run benchmark:lookups
MONGODB_URI=mongodb://127.0.0.1:27017 BENCH_CONCURRENCY=3 BENCH_INTERVAL_MS=500 npm run benchmark:lookups
```

O runner `scripts/benchmark-lookups.mjs` só aceita MongoDB em loopback, sem credenciais ou caminho de banco. Cria um banco com UUID exclusivo, confirma o nome antes da limpeza e bloqueia chamadas HTTP externas. Não usa o banco configurado em `MONGODB_DB`.

`BENCH_REPO` pode apontar para um checkout da revisão anterior com suas dependências instaladas. `BENCH_OUTPUT` salva os resultados em JSON. O cabeçalho do script documenta os limites de quantidade, latência, repetições e política. Os resultados incluem hash do engine, chamadas à fonte, pico de concorrência, espaçamento entre chamadas e comandos Mongo por coleção.

## Verificação

- `check:release`, `check`, `build` e 133 testes Node aprovados.
- Integrações em MongoDB descartável aprovadas: bootstrap/equipe, consultas, compras/vendas, gerações/competências, simulações e projeções.
- 76 testes Python/PDF aprovados, com Mongo e OCR habilitados, sem skips.
- 62 testes de navegador aprovados. As novas regressões verificam reaproveitamento da resposta, continuação com espera zero, cooldown de 60 s, pausa, ausência de chamadas simultâneas, progresso durante uma chamada pendente e perfil de leitura sem processamento.
- As regressões do engine verificam concorrência global entre lotes, 429 com outra consulta em andamento, tentativas futuras, falha de persistência, nova consulta após retomada e contagens do acompanhamento resumido.
- Revisão independente do diff concluída sem achados bloqueantes.
