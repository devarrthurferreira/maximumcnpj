# Desenvolvimento do Maximum CNPJ

Leia README, CHANGELOG e o estado real do repositório antes de alterar código. Escopo vigente v0.3.0: básico, Node.js + MongoDB, sem consulta fiscal externa automática. Planos anteriores são históricos.

## Cada entrega
1. Atualize README e CHANGELOG junto com a mudança; mantenha versão coerente em package.json e src/domain.ts.
2. Confira a branch antes de publicar e preserve alterações concorrentes. Não faça force-push.
3. Execute tipos, build, regras, integração e navegador quando possível. Registre falhas e testes ignorados sem chamá-los de aprovados.
4. Não versione .env real, URI privada, credenciais ou senha de produção. Não crie senha pública padrão.

## Invariantes
- A responsável pela base é escolhida explicitamente.
- CNPJ completo é texto; não deduplicar pela raiz nem preencher zeros perdidos por hipótese.
- Todas as linhas são preservadas; repetições e inválidos não inflam indicadores.
- A coluna de enquadramento é opcional. Ausência, desconhecimento ou conflito não é resposta negativa.
- Dados de planilha são declarações, não consultas oficiais. Não apresentar preenchimento como verificação fiscal.
- Resultados parciais não entram no dashboard; histórico antigo não é apagado.
- Processamento local usa páginas, checkpoint e chaves idempotentes. Não envia CNPJs a provedor externo.
- Não reintroduzir Google, API paga, scraping ou automação fiscal sem nova definição explícita do responsável.
- Não habilitar cálculos tributários fictícios; regras precisam de fontes e homologação próprias.

## Próxima prioridade
Validar build/lockfile, MongoDB e E2E; depois testar uma base real autorizada. Evoluir campos e filtros com base no uso antes de acrescentar integrações.
