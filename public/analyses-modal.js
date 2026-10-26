const $=(selector,root=document)=>root.querySelector(selector);

// Notices keep their identity and handlers when the native dialog changes the focus layer.
export function restoreAnalysisNotices() {
  const home=$('#analysis-notices');if(!home)return;
  for(const id of ['analysis-error','analysis-feedback']){const node=document.getElementById(id);if(node)home.append(node);}
}

/** DOM-only shell. Navigation, validation and persistence remain in the analysis controller. */
export function createAnalysisModal({dialog,onNext,onBack,onPrevious,onClose,isBusy,returnFocus}) {
  let disposed=false,pendingProgrammaticCloses=0,progressKey='';
  const notices=()=>{
    const host=$('#analysis-wizard-notices',dialog);if(!host)return;
    for(const id of ['analysis-error','analysis-feedback']){const node=document.getElementById(id);if(node)host.append(node);}
  };
  const restoreFocus=()=>{
    const target=returnFocus?.();
    if(target?.isConnected&&!target.closest('dialog')&&!target.disabled)target.focus({preventScroll:true});
  };
  const requestClose=()=>{if(!disposed&&!isBusy())onClose();};
  dialog.oncancel=event=>{event.preventDefault();requestClose();};
  dialog.onclose=()=>{
    if(pendingProgrammaticCloses){pendingProgrammaticCloses--;return;}
    if(!disposed&&!dialog.open)requestClose();
  };
  dialog.onclick=event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)requestClose();
  };
  dialog.onkeydown=event=>{
    if(event.key!=='Tab'||event.defaultPrevented||!dialog.open)return;
    const fields=[...dialog.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
      .filter(field=>field.tabIndex>=0&&!field.matches(':disabled')&&field.getClientRects().length&&getComputedStyle(field).visibility==='visible');
    const first=fields[0],last=fields.at(-1),active=document.activeElement;
    if(!first){event.preventDefault();$('#analysis-wizard-title',dialog)?.focus();return;}
    if(event.shiftKey&&active===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
  };
  $('#analysis-wizard-close',dialog).onclick=requestClose;
  dialog.querySelectorAll('[data-wizard-dismiss]').forEach(button=>button.onclick=requestClose);
  $('#analysis-wizard-next',dialog).onclick=()=>{if(!isBusy())onNext();};
  $('#analysis-wizard-back',dialog).onclick=()=>{if(!isBusy())onBack();};

  function focusStep() {
    const panel=[...dialog.querySelectorAll('[data-wizard-step]')].find(node=>!node.hidden);
    const heading=panel?.querySelector('[data-wizard-heading],h2,h3')||$('#analysis-wizard-title',dialog);
    const body=$('.analysis-wizard-body',dialog);if(body)body.scrollTop=0;
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
  function sync(state,{focus=false,busy=isBusy()}={}) {
    if(disposed)return;
    dialog.dataset.wizardStep=state.id;dialog.setAttribute('aria-busy',String(busy));
    dialog.querySelectorAll('[data-wizard-step]').forEach(panel=>panel.hidden=panel.dataset.wizardStep!==state.id);
    const progress=$('#analysis-wizard-progress',dialog);progress.hidden=state.total===1;
    const key=JSON.stringify([state.id,state.steps]);
    if(key!==progressKey){
      progressKey=key;progress.replaceChildren();
      const count=document.createElement('p');count.className='analysis-wizard-counter';count.setAttribute('role','status');count.setAttribute('aria-live','polite');count.textContent=`Etapa ${state.number} de ${state.total}`;progress.append(count);
      const list=document.createElement('ol');list.className='analysis-wizard-steps';list.setAttribute('aria-label','Etapas do preenchimento');
      state.steps.forEach((step,index)=>{
        const item=document.createElement('li');item.className=index===state.index?'is-current':index<state.index?'is-past':'';
        const button=document.createElement('button');button.type='button';button.dataset.wizardGo=step.id;button.disabled=busy||index>state.index;
        if(index===state.index)button.setAttribute('aria-current','step');
        const number=document.createElement('span');number.className='analysis-wizard-number';number.setAttribute('aria-hidden','true');number.textContent=String(index+1);
        const label=document.createElement('strong');label.textContent=step.label;button.append(number,label);item.append(button);list.append(item);
        button.onclick=()=>{if(!isBusy()&&index<state.index)onPrevious(step.id);};
      });progress.append(list);
    }else progress.querySelectorAll('[data-wizard-go]').forEach(button=>button.disabled=busy||state.steps.findIndex(step=>step.id===button.dataset.wizardGo)>state.index);
    const back=$('#analysis-wizard-back',dialog),next=$('#analysis-wizard-next',dialog);
    back.hidden=state.isFirst;back.disabled=busy;
    next.hidden=state.isLast;next.disabled=busy;next.textContent='Continuar';
    dialog.querySelectorAll('[data-wizard-final-actions]').forEach(host=>host.hidden=!state.isLast);
    $('#analysis-wizard-close',dialog).disabled=busy;
    dialog.querySelectorAll('[data-wizard-dismiss]').forEach(button=>button.disabled=busy);
    if(focus&&dialog.open)focusStep();
  }
  return {
    sync,
    open(state,{focus=true}={}){
      if(disposed)return;
      notices();sync(state);document.body.classList.add('analysis-modal-open');
      if(!dialog.open)dialog.showModal();
      if(focus)focusStep();
    },
    close({focus=true}={}){
      if(disposed)return;
      if(dialog.open){pendingProgrammaticCloses++;dialog.close();}
      restoreAnalysisNotices();document.body.classList.remove('analysis-modal-open');
      if(focus)restoreFocus();
    },
    dispose(){
      if(disposed)return;
      disposed=true;dialog.onclose=null;if(dialog.open)dialog.close();
      restoreAnalysisNotices();document.body.classList.remove('analysis-modal-open');
    }
  };
}
