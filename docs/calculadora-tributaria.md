# Calculadora tributária · contrato proposto

**Planejamento, não implementação fiscal.** A v0.2.0 só prepara carteiras, CNPJs, snapshots e rastreabilidade. Nenhuma alíquota ou regra de transição tributária está habilitada.

## Dados propostos para uma simulação futura

- Identidade da empresa, competência, responsável e finalidade da simulação.
- Receitas e segregações relevantes, folha e demais parâmetros necessários à regra aplicável.
- Conjunto de regras identificado por versão, vigência, jurisdição, fontes normativas e aprovador.
- Saída com valores, arredondamentos, memória de cálculo, avisos, hipóteses e parâmetros reproduzíveis.

Exemplo **estrutural**, deliberadamente sem taxas ou resultados:

```json
{
  "simulationId": "identificador",
  "cnpj": "CNPJ_CANONICO",
  "competence": "YYYY-MM",
  "ruleset": {
    "id": "a-definir",
    "version": "rascunho",
    "effectiveFrom": null,
    "effectiveTo": null,
    "normativeSources": [],
    "approvedBy": null,
    "approvedAt": null
  },
  "inputs": {},
  "outputs": null,
  "status": "NOT_IMPLEMENTED"
}
```

## Critérios antes da ativação

Definir o escopo fiscal com profissional responsável; pesquisar as fontes oficiais vigentes; documentar hipóteses e exceções; revisar segregações, competências, arredondamentos e regras de transição; criar testes para limites e mudanças de vigência; comparar com cálculos de referência; exigir aprovação do conjunto de regras; separar simulação de apuração/declaração oficial.

Alterações normativas devem produzir uma nova versão de regras, não modificar silenciosamente o significado de simulações já salvas. Um CNPJ optante não fornece sozinho todas as informações necessárias a uma apuração correta. Não inferir taxas pelo nome da empresa ou por um resultado de enquadramento.
