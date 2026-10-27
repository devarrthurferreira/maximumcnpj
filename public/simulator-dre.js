import {dreRows, MONTH_NAMES} from './simulator-calendar.js';
import {buildRevenueReconciliation} from './revenue-reconciliation.js';
import {resolveRegimeSelection,requiresSimplesReference,regimeMemoryApplies,regimeWarningApplies} from './regime-selection.js';

/** Read-only presentation: no tax engine, source hydration or snapshot mutation. */
export const DRE_PRESENTATION_VERSION = 'DRE_PRESENTATION_V1';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const close = (a,b) => finite(a) && finite(b) && Math.abs(a-b) <= Math.max(1e-7,8*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b)));
const sum = values => values.every(finite) ? values.reduce((total,value)=>total+value,0) : null;
const good = value => ({value,reason:''});
const missing = (reason='Detalhamento não disponível nesta versão.') => ({value:null,reason});
const currency = value => finite(value) ? good(value) : missing('Valor não disponível nesta versão.');
const unique = (rows,key,value) => {const matches=Array.isArray(rows)?rows.filter(row=>row?.[key]===value):[];return matches.length===1?matches[0]:null;};
const SUBTOTALS = new Set(['revenue','netRevenue','cmv','grossProfit','personnel','preTax','netProfit']);
const GROUPS = ['salesOptantCents','salesNonOptantCents','salesCpfCents'];
const capturedDifalVersion = value => ['DIFAL_SCENARIOS_V1','DIFAL_SCENARIOS_V2'].includes(value?.version);

/** Explain captured decisions only; older snapshots never acquire today's policy. */
export function dreDifalNotes(presentation,{sourceMonth=null}={}) {
  if(presentation?.regimeSelection!==undefined&&!requiresSimplesReference(presentation.regimeSelection))return [];
  return (presentation?.regimes||[]).flatMap(regime=>{
    const application=regime.difalApplication;
    if(!capturedDifalVersion(application)||typeof application.enabled!=='boolean')return [];
    const current=application.version==='DIFAL_SCENARIOS_V2',simple=['pure','hybrid'].includes(regime.id);
    const directions=current&&simple&&application.operations?` Seleção de entrada: ${application.operations.entry?'incluir':'excluir'}; seleção de saída: ${application.operations.exit?'incluir':'excluir'}.`:'';
    const choice=`${regime.name} · DIFAL: ${current&&!simple?'não se aplica':application.enabled?'incluir':'excluir'}.${directions}`;
    if(!Array.isArray(application.months))return [choice+' '+(application.message||'')];
    const months=application.months.filter(item=>!sourceMonth||item.sourceMonth===sourceMonth);
    if(!months.length)return [choice+' Sem decisão registrada para esta competência.'];
    const groups=new Map();
    for(const item of months){
      if(!groups.has(item.message))groups.set(item.message,[]);
      groups.get(item.message).push(item.sourceMonth);
    }
    return [choice+' '+[...groups].map(([message,periods])=>`${periods.join(', ')}: ${message}`).join(' ')];
  });
}

/** Describes captured coverage, without completing missing months or changing a saved result. */
export function dreReportCoverage(presentation) {
  if(presentation?.method!=='REPORT_MONTHS_V1')return {actual:false,sourceMonths:[],count:null,completeYear:false,
    label:'Projeção anual salva',detail:'Os valores mensais representam a projeção capturada nesta versão; não são movimentos históricos de cada mês.'};
  const candidates=presentation.report?.sourceMonths||presentation.months?.map(month=>month.sourceMonth)||[];
  const sourceMonths=[...new Set(candidates.filter(value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)))].sort();
  const period=presentation.analysisPeriod;
  if(period?.version==='JAN_SEP_V1'){
    const expected=Array.isArray(period.expectedMonths)?period.expectedMonths:[];
    const included=sourceMonths.filter(month=>expected.includes(month)),count=included.length;
    const complete=count===9&&expected.length===9&&period.complete===true;
    return {actual:true,sourceMonths:included,count,completeYear:false,completePeriod:complete,
      label:complete?'Janeiro a setembro · 9 de 9 competências':`Janeiro a setembro · ${count} de 9 competências`,
      detail:`Período fixo: ${period.startMonth} a ${period.endMonth}. ${complete?'O consolidado soma os nove meses confirmados.':'Cobertura pendente: não há um consolidado completo de janeiro a setembro.'} Outubro a dezembro ficam fora da análise. A RBT12 do Simples mantém sua referência própria de 12 meses.`};
  }
  const count=sourceMonths.length,years=new Set(sourceMonths.map(value=>value.slice(0,4))),completeYear=count===12&&years.size===1;
  const label=completeYear?'Ano de origem completo · 12 de 12 competências':count===12?'12 competências em mais de um ano de origem':`Período parcial · ${count} de 12 competências`;
  return {actual:true,sourceMonths,count,completeYear,label,
    detail:count?`Base dos relatórios: ${sourceMonths[0]} a ${sourceMonths.at(-1)}. O total consolida somente as competências importadas, sem médias nem projeção dos meses ausentes. ${completeYear?'As 12 competências da origem estão presentes.':'Este total não representa um exercício de origem completo.'}`:'A cobertura das competências não está disponível nesta versão. Não é possível afirmar que o total corresponde a um exercício completo.'};
}

/** Keep the exact captured cause visible beside availability, including partial annual blocks. */
export function dreRegimeStatuses(presentation,{sourceMonth=null}={}) {
  return (presentation?.regimes||[]).map(regime=>{
    const groups=new Map();
    for(const [index,month] of (presentation.months||[]).entries()){
      if(!month.sourceMonth||(sourceMonth&&sourceMonth!==month.sourceMonth))continue;
      const status=regime.monthlyStatuses?.[index];
      if(!status)continue;
      const available=regime.monthlyAvailability?.[index]===true,key=`${available}:${status}`;
      if(!groups.has(key))groups.set(key,{available,status,months:[]});
      groups.get(key).months.push(month.sourceMonth);
    }
    return {id:regime.id,name:regime.name,available:regime.available===true,
      status:regime.status||(regime.available?'Calculado':'Motivo não registrado nesta versão.'),months:[...groups.values()]};
  });
}

/** Historical unsupported Simples calculations are never promoted to confirmed payable amounts. */
export function dreReportMemory(presentation,{includeDre=false}={}) {
  const simplesPending=(presentation?.regimes||[]).some(regime=>['pure','hybrid'].includes(regime.id)&&regime.available!==true);
  const unavailable=new Map((presentation?.regimes||[]).filter(regime=>regime.available!==true).map(regime=>[regime.id,regime]));
  return (presentation?.report?.memory||[]).filter(item=>(presentation.regimeSelection===undefined||regimeMemoryApplies(item.id,presentation.regimeSelection))&&(includeDre||!/^dre\.|^summary\./.test(item.id))).map(item=>{
    const key=/^dre\.[^.]+\.(revenue|netRevenue)$/.exec(item.id)?.[1];
    const label=key==='revenue'?'Receita total utilizada':key==='netRevenue'?'Receita após deduções tributárias':item.label;
    const pending=unavailable.get(/^(?:dre|summary)\.([^.]+)\./.exec(item.id)?.[1]);
    if(pending&&typeof item.value==='number')return {...item,label,unit:'text',value:`Não disponível: ${pending.status||'o cálculo deste regime exige conferência neste período.'}`};
    if(simplesPending&&item.unit==='currency'&&/^simples\./.test(item.id)&&!/(?:\.deduction$|^simples\.revenueReference$)/.test(item.id))
      return {...item,label,unit:'text',value:'Não disponível: o cálculo do Simples exige conferência neste período.'};
    return label!==item.label?{...item,label}:item;
  });
}

/** One continuous display/export order, retaining the original row objects and values. */
export function unifiedDreRows(presentation) {
  const base=(presentation?.sections||[]).flatMap(section=>section.rows||[]);
  const details=(presentation?.details||[]).flatMap(group=>(group.rows||[]).map(row=>({row,parentKey:row.parentKey||group.parentKey})));
  const children=new Map(),rows=[],seen=new Set();
  for(const {row,parentKey} of details){
    if(!children.has(parentKey))children.set(parentKey,[]);
    children.get(parentKey).push(row);
  }
  const append=row=>{
    if(!row||typeof row.key!=='string'||seen.has(row.key))return;
    seen.add(row.key);rows.push(row);
    for(const child of children.get(row.key)||[])append(child);
  };
  for(const row of base)append(row);
  // Retain any extension whose parent is absent instead of hiding an available detail.
  for(const {row} of details)append(row);
  for(const row of presentation?.indicators||[])append(row);
  for(const row of presentation?.revenueReconciliation?.rows||[])append(row);
  for(const row of presentation?.icmsReconciliation?.rows||[])append(row);
  return rows;
}

export function buildDrePresentation({result,monthlyGroups,projection,source,reportMonths,engineInput,reprocessing,calendar,taxSources}={}) {
  const capturedSelection=result?.regimeSelection!==undefined?result.regimeSelection:engineInput?.regimeSelection!==undefined?engineInput.regimeSelection:calendar?.regimeSelection;
  const regimeSelection=capturedSelection===undefined?undefined:resolveRegimeSelection(capturedSelection),hasSimples=requiresSimplesReference(regimeSelection);
  const originals = (Array.isArray(result?.regimes) ? result.regimes : []).filter(regime=>!regimeSelection||regimeSelection.selected.includes(regime.id));
  const actual=result?.method==='REPORT_MONTHS_V1';
  const analysisPeriod=actual&&result.analysisPeriod?.version==='JAN_SEP_V1'?structuredClone(result.analysisPeriod):null;
  const hasCalendar = calendar != null;
  const validCalendar = Array.isArray(calendar?.months) && (analysisPeriod?
    calendar.version==='DRE_CALENDAR_V4'&&calendar.analysisPeriod?.version==='JAN_SEP_V1'&&calendar.months.length===9:
    ['DRE_CALENDAR_V1','DRE_CALENDAR_V2','DRE_CALENDAR_V3'].includes(calendar?.version)&&calendar.months.length===12);
  const calendarYear = calendar?.year ?? engineInput?.year ?? null;
  const months = validCalendar ? calendar.months.map(month=>({...month})) : MONTH_NAMES.slice(0,analysisPeriod?9:12).map((label,index)=>({number:index+1,label,period:calendarYear?`${calendarYear}-${String(index+1).padStart(2,'0')}`:null}));
  const memory = (id,frame=null) => {
    const entry=unique(frame?.monthResult?.memory||result?.memory,'id',id);
    return entry?.unit==='currency' && finite(entry.value) && entry.value>=0 ? entry.value : null;
  };
  function frame(regime,kind,index=null) {
    const saved=validCalendar?unique(calendar.regimes,'id',regime.id):null;
    const monthlyEntry=actual&&kind==='month'?result.monthlyResults?.find(row=>row.month===index+1):null;
    const monthlyRegime=monthlyEntry?.result?.regimes?.find(row=>row.id===regime.id);
    const effective=monthlyRegime||regime;
    const available=actual&&kind==='month'?
      !!monthlyRegime&&monthlyRegime.available===true&&(!hasCalendar||(validCalendar&&['DRE_CALENDAR_V3','DRE_CALENDAR_V4'].includes(calendar.version)&&!!saved&&calendar.months[index]?.sourceMonth===monthlyEntry.sourceMonth)):
      regime.available===true&&(kind==='annual'||!hasCalendar||saved?.available===true);
    return {regime:effective,kind,index,available,monthlyEntry,monthResult:monthlyEntry?.result,scale:kind==='month'&&!actual?1/12:1,
      get(key) {
        if(!available)return null;
        if(actual&&kind==='month'&&!hasCalendar){const value=effective.dre?.[key];return finite(value)?value:null;}
        if(kind==='annual'||!hasCalendar){const value=regime.dre?.[key];return finite(value)?value*(kind==='month'?1/12:1):null;}
        const row=unique(saved.rows,'key',key),value=kind==='month'?row?.months?.[index]:row?.annual;
        return finite(value)?value:null;
      }
    };
  }
  const regimes = originals.map(r=>({id:r.id,name:r.name,available:r.available===true,status:typeof r.status==='string'?r.status:r.available===true?'Calculado':'Motivo não registrado nesta versão.',
    ...(capturedDifalVersion(r.difalApplication)?{difalApplication:structuredClone(r.difalApplication)}:{}),
    ...(actual?{monthlyAvailability:months.map((_,index)=>frame(r,'month',index).available),monthlyStatuses:months.map((_,index)=>{
      const f=frame(r,'month',index);
      return !f.monthlyEntry?'Sem dados importados para esta competência.':typeof f.regime.status==='string'?f.regime.status:f.available?'Calculado':'Motivo não registrado nesta versão.';
    })}:{})}));
  function checkedFrame(f,compute) {
    if(!f.available)return missing(actual&&f.kind==='month'&&!f.monthlyEntry?'Sem dados importados para esta competência.':f.regime.available===true?'Calendário salvo não disponível para este regime.':f.regime.status&&!/^Disponível/.test(f.regime.status)?f.regime.status:'Regime indisponível neste cenário.');
    const cell=compute(f);
    return cell && (cell.value===null||finite(cell.value)) ? cell : missing();
  }
  function row(key,label,kind,compute,{unit='currency',notes=[],informative=false,parentKey,sourceRefs=[]}={}) {
    const values={},monthlyValues={},calendarAnnualValues={},reasonByRegime={},calendarReasonByRegime={},monthlyReasonByRegime={};
    const percentValues={},monthlyPercentValues={},calendarAnnualPercentValues={};
    const percent=(cell,f)=>cell.value===null?null:unit==='percent'?cell.value:finite(f.get('revenue'))&&f.get('revenue')>0?cell.value/f.get('revenue'):null;
    for(const regime of originals){
      const annualFrame=frame(regime,'annual'),annual=checkedFrame(annualFrame,compute);
      const calendarFrame=frame(regime,'calendarAnnual'),calendarAnnual=checkedFrame(calendarFrame,compute);
      const monthFrames=months.map((_,index)=>frame(regime,'month',index)),monthly=monthFrames.map(f=>checkedFrame(f,compute));
      values[regime.id]=annual.value;calendarAnnualValues[regime.id]=calendarAnnual.value;monthlyValues[regime.id]=monthly.map(cell=>cell.value);
      reasonByRegime[regime.id]=annual.reason;calendarReasonByRegime[regime.id]=calendarAnnual.reason||monthly.find(cell=>cell.reason)?.reason||'';
      monthlyReasonByRegime[regime.id]=monthly.map(cell=>cell.reason);
      percentValues[regime.id]=percent(annual,annualFrame);calendarAnnualPercentValues[regime.id]=percent(calendarAnnual,calendarFrame);
      monthlyPercentValues[regime.id]=monthly.map((cell,index)=>percent(cell,monthFrames[index]));
    }
    return {key,label,kind,unit,values,monthlyValues,calendarAnnualValues,percentValues,monthlyPercentValues,calendarAnnualPercentValues,
      reasonByRegime,calendarReasonByRegime,monthlyReasonByRegime,notes:[...notes],informative,...(parentKey?{parentKey}:{}),sourceRefs:[...sourceRefs]};
  }
  const baseRows=dreRows({regimes:originals}),labels=new Map(baseRows);
  const base=key=>row(key,labels.get(key),SUBTOTALS.has(key)?'subtotal':'line',f=>currency(f.get(key)),{sourceRefs:[`result.regimes[].dre.${key}`]});
  const reconciledSum=(keys,parent,less=null)=>f=>{
    const value=sum(keys.map(key=>f.get(key))),expected=less?sum([f.get(parent),finite(f.get(less))?-f.get(less):null]):f.get(parent);
    return close(value,expected)?good(value):missing('As linhas disponíveis não conciliam com o subtotal salvo.');
  };
  const subtotal=(key,label,keys,parent,less)=>row(key,label,'subtotal',reconciledSum(keys,parent,less),{
    informative:true,notes:['Subtotal de conferência das linhas já incluídas no resultado; não somar novamente.'],sourceRefs:keys.map(key=>`result.regimes[].dre.${key}`)});
  const deductions=['das','cbsDebit','ibsDebit','icmsNet','iss',...['difal','icmsAnticipation'].filter(key=>labels.has(key))];
  const sections=[
    {key:'revenue',label:'Receitas',rows:['services','sales','revenue'].map(base)},
    {key:'deductions',label:'Tributos sobre a receita',rows:[...deductions.map(base),subtotal('revenueDeductions','Deduções tributárias da receita',deductions,'netRevenue','revenue'),base('netRevenue')]},
    {key:'costs',label:'Compras, custos e créditos',rows:[...['cmvSimple','cmvRegular','cmv','cbsUsed','ibsUsed'].map(base),subtotal('cmvNetCredits','Compras/CMV após créditos de CBS e IBS',['cmv','cbsUsed','ibsUsed'],'grossProfit','netRevenue'),base('grossProfit')]},
    {key:'expenses',label:'Despesas operacionais',rows:[...['salaries','benefits','payroll','personnel','administrative','rent','cards'].map(base),subtotal('operatingExpenses','Total de despesas operacionais',['personnel','administrative','rent','cards'],'preTax','grossProfit'),base('preTax')]},
    {key:'profit',label:'Tributos sobre o lucro e resultado',rows:[base('irpj'),base('csll'),subtotal('incomeTaxes','Total de IRPJ e CSLL',['irpj','csll'],'netProfit','preTax'),base('netProfit')]}
  ];
  const detail=(key,label,parentKey,compute,options={})=>row(key,label,'detail',compute,{informative:true,parentKey,...options});
  let salesMonthly=null;
  if(GROUPS.every(key=>finite(monthlyGroups?.[key])&&monthlyGroups[key]===Math.round(monthlyGroups[key]*100)/100))salesMonthly=GROUPS.map(key=>monthlyGroups[key]);
  else if(monthlyGroups==null && projection?.scenario?.unit==='CENTS' && GROUPS.every(key=>Number.isSafeInteger(projection.scenario.monthlyGroupsCents?.[key])))salesMonthly=GROUPS.map(key=>projection.scenario.monthlyGroupsCents[key]/100);
  const salesDetail=index=>f=>{
    if(actual){
      const groups=f.monthlyEntry?f.monthlyEntry.groups:Object.fromEntries(GROUPS.map(key=>[key,sum(result.monthlyResults.map(row=>row.groups[key]))]));
      return close(sum(GROUPS.map(key=>groups[key])),f.get('sales'))?good(groups[GROUPS[index]]):missing();
    }
    const total=salesMonthly?sum(salesMonthly)*12*f.scale:null;
    return close(total,f.get('sales'))?good(salesMonthly[index]*12*f.scale):missing('Os grupos mensais não estão disponíveis ou não conciliam com as vendas salvas.');
  };
  const serviceBaseline=source?.revenueSplit?.version==='SALES_SERVICES_V1' && projection?.version==='AVERAGE_X12_V2' && projection?.unit==='CENTS' &&
    Number.isSafeInteger(projection.monthlyGroupsCents?.serviceRevenueCents) && projection.monthlyGroupsCents.serviceRevenueCents>=0 &&
    (reportMonths==null||projection.reportMonths===reportMonths) ? projection.monthlyGroupsCents.serviceRevenueCents/100*12:null;
  const servicesDetail=adjustment=>f=>{
    if(actual){
      const reports=source?.monthlyReports;
      const sourceCents=!Array.isArray(reports)?null:f.monthlyEntry?reports.find(row=>row.sourceMonth===f.monthlyEntry.sourceMonth)?.fields?.serviceRevenueCents:sum(reports.map(row=>row.fields?.serviceRevenueCents));
      const baseline=finite(sourceCents)?sourceCents/100:null;
      return finite(baseline)&&finite(f.get('services'))?good(adjustment?f.get('services')-baseline:baseline):missing();
    }
    const annual=f.regime.dre?.services;
    if(!finite(serviceBaseline)||!finite(annual)||!close(annual*f.scale,f.get('services')))return missing('A base de serviços não está disponível ou não concilia com o cenário salvo.');
    return good((adjustment?annual-serviceBaseline:serviceBaseline)*f.scale);
  };
  const capturedOutside=(input,entries)=>{
    const entry=unique(entries,'id','outside');
    const text=entry?.unit==='text'&&['Sim','Não'].includes(entry.value)?entry.value==='Sim':null;
    const flag=typeof input?.icmsOutside==='boolean'?input.icmsOutside:null;
    return flag!==null&&text!==null&&flag!==text?null:flag??text;
  };
  const outsideBase=capturedOutside(engineInput,result?.memory);
  const outsideForMonth=entry=>capturedOutside(entry?.engineInput||engineInput?.months?.find(item=>item.sourceMonth===entry?.sourceMonth)?.input,entry?.result?.memory);
  const outsideForFrame=f=>{
    if(!actual)return outsideBase;
    if(f.monthlyEntry)return outsideForMonth(f.monthlyEntry);
    const flags=(result.monthlyResults||[]).map(outsideForMonth);
    return flags.length&&flags.every(flag=>typeof flag==='boolean'&&flag===flags[0])?flags[0]:null;
  };
  function creditCell(tax,field){return f=>{
    const id=f.regime.id,outside=outsideForFrame(f);
    if(!['pure','hybrid','presumed','actual'].includes(id))return missing('Aplicabilidade do crédito não disponível nesta versão.');
    if((tax!=='icms'&&id==='pure')||(tax==='icms'&&['pure','hybrid'].includes(id)&&outside===false))return missing('Incluído no DAS; sem crédito externo neste regime.');
    if(tax==='icms'&&['pure','hybrid'].includes(id)&&outside===null)return missing('A opção de ICMS fora do DAS não está confirmada nesta versão.');
    const credit=(f.monthResult||result)?.credits?.[tax];
    if(!['debit','potential','used','due','balance'].every(key=>finite(credit?.[key])&&credit[key]>=0)||
      (!actual&&!close(credit.used,Math.min(credit.debit,credit.potential)))||!close(credit.due,credit.debit-credit.used)||!close(credit.balance,credit.potential-credit.used))return missing('A apuração do crédito não está disponível ou não concilia.');
    const d=f.regime.dre;
    const matches=tax==='icms'?close(d?.icmsUsed,credit.used)&&close(d?.icmsBalance,credit.balance)&&close(f.get('icmsNet'),-credit.due*f.scale):
      close(f.get(tax+'Debit'),-credit.debit*f.scale)&&close(f.get(tax+'Used'),credit.used*f.scale);
    return matches?good(credit[field]*f.scale):missing('O crédito não concilia com os valores deste demonstrativo.');
  };}
  const creditDetails=['cbs','ibs','icms'].map(tax=>({key:tax+'Credits',label:'Apuração de '+tax.toUpperCase(),parentKey:tax==='icms'?'icmsNet':tax+'Debit',
    rows:[['debit','Débito'],['potential','Crédito potencial'],['used','Crédito utilizado'],['due','Valor líquido a recolher'],['balance','Saldo credor potencial']].filter(([field])=>tax==='icms'||!['potential','used'].includes(field)).map(([field,label])=>detail(tax+'.'+field,label+' de '+tax.toUpperCase(),tax==='icms'?'icmsNet':tax+'Debit',creditCell(tax,field),{
      notes:[field==='balance'?'Saldo informativo: não compõe o lucro nem representa restituição automática.':tax==='icms'?'Crédito já abatido do ICMS líquido; não somar novamente ao resultado.':'Detalhe da apuração já refletida nas linhas de débitos e créditos da DRE.'],sourceRefs:[`result.credits.${tax}.${field}`]}))}));
  const icmsOrigin=field=>f=>{
    const potential=creditCell('icms','potential')(f);
    if(potential.value===null)return potential;
    const purchase=memory('icms.purchaseCredit',f),returns=memory('icms.returnCredit',f),total=sum([purchase,returns]);
    if(!finite(total)||!close(total*f.scale,potential.value))return missing('A composição do crédito entre compras e devoluções não está capturada ou não concilia com o potencial salvo.');
    return good((field==='purchaseCredit'?purchase:returns)*f.scale);
  };
  const icmsOriginRows=[['purchaseCredit','Crédito de ICMS das compras elegíveis'],['returnCredit','Crédito de ICMS das devoluções de venda']].map(([field,label])=>
    detail('icms.'+field,label,'icms.potential',icmsOrigin(field),{notes:['Parcela do crédito potencial de ICMS; já incluída no crédito utilizado quando houver débito. Não somar novamente ao resultado.'],sourceRefs:[`result.memory:icms.${field}`]}));
  const capturedOrigin=icmsOriginRows.every(row=>Object.values(row.values).some(finite)||Object.values(row.monthlyValues).some(values=>values.some(finite))||Object.values(row.calendarAnnualValues).some(finite));
  const icmsRows=creditDetails.find(group=>group.key==='icmsCredits').rows;
  const icmsReconciliation={key:'icmsReconciliation',label:'Apuração do crédito de ICMS',
    note:'Débito de ICMS menos crédito utilizado = valor líquido a recolher. O crédito utilizado já está abatido na linha “− ICMS líquido fora do DAS” desta DRE. Este quadro é informativo e não acrescenta uma segunda dedução ao resultado. Crédito potencial menos crédito utilizado = saldo credor potencial, sem restituição ou compensação automática.',
    rows:[...icmsRows.slice(0,2),...(capturedOrigin?icmsOriginRows:[]),...icmsRows.slice(2)]};
  const irpjDetail=part=>f=>{
    const id=f.regime.id;
    if(['pure','hybrid'].includes(id))return missing('IRPJ incluído no DAS; sem parcela externa neste regime.');
    if(!['presumed','actual'].includes(id))return missing();
    const basic=memory(id+'.irBasic',f),additional=memory(id+'.irAdditional',f),total=memory(id+'.irTotal',f);
    return close(sum([basic,additional]),total)&&close(-total,f.regime.dre?.irpj)&&close(-total*f.scale,f.get('irpj'))?
      good(-(part==='basic'?basic:additional)*f.scale):missing('A memória do IRPJ não está disponível ou não concilia com o total salvo.');
  };
  const details=[
    {key:'salesBreakdown',label:'Composição das vendas utilizadas',parentKey:'sales',rows:GROUPS.map((key,index)=>detail(key,['Vendas a optantes do Simples','Vendas a não optantes do Simples','Vendas a CPFs'][index],'sales',salesDetail(index),{notes:['Valores utilizados no cenário. O fechamento ao final separa a receita da fonte, as devoluções já abatidas e os ajustes manuais quando há evidência capturada.'],sourceRefs:[`monthlyGroups.${key}`]}))},
    {key:'serviceBreakdown',label:'Composição da receita de serviços',parentKey:'services',rows:[detail('serviceReport',actual?'Serviços dos relatórios · por competência':'Serviços dos relatórios · média projetada','services',servicesDetail(false),{sourceRefs:['projection.monthlyGroupsCents.serviceRevenueCents']}),detail('serviceAdjustment','Ajuste de serviços no cenário','services',servicesDetail(true),{notes:[reprocessing?.serviceRevenueMigration?.warning||'Diferença entre os serviços do cenário e a base importada; pode ser positiva, negativa ou zero.'],sourceRefs:['result.regimes[].dre.services','projection.monthlyGroupsCents.serviceRevenueCents']})]},
    ...creditDetails.filter(group=>group.key!=='icmsCredits'),
    {key:'irpjBreakdown',label:'Composição do IRPJ',parentKey:'irpj',rows:[detail('irpjBasic','− IRPJ normal','irpj',irpjDetail('basic'),{sourceRefs:['result.memory:presumed.irBasic','result.memory:actual.irBasic']}),detail('irpjAdditional','− Adicional de IRPJ','irpj',irpjDetail('additional'),{sourceRefs:['result.memory:presumed.irAdditional','result.memory:actual.irAdditional']})]}
  ];
  const taxes=f=>{
    const pieces=[...deductions,'payroll','irpj','csll','cbsUsed','ibsUsed'];
    const net=sum(pieces.map(key=>f.get(key)));
    if(!finite(net))return missing('Os tributos e encargos não estão completos neste demonstrativo.');
    const value=-net;
    if(f.kind==='annual'&&!close(value,f.regime.totalTaxes))return missing('Os tributos não conciliam com o total salvo.');
    return good(f.kind==='annual'?f.regime.totalTaxes:value);
  };
  const ratio=(numerator,{negative=false,stored}={})=>f=>{
    const revenue=f.get('revenue');
    if(!finite(revenue)||revenue<=0)return missing('Percentual não aplicável sem receita utilizada positiva.');
    const amount=typeof numerator==='function'?numerator(f):currency(f.get(numerator));
    if(amount.value===null)return amount;
    const value=amount.value*(negative?-1:1)/revenue;
    if(stored&&f.kind==='annual')return close(f.regime[stored],value)?good(f.regime[stored]):missing('O indicador não está disponível ou não concilia com o resultado salvo.');
    return good(value);
  };
  const indicator=(key,label,compute,options={})=>row(key,label,'indicator',compute,{unit:'percent',informative:true,notes:['Percentual sobre a receita utilizada no mesmo cenário e período. O fechamento separa devoluções e ajustes quando há evidência capturada.'],...options});
  const indicators=[
    indicator('grossMargin','Margem bruta sobre receita utilizada',ratio('grossProfit')),
    indicator('preTaxMargin','Margem antes de IRPJ/CSLL sobre receita utilizada',ratio('preTax')),
    indicator('netMargin','Margem líquida',ratio('netProfit',{stored:'margin'})),
    indicator('taxBurden','Tributos e encargos sobre receita utilizada',ratio(taxes,{stored:'taxBurden'})),
    indicator('cmvBurden','Compras/CMV sobre receita utilizada',ratio('cmv',{negative:true})),
    indicator('operatingExpenseBurden','Despesas operacionais sobre receita utilizada',ratio(reconciledSum(['personnel','administrative','rent','cards'],'preTax','grossProfit'),{negative:true})),
    indicator('totalTaxes','Tributos e encargos totais',taxes,{unit:'currency',notes:['Inclui encargos sobre a folha. Créditos utilizados já foram abatidos; não deduzir novamente.']})
  ];
  // The source is already net of returns. This bridge explains the captured amount;
  // it must never become another deduction or invoke the calculator on historical data.
  const revenueFrames=new Map();
  const reconcileRevenue=f=>{
    if(!actual)return {available:false,reason:'A separação entre receita bruta e devoluções não está comprovada nesta projeção histórica.'};
    const revenue=f.get('revenue'),scenarioRevenueCents=finite(revenue)?Math.round(revenue*100):null;
    if(!Number.isSafeInteger(scenarioRevenueCents)||!close(scenarioRevenueCents/100,revenue))return {available:false,reason:'A receita utilizada não está disponível em centavos nesta versão.'};
    if(!close(revenue,f.regime.dre?.revenue)||!close(sum([f.get('sales'),f.get('services')]),revenue))return {available:false,reason:'A composição da receita não concilia com a DRE e o calendário preservados nesta versão.'};
    const sourceMonth=f.monthlyEntry?.sourceMonth||null,key=`${sourceMonth||'annual'}:${scenarioRevenueCents}`;
    if(!revenueFrames.has(key)){
      const reconciliation=buildRevenueReconciliation({source,sourceMonth,scenarioRevenueCents});
      const capturedMonths=(result.monthlyResults||[]).map(entry=>entry.sourceMonth);
      const matches=sourceMonth||!reconciliation.available||(capturedMonths.length===reconciliation.monthly.length&&new Set(capturedMonths).size===capturedMonths.length&&reconciliation.monthly.every(entry=>capturedMonths.includes(entry.sourceMonth)));
      revenueFrames.set(key,matches?reconciliation:{available:false,reason:'As competências da fonte não correspondem às competências da DRE salva.'});
    }
    return revenueFrames.get(key);
  };
  const revenueCell=(field,negative=false)=>f=>{
    const reconciliation=reconcileRevenue(f),amount=reconciliation[field];
    return reconciliation.available&&Number.isSafeInteger(amount)?good((negative&&amount!==0?-amount:amount)/100):missing(reconciliation.reason||'Conferência da receita indisponível nesta versão.');
  };
  const revenueReconciliation={key:'revenueReconciliation',label:'Fechamento da receita',
    note:'Receita bruta de vendas e serviços menos devoluções de venda = receita após devoluções. Os ajustes manuais explicam a diferença até a receita utilizada. Quando a origem está conciliada, as devoluções já estão abatidas; este fechamento não altera nem deduz novamente os valores da DRE.',
    rows:[
      row('revenueSourceGross','Receita bruta de vendas e serviços','line',revenueCell('grossRevenueCents'),{informative:true,sourceRefs:['source.monthlyReports[].operationAudit.grossSalesCents','source.monthlyReports[].operationAudit.serviceSalesCents']}),
      row('revenueSalesReturns','− Devoluções de vendas','line',revenueCell('salesReturnsCents',true),{informative:true,notes:['Devoluções de venda identificadas nas entradas, já abatidas na receita da competência; não deduzir novamente.'],sourceRefs:['source.monthlyReports[].operationAudit.salesReturnsCents']}),
      row('revenueAfterReturns','= Receita após devoluções','subtotal',revenueCell('revenueAfterReturnsCents'),{informative:true,sourceRefs:['source.monthlyReports[].fields']}),
      row('revenueManualAdjustment','Ajustes manuais do cenário (+/−)','line',revenueCell('manualAdjustmentCents'),{informative:true,notes:['Diferença entre a receita utilizada no cenário e a receita da fonte após devoluções. Não modifica os relatórios de origem.'],sourceRefs:['source.monthlyReports[].fields','result.regimes[].dre.revenue']}),
      row('revenueUsed','= Receita utilizada na simulação','subtotal',f=>currency(f.get('revenue')),{informative:true,notes:['Valor preservado na DRE. A base dos tributos, margens e percentuais permanece a mesma.'],sourceRefs:['result.regimes[].dre.revenue']})
    ]};
  const appliedCredits=analysisPeriod?row('appliedCredits','Créditos tributários efetivamente utilizados','indicator',f=>{
    const icms=f.regime.dre?.icmsUsed;
    if(!finite(icms)||icms<0)return missing('O crédito de ICMS utilizado não está capturado nesta versão.');
    if(!close(f.get('icmsNet'),f.regime.dre?.icmsNet*f.scale))return missing('O ICMS líquido do calendário não concilia com o resultado capturado.');
    const amounts=[f.get('cbsUsed'),f.get('ibsUsed'),icms*f.scale];
    return amounts.every(value=>finite(value)&&value>=0)?good(sum(amounts)):missing('Os créditos utilizados não estão completos neste período e regime.');
  },{informative:true,notes:['Créditos de CBS, IBS e ICMS já considerados nos impostos ou nas compras. Não acrescentar novamente ao resultado; não representam restituição em dinheiro.'],sourceRefs:['result.regimes[].dre.cbsUsed','result.regimes[].dre.ibsUsed','result.regimes[].dre.icmsUsed']}):null;
  const commercialComposition=analysisPeriod&&source?.commercialComposition?.version==='COMMERCIAL_COMPOSITION_V1'?structuredClone(source.commercialComposition):null;
  const monthlyCommercialComposition=analysisPeriod?Object.fromEntries((source?.monthlyReports||[]).filter(entry=>entry.commercialComposition?.version==='COMMERCIAL_COMPOSITION_V1'&&analysisPeriod.includedMonths.includes(entry.sourceMonth)).map(entry=>[entry.sourceMonth,structuredClone(entry.commercialComposition)])):null;
  return {version:DRE_PRESENTATION_VERSION,method:actual?'REPORT_MONTHS_V1':null,regimes,sections,details,indicators,revenueReconciliation,icmsReconciliation,months,calendarYear,
    ...(analysisPeriod?{analysisPeriod,appliedCredits,commercialComposition,monthlyCommercialComposition}:{}),
    ...(regimeSelection?{regimeSelection}:{}),
    ...(hasSimples&&result?.simplesDiagnostic?.version==='SIMPLES_DIAGNOSTIC_V1'?{simplesDiagnostic:structuredClone(result.simplesDiagnostic)}:{}),
    report:{modelVersion:typeof result?.version==='string'?result.version:null,
      sourceMonths:actual?(result.monthlyResults||[]).map(row=>row.sourceMonth):[],
      warnings:structuredClone((Array.isArray(result?.warnings)?result.warnings:[]).filter(item=>!regimeSelection||regimeWarningApplies(item.code,regimeSelection))),
      memory:structuredClone((Array.isArray(result?.memory)?result.memory:[]).filter(item=>!regimeSelection||regimeMemoryApplies(item.id,regimeSelection))),
      sources:structuredClone(Array.isArray(taxSources)?taxSources:[]),
      reportPeriod:structuredClone(calendar?.reportPeriod??source?.period??null)},
    ...(capturedDifalVersion(result?.difalPolicy)?{difalPolicy:structuredClone(result.difalPolicy)}:{}),
    ...(hasSimples&&calendar?.rbt12Schedule?{rbt12Schedule:structuredClone(calendar.rbt12Schedule)}:{}),
    calendarReference:hasSimples?calendar?.rbt12Reference??null:null,calendarRounding:calendar?.rounding??'Valores completos preservados; exibição com duas casas decimais.',
    percentBasis:'Receita utilizada na simulação, no mesmo período e regime'};
}
