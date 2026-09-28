"""PDF paginado e sem HTML remoto, anexos ou cópias permanentes no banco."""
from __future__ import annotations
from html import escape
from .brand import draw_brand_header
from io import BytesIO
import re
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, LongTable
from .core import (VERSION, STATUSES, KINDS, NOTICE, display_date, number, percent,
                   percentage, cnpj_mask, PDF_PART_SIZE)

INK = colors.HexColor('#222222')
BORDEAUX = colors.HexColor('#750207')
LIGHT = colors.HexColor('#F7F3F3')
MUTED = colors.HexColor('#666666')


def render_pdf(meta, result, options):
    job = meta['job']
    stream = BytesIO()
    page_width, page_height = landscape(A4)
    width = page_width - 64
    doc = SimpleDocTemplate(stream, pagesize=landscape(A4), rightMargin=32, leftMargin=32,
                            topMargin=88, bottomMargin=40, title='Maximum CNPJ - Relatório de consulta',
                            author='Maximum CNPJ', pageCompression=1)
    styles = {
        'body': ParagraphStyle('body', fontName='Helvetica', fontSize=9, leading=13, textColor=INK, spaceAfter=7),
        'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8, leading=11, textColor=MUTED),
        'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=22, leading=26, textColor=INK, spaceAfter=12),
        'heading': ParagraphStyle('heading', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=BORDEAUX, spaceAfter=9),
        'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=8, leading=10.5, textColor=INK, splitLongWords=True),
        'head': ParagraphStyle('head', fontName='Helvetica-Bold', fontSize=8, leading=11, textColor=colors.white),
    }
    def p(value, style='body'):
        s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value if value is not None else '—'))
        return Paragraph(escape(s).replace('\n', '<br/>'), styles[style])
    def table(data, widths, header=True):
        t = LongTable(data, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
        spec = [('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),
                ('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),
                ('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,-1),(-1,-1),0.3,colors.HexColor('#EAD5D6'))]
        if header:
            spec += [('BACKGROUND',(0,0),(-1,0),BORDEAUX),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, LIGHT])]
        t.setStyle(TableStyle(spec))
        return t
    def on_page(canvas, document):
        canvas.saveState()
        draw_brand_header(canvas, page_width, page_height)
        canvas.setFillColor(MUTED)
        canvas.setStrokeColor(colors.HexColor('#EAD5D6')); canvas.line(32,32,page_width-32,32)
        canvas.setFont('Helvetica',7)
        canvas.drawString(32,20,f'Consulta {job["_id"]} | v{VERSION}')
        canvas.drawRightString(page_width-32,20,f'Página {document.page} | Horários de Brasília')
        canvas.restoreState()
    title = f'{job.get("clientCode") or "Sem código"} · {job.get("clientName") or "Empresa"}'
    group_label = STATUSES[options['status']]
    story = [p('Relatório de enquadramento','heading'), p(title,'title'),
             p(f'Arquivo: {job.get("fileName") or "Não informado"}'),
             p(f'Grupo: {group_label} | Tipo: {KINDS[options["kind"]]}'),
             p(f'Consulta concluída: {display_date(job.get("completedAt"))} | Relatório emitido: {display_date(meta["generatedAt"])}','small'),
             Spacer(1,14)]
    counts = [['Enquadramento', 'CNPJs únicos', '% no tipo selecionado', '% no lote completo']]
    for g in meta['groups']:
        counts.append([g['label'],number(g['count']),percent(g['percent']),percent(g['batchPercent'])])
    counts.append(['TOTAL DO TIPO', number(meta['denominator']), percent(100 if meta['denominator'] else 0), percent(percentage(meta['denominator'], meta['total']))])
    story.append(table([[p(v,'head' if i==0 else 'cell') for v in row] for i,row in enumerate(counts)], [width*.40,width*.18,width*.21,width*.21]))
    s = job.get('summary') or {}
    story += [Spacer(1,12), p('Qualidade da base e rastreabilidade','heading'),
              p(f'Arquivo completo: {number(s.get("lines"))} linhas · {number(meta["total"])} CNPJs únicos · '
                f'{number(s.get("duplicates"))} repetições adicionais · {number(s.get("invalid"))} documentos não consultáveis.'),
              p(f'Tipo selecionado: {number(meta["denominator"])} CNPJs; cobertura de respostas explícitas: {percent(meta["coverage"])}. '
                f'Nomes semelhantes ou divergentes para revisão: {number(meta["nameWarnings"])}.'),
              p(f'Verificações deste tipo: {display_date(meta["firstCheck"])} até {display_date(meta["lastCheck"])}.','small'),
              p('Percentuais por tipo incluem os não confirmados. Repetições não aumentam os totais; matriz e filial com CNPJs completos diferentes são distintas. '
                'O filtro de tipo usa o primeiro tipo informado para cada CNPJ na importação; não reconstrói linhas descartadas pela deduplicação.','small'),
              Spacer(1,6), p(NOTICE,'small')]
    story += [Spacer(1,8), p('Distribuição por tipo no lote completo','heading'),
              p(' | '.join(f'{x["label"]}: {number(x["count"])}' for x in meta['kinds']),'small')]
    if options['layout'] == 'summary':
        story += [Spacer(1,10),p('Relatório sintético: contém as quantidades completas, sem a relação nominal. Para os CNPJs, baixe as partes do relatório detalhado.','small')]
    else:
        story += [PageBreak(), p(f'{group_label} · listagem detalhada','title'),
                  p(f'Parte {result["page"]} de {result["parts"]} | {number(len(result["items"]))} de {number(result["total"])} CNPJs do grupo.'),
                  p(f'Limite de {PDF_PART_SIZE} CNPJs por parte; baixe todas as partes para a relação completa. O resumo acima sempre considera o lote/tipo completo.','small'),Spacer(1,8)]
        data = [[p(x,'head') for x in ('CNPJ / Simples','Nome informado / API','Tipo / UF / repetições','Conferência e cadastro','Datas de opção / exclusão','Consultado em')]]
        for row in result['items']:
            d = row.get('details') or {}
            names = f'Informado: {row.get("submittedName") or "Não informado"}\nAPI: {d.get("name") or "Não retornado"}'
            if d.get('tradeName'): names += '\nFantasia: ' + d['tradeName']
            data.append([p(cnpj_mask(row['cnpj'])+'\n'+STATUSES[row['status']],'cell'),p(names,'cell'),
              p(f'{row.get("kind") or "Sem tipo"}\nUF: {d.get("uf") or row.get("uf") or "—"}\nOcorrências: {row.get("occurrences",1)}','cell'),
              p(f'{row.get("nameMatch") or "Não informada"}\n{row.get("reason") or "Sem impedimento registrado"}\nCadastro: {d.get("registryStatus") or "Não informado"}\nMEI: '+('Sim' if d.get('mei') is True else 'Não' if d.get('mei') is False else 'Não confirmado'),'cell'),
              p(f'Opção: {display_date(d.get("optionDate"))}\nExclusão: {display_date(d.get("exclusionDate"))}','cell'),
              p(display_date(row.get('checkedAt')),'cell')])
        if result['items']:
            story.append(table(data,[width*x for x in (.15,.28,.105,.205,.15,.11)]))
        else:
            story.append(p('Nenhum CNPJ neste grupo. Não houve omissão de resultados.'))
    doc.build(story,onFirstPage=on_page,onLaterPages=on_page)
    return stream.getvalue()
