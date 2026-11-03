/** Visual feedback only. This module never changes data, choices or request outcomes. */
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function loadingMarkup({title='Carregando…',detail='Aguarde a conclusão desta etapa.',compact=false}={}) {
  return `<section class="max-loading${compact?' is-compact':''}" role="status" aria-live="polite" aria-atomic="true"><span class="max-loading-spinner" aria-hidden="true"></span><div class="max-loading-copy"><strong data-loading-title>${escape(title)}</strong><p data-loading-detail>${escape(detail)}</p><p class="max-loading-slow" data-loading-slow hidden>Ainda em andamento. Aguarde a confirmação antes de fechar esta tela.</p></div><span class="max-loading-track" aria-hidden="true"></span></section>`;
}

/** One foreground operation at a time; background reads keep their own inline states. */
export function createLoadingScreen({id='maximum-busy-screen',home=document.body,target=()=>null}={}) {
  const screen=document.createElement('div');screen.id=id;screen.className='max-busy-screen';screen.hidden=true;
  screen.innerHTML=loadingMarkup();home.append(screen);
  let timer=null,active=false;
  const relocate=()=>{
    const destination=target()||home;
    screen.classList.toggle('is-in-dialog',destination!==home);
    if(screen.parentElement!==destination)destination.append(screen);
  };
  const update=({title,detail}={})=>{
    if(title!==undefined)screen.querySelector('[data-loading-title]').textContent=title;
    if(detail!==undefined)screen.querySelector('[data-loading-detail]').textContent=detail;
  };
  return {
    show(options={}) {
      relocate();update(options);screen.hidden=false;
      if(!active){active=true;screen.querySelector('[data-loading-slow]').hidden=true;
        timer=setTimeout(()=>{if(active)screen.querySelector('[data-loading-slow]').hidden=false;},12000);}
    },
    update,
    relocate,
    park(){home.append(screen);screen.classList.remove('is-in-dialog');},
    hide(){active=false;clearTimeout(timer);timer=null;screen.hidden=true;screen.querySelector('[data-loading-slow]').hidden=true;},
    dispose(){active=false;clearTimeout(timer);screen.remove();}
  };
}
