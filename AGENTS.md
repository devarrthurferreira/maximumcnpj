# Desenvolvimento do Maximum CNPJ

Leia README.md, CHANGELOG.md e o estado real do repositório antes de iniciar cada alteração. O plano v0.1.0 é histórico; o escopo vigente usa MongoDB.

## Compromissos de cada entrega

1. Atualize README e CHANGELOG no mesmo commit/PR de toda mudança relevante. Registre funcionamento, configurações, testes executados, limitações, progresso e próximo passo.
2. Mantenha a versão consistente em package.json, src/domain.ts, README e CHANGELOG. Use commits descritivos e preserve o histórico.
3. Execute check:release, check, build, test, test:integration e test:e2e quando o ambiente permitir. Informe explicitamente o que não foi executado. Não invente sucesso de CI, fonte real ou deploy.
4. Não faça force-push nem sobrescreva alterações concorrentes. Confira a branch antes de publicar.
5. Nunca adicione senha padrão, tokens, arquivos .env reais ou credenciais JSON ao repositório.

## Invariantes do produto

- Cada importação pertence a uma carteira escolhida pelo usuário.
- CNPJ é STRING canônica de 14 caracteres, incluindo formato alfanumérico; não deduplicar pelo CNPJ básico.
- Repetições permanecem nas linhas/exportações, mas não inflam indicadores.
- Inválidos, ausentes, desconhecidos, conflitos e falhas não significam não optante.
- Resultados parciais não entram no dashboard. Conferir identidades, quantidade e lote concluído.
- Indicadores globais usam a última observação por identidade, não a soma dos lotes.
- Fonte, referência fiscal e data técnica são informações diferentes.
- Demonstração deve permanecer identificada e isolada de consultas reais.
- Jobs precisam de estimativa, teto de bytes, confirmação e ID idempotente.
- Não substituir uma fonte por API paga, scraping ou contorno de CAPTCHA sem aprovação e documentação.
- A calculadora tributária fica bloqueada até existir engine e homologação fiscal com regras versionadas.

## Evolução imediata

Primeiro estabilize testes, lockfile e fonte real. Depois avance para comparação individual de snapshots, filas, governança e calculadora. Não crie telas que aparentem uma funcionalidade fiscal pronta quando ela é apenas planejamento.
