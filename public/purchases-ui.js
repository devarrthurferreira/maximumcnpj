import {mountNavigation} from './navigation.js';
import {formatCnpj,REPORTING_LABELS} from './domain.js';
import {assertMatchingPurchaseCompetences} from './purchase-model.js';

const $ = q => document.querySelector(q);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const number = v => Number(v || 0).toLocaleString('pt-BR');
const money = v => (Number(v || 0) / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const percent = v => Number(v || 0).toLocaleString('pt-BR', {maximumFractionDigits:2}) + '%';
const date = v => v ? new Date(v).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}) : 'Não informada';
const jobLabels = {UPLOADING:'Importação incompleta', PROCESSING:'Consulta em andamento', COMPLETED:'Concluído', CANCELLED:'Cancelado'};
const kinds = {CPF:'CPF', INVALIDO:'Documento inválido', AUSENTE:'Documento ausente', CNO_OU_OUTRO:'CNO ou outro documento'};
const reportType = new URLSearchParams(location.search).get('type') || 'PURCHASES';
const guided = new URLSearchParams(location.search).get('guided') === '1';
const sales = reportType === 'SALES';
const labels = {ALL:'Todos os enquadramentos', ...REPORTING_LABELS, ...(sales ? {CPF:'CPF'} : {})};
const groupLabels = sales ? {OPTANTE:'Faturamento vendas Optantes SN',NAO_OPTANTE:'Faturamento vendas Não Optantes SN',CPF:'Faturamento Vendas de CPFs'} : {OPTANTE:'Compras de empresas do Simples',NAO_OPTANTE:'Compras de empresas fora do Simples'};
const operationLabels = {VENDA:'Vendas',SERVICO:'Serviços',DEVOLUCAO:'Devoluções',OUTRAS:'Outras',MISTAS:'Múltiplas'};
const groupingHelp = sales ? 'Vendas separadas em três grupos: optantes pelo Simples, não optantes e CPFs. CNPJs não confirmados, CNO e documentos inválidos ou ausentes entram em Não optantes. CPF tem seu próprio grupo. Devoluções sempre abatem o saldo líquido.' : 'Compras separadas em dois grupos: empresas do Simples e empresas fora do Simples. CPF, CNO, documentos inválidos ou ausentes e resultados não confirmados entram em fora do Simples.';
const reportName = sales ? 'Vendas' : 'Compras', reportLower = reportName.toLowerCase();
const party = sales ? 'comprador' : 'fornecedor', parties = sales ? 'compradores' : 'fornecedores';
const partyHeading = sales ? 'Comprador' : 'Razão social';
const S = {generation:null, generationDetails:null, resume:null, user:null, clients:[], company:'', worker:null, file:null, review:null, pending:null, busy:false, job:null, summary:null, historyPage:1, historyTotal:0, status:'ALL', page:1, total:0, view:'suppliers', seq:0, rowsSeq:0, jobsSeq:0, running:false, paused:true, timer:null};
const writable = () => ['admin','operator'].includes(S.user?.role);
const path = suffix => `/api/v4/${sales ? 'sales' : 'purchases'}${suffix || ''}`;

function error(e) { $('#purchase-error').textContent = e.message || String(e); }
function clearError() { $('#purchase-error').textContent = ''; }
function status(text) { if ($('#purchase-progress-text')) $('#purchase-progress-text').textContent = text; }
async function api(url, method = 'GET', data) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const r = await fetch(url, {method, credentials:'same-origin', headers:method === 'GET' ? {} : {'Content-Type':'application/json'}, body:data === undefined ? undefined : JSON.stringify(data), signal:controller.signal});
    let d;
    try { d = await r.json(); } catch { throw new Error('Resposta inesperada do servidor. Confira a implantação e tente novamente.'); }
    if (!r.ok) {
      if (r.status === 401) throw new Error('Sua sessão expirou. Entre novamente pelo painel.');
      throw new Error(d.message || 'Não foi possível concluir a operação.');
    }
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O servidor excedeu o tempo de resposta. Retome o mesmo relatório para continuar do progresso salvo.');
    throw e;
  } finally { clearTimeout(timeout); }
}

function urlParams(extra = {}) { return new URLSearchParams({...(sales ? {type:'SALES'} : {}), ...(S.generation ? {generation:S.generation} : {}), client:S.company, ...(guided ? {guided:'1'} : {}), ...extra}); }
function guidedShell() {
  document.body.classList.add('purchases-guided');
  $('#purchase-app').innerHTML = `<div class="generation-back"><a href="/generations.html?id=${encodeURIComponent(S.generation)}">← Voltar à geração</a><span>Progresso salvo automaticamente</span></div><div id="purchase-flow"></div>
    <div hidden><select id="purchase-company"><option value=""></option>${S.clients.map(c => `<option value="${esc(c._id)}">${esc(c.name)}</option>`).join('')}</select><div id="purchase-history-list"></div><button id="purchase-history-prev"></button><span id="purchase-history-page"></span><button id="purchase-history-next"></button></div>
    ${writable() ? `<section id="purchase-import" class="card purchase-guided-import" aria-labelledby="purchase-import-title"><span class="purchase-guided-icon" aria-hidden="true">${sales ? '↗' : '↙'}</span><div class="eyebrow">RELATÓRIO DE ${reportName.toUpperCase()}</div><h2 id="purchase-import-title">Adicione o arquivo de ${reportLower}</h2><p id="purchase-guided-company"></p><label class="purchase-dropzone" id="purchase-dropzone"><input type="file" id="purchase-file" accept=".csv,.xlsx,.xls" disabled><span class="purchase-upload-icon" aria-hidden="true">↑</span><strong id="purchase-file-label">Clique para selecionar ou arraste o arquivo aqui</strong><span>CSV, XLSX ou XLS · até 10 MiB</span></label><p class="hint">A leitura e a consulta começam automaticamente.</p><select id="purchase-encoding" hidden><option value="auto">Automática</option></select><div id="purchase-file-preview"></div><div id="purchase-review"></div><p id="purchase-progress-text" class="purchase-status" role="status" aria-live="polite"></p></section>` : '<p class="warning info">Seu acesso permite consultar os relatórios existentes.</p>'}
    <div id="purchase-report-view"></div><div id="purchase-next-step" aria-live="polite"></div>`;
  if (!writable()) return;
  $('#purchase-file').onchange = () => openFile().catch(error);
  const dropzone = $('#purchase-dropzone');
  for (const name of ['dragenter','dragover']) dropzone.addEventListener(name, e => { e.preventDefault(); if (!S.busy && !S.pending) dropzone.classList.add('dragging'); });
  for (const name of ['dragleave','drop']) dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.remove('dragging'); });
  dropzone.addEventListener('drop', e => {
    if (S.busy || S.pending || !S.company) return;
    if (e.dataTransfer.files.length !== 1) { error(new Error('Adicione um relatório por vez.')); return; }
    $('#purchase-file').files = e.dataTransfer.files; openFile().catch(error);
  });
}
function shell() {
  if (guided) { guidedShell(); return; }
  $('#purchase-app').innerHTML = `
    ${S.generation ? `<div class="generation-back"><a href="/generations.html?id=${encodeURIComponent(S.generation)}">← Voltar à geração e às outras empresas</a><span class="badge">Progresso salvo no Histórico</span></div>` : '<div class="generation-back"><a href="/generations.html?view=history">← Histórico de gerações</a><a href="/generations.html?multiple=1">Iniciar geração com várias empresas →</a></div>'}
    <div id="purchase-flow"></div><div class="purchase-types" role="group" aria-label="Tipo de relatório"><button type="button" data-report-type="PURCHASES" aria-pressed="${!sales}">Compras <span aria-hidden="true">↙</span></button><button type="button" data-report-type="SALES" aria-pressed="${sales}">Vendas <span aria-hidden="true">↗</span></button></div>
    <section id="purchase-company-card" class="card stack"><h2 class="purchase-step"><span>1</span> Selecione a empresa</h2><label>Empresa responsável (Código / ID)<select id="purchase-company"><option value="">Escolha uma empresa cadastrada</option>${S.clients.map(c => `<option value="${esc(c._id)}">${esc(c.code || 'Sem código')} · ${esc(c.name)}${c.active ? '' : ' (inativa)'}</option>`).join('')}</select></label><p class="hint">O relatório ficará vinculado somente à empresa escolhida. Seus cadastros atuais continuam disponíveis.</p>${S.clients.length ? '' : '<p>Nenhuma empresa cadastrada. <a href="/#clients">Cadastre ou importe suas empresas no painel</a> para continuar.</p>'}</section>
    ${writable() ? `<section id="purchase-import" class="card stack purchase-section"><h2 class="purchase-step"><span>2</span> Importe o relatório de ${reportLower}</h2><div class="purchase-grid"><label>Arquivo de ${reportLower} (.csv, .xlsx ou .xls)<input type="file" id="purchase-file" accept=".csv,.xlsx,.xls" disabled></label><label>Codificação do CSV<select id="purchase-encoding" disabled><option value="auto">Detectar automaticamente</option><option value="windows-1252">Windows-1252 (Excel em português)</option><option value="utf-8">UTF-8</option></select></label></div><p class="hint">Até 10 MiB e 50.000 linhas. O arquivo original fica no navegador; somente os campos abaixo são importados.</p><div class="purchase-map"><div><strong>A</strong>CNPJ do ${party}<small>CPF e demais documentos incluídos</small></div><div><strong>I</strong>${partyHeading}<small>Nome informado no relatório</small></div>${sales ? '<div><strong>L</strong>Natureza / CFOP<small>Somente os 4 primeiros dígitos são considerados</small></div><div><strong>O</strong>Descrição<small>Classifica Venda, Serviço, Devolução ou Outras</small></div>' : ''}<div><strong>P</strong>Quantidade<small>${sales ? 'Opcional no relatório de vendas' : 'Preservada por linha'}</small></div><div><strong>Q</strong>Valor Total<small>Valor bruto em reais</small></div><div><strong>Y</strong>Desconto<small>Subtrair do valor</small></div><div><strong>Z</strong>Despesa acessória<small>Somente informativa</small></div><div><strong>AA</strong>Frete<small>Somar ao valor</small></div><div><strong>AB</strong>Abatimento não tributado<small>Subtrair do valor</small></div></div><p class="hint">Novo total = Q − Y + AA − AB. A despesa acessória (Z) fica registrada para conferência e não entra nesta conta. A quantidade (P) não multiplica o valor. Documentos repetidos somam os valores e contam uma vez entre ${parties}.</p><div id="purchase-file-preview"></div><div id="purchase-review"></div><p id="purchase-progress-text" class="purchase-status" role="status" aria-live="polite"></p></section>` : '<div class="warning info purchase-readonly">Seu acesso permite consultar e baixar os relatórios existentes.</div>'}
    <div id="purchase-report-view"></div><div id="purchase-next-step" aria-live="polite"></div><section class="card purchase-history" ${S.generation ? 'hidden' : ''}><div class="card-header"><h2>Histórico de ${reportLower} da empresa</h2><p>Abra um relatório concluído ou retome uma consulta em andamento.</p></div><div id="purchase-history-list" class="purchase-empty"><p>Selecione uma empresa para ver o histórico.</p></div><div class="pagination"><button id="purchase-history-prev" disabled>Anterior</button><span id="purchase-history-page"></span><button id="purchase-history-next" disabled>Próxima</button></div></section>`;
  document.querySelectorAll('[data-report-type]').forEach(button => button.onclick = () => switchReportType(button.dataset.reportType).catch(error));
  $('#purchase-company').onchange = companyChanged;
  $('#purchase-history-prev').onclick = () => loadHistory(S.historyPage - 1).catch(error);
  $('#purchase-history-next').onclick = () => loadHistory(S.historyPage + 1).catch(error);
  if (writable()) {
    $('#purchase-file').onchange = () => openFile().catch(error);
    $('#purchase-encoding').onchange = () => { if (S.file) openFile().catch(error); };
  }
}

function renderFlow() {
  const container = $('#purchase-flow');
  if (!container || !S.generation) return;
  const company = S.generationDetails?.companies.find(c => c.clientId === S.company);
  const purchaseDone = company?.purchase?.status === 'COMPLETED' || (!sales && S.job?.status === 'COMPLETED');
  const salesDone = company?.sales?.status === 'COMPLETED' || (sales && S.job?.status === 'COMPLETED');
  const required = S.generationDetails?.requiredReports || ['PURCHASES','SALES'];
  const steps = guided ? [{label:'Empresa',done:!!S.company},...(required.includes('PURCHASES') ? [{label:'Compras',done:purchaseDone,current:!sales}] : []),...(required.includes('SALES') ? [{label:'Vendas',done:salesDone,current:sales}] : []),...(required.length === 2 ? [{label:'Extrato e simulador',done:false,current:purchaseDone && salesDone}] : [])] : [{label:'Empresa selecionada',done:!!S.company},{label:'Ler compras',done:purchaseDone,current:!sales},{label:'Ler vendas',done:salesDone,current:sales},{label:'Conferir e simular',done:false,current:purchaseDone && salesDone}];
  container.innerHTML = `<div class="generation-steps" aria-label="Etapas da simulação">${steps.map((step,i) => `<div class="${step.done ? 'complete' : step.current ? 'current' : ''}"${step.current && !step.done ? ' aria-current="step"' : ''}><span>${step.done ? '✓' : i + 1}</span>${step.label}</div>`).join('')}</div>`;
}
async function renderNextStep(seq) {
  if (!S.generation || S.job?.status !== 'COMPLETED') return;
  const companyId = S.company;
  $('#purchase-next-step').innerHTML = '<section class="card purchase-section"><p>Conferindo compras e vendas para liberar o simulador…</p></section>';
  try {
    const generation = await api('/api/v4/generations/' + encodeURIComponent(S.generation));
    if (seq !== S.seq || companyId !== S.company) return;
    const company = generation.companies.find(c => c.clientId === companyId);
    if (!company) throw new Error('A empresa não pertence mais a esta geração. Abra o Histórico para conferir.');
    S.generationDetails = generation; renderFlow();
    if (guided) { renderGuidedNext(generation, company); return; }
    const ready = company.purchase?.status === 'COMPLETED' && company.sales?.status === 'COMPLETED';
    const nextType = company.purchase?.status === 'COMPLETED' ? 'SALES' : 'PURCHASES';
    const nextJob = nextType === 'SALES' ? company.sales : company.purchase;
    const nextJobId = nextType === 'SALES' ? company.salesJobId : company.purchaseJobId;
    const nextName = nextType === 'SALES' ? 'vendas' : 'compras';
    const params = new URLSearchParams({generation:S.generation,client:companyId,...(nextType === 'SALES' ? {type:'SALES'} : {}),...(nextJobId ? {job:nextJobId} : {})});
    $('#purchase-next-step').innerHTML = `<section class="card generation-simulator purchase-section ${ready ? 'ready' : ''}"><div><div class="eyebrow">${ready ? 'OS DOIS RELATÓRIOS ESTÃO PRONTOS' : 'PRÓXIMO PASSO'}</div><h2>${ready ? 'Agora, simule com os valores desta empresa.' : `Continue com o relatório de ${nextName}.`}</h2><p>${ready ? 'Os valores de vendas para optantes, não optantes e CPFs, além das compras dentro e fora do Simples, já serão preenchidos no simulador. Confira o período e complete serviços e despesas.' : `O relatório de ${reportLower} foi concluído. ${nextJob?.status === 'PROCESSING' ? 'Retome a consulta' : 'Selecione e confira o arquivo'} de ${nextName} da mesma empresa para liberar a simulação.`}</p><a href="/generations.html?id=${encodeURIComponent(S.generation)}">Conferir todos os relatórios da geração</a></div>${ready ? `<a class="primary report-links" href="/simulator.html?${new URLSearchParams({generation:S.generation,client:companyId})}">Ir para o simulador <span aria-hidden="true">→</span></a>` : writable() ? `<a class="primary report-links" href="/purchases.html?${params}">Continuar: ${nextJob?.status === 'PROCESSING' ? 'consultar' : nextJob?.status === 'UPLOADING' ? 'retomar' : 'importar'} ${nextName} <span aria-hidden="true">→</span></a>` : '<p class="hint">Aguardando a conclusão do outro relatório.</p>'}</section>`;
  } catch (e) {
    if (seq !== S.seq || companyId !== S.company) return;
    $('#purchase-next-step').innerHTML = `<section class="card purchase-section"><p>${esc(e.message)}</p><a class="report-links" href="/generations.html?id=${encodeURIComponent(S.generation)}">Conferir situação na geração</a></section>`;
  }
}

function renderGuidedNext(generation, company) {
  const required = generation.requiredReports || ['PURCHASES','SALES'];
  const slot = (item, type) => type === 'SALES' ? {job:item.sales, id:item.salesJobId} : {job:item.purchase, id:item.purchaseJobId};
  const unfinished = required.find(type => slot(company, type).job?.status !== 'COMPLETED');
  let href, label, title, description;
  if (unfinished) {
    const next = slot(company, unfinished), name = unfinished === 'SALES' ? 'vendas' : 'compras';
    href = '/purchases.html?' + new URLSearchParams({generation:S.generation,client:S.company,type:unfinished,guided:'1',...(next.id ? {job:next.id} : {})});
    label = `Continuar: ${name}`; title = `${reportName} concluídas.`;
    description = `Agora, adicione o relatório de ${name} desta empresa.`;
  } else if (company.purchase?.status === 'COMPLETED' && company.sales?.status === 'COMPLETED') {
    href = '/simulator.html?' + new URLSearchParams({generation:S.generation,client:S.company,guided:'1',step:'extrato'});
    label = 'Continuar para o extrato'; title = 'Compras e vendas prontas.';
    description = 'No próximo passo, adicione o extrato do Simples Nacional para preencher a RBT12.';
  } else {
    const nextCompany = generation.companies.find(item => item.clientId !== S.company && required.some(type => slot(item,type).job?.status !== 'COMPLETED'));
    if (nextCompany) {
      const type = required.find(type => slot(nextCompany,type).job?.status !== 'COMPLETED'), next = slot(nextCompany,type);
      href = '/purchases.html?' + new URLSearchParams({generation:S.generation,client:nextCompany.clientId,type,guided:'1',...(next.id ? {job:next.id} : {})});
      label = 'Continuar para a próxima empresa'; title = 'Relatórios desta empresa prontos.'; description = `${nextCompany.code || 'Sem código'} · ${nextCompany.name}`;
    } else {
      href = '/generations.html?id=' + encodeURIComponent(S.generation); label = 'Concluir e ver geração'; title = 'Relatórios concluídos.';
      description = 'Os relatórios selecionados estão salvos. O simulador fica disponível quando a empresa tiver compras e vendas.';
    }
  }
  $('#purchase-next-step').innerHTML = `<section class="card purchase-guided-next"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><a data-guided-continue class="primary report-links" href="${esc(href)}">${esc(label)} <span aria-hidden="true">→</span></a></section>`;
}

async function switchReportType(type) {
  if (type === reportType || S.busy || S.pending) return;
  const params = new URLSearchParams({...(type === 'SALES' ? {type} : {}), ...(S.company ? {client:S.company} : {})});
  if (S.generation) {
    const generation = await api('/api/v4/generations/' + encodeURIComponent(S.generation));
    const company = generation.companies.find(c => c.clientId === S.company);
    const jobId = type === 'SALES' ? company?.salesJobId : company?.purchaseJobId;
    params.set('generation', S.generation); if (jobId) params.set('job', jobId);
  }
  location.href = '/purchases.html?' + params;
}

function stopProcessing() { S.paused = true; clearTimeout(S.timer); }
function resetPreview() {
  S.worker?.terminate(); S.worker = null; S.review = null; S.file = null;
  if ($('#purchase-file')) $('#purchase-file').value = '';
  if ($('#purchase-file-preview')) $('#purchase-file-preview').innerHTML = '';
  if ($('#purchase-review')) $('#purchase-review').innerHTML = '';
  status('');
}
function setBusy(busy) {
  S.busy = busy;
  $('#purchase-company').disabled = !!S.generation || busy || !!S.pending;
  for (const selector of ['#purchase-file','#purchase-encoding','#purchase-sheet','#purchase-header','#purchase-validate']) {
    if ($(selector)) $(selector).disabled = busy || !!S.pending || !S.company;
  }
  document.querySelectorAll('[data-open-purchase], [data-report-type]').forEach(b => b.disabled = busy || !!S.pending);
}
async function companyChanged() {
  if (S.busy || S.pending) { $('#purchase-company').value = S.company; return; }
  stopProcessing(); S.seq++; S.rowsSeq++; S.company = $('#purchase-company').value; S.job = null; S.summary = null; S.resume = null;
  clearError(); resetPreview(); $('#purchase-report-view').innerHTML = ''; $('#purchase-next-step').innerHTML = ''; renderFlow(); setBusy(false);
  if (guided && $('#purchase-guided-company')) {
    const company = S.clients.find(item => item._id === S.company);
    $('#purchase-guided-company').textContent = company ? `${company.code || 'Sem código'} · ${company.name}` : '';
  }
  if (!S.company) {
    S.jobsSeq++; $('#purchase-history-list').innerHTML = '<div class="purchase-empty"><p>Selecione uma empresa para ver o histórico.</p></div>';
    $('#purchase-history-prev').disabled = true; $('#purchase-history-next').disabled = true; $('#purchase-history-page').textContent = ''; return;
  }
  history.replaceState(null, '', '/purchases.html?' + urlParams());
  await loadHistory(1).catch(error);
}
async function loadHistory(page = 1) {
  if (!S.company || S.generation) return;
  const seq = ++S.jobsSeq, company = S.company;
  $('#purchase-history-list').innerHTML = '<p>Carregando relatórios…</p>';
  const d = await api(path('?' + new URLSearchParams({clientId:company, page})));
  if (seq !== S.jobsSeq || company !== S.company) return;
  S.historyPage = page; S.historyTotal = d.total;
  $('#purchase-history-list').innerHTML = d.items.length ? `<div class="purchase-table"><table><thead><tr><th>Relatório</th><th>Importado em</th><th>Situação</th><th>Linhas</th><th></th></tr></thead><tbody>${d.items.map(j => `<tr><td>${esc(j.fileName)}<small>${esc(j.clientCode || 'Sem código')} · ${esc(j.clientName)}</small></td><td>${date(j.createdAt)}</td><td>${esc(jobLabels[j.status] || j.status)}</td><td>${number(j.summary?.lines ?? j.uploaded)} / ${number(j.expectedRows)}</td><td><button data-open-purchase="${esc(j._id)}" ${S.busy || S.pending ? 'disabled' : ''}>${j.status === 'COMPLETED' ? 'Ver relatório' : 'Abrir'}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="purchase-empty"><h3>A primeira análise começa aqui</h3><p>Importe o relatório de ${reportLower} desta empresa para ver os ${parties} e seus valores por enquadramento.</p></div>`;
  const size = d.pageSize || 30;
  $('#purchase-history-page').textContent = `${page} / ${Math.max(1, Math.ceil(d.total / size))}`;
  $('#purchase-history-prev').disabled = page <= 1; $('#purchase-history-next').disabled = page * size >= d.total;
  document.querySelectorAll('[data-open-purchase]').forEach(b => b.onclick = () => openJob(b.dataset.openPurchase).catch(error));
}

async function openFile() {
  if (!S.company || S.pending || S.busy || !writable()) return;
  const file = $('#purchase-file').files[0];
  if (!file) return;
  if (guided) $('#purchase-file').value = ''; // Allow selecting the same file again after a recoverable read error.
  clearError(); S.worker?.terminate(); S.review = null; S.file = file;
  $('#purchase-file-preview').innerHTML = '<p>Lendo o relatório no navegador…</p>'; $('#purchase-review').innerHTML = ''; status('');
  if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo acima de 10 MiB. Divida o relatório.');
  if (guided) { setBusy(true); $('#purchase-file-label').textContent = file.name; }
  S.worker = new Worker('/purchase-import-worker.js');
  const worker = S.worker;
  worker.onerror = () => { if (S.worker === worker) { if (guided) setBusy(false); error(new Error('O leitor da planilha não iniciou. Recarregue a página e tente novamente.')); } };
  worker.onmessage = ({data:d}) => {
    if (S.worker !== worker) return;
    if (d.type === 'error') { if (guided) { setBusy(false); $('#purchase-file-preview').innerHTML = ''; } error(new Error(d.message)); status('Não foi possível validar o relatório. Corrija o arquivo e tente novamente.'); return; }
    if (d.type === 'sheets') {
      $('#purchase-file-preview').innerHTML = `<div class="purchase-grid"><label>Aba do arquivo<select id="purchase-sheet">${d.sheets.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label><label>Linha do cabeçalho<select id="purchase-header"></select></label></div><p id="purchase-file-info" class="hint mt"></p><div id="purchase-source-preview" class="purchase-preview"></div><button id="purchase-validate" class="mt">Conferir colunas e valores</button>`;
      $('#purchase-sheet').onchange = () => { S.review = null; $('#purchase-review').innerHTML = ''; worker.postMessage({action:'sheet', name:$('#purchase-sheet').value}); };
      $('#purchase-header').onchange = () => { S.review = null; $('#purchase-review').innerHTML = ''; };
      $('#purchase-validate').onclick = () => { clearError(); status('Conferindo documentos, quantidades e valores…'); worker.postMessage({action:'validate', reportType, companyCode:S.clients.find(c => c._id === S.company)?.code, header:Number($('#purchase-header').value), calculationVersion:S.resume?.calculationVersion || (S.resume ? 'Q_V1' : 'NET_V2')}); };
      worker.postMessage({action:'sheet', name:d.sheets[0]});
    }
    if (d.type === 'preview') {
      $('#purchase-header').innerHTML = d.rows.map((r,i) => `<option value="${i}">Linha ${i + 1} · ${esc(String(r[0] || 'Sem título').slice(0,65))}</option>`).join('');
      $('#purchase-file-info').textContent = `${file.name} · ${number(d.total)} linhas lidas${d.encoding ? ' · ' + d.encoding.toUpperCase() : ''}. Confira o cabeçalho e os campos abaixo.`;
      $('#purchase-source-preview').innerHTML = `<table><thead><tr><th>Linha</th><th>A · Documento</th><th>H · Data Escrituração/Serviço</th><th>I · ${partyHeading}</th><th>P · Quantidade</th><th>Q · Valor Total</th><th>Y · Desconto</th><th>Z · Despesa</th><th>AA · Frete</th><th>AB · Abatimento</th></tr></thead><tbody>${d.rows.slice(0,7).map((r,i) => `<tr><td>${i + 1}</td><td>${esc(r[0])}</td><td>${esc(r[7])}</td><td>${esc(r[8])}</td><td>${esc(r[15])}</td><td>${esc(r[16])}</td><td>${esc(r[24])}</td><td>${esc(r[25])}</td><td>${esc(r[26])}</td><td>${esc(r[27])}</td></tr>`).join('')}</tbody></table>`;
      const code = file.name.match(/^(\d+)[\s_-]/)?.[1]?.replace(/^0+(?=\d)/, ''), company = S.clients.find(c => c._id === S.company);
      if (code && company?.code !== code) status(`Atenção: o arquivo começa com o código ${code}, mas a empresa selecionada tem código ${company?.code || 'não informado'}. Confira a responsável antes de importar.`);
    }
    if (d.type === 'validated') showReview(d);
  };
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch { if (guided) setBusy(false); throw new Error('Não foi possível abrir o arquivo. Selecione-o novamente.'); }
  if (S.worker !== worker) return;
  worker.postMessage({action:'open', name:file.name, encoding:$('#purchase-encoding').value, buffer,...(guided ? {automatic:true,reportType,companyCode:S.clients.find(c => c._id === S.company)?.code,calculationVersion:S.resume?.calculationVersion || (S.resume ? 'Q_V1' : 'NET_V2')} : {})}, [buffer]);
}
function showReview(review) {
  if (guided) { showGuidedReview(review).catch(e => { setBusy(false); error(e); }); return; }
  S.review = review; status('');
  const company = S.clients.find(c => c._id === S.company);
  const repairs = Array.isArray(review.repairs) ? review.repairs : [];
  const repairNotice = repairs.length ? `<div class="warning info purchase-repairs"><strong>${number(review.repairedCount ?? repairs.length)} linha(s) alinhada(s) automaticamente</strong><p>Separadores dentro da descrição foram reconhecidos. Os valores originais foram preservados; a despesa acessória (Z) continua fora da fórmula.</p><p>Linhas: ${repairs.map(item => number(item.line)).join(', ')}.</p></div>` : '';
  if (review.errors.length || !review.rows.length) {
    $('#purchase-review').innerHTML = `<div class="warning purchase-validation"><h3>Revise o arquivo antes de importar</h3>${repairNotice}<p>${number(review.errors.length)} linha(s) com pendências. Nenhuma linha foi enviada.</p>${review.errors.length ? `<ul>${review.errors.slice(0,20).map(e => `<li>Linha ${number(e.line)}: ${esc(e.message)}</li>`).join('')}</ul>${review.errors.length > 20 ? '<p>Exibindo as primeiras 20 pendências. Corrija o arquivo e valide novamente.</p>' : ''}` : '<p>Não há linhas de dados após o cabeçalho selecionado.</p>'}</div>`;
    return;
  }
  const periodNotice = review.period ? `<div class="warning info purchase-validation"><strong>Período identificado pela coluna H: ${esc(review.period.startMonth)} a ${esc(review.period.endMonth)} · ${number(review.period.months)} ${review.period.months===1?'mês':'meses'}</strong><p>Primeira data: ${esc(review.period.startDate)} · última data: ${esc(review.period.endDate)}.${review.period.missingMonths?.length ? ' Meses sem lançamentos dentro do intervalo: '+review.period.missingMonths.map(esc).join(', ')+'.' : ' Todos os meses do intervalo possuem ao menos um lançamento.'}</p></div>` : '';
  $('#purchase-review').innerHTML = `<div class="purchase-section"><h2>Confira antes de importar</h2>${repairNotice}${periodNotice}<p class="hint mt">Empresa: <strong>${esc(company?.code || 'Sem código')} · ${esc(company?.name)}</strong></p><div class="import-totals">${[[`Linhas de ${reportLower}`, review.rows.length], ['CNPJs únicos', review.uniqueCnpjs], ['Linhas sem CNPJ válido', review.nonCnpjLines]].map(([l,v]) => `<div><b>${number(v)}</b><span>${l}</span></div>`).join('')}<div><b>${money(review.totalCents)}</b><span>${review.calculationVersion === 'Q_V1' ? 'Soma de Q · regra original' : 'Q − Y + AA − AB · novo total'}</span></div>${sales ? `<div><b>${money(review.balanceCents)}</b><span>Saldo líquido após devoluções</span></div>` : ''}</div><div class="warning info purchase-validation">${groupingHelp} Todos os valores participam dos percentuais; somente CNPJs válidos são consultados na API. O retorno original fica preservado nos detalhes.</div><div class="purchase-preview"><table><thead><tr><th>Documento</th><th>${partyHeading}</th><th>Quantidade</th><th>Q · Valor bruto</th><th>Y · Desconto</th><th>AA · Frete</th><th>AB · Abatimento</th>${sales ? '<th>Operação</th>' : ''}<th>${review.calculationVersion === 'Q_V1' ? 'Total Q · original' : 'Novo total'}</th>${sales ? '<th>Saldo</th>' : ''}</tr></thead><tbody>${review.rows.slice(0,8).map(r => `<tr><td>${esc(r.document || 'Ausente')}</td><td>${esc(r.name || 'Não informada')}</td><td>${esc(r.quantity)}</td><td>${money(r.grossCents ?? r.totalCents)}</td><td>${review.calculationVersion === 'Q_V1' ? '—' : money(r.discountCents)}</td><td>${review.calculationVersion === 'Q_V1' ? '—' : money(r.freightCents)}</td><td>${review.calculationVersion === 'Q_V1' ? '—' : money(r.abatementCents)}</td>${sales ? `<td>${esc(operationLabels[r.operation] || 'Outras')}</td>` : ''}<td>${money(r.totalCents)}</td>${sales ? `<td>${money(r.balanceCents)}</td>` : ''}</tr>`).join('')}</tbody></table></div><button id="purchase-confirm" class="primary mt">Confirmar empresa e consultar ${number(review.uniqueCnpjs)} CNPJs</button></div>`;
  $('#purchase-confirm').onclick = () => upload().catch(error);
}

async function showGuidedReview(review) {
  S.review = review; $('#purchase-file-preview').innerHTML = ''; status('');
  if (review.errors.length || !review.rows.length) {
    setBusy(false);
    $('#purchase-review').innerHTML = `<div class="warning purchase-validation"><h3>Não foi possível importar este arquivo</h3><p>Nenhuma linha foi enviada. Corrija as pendências e selecione o arquivo novamente.</p>${review.errors.length ? `<ul>${review.errors.slice(0,20).map(item => `<li>Linha ${number(item.line)}: ${esc(item.message)}</li>`).join('')}</ul>${review.errors.length > 20 ? `<p>${number(review.errors.length)} pendências no total; exibindo as primeiras 20.</p>` : ''}` : '<p>O relatório não contém linhas de dados.</p>'}</div>`;
    return;
  }
  const generation = await api('/api/v4/generations/' + encodeURIComponent(S.generation));
  const company = generation.companies.find(item => item.clientId === S.company);
  if (!company) throw new Error('A empresa não pertence mais a esta geração. Abra o Histórico para conferir.');
  const other = sales ? company.purchase : company.sales;
  if (other?.status === 'COMPLETED') assertMatchingPurchaseCompetences(review.period, other.reportPeriod);
  S.generationDetails = generation;
  setBusy(false);
  const repairs = review.repairedCount || 0;
  $('#purchase-review').innerHTML = `${repairs ? `<p class="hint purchase-repairs">${number(repairs)} linha(s) alinhada(s) automaticamente, preservando os valores originais.</p>` : ''}<button id="purchase-confirm" class="primary" hidden>Retomar envio deste relatório</button>`;
  $('#purchase-confirm').onclick = () => upload().catch(error);
  status('Arquivo reconhecido. Importando e iniciando a consulta…');
  upload().catch(error);
}

async function upload() {
  if (!S.review || S.review.errors.length || S.busy || !writable()) return;
  clearError(); stopProcessing(); S.seq++; S.rowsSeq++;
  if (S.resume && (S.file.name !== S.resume.fileName || S.review.rows.length !== S.resume.expectedRows)) throw new Error('Para retomar, selecione o mesmo arquivo, com o mesmo nome e número de linhas. Para substituir os dados, cancele este relatório primeiro.');
  S.pending ??= {importId:S.resume?._id || crypto.randomUUID(), clientId:S.company, fileName:S.file.name, rows:S.review.rows, offset:0};
  const pending = S.pending, button = $('#purchase-confirm');
  setBusy(true); button.disabled = true;
  try {
    await api(S.generation ? `/api/v4/generations/${S.generation}/${sales ? 'sales' : 'purchases'}` : path(), 'POST', {importId:pending.importId, clientId:pending.clientId, fileName:pending.fileName, expectedRows:pending.rows.length, type:reportType});
    while (pending.offset < pending.rows.length) {
      const d = await api(path(`/${pending.importId}/rows`), 'POST', {offset:pending.offset, rows:pending.rows.slice(pending.offset, pending.offset + 250)});
      const nextOffset = Math.min(pending.rows.length, pending.offset + 250);
      if (d.uploaded < nextOffset) throw new Error('O envio não avançou. Clique em retomar para continuar o mesmo relatório.');
      pending.offset = nextOffset;
      status(`${number(pending.offset)} / ${number(pending.rows.length)} linhas enviadas…`);
    }
    await api(path(`/${pending.importId}/finalize`), 'POST', {});
    S.pending = null; S.resume = null; setBusy(false); button.disabled = true; button.textContent = 'Relatório importado';
    status('Relatório salvo. Consultando os CNPJs únicos…');
    await loadHistory(1); await openJob(pending.importId, true);
  } catch (e) {
    button.textContent = 'Retomar envio deste relatório'; button.disabled = false; button.hidden = false;
    status('O progresso salvo será retomado. Mantenha esta página aberta para reenviar somente o que falta.');
    throw e;
  } finally { setBusy(false); }
}

async function openJob(id, auto = false) {
  if (S.busy || S.pending) return;
  stopProcessing(); const seq = ++S.seq; S.rowsSeq++; clearError();
  $('#purchase-report-view').innerHTML = `<div class="initial">Carregando relatório de ${reportLower}…</div>`;
  const job = await api(path('/' + encodeURIComponent(id)));
  if (seq !== S.seq) return;
  if (job.clientId !== S.company) throw new Error('Este relatório pertence a outra empresa. Selecione a empresa correspondente.');
  if (S.generation && job.generationId !== S.generation) throw new Error('Este relatório não pertence à geração selecionada.');
  S.job = job; S.resume = job.status === 'UPLOADING' ? job : null; S.summary = null; S.page = 1; S.status = 'ALL'; S.view = 'suppliers';
  history.replaceState(null, '', '/purchases.html?' + urlParams({job:job._id}));
  await renderJob(seq);
  if (auto && S.job.status === 'PROCESSING') { S.paused = false; scheduleProcess(seq); }
}
function jobTitle(job) {
  return `<div class="purchase-view-title purchase-section"><div class="eyebrow">RELATÓRIO DE ${reportName.toUpperCase()}</div><h2>${esc(job.clientCode || 'Sem código')} · ${esc(job.clientName)}</h2><p class="purchase-file">${esc(job.fileName)}</p><p class="hint purchase-meta">Importado em ${date(job.createdAt)}${job.completedAt ? ' · Concluído em ' + date(job.completedAt) : ''}<br>Identificação da consulta: ${esc(job._id)}</p></div>`;
}
async function renderJob(seq = S.seq) {
  const job = S.job;
  $('#purchase-next-step').innerHTML = ''; renderFlow();
  if ($('#purchase-import')) $('#purchase-import').hidden = !!S.generation && ['PROCESSING','COMPLETED'].includes(job.status);
  if (job.status === 'COMPLETED') {
    const summary = await api(path(`/${job._id}/summary`));
    if (seq !== S.seq) return;
    S.summary = summary; renderSummary(); if (!guided) await loadRows(1); await renderNextStep(seq); return;
  }
  if (guided) { renderGuidedJob(seq); return; }
  $('#purchase-report-view').innerHTML = `${jobTitle(job)}<section class="card stack"><div class="purchase-split"><h2>${esc(jobLabels[job.status] || job.status)}</h2><span class="badge">${number(job.uploaded)} linhas importadas</span></div>${job.status === 'PROCESSING' ? `<p>${number(job.received)} / ${number(job.summary?.unique)} CNPJs com consulta concluída.</p><progress class="purchase-progress" value="${Number(job.received || 0)}" max="${Math.max(1, Number(job.summary?.unique || 0))}"></progress><p class="hint">Mantenha esta tela aberta para consultar. Você pode pausar e voltar ao histórico para retomar. Cada CNPJ válido é consultado uma vez neste relatório.</p>${writable() ? '<div class="row wrap"><button id="purchase-process" class="primary">Consultar / retomar</button><button id="purchase-pause">Pausar nesta tela</button></div>' : ''}<p id="purchase-process-status" class="hint" role="status"></p>` : job.status === 'UPLOADING' ? `<p>Selecione novamente o arquivo <strong>${esc(job.fileName)}</strong> na área de importação e confira as colunas. As partes já salvas serão verificadas; somente as pendências serão adicionadas.</p><p class="hint">${job.calculationVersion === 'NET_V2' ? 'Esta importação usa Q − Y + AA − AB.' : 'Este histórico usa a regra original Q. Para aplicar a regra nova, cancele este relatório e importe novamente.'}</p>` : '<p>Este relatório foi cancelado. Os registros concluídos foram preservados no histórico; ele não gera indicadores finais.</p>'}${!['COMPLETED','CANCELLED'].includes(job.status) && writable() ? '<button id="purchase-cancel" class="danger">Cancelar relatório</button>' : ''}</section>`;
  if ($('#purchase-process')) $('#purchase-process').onclick = () => { S.paused = false; clearError(); process(seq); };
  if ($('#purchase-pause')) $('#purchase-pause').onclick = () => { stopProcessing(); $('#purchase-process-status').textContent = 'Pausado nesta tela. Uma chamada já iniciada pode terminar; o progresso fica salvo.'; };
  if ($('#purchase-cancel')) $('#purchase-cancel').onclick = async () => {
    if (!confirm('Cancelar este relatório? Os registros já salvos ficam no histórico, sem emitir indicadores finais.')) return;
    stopProcessing();
    try { await api(path(`/${job._id}/cancel`), 'POST', {}); await openJob(job._id); await loadHistory(S.historyPage); } catch (e) { error(e); }
  };
}
function renderGuidedJob(seq) {
  const job = S.job;
  if (job.status === 'UPLOADING') {
    $('#purchase-report-view').innerHTML = `<section class="card purchase-guided-message"><h2>Retome este relatório</h2><p>Selecione o mesmo arquivo <strong>${esc(job.fileName)}</strong>. O envio continuará do progresso salvo.</p>${writable() ? '<button id="purchase-cancel" class="mt">Trocar arquivo</button>' : ''}</section>`;
    wireGuidedCancel();
    return;
  }
  if (job.status !== 'PROCESSING') {
    $('#purchase-report-view').innerHTML = `<section class="card purchase-guided-message"><h2>${esc(jobLabels[job.status] || job.status)}</h2><p>Adicione outro arquivo para substituir este relatório.</p></section>`;
    return;
  }
  $('#purchase-report-view').innerHTML = `<section class="card purchase-guided-processing"><div class="eyebrow">RELATÓRIO DE ${reportName.toUpperCase()}</div><h2>Consultando os CNPJs</h2><p>${esc(job.fileName)}</p><progress class="purchase-progress" value="${Number(job.received || 0)}" max="${Math.max(1,Number(job.summary?.unique || 0))}"></progress><strong>${number(job.received)} de ${number(job.summary?.unique)} concluídos</strong><p class="hint">Mantenha esta tela aberta. O progresso fica salvo no Histórico.</p>${writable() ? '<div class="purchase-guided-controls"><button id="purchase-process">Retomar consulta</button><button id="purchase-pause">Pausar</button><button id="purchase-cancel">Trocar arquivo</button></div>' : ''}<p id="purchase-process-status" class="purchase-status" role="status"></p></section>`;
  if ($('#purchase-process')) {
    $('#purchase-process').disabled = !S.paused || S.running;
    $('#purchase-process').onclick = () => { S.paused = false; clearError(); process(seq); };
    $('#purchase-pause').onclick = () => { stopProcessing(); $('#purchase-process').disabled = S.running; $('#purchase-process-status').textContent = 'Consulta pausada. Você pode retomá-la quando quiser.'; };
  }
  wireGuidedCancel();
}
function wireGuidedCancel() {
  const button = $('#purchase-cancel');
  if (!button) return;
  button.onclick = async () => {
    if (S.busy || S.pending || !confirm('Cancelar este relatório para escolher outro arquivo? O progresso atual ficará cancelado no histórico.')) return;
    stopProcessing(); button.disabled = true;
    try { await api(path(`/${S.job._id}/cancel`), 'POST', {}); resetPreview(); await openJob(S.job._id); } catch (e) { button.disabled = false; error(e); }
  };
}
function scheduleProcess(seq) {
  clearTimeout(S.timer);
  if (!S.paused && S.job?.status === 'PROCESSING' && seq === S.seq && writable()) S.timer = setTimeout(() => process(seq), Math.max(700, Number(S.job.nextPollMs || 1200)));
}
async function process(seq) {
  if (seq !== S.seq || S.paused) return;
  if (S.running) { scheduleProcess(seq); return; }
  S.running = true; if ($('#purchase-process')) $('#purchase-process').disabled = true;
  if ($('#purchase-process-status')) $('#purchase-process-status').textContent = 'Consultando a fonte. Aguarde…';
  try {
    await api(path(`/${S.job._id}/process`), 'POST', {});
    if (seq !== S.seq) return;
    const job = await api(path(`/${S.job._id}`));
    if (seq !== S.seq) return;
    S.job = job; await renderJob(seq);
    if (job.status === 'COMPLETED') { stopProcessing(); await loadHistory(1); }
  } catch (e) { if (seq === S.seq) { stopProcessing(); error(e); } }
  finally { S.running = false; if (seq === S.seq) { if ($('#purchase-process')) $('#purchase-process').disabled = false; scheduleProcess(seq); } }
}

function reportingGroups(m) {
  return m.reportingGroups || [];
}
function composition(m) {
  if (!m.components) return '<div class="warning info">Histórico com a regra original: soma da coluna Q. Os valores deste relatório foram preservados. Para aplicar Q − Y + AA − AB, inicie uma nova geração e importe o arquivo novamente.</div>';
  const c = m.components;
  return `<section class="card purchase-calculation"><div class="eyebrow">MEMÓRIA DE CÁLCULO</div><h2>Como chegamos ao novo total</h2><div class="purchase-equation">Q <span>−</span> Y <span>+</span> AA <span>−</span> AB <span>=</span> Novo total</div><div class="purchase-components">${[['Q · Valor bruto',c.grossCents],['− Y · Desconto',c.discountCents],['+ AA · Frete',c.freightCents],['− AB · Abatimento não tributado',c.abatementCents],['= Novo total',c.totalCents]].map(([label,value])=>`<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</div><p class="hint mt">Z · Despesa acessória: ${money(c.accessoryCents)} — informativa, não participa da fórmula. A quantidade (P) é preservada e não multiplica o total.</p></section>`;
}
function operationSummary(m) {
  if (!sales || !m.operationTotals?.length) return '';
  const order=['VENDA','SERVICO','DEVOLUCAO','OUTRAS'];
  const items=order.map(key=>m.operationTotals.find(item=>item.operation===key) || {operation:key,lines:0,totalCents:0,balanceCents:0});
  return `<section class="card purchase-section"><div class="card-header"><h2>Vendas, serviços, devoluções e outras</h2><p>A Natureza/CFOP é reduzida sempre aos 4 primeiros dígitos (ex.: 900001 → 9000). A descrição complementa Venda/Serviço/Outras; devoluções sempre entram negativas no saldo.</p></div><div class="purchase-cards purchase-cards-sales">${items.map(item=>`<article class="purchase-group"><span>${esc(operationLabels[item.operation])}</span><strong>${money(item.balanceCents)}</strong><small>${number(item.lines)} linhas<br>Valor antes do sinal: ${money(item.totalCents)}</small></article>`).join('')}</div></section>`;
}
function renderSummary() {
  const m = S.summary, t = m.totals, groups = reportingGroups(m), net = m.calculationVersion === 'NET_V2';
  if (guided) { renderGuidedSummary(m); return; }
  $('#purchase-report-view').innerHTML = `${jobTitle(S.job)}
    <section class="card purchase-hero"><div><h2>Total de ${reportLower} do relatório</h2><strong class="purchase-money">${money(t.totalCents)}</strong><p>${number(t.lines)} linhas · ${net ? 'Q − Y + AA − AB' : 'soma de Q · regra original'}</p></div><div class="purchase-stat"><h2>Documentos no relatório</h2><strong class="purchase-money">${number(t.uniqueDocuments)}</strong><p>${number(t.uniqueCnpjs)} CNPJs válidos · ${number(t.nonCnpjDocumentCount)} demais documentos</p></div></section>
    ${operationSummary(m)}<div class="purchase-cards ${sales ? 'purchase-cards-sales' : ''}" role="group" aria-label="Resultados por enquadramento">${groups.map(g => `<button class="purchase-group" data-status="${esc(g.status)}" aria-pressed="false"><span>${esc(groupLabels[g.status] || labels[g.status])}</span><strong>${money(g.totalCents)}</strong><span class="purchase-bar" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, Number(g.valuePercent || 0)))}%"></span></span><small><b>${percent(g.valuePercent)}</b> do valor total do arquivo<br><b>${number(g.count)} documentos · ${percent(g.countPercent)}</b> dos documentos únicos<br>${number(g.lines)} linhas de ${reportLower}${g.status === 'NAO_OPTANTE' ? `<br>Inclui ${number(g.unconfirmedCount)} não confirmado(s) · ${money(g.unconfirmedCents)}<br>${sales ? 'Demais documentos (sem CPF)' : 'CPF e demais documentos'}: ${money((m.excluded || []).filter(e => !sales || e.documentKind !== 'CPF').reduce((sum,e) => sum + Number(e.totalCents || 0), 0))}` : ''}</small></button>`).join('')}</div>
    ${composition(m)}
    <section class="card"><h2>Como ler os percentuais</h2><p class="hint purchase-meta">Documentos: quantidade do grupo ÷ ${number(t.uniqueDocuments)} documentos únicos do arquivo.<br>Valores: soma do ${net ? 'novo total' : 'valor de Q'} do grupo ÷ ${money(t.totalCents)} do arquivo completo.</p><p class="hint purchase-meta">Documentos repetidos contam uma vez, mas todas as linhas entram no valor. Cada linha sem documento conta como um registro próprio. ${groupingHelp}</p><details class="purchase-source-details"><summary>Detalhes dos documentos e da classificação</summary><p class="hint mt">${number(t.nonCnpjLines)} linhas com CPF, CNO, documento inválido ou ausente participam dos valores e percentuais. ${sales ? 'CPFs ficam em seu próprio grupo; os demais entram em Não optante.' : 'Todos entram no grupo fora do Simples.'} Esses documentos não são enviados à API de CNPJ.</p><p class="hint mt">${m.excluded?.length ? m.excluded.map(e => `${esc(kinds[e.documentKind] || e.documentKind)}: ${number(e.lines)} linhas · ${money(e.totalCents)}`).join('<br>') : 'Todos os documentos do relatório são CNPJs consultáveis.'}</p><p class="hint mt">Resultados não confirmados também integram Não optante. A classificação e o motivo originais da fonte continuam nos detalhes de cada registro.</p></details></section>
    <section class="card purchase-section"><div class="purchase-split"><div><h2>Relatório e arquivos</h2><p class="hint mt">Resumo completo em PDF e linhas detalhadas em CSV, com quantidade e valor.</p></div><div class="purchase-view-actions"><button id="purchase-pdf" class="primary">Baixar resumo PDF</button><button id="purchase-print">Imprimir resumo</button></div></div><p id="purchase-download-status" class="purchase-status" role="status"></p><p class="purchase-print-note">Resumo financeiro completo. A relação detalhada de linhas está disponível no CSV do relatório.</p></section>
    <section class="card purchase-section" id="purchase-results"><div class="card-header"><h2>Explore os ${parties} e valores</h2><p>Compare os documentos agrupados ou confira cada linha do arquivo importado.</p></div><div class="purchase-toolbar"><label>Enquadramento<select id="purchase-status-filter">${Object.entries(labels).map(([key,label]) => `<option value="${key}" ${key === S.status ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label>Visualização<select id="purchase-view-filter"><option value="suppliers">Documentos agrupados</option><option value="lines">Linhas do relatório</option></select></label></div><div id="purchase-result-list"></div><div class="pagination"><button id="purchase-prev">Anterior</button><span id="purchase-page"></span><button id="purchase-next">Próxima</button></div><div class="purchase-controls mt"><label>Parte do CSV (linhas do grupo)<select id="purchase-csv-part"></select></label><button id="purchase-csv">Baixar CSV das linhas</button></div><p id="purchase-csv-note" class="hint mt"></p></section>
    <div class="warning info purchase-disclosure">Fonte dos CNPJs: Minha Receita. ${groupingHelp} O resultado original da fonte é preservado; esse agrupamento não comprova uma situação fiscal.</div>`;
  document.querySelectorAll('.purchase-group[data-status]').forEach(b => b.onclick = () => filterStatus(b.dataset.status));
  $('#purchase-status-filter').onchange = () => filterStatus($('#purchase-status-filter').value);
  $('#purchase-view-filter').onchange = () => { S.view = $('#purchase-view-filter').value; loadRows(1).catch(error); };
  $('#purchase-prev').onclick = () => loadRows(S.page - 1).catch(error);
  $('#purchase-next').onclick = () => loadRows(S.page + 1).catch(error);
  $('#purchase-pdf').onclick = () => downloadPdf().catch(error);
  $('#purchase-csv').onclick = () => downloadCsv().catch(error);
  $('#purchase-print').onclick = () => window.print();
  updateCsvParts();
}
function renderGuidedSummary(m) {
  const t = m.totals;
  $('#purchase-report-view').innerHTML = `<section class="purchase-guided-summary" aria-labelledby="purchase-summary-title"><div class="purchase-guided-summary-title"><span class="purchase-guided-success" aria-hidden="true">✓</span><div><div class="eyebrow">CONSULTA CONCLUÍDA</div><h2 id="purchase-summary-title">Resumo de ${reportLower}</h2><p>${esc(S.job.clientCode || 'Sem código')} · ${esc(S.job.clientName)}</p></div></div><section class="card purchase-hero"><div><h2>Total de ${reportLower} do relatório</h2><strong class="purchase-money">${money(t.totalCents)}</strong><p>${number(t.lines)} linhas importadas${sales ? ' · saldo já líquido de devoluções' : ''}</p></div><div class="purchase-stat"><h2>Documentos no relatório</h2><strong class="purchase-money">${number(t.uniqueDocuments)}</strong><p>${number(t.uniqueCnpjs)} CNPJs válidos</p></div></section><div class="purchase-cards ${sales ? 'purchase-cards-sales' : ''}" role="group" aria-label="Resultados por enquadramento">${reportingGroups(m).map(group => `<article class="purchase-group" data-status="${esc(group.status)}"><span>${esc(groupLabels[group.status] || labels[group.status])}</span><strong>${money(group.totalCents)}</strong><span class="purchase-bar" aria-hidden="true"><span style="width:${Math.min(100,Math.max(0,Number(group.valuePercent || 0)))}%"></span></span><small>${percent(group.valuePercent)} do valor total do arquivo<br>${number(group.count)} documentos · ${percent(group.countPercent)} dos documentos únicos${group.status === 'NAO_OPTANTE' ? `<br>Inclui ${number(group.unconfirmedCount)} não confirmado(s)` : ''}</small></article>`).join('')}</div><p class="hint purchase-guided-note">${sales ? 'CPF aparece separado nas vendas. ' : ''}Não confirmados integram o grupo gerencial Não optante. Documentos repetidos contam uma vez; seus valores são somados.</p><a class="purchase-guided-detail" href="/purchases.html?${new URLSearchParams({generation:S.generation,client:S.company,type:reportType,job:S.job._id})}">Ver relatório completo e baixar arquivos</a></section>`;
}
function filterStatus(value) {
  S.status = value; $('#purchase-status-filter').value = value;
  document.querySelectorAll('.purchase-group[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === value)));
  updateCsvParts(); loadRows(1).catch(error);
}
function groupLines() {
  if (S.status === 'ALL') return S.summary.totals.lines;
  return reportingGroups(S.summary).find(g => g.status === S.status)?.lines || 0;
}
function updateCsvParts() {
  const lines = groupLines(), parts = Math.max(1, Math.ceil(lines / 2000));
  $('#purchase-csv-part').innerHTML = Array.from({length:parts}, (_,i) => `<option value="${i + 1}">${i + 1} / ${parts}</option>`).join('');
  $('#purchase-csv-note').textContent = `${number(lines)} linhas neste grupo. CSV em partes de até 2.000 linhas; baixe todas as ${parts} parte(s) para obter a relação completa. O PDF sempre contém o resumo completo da empresa e da consulta.`;
  $('#purchase-csv').disabled = !lines;
}
async function loadRows(page) {
  const ticket = ++S.rowsSeq, seq = S.seq, view = S.view;
  $('#purchase-result-list').innerHTML = '<p>Carregando resultados…</p>'; $('#purchase-prev').disabled = true; $('#purchase-next').disabled = true;
  const d = await api(path(`/${S.job._id}/${view === 'lines' ? 'lines' : 'results'}?` + new URLSearchParams({page, status:S.status})));
  if (seq !== S.seq || ticket !== S.rowsSeq) return;
  S.page = page; S.total = d.total;
  $('#purchase-result-list').innerHTML = d.items.length ? `<div class="purchase-table"><table><thead><tr><th>Documento</th><th>${partyHeading}</th><th>Enquadramento</th>${sales ? '<th>Operação</th>' : ''}<th>${view === 'lines' ? 'Quantidade (P)' : 'Linhas'}</th><th class="numeric">${sales ? 'Saldo da operação' : S.summary.calculationVersion === 'NET_V2' ? 'Novo total' : 'Total (Q) · original'}</th><th>Consultado em</th></tr></thead><tbody>${d.items.map(r => `<tr><td>${esc(r.cnpj ? formatCnpj(r.cnpj) : r.document || 'Ausente')}<small>${esc(kinds[r.documentKind] || '')}</small></td><td>${esc(r.submittedName || r.name || 'Não informada')}<small>${r.details?.name ? 'API: ' + esc(r.details.name) : ''}</small></td><td>${esc(labels[r.reportingStatus || (sales && r.documentKind === 'CPF' ? 'CPF' : r.status === 'OPTANTE' ? 'OPTANTE' : 'NAO_OPTANTE')])}<small>${r.status === 'NAO_CONFIRMADO' ? 'Origem: não confirmado. ' : ''}${esc(r.reason || '')}</small></td>${sales ? `<td>${esc(operationLabels[r.operation] || 'Outras')}</td>` : ''}<td class="purchase-quantity">${view === 'lines' ? esc(r.quantity ?? '—') : number(r.occurrences ?? 1)}</td><td class="numeric">${money(r.reportingCents ?? r.totalCents)}</td><td>${r.documentKind === 'CNPJ' || r.cnpj ? date(r.checkedAt) : 'Não se aplica'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="purchase-empty"><h3>Nenhum resultado neste grupo</h3><p>Selecione outro enquadramento para ver os demais dados do relatório.</p></div>';
  const parts = Math.max(1, Math.ceil(d.total / (d.pageSize || 100)));
  $('#purchase-page').textContent = `${page} / ${parts} · ${number(d.total)} ${view === 'lines' ? 'linhas' : 'registros'}`;
  $('#purchase-prev').disabled = page <= 1; $('#purchase-next').disabled = page >= parts;
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function downloadPdf() {
  const button = $('#purchase-pdf'), seq = S.seq;
  button.disabled = true; clearError(); $('#purchase-download-status').textContent = 'Gerando o resumo em PDF…';
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const r = await fetch('/api/reports', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'pdf', jobId:S.job._id, clientId:S.job.clientId, layout:'summary', status:'ALL', kind:'ALL', part:1}), signal:controller.signal});
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Não foi possível gerar o PDF. Confira a função de relatórios.'); }
    const name = r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `maximum_${reportLower}_${S.job._id}.pdf`;
    saveBlob(await r.blob(), name); if (seq === S.seq) $('#purchase-download-status').textContent = 'Resumo PDF gerado com os totais completos.';
  } catch (e) {
    if (seq === S.seq) $('#purchase-download-status').textContent = 'PDF não gerado. Você pode tentar novamente.';
    if (e.name === 'AbortError') throw new Error('A geração do PDF excedeu o tempo de resposta. Tente novamente.');
    throw e;
  } finally { clearTimeout(timeout); button.disabled = false; }
}
async function downloadCsv() {
  const button = $('#purchase-csv'), seq = S.seq; button.disabled = true; clearError();
  try {
    const d = await api(path(`/${S.job._id}/csv`), 'POST', {part:Number($('#purchase-csv-part').value), status:S.status});
    saveBlob(new Blob([d.content], {type:d.mimeType || 'text/csv;charset=utf-8'}), d.fileName);
    if (seq === S.seq) $('#purchase-download-status').textContent = `CSV gerado: parte ${d.part} de ${d.parts}.`;
  } finally { button.disabled = false; }
}
async function boot() {
  try {
    if (!['PURCHASES','SALES'].includes(reportType)) throw new Error('Tipo de relatório inválido. Selecione Compras ou Vendas na geração.');
    document.title = `${reportName} · Maximum CNPJ`;
    $('.crumb').textContent = `Maximum CNPJ / ${reportName}`;
    $('.page-heading .eyebrow').textContent = `${reportName.toUpperCase()} · SIMPLES NACIONAL`;
    $('.page-heading h1').textContent = guided ? `Vamos ler suas ${reportLower}.` : sales ? 'Para quem sua empresa vende?' : 'De quem sua empresa compra?';
    $('.page-heading p').textContent = guided ? 'Um arquivo por etapa, com os resultados organizados para você.' : `Selecione uma empresa e descubra a participação de cada enquadramento nas suas ${reportLower}.`;
    S.user = (await api('/api/auth/session')).user;
    if (!S.user || S.user.mustChangePassword) {
      $('#purchase-app').innerHTML = `<section class="card stack"><h2>${S.user?.mustChangePassword ? 'Redefina sua senha para continuar' : 'Entre para continuar'}</h2><p>${S.user?.mustChangePassword ? 'A senha inicial precisa ser alterada antes de consultar empresas e relatórios.' : `O módulo de ${reportLower} usa a mesma conta e sessão do painel.`}</p><a href="/" class="report-links">Acessar painel</a></section>`; return;
    }
    const query = new URLSearchParams(location.search), jobId = query.get('job'), client = query.get('client');
    S.generation = query.get('generation');
    if (S.generation && !/^[a-f0-9-]{36}$/i.test(S.generation)) throw new Error('Identificação da geração inválida.');
    if (guided && (!S.generation || !client)) throw new Error('Selecione a empresa em Iniciar para abrir esta etapa.');
    mountNavigation(S.user,S.generation ? 'start' : 'history');
    S.clients = (await api('/api/v4/clients')).items; shell();
    let selected = client;
    if (jobId && /^[a-f0-9-]{36}$/i.test(jobId)) {
      const job = await api(path('/' + encodeURIComponent(jobId)));
      if (guided && job.clientId !== client) throw new Error('Este relatório não pertence à empresa selecionada.');
      selected = job.clientId; if (S.generation && job.generationId !== S.generation) throw new Error('Este relatório não pertence à geração selecionada.');
    }
    if (S.generation) {
      const generation = await api('/api/v4/generations/' + encodeURIComponent(S.generation));
      S.generationDetails = generation;
      if (!generation.companies.some(c => c.clientId === selected)) throw new Error('A empresa não pertence a esta geração. Abra a geração pelo Histórico.');
      if (guided && !(generation.requiredReports || ['PURCHASES']).includes(reportType)) throw new Error('Este tipo de relatório não foi selecionado nesta geração. Abra a geração para incluí-lo.');
      if (writable() && !(generation.requiredReports || ['PURCHASES']).includes(reportType)) {
        $('#purchase-import').insertAdjacentHTML('afterbegin', `<div class="warning info">Ao confirmar esta importação, ${reportLower} será incluído para todas as empresas desta geração. O PDF completo ficará disponível quando todos os relatórios estiverem concluídos.</div>`);
      }
    }
    if (selected && S.clients.some(c => c._id === selected)) {
      $('#purchase-company').value = selected; await companyChanged();
      const linkedCompany = S.generationDetails?.companies.find(item => item.clientId === selected);
      const currentJob = jobId || (guided ? sales ? linkedCompany?.salesJobId : linkedCompany?.purchaseJobId : null);
      if (currentJob && /^[a-f0-9-]{36}$/i.test(currentJob)) await openJob(currentJob, guided && writable());
    }
  } catch (e) { error(e); }
}
window.addEventListener('beforeunload', e => { if (S.busy || S.pending) { e.preventDefault(); e.returnValue = ''; } });
boot();
