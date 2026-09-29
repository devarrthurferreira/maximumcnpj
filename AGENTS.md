# Desenvolvimento do Maximum CNPJ

Leia README, CHANGELOG e estado real da branch. v0.5.0: Node.js/TypeScript, MongoDB, Minha Receita e Python exclusivamente para relatórios. Sem Google Cloud.

## Cada entrega
- Versione README e CHANGELOG junto com as mudanças. package.json, src/domain.ts e reporting/core.py devem concordar.
- Preserve histórico e alterações concorrentes. Não faça force-push.
- Execute tipos, build, regras, MongoDB descartável, Python/PDF e navegador; não confunda simulação com produção.
- Não versione .env, senhas, URI privada, arquivos reais de clientes ou dados sensíveis.

## Invariantes
- Código = ID de origem. Responsável escolhida explicitamente. UUID interno é diferente do Código.
- CNPJ completo é identidade. CPF/CNO/inválidos não vão à API CNPJ. A partir da v0.9.0, por solicitação expressa da Maximum, esses registros entram no grupo gerencial Não optante; percentuais financeiros usam o arquivo completo, e contagens financeiras usam documentos distintos (ausência de documento conta por linha).
- Nome auxilia, mas não comprova enquadramento. Erro/ausência nunca viram negativa fiscal na fonte. Na apresentação gerencial há somente Simples (OPTANTE explícito) e Não optante (todos os demais, incluindo não confirmados e documentos não consultáveis). Preserve a situação original e os subtotais para conferência.
- Novo lote consulta novamente a API. Relatório só lê o snapshot, não é nova consulta.
- Compartilhe estados iguais no banco; preserve data e vínculo de cada busca.
- Relatórios precisam de sessão/usuário ativo/workspace/origem; não aceite cliente enviando resultados como verdade.
- Nunca remova a autenticação para resolver erro de Vercel. Não confie em Host arbitrário.
- Conteúdo mínimo; não duplique arquivos no MongoDB. Partes explícitas, sem truncamento oculto.
- Recuperação de CSV só pode realinhar descrição com separadores extras no modelo conhecido, com âncoras e valores validados e aviso na prévia; casos ambíguos continuam bloqueados.
- Percentuais devem expor denominador; filtro de tipo usa o primeiro tipo armazenado por CNPJ.
- Snapshot incompleto ou contagem divergente bloqueia emissão. Sem mistura entre empresas ou consultas.
- Preserve o bootstrap v0.4.1; não redefina senha existente por mudança de ambiente.
- Calculadora e regras fiscais dependem de homologação própria.
