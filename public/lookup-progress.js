import {formatCnpj} from './domain.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value || 0).toLocaleString('pt-BR');
const reasons = {INDICADOR_AUSENTE:'A fonte não informou o indicador do Simples.', CONFLITO_NA_FONTE:'Os indicadores do Simples e do MEI estão em conflito.',
  FONTE_INDISPONIVEL:'Fonte indisponível ou tempo de resposta excedido.', LIMITE_DA_FONTE:'Limite da fonte: aguardando o prazo para nova tentativa.',
  NAO_ENCONTRADO:'CNPJ não encontrado na fonte.', IDENTIDADE_DIVERGENTE:'A fonte retornou outro CNPJ; resposta rejeitada.',
  RESPOSTA_INVALIDA:'A fonte não retornou uma resposta válida.', FONTE_HTTP_403:'A fonte bloqueou temporariamente o acesso.', FONTE_HTTP_401:'A fonte recusou o acesso.'};
let current = '', page = 1, filter = 'ALL', panel = null, data = null, controller = null, nextRead = 0;
const compact = location.pathname === '/purchases.html' && new URLSearchParams(location.search).get('guided') === '1';
function target() {
  const url = new URL(location.href);
  const id = url.pathname === '/purchases.html' ? url.searchParams.get('job') : url.hash.match(/^#job\/([a-f0-9-]{36})$/)?.[1];
  return /^[a-f0-9-]{36}$/.test(id || '') ? id : '';
}
function mount() {
  const root = document.querySelector(location.pathname === '/purchases.html' ? '#purchase-report-view' : '#content');
  if (!root || !root.children.length) return false;
  if (panel?.isConnected) return true;
  panel = document.createElement('section'); panel.className = 'card lookup-live'; panel.id = 'lookup-live';
  if (compact) panel.setAttribute('aria-label', 'Indicadores da consulta dos CNPJs');
  else panel.setAttribute('aria-labelledby', 'lookup-live-title');
  panel.innerHTML = compact ? '<div class="lookup-live-counts" data-counts aria-live="polite"></div><p role="alert" data-error></p>' : `<div class="lookup-live-heading"><div><h2 id="lookup-live-title">Classificação dos CNPJs</h2><p data-caption class="hint">Lendo os resultados já salvos…</p></div><button type="button" data-refresh>Atualizar agora</button></div>
    <div class="lookup-live-counts" data-counts></div>
    <p class="hint">Aguardando consulta não significa Não optante. No resumo gerencial final, os não confirmados continuam em Não optante; CPF permanece separado nas vendas.</p>
    <div class="lookup-live-controls"><label>Conferir situação original<select data-filter><option value="ALL">Todos os CNPJs</option><option value="OPTANTE">Simples confirmado</option><option value="NAO_OPTANTE">Não optante confirmado</option><option value="NAO_CONFIRMADO">Não confirmado / falha</option><option value="PENDING">Aguardando / nova tentativa</option></select></label><button type="button" data-recheck hidden>Revalidar em novo lote</button></div>
    <p role="alert" data-error></p><div class="table-wrap" data-rows></div>
    <div class="pagination"><button type="button" data-prev>Anterior</button><span data-page></span><button type="button" data-next>Próxima</button></div>`;
  if (location.pathname === '/purchases.html') root.after(panel); else root.append(panel);
  if (compact) { if (data) draw(data); return true; }
  panel.querySelector('[data-filter]').value = filter;
  panel.querySelector('[data-filter]').onchange = e => { filter = e.target.value; page = 1; nextRead = 0; refresh(); };
  panel.querySelector('[data-refresh]').onclick = () => { nextRead = 0; refresh(); };
  panel.querySelector('[data-prev]').onclick = () => { page = Math.max(1, page - 1); nextRead = 0; refresh(); };
  panel.querySelector('[data-next]').onclick = () => { page++; nextRead = 0; refresh(); };
  panel.querySelector('[data-recheck]').onclick = recheck;
  if (data) draw(data);
  return true;
}
function draw(result) {
  if (!panel?.isConnected) return;
  const m = result.metrics;
  if (!compact) panel.querySelector('[data-caption]').textContent = `${result.partial ? 'Acompanhamento parcial' : 'Consulta concluída'} · ${number(m.completed)} de ${number(m.total)} CNPJs concluídos. A fonte é a Minha Receita.`;
  panel.querySelector('[data-counts]').innerHTML = [[m.optants,'Simples confirmado','yes'],[m.nonOptants,'Não optante confirmado','no'],[m.unconfirmed,'Não confirmado / falha','unknown'],[m.pending + m.retrying,'Aguardando / nova tentativa','pending']]
    .map(([count, label, tone]) => `<div class="lookup-live-count ${tone}"><strong>${number(count)}</strong><span>${label}</span></div>`).join('');
  if (compact) return;
  panel.querySelector('[data-rows]').innerHTML = `<table><caption class="hint">Situação original da fonte por CNPJ — até 25 registros por página.</caption><thead><tr><th>CNPJ</th><th>Empresa</th><th>Situação da consulta</th><th>Detalhes</th></tr></thead><tbody>${result.items.map(row => {
    const done = row.state === 'DONE';
    const label = !done ? row.state === 'RETRY' ? 'Nova tentativa programada' : 'Aguardando consulta' : row.status === 'OPTANTE' ? 'Simples — confirmado' : row.status === 'NAO_OPTANTE' ? 'Não optante — confirmado' : 'Não confirmado';
    const tone = !done ? 'pending' : row.status === 'OPTANTE' ? 'yes' : row.status === 'NAO_OPTANTE' ? 'no' : 'unknown';
    const when = row.checkedAt ? new Date(row.checkedAt).toLocaleString('pt-BR') : 'Ainda não consultado';
    return `<tr><td>${esc(formatCnpj(row.cnpj))}</td><td>${esc(row.submittedName)}<small>${esc(row.details?.name || '')}</small></td><td><span class="lookup-live-badge ${tone}">${label}</span></td><td>${esc(reasons[row.reason] || row.reason || (done ? 'Indicador explícito na fonte.' : 'Ainda não há uma resposta concluída.'))}<small>${esc(when)} · ${number(row.attempts)} tentativa(s)</small></td></tr>`;
  }).join('') || '<tr><td colspan="4">Nenhum CNPJ neste filtro.</td></tr>'}</tbody></table>`;
  panel.querySelector('[data-page]').textContent = `${page} / ${Math.max(1, Math.ceil(result.total / 25))} · ${number(result.total)} CNPJs`;
  panel.querySelector('[data-prev]').disabled = page <= 1;
  panel.querySelector('[data-next]').disabled = page * 25 >= result.total;
  panel.querySelector('[data-recheck]').hidden = !result.canRecheck || result.partial || !m.total;
}
async function refresh() {
  const id = target();
  if (id !== current) {
    controller?.abort(); controller = null; current = id; page = 1; filter = 'ALL'; data = null; nextRead = 0; panel?.remove(); panel = null;
  }
  if (!id || document.hidden || !mount() || controller || Date.now() < nextRead) return;
  const own = new AbortController(); controller = own;
  const timeout = setTimeout(() => own.abort(), 20000);
  const requestedPage = page, requestedFilter = filter;
  try {
    const response = await fetch(`/api/v4/lookups/${id}/progress?${new URLSearchParams({page, status: filter, ...(compact ? {summary:'1'} : {})})}`, {credentials:'same-origin', cache:'no-store', signal: own.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Não foi possível ler o acompanhamento.');
    if (current !== id || target() !== id || page !== requestedPage || filter !== requestedFilter) return;
    data = result; draw(result); panel.querySelector('[data-error]').textContent = '';
    window.dispatchEvent(new CustomEvent('lookup-progress-updated', {detail: result}));
    nextRead = ['UPLOADING', 'PROCESSING'].includes(result.job.status) ? Date.now() + 4000 : Infinity;
  } catch (e) {
    if (current === id && panel?.isConnected && controller === own) {
      panel.querySelector('[data-error]').textContent = e.name === 'AbortError' ? 'A leitura do acompanhamento demorou. O progresso salvo foi mantido.' : e.message;
      nextRead = Date.now() + 10000;
    }
  } finally { clearTimeout(timeout); if (controller === own) controller = null; }
}
async function recheck() {
  if (!data?.canRecheck || data.partial) return;
  if (!confirm('Criar um novo lote e consultar novamente todos os CNPJs? Os dados e valores importados serão preservados. O histórico e a geração anteriores não serão alterados.')) return;
  const id = current, button = panel.querySelector('[data-recheck]'); button.disabled = true;
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 55000);
  try {
    const response = await fetch(`/api/v4/lookups/${id}/recheck`, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{}', signal:abort.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Não foi possível revalidar.');
    location.href = ['PURCHASES_V1','SALES_V1'].includes(result.mode)
      ? '/purchases.html?' + new URLSearchParams({type:result.mode === 'SALES_V1' ? 'SALES' : 'PURCHASES', client:result.clientId, job:result._id})
      : '/#job/' + result._id;
  } catch (e) { if (!panel?.isConnected || current !== id) return; panel.querySelector('[data-error]').textContent = e.name === 'AbortError' ? 'Confira o histórico antes de tentar de novo: a criação pode ter sido concluída.' : e.message; button.disabled = false; }
  finally { clearTimeout(timeout); }
}
window.addEventListener('hashchange', refresh);
window.addEventListener('popstate', refresh);
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 1500);
refresh();
