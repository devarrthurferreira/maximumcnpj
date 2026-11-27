import {analysisRequest} from './analyses-api.js';
import {esc} from './analyses-view.js';
import {formatCnpj} from './domain.js';
import {loadingMarkup} from './ui-loading.js';

const statuses={EMPTY:'Não iniciado',DRAFT:'Rascunho',REVIEW:'A conferir',COMPLETE:'Concluído'};
const choices={ALL:'Todos',COMPLETE:'Concluído',PENDING:'Qualquer pendência',EMPTY:'Não iniciado',DRAFT:'Rascunho',REVIEW:'A conferir'};
const dateFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const dateText=value=>value?dateFormat.format(new Date(value)):'';
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const sectorMatches=(status,filter)=>filter==='ALL'||(filter==='PENDING'?status!=='COMPLETE':status===filter);
const options=Object.entries(choices).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');

function sectorCell(sector){
  const kind=sector.status==='COMPLETE'?' is-ready':sector.status==='REVIEW'?' is-pending':'';
  const detail=[sector.updatedBy,dateText(sector.updatedAt)].filter(Boolean).join(' · ');
  return `<td><span class="analysis-tag${kind}">${esc(statuses[sector.status])}</span>${detail?`<small>${esc(detail)}</small>`:''}</td>`;
}

async function exportExcel(rows){
  const worker=new Worker('/import-worker.js');
  try{
    const blob=await new Promise((resolve,reject)=>{
      worker.onerror=()=>reject(new Error('Falha ao preparar a planilha. Tente novamente.'));
      worker.onmessage=({data})=>data.type==='export'?resolve(data.blob):reject(new Error(data.message||'Falha ao exportar.'));
      const sectorValues=sector=>[statuses[sector.status],sector.updatedBy,dateText(sector.updatedAt)];
      worker.postMessage({action:'export',format:'xlsx',sheetName:'Preenchimento por setor',widths:[13,44,23,12,14,18,27,24,18,27,24],
        headers:['Código','Empresa','CNPJ','Cadastro','Ano do cenário','Fiscal','Última alteração por · Fiscal','Alterado em · Fiscal','Contábil','Última alteração por · Contábil','Alterado em · Contábil'],
        rows:rows.map(row=>[row.code,row.name,formatCnpj(row.cnpj),row.active?'Ativo':'Inativo',row.year,...sectorValues(row.fiscal),...sectorValues(row.accounting)])});
    });
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='Maximum_Preenchimento_Fiscal_Contabil.xlsx';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }finally{worker.terminate();}
}

export async function openSectorReport(host){
  host.innerHTML=loadingMarkup({title:'Carregando o preenchimento por setor…',detail:'Consultando as empresas cadastradas.'});
  const companies=[];
  try{
    let cursor=null;
    do{
      const query=cursor?'?'+new URLSearchParams({after:cursor}):'';
      const page=await analysisRequest('/api/v4/analyses/sector-progress'+query);
      if(!Array.isArray(page.items)||!(page.next===null||typeof page.next==='string'&&page.next>(cursor||''))){
        throw new Error('A lista de empresas não foi confirmada. Tente novamente.');
      }
      companies.push(...page.items);
      cursor=page.next;
    }while(cursor);
  }catch(error){
    host.innerHTML=`<section class="analysis-empty"><h1>Preenchimento por setor</h1><p role="alert">${esc(error.message)}</p><button type="button">Tentar novamente</button> <a href="/">Acessar painel</a></section>`;
    host.querySelector('button').onclick=()=>openSectorReport(host);return;
  }
  companies.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||String(a.code).localeCompare(String(b.code),'pt-BR',{numeric:true}));
  host.innerHTML=`<section class="sector-report">
    <a class="analysis-back" href="/generations.html?view=history">← Relatórios</a>
    <div class="analysis-heading"><div><h1>Preenchimento por setor</h1><p>Situação salva do Fiscal e do Contábil por empresa.</p></div>
      <div class="analysis-heading-actions"><button type="button" data-print>Imprimir / PDF</button><button type="button" class="primary" data-excel>Baixar Excel</button></div></div>
    <form class="analysis-filter-bar"><label>Nome, código ou CNPJ<input name="search" type="search" maxlength="100" placeholder="Buscar empresa"></label>
      <label>Cadastro<select name="registration"><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></label>
      <label>Fiscal<select name="fiscal">${options}</select></label><label>Contábil<select name="accounting">${options}</select></label></form>
    <div class="sector-report-summary analysis-overview" aria-live="polite"></div>
    <p class="analysis-note sector-report-caption"></p><p role="alert" class="sector-export-error" hidden></p>
    <div class="sector-report-table" tabindex="0" role="region" aria-label="Empresas do relatório"><table><thead><tr>
      <th scope="col">Código</th><th scope="col">Empresa</th><th scope="col">CNPJ</th><th scope="col">Cadastro</th><th scope="col">Fiscal</th><th scope="col">Contábil</th></tr></thead>
      <tbody></tbody></table></div></section>`;
  const form=host.querySelector('form'),excel=host.querySelector('[data-excel]'),print=host.querySelector('[data-print]');
  const message=host.querySelector('.sector-export-error'),readAt=dateText(new Date());
  let filtered=[],exporting=false;
  function render(){
    const {search,registration,fiscal,accounting}=form.elements,term=normalize(search.value);
    filtered=companies.filter(row=>(registration.value==='all'||row.active===(registration.value==='active'))&&
      sectorMatches(row.fiscal.status,fiscal.value)&&sectorMatches(row.accounting.status,accounting.value)&&
      [row.name,row.code,row.cnpj,formatCnpj(row.cnpj)].some(value=>normalize(value).includes(term)));
    const complete=(row,key)=>row[key].status==='COMPLETE';
    const totals=[['Empresas no filtro',filtered.length],['Fiscal concluído',filtered.filter(row=>complete(row,'fiscal')).length],
      ['Contábil concluído',filtered.filter(row=>complete(row,'accounting')).length],['Ambos concluídos',filtered.filter(row=>complete(row,'fiscal')&&complete(row,'accounting')).length]];
    host.querySelector('.sector-report-summary').innerHTML=totals.map(([label,count])=>`<article><span>${label}</span><strong>${count}</strong></article>`).join('');
    const filters=[registration,fiscal,accounting].map(select=>select.labels[0].firstChild.textContent+' · '+select.selectedOptions[0].text);
    host.querySelector('.sector-report-caption').textContent=['Consulta em '+readAt,...filters,...(term?['Busca · '+search.value.trim()]:[])].join('  |  ');
    host.querySelector('tbody').innerHTML=filtered.length?filtered.map(row=>`<tr><td>${esc(row.code)||'—'}</td><th scope="row">${esc(row.name)}</th><td>${esc(formatCnpj(row.cnpj))||'—'}</td><td>${row.active?'Ativo':'Inativo'}</td>${sectorCell(row.fiscal)}${sectorCell(row.accounting)}</tr>`).join(''):
      '<tr><td colspan="6">Nenhuma empresa encontrada para os filtros selecionados.</td></tr>';
    print.disabled=!filtered.length;excel.disabled=exporting||!filtered.length;message.hidden=true;
  }
  form.onsubmit=event=>event.preventDefault();form.oninput=render;
  print.onclick=()=>window.print();
  excel.onclick=async()=>{
    exporting=true;excel.disabled=true;message.hidden=true;
    try{await exportExcel(filtered);}
    catch(error){message.textContent=error.message;message.hidden=false;}
    finally{exporting=false;excel.disabled=!filtered.length;}
  };
  render();
}
