const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const drawings = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  companies:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M10 21v-3h4v3"/>',
  start:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8m-4-4h8"/>',
  history:'<path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7m2-5v6l4 2"/>',
  simulations:'<path d="M4 20h16M7 16v-5m5 5V5m5 11V8"/>',
  account:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  logout:'<path d="M9 4H4v16h5m6-12 4 4-4 4m-7-4h11"/>'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${drawings[name] || drawings.start}</svg>`;
if (!document.querySelector('link[href="/navigation.css"]')) { const link = document.createElement('link'); link.rel='stylesheet'; link.href='/navigation.css'; document.head.append(link); }
export function navigationMarkup(user, active = 'overview', internal = false) {
  const entry = (key, label, image, href) => `<a href="${href}" title="${label}" ${internal && ['overview','clients'].includes(key) ? `data-nav="${key}"` : ''} data-navigation="${key}" ${active===key?'aria-current="page"':''}>${icon(image)}<span class="nav-label">${label}</span></a>`;
  return `<a href="/" class="brand maximum-brand" aria-label="Maximum CNPJ início"><img class="maximum-logo" src="/img/logo-maximum-white.png" width="512" height="107" alt="Maximum Assessoria Contábil"><span class="maximum-symbol" aria-hidden="true"><img src="/img/maximum-symbol.png" width="78" height="65" alt=""></span><small class="maximum-product">CNPJ · INTELIGÊNCIA</small></a><div class="nav-title">Navegação</div><nav class="nav" aria-label="Navegação principal">${entry('overview','Início','home','/#overview')}${entry('clients','Empresas','companies','/#clients')}<hr class="nav-divider"><div class="nav-title">Geração</div>${entry('start','Iniciar','start','/generations.html')}${entry('history','Histórico','history','/generations.html?view=history')}${entry('simulations','Simulações','simulations','/simulations.html')}</nav><div class="side-bottom"><div class="navigation-note"><strong>Uma visão completa.</strong><span>Empresas, relatórios e cálculos no mesmo lugar.</span></div><a class="navigation-account" href="/#settings" title="Conta e configurações">${icon('account')}<span class="nav-label">Conta e configurações</span></a><div class="side-user"><div class="avatar">${escape((user?.name || user?.email || 'M').slice(0,1))}</div><div class="navigation-user"><strong>${escape(user?.name || 'Equipe Maximum')}</strong><small>${user?.role==='admin'?'Administrador':user?.role==='operator'?'Colaborador':'Consulta'}</small></div><button id="logout" title="Sair" aria-label="Sair da conta">${icon('logout')}</button></div></div>`;
}
export function markNavigation(active) {
  document.querySelectorAll('[data-navigation]').forEach(a => { if(a.dataset.navigation===active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current'); });
}
export function bindNavigation(onLogout) {
  const toggle = document.querySelector('#toggle-nav');
  if(toggle) toggle.onclick=()=>{const mobile=innerWidth<=850;document.body.classList.toggle(mobile?'mobile-open':'collapsed');toggle.setAttribute('aria-expanded',String(document.body.classList.contains(mobile?'mobile-open':'collapsed')));};
  const logout=document.querySelector('#logout');
  if(logout) logout.onclick=onLogout || (async()=>{logout.disabled=true;try{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});if(!r.ok)throw new Error('Não foi possível sair. Tente novamente.');location.href='/';}catch(e){logout.disabled=false;const t=document.querySelector('#toast');if(t)t.textContent=e.message;}});
  let overlay=document.querySelector('.navigation-overlay');
  if(!overlay){overlay=document.createElement('button');overlay.className='navigation-overlay';overlay.setAttribute('aria-label','Fechar navegação');overlay.onclick=()=>document.body.classList.remove('mobile-open');document.body.append(overlay);}
}
export function mountNavigation(user,active){const side=document.querySelector('.sidebar');if(side)side.innerHTML=navigationMarkup(user,active);bindNavigation();}
