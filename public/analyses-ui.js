import {mountNavigation} from './navigation.js';
import {analysisRequest} from './analyses-api.js';
import {defaultRegimeSelection,parseRegimeSelection,requiresSimplesReference,REGIME_SELECTION_VERSION} from './regime-selection.js';
import {defaultDifalPolicy,parseDifalPolicy} from './simulator-engine.js';
import {buildRbt12Schedule} from './simulator-rbt12.js';
import {analysisDocumentStatus,loadAnalysisExtraction,retryAnalysisExtraction,uploadAnalysisExtraction} from './analyses-extrato.js';
import {parseAccountingPaste,planAccountingPaste,ACCOUNTING_IMPORT_CSV_TEMPLATE} from './analysis-accounting-import.js';
import {renderAccountingPaste} from './analyses-accounting-paste.js';
import {analysisGuidance,accountingSourceMonths,analysisPeriodFor,scopedAccountingMonths,usesFixedAnalysisPeriod} from './analyses-guidance.js';
import {analysisMonthsForYear,isAnalysisMonth} from './analysis-period.js';
import {wizardStep,initialWizardStep,normalizeWizardStep} from './analyses-wizard.js';
import {createAnalysisModal,restoreAnalysisNotices} from './analyses-modal.js';
import {ACCOUNTING_FIELDS,ADJUSTMENT_FIELDS,esc,money,monthLabel,sectorName,analysisUrl,companyResults,
  renderNewAnalysis,renderNewCompanyContext,renderAnalysisList,renderAnalysisDetail,renderAnalysisVersions,
  renderAnalysisGuidance,renderAccountingSummary,renderAnalysisGeneration,renderWizardReview,
  renderDifalChoice,difalChoiceSummary,renderFiscalReports,renderFiscalReference,renderFiscalEvidence,renderAccountingSourceMonths,
  renderAnalysisPeriod,renderFiscalComposition} from './analyses-view.js';

const $=(selector,root=document)=>root.querySelector(selector);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const clone=value=>structuredClone(value);
const S={user:null,clients:null,analysis:null,sector:null,source:null,generation:null,generationError:'',reference:null,
  documentStatus:null,pdfStatus:'',pdfBusy:false,busy:false,sequence:0,configDraft:null,fiscalDraft:null,accountingDraft:null,
  evidenceState:'idle',evidenceError:'',evidenceKey:null,
  metadataState:'idle',metadataKey:null,generationUnavailable:false,
  configDirty:false,fiscalDirty:false,accountingDirty:false,versionsOpen:false,versionsData:null,versionsLoading:false,
  generateRequest:null,newClient:'',newSearch:'',newSector:'',newYear:2027,newSelection:defaultRegimeSelection(),
  newChoiceIds:defaultRegimeSelection().selected,newExisting:null,newCheckingCompany:false,newCompanyError:'',companyCheckSequence:0,
  newDifalPolicy:defaultDifalPolicy(),newDifalChoice:null,fiscalDifalChoice:undefined,difalEnabledMemory:{new:null,analysis:null},
  deleting:false,deleteTarget:null,deleteTrigger:null,
  paste:{text:'',preview:null,error:'',replaceConfirmed:false,open:false,pending:false},detailOpen:{},
  modalKind:null,modalOpen:false,modalSteps:{},modalReturn:null};
let modal=null;
let companyCheckController=null,evidenceTask=null,metadataTask=null,accountingSummaryFrame=0;
let scheduleCache={reference:null,months:null,value:null};
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
  feedback('');
  const host=$('#analysis-error');host.replaceChildren();host.hidden=false;
  const conflict=error?.status===409&&error?.code==='ANALYSIS_CONFLICT';
  const missingGeneration=error?.code==='ANALYSIS_GENERATION_UNAVAILABLE'&&S.analysis;
  if(missingGeneration){
    cancelEvidence();cancelMetadata();S.generation=null;S.source=null;S.generationUnavailable=true;
    S.generationError=error.message;S.metadataState='error';S.metadataKey=evidenceKey(S.analysis);
    S.evidenceState='error';S.evidenceError=error.message;S.evidenceKey=evidenceKey(S.analysis);
    if(S.modalKind==='fiscal')S.modalSteps.fiscal='documents';
  }
  const message=document.createElement('p');
  message.textContent=conflict?'Este trabalho foi atualizado em outra aba ou por outra pessoa. Seus campos continuam nesta tela. Confira a versão salva antes de continuar.':error?.message||'Não foi possível concluir a operação. Tente novamente.';
  host.append(message);
  if(missingGeneration){
    const button=document.createElement('button');button.type='button';button.textContent='Conferir documentos fiscais';
    button.onclick=()=>openWizard('fiscal',{step:'documents'});host.append(button);
  }
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
  const changed=!S[sector+'Dirty'];
  S[sector+'Dirty']=true;S.generateRequest=null;
  if(sector==='accounting')invalidatePastePreview('Os valores do formulário mudaram. Confira novamente a colagem antes de aplicá-la.');
  const generate=$('#analysis-generate');if(generate)generate.disabled=true;
  feedback('');
  if(changed)refreshGuidance();
  else refreshDraftStatus();
}
function refreshDraftStatus() {
  const host=$('#analysis-draft-status');if(!host)return;
  if(S.modalKind==='new'){host.textContent='';return;}
  if(!writable()){host.textContent='Somente consulta';host.dataset.state='saved';return;}
  const pending=S.modalKind==='accounting'&&S.paste.pending;
  const changed=S[S.modalKind+'Dirty'];
  host.textContent=pending?'Colagem aguardando aplicação':changed?'Alterações não salvas':S.modalKind==='config'?'Escolhas salvas':S.analysis?.[S.modalKind]?.updatedAt?'Dados salvos':'Salve para continuar depois';
  host.dataset.state=pending||changed?'pending':'saved';
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
  let step=normalizeWizardStep(kind,S.modalSteps[kind]);
  if(!step){
    step=initialWizardStep(kind,{resume,hasDocuments:!!(S.source?.monthlyReports?.length||S.analysis?.fiscal?.data?.generationId&&S.analysis?.readiness?.months?.length),hasMonths:!!S.accountingDraft?.months?.length}).id;
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
    checkingCompany:S.newCheckingCompany,companyCheckError:S.newCompanyError,
    difalPolicy:S.newDifalPolicy,difalChoice:S.newDifalChoice};
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
  }
}
async function advanceWizard() {
  if(S.busy||S.pdfBusy||!S.modalKind)return;
  try{
    clearError();const state=currentWizardState();if(!state.next)return;validateWizardAdvance(state);
    if(S.modalKind==='fiscal'&&state.id==='regimes'){
      captureAll();
      if(S.configDirty&&writable()){
        setBusy(true,'Salvando os regimes escolhidos…');
        const config=S.configDraft;
        const response=await analysisRequest(apiPath('/'+S.analysis.id+'/config?summary=1'),{method:'PATCH',body:{expectedConfigRevision:S.analysis.config.revision,year:config.year,regimeSelection:config.regimeSelection}});
        S.configDirty=false;adoptAnalysis(response.analysis,{preserveDrafts:true});
        // Regime changes can remove the reference requirement. The captured draft
        // is normalized against the configuration returned by the server.
        if(!requiresSimplesReference(S.analysis.config.regimeSelection))Object.assign(S.fiscalDraft,{rbt12Source:'NOT_REQUIRED',rbt12:null,rbt12ExtractionId:null,rbt12DocumentId:null,rbt12ManualConfirmed:false});
        else if(S.fiscalDraft.rbt12Source==='NOT_REQUIRED')S.fiscalDraft.rbt12Source='SIMPLES_SECTION_22';
        setBusy(false);S.modalSteps.fiscal=state.next;renderDetail();return;
      }
    }
    if(S.modalKind==='fiscal'&&state.id==='difal')validateDifalChoice('analysis',S.analysis.config.regimeSelection,captureFiscal().difalPolicy,{required:S.fiscalDifalChoice===null});
    setWizardStep(state.next);
  }catch(error){if(S.busy){setBusy(false);renderDetail();}showError(error);}
}
function closeWizard() {
  if(S.busy||S.pdfBusy||!S.modalOpen)return;
  // Keep the dialog and its raw inputs mounted. Closing/back never parses or saves a draft.
  S.modalOpen=false;modal?.close();syncWizardUrl();
}
function bindWizard() {
  const dialog=$('#analysis-wizard');if(!dialog||!S.modalKind)return;
  modal=createAnalysisModal({dialog,isBusy:()=>S.busy||S.pdfBusy||S.deleting,returnFocus:wizardReturnTarget,
    onNext:advanceWizard,onBack:()=>{const previous=currentWizardState().previous;if(previous)setWizardStep(previous);},
    onPrevious:step=>setWizardStep(step),onClose:closeWizard});
  modal.sync(currentWizardState());
  if(S.modalOpen)modal.open(currentWizardState());
  refreshDraftStatus();
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||!event.target.matches('input:not([type=file])'))return;
    event.preventDefault();
    if(S.busy||S.pdfBusy)return;
    if(['analysis-new-month','analysis-new-source-year'].includes(event.target.id)){$('#analysis-add-month')?.click();return;}
    if(!event.target.matches('[type=checkbox],[type=radio]')&&!currentWizardState().isLast)advanceWizard();
  });
}
function openWizard(kind,{step=null}={}) {
  if(S.busy||S.pdfBusy)return false;
  try {
    clearError();feedback('');
    const same=S.modalKind===kind&&$('#analysis-wizard')?.dataset.wizardKind===kind;
    if(!same)captureAll();
    if(!document.activeElement?.closest('dialog'))S.modalReturn=document.activeElement;
    S.modalKind=kind;S.modalOpen=true;
    if(['fiscal','accounting'].includes(kind))S.sector=kind;
    if(step)S.modalSteps[kind]=wizardStep(kind,step).id;
    if(same){if(step)setWizardStep(step,{focus:false});modal.open(currentWizardState());}
    else renderDetail();
    if(kind==='fiscal')void ensureEvidence();
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
  if(evidenceTask&&S.analysis?.revision!==record.revision)cancelEvidence();
  if(S.analysis&&evidenceKey(S.analysis)!==evidenceKey(record)){
    cancelEvidence();S.evidenceState='idle';S.evidenceKey=null;S.evidenceError='';
    cancelMetadata();S.metadataState='idle';S.metadataKey=null;S.generationUnavailable=false;
    if(S.analysis.fiscal.data.generationId!==record.fiscal.data.generationId){S.generation=null;S.source=null;S.generationError='';}
  }
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
  const response=await analysisRequest(apiPath('?'+new URLSearchParams({page:String(page),summary:'1',...(search?{search}:{})})));
  if(!Array.isArray(response.items))throw new Error('Não foi possível carregar as análises.');
  const items=response.items.map(assertAnalysis);
  $('#analyses-app').innerHTML=renderAnalysisList({items,pagination:pagination(response),search,canWrite:writable()});
  $('#analysis-search-form').onsubmit=event=>{event.preventDefault();location.href='/analyses.html?'+new URLSearchParams({view:'list',search:$('#analysis-search').value.trim()});};
  document.querySelectorAll('[data-analysis-page]').forEach(button=>button.onclick=()=>{location.href='/analyses.html?'+new URLSearchParams({view:'list',page:button.dataset.analysisPage,...(search?{search}:{})});});
  bindDeleteAnalysis(items);
  if(query.get('deleted')==='1')feedback('Análise excluída. Você já pode iniciar uma nova análise para esta empresa. O cadastro e os documentos fiscais existentes foram preservados.');
}

function setDeleteBusy(value) {
  S.deleting=value;
  const dialog=$('#analysis-delete-dialog');if(!dialog)return;
  dialog.setAttribute('aria-busy',String(value));
  $('#analyses-app').setAttribute('aria-busy',String(value));
  dialog.querySelectorAll('button').forEach(button=>button.disabled=value);
  $('#analysis-delete-confirm').textContent=value?'Excluindo…':'Excluir análise';
}
function bindDeleteAnalysis(items=[]) {
  const dialog=$('#analysis-delete-dialog');
  if(!dialog||!writable())return;
  const records=new Map(items.map(record=>[record.id,record]));
  document.querySelectorAll('[data-delete-analysis]').forEach(trigger=>trigger.onclick=()=>{
    if(S.busy||S.pdfBusy||S.deleting||dialog.open)return;
    const id=trigger.dataset.deleteAnalysis,record=S.analysis?.id===id?S.analysis:records.get(id);
    if(!record||S.analysis&&S.analysis.id!==record.id)return;
    S.deleteTarget={id:record.id,clientId:record.clientId,revision:record.revision,fromList:!S.analysis};S.deleteTrigger=trigger;
    $('#analysis-delete-company').textContent=record.company?.name||'Empresa';
    $('#analysis-delete-cnpj').textContent=record.company?.cnpj||'CNPJ não informado';
    $('#analysis-delete-context').textContent=(record.company?.code?'Código '+record.company.code+' · ':'')+'Cenário '+record.config.year;
    $('#analysis-delete-error').replaceChildren();$('#analysis-delete-status').textContent='';
    dialog.showModal();$('#analysis-delete-cancel').focus();
  });
  $('#analysis-delete-cancel').onclick=()=>{if(!S.deleting)dialog.close();};
  $('#analysis-delete-confirm').onclick=()=>void confirmDeleteAnalysis();
  dialog.addEventListener('cancel',event=>{if(S.deleting)event.preventDefault();});
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    S.deleteTarget=null;
    if(S.deleteTrigger?.isConnected)S.deleteTrigger.focus({preventScroll:true});
    S.deleteTrigger=null;
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button:not(:disabled)')].filter(button=>button.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
  });
}
async function confirmDeleteAnalysis() {
  const target=S.deleteTarget,dialog=$('#analysis-delete-dialog');
  if(!target||!dialog?.open||S.deleting||S.busy||S.pdfBusy||!writable()||(!target.fromList&&S.analysis?.id!==target.id)||(target.fromList&&S.analysis))return;
  setDeleteBusy(true);$('#analysis-delete-error').replaceChildren();$('#analysis-delete-status').textContent='Excluindo os dados e as versões desta análise…';
  try {
    const response=await analysisRequest(apiPath('/'+target.id),{method:'DELETE',body:{expectedRevision:target.revision,confirmed:true}});
    if(response.deleted!==true||response.id!==target.id||response.clientId!==target.clientId)throw new Error('O servidor não confirmou a exclusão desta análise. Tente novamente para conferir o mesmo registro.');
    S.sequence++;cancelEvidence();cancelMetadata();S.analysis=null;S.configDraft=S.fiscalDraft=S.accountingDraft=null;
    S.configDirty=S.fiscalDirty=S.accountingDirty=false;S.paste.pending=false;S.generateRequest=null;
    S.modalOpen=false;S.modalKind=null;releaseWizard();setDeleteBusy(false);dialog.close();
    location.href='/analyses.html?deleted=1';
  } catch(error){
    const host=$('#analysis-delete-error');host.textContent=error?.message||'Não foi possível confirmar a exclusão. Tente novamente.';
    if(error?.status===409&&error?.code==='ANALYSIS_CONFLICT'){
      host.textContent='A análise foi atualizada por outra pessoa ou aba. Confira os dados salvos antes de confirmar uma nova exclusão.';
      const reload=document.createElement('button');reload.type='button';reload.id='analysis-delete-reload';reload.textContent='Conferir trabalho atualizado';
      reload.onclick=async()=>{
        if(S.deleting)return;
        if(hasLocalWork()&&!confirm('Recarregar o trabalho salvo? Os campos e a colagem ainda não salvos nesta página serão descartados.'))return;
        dialog.close();S.configDirty=S.fiscalDirty=S.accountingDirty=false;S.paste.pending=false;
        try{
          if(target.fromList){
            const controls=[...document.querySelectorAll('#analyses-app button')].map(button=>[button,button.disabled]);
            setBusy(true,'Atualizando a lista de análises…');
            try{
              await openList();feedback('Lista atualizada. Confirme a análise que deseja excluir.','info');
              document.querySelector(`[data-delete-analysis="${target.id}"]`)?.focus({preventScroll:true});
            }finally{
              setBusy(false);for(const [button,disabled] of controls)if(button.isConnected)button.disabled=disabled;
            }
          }else await openAnalysis(target.id);
        }catch(reloadError){showError(reloadError);}
      };
      host.append(document.createElement('br'),reload);
    }
    $('#analysis-delete-status').textContent='';
    setDeleteBusy(false);$('#analysis-delete-cancel').focus();
  }
}

function selectionFrom(form) {
  const selected=[...form.querySelectorAll('input[name=regime]:checked')].map(input=>input.value);
  if(!selected.length){const field=form.querySelector('input[name=regime]');revealWizardField(field);field?.focus();throw new Error('Selecione pelo menos um regime tributário para esta análise.');}
  return parseRegimeSelection({version:REGIME_SELECTION_VERSION,selected});
}
function difalSelection(prefix) {
  return prefix==='new'?{version:REGIME_SELECTION_VERSION,selected:S.newChoiceIds}:S.analysis.config.regimeSelection;
}
function selectedDifalRegimes(selection) {return selection.selected.filter(id=>id==='pure'||id==='hybrid');}
function difalChoice(policy,selection) {return selectedDifalRegimes(selection).some(id=>policy.enabled[id])?'yes':'no';}
function captureDifalPolicy(prefix,base) {
  const panel=$('#'+prefix+'-difal-panel'),policy=clone(base||defaultDifalPolicy());
  if(!panel)return parseDifalPolicy(policy);
  panel.querySelectorAll('[data-analysis-difal-enabled]').forEach(input=>policy.enabled[input.dataset.analysisDifalEnabled]=input.checked);
  panel.querySelectorAll('[data-analysis-difal-operation]').forEach(input=>policy.operations[input.dataset.analysisDifalRegime][input.dataset.analysisDifalOperation]=input.checked);
  return parseDifalPolicy(policy);
}
function refreshDifalControls(prefix,policy,selection,choice=difalChoice(policy,selection)) {
  const panel=$('#'+prefix+'-difal-panel');if(!panel)return;
  panel.querySelectorAll('[data-difal-choice]').forEach(input=>input.checked=input.value===choice);
  panel.querySelectorAll('[data-analysis-difal-enabled]').forEach(input=>{
    input.checked=policy.enabled[input.dataset.analysisDifalEnabled];input.disabled=choice!=='yes';
  });
  panel.querySelectorAll('[data-analysis-difal-operation]').forEach(input=>{
    const id=input.dataset.analysisDifalRegime;
    input.checked=policy.operations[id][input.dataset.analysisDifalOperation];input.disabled=choice!=='yes'||!policy.enabled[id];
  });
  const details=$('#'+prefix+'-difal-details');if(details)details.hidden=choice!=='yes';
  const summary=$('#'+prefix+'-difal-summary');if(summary)summary.textContent=difalChoiceSummary(selection,policy,choice);
}
function changeDifal(prefix,input) {
  const selection=difalSelection(prefix),selected=selectedDifalRegimes(selection);
  const before=clone(prefix==='new'?S.newDifalPolicy:S.fiscalDraft.difalPolicy),policy=captureDifalPolicy(prefix,before);
  let choice;
  if(input.matches('[data-difal-choice]')){
    choice=input.value;
    if(choice==='no'){
      if(selected.some(id=>before.enabled[id]))S.difalEnabledMemory[prefix]=clone(before.enabled);
      policy.enabled.pure=policy.enabled.hybrid=false;
    }else if(!selected.some(id=>policy.enabled[id])){
      const memory=S.difalEnabledMemory[prefix],restore=memory&&selected.some(id=>memory[id]);
      selected.forEach(id=>policy.enabled[id]=restore?memory[id]===true:true);
    }
  }else{
    choice=difalChoice(policy,selection);
    if(choice==='no'){
      if(selected.some(id=>before.enabled[id]))S.difalEnabledMemory[prefix]=clone(before.enabled);
    }
  }
  if(prefix==='new'){S.newDifalPolicy=policy;S.newDifalChoice=choice;}
  else {S.fiscalDraft.difalPolicy=policy;S.fiscalDifalChoice=choice;}
  refreshDifalControls(prefix,policy,selection,choice);
  if(input.matches('[data-difal-choice]')&&choice==='yes'){
    const details=$('#'+prefix+'-difal-details');if(details)details.open=true;
  }
}
function refreshNewDifal() {
  const host=$('#analysis-new-difal');if(!host)return;
  const selection=difalSelection('new'),key=JSON.stringify([selection.selected,!!S.newExisting]);
  if(host.dataset.selection===key)return;
  const open=$('#new-difal-details')?.open;
  if(S.newDifalChoice!==null&&selectedDifalRegimes(selection).length)S.newDifalChoice=difalChoice(S.newDifalPolicy,selection);
  host.hidden=!!S.newExisting||!selectedDifalRegimes(selection).length;
  host.innerHTML=host.hidden?'':renderDifalChoice(selection,S.newDifalPolicy,{prefix:'new',choice:S.newDifalChoice});
  host.dataset.selection=key;
  refreshDifalControls('new',S.newDifalPolicy,selection,S.newDifalChoice);
  if(open&&$('#new-difal-details'))$('#new-difal-details').open=true;
}
function validateDifalChoice(prefix,selection,policy,{required=false}={}) {
  if(!selectedDifalRegimes(selection).length)return;
  if(required&&!['yes','no'].includes(prefix==='new'?S.newDifalChoice:S.fiscalDifalChoice)){
    const field=$('#'+prefix+'-difal-yes');revealWizardField(field);field?.focus();
    throw new Error('Informe se esta análise terá DIFAL: escolha Sim ou Não.');
  }
  if(difalChoice(policy,selection)==='yes'&&!selectedDifalRegimes(selection).some(id=>policy.enabled[id]&&(policy.operations[id].entry||policy.operations[id].exit))){
    const details=$('#'+prefix+'-difal-details');if(details){details.hidden=false;details.open=true;}
    const field=$('#'+prefix+'-difal-panel [data-analysis-difal-operation]:not(:disabled)');revealWizardField(field);field?.focus();
    throw new Error('Escolha entrada ou saída para incluir DIFAL, ou marque Não para gerar sem DIFAL.');
  }
}
function bindCompanyResults() {
  document.querySelectorAll('[data-analysis-client]').forEach(button=>button.onclick=()=>{
    if(S.busy)return;
    if(S.newClient===button.dataset.analysisClient&&S.newCheckingCompany)return;
    captureNewChoices();
    S.newClient=button.dataset.analysisClient;$('#analysis-new-client').value=S.newClient;
    S.newExisting=null;S.newCompanyError='';refreshCompanies();void checkNewCompany({advance:true});
  });
}
function captureNewChoices() {
  const form=$('#analysis-new-form');if(!form)return;
  S.newSector=form.querySelector('input[name=sector]:checked')?.value||'';
  if(!S.newExisting){
    if(form.querySelector('input[name=regime]'))S.newChoiceIds=[...form.querySelectorAll('input[name=regime]:checked')].map(input=>input.value);
    if($('#analysis-new-year'))S.newYear=Number($('#analysis-new-year').value);
    if($('#new-difal-panel')){
      S.newDifalPolicy=captureDifalPolicy('new',S.newDifalPolicy);
      S.newDifalChoice=$('#new-difal-panel [data-difal-choice]:checked')?.value||null;
    }
  }
}
function refreshNewCompanyState() {
  const host=$('#analysis-new-company-context');if(!host)return;
  host.innerHTML=renderNewCompanyContext({existingAnalysis:S.newExisting,checkingCompany:S.newCheckingCompany,companyCheckError:S.newCompanyError});
  const config=$('#analysis-new-config');
  if(config){config.hidden=!!S.newExisting;config.disabled=S.busy||!writable()||S.newCheckingCompany||!!S.newExisting||!!S.newCompanyError;}
  const chosen=S.newExisting?.config.regimeSelection.selected||S.newChoiceIds;
  document.querySelectorAll('#analysis-new-form input[name=regime]').forEach(input=>input.checked=chosen.includes(input.value));
  if($('#analysis-new-year'))$('#analysis-new-year').value=String(S.newExisting?.config.year||S.newYear);
  refreshNewDifal();
  const button=$('#analysis-open-company');button.disabled=S.busy||!writable()||!uuid(S.newClient)||S.newCheckingCompany||!!S.newCompanyError;
  $('#analysis-company-search').disabled=S.busy;
  button.textContent=S.newCheckingCompany?'Conferindo empresa…':['fiscal','accounting'].includes(S.newSector)?`${S.newExisting?'Continuar':'Começar'} no ${sectorName(S.newSector)}`:S.newExisting?'Continuar análise':'Começar análise';
  if($('#analysis-company-retry'))$('#analysis-company-retry').onclick=()=>void checkNewCompany({advance:true});
  if(modal&&S.modalKind==='new'){modal.sync(currentWizardState());if(currentWizardState().isLast)refreshWizardReview();}
}
async function checkNewCompany({advance=false}={}) {
  companyCheckController?.abort();
  const controller=new AbortController();companyCheckController=controller;
  const clientId=S.newClient,ticket=++S.companyCheckSequence;
  if(!uuid(clientId))return;
  clearError();
  S.newExisting=null;S.newCheckingCompany=true;S.newCompanyError='';refreshNewCompanyState();
  try {
    const response=await analysisRequest(apiPath('?'+new URLSearchParams({clientId,page:'1',summary:'1'})),{signal:controller.signal});
    if(ticket!==S.companyCheckSequence||S.newClient!==clientId)return;
    if(!Array.isArray(response.items))throw new Error('Não foi possível conferir a análise desta empresa. Tente novamente.');
    if(response.items.some(item=>item.clientId!==clientId))throw new Error('A resposta não corresponde à empresa escolhida. Selecione a empresa novamente.');
    const found=response.items[0];S.newExisting=found?assertAnalysis(found):null;
  } catch(error){if(ticket===S.companyCheckSequence&&S.newClient===clientId)S.newCompanyError=error.message;}
  finally{if(companyCheckController===controller)companyCheckController=null;if(ticket===S.companyCheckSequence&&S.newClient===clientId){
    S.newCheckingCompany=false;clearError();refreshNewCompanyState();
    if(advance&&!S.newCompanyError&&S.modalOpen&&S.modalKind==='new')setWizardStep('sector');
  }}
}
function refreshCompanies() {
  const results=companyResults(S.clients||[],S.newClient,S.newSearch);
  $('#analysis-company-results').innerHTML=results.html;
  $('#analysis-company-count').textContent=results.count?`${results.count} empresa(s) encontrada(s)${results.count>20?' · refine a busca para ver as demais':''}`:S.newSearch?'Nenhuma empresa encontrada.':'Busque uma empresa para começar.';
  bindCompanyResults();
}
async function openNew(clientId='') {
  await clients();
  const requestedSector=new URLSearchParams(location.search).get('sector');
  if(['fiscal','accounting'].includes(requestedSector))S.newSector=requestedSector;
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
    companyCheckController?.abort();companyCheckController=null;
    captureNewChoices();S.newSearch=event.target.value;S.newClient='';S.newExisting=null;S.newCompanyError='';
    S.newCheckingCompany=false;S.companyCheckSequence++;$('#analysis-new-client').value='';refreshCompanies();refreshNewCompanyState();
  };
  $('#analysis-new-form').onchange=event=>{
    if(event.target.matches('[data-difal-choice],[data-analysis-difal-enabled],[data-analysis-difal-operation]'))changeDifal('new',event.target);
    captureNewChoices();refreshNewCompanyState();
  };bindCompanyResults();refreshNewCompanyState();
  $('#analysis-new-form').onsubmit=async event=>{
    event.preventDefault();if(S.busy||!writable())return;
    if(!currentWizardState().isLast){advanceWizard();return;}
    try {
      clearError();const form=event.currentTarget;
      if(!uuid(S.newClient))throw new Error('Selecione a empresa na busca antes de continuar.');
      if(S.newCheckingCompany||S.newCompanyError)throw new Error('Conclua a conferência da empresa antes de continuar.');
      captureNewChoices();
      const selection=S.newExisting?.config.regimeSelection||S.newSelection,year=S.newExisting?.config.year||S.newYear;
      if(!S.newExisting)S.newSelection=selection;
      if(!['fiscal','accounting'].includes(S.newSector)){
        const field=form.querySelector('input[name=sector]');revealWizardField(field);field?.focus();
        throw new Error('Escolha o setor Fiscal ou Contábil para começar.');
      }
      if(![2027,2028].includes(year))throw new Error('Escolha um ano válido para o cenário.');

      const clientId=S.newClient,sector=S.newSector;
      const difalPolicy=clone(S.newDifalPolicy);
      if(!requiresSimplesReference(selection))difalPolicy.enabled.pure=difalPolicy.enabled.hybrid=false;
      setBusy(true,'Abrindo a análise desta empresa…');
      const response=await analysisRequest(apiPath('?summary=1'),{method:'POST',body:{clientId,year,regimeSelection:selection,...(!S.newExisting?{difalPolicy:parseDifalPolicy(difalPolicy)}:{})}});
      const record=assertAnalysis(response.analysis);
      if(record.clientId!==clientId)throw new Error('A análise retornada não corresponde à empresa selecionada.');
      setBusy(false);location.href=analysisUrl(record.id,sector)+(response.created?'&created=1':'&resumed=1');
    } catch(error){if(S.busy){setBusy(false);await openNew().catch(showError);}showError(error);}
  };
  $('#analysis-resume-new').onclick=()=>{S.modalReturn=$('#analysis-resume-new');S.modalOpen=true;modal.open(currentWizardState());};
  bindWizard();
  if(clientId&&!S.newExisting&&!S.newCheckingCompany)await checkNewCompany({advance:true});
}

async function openCompany(clientId) {
  if(!uuid(clientId))throw new Error('Selecione uma empresa válida para abrir a análise.');
  const query=new URLSearchParams(location.search),requestedSector=query.get('sector');
  const sector=['fiscal','accounting'].includes(requestedSector)?requestedSector:null;
  const response=await analysisRequest(apiPath('?'+new URLSearchParams({clientId,page:'1',summary:'1'})));
  if(!Array.isArray(response.items)||response.items.some(item=>item.clientId!==clientId))throw new Error('Não foi possível conferir a análise desta empresa.');
  let found=response.items[0],created=false;
  // An explicit company-sector button already identifies both choices. The server
  // atomically creates or resumes the one analysis; a concurrent existing record
  // keeps its configuration and data unchanged.
  if(!found&&sector&&writable()){
    const opened=await analysisRequest(apiPath('?summary=1'),{method:'POST',body:{clientId,year:2027,regimeSelection:defaultRegimeSelection()}});
    found=assertAnalysis(opened.analysis);created=opened.created===true;
    if(found.clientId!==clientId)throw new Error('A análise retornada não corresponde à empresa selecionada.');
  }
  if(found){
    const target=new URL(analysisUrl(found.id,sector||undefined,query.get('view')==='versions'?'versions':undefined),location.origin);
    if(created)target.searchParams.set('created','1');
    if(query.get('entry')==='company'){
      target.searchParams.set('entry','company');
      if(sector==='fiscal')target.searchParams.set('step','documents');
    }
    history.replaceState(null,'',target.pathname+target.search);
    await openAnalysis(found.id);
  } else await openNew(clientId);
}

function currentContext(id,sequence){return S.analysis?.id===id&&S.sequence===sequence;}
function evidenceKey(record) {
  return JSON.stringify([record.id,record.revision,record.config.revision,record.fiscal.revision]);
}
function cancelEvidence() {
  if(!evidenceTask)return;
  evidenceTask.controller.abort();evidenceTask=null;
  if(S.evidenceState==='loading')S.evidenceState='idle';
}
function cancelMetadata() {
  metadataTask?.controller.abort();metadataTask=null;
}
function generationMetadata(record,{force=false}={}) {
  const key=evidenceKey(record),id=record.id,generationId=record.fiscal.data.generationId,sequence=S.sequence;
  if(!generationId)return Promise.resolve(null);
  if(metadataTask?.key===key)return metadataTask.promise;
  if(!force&&S.metadataKey===key&&S.metadataState==='ready')return Promise.resolve(S.generation);
  if(!force&&S.metadataKey===key&&S.metadataState==='error')return Promise.reject(Object.assign(new Error(S.generationError),{status:S.generationUnavailable?404:0}));
  cancelMetadata();const controller=new AbortController(),task={key,controller,promise:null};metadataTask=task;
  S.metadataState='loading';S.metadataKey=key;S.generationError='';S.generationUnavailable=false;refreshAccountingSources();
  task.promise=analysisRequest('/api/v4/generations/'+encodeURIComponent(generationId),{signal:controller.signal}).then(generation=>{
    if(generation._id!==generationId||!generation.companies?.some(company=>company.clientId===record.clientId))throw new Error('Os relatórios não correspondem à empresa desta análise. Confira o vínculo antes de continuar.');
    if(currentContext(id,sequence)&&evidenceKey(S.analysis)===key){S.generation=generation;S.metadataState='ready';}
    return generation;
  }).catch(error=>{
    if(!controller.signal.aborted&&currentContext(id,sequence)&&evidenceKey(S.analysis)===key){
      S.metadataState='error';S.generation=null;S.generationUnavailable=error.status===404;
      S.generationError=S.generationUnavailable?'Os documentos fiscais vinculados não estão disponíveis. Prepare uma nova importação para continuar.':error.message||'Não foi possível conferir os relatórios vinculados.';
    }
    throw error;
  }).finally(()=>{
    if(metadataTask===task)metadataTask=null;
    if(currentContext(id,sequence)&&evidenceKey(S.analysis)===key)refreshAccountingSources();
  });return task.promise;
}
function bindAccountingSourceActions() {
  const add=$('#analysis-add-fiscal-months');if(add)add.onclick=()=>{try{clearError();addMonths(expectedAccountingMonths());}catch(error){showError(error);}};
  const retry=$('#analysis-retry-accounting-months');if(retry)retry.onclick=()=>void generationMetadata(S.analysis,{force:true}).catch(()=>{});
}
function refreshAccountingSources() {
  const period=S.analysis&&analysisPeriodFor(S.analysis,S.source,S.generation);
  // When source metadata identifies the year after an empty grid opened, follow
  // that year only while there is no accounting input or pending paste to lose.
  if(period&&$('#analysis-accounting-form')&&!S.accountingDirty&&!S.paste.pending&&
     S.accountingDraft?.months.every(row=>ACCOUNTING_FIELDS.every(([key])=>row[key]===null))&&
     document.querySelector('[data-accounting-month]')?.dataset.accountingMonth.slice(0,4)!==String(period.sourceYear)){
    ensureAccountingGrid();renderDetail();return;
  }
  refreshPeriodViews();
  const host=$('#analysis-accounting-source-months');if(!host||!S.analysis)return;
  host.innerHTML=renderAccountingSourceMonths(detailOptions());bindAccountingSourceActions();scheduleAccountingSummary();
}
function ensureAccountingMetadata() {
  if(S.analysis?.fiscal.data.generationId&&(usesFixedAnalysisPeriod(S.analysis)?!analysisPeriodFor(S.analysis,S.source,S.generation):!expectedAccountingMonths().length))void generationMetadata(S.analysis).catch(()=>{});
}
function refreshPeriodViews() {
  if(!S.analysis)return;
  const options=detailOptions(),html=renderAnalysisPeriod(options),compactHtml=renderAnalysisPeriod(options,{compact:true});
  for(const id of ['analysis-overview-period','analysis-fiscal-period','analysis-accounting-period']){
    const host=$('#'+id);if(!host)continue;
    const open=host.querySelector('.analysis-period-details')?.open;
    host.innerHTML=id==='analysis-overview-period'?html:compactHtml;
    if(open&&host.querySelector('.analysis-period-details'))host.querySelector('.analysis-period-details').open=true;
  }
  const field=$('#analysis-new-source-year'),period=analysisPeriodFor(S.analysis,S.source,S.generation);
  if(field&&period){field.value=String(period.sourceYear);field.readOnly=true;}
  if(period&&$('#analysis-accounting-form')){
    // A late year must not hide a field while its raw value is being edited.
    document.querySelectorAll('[data-accounting-month]').forEach(host=>{
      const outside=!isAnalysisMonth(host.dataset.accountingMonth,period.sourceYear);
      host.hidden=false;host.classList.toggle('is-outside-period',outside);
      const name=$('.analysis-expense-month-name',host),note=$('[data-accounting-period-note]',host);
      if(outside&&!note)name.insertAdjacentHTML('beforeend','<small data-accounting-period-note>Fora do período desta análise</small>');
      else if(!outside)note?.remove();
    });
    const excluded=S.accountingDraft.months.length-scopedAccountingMonths(S.analysis,S.accountingDraft.months,S.source,S.generation).length;
    const note=$('#analysis-accounting-excluded');if(note)note.innerHTML=excluded?`<p class="analysis-period-excluded">${excluded} competência(s) fora do período permanecem salvas e não entram nos totais abaixo.</p>`:'';
  }
}
function refreshEvidence() {
  const status=$('#analysis-fiscal-evidence');if(status)status.innerHTML=renderFiscalEvidence(detailOptions());
  const retry=$('#analysis-retry-evidence');if(retry)retry.onclick=()=>void ensureEvidence({force:true});
  const replace=$('#analysis-replace-missing-documents');if(replace)replace.onclick=()=>void prepareImport();
  const reports=$('#analysis-fiscal-documents-view');if(reports)reports.innerHTML=renderFiscalReports(detailOptions());
  const composition=$('#analysis-commercial-composition');if(composition)composition.innerHTML=renderFiscalComposition(detailOptions());
  bindFiscalDocumentActions();
  const reference=$('#analysis-fiscal-reference');
  if(reference)reference.innerHTML=renderFiscalReference({...detailOptions(),draft:S.fiscalDraft});
  const searchable=$('#analysis-searchable-pdf');if(searchable)searchable.hidden=!(S.reference&&S.reference.searchableStored!==false);
  const pdfStatus=$('#analysis-pdf-status');if(pdfStatus&&!S.pdfBusy)pdfStatus.textContent=S.pdfStatus||
    (S.reference?'Leitura confirmada e salva no Fiscal. Confira a seção 2.2 abaixo.':S.fiscalDraft.rbt12DocumentId?'Há um PDF vinculado. Confira a leitura ou tente novamente.':'Nenhum extrato confirmado nesta análise.');
  bindAnalysisActions(status||document);
  const adjustment=$('#analysis-adjustment-source-action');
  if(adjustment){
    adjustment.hidden=!S.source?.monthlyReports?.length;
    if($('#analysis-edit-adjustments'))$('#analysis-edit-adjustments').onclick=editFiscalAdjustments;
  }
  refreshAccountingSources();
}
async function ensureEvidence({force=false}={}) {
  if(!S.analysis||S.modalKind!=='fiscal'||!S.modalOpen)return;
  const record=S.analysis,id=record.id,sequence=S.sequence,key=evidenceKey(record),fiscal=record.fiscal.data;
  // Closing or switching a modal does not start another server reconciliation.
  if(evidenceTask?.key===key)return evidenceTask.promise;
  if(!force&&S.evidenceKey===key&&['ready','error'].includes(S.evidenceState))return;
  cancelEvidence();
  const controller=new AbortController(),task={key,controller,promise:null};evidenceTask=task;
  S.evidenceKey=key;S.evidenceState='loading';S.evidenceError='';refreshEvidence();
  task.promise=(async()=>{
    const sourceRead=analysisRequest(apiPath('/'+id+'?includeSource=1'),{signal:controller.signal});
    const generationRead=generationMetadata(record,{force});
    const referenceRead=requiresSimplesReference(record.config.regimeSelection)&&fiscal.rbt12Source==='SIMPLES_SECTION_22'&&fiscal.rbt12ExtractionId?
      S.reference?.extractionId===fiscal.rbt12ExtractionId&&S.reference?.documentId===fiscal.rbt12DocumentId?Promise.resolve(S.reference):
        loadAnalysisExtraction({clientId:record.clientId,documentId:fiscal.rbt12DocumentId,extractionId:fiscal.rbt12ExtractionId,cnpj:record.company.cnpj,signal:controller.signal}):Promise.resolve(null);
    const active=()=>!controller.signal.aborted&&evidenceTask===task&&
      currentContext(id,sequence)&&evidenceKey(S.analysis)===key&&S.modalKind==='fiscal'&&S.modalOpen;
    // The lighter generation metadata can show Entradas and Saídas as completed
    // immediately, independently of the slower reconciliation and PDF reading.
    const reportUpdated=()=>{if(active())refreshEvidence();};
    void generationRead.then(reportUpdated,reportUpdated);
    // A confirmed extrato becomes visible as soon as it arrives; it must not
    // hold the report badges hostage or silently invalidate their success.
    void referenceRead.then(reference=>{
      if(active()&&reference&&S.fiscalDraft.rbt12Source==='SIMPLES_SECTION_22'&&
         S.fiscalDraft.rbt12ExtractionId===fiscal.rbt12ExtractionId&&
         S.fiscalDraft.rbt12DocumentId===fiscal.rbt12DocumentId){S.reference=reference;S.pdfStatus='';refreshEvidence();}
    },error=>{if(active()){S.pdfStatus=error.message||'Não foi possível confirmar a leitura do extrato.';refreshEvidence();}});
    const reads=await Promise.allSettled([sourceRead,generationRead,referenceRead]);
    if(controller.signal.aborted||evidenceTask!==task||!currentContext(id,sequence)||evidenceKey(S.analysis)!==key)return;
    let error='',generationUnavailable=false;
    S.generationError='';
    if(reads[0].status==='fulfilled'){
      try{
        const data=reads[0].value,checked=assertAnalysis(data.analysis);
        if(checked.id!==id||checked.clientId!==record.clientId||evidenceKey(checked)!==key)throw new Error('Os dados salvos foram atualizados durante a conferência. Reabra a análise para consultar a versão atual; os campos desta tela continuam preservados.');
        if(data.source&&(data.source.generationId!==fiscal.generationId||data.source.clientId!==record.clientId))throw new Error('A fonte recebida não corresponde à empresa e aos documentos desta análise.');
        S.source=data.source||null;
        // A late check never advances a saved revision underneath an edited form.
        if(S.analysis.revision===record.revision&&checked.revision===record.revision)adoptAnalysis(checked,{preserveDrafts:true});
        if(data.sourceError&&fiscal.generationId){
          error=data.sourceError.message||'Não foi possível conferir os documentos fiscais vinculados.';
          generationUnavailable=data.sourceError.code==='ANALYSIS_GENERATION_UNAVAILABLE';
        }
      }catch(failure){error=failure.message;}
    }else error=reads[0].reason?.message||'Não foi possível conferir os documentos fiscais.';
    if(reads[1].status==='fulfilled'){
      const generation=reads[1].value;
      if(generation&&(generation._id!==fiscal.generationId||!generation.companies?.some(company=>company.clientId===record.clientId)))S.generationError='Os relatórios não correspondem à empresa desta análise. Confira o vínculo antes de continuar.';
      else S.generation=generation;
    }else S.generationError=reads[1].reason?.status===404?'Os documentos fiscais vinculados não estão disponíveis. Confira os relatórios ou prepare uma nova importação.':reads[1].reason?.message||'Não foi possível conferir os relatórios vinculados.';
    const usesReference=S.fiscalDraft.rbt12Source==='SIMPLES_SECTION_22'&&S.fiscalDraft.rbt12ExtractionId===fiscal.rbt12ExtractionId&&S.fiscalDraft.rbt12DocumentId===fiscal.rbt12DocumentId;
    if(reads[2].status==='fulfilled'){
      const reference=reads[2].value;
      if(reference&&usesReference){if(S.reference!==reference)S.pdfStatus='';S.reference=reference;}
    }else if(usesReference)S.pdfStatus=reads[2].reason?.message||'Não foi possível confirmar a leitura do extrato. Verifique o PDF vinculado.';
    // O erro do PDF pertence ao campo RBT12; não transforma entradas/saídas já concluídas em documentos com erro.
    if(generationUnavailable||reads[1].status==='rejected'&&reads[1].reason?.status===404){
      S.generation=null;S.source=null;S.generationUnavailable=true;
      if(generationUnavailable)S.generationError=error;
      S.metadataState='error';S.metadataKey=key;
    }
    S.evidenceError=S.generationError||error;
    S.evidenceState=S.evidenceError?'error':'ready';
    evidenceTask=null;refreshEvidence();refreshGuidance();
  })().catch(error=>{
    if(controller.signal.aborted||evidenceTask!==task||!currentContext(id,sequence))return;
    evidenceTask=null;S.evidenceState='error';S.evidenceError=error.message||'Não foi possível conferir os documentos fiscais.';refreshEvidence();
  });
  return task.promise;
}
async function openAnalysis(id) {
  if(!uuid(id))throw new Error('A identificação da análise é inválida. Abra a empresa pela carteira.');
  const sequence=++S.sequence;
  cancelEvidence();cancelMetadata();
  releaseWizard();
  $('#analyses-app').innerHTML='<div class="initial">Abrindo o trabalho salvo desta empresa…</div>';
  const response=await analysisRequest(apiPath('/'+encodeURIComponent(id)+'?summary=1'));
  if(sequence!==S.sequence)return;
  S.analysis=null;adoptAnalysis(response.analysis);S.generateRequest=null;
  S.difalEnabledMemory.analysis=null;
  S.paste={text:'',preview:null,error:'',replaceConfirmed:false,open:false,pending:false};S.detailOpen={};
  S.modalSteps={};S.modalReturn=null;
  S.generation=null;S.source=null;S.generationError='';S.reference=null;S.documentStatus=null;S.pdfStatus='';
  S.evidenceState='idle';S.evidenceError='';S.evidenceKey=null;
  S.metadataState='idle';S.metadataKey=null;S.generationUnavailable=false;
  const query=new URLSearchParams(location.search),sector=query.get('sector');
  S.fiscalDifalChoice=query.get('created')==='1'?null:undefined;
  S.sector=['fiscal','accounting'].includes(sector)?sector:null;S.versionsOpen=query.get('view')==='versions';S.versionsData=null;
  S.modalKind=query.get('view')==='settings'?'config':S.sector;
  S.modalOpen=!!S.modalKind;
  if(S.modalKind){const step=normalizeWizardStep(S.modalKind,query.get('step'));if(step)S.modalSteps[S.modalKind]=step;}
  clearError();renderDetail();
  if(query.get('resumed')==='1')feedback('Esta empresa já tinha uma análise. Retomamos o trabalho e preservamos os regimes e dados já salvos.','info');
  if(S.versionsOpen){await loadVersions(1);$('#analysis-versions')?.scrollIntoView({block:'start',behavior:'instant'});}
  else if(query.get('view')==='review')$('#analysis-generation')?.scrollIntoView({block:'start',behavior:'instant'});
}

function schedule() {
  const period=S.analysis&&analysisPeriodFor(S.analysis,S.source,S.generation);
  if(!S.reference||!period?.sourceYear)return null;
  const months=period.availableMonths||period.includedMonths||[],key=months.join(',');
  if(!months.length)return null;
  if(scheduleCache.reference===S.reference&&scheduleCache.months===key)return scheduleCache.value;
  let value=null;try{value=buildRbt12Schedule(S.reference,months);}catch{}
  scheduleCache={reference:S.reference,months:key,value};return value;
}
function detailOptions() {
  return {analysis:S.analysis,sector:S.sector,modalKind:S.modalKind,configDraft:S.configDraft,
    fiscalDraft:S.fiscalDraft,fiscalDifalChoice:S.fiscalDifalChoice,accountingDraft:S.accountingDraft,source:S.source,generation:S.generation,
    evidenceState:S.evidenceState,evidenceError:S.evidenceError,
    metadataState:S.metadataState,generationUnavailable:S.generationUnavailable,
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
  document.querySelectorAll('[data-analysis-sector-card]').forEach(card=>{
    card.classList.toggle('is-complete',guidance.sectors[card.dataset.analysisSectorCard]?.complete===true);
  });
  const issuesOpen=$('#analysis-pending-issues')?.open;
  if($('#analysis-generation'))$('#analysis-generation').outerHTML=renderAnalysisGeneration(options);
  if(issuesOpen!==undefined&&$('#analysis-pending-issues'))$('#analysis-pending-issues').open=issuesOpen;
  if($('#analysis-generate'))$('#analysis-generate').onclick=()=>void generate();
  document.querySelectorAll('#analysis-fiscal-form button[value="complete"],#analysis-accounting-form button[value="complete"]').forEach(button=>button.disabled=S.configDirty||S.busy||!writable());
  bindAnalysisActions();
  refreshDraftStatus();
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
        setWizardStep('values');
        $('#analysis-accounting-paste-panel').open=true;focusSection('#analysis-accounting-paste-panel');
      }
      return;
    }
    if(action==='save-fiscal'||action==='save-accounting'){
      const sector=action.slice(5);if(switchSector(sector))await saveSector(sector,false);return;
    }
    if(action==='accounting-months'){
      if(!openWizard('accounting',{step:'values'}))return;
      const missing=expectedAccountingMonths().filter(month=>!S.accountingDraft.months.some(row=>row.sourceMonth===month));
      if(missing.length&&writable())addMonths(missing);
      focusSection('#analysis-add-month');
      return;
    }
    if(action==='reference'){
      if(openWizard('fiscal',{step:'rbt12'}))focusSection('.analysis-extrato');return;
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
  if(S.modalKind==='accounting')ensureAccountingGrid();
  if(accountingSummaryFrame){cancelAnimationFrame(accountingSummaryFrame);accountingSummaryFrame=0;}
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
  bindDeleteAnalysis();
  if($('#analysis-fiscal-form'))bindFiscal();
  if($('#analysis-accounting-form'))bindAccounting();
  bindWizard();
  if($('#analysis-accounting-tools')&&(S.paste.pending||!S.accountingDraft.months.length))$('#analysis-accounting-tools').open=true;
  if(S.busy)setBusy(true);
  if(S.modalOpen&&S.modalKind==='fiscal')void ensureEvidence();
  if(S.modalOpen&&S.modalKind==='accounting')ensureAccountingMetadata();
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
  result.difalPolicy=captureDifalPolicy('analysis',result.difalPolicy);
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
  if($('#analysis-fiscal-form')){
    const config={...S.configDraft,year:Number($('#analysis-fiscal-year').value),regimeSelection:selectionFrom($('#analysis-fiscal-form'))};
    S.configDirty=config.year!==S.analysis.config.year||JSON.stringify(config.regimeSelection)!==JSON.stringify(S.analysis.config.regimeSelection);
    S.configDraft=config;
  }
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
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/config?summary=1'),{method:'PATCH',body:{expectedConfigRevision:S.analysis.config.revision,year:config.year,regimeSelection:config.regimeSelection}});
    S.configDirty=false;adoptAnalysis(response.analysis,{preserveDrafts:true});S.generateRequest=null;
    S.modalOpen=false;
    feedback('Escolhas salvas. Confira os setores antes de gerar a próxima versão.');
  } catch(error){showError(error);}
  finally{if(S.busy){setBusy(false);renderDetail();if(!S.modalOpen)wizardReturnTarget()?.focus();}}
}

async function patchSector(sector,data,complete) {
  const response=await analysisRequest(apiPath('/'+S.analysis.id+'/'+sector+'?summary=1'),{method:'PATCH',body:{
    expectedSectorRevision:S.analysis[sector].revision,expectedConfigRevision:S.analysis.config.revision,complete,data}});
  S[sector+'Dirty']=false;adoptAnalysis(response.analysis,{preserveDrafts:true});S.generateRequest=null;
  return S.analysis;
}
async function saveSector(sector,complete) {
  if(S.busy||!writable())return;
  try {
    clearError();
    if(complete&&sector==='accounting'&&S.paste.pending){
      focusSection('#analysis-accounting-paste-panel');
      throw new Error('Confira e aplique a colagem ou use Limpar colagem antes de concluir o Contábil.');
    }
    captureConfig();const data=sector==='fiscal'?captureFiscal():captureAccounting();
    if(S.configDirty)throw new Error('Na etapa Regimes, clique em Continuar para salvar as escolhas antes de salvar o setor.');
    if(complete&&sector==='fiscal')validateDifalChoice('analysis',S.analysis.config.regimeSelection,data.difalPolicy,{required:S.fiscalDifalChoice===null});
    if(complete&&sector==='accounting'){
      const months=scopedAccountingMonths(S.analysis,data.months,S.source,S.generation).filter(row=>ACCOUNTING_FIELDS.some(([key])=>row[key]!==null));
      if(!months.length){focusSection(usesFixedAnalysisPeriod(S.analysis)?'#analysis-new-source-year':'#analysis-new-month');throw new Error(usesFixedAnalysisPeriod(S.analysis)?'Preencha pelo menos um mês de janeiro a setembro. Meses totalmente em branco ficam fora do relatório.':'Adicione pelo menos uma competência com os dados contábeis.');}
      for(const row of months){const missing=ACCOUNTING_FIELDS.find(([key])=>row[key]===null);if(missing){
        const field=document.querySelector(`[data-accounting-month="${row.sourceMonth}"] [data-accounting-field="${missing[0]}"]`);
        revealWizardField(field);field?.focus();
        throw new Error(`Informe ${missing[1]} em ${monthLabel(row.sourceMonth)}. Use zero somente quando não houver essa despesa.`);
      }}
    }
    setBusy(true,`${complete?'Concluindo':'Salvando'} o trabalho ${sectorName(sector)}…`);
    await patchSector(sector,data,complete);
    if(complete){S.modalOpen=false;if(sector==='accounting')collapseAccountingTools();}
    feedback(complete?`${sectorName(sector)} concluído. ${hasLocalWork()?'Há preenchimentos locais que ainda precisam ser conferidos e salvos.':S.analysis.readiness.ready?'Os dois setores estão prontos para gerar a análise.':'Acompanhe abaixo o que ainda falta para gerar.'}`:`Trabalho ${sectorName(sector)} salvo. Você pode continuar depois nesta mesma análise.`);
  } catch(error){
    if(sector==='fiscal'&&String(error.code||'').startsWith('RBT12_'))S.modalSteps.fiscal='rbt12';
    if(sector==='fiscal'&&['ANALYSIS_FISCAL_INCOMPLETE','SIMULATOR_INCOMPLETE','ANALYSIS_GENERATION_UNAVAILABLE'].includes(error.code))S.modalSteps.fiscal='documents';
    if(sector==='accounting'&&error.code==='ACCOUNTING_MONTHS_MISMATCH'){
      S.modalSteps.accounting='values';S.detailOpen['analysis-accounting-tools']=true;
      if($('#analysis-accounting-tools'))$('#analysis-accounting-tools').open=true;
    }
    showError(error);
  }
  finally{if(S.busy){setBusy(false);renderDetail();if(!S.modalOpen)wizardReturnTarget()?.focus();}}
}

function editFiscalAdjustments() {
  try{
    if(!S.source?.monthlyReports?.length)throw new Error('Confira os documentos fiscais antes de editar os valores por competência.');
    captureAll();S.fiscalDraft.monthlyOverrides=S.source.monthlyReports.map(row=>({sourceMonth:row.sourceMonth,
      groups:Object.fromEntries(ADJUSTMENT_FIELDS.map(([key])=>[key,row.fields[key]/100])),serviceRevenue:row.fields.serviceRevenueCents/100}));
    markDirty('fiscal');renderDetail();$('#analysis-fiscal-adjustments').open=true;
  }catch(error){showError(error);}
}
function bindFiscal() {
  refreshDifalControls('analysis',S.fiscalDraft.difalPolicy,S.analysis.config.regimeSelection,S.fiscalDifalChoice===undefined?difalChoice(S.fiscalDraft.difalPolicy,S.analysis.config.regimeSelection):S.fiscalDifalChoice);
  $('#analysis-fiscal-form').oninput=event=>{
    if(event.target.name==='regime'||event.target.id==='analysis-fiscal-year'){markDirty('config');return;}
    if(event.target.matches('[data-difal-choice],[data-analysis-difal-enabled],[data-analysis-difal-operation]'))changeDifal('analysis',event.target);
    markDirty('fiscal');
    if(event.target.id==='analysis-rbt12'&&$('#analysis-rbt12-confirm'))$('#analysis-rbt12-confirm').checked=false;
  };
  $('#analysis-fiscal-form').onsubmit=event=>{event.preventDefault();void saveSector('fiscal',event.submitter?.value==='complete');};
  bindFiscalDocumentActions();
  for(const [id,mode] of [['analysis-extrato-pdf','SIMPLES_SECTION_22'],['analysis-extrato-manual','MANUAL']])if($('#'+id))$('#'+id).onclick=()=>{
    try{captureAll();S.fiscalDraft.rbt12Source=mode;S.fiscalDraft.rbt12=null;S.fiscalDraft.rbt12ExtractionId=null;S.fiscalDraft.rbt12ManualConfirmed=false;if(mode==='MANUAL')S.fiscalDraft.rbt12DocumentId=null;S.reference=null;markDirty('fiscal');renderDetail();$('#analysis-rbt12')?.focus();}catch(error){showError(error);}
  };
  if($('#analysis-rbt12-pdf'))$('#analysis-rbt12-pdf').onchange=event=>{const file=event.target.files?.[0];if(file)void readPdf(file);};
  if($('#analysis-read-selected-pdf'))$('#analysis-read-selected-pdf').onclick=()=>{const file=$('#analysis-rbt12-pdf').files?.[0];if(file)void readPdf(file);else showError(new Error('Selecione o extrato em PDF antes de iniciar a leitura.'));};
  if($('#analysis-extrato-status'))$('#analysis-extrato-status').onclick=()=>void checkPdf();
  if($('#analysis-extrato-retry'))$('#analysis-extrato-retry').onclick=()=>void retryPdf();
  if($('#analysis-edit-adjustments'))$('#analysis-edit-adjustments').onclick=editFiscalAdjustments;
  if($('#analysis-retry-evidence'))$('#analysis-retry-evidence').onclick=()=>void ensureEvidence({force:true});
  if($('#analysis-replace-missing-documents'))$('#analysis-replace-missing-documents').onclick=()=>void prepareImport();
  if($('#analysis-clear-adjustments'))$('#analysis-clear-adjustments').onclick=()=>{
    if(!confirm('Usar os valores dos relatórios em todas as competências? Os ajustes ainda não salvos nesta análise serão retirados. As versões anteriores permanecerão no histórico.'))return;
    try{captureAll();S.fiscalDraft.monthlyOverrides=null;markDirty('fiscal');renderDetail();$('#analysis-fiscal-adjustments').open=true;}catch(error){showError(error);}
  };
}

function bindFiscalDocumentActions() {
  const start=$('#analysis-start-import');if(start){start.onclick=()=>void prepareImport();start.disabled=S.busy||S.pdfBusy;}
  document.querySelectorAll('[data-analysis-add-document]').forEach(button=>{
    button.disabled=S.busy||S.pdfBusy;
    button.onclick=()=>void prepareImport({type:button.dataset.analysisAddDocument,reuse:true});
  });
}
function documentImportUrl(generationId,type,company=null) {
  const job=type==='SALES'?company?.sales:company?.purchase;
  const jobId=(type==='SALES'?company?.salesJobId:company?.purchaseJobId)||job?._id;
  return '/purchases.html?'+new URLSearchParams({generation:generationId,client:S.analysis.clientId,guided:'1',analysis:S.analysis.id,type,...(jobId?{job:jobId}:{})});
}
async function prepareImport({type='PURCHASES',reuse=false}={}) {
  if(S.busy||S.pdfBusy||S.deleting||!writable())return;
  try {
    clearError();captureAll();
    validateDifalChoice('analysis',S.analysis.config.regimeSelection,S.fiscalDraft.difalPolicy);
    if(S.paste.pending)throw new Error('Há uma colagem do Contábil ainda não aplicada. Confira e aplique os dados ou use Limpar colagem antes de abrir a importação fiscal.');
    if(S.accountingDirty)throw new Error('Salve o trabalho Contábil antes de abrir a importação fiscal. As despesas ainda não salvas continuam nesta tela.');
    if(S.configDirty)throw new Error('Salve as escolhas da análise antes de preparar os documentos fiscais.');
    if(!['PURCHASES','SALES'].includes(type))throw new Error('Escolha o documento de entradas ou de saídas.');
    setBusy(true,'Preparando o envio do documento desta empresa…');
    // A card action resumes the current import. Only a confirmed missing source
    // may fall through to explicit replacement; network failures never create one.
    if(reuse&&S.analysis.fiscal.data.generationId){
      let generation;
      try{generation=await generationMetadata(S.analysis,{force:true});}
      catch(error){if(error.status!==404)throw error;}
      if(generation){
        const company=generation.companies.find(item=>item.clientId===S.analysis.clientId);
        if(S.fiscalDirty)await patchSector('fiscal',S.fiscalDraft,false);
        if(S.analysis.fiscal.data.generationId!==generation._id)throw new Error('Os documentos da análise mudaram. Atualize antes de continuar.');
        setBusy(false);location.href=documentImportUrl(generation._id,type,company);return;
      }
    }
    if(S.analysis.fiscal.data.generationId&&!confirm('Preparar novos relatórios de entradas e saídas? A análise passará a aguardar os novos arquivos; as versões e os relatórios anteriores continuarão preservados.'))return;
    if(S.fiscalDirty)await patchSector('fiscal',S.fiscalDraft,false);
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/fiscal/import?summary=1'),{method:'POST',body:{expectedSectorRevision:S.analysis.fiscal.revision,expectedConfigRevision:S.analysis.config.revision}});
    adoptAnalysis(response.analysis);
    if(!uuid(response.generationId)||S.analysis.fiscal.data.generationId!==response.generationId)throw new Error('Não foi possível confirmar os relatórios preparados. Atualize a análise antes de continuar.');
    setBusy(false);location.href=documentImportUrl(response.generationId,type);
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
    pdfProgress('Seção 2.2 lida. Salvando a referência RBT12 no Fiscal…');
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

function ensureAccountingGrid() {
  if(!usesFixedAnalysisPeriod(S.analysis)||!S.accountingDraft)return;
  const months=S.accountingDraft.months,period=analysisPeriodFor(S.analysis,S.source,S.generation);
  const entered=months.filter(row=>ACCOUNTING_FIELDS.some(([key])=>row[key]!==null));
  const year=period?.sourceYear||Number(entered[0]?.sourceMonth.slice(0,4)||months[0]?.sourceMonth.slice(0,4))||Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date()));
  // Empty placeholders from a provisional year can follow the fiscal source.
  S.accountingDraft.months=months.filter(row=>Number(row.sourceMonth.slice(0,4))===year||ACCOUNTING_FIELDS.some(([key])=>row[key]!==null));
  for(const sourceMonth of analysisMonthsForYear(year))if(!S.accountingDraft.months.some(row=>row.sourceMonth===sourceMonth))S.accountingDraft.months.push(blankMonth(sourceMonth));
  S.accountingDraft.months.sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));
}
function blankMonth(sourceMonth){return {sourceMonth,...Object.fromEntries(ACCOUNTING_FIELDS.map(([key])=>[key,null]))};}
function expectedAccountingMonths() {
  const expected=accountingSourceMonths(S.analysis,S.source,S.generation,S.accountingDraft.months);
  if(expected.length||!usesFixedAnalysisPeriod(S.analysis))return expected;
  const years=[...new Set(S.accountingDraft.months.filter(row=>isAnalysisMonth(row.sourceMonth)).map(row=>Number(row.sourceMonth.slice(0,4))))];
  return years.length===1?analysisMonthsForYear(years[0]):[];
}
function displayedAccountingMonths() {
  return scopedAccountingMonths(S.analysis,S.accountingDraft.months,S.source,S.generation).map(row=>{
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
  if(!$('#analysis-accounting-summary-panel')?.open)return;
  const open=$('#analysis-accounting-breakdown')?.open??S.detailOpen['analysis-accounting-breakdown'];
  host.innerHTML=renderAccountingSummary({months:displayedAccountingMonths(),expectedMonths:expectedAccountingMonths()});
  if($('#analysis-accounting-breakdown'))$('#analysis-accounting-breakdown').open=!!open;
}
function scheduleAccountingSummary() {
  if(accountingSummaryFrame||!$('#analysis-accounting-summary-panel')?.open)return;
  accountingSummaryFrame=requestAnimationFrame(()=>{accountingSummaryFrame=0;refreshAccountingSummary();});
}
function invalidatePastePreview(message='') {
  if(!S.paste.preview)return;
  S.paste.preview=null;S.paste.replaceConfirmed=false;S.paste.error=message;
  renderPaste();
}
function validateAccountingPasteMonths(months) {
  if(!usesFixedAnalysisPeriod(S.analysis))return;
  const period=analysisPeriodFor(S.analysis,S.source,S.generation),years=[...new Set(months.map(row=>Number(row.sourceMonth.slice(0,4))))];
  if(years.length!==1||period&&years[0]!==period.sourceYear)throw new Error('Cole as despesas do mesmo ano dos documentos da análise. Outubro a dezembro podem estar na planilha, mas ficam fora do resultado.');
  if(S.accountingDraft.months.some(row=>Number(row.sourceMonth.slice(0,4))!==years[0]))throw new Error('Use Preparar janeiro a setembro para escolher o ano desta colagem antes de aplicá-la.');
}
function renderPaste() {
  const host=$('#analysis-accounting-import');if(!host)return;
  S.paste.open=$('#analysis-accounting-paste-panel')?.open??S.paste.open;
  host.innerHTML=renderAccountingPaste({...S.paste,sourceMonths:expectedAccountingMonths(),fixedPeriod:usesFixedAnalysisPeriod(S.analysis),canWrite:writable()&&!S.busy});
  $('#analysis-accounting-paste-panel').ontoggle=()=>{S.paste.open=$('#analysis-accounting-paste-panel').open;};
  $('#analysis-accounting-paste').oninput=event=>{
    const wasPending=S.paste.pending;
    S.paste.text=event.target.value;S.paste.preview=null;S.paste.error='';S.paste.replaceConfirmed=false;
    S.paste.pending=S.paste.text.trim()!=='';
    // Keep the textarea and selection in place while discarding the obsolete preview.
    $('#analysis-accounting-paste-preview').replaceChildren();$('#analysis-accounting-paste-preview').hidden=true;
    $('#analysis-accounting-paste-error').textContent='';$('#analysis-accounting-paste-error').hidden=true;
    $('#analysis-clear-accounting-paste').disabled=!S.paste.text;
    if(wasPending!==S.paste.pending)refreshGuidance();else refreshDraftStatus();
  };
  $('#analysis-preview-accounting-paste').onclick=()=>{
    if(S.busy||!writable())return;
    S.paste.pending=S.paste.text.trim()!=='';
    try {
      clearError();captureAll();
      const parsed=parseAccountingPaste(S.paste.text);
      validateAccountingPasteMonths(parsed.months);
      const plan=planAccountingPaste(S.accountingDraft.months,parsed.months);
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
      validateAccountingPasteMonths(preview.parsed.months);
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
      collapseAccountingTools();
      feedback(`${count} competência(s) aplicada(s). Confira os valores e use Salvar rascunho ou Salvar e concluir.`,'info');
      const first=scopedAccountingMonths(S.analysis,preview.parsed.months,S.source,S.generation)[0];
      if(first)focusSection(`[data-accounting-month="${first.sourceMonth}"] [data-accounting-field]`);
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
    try{
      clearError();
      const year=analysisPeriodFor(S.analysis,S.source,S.generation)?.sourceYear||Number($('#analysis-new-source-year')?.value)||new Date().getFullYear();
      const template=usesFixedAnalysisPeriod(S.analysis)?ACCOUNTING_IMPORT_CSV_TEMPLATE.split('\n')[0]+'\n'+analysisMonthsForYear(year).map(month=>`${month.slice(5)}/${year};;;;;`).join('\n')+'\n':ACCOUNTING_IMPORT_CSV_TEMPLATE;
      const url=URL.createObjectURL(new Blob(['\uFEFF'+template],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='modelo-despesas-contabeis.csv';document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){showError(error);$('#analysis-new-source-year')?.focus();}
  };
}
function collapseAccountingTools() {
  const panel=$('#analysis-accounting-tools');if(panel)panel.open=false;
  S.detailOpen['analysis-accounting-tools']=false;
}
function addMonths(months) {
  captureAll();
  if(usesFixedAnalysisPeriod(S.analysis)){
    const years=[...new Set(months.map(month=>Number(month.slice(0,4))))],period=analysisPeriodFor(S.analysis,S.source,S.generation);
    if(years.length!==1||months.some(month=>!isAnalysisMonth(month,period?.sourceYear)))throw new Error('A análise usa janeiro a setembro do ano dos documentos.');
    const outsideYear=S.accountingDraft.months.filter(row=>Number(row.sourceMonth.slice(0,4))!==years[0]);
    if(outsideYear.length){
      if(!confirm(`Preparar janeiro a setembro de ${years[0]}? As ${outsideYear.length} competências do outro ano sairão deste rascunho. As versões já geradas permanecem preservadas.`))return;
      S.accountingDraft.months=S.accountingDraft.months.filter(row=>Number(row.sourceMonth.slice(0,4))===years[0]);
    }
  }
  const current=new Set(S.accountingDraft.months.map(row=>row.sourceMonth));
  for(const month of months){
    if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month))throw new Error('Informe uma competência válida, com mês e ano entre 2000 e 2099.');
    current.add(month);
  }
  if(current.size>12)throw new Error('A análise aceita até 12 competências. Confira os meses antes de continuar.');
  for(const month of months)if(!S.accountingDraft.months.some(row=>row.sourceMonth===month))S.accountingDraft.months.push(blankMonth(month));
  S.accountingDraft.months.sort((a,b)=>a.sourceMonth.localeCompare(b.sourceMonth));markDirty('accounting');renderDetail();
  collapseAccountingTools();
  if(months.length)focusSection(`[data-accounting-month="${months[0]}"] [data-accounting-field]`);
}
function refreshMonthTotal(host) {
  try {
    const values=ACCOUNTING_FIELDS.map(([key])=>{
      const field=host.querySelector(`[data-accounting-field="${key}"]`),raw=field.value.trim();
      if(!field.validity.valid||!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
      const [whole,fraction='']=raw.split('.'),value=Number(whole)*100+Number(fraction.padEnd(2,'0'));
      return Number.isSafeInteger(value)&&value<=100000000000000?value:null;
    });
    $('[data-accounting-total]',host).textContent=values.every(value=>value===null)?'Não incluído · sem valores':values.some(value=>value===null)?'Preenchimento incompleto':money(values.reduce((sum,value)=>sum+value,0)/100);
  } catch { $('[data-accounting-total]',host).textContent='Preenchimento incompleto'; }
}
function bindAccounting() {
  renderPaste();
  bindAccountingSourceActions();
  $('#analysis-accounting-summary-panel').ontoggle=()=>scheduleAccountingSummary();
  $('#analysis-accounting-form').oninput=event=>{
    if(!event.target.matches('[data-accounting-field]'))return;
    markDirty('accounting');const host=event.target.closest('[data-accounting-month]');if(host)refreshMonthTotal(host);scheduleAccountingSummary();
  };
  $('#analysis-accounting-form').onsubmit=event=>{event.preventDefault();void saveSector('accounting',event.submitter?.value==='complete');};
  if($('#analysis-add-month'))$('#analysis-add-month').onclick=()=>{
    try{
      clearError();
      if(usesFixedAnalysisPeriod(S.analysis)){addMonths(analysisMonthsForYear(Number($('#analysis-new-source-year').value)));return;}
      const month=$('#analysis-new-month').value;
      if(S.accountingDraft.months.some(row=>row.sourceMonth===month))throw new Error('Esta competência já está no formulário. Preencha os valores no mês correspondente.');
      addMonths([month]);
    }catch(error){showError(error);}
  };
  if($('#analysis-zero-empty'))$('#analysis-zero-empty').onclick=()=>{
    try {
      captureAll();
      const visible=new Set(displayedAccountingMonths().map(row=>row.sourceMonth));
      const fields=ACCOUNTING_FIELDS.map(([key])=>key);
      let missing=0;
      for(const row of S.accountingDraft.months)if(visible.has(row.sourceMonth))for(const key of fields)if(row[key]===null)missing++;
      if(!missing)return feedback('Não há campos vazios nas competências deste período.','info');
      if(!confirm(`Preencher ${missing} campo(s) vazio(s) com R$ 0,00? Confirme somente se realmente não houve despesa nessas categorias e meses. Os valores informados serão preservados. Você ainda precisará salvar.`))return;
      for(const row of S.accountingDraft.months)if(visible.has(row.sourceMonth))for(const key of fields)if(row[key]===null)row[key]=0;
      markDirty('accounting');renderDetail();
      feedback(`${missing} campo(s) preenchido(s) com zero. Confira os valores e salve o Contábil.`,'info');
    } catch(error){showError(error);}
  };
  document.querySelectorAll('[data-zero-month]').forEach(button=>button.onclick=()=>{
    try{captureAll();const row=S.accountingDraft.months.find(item=>item.sourceMonth===button.dataset.zeroMonth);for(const [key] of ACCOUNTING_FIELDS)if(row[key]===null)row[key]=0;markDirty('accounting');renderDetail();}catch(error){showError(error);}
  });
  document.querySelectorAll('[data-remove-month]').forEach(button=>button.onclick=()=>{
    if(!confirm(`Limpar os valores de ${monthLabel(button.dataset.removeMonth)} e retirar este mês do cálculo? As versões já geradas continuarão preservadas.`))return;
    try{captureAll();S.accountingDraft.months=S.accountingDraft.months.map(row=>row.sourceMonth===button.dataset.removeMonth?blankMonth(row.sourceMonth):row);markDirty('accounting');renderDetail();}catch(error){showError(error);}
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
    const response=await analysisRequest(apiPath('/'+S.analysis.id+'/generate?summary=1'),{method:'POST',body:S.generateRequest});
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
    else if(!writable()||query.get('view')==='list'||query.has('search')||query.has('page')||query.has('deleted'))await openList();
    else await openNew();
  } catch(error){
    showError(error);
    if($('#analyses-app .initial'))$('#analyses-app').innerHTML=error?.status===404?
      '<section class="analysis-empty"><h2>Análise não encontrada</h2><p>Este trabalho pode ter sido excluído. Abra a carteira para consultar as análises disponíveis ou iniciar uma nova.</p><a class="analysis-button primary" href="/analyses.html">Ver análises</a></section>':
      '<section class="analysis-empty"><h2>Não foi possível abrir as análises</h2><p>Confira sua sessão e tente novamente.</p><a class="analysis-button" href="/analyses.html">Tentar novamente</a><a href="/">Acessar painel</a></section>';
  }
}
window.addEventListener('beforeunload',event=>{if(hasLocalWork()||S.busy||S.pdfBusy||S.deleting){event.preventDefault();event.returnValue='';}});
boot();
