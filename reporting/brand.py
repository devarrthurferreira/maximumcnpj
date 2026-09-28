"""Marca oficial local para todas as páginas dos relatórios. Nenhuma leitura de rede."""
from functools import lru_cache
from pathlib import Path
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader

PRIMARY = '#750207'
DARK = '#6F0000'
LOGO_PATH = Path(__file__).resolve().parent / 'assets' / 'logo-maximum-white.png'

@lru_cache(maxsize=1)
def logo_reader():
    image = ImageReader(str(LOGO_PATH))
    if image.getSize() != (512, 107):
        raise ValueError('Logo Maximum ausente ou com dimensões inesperadas na implantação.')
    return image

def draw_brand_header(canvas, page_width, page_height):
    canvas.saveState()
    canvas.setFillColor(HexColor(PRIMARY))
    canvas.rect(0, page_height - 70, page_width, 70, fill=1, stroke=0)
    width = 182
    height = width * 107 / 512
    canvas.drawImage(logo_reader(), 32, page_height - 35 - height / 2,
                     width=width, height=height, mask='auto', preserveAspectRatio=True)
    canvas.setFillColor(white)
    canvas.setFont('Helvetica-Bold', 11)
    canvas.drawRightString(page_width - 32, page_height - 30, 'CNPJ | RELATÓRIOS')
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(page_width - 32, page_height - 46, 'Maximum Assessoria Contábil')
    canvas.restoreState()
