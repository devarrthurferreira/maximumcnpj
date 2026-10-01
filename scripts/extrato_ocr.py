#!/usr/bin/env python3
"""Converte um extrato local para PDF pesquisável e extrai somente a seção 2.2."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reporting.simples import convert_statement_pdf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='PDF pesquisável de saída (novo arquivo)')
    parser.add_argument('--force-ocr', action='store_true', help='Reconhece novamente inclusive páginas com texto nativo')
    args = parser.parse_args()
    outputs = [args.output, args.output.with_suffix('.json'), args.output.with_suffix('.txt')]
    if any(p.exists() for p in outputs):
        parser.error('Um dos arquivos de saída já existe. Escolha outro nome para preservar o original.')
    try:
        result, pdf, text = convert_statement_pdf(args.pdf.read_bytes(), force_ocr=args.force_ocr, timeout_seconds=600)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        outputs[0].write_bytes(pdf)
        outputs[1].write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        outputs[2].write_text(text, encoding='utf-8')
    except Exception as error:
        print(f'Leitura não confirmada: {error}', file=sys.stderr)
        return 1
    print(f'Concluído: {result["processedPages"]} páginas. RBT12 calculada exclusivamente pela seção 2.2. Confira o JSON e o PDF pesquisável.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
