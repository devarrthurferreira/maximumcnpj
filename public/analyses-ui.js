import {mountNavigation} from './navigation.js';
import {analysisRequest} from './analyses-api.js';
import {defaultRegimeSelection,parseRegimeSelection,requiresSimplesReference,REGIME_SELECTION_VERSION} from './regime-selection.js';
import {defaultDifalPolicy,parseDifalPolicy} from './simulator-engine.js';
import {buildRbt12Schedule} from './simulator-rbt12.js';
import {analysisDocumentStatus,loadAnalysisExtraction,retryAnalysisExtraction,uploadAnalysisExtraction} from './analyses-extrato.js';
import {parseAccountingPaste,planAccountingPaste,ACCOUNTING_IMPORT_CSV_TEMPLATE} from './analysis-accounting-import.js';
import {renderAccountingPaste} from './analyses-accounting-paste.js';
import {analysisGuidance} from './analyses-guidance.js';
import {wizardSteps,wizardStep,initialWizardStep} from './analyses-wizard.js';
import {createAnalysisModal,restoreAnalysisNotices} from './analyses-modal.js';
import {ACCOUNTING_FIELDS,ADJUSTMENT_FIELDS,esc,money,monthLabel,sectorName,analysisUrl,companyResults,
  renderNewAnalysis,renderNewCompanyContext,renderAnalysisList,renderAnalysisDetail,renderAnalysisVersions,
  renderAnalysisGuidance,renderAccountingSummary,renderAnalysisGeneration,renderWizardReview} from './analyses-view.js';

const $=(selector,root=document)=>root.querySelector(selector);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const clone=value=>structuredClone(value);
const S={user:null,clients:null,analysis:null,sector:null,source:null,generation:null,generationError:'',reference:null,
  documentStatus:null,pdfStatus:'',pdfBusy:false,busy:false,sequence:0,configDraft:null,fiscalDraft:null,accountingDraft:null,
  configDirty:false,fiscalDirty:false,accountingDirty:false,versionsOpen:false,versionsData:null,versionsLoading:false,
  generateRequest:null,newClient:'',newSearch:'',newSector:'',newYear:2027,newSelection:defaultRegimeSelection(),
  newChoiceIds:defaultRegimeSelection().selected,newExisting:null,newCheckingCompany:false,newCompanyError:'',companyCheckSequence:0,
  paste:{text:'',preview:null,error:'',replaceConfirmed:false,open:false,pending:false},detailOpen:{},
  modalKind:null,modalOpen:false,modalSteps:{},modalReturn:null};
let modal=null;
const writable=()=>['admin','operator'].includes(S.user?.role);
const dirty=()=>S.configDirty||S.fiscalDirty||S.accountingDirty;
const hasLocalWork=()=>dirty()||S.paste.pending;
const apiPath=suffix=>'/api/v4/analyses'+(suffix||'');

function feedback(message,kind='') {
  const host=$('#analysis-feedback');host.textContent=message||'';host.hidden=!message;
  host.className='analysis-message'+(kind?' is-'+kind:'');
}
function clearError(){const host=$('#analysis-error');host.replaceChildren();host.hidden=true;}
function showError(error) {
  const host=$('#analysis-error');host.replaceChildren();host.hidden=false;
  const conflict=error?.status===409&&error?.code==='ANALYSIS_CONFLICT';
  const message=document.createElement('p');
  message.textContent=conflict?'Este trabalho foi atualizado em outra aba ou por outra pessoa. Seus campos continuam nesta tela. Confira a versão salva antes de continuar.':error?.message||'Não foi possível concluir a operação. Tente novamente.';
  host.append(message);
  if(conflict){
    const button=document.createElement('button');button.type='button';button.textContent='Recarregar o trabalho salvo';
    button.onclick=async()=>{
      if(hasLocalWork()&&!confirm('Recarregar os dados salvos? As alterações e a colagem ainda não aplicadas nesta tela serão descartadas.'))return;
      S.configDirty=S.fiscalDirty=S.accountingDirty=false;
      await openAnalysis(S.analysis.id).catch(showError);
    };
    host.append(button);
  }
  host.scrollIntoView({block:'nearest',behavior:'instant'});
}
function markDirty(sector) {
  S[sector+'Dirty']=true;S.generateRequest=null;
  if(sector==='accounting')invalidatePastePreview('Os valores do formulário mudaram. Confira novamente a colagem antes de aplicá-la.');
  const generate=$('#analysis-generate');if(generate)generate.disabled=true;
  feedback('Há alterações ainda não salvas. Salve o trabalho do setor para compartilhá-las com a equipe.','info');
  refreshGuidance();
}
function setBusy(value,message='') {
  S.busy=value;$('#analyses-app').setAttribute('aria-busy',String(value));
  if(value){
    document.querySelectorAll('#analyses-app fieldset.analysis-fields,#analysis-new-form fieldset').forEach(field=>field.disabled=true);
    document.querySelectorAll('#analyses-app button').forEach(button=>button.disabled=true);
    if($('#analysis-accounting-paste'))$('#analysis-accounting-paste').disabled=true;
    if($('#analysis-paste-replace-confirm'))$('#analysis-paste-replace-confirm').disabled=true;
    if($('#analysis-company-search'))$('#analysis-company-search').disabled=true;
    if(message)feedback(message,'info');
  }
  if(modal&&S.modalKind)modal.sync(currentWizardState(),{busy:value||S.pdfBusy});
}

function currentWizardState() {
  const kind=S.modalKind,resume=kind==='new'&&!!S.newExisting;
  let step=S.modalSteps[kind];
  const steps=wizardSteps(kind,{resume});
  if(!steps.some(item=>item.id===step)){
    step=initialWizardStep(kind,{resume,hasDocuments:!!S.source?.monthlyReports?.length,hasMonths:!!S.accountingDraft?.months?.length}).id;
  }
  S.modalSteps[kind]=step;return wizardStep(kind,step,{resume});
}
function releaseWizard() {modal?.dispose();modal=null;restoreAnalysisNotices();}
function wizardReturnTarget() {
  if(S.modalReturn?.isConnected)return S.modalReturn;
  if(S.modalKind==='new')return $('#analysis-resume-new');
  if(S.modalKind==='config')return $('#analysis-open-config');
  return document.querySelector(`[data-analysis-sector="${S.modalKind}"]`)||$('#analysis-open-config');
}
function syncWizardUrl() {
  if(!S.analysis)return;
  const url=new URL(location.href);url.searchParams.delete('step');url.searchParams.delete('resumed');
  if(S.modalOpen){
    if(['fiscal','accounting'].includes(S.modalKind)){url.searchParams.set('sector',S.modalKind);url.searchParams.delete('view');}
    else if(S.modalKind==='config'){url.searchParams.set('view','settings');url.searchParams.delete('sector');}
    url.searchParams.set('step',currentWizardState().id);
  }else{
    url.searchParams.delete('sector');if(url.searchParams.get('view')==='settings')url.searchParams.delete('view');
  }
  history.replaceState(null,'',url.pathname+url.search);
}
function newOptions() {
  return {kind:'new',modalKind:'new',clients:S.clients,clientId:S.newClient,search:S.newSearch,selection:S.newSelection,
    sector:S.newSector,year:S.newYear,canWrite:writable(),existingAnalysis:S.newExisting,
    checkingCompany:S.newCheckingCompany,companyCheckError:S.newCompanyError};
}
function refreshWizardReview() {
  const host=$('#analysis-wizard-review');
  if(host)host.innerHTML=renderWizardReview(S.modalKind==='new'?newOptions():detailOptions());
  if(S.modalKind==='accounting')refreshAccountingSummary();
}
function setWizardStep(step,{focus=true}={}) {
  if(!S.modalKind)return;
  const state=wizardStep(S.modalKind,step,{resume:S.modalKind==='new'&&!!S.newExisting});
  S.modalSteps[S.modalKind]=state.id;
  if(state.isLast)refreshWizardReview();
  modal?.sync(state,{focus});syncWizardUrl();
}
function revealWizardField(field) {
  if(!field)return;
  const panel=field.closest('[data-wizard-step]');
  if(panel&&$('#analysis-wizard')){
    S.modalOpen=true;
    S.modalSteps[S.modalKind]=panel.dataset.wizardStep;
    modal?.open(currentWizardState(),{focus:false});syncWizardUrl();
  }
  for(let parent=field.closest('details');parent;parent=parent.parentElement?.closest('details'))parent.open=true;
}
function validateWizardAdvance(state) {
  if(S.modalKind==='new'){
    captureNewChoices();
    if(state.id==='company'){
      if(!uuid(S.newClient)){$('#analysis-company-search')?.focus();throw new Error('Selecione a empresa encontrada na busca antes de continuar.');}
      if(S.newCheckingCompany)throw new Error('Aguarde a conferência da análise desta empresa.');
      if(S.newCompanyError)throw new Error('Tente novamente a conferência da empresa antes de continuar.');
    }
    if(state.id==='sector'&&!['fiscal','accounting'].includes(S.newSector)){
      $('#analysis-new-form input[name=sector]')?.focus();throw new Error('Escolha o setor Fiscal ou Contábil antes de continuar.');
    }
    if(state.id==='regimes'){
      S.newSelection=selectionFrom($('#analysis-new-form'));
      if(![2027,2028].includes(S.newYear))throw new Error('Escolha um ano válido para o cenário.');
    }
  }else if(S.modalKind==='accounting'){
    if(state.id==='months'&&writable()){
      if(S.paste.pending){focusSection('#analysis-accounting-paste-panel');throw new Error('Confira e aplique a colagem ou use Limpar colagem antes de continuar para as despesas.');}
      if(!S.accountingDraft.months.length){$('#analysis-new-month')?.focus();throw new Error('Adicione pelo menos uma competência ou aplique uma colagem para continuar.');}
    }
    if(state.id==='values')captureAccounting();
  }else if(S.modalKind==='fiscal'&&state.id==='tax')captureFiscal();
  else if(S.modalKind==='config'&&state.id==='choices')captureConfig();
}
function advanceWizard() {
  if(S.busy||S.pdfBusy||!S.modalKind)return;
  try{clearError();const state=currentWizardState();if(!state.next)return;validateWizardAdvance(state);setWizardStep(state.next);}
  catch(error){showError(error);}
}
function closeWizard() {
  if(S.busy||S.pdfBusy||!S.modalOpen)return;
  // Keep the dialog and its raw inputs mounted. Closing/back never parses or saves a draft.
  S.modalOpen=false;modal?.close();syncWizardUrl();
  if(hasLocalWork())feedback('O preenchimento continua nesta página. Reabra o setor e salve o trabalho antes de sair.','info');
}
function bindWizard() {
  const dialog=$('#analysis-wizard');if(!dialog||!S.modalKind)return;
  modal=createAnalysisModal({dialog,isBusy:()=>S.busy||S.pdfBusy,returnFocus:wizardReturnTarget,
    onNext:advanceWizard,onBack:()=>{const previous=currentWizardState().previous;if(previous)setWizardStep(previous);},
    onPrevious:step=>setWizardStep(step),onClose:closeWizard});
  modal.sync(currentWizardState());
  if(S.modalOpen)modal.open(currentWizardState());
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('input:not([type=file]):not([type=checkbox]):not([type=radio])')&&!currentWizardState().isLast){event.preventDefault();advanceWizard();}
  });
}
function openWizard(kind,{step=null}={}) {
  if(S.busy||S.pdfBusy)return false;
  try {
    clearError();
    const same=S.modalKind===kind&&$('#analysis-wizard')?.dataset.wizardKind===kind;
    if(!same)captureAll();
    if(!document.activeElement?.closest('dialog'))S.modalReturn=document.activeElement;
    S.modalKind=kind;S.modalOpen=true;
    if(['fiscal','accounting'].includes(kind))S.sector=kind;
    if(step)S.modalSteps[kind]=wizardStep(kind,step).id;
    if(same){if(step)setWizardStep(step,{focus:false});modal.open(currentWizardState());}
    else renderDetail();
    syncWizardUrl();return true;
  }catch(error){showError(error);return false;}
}
function assertAnalysis(value) {
  if(!value||!uuid(value.id)||!uuid(value.clientId)||!value.config||!value.fiscal?.data||!value.accounting?.data||!value.readiness){
    throw new Error('A análise recebida está incompleta. Atualize a página para conferir o trabalho salvo.');
  }
  parseRegimeSelection(value.config.regimeSelection);
  return value;
}
function adoptAnalysis(value,{preserveDrafts=false}={}) {
  const record=assertAnalysis(value);
  if(S.analysis&&S.analysis.id!==record.id)throw new Error('A resposta não corresponde à empresa aberta. Atualize a análise.');
  S.analysis=record;
  if(!preserveDrafts||!S.configDirty){S.configDraft=clone(record.config);S.configDirty=false;}
  if(!preserveDrafts||!S.fiscalDirty){S.fiscalDraft=clone(record.fiscal.data);S.fiscalDirty=false;}
  if(!preserveDrafts||!S.accountingDirty){S.accountingDraft=clone(record.accounting.data);S.accountingDirty=false;}
  if(!S.fiscalDraft.difalPolicy)S.fiscalDraft.difalPolicy=defaultDifalPolicy();
}
function pagination(data) {
  const value=data?.pagination;
  if(!value||!Number.isInteger(value.page)||!Number.isInteger(value.total)||!Number.isInteger(value.totalPages))throw new Error('Não foi possível confirmar a lista. Atualize a página.');
  return value;
}

async function clients(){
  if(!S.clients){const response=await analysisRequest('/api/v4/clients');if(!Array.isArray(response.items))throw new Error('Não foi possível carregar as empresas.');S.clients=response.items;}
  return S.clients;
}

async function openList() {
  const query=new URLSearchParams(location.search),search=(query.get('search')||'').trim(),page=Math.max(1,Math.min(100000,Number(query.get('page'))||1));
  const response=await analysisRequest(apiPath('?'+new URLSearchParams({page:String(page),...(search?{search}:{})})));
  if(!Array.isArray(response.items))throw new Error('Não foi possível carregar as análises.');
  $('#analyses-app').innerHTML=renderAnalysisList({items:response.items.map(assertAnalysis),pagination:pagination(response),search,canWrite:writable()});
  $('#analysis-search-form').onsubmit=event=>{event.preventDefault();location.href='/analyses.html?'+new URLSearchParams({search:$('#analysis-search').value.trim()});};
  document.querySelectorAll('[data-analysis-page]').forEach(button=>button.onclick=()=>{location.href='/analyses.html?'+new URLSearchParams({page:button.dataset.analysisPage,...(search?{search}:{})});});
}

function selectionFrom(form) {
  const selected=[...form.querySelectorAll('input[name=regime]:checked')].map(input=>input.value);
  if(!selected.length){const field=form.querySelector('input[name=regime]');revealWizardField(field);field?.focus();throw new Error('Selecione pelo menos um regime tributário para esta análise.');}
  return parseRegimeSelection({version:REGIME_SELECTION_VERSION,selected});
}
function bindCompanyResults() {
  document.querySelectorAll('[data-analysis-client]').forEach(button=>button.onclick=()=>{
    if(S.busy)return;
    captureNewChoices();
    S.newClient=button.dataset.analysisClient;$('#analysis-new-client').value=S.newClient;
    S.newExisting=null;S.newCompanyError='';refreshCompanies();void checkNewCompany();
  });
}
function captureNewChoices() {
  const form=$('#analysis-new-form');if(!form)return;
  S.newSector=form.querySelector('input[name=sector]:checked')?.value||'';
  if(!S.newExisting){
    S.newChoiceIds=[...form.querySelectorAll('input[name=regime]:checked')].map(input=>input.value);
    S.newYear=Number($('#analysis-new-year').value);
  }
}
function refreshNewCompanyState() {
  const host=$('#analysis-new-company-context');if(!host)return;
  host.innerHTML=renderNewCompanyContext({existingAnalysis:S.newExisting,checkingCompany:S.newCheckingCompany,companyCheckError:S.newCompanyError});
  const config=$('#analysis-new-config');
  if(config){config.hidden=!!S.newExisting;config.disabled=S.busy||!writable()||S.newCheckingCompany||!!S.newExisting||!!S.newCompanyError;}
  const chosen=S.newExisting?.config.regimeSelection.selected||S.newChoiceIds;
  document.querySelectorAll('#analysis-new-form input[name=regime]').forEach(input=>input.checked=chosen.includes(input.value));
  $('#analysis-new-year').value=String(S.newExisting?.config.year||S.newYear);
  const button=$('#analysis-open-company');button.disabled=S.busy||!writable()||!uuid(S.newClient)||S.newCheckingCompany||!!S.newCompanyError;
  $('#analysis-company-search').disabled=S.busy;
  button.textContent=S.newCheckingCompany?'Conferindo empresa…':S.newExisting?'Continuar análise existente':'Abrir análise da empresa';
  if($('#analysis-company-retry'))$('#analysis-company-retry').onclick=()=>void checkNewCompany();
  if(modal&&S.modalKind==='new'){modal.sync(currentWizardState());if(currentWizardState().isLast)refreshWizardReview();}
}
async function checkNewCompany() {
  const clientId=S.newClient,ticket=++S.companyCheckSequence;
  if(!uuid(clientId))return;
  S.newExisting=null;S.newCheckingCompany=true;S.newCompanyError='';refreshNewCompanyState();
  try {
    const response=await analysisRequest(apiPath('?'+new URLSearchParams({clientId,page:'1'})));
    if(ticket!==S.companyCheckSequence||S.newClient!==clientId)return;
    if(!Array.isArray(response.items))throw new Error('Não foi possível conferir a análise desta empresa. Tente novamente.');
    if(response.items.some(item=>item.clientId!==clientId))throw new Error('A resposta não corresponde à empresa escolhida. Selecione a empresa novamente.');
    const found=response.items[0];S.newExisting=found?assertAnalysis(found):null;
  } catch(error){if(ticket===S.companyCheckSequence&&S.newClient===clientId)S.newCompanyError=error.message;}
  finally{if(ticket===S.companyCheckSequence&&S.newClient===clientId){S.newCheckingCompany=false;refreshNewCompanyState();}}
}
function refreshCompanies() {
  const results=companyResults(S.clients||[],S.newClient,S.newSearch);
  $('#analysis-company-results').innerHTML=results.html;
  $('#analysis-company-count').textContent=results.count?`${results.count} empresa(s) encontrada(s)${results.count>20?' · refine a busca para ver as demais':''}`:S.newSearch?'Nenhuma empresa encontrada.':'Busque uma empresa para começar.';
  bindCompanyResults();
}
async function openNew(clientId='') {
  await clients();
  if(clientId){
    const company=S.clients.find(item=>item._id===clientId);
    if(!company)throw new Error('A empresa não foi encontrada no cadastro disponível. Volte à carteira e selecione outra empresa.');
    S.newClient=clientId;S.newSearch=company.code||company.name;
  }
  releaseWizard();S.modalKind='new';S.modalOpen=true;
  $('#analyses-app').innerHTML=renderNewAnalysis(newOptions());
  if(!writable())feedback('Seu acesso permite consultar análises existentes. Um operador pode iniciar o trabalho desta empresa.','info');
  $('#analysis-company-search').oninput=event=>{
    if(S.busy)return;
    captureNewChoices();S.newSearch=event.target.value;S.newClient='';S.newExisting=null;S.newCompanyError='';
    S.newCheckingCompany=false;S.companyCheckSequence++;$('#analysis-new-client').value='';refreshCompanies();refreshNewCompanyState();
  };
  $('#analysis-new-form').onchange=()=>captureNewChoices();bindCompanyResults();refreshNewCompanyState();
  $('#analysis-new-form').onsubmit=async event=>{
    event.preventDefault();if(S.busy||!writable())return;
    if(!currentWizardState().isLast){advanceWizard();return;}
    try {
      clearError();const form=event.currentTarget;
      if(!uuid(S.newClient))throw new Error('Selecione a empresa na busca antes de continuar.');
      if(S.newCheckingCompany||S.newCompanyError)throw new Error('Conclua a conferência da empresa antes de continuar.');
      captureNewChoices();
      const selection=S.newExisting?.config.regimeSelection||selectionFrom(form),year=S.newExisting?.config.year||S.newYear;
      if(!S.newExisting)S.newSelection=selection;
      if(!['fiscal','accounting'].includes(S.newSector))throw new Error('Escolha o setor Fiscal ou Contábil para começar.');
      const clientId=S.newClient,sector=S.newSector;
      setBusy(true,'Abrindo a análise desta empresa…');
      const response=await analysisRequest(apiPath(),{method:'POST',body:{clientId,year,regimeSelection:selection}});
      const record=assertAnalysis(response.analysis);
      if(record.clientId!==clientId)throw new Error('A análise retornada não corresponde à empresa selecionada.');
      setBusy(false);location.href=analysisUrl(record.id,sector)+(response.created?'':'&resumed=1');
    } catch(error){if(S.busy){setBusy(false);await openNew().catch(showError);}showError(error);}
  };
  $('#analysis-resume-new').onclick=()=>{S.modalReturn=$('#analysis-resume-new');S.modalOpen=true;modal.open(currentWizardState());};
  bindWizard();
  if(clientId&&!S.newExisting&&!S.newCheckingCompany)await checkNewCompany();
}

async function openCompany(clientId) {
  if(!uuid(clientId))throw new Error('Selecione uma empresa válida para abrir a análise.');
  const response=await analysisRequest(apiPath('?'+new URLSearchParams({clientId,page:'1'})));
  const found=response.items?.find(item=>item.clientId===clientId);
  if(found){
    const query=new URLSearchParams(location.search),sector=query.get('sector');
    history.replaceState(null,'',analysisUrl(found.id,['fiscal','accounting'].includes(sector)?sector:undefined));
    await openAnalysis(found.id);
  } else await openNew(clientId);
}

function currentContext(id,sequence){return S.analysis?.id===id&&S.sequence===sequence;}
async function loadEvidence(id,sequence) {
  const record=S.analysis,fiscal=record.fiscal.data;
  S.generation=null;S.source=null;S.generationError='';S.reference=null;S.documentStatus=null;S.pdfStatus='';
  const reads=await Promise.allSettled([
    fiscal.generationId?analysisRequest('/api/v4/generations/'+encodeURIComponent(fiscal.generationId)):Promise.resolve(null),
    requiresSimplesReference(record.config.regimeSelection)&&fiscal.rbt12Source==='SIMPLES_SECTION_22'&&fiscal.rbt12ExtractionId?
      loadAnalysisExtraction({clientId:record.clientId,documentId:fiscal.rbt12DocumentId,extractionId:fiscal.rbt12ExtractionId,cnpj:record.company.cnpj}):Promise.resolve(null)
  ]);
  if(!currentContext(id,sequence))return;
  if(reads[0].status==='fulfilled'){
    const generation=reads[0].value;
    if(generation&&(generation._id!==fiscal.generationId||!generation.companies?.some(company=>company.clientId===record.clientId)))S.generationError='Os relatórios não correspondem à empresa desta análise. Confira o vínculo antes de continuar.';
    else S.generation=generation;
  }else S.generationError=reads[0].reason?.message||'Não foi possível conferir os relatórios vinculados.';
  if(reads[1].status==='fulfilled')S.reference=reads[1].value;
  else S.pdfStatus=reads[1].reason?.message||'Não foi possível confirmar a leitura do extrato. Verifique o PDF vinculado.';
  const company=S.generation?.companies?.find(item=>item.clientId===record.clientId);
  if(company?.purchase?.status==='COMPLETED'&&company?.sales?.status==='COMPLETED'){
    try {
      const source=await analysisRequest(`/api/v4/generations/${encodeURIComponent(fiscal.generationId)}/simulator?`+new URLSearchParams({clientId:record.clientId}));
      if(!currentContext(id,sequence))return;
      if(source.generationId!==fiscal.generationId||source.clientId!==record.clientId)throw new Error('A fonte recebida não corresponde à empresa e aos documentos desta análise.');
      S.source=source;
    } catch(error){if(currentContext(id,sequence))S.generationError=error.message;}
  }
}
async function openAnalysis(id) {
  if(!uuid(id))throw new Error('A identificação da análise é inválida. Abra a empresa pela carteira.');
  const sequence=++S.sequence;
  releaseWizard();
  $('#analyses-app').innerHTML='<div class="initial">Conferindo os setores e os documentos desta empresa…</div>';
  const response=await analysisRequest(apiPath('/'+encodeURIComponent(id)));
  if(sequence!==S.sequence)return;
  S.analysis=null;adoptAnalysis(response.analysis);S.generateRequest=null;
  S.paste={text:'',preview:null,error:'',replaceConfirmed:false,open:false,pending:false};S.detailOpen={};
  S.modalSteps={};S.modalReturn=null;
  const query=new URLSearchParams(location.search),sector=query.get('sector');
  S.sector=['fiscal','accounting'].includes(sector)?sector:null;S.versionsOpen=query.get('view')==='versions';S.versionsData=null;
  await loadEvidence(id,sequence);if(!currentContext(id,sequence))return;
  S.modalKind=query.get('view')==='settings'?'config':S.sector;
  S.modalOpen=!!S.modalKind;
  if(S.modalKind&&wizardSteps(S.modalKind).some(item=>item.id===query.get('step')))S.modalSteps[S.modalKind]=query.get('step');
  clearError();renderDetail();
  if(query.get('resumed')==='1')feedback('Esta empresa já tinha uma análise. Retomamos o trabalho e preservamos os regimes e dados já salvos.','info');
  if(S.versionsOpen){await loadVersions(1);$('#analysis-versions')?.scrollIntoView({block:'start',behavior:'instant'});}
  else if(query.get('view')==='review')$('#analysis-generation')?.scrollIntoView({block:'start',behavior:'instant'});
}

function schedule() {
  if(!S.reference||!S.source?.monthlyReports?.length)return null;
  try{return buildRbt12Schedule(S.reference,S.source.monthlyReports.map(row=>row.sourceMonth));}
  catch{return null;}
}
function detailOptions() {
  return {analysis:S.analysis,sector:S.sector,modalKind:S.modalKind,configDraft:S.configDraft,
    fiscalDraft:S.fiscalDraft,accountingDraft:S.accountingDraft,source:S.source,generation:S.generation,
    generationError:S.generationError,reference:S.reference,schedule:schedule(),documentStatus:S.documentStatus,
    pdfStatus:S.pdfStatus,pdfBusy:S.pdfBusy,canWrite:writable(),configDirty:S.configDirty,
    fiscalDirty:S.fiscalDirty,accountingDirty:S.accountingDirty,pastePending:S.paste.pending,dirty:dirty(),versionsOpen:S.versionsOpen};
}
function bindAnalysisActions(root=document) {
  root.querySelectorAll('[data-analysis-action]').forEach(button=>button.onclick=()=>void handleAnalysisAction(button.dataset.analysisAction));
  root.querySelectorAll('[data-analysis-sector]').forEach(link=>link.onclick=event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();switchSector(link.dataset.analysisSector);
  });
}
function refreshGuidance() {
  if(!S.analysis||!$('#analysis-guidance'))return;
  const options=detailOptions(),guidance=analysisGuidance(S.analysis,options);
  $('#analysis-guidance').innerHTML=renderAnalysisGuidance(options);
  document.querySelectorAll('[data-analysis-sector-status]').forEach(host=>{
    const status=guidance.sectors[host.dataset.analysisSectorStatus];
    if(status)host.innerHTML=`<span class="analysis-tag is-${status.kind}">${esc(status.label)}</span>`;
  });
  if($('#analysis-generation'))$('#analysis-generation').outerHTML=renderAnalysisGeneration(options);
  if($('#analysis-generate'))$('#analysis-generate').onclick=()=>void generate();
  document.querySelectorAll('#analysis-fiscal-form button[value="complete"],#analysis-accounting-form button[value="complete"]').forEach(button=>button.disabled=S.configDirty||S.busy||!writable());
  bindAnalysisActions();
}
function focusSection(selector) {
  const target=$(selector);if(!target)return;
  revealWizardField(target);
  for(let parent=target.closest('details');parent;parent=parent.parentElement?.closest('details'))parent.open=true;
  target.scrollIntoView({block:'start',behavior:'instant'});
  const field=target.matches('input,select,textarea,button,a')?target:target.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)');
  field?.focus({preventScroll:true});
}
function switchSector(sector) {
  return ['fiscal','accounting'].includes(sector)&&openWizard(sector);
}
async function handleAnalysisAction(action) {
  if(S.busy||S.pdfBusy)return;
  try {
    clearError();
    if(action==='config'){openWizard('config',{step:'choices'});return;}
    if(['fiscal','accounting'].includes(action)){
      if(switchSector(action)&&action==='accounting'&&S.paste.pending){
        setWizardStep('months');
        $('#analysis-accounting-paste-panel').open=true;focusSection('#analysis-accounting-paste-panel');
      }
      return;
    }
    if(action==='save-fiscal'||action==='save-accounting'){
      const sector=action.slice(5);if(switchSector(sector))await saveSector(sector,false);return;
    }
    if(action==='accounting-months'){
      if(!openWizard('accounting',{step:'months'}))return;
      const missing=expectedAccountingMonths().filter(month=>!S.accountingDraft.months.some(row=>row.sourceMonth===month));
      if(missing.length&&writable())addMonths(missing);
      focusSection('#analysis-add-month');
      return;
    }
    if(action==='reference'){
      if(openWizard('fiscal',{step:'tax'}))focusSection('.analysis-extrato');return;
    }
    if(action==='import'){
      openWizard('fiscal',{step:'documents'});return;
    }
    if(action==='generate'){await generate();return;}
    if(action==='result'&&uuid(S.analysis.currentSimulation?.id))location.href='/simulator.html?'+new URLSearchParams({simulation:S.analysis.currentSimulation.id});
  } catch(error){showError(error);}
}
function renderDetail() {
  if(!S.analysis)return;
  S.versionsOpen=$('#analysis-versions')?.open??S.versionsOpen;
  document.querySelectorAll('#analyses-app details[id]').forEach(detail=>S.detailOpen[detail.id]=detail.open);
  S.paste.open=$('#analysis-accounting-paste-panel')?.open??S.paste.open;
  releaseWizard();
  $('#analyses-app').innerHTML=renderAnalysisDetail(detailOptions());
  document.querySelectorAll('#analyses-app details[id]').forEach(detail=>{if(Object.hasOwn(S.detailOpen,detail.id))detail.open=S.detailOpen[detail.id];});
  if($('#analysis-config-form')){
    $('#analysis-config-form').oninput=()=>{markDirty('config');};
    $('#analysis-config-form').onsubmit=event=>{event.preventDefault();if(!currentWizardState().isLast){advanceWizard();return;}void saveConfig();};
  }
  $('#analysis-versions').ontoggle=()=>{S.versionsOpen=$('#analysis-versions').open;if(S.versionsOpen&&!S.versionsData&&!S.versionsLoading)void loadVersions(1);};
  if(S.versionsData)showVersions();
  if($('#analysis-generate'))$('#analysis-generate').onclick=()=>void generate();
  bindAnalysisActions();
  if($('#analysis-fiscal-form'))bindFiscal();
  if($('#analysis-accounting-form'))bindAccounting();
  bindWizard();
  if(S.busy)setBusy(true);
}

function readNumber(input,{cents=false,signed=false,label='o valor'}={}) {
  if(!input)return null;
  const raw=input.value.trim();
  if(input.validity.badInput||!input.validity.valid||raw&&!new RegExp(`^${signed?'-?':''}\\d+(?:\\.\\d{1,2})?$`).test(raw)){
    revealWizardField(input);input.focus();
    throw new Error(`Confira ${label}. Informe um valor ${signed?'':'não negativo '}com até duas casas decimais.`);
  }
  if(raw==='')return null;
  const negative=raw.startsWith('-'),[whole,fraction='']=raw.replace(/^-/,'').split('.');
  const amount=(Number(whole)*100+Number(fraction.padEnd(2,'0')))*(negative?-1:1);
  if(!Number.isSafeInteger(amount)||Math.abs(amount)>100000000000000){revealWizardField(input);input.focus();throw new Error(`Confira ${label}. O valor está fora do limite aceito.`);}
  return cents?amount:amount/100;
}
function captureFiscal() {
  if(!$('#analysis-fiscal-form'))return clone(S.fiscalDraft);
  const result=clone(S.fiscalDraft);
  result.salesAnnex=Number($('#analysis-sales-annex')?.value||result.salesAnnex);
  result.serviceAnnex=Number($('#analysis-service-annex')?.value||result.serviceAnnex);
  if($('#analysis-icms-outside'))result.icmsOutside=$('#analysis-icms-outside').value==='outside';
  const policy=clone(result.difalPolicy||defaultDifalPolicy());
  document.querySelectorAll('[data-analysis-difal-enabled]').forEach(input=>policy.enabled[input.dataset.analysisDifalEnabled]=input.checked);
  document.querySelectorAll('[data-analysis-difal-operation]').forEach(input=>policy.operations[input.dataset.analysisDifalRegime][input.dataset.analysisDifalOperation]=input.checked);
  result.difalPolicy=parseDifalPolicy(policy);
  if(!requiresSimplesReference(S.analysis.config.regimeSelection)){
    result.rbt12Source='NOT_REQUIRED';result.rbt12=null;result.rbt12ExtractionId=null;result.rbt12DocumentId=null;result.rbt12ManualConfirmed=false;
  }else if(result.rbt12Source==='MANUAL'){
    result.rbt12=readNumber($('#analysis-rbt12'),{label:'a RBT12'});result.rbt12ManualConfirmed=$('#analysis-rbt12-confirm')?.checked===true;
    result.rbt12ExtractionId=null;result.rbt12DocumentId=null;
  }else if(result.rbt12Source==='NOT_REQUIRED')result.rbt12Source='SIMPLES_SECTION_22';
  if(Array.isArray(result.monthlyOverrides))result.monthlyOverrides=result.monthlyOverrides.map(row=>{
    const host=document.querySelector(`[data-fiscal-month="${row.sourceMonth}"]`);if(!host)return row;
    const groups=Object.fromEntries(ADJUSTMENT_FIELDS.map(([key,label],index)=>[key,readNumber(host.querySelector(`[data-fiscal-field="${key}"]`),{signed:index<3,label:label+' em '+monthLabel(row.sourceMonth)})]));
    return {sourceMonth:row.sourceMonth,groups,serviceRevenue:readNumber(host.querySelector('[data-fiscal-field=serviceRevenue]'),{label:'a receita de serviços em '+monthLabel(row.sourceMonth)})};
  });
  S.fiscalDraft=result;return clone(result);
}
function captureAccounting() {
  if(!$('#analysis-accounting-form'))return clone(S.accountingDraft);
  const months=S.accountingDraft.months.map(row=>{
    const host=document.querySelector(`[data-accounting-month="${row.sourceMonth}"]`);if(!host)return row;
    return {sourceMonth:row.sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(([key,label])=>[key,readNumber(host.querySelector(`[data-accounting-field="${key}"]`),{cents:true,label:label+' em '+monthLabel(row.sourceMonth)})]))};
  });
  S.accountingDraft={months};return clone(S.accountingDraft);
}
function captureConfig(){
  if($('#analysis-config-form'))S.configDraft={...S.configDraft,year:Number($('#analysis-config-year').value),regimeSelection:selectionFrom($('#analysis-config-form'))};
  return S.configDraft;
}
function captureAll(){captureConfig();if($('#analysis-fiscal-form'))captureFiscal();if($('#analysis-accounting-form'))captureAccounting();}

async function saveConfig() {
  if(S.busy||!writable())return;
  try {
    clearError();captureAll();const config=S.configDraft;
    if(config.year===S.analysis.config.year&&JSON.stringify(config.regimeSelection)===JSON.stringify(S.analysis.config.regimeSelection)){
      S.configDirty=false;S.modalOpen=false;renderDetail();feedback('As escolhas da análise já estão salvas.');wizardReturnTarget()?.focus();return;
    }
    setBusy(true,'Salvando os regimes e o ano desta análise…');
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/config'),{method:'PATCH',body:{expectedConfigRevision:S.analysis.config.revision,year:config.year,regimeSelection:config.regimeSelection}});
    S.configDirty=false;adoptAnalysis(response.analysis,{preserveDrafts:true});S.generateRequest=null;
    S.modalOpen=false;
    feedback('Escolhas salvas. Confira os setores antes de gerar a próxima versão.');
  } catch(error){showError(error);}
  finally{if(S.busy){setBusy(false);renderDetail();if(!S.modalOpen)wizardReturnTarget()?.focus();}}
}

async function patchSector(sector,data,complete) {
  const response=await analysisRequest(apiPath('/'+S.analysis.id+'/'+sector),{method:'PATCH',body:{
    expectedSectorRevision:S.analysis[sector].revision,expectedConfigRevision:S.analysis.config.revision,complete,data}});
  S[sector+'Dirty']=false;adoptAnalysis(response.analysis,{preserveDrafts:true});S.generateRequest=null;
  return S.analysis;
}
async function saveSector(sector,complete) {
  if(S.busy||!writable())return;
  try {
    clearError();captureConfig();const data=sector==='fiscal'?captureFiscal():captureAccounting();
    if(complete&&S.configDirty)throw new Error('Salve primeiro os regimes e o ano da análise, depois conclua o setor.');
    if(complete&&sector==='accounting'){
      if(!data.months.length){setWizardStep('months');throw new Error('Adicione pelo menos uma competência com os dados contábeis.');}
      for(const row of data.months){const missing=ACCOUNTING_FIELDS.find(([key])=>row[key]===null);if(missing){
        const field=document.querySelector(`[data-accounting-month="${row.sourceMonth}"] [data-accounting-field="${missing[0]}"]`);
        revealWizardField(field);field?.focus();
        throw new Error(`Informe ${missing[1]} em ${monthLabel(row.sourceMonth)}. Use zero somente quando não houver essa despesa.`);
      }}
    }
    setBusy(true,`${complete?'Concluindo':'Salvando'} o trabalho ${sectorName(sector)}…`);
    await patchSector(sector,data,complete);
    if(complete)S.modalOpen=false;
    feedback(complete?`${sectorName(sector)} concluído. ${hasLocalWork()?'Há preenchimentos locais que ainda precisam ser conferidos e salvos.':S.analysis.readiness.ready?'Os dois setores estão prontos para gerar a análise.':'Acompanhe abaixo o que ainda falta para gerar.'}`:`Trabalho ${sectorName(sector)} salvo. Você pode continuar depois nesta mesma análise.`);
  } catch(error){
    if(sector==='fiscal'&&String(error.code||'').startsWith('RBT12_'))S.modalSteps.fiscal='tax';
    if(sector==='fiscal'&&['ANALYSIS_FISCAL_INCOMPLETE','SIMULATOR_INCOMPLETE'].includes(error.code))S.modalSteps.fiscal='documents';
    if(sector==='accounting'&&error.code==='ACCOUNTING_MONTHS_MISMATCH')S.modalSteps.accounting='months';
    showError(error);
  }
  finally{if(S.busy){setBusy(false);renderDetail();if(!S.modalOpen)wizardReturnTarget()?.focus();}}
}

function bindFiscal() {
  $('#analysis-fiscal-form').oninput=event=>{
    markDirty('fiscal');
    if(event.target.id==='analysis-rbt12'&&$('#analysis-rbt12-confirm'))$('#analysis-rbt12-confirm').checked=false;
    if(event.target.dataset.analysisDifalEnabled){const id=event.target.dataset.analysisDifalEnabled;document.querySelectorAll(`[data-analysis-difal-regime="${id}"]`).forEach(input=>input.disabled=!event.target.checked);}
  };
  $('#analysis-fiscal-form').onsubmit=event=>{event.preventDefault();void saveSector('fiscal',event.submitter?.value==='complete');};
  if($('#analysis-start-import'))$('#analysis-start-import').onclick=()=>void prepareImport();
  for(const [id,mode] of [['analysis-extrato-pdf','SIMPLES_SECTION_22'],['analysis-extrato-manual','MANUAL']])if($('#'+id))$('#'+id).onclick=()=>{
    try{captureAll();S.fiscalDraft.rbt12Source=mode;S.fiscalDraft.rbt12=null;S.fiscalDraft.rbt12ExtractionId=null;S.fiscalDraft.rbt12ManualConfirmed=false;if(mode==='MANUAL')S.fiscalDraft.rbt12DocumentId=null;S.reference=null;markDirty('fiscal');renderDetail();$('#analysis-rbt12')?.focus();}catch(error){showError(error);}
  };
  if($('#analysis-rbt12-pdf'))$('#analysis-rbt12-pdf').onchange=event=>{const file=event.target.files?.[0];if(file)void readPdf(file);};
  if($('#analysis-read-selected-pdf'))$('#analysis-read-selected-pdf').onclick=()=>{const file=$('#analysis-rbt12-pdf').files?.[0];if(file)void readPdf(file);else showError(new Error('Selecione o extrato em PDF antes de iniciar a leitura.'));};
  if($('#analysis-extrato-status'))$('#analysis-extrato-status').onclick=()=>void checkPdf();
  if($('#analysis-extrato-retry'))$('#analysis-extrato-retry').onclick=()=>void retryPdf();
  if($('#analysis-edit-adjustments'))$('#analysis-edit-adjustments').onclick=()=>{
    try{
      captureAll();S.fiscalDraft.monthlyOverrides=S.source.monthlyReports.map(row=>({sourceMonth:row.sourceMonth,
        groups:Object.fromEntries(ADJUSTMENT_FIELDS.map(([key])=>[key,row.fields[key]/100])),serviceRevenue:row.fields.serviceRevenueCents/100}));
      markDirty('fiscal');renderDetail();$('#analysis-fiscal-adjustments').open=true;
    }catch(error){showError(error);}
  };
  if($('#analysis-clear-adjustments'))$('#analysis-clear-adjustments').onclick=()=>{
    if(!confirm('Usar os valores dos relatórios em todas as competências? Os ajustes ainda não salvos nesta análise serão retirados. As versões anteriores permanecerão no histórico.'))return;
    try{captureAll();S.fiscalDraft.monthlyOverrides=null;markDirty('fiscal');renderDetail();$('#analysis-fiscal-adjustments').open=true;}catch(error){showError(error);}
  };
}

async function prepareImport() {
  if(S.busy||!writable())return;
  try {
    clearError();captureAll();
    if(S.paste.pending)throw new Error('Há uma colagem do Contábil ainda não aplicada. Confira e aplique os dados ou use Limpar colagem antes de abrir a importação fiscal.');
    if(S.accountingDirty)throw new Error('Salve o trabalho Contábil antes de abrir a importação fiscal. As despesas ainda não salvas continuam nesta tela.');
    if(S.configDirty)throw new Error('Salve as escolhas da análise antes de preparar os documentos fiscais.');
    if(S.analysis.fiscal.data.generationId&&!confirm('Preparar novos relatórios de entradas e saídas? A análise passará a aguardar os novos arquivos; as versões e os relatórios anteriores continuarão preservados.'))return;
    setBusy(true,'Preparando os documentos fiscais desta empresa…');
    if(S.fiscalDirty)await patchSector('fiscal',S.fiscalDraft,false);
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/fiscal/import'),{method:'POST',body:{expectedSectorRevision:S.analysis.fiscal.revision,expectedConfigRevision:S.analysis.config.revision}});
    adoptAnalysis(response.analysis);
    if(!uuid(response.generationId)||S.analysis.fiscal.data.generationId!==response.generationId)throw new Error('Não foi possível confirmar os relatórios preparados. Atualize a análise antes de continuar.');
    setBusy(false);location.href='/purchases.html?'+new URLSearchParams({generation:response.generationId,client:S.analysis.clientId,guided:'1',analysis:S.analysis.id});
  } catch(error){showError(error);}
  finally{if(S.busy){setBusy(false);renderDetail();}}
}

function pdfProgress(message){S.pdfStatus=message;const host=$('#analysis-pdf-status');if(host)host.textContent=message;}
function pdfContext(){return {clientId:S.analysis.clientId,cnpj:S.analysis.company.cnpj,documentId:S.fiscalDraft.rbt12DocumentId,onProgress:pdfProgress};}
async function savePdfReference(reference) {
  S.reference=reference;S.fiscalDraft={...S.fiscalDraft,rbt12Source:'SIMPLES_SECTION_22',rbt12ExtractionId:reference.extractionId,
    rbt12DocumentId:reference.documentId||S.fiscalDraft.rbt12DocumentId,rbt12:reference.rbt12Cents/100,rbt12ManualConfirmed:false};
  S.fiscalDirty=true;await patchSector('fiscal',S.fiscalDraft,false);
  pdfProgress('Leitura confirmada e salva no Fiscal. Confira a seção 2.2 antes de concluir o setor.');
}
async function readPdf(file) {
  if(S.busy||!writable())return;
  try {
    clearError();captureAll();if(S.configDirty)throw new Error('Salve os regimes da análise antes de adicionar o extrato.');
    S.pdfBusy=true;setBusy(true,'Armazenando e lendo o extrato desta empresa…');
    const reference=await uploadAnalysisExtraction({...pdfContext(),file,onStored:async documentId=>{
      S.reference=null;S.documentStatus=null;S.fiscalDraft={...S.fiscalDraft,rbt12Source:'SIMPLES_SECTION_22',rbt12DocumentId:documentId,
        rbt12ExtractionId:null,rbt12:null,rbt12ManualConfirmed:false};S.fiscalDirty=true;
      await patchSector('fiscal',S.fiscalDraft,false);
    }});
    await savePdfReference(reference);feedback('Extrato lido e vinculado à análise. O Fiscal ainda precisa ser concluído.');
  } catch(error){
    if(error.documentId)S.fiscalDraft.rbt12DocumentId=error.documentId;
    pdfProgress((error.message||'A leitura não foi confirmada.')+(S.fiscalDraft.rbt12DocumentId?' O PDF vinculado pode ser conferido ou lido novamente.':''));
    showError(error);
  } finally{const wasBusy=S.busy;S.pdfBusy=false;if(wasBusy){setBusy(false);renderDetail();}}
}
async function checkPdf() {
  if(S.busy)return;
  try {
    clearError();captureAll();S.pdfBusy=true;setBusy(true,'Conferindo a leitura do documento armazenado…');
    const context=pdfContext(),status=await analysisDocumentStatus(context);S.documentStatus=status;
    if(status.status==='READY'&&!status.error&&!status.lastError&&uuid(status.extractionId)){
      const reference=await loadAnalysisExtraction({...context,extractionId:status.extractionId});
      if(writable())await savePdfReference(reference);else{S.reference=reference;pdfProgress('Leitura do documento armazenado confirmada.');}
      feedback('Leitura do PDF recuperada.');
    }else {
      S.reference=null;
      pdfProgress(status.status==='PROCESSING'?'A leitura ainda está em andamento. Verifique novamente em instantes.':status.originalStored?'O original está armazenado, mas a última leitura não foi confirmada. Use Ler novamente para retomar.':'O envio ainda não foi confirmado. Verifique novamente ou selecione o PDF para reenviar.');
      feedback('A seção 2.2 ainda precisa ser confirmada.','info');
    }
  } catch(error){pdfProgress(error.message);showError(error);}
  finally{const wasBusy=S.busy;S.pdfBusy=false;if(wasBusy){setBusy(false);renderDetail();}}
}
async function retryPdf() {
  if(S.busy||!writable())return;
  try {
    clearError();captureAll();if(S.configDirty)throw new Error('Salve os regimes da análise antes de ler o extrato novamente.');
    S.pdfBusy=true;setBusy(true,'Retomando a leitura do PDF armazenado…');
    S.reference=null;S.fiscalDraft.rbt12ExtractionId=null;S.fiscalDraft.rbt12=null;S.fiscalDraft.rbt12ManualConfirmed=false;
    S.fiscalDraft.rbt12Source='SIMPLES_SECTION_22';S.fiscalDirty=true;await patchSector('fiscal',S.fiscalDraft,false);
    const reference=await retryAnalysisExtraction(pdfContext());await savePdfReference(reference);
    feedback('Nova leitura do extrato confirmada e salva. Confira os dados antes de concluir o Fiscal.');
  } catch(error){pdfProgress(error.message);showError(error);}
  finally{const wasBusy=S.busy;S.pdfBusy=false;if(wasBusy){setBusy(false);renderDetail();}}
}

function blankMonth(sourceMonth){return {sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>[key,null]))};}
function expectedAccountingMonths() {
  const source=S.source?.monthlyReports?.map(row=>row.sourceMonth);
  return source?.length?source:S.analysis.readiness.months||[];
}
function displayedAccountingMonths() {
  return S.accountingDraft.months.map(row=>{
    const host=document.querySelector(`[data-accounting-month="${row.sourceMonth}"]`);if(!host)return row;
    return {sourceMonth:row.sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>{
      const input=host.querySelector(`[data-accounting-field="${key}"]`),raw=input?.value.trim();
      if(!input?.validity.valid||!/^\d+(?:\.\d{1,2})?$/.test(raw||''))return [key,null];
      const [whole,fraction='']=raw.split('.'),value=Number(whole)*100+Number(fraction.padEnd(2,'0'));
      return [key,Number.isSafeInteger(value)&&value<=100000000000000?value:null];
    }))};
  });
}
function refreshAccountingSummary() {
  const host=$('#analysis-accounting-summary');if(!host)return;
  const open=$('#analysis-accounting-breakdown')?.open??S.detailOpen['analysis-accounting-breakdown'];
  host.innerHTML=renderAccountingSummary({months:displayedAccountingMonths(),expectedMonths:expectedAccountingMonths()});
  if($('#analysis-accounting-breakdown'))$('#analysis-accounting-breakdown').open=!!open;
}
function invalidatePastePreview(message='') {
  if(!S.paste.preview)return;
  S.paste.preview=null;S.paste.replaceConfirmed=false;S.paste.error=message;
  renderPaste();
}
function renderPaste() {
  const host=$('#analysis-accounting-import');if(!host)return;
  S.paste.open=$('#analysis-accounting-paste-panel')?.open??S.paste.open;
  host.innerHTML=renderAccountingPaste({...S.paste,sourceMonths:expectedAccountingMonths(),canWrite:writable()&&!S.busy});
  $('#analysis-accounting-paste-panel').ontoggle=()=>{S.paste.open=$('#analysis-accounting-paste-panel').open;};
  $('#analysis-accounting-paste').oninput=event=>{
    S.paste.text=event.target.value;S.paste.preview=null;S.paste.error='';S.paste.replaceConfirmed=false;
    S.paste.pending=S.paste.text.trim()!=='';
    // Keep the textarea and selection in place while discarding the obsolete preview.
    $('#analysis-accounting-paste-preview').replaceChildren();$('#analysis-accounting-paste-preview').hidden=true;
    $('#analysis-accounting-paste-error').textContent='';$('#analysis-accounting-paste-error').hidden=true;
    $('#analysis-clear-accounting-paste').disabled=!S.paste.text;refreshGuidance();
  };
  $('#analysis-preview-accounting-paste').onclick=()=>{
    if(S.busy||!writable())return;
    S.paste.pending=S.paste.text.trim()!=='';
    try {
      clearError();captureAll();
      const parsed=parseAccountingPaste(S.paste.text),plan=planAccountingPaste(S.accountingDraft.months,parsed.months);
      S.paste.preview={parsed,plan,baseline:JSON.stringify(S.accountingDraft.months)};
      S.paste.error='';S.paste.replaceConfirmed=false;S.paste.open=true;renderPaste();
      refreshGuidance();
      $('#analysis-accounting-paste-preview').scrollIntoView({block:'nearest',behavior:'instant'});
    } catch(error){S.paste.preview=null;S.paste.replaceConfirmed=false;S.paste.error=error.message;S.paste.open=true;renderPaste();refreshGuidance();}
  };
  if($('#analysis-paste-replace-confirm'))$('#analysis-paste-replace-confirm').onchange=event=>{
    S.paste.replaceConfirmed=event.target.checked;
    $('#analysis-apply-accounting-paste').disabled=!S.paste.replaceConfirmed||!writable()||S.busy;
  };
  if($('#analysis-apply-accounting-paste'))$('#analysis-apply-accounting-paste').onclick=()=>{
    if(S.busy||!writable()||!S.paste.preview)return;
    try {
      clearError();captureAll();const preview=S.paste.preview;
      if(preview.baseline!==JSON.stringify(S.accountingDraft.months)){
        preview.plan=planAccountingPaste(S.accountingDraft.months,preview.parsed.months);
        preview.baseline=JSON.stringify(S.accountingDraft.months);S.paste.replaceConfirmed=false;
        S.paste.error='O formulário mudou depois da prévia. Confira os meses e confirme novamente antes de aplicar.';renderPaste();return;
      }
      if(preview.plan.replacedMonths.length&&!S.paste.replaceConfirmed)throw new Error('Confirme a substituição dos meses já preenchidos antes de aplicar.');
      S.accountingDraft={months:clone(preview.plan.months)};
      S.paste.preview=null;S.paste.error='';S.paste.replaceConfirmed=false;S.paste.open=false;S.paste.pending=false;
      const count=preview.parsed.monthCount;
      S.modalSteps.accounting='values';
      markDirty('accounting');renderDetail();
      feedback(`${count} competência(s) aplicada(s) ao formulário. Confira as despesas e use Salvar trabalho Contábil ou Concluir Contábil.`,'info');
      focusSection('#analysis-expenses');
    } catch(error){S.paste.error=error.message;S.paste.open=true;renderPaste();}
  };
  if($('#analysis-cancel-accounting-paste'))$('#analysis-cancel-accounting-paste').onclick=()=>{
    S.paste.preview=null;S.paste.error='';S.paste.replaceConfirmed=false;renderPaste();
  };
  $('#analysis-clear-accounting-paste').onclick=()=>{
    S.paste={text:'',preview:null,error:'',replaceConfirmed:false,open:true,pending:false};renderPaste();refreshGuidance();
    $('#analysis-accounting-paste').focus();
  };
  $('#analysis-download-accounting-template').onclick=()=>{
    const url=URL.createObjectURL(new Blob(['\uFEFF'+ACCOUNTING_IMPORT_CSV_TEMPLATE],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='modelo-despesas-contabeis.csv';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
}
function addMonths(months) {
  captureAll();const current=new Set(S.accountingDraft.months.map(row=>row.sourceMonth));
  for(const month of months){
    if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month))throw new Error('Informe uma competência válida, com mês e ano entre 2000 e 2099.');
    current.add(month);
  }
  if(current.size>12)throw new Error('A análise aceita até 12 competências. Confira os meses antes de continuar.');
  for(const month of months)if(!S.accountingDraft.months.some(row=>row.sourceMonth===month))S.accountingDraft.months.push(blankMonth(month));
  S.accountingDraft.months.sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));markDirty('accounting');renderDetail();
}
function refreshMonthTotal(host) {
  try {
    const values=ACCOUNTING_FIELDS.map(([key])=>{
      const field=host.querySelector(`[data-accounting-field="${key}"]`),raw=field.value.trim();
      if(!field.validity.valid||!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
      const [whole,fraction='']=raw.split('.'),value=Number(whole)*100+Number(fraction.padEnd(2,'0'));
      return Number.isSafeInteger(value)&&value<=100000000000000?value:null;
    });
    $('[data-accounting-total]',host).textContent=values.some(value=>value===null)?'Preenchimento incompleto':money(values.reduce((sum,value)=>sum+value,0)/100);
  } catch { $('[data-accounting-total]',host).textContent='Preenchimento incompleto'; }
}
function bindAccounting() {
  renderPaste();
  $('#analysis-accounting-form').oninput=event=>{
    if(!event.target.matches('[data-accounting-field]'))return;
    markDirty('accounting');const host=event.target.closest('[data-accounting-month]');if(host)refreshMonthTotal(host);refreshAccountingSummary();
  };
  $('#analysis-accounting-form').onsubmit=event=>{event.preventDefault();void saveSector('accounting',event.submitter?.value==='complete');};
  if($('#analysis-add-month'))$('#analysis-add-month').onclick=()=>{
    try{clearError();const month=$('#analysis-new-month').value;if(S.accountingDraft.months.some(row=>row.sourceMonth===month))throw new Error('Esta competência já está no formulário. Preencha os valores no mês correspondente.');addMonths([month]);}catch(error){showError(error);}
  };
  if($('#analysis-add-fiscal-months'))$('#analysis-add-fiscal-months').onclick=()=>{try{clearError();addMonths(expectedAccountingMonths());}catch(error){showError(error);}};
  document.querySelectorAll('[data-zero-month]').forEach(button=>button.onclick=()=>{
    try{captureAll();const row=S.accountingDraft.months.find(item=>item.sourceMonth===button.dataset.zeroMonth);for(const [key] of ACCOUNTING_FIELDS)if(row[key]===null)row[key]=0;markDirty('accounting');renderDetail();}catch(error){showError(error);}
  });
  document.querySelectorAll('[data-remove-month]').forEach(button=>button.onclick=()=>{
    if(!confirm(`Retirar ${monthLabel(button.dataset.removeMonth)} deste trabalho Contábil? As versões já geradas continuarão preservadas.`))return;
    try{captureAll();S.accountingDraft.months=S.accountingDraft.months.filter(row=>row.sourceMonth!==button.dataset.removeMonth);markDirty('accounting');renderDetail();}catch(error){showError(error);}
  });
}

async function generate() {
  if(S.busy||!writable())return;
  try {
    clearError();
    if(S.paste.pending)throw new Error('Confira e aplique a colagem do Contábil ou use Limpar colagem antes de gerar.');
    if(dirty())throw new Error('Salve as alterações e conclua os setores antes de gerar.');
    if(!S.analysis.readiness.ready)throw new Error('Conclua os dois setores e confira as pendências indicadas antes de gerar.');
    S.generateRequest??={requestId:crypto.randomUUID(),expectedRevision:S.analysis.revision};
    setBusy(true,'Gerando a análise com os dados conferidos dos dois setores…');
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/generate'),{method:'POST',body:S.generateRequest});
    adoptAnalysis(response.analysis);
    if(!uuid(response.simulation?._id)||S.analysis.currentSimulation?.id!==response.simulation._id)throw new Error('O resultado ainda não foi confirmado nesta tela. Atualize a análise para conferir a versão salva.');
    S.generateRequest=null;S.versionsData=null;
    setBusy(false);location.href='/simulator.html?'+new URLSearchParams({simulation:response.simulation._id});
  } catch(error){showError(error);}
  finally{if(S.busy){setBusy(false);renderDetail();}}
}

function showVersions() {
  if(!S.versionsData||!$('#analysis-version-list'))return;
  $('#analysis-version-list').innerHTML=renderAnalysisVersions({...S.versionsData,currentId:S.analysis.currentSimulation?.id});
  document.querySelectorAll('[data-versions-page]').forEach(button=>button.onclick=()=>void loadVersions(Number(button.dataset.versionsPage)));
}
async function loadVersions(page) {
  if(S.versionsLoading||!S.analysis)return;
  const id=S.analysis.id,sequence=S.sequence;S.versionsLoading=true;
  try {
    $('#analysis-version-list').innerHTML='<p class="analysis-note">Carregando as versões desta empresa…</p>';
    const response=await analysisRequest(apiPath('/'+id+'/versions?'+new URLSearchParams({page:String(page)})));
    if(!currentContext(id,sequence))return;
    if(!Array.isArray(response.items))throw new Error('Não foi possível confirmar as versões salvas.');
    S.versionsData={items:response.items,pagination:pagination(response)};showVersions();
  } catch(error){if(currentContext(id,sequence)&&$('#analysis-version-list')){
    $('#analysis-version-list').innerHTML=`<p class="analysis-note">${esc(error.message)}</p><button type="button" id="analysis-retry-versions">Tentar novamente</button>`;
    $('#analysis-retry-versions').onclick=()=>void loadVersions(page);
  }}finally{S.versionsLoading=false;}
}

async function boot() {
  try {
    const session=await analysisRequest('/api/auth/session');S.user=session.user;
    mountNavigation(S.user,'analyses');
    if(!S.user||S.user.mustChangePassword){
      $('#analyses-app').innerHTML=`<section class="analysis-empty"><h1>${S.user?.mustChangePassword?'Redefina sua senha para continuar':'Entre para acessar as análises'}</h1><p>Use a conta da equipe Maximum para consultar empresas, documentos e resultados.</p><a class="analysis-button primary" href="/">Acessar painel</a></section>`;return;
    }
    const query=new URLSearchParams(location.search),id=query.get('id'),clientId=query.get('client');
    if(id)await openAnalysis(id);
    else if(query.get('view')==='new')await openNew(clientId||'');
    else if(clientId)await openCompany(clientId);
    else await openList();
  } catch(error){showError(error);if($('#analyses-app .initial'))$('#analyses-app').innerHTML='<section class="analysis-empty"><h2>Não foi possível abrir as análises</h2><p>Confira sua sessão e tente novamente. O trabalho já salvo permanece disponível.</p><a class="analysis-button" href="/analyses.html">Tentar novamente</a><a href="/">Acessar painel</a></section>';}
}
window.addEventListener('beforeunload',event=>{if(hasLocalWork()||S.busy||S.pdfBusy){event.preventDefault();event.returnValue='';}});
boot();
