import {icon} from './navigation.js';
import {REGIME_IDS,REGIME_LABELS,resolveRegimeSelection,requiresSimplesReference} from './regime-selection.js';
import {renderSection22} from './simulator-extrato-view.js';
import {renderRbt12Schedule} from './simulator-source-view.js';
import {ACCOUNTING_FIELDS,accountingSummary,analysisGuidance} from './analyses-guidance.js';

export {ACCOUNTING_FIELDS} from './analyses-guidance.js';
export const ADJUSTMENT_FIELDS=[
  ['salesOptantCents','Vendas a optantes do Simples'],['salesNonOptantCents','Vendas a não optantes'],
  ['salesCpfCents','Vendas a CPFs'],['purchasesOptantCents','Compras do Simples'],
  ['purchasesNonOptantCents','Compras fora do Simples']
];
export const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const sectorName=sector=>sector==='fiscal'?'Fiscal':'Contábil';
export const money=value=>Number.isFinite(value)?value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não informado';
export const centsInput=value=>Number.isSafeInteger(value)?(value/100).toFixed(2):'';
const reaisInput=value=>Number.isFinite(value)?value.toFixed(2):'';
const dates=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Ainda não salvo';
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const monthLabel=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')?MONTHS[Number(value.slice(5))-1]+' / '+value.slice(0,4):String(value||'Competência não informada');
export const analysisUrl=(id,sector,view)=>'/analyses.html?'+new URLSearchParams({id,...(sector?{sector}:{}),...(view?{view}:{})});

export const sectorState=(analysis,sector,options={})=>analysisGuidance(analysis,options).sectors[sector];

function tags(selection){return resolveRegimeSelection(selection).selected.map(id=>`<span class="analysis-tag">${esc(REGIME_LABELS[id])}</span>`).join('');}
function badge(state){return `<span class="analysis-tag is-${state.kind}">${esc(state.label)}</span>`;}
function savedBy(sector){return sector?.updatedAt?`Salvo em ${dates(sector.updatedAt)}${sector.updatedBy?.name?' por '+esc(sector.updatedBy.name):''}`:'Trabalho ainda não concluído.';}
const completionText=count=>`${count} de 2 setores conferidos`;
const resultUrl=analysis=>'/simulator.html?'+new URLSearchParams({simulation:analysis.currentSimulation.id});
const actionLabel=(action,canWrite=true)=>canWrite?action.label:({import:'Consultar documentos fiscais',reference:'Consultar extrato ou RBT12',fiscal:'Consultar Fiscal',accounting:'Consultar Contábil',config:'Consultar escolhas da análise','accounting-months':'Consultar competências do Contábil'}[action.action]||action.label);
function actionButton(action,{primary=false,canWrite=true}={}) {
  const writes=['generate','save-fiscal','save-accounting'];
  if(!canWrite&&writes.includes(action.action))return '';
  return `<button type="button" class="${primary?'primary':'analysis-action-link'}" data-analysis-action="${esc(action.action)}">${esc(actionLabel(action,canWrite))}${primary?'<span aria-hidden="true"> →</span>':''}</button>`;
}

function wizardFrame(kind,title,description,form) {
  return `<dialog id="analysis-wizard" class="analysis-wizard" data-wizard-kind="${kind}" aria-labelledby="analysis-wizard-title" aria-describedby="analysis-wizard-description">
    <div class="analysis-wizard-frame"><header class="analysis-wizard-header"><div><span class="analysis-eyebrow">ANÁLISE · PASSO A PASSO</span><h2 id="analysis-wizard-title" tabindex="-1">${esc(title)}</h2><p id="analysis-wizard-description">${esc(description)}</p></div><button type="button" id="analysis-wizard-close" class="analysis-wizard-close" aria-label="Fechar etapas da análise">×</button></header>
      <div id="analysis-wizard-progress"></div><div id="analysis-wizard-notices"></div>${form}
    </div></dialog>`;
}

function wizardStep(id,title,description,content,{first=false}={}) {
  return `<section class="analysis-wizard-step" data-wizard-step="${id}" ${first?'':'hidden'}><div class="analysis-wizard-step-heading"><h3 tabindex="-1" data-wizard-heading>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${content}</section>`;
}

function wizardFooter({canWrite,sector=null,finalAction='',note=''}) {
  return `<footer class="analysis-wizard-footer"><p>${esc(note||(canWrite?'Avance para conferir. Salvar grava o trabalho do setor.':'Consulta dos dados salvos. Você pode percorrer todas as etapas.'))}</p><div class="analysis-wizard-footer-actions"><button type="button" id="analysis-wizard-back" disabled>Voltar</button><div class="analysis-wizard-footer-end">${sector&&canWrite?`<button type="submit" name="intent" value="save">Salvar trabalho ${sectorName(sector)}</button>`:''}<button type="button" id="analysis-wizard-next" class="primary">Continuar</button><div data-wizard-final-actions hidden>${finalAction}</div></div></div></footer>`;
}

function reviewFacts(rows) {
  return `<dl class="analysis-wizard-facts">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

function reviewRegimes(selection) {
  try{return resolveRegimeSelection(selection).selected.map(id=>REGIME_LABELS[id]).join(' · ');}catch{return 'Seleção de regimes pendente';}
}

export function renderWizardReview(options) {
  const kind=options.modalKind||options.kind||options.wizardKind||'new';
  if(kind==='new'){
    const existing=options.existingAnalysis,company=existing?.company||options.clients?.find(item=>(item._id||item.id)===options.clientId);
    const selection=existing?.config.regimeSelection||options.selection,year=existing?.config.year||options.year;
    return `${existing?'<p class="analysis-message is-info">Você continuará o trabalho existente com os regimes, o ano e os dados já salvos.</p>':'<p class="analysis-note">Confira as escolhas antes de abrir o trabalho compartilhado.</p>'}${reviewFacts([
      ['Empresa',company?.name||'Selecione a empresa'],['Código',company?.code||'Não informado'],['CNPJ',company?.cnpj||'Não informado'],
      ['Setor de entrada',['fiscal','accounting'].includes(options.sector)?sectorName(options.sector):'Selecione o setor'],
      ['Regimes',reviewRegimes(selection)],['Ano do cenário',year||'Não informado']
    ])}<p class="analysis-note">Fiscal e Contábil podem salvar separadamente. O resultado usa os dois setores conferidos.</p>`;
  }
  const {analysis}=options;
  if(kind==='config'){
    const config=options.configDraft||analysis.config;
    const changed=reviewRegimes(config.regimeSelection)!==reviewRegimes(analysis.config.regimeSelection)||config.year!==analysis.config.year;
    return `${reviewFacts([['Regimes salvos',reviewRegimes(analysis.config.regimeSelection)],['Regimes escolhidos',reviewRegimes(config.regimeSelection)],['Ano salvo',analysis.config.year],['Ano escolhido',config.year]])}<p class="analysis-message ${changed?'is-warning':'is-info'}">${changed?'Salvar estas escolhas exige conferir os setores antes do próximo cálculo. As versões já geradas conservam os dados da época.':'As escolhas permanecem iguais às que já estão salvas nesta análise.'}</p>`;
  }
  if(kind==='fiscal'){
    const draft=options.fiscalDraft||analysis.fiscal.data,simples=requiresSimplesReference(analysis.config.regimeSelection);
    const company=options.generation?.companies?.find(item=>item.clientId===analysis.clientId);
    const months=options.source?.monthlyReports?.map(row=>row.sourceMonth)||analysis.readiness?.months||[];
    const report=key=>company?.[key]?`${company[key].fileName||'Relatório vinculado'} · ${company[key].status==='COMPLETED'?'leitura concluída':'leitura pendente'}`:'Documento ainda não informado';
    const rows=[['Entradas',report('purchase')],['Saídas',report('sales')],['Competências',months.length?months.map(monthLabel).join(' · '):'Aguardando os relatórios'],
      ['Regimes do cenário',reviewRegimes(analysis.config.regimeSelection)],['Ano do cenário',analysis.config.year],['Atividade das vendas',draft.salesAnnex===2?'Indústria · Anexo II':'Comércio · Anexo I']];
    if(simples){
      rows.push(['Referência do Simples',draft.rbt12Source==='MANUAL'?`Informação manual · ${draft.rbt12ManualConfirmed?'confirmada':'confirmação pendente'}`:draft.rbt12ExtractionId?options.reference?.fileName||'Extrato vinculado':'Extrato ainda não confirmado'],
        ['RBT12 informada',money(draft.rbt12)],['Categoria dos serviços',`Anexo ${({3:'III',4:'IV',5:'V'})[draft.serviceAnnex]||'a conferir'}`],['ICMS e ISS no cenário',draft.icmsOutside?'Fora do DAS':'Dentro do DAS']);
      for(const id of resolveRegimeSelection(analysis.config.regimeSelection).selected.filter(id=>['pure','hybrid'].includes(id))){
        const enabled=draft.difalPolicy?.enabled?.[id],operations=draft.difalPolicy?.operations?.[id];
        rows.push([`DIFAL · ${REGIME_LABELS[id]}`,enabled?[operations?.entry?'Entrada':null,operations?.exit?'Saída':null].filter(Boolean).join(' e ')||'Nenhuma operação selecionada':'Não incluído']);
      }
    }else rows.push(['Referência do Simples','Não exigida para os regimes selecionados']);
    rows.push(['Ajustes por competência',draft.monthlyOverrides?.length?`${draft.monthlyOverrides.length} competência(s) com ajustes informados`:'Valores dos relatórios fiscais']);
    return `${options.configDirty?'<p class="analysis-message is-warning">Salve as escolhas da análise antes de concluir o Fiscal.</p>':''}${reviewFacts(rows)}<p class="analysis-note">Concluir Fiscal confirma estes dados. Os documentos e a referência serão conferidos antes de concluir.</p><p class="analysis-note">${savedBy(analysis.fiscal)}</p>`;
  }
  return '';
}

export function regimeChoices(selection,prefix='analysis-regime',disabled=false) {
  const chosen=resolveRegimeSelection(selection).selected;
  const descriptions={pure:'Tributos do Simples no DAS.',hybrid:'Simples com CBS e IBS no regime regular.',presumed:'Comparação pelo Lucro Presumido.',actual:'Comparação pelo Lucro Real.'};
  return `<fieldset class="analysis-regime-options"><legend>Quais regimes deseja analisar?</legend>${REGIME_IDS.map(id=>`<label for="${prefix}-${id}"><input id="${prefix}-${id}" type="checkbox" name="regime" value="${id}" ${chosen.includes(id)?'checked':''} ${disabled?'disabled':''}><span><strong>${esc(REGIME_LABELS[id])}</strong><small>${descriptions[id]}</small></span></label>`).join('')}</fieldset>`;
}

export function companyResults(clients,selected,search) {
  const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const term=fold(search).trim(),digits=term.replace(/\D/g,'');
  const items=term?clients.filter(client=>fold(`${client.code||''} ${client.name||''} ${client.cnpj||''}`).includes(term)||(/^[\d.\/-]+$/.test(term)&&digits&&String(client.cnpj||'').replace(/\D/g,'').includes(digits))):clients.filter(client=>client._id===selected);
  return {count:items.length,html:items.slice(0,20).map(client=>`<button type="button" class="analysis-company-pick" data-analysis-client="${esc(client._id)}" aria-pressed="${client._id===selected}"><span class="analysis-company-code">${esc(client.code||'—')}</span><span><strong>${esc(client.name)}</strong><small>${esc(client.cnpj||'CNPJ não informado')}${client.active===false?' · cadastro inativo':''}</small></span><span aria-hidden="true">${client._id===selected?'✓':'→'}</span></button>`).join('')||`<div class="analysis-note">${term?'Nenhuma empresa encontrada. Tente outro código, nome ou CNPJ.':'Busque a empresa para começar.'}</div>`};
}

export function renderNewCompanyContext({existingAnalysis=null,checkingCompany=false,companyCheckError=''}) {
  if(checkingCompany)return '<p class="analysis-company-check" role="status">Conferindo o trabalho já salvo desta empresa…</p>';
  if(companyCheckError)return `<div class="analysis-message is-warning" role="status"><strong>Não foi possível conferir esta empresa.</strong><p>${esc(companyCheckError)}</p><button type="button" id="analysis-company-retry">Tentar novamente</button></div>`;
  if(!existingAnalysis)return '';
  const guidance=analysisGuidance(existingAnalysis);
  return `<div class="analysis-existing-work"><div><span class="analysis-eyebrow">TRABALHO ENCONTRADO</span><h2>Continue a análise desta empresa</h2><p>${esc(guidance.label)} · ${completionText(guidance.confirmedCount)} · Cenário ${esc(existingAnalysis.config.year)}</p></div><div class="analysis-tags">${tags(existingAnalysis.config.regimeSelection)}</div><p>Os regimes, o ano e os dados acima já estão salvos. Escolha o setor para continuar; as configurações podem ser ajustadas dentro da análise.</p></div>`;
}

export function renderNewAnalysis(options) {
  const {clients,clientId,search,selection,sector,year,canWrite,existingAnalysis=null,checkingCompany=false,companyCheckError=''}=options;
  const results=companyResults(clients,clientId,search),chosen=existingAnalysis?.config.regimeSelection||selection,chosenYear=existingAnalysis?.config.year||year;
  const blocked=checkingCompany||!!companyCheckError||!clientId||!canWrite&&!existingAnalysis;
  const companyStep=`<label for="analysis-company-search">Código, nome ou CNPJ da empresa<input id="analysis-company-search" type="search" autocomplete="off" value="${esc(search)}" placeholder="Buscar empresa…" aria-controls="analysis-company-results"></label>
      <p id="analysis-company-count" class="analysis-note" role="status">${results.count?`${results.count} empresa(s) encontrada(s)${results.count>20?' · refine a busca para ver as demais':''}`:'Os resultados aparecem enquanto você digita.'}</p>
      <div id="analysis-company-results" class="analysis-company-results">${results.html}</div><input type="hidden" id="analysis-new-client" value="${esc(clientId)}">
      <div id="analysis-new-company-context" aria-live="polite">${renderNewCompanyContext({existingAnalysis,checkingCompany,companyCheckError})}</div>`;
  const sectorStep=`<fieldset class="analysis-new-sector"><legend>Em qual setor vai trabalhar agora?</legend><label><input type="radio" name="sector" value="fiscal" ${sector==='fiscal'?'checked':''} required><span><strong>Fiscal</strong><small>Entradas, saídas e referência do Simples quando necessária.</small></span></label><label><input type="radio" name="sector" value="accounting" ${sector==='accounting'?'checked':''} required><span><strong>Contábil</strong><small>Despesas por competência, inclusive antes dos arquivos fiscais.</small></span></label></fieldset>`;
  const regimesStep=`<fieldset id="analysis-new-config" class="analysis-new-config" ${!canWrite||checkingCompany||companyCheckError?'disabled':''}>
        <legend>Escolhas da nova análise</legend>${regimeChoices(chosen,'analysis-new-regime')}
        <div class="analysis-form-grid"><label>Ano do cenário<select id="analysis-new-year"><option value="2027" ${chosenYear===2027?'selected':''}>2027</option><option value="2028" ${chosenYear===2028?'selected':''}>2028</option></select><small>As competências dos documentos serão conferidas separadamente.</small></label></div>
      </fieldset>`;
  const form=`<form id="analysis-new-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body">
      ${wizardStep('company','Selecione a empresa','O trabalho já salvo será identificado para você retomar.',companyStep,{first:true})}
      ${wizardStep('sector','Escolha o setor','Você poderá alternar entre Fiscal e Contábil durante a análise.',sectorStep)}
      ${wizardStep('regimes','Regimes e ano do cenário','Escolha os regimes que deseja comparar nesta análise.',regimesStep)}
      ${wizardStep('review','Confira antes de continuar','Revise a empresa e as escolhas do trabalho.',`<div id="analysis-wizard-review">${renderWizardReview({...options,modalKind:'new'})}</div>`)}
    </div>${wizardFooter({canWrite,finalAction:`<button class="primary" id="analysis-open-company" type="submit" ${blocked?'disabled':''}>${checkingCompany?'Conferindo empresa…':existingAnalysis?'Continuar análise':'Abrir análise da empresa'}</button>`,note:'Na última etapa, confira os dados e abra o trabalho da empresa.'})}</form>`;
  return `<a class="analysis-back" href="/analyses.html">← Todas as análises</a><div class="analysis-heading"><div><span class="analysis-eyebrow">ABRIR UM TRABALHO</span><h1>Uma análise, uma etapa de cada vez.</h1><p>Escolha a empresa, o setor e os regimes. Se já houver um trabalho salvo, você continuará nele.</p></div></div><section class="analysis-panel analysis-new-intro"><div>${icon('start')}<h2>Prepare ou retome a análise da empresa</h2><p>O assistente organiza as escolhas em etapas curtas. Você poderá conferir tudo antes de continuar.</p></div><button type="button" id="analysis-resume-new" class="primary" aria-haspopup="dialog">Abrir passo a passo</button></section>${wizardFrame('new','Abrir análise da empresa','Selecione a empresa e confirme por onde deseja começar.',form)}`;
}

function companyCard(analysis,canWrite) {
  const guidance=analysisGuidance(analysis),current=analysis.currentSimulation;
  const href=guidance.state==='current'?resultUrl(analysis):guidance.state==='ready'?analysisUrl(analysis.id,null,'review'):analysisUrl(analysis.id,guidance.primaryAction.sector||'fiscal');
  const description=canWrite||guidance.state==='current'?guidance.primaryAction.message:guidance.state==='ready'?'Os dois setores estão conferidos e aguardam a geração pela equipe.':'Consulte as pendências e os dados salvos de cada setor.';
  return `<article class="analysis-company-card" data-analysis-id="${esc(analysis.id)}" data-analysis-state="${guidance.state}">
    <div class="analysis-company-status">${badge(guidance)}<small>${completionText(guidance.confirmedCount)}</small></div>
    <div class="analysis-company-title"><span class="analysis-company-code">${esc(analysis.company?.code||'—')}</span><div><h2>${esc(analysis.company?.name||'Empresa')}</h2><p>${analysis.company?.cnpj?esc(analysis.company.cnpj)+' · ':''}Cenário ${esc(analysis.config.year)}</p></div></div>
    <div class="analysis-tags">${tags(analysis.config.regimeSelection)}</div>
    <div class="analysis-sector-progress">${['fiscal','accounting'].map(sector=>{const state=guidance.sectors[sector];return `<a href="${analysisUrl(analysis.id,sector)}" class="${state.complete?'is-complete':''}" data-continue-sector="${sector}" data-analysis-sector="${sector}"><span><strong>${sectorName(sector)}</strong><small>${esc(state.label)}</small></span><span aria-hidden="true">${state.complete?'✓':'→'}</span></a>`;}).join('')}</div>
    <div class="analysis-card-next"><p>${esc(description)}</p><a class="analysis-button ${guidance.state==='current'?'':'primary'}" data-analysis-next="${guidance.primaryAction.action}" href="${href}">${esc(guidance.state==='ready'?canWrite?'Conferir e '+(current?'atualizar':'gerar'):'Consultar análise':actionLabel(guidance.primaryAction,canWrite))} →</a></div>
    ${current&&guidance.state!=='current'?`<a class="analysis-previous-result" href="${resultUrl(analysis)}">Ver resultado anterior · ${dates(current.createdAt)}</a>`:''}
    <div class="analysis-company-footer"><p>Atualizada em ${dates(analysis.updatedAt)}</p><a href="${analysisUrl(analysis.id)}">Abrir empresa →</a></div>
  </article>`;
}

export function renderAnalysisList({items,pagination,search,canWrite}) {
  const states=items.map(item=>analysisGuidance(item).state),count=state=>states.filter(value=>value===state).length;
  return `<div class="analysis-heading"><div><span class="analysis-eyebrow">CARTEIRA · FISCAL E CONTÁBIL</span><h1>Suas análises, com o próximo passo à vista.</h1><p>Retome o setor que precisa de atenção ou abra o resultado já atualizado. Cada empresa reúne o trabalho dos dois setores.</p></div>${canWrite?`<div class="analysis-heading-actions"><a class="analysis-button primary" href="/analyses.html?view=new">${icon('start')}Nova análise</a></div>`:''}</div>
    <section class="analysis-overview" aria-label="Situação das análises"><article><span>Análises encontradas</span><strong>${pagination.total}</strong><small>${search?'Busca atual':'Uma análise corrente por empresa'}</small></article><article data-analysis-count="working"><span>Em andamento</span><strong>${count('working')}</strong><small>Setores ou dados a conferir nesta página</small></article><article data-analysis-count="ready"><span>Prontas para gerar</span><strong>${count('ready')}</strong><small>Primeiro resultado ou atualização nesta página</small></article><article data-analysis-count="current"><span>Resultado atual</span><strong>${count('current')}</strong><small>Sem alterações pendentes nesta página</small></article></section>
    <form class="analysis-filter-bar" id="analysis-search-form"><label for="analysis-search">Buscar análise<input id="analysis-search" type="search" maxlength="100" autocomplete="off" value="${esc(search)}" placeholder="Nome, código ou CNPJ da empresa"></label><button type="submit">Buscar</button></form>
    ${items.length?`<div class="analysis-company-list">${items.map(item=>companyCard(item,canWrite)).join('')}</div>`:`<section class="analysis-empty">${icon('companies')}<h2>${search?'Nenhuma análise nesta busca':'A próxima análise começa pela empresa'}</h2><p>${search?'Tente outro nome, código ou CNPJ. Os relatórios e as versões anteriores continuam disponíveis.':'Escolha a empresa e comece pelo Fiscal ou pelo Contábil. Cada setor pode salvar seu trabalho e continuar depois.'}</p>${canWrite?'<a class="analysis-button primary" href="/analyses.html?view=new">Nova análise</a>':''}</section>`}
    <div class="analysis-pagination"><button type="button" data-analysis-page="${pagination.page-1}" ${pagination.page<=1?'disabled':''}>Anterior</button><p>Página ${pagination.page} de ${Math.max(1,pagination.totalPages)}</p><button type="button" data-analysis-page="${pagination.page+1}" ${pagination.page>=pagination.totalPages?'disabled':''}>Próxima</button></div><div class="analysis-footer-links"><span>Seu trabalho anterior continua disponível:</span><a href="/generations.html?view=history">Relatórios importados</a><a href="/simulations.html">Histórico de versões</a>${canWrite?'<a href="/generations.html">Importar relatórios avulsos</a>':''}</div>`;
}

function configPanel(options) {
  const {analysis,canWrite}=options,config=options.configDraft||analysis.config;
  const choices=`<div id="analysis-settings">${regimeChoices(config.regimeSelection)}<div class="analysis-form-grid analysis-config-year"><label>Ano do cenário<select id="analysis-config-year"><option value="2027" ${config.year===2027?'selected':''}>2027</option><option value="2028" ${config.year===2028?'selected':''}>2028</option></select></label></div><p class="analysis-note">Alterar os regimes ou o ano exige conferir os setores antes do próximo cálculo.</p></div>`;
  const form=`<form id="analysis-config-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('choices','Regimes e ano','Estas escolhas serão compartilhadas entre Fiscal e Contábil.',choices,{first:true})}
      ${wizardStep('review','Confira as alterações','As versões anteriores conservam as escolhas e os valores já registrados.',`<div id="analysis-wizard-review">${renderWizardReview({...options,modalKind:'config'})}</div>`)}
    </fieldset></div>${wizardFooter({canWrite,finalAction:canWrite?'<button type="submit" id="analysis-save-config" class="primary">Salvar escolhas da análise</button>':'',note:canWrite?'As novas escolhas serão gravadas ao salvar na última etapa.':'Consulta das escolhas salvas desta análise.'})}</form>`;
  return wizardFrame('config','Regimes e ano da análise',analysis.company?.name||'Confira as escolhas desta empresa.',form);
}

function sectorChooser(analysis,options) {
  return `<section class="analysis-sectors-overview" aria-label="Setores da análise"><div class="analysis-sector-choice">${['fiscal','accounting'].map(sector=>`<a class="analysis-sector-tab analysis-sector-card" href="${analysisUrl(analysis.id,sector)}" data-analysis-sector="${sector}" aria-haspopup="dialog"><div class="analysis-sector-card-heading"><strong>${icon(sector==='fiscal'?'report':'companies')}${sectorName(sector)}</strong><span data-analysis-sector-status="${sector}">${badge(sectorState(analysis,sector,options))}</span></div><p>${sector==='fiscal'?'Documentos → Tributação e referência → Revisão':'Competências e colagem → Despesas → Conferência'}</p><small>${savedBy(analysis[sector])}</small><b>${options.canWrite?'Abrir etapas':'Consultar etapas'} do ${sectorName(sector)} <span aria-hidden="true">→</span></b></a>`).join('')}</div></section>`;
}

function fiscalReports({analysis,generation,generationError,canWrite}) {
  const data=analysis.fiscal.data,company=generation?.companies?.find(item=>item.clientId===analysis.clientId);
  const slots=[['PURCHASES','Entradas','Compras e devoluções de venda.','purchase','purchaseJobId'],['SALES','Saídas','Vendas de mercadorias e serviços.','sales','salesJobId']];
  return `<div class="analysis-fiscal-documents">${generationError?`<p class="analysis-message is-warning">${esc(generationError)}</p>`:''}<div class="analysis-document-list">${slots.map(([type,label,description,key,idKey])=>{
    const job=company?.[key],jobId=company?.[idKey]||job?._id,complete=job?.status==='COMPLETED';
    const href=data.generationId?'/purchases.html?'+new URLSearchParams({generation:data.generationId,client:analysis.clientId,type,guided:'1',analysis:analysis.id,...(jobId?{job:jobId}:{})}):null;
    const state={label:complete?'Leitura concluída':job?.status==='PROCESSING'?'Consulta em andamento':job?.status==='UPLOADING'?'Importação incompleta':'Aguardando documento',kind:complete?'ready':'pending'};
    return `<article class="analysis-document" data-analysis-document="${type}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>${label}</h3><p>${description}</p>${job?.fileName?`<p>${esc(job.fileName)}</p>`:''}${badge(state)}</div>${href&&(canWrite||job)?`<div class="analysis-document-actions"><a class="analysis-button ${complete?'':'primary'}" href="${href}">${complete?'Conferir relatório':job?'Retomar leitura':'Adicionar documento'} →</a></div>`:''}</article>`;
  }).join('')}</div>${canWrite?`<div class="analysis-actions analysis-import-actions"><button type="button" id="analysis-start-import" ${generationError?'disabled':''}>${data.generationId?'Substituir os relatórios fiscais':'Preparar importação de entradas e saídas'}</button></div>`:''}${data.generationId?`<p class="analysis-note">As leituras pertencem a esta análise. <a href="/generations.html?${new URLSearchParams({id:data.generationId,analysis:analysis.id,client:analysis.clientId})}">Conferir os relatórios desta empresa</a>.</p><p class="analysis-note">Os relatórios conservam as opções de DIFAL desta importação. A simulação usa as escolhas atuais após concluir o Fiscal.</p>`:''}</div>`;
}

function extratoPanel({analysis,draft,reference,schedule,documentStatus,pdfStatus,pdfBusy,canWrite}) {
  if(!requiresSimplesReference(analysis.config.regimeSelection))return '<div class="analysis-message is-info">A análise seleciona somente Lucro Presumido e/ou Lucro Real. O extrato e a RBT12 do Simples não são exigidos.</div>';
  const manual=draft.rbt12Source==='MANUAL',stored=draft.rbt12DocumentId,hasReference=!!reference;
  return `<section class="analysis-extrato"><h3 class="analysis-subheading">Extrato do Simples Nacional</h3><p class="analysis-note">Necessário porque a análise inclui Simples Puro ou Híbrido. O extrato informa a RBT12; ele não é substituído pela projeção da receita.</p><div class="analysis-actions analysis-rbt12-modes"><button type="button" id="analysis-extrato-pdf" aria-pressed="${!manual}" ${!manual?'disabled':''}>Usar extrato em PDF</button><button type="button" id="analysis-extrato-manual" aria-pressed="${manual}" ${manual?'disabled':''}>Informar RBT12 sem o PDF</button></div>${manual?`<div class="analysis-manual-rbt12"><label for="analysis-rbt12">RBT12 efetiva dos 12 meses anteriores (R$)<input id="analysis-rbt12" type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" value="${reaisInput(draft.rbt12)}" placeholder="Informe o valor efetivo"></label><label class="analysis-check"><input type="checkbox" id="analysis-rbt12-confirm" ${draft.rbt12ManualConfirmed?'checked':''}>Confirmo a receita bruta efetiva dos 12 meses anteriores ao período de apuração. O valor ficará identificado como manual e fixo nas competências.</label></div>`:`<div class="analysis-upload"><label for="analysis-rbt12-pdf">Extrato ou declaração PGDAS-D (PDF)<input id="analysis-rbt12-pdf" type="file" accept="application/pdf,.pdf" ${!canWrite||pdfBusy?'disabled':''}></label><p>Selecione o PDF para armazenar e ler a seção 2.2 · até 8 MiB.</p>${canWrite?`<div class="analysis-actions"><button type="button" id="analysis-read-selected-pdf" ${pdfBusy?'disabled':''}>Ler PDF selecionado</button></div>`:''}<p id="analysis-pdf-status" class="analysis-upload-status" role="status" aria-live="polite">${esc(pdfStatus|| (hasReference?'Leitura confirmada. Confira a seção 2.2 abaixo.':stored?'Há um PDF vinculado. Confira a leitura ou tente novamente.':'Nenhum extrato confirmado nesta análise.'))}</p>${stored?`<div class="analysis-document-actions"><a class="analysis-button" target="_blank" rel="noopener noreferrer" href="/api/v4/simples-documents/${encodeURIComponent(stored)}/file?kind=original">Ver original</a>${reference?.searchableStored!==false&&hasReference?`<a class="analysis-button" target="_blank" rel="noopener noreferrer" href="/api/v4/simples-documents/${encodeURIComponent(stored)}/file?kind=searchable">Ver PDF pesquisável</a>`:''}<button type="button" id="analysis-extrato-status" ${pdfBusy?'disabled':''}>Verificar leitura</button>${canWrite?`<button type="button" id="analysis-extrato-retry" ${pdfBusy||documentStatus?.retryable===false?'disabled':''}>Ler novamente</button>`:''}</div>`:''}</div>${hasReference?`<div class="analysis-reference"><span class="analysis-eyebrow">SEÇÃO 2.2 · PA ${esc(reference.pa)}</span><strong>${money(reference.rbt12Cents/100)}</strong><p>Referência do extrato. A janela de cada competência será conferida antes de concluir o Fiscal.</p><details><summary>Conferir a leitura do extrato</summary>${renderSection22(reference)}</details>${schedule?`<details><summary>RBT12 por competência${schedule.complete?'':' · há janelas pendentes'}</summary>${renderRbt12Schedule(schedule)}</details>`:''}</div>`:''}`}</section>`;
}

function difalOptions(selection,policy) {
  const selected=resolveRegimeSelection(selection).selected.filter(id=>['pure','hybrid'].includes(id));
  if(!selected.length)return '';
  return `<div class="analysis-difal-options">${selected.map(id=>`<fieldset data-analysis-difal="${id}"><legend>${esc(REGIME_LABELS[id])} · DIFAL</legend><label class="analysis-check"><input type="checkbox" data-analysis-difal-enabled="${id}" ${policy?.enabled?.[id]?'checked':''}>Incluir DIFAL neste cenário</label>${[['entry','Entrada · antecipação das compras'],['exit','Saída · vendas']].map(([operation,label])=>`<label class="analysis-check"><input type="checkbox" data-analysis-difal-operation="${operation}" data-analysis-difal-regime="${id}" ${policy?.operations?.[id]?.[operation]?'checked':''} ${!policy?.enabled?.[id]?'disabled':''}>${label}</label>`).join('')}</fieldset>`).join('')}</div><p class="analysis-note">Entrada e saída são independentes. Os bloqueios por competência e ICMS fora do DAS continuam sendo verificados no cálculo.</p>`;
}

function fiscalAdjustments(draft,source,canWrite) {
  const rows=draft.monthlyOverrides;
  return `<details class="analysis-adjustments" id="analysis-fiscal-adjustments"><summary>Ajustes de receitas e compras por competência${rows?.length?` · ${rows.length} competência(s) registrada(s)`:''}</summary><p class="analysis-note">Os documentos permanecem preservados. Informe valores finais após devoluções. Ajustes de compras alteram o custo, sem criar crédito de ICMS de documentos.</p>${rows?.length?`<div class="analysis-expenses">${rows.map(row=>`<section class="analysis-expense-month" data-fiscal-month="${esc(row.sourceMonth)}"><header><h3>${esc(monthLabel(row.sourceMonth))}</h3><p>Valores do cenário em reais</p></header><div class="analysis-expense-fields">${ADJUSTMENT_FIELDS.map(([key,label],index)=>`<label>${label}<input type="number" step="0.01" ${index>2?'min="0"':''} inputmode="decimal" data-fiscal-field="${key}" value="${reaisInput(row.groups?.[key])}" placeholder="Valor após devoluções"></label>`).join('')}<label>Receita de serviços<input type="number" min="0" step="0.01" inputmode="decimal" data-fiscal-field="serviceRevenue" value="${reaisInput(row.serviceRevenue)}" placeholder="Serviços da competência"></label></div></section>`).join('')}</div>${canWrite?'<button type="button" id="analysis-clear-adjustments">Usar novamente os valores dos relatórios</button>':''}`:canWrite&&source?.monthlyReports?.length?'<button type="button" id="analysis-edit-adjustments">Editar valores por competência</button>':'<p class="analysis-note">Nenhum ajuste manual registrado. Os valores serão os dos relatórios conciliados.</p>'}</details>`;
}

function fiscalPanel(options) {
  const {analysis,fiscalDraft:draft,canWrite,configDirty}=options,simples=requiresSimplesReference(analysis.config.regimeSelection);
  const tax=`${extratoPanel({...options,draft})}<div class="analysis-form-grid analysis-fiscal-options"><label>Atividade das vendas<select id="analysis-sales-annex"><option value="1" ${draft.salesAnnex===1?'selected':''}>Comércio · Anexo I</option><option value="2" ${draft.salesAnnex===2?'selected':''}>Indústria · Anexo II</option></select></label>${simples?`<label>Categoria dos serviços<select id="analysis-service-annex"><option value="3" ${draft.serviceAnnex===3?'selected':''}>Anexo III</option><option value="4" ${draft.serviceAnnex===4?'selected':''}>Anexo IV</option><option value="5" ${draft.serviceAnnex===5?'selected':''}>Anexo V</option></select></label>`:''}${simples?`<label class="full">ICMS e ISS no cenário do Simples<select id="analysis-icms-outside"><option value="inside" ${!draft.icmsOutside?'selected':''}>Dentro do DAS</option><option value="outside" ${draft.icmsOutside?'selected':''}>Fora do DAS · situação já confirmada</option></select><small>A escolha não é automática pelo limite de receita. Confirme a situação aplicável à empresa.</small></label>`:''}</div>${difalOptions(analysis.config.regimeSelection,draft.difalPolicy)}${fiscalAdjustments(draft,options.source,canWrite)}`;
  const form=`<form id="analysis-fiscal-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('documents','Entradas e saídas','Adicione os documentos da empresa ou retome as leituras que já começaram.',fiscalReports(options),{first:true})}
      ${wizardStep('tax','Tributação e referência','Confira as opções fiscais e a referência exigida pelos regimes escolhidos.',tax)}
      ${wizardStep('review','Revise o Fiscal','Confira o vínculo dos documentos e as opções antes de concluir o setor.',`<div id="analysis-wizard-review">${renderWizardReview({...options,modalKind:'fiscal'})}</div>`)}
    </fieldset></div>${wizardFooter({canWrite,sector:'fiscal',finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Concluir Fiscal</button>`:''})}</form>`;
  return wizardFrame('fiscal','Setor Fiscal',analysis.company?.name||'Documentos e opções fiscais da empresa.',form);
}

function accountingMonth(row,canWrite) {
  const complete=ACCOUNTING_FIELDS.every(([key])=>Number.isSafeInteger(row[key])&&row[key]>=0),total=complete?ACCOUNTING_FIELDS.reduce((sum,[key])=>sum+row[key],0):null;
  return `<section class="analysis-expense-month" data-accounting-month="${esc(row.sourceMonth)}"><header><div><h3>${esc(monthLabel(row.sourceMonth))}</h3><p>Valores desta competência, em reais</p></div>${canWrite?`<div class="analysis-actions"><button type="button" data-zero-month="${esc(row.sourceMonth)}" title="Use somente quando não houver despesa nas categorias ainda em branco.">Preencher vazios com zero</button><button type="button" data-remove-month="${esc(row.sourceMonth)}" aria-label="Remover ${esc(monthLabel(row.sourceMonth))}">Remover mês</button></div>`:''}</header><div class="analysis-expense-fields">${ACCOUNTING_FIELDS.map(([key,label])=>`<label>${label} (R$)<input type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" data-accounting-field="${key}" value="${centsInput(row[key])}" placeholder="Não informado" aria-label="${esc(label+' em '+monthLabel(row.sourceMonth))}"></label>`).join('')}</div><div class="analysis-expense-total"><span>Despesas desta competência</span><strong data-accounting-total>${total===null?'Preenchimento incompleto':money(total/100)}</strong></div></section>`;
}

export function renderAccountingSummary({months=[],expectedMonths=[]}) {
  const summary=accountingSummary(months,expectedMonths);
  const amount=value=>value===null?'Sem valores informados':money(value/100);
  return `<div class="analysis-summary-heading"><div><h3>Resumo do preenchimento</h3><p>${summary.monthCount?'Valores registrados nos campos desta análise.':'Adicione uma competência para começar a registrar as despesas.'}</p></div>${badge({kind:summary.complete?'ready':'pending',label:summary.complete?'Valores preenchidos':'Preenchimento pendente'})}</div>
    <div class="analysis-accounting-totals">
      <div><span>Total preenchido</span><strong data-accounting-summary-total>${amount(summary.enteredCents)}</strong><small>${summary.filledFields} campo(s) informado(s)${summary.missingFields?' · subtotal dos valores disponíveis':''}</small></div>
      <div><span>Competências preenchidas</span><strong data-accounting-summary-months>${summary.monthCount?summary.completeMonths+' / '+summary.monthCount:'A definir'}</strong><small>Com as cinco categorias informadas</small></div>
      <div><span>Campos que faltam</span><strong data-accounting-summary-missing>${summary.monthCount?summary.missingFields:'—'}</strong><small>${summary.missingMonths.length?`${summary.missingMonths.length} competência(s) do Fiscal ainda não adicionada(s)`:summary.monthCount?'Campos em branco permanecem pendentes':'Competências ainda não adicionadas'}</small></div>
    </div>
    <p class="analysis-summary-note">${summary.complete?'O preenchimento está completo. A conferência do setor é registrada ao clicar em Concluir Contábil.':'O total preenchido soma apenas valores informados. Campos vazios e meses ausentes continuam pendentes; registre zero quando não houver despesa.'}</p>
    ${summary.missingMonths.length?`<p class="analysis-summary-alert"><strong>Adicionar do Fiscal:</strong> ${summary.missingMonths.map(month=>esc(monthLabel(month))).join(' · ')}.</p>`:''}
    ${summary.extraMonths.length?`<p class="analysis-summary-alert"><strong>Conferir a cobertura:</strong> ${summary.extraMonths.map(month=>esc(monthLabel(month))).join(' · ')} não consta(m) nos relatórios fiscais. As competências precisam coincidir antes da geração.</p>`:''}
    ${summary.monthCount?`<details class="analysis-accounting-breakdown" id="analysis-accounting-breakdown"><summary>Conferir valores por categoria e competência</summary><div class="analysis-accounting-breakdown-grid">
      <section><h4>Por categoria</h4><dl class="analysis-cost-list">${summary.categories.map(category=>`<div data-accounting-category="${category.key}"><dt>${esc(category.label)}<small>${category.filledMonths} de ${summary.monthCount} competência(s) informada(s)</small></dt><dd>${amount(category.enteredCents)}${category.missingMonths.length?`<small>${category.missingMonths.length} pendente(s)</small>`:''}</dd></div>`).join('')}</dl></section>
      <section><h4>Por competência</h4><dl class="analysis-cost-list">${summary.rows.map(row=>`<div data-accounting-summary-month="${esc(row.sourceMonth)}"><dt>${esc(monthLabel(row.sourceMonth))}<small>${row.present?`${row.filledFields} de ${ACCOUNTING_FIELDS.length} categorias informadas`:'Competência ainda não adicionada'}</small></dt><dd>${amount(row.enteredCents)}${row.missingFields.length?`<small>${row.missingFields.length} campo(s) pendente(s)</small>`:''}</dd></div>`).join('')}</dl></section>
    </div></details>`:''}`;
}

function accountingPanel(options) {
  const {analysis,accountingDraft,canWrite,configDirty,source}=options;
  const months=accountingDraft.months||[],sourceMonths=source?.monthlyReports?.length?source.monthlyReports.map(row=>row.sourceMonth):analysis.readiness?.months||[],missing=sourceMonths.filter(month=>!months.some(row=>row.sourceMonth===month));
  const monthsContent=`${sourceMonths.length?`<p class="analysis-note"><strong>Competências dos relatórios fiscais:</strong> ${sourceMonths.map(month=>esc(monthLabel(month))).join(' · ')}</p>`:'<p class="analysis-note">Você pode começar antes do Fiscal. Depois da importação, as competências dos dois setores serão conferidas.</p>'}
    ${canWrite?`<div class="analysis-add-month"><label for="analysis-new-month">Adicionar competência<input type="month" id="analysis-new-month" min="2000-01" max="2099-12"></label><button type="button" id="analysis-add-month">Adicionar mês</button>${missing.length?`<button type="button" id="analysis-add-fiscal-months">Adicionar ${missing.length} competência(s) do Fiscal</button>`:''}</div>`:''}
    <div id="analysis-accounting-import"></div><div class="analysis-month-selection"><h4>Competências adicionadas · ${months.length}</h4>${months.length?`<ul class="analysis-month-chips">${months.map(row=>`<li>${esc(monthLabel(row.sourceMonth))}</li>`).join('')}</ul>`:'<p class="analysis-note">Adicione os meses ou aplique a colagem para continuar para as despesas.</p>'}</div>`;
  const valuesContent=`<div class="analysis-expenses" id="analysis-expenses">${months.length?months.map(row=>accountingMonth(row,canWrite)).join(''):'<div class="analysis-empty"><h3>Nenhuma competência informada</h3><p>Volte à etapa de competências para adicionar os meses ou aplicar a colagem.</p></div>'}</div><p class="analysis-note">Uma despesa deve aparecer uma única vez. “Preencher vazios com zero” registra sua confirmação de que não houve despesa nas categorias pendentes daquele mês.</p>`;
  const reviewContent=`${configDirty?'<p class="analysis-message is-warning">Salve as escolhas da análise antes de concluir o Contábil.</p>':''}<div id="analysis-accounting-summary" class="analysis-accounting-summary" aria-label="Resumo das despesas informadas">${renderAccountingSummary({months,expectedMonths:sourceMonths})}</div><p class="analysis-note">${savedBy(analysis.accounting)}</p>`;
  const form=`<form id="analysis-accounting-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('months','Competências e colagem','Adicione os meses do período ou cole os dados de uma planilha.',monthsContent,{first:true})}
      ${wizardStep('values','Despesas de cada competência','Informe as cinco categorias. Salários incluem pró-labore; os campos em branco permanecem pendentes.',valuesContent)}
      ${wizardStep('review','Confira o Contábil','Revise os totais e a cobertura dos meses antes de concluir o setor.',reviewContent)}
    </fieldset></div>${wizardFooter({canWrite,sector:'accounting',finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Concluir Contábil</button>`:''})}</form>`;
  return wizardFrame('accounting','Setor Contábil',analysis.company?.name||'Despesas por competência da empresa.',form);
}

export function renderAnalysisGuidance(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options),action=guidance.primaryAction;
  const title=guidance.state==='current'?'Seu resultado está atualizado':guidance.state==='ready'?'Tudo pronto para o próximo cálculo':!canWrite?'Acompanhe a conferência dos setores':guidance.hasUnsavedChanges?'Salve o preenchimento para continuar depois':'O próximo passo está aqui';
  const description=!canWrite&&guidance.state==='working'?'Consulte os dados e as pendências registradas pela equipe.':!canWrite&&guidance.state==='ready'?'Os dois setores foram conferidos. A equipe com acesso de edição pode gerar o resultado.':action.message;
  return `<div class="analysis-guidance-main" data-analysis-guidance-state="${guidance.state}">
    <div class="analysis-guidance-labels">${badge(guidance)}<span class="analysis-eyebrow">${guidance.state==='current'?'RESULTADO':'PRÓXIMA AÇÃO'}</span></div>
    <h2>${title}</h2><p>${esc(description)}</p>
    <div class="analysis-actions">${actionButton(action,{primary:true,canWrite})}${analysis.currentSimulation&&guidance.state!=='current'?`<a class="analysis-previous-result" href="${resultUrl(analysis)}">Ver última versão salva</a>`:''}</div>
    ${!canWrite&&guidance.state!=='current'?'<small class="analysis-readonly-note">Você pode consultar o trabalho. A gravação e a geração são feitas por quem tem acesso de edição.</small>':''}
  </div><div class="analysis-guidance-progress"><strong data-analysis-confirmed-count>${completionText(guidance.confirmedCount)}</strong>
    <div class="analysis-progress-track" role="progressbar" aria-label="Setores conferidos" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${guidance.confirmedCount}"><span style="width:${guidance.confirmedCount*50}%"></span></div>
    <div class="analysis-guidance-sectors">${['fiscal','accounting'].map(sector=>`<a href="${analysisUrl(analysis.id,sector)}" data-analysis-sector="${sector}" class="${guidance.sectors[sector].complete?'is-complete':''}"><span aria-hidden="true">${guidance.sectors[sector].complete?'✓':'○'}</span><span><b>${sectorName(sector)}</b><small>${esc(guidance.sectors[sector].label)}</small></span></a>`).join('')}</div>
    <p>${canWrite?'Concluir os dois setores libera o resultado. Salvar permite retomar o trabalho.':'Situação do trabalho salvo de cada setor. Abra o setor para consultar seus dados.'}</p>
  </div>`;
}

export function renderAnalysisGeneration(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options),current=analysis.currentSimulation;
  return `<section class="analysis-panel analysis-generate" id="analysis-generation"><div class="analysis-panel-heading"><div><h2>${guidance.state==='current'?'Resultado atual':!canWrite?'Situação do resultado':current?'Atualizar o resultado':'Gerar a análise da empresa'}</h2><p>${guidance.state==='current'?'A DRE disponível corresponde ao trabalho salvo e conferido.':guidance.state==='ready'?'Os dados dos dois setores estão prontos para gerar o resultado com os regimes escolhidos.':canWrite?'Resolva as pendências abaixo. Os atalhos levam diretamente ao ponto que precisa de atenção.':'Acompanhe as pendências registradas. Os atalhos permitem consultar os dados de cada setor.'}</p></div>${badge(guidance)}</div>
    ${guidance.issues.length?`<ul class="analysis-checklist analysis-action-checklist">${guidance.issues.map(issue=>`<li data-analysis-issue="${esc(issue.code)}"><span class="analysis-issue-marker" aria-hidden="true">→</span><div><p>${esc(issue.message)}</p>${actionButton(issue,{canWrite})}</div></li>`).join('')}</ul>`:''}
    <div class="analysis-actions">${canWrite?`<button type="button" class="primary" id="analysis-generate" ${guidance.canGenerate?'':'disabled'}>${guidance.state==='current'?'Resultado atualizado':current?'Atualizar cálculo da análise':'Gerar análise'}</button>`:''}${current?`<a class="analysis-button ${guidance.state==='current'?'primary':''}" href="${resultUrl(analysis)}">${guidance.state==='current'?'Ver DRE atual':'Ver última versão salva'} →</a>`:''}</div>
    <a class="analysis-history-link" href="${analysisUrl(analysis.id,null,'versions')}">Conferir as versões desta empresa →</a></section>`;
}

export function renderAnalysisDetail(options) {
  const {analysis,canWrite,versionsOpen,modalKind}=options;
  const modal=modalKind==='fiscal'?fiscalPanel(options):modalKind==='accounting'?accountingPanel(options):modalKind==='config'?configPanel(options):'';
  return `<a class="analysis-back" href="/analyses.html">← Todas as análises</a>
    <div class="analysis-heading"><div><span class="analysis-eyebrow">ANÁLISE DA EMPRESA · ${esc(analysis.company?.code||'SEM CÓDIGO')}</span><h1>${esc(analysis.company?.name||'Empresa')}</h1><p>${analysis.company?.cnpj?esc(analysis.company.cnpj)+' · ':''}Cenário ${esc(analysis.config.year)} · Fiscal e Contábil na mesma análise.</p><div class="analysis-tags analysis-heading-tags">${tags(analysis.config.regimeSelection)}</div></div><div class="analysis-heading-actions"><button type="button" id="analysis-open-config" class="analysis-button" data-analysis-action="config" aria-haspopup="dialog">${icon('settings')}${canWrite?'Regimes e ano':'Consultar escolhas'}</button><a class="analysis-button" href="${analysisUrl(analysis.id,null,'versions')}">${icon('history')}Versões salvas</a></div></div>
    <div class="analysis-detail-overview"><section class="analysis-guidance" id="analysis-guidance" aria-label="Próxima ação da análise">${renderAnalysisGuidance(options)}</section>
      ${analysis.legacy?'<p class="analysis-note analysis-legacy-note">O trabalho anterior foi preservado. Confira os setores para gerar a próxima versão.</p>':''}
      ${sectorChooser(analysis,options)}${renderAnalysisGeneration(options)}
      <details class="analysis-panel analysis-versions" id="analysis-versions" ${versionsOpen?'open':''}><summary>Versões salvas desta análise</summary><div id="analysis-version-list"><p class="analysis-note">Abra para consultar as versões anteriores. Os dados e resultados de cada versão permanecem preservados.</p></div></details>
    </div>${modal}`;
}

export function renderAnalysisVersions({items,pagination,currentId}) {
  return `${items.length?`<div class="analysis-document-list">${items.map(item=>{const id=item.id||item._id;return `<article class="analysis-document" data-analysis-version="${esc(id)}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>${esc(id===currentId?'Versão corrente':item.title||'Versão salva')}</h3><p>${dates(item.createdAt)}${item.createdBy?.name?' · '+esc(item.createdBy.name):''}</p><p>${item.year?'Cenário '+esc(item.year)+' · ':''}Modelo ${esc(item.modelVersion||'registrado na simulação')}</p></div><div class="analysis-document-actions"><a class="analysis-button" href="/simulator.html?${new URLSearchParams({simulation:id})}">Abrir DRE →</a></div></article>`;}).join('')}</div>`:'<p class="analysis-note">Ainda não há uma versão gerada para esta análise.</p>'}<div class="analysis-pagination"><button type="button" data-versions-page="${pagination.page-1}" ${pagination.page<=1?'disabled':''}>Anterior</button><p>Página ${pagination.page} de ${Math.max(1,pagination.totalPages)}</p><button type="button" data-versions-page="${pagination.page+1}" ${pagination.page>=pagination.totalPages?'disabled':''}>Próxima</button></div>`;
}
