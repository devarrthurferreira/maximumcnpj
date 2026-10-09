# Navegação compacta e geração · v0.19.0

## Navegação

O desktop abre com um trilho de ícones de 72 px. O botão da barra superior expande o menu para mostrar os nomes das áreas; recolher volta aos ícones, mantendo os atalhos acessíveis. A preferência é guardada quando o armazenamento do navegador está disponível. Os itens mantêm nomes acessíveis, foco visível, tooltips no trilho e indicação da página atual.

No celular, o painel abre sobre o conteúdo. O foco permanece no menu, o fundo fica indisponível enquanto ele está aberto e Escape, fechar, toque externo ou escolha de um link encerram o drawer. Redimensionar a tela não deixa o conteúdo bloqueado.

## Campos da geração

- Busca por código, nome com ou sem acentos e CNPJ formatado ou numérico. Empresas inativas não aparecem na seleção.
- Seleção de compras e vendas em controles menores, com resumo atualizado. Nenhum relatório selecionado bloqueia o avanço.
- A geração só é criada na confirmação explícita. Durante o pedido, os controles ficam bloqueados.
- Rejeições 400, 404 e 422 permitem corrigir empresa/tipos e criar um novo pedido. Rede, timeout, conflito e falhas temporárias conservam o ID e o payload anteriores no reenvio.
- A seleção de várias empresas conserva o limite de 50, o histórico e o fluxo de importação.

## Importação e simulação

Cards de upload e extrato usam superfícies claras, controles de pelo menos 44 px e feedback sem animação decorativa contínua. Os campos financeiros identificam moeda e origem; campos obrigatórios continuam exigindo informação, inclusive zero explícito quando aplicável. RBT12 manual continua exigindo confirmação e RBT12 extraída permanece vinculada ao documento.

## Regras e compatibilidade

Snapshots antigos de vendas sem `balanceCents` usam o total já armazenado como saldo histórico. A ausência é tratada de modo diferente de um valor inválido ou divergente; não há reclassificação retroativa. Vendas atuais continuam conciliando bruto e líquido separadamente.

Percentuais líquidos usam aritmética inteira idêntica no Node e no PDF. Os centésimos percentuais são distribuídos pelo maior resto, com desempate na ordem Optantes SN, Não optantes SN e CPF, para fechar 100% quando o denominador não é zero. Grupos vazios permanecem em 0%; grupos com devoluções são proporcionais ao saldo líquido, inclusive quando negativos. Com total líquido zero, todos os percentuais são 0%. Valores monetários, natureza em quatro dígitos, CFOP, fonte fiscal e fórmulas tributárias não foram alterados.

## Verificação

Regressões cobrem trilho/expansão, persistência e armazenamento indisponível, foco móvel, Escape, resizing, seleção vazia, falha definitiva versus reenvio incerto, pesquisa, larguras de 320/390/1440 px e acesso de históricos legados ao simulador. O percurso com arquivos sintéticos exercita navegador, APIs, banco descartável e resultado salvo. Executar os gates de `AGENTS.md`; a CI registra o resultado do commit.
