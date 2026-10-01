# Validação da leitura e classificação — v0.11.1

Verificação executada em **01/10/2026**, antes da integração do PR #2 na branch principal.

- Código verificado: `631f9a139c7070e6eb208bd26e418967fd46818b`.
- Integração na main: `2d819ecd843d4f04f2341deedc607c929ced904a`.
- Execução GitHub Actions aprovada: [Verificação Maximum CNPJ #45](https://github.com/devarrthurferreira/maximumCNPJ/actions/runs/36876732152).

## Etapas aprovadas

| Verificação | Resultado |
| --- | --- |
| Versões e documentação | Aprovado |
| TypeScript e build | Aprovado |
| Regras unitárias e HTTP | Aprovado |
| Integração legada com MongoDB descartável | Aprovado |
| Consultas com API simulada e compartilhamento de registros | Aprovado |
| Compras, vendas, valores financeiros e isolamento | Aprovado |
| Gerações, retomada e isolamento | Aprovado |
| Simulações salvas e reprodução | Aprovado |
| Python, PDF e MongoDB descartável | Aprovado |
| Navegador, CSV e XLSX | Aprovado |

Os nove testes unitários novos também foram executados localmente e aprovados. Os testes da nova consulta cobrem flags explícitas, CNPJ com máscara, rejeição de CPF/inválidos, falhas e limites da fonte, concorrência limitada, distinção de pendências e preservação dos snapshots financeiros.

## Limites da validação

A integração usa transporte simulado e bases descartáveis. Nenhuma carteira real foi utilizada para medir velocidade ou cobertura fiscal. Não se atribui a estes testes uma garantia de disponibilidade ou atualização da API Minha Receita. A situação desconhecida continua preservada como tal na origem, mesmo quando incluída no grupo gerencial Não optante.

O preview Vercel do código verificado concluiu o build com estado READY; a rota de saúde retornou HTTP 200 e versão 0.11.1. Isso não substitui a verificação do domínio de produção após a publicação.

Consulte o [README atual](../README.md) para operação, regras preservadas e configuração opcional de concorrência.
