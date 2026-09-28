"""Preparação única da identidade solicitada. Não acessa banco, contas ou segredos."""
from pathlib import Path
from urllib.request import urlopen, Request
from io import BytesIO
import base64, colorsys, hashlib, json, re, time
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path, content):
    p=ROOT/path; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(content,encoding='utf-8')
def replace(path, old, new):
    s=read(path)
    if old not in s: raise RuntimeError('Trecho esperado ausente: '+path)
    write(path,s.replace(old,new))

# Copiar exatamente a imagem fornecida, com integridade conferida contra o ativo do MaximumClub.
url='https://maximum-club.vercel.app/img/logo-maximum-white.png'
for attempt in range(3):
    try:
        with urlopen(Request(url,headers={'User-Agent':'MaximumCNPJ-BrandPreparation/1.0'}),timeout=20) as response:
            logo=response.read(1000000)
        assert logo.startswith(b'\x89PNG\r\n\x1a\n')
        assert hashlib.sha1(b'blob '+str(len(logo)).encode()+b'\0'+logo).hexdigest()=='25967ce7f55a9058f45733a79536a9eb092f4b2a', 'Logo diferente da referência verificada'
        break
    except Exception:
        if attempt==2: raise
        time.sleep(2)
image=Image.open(BytesIO(logo)).convert('RGBA')
assert image.size==(512,107)
for path in ('public/img/logo-maximum-white.png','reporting/assets/logo-maximum-white.png'):
    p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(logo)
# Recorte apenas do símbolo M da mesma imagem, sem redesenhar a marca.
symbol=image.crop((0,0,78,65)); stream=BytesIO(); symbol.save(stream,format='PNG',optimize=True)
(ROOT/'public/img/maximum-symbol.png').write_bytes(stream.getvalue())
encoded=base64.b64encode(stream.getvalue()).decode('ascii')
write('public/favicon.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#750207"/><image x="8" y="12" width="48" height="40" href="data:image/png;base64,{encoded}"/></svg>\n')

brand='<div class="brand maximum-brand"><img class="maximum-logo" src="/img/logo-maximum-white.png" width="512" height="107" alt="Maximum Assessoria Contábil"><span class="maximum-symbol" aria-hidden="true"><img src="/img/maximum-symbol.png" width="78" height="65" alt=""></span><small class="maximum-product">CNPJ · INTELIGÊNCIA</small></div>'
pattern=r'<div class="brand"><img class="brand-icon"[^>]*><div class="brand-name">maximum<small>[^<]*</small></div></div>'
for path in ('public/app.js','public/lookup-ui.js','public/reports.html'):
    s,count=re.subn(pattern,lambda m:brand,read(path))
    assert count==1,(path,count)
    if path.endswith('.js'):
        marker='<form id="login-form" class="login-form">'
        assert marker in s
        s=s.replace(marker,marker+'<div class="mobile-brand">'+brand+'</div>')
    write(path,s)

# Substituição de cores decorativas. As regras de classificação não mudam.
fixed={'#6852d5':'#750207','#5542bb':'#6F0000','#6d58c8':'#750207','#f6f5f9':'#F7F3F3','#22212c':'#222222','#777482':'#666666','#eceaf1':'#EAD5D6','#f0ecff':'#F7F3F3','#afa0f2':'#B2797B','#b9afd9':'#B2797B','#eed1a2':'#EAD5D6'}
def recolor(match):
    value=match.group().lower(); raw=value[1:7];alpha=value[7:]
    if value[:7] in fixed:return fixed[value[:7]]+alpha
    rgb=tuple(int(raw[i:i+2],16)/255 for i in (0,2,4));h,l,s=colorsys.rgb_to_hls(*rgb)
    if s<.12:
        color='#FFFFFF' if l>.96 else '#F7F3F3' if l>.9 else '#EAD5D6' if l>.78 else '#666666' if l>.37 else '#222222'
    else:
        color='#F7F3F3' if l>.92 else '#EAD5D6' if l>.78 else '#B2797B' if l>.62 else '#750207' if l>.3 else '#6F0000'
    return color+alpha
for path in ('public/styles.css','public/reports.css','public/app.js','public/lookup-ui.js'):
    write(path,re.sub(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b',recolor,read(path)))
for path in ('public/index.html','public/legacy.html','public/reports.html'):
    s=read(path).replace('#6852d5','#750207')
    assert '</head>' in s
    s=s.replace('</head>','<link rel="stylesheet" href="/maximum-brand.css"></head>')
    write(path,s)

# PDF usa o mesmo PNG incorporado localmente; nenhuma chamada remota na emissão.
replace('reporting/pdf.py','from html import escape','from html import escape\nfrom .brand import draw_brand_header')
for old,new in (('#172339','#222222'),('#6852d5','#750207'),('#f3f1fa','#F7F3F3'),('#5b6475','#666666'),('#d7dce5','#EAD5D6'),('#dedbe9','#EAD5D6')):
    replace('reporting/pdf.py',old,new)
replace('reporting/pdf.py','VIOLET','BORDEAUX')
replace('reporting/pdf.py','topMargin=54','topMargin=88')
replace('reporting/pdf.py',"('BACKGROUND',(0,0),(-1,0),INK)","('BACKGROUND',(0,0),(-1,0),BORDEAUX)")
s=read('reporting/pdf.py')
start=s.index("        canvas.setFont('Helvetica-Bold',11); canvas.setFillColor(BORDEAUX)")
end=s.index("        canvas.setStrokeColor",start)
s=s[:start]+'        draw_brand_header(canvas, page_width, page_height)\n        canvas.setFillColor(MUTED)\n'+s[end:]
write('reporting/pdf.py',s)

pkg=json.loads(read('package.json'));assert pkg['version']=='0.5.0';pkg['version']='0.5.1';write('package.json',json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
replace('src/domain.ts',"VERSION = '0.5.0'","VERSION = '0.5.1'")
replace('reporting/core.py',"VERSION = '0.5.0'","VERSION = '0.5.1'")
readme=read('README.md')
section='''## Identidade Maximum · v0.5.1

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

'''
readme=readme.replace('# Maximum CNPJ · v0.5.0','# Maximum CNPJ · v0.5.1',1).replace('**0.5.0 · 28/09/2026**','**0.5.1 · 28/09/2026**',1)
readme=readme.replace('## 1. O que foi acrescentado',section+'## 1. O que foi acrescentado',1)
write('README.md',readme)
changelog=read('CHANGELOG.md');pos=changelog.index('\n## ')
write('CHANGELOG.md',changelog[:pos]+'''\n## [0.5.1] — 2026-09-28

### Identidade visual
- Paleta Maximum em bordô, branco e tons de apoio no painel atual, legado, login e relatórios.
- Logo oficial local, íntegra e proporcional; símbolo compacto derivado do próprio PNG.
- Marca no login móvel e no menu recolhido; sem dependência de imagem remota em produção.
- PDFs Python com logo branca em faixa bordô em todas as páginas, margens e contraste ajustados.
- Testes de integridade da imagem, PDF incorporado, contraste e navegação responsiva.
- README atualizado no mesmo incremento. Senhas, autenticação, dados e regras fiscais preservados.

'''+changelog[pos:])
write('docs/identidade-maximum.md',section)
# A preparação não integra o aplicativo final; a árvore resultante contém só fontes/ativos/testes.
(ROOT/'.github/workflows/prepare-maximum-brand.yml').unlink()
(ROOT/'scripts/prepare-maximum-brand.py').unlink()
print('Identidade v0.5.1 preparada. Logo original validada. Nenhum acesso a dados ou contas.')
