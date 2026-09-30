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
const S = {source:null,user:null,key:'',result:null,months:1,edited:false,snapshot:null,parentId:null,pending:null,saving:false,viewPeriod:'annual',readonly:false,rbt12ExtractionId:null};
const canSave = () => ['admin','operator'].includes(S.user?.role);
const sourceUrl = () => '/simulator.html?'+new URLSearchParams({generation:S.source.generationId,client:S.source.clientId,...(S.parentId?{parent:S.parentId}:{})});
const fail = error => { $('#simulator-error').textContent = error.message || String(error); };
async function api(path, options={}) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),55000);
  try {
    const response = await fetch(path,{credentials:'same-origin',...options,signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
    return data;
  } catch(error) { if(error.name === 'AbortError') throw new Error('O servidor demorou a responder. Tente salvar novamente para confirmar o mesmo registro.'); throw error; }
  finally { clearTimeout(timer); }
}
function moneyField(id, label, help, imported=false, readonly=false) {
  return `<div class="sim-field"><label for="${id}">${label}${readonly?'':' *'}${imported?'<span class="sim-tag">PREENCHIDO PELO RELATÓRIO · EDITÁVEL</span>':''}</label><input id="${id}" name="${id}" type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" ${readonly?'readonly':'required'} placeholder="0,00" aria-describedby="${id}-help"><small id="${id}-help">${help}</small></div>`;
}
function section(number,title,subtitle,content) {
  return `<section class="card sim-section"><div class="sim-section-header"><span class="sim-number">${number}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div>${content}</section>`;
}
function display(prefill=null) {
  S.readonly=false; S.result=null; S.snapshot=null; S.pending=null; S.rbt12ExtractionId=null;
  const automaticPeriod=S.source.periodBasis==='COLUMN_H'&&Number.isInteger(S.source.reportMonths);
  if(automaticPeriod)S.months=S.source.reportMonths;
  const periodText=automaticPeriod ? `<h2>Período identificado automaticamente</h2><p class="sim-help">A coluna H · Data Escrituração/Serviço foi lida em compras e vendas. O sistema só libera o simulador quando os dois arquivos têm o mesmo intervalo.</p><div class="sim-period"><label for="period-months">Meses nos relatórios<select id="period-months" disabled><option value="${S.months}">${S.months} ${S.months===1?'mês':'meses'} · ${esc(S.source.period.startMonth)} a ${esc(S.source.period.endMonth)}</option></select></label><label class="sim-confirm"><input id="period-confirm" type="checkbox" checked disabled>Período confirmado automaticamente pela coluna H.</label></div>` :
    `<h2>Qual período os dois arquivos representam?</h2><p class="sim-help">Este histórico não possui a coluna H persistida. Informe de 1 a 12 meses e confirme o mesmo período para compras e vendas.</p><div class="sim-period"><label for="period-months">Meses nos relatórios<select id="period-months">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} ${i?'meses · média mensal':'mês · valores integrais'}</option>`).join('')}</select></label><label class="sim-confirm"><input id="period-confirm" type="checkbox" required>Confirmo que compras e vendas correspondem ao mesmo período e à quantidade de meses selecionada.</label></div>`;
  $('#simulator-app').innerHTML = `<div id="simulator-intro">${hero(false)}</div>${sourceCard()}<div id="simulation-notices"></div>
    <form id="simulator-form"><fieldset id="simulation-fields"><section class="card sim-source">${periodText}<p id="period-explanation" class="sim-help"></p></section>
    ${section('01','Quanto a empresa fatura?','Por mês',`<div class="sim-fields">${moneyField('serviceRevenue','Receita de serviços','Quanto sua empresa recebe por mês com serviços, antes de descontar despesas e impostos. Não repita os valores já incluídos nas vendas.')}${moneyField('salesRevenue','Receita de vendas','Soma automática dos três grupos de vendas abaixo.',false,true)}</div><div class="sim-fields sales">${moneyField('salesOptantCents','Faturamento vendas Optantes SN','Vendas a CNPJs com opção pelo Simples confirmada na pesquisa.',true)}${moneyField('salesNonOptantCents','Faturamento vendas Não Optantes SN','Não optantes, não confirmados e outros documentos, exceto CPFs.',true)}${moneyField('salesCpfCents','Faturamento Vendas de CPFs','Vendas identificadas com CPF, sem consulta fiscal de CNPJ.',true)}</div><div class="sim-totals"><article><span>Total por mês</span><strong id="monthly-revenue">Preencha as receitas</strong></article><article><span>Receita estimada em 12 meses</span><strong id="annual-revenue">Calculada automaticamente</strong></article></div><p class="sim-help">Estimativa automática: receita mensal × 12. Não é uma consulta ao faturamento real dos últimos 12 meses.</p>`)}
    ${section('02','Quanto a empresa compra?','Por mês',`<p class="sim-help">Separe as compras pela categoria do fornecedor. A nota fiscal pode ajudar a identificar se ele está no Simples Nacional.</p><div class="sim-fields">${moneyField('purchasesOptantCents','Compras de empresas do Simples Nacional','Valor mensal das mercadorias compradas de fornecedores que estão no Simples.',true)}${moneyField('purchasesNonOptantCents','Compras de empresas fora do Simples','Valor mensal das mercadorias dos demais fornecedores, incluindo não confirmados e documentos não consultáveis.',true)}</div>`)}
    ${section('03','Quais são as despesas?','Por mês',`<div class="sim-fields">${moneyField('salaries','Salários e pró-labore','Total mensal pago à equipe e aos sócios pelo trabalho na empresa.')}${moneyField('benefits','Benefícios da equipe','Vale-transporte, alimentação e outros benefícios pagos no mês.')}${moneyField('adminExpenses','Outras despesas da empresa','Água, energia, internet e outras despesas. Não repita os valores dos outros campos.')}${moneyField('rent','Aluguel','Valor mensal do aluguel. Se não houver, digite 0.')}${moneyField('cardExpenses','Taxas de cartão','Total pago em taxas no mês, em reais. Se não houver, digite 0.')}</div>`)}
    ${section('04','Sobre a simulação','Escolha o cenário',`<div class="sim-fields">${moneyField('rbt12','RBT12 do Simples Nacional','Receita bruta acumulada nos 12 meses anteriores ao PA. Você pode informar manualmente ou ler o Extrato do Simples Nacional em PDF.')}<div class="sim-field"><label for="rbt12-pdf">Extrato do Simples Nacional (PDF)</label><input id="rbt12-pdf" type="file" accept="application/pdf,.pdf"><button type="button" id="rbt12-read">Ler RBT12 do PDF</button><small id="rbt12-status">O PDF é processado em memória; o sistema salva somente o resultado e a referência da leitura.</small></div><div class="sim-field"><label for="simulation-year">Ano da simulação</label><select id="simulation-year"><option>2027</option><option>2028</option></select></div><div class="sim-field"><label for="sales-annex">Atividade das vendas</label><select id="sales-annex"><option value="1">Comércio · Anexo I</option><option value="2">Indústria · Anexo II</option></select></div><div class="sim-field"><label for="service-annex">Categoria dos serviços</label><select id="service-annex"><option value="3">Anexo III</option><option value="4">Anexo IV</option><option value="5">Anexo V</option></select><small>Se tiver dúvida sobre a categoria, confirme com sua contabilidade.</small></div></div>`)}
    <div class="sim-actions"><button class="primary" type="submit" id="generate-simulation">Gerar simulação</button><button id="restore-reports" type="button">Restaurar valores dos relatórios</button><small id="draft-status" role="status">Serviços e despesas precisam ser informados. Use 0 quando não houver valor.</small></div></fieldset></form><div id="simulation-result"></div>`;
  applyReports();
  $('#simulator-form').oninput = event => {
    if(S.saving)return;
    if (IMPORTED.includes(event.target.id)) S.edited=true;
    if(event.target.id==='rbt12'){S.rbt12ExtractionId=null;const status=$('#rbt12-status');if(status)status.textContent='RBT12 alterada manualmente. Para vincular novamente ao PDF, leia o extrato outra vez.';}
    updateRevenue(); invalidate(); saveDraft();
  };
  $('#period-months').onchange = () => {
    if(automaticPeriod)return;
    const months=Number($('#period-months').value);
    if(S.edited && !confirm('Recalcular os cinco campos importados com o novo período? Os ajustes manuais nesses campos serão substituídos.')) { $('#period-months').value=String(S.months); return; }
    S.months=months; $('#period-confirm').checked=false; applyReports(); invalidate(); saveDraft();
  };
  $('#restore-reports').onclick = () => { if(!S.edited || confirm('Restaurar os cinco campos importados? Serviços e despesas serão mantidos.')) { applyReports(); invalidate(); saveDraft(); } };
  $('#rbt12-read').onclick = () => void readRbt12Pdf();
  $('#simulator-form').onsubmit = event => { event.preventDefault(); void simulate(); };
  if(prefill) fillSnapshot(prefill);
  restoreDraft();
  updateRevenue(); renderNotices();
}
// Allocate monthly rounding cents across sales so the three categories add to the rounded total.
function monthlyGroups(keys) {
  const exact=keys.map(k=>S.source.fields[k]/S.months), base=exact.map(Math.floor);
  let remainder=Math.round(keys.reduce((sum,k)=>sum+S.source.fields[k],0)/S.months)-base.reduce((a,b)=>a+b,0);
  const order=exact.map((v,i)=>({i,fraction:v-base[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
  for(let i=0;i<remainder;i++) base[order[i].i]++;
  keys.forEach((key,i)=>$('#'+key).value=(base[i]/100).toFixed(2));
}
function applyReports() {
  monthlyGroups(IMPORTED.slice(0,3)); monthlyGroups(IMPORTED.slice(3)); S.edited=false;
  $('#period-explanation').textContent=`Cada grupo importado = total do grupo no arquivo ÷ ${S.months} ${S.months===1?'mês':'meses'}, arredondado para centavos. ${S.source.periodBasis==='COLUMN_H'?'O período veio da coluna H e não precisa ser informado manualmente.':'Serviços e despesas devem ser valores mensais.'}`;
  updateRevenue();
}
function value(id) { const input=$('#'+id); return input.value!=='' && input.validity.valid ? Number(input.value) : null; }
function salesTotal() { const amounts=IMPORTED.slice(0,3).map(value); return amounts.some(v=>v===null)?null:amounts.reduce((a,b)=>a+Math.round(b*100),0)/100; }
function updateRevenue() {
  const sales=salesTotal(), service=value('serviceRevenue');
  $('#salesRevenue').value=sales===null?'':sales.toFixed(2);
  const total=sales===null||service===null?null:Math.round((sales+service)*100)/100;
  $('#monthly-revenue').textContent=total===null?'Preencha as receitas':money(total);
  $('#annual-revenue').textContent=total===null?'Calculada automaticamente':money(total*12);
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
  const data={months:S.months,edited:S.edited,confirmed:$('#period-confirm').checked,rbt12ExtractionId:S.rbt12ExtractionId,fields:Object.fromEntries([...IMPORTED,...MANUAL,'rbt12'].map(key=>{const field=$('#'+key);return [key,field.value!==''&&field.validity.valid?Number(field.value).toFixed(2):field.value];})),year:$('#simulation-year').value,salesAnnex:$('#sales-annex').value,serviceAnnex:$('#service-annex').value};
  try { sessionStorage.setItem(S.key,JSON.stringify(data)); $('#draft-status').textContent='Rascunho salvo nesta aba, vinculado à empresa e aos dois relatórios. Alterar valores exige gerar a simulação novamente.'; }
  catch { $('#draft-status').textContent='Não foi possível guardar o rascunho nesta aba. Mantenha a página aberta até concluir.'; }
}
function restoreDraft() {
  try {
    const data=JSON.parse(sessionStorage.getItem(S.key)||'null'); if(!data || !Number.isInteger(data.months) || data.months<1 || data.months>12) return;
    if(S.source.periodBasis!=='COLUMN_H')S.months=data.months; $('#period-months').value=String(S.months);applyReports();
    for(const key of [...IMPORTED,...MANUAL,'rbt12']) { const v=data.fields?.[key]; if(typeof v==='string' && (v==='' || /^\d+(\.\d{1,2})?$/.test(v))) $('#'+key).value=v; }
    if(typeof data.rbt12ExtractionId==='string'&&/^[a-f0-9-]{36}$/.test(data.rbt12ExtractionId))S.rbt12ExtractionId=data.rbt12ExtractionId;
    for(const [key,id,choices] of [['year','simulation-year',['2027','2028']],['salesAnnex','sales-annex',['1','2']],['serviceAnnex','service-annex',['3','4','5']]]) if(choices.includes(data[key])) $('#'+id).value=data[key];
    S.edited=data.edited===true;$('#period-confirm').checked=S.source.periodBasis==='COLUMN_H'||data.confirmed===true;$('#draft-status').textContent='Rascunho desta empresa restaurado. Confira os campos antes de gerar.';
  } catch { /* Invalid/unavailable local drafts never prevent using verified report totals. */ }
}
const DRE=[['services','Receita de serviços'],['sales','Receita de vendas'],['revenue','Receita bruta total'],['das','− DAS'],['cbsDebit','− Débito de CBS'],['ibsDebit','− Débito de IBS'],['icmsNet','− ICMS líquido fora do DAS'],['iss','− ISS fora do DAS'],['netRevenue','Receita líquida'],['cmvSimple','− Compras do Simples'],['cmvRegular','− Compras fora do Simples'],['cmv','CMV total'],['cbsUsed','+ Crédito CBS utilizado'],['ibsUsed','+ Crédito IBS utilizado'],['grossProfit','Lucro bruto'],['salaries','− Salários e pró-labore'],['benefits','− Benefícios'],['payroll','− Encargos adicionais'],['personnel','Pessoal e encargos'],['administrative','− Outras despesas'],['rent','− Aluguel'],['cards','− Taxas de cartão'],['preTax','Resultado antes de IRPJ/CSLL'],['irpj','− IRPJ e adicional'],['csll','− CSLL'],['netProfit','Resultado líquido']];
function hero(readonly) {
  const company=S.source.company;
  return `<div class="sim-top-links"><a class="sim-back" href="/generations.html?id=${encodeURIComponent(S.source.generationId)}">← Conferir relatórios</a><a class="sim-back" href="/simulations.html?clientId=${encodeURIComponent(S.source.clientId)}">Histórico de simulações →</a></div>
    <div class="sim-hero"><div><div class="eyebrow">SIMULADOR · ${esc(company.code||'EMPRESA')}</div><h1>Uma visão clara.<br>Melhores decisões.</h1><p><strong>${esc(company.name)}</strong><br>${readonly?'Todos os dados e resultados da versão salva, disponíveis para conferência.':'Compras e vendas já separadas. Complete os valores e compare os cenários.'}</p></div><div class="sim-hero-side"><span class="sim-hero-icon" aria-hidden="true">↗</span><span>${readonly?'Versão preservada':S.parentId?'Nova versão da simulação':'Da informação à decisão'}</span></div></div>
    ${readonly?'':`<nav class="sim-step-track" aria-label="Seções do simulador"><a href="#serviceRevenue">01 · Faturamento</a><a href="#purchasesOptantCents">02 · Compras</a><a href="#salaries">03 · Despesas</a><a href="#simulation-year">04 · Cenário</a></nav>`}`;
}
function sourceCard() {
  const d=S.source;
  return `<details class="card sim-source sim-report-details"><summary><span>Relatórios de origem</span><span class="sim-source-caption">Compras ${money(d.purchases.totalCents/100)} · Vendas ${money(d.sales.totalCents/100)} <span aria-hidden="true">⌄</span></span></summary><div class="sim-source-grid">${[['purchases','Compras'],['sales','Vendas']].map(([key,label])=>`<article><div class="eyebrow">${label.toUpperCase()} · TOTAL DO ARQUIVO</div><strong>${money(d[key].totalCents/100)}</strong><p>${esc(d[key].fileName)}</p><small>Concluído em ${date(d[key].completedAt)}<br>Fórmula: ${esc(d[key].formula)} · versão ${esc(d[key].calculationVersion)}</small><a href="/purchases.html?${new URLSearchParams({job:d[key].jobId,...(key==='sales'?{type:'SALES'}:{}),generation:d.generationId,client:d.clientId})}">Conferir linhas de ${label.toLowerCase()} →</a></article>`).join('')}</div>${classificationDetails()}</details>`;
}
async function readRbt12Pdf() {
  const file=$('#rbt12-pdf')?.files?.[0],status=$('#rbt12-status'),button=$('#rbt12-read');
  if(!file){if(status)status.textContent='Selecione o Extrato do Simples Nacional em PDF.';return;}
  if(file.size>8*1024*1024){if(status)status.textContent='O PDF deve ter no máximo 8 MiB.';return;}
  try{
    button.disabled=true;if(status)status.textContent='Lendo o Extrato do Simples Nacional e conferindo a RBT12…';
    const data=await api('/api/simples?'+new URLSearchParams({clientId:S.source.clientId,fileName:file.name}),{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
    $('#rbt12').value=(data.rbt12Cents/100).toFixed(2);S.rbt12ExtractionId=data.extractionId;
    const reconciliation=data.rbt12Reconciled===true?'12 competências anteriores ao PA conciliadas com a RBT12.':data.rbt12Reconciled===false?'A soma das competências divergiu; revise o extrato.':'RBT12 lida; a tabela mensal não pôde ser conciliada integralmente.';
    if(status)status.textContent=`RBT12 ${money(data.rbt12Cents/100)}${data.pa?' · PA '+data.pa:''} · ${reconciliation}${data.ocrUsed?' Leitura por OCR.':''}`;
    invalidate();saveDraft();
  }catch(error){if(status)status.textContent=error.message||'Não foi possível ler o PDF.';fail(error);}
  finally{button.disabled=false;}
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
  const notices=[...(S.source.warnings||[]).map(detail=>({title:'Conferência dos relatórios',detail})),{title:'Classificação de vendas e créditos',detail:'Os três grupos de vendas compõem a receita total. A classificação do comprador não cria uma alíquota diferente neste modelo. As compras alimentam as bases de crédito presumidas pela calculadora; confira o direito ao crédito nos documentos fiscais.'},...(S.result?.result.warnings||[])];
  const unique=[...new Map(notices.map(w=>[w.detail,w])).values()];
  const host=$('#simulation-notices'); if(!host)return;
  const open=host.querySelector('details')?.open;
  host.innerHTML=`<details class="sim-notices" ${open?'open':''}><summary><span>${unique.length} avisos e premissas</span><span class="sim-notices-toggle">Ver todos <span aria-hidden="true">⌄</span></span></summary><div class="sim-notices-content">${unique.map(w=>`<article><strong>${esc(w.title)}</strong><p>${esc(w.detail)}</p></article>`).join('')}</div></details>`;
}
function fillSnapshot(snapshot) {
  S.months=snapshot.reportMonths; $('#period-months').value=String(S.months); applyReports();
  for(const key of IMPORTED) $('#'+key).value=Number(snapshot.monthlyGroups[key]).toFixed(2);
  for(const key of MANUAL) $('#'+key).value=Number(snapshot.draft.values[key]).toFixed(2);
  $('#rbt12').value=Number(snapshot.draft.rbt12 ?? snapshot.engineInput?.rbt12 ?? 0).toFixed(2);
  S.rbt12ExtractionId=snapshot.rbt12Extraction?.id||null;
  $('#simulation-year').value=String(snapshot.draft.year);$('#sales-annex').value=String(snapshot.draft.salesAnnex);$('#service-annex').value=String(snapshot.draft.serviceAnnex);
  $('#period-confirm').checked=S.source.periodBasis==='COLUMN_H'; S.edited=snapshot.manuallyAdjusted;
  $('#draft-status').textContent=S.source.periodBasis==='COLUMN_H'?'Valores copiados da versão salva. O período continua vinculado à coluna H; gere uma nova versão quando terminar.':'Valores copiados da versão salva. Confirme o período e gere uma nova versão; o registro anterior permanece disponível.';
}
function setSaving(value) {
  S.saving=value;
  const fieldset=$('#simulation-fields'); if(fieldset)fieldset.disabled=value;
  const button=$('#generate-simulation'); if(button)button.textContent=value?'Salvando simulação…':'Gerar simulação';
}
async function simulate() {
  if(S.saving||!$('#simulator-form').reportValidity())return;
  try {
    $('#simulator-error').textContent='';
    const input=draft(),result=calculateSimulation(input),groups=Object.fromEntries(IMPORTED.map(key=>[key,value(key)]));
    S.result={input,result,monthlyGroups:groups};S.snapshot=null;S.saveError=null;S.viewPeriod='annual';saveDraft();
    S.pending=canSave()?{simulationId:crypto.randomUUID(),generationId:S.source.generationId,clientId:S.source.clientId,reportMonths:S.months,periodConfirmed:true,monthlyGroups:groups,draft:input,...(S.rbt12ExtractionId?{rbt12ExtractionId:S.rbt12ExtractionId}:{}),...(S.parentId?{parentSimulationId:S.parentId}:{})}:null;
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
    S.snapshot=snapshot;S.source=snapshot.source;S.edited=snapshot.manuallyAdjusted;S.result={input:snapshot.draft,result:snapshot.result,monthlyGroups:snapshot.monthlyGroups};S.pending=null;
    $('#simulator-intro').innerHTML=hero(false);
    const sourceDetails=$('.sim-report-details'),sourceOpen=sourceDetails.open;sourceDetails.outerHTML=sourceCard();$('.sim-report-details').open=sourceOpen;
    renderResult();renderNotices();
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
function renderResult() {
  if(!S.result)return;
  const {input,result,monthlyGroups}=S.result,monthly=S.viewPeriod==='monthly',divisor=monthly?12:1,periodLabel=monthly?'MENSAL':'ANUAL';
  const best=result.regimes.find(r=>r.id===result.bestRegimeId);
  $('#simulation-result').innerHTML=`<section class="sim-result" id="results-top"><div class="sim-result-head"><div><div class="eyebrow">PAINEL DA SIMULAÇÃO · ${input.year}</div><h2>O mesmo negócio. Quatro cenários.</h2><p class="sim-help">${esc(S.source.company.name)} · valores ${monthly?'mensais':'anuais'} projetados a partir dos dados informados.</p></div><div class="sim-result-actions"><div class="sim-period-toggle" role="group" aria-label="Período dos resultados"><button type="button" data-period="monthly" aria-pressed="${monthly}">Mensal</button><button type="button" data-period="annual" aria-pressed="${!monthly}">Anual</button></div><button id="export-simulation" type="button">Exportar memória da simulação</button></div></div>
    <div id="simulation-save-status" class="sim-save-status" role="status" aria-live="polite"></div>
    <div class="sim-kpis"><article><span>Faturamento ${monthly?'mensal':'anual'}</span><strong>${money(result.annualRevenue/divisor)}</strong><small>${monthly?'Média mensal usada na projeção':'Receita mensal × 12'}</small></article><article><span>Maior resultado estimado</span><strong class="${best?.annualProfit<0?'sim-negative':''}">${best?money(best.annualProfit/divisor):'Sem ranking'}</strong><small>${best?esc(best.name):'A receita é zero neste cenário'}</small></article><article><span>Diferença entre os cenários</span><strong>${best?money(result.difference/divisor):'—'}</strong><small>Maior menos menor resultado disponível</small></article></div>
    ${renderSimulationCharts({input,result,monthlyGroups,period:S.viewPeriod})}
    <div class="sim-subheading"><h3>Comparação por regime</h3><span>${monthly?'Por mês':'Por ano'} · ${input.year}</span></div><div class="sim-regimes">${result.regimes.map(r=>`<article class="sim-regime ${r.id===result.bestRegimeId?'best':''}"><span class="sim-badge">${r.id===result.bestRegimeId?'MAIOR RESULTADO ESTIMADO':r.available?'CENÁRIO COMPARATIVO':'REVISÃO NECESSÁRIA'}</span><h3>${esc(r.name)}</h3><strong class="${r.annualProfit<0&&r.available?'sim-negative':''}">${r.available?money(r.annualProfit/divisor):'Indisponível'}</strong><p>Resultado líquido ${monthly?'por mês':'por ano'}</p>${r.available?`<dl class="sim-regime-metrics"><div><dt>Tributos e encargos</dt><dd>${money(r.totalTaxes/divisor)}</dd></div><div><dt>Margem líquida</dt><dd>${pct(r.margin)}</dd></div><div><dt>Carga sobre receita</dt><dd>${pct(r.taxBurden)}</dd></div></dl>`:`<p>${esc(r.status)}</p>`}</article>`).join('')}</div>
    ${memoryDetails()}
    <section class="card sim-dre"><div class="eyebrow">DRE · PROJEÇÃO ${periodLabel}</div><h2>Do faturamento ao resultado.</h2><p class="sim-help">Para ver a DRE completa, arraste para o lado ou deite o celular. A coluna Indicador permanece fixa.</p><div class="sim-table-wrap" tabindex="0" role="region" aria-label="DRE comparativa com rolagem horizontal"><table><thead><tr><th scope="col">Indicador</th>${result.regimes.map(r=>`<th scope="col">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${DRE.map(([key,label])=>`<tr class="${['revenue','netRevenue','grossProfit','preTax','netProfit'].includes(key)?'total':''}"><th scope="row">${label}</th>${result.regimes.map(r=>`<td>${r.available?money(r.dre[key]/divisor):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section></section>`;
  $('#export-simulation').onclick=exportSimulation;
  document.querySelectorAll('[data-period]').forEach(button=>button.onclick=()=>{S.viewPeriod=button.dataset.period;renderResult();});
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
  const engine=snapshot?.engineInput;
  return `<details class="card sim-memory"><summary>Memória de cálculo completa · ${result.memory.length} itens</summary><p class="sim-help">Modelo ${esc(snapshot?.modelVersion||result.version)} · memória original anual. A troca entre Mensal e Anual altera a apresentação do painel e da DRE; as fórmulas abaixo conservam suas unidades originais.</p><div class="sim-links">${sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join('')}</div>${engine?`<div class="sim-engine-premises"><h3>Parâmetros capturados nesta versão</h3><p class="sim-help">Anexo de vendas ${esc(engine.salesAnnex)} · serviços ${esc(engine.serviceAnnex)} · referência de receita 12 meses ${money(engine.rbt12)}</p><div class="sim-detail-grid">${Object.entries(engine.rates||{}).map(([key,val])=>`<article><span>${esc({cbs:'CBS',ibs:'IBS',icms:'ICMS',iss:'ISS',payroll:'Encargos sobre folha',irSales:'Presunção de IRPJ · vendas',csSales:'Presunção de CSLL · vendas',irServices:'Presunção de IRPJ · serviços',csServices:'Presunção de CSLL · serviços'}[key]||key)}</span><strong>${pct(val)}</strong></article>`).join('')}</div></div>`:''}
    ${sections.map(section=>`<section class="sim-memory-section"><h3>${esc(section)}</h3><div class="sim-memory-items">${result.memory.filter(row=>row.section===section).map(row=>`<article><div><strong>${esc(row.label)}</strong><p>${esc(row.formula)}</p></div><span>${formatMemory(row)}</span></article>`).join('')}</div></section>`).join('')}</details>`;
}
function capturedFields(snapshot) {
  const d=snapshot.draft,fields=[['RBT12 do Simples Nacional',d.rbt12 ?? snapshot.engineInput?.rbt12],['Receita de serviços',d.values.serviceRevenue],['Receita de vendas · total',d.values.salesRevenue],['Faturamento vendas Optantes SN',snapshot.monthlyGroups.salesOptantCents],['Faturamento vendas Não Optantes SN',snapshot.monthlyGroups.salesNonOptantCents],['Faturamento Vendas de CPFs',snapshot.monthlyGroups.salesCpfCents],['Compras de empresas do Simples Nacional',d.values.simplePurchases],['Compras de empresas fora do Simples',d.values.regularPurchases],['Salários e pró-labore',d.values.salaries],['Benefícios da equipe',d.values.benefits],['Outras despesas da empresa',d.values.adminExpenses],['Aluguel',d.values.rent],['Taxas de cartão',d.values.cardExpenses]];
  return `<section class="card sim-snapshot" id="simulation-snapshot"><div class="sim-result-head"><div><div class="eyebrow">VERSÃO SALVA · SOMENTE LEITURA</div><h2>${esc(snapshot.title||'Simulação de '+S.source.company.name)}</h2><p class="sim-help">${date(snapshot.createdAt)} · ${esc(snapshot.createdBy?.name||'Usuário')} · modelo ${esc(snapshot.modelVersion)}</p></div>${canSave()?'<button type="button" class="primary" id="create-version">Criar nova versão</button>':''}</div><div class="sim-snapshot-meta"><span>${d.year} · Vendas: Anexo ${d.salesAnnex===1?'I':'II'}</span><span>Serviços: Anexo ${{3:'III',4:'IV',5:'V'}[d.serviceAnnex]}</span><span>${snapshot.reportMonths} ${snapshot.reportMonths===1?'mês':'meses'} nos arquivos · ${snapshot.periodBasis==='COLUMN_H'?'coluna H':'período confirmado'}</span><span>RBT12: ${snapshot.rbt12Source==='SIMPLES_PDF'?'Extrato do Simples Nacional':snapshot.rbt12Source==='MANUAL'?'informada manualmente':'estimativa histórica'}</span><span>${snapshot.manuallyAdjusted?'Valores importados ajustados':'Valores dos relatórios preservados'}</span></div>${snapshot.parentSimulationId?`<a class="sim-back" href="/simulator.html?simulation=${encodeURIComponent(snapshot.parentSimulationId)}">Abrir versão de origem →</a>`:''}<h3>Dados usados no cálculo <small>Valores mensais</small></h3><div class="sim-detail-grid">${fields.map(([label,val])=>`<article><span>${label}</span><strong>${money(val)}</strong></article>`).join('')}</div>${snapshot.adjustments?.length?`<details class="sim-adjustments"><summary>${snapshot.adjustments.length} ajustes em relação aos relatórios</summary><div class="sim-memory-items">${snapshot.adjustments.map(a=>`<article><div><strong>${esc(fieldLabel(a.field))}</strong><p>Valor mensal dos relatórios: ${money(a.reportMonthlyValue)}</p></div><span>Simulado: ${money(a.simulatedMonthlyValue)}</span></article>`).join('')}</div></details>`:''}<p class="sim-help sim-record-id">Registro ${esc(snapshot._id)} · Base de cálculo ${esc(snapshot.calculatorSourceCommit)}</p></section>`;
}
function fieldLabel(key) { return {salesOptantCents:'Vendas Optantes SN',salesNonOptantCents:'Vendas Não Optantes SN',salesCpfCents:'Vendas de CPFs',purchasesOptantCents:'Compras do Simples',purchasesNonOptantCents:'Compras fora do Simples'}[key]||key; }
function showSnapshot(snapshot) {
  S.snapshot=snapshot;S.source=snapshot.source;S.months=snapshot.reportMonths;S.edited=snapshot.manuallyAdjusted;S.readonly=true;S.pending=null;S.result={input:snapshot.draft,result:snapshot.result,monthlyGroups:snapshot.monthlyGroups};
  $('#simulator-app').innerHTML=`<div id="simulator-intro">${hero(true)}</div>${capturedFields(snapshot)}${sourceCard()}<div id="simulation-notices"></div><div id="simulation-result"></div>`;
  renderNotices();renderResult();
  const button=$('#create-version');if(button)button.onclick=()=>{
    S.parentId=snapshot._id;S.key=`maximum-simulator:copy:${S.user._id}:${snapshot._id}`;
    history.replaceState(null,'',sourceUrl());display(snapshot);
    $('#simulator-app').scrollIntoView({block:'start',behavior:'instant'});
  };
}
function exportSimulation() {
  if(!S.result)return;
  const payload=S.snapshot||{saved:false,generatedAt:new Date().toISOString(),calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,source:S.source,reportMonths:S.months,manuallyAdjusted:S.edited,monthlyGroups:S.result.monthlyGroups,monthlyGroupsUnit:'BRL',draft:S.result.input,result:S.result.result};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`simulacao-${String(S.source.company.code||'empresa').replace(/[^\w-]/g,'_')}-${S.result.input.year}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
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
      S.source=snapshot.source;S.parentId=parent;S.key=`maximum-simulator:copy:${S.user._id}:${parent}`;display(snapshot);return;
    }
    S.source=await api(`/api/v4/generations/${generation}/simulator?${new URLSearchParams({clientId:client})}`);
    S.key=`maximum-simulator:v1:${S.user._id}:${generation}:${client}:${S.source.purchases.jobId}:${S.source.sales.jobId}`;
    display();
  } catch(error) {fail(error);$('#simulator-app').innerHTML='<section class="card sim-empty"><h2>Não foi possível abrir o simulador.</h2><p>Confira o acesso e os relatórios da empresa ou tente abrir a versão salva novamente.</p><div class="sim-links"><a class="sim-back" href="/simulations.html">Simulações salvas →</a><a class="sim-back" href="/generations.html?view=history">Conferir relatórios →</a></div></section>';}
}
boot();
