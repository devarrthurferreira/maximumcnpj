# Histórico de alterações

## [0.12.1] — 2026-10-01

- OCR integral em páginas de imagem e conversão para PDF pesquisável, com processamento de todas as páginas e limites explícitos sem truncamento.
- RBT12 exclusiva da seção 2.2: 12 competências anteriores ao PA, mercados interno e externo; rejeição de ausência, conflito e OCR numérico de baixa confiança, sem fallback para 2.1, DAS ou estimativa.
- Novas simulações exigem extrato validado e vínculo por empresa/workspace; reconciliação das 12 linhas no servidor. Campo não editável e reidratação autenticada dos rascunhos.
- DRE mensal janeiro–dezembro + total anual, seletor de regime, Indicador fixo e RBT12 fixa identificada pelo PA. Ano do cenário e período dos relatórios exibidos separadamente.
- Snapshots anteriores preservados sem recalcular; memória mensal versionada nas novas simulações. Fórmulas tributárias e projeção pela média dos relatórios mantidas.
- Conversor Python local com saídas PDF/TXT/JSON; nenhum PDF original, OCR integral ou base64 é persistido no banco.
- Testes de OCR real com PDF imagem sintético, seção 2.2, autenticação, valores e calendário. Sem dados reais de contribuintes no repositório.


## [0.12.0] — 2026-10-01

- Projeção explícita e permanente: total importado ÷ competências (1–12) × 12, em todos os cinco grupos de compras/vendas.
- Regra compartilhada em centavos inteiros entre navegador e servidor, arredondamento conciliado entre grupos e horizonte fixo de 12 meses, nunca N + 12.
- Memória `AVERAGE_X12_V1` salva pelo servidor com totais, divisor, médias, projeções e cenário mensal editado separado da base original.
- Redesign com três cartões de cálculo, alternância Compras/Vendas, 12 meses iguais, tabela de conferência por grupo, seções e responsividade.
- Serviços e despesas permanecem mensais, multiplicados por 12 uma vez; RBT12 manual/PDF permanece independente da projeção.
- Históricos não recalculados; rascunho com divisor diferente não sobrescreve médias automáticas atuais.
- Conservadas a comparação mensal da coluna H e a consulta concorrente da v0.11.1; revalidação financeira mantém o período original.
- Testes de precisão, contratos, integração MongoDB, histórico e navegador adicionados. Atualizados testes antigos de rotas Python, fixtures com coluna H e detalhes da RBT12, sem relaxar autenticação ou conciliação.


## [0.12.0] — correção de competências em 2026-10-01

- Corrigido o bloqueio do simulador quando compras e vendas possuem primeiros/últimos lançamentos em dias diferentes dentro dos mesmos meses.
- Comparação passa a utilizar mês/ano inicial e final e quantidade inclusiva de competências, com validação de intervalo entre 1 e 12 meses.
- Abril a agosto de 2026 é aceito como cinco competências nos dois arquivos, inclusive quando um começa no dia 02/04 e outro no dia 01/04.
- Meses sem movimento dentro do intervalo não reduzem o divisor. Meses/anos realmente diferentes continuam bloqueados, mesmo com a mesma duração.
- Datas originais da coluna H preservadas, sem normalização destrutiva para o primeiro/último dia do mês. Conciliação individual do snapshot continua exata.
- Mensagem de erro e aviso do simulador esclarecem a regra mensal. Fórmulas, valores, Simples/CPF, RBT12, permissões e históricos não foram alterados.
- Seis testes unitários e integração com MongoDB descartável adicionados: caso informado, dias finais diferentes, um mês, virada de ano, divergências reais, integridade e isolamento.
- Correção aplicada à branch de período/RBT12, sem substituir a linha de consultas da main. Versão de aplicação 0.12.0 e dependências mantidas.

## Entrega inicial [0.12.0] e versões anteriores

O histórico integral anterior foi preservado em [CHANGELOG v0.12.0 inicial](CHANGELOG-v0.12.0-inicial.md). A exigência antiga de dias idênticos na comparação entre compras e vendas foi substituída pela regra de competências desta correção.
