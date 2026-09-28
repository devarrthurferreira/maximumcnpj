# Desenvolvimento do Maximum CNPJ

Leia README, CHANGELOG e estado real da branch. Escopo v0.4.0: Node.js/TypeScript, MongoDB e consulta Minha Receita explicitamente solicitada pelo responsável; sem Google Cloud.

## Cada entrega
- Versione README e CHANGELOG junto com mudanças. Versões em package.json e src/domain.ts precisam coincidir.
- Preserve histórico e alterações concorrentes. Não faça force-push.
- Execute tipos, build, regras, integração e navegador quando possível. Diferencie simulação, banco descartável, produção e homologação fiscal.
- Não versione .env, senhas, URI privada, arquivos reais de clientes ou payloads sensíveis.

## Invariantes
- Código = ID de origem; responsável escolhida explicitamente.
- CNPJ completo é identidade; CPF/CNO não vão à API CNPJ.
- A resposta precisa trazer a mesma identidade. Nome confere; homônimo não comprova enquadramento.
- Erro, ausência e desconhecimento não equivalem a não optante; só booleano explícito da fonte.
- Novo lote chama novamente a API. Reutilização de MongoDB não é usar resposta velha como atual.
- Conteúdo igual compartilha estado; cada busca conserva data e vínculo próprios.
- Fluxo novo não persiste planilha/payload integral. Não misture declarações antigas com consulta nova.
- Origem usa configuração confiável, não Host recebido. Sem CORS *, sem remover autenticação.
- Respeite pausas/limites e privacidade; sem fallback pago ou scraping automático.
- Calculadora exige regras versionadas e homologação, não valores fictícios.
