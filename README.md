# Maximum CNPJ · v0.12.0

Node.js + TypeScript + MongoDB para consultas e histórico. Python para PDFs e leitura de Extrato do Simples Nacional. Identidade Maximum, acesso autenticado e isolamento por workspace. Sem Google Cloud.

## Correção de 01/10/2026 — períodos comparados por competência

**Compras e vendas são comparadas pelo mês/ano inicial e final da coluna H, e não pelo dia do primeiro ou do último lançamento.** A falta de compras ou vendas em um dia não representa uma competência diferente.

Exemplo aceito:

| Relatório | Datas efetivamente observadas na coluna H | Competências consideradas |
| --- | --- | --- |
| Compras | 02/04/2026 a 31/08/2026 | 04/2026 a 08/2026 |
| Vendas | 01/04/2026 a 31/08/2026 | 04/2026 a 08/2026 |

Os dois arquivos representam **5 competências**: abril, maio, junho, julho e agosto. Diferenças nos dias iniciais e finais são permitidas quando permanecem nos mesmos meses/anos. Meses internos sem lançamentos continuam incluídos no divisor; não é necessário ter movimento todos os dias nem em todos os meses intermediários.

Um arquivo de abril a agosto e outro de maio a agosto continuam incompatíveis. Intervalos de igual duração, mas com meses ou anos diferentes, também não são confundidos. Continua permitido o intervalo inclusivo de 1 a 12 meses, inclusive quando atravessa a virada do ano.

### Dados originais e conciliação

Esta alteração afeta somente a comparação entre dois relatórios distintos. **Cada relatório continua conciliado individualmente contra as suas datas e valores originais no MongoDB.** A função de conferência exata do snapshot não foi flexibilizada: editar a data persistida sem correspondência nas linhas continua bloqueando a emissão.

As datas da coluna H não são substituídas por dia 1 ou pelo último dia do mês. O simulador conserva o período original de compras em `purchases.period` e o original de vendas em `sales.period`; o intervalo mensal comum determina `reportMonths`. O aviso do simulador explica que os dias sem movimento não alteram as competências.

Não há alteração da fórmula **Q − Y + AA − AB**, da classificação do Simples, do grupo CPF nas vendas, da RBT12, dos totais importados, das permissões ou dos cenários já salvos. Não há migração destrutiva nem nova variável de ambiente.

### Como utilizar

Após a atualização da versão com leitura da coluna H, reabra a geração pelo histórico e clique novamente em **Ir para o simulador**. Relatórios completos já armazenados podem ser usados sem reenviar os arquivos ou consultar novamente os CNPJs: o backend reconcilia os snapshots existentes e aplica a nova comparação mensal.

A correção está na linha de desenvolvimento `feature/period-rbt12-extrato`, onde existia a validação diária. A branch `main` possui uma evolução separada das consultas; esta entrega não a substitui nem remove suas melhorias. Não confunda publicação do preview dessa branch com implantação do domínio principal.

## Funcionalidades da versão

Mantidos os recursos da v0.12.0: período fiscal pela coluna H, importação de compras/vendas, pré-preenchimento dos cinco grupos do simulador, leitura Python de RBT12, simulações históricas, relatórios e isolamento por empresa/workspace. Históricos sem período fiscal persistido continuam no fluxo de confirmação manual.

A documentação operacional completa de instalação, equipe, consultas, relatórios, simulador, RBT12 e configurações está preservada em [README v0.12.0 inicial](README-v0.12.0-inicial.md). As orientações antigas que exigiam igualdade de dias foram substituídas pela regra de competências acima. Consulte também [AGENTS.md](AGENTS.md), [CHANGELOG.md](CHANGELOG.md) e [documentação da calculadora](docs/calculadora-tributaria.md).

## Verificação e progresso

- [x] Comparação mensal isolada da conciliação exata dos snapshots.
- [x] Mensagem de erro restrita a divergências reais de competência.
- [x] Seis testes unitários adicionados e executados localmente com Node.js 22.
- [x] Regressão do fluxo de importação → MongoDB → API do simulador, sem consultar fonte externa e sem dados reais de clientes.
- [x] Teste de preservação das datas/valores e bloqueio de adulteração do snapshot.
- [x] Workflow específico de competências, além da inclusão dos testes nas rotinas existentes.

```sh
# Somente a regra mensal, sem MongoDB
node --experimental-strip-types --test tests/report-competence.test.ts

# Tipos e build
npm run check:release
npm run check
npm run build

# Regra e integração; configure MONGODB_URI para uma instância de teste
npm run test:competences
```

A integração cria um banco com nome aleatório e o remove ao final, após conferir sua identidade. Usa somente lançamentos sintéticos não consultáveis, sem chamadas à API CNPJ. O workflow **Competências de compras e vendas** verifica versão, tipos, build e a integração desta correção. Confira a execução do commit entregue; a aprovação desse workflow específico não afirma que todas as suítes preexistentes da branch estejam aprovadas.
