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
ensureStylesheet('/navigation.css?v=0.19.0');

function navigationLabel(label) {
  return `<span class="navigation-label">${escape(label)}</span>`;
}

function brandMark() {
  return `<a href="/#overview" class="navigation-rail-cap" aria-label="Maximum CNPJ · Início"><span class="navigation-mark" aria-hidden="true"><img src="/img/maximum-symbol.png" width="78" height="65" alt=""></span><span class="navigation-brand-copy"><strong>Maximum</strong><small>CNPJ</small></span></a>`;
}

export function navigationMarkup(user, active = 'overview', internal = false) {
  const entry = (key, label, image, href, primary = false) => `<a href="${href}" class="navigation-item${primary ? ' navigation-start' : ''}" aria-label="${escape(label)}" ${internal && ['overview','clients','settings'].includes(key) ? `data-nav="${key}"` : ''} data-navigation="${key}" ${active===key?'aria-current="page"':''}><span class="navigation-icon">${icon(image)}</span>${navigationLabel(label)}</a>`;
  const name = user?.name || user?.email || 'Equipe Maximum';
  const role = {admin:'Administrador',operator:'Operador',viewer:'Visualização'}[user?.role] || 'Equipe Maximum';
  return `<div class="navigation-heading">${brandMark()}<button class="navigation-close" type="button" aria-label="Fechar navegação"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><div class="navigation-dock"><span class="navigation-section" aria-hidden="true">Workspace</span><nav class="nav" aria-label="Navegação principal">${entry('overview','Início','home','/#overview')}${entry('clients','Empresas','companies','/#clients')}${entry('start','Iniciar','start','/generations.html',true)}${entry('history','Histórico','history','/generations.html?view=history')}${entry('simulations','Simulações','simulations','/simulations.html')}</nav></div><div class="side-bottom navigation-utility-dock">${entry('settings','Configurações','settings','/#settings')}<button id="logout" class="navigation-item navigation-logout" type="button" aria-label="Sair da conta"><span class="navigation-icon">${icon('logout')}</span>${navigationLabel('Sair')}</button><div class="navigation-profile" title="${escape(name)}"><span class="navigation-avatar" aria-hidden="true">${escape(Array.from(name)[0]?.toUpperCase() || 'M')}</span><span class="navigation-user-copy"><strong>${escape(name)}</strong><small>${escape(role)}</small></span><span class="sr-only">Usuário conectado: ${escape(name)}</span></div></div>`;
}

export function markNavigation(active) {
  document.querySelectorAll('[data-navigation]').forEach(link => {
    if (link.dataset.navigation === active) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  syncNavigation();
}

function isMobileNavigation() {
  return innerWidth <= 850;
}

function navigationExpanded() {
  return isMobileNavigation() ? document.body.classList.contains('mobile-open') : document.body.classList.contains('navigation-expanded');
}

function mountToggleVisual(toggle) {
  if (!toggle || toggle.querySelector('.navigation-toggle-glyph')) return;
  toggle.innerHTML = `<svg class="navigation-toggle-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path class="navigation-toggle-chevron" d="m13 9 3 3-3 3"/></svg>`;
}

function syncNavigation() {
  const toggle = document.querySelector('#toggle-nav');
  const side = document.querySelector('#maximum-navigation');
  const mobile = isMobileNavigation();
  const expanded = navigationExpanded();
  const action = expanded ? (mobile ? 'Fechar navegação' : 'Recolher navegação') : (mobile ? 'Abrir navegação' : 'Expandir navegação');
  if (toggle) {
    mountToggleVisual(toggle);
    toggle.dataset.navigationState = expanded ? 'open' : 'closed';
    toggle.dataset.navigationAction = action;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', 'maximum-navigation');
    toggle.setAttribute('aria-label', 'Alternar navegação');
    toggle.setAttribute('aria-description', action);
    toggle.title = action;
  }
  if (side) {
    side.inert = mobile && !expanded;
    if (mobile && expanded) {
      side.setAttribute('role', 'dialog');
      side.setAttribute('aria-modal', 'true');
      side.setAttribute('aria-label', 'Navegação');
    } else {
      side.removeAttribute('role');
      side.removeAttribute('aria-modal');
      side.removeAttribute('aria-label');
    }
  }
  document.querySelectorAll('.main').forEach(main => {
    if (mobile && expanded) {
      if (!main.inert) {
        main.dataset.navigationInert = 'true';
        main.inert = true;
      }
    } else if (main.dataset.navigationInert) {
      main.inert = false;
      delete main.dataset.navigationInert;
    }
  });
}

function closeMobileNavigation(restoreFocus = false) {
  const wasOpen = document.body.classList.contains('mobile-open');
  document.body.classList.remove('mobile-open');
  syncNavigation();
  if (restoreFocus && wasOpen) document.querySelector('#toggle-nav')?.focus();
}

function focusableNavigation() {
  return [...document.querySelectorAll('#maximum-navigation a[href], #maximum-navigation button:not(:disabled)')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
}

export function bindNavigation(onLogout) {
  const side = document.querySelector('.sidebar');
  if (side) side.id = 'maximum-navigation';
  const toggle = document.querySelector('#toggle-nav');
  document.body.classList.remove('navigation-hidden');
  try {
    document.body.classList.toggle('navigation-expanded', localStorage.getItem('maximum:navigation-expanded') === '1');
  } catch {
    // Navigation remains usable when the browser blocks preference storage.
  }
  syncNavigation();

  if (toggle) toggle.onclick = () => {
    if (isMobileNavigation()) {
      const open = !document.body.classList.contains('mobile-open');
      document.body.classList.toggle('mobile-open', open);
      syncNavigation();
      if (open) side?.querySelector('.navigation-close')?.focus();
    } else {
      document.body.classList.toggle('navigation-expanded');
      try {
        localStorage.setItem('maximum:navigation-expanded', document.body.classList.contains('navigation-expanded') ? '1' : '0');
      } catch {
        // A blocked preference must not prevent opening the sidebar.
      }
      syncNavigation();
    }
  };

  side?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    if (isMobileNavigation()) closeMobileNavigation(true);
  }));
  const close = side?.querySelector('.navigation-close');
  if (close) close.onclick = () => closeMobileNavigation(true);

  const logout = document.querySelector('#logout');
  if (logout) logout.onclick = async () => {
    closeMobileNavigation(true);
    if (onLogout) return onLogout();
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
  };

  let overlay = document.querySelector('.navigation-overlay');
  if (!overlay) {
    overlay = document.createElement('button');
    overlay.className = 'navigation-overlay';
    overlay.type = 'button';
    overlay.tabIndex = -1;
    overlay.setAttribute('aria-label', 'Fechar navegação');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.append(overlay);
  }
  overlay.onclick = () => closeMobileNavigation(true);

  if (!window.__maximumNavigationGlobalBound) {
    document.addEventListener('keydown', event => {
      if (!isMobileNavigation() || !document.body.classList.contains('mobile-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileNavigation(true);
      } else if (event.key === 'Tab') {
        const items = focusableNavigation();
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    window.addEventListener('resize', () => {
      const active = document.activeElement;
      const closingDrawer = !isMobileNavigation() && document.body.classList.contains('mobile-open');
      if (!isMobileNavigation()) document.body.classList.remove('mobile-open');
      syncNavigation();
      // The browser may already have blurred the mobile close button after its CSS changed.
      if (closingDrawer || (active?.closest('#maximum-navigation') && (active.closest('[inert]') || getComputedStyle(active).display === 'none'))) document.querySelector('#toggle-nav')?.focus();
    });
    window.__maximumNavigationGlobalBound = true;
  }
}

export function mountNavigation(user, active) {
  const side = document.querySelector('.sidebar');
  if (side) side.innerHTML = navigationMarkup(user, active);
  bindNavigation();
}
