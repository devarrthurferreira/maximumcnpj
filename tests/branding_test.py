"""Marca e PDF com dados inteiramente fictícios; sem banco e sem consulta fiscal."""
import hashlib
import unittest
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image
from reporting.pdf import render_pdf
from reporting.brand import LOGO_PATH, PRIMARY

ROOT = Path(__file__).resolve().parents[1]
class BrandingTests(unittest.TestCase):
    def test_logo_integrity_and_proportion(self):
        data=LOGO_PATH.read_bytes()
        self.assertEqual(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'25967ce7f55a9058f45733a79536a9eb092f4b2a')
        self.assertEqual(data,(ROOT/'public/img/logo-maximum-white.png').read_bytes())
        with Image.open(LOGO_PATH) as img:self.assertEqual(img.size,(512,107))
    def test_white_text_contrast(self):
        def channel(v):
            s=int(v,16)/255
            return s/12.92 if s<=.04045 else ((s+.055)/1.055)**2.4
        rgb=[channel(PRIMARY[i:i+2]) for i in (1,3,5)]
        luminance=sum(v*w for v,w in zip(rgb,(.2126,.7152,.0722)))
        self.assertGreater(1.05/(luminance+.05),7)
    def test_summary_and_detailed_embed_logo(self):
        now=datetime(2026,9,28,15,0,tzinfo=timezone.utc)
        job={'_id':'00000000-0000-4000-8000-000000000001','clientCode':'DEMO','clientName':'EMPRESA DEMONSTRATIVA — DADOS FICTÍCIOS','fileName':'Demonstração visual, sem resultado fiscal','completedAt':now,'summary':{'lines':4,'unique':3,'duplicates':1,'invalid':0}}
        groups=[{'label':'Simples','count':1,'percent':33.33,'batchPercent':33.33},
                {'label':'Não optante','count':2,'percent':66.67,'batchPercent':66.67}]
        meta={'job':job,'generatedAt':now,'groups':groups,'denominator':3,'total':3,'coverage':66.67,'nameWarnings':0,'firstCheck':now,'lastCheck':now,'unconfirmedCount':1,'kinds':[{'label':'Tipo não informado','count':3}]}
        rows=[{'cnpj':'00000000000000','status':'NAO_CONFIRMADO','submittedName':'REGISTRO FICTÍCIO — NÃO CONSULTADO','kind':'CLIENTE','uf':'MG','occurrences':1,'checkedAt':now,'reason':'DEMONSTRACAO','details':{}}]
        result={'items':rows,'page':1,'parts':1,'total':1}
        output=ROOT/'test-results'/'maximum-brand';output.mkdir(parents=True,exist_ok=True)
        for layout in ('summary','detailed'):
            pdf=render_pdf(meta,result,{'layout':layout,'status':'ALL','kind':'ALL'})
            self.assertTrue(pdf.startswith(b'%PDF-'))
            self.assertIn(b'/Subtype /Image',pdf)
            (output/f'{layout}-demonstracao.pdf').write_bytes(pdf)
