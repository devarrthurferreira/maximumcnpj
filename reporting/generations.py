"""Generation reports with separate purchase/sales snapshots and explicit company parts."""
from __future__ import annotations

from io import BytesIO
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, PageBreak

from .core import require, utcnow, display_date, number
from .anticipation import ANTICIPATION_VERSION
from .difal import DIFAL_VERSION
from .difal_policy import parse_difal_policy, direction_selection, assert_generation_available, NAMES
from .purchases import (PURCHASES_MODE, SALES_MODE, purchase_metadata, purchase_pdf_styles, purchase_story,
                        purchase_page_callback, purchase_paragraph, purchase_table, money, _check, _integer,
                        purchase_selection_view, PURCHASE_SELECTION_VERSION)

GENERATION_PART_SIZE = 10
GENERATION_COMPANY_LIMIT = 50
REPORTS = {
    'PURCHASES': {'slot': 'purchase', 'mode': PURCHASES_MODE, 'label': 'Compras'},
    'SALES': {'slot': 'sales', 'mode': SALES_MODE, 'label': 'Vendas'},
}


def tax_selection_totals():
    empty = lambda: {'baseCents': 0, 'amountCents': 0, 'eligibleLines': 0, 'pendingLines': 0,
                     'availableReports': 0, 'unavailableReports': 0}
    return {'selectedReports': 0, 'excludedReports': 0, 'unconfiguredReports': 0, 'regimeIds': [],
            'sourceEstimate': empty(), 'unconfiguredEstimate': empty()}


def add_tax_estimate(total, estimate):
    if estimate is None:
        total['unavailableReports'] += 1
    else:
        total['availableReports'] += 1
        for key in ('baseCents', 'amountCents', 'eligibleLines', 'pendingLines'):
            total[key] = _integer(total[key] + estimate[key])


def generation_metadata(db, generation_id, workspace, part=1):
    generation = db.generations.find_one({'_id': generation_id, 'workspaceId': workspace})
    require(generation, 404, 'NOT_FOUND', 'Geração não encontrada.')
    assert_generation_available(db, generation, workspace)
    companies = generation.get('companies')
    _check(isinstance(companies, list) and 1 <= len(companies) <= GENERATION_COMPANY_LIMIT)
    required = generation.get('requiredReports', ['PURCHASES'])
    _check(isinstance(required, list) and 1 <= len(required) <= 2 and
           all(isinstance(value, str) and value in REPORTS for value in required) and len(set(required)) == len(required))
    required = [report_type for report_type in REPORTS if report_type in required]
    parts = (len(companies) + GENERATION_PART_SIZE - 1) // GENERATION_PART_SIZE
    require(type(part) is int and 1 <= part <= parts, 400, 'PART', 'Parte do relatório inexistente.')
    client_ids, job_ids, history_ids = set(), set(), set()
    for company in companies:
        _check(isinstance(company, dict) and isinstance(company.get('clientId'), str) and bool(company['clientId']))
        _check(company['clientId'] not in client_ids)
        client_ids.add(company['clientId'])
        if 'difalPolicy' in company:
            parse_difal_policy(company['difalPolicy'])
        for report_type, report in REPORTS.items():
            job_id = company.get(f'{report["slot"]}JobId')
            history = company.get(f'{report["slot"]}JobIds', [])
            _check(isinstance(history, list) and all(isinstance(identity, str) and identity for identity in history))
            for identity in history:
                _check(identity not in history_ids)
                history_ids.add(identity)
            if report_type not in required:
                _check(job_id is None)
                continue
            require(isinstance(job_id, str) and bool(job_id), 409, 'GENERATION_INCOMPLETE',
                    f'Adicione e conclua {report["label"].lower()} de todas as empresas antes de emitir o PDF.')
            _check(job_id in history)
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
            'pendingLines': 0, 'unavailableReports': 0, 'legacyReports': 0, 'derivedReports': 0,
            'importedReports': 0, 'version': DIFAL_VERSION, 'ratePercent': 10, 'sourceVersions': [],
            **tax_selection_totals()}
    if 'PURCHASES' in totals_by_type:
        totals_by_type['PURCHASES']['anticipation'] = {'baseCents': 0, 'amountCents': 0, 'eligibleLines': 0,
            'pendingLines': 0, 'unavailableReports': 0, 'legacyReports': 0, 'derivedReports': 0,
            'importedReports': 0, 'version': ANTICIPATION_VERSION, 'ratePercent': 7.32, 'sourceVersions': [],
            **tax_selection_totals()}
        totals_by_type['PURCHASES']['purchaseSelection'] = {
            'version': PURCHASE_SELECTION_VERSION, 'availableReports': 0, 'unavailableReports': 0,
            'unavailableTotalCents': 0, 'unavailableLines': 0, 'complete': True,
            **{key: None for key in ('totalCents', 'lineCount', 'optantCents', 'nonoptantCents',
                                    'unconfirmedCents', 'excludedTotalCents', 'excludedLines')}}
    for company in selected:
        reports = {}
        for report_type in required:
            report = REPORTS[report_type]
            meta = purchase_metadata(db, by_id[company[f'{report["slot"]}JobId']], workspace)
            if 'difalPolicy' in company:
                meta = {**meta, 'difalPolicy': parse_difal_policy(company['difalPolicy'])}
            reports[report_type] = meta
            totals = totals_by_type[report_type]
            for key in ('totalCents', 'cnpjCents', 'nonCnpjCents', 'lineCount'):
                totals[key] = _integer(totals[key] + meta[key])
            totals['unconfirmedCents'] = _integer(totals['unconfirmedCents'] + meta['unconfirmed']['totalCents'])
            for group in meta['reportingGroups']:
                key = {'OPTANTE': 'optantCents', 'NAO_OPTANTE': 'nonoptantCents', 'CPF': 'cpfCents'}[group['status']]
                totals[key] = _integer(totals[key] + group['totalCents'])
            if report_type == 'PURCHASES':
                selection, selection_totals = meta.get('purchaseSelection'), totals['purchaseSelection']
                if not selection or not selection['available']:
                    selection_totals['unavailableReports'] += 1
                    selection_totals['complete'] = False
                    selection_totals['unavailableTotalCents'] = _integer(selection_totals['unavailableTotalCents'] + meta['totalCents'])
                    selection_totals['unavailableLines'] += meta['lineCount']
                else:
                    selection_totals['availableReports'] += 1
                    values = {'totalCents': selection['totals']['totalCents'], 'lineCount': selection['totals']['lines'],
                              'excludedTotalCents': selection['excludedTotalCents'], 'excludedLines': selection['excludedLines'],
                              'unconfirmedCents': selection['reportingGroups'][1]['unconfirmedCents'],
                              **{key: group['totalCents'] for key, group in
                                 zip(('optantCents', 'nonoptantCents'), selection['reportingGroups'])}}
                    for key, value in values.items():
                        selection_totals[key] = _integer((selection_totals[key] or 0) + value)
            tax_key = 'difal' if report_type == 'SALES' else 'anticipation'
            estimate, tax_totals = meta.get(tax_key), totals[tax_key]
            source_version = meta['job'].get(f'{tax_key}Version')
            if source_version and source_version not in tax_totals['sourceVersions']:
                tax_totals['sourceVersions'] = sorted([*tax_totals['sourceVersions'], source_version])
            choice = direction_selection(meta.get('difalPolicy'), 'exit' if report_type == 'SALES' else 'entry')
            # The source is conserved independently. A company selected in both
            # Simple scenarios contributes once to the selected report total.
            add_tax_estimate(tax_totals['sourceEstimate'], estimate)
            if choice is None:
                tax_totals['unconfiguredReports'] += 1
                add_tax_estimate(tax_totals['unconfiguredEstimate'], estimate)
            elif not choice['enabled']:
                tax_totals['excludedReports'] += 1
            else:
                tax_totals['selectedReports'] += 1
                tax_totals['regimeIds'] = [key for key in ('pure', 'hybrid') if key in set(tax_totals['regimeIds'] + choice['regimeIds'])]
                if estimate is None:
                    tax_totals['unavailableReports'] += 1
                else:
                    for key in ('baseCents', 'amountCents', 'eligibleLines', 'pendingLines'):
                        tax_totals[key] = _integer(tax_totals[key] + estimate[key])
                    tax_totals['legacyReports'] += int(source_version is not None and source_version != tax_totals['version'])
                    tax_totals['derivedReports'] += int(meta.get(f'{tax_key}Origin') == 'DERIVED_FROM_SNAPSHOT')
                    tax_totals['importedReports'] += int(meta.get(f'{tax_key}Origin') == 'IMPORTED')
        sections.append({'company': company, 'reports': reports})
    # Keep the internal purchases list for consumers of older generation metadata.
    purchases = [section['reports']['PURCHASES'] for section in sections if 'PURCHASES' in section['reports']]
    sales = [section['reports']['SALES'] for section in sections if 'SALES' in section['reports']]
    return {'generation': generation, 'requiredReports': required, 'sections': sections,
            'purchases': purchases, 'sales': sales, 'part': part, 'parts': parts,
            'companyCount': len(companies), 'firstCompany': start + 1, 'lastCompany': start + len(selected),
            'totalsByType': totals_by_type, 'totals': totals_by_type.get('PURCHASES'), 'generatedAt': utcnow()}


def selected_tax_story(total, report_type, scope, width, styles):
    p = lambda value, style='body': purchase_paragraph(value, styles, style)
    reports = lambda count: f'{number(count)} relatório' + ('s' if count != 1 else '')
    sales = report_type == 'SALES'
    title = 'DIFAL sobre vendas (10%)' if sales else 'DIFAL de entrada — Antecipação de ICMS (7,32%)'
    direction = 'saída' if sales else 'entrada'
    story = [p(f'{title} {scope}', 'heading')]
    if total['selectedReports']:
        selection_note = p(f'{reports(total["selectedReports"])} com DIFAL de {direction} selecionado. '
                           'Cenários: ' + ', '.join(NAMES[key] for key in total['regimeIds']) +
                           '. Cada empresa entra uma única vez na soma, mesmo quando os dois cenários estão selecionados.', 'small')
        selection_note.keepWithNext = True
        story.append(selection_note)
        if total['unavailableReports'] == total['selectedReports']:
            story.append(p('Indisponível: as estimativas dos relatórios selecionados não conservam todos os dados necessários. '
                           'Confira a necessidade de reimportação nas memórias individuais.', 'small'))
        else:
            rows = [['Base selecionada', 'Estimativa selecionada', 'Linhas elegíveis', 'Linhas pendentes por UF'],
                    [money(total['baseCents']), money(total['amountCents']), number(total['eligibleLines']), number(total['pendingLines'])]]
            story += [purchase_table(rows, (.30, .30, .20, .20), width, styles), Spacer(1, 4)]
            if total['unavailableReports'] or total['pendingLines']:
                story.append(p(f'Estimativa parcial: {reports(total["unavailableReports"])} sem estimativa disponível entre os selecionados e '
                               f'{number(total["pendingLines"])} linhas pendentes por UF.', 'small'))
            if total['derivedReports']:
                story.append(p(f'{reports(total["derivedReports"])} com estimativa calculada a partir dos dados salvos na origem, '
                               'após conferir a regra original, sem modificar os lotes ou as suas linhas.', 'small'))
    elif total['excludedReports'] and not total['unconfiguredReports']:
        exclusion_note = p(f'Não incluído por escolha: DIFAL de {direction} desmarcado em todas as empresas desta parte. Valor selecionado: R$ 0,00.')
        exclusion_note.keepWithNext = True
        story.append(exclusion_note)
    if total['excludedReports']:
        audit_note = p(f'{reports(total["excludedReports"])} com esta direção desmarcada: exclusão da soma selecionada. '
                       'As estimativas de origem permanecem preservadas para auditoria.', 'small')
        audit_note.keepWithNext = not total['selectedReports'] and not total['unconfiguredReports']
        story.append(audit_note)
    if total['unconfiguredReports']:
        source = total['unconfiguredEstimate']
        story.append(p(f'Auditoria de {direction} — {reports(total["unconfiguredReports"])} sem escolha de DIFAL registrada', 'heading'))
        audit_note = p('As estimativas abaixo são referências de origem e não integram a soma selecionada. '
                       'A ausência de escolha não significa imposto confirmado em zero.', 'small')
        audit_note.keepWithNext = True
        story.append(audit_note)
        if source['availableReports']:
            story += [purchase_table([['Base da origem', 'Estimativa da origem', 'Linhas elegíveis', 'Pendentes por UF'],
                [money(source['baseCents']), money(source['amountCents']), number(source['eligibleLines']), number(source['pendingLines'])]],
                (.30, .30, .20, .20), width, styles), Spacer(1, 4)]
        if source['unavailableReports']:
            story.append(p(f'{reports(source["unavailableReports"])} sem estimativa disponível nos dados salvos.', 'small'))
    story.append(p('Estimativa gerencial separada dos totais de compras e vendas. A seleção de entrada e saída é independente. '
                   'As regras de regime e sublimite são aplicadas por competência na DRE.', 'small'))
    return story


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
        headers.extend([f'Linhas de {label.lower()}', 'Compras consideradas' if report_type == 'PURCHASES' else f'Total de {label.lower()}'])
    rows = [headers]
    for section in meta['sections']:
        first = section['reports'][required[0]]['job']
        row = [f'{first.get("clientCode") or "Sem código"} - {first.get("clientName") or "Empresa"}']
        for report_type in required:
            financial = section['reports'][report_type]
            if report_type == 'PURCHASES':
                financial = purchase_selection_view(financial)
            row.extend([number(financial['lineCount']), money(financial['totalCents'])] if financial is not None else
                       ['Indisponível', 'Naturezas ausentes'])
        rows.append(row)
    final = [f'TOTAL {scope.upper()}']
    for report_type in required:
        totals = meta['totalsByType'][report_type]
        if report_type == 'PURCHASES':
            selected = totals['purchaseSelection']
            final.extend([number(selected['lineCount']), ('Parcial: ' if not selected['complete'] else '') + money(selected['totalCents'])]
                         if selected['availableReports'] else ['Indisponível', 'Naturezas ausentes'])
        else:
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
            selected = totals['purchaseSelection']
            if selected['availableReports']:
                groups[0][0] = 'Compras consideradas por natureza'
                groups.extend([['Compras de empresas do Simples Nacional', money(selected['optantCents'])],
                               ['Compras de empresas fora do Simples', money(selected['nonoptantCents'])]])
        financial_totals = totals if report_type == 'SALES' else totals['purchaseSelection']
        if report_type == 'SALES' or financial_totals['availableReports']:
            label = 'TOTAL PARCIAL — RELATÓRIOS CLASSIFICÁVEIS' if report_type == 'PURCHASES' and not financial_totals['complete'] else 'TOTAL'
            groups.append([label, money(financial_totals['totalCents'])])
            story += [purchase_table(groups, (.70, .30), width, styles, True, padding=5), Spacer(1, 6),
                      p(f'{REPORTS[report_type]["label"]} {scope}: não confirmados na fonte já incluídos em '
                        f'Não optante = {money(financial_totals["unconfirmedCents"])}.', 'small')]
        elif report_type == 'PURCHASES':
            story.append(p('Compras consideradas: indisponível nesta parte. Os relatórios não conservam '
                           'as naturezas necessárias; os valores originais permanecem na conferência abaixo.', 'small'))
        if report_type == 'PURCHASES':
            selected = totals['purchaseSelection']
            rows = [['Conferência das compras', f'Valor {scope}'],
                    ['Arquivo original de todas as empresas', money(totals['totalCents'])],
                    ['Compras consideradas nos relatórios classificáveis',
                     money(selected['totalCents']) if selected['availableReports'] else 'Indisponível'],
                    ['Fora das compras nos relatórios classificáveis',
                     money(selected['excludedTotalCents']) if selected['availableReports'] else 'Indisponível'],
                    ['Arquivo original sem seleção disponível', money(selected['unavailableTotalCents'])]]
            story += [purchase_table(rows, (.70, .30), width, styles, padding=5), Spacer(1, 5),
                      p('Compras consideradas incluem somente operações COMPRAS e serviços de prefixo 8000. '
                        'Devoluções e outras operações ficam fora dos grupos e percentuais de compras.', 'small')]
            if selected['unavailableReports']:
                story.append(p(f'{number(selected["unavailableReports"])} relatórios sem seleção por natureza disponível. '
                               'Se houver valores parciais acima, eles abrangem somente os relatórios classificáveis; '
                               'os demais não foram tratados como compras de valor zero.', 'small'))
        story += selected_tax_story(totals['difal' if report_type == 'SALES' else 'anticipation'],
                                    report_type, scope, width, styles)
    story += [p('Como conferir esta geração', 'heading'),
              p('As próximas páginas apresentam, por empresa e tipo de relatório, os grupos gerenciais, as bases dos percentuais '
                'e os valores usados no cálculo. Fórmula atual: Q - Y + AA - AB. A despesa acessória Z é informativa. '
                'Compras no formato antigo Q_V1 preservam Q e exibem o aviso de reimportação.', 'small'),
              p('Compras e vendas têm totais e percentuais próprios. Cada documento conta uma vez dentro de cada relatório; '
                'os percentuais não são somados entre empresas ou entre compras e vendas. A situação original dos não '
                'confirmados continua identificada no subtotal individual. Em vendas, CPFs têm grupo próprio; '
                'em compras, integram Não optante. Outros documentos não consultáveis integram Não optante nos dois '
                'relatórios. Nas compras, apenas as naturezas de compra e serviços 8000 compõem a base apresentada. '
                'Cada linha sem documento conta separadamente.', 'small'),
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
