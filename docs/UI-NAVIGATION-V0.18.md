# Interface compacta e fluxo guiado · 08/10/2026

Esta correção visual da v0.18.0 moderniza a navegação e o início da geração sem alterar contratos, permissões, cálculos ou persistência.

## Navegação lateral

- A barra lateral deixa de exibir logo, títulos e nomes permanentes.
- Início, Empresas, Iniciar, Histórico, Simulações, Configurações e Sair aparecem como ícones.
- Cada item possui nome acessível e tooltip no hover ou foco por teclado.
- **Iniciar** é a ação principal: botão maior, fundo marsala, brilho suave e indicação própria de estado ativo.
- No desktop, o botão da barra superior oculta e reabre a navegação; a preferência fica guardada no navegador.
- No celular, a navegação abre como drawer e fecha por overlay ou tecla `Esc`.

## Passo 1 e escolha dos relatórios

- A busca por número, nome ou CNPJ continua sendo o primeiro passo.
- A pergunta **Quais relatórios serão incluídos?** e as opções Compras e Vendas foram preservadas.
- Os cartões ganharam seleção, hover, foco e transições mais claras, sem mudar a regra de tipos escolhidos.
- A criação da geração mostra estado de processamento para impedir cliques duplicados.

## Upload de Compras e Vendas

- A área de arrastar/selecionar arquivo recebeu estados de hover, drag-over, leitura e envio.
- O progresso da consulta usa barra animada e mensagens de carregamento.
- Resumo e próximo passo entram suavemente para manter a tela limpa.
- Animações são removidas quando o dispositivo solicita `prefers-reduced-motion`.

## Compatibilidade

- Nenhuma rota, fórmula, classificação, permissão ou formato de arquivo foi modificado.
- Histórico, seleção múltipla, relatórios completos, simulador e retomada continuam usando a lógica existente.
- O teste visual cobre navegação icon-only, tooltip, destaque de Iniciar, recolhimento no desktop, drawer no celular e ausência de overflow horizontal.
