import {isReadyToFinalize} from './purchase-finalization.js';
import {icon} from './navigation.js';
import {REGIME_IDS,REGIME_LABELS,resolveRegimeSelection,requiresSimplesReference} from './regime-selection.js';
import {renderSection22} from './simulator-extrato-view.js';
import {renderRbt12Schedule} from './simulator-source-view.js';
import {ACCOUNTING_FIELDS,accountingSummary,analysisGuidance,accountingSourceMonths,analysisPeriodFor,scopedAccountingMonths,usesFixedAnalysisPeriod} from './analyses-guidance.js';
import {renderCommercialComposition} from './simulator-commercial-view.js';
import {BRAZIL_UFS,normalizeUf} from './difal.js';
import {documentDifalSummary} from './analysis-document-difal.js';

export {ACCOUNTING_FIELDS} from './analyses-guidance.js';
export const ADJUSTMENT_FIELDS=[
  ['salesOptantCents','Vendas a optantes do Simples'],['salesNonOptantCents','Vendas a não optantes'],
  ['salesCpfCents','Vendas a CPFs'],['purchasesOptantCents','Compras do Simples'],
  ['purchasesNonOptantCents','Compras fora do Simples']
];
export const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const sectorName=sector=>sector==='fiscal'?'Fiscal':'Contábil';
const currencyFormatter=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
export const money=value=>Number.isFinite(value)?currencyFormatter.format(value):'Não informado';
export const centsInput=value=>Number.isSafeInteger(value)?(value/100).toFixed(2):'';
const reaisInput=value=>Number.isFinite(value)?value.toFixed(2):'';
const dates=value=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Ainda não salvo';
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const monthLabel=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')?MONTHS[Number(value.slice(5))-1]+' / '+value.slice(0,4):String(value||'Competência não informada');
export const analysisUrl=(id,sector,view)=>'/analyses.html?'+new URLSearchParams({id,...(sector?{sector}:{}),...(view?{view}:{})});

export const sectorState=(analysis,sector,options={})=>analysisGuidance(analysis,options).sectors[sector];

function badge(state){return `<span class="analysis-tag is-${state.kind}">${esc(state.label)}</span>`;}
const deleteIcon='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg>';
function savedBy(sector){return sector?.updatedAt?`Salvo em ${dates(sector.updatedAt)}${sector.updatedBy?.name?' por '+esc(sector.updatedBy.name):''}`:'Trabalho ainda não concluído.';}
const completionText=count=>`${count} de 2 setores conferidos`;
const resultUrl=analysis=>'/simulator.html?'+new URLSearchParams({simulation:analysis.currentSimulation.id});
const displayCnpj=value=>{
  const text=String(value||''),digits=text.replace(/\D/g,'');
  return digits.length===14?digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):text||'Não informado';
};
const actionLabel=(action,canWrite=true)=>canWrite?action.label:({import:'Consultar documentos fiscais',reference:'Consultar extrato ou RBT12',fiscal:'Consultar Fiscal',accounting:'Consultar Contábil',config:'Consultar escolhas da análise','accounting-months':'Consultar competências do Contábil'}[action.action]||action.label);
function actionButton(action,{primary=false,canWrite=true}={}) {
  const writes=['generate','save-fiscal','save-accounting'];
  if(!canWrite&&writes.includes(action.action))return '';
  return `<button type="button" class="${primary?'primary':'analysis-action-link'}" data-analysis-action="${esc(action.action)}">${esc(actionLabel(action,canWrite))}${primary?'<span aria-hidden="true"> →</span>':''}</button>`;
}

function wizardFrame(kind,title,description,form) {
  const sectors=['fiscal','accounting'].includes(kind)?`<nav class="analysis-wizard-sector-switch" aria-label="Trocar setor">${['fiscal','accounting'].map(sector=>`<button type="button" data-analysis-sector="${sector}" aria-pressed="${sector===kind}">${sectorName(sector)}</button>`).join('')}</nav>`:'';
  return `<dialog id="analysis-wizard" class="analysis-wizard" data-wizard-kind="${kind}" aria-labelledby="analysis-wizard-title" aria-describedby="analysis-wizard-description">
    <div class="analysis-wizard-frame"><header class="analysis-wizard-header"><div class="analysis-wizard-identity"><div class="analysis-wizard-title-row"><h2 id="analysis-wizard-title" tabindex="-1">${esc(title)}</h2>${sectors}</div><p id="analysis-wizard-description">${esc(description)}</p></div><button type="button" id="analysis-wizard-close" class="analysis-wizard-close" aria-label="Fechar formulário da análise">×</button></header>
      <div id="analysis-wizard-progress"></div><div id="analysis-wizard-notices"></div>${form}
    </div></dialog>`;
}

function wizardStep(id,title,description,content,{first=false}={}) {
  return `<section class="analysis-wizard-step" data-wizard-step="${id}" ${first?'':'hidden'}><div class="analysis-wizard-step-heading"><h3 tabindex="-1" data-wizard-heading>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${content}</section>`;
}

function wizardFooter({canWrite,sector=null,analysisId=null,finalAction='',note=''}) {
  const final=finalAction||(!canWrite?'<button type="button" data-wizard-dismiss>Fechar</button>':'');
  return `<footer class="analysis-wizard-footer"><div class="analysis-wizard-footer-meta"><p id="analysis-draft-status" role="status" aria-live="polite">${esc(note||(canWrite?'Salve para continuar depois.':'Somente consulta.'))}</p>${canWrite&&analysisId?`<button type="button" id="analysis-delete-in-wizard" class="analysis-danger" data-delete-analysis="${esc(analysisId)}" aria-haspopup="dialog">${deleteIcon}Excluir análise</button>`:''}</div><div class="analysis-wizard-footer-actions"><button type="button" id="analysis-wizard-back" disabled>Voltar</button><div class="analysis-wizard-footer-end">${sector&&canWrite?'<button type="submit" name="intent" value="save">Salvar rascunho</button>':''}<button type="button" id="analysis-wizard-next" class="primary">Continuar</button><div data-wizard-final-actions hidden>${final}</div></div></div></footer>`;
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

const foldCompany=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const companyIndexes=new WeakMap();
export function companyResults(clients,selected,search) {
  let index=companyIndexes.get(clients);
  if(!index){index=clients.map(client=>({client,text:foldCompany(`${client.code||''} ${client.name||''} ${client.cnpj||''}`),digits:String(client.cnpj||'').replace(/\D/g,'')}));companyIndexes.set(clients,index);}
  const term=foldCompany(search).trim(),digits=term.replace(/\D/g,''),matchDigits=/^[\d.\/-]+$/.test(term)&&!!digits;
  let count=0;const items=[];
  for(const row of index)if(term?row.text.includes(term)||matchDigits&&row.digits.includes(digits):row.client._id===selected){count++;if(items.length<20)items.push(row.client);}
  return {count,html:items.map(client=>`<button type="button" class="analysis-company-pick" data-analysis-client="${esc(client._id)}" aria-pressed="${client._id===selected}"><span class="analysis-company-code">${esc(client.code||'—')}</span><span><strong>${esc(client.name)}</strong><small>${esc(client.cnpj||'CNPJ não informado')}${client.active===false?' · cadastro inativo':''}</small></span><span aria-hidden="true">${client._id===selected?'✓':'→'}</span></button>`).join('')||`<div class="analysis-note">${term?'Nenhuma empresa encontrada. Tente outro código, nome ou CNPJ.':'Busque a empresa para começar.'}</div>`};
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
  const form=`<form id="analysis-new-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body">
      ${wizardStep('company','Qual empresa vamos analisar?','Busque pelo código, nome ou CNPJ e selecione o cadastro.',companyStep,{first:true})}
      ${wizardStep('sector','Escolha o setor','O trabalho de cada setor pode ser salvo e retomado depois.',`<div id="analysis-wizard-review">${renderWizardReview({...options,modalKind:'new'})}</div>${sectorStep}`)}
    </div>${wizardFooter({canWrite,finalAction:`<button class="primary" id="analysis-open-company" type="submit" ${blocked?'disabled':''}>${checkingCompany?'Conferindo empresa…':existingAnalysis?'Continuar análise':'Abrir análise da empresa'}</button>`,note:'Uma análise por empresa, com o histórico preservado.'})}</form>`;
  return `<a class="analysis-back" href="/analyses.html?view=list">← Todas as análises</a><section class="analysis-panel analysis-new-intro"><div><h1>Análises</h1><p>Escolha a empresa e o setor para começar ou retomar o trabalho.</p></div><button type="button" id="analysis-resume-new" class="primary" aria-haspopup="dialog">Escolher empresa</button></section>${wizardFrame('new','Abrir análise','Empresa → Setor',form)}`;
}

function companyCard(analysis,canWrite) {
  const guidance=analysisGuidance(analysis);
  return `<article class="analysis-company-card" data-analysis-id="${esc(analysis.id)}" data-analysis-state="${guidance.state}">
    <div class="analysis-company-title"><div><h2>${esc(analysis.company?.name||'Empresa')}</h2><p>Código ${esc(analysis.company?.code||'—')} · CNPJ ${esc(displayCnpj(analysis.company?.cnpj))}</p><p class="analysis-card-context">Cenário ${esc(analysis.config.year)}${usesFixedAnalysisPeriod(analysis)?' · Janeiro a setembro':''}</p></div></div>
    <div class="analysis-company-status">${badge(guidance)}</div>
    <div class="analysis-company-footer-actions"><a class="analysis-button" data-analysis-next="overview" href="${analysisUrl(analysis.id)}">Abrir análise <span aria-hidden="true">→</span></a>${canWrite?`<button type="button" class="analysis-card-delete analysis-danger" data-delete-analysis="${esc(analysis.id)}" aria-label="Excluir análise de ${esc(analysis.company?.name||'Empresa')}" aria-haspopup="dialog">${deleteIcon}Excluir análise</button>`:''}</div>
  </article>`;
}

export function renderAnalysisList({items,pagination,search,canWrite}) {
  return `<div class="analysis-heading"><div><h1>Análises</h1><p>Escolha a empresa para continuar.</p></div>${canWrite?`<div class="analysis-heading-actions"><a class="analysis-button primary" href="/analyses.html?view=new">${icon('start')}Nova análise</a></div>`:''}</div>
    <form class="analysis-filter-bar" id="analysis-search-form"><label for="analysis-search">Nome, código ou CNPJ<input id="analysis-search" type="search" maxlength="100" autocomplete="off" value="${esc(search)}" placeholder="Buscar empresa"></label><button type="submit">Buscar</button>${search?'<a class="analysis-clear-search" href="/analyses.html?view=list">Limpar busca</a>':''}</form>
    ${items.length?`<div class="analysis-list-caption"><strong>${search?'Resultados da busca':'Empresas em análise'}</strong><span>${items.length} nesta página · ${pagination.total} ${search?'encontrada(s)':'no total'}</span></div><div class="analysis-company-list">${items.map(item=>companyCard(item,canWrite)).join('')}</div>`:`<section class="analysis-empty">${icon('companies')}<h2>${search?'Nenhuma análise nesta busca':'A próxima análise começa pela empresa'}</h2><p>${search?'Tente outro nome, código ou CNPJ. Os relatórios e as versões anteriores continuam disponíveis.':'Escolha a empresa e comece pelo Fiscal ou pelo Contábil. Cada setor pode salvar seu trabalho e continuar depois.'}</p>${search?'<a class="analysis-button primary" href="/analyses.html?view=list">Ver todas as análises</a>':canWrite?'<a class="analysis-button primary" href="/analyses.html?view=new">Nova análise</a>':'<a class="analysis-button" href="/simulations.html">Consultar versões salvas</a>'}</section>`}
    ${pagination.totalPages>1?`<div class="analysis-pagination"><button type="button" data-analysis-page="${pagination.page-1}" ${pagination.page<=1?'disabled':''}>Anterior</button><p>Página ${pagination.page} de ${Math.max(1,pagination.totalPages)}</p><button type="button" data-analysis-page="${pagination.page+1}" ${pagination.page>=pagination.totalPages?'disabled':''}>Próxima</button></div>`:''}<details class="analysis-other-access"><summary>Outros acessos</summary><div class="analysis-footer-links"><a href="/generations.html?view=history">Relatórios importados</a><a href="/simulations.html">Histórico de versões</a>${canWrite?'<a href="/generations.html">Importar relatórios avulsos</a>':''}</div></details>${canWrite?deleteAnalysisDialog(null,canWrite):''}`;
}

function configPanel(options) {
  const {analysis,canWrite}=options,config=options.configDraft||analysis.config;
  const choices=`<div id="analysis-settings">${regimeChoices(config.regimeSelection)}<div class="analysis-form-grid analysis-config-year"><label>Ano do cenário<select id="analysis-config-year"><option value="2027" ${config.year===2027?'selected':''}>2027</option><option value="2028" ${config.year===2028?'selected':''}>2028</option></select></label></div><p class="analysis-note">Alterar os regimes ou o ano exige conferir os setores antes do próximo cálculo.</p></div>`;
  const form=`<form id="analysis-config-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('choices','Configuração da análise','',choices,{first:true})}
    </fieldset></div>${wizardFooter({canWrite,analysisId:analysis.id,finalAction:canWrite?'<button type="submit" id="analysis-save-config" class="primary">Salvar configuração</button>':'',note:canWrite?'As versões anteriores permanecem preservadas.':'Somente consulta.'})}</form>`;
  return wizardFrame('config','Regimes e ano',analysis.company?.name||'Configuração da empresa.',form);
}

function sectorChooser(analysis,options) {
  const guidance=analysisGuidance(analysis,options);
  return `<section class="analysis-sectors-overview" aria-label="Setores da análise"><div class="analysis-sector-choice">${['fiscal','accounting'].map(sector=>`<a class="analysis-sector-tab analysis-sector-card${guidance.sectors[sector].complete?' is-complete':''}" href="${analysisUrl(analysis.id,sector)}" data-analysis-sector="${sector}" data-analysis-sector-card="${sector}" aria-haspopup="dialog"><span class="analysis-sector-icon" aria-hidden="true">${icon(sector==='fiscal'?'report':'companies')}</span><div class="analysis-sector-card-heading"><strong>${sectorName(sector)}</strong><p>${sector==='fiscal'?'Documentos e impostos':'Despesas da empresa'}</p></div><span data-analysis-sector-status="${sector}" title="${savedBy(analysis[sector])}">${badge(guidance.sectors[sector])}</span><b>${options.canWrite?'Abrir':'Consultar'} <span aria-hidden="true">→</span></b></a>`).join('')}</div></section>`;
}

function renderDocumentDifal(summary,type) {
  if(!summary)return '';
  const amount=summary.amountCents===null?(summary.state==='pending'?'Pendente':'Indisponível'):money(summary.amountCents/100);
  return `<div class="analysis-document-difal${summary.state==='ready'?'':' is-pending'}" data-analysis-document-difal="${type}" data-difal-state="${summary.state}" role="status"><div class="analysis-document-difal-heading"><span>${esc(summary.label)}</span><strong data-analysis-document-difal-amount>${esc(amount)}</strong></div><small>${esc(summary.context)}</small>${summary.note?`<p>${esc(summary.note)}</p>`:''}</div>`;
}

export function renderFiscalReports({analysis,generation,canWrite,generationUnavailable=false,documentUploads={},documentIssuerUf,fiscalDraft,configDraft,fiscalDifalChoice}) {
  const data=analysis.fiscal.data,company=generation&&generation._id===data.generationId&&!generationUnavailable?generation.companies?.find(item=>item.clientId===analysis.clientId):null;
  const slots=[['PURCHASES','Entradas','Compras e devoluções de venda.','purchase','purchaseJobId'],['SALES','Saídas','Vendas de mercadorias e serviços.','sales','salesJobId']];
  const issuerUf=normalizeUf(documentIssuerUf??analysis.company?.uf),needsDocument=slots.some(([,,,key])=>company?.[key]?.status!=='COMPLETED');
  const ufField=canWrite&&needsDocument?`<div class="analysis-document-uf"><label for="analysis-document-uf">UF da empresa<select id="analysis-document-uf" data-analysis-document-uf aria-describedby="analysis-document-uf-help"><option value="">Selecione</option>${BRAZIL_UFS.map(uf=>`<option value="${uf}" ${uf===issuerUf?'selected':''}>${uf}</option>`).join('')}</select></label><p id="analysis-document-uf-help">${issuerUf?'Confira a UF. O envio começa ao selecionar o arquivo.':'Informe a UF da empresa para os cálculos de entrada e saída.'}</p></div>`:'';
  return `<div class="analysis-fiscal-documents">${ufField}<div class="analysis-document-list">${slots.map(([type,label,description,key,idKey])=>{
    const job=company?.[key],jobId=company?.[idKey]||job?._id,complete=job?.status==='COMPLETED';
    const localUpload=documentUploads[type]||{},upload=localUpload.status?.toLowerCase()==='completed'&&!complete?{}:localUpload;
    const running=!!upload.busy||['reading','preparing','uploading','processing'].includes(upload.status?.toLowerCase()),pending=!!upload.pending;
    const canSelect=canWrite&&!complete&&!pending&&job?.status!=='PROCESSING'&&!isReadyToFinalize(job),fileName=upload.fileName||job?.fileName;
    const href=company&&generation?._id===data.generationId&&!generationUnavailable?'/purchases.html?'+new URLSearchParams({generation:data.generationId,client:analysis.clientId,type,guided:'1',analysis:analysis.id,...(jobId?{job:jobId}:{})}):null;
    const state={label:complete?'Leitura concluída':running?'Lendo e salvando…':upload.error?'Envio pendente':generationUnavailable?'Documento indisponível':job?.status==='PROCESSING'?'Consulta em andamento':job?.status==='UPLOADING'?isReadyToFinalize(job)?'Finalização pendente':'Importação incompleta':!generation&&data.generationId?'Conferindo leitura…':'Aguardando documento',kind:complete?'ready':'pending'};
    let action=canSelect?`<button type="button" class="analysis-button primary" data-analysis-add-document="${type}" aria-label="Adicionar documento de ${label.toLocaleLowerCase('pt-BR')}" ${running?'disabled':''}>${job?.status==='UPLOADING'?'Continuar envio':'Adicionar arquivo'}</button><input type="file" data-analysis-document-file="${type}" accept=".csv,.xlsx,.xls" aria-label="Arquivo de ${label.toLocaleLowerCase('pt-BR')}" hidden ${running?'disabled':''}>`:'';
    if(canWrite&&!complete&&(upload.error&&pending||job?.status==='PROCESSING'||isReadyToFinalize(job)))action=`<button type="button" class="analysis-button primary" data-analysis-document-retry="${type}" ${running?'disabled':''}>${upload.error?'Tentar novamente':'Retomar leitura'}</button>`;
    if(href&&job&&(complete||!canWrite))action=`<a class="analysis-button" href="${href}">${complete?'Conferir relatório':'Conferir leitura'} →</a>`;
    const repairs=Array.isArray(upload.repairs)?upload.repairs.length:Number(upload.repairs)||0;
    const difal=renderDocumentDifal(documentDifalSummary({job,type,jobId,clientId:analysis.clientId,generationId:data.generationId,
      policy:(fiscalDraft||data).difalPolicy,regimeSelection:(configDraft||analysis.config).regimeSelection,choice:fiscalDifalChoice}),type);
    const details=`${canSelect&&!running?`<p class="analysis-document-hint">${job?.status==='UPLOADING'?'Selecione o mesmo arquivo para continuar.':'Arraste o arquivo ou selecione acima.'}<br>CSV, XLSX ou XLS · até 10 MiB</p>`:''}${upload.progress?`<p class="analysis-document-progress" data-analysis-document-progress="${type}" role="status" aria-live="polite">${esc(upload.progress)}</p>`:''}${upload.error?`<p class="analysis-document-error" data-analysis-document-error="${type}" role="alert">${esc(upload.error)}</p>`:''}${repairs?`<p class="analysis-document-hint">${repairs} linha(s) alinhada(s) automaticamente, preservando os valores originais.</p>`:''}`;
    return `<article class="analysis-document analysis-document-inline${canSelect?' is-uploadable':''}${complete?' is-complete':''}${running?' is-loading':''}" data-analysis-document="${type}" ${canSelect?`data-analysis-document-drop="${type}"`:''} aria-busy="${running}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>${label}</h3><p>${description}</p>${fileName?`<p class="analysis-document-filename">${esc(fileName)}</p>`:''}${badge(state)}${difal}</div>${action?`<div class="analysis-document-actions">${action}</div>`:''}${details?`<div class="analysis-document-upload-details">${details}</div>`:''}</article>`;
  }).join('')}</div>${canWrite?`<details class="analysis-document-options"><summary>Outras opções dos documentos</summary><div class="analysis-actions"><button type="button" id="analysis-start-import">${generationUnavailable?'Preparar nova importação':data.generationId?'Substituir os relatórios fiscais':'Preparar importação de entradas e saídas'}</button></div><p class="analysis-note">As versões e os relatórios anteriores continuam no histórico. Os relatórios conservam as opções de DIFAL desta importação; a simulação usa as escolhas atuais após concluir o Fiscal.</p></details>`:''}${company&&generation?._id===data.generationId&&!generationUnavailable?`<p class="analysis-document-history"><a href="/generations.html?${new URLSearchParams({id:data.generationId,analysis:analysis.id,client:analysis.clientId})}">Conferir todos os relatórios desta empresa →</a></p>`:''}</div>`;
}

export function renderFiscalEvidence({evidenceState,evidenceError,generationUnavailable=false,canWrite}) {
  if(evidenceState==='loading')return '<div class="analysis-evidence-loading" role="status"><strong>Conferindo documentos fiscais…</strong><span>Você pode preencher os campos ou continuar no Contábil enquanto a conferência termina.</span></div>';
  if(evidenceState==='error')return `<div class="analysis-evidence-error" role="status"><strong>Conferência dos documentos pendente</strong><p>${esc(evidenceError)}</p>${generationUnavailable?'<p>Você pode continuar preenchendo e salvando o Fiscal, a RBT12 e o Contábil. Para concluir, prepare uma nova importação e envie novamente as entradas e saídas.</p>':''}<div class="analysis-actions"><button type="button" id="analysis-retry-evidence">Tentar novamente</button>${generationUnavailable&&canWrite?'<button type="button" id="analysis-replace-missing-documents">Preparar nova importação</button>':generationUnavailable?'':'<button type="button" data-analysis-action="import">Conferir documentos fiscais</button>'}</div></div>`;
  return '';
}

export function renderFiscalReference({draft,reference,schedule}) {
  if(draft.rbt12Source==='MANUAL'||!reference||reference.extractionId!==draft.rbt12ExtractionId)return '';
  return `<div class="analysis-reference"><span class="analysis-eyebrow">SEÇÃO 2.2 · PA ${esc(reference.pa)}</span><strong>${money(reference.rbt12Cents/100)}</strong><p>O PDF conserva as receitas históricas necessárias. Serão usadas somente as competências disponíveis entre janeiro e setembro; cada RBT12 mantém os 12 meses anteriores da respectiva competência.</p><details><summary>Conferir a leitura do extrato</summary>${renderSection22(reference)}</details>${schedule?`<details><summary>RBT12 · ${schedule.rows.length} competência(s) no período${schedule.complete?'':' · histórico pendente'}</summary>${renderRbt12Schedule(schedule)}</details>`:''}</div>`;
}

export function renderInlineRbt12({analysis,fiscalDraft:draft,reference,pdfStatus,pdfBusy,canWrite}) {
  if(!requiresSimplesReference(analysis.config.regimeSelection))return '';
  const stored=!!draft.rbt12DocumentId,confirmed=!!draft.rbt12ExtractionId,
    manual=draft.rbt12Source==='MANUAL'&&draft.rbt12!==null,
    status=pdfStatus||(confirmed?'Leitura confirmada e salva no Fiscal.':manual?'Referência manual registrada.':stored?'PDF vinculado. Confira ou retome a leitura.':'Aguardando extrato do Simples em PDF.');
  const fileName=reference?.extractionId===draft.rbt12ExtractionId?reference.fileName:'';
  return `<article class="analysis-document analysis-document-inline analysis-inline-rbt12${confirmed?' is-complete':''}${pdfBusy?' is-loading':''}" aria-label="Documento RBT12" aria-busy="${!!pdfBusy}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>RBT12 · seção 2.2</h3><p>Adicione o extrato do Simples junto dos relatórios de entradas e saídas.</p>${fileName?`<p class="analysis-document-filename">${esc(fileName)}</p>`:''}</div>${canWrite?`<div class="analysis-document-actions"><button type="button" class="primary" id="analysis-add-rbt12-document" aria-label="${stored||confirmed?'Trocar':'Adicionar'} RBT12 em PDF" ${pdfBusy?'disabled':''}>${stored||confirmed?'Trocar PDF':'Adicionar PDF'}</button><input id="analysis-inline-rbt12-pdf" type="file" accept="application/pdf,.pdf" aria-label="Extrato RBT12 em PDF" hidden ${pdfBusy?'disabled':''}></div>`:''}<div class="analysis-document-upload-details"><p class="analysis-document-hint">PDF · até 8 MiB. A leitura da seção 2.2 começa ao selecionar o arquivo.</p><p id="analysis-inline-pdf-status" class="analysis-document-progress" role="status" aria-live="polite">${esc(status)}</p><div class="analysis-inline-rbt12-options"><button type="button" data-analysis-action="reference">${confirmed||manual||stored?'Conferir RBT12 e opções':'Informar RBT12 manualmente ou conferir opções'} →</button></div></div></article>`;
}

function extratoPanel({analysis,draft,reference,schedule,documentStatus,pdfStatus,pdfBusy,canWrite}) {
  if(!requiresSimplesReference(analysis.config.regimeSelection))return '<div class="analysis-message is-info">A análise seleciona somente Lucro Presumido e/ou Lucro Real. O extrato e a RBT12 do Simples não são exigidos.</div>';
  const manual=draft.rbt12Source==='MANUAL',stored=draft.rbt12DocumentId,hasReference=!!reference;
  const modes=`<div class="analysis-actions analysis-rbt12-modes"><button type="button" id="analysis-extrato-pdf" aria-pressed="${!manual}" ${!manual?'disabled':''}>Usar extrato em PDF</button><button type="button" id="analysis-extrato-manual" aria-pressed="${manual}" ${manual?'disabled':''}>Informar RBT12 sem o PDF</button></div>`;
  const manualFields=`<div class="analysis-manual-rbt12"><label for="analysis-rbt12">RBT12 efetiva dos 12 meses anteriores (R$)<input id="analysis-rbt12" type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" value="${reaisInput(draft.rbt12)}" placeholder="Informe o valor efetivo"></label><label class="analysis-check"><input type="checkbox" id="analysis-rbt12-confirm" ${draft.rbt12ManualConfirmed?'checked':''}>Confirmo a receita bruta efetiva dos 12 meses anteriores ao período de apuração. O valor ficará identificado como manual e fixo nas competências.</label></div>`;
  const upload=`<div class="analysis-upload"><label for="analysis-rbt12-pdf">Extrato ou declaração PGDAS-D (PDF)<input id="analysis-rbt12-pdf" type="file" accept="application/pdf,.pdf" ${!canWrite||pdfBusy?'disabled':''}></label><p>Selecione o PDF para armazenar e ler a seção 2.2 · até 8 MiB.</p>${canWrite?`<div class="analysis-actions"><button type="button" id="analysis-read-selected-pdf" ${pdfBusy?'disabled':''}>Ler PDF selecionado</button></div>`:''}
    <p id="analysis-pdf-status" class="analysis-upload-status" role="status" aria-live="polite">${esc(pdfStatus||(hasReference?'Leitura confirmada e salva no Fiscal. Confira a seção 2.2 abaixo.':stored?'Há um PDF vinculado. Confira a leitura ou tente novamente.':'Nenhum extrato confirmado nesta análise.'))}</p>
    ${stored?`<div class="analysis-document-actions"><a class="analysis-button" target="_blank" rel="noopener noreferrer" href="/api/v4/simples-documents/${encodeURIComponent(stored)}/file?kind=original">Ver original</a><a class="analysis-button" id="analysis-searchable-pdf" target="_blank" rel="noopener noreferrer" href="/api/v4/simples-documents/${encodeURIComponent(stored)}/file?kind=searchable" ${reference?.searchableStored!==false&&hasReference?'':'hidden'}>Ver PDF pesquisável</a><button type="button" id="analysis-extrato-status" ${pdfBusy?'disabled':''}>Verificar leitura</button>${canWrite?`<button type="button" id="analysis-extrato-retry" ${pdfBusy||documentStatus?.retryable===false?'disabled':''}>Ler novamente</button>`:''}</div>`:''}</div>`;
  return `<section class="analysis-extrato"><h3 class="analysis-subheading">Extrato do Simples Nacional</h3><p class="analysis-note">Necessário porque a análise inclui Simples Puro ou Híbrido. O extrato informa o histórico da seção 2.2. A simulação usa os meses disponíveis de janeiro a setembro. Cada RBT12 conserva os 12 meses anteriores; competências sem histórico suficiente são identificadas e ficam fora do cálculo.</p>${modes}${manual?manualFields:upload}<div id="analysis-fiscal-reference">${renderFiscalReference({draft,reference,schedule})}</div></section>`;
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
    <details class="analysis-difal-details" id="${esc(prefix)}-difal-details" ${decision==='yes'?'open':'hidden'}><summary>Definir regimes, entrada e saída</summary>${difalOptions(selection,policy)}</details>
  </section>`;
}

function difalOptions(selection,policy) {
  const selected=resolveRegimeSelection(selection).selected.filter(id=>['pure','hybrid'].includes(id));
  if(!selected.length)return '';
  return `<div class="analysis-difal-options">${selected.map(id=>`<fieldset data-analysis-difal="${id}"><legend>${esc(REGIME_LABELS[id])}</legend><label class="analysis-check"><input type="checkbox" data-analysis-difal-enabled="${id}" ${policy?.enabled?.[id]?'checked':''}>Incluir DIFAL neste regime</label>${[['entry','ENTRADA - antecipação das compras'],['exit','SAÍDAS - vendas']].map(([operation,label])=>`<label class="analysis-check"><input type="checkbox" data-analysis-difal-operation="${operation}" data-analysis-difal-regime="${id}" ${policy?.operations?.[id]?.[operation]?'checked':''} ${!policy?.enabled?.[id]?'disabled':''}>${label}</label>`).join('')}</fieldset>`).join('')}</div><p class="analysis-note">Somente Simples Puro e Híbrido. Entrada e saída são independentes; a aplicação continua sujeita às regras de cada competência e à situação do ICMS.</p>`;
}

function fiscalAdjustments(draft,source,canWrite,analysis,generation) {
  const rows=draft.monthlyOverrides?scopedAccountingMonths(analysis,draft.monthlyOverrides,source,generation):null;
  return `<details class="analysis-adjustments" id="analysis-fiscal-adjustments"><summary>Ajustes de receitas e compras por competência${rows?.length?` · ${rows.length} competência(s) registrada(s)`:''}</summary><p class="analysis-note">Os documentos permanecem preservados. Informe valores finais após devoluções. Ajustes de compras alteram o custo, sem criar crédito de ICMS de documentos.</p>${rows?.length?`<div class="analysis-expenses">${rows.map(row=>`<section class="analysis-expense-month" data-fiscal-month="${esc(row.sourceMonth)}"><header><h3>${esc(monthLabel(row.sourceMonth))}</h3><p>Valores do cenário em reais</p></header><div class="analysis-expense-fields">${ADJUSTMENT_FIELDS.map(([key,label],index)=>`<label>${label}<input type="number" step="0.01" ${index>2?'min="0"':''} inputmode="decimal" data-fiscal-field="${key}" value="${reaisInput(row.groups?.[key])}" placeholder="Valor após devoluções"></label>`).join('')}<label>Receita de serviços<input type="number" min="0" step="0.01" inputmode="decimal" data-fiscal-field="serviceRevenue" value="${reaisInput(row.serviceRevenue)}" placeholder="Serviços da competência"></label></div></section>`).join('')}</div>${canWrite?'<button type="button" id="analysis-clear-adjustments">Usar novamente os valores dos relatórios</button>':''}`:canWrite?`<span id="analysis-adjustment-source-action" ${source?.monthlyReports?.length?'':'hidden'}><button type="button" id="analysis-edit-adjustments">Editar valores por competência</button></span><p class="analysis-note">Nenhum ajuste manual registrado. Os valores serão os dos relatórios conciliados.</p>`:'<p class="analysis-note">Nenhum ajuste manual registrado. Os valores serão os dos relatórios conciliados.</p>'}</details>`;
}

export function renderAnalysisPeriod(options,{compact=false}={}) {
  const {analysis,source,generation}=options;
  if(!usesFixedAnalysisPeriod(analysis))return '';
  const period=analysisPeriodFor(analysis,source,generation),covered=new Set(period?.includedMonths||[]);
  const title=`Janeiro a setembro${period?' de '+period.sourceYear:''}`;
  return `<section class="analysis-period${compact?' is-compact':''}" aria-label="Período fixo da análise"><details class="analysis-period-details"><summary><strong aria-label="${esc(title)}">${esc(compact?'Jan–Set'+(period?' · '+period.sourceYear:''):title)}</strong><span>${period?`${covered.size}/9 meses cobertos`:'9 meses'} · Conferir</span></summary><div class="analysis-period-months" aria-label="Cobertura de entradas e saídas">${MONTHS.slice(0,9).map((name,index)=>{const month=period?.expectedMonths[index],present=month&&covered.has(month);return `<span class="${period?present?'is-covered':'is-missing':''}" title="${esc(name+(period?present?' · cobertura de entradas e saídas':' · cobertura fiscal pendente':''))}">${name.slice(0,3)}${period?`<small aria-label="${present?'coberto':'pendente'}">${present?'✓':'·'}</small>`:''}</span>`;}).join('')}</div><p class="analysis-period-status">Somente os meses disponíveis entre janeiro e setembro entram no cálculo. Outubro a dezembro ficam fora dos totais.</p></details>${!period?'<p class="analysis-period-status">O ano será identificado nos documentos.</p>':''}${period&&!period.complete?`<p class="analysis-period-warning">Nenhum mês possui cobertura conjunta de entradas e saídas. Confira: ${period.missingMonths.map(month=>esc(monthLabel(month))).join(' · ')}.</p>`:''}</section>`;
}

export function renderFiscalComposition(options) {
  const composition=options.source?.commercialComposition;
  return composition?renderCommercialComposition(composition,{title:'Receitas e compras dos documentos',compact:true})+
    (options.fiscalDraft?.monthlyOverrides?.length?'<p class="analysis-note">A composição mantém a classificação dos documentos. Ajustes manuais de receita e compras são aplicados no resultado da simulação.</p>':''):'';
}

function fiscalPanel(options) {
  const {analysis,fiscalDraft:draft,canWrite,configDirty}=options,simples=requiresSimplesReference(analysis.config.regimeSelection);
  const customized=draft.salesAnnex!==1||simples&&(draft.serviceAnnex!==3||draft.icmsOutside)||!!draft.monthlyOverrides?.length;
  const optionsSummary=simples?'Atividade, anexos, ICMS/ISS e ajustes por competência.':'Atividade e ajustes de receitas e compras por competência.';
  const tax=`<details class="analysis-options-panel" id="analysis-fiscal-options" ${customized?'open':''}><summary><strong>Opções fiscais e ajustes</strong><span>${esc(optionsSummary)}</span></summary><div class="analysis-options-content"><div class="analysis-form-grid analysis-fiscal-options"><label>Atividade das vendas<select id="analysis-sales-annex"><option value="1" ${draft.salesAnnex===1?'selected':''}>Comércio · Anexo I</option><option value="2" ${draft.salesAnnex===2?'selected':''}>Indústria · Anexo II</option></select></label>${simples?`<label>Categoria dos serviços<select id="analysis-service-annex"><option value="3" ${draft.serviceAnnex===3?'selected':''}>Anexo III</option><option value="4" ${draft.serviceAnnex===4?'selected':''}>Anexo IV</option><option value="5" ${draft.serviceAnnex===5?'selected':''}>Anexo V</option></select></label>`:''}${simples?`<label class="full">ICMS e ISS no cenário do Simples<select id="analysis-icms-outside"><option value="inside" ${!draft.icmsOutside?'selected':''}>Dentro do DAS</option><option value="outside" ${draft.icmsOutside?'selected':''}>Fora do DAS · situação já confirmada</option></select><small>A escolha não é automática pelo limite de receita. Confirme a situação aplicável à empresa.</small></label>`:''}</div>${fiscalAdjustments(draft,options.source,canWrite,analysis,options.generation)}</div></details>${configDirty?'<p class="analysis-message is-warning">Salve os regimes e o ano antes de concluir o Fiscal.</p>':''}`;
  const config=options.configDraft||analysis.config;
  const regimes=`${regimeChoices(config.regimeSelection,'analysis-fiscal-regime')}<label class="analysis-config-year">Ano do cenário<select id="analysis-fiscal-year"><option value="2027" ${config.year===2027?'selected':''}>2027</option><option value="2028" ${config.year===2028?'selected':''}>2028</option></select></label><p class="analysis-note">Escolha um ou mais regimes. A DRE única compara somente os regimes selecionados. O período dos documentos fica limitado aos meses disponíveis de janeiro a setembro.</p>`;
  const form=`<form id="analysis-fiscal-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('regimes','Quais regimes terão DRE?','Selecione os regimes da comparação.',regimes,{first:true})}
      ${wizardStep('difal','DIFAL por regime','Defina se haverá DIFAL e as operações de cada Simples.',renderDifalChoice(analysis.config.regimeSelection,draft.difalPolicy,{choice:options.fiscalDifalChoice})||'<p class="analysis-note">Os regimes escolhidos não utilizam as opções de DIFAL do Simples. Continue para os documentos.</p>')}
      ${wizardStep('rbt12','RBT12 · seção 2.2','',extratoPanel({...options,draft}))}
      ${wizardStep('documents','Relatórios de entradas e saídas','Importe e confira somente as competências disponíveis entre janeiro e setembro.',`<div id="analysis-fiscal-period">${renderAnalysisPeriod(options,{compact:true})}</div><div id="analysis-fiscal-evidence">${renderFiscalEvidence(options)}</div><div id="analysis-fiscal-documents-view">${renderFiscalReports(options)}</div>${simples?`<div id="analysis-inline-rbt12-view">${renderInlineRbt12(options)}</div>`:''}<div id="analysis-commercial-composition">${renderFiscalComposition(options)}</div>${tax}`)}
    </fieldset></div>${wizardFooter({canWrite,sector:'fiscal',analysisId:analysis.id,finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Salvar e concluir</button>`:''})}</form>`;
  return wizardFrame('fiscal','Fiscal',analysis.company?.name||'Documentos e tributação.',form);
}

function accountingMonth(row,canWrite,first=false) {
  const complete=ACCOUNTING_FIELDS.every(([key])=>Number.isSafeInteger(row[key])&&row[key]>=0),total=complete?ACCOUNTING_FIELDS.reduce((sum,[key])=>sum+row[key],0):null;
  return `<details class="analysis-expense-month" data-accounting-month="${esc(row.sourceMonth)}" id="analysis-month-${esc(row.sourceMonth)}" ${first?'open':''}><summary><span class="analysis-expense-month-name">${esc(monthLabel(row.sourceMonth))}</span><span class="analysis-expense-month-total"><small>Despesas do mês</small><strong data-accounting-total>${total===null?ACCOUNTING_FIELDS.every(([key])=>row[key]===null)?'Não incluído · sem valores':'Preenchimento incompleto':money(total/100)}</strong></span></summary><div class="analysis-expense-fields">${ACCOUNTING_FIELDS.map(([key,label])=>`<label>${label} (R$)<input type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" data-accounting-field="${key}" value="${centsInput(row[key])}" placeholder="Não informado" aria-label="${esc(label+' em '+monthLabel(row.sourceMonth))}"></label>`).join('')}</div>${canWrite?`<div class="analysis-expense-month-actions"><button type="button" data-zero-month="${esc(row.sourceMonth)}" title="Use somente quando não houver despesa nas categorias ainda em branco.">Preencher vazios com zero</button><button type="button" data-remove-month="${esc(row.sourceMonth)}" aria-label="Remover ${esc(monthLabel(row.sourceMonth))}">Limpar mês</button></div>`:''}</details>`;
}

export function renderAccountingCopy(options) {
  const {analysis,accountingDraft,canWrite,source,generation,accountingCopy={}}=options;
  if(!canWrite)return '';
  const months=scopedAccountingMonths(analysis,accountingDraft.months||[],source,generation).map(row=>row.sourceMonth);
  const mode=['manual','copy','repeat'].includes(accountingCopy.mode)?accountingCopy.mode:'manual';
  const sourceMonth=months.includes(accountingCopy.sourceMonth)?accountingCopy.sourceMonth:months[0]||'';
  const targets=months.filter(month=>month!==sourceMonth);
  const targetMonth=targets.includes(accountingCopy.targetMonth)?accountingCopy.targetMonth:targets.find(month=>month>sourceMonth)||targets[0]||'';
  const choices=[['manual','Preencher mês a mês','Digite valores diferentes em cada competência.'],['copy','Copiar para outro mês','Use um mês preenchido como base para outro.'],['repeat','Repetir em todos os meses','Use os mesmos valores nos meses deste período.']];
  const selectOptions=(values,selected)=>values.map(month=>`<option value="${esc(month)}" ${month===selected?'selected':''}>${esc(monthLabel(month))}</option>`).join('');
  return `<section class="analysis-accounting-copy" aria-labelledby="analysis-accounting-copy-heading">
    <h3 id="analysis-accounting-copy-heading">Como deseja preencher?</h3>
    <fieldset class="analysis-accounting-copy-modes"><legend class="sr-only">Forma de preenchimento das despesas</legend>${choices.map(([id,label,description])=>`<label class="analysis-accounting-copy-mode ${mode===id?'is-selected':''}"><input type="radio" name="accounting-fill-mode" id="analysis-accounting-mode-${id}" value="${id}" ${mode===id?'checked':''}><span><strong>${label}</strong><small>${description}</small></span></label>`).join('')}</fieldset>
    <p class="analysis-accounting-copy-manual" ${mode==='manual'?'':'hidden'}>Abra cada mês abaixo para informar as despesas. Você também pode copiar valores e depois ajustar cada mês separadamente.</p>
    <div class="analysis-accounting-copy-controls" ${mode==='manual'?'hidden':''}>
      <div class="analysis-accounting-copy-selectors"><label for="analysis-accounting-copy-source">Copiar valores de<select id="analysis-accounting-copy-source" ${months.length?'':'disabled'}>${months.length?selectOptions(months,sourceMonth):'<option value="">Nenhum mês disponível</option>'}</select></label>
      <label for="analysis-accounting-copy-target" ${mode==='copy'?'':'hidden'}>Para o mês<select id="analysis-accounting-copy-target" ${targets.length?'':'disabled'}>${targets.length?selectOptions(targets,targetMonth):'<option value="">Nenhum outro mês disponível</option>'}</select></label></div>
      <div id="analysis-accounting-copy-preview" class="analysis-accounting-copy-preview" aria-live="polite"></div>
      <button type="button" class="primary" id="analysis-accounting-copy-apply" disabled>Aplicar cópia</button>
    </div>
    <div class="analysis-accounting-copy-result"><p id="analysis-accounting-copy-status" role="status" ${accountingCopy.message?'':'hidden'}>${esc(accountingCopy.message||'')}</p><button type="button" id="analysis-accounting-copy-undo" ${accountingCopy.undo?'':'hidden'}>Desfazer cópia</button></div>
  </section>`;
}

export function renderAccountingSummary({months=[],expectedMonths=[]}) {
  const summary=accountingSummary(months,expectedMonths),amount=value=>value===null?'Sem valores informados':money(value/100);
  return `<div class="analysis-summary-heading"><div><h3>Meses e valores do relatório</h3><p>O consolidado soma os meses preenchidos, sem projetar valores para meses vazios.</p></div>${badge({kind:summary.complete?'ready':'pending',label:summary.complete?'Preenchimento pronto':summary.enteredMonths?'Complete os meses iniciados':'Nenhum mês preenchido'})}</div>
    <div class="analysis-accounting-totals">
      <div><span>Total preenchido</span><strong data-accounting-summary-total>${amount(summary.enteredCents)}</strong><small>${summary.filledFields} campo(s) informado(s)</small></div>
      <div><span>Meses prontos para o relatório</span><strong data-accounting-summary-months>${summary.completeMonths} / ${summary.monthCount}</strong><small>Com as cinco contas informadas</small></div>
      <div><span>Meses em branco descartados</span><strong data-accounting-summary-excluded>${summary.excludedMonths.length}</strong><small data-accounting-summary-missing>${summary.missingFields} campo(s) pendente(s) em meses iniciados</small></div>
    </div>
    <p class="analysis-summary-note">${summary.includedMonths.length?'<strong>Meses preenchidos:</strong> '+summary.includedMonths.map(month=>esc(monthLabel(month))).join(' · ')+'.':'Preencha pelo menos um mês para concluir.'} Os documentos fiscais e a referência RBT12 precisam cobrir os meses usados no resultado final.</p>
    ${summary.excludedMonths.length?`<p class="analysis-summary-note"><strong>Fora do cálculo por falta de preenchimento:</strong> ${summary.excludedMonths.map(month=>esc(monthLabel(month))).join(' · ')}. Nenhum valor foi tratado como zero.</p>`:''}
    ${summary.extraMonths.length?`<p class="analysis-summary-alert"><strong>Conferir a cobertura fiscal:</strong> ${summary.extraMonths.map(month=>esc(monthLabel(month))).join(' · ')}.</p>`:''}
    ${summary.enteredMonths?`<details class="analysis-accounting-breakdown" id="analysis-accounting-breakdown"><summary>Conferir valores por conta e competência</summary><div class="analysis-accounting-breakdown-grid">
      <section><h4>Por conta</h4><dl class="analysis-cost-list">${summary.categories.map(category=>`<div data-accounting-category="${category.key}"><dt>${esc(category.label)}<small>${category.filledMonths} de ${summary.enteredMonths} mês(es) iniciado(s)</small></dt><dd>${amount(category.enteredCents)}${category.missingMonths.length?`<small>${category.missingMonths.length} pendente(s)</small>`:''}</dd></div>`).join('')}</dl></section>
      <section><h4>Por competência</h4><dl class="analysis-cost-list">${summary.rows.filter(row=>!row.excluded).map(row=>`<div data-accounting-summary-month="${esc(row.sourceMonth)}"><dt>${esc(monthLabel(row.sourceMonth))}<small>${row.filledFields} de ${ACCOUNTING_FIELDS.length} contas informadas</small></dt><dd>${amount(row.enteredCents)}${row.missingFields.length?`<small>${row.missingFields.length} campo(s) pendente(s)</small>`:''}</dd></div>`).join('')}</dl></section>
    </div></details>`:''}`;
}

export function renderAccountingSourceMonths(options) {
  const {analysis,accountingDraft,canWrite,source,generation,metadataState,generationError}=options;
  const sourceMonths=accountingSourceMonths(analysis,source,generation,accountingDraft.months),months=accountingDraft.months||[];
  const missing=sourceMonths.filter(month=>!months.some(row=>row.sourceMonth===month));
  if(sourceMonths.length)return `<p class="analysis-note"><strong>${usesFixedAnalysisPeriod(analysis)?'Período da análise:':'Meses dos relatórios fiscais:'}</strong> ${usesFixedAnalysisPeriod(analysis)?`Janeiro a setembro de ${esc(sourceMonths[0].slice(0,4))} · 9 competências`:sourceMonths.map(month=>esc(monthLabel(month))).join(' · ')}</p>${canWrite&&missing.length?`<div class="analysis-actions"><button type="button" id="analysis-add-fiscal-months">Adicionar ${missing.length} competência(s) ${usesFixedAnalysisPeriod(analysis)?'da análise':'do Fiscal'}</button></div>`:''}`;
  if(metadataState==='loading')return '<p class="analysis-note" role="status">Identificando as competências dos documentos… Você pode continuar preenchendo.</p>';
  if(metadataState==='error')return `<p class="analysis-note" role="status">${esc(generationError||'Não foi possível conferir as competências dos documentos.')} Os valores contábeis podem ser preenchidos e salvos.</p><button type="button" id="analysis-retry-accounting-months">Conferir competências novamente</button>`;
  if(analysis.fiscal.data.generationId&&metadataState==='ready')return '<p class="analysis-note">Os períodos de entradas e saídas ainda precisam ser conferidos no Fiscal. Adicione os meses manualmente enquanto os documentos são ajustados.</p>';
  return `<p class="analysis-note">${canWrite?'Você pode preencher antes do Fiscal. ':''}Os meses serão conferidos após a importação.</p>`;
}

function accountingPanel(options) {
  const {analysis,accountingDraft,canWrite,configDirty,source,generation}=options;
  const storedMonths=accountingDraft.months||[],months=scopedAccountingMonths(analysis,storedMonths,source,generation),sourceMonths=accountingSourceMonths(analysis,source,generation,accountingDraft.months);
  const fixed=usesFixedAnalysisPeriod(analysis),period=analysisPeriodFor(analysis,source,generation),year=period?.sourceYear||months[0]?.sourceMonth.slice(0,4)||'';
  const addControl=fixed?`<div class="analysis-add-month analysis-prepare-period"><label for="analysis-new-source-year">Ano dos documentos<input type="number" id="analysis-new-source-year" min="2000" max="2099" step="1" inputmode="numeric" placeholder="Ex.: 2026" value="${esc(year)}" ${period?'readonly':''}></label><button type="button" id="analysis-add-month">Preparar janeiro a setembro</button><p class="analysis-note">Adiciona os nove meses com os campos em branco. Valores já preenchidos no mesmo ano são mantidos.</p></div>`:`<div class="analysis-add-month"><label for="analysis-new-month">Adicionar competência<input type="month" id="analysis-new-month" min="2000-01" max="2099-12"></label><button type="button" id="analysis-add-month">Adicionar mês</button></div>`;
  const monthsContent=`<details class="analysis-accounting-tools" id="analysis-accounting-tools" ${months.length?'':'open'}><summary>${canWrite?'Adicionar meses ou colar planilha':'Competências dos documentos'}</summary><div class="analysis-accounting-tools-content"><div id="analysis-accounting-source-months">${renderAccountingSourceMonths(options)}</div>
    ${canWrite?addControl:''}
    <div id="analysis-accounting-import"></div></div></details>`;
  const valuesContent=`<div id="analysis-accounting-period">${renderAnalysisPeriod(options,{compact:true})}</div>${monthsContent}<div id="analysis-accounting-excluded">${storedMonths.length>months.length?`<p class="analysis-period-excluded">${storedMonths.length-months.length} competência(s) fora do período permanecem salvas e não entram nos totais abaixo.</p>`:''}</div><div id="analysis-accounting-copy">${renderAccountingCopy(options)}</div><div class="analysis-accounting-quickbar"><p>Preencha os meses disponíveis. Um mês totalmente em branco fica fora do relatório. Em um mês iniciado, informe as cinco contas e use zero nas categorias sem gasto.</p>${canWrite&&months.length?'<button type="button" id="analysis-zero-empty">Preencher campos vazios com R$ 0,00</button>':''}</div><div class="analysis-expenses" id="analysis-expenses">${months.length?months.map((row,index)=>accountingMonth(row,canWrite,index===0)).join(''):'<p class="analysis-note analysis-accounting-empty">Nenhuma competência adicionada.</p>'}</div><p class="analysis-note">Meses totalmente em branco são descartados do cálculo. Meses parcialmente preenchidos precisam ser completados. Zero é um valor informado e cada despesa deve aparecer uma única vez.</p>

        <details class="analysis-accounting-summary-panel" id="analysis-accounting-summary-panel" open><summary>Ver meses incluídos e totais das despesas</summary><div id="analysis-accounting-summary" class="analysis-accounting-summary" aria-label="Resumo das despesas informadas">${renderAccountingSummary({months,expectedMonths:sourceMonths})}</div></details>${configDirty?'<p class="analysis-message is-warning">Salve os regimes e o ano antes de concluir o Contábil.</p>':''}`;
  const form=`<form id="analysis-accounting-form" class="analysis-wizard-form" novalidate><div class="analysis-wizard-body"><fieldset class="analysis-fields" ${canWrite?'':'disabled'}>
      ${wizardStep('values','Despesas por mês','',valuesContent,{first:true})}
    </fieldset></div>${wizardFooter({canWrite,sector:'accounting',analysisId:analysis.id,finalAction:canWrite?`<button type="submit" name="intent" value="complete" class="primary" ${configDirty?'disabled':''}>Salvar e concluir</button>`:''})}</form>`;
  return wizardFrame('accounting','Contábil',analysis.company?.name||'Despesas por competência.',form);
}

export function renderAnalysisGuidance(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options);
  const description=!canWrite?'Consulte os dados salvos de cada setor.':guidance.hasUnsavedChanges?'Há alterações ainda não salvas.':guidance.state==='current'?'Abra um setor para editar os dados.':guidance.state==='ready'?'Os dois setores estão conferidos.':'Preencha os dois setores, em qualquer ordem.';
  return `<p class="analysis-guidance-strip" data-analysis-guidance-state="${guidance.state}">${description}</p>`;
}

export function renderAnalysisGeneration(options) {
  const {analysis,canWrite}=options,guidance=analysisGuidance(analysis,options),current=analysis.currentSimulation;
  return `<section class="analysis-panel analysis-generate" id="analysis-generation" data-analysis-result-state="${guidance.state}" aria-label="Resultado da análise"><div class="analysis-generation-top"><div class="analysis-panel-heading"><p>${guidance.state==='current'?'Resultado da última versão salva.':guidance.state==='ready'?canWrite?'Compare os regimes com os dados conferidos.':'A equipe pode gerar o resultado com os dados conferidos.':esc(guidance.primaryAction.message)}</p></div>
    <div class="analysis-actions">${canWrite?`<button type="button" class="primary" id="analysis-generate" ${guidance.canGenerate?'':'disabled'} ${guidance.state==='current'?'hidden':''}>${current?'Atualizar resultado':'Gerar análise'}</button>`:''}${current?`<a class="analysis-button ${guidance.state==='current'?'primary':''}" href="${resultUrl(analysis)}">${guidance.state==='current'?(guidance.savedVerification?'Ver DRE salva':'Ver DRE atual'):'Ver última versão salva'} →</a>`:''}</div></div>
    ${guidance.issues.length?`<details class="analysis-pending-issues" id="analysis-pending-issues"><summary>Pendências para gerar · ${guidance.issues.length}</summary><ul class="analysis-checklist analysis-action-checklist">${guidance.issues.map(issue=>`<li data-analysis-issue="${esc(issue.code)}"><span class="analysis-issue-marker" aria-hidden="true">→</span><div><p>${esc(issue.message)}</p>${actionButton(issue,{canWrite})}</div></li>`).join('')}</ul></details>`:''}</section>`;
}

function deleteAnalysisDialog(analysis,canWrite) {
  return `<dialog id="analysis-delete-dialog" class="analysis-delete-dialog" aria-labelledby="analysis-delete-title" aria-describedby="analysis-delete-description analysis-delete-effect"><div class="analysis-delete-content"><div class="analysis-delete-body"><h2 id="analysis-delete-title">Excluir análise?</h2><p id="analysis-delete-description">A análise e os dados dos setores Fiscal e Contábil serão excluídos definitivamente, incluindo as versões de simulação vinculadas, se houver.</p>
    <div class="analysis-delete-target"><strong id="analysis-delete-company">${esc(analysis?.company?.name||'Empresa')}</strong><span id="analysis-delete-cnpj">${esc(analysis?.company?.cnpj||'CNPJ não informado')}</span><small id="analysis-delete-context">${analysis?.company?.code?'Código '+esc(analysis.company.code)+' · ':''}${analysis?'Cenário '+esc(analysis.config.year):''}</small></div>
    <p id="analysis-delete-effect" class="analysis-delete-effect">O cadastro da empresa e os documentos fiscais serão preservados. Você poderá iniciar uma nova análise vazia para esta empresa. Esta ação não pode ser desfeita.</p><p id="analysis-delete-error" class="analysis-delete-error" role="alert"></p><p id="analysis-delete-status" class="analysis-delete-status" role="status" aria-live="polite"></p></div>
    <div class="analysis-delete-actions"><button type="button" id="analysis-delete-cancel" autofocus>Cancelar</button><button type="button" id="analysis-delete-confirm" class="analysis-danger-solid" ${canWrite?'':'disabled'}>Excluir análise</button></div></div></dialog>`;
}

export function renderAnalysisDetail(options) {
  const {analysis,canWrite,versionsOpen,modalKind}=options;
  const modal=modalKind==='fiscal'?fiscalPanel(options):modalKind==='accounting'?accountingPanel(options):modalKind==='config'?configPanel(options):'';
  return `<a class="analysis-back" href="/analyses.html?view=list">← Todas as análises</a>
    <div class="analysis-heading analysis-company-heading"><div><h1>${esc(analysis.company?.name||'Empresa')}</h1><p class="analysis-company-identity">Código ${esc(analysis.company?.code||'—')} · CNPJ ${esc(displayCnpj(analysis.company?.cnpj))} · Cenário ${esc(analysis.config.year)}</p></div><div class="analysis-heading-actions"><button type="button" id="analysis-open-config" class="analysis-button" data-analysis-action="config" aria-haspopup="dialog">${icon('settings')}${canWrite?'Regimes e ano':'Consultar escolhas'}</button></div></div>
    <div class="analysis-detail-overview"><div id="analysis-overview-period">${renderAnalysisPeriod(options)}</div>
      ${analysis.legacy?'<p class="analysis-note analysis-legacy-note">O trabalho anterior foi preservado. Confira os setores para gerar a próxima versão.</p>':''}
      <section class="analysis-workflow" aria-label="Dados e resultado da análise"><section class="analysis-guidance" id="analysis-guidance" aria-label="Situação da análise">${renderAnalysisGuidance(options)}</section>${sectorChooser(analysis,options)}${renderAnalysisGeneration(options)}</section>
      <div class="analysis-secondary-actions"><details class="analysis-versions" id="analysis-versions" ${versionsOpen?'open':''}><summary>Versões anteriores</summary><div id="analysis-version-list"><p class="analysis-note">Abra para consultar as versões salvas.</p></div></details>${canWrite?`<button type="button" id="analysis-delete" class="analysis-card-delete analysis-danger" data-delete-analysis="${esc(analysis.id)}" aria-haspopup="dialog">${deleteIcon}Excluir análise</button>`:''}</div>
    </div>${modal}${deleteAnalysisDialog(analysis,canWrite)}`;
}

export function renderAnalysisVersions({items,pagination,currentId}) {
  return `${items.length?`<div class="analysis-document-list">${items.map(item=>{const id=item.id||item._id;return `<article class="analysis-document" data-analysis-version="${esc(id)}"><span class="analysis-document-icon">${icon('report')}</span><div class="analysis-document-copy"><h3>${esc(id===currentId?'Versão corrente':item.title||'Versão salva')}</h3><p>${dates(item.createdAt)}${item.createdBy?.name?' · '+esc(item.createdBy.name):''}</p><p>${item.year?'Cenário '+esc(item.year)+' · ':''}Modelo ${esc(item.modelVersion||'registrado na simulação')}</p></div><div class="analysis-document-actions"><a class="analysis-button" href="/simulator.html?${new URLSearchParams({simulation:id})}">Abrir DRE →</a></div></article>`;}).join('')}</div>`:'<p class="analysis-note">Ainda não há uma versão gerada para esta análise.</p>'}<div class="analysis-pagination"><button type="button" data-versions-page="${pagination.page-1}" ${pagination.page<=1?'disabled':''}>Anterior</button><p>Página ${pagination.page} de ${Math.max(1,pagination.totalPages)}</p><button type="button" data-versions-page="${pagination.page+1}" ${pagination.page>=pagination.totalPages?'disabled':''}>Próxima</button></div>`;
}
