const endpoint = '/api/v4/simulations/reprocess';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => Number(value).toLocaleString('pt-BR');
const date = value => Number.isFinite(Date.parse(value || '')) ? new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '';
const labels = {QUEUED:'Aguardando', PROCESSING:'Processando', OK:'OK', PENDING:'Pendente', FAILED:'Falhou'};
const simulationLink = (id, label) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id || '')
  ? `<a href="/simulator.html?simulation=${encodeURIComponent(id)}">${label}</a>` : '';

function validate(data) {
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  if (!data || data.version !== 'REPORT_MONTHS_2026_10_V1' || !validCount(data.total) ||
      !['queued','processing','ok','pending','failed'].every(key => validCount(data.counts?.[key])) ||
      !validCount(data.retryableFailed) || data.retryableFailed > data.counts.failed ||
      typeof data.hasMore !== 'boolean' || typeof data.inventoryComplete !== 'boolean' ||
      !Array.isArray(data.items) || !validCount(data.page) || data.page < 1 || !validCount(data.totalPages) ||
      !Number.isFinite(data.retryAfterMs) || data.retryAfterMs < 0) {
    throw new Error('O servidor não confirmou o andamento da atualização. Tente novamente.');
  }
  return data;
}

async function request(method, controller, page = 1, retryFailed = false) {
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(endpoint + (method === 'GET' && page > 1 ? `?page=${page}` : ''), {
      method, credentials:'same-origin', signal:controller.signal,
      ...(method === 'POST' ? {headers:{'Content-Type':'application/json'}, body:JSON.stringify(retryFailed ? {retryFailed:true} : {})} : {})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente para continuar a atualização.' :
        response.status === 403 ? 'Seu acesso não permite continuar esta atualização.' :
        data?.message || 'Não foi possível confirmar a atualização. Tente novamente.');
      error.status = response.status;
      throw error;
    }
    return validate(data);
  } finally { clearTimeout(timer); }
}

function waitForNext(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => {clearTimeout(timer); reject(new DOMException('Atualização pausada.', 'AbortError'));};
    const timer = setTimeout(() => {signal.removeEventListener('abort', cancel); resolve();}, Math.min(10000, Math.max(200, milliseconds)));
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, {once:true});
  });
}

/** Separate from history filters and deletion: a retry always resumes the same server-owned batch. */
export function mountSimulationReprocess(root, user, onComplete) {
  const writable = ['admin','operator'].includes(user?.role);
  const state = {summary:null, detail:null, detailPage:1, detailLoading:false, detailError:'', open:false,
    running:false, paused:document.hidden, finished:false, error:'', fatal:0, controller:null, detailController:null,
    sequence:0, disposed:false, refreshNeeded:false};

  function render() {
    if (!root.isConnected) return;
    const data = state.summary, counts = data?.counts, issues = counts ? counts.pending + counts.failed : 0;
    const heading = state.fatal || state.error ? 'Atualização interrompida' : state.paused ? 'Atualização pausada' :
      state.finished && !state.running ? issues ? 'Atualização encerrada com pendências' : 'Verificação concluída' :
      writable ? 'Atualizando simulações' : 'Atualização das simulações';
    const message = state.error || (state.paused ? 'O processamento retoma quando esta aba estiver visível.' :
      state.finished && !state.running ? issues ? 'Há simulações que precisam de conferência. Veja os motivos nos detalhes.' :
        data?.total ? 'As simulações verificadas estão atualizadas.' : 'Nenhuma simulação precisa de atualização neste lote.' :
      !data ? 'Verificando o andamento…' : !writable ? 'Seu acesso permite acompanhar a atualização. Um administrador ou operador pode continuar o processamento.' :
      !data.inventoryComplete ? 'Identificando as simulações que precisam de atualização…' : 'Serviços e DIFAL estão sendo conferidos em cada simulação.');
    const detail = state.detail || data;
    root.innerHTML = `<section class="history-reprocess" aria-labelledby="history-reprocess-heading" aria-busy="${state.running}">
      <div class="history-reprocess-summary"><div><h2 id="history-reprocess-heading">${heading}</h2><p class="history-reprocess-status" role="status">${escapeHtml(message)}</p></div>
      <dl class="history-reprocess-counts">${[['ok','OK'],['pending','Pendente'],['failed','Falhou']].map(([key,label]) => `<div data-reprocess-count="${key}"><dt>${label}</dt><dd>${counts ? number(counts[key]) : '—'}</dd></div>`).join('')}</dl></div>
      ${data ? `<p class="history-reprocess-progress">${number(data.total)} simulações no lote · ${number(counts.queued)} aguardando · ${number(counts.processing)} em processamento</p>` : ''}
      ${state.fatal ? `<a class="history-reprocess-session" href="/">${state.fatal === 401 ? 'Entrar novamente' : 'Voltar ao painel'}</a>` : state.error ? '<button type="button" data-reprocess-retry>Tentar atualização novamente</button>' : ''}
      ${writable && state.finished && !state.running && !state.error && data?.retryableFailed > 0 ? '<button type="button" data-reprocess-failed>Repetir simulações com falha</button>' : ''}
      ${state.finished && !state.running && !state.error && counts?.failed && data.retryableFailed === 0 ? '<p class="history-reprocess-progress">O limite de tentativas das simulações com falha foi alcançado. Confira os registros e motivos nos detalhes.</p>' : ''}
      <details class="history-reprocess-details" ${state.open ? 'open' : ''}><summary>Conferir pendências e versões</summary>
        <p>Os originais permanecem no histórico. As versões atualizadas têm um link próprio. Esta conferência abrange todas as empresas, independentemente dos filtros abaixo.</p>
        ${date(data?.startedAt) ? `<p>Inclui simulações salvas até ${escapeHtml(date(data.startedAt))} (horário de Brasília).</p>` : ''}
        ${state.detailError ? `<p class="history-reprocess-error" role="alert">${escapeHtml(state.detailError)}</p>` : ''}
        ${state.detailLoading ? '<p role="status">Carregando detalhes…</p>' : detail?.items.length ? `<ul class="history-reprocess-items">${detail.items.map(item => `<li><div><strong>${escapeHtml(item.company?.name || 'Simulação salva')}</strong><span class="history-reprocess-badge" data-reprocess-status="${escapeHtml(item.status)}">${escapeHtml(labels[item.status] || 'A conferir')}</span></div><small>${escapeHtml(item.company?.code || 'Sem código')} · ${escapeHtml(item.title || 'Simulação tributária')}</small><p>${escapeHtml(item.message || 'Aguardando conferência.')}</p><div class="history-reprocess-links">${simulationLink(item.originalId, 'Abrir original')}${simulationLink(item.childId, 'Abrir versão atualizada')}</div></li>`).join('')}</ul>` : '<p>Nenhum detalhe disponível neste momento.</p>'}
        ${detail && detail.totalPages > 1 ? `<div class="history-reprocess-pages"><button type="button" data-reprocess-page="${Math.max(1,state.detailPage-1)}" ${state.detailPage <= 1 || state.detailLoading ? 'disabled' : ''}>Detalhes anteriores</button><span>Página ${number(state.detailPage)} de ${number(detail.totalPages)}</span><button type="button" data-reprocess-page="${state.detailPage+1}" ${state.detailPage >= detail.totalPages || state.detailLoading ? 'disabled' : ''}>Próximos detalhes</button></div>` : ''}
      </details></section>`;
    root.querySelector('details').ontoggle = event => {state.open = event.currentTarget.open;};
    root.querySelector('[data-reprocess-retry]')?.addEventListener('click', () => void start());
    root.querySelector('[data-reprocess-failed]')?.addEventListener('click', () => void start(true));
    root.querySelectorAll('[data-reprocess-page]').forEach(button => button.addEventListener('click', () => void details(Number(button.dataset.reprocessPage))));
  }

  async function details(page) {
    state.detailController?.abort();
    const controller = new AbortController(); state.detailController = controller;
    state.detailLoading = true; state.detailError = ''; state.open = true; render();
    try {
      const data = await request('GET', controller, page);
      if (state.disposed || state.detailController !== controller) return;
      state.detail = data; state.detailPage = data.page;
    } catch (error) {
      if (state.disposed || state.detailController !== controller) return;
      if ([401,403].includes(error.status)) {state.fatal = error.status; state.error = error.message; state.controller?.abort();}
      else if (!document.hidden) state.detailError = error.name === 'AbortError' ? 'Os detalhes demoraram a responder. Selecione a página novamente para tentar.' : error.message;
    } finally {if (state.detailController === controller) {state.detailLoading = false; render();}}
  }

  function accept(data) {
    state.summary = data;
    if (state.detailPage === 1) state.detail = data;
    state.finished = !data.hasMore && data.inventoryComplete;
    render();
  }

  async function start(retryFailed = false) {
    if (state.running || state.disposed || state.fatal || document.hidden) return;
    const sequence = ++state.sequence, controller = new AbortController(); state.controller = controller;
    state.running = true; state.paused = false; state.error = ''; state.finished = false; render();
    try {
      let data = await request('GET', controller); if (sequence !== state.sequence) return; accept(data);
      if (!writable) return;
      let lastProgress = '', unchanged = 0, lastProgressAt = Date.now();
      // The batch inventory and all tax inputs remain server-owned.
      do {
        if (controller.signal.aborted) throw new DOMException('Atualização pausada.', 'AbortError');
        data = await request('POST', controller, 1, retryFailed); retryFailed = false; if (sequence !== state.sequence) return;
        state.refreshNeeded = true; accept(data);
        const progress = JSON.stringify([data.total, data.inventoryComplete, data.counts]);
        if (progress === lastProgress) unchanged++; else {unchanged = 0; lastProgressAt = Date.now();} lastProgress = progress;
        if (data.hasMore) {
          const leaseUntil = Date.parse(data.leaseExpiresAt || '');
          const activeLease = Number.isFinite(leaseUntil) && Date.now() <= leaseUntil + 5000;
          if (unchanged >= 10 && (!activeLease || Date.now() - lastProgressAt > 300000)) throw new Error('A atualização não avançou nas últimas tentativas. Tente novamente para retomar o mesmo lote.');
          await waitForNext(data.retryAfterMs, controller.signal);
        }
      } while (data.hasMore);
      if (state.detailPage > 1) await details(state.detailPage);
      if (state.fatal || controller.signal.aborted) return;
      if (state.refreshNeeded) {state.refreshNeeded = false; await onComplete();}
    } catch (error) {
      if (sequence !== state.sequence || state.disposed) return;
      if (document.hidden && error.name === 'AbortError') state.paused = true;
      else if (!state.fatal) {state.error = error.name === 'AbortError' ? 'O servidor demorou a confirmar a atualização. Tente novamente para retomar o mesmo lote.' : error.message; state.fatal = [401,403].includes(error.status) ? error.status : 0;}
    } finally {
      if (sequence === state.sequence) {state.running = false; render();}
    }
  }

  function visibility() {
    if (document.hidden) {
      state.detailController?.abort();
      if (state.running) {state.paused = true; state.controller?.abort(); render();}
    } else if (state.paused && !state.error && !state.fatal) {
      // Abort completion may still be queued; release the old run before resuming.
      state.sequence++; state.running = false; void start();
    }
  }
  function dispose() {
    state.disposed = true; state.sequence++; state.controller?.abort(); state.detailController?.abort();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', dispose);
  }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', dispose);
  render(); void start();
  return {dispose};
}
