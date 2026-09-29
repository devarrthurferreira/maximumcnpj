"""Generation reports: completed company purchases, scoped snapshots and explicit parts."""
from __future__ import annotations

from io import BytesIO
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, PageBreak

from .core import require, utcnow, display_date, number
from .purchases import (PURCHASES_MODE, purchase_metadata, purchase_pdf_styles, purchase_story,
                        purchase_page_callback, purchase_paragraph, purchase_table, money, _check, _integer)

GENERATION_PART_SIZE = 10
GENERATION_COMPANY_LIMIT = 50


def generation_metadata(db, generation_id, workspace, part=1):
    generation = db.generations.find_one({'_id': generation_id, 'workspaceId': workspace})
    require(generation, 404, 'NOT_FOUND', 'Geração não encontrada.')
    companies = generation.get('companies')
    _check(isinstance(companies, list) and 1 <= len(companies) <= GENERATION_COMPANY_LIMIT)
    parts = (len(companies) + GENERATION_PART_SIZE - 1) // GENERATION_PART_SIZE
    require(type(part) is int and 1 <= part <= parts, 400, 'PART', 'Parte do relatório inexistente.')
    client_ids, job_ids = set(), set()
    for company in companies:
        _check(isinstance(company, dict) and isinstance(company.get('clientId'), str) and bool(company['clientId']))
        _check(company['clientId'] not in client_ids)
        client_ids.add(company['clientId'])
        job_id = company.get('purchaseJobId')
        require(isinstance(job_id, str) and bool(job_id), 409, 'GENERATION_INCOMPLETE',
                'Adicione e conclua o relatório de compras de todas as empresas antes de emitir o PDF.')
        history = company.get('purchaseJobIds')
        _check(isinstance(history, list) and job_id in history)
        _check(job_id not in job_ids)
        job_ids.add(job_id)
    # Check ALL companies even when only one explicit PDF part is requested.
    jobs = list(db.lookupJobs.find({'_id': {'$in': list(job_ids)}, 'workspaceId': workspace})
                .limit(GENERATION_COMPANY_LIMIT + 1).max_time_ms(15000))
    by_id = {job['_id']: job for job in jobs}
    require(len(by_id) == len(companies), 409, 'GENERATION_INCOMPLETE',
            'Uma consulta vinculada está indisponível. Confira todas as empresas desta geração.')
    for company in companies:
        job = by_id[company['purchaseJobId']]
        _check(job.get('clientId') == company['clientId'] and job.get('generationId') == generation_id and
               job.get('workspaceId') == workspace and job.get('mode') == PURCHASES_MODE)
        require(job.get('status') == 'COMPLETED', 409, 'GENERATION_INCOMPLETE',
                'Conclua as compras de todas as empresas antes de emitir o PDF completo.')
    start = (part - 1) * GENERATION_PART_SIZE
    selected = companies[start:start + GENERATION_PART_SIZE]
    purchases = [purchase_metadata(db, by_id[company['purchaseJobId']], workspace) for company in selected]
    totals = {'totalCents': 0, 'cnpjCents': 0, 'nonCnpjCents': 0, 'lineCount': 0, 'unconfirmedCents': 0}
    for meta in purchases:
        for key in ('totalCents', 'cnpjCents', 'nonCnpjCents', 'lineCount'):
            totals[key] = _integer(totals[key] + meta[key])
        totals['unconfirmedCents'] = _integer(totals['unconfirmedCents'] + meta['unconfirmed']['totalCents'])
    return {'generation': generation, 'purchases': purchases, 'part': part, 'parts': parts,
            'companyCount': len(companies), 'firstCompany': start + 1, 'lastCompany': start + len(selected),
            'totals': totals, 'generatedAt': utcnow()}


def render_generation_pdf(meta):
    stream = BytesIO()
    generation, part, parts = meta['generation'], meta['part'], meta['parts']
    doc = SimpleDocTemplate(stream, pagesize=landscape(A4), rightMargin=32, leftMargin=32,
                            topMargin=86, bottomMargin=40, title='Maximum CNPJ - Geração de relatórios de compras',
                            author='Maximum CNPJ', pageCompression=1)
    width = landscape(A4)[0] - 64
    styles = purchase_pdf_styles()
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    scope = 'da geração' if parts == 1 else 'desta parte'
    totals = meta['totals']
    story = [p('Geração de relatórios', 'heading'), p(f'Compras - parte {part} de {parts}', 'title'),
             p(f'Geração: {generation["_id"]} | Criada em: {display_date(generation.get("createdAt"))} | '
               f'Emissão: {display_date(meta["generatedAt"])}', 'small'),
             p(f'{meta["companyCount"]} empresas com compras concluídas. Esta parte contém as empresas '
               f'{meta["firstCompany"]} a {meta["lastCompany"]}, com resumo e memória individual.', 'body'),
             p(f'Total {scope}: {money(totals["totalCents"])} | {number(totals["lineCount"])} linhas', 'heading')]
    rows = [['Código / Empresa', 'Cálculo', 'Linhas', 'Valor CNPJs', 'CPF / outros', 'Total']]
    for purchase in meta['purchases']:
        job = purchase['job']
        rows.append([f'{job.get("clientCode") or "Sem código"} - {job.get("clientName") or "Empresa"}',
                     'Atual' if purchase['calculationVersion'] == 'NET_V2' else 'Anterior', number(purchase['lineCount']), money(purchase['cnpjCents']),
                     money(purchase['nonCnpjCents']), money(purchase['totalCents'])])
    rows.append([f'TOTAL {scope.upper()}', '-', number(totals['lineCount']), money(totals['cnpjCents']),
                 money(totals['nonCnpjCents']), money(totals['totalCents'])])
    story += [purchase_table(rows, (.34, .08, .07, .17, .17, .17), width, styles, True, padding=5), Spacer(1, 9),
              p('Como conferir esta geração', 'heading'),
              p('As próximas páginas apresentam, por empresa, os grupos gerenciais, as bases dos percentuais e os '
                'valores usados no cálculo. Fórmula atual: Q - Y + AA - AB. A despesa acessória Z é informativa. '
                'Relatórios com a regra anterior preservam Q e exibem o aviso de reimportação.', 'small'),
              p(f'Não confirmados já incluídos em Não optantes {scope}: {money(totals["unconfirmedCents"])}. '
                'A classificação original continua identificada no subtotal individual. CPF e outros documentos '
                'permanecem separados. Os percentuais são calculados por empresa, sem somar ou deduplicar fornecedores entre empresas.', 'small'),
              p('Vendas: indisponível nesta etapa. Todas as empresas devem ter compras concluídas para habilitar a emissão. '
                'Este documento usa somente os snapshots salvos e reconciliados da parte indicada.', 'small')]
    if parts > 1:
        story.append(p(f'Arquivo dividido em {parts} partes de até {GENERATION_PART_SIZE} empresas. '
                       'Baixe todas as partes para obter a geração completa; os totais desta capa abrangem somente esta parte.', 'small'))
    for purchase in meta['purchases']:
        story.extend([PageBreak(), *purchase_story(purchase, width, styles)])
    on_page = purchase_page_callback(f'Geração {generation["_id"]} | Parte {part}/{parts}')
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return stream.getvalue()
