import {monthlyProjection, monthlyDifal, baselineMonth, calculateMonthlySimulation} from './simulator-monthly.js';
import {buildMonthlyDre} from './simulator-calendar.js';
import {renderSection22,renderMonthlyDre,isSection22} from './simulator-extrato-view.js';
import {annualizeReports, projectScenario, projectDifal} from './simulator-projection.js';
import {renderProjectionCard} from './simulator-projection-view.js';
import {buildDrePresentation} from './simulator-dre.js';
import {renderAnnualDre,renderDrePrintCalendar,renderDrePrintDocument} from './simulator-dre-view.js';
import {buildDreCsv,buildDreExportPayload} from './simulator-dre-export.js';
import {mountNavigation} from './navigation.js';
import {renderSimulationCharts} from './simulation-charts.js';
import {createEmptyDraft, calculateSimulation, CALCULATOR_SOURCE_COMMIT, TAX_SOURCES} from './simulator-engine.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const pct = value => value == null ? '—' : (value * 100).toLocaleString('pt-BR',{maximumFractionDigits:2}) + '%';
const date = value => value ? new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—';
const IMPORTED = ['salesOptantCents','salesNonOptantCents','salesCpfCents','purchasesOptantCents','purchasesNonOptantCents'];
const MANUAL = ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'];
const S = {source:null,user:null,key:'',result:null,months:1,edited:false,snapshot:null,parentId:null,pending:null,saving:false,viewPeriod:'annual',readonly:false,rbt12ExtractionId:null,rbt12Data:null,rbt12DocumentId:null,rbt12DocumentConfirmed:false,rbt12DocumentRetryable:false,rbt12Sequence:0,pdfOperation:null,pdfUrl:null,readingPdf:false,calendarRegime:null,projectionKind:'sales',guided:false,guidedStage:false,guidedResume:false,rbt12Mode:'PDF',serviceMigration:null,draftMigrationNotice:null,dreShowPercent:false,dreMonthView:false,dreMonth:0,dreContext:null,detailStates:new Map(),monthlyInputs:[],entry:0};
const hasImportedServices = () => S.source?.revenueSplit?.version === 'SALES_SERVICES_V1' && Number.isSafeInteger(S.source.fields?.serviceRevenueCents);
const isImportedField = key => IMPORTED.includes(key) || (key === 'serviceRevenue' && hasImportedServices());
const actualMonths=()=>Array.isArray(S.source?.monthlyReports)&&(!S.readonly||S.snapshot?.result?.method==='REPORT_MONTHS_V1');
const sourceProjection=()=>actualMonths()?monthlyProjection(S.source.monthlyReports):annualizeReports(S.source.fields,S.months);
const difalProjection = () => S.readonly ? S.snapshot?.difalProjection || null : actualMonths()?monthlyDifal(S.source.monthlyReports,S.source.sales.jobId):projectDifal(S.source.sales.difal, S.months, S.source.sales.jobId);
function captureMonth(){if(!actualMonths()||S.readonly||!S.monthlyInputs[S.entry])return;const row=S.monthlyInputs[S.entry];row.groups=Object.fromEntries(IMPORTED.map(key=>[key,value(key)]));row.values=Object.fromEntries(MANUAL.map(key=>[key,value(key)]));}
function showMonth(){const row=S.monthlyInputs[S.entry];for(const key of IMPORTED)$('#'+key).value=typeof row.groups[key]==='number'?row.groups[key].toFixed(2):'';for(const key of MANUAL)$('#'+key).value=typeof row.values[key]==='number'?row.values[key].toFixed(2):'';const select=$('#report-competence');if(select)select.value=String(S.entry);}
const servicesMigration = snapshot => !!snapshot && hasImportedServices() && snapshot.source?.revenueSplit?.version !== 'SALES_SERVICES_V1';
const canSave = () => ['admin','operator'].includes(S.user?.role);
const sourceUrl = () => '/simulator.html?'+new URLSearchParams({generation:S.source.generationId,client:S.source.clientId,...(S.parentId?{parent:S.parentId}:{})});
const documentUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const rbt12SourceKey=()=>JSON.stringify([S.source.generationId,S.source.clientId,S.source.company.code||'',S.source.company.name||'',S.source.company.cnpj||'']);
const rbt12Context=()=>({sequence:S.rbt12Sequence,sourceKey:rbt12SourceKey(),clientId:S.source.clientId,documentId:S.rbt12DocumentId});
const currentRbt12=context=>context.sequence===S.rbt12Sequence&&context.sourceKey===rbt12SourceKey()&&context.documentId===S.rbt12DocumentId&&S.rbt12Mode==='PDF';
const fail = error => { $('#simulator-error').textContent = error.message || String(error); };
async function api(path, options={}) {
  const processingPdf=options.method?.toUpperCase()==='POST'&&path.split('?')[0]==='/api/simples';
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),processingPdf?285000:55000);
  try {
    const response = await fetch(path,{credentials:'same-origin',...options,signal:controller.signal});
    const data = await response.json().catch(()=>null);
    if (!response.ok) throw new Error((data?.message || 'O servidor não conseguiu concluir a operação. Tente novamente.')+(data?.requestId?' Código: '+data.requestId+'.':''));
    if(!data)throw new Error('O servidor retornou uma resposta incompleta. Tente novamente.');
    return data;
  } catch(error) { if(error.name === 'AbortError') {
    if(processingPdf)throw new Error('A leitura do PDF demorou a responder. Nenhuma RBT12 foi confirmada nesta tela. Verifique a leitura armazenada antes de reprocessar.');
    if(path.startsWith('/api/v4/simples-documents'))throw new Error(path.endsWith('/status')?'Não foi possível verificar a leitura armazenada a tempo. Tente verificar novamente.':path.endsWith('/process-urls')?'A preparação da leitura demorou a responder. O PDF original permanece armazenado; tente novamente.':'A preparação do envio do PDF demorou a responder. Tente enviar novamente.');
    if(path.startsWith('/api/simples'))throw new Error('Não foi possível recuperar a leitura do extrato a tempo. Tente novamente.');
    throw new Error('O servidor demorou a responder. Tente salvar novamente para confirmar o mesmo registro.');
  } throw error; }
  finally { clearTimeout(timer); }
}
function moneyField(id, label, help, imported=false, readonly=false, signed=false) {
  return `<div class="sim-field${imported?' sim-field-imported':''}"><div class="sim-field-label"><label for="${id}">${label}${readonly?'':' *'}</label>${imported?'<span class="sim-field-origin" aria-hidden="true">Relatório</span>':id==='salesRevenue'?'<span class="sim-field-origin" aria-hidden="true">Calculado</span>':''}</div><div class="sim-money-control"><span aria-hidden="true">R$</span><input id="${id}" name="${id}" type="number" min="${signed?'-1000000000000':'0'}" max="1000000000000" step="0.01" inputmode="decimal" ${readonly?'readonly':'required'} placeholder="${id==='rbt12'?'Leia o PDF':'0,00'}" aria-describedby="${id}-help"></div><small id="${id}-help">${help}</small></div>`;
}
function section(number,title,subtitle,content,id) {
  return `<section class="card sim-section" id="${id}"><div class="sim-section-header"><span class="sim-number">${number}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div>${content}</section>`;
}
function display(prefill=null) {
  S.readonly=false; S.result=null; S.snapshot=null; S.pending=null; S.rbt12Mode='PDF'; S.serviceMigration=servicesMigration(prefill)?{previousServices:Number(prefill.draft.values.serviceRevenue)||0}:null;S.draftMigrationNotice=null;clearRbt12();
  S.entry=0;S.monthlyInputs=[];
  const automaticPeriod=S.source.periodBasis==='COLUMN_H'&&Number.isInteger(S.source.reportMonths);
  if(automaticPeriod)S.months=S.source.reportMonths;
  const periodText=automaticPeriod ? `<details class="card sim-source sim-period-details"><summary>Período confirmado · ${S.months} ${S.months===1?'mês':'meses'}<span>${esc(S.source.period.startMonth)} a ${esc(S.source.period.endMonth)}</span></summary><div class="sim-period"><label for="period-months">Meses nos relatórios<select id="period-months" disabled><option value="${S.months}">${S.months} ${S.months===1?'mês':'meses'}</option></select></label><label class="sim-confirm"><input id="period-confirm" type="checkbox" checked disabled>Confirmado pela coluna H. Compras e vendas podem ter dias diferentes na mesma competência.</label></div><p id="period-explanation" class="sim-help"></p></details>` :
    `<section class="card sim-source sim-period-manual"><h2>Confirme o período dos relatórios</h2><p class="sim-help">Informe quantos meses estão incluídos nos dois arquivos.</p><div class="sim-period"><label for="period-months">Meses nos relatórios<select id="period-months">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} ${i?'meses':'mês'}</option>`).join('')}</select></label><label class="sim-confirm"><input id="period-confirm" type="checkbox" required>Compras e vendas correspondem ao mesmo período.</label></div><p id="period-explanation" class="sim-help"></p></section>`;
  $('#simulator-app').innerHTML = `<div id="simulator-intro">${hero(false)}</div><div class="sim-context">${sourceCard()}<div id="simulation-notices"></div></div>
    <form id="simulator-form"><fieldset id="simulation-fields"><p class="sim-form-guidance">Valores em reais (R$). Campos com * são obrigatórios; informe 0 quando não houver valor.</p><div id="simulator-projection"></div>${periodText}
    ${section('01','Extrato e cenário','Leia o PDF para preencher a RBT12.',`<div class="sim-pdf-grid"><div class="sim-field sim-pdf-upload"><label for="rbt12-pdf">Extrato ou declaração do Simples Nacional (PDF)</label><div class="sim-upload-controls"><input id="rbt12-pdf" type="file" accept="application/pdf,.pdf"><button type="button" id="rbt12-read">Ler RBT12</button></div><small id="rbt12-status" role="status" aria-live="polite">Selecione o extrato ou a declaração PGDAS-D em PDF para conferir a seção 2.2. Até 8 MiB.</small><div class="sim-pdf-actions"><button type="button" id="rbt12-view-original" hidden>Ver PDF original</button><button type="button" id="rbt12-view-searchable" hidden>Ver PDF pesquisável</button><button type="button" id="rbt12-reprocess" hidden>Ler novamente</button><button type="button" id="rbt12-check-status" hidden>Verificar leitura</button><a id="rbt12-download" hidden>Baixar PDF pesquisável</a></div></div>${moneyField('rbt12','RBT12 · seção 2.2','Soma das 12 competências anteriores ao PA.',false,true)}</div><div id="rbt12-details"></div><div class="sim-rbt12-mode"><button type="button" id="rbt12-manual">Informar RBT12 sem o extrato</button><button type="button" id="rbt12-use-pdf" hidden>Usar extrato em PDF</button><div id="rbt12-manual-notice" hidden><p class="sim-help">Informe a receita bruta efetiva dos 12 meses anteriores ao período de apuração. O valor ficará identificado como manual; não é a projeção das vendas.</p><label class="sim-confirm" for="rbt12-manual-confirm"><input id="rbt12-manual-confirm" type="checkbox">Confirmo que informei a receita bruta dos 12 meses anteriores ao período de apuração.</label></div></div><div class="sim-fields sim-scenario-fields"><div class="sim-field"><label for="simulation-year">Ano da simulação</label><select id="simulation-year"><option>2027</option><option>2028</option></select></div><div class="sim-field"><label for="sales-annex">Atividade das vendas</label><select id="sales-annex"><option value="1">Comércio · Anexo I</option><option value="2">Indústria · Anexo II</option></select></div><div class="sim-field"><label for="service-annex">Categoria dos serviços</label><select id="service-annex"><option value="3">Anexo III</option><option value="4">Anexo IV</option><option value="5">Anexo V</option></select></div></div>`,'sim-section-extrato')}
    ${actualMonths()?`<section class="card sim-section"><label for="report-competence">Competência dos relatórios<select id="report-competence">${S.source.monthlyReports.map((row,index)=>`<option value="${index}">${esc(row.sourceMonth)}</option>`).join('')}</select></label><p class="sim-help">Confira compras, vendas, serviços e despesas de cada mês. Alterações ficam somente na competência selecionada. Despesas começam em R$ 0,00; preencha em cada mês quando houver.</p></section>`:''}
    ${section('02','Quanto a empresa fatura?','Valores mensais · confira as vendas e os serviços dos relatórios.',`<div class="sim-fields">${moneyField('serviceRevenue','Vendas de serviços',actualMonths()?'Serviços desta competência, separados das mercadorias.':hasImportedServices()?'Média mensal dos serviços do relatório. Natureza 9000 e seus complementos entram aqui, sem repetir nos grupos de mercadorias.':'Informe o valor mensal. Use 0 se não houver.',hasImportedServices())}${moneyField('salesRevenue','Receita de vendas','Soma dos três grupos abaixo.',false,true)}</div><div class="sim-fields sales">${moneyField('salesOptantCents','Vendas a optantes SN','Opção pelo Simples confirmada. Devoluções podem reduzir este grupo abaixo de zero.',true,false,true)}${moneyField('salesNonOptantCents','Vendas a não optantes SN','Inclui não confirmados; exclui CPFs. Devoluções podem reduzir este grupo abaixo de zero.',true,false,true)}${moneyField('salesCpfCents','Vendas a CPFs','Clientes identificados por CPF. Devoluções podem reduzir este grupo abaixo de zero.',true,false,true)}</div><div id="simulator-difal"></div>${S.serviceMigration?`<div class="sim-note" id="sim-service-migration"><h3>Confira a separação de serviços nesta nova versão</h3><p>Os valores importados foram restaurados pela classificação atual. A receita de serviços agora fica separada das mercadorias. O valor mensal de serviços informado na versão anterior era <strong>${money(S.serviceMigration.previousServices)}</strong>; ele pode já estar incluído nas vendas antigas. Confira o campo Vendas de serviços antes de simular.</p>${S.serviceMigration.previousServices>0?'<label class="sim-confirm"><input id="service-migration-confirm" type="checkbox" required>Revisei os serviços importados e o valor anterior, sem duplicar receitas.</label>':''}</div>`:''}<div class="sim-totals"><article><span>Faturamento mensal</span><strong id="monthly-revenue">Preencha as receitas</strong></article><article><span>${actualMonths()?'Soma das competências':'Projeção anual'}</span><strong id="annual-revenue">Calculada automaticamente</strong></article></div><details class="sim-inline-help"><summary>Sobre os valores de faturamento</summary><p>${actualMonths()?'As receitas usam os valores de cada competência dos relatórios e podem ser ajustadas nesse mês.':'As receitas usam a média mensal dos relatórios e podem ser ajustadas.'} Serviços identificados ficam separados das vendas de mercadorias; naturezas iniciadas por 9000 são serviços. Confira serviços adicionais sem repetir valores já importados. ${actualMonths()?'O total é a soma dos meses importados.':'A projeção é (vendas + serviços) × 12.'} A RBT12 do extrato é uma referência separada.</p></details>`,'sim-section-revenue')}
    ${section('03','Quanto a empresa compra?','Valores mensais · preenchidos pelos relatórios e editáveis.',`<div class="sim-fields">${moneyField('purchasesOptantCents','Compras de empresas do Simples','Fornecedores optantes pelo Simples.',true)}${moneyField('purchasesNonOptantCents','Compras de empresas fora do Simples','Inclui não confirmados e outros documentos.',true)}</div>`,'sim-section-purchases')}
    ${section('04','Quais são as despesas?','Informe os valores por mês. Use 0 quando não houver.',`<div class="sim-fields sim-expense-fields">${moneyField('salaries','Salários e pró-labore','Pagamentos à equipe e aos sócios.')}${moneyField('benefits','Benefícios da equipe','Transporte, alimentação e outros.')}${moneyField('adminExpenses','Outras despesas da empresa','Água, energia, internet e similares.')}${moneyField('rent','Aluguel','Valor mensal do imóvel.')}${moneyField('cardExpenses','Taxas de cartão','Total das taxas em reais.')}</div><p class="sim-help">Não repita uma mesma despesa em mais de um campo.</p>`,'sim-section-expenses')}
    <div class="sim-actions"><button class="primary" type="submit" id="generate-simulation">Gerar simulação</button><button id="restore-reports" type="button">Restaurar valores dos relatórios</button><small id="draft-status" role="status">Preencha os campos obrigatórios para comparar os cenários.</small></div></fieldset></form><div id="simulation-result"></div>`;
  applyReports();
  if($('#report-competence'))$('#report-competence').onchange=event=>{captureMonth();S.entry=Number(event.target.value);showMonth();updateRevenue();invalidate();saveDraft();};
  $('#simulator-form').oninput = event => {
    if(S.saving)return;
    if (isImportedField(event.target.id)) S.edited=true;
    if(event.target.id==='serviceRevenue'&&$('#service-migration-confirm'))$('#service-migration-confirm').checked=false;
    if(event.target.id==='rbt12'){if(S.rbt12Mode==='MANUAL')$('#rbt12-manual-confirm').checked=false;else clearRbt12();}
    updateRevenue(); invalidate(); saveDraft();
  };
  $('#period-months').onchange = () => {
    if(automaticPeriod)return;
    const months=Number($('#period-months').value);
    if(S.edited && !confirm('Recalcular os campos importados com o novo período? Os ajustes manuais nesses campos serão substituídos.')) { $('#period-months').value=String(S.months); return; }
    S.months=months; $('#period-confirm').checked=false; applyReports(); invalidate(); saveDraft();
  };
  $('#restore-reports').onclick = () => { if(!S.edited || confirm(hasImportedServices()?'Restaurar vendas, serviços e compras dos relatórios? As despesas serão mantidas.':'Restaurar os cinco campos importados? Serviços e despesas serão mantidos.')) { applyReports(); invalidate(); saveDraft(); } };
  $('#rbt12-read').onclick = () => void readRbt12Pdf();
  $('#rbt12-view-original').onclick = () => void viewStoredPdf('original');
  $('#rbt12-view-searchable').onclick = () => void viewStoredPdf('searchable');
  $('#rbt12-reprocess').onclick = () => void reprocessRbt12();
  $('#rbt12-check-status').onclick=()=>void restoreStoredRbt12();
  $('#rbt12-pdf').onchange = () => {clearRbt12();invalidate();saveDraft();if(S.guidedStage)void readRbt12Pdf();};
  $('#rbt12-manual').onclick=()=>{setRbt12Mode('MANUAL');invalidate();saveDraft();$('#rbt12').focus();};
  $('#rbt12-use-pdf').onclick=()=>{setRbt12Mode('PDF');invalidate();saveDraft();$('#rbt12-pdf').focus();};
  $('#simulator-form').onsubmit = event => { event.preventDefault(); void simulate(); };
  if(prefill) fillSnapshot(prefill);
  restoreDraft();
  updateRevenue(); renderNotices();
  if(S.rbt12DocumentId&&!S.rbt12Data)void restoreStoredRbt12();
  else if(S.rbt12ExtractionId&&!S.rbt12Data)void restoreRbt12();
  else if(!S.rbt12Data&&S.rbt12Mode!=='MANUAL')clearRbt12();
  else if(S.rbt12Data&&S.rbt12ExtractionId===(S.rbt12Data.extractionId||S.rbt12Data.id))applyRbt12(S.rbt12Data);
  else if(S.rbt12Mode!=='MANUAL')void restoreRbt12();
  if(S.guided)setupGuidedRbt12();
}
// One shared rule is used in browser, API, saved history and projection memory.
function applyReports() {
  if(actualMonths()){
    const previous=S.monthlyInputs;S.monthlyInputs=S.source.monthlyReports.map((row,index)=>baselineMonth(row,previous[index]?.values));showMonth();S.edited=false;
    $('#period-explanation').textContent='Valores de cada competência pela coluna H. Total anual = soma dos meses importados. Meses fora do período ficam sem dados.';updateRevenue();return;
  }
  const projection=sourceProjection();
  for(const key of IMPORTED) $('#'+key).value=(projection.monthlyGroupsCents[key]/100).toFixed(2);
  if(hasImportedServices())$('#serviceRevenue').value=(projection.monthlyGroupsCents.serviceRevenueCents/100).toFixed(2);
  S.edited=false;
  $('#period-explanation').textContent=`Média mensal = total importado ÷ ${S.months}. Projeção anual = média × 12. ${hasImportedServices()?'Serviços são separados das mercadorias na média dos relatórios.':'Serviços são informados por mês.'} Despesas são informadas por mês.`;
  updateRevenue();
}
function updateProjection() {
  const host=$('#simulator-projection');if(!host)return;
  const projection=S.readonly&&S.snapshot?.projection?S.snapshot.projection:sourceProjection();
  const open=host.querySelector('details')?.open ?? false;
  const focused=host.contains(document.activeElement)?document.activeElement?.dataset?.projectionKind:null;
  host.innerHTML=renderProjectionCard({projection,kind:S.projectionKind,period:S.source.period,
    selectedMonth:S.entry,confirmed:S.readonly||S.source.periodBasis==='COLUMN_H'||$('#period-confirm')?.checked===true,
    edited:S.edited,legacy:S.readonly&&!S.snapshot?.projection});
  host.querySelector('details').open=open;
  host.querySelectorAll('[data-projection-kind]').forEach(button=>button.onclick=()=>{S.projectionKind=button.dataset.projectionKind;updateProjection();});
  if(focused)host.querySelector(`[data-projection-kind="${focused}"]`)?.focus();
}

function updateDifalSource() {
  const host=$('#simulator-difal');if(!host)return;
  const difal=S.source.sales.difal;
  if(actualMonths()){
    const projected=difalProjection(),reports=S.source.monthlyReports,row=reports[S.entry]||reports[0],current=row.difal;
    if(!projected){host.innerHTML='<p class="sim-help">DIFAL indisponível. Reimporte as vendas com UF do emitente e destinatário.</p>';return;}
    host.innerHTML=`<section class="sim-note"><h3>DIFAL estimado · vendas/saídas por competência</h3><div class="sim-detail-grid"><article><span>DIFAL de ${esc(row.sourceMonth)}</span><strong data-difal-monthly>${current.pendingLines&&!current.eligibleLines?'Pendente':money(current.amountCents/100)}</strong><small>Somente as vendas elegíveis deste mês</small></article><article><span>Total das competências na DRE</span><strong data-difal-annual data-difal-amount>${money(projected.annualCents/100)}</strong><small>Soma dos meses importados</small></article><article><span>Base elegível de ${esc(row.sourceMonth)}</span><strong>${money(current.baseCents/100)}</strong><small>${current.eligibleLines} linhas · UF do emitente: ${esc(current.issuerUf||'pendente')}</small></article></div><p>Estimativa gerencial de 10% sobre as vendas/saídas elegíveis de cada competência. A DRE usa o valor daquele mês, uma única vez. Serviços não integram a base.</p>${projected.pendingLines?`<p data-difal-pending>Estimativa parcial: ${projected.pendingLines} linhas aguardam UF. Confira e reimporte as vendas.</p>`:''}<details><summary>Conferir DIFAL de todos os meses</summary><div class="projection-table-wrap"><table><thead><tr><th>Competência</th><th>Base elegível</th><th>DIFAL estimado</th></tr></thead><tbody>${reports.map(item=>`<tr><th>${esc(item.sourceMonth)}</th><td>${money(item.difal.baseCents/100)}</td><td>${money(item.difal.amountCents/100)}${item.difal.pendingLines?' · parcial':''}</td></tr>`).join('')}</tbody></table></div></details>${S.edited?'<p data-difal-adjusted>O DIFAL permanece vinculado às linhas importadas. Para alterar sua base, corrija e reimporte as vendas.</p>':''}</section>`;return;
  }
  if(!difal){
    // Historic simulations remain as captured; an absent estimate never means zero.
    host.innerHTML=S.readonly?'':'<p class="sim-help">DIFAL indisponível neste relatório anterior. Reimporte as vendas com UF do emitente e do destinatário para obter a estimativa.</p>';
    return;
  }
  const original=S.readonly&&S.snapshot?.projection?S.snapshot.projection:sourceProjection();
  const adjusted=IMPORTED.slice(0,3).some(key=>{
    const current=S.readonly?S.snapshot.monthlyGroups[key]:value(key);
    return current===null||Math.round(current*100)!==original.monthlyGroupsCents[key];
  });
  const projected=difalProjection();
  const pending=Number(difal.pendingLines||0)>0;
  const noCalculatedLines=pending&&!difal.eligibleLines;
  host.innerHTML=`<section class="sim-note" aria-labelledby="sim-difal-title"><h3 id="sim-difal-title">DIFAL estimado · relatório e DRE</h3>
    <div class="sim-detail-grid"><article><span>Total importado · ${esc(difal.ratePercent)}%</span><strong data-difal-amount>${noCalculatedLines?'Pendente':money(difal.amountCents/100)}</strong></article><article><span>Base das vendas elegíveis</span><strong>${money(difal.baseCents/100)}</strong></article><article><span>Vendas elegíveis no arquivo</span><strong>${esc(difal.eligibleLines)}</strong><small>UF do emitente: ${esc(difal.issuerUf||'não informada')}</small></article>${projected?`<article><span>DIFAL mensal na DRE</span><strong data-difal-monthly>${noCalculatedLines?'Pendente':money(projected.monthlyCents/100)}</strong><small>Total importado ÷ ${S.months} ${S.months===1?'mês':'meses'}</small></article><article><span>DIFAL anual na DRE</span><strong data-difal-annual>${noCalculatedLines?'Pendente':money(projected.annualCents/100)}</strong><small>Média mensal × 12</small></article>`:''}</div>
    <p>Alíquota média estimada de ${esc(difal.ratePercent)}%, que não corresponde necessariamente à alíquota legal de cada operação. ${projected?'A mesma estimativa gerencial é deduzida na DRE e incluída nos tributos dos regimes comparados. O total importado é dividido pelo período confirmado e projetado em 12 meses. Serviços, inclusive natureza 9000, não integram a base elegível.':'Esta versão histórica preserva o DIFAL como referência separada; seus tributos e resultados não foram recalculados.'}</p>
    ${pending?`<p data-difal-pending>Estimativa parcial: ${esc(difal.pendingLines)} ${difal.pendingLines===1?'linha depende':'linhas dependem'} de UF para verificar a aplicação do DIFAL. ${projected?'A DRE considera apenas as linhas calculadas e pode subestimar o valor. ':''}Confira e reimporte as vendas.</p>`:''}
    ${adjusted?'<p data-difal-adjusted role="status">As vendas mensais foram ajustadas. O DIFAL permanece vinculado às operações importadas; para atualizar sua base, valor ou elegibilidade, corrija e reimporte as vendas com os dados de cada operação.</p>':''}
  </section>`;
}

function value(id) { const input=$('#'+id); return input.value!=='' && input.validity.valid ? Number(input.value) : null; }
function salesTotal() { const amounts=IMPORTED.slice(0,3).map(value); return amounts.some(v=>v===null)?null:amounts.reduce((a,b)=>a+Math.round(b*100),0)/100; }
function updateRevenue() {
  const sales=salesTotal(), service=value('serviceRevenue');
  $('#salesRevenue').value=sales===null?'':sales.toFixed(2);
  const total=sales===null||service===null?null:Math.round((sales+service)*100)/100;
  $('#monthly-revenue').textContent=total===null?'Preencha as receitas':money(total);
  captureMonth();
  const revenueTotal=actualMonths()?S.monthlyInputs.reduce((sum,row)=>sum+IMPORTED.slice(0,3).reduce((a,key)=>a+(row.groups[key]??0),0)+(row.values.serviceRevenue??0),0):total===null?null:total*12;
  $('#annual-revenue').textContent=revenueTotal===null?'Calculada automaticamente':money(revenueTotal);
  updateProjection(); updateDifalSource();
}
function invalidate() { S.result=null; S.snapshot=null; S.pending=null; $('#simulation-result').innerHTML=''; $('#simulator-error').textContent=''; renderNotices(); }
function draft() {
  const d=createEmptyDraft(); d.year=Number($('#simulation-year').value);d.salesAnnex=Number($('#sales-annex').value);d.serviceAnnex=Number($('#service-annex').value);
  MANUAL.forEach(key=>d.values[key]=value(key));
  d.rbt12=value('rbt12');
  d.values.salesRevenue=salesTotal();d.values.simplePurchases=value('purchasesOptantCents');d.values.regularPurchases=value('purchasesNonOptantCents');
  return d;
}
function saveDraft() {
  captureMonth();
  const data={monthlyInputs:actualMonths()?S.monthlyInputs:undefined,entry:S.entry,projectionVersion:actualMonths()?'REPORT_MONTHS_V1':hasImportedServices()?'AVERAGE_X12_V2':'AVERAGE_X12_V1',revenueSplitVersion:S.source.revenueSplit?.version||null,serviceMigrationConfirmed:$('#service-migration-confirm')?.checked===true,months:S.months,edited:S.edited,confirmed:$('#period-confirm').checked,rbt12ExtractionId:S.rbt12ExtractionId,rbt12Document:S.rbt12DocumentId?{documentId:S.rbt12DocumentId,sourceKey:rbt12SourceKey()}:null,rbt12Mode:S.rbt12Mode,rbt12ManualConfirmed:S.rbt12Mode==='MANUAL'&&$('#rbt12-manual-confirm').checked,fields:Object.fromEntries([...IMPORTED,...MANUAL,'rbt12'].map(key=>{const field=$('#'+key);return [key,field.value!==''&&field.validity.valid?Number(field.value).toFixed(2):field.value];})),year:$('#simulation-year').value,salesAnnex:$('#sales-annex').value,serviceAnnex:$('#service-annex').value};
  try { sessionStorage.setItem(S.key,JSON.stringify(data)); $('#draft-status').textContent='Rascunho salvo nesta aba. Após alterar valores, gere a simulação novamente.'; }
  catch { $('#draft-status').textContent='Não foi possível guardar o rascunho nesta aba. Mantenha a página aberta até concluir.'; }
}
function restoreDraft() {
  try {
    const data=JSON.parse(sessionStorage.getItem(S.key)||'null'); if(!data || !Number.isInteger(data.months) || data.months<1 || data.months>12) return;
    if(S.source.periodBasis!=='COLUMN_H')S.months=data.months; $('#period-months').value=String(S.months);applyReports();
    const matchingMonths=data.months===S.months;
    const matchingMonthly=!actualMonths()||data.projectionVersion==='REPORT_MONTHS_V1';
    if(actualMonths()&&!matchingMonthly){for(const entry of S.monthlyInputs)for(const key of MANUAL.slice(1))if(/^\d+(\.\d{1,2})?$/.test(data.fields?.[key]||''))entry.values[key]=Number(data.fields[key]);showMonth();}
    if(actualMonths()&&matchingMonthly&&data.monthlyInputs?.length===S.source.monthlyReports.length&&data.monthlyInputs.every((row,index)=>row.sourceMonth===S.source.monthlyReports[index].sourceMonth)){S.monthlyInputs=data.monthlyInputs;S.entry=Number.isInteger(data.entry)&&data.entry>=0&&data.entry<S.monthlyInputs.length?data.entry:0;showMonth();}
    const matchingRevenueSplit=matchingMonthly&&(data.revenueSplitVersion||null)===(S.source.revenueSplit?.version||null);
    if(!matchingRevenueSplit)S.draftMigrationNotice=`O rascunho anterior usava receitas sem a separação atual. Os campos importados foram preenchidos novamente; as despesas foram preservadas. Serviços no rascunho anterior: ${money(Number(data.fields?.serviceRevenue)||0)} por mês. Confira esse valor antes de simular.`;
    if($('#service-migration-confirm'))$('#service-migration-confirm').checked=matchingRevenueSplit&&data.serviceMigrationConfirmed===true;
    for(const key of [...IMPORTED,...MANUAL,'rbt12']) { if(actualMonths()&&key!=='rbt12')continue; if(isImportedField(key)&&(!matchingMonths||!matchingRevenueSplit))continue; const v=data.fields?.[key]; const signed=IMPORTED.slice(0,3).includes(key), pattern=signed?/^-?\d+(\.\d{1,2})?$/:/^\d+(\.\d{1,2})?$/; if(typeof v==='string' && (v==='' || pattern.test(v))) $('#'+key).value=v; }
    if(data.rbt12Mode==='MANUAL'&&!data.rbt12ExtractionId){setRbt12Mode('MANUAL',{preserveValue:true});$('#rbt12-manual-confirm').checked=data.rbt12ManualConfirmed===true;}
    else {
      setRbt12Mode('PDF',{preserveValue:true});
      clearRbt12();
      const matchingDocument=data.rbt12Document?.sourceKey===rbt12SourceKey()&&documentUuid(data.rbt12Document?.documentId);
      if((!data.rbt12Document||matchingDocument)&&documentUuid(data.rbt12ExtractionId))S.rbt12ExtractionId=data.rbt12ExtractionId;
      if(matchingDocument)S.rbt12DocumentId=data.rbt12Document.documentId;
    }
    for(const [key,id,choices] of [['year','simulation-year',['2027','2028']],['salesAnnex','sales-annex',['1','2']],['serviceAnnex','service-annex',['3','4','5']]]) if(choices.includes(data[key])) $('#'+id).value=data[key];
    S.edited=matchingMonths&&matchingRevenueSplit&&data.edited===true;$('#period-confirm').checked=S.source.periodBasis==='COLUMN_H'||data.confirmed===true;$('#draft-status').textContent='Rascunho desta empresa restaurado. Confira os campos antes de gerar.';
  } catch { /* Invalid/unavailable local drafts never prevent using verified report totals. */ }
}

function hero(readonly) {
  const company=S.source.company;
  return `<div class="sim-top-links"><a class="sim-back" href="/generations.html?id=${encodeURIComponent(S.source.generationId)}">← Relatórios</a><a class="sim-back" href="/simulations.html?clientId=${encodeURIComponent(S.source.clientId)}">Histórico de simulações →</a></div>
    <div class="sim-hero"><div><div class="eyebrow">${readonly?'SIMULAÇÃO SALVA':S.parentId?'NOVA VERSÃO':'PLANEJAMENTO TRIBUTÁRIO'}</div><h1>Simulador tributário</h1><p><strong>${esc(company.name)}</strong>${company.code?` <span class="sim-company-code">· ${esc(company.code)}</span>`:''}</p></div><span class="sim-hero-caption">${readonly?'Valores preservados desta versão':'Confira os valores e compare os regimes.'}</span></div>
    ${readonly?'':`<nav class="sim-step-track" aria-label="Seções do simulador"><a href="#sim-section-extrato">01 · Extrato</a><a href="#sim-section-revenue">02 · Faturamento</a><a href="#sim-section-purchases">03 · Compras</a><a href="#sim-section-expenses">04 · Despesas</a></nav>`}`;
}
function sourceCard() {
  const d=S.source;
  return `<details class="card sim-source sim-report-details"><summary><span>Relatórios de origem</span><span class="sim-source-caption">Compras e vendas <span aria-hidden="true">⌄</span></span></summary><div class="sim-source-grid">${[['purchases','Compras'],['sales','Vendas']].map(([key,label])=>`<article><div class="eyebrow">${label.toUpperCase()} · TOTAL DO ARQUIVO</div><strong>${money(d[key].totalCents/100)}</strong><p>${esc(d[key].fileName)}</p><small>Concluído em ${date(d[key].completedAt)}<br>Fórmula: ${esc(d[key].formula)} · versão ${esc(d[key].calculationVersion)}</small><a href="/purchases.html?${new URLSearchParams({job:d[key].jobId,...(key==='sales'?{type:'SALES'}:{}),generation:d.generationId,client:d.clientId})}">Conferir linhas de ${label.toLowerCase()} →</a></article>`).join('')}</div>${classificationDetails()}</details>`;
}
function setRbt12Mode(mode,{preserveValue=false}={}) {
  const previous=preserveValue?$('#rbt12').value:'';
  clearRbt12();S.rbt12Mode=mode;
  const manual=mode==='MANUAL',input=$('#rbt12');
  input.readOnly=!manual;input.required=manual;input.placeholder=manual?'Informe a RBT12':'Leia o PDF';input.value=previous;
  $('label[for="rbt12"]').textContent=manual?'RBT12 informada manualmente *':'RBT12 · seção 2.2';
  $('#rbt12-help').textContent=manual?'Receita efetiva dos 12 meses anteriores ao PA.':'Soma das 12 competências anteriores ao PA.';
  $('.sim-pdf-upload').hidden=manual;$('#rbt12-manual').hidden=manual;$('#rbt12-use-pdf').hidden=!manual;$('#rbt12-manual-notice').hidden=!manual;
  $('#rbt12-manual-confirm').checked=false;$('#rbt12-manual-confirm').required=manual;
  updateGuidedRbt12();
}
function setupGuidedRbt12() {
  S.guidedStage=true;
  $('#simulator-intro').insertAdjacentHTML('afterend',`<section class="card sim-guided-rbt12" id="guided-rbt12-stage" aria-labelledby="guided-rbt12-title"><div class="eyebrow">COMPRAS E VENDAS CONCLUÍDAS</div><h2 id="guided-rbt12-title" tabindex="-1">Agora, o extrato do Simples</h2><p>Se tiver o PDF, adicione abaixo. Vamos ler a seção 2.2 e preencher a RBT12 automaticamente.</p><div id="guided-rbt12-reader"></div><div class="sim-guided-actions"><button type="button" id="guided-rbt12-skip">Não tenho o extrato agora</button><button type="button" class="primary" id="guided-rbt12-continue" disabled>Continuar com a RBT12</button></div><p class="sim-guided-note">Sem o PDF, você poderá informar a RBT12 nos próximos dados.</p></section>`);
  const reader=$('#guided-rbt12-reader');
  for(const selector of ['.sim-pdf-grid','#rbt12-details'])reader.append($(selector));
  if(S.rbt12Mode==='MANUAL'){
    // A previous manual draft remains available if the user chooses to continue without a PDF.
    S.manualDraft={value:$('#rbt12').value,valid:value('rbt12')!==null,confirmed:$('#rbt12-manual-confirm').checked};
    setRbt12Mode('PDF');
  }
  $('#simulator-form').hidden=true;$('.sim-context').hidden=true;$('.sim-step-track').hidden=true;
  $('#rbt12-pdf').insertAdjacentHTML('beforebegin','<span class="sim-guided-placeholder" aria-hidden="true">Adicione o extrato ou a declaração em PDF<br><small>A leitura começa ao selecionar o arquivo · até 8 MiB</small></span>');
  $('#guided-rbt12-continue').onclick=()=>{if(!S.readingPdf&&isSection22(S.rbt12Data)&&S.rbt12ExtractionId)finishGuidedRbt12(false);};
  $('#guided-rbt12-skip').onclick=()=>{if(!S.readingPdf)finishGuidedRbt12(true);};
  updateGuidedRbt12();$('#guided-rbt12-title').focus({preventScroll:true});
  if(S.guidedResume){
    if(S.manualDraft?.valid&&S.manualDraft.confirmed)finishGuidedRbt12(true);
    else if(isSection22(S.rbt12Data)&&S.rbt12ExtractionId)finishGuidedRbt12(false);
  }
}
function updateGuidedRbt12() {
  if(!S.guidedStage)return;
  const valid=isSection22(S.rbt12Data)&&S.rbt12ExtractionId===(S.rbt12Data.extractionId||S.rbt12Data.id);
  $('#guided-rbt12-continue').disabled=S.readingPdf||!valid;
  $('#guided-rbt12-skip').disabled=S.readingPdf;
  $('#guided-rbt12-continue').textContent=S.readingPdf?'Lendo a seção 2.2…':'Continuar com a RBT12';
  $('#rbt12-read').hidden=S.readingPdf||valid||!$('#rbt12-pdf')?.files?.length;
  $('#rbt12-read').textContent='Tentar ler novamente';
  $('#guided-rbt12-stage').setAttribute('aria-busy',String(S.readingPdf));
}
function finishGuidedRbt12(manual) {
  S.guidedStage=false;S.guidedResume=false;
  const section=$('#sim-section-extrato'),mode=$('.sim-rbt12-mode');
  for(const selector of ['.sim-pdf-grid','#rbt12-details'])section.insertBefore($(selector),mode);
  $('.sim-guided-placeholder')?.remove();$('#guided-rbt12-stage').remove();
  $('#simulator-form').hidden=false;$('.sim-context').hidden=false;$('.sim-step-track').hidden=false;
  $('#rbt12-read').hidden=false;$('#rbt12-read').textContent='Ler RBT12';
  if(manual){
    setRbt12Mode('MANUAL');
    if(S.manualDraft){$('#rbt12').value=S.manualDraft.value;$('#rbt12-manual-confirm').checked=S.manualDraft.confirmed;}
  }
  S.manualDraft=null;saveDraft();renderNotices();
  const params=new URLSearchParams(location.search);params.set('step','dados');history.replaceState(null,'','/simulator.html?'+params);
  const form=$('#simulator-form');
  (form.querySelector('input:invalid')||$('#generate-simulation')).focus();
}
function rbt12Reference() {
  if(S.snapshot)return S.snapshot.rbt12Extraction||S.snapshot.rbt12Manual||null;
  if(S.rbt12Mode==='MANUAL')return value('rbt12')===null?null:{source:'MANUAL',confirmed:$('#rbt12-manual-confirm').checked,rbt12Cents:Math.round(value('rbt12')*100)};
  return S.rbt12Data;
}
function clearRbt12(keepDocument=false) {
  S.rbt12Sequence++;S.rbt12ExtractionId=null;S.rbt12Data=null;if(!keepDocument){S.rbt12DocumentId=null;S.rbt12DocumentConfirmed=false;S.rbt12DocumentRetryable=false;}
  if(S.pdfUrl)URL.revokeObjectURL(S.pdfUrl);S.pdfUrl=null;
  if($('#rbt12'))$('#rbt12').value='';
  if($('#rbt12-download'))$('#rbt12-download').hidden=true;
  for(const id of ['rbt12-view-original','rbt12-view-searchable','rbt12-reprocess','rbt12-check-status'])if($('#'+id))$('#'+id).hidden=true;
  if($('#rbt12-details'))$('#rbt12-details').innerHTML='';
  if($('#rbt12-status'))$('#rbt12-status').textContent='Selecione o extrato ou a declaração PGDAS-D em PDF para conferir a seção 2.2. Até 8 MiB.';
  updateGuidedRbt12();
}
function setReadingPdf(reading) {
  S.readingPdf=reading;
  for(const id of ['rbt12-pdf','rbt12-read','rbt12-reprocess','rbt12-check-status','generate-simulation'])if($('#'+id))$('#'+id).disabled=reading;
  for(const id of ['rbt12-manual','rbt12-use-pdf'])if($('#'+id))$('#'+id).disabled=reading;
  updateGuidedRbt12();
}
function applyRbt12(data) {
  if(!isSection22(data)||!(data.extractionId||data.id))throw new Error('Leitura incompleta da seção 2.2. Leia novamente o extrato.');
  S.rbt12ExtractionId=data.extractionId||data.id;S.rbt12Data=data;S.rbt12DocumentId=data.documentId||null;S.rbt12DocumentConfirmed=!!S.rbt12DocumentId;S.rbt12DocumentRetryable=!!S.rbt12DocumentId;
  $('#rbt12').value=(data.rbt12Cents/100).toFixed(2);
  $('#rbt12-details').innerHTML=renderSection22(data);
  $('#rbt12-status').textContent=`Seção 2.2 conferida · PA ${data.pa}. Confira as 12 competências nos detalhes abaixo.`;
  const searchableLabel=data.searchablePdfScope==='SELECTED_PAGES'?'PDF com seção 2.2 pesquisável':'PDF pesquisável';
  $('#rbt12-view-searchable').textContent='Ver '+searchableLabel;
  $('#rbt12-download').textContent='Baixar '+searchableLabel;
  if(data.searchablePdfBase64) {
    const bytes=Uint8Array.from(atob(data.searchablePdfBase64),c=>c.charCodeAt(0));
    if(S.pdfUrl)URL.revokeObjectURL(S.pdfUrl);
    S.pdfUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const link=$('#rbt12-download');link.href=S.pdfUrl;link.download='extrato-simples-pesquisavel.pdf';link.hidden=false;
    delete S.rbt12Data.searchablePdfBase64;
  }
  for(const id of ['rbt12-view-original','rbt12-view-searchable','rbt12-reprocess','rbt12-check-status'])$('#'+id).hidden=true;
  if(S.rbt12DocumentId){
    $('#rbt12-view-original').hidden=false;
    $('#rbt12-view-searchable').hidden=data.searchableStored===false;
    $('#rbt12-reprocess').hidden=false;
  }
  if(data.downloadNotice)$('#rbt12-status').textContent+=' '+data.downloadNotice;
  updateGuidedRbt12();
}
function validateRestoredRbt12(data,context,extractionId){
  if(data.clientId!==context.clientId||(data.extractionId||data.id)!==extractionId||(context.documentId&&data.documentId!==context.documentId))throw new Error('A leitura recuperada não corresponde ao PDF e à empresa selecionados. Nenhuma RBT12 foi aplicada.');
  const registered=String(S.source.company.cnpj||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  if(registered&&registered.slice(0,8)!==data.cnpjBasico)throw new Error('O CNPJ básico do extrato não corresponde à empresa selecionada. Nenhuma RBT12 foi aplicada.');
}
function storedRbt12Actions(){
  $('#rbt12-check-status').hidden=!S.rbt12DocumentId;
  $('#rbt12-view-original').hidden=!S.rbt12DocumentConfirmed;
  $('#rbt12-reprocess').hidden=!S.rbt12DocumentRetryable;
}
async function restoreRbt12() {
  const id=S.rbt12ExtractionId,context=rbt12Context();
  S.rbt12Data=null;$('#rbt12').value='';
  try {
    const data=await api('/api/simples?'+new URLSearchParams({extractionId:id,clientId:context.clientId}));
    if(!currentRbt12(context)||S.rbt12ExtractionId!==id)return;
    validateRestoredRbt12(data,context,id);applyRbt12(data);saveDraft();
    if(S.guidedResume&&S.guidedStage)finishGuidedRbt12(false);
  }catch(error){if(currentRbt12(context)&&S.rbt12ExtractionId===id){clearRbt12(!!context.documentId);saveDraft();storedRbt12Actions();$('#rbt12-status').textContent=error.message;}}
}
async function restoreStoredRbt12(){
  if(!S.rbt12DocumentId||S.readingPdf)return;
  clearRbt12(true);invalidate();saveDraft();
  const context=rbt12Context(),status=$('#rbt12-status');
  $('#rbt12-check-status').hidden=false;$('#rbt12-check-status').disabled=true;status.textContent='Verificando o PDF armazenado desta empresa…';
  try{
    const document=await api('/api/v4/simples-documents/'+encodeURIComponent(context.documentId)+'/status');
    if(!currentRbt12(context))return;
    if(document.documentId!==context.documentId||document.clientId!==context.clientId){
      S.rbt12DocumentConfirmed=false;S.rbt12DocumentRetryable=false;storedRbt12Actions();
      throw new Error('O documento armazenado não corresponde à empresa selecionada. Nenhuma RBT12 foi aplicada.');
    }
    S.rbt12DocumentConfirmed=document.originalStored===true;
    S.rbt12DocumentRetryable=document.retryable===true;
    if(document.status==='READY'&&!document.error&&!document.lastError&&documentUuid(document.extractionId)){
      const data=await api('/api/simples?'+new URLSearchParams({extractionId:document.extractionId,clientId:context.clientId}));
      if(!currentRbt12(context))return;
      validateRestoredRbt12(data,context,document.extractionId);applyRbt12(data);invalidate();saveDraft();
      status.textContent+=' Leitura recuperada sem reenviar o PDF.';
      if(S.guidedResume&&S.guidedStage)finishGuidedRbt12(false);
      return;
    }
    storedRbt12Actions();
    if(document.status==='PROCESSING')status.textContent='A leitura do PDF armazenado ainda está em andamento. Use Verificar leitura para consultar novamente; nenhum novo OCR foi iniciado.';
    else if(S.rbt12DocumentConfirmed)status.textContent='O PDF original está armazenado. '+((document.error||document.lastError)?.message? (document.error||document.lastError).message+' ':'')+(document.hasReadyExtraction?'A tentativa mais recente não confirmou uma nova leitura; a leitura anterior foi preservada no servidor e não foi aplicada nesta tela. ':'')+'Use Ler novamente para tentar a leitura sem reenviar o arquivo.';
    else if(S.rbt12DocumentRetryable)status.textContent='O envio anterior foi registrado, mas o servidor ainda não confirmou o arquivo. Use Ler novamente para tentar a leitura do mesmo PDF sem reenviar.';
    else status.textContent='O envio do PDF ainda não foi confirmado no servidor. Verifique novamente ou selecione o arquivo para reenviar.';
    saveDraft();
  }catch(error){
    if(!currentRbt12(context))return;
    storedRbt12Actions();status.textContent=error.message||'Não foi possível verificar o PDF armazenado. Tente novamente.';
  }finally{if(currentRbt12(context))$('#rbt12-check-status').disabled=false;}
}
async function processStoredRbt12(urls,context) {
  if(urls.documentId!==context.documentId)throw new Error('A preparação da leitura não corresponde ao PDF selecionado.');
  const data=await api('/api/simples?'+new URLSearchParams({clientId:context.clientId}),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({documentId:urls.documentId,attemptId:urls.attemptId,originalGetUrl:urls.originalGetUrl,searchablePutUrl:urls.searchablePutUrl})
  });
  if(!currentRbt12(context))return null;
  if(data.documentId!==context.documentId||(data.clientId&&data.clientId!==context.clientId))throw new Error('A leitura não corresponde ao PDF e à empresa selecionados.');
  applyRbt12(data);invalidate();saveDraft();return data;
}
async function viewStoredPdf(kind) {
  if(!S.rbt12DocumentId||!S.rbt12DocumentConfirmed)return;
  const url='/api/v4/simples-documents/'+encodeURIComponent(S.rbt12DocumentId)+'/file?'+new URLSearchParams({kind});
  window.open(url,'_blank','noopener,noreferrer');
}
async function reprocessRbt12() {
  if(!S.rbt12DocumentId||!S.rbt12DocumentRetryable||S.readingPdf||S.saving)return;
  clearRbt12(true);invalidate();saveDraft();
  const context=rbt12Context(),status=$('#rbt12-status'),operation={};S.pdfOperation=operation;
  try{
    setReadingPdf(true);status.textContent='Lendo novamente a seção 2.2 do PDF armazenado…';
    const urls=await api('/api/v4/simples-documents/'+encodeURIComponent(context.documentId)+'/process-urls',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!currentRbt12(context))return;
    await processStoredRbt12(urls,context);
  }catch(error){if(currentRbt12(context)){clearRbt12(true);saveDraft();storedRbt12Actions();status.textContent=error.message||'Não foi possível reprocessar a leitura.';fail(error);}}
  finally{if(S.pdfOperation===operation){S.pdfOperation=null;setReadingPdf(false);}}
}
async function readRbt12Pdf() {
  if(S.readingPdf||S.saving)return;
  const file=$('#rbt12-pdf')?.files?.[0],status=$('#rbt12-status');
  clearRbt12();invalidate();saveDraft();
  const context=rbt12Context();
  if(!file){status.textContent='Selecione o extrato ou a declaração PGDAS-D em PDF.';return;}
  if(file.size>8*1024*1024){status.textContent='O extrato pode ter até 8 MiB neste fluxo.';return;}
  const operation={};S.pdfOperation=operation;
  try{
    setReadingPdf(true);status.textContent='Preparando o envio do PDF…';
    const started=await api('/api/v4/simples-documents',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({clientId:context.clientId,fileName:file.name,sizeBytes:file.size})});
    if(!currentRbt12(context))return;
    status.textContent='Armazenando o PDF original com segurança…';
    const uploaded=await fetch(started.originalPutUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file,signal:AbortSignal.timeout(55000)});
    if(!uploaded.ok)throw new Error('Não foi possível armazenar o PDF original. Tente novamente.');
    if(!currentRbt12(context)||$('#rbt12-pdf')?.files?.[0]!==file)return;
    S.rbt12DocumentId=started.documentId;S.rbt12DocumentConfirmed=true;S.rbt12DocumentRetryable=true;context.documentId=started.documentId;saveDraft();
    status.textContent='PDF armazenado. Lendo a seção 2.2…';
    await processStoredRbt12(started,context);
  }catch(error){
    if(!currentRbt12(context))return;
    clearRbt12(Boolean(S.rbt12DocumentId));saveDraft();storedRbt12Actions();
    status.textContent=(error.name==='TimeoutError'?'O envio do PDF demorou a responder. Tente enviar novamente.':error.message||'Não foi possível confirmar a seção 2.2.')+(S.rbt12DocumentId?' O arquivo original ficou armazenado; você pode verificar a leitura ou usar Ler novamente sem reenviar.':'');
    fail(error);
  }finally{if(S.pdfOperation===operation){S.pdfOperation=null;setReadingPdf(false);}}
}
window.addEventListener('pagehide',()=>{if(S.pdfUrl)URL.revokeObjectURL(S.pdfUrl);});
// Print every financial disclosure, preserving the reader’s choices after printing.
const printDetails=[];
window.addEventListener('beforeprint',()=>{
  if(document.body.classList.contains('dre-print-only'))return;
  if(S.result)setDrePrintPage(S.viewPeriod);
  if(S.result && $('#simulator-form')) {
    const context=document.createElement('section');context.id='simulation-print-context';
    for(const selector of ['#simulator-projection','.sim-period-details','#simulator-difal','#rbt12-details']) {
      const source=$('#simulator-form '+selector);if(!source||!source.textContent.trim())continue;
      const copy=source.cloneNode(true);copy.removeAttribute('id');
      copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      copy.querySelectorAll('details').forEach(detail=>detail.open=true);
      if(copy.matches('details'))copy.open=true;
      context.append(copy);
    }
    $('#simulation-result').before(context);
  }
  const calendarHost=$('.sim-calendar');
  if(calendarHost&&S.dreContext&&!calendarHost.querySelector('.dre-print-calendar'))calendarHost.querySelector('.dre-calendar-screen').insertAdjacentHTML('afterend',renderDrePrintCalendar({...S.dreContext,regimeId:S.calendarRegime,showPercent:S.dreShowPercent}));
  document.querySelectorAll('#simulator-app details:not([open])').forEach(detail=>{
    printDetails.push(detail);detail.open=true;
  });
});
window.addEventListener('afterprint',()=>{for(const detail of printDetails.splice(0))detail.open=false;$('#simulation-print-context')?.remove();$('.dre-print-calendar')?.remove();clearDrePrint();});

let drePrintFocus=null;
function setDrePrintPage(period){
  $('#dre-print-page-style')?.remove();
  const style=document.createElement('style');style.id='dre-print-page-style';
  style.textContent=`@page { size: ${period==='monthly'?'A3':'A4'} landscape; margin: 12mm; }`;
  document.head.append(style);
}
function clearDrePrint(){
  $('#dre-print-document')?.remove();$('#dre-print-page-style')?.remove();document.body.classList.remove('dre-print-only');
  if(drePrintFocus?.isConnected)drePrintFocus.focus({preventScroll:true});drePrintFocus=null;
}
function printDre(){
  if(!S.result||!S.dreContext)return;
  clearDrePrint();drePrintFocus=document.activeElement;
  document.body.insertAdjacentHTML('beforeend',renderDrePrintDocument({...S.dreContext,company:S.source.company,regimeId:S.calendarRegime,showPercent:S.dreShowPercent,period:S.viewPeriod}));
  document.body.classList.add('dre-print-only');setDrePrintPage(S.viewPeriod);
  try{window.print();}catch(error){clearDrePrint();fail(error);}
}

function classificationDetails() {
  if(!S.source.classification)return '';
  const c=S.source.classification;
  return `<h3>Subtotais preservados na classificação</h3><div class="sim-detail-grid">${[
    ['Compras · CNPJs não confirmados',c.purchases?.unconfirmedCount,c.purchases?.unconfirmedCents],
    ['Compras · CPF e outros documentos',c.purchases?.nonCnpjCount,c.purchases?.nonCnpjCents],
    ['Vendas · CNPJs não confirmados',c.sales?.unconfirmedCount,c.sales?.unconfirmedCents],
    ['Vendas · outros documentos, exceto CPF',c.sales?.otherDocumentsCount,c.sales?.otherDocumentsCents],
  ].map(([label,count,cents])=>`<article><span>${label}</span><strong>${money(cents==null?null:cents/100)}</strong><small>${count==null?'Contagem não disponível':esc(count)+' registros'} · incluídos em Não optantes</small></article>`).join('')}</div>`;
}
function renderNotices() {
  const manual=S.snapshot?.rbt12Source==='MANUAL'||(!S.readonly&&S.rbt12Mode==='MANUAL');
  const notices=[...(S.draftMigrationNotice?[{title:'Rascunho anterior à separação de serviços',detail:S.draftMigrationNotice}]:[]),...(manual?[{title:'RBT12 informada manualmente',detail:'A RBT12 foi informada pelo usuário e não foi validada pelo OCR do extrato. Confira a receita efetiva dos 12 meses anteriores ao período de apuração.'}]:[]),...(S.source.warnings||[]).map(detail=>({title:'Conferência dos relatórios',detail})),{title:'Classificação de vendas e créditos',detail:'Os três grupos de vendas de mercadorias e a receita de serviços compõem a receita total. Serviços identificados são separados para evitar duplicação. A classificação do comprador não cria uma alíquota diferente neste modelo. As compras alimentam as bases de crédito presumidas pela calculadora; confira o direito ao crédito nos documentos fiscais.'},...(S.result?.result.warnings||[])];
  const unique=[...new Map(notices.map(w=>[w.detail,w])).values()];
  const host=$('#simulation-notices'); if(!host)return;
  const open=host.querySelector('details')?.open ?? false;
  host.innerHTML=`<details class="sim-notices" ${open?'open':''}><summary><span>${unique.length} ${unique.length===1?'aviso':'avisos'} e premissas</span><span class="sim-notices-toggle">Detalhes <span aria-hidden="true">⌄</span></span></summary><div class="sim-notices-content">${unique.map(w=>`<article><strong>${esc(w.title)}</strong><p>${esc(w.detail)}</p></article>`).join('')}</div></details>`;
}
function fillSnapshot(snapshot) {
  S.months=S.source.periodBasis==='COLUMN_H'?S.source.reportMonths:snapshot.reportMonths; $('#period-months').value=String(S.months); applyReports();
  if(actualMonths()){
    const split=snapshot.source?.revenueSplit?.version==='SALES_SERVICES_V1';
    const oldBase=snapshot.baselineMonthlyGroups||Object.fromEntries(IMPORTED.map(key=>[key,(snapshot.projection?.monthlyGroupsCents?.[key]??NaN)/100]));
    S.monthlyInputs=S.source.monthlyReports.map((report,index)=>{
      const entry=baselineMonth(report,snapshot.draft.values),oldRow=snapshot.source.monthlyReports?.[index],oldInput=snapshot.monthlyInputs?.[index];
      if(oldRow?.sourceMonth===report.sourceMonth&&oldInput?.sourceMonth===report.sourceMonth){
        for(const key of IMPORTED)entry.groups[key]=(report.fields[key]+Math.round(oldInput.groups[key]*100)-oldRow.fields[key])/100;
        entry.values={...oldInput.values,serviceRevenue:(report.fields.serviceRevenueCents+Math.round(oldInput.values.serviceRevenue*100)-oldRow.fields.serviceRevenueCents)/100};
      }else{
        for(const key of IMPORTED)if(Number.isFinite(oldBase[key]))entry.groups[key]=(report.fields[key]+Math.round(snapshot.monthlyGroups[key]*100)-Math.round(oldBase[key]*100))/100;
        const base=split?snapshot.baselineServiceRevenue??snapshot.projection?.monthlyGroupsCents?.serviceRevenueCents/100:0;
        if(Number.isFinite(base))entry.values.serviceRevenue=(report.fields.serviceRevenueCents+Math.round(snapshot.draft.values.serviceRevenue*100)-Math.round(base*100))/100;
      }
      return entry;
    });
    S.draftMigrationNotice='Valores por competência dos relatórios. Ajustes e despesas anteriores foram preservados; confira cada mês antes de salvar.';showMonth();
  }
  if(!actualMonths()&&!S.serviceMigration)for(const key of IMPORTED) $('#'+key).value=Number(snapshot.monthlyGroups[key]).toFixed(2);
  for(const key of MANUAL)if(!actualMonths()&&(key!=='serviceRevenue'||!S.serviceMigration))$('#'+key).value=Number(snapshot.draft.values[key]).toFixed(2);
  if(snapshot.rbt12Source==='MANUAL'&&Number.isFinite(snapshot.draft.rbt12)) {setRbt12Mode('MANUAL');$('#rbt12').value=Number(snapshot.draft.rbt12).toFixed(2);}
  else if(isSection22(snapshot.rbt12Extraction))applyRbt12(snapshot.rbt12Extraction);
  else clearRbt12();
  $('#simulation-year').value=String(snapshot.draft.year);$('#sales-annex').value=String(snapshot.draft.salesAnnex);$('#service-annex').value=String(snapshot.draft.serviceAnnex);
  $('#period-confirm').checked=S.source.periodBasis==='COLUMN_H'; S.edited=S.serviceMigration?false:snapshot.manuallyAdjusted;
  $('#draft-status').textContent=S.source.periodBasis==='COLUMN_H'?'Valores copiados da versão salva. O período continua vinculado à coluna H; gere uma nova versão quando terminar.':'Valores copiados da versão salva. Confirme o período e gere uma nova versão; o registro anterior permanece disponível.';
}
function setSaving(value) {
  S.saving=value;
  const fieldset=$('#simulation-fields'); if(fieldset)fieldset.disabled=value;
  const button=$('#generate-simulation'); if(button)button.textContent=value?'Salvando simulação…':'Gerar simulação';
}
async function simulate() {
  if(S.saving||S.readingPdf)return;
  const manual=S.rbt12Mode==='MANUAL';
  if(manual&&(value('rbt12')===null||!$('#rbt12-manual-confirm').checked)){fail(new Error('Informe a RBT12 efetiva e confirme a origem manual para gerar a simulação.'));(value('rbt12')===null?$('#rbt12'):$('#rbt12-manual-confirm')).focus();return;}
  if(!manual&&(!isSection22(S.rbt12Data)||!S.rbt12ExtractionId||S.rbt12ExtractionId!==(S.rbt12Data.extractionId||S.rbt12Data.id)||Math.round(value('rbt12')*100)!==S.rbt12Data.rbt12Cents)){fail(new Error('Leia a seção 2.2 do PDF ou escolha informar a RBT12 sem o extrato.'));$('#rbt12-pdf').focus();return;}
  if(!$('#simulator-form').reportValidity())return;
  try {
    $('#simulator-error').textContent='';
    captureMonth();
    const input=draft(),groups=Object.fromEntries(IMPORTED.map(key=>[key,value(key)])),computed=actualMonths()?calculateMonthlySimulation(input,S.source.monthlyReports,S.monthlyInputs,S.source.sales.jobId):null;
    const difal=computed?.difalProjection||difalProjection(),result=computed?.result||calculateSimulation(input,difal);
    S.result={input,result,difalProjection:difal,monthlyGroups:groups,projection:computed?.projection||{...annualizeReports(S.source.fields,S.months),scenario:projectScenario(groups,input.values)}};S.snapshot=null;S.saveError=null;S.viewPeriod=actualMonths()?'monthly':'annual';if(actualMonths())S.dreMonth=S.source.monthlyReports[S.entry].month-1;saveDraft();
    S.pending=canSave()?{simulationId:crypto.randomUUID(),generationId:S.source.generationId,clientId:S.source.clientId,reportMonths:S.months,periodConfirmed:true,monthlyGroups:groups,draft:input,...(actualMonths()?{monthlyInputs:S.monthlyInputs}:{}),...(manual?{rbt12Source:'MANUAL',rbt12ManualConfirmed:true}:{rbt12ExtractionId:S.rbt12ExtractionId}),...(S.parentId?{parentSimulationId:S.parentId}:{})}:null;
    renderResult();renderNotices();
    $('#results-top').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    if(canSave())await persist();
  } catch(error) {fail(error);}
}
async function persist() {
  if(S.saving||!S.pending)return;
  const request=S.pending;setSaving(true);renderSaveStatus();
  try {
    const snapshot=await api('/api/v4/simulations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
    if(S.pending!==request)return;
    S.snapshot=snapshot;S.source=snapshot.source;S.edited=snapshot.manuallyAdjusted;S.result={input:snapshot.draft,result:snapshot.result,monthlyGroups:snapshot.monthlyGroups,projection:snapshot.projection,difalProjection:snapshot.difalProjection};S.pending=null;
    $('#simulator-intro').innerHTML=hero(false);
    const sourceDetails=$('.sim-report-details'),sourceOpen=sourceDetails.open;sourceDetails.outerHTML=sourceCard();$('.sim-report-details').open=sourceOpen;
    updateDifalSource();renderResult();renderNotices();
  } catch(error) {
    if(S.pending===request)S.saveError=error.message||String(error);
  } finally {setSaving(false);renderSaveStatus();}
}
function renderSaveStatus() {
  const host=$('#simulation-save-status');if(!host)return;
  if(S.snapshot)host.innerHTML=`<span class="sim-save-dot" aria-hidden="true"></span><span>Simulação salva no histórico · ${date(S.snapshot.createdAt)}</span><a id="saved-simulation-link" href="/simulator.html?simulation=${encodeURIComponent(S.snapshot._id)}">Abrir versão salva →</a>`;
  else if(S.saving)host.innerHTML='<span class="sim-save-dot pending" aria-hidden="true"></span><span>Salvando simulação no histórico…</span>';
  else if(!canSave())host.innerHTML='<span>Prévia local. Seu perfil permite consultar o histórico; salvar versões exige acesso de operador.</span>';
  else if(S.pending) {host.innerHTML=`<span>O salvamento não foi confirmado. ${esc(S.saveError||'Tente novamente.')}</span><button type="button" id="retry-save">Tentar salvar novamente</button>`;$('#retry-save').onclick=()=>void persist();}
}
function dreContext() {
  const result=S.result.result,year=S.result.input.year;
  const calendar=['DRE_CALENDAR_V1','DRE_CALENDAR_V2','DRE_CALENDAR_V3'].includes(S.snapshot?.monthlyDre?.version)?S.snapshot.monthlyDre:buildMonthlyDre(result,year,rbt12Reference(),S.source.period);
  const presentation=buildDrePresentation({result,calendar,monthlyGroups:S.result.monthlyGroups,projection:S.result.projection,source:S.source,reportMonths:S.months,engineInput:S.snapshot?.engineInput,reprocessing:S.snapshot?.reprocessing});
  return {presentation,calendar,year};
}
function renderResult() {
  if(!S.result)return;
  document.querySelectorAll('#simulation-result details').forEach(el=>S.detailStates.set(el.dataset.stateKey||el.className,el.open));
  S.dreContext=dreContext();
  const {input,monthlyGroups}=S.result,actual=S.result.result.method==='REPORT_MONTHS_V1',monthly=S.viewPeriod==='monthly',divisor=monthly&&!actual?12:1,periodLabel=monthly?'MENSAL':'ANUAL';
  const entry=actual&&monthly?S.result.result.monthlyResults.find(row=>row.month===S.dreMonth+1):null;
  const result=actual&&monthly?(entry?.result||{annualRevenue:null,regimes:[],bestRegimeId:null,difference:0}):S.result.result;
  const best=result.regimes.find(r=>r.id===result.bestRegimeId);
  $('#simulation-result').innerHTML=`<section class="sim-result" id="results-top"><div class="sim-result-head"><div><div class="eyebrow">PAINEL DA SIMULAÇÃO · ${input.year}</div><h2>Compare os regimes</h2><p class="sim-help">Valores ${monthly?'mensais':'anuais'} de ${input.year} · ${S.edited?'cenário com ajustes manuais':actual?'valores por competência':'média dos relatórios'}.</p></div><div class="sim-result-actions"><div class="sim-period-toggle" role="group" aria-label="Período dos resultados"><button type="button" data-period="monthly" aria-pressed="${monthly}">Mensal</button><button type="button" data-period="annual" aria-pressed="${!monthly}">Anual</button></div><button id="export-simulation" type="button">Exportar simulação</button></div></div>
    <div id="simulation-save-status" class="sim-save-status" role="status" aria-live="polite"></div>
    <div class="sim-kpis"><article><span>Faturamento ${monthly?'mensal':'anual'}</span><strong>${money(result.annualRevenue===null?null:result.annualRevenue/divisor)}</strong><small>${actual?(monthly?entry?.sourceMonth||'Sem dados nesta competência':'Soma das competências importadas'):monthly?'Média mensal usada na projeção':'Receita mensal × 12'}</small></article><article><span>Maior resultado estimado</span><strong class="${best?.annualProfit<0?'sim-negative':''}">${best?money(best.annualProfit/divisor):'Sem ranking'}</strong><small>${best?esc(best.name):'A receita é zero neste cenário'}</small></article><article><span>Diferença entre os cenários</span><strong>${best?money(result.difference/divisor):'—'}</strong><small>Maior menos menor resultado disponível</small></article></div>
    <div class="sim-subheading"><h3>Comparação por regime</h3><span>${monthly?'Por mês':'Por ano'} · ${input.year}</span></div><div class="sim-regimes">${result.regimes.map(r=>`<article class="sim-regime ${r.id===result.bestRegimeId?'best':''}"><span class="sim-badge">${r.id===result.bestRegimeId?'MAIOR RESULTADO ESTIMADO':r.available?'CENÁRIO COMPARATIVO':'REVISÃO NECESSÁRIA'}</span><h3>${esc(r.name)}</h3><strong class="${r.annualProfit<0&&r.available?'sim-negative':''}">${r.available?money(r.annualProfit/divisor):'Indisponível'}</strong><p>Resultado líquido ${monthly?'por mês':'por ano'}</p>${r.available?`<dl class="sim-regime-metrics"><div><dt>Tributos e encargos</dt><dd>${money(r.totalTaxes/divisor)}</dd></div><div><dt>Margem líquida</dt><dd>${pct(r.margin)}</dd></div><div><dt>Carga sobre receita</dt><dd>${pct(r.taxBurden)}</dd></div></dl>`:`<p>${esc(r.status)}</p>`}</article>`).join('')}</div>
    <details class="card sim-charts-details"><summary>Gráficos<span>Resultados, tributos, receitas e despesas</span></summary>${renderSimulationCharts({input,result,monthlyGroups,period:S.viewPeriod,actualMonths:actual,monthlyEntries:actual?(monthly?(entry?[entry]:[]):S.result.result.monthlyResults):null})}</details>
    ${memoryDetails()}
    ${monthly?renderMonthlyDre({...S.dreContext,result,reference:rbt12Reference(),period:S.source.period,regimeId:S.calendarRegime,showPercent:S.dreShowPercent,monthView:S.dreMonthView,month:S.dreMonth}):renderAnnualDre({...S.dreContext,showPercent:S.dreShowPercent})}</section>`;
  document.querySelectorAll('#simulation-result details').forEach(el=>{const key=el.dataset.stateKey||el.className;if(S.detailStates.has(key))el.open=S.detailStates.get(key);});
  $('#export-simulation').onclick=exportSimulation;
  $('#export-dre-csv').onclick=exportDre;
  $('#print-dre').onclick=printDre;
  $('#dre-show-percent').onchange=event=>{S.dreShowPercent=event.target.checked;renderResult();$('#dre-show-percent').focus({preventScroll:true});};
  document.querySelectorAll('[data-dre-month-view]').forEach(button=>button.onclick=()=>{S.dreMonthView=button.dataset.dreMonthView==='single';renderResult();document.querySelector(`[data-dre-month-view="${S.dreMonthView?'single':'all'}"]`).focus({preventScroll:true});});
  const monthSelect=$('#dre-month');if(monthSelect)monthSelect.onchange=()=>{S.dreMonth=Number(monthSelect.value);renderResult();$('#dre-month').focus({preventScroll:true});};
  document.querySelectorAll('[data-period]').forEach(button=>button.onclick=()=>{S.viewPeriod=button.dataset.period;renderResult();document.querySelector(`[data-period="${S.viewPeriod}"]`)?.focus({preventScroll:true});});
  const regimeSelect=$('#dre-regime');if(regimeSelect)regimeSelect.onchange=()=>{S.calendarRegime=regimeSelect.value;renderResult();$('#dre-regime').focus({preventScroll:true});};
  renderSaveStatus();
}
function formatMemory(row) {
  if(typeof row.value!=='number')return esc(row.value);
  if(row.unit==='percent')return pct(row.value);
  if(row.unit==='currency')return money(row.value);
  return esc(row.value.toLocaleString('pt-BR',{maximumFractionDigits:6}));
}
function memoryDetails() {
  const result=S.result.result,snapshot=S.snapshot;
  const sections=[...new Set(result.memory.map(row=>row.section))];
  const sources=snapshot?.taxSources||TAX_SOURCES;
  const engine=snapshot?.engineInput?.version==='REPORT_MONTHS_V1'?snapshot.engineInput.months[0]?.input:snapshot?.engineInput;
  return `<details class="card sim-memory"><summary>Memória de cálculo completa · ${result.memory.length} itens</summary><p class="sim-help">Modelo ${esc(snapshot?.modelVersion||result.version)} · ${result.method==='REPORT_MONTHS_V1'?'soma dos cálculos por competência':'memória original anual'}. A troca entre Mensal e Anual altera a apresentação do painel e da DRE; as fórmulas abaixo conservam suas unidades originais.</p><div class="sim-links">${sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join('')}</div>${engine?`<div class="sim-engine-premises"><h3>Parâmetros capturados nesta versão</h3><p class="sim-help">Anexo de vendas ${esc(engine.salesAnnex)} · serviços ${esc(engine.serviceAnnex)} · referência de receita 12 meses ${money(engine.rbt12)}</p><div class="sim-detail-grid">${Object.entries(engine.rates||{}).map(([key,val])=>`<article><span>${esc({cbs:'CBS',ibs:'IBS',icms:'ICMS',iss:'ISS',payroll:'Encargos sobre folha',irSales:'Presunção de IRPJ · vendas',csSales:'Presunção de CSLL · vendas',irServices:'Presunção de IRPJ · serviços',csServices:'Presunção de CSLL · serviços'}[key]||key)}</span><strong>${pct(val)}</strong></article>`).join('')}</div></div>`:''}
    ${sections.map(section=>`<section class="sim-memory-section"><h3>${esc(section)}</h3><div class="sim-memory-items">${result.memory.filter(row=>row.section===section).map(row=>`<article><div><strong>${esc(row.label)}</strong><p>${esc(row.formula)}</p></div><span>${formatMemory(row)}</span></article>`).join('')}</div></section>`).join('')}</details>`;
}
function capturedFields(snapshot) {
  const d=snapshot.draft,fields=[['RBT12 do Simples Nacional',d.rbt12 ?? snapshot.engineInput?.rbt12],['Receita de serviços',d.values.serviceRevenue],['Receita de vendas · total',d.values.salesRevenue],['Faturamento vendas Optantes SN',snapshot.monthlyGroups.salesOptantCents],['Faturamento vendas Não Optantes SN',snapshot.monthlyGroups.salesNonOptantCents],['Faturamento Vendas de CPFs',snapshot.monthlyGroups.salesCpfCents],['Compras de empresas do Simples Nacional',d.values.simplePurchases],['Compras de empresas fora do Simples',d.values.regularPurchases],['Salários e pró-labore',d.values.salaries],['Benefícios da equipe',d.values.benefits],['Outras despesas da empresa',d.values.adminExpenses],['Aluguel',d.values.rent],['Taxas de cartão',d.values.cardExpenses]];
  const monthlyTable=snapshot.result?.method==='REPORT_MONTHS_V1'?`<p>RBT12: ${money(d.rbt12)}</p><div class="projection-table-wrap"><table><thead><tr><th>Competência</th><th>Vendas</th><th>Serviços</th><th>Compras SN</th><th>Compras fora SN</th><th>Despesas</th></tr></thead><tbody>${snapshot.monthlyInputs.map(row=>`<tr><th>${esc(row.sourceMonth)}</th><td>${money(IMPORTED.slice(0,3).reduce((sum,key)=>sum+row.groups[key],0))}</td><td>${money(row.values.serviceRevenue)}</td><td>${money(row.groups.purchasesOptantCents)}</td><td>${money(row.groups.purchasesNonOptantCents)}</td><td>${money(MANUAL.slice(1).reduce((sum,key)=>sum+row.values[key],0))}</td></tr>`).join('')}</tbody></table></div>`:null;
  return `<section class="card sim-snapshot" id="simulation-snapshot"><div class="sim-result-head"><div><div class="eyebrow">VERSÃO SALVA · SOMENTE LEITURA</div><h2>${esc(snapshot.title||'Simulação de '+S.source.company.name)}</h2><p class="sim-help">${date(snapshot.createdAt)} · ${esc(snapshot.createdBy?.name||'Usuário')} · modelo ${esc(snapshot.modelVersion)}</p></div>${canSave()?'<button type="button" class="primary" id="create-version">Criar nova versão</button>':''}</div><div class="sim-snapshot-meta"><span>${d.year} · Vendas: Anexo ${d.salesAnnex===1?'I':'II'}</span><span>Serviços: Anexo ${{3:'III',4:'IV',5:'V'}[d.serviceAnnex]}</span><span>${snapshot.reportMonths} ${snapshot.reportMonths===1?'mês':'meses'} nos arquivos · ${snapshot.periodBasis==='COLUMN_H'?'coluna H':'período confirmado'}</span><span>RBT12: ${snapshot.rbt12Source==='SIMPLES_SECTION_22'?'Extrato · seção 2.2':snapshot.rbt12Source==='SIMPLES_PDF'?'Extrato · leitura anterior':snapshot.rbt12Source==='MANUAL'?'informada manualmente':'estimativa histórica'}</span><span>${snapshot.manuallyAdjusted?'Valores importados ajustados':'Valores dos relatórios preservados'}</span></div>${snapshot.parentSimulationId&&!snapshot.parentSimulationDeleted?`<a class="sim-back" href="/simulator.html?simulation=${encodeURIComponent(snapshot.parentSimulationId)}">Abrir versão de origem →</a>`:snapshot.parentSimulationDeleted?'<p class="sim-help">A versão de origem foi excluída do histórico.</p>':''}<details class="sim-captured-details"><summary>Dados usados no cálculo <span>Valores mensais · exceto RBT12</span></summary>${monthlyTable||`<div class="sim-detail-grid">${fields.map(([label,val])=>`<article><span>${label}</span><strong>${money(val)}</strong></article>`).join('')}</div>`}${snapshot.adjustments?.length?`<details class="sim-adjustments"><summary>${snapshot.adjustments.length} ajustes em relação aos relatórios</summary><div class="sim-memory-items">${snapshot.adjustments.map(a=>`<article><div><strong>${a.sourceMonth?esc(a.sourceMonth)+' · ':''}${esc(fieldLabel(a.field))}</strong><p>Valor mensal dos relatórios: ${money(a.reportMonthlyValue)}</p></div><span>Simulado: ${money(a.simulatedMonthlyValue)}</span></article>`).join('')}</div></details>`:''}<p class="sim-help sim-record-id">Registro ${esc(snapshot._id)} · Base de cálculo ${esc(snapshot.calculatorSourceCommit)}</p></details></section>`;
}
function fieldLabel(key) { return {serviceRevenue:'Vendas de serviços',serviceRevenueCents:'Vendas de serviços',salesOptantCents:'Vendas Optantes SN',salesNonOptantCents:'Vendas Não Optantes SN',salesCpfCents:'Vendas de CPFs',purchasesOptantCents:'Compras do Simples',purchasesNonOptantCents:'Compras fora do Simples'}[key]||key; }
function showSnapshot(snapshot) {
  if(snapshot.result?.method==='REPORT_MONTHS_V1'){S.entry=0;S.viewPeriod='monthly';S.dreMonth=snapshot.source.monthlyReports[0].month-1;}
  S.snapshot=snapshot;S.source=snapshot.source;S.months=snapshot.reportMonths;S.edited=snapshot.manuallyAdjusted;S.readonly=true;S.pending=null;S.result={input:snapshot.draft,result:snapshot.result,monthlyGroups:snapshot.monthlyGroups,projection:snapshot.projection,difalProjection:snapshot.difalProjection};
  $('#simulator-app').innerHTML=`<div id="simulator-intro">${hero(true)}</div>${capturedFields(snapshot)}<div id="simulator-projection"></div><div id="simulator-difal"></div>${renderSection22(snapshot.rbt12Extraction)}${sourceCard()}<div id="simulation-notices"></div><div id="simulation-result"></div>`;
  updateProjection();updateDifalSource();renderNotices();renderResult();
  const button=$('#create-version');if(button)button.onclick=()=>void openSnapshotVersion(snapshot);
}
async function openSnapshotVersion(snapshot) {
  const button=$('#create-version');if(button)button.disabled=true;
  try {
    const current=await api(`/api/v4/generations/${snapshot.generationId}/simulator?${new URLSearchParams({clientId:snapshot.clientId})}`);
    if(current.generationId!==snapshot.generationId||current.clientId!==snapshot.clientId)throw new Error('A origem atual não corresponde à empresa desta simulação.');
    S.source=current;S.parentId=snapshot._id;S.key=`maximum-simulator:copy:${S.user._id}:${snapshot._id}`;
    history.replaceState(null,'',sourceUrl());display(snapshot);
    $('#simulator-app').scrollIntoView({block:'start',behavior:'instant'});
  } catch(error) {
    fail(new Error('Não foi possível conferir os relatórios para criar uma nova versão. A simulação salva foi preservada. '+(error.message||String(error))));
    if(button)button.disabled=false;
  }
}

function exportSimulation() {
  if(!S.result)return;
  const payload=S.snapshot||{...(actualMonths()?{monthlyInputs:S.monthlyInputs}:{}),saved:false,generatedAt:new Date().toISOString(),calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,source:S.source,reportMonths:S.months,manuallyAdjusted:S.edited,monthlyGroups:S.result.monthlyGroups,monthlyGroupsUnit:'BRL',projection:S.result.projection,difalProjection:S.result.difalProjection,rbt12Source:S.rbt12Mode==='MANUAL'?'MANUAL':'SIMPLES_SECTION_22',rbt12Extraction:S.rbt12Data,...(S.rbt12Mode==='MANUAL'?{rbt12Manual:{source:'MANUAL',confirmed:$('#rbt12-manual-confirm').checked,rbt12Cents:Math.round(value('rbt12')*100)}}:{}),monthlyDre:buildMonthlyDre(S.result.result,S.result.input.year,rbt12Reference(),S.source.period),draft:S.result.input,result:S.result.result};
  const url=URL.createObjectURL(new Blob([JSON.stringify(buildDreExportPayload(payload,S.dreContext.presentation),null,2)],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`simulacao-${String(S.source.company.code||'empresa').replace(/[^\w-]/g,'_')}-${S.result.input.year}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function exportDre() {
  if(!S.result||!S.dreContext)return;
  const csv=buildDreCsv({...S.dreContext,company:S.source.company,period:S.viewPeriod,showPercent:S.dreShowPercent});
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`dre-${String(S.source.company.code||'empresa').replace(/[^\w-]/g,'_')}-${S.result.input.year}-${S.viewPeriod==='monthly'?'mensal':'anual'}.csv`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function boot() {
  try {
    S.user=(await api('/api/auth/session')).user;mountNavigation(S.user,'simulations');
    if(!S.user||S.user.mustChangePassword){$('#simulator-app').innerHTML=`<section class="card sim-empty"><h2>${S.user?.mustChangePassword?'Redefina sua senha para continuar':'Entre para continuar'}</h2><p>Use sua conta Maximum para acessar os relatórios e o simulador.</p><a class="sim-back" href="/">Acessar painel →</a></section>`;return;}
    const params=new URLSearchParams(location.search),simulation=params.get('simulation'),generation=params.get('generation'),client=params.get('client'),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if(simulation) {if(!uuid.test(simulation))throw new Error('Identificação da simulação inválida.');showSnapshot(await api('/api/v4/simulations/'+simulation));return;}
    if(!generation||!client){$('#simulator-app').innerHTML='<section class="card sim-empty"><h1>Seu próximo cenário começa aqui.</h1><p>Selecione a empresa e importe compras e vendas para começar ou reabra uma simulação salva.</p><div class="sim-links"><a class="sim-back" href="/generations.html">Iniciar geração →</a><a class="sim-back" href="/simulations.html">Ver simulações salvas →</a></div></section>';return;}
    if(!uuid.test(generation)||!uuid.test(client))throw new Error('Identificação da geração ou empresa inválida.');
    const parent=params.get('parent');
    if(parent){
      if(!uuid.test(parent))throw new Error('Identificação da versão de origem inválida.');
      const snapshot=await api('/api/v4/simulations/'+parent);
      if(snapshot.generationId!==generation||snapshot.clientId!==client)throw new Error('A versão de origem pertence a outra empresa ou geração.');
      showSnapshot(snapshot);await openSnapshotVersion(snapshot);return;
    }
    S.guided=params.get('guided')==='1';S.guidedResume=params.get('step')==='dados';
    S.source=await api(`/api/v4/generations/${generation}/simulator?${new URLSearchParams({clientId:client})}`);
    S.key=`maximum-simulator:v1:${S.user._id}:${generation}:${client}:${S.source.purchases.jobId}:${S.source.sales.jobId}`;
    display();
  } catch(error) {fail(error);$('#simulator-app').innerHTML='<section class="card sim-empty"><h2>Não foi possível abrir o simulador.</h2><p>Confira o acesso e os relatórios da empresa ou tente abrir a versão salva novamente.</p><div class="sim-links"><a class="sim-back" href="/simulations.html">Simulações salvas →</a><a class="sim-back" href="/generations.html?view=history">Conferir relatórios →</a></div></section>';}
}
boot();
