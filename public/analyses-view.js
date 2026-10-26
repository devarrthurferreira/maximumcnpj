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
  const sectors=['fiscal','accounting'].includes(kind)?`<nav class="analysis-wizard-sector-switch" aria-label="Trocar setor">${['fiscal','accounting'].map(sector=>`<button type="button" data-analysis-sector="${sector}" aria-pressed="${sector===kind}">${sectorName(sector)}</button>`).join('')}</nav>`:'';
  return `<dialog id="analysis-wizard" class="analysis-wizard" data-wizard-kind="${kind}" aria-labelledby="analysis-wizard-title" aria-describedby="analysis-wizard-description">
    <div class="analysis-wizard-frame"><header class="analysis-wizard-header"><div class="analysis-wizard-identity"><h2 id="analysis-wizard-title" tabindex="-1">${esc(title)}</h2><p id="analysis-wizard-description">${esc(description)}</p>${sectors}</div><button type="button" id="analysis-wizard-close" class="analysis-wizard-close" aria-label="Fechar formulário da análise">×</button></header>
      <div id="analysis-wizard-progress"></div><div id="analysis-wizard-notices"></div>${form}
    </div></dialog>`;
}

function wizardStep(id,title,description,content,{first=false}={}) {
  return `<section class="analysis-wizard-step" data-wizard-step="${id}" ${first?'':'hidden'}><div class="analysis-wizard-step-heading"><h3 tabindex="-1" data-wizard-heading>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${content}</section>`;
}

function wizardFooter({canWrite,sector=null,finalAction='',note=''}) {
  const final=finalAction||(!canWrite?'<button type="button" data-wizard-dismiss>Fechar</button>':'');
  return `<footer class="analysis-wizard-footer"><p id="analysis-draft-status" role="status" aria-live="polite">${esc(note||(canWrite?'Salve para continuar depois.':'Somente consulta.'))}</p><div class="analysis-wizard-footer-actions"><button type="button" id="analysis-wizard-back" disabled>Voltar</button><div class="analysis-wizard-footer-end">${sector&&canWrite?'<button type="submit" name="intent" value="save">Salvar rascunho</button>':''}<button type="button" id="analysis-wizard-next" class="primary">Continuar</button><div data-wizard-final-actions hidden>${final}</div></div></div></footer>`;
}

function reviewRegimes(selection) {
  try{return resolveRegimeSelection(selection).selected.map(id=>REGIME_LABELS[id]).join(' · ');}catch{return 'Seleção de regimes pendente';}
}

export function renderWizardReview(options) {
  const kind=options.modalKind||options.kind||options.wizardKind||'new';
  if(kind!=='new')return '';
  const existing=options.existingAnalysis,company=existing?.company||options.clients?.find(item=>(item._id||item.id)===options.clientId);
  return `<div class="analysis-setup-company"><strong>${esc(company?.name||'Selecione a empresa')}</strong><span>${company?.code?'Código '+esc(company.code)+' · ':''}${esc(company?.cnpj||'CNPJ não informado')}</span>${existing?`<p><b>Configuração salva:</b> ${esc(reviewRegimes(existing.config.regimeSelection))} · Cenário ${esc(existing.config.year)}</p>${requiresSimplesReference(existing.config.regimeSelection)?`<p><b>DIFAL salvo:</b> ${esc(difalChoiceSummary(existing.config.regimeSelection,existing.fiscal?.data?.difalPolicy))}</p>`:''}<small>O trabalho existente será retomado. As escolhas podem ser alteradas dentro da análise.</small>`:''}</div>`;
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
  return `<div class="analysis-existing-work"><strong>Análise encontrada</strong><p>${esc(guidance.label)} · ${completionText(guidance.confirmedCount)}. Continue para escolher o setor.</p></div>`;
}

export function renderNewAnalysis(options) {
  const {clients,clientId,search,selection,sector,year,canWrite,existingAnalysis=null,checkingCompany=false,companyCheckError='',difalPolicy,difalChoice=null}=options;
  const results=companyResults(clients,clientId,search),chosen=existingAnalysis?.config.regimeSelection||selection,chosenYear=existingAnalysis?.config.year||year;
  const showDifal=!existingAnalysis&&requiresSimplesReference(chosen);
  const blocked=checkingCompany||!!companyCheckError||!clientId||!canWrite&&!existingAnalysis;
  const companyStep=`<label for="analysis-company-search">Código, nome ou CNPJ da empresa<input id="analysis-company-search" type="search" autocomplete="off" value="${esc(search)}" placeholder="Buscar empresa…" aria-controls="analysis-company-results"></label>
      <p id="analysis-company-count" class="analysis-note" role="status">${results.count?`${results.count} empresa(s) encontrada(s)${results.count>20?' · refine a busca para ver as demais':''}`:'Os resultados aparecem enquanto você digita.'}</p>
      <div id="analysis-company-results" class="analysis-company-results">${results.html}</div><input type="hidden" id="analysis-new-client" value="${esc(clientId)}">
      <div id="analysis-new-company-context" aria-live="polite">${renderNewCompanyContext({existingAnalysis,checkingCompany,companyCheckError})}</div>`;
  const sectorStep=`<fieldset class="analysis-new-sector"><legend>Por qual setor deseja começar?</legend><label><input type="radio" name="sector" value="fiscal" ${sector==='fiscal'?'checked':''} required><span><strong>Fiscal</strong><small>Documentos e tributação.</small></span></label><label><input type="radio" name="sector" value="accounting" ${sector==='accounting'?'checked':''} required><span><strong>Contábil</strong><small>Despesas por competência.</small></span></label></fieldset>`;
  const regimesStep=`<fieldset id="analysis-new-config" class="analysis-new-config" ${existingAnalysis?'hidden':''} ${existingAnalysis||!canWrite||checkingCompany||companyCheckError?'disabled':''}>
        <legend>Regimes e ano</legend><div class="analysis-new-config-heading"><strong>Regimes</strong><label for="analysis-new-year">Ano do cenário<select id="analysis-new-year"><option value="2027" ${chosenYear===2027?'selected':''}>2027</option><option value="2028" ${chosenYear===2028?'selected':''}>2028</option></select></label></div>
        ${regimeChoices(chosen,'analysis-new-regime')}<p class="analysis-new-year-note">As competências dos documentos serão conferidas separadamente.</p>
        <div id="analysis-new-difal" ${showDifal?'':'hidden'}>${showDifal?renderDifalChoice(chosen,difalPolicy,{prefix:'new',choice:difalChoice}):''}</div>
      </fieldset>`;
  const form=`<form id="analysis-new-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body">
      ${wizardStep('company','Empresa','Busque pelo código, nome ou CNPJ.',companyStep,{first:true})}
      ${wizardStep('setup','Setor e configuração','',`<div id="analysis-wizard-review">${renderWizardReview({...options,modalKind:'new'})}</div>${sectorStep}${regimesStep}`)}
    </div>${wizardFooter({canWrite,finalAction:`<button class="primary" id="analysis-open-company" type="submit" ${blocked?'disabled':''}>${checkingCompany?'Conferindo empresa…':existingAnalysis?'Continuar análise':'Abrir análise da empresa'}</button>`,note:'Uma análise por empresa, com o histórico preservado.'})}</form>`;
  return `<a class="analysis-back" href="/analyses.html">← Todas as análises</a><section class="analysis-panel analysis-new-intro"><div><h1>Nova análise</h1><p>Escolha a empresa para começar ou retomar o trabalho salvo.</p></div><button type="button" id="analysis-resume-new" class="primary" aria-haspopup="dialog">Escolher empresa</button></section>${wizardFrame('new','Abrir análise','Empresa, setor e regimes em duas etapas.',form)}`;
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
      ${wizardStep('choices','Configuração da análise','',choices,{first:true})}
    </fieldset></div>${wizardFooter({canWrite,finalAction:canWrite?'<button type="submit" id="analysis-save-config" class="primary">Salvar configuração</button>':'',note:canWrite?'As versões anteriores permanecem preservadas.':'Somente consulta.'})}</form>`;
  return wizardFrame('config','Regimes e ano',analysis.company?.name||'Configuração da empresa.',form);
}

function sectorChooser(analysis,options) {
  return `<section class="analysis-sectors-overview" aria-label="Setores da análise"><div class="analysis-sector-choice">${['fiscal','accounting'].map(sector=>`<a class="analysis-sector-tab analysis-sector-card" href="${analysisUrl(analysis.id,sector)}" data-analysis-sector="${sector}" aria-haspopup="dialog"><div class="analysis-sector-card-heading"><strong>${icon(sector==='fiscal'?'report':'companies')}${sectorName(sector)}</strong><span data-analysis-sector-status="${sector}">${badge(sectorState(analysis,sector,options))}</span></div><p>${sector==='fiscal'?'Entradas, saídas e tributação.':'Despesas organizadas por competência.'}</p><small>${savedBy(analysis[sector])}</small><b>${options.canWrite?'Abrir':'Consultar'} ${sectorName(sector)} <span aria-hidden="true">→</span></b></a>`).join('')}</div></section>`;
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

export function difalChoiceSummary(selection,policy,choice) {
  const selected=resolveRegimeSelection(selection).selected.filter(id=>['pure','hybrid'].includes(id));
  if(!selected.length)return 'DIFAL não utilizado nos regimes selecionados.';
  const decision=choice===undefined?(selected.some(id=>policy?.enabled?.[id])?'yes':'no'):choice;
  if(decision===null)return 'Escolha Sim ou Não para esta análise.';
  if(decision==='no')return 'DIFAL não será incluído nesta simulação.';
  return selected.map(id=>{
    const name=id==='pure'?'Puro':'Híbrido';
    if(!policy?.enabled?.[id])return `${name}: não incluído`;
    const operations=policy.operations?.[id],directions=[operations?.entry?'entrada':null,operations?.exit?'saída':null].filter(Boolean);
    return `${name}: ${directions.join(' e ')||'nenhuma operação selecionada'}`;
  }).join(' · ')+'.';
}

export function renderDifalChoice(selection,policy,{prefix='analysis',choice}={}) {
  const selected=resolveRegimeSelection(selection).selected.filter(id=>['pure','hybrid'].includes(id));
  if(!selected.length)return '';
  const decision=choice===undefined?(selected.some(id=>policy?.enabled?.[id])?'yes':'no'):choice;
  return `<section class="analysis-difal-panel" id="${esc(prefix)}-difal-panel"><fieldset class="analysis-difal-question" aria-describedby="${esc(prefix)}-difal-summary"><legend>Terá DIFAL?</legend><div class="analysis-difal-choice-options">${[['yes','Sim'],['no','Não']].map(([value,label])=>`<label for="${esc(prefix)}-difal-${value}"><input id="${esc(prefix)}-difal-${value}" type="radio" name="${esc(prefix)}-difal-choice" value="${value}" data-difal-choice="${value}" data-difal-context="${esc(prefix)}" ${decision===value?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>
    <p class="analysis-difal-summary" id="${esc(prefix)}-difal-summary" role="status" aria-live="polite">${esc(difalChoiceSummary(selection,policy,choice))}</p>
    <details class="analysis-difal-details" id="${esc(prefix)}-difal-details" ${decision==='yes'?'':'hidden'}><summary>Definir regimes, entrada e saída</summary>${difalOptions(selection,policy)}</details>
  </section>`;
}

function difalOptions(selection,policy) {
  const selected=resolveRegimeSelection(selection).selected.filter(id=>['pure','hybrid'].includes(id));
  if(!selected.length)return '';
  return `<div class="analysis-difal-options">${selected.map(id=>`<fieldset data-analysis-difal="${id}"><legend>${esc(REGIME_LABELS[id])}</legend><label class="analysis-check"><input type="checkbox" data-analysis-difal-enabled="${id}" ${policy?.enabled?.[id]?'checked':''}>Incluir DIFAL neste regime</label>${[['entry','Entrada · antecipação das compras'],['exit','Saída · vendas']].map(([operation,label])=>`<label class="analysis-check"><input type="checkbox" data-analysis-difal-operation="${operation}" data-analysis-difal-regime="${id}" ${policy?.operations?.[id]?.[operation]?'checked':''} ${!policy?.enabled?.[id]?'disabled':''}>${label}</label>`).join('')}</fieldset>`).join('')}</div><p class="analysis-note">Somente Simples Puro e Híbrido. Entrada e saída são independentes; a aplicação continua sujeita às regras de cada competência e à situação do ICMS.</p>`;
}

function fiscalAdjustments(draft,source,canWrite) {
  const rows=draft.monthlyOverrides;
  return `<details class="analysis-adjustments" id="analysis-fiscal-adjustments"><summary>Ajustes de receitas e compras por competência${rows?.length?` · ${rows.length} competência(s) registrada(s)`:''}</summary><p class="analysis-note">Os documentos permanecem preservados. Informe valores finais após devoluções. Ajustes de compras alteram o custo, sem criar crédito de ICMS de documentos.</p>${rows?.length?`<div class="analysis-expenses">${rows.map(row=>`<section class="analysis-expense-month" data-fiscal-month="${esc(row.sourceMonth)}"><header><h3>${esc(monthLabel(row.sourceMonth))}</h3><p>Valores do cenário em reais</p></header><div class="analysis-expense-fields">${ADJUSTMENT_FIELDS.map(([key,label],index)=>`<label>${label}<input type="number" step="0.01" ${index>2?'min="0"':''} inputmode="decimal" data-fiscal-field="${key}" value="${reaisInput(row.groups?.[key])}" placeholder="Valor após devoluções"></label>`).join('')}<label>Receita de serviços<input type="number" min="0" step="0.01" inputmode="decimal" data-fiscal-field="serviceRevenue" value="${reaisInput(row.serviceRevenue)}" placeholder="Serviços da competência"></label></div></section>`).join('')}</div>${canWrite?'<button type="button" id="analysis-clear-adjustments">Usar novamente os valores dos relatórios</button>':''}`:canWrite&&source?.monthlyReports?.length?'<button type="button" id="analysis-edit-adjustments">Editar valores por competência</button>':'<p class="analysis-note">Nenhum ajuste manual registrado. Os valores serão os dos relatórios conciliados.</p>'}</details>`;
}

function fiscalPanel(options) {
  const {analysis,fiscalDraft:draft,canWrite,configDirty}=options,simples=requiresSimplesReference(analysis.config.regimeSelection);
  const customized=draft.salesAnnex!==1||simples&&(draft.serviceAnnex!==3||draft.icmsOutside)||!!draft.monthlyOverrides?.length;
  const optionsSummary=simples?'Atividade, anexos, ICMS/ISS e ajustes por competência.':'Atividade e ajustes de receitas e compras por competência.';
  const tax=`${extratoPanel({...options,draft})}<details class="analysis-options-panel" id="analysis-fiscal-options" ${customized?'open':''}><summary><strong>Opções fiscais e ajustes</strong><span>${esc(optionsSummary)}</span></summary><div class="analysis-options-content"><div class="analysis-form-grid analysis-fiscal-options"><label>Atividade das vendas<select id="analysis-sales-annex"><option value="1" ${draft.salesAnnex===1?'selected':''}>Comércio · Anexo I</option><option value="2" ${draft.salesAnnex===2?'selected':''}>Indústria · Anexo II</option></select></label>${simples?`<label>Categoria dos serviços<select id="analysis-service-annex"><option value="3" ${draft.serviceAnnex===3?'selected':''}>Anexo III</option><option value="4" ${draft.serviceAnnex===4?'selected':''}>Anexo IV</option><option value="5" ${draft.serviceAnnex===5?'selected':''}>Anexo V</option></select></label>`:''}${simples?`<label class="full">ICMS e ISS no cenário do Simples<select id="analysis-icms-outside"><option value="inside" ${!draft.icmsOutside?'selected':''}>Dentro do DAS</option><option value="outside" ${draft.icmsOutside?'selected':''}>Fora do DAS · situação já confirmada</option></select><small>A escolha não é automática pelo limite de receita. Confirme a situação aplicável à empresa.</small></label>`:''}</div>${fiscalAdjustments(draft,options.source,canWrite)}</div></details>${configDirty?'<p class="analysis-message is-warning">Salve os regimes e o ano antes de concluir o Fiscal.</p>':''}`;
  const form=`<form id="analysis-fiscal-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${renderDifalChoice(analysis.config.regimeSelection,draft.difalPolicy)}
      ${wizardStep('documents','Entradas e saídas',canWrite?'Importe os documentos ou retome uma leitura.':'Consulte os documentos vinculados à análise.',fiscalReports(options),{first:true})}
      ${wizardStep('tax','Tributação','',tax)}
    </fieldset></div>${wizardFooter({canWrite,sector:'fiscal',finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Salvar e concluir</button>`:''})}</form>`;
  return wizardFrame('fiscal','Fiscal',analysis.company?.name||'Documentos e tributação.',form);
}

function accountingMonth(row,canWrite,first=false) {
  const complete=ACCOUNTING_FIELDS.every(([key])=>Number.isSafeInteger(row[key])&&row[key]>=0),total=complete?ACCOUNTING_FIELDS.reduce((sum,[key])=>sum+row[key],0):null;
  return `<details class="analysis-expense-month" data-accounting-month="${esc(row.sourceMonth)}" id="analysis-month-${esc(row.sourceMonth)}" name="analysis-accounting-months" ${first?'open':''}><summary><span class="analysis-expense-month-name">${esc(monthLabel(row.sourceMonth))}</span><span class="analysis-expense-month-total"><small>Despesas do mês</small><strong data-accounting-total>${total===null?'Preenchimento incompleto':money(total/100)}</strong></span></summary><div class="analysis-expense-fields">${ACCOUNTING_FIELDS.map(([key,label])=>`<label>${label} (R$)<input type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" data-accounting-field="${key}" value="${centsInput(row[key])}" placeholder="Não informado" aria-label="${esc(label+' em '+monthLabel(row.sourceMonth))}"></label>`).join('')}</div>${canWrite?`<div class="analysis-expense-month-actions"><button type="button" data-zero-month="${esc(row.sourceMonth)}" title="Use somente quando não houver despesa nas categorias ainda em branco.">Preencher vazios com zero</button><button type="button" data-remove-month="${esc(row.sourceMonth)}" aria-label="Remover ${esc(monthLabel(row.sourceMonth))}">Remover mês</button></div>`:''}</details>`;
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
    <p class="analysis-summary-note">${summary.complete?'Preenchimento completo nas competências desta análise.':'O total preenchido soma apenas valores informados. Campos vazios e meses ausentes continuam pendentes. Zero representa ausência de despesa.'}</p>
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
  const monthsContent=`<details class="analysis-accounting-tools" id="analysis-accounting-tools" ${months.length?'':'open'}><summary>${canWrite?'Adicionar meses ou colar planilha':'Competências dos documentos'}</summary><div class="analysis-accounting-tools-content">${sourceMonths.length?`<p class="analysis-note"><strong>Meses dos relatórios fiscais:</strong> ${sourceMonths.map(month=>esc(monthLabel(month))).join(' · ')}</p>`:`<p class="analysis-note">${canWrite?'Você pode preencher antes do Fiscal. ':''}Os meses serão conferidos após a importação.</p>`}
    ${canWrite?`<div class="analysis-add-month"><label for="analysis-new-month">Adicionar competência<input type="month" id="analysis-new-month" min="2000-01" max="2099-12"></label><button type="button" id="analysis-add-month">Adicionar mês</button>${missing.length?`<button type="button" id="analysis-add-fiscal-months">Adicionar ${missing.length} competência(s) do Fiscal</button>`:''}</div>`:''}
    <div id="analysis-accounting-import"></div></div></details>`;
  const valuesContent=`${monthsContent}<div class="analysis-expenses" id="analysis-expenses">${months.length?months.map((row,index)=>accountingMonth(row,canWrite,index===0)).join(''):'<p class="analysis-note analysis-accounting-empty">Nenhuma competência adicionada.</p>'}</div><p class="analysis-note">Campos em branco ficam pendentes. Zero representa ausência de despesa; cada despesa deve aparecer uma única vez.</p>
    <details class="analysis-accounting-summary-panel" id="analysis-accounting-summary-panel"><summary>Ver totais e pendências das despesas</summary><div id="analysis-accounting-summary" class="analysis-accounting-summary" aria-label="Resumo das despesas informadas">${renderAccountingSummary({months,expectedMonths:sourceMonths})}</div></details>${configDirty?'<p class="analysis-message is-warning">Salve os regimes e o ano antes de concluir o Contábil.</p>':''}`;
  const form=`<form id="analysis-accounting-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('values','Despesas por competência',canWrite?'Preencha as cinco categorias de cada mês, em reais.':'Valores salvos por mês, em reais.',valuesContent,{first:true})}
    </fieldset></div>${wizardFooter({canWrite,sector:'accounting',finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Salvar e concluir</button>`:''})}</form>`;
  return wizardFrame('accounting','Contábil',analysis.company?.name||'Despesas por competência.',form);
}

export function renderAnalysisGuidance(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options);
  return `<div class="analysis-guidance-strip" data-analysis-guidance-state="${guidance.state}">${badge(guidance)}<div class="analysis-guidance-completion"><strong data-analysis-confirmed-count>${completionText(guidance.confirmedCount)}</strong><div class="analysis-progress-track" role="progressbar" aria-label="Setores conferidos" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${guidance.confirmedCount}"><span style="width:${guidance.confirmedCount*50}%"></span></div></div>${!canWrite?'<small>Somente consulta</small>':''}</div>`;
}

export function renderAnalysisGeneration(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options),current=analysis.currentSimulation;
  return `<section class="analysis-panel analysis-generate" id="analysis-generation"><div class="analysis-generation-top"><div class="analysis-panel-heading"><div><h2>Resultado</h2><p>${guidance.state==='current'?'A DRE corresponde aos dados salvos e conferidos.':guidance.state==='ready'?canWrite?'Tudo pronto para calcular os regimes escolhidos.':'Os setores estão conferidos. A geração está disponível para quem pode editar.':canWrite?'Conclua Fiscal e Contábil para gerar a DRE.':'Consulte os setores e as pendências abaixo.'}</p></div></div>
    <div class="analysis-actions">${canWrite?`<button type="button" class="primary" id="analysis-generate" ${guidance.canGenerate?'':'disabled'} ${guidance.state==='current'?'hidden':''}>${current?'Atualizar resultado':'Gerar análise'}</button>`:''}${current?`<a class="analysis-button ${guidance.state==='current'?'primary':''}" href="${resultUrl(analysis)}">${guidance.state==='current'?'Ver DRE atual':'Ver última versão salva'} →</a>`:''}</div></div>
    ${guidance.issues.length?`<details class="analysis-pending-issues" id="analysis-pending-issues"><summary>Pendências para gerar · ${guidance.issues.length}</summary><ul class="analysis-checklist analysis-action-checklist">${guidance.issues.map(issue=>`<li data-analysis-issue="${esc(issue.code)}"><span class="analysis-issue-marker" aria-hidden="true">→</span><div><p>${esc(issue.message)}</p>${actionButton(issue,{canWrite})}</div></li>`).join('')}</ul></details>`:''}</section>`;
}

function deleteAnalysisDialog(analysis,canWrite) {
  return `<dialog id="analysis-delete-dialog" class="analysis-delete-dialog" aria-labelledby="analysis-delete-title" aria-describedby="analysis-delete-description analysis-delete-effect"><div class="analysis-delete-content"><h2 id="analysis-delete-title">Excluir simulação?</h2><p id="analysis-delete-description">Os dados dos setores Fiscal e Contábil e as versões vinculadas a esta análise serão excluídos definitivamente.</p>
    <div class="analysis-delete-target"><strong id="analysis-delete-company">${esc(analysis.company?.name||'Empresa')}</strong><span id="analysis-delete-cnpj">${esc(analysis.company?.cnpj||'CNPJ não informado')}</span><small>${analysis.company?.code?'Código '+esc(analysis.company.code)+' · ':''}Cenário ${esc(analysis.config.year)}</small></div>
    <p id="analysis-delete-effect" class="analysis-delete-effect">O cadastro da empresa e os documentos fiscais serão preservados. Esta ação não pode ser desfeita.</p><p id="analysis-delete-error" class="analysis-delete-error" role="alert"></p><p id="analysis-delete-status" class="analysis-delete-status" role="status" aria-live="polite"></p>
    <div class="analysis-delete-actions"><button type="button" id="analysis-delete-cancel" autofocus>Cancelar</button><button type="button" id="analysis-delete-confirm" class="analysis-danger-solid" ${canWrite?'':'disabled'}>Excluir simulação</button></div></div></dialog>`;
}

export function renderAnalysisDetail(options) {
  const {analysis,canWrite,versionsOpen,modalKind}=options;
  const modal=modalKind==='fiscal'?fiscalPanel(options):modalKind==='accounting'?accountingPanel(options):modalKind==='config'?configPanel(options):'';
  return `<a class="analysis-back" href="/analyses.html">← Todas as análises</a>
    <div class="analysis-heading"><div><span class="analysis-eyebrow">ANÁLISE DA EMPRESA · ${esc(analysis.company?.code||'SEM CÓDIGO')}</span><h1>${esc(analysis.company?.name||'Empresa')}</h1><p>${analysis.company?.cnpj?esc(analysis.company.cnpj)+' · ':''}Cenário ${esc(analysis.config.year)}</p><div class="analysis-tags analysis-heading-tags">${tags(analysis.config.regimeSelection)}</div></div><div class="analysis-heading-actions"><button type="button" id="analysis-open-config" class="analysis-button" data-analysis-action="config" aria-haspopup="dialog">${icon('settings')}${canWrite?'Regimes e ano':'Consultar escolhas'}</button>${canWrite?'<button type="button" id="analysis-delete" class="analysis-button analysis-danger" aria-haspopup="dialog">Excluir simulação</button>':''}</div></div>
    <div class="analysis-detail-overview"><section class="analysis-guidance" id="analysis-guidance" aria-label="Situação da análise">${renderAnalysisGuidance(options)}</section>
      ${analysis.legacy?'<p class="analysis-note analysis-legacy-note">O trabalho anterior foi preservado. Confira os setores para gerar a próxima versão.</p>':''}
      ${sectorChooser(analysis,options)}${renderAnalysisGeneration(options)}
      <details class="analysis-panel analysis-versions" id="analysis-versions" ${versionsOpen?'open':''}><summary>Versões salvas desta análise</summary><div id="analysis-version-list"><p class="analysis-note">Abra para consultar as versões anteriores. Os dados e resultados de cada versão permanecem preservados.</p></div></details>
    </div>${modal}${deleteAnalysisDialog(analysis,canWrite)}`;
}

export function renderAnalysisVersions({items,pagination,currentId}) {
  return `${items.length?`<div class="analysis-document-list">${items.map(item=>{const id=item.id||item._id;return `<article class="analysis-document" data-analysis-version="${esc(id)}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>${esc(id===currentId?'Versão corrente':item.title||'Versão salva')}</h3><p>${dates(item.createdAt)}${item.createdBy?.name?' · '+esc(item.createdBy.name):''}</p><p>${item.year?'Cenário '+esc(item.year)+' · ':''}Modelo ${esc(item.modelVersion||'registrado na simulação')}</p></div><div class="analysis-document-actions"><a class="analysis-button" href="/simulator.html?${new URLSearchParams({simulation:id})}">Abrir DRE →</a></div></article>`;}).join('')}</div>`:'<p class="analysis-note">Ainda não há uma versão gerada para esta análise.</p>'}<div class="analysis-pagination"><button type="button" data-versions-page="${pagination.page-1}" ${pagination.page<=1?'disabled':''}>Anterior</button><p>Página ${pagination.page} de ${Math.max(1,pagination.totalPages)}</p><button type="button" data-versions-page="${pagination.page+1}" ${pagination.page>=pagination.totalPages?'disabled':''}>Próxima</button></div>`;
}
