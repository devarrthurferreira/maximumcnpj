import {mountNavigation} from './navigation.js';
import {createEmptyDraft, calculateSimulation, CALCULATOR_SOURCE_COMMIT, TAX_SOURCES} from './simulator-engine.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const pct = value => value == null ? '—' : (value * 100).toLocaleString('pt-BR',{maximumFractionDigits:2}) + '%';
const date = value => value ? new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—';
const IMPORTED = ['salesOptantCents','salesNonOptantCents','salesCpfCents','purchasesOptantCents','purchasesNonOptantCents'];
const MANUAL = ['serviceRevenue','salaries','benefits','adminExpenses','rent','cardExpenses'];
const S = {source:null,user:null,key:'',result:null,months:1,edited:false};
const fail = error => { $('#simulator-error').textContent = error.message || String(error); };
async function api(path) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),55000);
  try {
    const response = await fetch(path,{credentials:'same-origin',signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível conferir os relatórios.');
    return data;
  } catch(error) { if(error.name === 'AbortError') throw new Error('A conferência demorou a responder. Atualize a página para tentar novamente.'); throw error; }
  finally { clearTimeout(timer); }
}
function moneyField(id, label, help, imported=false, readonly=false) {
  return `<div class="sim-field"><label for="${id}">${label}${readonly?'':' *'}${imported?'<span class="sim-tag">PREENCHIDO PELO RELATÓRIO · EDITÁVEL</span>':''}</label><input id="${id}" name="${id}" type="number" min="0" max="1000000000000" step="0.01" inputmode="decimal" ${readonly?'readonly':'required'} placeholder="0,00" aria-describedby="${id}-help"><small id="${id}-help">${help}</small></div>`;
}
function section(number,title,subtitle,content) {
  return `<section class="card sim-section"><div class="sim-section-header"><span class="sim-number">${number}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div>${content}</section>`;
}
function display() {
  const d = S.source, back = '/generations.html?id='+encodeURIComponent(d.generationId);
  $('#simulator-app').innerHTML = `<a class="sim-back" href="${back}">← Conferir os relatórios da geração</a>
    <div class="sim-hero"><div><div class="eyebrow">SIMULADOR · ${esc(d.company.code||'EMPRESA')}</div><h1>Uma visão clara.<br>Melhores decisões.</h1><p>Compras e vendas já separadas. Complete os dados mensais de <strong>${esc(d.company.name)}</strong> para comparar os cenários.</p></div></div>
    <div class="sim-step-track" aria-label="Etapas"><span>✓ Empresa</span><span>✓ Compras e vendas</span><span>✓ Consultas concluídas</span><span class="active">04 · Simulador</span></div>
    <section class="card sim-source"><h2>Seus relatórios são o ponto de partida.</h2><p class="sim-help">Valores líquidos de todas as linhas: Q − Y + AA − AB. O CPF tem seu próprio grupo nas vendas; não confirmados entram em Não optantes.</p><div class="sim-source-grid">${[['purchases','Compras'],['sales','Vendas']].map(([key,label])=>`<article><div class="eyebrow">${label.toUpperCase()} · TOTAL DO ARQUIVO</div><strong>${money(d[key].totalCents/100)}</strong><p>${esc(d[key].fileName)}</p><small>Concluído em ${date(d[key].completedAt)}</small></article>`).join('')}</div>
    ${d.warnings?.length?`<details><summary>Conferência da classificação e dos valores</summary><ul class="sim-help">${d.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}
    <div class="sim-links"><a href="/purchases.html?${new URLSearchParams({job:d.purchases.jobId,generation:d.generationId,client:d.clientId})}">Ver linhas de compras →</a><a href="/purchases.html?${new URLSearchParams({job:d.sales.jobId,type:'SALES',generation:d.generationId,client:d.clientId})}">Ver linhas de vendas →</a></div></section>
    <form id="simulator-form"><section class="card sim-source"><h2>Qual período os dois arquivos representam?</h2><p class="sim-help">Use relatórios da mesma empresa e do mesmo período. A quantidade de meses transforma os totais importados em média mensal.</p><div class="sim-period"><label for="period-months">Meses nos relatórios<select id="period-months">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} ${i?'meses · média mensal':'mês · valores integrais'}</option>`).join('')}</select></label><label class="sim-confirm"><input id="period-confirm" type="checkbox" required>Confirmo que compras e vendas correspondem ao mesmo período e à quantidade de meses selecionada.</label></div><p id="period-explanation" class="sim-help"></p></section>
    ${section('01','Quanto a empresa fatura?','Por mês',`<div class="sim-fields">${moneyField('serviceRevenue','Receita de serviços','Quanto sua empresa recebe por mês com serviços, antes de descontar despesas e impostos. Não repita os valores já incluídos nas vendas.')}${moneyField('salesRevenue','Receita de vendas','Soma automática dos três grupos de vendas abaixo.',false,true)}</div><div class="sim-fields sales">${moneyField('salesOptantCents','Faturamento vendas Optantes SN','Vendas a CNPJs com opção pelo Simples confirmada na pesquisa.',true)}${moneyField('salesNonOptantCents','Faturamento vendas Não Optantes SN','Não optantes, não confirmados e outros documentos, exceto CPFs.',true)}${moneyField('salesCpfCents','Faturamento Vendas de CPFs','Vendas identificadas com CPF, sem consulta fiscal de CNPJ.',true)}</div><div class="sim-totals"><article><span>Total por mês</span><strong id="monthly-revenue">Preencha as receitas</strong></article><article><span>Receita estimada em 12 meses</span><strong id="annual-revenue">Calculada automaticamente</strong></article></div><p class="sim-help">Estimativa automática: receita mensal × 12. Não é uma consulta ao faturamento real dos últimos 12 meses.</p>`)}
    ${section('02','Quanto a empresa compra?','Por mês',`<p class="sim-help">Separe as compras pela categoria do fornecedor. A nota fiscal pode ajudar a identificar se ele está no Simples Nacional.</p><div class="sim-fields">${moneyField('purchasesOptantCents','Compras de empresas do Simples Nacional','Valor mensal das mercadorias compradas de fornecedores que estão no Simples.',true)}${moneyField('purchasesNonOptantCents','Compras de empresas fora do Simples','Valor mensal das mercadorias dos demais fornecedores, incluindo não confirmados e documentos não consultáveis.',true)}</div>`)}
    ${section('03','Quais são as despesas?','Por mês',`<div class="sim-fields">${moneyField('salaries','Salários e pró-labore','Total mensal pago à equipe e aos sócios pelo trabalho na empresa.')}${moneyField('benefits','Benefícios da equipe','Vale-transporte, alimentação e outros benefícios pagos no mês.')}${moneyField('adminExpenses','Outras despesas da empresa','Água, energia, internet e outras despesas. Não repita os valores dos outros campos.')}${moneyField('rent','Aluguel','Valor mensal do aluguel. Se não houver, digite 0.')}${moneyField('cardExpenses','Taxas de cartão','Total pago em taxas no mês, em reais. Se não houver, digite 0.')}</div>`)}
    ${section('04','Sobre a simulação','Escolha o cenário',`<div class="sim-fields"><div class="sim-field"><label for="simulation-year">Ano da simulação</label><select id="simulation-year"><option>2027</option><option>2028</option></select></div><div class="sim-field"><label for="sales-annex">Atividade das vendas</label><select id="sales-annex"><option value="1">Comércio · Anexo I</option><option value="2">Indústria · Anexo II</option></select></div><div class="sim-field"><label for="service-annex">Categoria dos serviços</label><select id="service-annex"><option value="3">Anexo III</option><option value="4">Anexo IV</option><option value="5">Anexo V</option></select><small>Se tiver dúvida sobre a categoria, confirme com sua contabilidade.</small></div></div>`)}
    <div class="sim-actions"><button class="primary" type="submit">Gerar simulação</button><button id="restore-reports" type="button">Restaurar valores dos relatórios</button><small id="draft-status" role="status">Serviços e despesas precisam ser informados. Use 0 quando não houver valor.</small></div></form><div id="simulation-result"></div>`;
  applyReports();
  $('#simulator-form').oninput = event => {
    if (IMPORTED.includes(event.target.id)) S.edited=true;
    updateRevenue(); invalidate(); saveDraft();
  };
  $('#period-months').onchange = () => {
    const months=Number($('#period-months').value);
    if(S.edited && !confirm('Recalcular os cinco campos importados com o novo período? Os ajustes manuais nesses campos serão substituídos.')) { $('#period-months').value=String(S.months); return; }
    S.months=months; $('#period-confirm').checked=false; applyReports(); invalidate(); saveDraft();
  };
  $('#restore-reports').onclick = () => { if(!S.edited || confirm('Restaurar os cinco campos importados? Serviços e despesas serão mantidos.')) { applyReports(); invalidate(); saveDraft(); } };
  $('#simulator-form').onsubmit = event => { event.preventDefault(); try { simulate(); } catch(error) { fail(error); } };
  restoreDraft(); updateRevenue();
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
  $('#period-explanation').textContent=`Cada grupo importado = total do grupo no arquivo ÷ ${S.months} ${S.months===1?'mês':'meses'}, arredondado para centavos. Serviços e despesas devem ser valores mensais.`;
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
function invalidate() { S.result=null; $('#simulation-result').innerHTML=''; $('#simulator-error').textContent=''; }
function draft() {
  const d=createEmptyDraft(); d.year=Number($('#simulation-year').value);d.salesAnnex=Number($('#sales-annex').value);d.serviceAnnex=Number($('#service-annex').value);
  MANUAL.forEach(key=>d.values[key]=value(key));
  d.values.salesRevenue=salesTotal();d.values.simplePurchases=value('purchasesOptantCents');d.values.regularPurchases=value('purchasesNonOptantCents');
  return d;
}
function saveDraft() {
  const data={months:S.months,edited:S.edited,confirmed:$('#period-confirm').checked,fields:Object.fromEntries([...IMPORTED,...MANUAL].map(key=>{const field=$('#'+key);return [key,field.value!==''&&field.validity.valid?Number(field.value).toFixed(2):field.value];})),year:$('#simulation-year').value,salesAnnex:$('#sales-annex').value,serviceAnnex:$('#service-annex').value};
  try { sessionStorage.setItem(S.key,JSON.stringify(data)); $('#draft-status').textContent='Rascunho salvo nesta aba, vinculado à empresa e aos dois relatórios. Alterar valores exige gerar a simulação novamente.'; }
  catch { $('#draft-status').textContent='Não foi possível guardar o rascunho nesta aba. Mantenha a página aberta até concluir.'; }
}
function restoreDraft() {
  try {
    const data=JSON.parse(sessionStorage.getItem(S.key)||'null'); if(!data || !Number.isInteger(data.months) || data.months<1 || data.months>12) return;
    S.months=data.months; $('#period-months').value=String(data.months);applyReports();
    for(const key of [...IMPORTED,...MANUAL]) { const v=data.fields?.[key]; if(typeof v==='string' && (v==='' || /^\d+(\.\d{1,2})?$/.test(v))) $('#'+key).value=v; }
    for(const [key,id,choices] of [['year','simulation-year',['2027','2028']],['salesAnnex','sales-annex',['1','2']],['serviceAnnex','service-annex',['3','4','5']]]) if(choices.includes(data[key])) $('#'+id).value=data[key];
    S.edited=data.edited===true;$('#period-confirm').checked=data.confirmed===true;$('#draft-status').textContent='Rascunho desta empresa restaurado. Confira os campos antes de gerar.';
  } catch { /* Invalid/unavailable local drafts never prevent using verified report totals. */ }
}
const DRE=[['services','Receita de serviços'],['sales','Receita de vendas'],['revenue','Receita bruta total'],['das','− DAS'],['cbsDebit','− Débito de CBS'],['ibsDebit','− Débito de IBS'],['icmsNet','− ICMS líquido fora do DAS'],['iss','− ISS fora do DAS'],['netRevenue','Receita líquida'],['cmvSimple','− Compras do Simples'],['cmvRegular','− Compras fora do Simples'],['cmv','CMV total'],['cbsUsed','+ Crédito CBS utilizado'],['ibsUsed','+ Crédito IBS utilizado'],['grossProfit','Lucro bruto'],['salaries','− Salários e pró-labore'],['benefits','− Benefícios'],['payroll','− Encargos adicionais'],['personnel','Pessoal e encargos'],['administrative','− Outras despesas'],['rent','− Aluguel'],['cards','− Taxas de cartão'],['preTax','Resultado antes de IRPJ/CSLL'],['irpj','− IRPJ e adicional'],['csll','− CSLL'],['netProfit','Resultado líquido']];
function simulate() {
  if(!$('#simulator-form').reportValidity())return;
  const input=draft(), result=calculateSimulation(input);S.result={input,result};saveDraft();
  const best=result.regimes.find(r=>r.id===result.bestRegimeId);
  $('#simulation-result').innerHTML=`<section class="sim-result" id="results-top"><div class="sim-result-head"><div><div class="eyebrow">VISÃO GERAL · ${input.year}</div><h2>O mesmo negócio. Quatro cenários.</h2><p class="sim-help">${esc(S.source.company.name)} · projeção anual com base nos valores mensais preenchidos.</p></div><button id="export-simulation">Exportar memória da simulação</button></div><div class="sim-regimes">${result.regimes.map(r=>`<article class="sim-regime ${r.id===result.bestRegimeId?'best':''}"><span class="sim-badge">${r.id===result.bestRegimeId?'MAIOR RESULTADO ESTIMADO':r.available?'CENÁRIO COMPARATIVO':'REVISÃO NECESSÁRIA'}</span><h3>${esc(r.name)}</h3><strong>${r.available?money(r.annualProfit):'Indisponível'}</strong><p>Resultado líquido por ano${r.available?`<br>${money(r.monthlyProfit)} por mês`:''}</p><p>${r.available?`Margem ${pct(r.margin)} · carga ${pct(r.taxBurden)}`:esc(r.status)}</p></article>`).join('')}</div>${best?`<p class="sim-help">Maior resultado estimado neste cenário: <strong>${esc(best.name)}</strong>. A comparação considera as premissas da calculadora e os dados informados.</p>`:''}
    <div class="sim-note">Os três grupos de vendas compõem a receita total. A classificação do comprador não cria uma alíquota diferente neste modelo. As compras alimentam as bases de crédito presumidas pela calculadora; confirme o direito ao crédito nos documentos fiscais.</div>
    ${result.warnings.map(w=>`<details class="sim-note"><summary>${esc(w.title)}</summary><p>${esc(w.detail)}</p></details>`).join('')}
    <details class="card sim-memory"><summary>Premissas, origem dos valores e memória de cálculo</summary><p class="sim-help">Modelo da calculadora Maximum ${esc(result.version)}. Importação preservada; ajustes aqui não alteram os relatórios. ${S.months} mês(es) nos arquivos.</p><div class="sim-links">${TAX_SOURCES.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join('')}</div><pre>${esc(JSON.stringify({input,reportFields:S.source.fields,memory:result.memory},null,2))}</pre></details>
    <section class="card sim-dre"><div class="eyebrow">DRE · PROJEÇÃO ANUAL</div><h2>Do faturamento ao resultado.</h2><p class="sim-help">Para ver a DRE completa, arraste para o lado ou deite o celular. A coluna Indicador permanece fixa.</p><div class="sim-table-wrap" tabindex="0" role="region" aria-label="DRE comparativa com rolagem horizontal"><table><thead><tr><th scope="col">Indicador</th>${result.regimes.map(r=>`<th scope="col">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${DRE.map(([key,label])=>`<tr class="${['revenue','netRevenue','grossProfit','preTax','netProfit'].includes(key)?'total':''}"><th scope="row">${label}</th>${result.regimes.map(r=>`<td>${r.available?money(r.dre[key]):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section></section>`;
  $('#export-simulation').onclick=exportSimulation;
  $('#results-top').scrollIntoView({behavior:'smooth',block:'start'});
}
function exportSimulation() {
  if(!S.result)return;
  const payload={generatedAt:new Date().toISOString(),calculatorSourceCommit:CALCULATOR_SOURCE_COMMIT,source:S.source,reportMonths:S.months,manuallyAdjusted:S.edited,monthlyGroups:Object.fromEntries(IMPORTED.map(key=>[key,value(key)])),monthlyGroupsUnit:'BRL',...S.result};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`simulacao-${String(S.source.company.code||'empresa').replace(/[^\w-]/g,'_')}-${S.result.input.year}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function boot() {
  try {
    S.user=(await api('/api/auth/session')).user;mountNavigation(S.user,'start');
    if(!S.user||S.user.mustChangePassword){$('#simulator-app').innerHTML=`<section class="card sim-empty"><h2>${S.user?.mustChangePassword?'Redefina sua senha para continuar':'Entre para continuar'}</h2><p>Use sua conta Maximum para acessar os relatórios e o simulador.</p><a class="sim-back" href="/">Acessar painel →</a></section>`;return;}
    const params=new URLSearchParams(location.search), generation=params.get('generation'),client=params.get('client'),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if(!generation||!client){$('#simulator-app').innerHTML='<section class="card sim-empty"><h1>Comece pelos relatórios.</h1><p>Selecione a empresa e importe compras e vendas. Quando as consultas terminarem, use “Ir para o simulador” na geração.</p><a class="sim-back" href="/generations.html">Iniciar geração →</a></section>';return;}
    if(!uuid.test(generation)||!uuid.test(client))throw new Error('Identificação da geração ou empresa inválida.');
    S.source=await api(`/api/v4/generations/${generation}/simulator?${new URLSearchParams({clientId:client})}`);
    S.key=`maximum-simulator:v1:${S.user._id}:${generation}:${client}:${S.source.purchases.jobId}:${S.source.sales.jobId}`;
    display();
  } catch(error) {fail(error);$('#simulator-app').innerHTML='<section class="card sim-empty"><h2>Confira os relatórios antes de simular.</h2><p>O simulador precisa de compras e vendas concluídas e conferidas da mesma empresa.</p><a class="sim-back" href="/generations.html?view=history">Abrir histórico →</a></section>';}
}
boot();
