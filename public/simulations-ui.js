import {mountNavigation,icon} from './navigation.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null?'—':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=value=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
const params=new URLSearchParams(location.search);
const state={page:Math.max(1,Math.min(100000,Number(params.get('page'))||1)),clientId:params.get('clientId')||'',user:null,controller:null,sequence:0,items:[],deleteTarget:null,deleteTrigger:null,deleting:false,search:params.get('search')||'',year:['2027','2028'].includes(params.get('year'))?params.get('year'):''};
async function api(path,signal,options={}){
 const response=await fetch(path,{credentials:'same-origin',...options,signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(response.status===401?'Sua sessão expirou. Entre novamente para ver as simulações.':data?.message||'Não foi possível concluir a operação. Tente novamente.');
 if(!data)throw new Error('O servidor retornou uma resposta incompleta. Tente novamente.');
 return data;
}
const canDelete=()=>['admin','operator'].includes(state.user?.role);
function filters(){return new URLSearchParams({page:String(state.page),...(state.clientId?{clientId:state.clientId}:{}),...(state.search?{search:state.search}:{}),...(state.year?{year:state.year}:{})});}
function layout(){
 const writable=['admin','operator'].includes(state.user.role);
 $('#simulations-app').innerHTML=`<div class="history-hero"><div><div class="eyebrow">SIMULADOR · HISTÓRICO</div><h1>Histórico de simulações</h1><p>Consulte os valores, resultados e detalhes dos cenários salvos.</p></div>${writable?`<a class="history-action primary" href="/generations.html">${icon('start')}Nova simulação</a>`:''}</div><form id="history-filters" class="history-filters"><label for="simulation-search">Buscar simulações<input id="simulation-search" type="search" maxlength="100" autocomplete="off" placeholder="Nome da empresa, código ou título" value="${esc(state.search)}"></label><label for="simulation-year-filter">Ano do cenário<select id="simulation-year-filter"><option value="">Todos os anos</option><option value="2027" ${state.year==='2027'?'selected':''}>2027</option><option value="2028" ${state.year==='2028'?'selected':''}>2028</option></select></label><button type="submit">Buscar</button></form>${state.clientId?'<div class="history-context">Mostrando simulações da empresa selecionada. <a href="/simulations.html">Ver todas as empresas</a></div>':''}<div id="history-feedback" role="status" aria-live="polite"></div><div id="history-results" aria-live="polite"></div>
 <dialog id="delete-simulation-dialog" class="history-delete-dialog" aria-labelledby="delete-simulation-heading" aria-describedby="delete-simulation-description">
  <h2 id="delete-simulation-heading">Excluir simulação definitivamente?</h2><p id="delete-simulation-description">Os dados e resultados desta simulação serão apagados permanentemente. Esta ação não pode ser desfeita. Os relatórios e as outras versões continuam disponíveis.</p>
  <div class="history-delete-target"><strong id="delete-simulation-company"></strong><span id="delete-simulation-title"></span><small id="delete-simulation-year"></small></div>
  <p id="delete-simulation-error" class="history-delete-error" role="alert"></p><p id="delete-simulation-status" role="status" aria-live="polite"></p>
  <div class="history-delete-actions"><button id="delete-simulation-cancel" type="button" autofocus>Cancelar</button><button id="delete-simulation-confirm" type="button">Excluir definitivamente</button></div>
 </dialog>`;
 const dialog=$('#delete-simulation-dialog');
 $('#delete-simulation-cancel').onclick=()=>{if(!state.deleting)dialog.close();};
 $('#delete-simulation-confirm').onclick=()=>void confirmDelete();
 dialog.addEventListener('cancel',event=>{if(state.deleting)event.preventDefault();});
 dialog.addEventListener('close',()=>{state.deleteTarget=null;if(state.deleteTrigger?.isConnected)state.deleteTrigger.focus({preventScroll:true});state.deleteTrigger=null;});
 $('#history-filters').onsubmit=event=>{event.preventDefault();state.search=$('#simulation-search').value.trim();state.year=$('#simulation-year-filter').value;state.page=1;load();};
 $('#simulation-year-filter').onchange=()=>$('#history-filters').requestSubmit();
}
function card(item){return `<article class="history-item" data-simulation-id="${esc(item._id)}"><div class="history-company"><span class="history-company-symbol">${icon('companies')}</span><div><small>EMPRESA ${esc(item.company.code||'SEM CÓDIGO')}</small><h3>${esc(item.company.name)}</h3></div></div><p class="history-title">${esc(item.title||'Simulação tributária')}</p><div class="history-tags"><span class="history-tag">CENÁRIO ${esc(item.year)}</span><span class="history-tag">${esc(item.reportMonths)} ${item.reportMonths===1?'MÊS':'MESES'} NOS RELATÓRIOS</span>${item.manuallyAdjusted?'<span class="history-tag adjusted">VALORES AJUSTADOS</span>':''}</div><div class="history-financials"><div><span>Receita anual estimada</span><strong>${money(item.annualRevenue)}</strong><small>Referência mensal × 12</small></div><div class="best"><span>Maior resultado anual</span><strong>${money(item.bestAnnualProfit)}</strong><small>${esc(item.bestRegimeName||'Sem ranking neste cenário')}</small></div></div><div class="history-item-footer"><p>Salva em ${date(item.createdAt)}<br>Por ${esc(item.createdBy?.name||'Equipe Maximum')}</p><div class="history-item-actions"><a href="/simulator.html?${new URLSearchParams({simulation:item._id})}">Rever simulação →</a>${canDelete()?`<button type="button" class="history-delete" data-delete-simulation="${esc(item._id)}" aria-label="Excluir simulação de ${esc(item.company.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>Excluir</button>`:''}</div></div></article>`;}
function openDelete(id,trigger){
 const item=state.items.find(record=>record._id===id);
 if(!item||!canDelete()||state.deleting)return;
 state.deleteTarget=item;state.deleteTrigger=trigger;
 $('#delete-simulation-company').textContent=item.company.name;
 $('#delete-simulation-title').textContent=item.title||'Simulação tributária';
 $('#delete-simulation-year').textContent=`Cenário ${item.year} · salva em ${date(item.createdAt)}`;
 $('#delete-simulation-error').textContent='';$('#delete-simulation-status').textContent='';
 $('#delete-simulation-dialog').showModal();$('#delete-simulation-cancel').focus();
}
function setDeleting(value){
 state.deleting=value;$('#delete-simulation-confirm').disabled=value;$('#delete-simulation-cancel').disabled=value;
 $('#delete-simulation-confirm').textContent=value?'Excluindo…':'Excluir definitivamente';
 $('#delete-simulation-dialog').setAttribute('aria-busy',String(value));
}
async function confirmDelete(){
 const item=state.deleteTarget;if(!item||state.deleting||!canDelete())return;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 setDeleting(true);$('#delete-simulation-error').textContent='';$('#delete-simulation-status').textContent='Excluindo a simulação…';
 try{
  const result=await api('/api/v4/simulations/'+encodeURIComponent(item._id),controller.signal,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});
  if(result.deleted!==true||result.id!==item._id)throw new Error('A exclusão não foi confirmada. Tente novamente.');
 }catch(error){
  $('#delete-simulation-error').textContent=error.name==='AbortError'?'O servidor demorou a confirmar a exclusão. Tente novamente para conferir o mesmo registro.':error.message;
  $('#delete-simulation-status').textContent='';return;
 }finally{clearTimeout(timer);setDeleting(false);}
 $('#delete-simulation-dialog').close();
 $('#history-feedback').textContent='Simulação excluída definitivamente.';
 await load(true);
}
async function load(focusAfter=false){
 state.controller?.abort();const controller=new AbortController(),ticket=++state.sequence;state.controller=controller;const timer=setTimeout(()=>controller.abort(),55000);
 $('#simulations-error').textContent='';$('#history-results').innerHTML='<div class="history-loading" role="status">Buscando simulações salvas…</div>';history.replaceState(null,'','/simulations.html?'+filters());
 try {
  const data=await api('/api/v4/simulations?'+filters(),controller.signal);if(ticket!==state.sequence)return;
  state.items=data.items;
  const totalPages=Math.max(1,Math.ceil(data.total/data.pageSize));
  if(state.page>totalPages){state.page=totalPages;await load(focusAfter);return;}
  $('#history-results').innerHTML=`<div class="history-results-header"><h2 tabindex="-1">${Number(data.total).toLocaleString('pt-BR')} ${data.total===1?'simulação salva':'simulações salvas'}</h2><span>Mais recentes primeiro · ${data.items.length} nesta página</span></div>${data.items.length?`<div class="history-list">${data.items.map(card).join('')}</div>`:`<section class="history-empty"><h2>${state.search||state.year||state.clientId?'Nenhuma simulação com esses filtros':'Seu histórico começa aqui.'}</h2><p>${state.search||state.year||state.clientId?'Altere a busca ou selecione outro ano para encontrar a análise desejada.':'Gere uma simulação a partir de compras e vendas. Ela será salva aqui com todos os detalhes para você consultar depois.'}</p>${state.search||state.year||state.clientId?'<a class="history-action" href="/simulations.html">Limpar filtros</a>':['admin','operator'].includes(state.user.role)?'<a class="history-action primary" href="/generations.html">Escolher empresa e relatórios</a>':''}</section>`}<div class="history-pager"><button id="history-prev" ${state.page<=1?'disabled':''}>Anterior</button><span>Página ${state.page} de ${totalPages}</span><button id="history-next" ${state.page>=totalPages?'disabled':''}>Próxima</button></div><p class="history-note">O histórico mantém os dados e o resultado de cada simulação no momento em que foi salva. Para testar mudanças, abra uma análise e crie uma nova versão.</p>`;
  $('#history-prev').onclick=()=>{state.page--;load();};$('#history-next').onclick=()=>{state.page++;load();};
  document.querySelectorAll('[data-delete-simulation]').forEach(button=>button.onclick=()=>openDelete(button.dataset.deleteSimulation,button));
  if(focusAfter===true)$('.history-results-header h2')?.focus({preventScroll:true});
 }catch(error){if(ticket!==state.sequence)return;$('#simulations-error').textContent=error.name==='AbortError'?'A busca demorou a responder. Tente novamente.':error.message;$('#history-results').innerHTML='<section class="history-empty"><h2>Não foi possível carregar o histórico.</h2><button id="history-retry" class="history-retry">Tentar novamente</button></section>';$('#history-retry').onclick=load;}
 finally{clearTimeout(timer);}
}
async function boot(){try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);let session;try{session=await api('/api/auth/session',controller.signal);}finally{clearTimeout(timer);}state.user=session.user;mountNavigation(state.user,'simulations');if(!state.user||state.user.mustChangePassword){$('#simulations-app').innerHTML=`<section class="history-empty"><h2>${state.user?.mustChangePassword?'Redefina sua senha para continuar':'Entre para continuar'}</h2><p>As simulações são privadas e usam a mesma conta do painel.</p><a class="history-action primary" href="/">Acessar painel</a></section>`;return;}if(state.clientId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.clientId))throw new Error('Empresa inválida no filtro.');layout();await load();}catch(error){$('#simulations-error').textContent=error.message||'Não foi possível carregar a página.';$('#simulations-app').innerHTML='<section class="history-empty"><a class="history-action" href="/simulations.html">Abrir histórico de simulações</a></section>';}}
boot();
