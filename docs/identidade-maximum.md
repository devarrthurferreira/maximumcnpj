## Identidade Maximum · v0.5.1

Esta revisão aplica a identidade solicitada ao login, navegação, indicadores, importação, histórico, painel legado, central de relatórios e PDFs. Não modifica senhas, permissões, MongoDB, fonte de consulta, dados históricos, contagens ou critérios fiscais.

| Elemento | Aplicação |
|---|---|
| Bordô principal | `#750207`, ações principais, áreas da marca e cabeçalhos PDF |
| Bordô escuro | `#6F0000`, fundo do login e interações |
| Branco / fundo suave | `#FFFFFF` / `#F7F3F3` |
| Bordas / apoio | `#EAD5D6` / `#B2797B` |
| Texto / texto secundário | `#222222` / `#666666` |

Logo oficial de origem: https://maximum-club.vercel.app/img/logo-maximum-white.png. A cópia versionada preserva os bytes originais, a transparência e a proporção 512 × 107. O SHA Git do PNG é `25967ce7f55a9058f45733a79536a9eb092f4b2a`. O símbolo compacto do menu/favicon é um recorte do M da mesma imagem, não uma nova marca.

`public/img/logo-maximum-white.png` atende o navegador e `reporting/assets/logo-maximum-white.png` atende o Python. Os PDFs incorporam a imagem local: nenhuma consulta ao MaximumClub é necessária para abrir a interface, construir o aplicativo ou emitir um relatório. O navegador continua restrito aos próprios ativos; nenhuma ampliação de CORS/CSP foi necessária.

As classes de status continuam identificadas por texto. Bordô, grafite e tons claros da marca substituem a antiga paleta violeta; o significado de optante, não optante e não confirmado permanece o mesmo. O login possui marca visível também no celular, e o menu recolhido usa o símbolo compacto. A logo branca sempre fica sobre fundo bordô, sem filtros de cor ou distorção.

O PDF reserva espaço para a faixa da marca em todas as páginas, mantendo rodapé, paginação, filtros, datas e avisos de origem. Novos testes verificam a integridade do PNG, incorporação no PDF, contraste da ação principal, logo carregada e layout responsivo. As evidências usam dados fictícios e banco descartável. A aprovação da versão deve ser conferida na CI correspondente ao SHA publicado; existência dos testes não equivale a homologação de dados reais.

