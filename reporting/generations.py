"""Generation reports with separate purchase/sales snapshots and explicit company parts."""
from __future__ import annotations

from io import BytesIO
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, PageBreak

from .core import require, utcnow, display_date, number
from .purchases import (PURCHASES_MODE, SALES_MODE, purchase_metadata, purchase_pdf_styles, purchase_story,
                        purchase_page_callback, purchase_paragraph, purchase_table, money, _check, _integer)

GENERATION_PART_SIZE = 10
GENERATION_COMPANY_LIMIT = 50
REPORTS = {
    'PURCHASES': {'slot': 'purchase', 'mode': PURCHASES_MODE, 'label': 'Compras'},
    'SALES': {'slot': 'sales', 'mode': SALES_MODE, 'label': 'Vendas'},
}


def generation_metadata(db, generation_id, workspace, part=1):
    generation = db.generations.find_one({'_id': generation_id, 'workspaceId': workspace})
    require(generation, 404, 'NOT_FOUND', 'Geração não encontrada.')
    companies = generation.get('companies')
    _check(isinstance(companies, list) and 1 <= len(companies) <= GENERATION_COMPANY_LIMIT)
    required = generation.get('requiredReports', ['PURCHASES'])
    _check(isinstance(required, list) and 1 <= len(required) <= 2 and
           all(isinstance(value, str) and value in REPORTS for value in required) and len(set(required)) == len(required))
    required = [report_type for report_type in REPORTS if report_type in required]
    parts = (len(companies) + GENERATION_PART_SIZE - 1) // GENERATION_PART_SIZE
    require(type(part) is int and 1 <= part <= parts, 400, 'PART', 'Parte do relatório inexistente.')
    client_ids, job_ids = set(), set()
    for company in companies:
        _check(isinstance(company, dict) and isinstance(company.get('clientId'), str) and bool(company['clientId']))
        _check(company['clientId'] not in client_ids)
        client_ids.add(company['clientId'])
        for report_type, report in REPORTS.items():
            job_id = company.get(f'{report["slot"]}JobId')
            if report_type not in required:
                _check(job_id is None)
                continue
            require(isinstance(job_id, str) and bool(job_id), 409, 'GENERATION_INCOMPLETE',
                    f'Adicione e conclua {report["label"].lower()} de todas as empresas antes de emitir o PDF.')
            history = company.get(f'{report["slot"]}JobIds')
            _check(isinstance(history, list) and job_id in history)
            _check(job_id not in job_ids)
            job_ids.add(job_id)
    # Validate every required slot, including those outside the requested PDF part.
    jobs = list(db.lookupJobs.find({'_id': {'$in': list(job_ids)}, 'workspaceId': workspace})
                .limit(GENERATION_COMPANY_LIMIT * len(REPORTS) + 1).max_time_ms(15000))
    by_id = {job['_id']: job for job in jobs}
    require(len(by_id) == len(job_ids) and set(by_id) == job_ids, 409, 'GENERATION_INCOMPLETE',
            'Uma consulta vinculada está indisponível. Confira todas as empresas desta geração.')
    for company in companies:
        for report_type in required:
            report = REPORTS[report_type]
            job = by_id[company[f'{report["slot"]}JobId']]
            _check(job.get('clientId') == company['clientId'] and job.get('generationId') == generation_id and
                   job.get('workspaceId') == workspace and job.get('mode') == report['mode'])
            require(job.get('status') == 'COMPLETED', 409, 'GENERATION_INCOMPLETE',
                    'Conclua todos os relatórios selecionados, de todas as empresas, antes de emitir o PDF completo.')
    start = (part - 1) * GENERATION_PART_SIZE
    selected = companies[start:start + GENERATION_PART_SIZE]
    sections = []
    totals_by_type = {report_type: {'totalCents': 0, 'cnpjCents': 0, 'nonCnpjCents': 0,
                                   'lineCount': 0, 'unconfirmedCents': 0, 'cpfCents': 0,
                                   'optantCents': 0, 'nonoptantCents': 0} for report_type in required}
    if 'SALES' in totals_by_type:
        totals_by_type['SALES']['difal'] = {'baseCents': 0, 'amountCents': 0, 'eligibleLines': 0,
                                          'pendingLines': 0, 'unavailableReports': 0}
    for company in selected:
        reports = {}
        for report_type in required:
            report = REPORTS[report_type]
            meta = purchase_metadata(db, by_id[company[f'{report["slot"]}JobId']], workspace)
            reports[report_type] = meta
            totals = totals_by_type[report_type]
            for key in ('totalCents', 'cnpjCents', 'nonCnpjCents', 'lineCount'):
                totals[key] = _integer(totals[key] + meta[key])
            totals['unconfirmedCents'] = _integer(totals['unconfirmedCents'] + meta['unconfirmed']['totalCents'])
            for group in meta['reportingGroups']:
                key = {'OPTANTE': 'optantCents', 'NAO_OPTANTE': 'nonoptantCents', 'CPF': 'cpfCents'}[group['status']]
                totals[key] = _integer(totals[key] + group['totalCents'])
            if report_type == 'SALES':
                if meta.get('difal') is None:
                    totals['difal']['unavailableReports'] += 1
                else:
                    for key in ('baseCents', 'amountCents', 'eligibleLines', 'pendingLines'):
                        totals['difal'][key] = _integer(totals['difal'][key] + meta['difal'][key])
        sections.append({'company': company, 'reports': reports})
    # Keep the internal purchases list for consumers of older generation metadata.
    purchases = [section['reports']['PURCHASES'] for section in sections if 'PURCHASES' in section['reports']]
    sales = [section['reports']['SALES'] for section in sections if 'SALES' in section['reports']]
    return {'generation': generation, 'requiredReports': required, 'sections': sections,
            'purchases': purchases, 'sales': sales, 'part': part, 'parts': parts,
            'companyCount': len(companies), 'firstCompany': start + 1, 'lastCompany': start + len(selected),
            'totalsByType': totals_by_type, 'totals': totals_by_type.get('PURCHASES'), 'generatedAt': utcnow()}


def render_generation_pdf(meta):
    stream = BytesIO()
    generation, part, parts = meta['generation'], meta['part'], meta['parts']
    required = meta['requiredReports']
    labels = ' e '.join(REPORTS[report_type]['label'].lower() for report_type in required).capitalize()
    doc = SimpleDocTemplate(stream, pagesize=landscape(A4), rightMargin=32, leftMargin=32,
                            topMargin=86, bottomMargin=40, title=f'Maximum CNPJ - Geração de {labels.lower()}',
                            author='Maximum CNPJ', pageCompression=1)
    width = landscape(A4)[0] - 64
    styles = purchase_pdf_styles()
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    scope = 'da geração' if parts == 1 else 'desta parte'
    story = [p('Geração de relatórios', 'heading'), p(f'{labels} - parte {part} de {parts}', 'title'),
             p(f'Geração: {generation["_id"]} | Criada em: {display_date(generation.get("createdAt"))} | '
               f'Emissão: {display_date(meta["generatedAt"])}', 'small'),
             p(f'{meta["companyCount"]} empresas com todos os relatórios selecionados concluídos. Esta parte contém '
               f'as empresas {meta["firstCompany"]} a {meta["lastCompany"]}, com resumo e memória individual.', 'body')]
    headers = ['Código / Empresa']
    for report_type in required:
        label = REPORTS[report_type]['label']
        headers.extend([f'Linhas de {label.lower()}', f'Total de {label.lower()}'])
    rows = [headers]
    for section in meta['sections']:
        first = section['reports'][required[0]]['job']
        row = [f'{first.get("clientCode") or "Sem código"} - {first.get("clientName") or "Empresa"}']
        for report_type in required:
            financial = section['reports'][report_type]
            row.extend([number(financial['lineCount']), money(financial['totalCents'])])
        rows.append(row)
    final = [f'TOTAL {scope.upper()}']
    for report_type in required:
        totals = meta['totalsByType'][report_type]
        final.extend([number(totals['lineCount']), money(totals['totalCents'])])
    rows.append(final)
    fractions = (.4, .12, .18, .12, .18) if len(required) == 2 else (.50, .20, .30)
    story += [purchase_table(rows, fractions, width, styles, True, padding=5), Spacer(1, 8)]
    for report_type in required:
        totals = meta['totalsByType'][report_type]
        groups = [['Classificação de ' + REPORTS[report_type]['label'].lower(), f'Valor {scope}']]
        if report_type == 'SALES':
            groups.extend([['Faturamento de vendas a optantes SN', money(totals['optantCents'])],
                           ['Faturamento de vendas a não optantes SN', money(totals['nonoptantCents'])],
                           ['Faturamento de vendas a CPFs', money(totals['cpfCents'])]])
        else:
            groups.extend([['Compras de empresas do Simples Nacional', money(totals['optantCents'])],
                           ['Compras de empresas fora do Simples', money(totals['nonoptantCents'])]])
        groups.append(['TOTAL', money(totals['totalCents'])])
        story += [purchase_table(groups, (.70, .30), width, styles, True, padding=5), Spacer(1, 6),
                  p(f'{REPORTS[report_type]["label"]} {scope}: não confirmados na fonte já incluídos em '
                    f'Não optante = {money(totals["unconfirmedCents"])}.', 'small')]
        if report_type == 'SALES':
            difal = totals['difal']
            story += [p(f'DIFAL estimado (10%) {scope}', 'heading')]
            if difal['unavailableReports'] == len(meta['sales']):
                story.append(p('Indisponível: todos os relatórios de vendas desta parte são históricos '
                               'anteriores ao cálculo do DIFAL.', 'small'))
            else:
                rows = [['Base elegível', 'DIFAL estimado (10%)', 'Linhas elegíveis', 'Linhas pendentes por UF'],
                        [money(difal['baseCents']), money(difal['amountCents']), number(difal['eligibleLines']),
                         number(difal['pendingLines'])]]
                story += [purchase_table(rows, (.30, .30, .20, .20), width, styles), Spacer(1, 4)]
                if difal['unavailableReports'] or difal['pendingLines']:
                    story.append(p(f'Estimativa parcial: {number(difal["unavailableReports"])} relatórios históricos '
                                   f'sem DIFAL disponível e {number(difal["pendingLines"])} linhas pendentes por UF. '
                                   'Os valores acima incluem somente operações elegíveis reconciliadas.', 'small'))
            story.append(p('Parâmetro médio estimado, sem equivalência automática à alíquota legal. '
                           'Exibido separadamente, sem alterar o total de vendas ou outros impostos.', 'small'))
    story += [p('Como conferir esta geração', 'heading'),
              p('As próximas páginas apresentam, por empresa e tipo de relatório, os grupos gerenciais, as bases dos percentuais '
                'e os valores usados no cálculo. Fórmula atual: Q - Y + AA - AB. A despesa acessória Z é informativa. '
                'Compras anteriores preservam Q e exibem o aviso de reimportação.', 'small'),
              p('Compras e vendas têm totais e percentuais próprios. Cada documento conta uma vez dentro de cada relatório; '
                'os percentuais não são somados entre empresas ou entre compras e vendas. A situação original dos não '
                'confirmados continua identificada no subtotal individual. Em vendas, CPFs têm grupo próprio; '
                'em compras, integram Não optante. Outros documentos não consultáveis integram Não optante nos dois '
                'relatórios. Todos compõem as bases dos percentuais. Cada linha sem documento conta separadamente.', 'small'),
              p('Este documento usa somente os snapshots salvos e reconciliados da parte indicada.', 'small')]
    if parts > 1:
        story.append(p(f'Arquivo dividido em {parts} partes de até {GENERATION_PART_SIZE} empresas. '
                       'Baixe todas as partes para obter a geração completa; os totais desta capa abrangem somente esta parte.', 'small'))
    for section in meta['sections']:
        for report_type in required:
            story.extend([PageBreak(), *purchase_story(section['reports'][report_type], width, styles)])
    on_page = purchase_page_callback(f'Geração {generation["_id"]} | Parte {part}/{parts}')
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return stream.getvalue()
