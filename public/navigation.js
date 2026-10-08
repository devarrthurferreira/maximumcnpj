const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const drawings = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  companies:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M10 21v-3h4v3"/>',
  start:'<rect x="3" y="3" width="18" height="18" rx="6"/><path d="m10 8 6 4-6 4z"/>',
  history:'<path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7m2-5v6l4 2"/>',
  simulations:'<path d="M4 20h16M7 16v-5m5 5V5m5 11V8"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.55 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.55a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.45 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.66.96.3.25.68.4 1.07.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"/>',
  logout:'<path d="M9 4H4v16h5m6-12 4 4-4 4m-7-4h11"/>'
};

export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${drawings[name] || drawings.start}</svg>`;

function ensureStylesheet(href) {
  if (document.querySelector(`link[data-navigation-style="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.navigationStyle = href;
  document.head.append(link);
}
ensureStylesheet('/navigation.css?v=0.18.1-dock');

function tooltip(label) {
  return `<span class="navigation-tooltip" role="tooltip">${escape(label)}</span>`;
}

function brandMark() {
  return `<a href="/#overview" class="navigation-rail-cap" aria-label="Maximum CNPJ · Início" data-tooltip="Maximum CNPJ"><span class="navigation-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${tooltip('Maximum CNPJ')}</a>`;
}

export function navigationMarkup(user, active = 'overview', internal = false) {
  const entry = (key, label, image, href, primary = false) => `<a href="${href}" class="navigation-item${primary ? ' navigation-start' : ''}" aria-label="${escape(label)}" ${internal && ['overview','clients'].includes(key) ? `data-nav="${key}"` : ''} data-navigation="${key}" data-tooltip="${escape(label)}" ${active===key?'aria-current="page"':''}><span class="navigation-icon">${icon(image)}</span>${tooltip(label)}</a>`;
  return `${brandMark()}<div class="navigation-dock"><nav class="nav" aria-label="Navegação principal">${entry('overview','Início','home','/#overview')}${entry('clients','Empresas','companies','/#clients')}${entry('start','Iniciar','start','/generations.html',true)}${entry('history','Histórico','history','/generations.html?view=history')}${entry('simulations','Simulações','simulations','/simulations.html')}</nav></div><div class="side-bottom navigation-utility-dock"><a class="navigation-item navigation-account" href="/#settings" aria-label="Configurações" data-tooltip="Configurações"><span class="navigation-icon">${icon('settings')}</span>${tooltip('Configurações')}</a><button id="logout" class="navigation-item navigation-logout" type="button" aria-label="Sair da conta" data-tooltip="Sair"><span class="navigation-icon">${icon('logout')}</span>${tooltip('Sair')}</button></div><span class="sr-only">Usuário conectado: ${escape(user?.name || user?.email || 'Equipe Maximum')}</span>`;
}

export function markNavigation(active) {
  document.querySelectorAll('[data-navigation]').forEach(link => {
    if (link.dataset.navigation === active) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
}

function isMobileNavigation() {
  return innerWidth <= 850;
}

function navigationVisible() {
  return isMobileNavigation() ? document.body.classList.contains('mobile-open') : !document.body.classList.contains('navigation-hidden');
}

function mountToggleVisual(toggle) {
  if (!toggle || toggle.querySelector('.navigation-toggle-glyph')) return;
  toggle.textContent = '';
  toggle.insertAdjacentHTML('afterbegin', `<span class="navigation-toggle-glyph" aria-hidden="true"><span class="navigation-toggle-panel"></span><span class="navigation-toggle-content"><i></i><i></i><i></i></span><span class="navigation-toggle-chevron"></span></span><span class="navigation-toggle-tooltip" role="tooltip"></span>`);
}

function syncToggle(toggle) {
  if (!toggle) return;
  mountToggleVisual(toggle);
  const mobile = isMobileNavigation();
  const visible = navigationVisible();
  const action = visible ? (mobile ? 'Fechar navegação' : 'Recolher navegação') : 'Abrir navegação';
  toggle.dataset.navigationState = visible ? 'open' : 'closed';
  toggle.dataset.navigationAction = action;
  toggle.setAttribute('aria-expanded', String(visible));
  toggle.setAttribute('aria-controls', 'maximum-navigation');
  toggle.setAttribute('aria-label', 'Alternar navegação');
  toggle.setAttribute('aria-description', action);
  toggle.title = action;
  const tip = toggle.querySelector('.navigation-toggle-tooltip');
  if (tip) tip.textContent = action;
}

function closeMobileNavigation(toggle, restoreFocus = false) {
  if (!document.body.classList.contains('mobile-open')) return;
  document.body.classList.remove('mobile-open');
  syncToggle(toggle);
  if (restoreFocus) toggle?.focus();
}

export function bindNavigation(onLogout) {
  const side = document.querySelector('.sidebar');
  if (side) side.id = 'maximum-navigation';
  const toggle = document.querySelector('#toggle-nav');
  if (!isMobileNavigation() && localStorage.getItem('maximum:navigation-hidden') === '1') document.body.classList.add('navigation-hidden');
  syncToggle(toggle);

  if (toggle) toggle.onclick = () => {
    if (isMobileNavigation()) document.body.classList.toggle('mobile-open');
    else {
      document.body.classList.toggle('navigation-hidden');
      localStorage.setItem('maximum:navigation-hidden', document.body.classList.contains('navigation-hidden') ? '1' : '0');
    }
    syncToggle(toggle);
  };

  side?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    if (isMobileNavigation()) closeMobileNavigation(toggle);
  }));

  const logout = document.querySelector('#logout');
  if (logout) logout.onclick = onLogout || (async () => {
    logout.disabled = true;
    try {
      const response = await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'same-origin'});
      if (!response.ok) throw new Error('Não foi possível sair. Tente novamente.');
      location.href = '/';
    } catch (error) {
      logout.disabled = false;
      const toast = document.querySelector('#toast');
      if (toast) toast.textContent = error.message;
    }
  });

  let overlay = document.querySelector('.navigation-overlay');
  if (!overlay) {
    overlay = document.createElement('button');
    overlay.className = 'navigation-overlay';
    overlay.type = 'button';
    overlay.setAttribute('aria-label','Fechar navegação');
    document.body.append(overlay);
  }
  overlay.onclick = () => closeMobileNavigation(toggle, true);

  if (!window.__maximumNavigationGlobalBound) {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMobileNavigation(document.querySelector('#toggle-nav'), true);
    });
    window.addEventListener('resize', () => {
      if (!isMobileNavigation()) document.body.classList.remove('mobile-open');
      syncToggle(document.querySelector('#toggle-nav'));
    });
    window.__maximumNavigationGlobalBound = true;
  }
}

export function mountNavigation(user, active) {
  const side = document.querySelector('.sidebar');
  if (side) side.innerHTML = navigationMarkup(user, active);
  bindNavigation();
}
