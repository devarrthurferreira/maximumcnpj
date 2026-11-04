import {dreRows, MONTH_NAMES} from './simulator-calendar.js';
import {buildRevenueReconciliation} from './revenue-reconciliation.js';
import {resolveRegimeSelection,requiresSimplesReference,regimeMemoryApplies,regimeWarningApplies} from './regime-selection.js';
import {reconcileIrpj,IRPJ_RECONCILIATION_VERSION,QUARTERLY_IRPJ_RECONCILIATION_VERSION,usesQuarterlyIncomeTax} from './irpj-reconciliation.js';

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
    const complete=count>0&&count<=9&&expected.length===9&&period.complete===true;
    const fullCoverage=complete&&count===9,omitted=expected.filter(month=>!included.includes(month));
    return {actual:true,sourceMonths:included,count,completeYear:false,completePeriod:complete,fullCoverage,omittedMonths:omitted,
      label:`Janeiro a setembro · ${count} de 9 competências`,
      detail:complete?`O consolidado soma somente ${count} ${count===1?'competência confirmada':'competências confirmadas'}: ${included.join(', ')}. ${omitted.length?'Fora do cálculo por falta de dados: '+omitted.join(', ')+'. ':''}Não há preenchimento com zero nem projeção dos meses ausentes. Outubro a dezembro ficam fora da análise. A RBT12 do Simples mantém sua referência própria de 12 meses.`:'Nenhuma competência com dados suficientes entre janeiro e setembro. Não há consolidado disponível.'};
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
  const ids=(presentation?.regimes||[]).map(regime=>regime.id);
  const selection=ids.length&&ids.every(id=>['pure','hybrid','presumed','actual'].includes(id))&&new Set(ids).size===ids.length?
    {version:'REGIME_SELECTION_V1',selected:ids}:presentation?.regimeSelection;
  const simplesPending=(presentation?.regimes||[]).some(regime=>['pure','hybrid'].includes(regime.id)&&regime.available!==true);
  const missingRbt12=presentation?.rbt12Source==='NOT_PROVIDED';
  const unavailable=new Map((presentation?.regimes||[]).filter(regime=>regime.available!==true).map(regime=>[regime.id,regime]));
  return (presentation?.report?.memory||[]).filter(item=>(selection===undefined||regimeMemoryApplies(item.id,selection))&&(includeDre||!/^dre\.|^summary\./.test(item.id))).map(item=>{
    const key=/^dre\.[^.]+\.(revenue|netRevenue)$/.exec(item.id)?.[1];
    const label=key==='revenue'?'Receita total utilizada':key==='netRevenue'?'Receita após deduções tributárias':item.label;
    const pending=unavailable.get(/^(?:dre|summary)\.([^.]+)\./.exec(item.id)?.[1]);
    if(pending&&typeof item.value==='number')return {...item,label,unit:'text',value:`Não disponível: ${pending.status||'o cálculo deste regime exige conferência neste período.'}`};
    if(missingRbt12&&typeof item.value==='number'&&/^simples\./.test(item.id)&&item.id!=='simples.revenueReference')
      return {...item,label,unit:'text',value:'Não disponível: a RBT12 não foi informada.'};
    if(simplesPending&&item.unit==='currency'&&/^simples\./.test(item.id)&&!/(?:\.deduction$|^simples\.revenueReference$)/.test(item.id))
      return {...item,label,unit:'text',value:'Não disponível: o cálculo do Simples exige conferência neste período.'};
    return label!==item.label?{...item,label}:item;
  });
}

/** Captured calculation rows remain available for reconciliation and historical views. */
export function capturedDreRows(presentation) {
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
  for(const row of presentation?.irpjReconciliation?.rows||[])append(row);
  return rows;
}

/** The DRE keeps one tax deduction; the assessed taxes have their own statement. */
export function unifiedDreRows(presentation) {
  if(presentation?.statement?.version!=='DRE_STATEMENT_V1')return capturedDreRows(presentation);
  return [...presentation.statement.sections.flatMap(section=>section.rows||[]),
    ...(presentation.revenueReconciliation?.rows||[]),...(presentation.icmsReconciliation?.rows||[])];
}

export function buildDrePresentation({result,monthlyGroups,projection,source,reportMonths,engineInput,reprocessing,calendar,taxSources,rbt12Source}={}) {
  const capturedSelection=result?.regimeSelection!==undefined?result.regimeSelection:engineInput?.regimeSelection!==undefined?engineInput.regimeSelection:calendar?.regimeSelection;
  const regimeSelection=capturedSelection===undefined?undefined:resolveRegimeSelection(capturedSelection),hasSimples=requiresSimplesReference(regimeSelection);
  const capturedRbt12Source=rbt12Source??result?.rbt12Source??calendar?.rbt12Source;
  const originals = (Array.isArray(result?.regimes) ? result.regimes : []).filter(regime=>!regimeSelection||regimeSelection.selected.includes(regime.id));
  const actual=result?.method==='REPORT_MONTHS_V1';
  const quarterlyIrpj=usesQuarterlyIncomeTax(result);
  const uniformQuarterly=quarterlyIrpj&&!actual&&result?.incomeTaxAssessment?.basis==='UNIFORM_PROJECTION';
  const analysisPeriod=actual&&result.analysisPeriod?.version==='JAN_SEP_V1'?structuredClone(result.analysisPeriod):null;
  const hasCalendar = calendar != null;
  const validCalendar = Array.isArray(calendar?.months) && (analysisPeriod?
    calendar.version==='DRE_CALENDAR_V4'&&calendar.analysisPeriod?.version==='JAN_SEP_V1'&&calendar.months.length===analysisPeriod.includedMonths?.length&&calendar.months.every((month,index)=>month.sourceMonth===analysisPeriod.includedMonths[index]&&month.number===Number(month.sourceMonth.slice(5))):
    ['DRE_CALENDAR_V1','DRE_CALENDAR_V2','DRE_CALENDAR_V3'].includes(calendar?.version)&&calendar.months.length===12);
  const calendarYear = calendar?.year ?? engineInput?.year ?? null;
  const months = validCalendar ? calendar.months.map(month=>({...month})) : (analysisPeriod?analysisPeriod.includedMonths.map(sourceMonth=>({sourceMonth,number:Number(sourceMonth.slice(5))})):MONTH_NAMES.map((_,index)=>({number:index+1}))).map(month=>({...month,label:MONTH_NAMES[month.number-1],period:calendarYear?`${calendarYear}-${String(month.number).padStart(2,'0')}`:null}));
  const memory = (id,frame=null) => {
    const entry=unique(frame?.monthResult?.memory||result?.memory,'id',id);
    return entry?.unit==='currency' && finite(entry.value) && entry.value>=0 ? entry.value : null;
  };
  function frame(regime,kind,index=null) {
    const saved=validCalendar?unique(calendar.regimes,'id',regime.id):null;
    const monthlyEntry=actual&&kind==='month'?result.monthlyResults?.find(row=>row.month===months[index]?.number):null;
    const monthlyRegime=monthlyEntry?.result?.regimes?.find(row=>row.id===regime.id);
    const effective=monthlyRegime||regime;
    const available=actual&&kind==='month'?
      !!monthlyRegime&&monthlyRegime.available===true&&(!hasCalendar||(validCalendar&&['DRE_CALENDAR_V3','DRE_CALENDAR_V4'].includes(calendar.version)&&!!saved&&calendar.months[index]?.sourceMonth===monthlyEntry.sourceMonth)):
      regime.available===true&&(kind==='annual'||!hasCalendar||saved?.available===true);
    return {regime:effective,kind,index,available,monthlyEntry,monthResult:monthlyEntry?.result,scale:kind==='month'&&!actual?1/12:1,
      get(key) {
        if(!available)return null;
        if(actual&&kind==='month'&&!hasCalendar){const value=effective.dre?.[key];return finite(value)?value:null;}
        if(uniformQuarterly&&kind==='month'&&!hasCalendar&&['irpj','csll','netProfit'].includes(key)&&['presumed','actual'].includes(regime.id)){
          const period=`${result.incomeTaxAssessment.scenarioYear}-${String(months[index].number).padStart(2,'0')}`;
          const captured=result.incomeTaxAssessment.monthlyAssessments?.[period]?.regimes?.[regime.id];
          if(!captured?.available||!captured.movement)return null;
          const irpj=-captured.movement.irpjTotalCents/100,csll=-captured.movement.csllCents/100;
          return key==='irpj'?irpj:key==='csll'?csll:regime.dre.preTax/12+irpj+csll;
        }
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
  const baseRows=dreRows({...result,regimes:originals}),labels=new Map(baseRows);
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
    note:`Débito de ICMS menos crédito utilizado = valor líquido a recolher. O crédito utilizado já está abatido na linha “${analysisPeriod?'ICMS (D − C) apurado':'− ICMS líquido fora do DAS'}” desta DRE. Este quadro é informativo e não acrescenta uma segunda dedução ao resultado. Crédito potencial menos crédito utilizado = saldo credor potencial, sem restituição ou compensação automática.`,
    rows:[...icmsRows.slice(0,2),...(capturedOrigin?icmsOriginRows:[]),...icmsRows.slice(2)]};
  const irpjExpectedMonths=uniformQuarterly?null:analysisPeriod?.includedMonths??(Array.isArray(source?.monthlyReports)?
    source.monthlyReports.map(entry=>entry?.sourceMonth):validCalendar?calendar.months.filter(month=>month.sourceMonth).map(month=>month.sourceMonth):null);
  const irpjExpectedCount=uniformQuarterly?null:analysisPeriod?.months??reportMonths??source?.reportMonths??null;
  const irpjCache=new Map();
  const irpjAssessment=f=>{
    const sourceMonth=f.kind==='month'?(actual?f.monthlyEntry?.sourceMonth:uniformQuarterly?
      `${result.incomeTaxAssessment.scenarioYear}-${String(months[f.index]?.number).padStart(2,'0')}`:null):null;
    if(actual&&f.kind==='month'&&(!sourceMonth||(months[f.index]?.sourceMonth&&months[f.index].sourceMonth!==sourceMonth)))
      return {available:false,reason:'As competências do IRPJ estão ausentes, duplicadas ou divergem do período salvo.'};
    const key=f.regime.id+':'+(sourceMonth||'period');
    if(!irpjCache.has(key))irpjCache.set(key,reconcileIrpj(result,f.regime.id,{sourceMonth,
      expectedSourceMonths:irpjExpectedMonths,expectedCount:irpjExpectedCount}));
    const assessed=irpjCache.get(key);
    if(!assessed.available)return assessed;
    const movement=assessed.componentMovements?.total??assessed.values.irpjTotalAssessed;
    const scale=quarterlyIrpj?1:f.scale;
    if((!(uniformQuarterly&&f.kind==='month')&&!close(-movement,f.regime.dre?.irpj))||
       !close(-movement*scale,f.get('irpj')))
      return {available:false,reason:'A memória do IRPJ não concilia com o total do calendário salvo.'};
    return assessed;
  };
  const irpjValue=(key,sign=1)=>f=>{
    const assessed=irpjAssessment(f);
    return assessed.available?{value:sign*assessed.values[key]*(quarterlyIrpj?1:f.scale),
      reason:quarterlyIrpj&&assessed.status==='PROVISIONAL'?assessed.reason:''}:missing(assessed.reason);
  };
  const irpjDetail=part=>f=>{
    const assessed=irpjAssessment(f);
    if(!assessed.available)return missing(assessed.reason);
    return quarterlyIrpj?{value:assessed.componentMovements[part==='basic'?'normal':'additional']===0?0:-assessed.componentMovements[part==='basic'?'normal':'additional'],
      reason:assessed.status==='PROVISIONAL'?assessed.reason:''}:
      good(-assessed.values[part==='basic'?'irpjNormalAssessed':'irpjAdditionalAssessed']*f.scale);
  };
  const irpjReconciliation={key:'irpjReconciliation',version:quarterlyIrpj?QUARTERLY_IRPJ_RECONCILIATION_VERSION:IRPJ_RECONCILIATION_VERSION,label:'Memória de cálculo do IRPJ',
    note:quarterlyIrpj?'IRPJ e CSLL por trimestre civil. No mês, a memória mostra a provisão acumulada no trimestre e desconta a provisão anterior para explicar o movimento lançado na DRE. O limite do adicional permanece R$ 60.000 por trimestre, inclusive na provisão parcial. Não some os acumulados mensais: o consolidado usa o último acumulado de cada trimestre, com centavos fechados por componente. Competências ausentes não viram zero: provisão parcial não é fechamento confirmado. O Real é uma estimativa gerencial, sem ajustes fiscais, estoques ou compensação de prejuízos.':actual?'Estimativa gerencial mensal histórica. O consolidado soma os cálculos de cada competência. O limite não utilizado em um mês não reduz o excedente de outro. Base dentro do limite + base excedente = base do IRPJ. IRPJ normal + adicional = IRPJ total. Estes valores são informativos e já estão incluídos nos tributos da DRE.':
      'Projeção anual capturada: limite de R$ 240.000 para o adicional. A visualização mensal divide a projeção por 12, com limite equivalente a R$ 20.000; não representa movimentos históricos. Base dentro do limite + base excedente = base do IRPJ. As parcelas já estão incluídas nos tributos da DRE.',
    rows:[
      row('irpjTaxBase','Base do IRPJ','detail',irpjValue('irpjTaxBase'),{informative:true,
        notes:[quarterlyIrpj?'No mês: base acumulada nas competências conhecidas do trimestre. No consolidado: soma das bases de cada período. Real: resultado com sinal agregado antes do piso de zero.':'Presumido: base presumida total capturada. Real: base positiva capturada do resultado anterior ao IRPJ/CSLL.'],
        sourceRefs:['result.memory:presumed.irTotalBase','result.memory:actual.base']}),
      row('irpjAdditionalLimit','Limite do adicional','detail',irpjValue('irpjAdditionalLimit'),{informative:true,
        notes:[quarterlyIrpj?'R$ 60.000 por trimestre civil. Meses ausentes não reduzem esse limite; o consolidado soma os limites dos períodos.':'R$ 20.000 por competência calculada; o consolidado mostra a soma dos limites mensais. Projeção anual: R$ 240.000.'],
        sourceRefs:['result.method','result.monthlyResults[].sourceMonth']}),
      row('irpjBaseWithinLimit','Base dentro do limite','detail',irpjValue('irpjBaseWithinLimit'),{informative:true,
        notes:[quarterlyIrpj?'Menor valor entre a base acumulada e o limite do trimestre; no consolidado, soma das parcelas de cada período.':'Menor valor entre a base e o limite, calculado antes de somar as competências.'],
        sourceRefs:['result.memory:presumed.irTotalBase','result.memory:actual.base']}),
      row('irpjExcessBase','Base excedente ao limite','detail',irpjValue('irpjExcessBase'),{informative:true,
        notes:[quarterlyIrpj?'Máximo(0; base acumulada do IRPJ − R$ 60.000), calculado por trimestre antes de somar os períodos.':'Máximo(0; base do IRPJ − limite), calculado por competência antes da soma.'],
        sourceRefs:['result.memory:presumed.irTotalBase','result.memory:actual.base']}),
      row('irpjNormalAssessed','IRPJ normal · 15% da base','detail',irpjValue('irpjNormalAssessed'),{informative:true,
        notes:[quarterlyIrpj?'Base acumulada × 15%; provisão arredondada por componente. No consolidado, soma das parcelas de cada período.':'Base do IRPJ × 15%; parcela capturada conferida contra a base.'],
        sourceRefs:['result.memory:presumed.irBasic','result.memory:actual.irBasic']}),
      row('irpjAdditionalAssessed','Adicional de IRPJ · 10% do excedente','detail',irpjValue('irpjAdditionalAssessed'),{informative:true,
        notes:[quarterlyIrpj?'Excedente do trimestre × 10%; provisão arredondada por componente. Não é o movimento isolado do mês.':'Base excedente ao limite × 10%; parcela capturada conferida em cada competência.'],
        sourceRefs:['result.memory:presumed.irAdditional','result.memory:actual.irAdditional']}),
      row('irpjTotalAssessed','IRPJ total apurado','detail',irpjValue('irpjTotalAssessed'),{informative:true,
        notes:[quarterlyIrpj?'Normal + adicional acumulados. Subtraia a provisão anterior para chegar ao movimento reconhecido na DRE.':'IRPJ normal + adicional; mesmo imposto da DRE, apresentado como valor positivo para conferência.'],
        sourceRefs:['result.memory:presumed.irTotal','result.memory:actual.irTotal','result.regimes[].dre.irpj']})
      ,...(quarterlyIrpj?[
        row('irpjPreviousProvision','Provisão anterior','detail',irpjValue('irpjPreviousProvision'),{informative:true,
          notes:['No mês: valor já reconhecido no trimestre. No consolidado: zero na ponte com a soma dos períodos.'],sourceRefs:['result.incomeTaxAssessment.regimes[].previousProvision']}),
        row('irpjCurrentMovement','Movimento reconhecido na DRE','detail',irpjValue('irpjCurrentMovement'),{informative:true,
          notes:['IRPJ acumulado − provisão anterior. Valor negativo é reversão de provisão; não é restituição automática. A DRE usa o sinal oposto uma única vez.'],sourceRefs:['result.incomeTaxAssessment.regimes[].movement','result.regimes[].dre.irpj']})
      ]:[])
    ]};
  if(quarterlyIrpj){
    for(const item of irpjReconciliation.rows)item.sourceRefs=[...new Set([...item.sourceRefs,
      'result.incomeTaxAssessment.regimes[].periods','result.monthlyResults[].result.incomeTaxAssessment',
      'result.incomeTaxAssessment.monthlyAssessments'])];
    irpjReconciliation.frames=Object.fromEntries(originals.map(regime=>{
      const describe=f=>{const assessed=irpjAssessment(f);return {available:assessed.available,status:assessed.status||'UNAVAILABLE',
        reason:assessed.reason||'',scope:assessed.scope||null,closed:assessed.closure?.available===true};};
      return [regime.id,{period:describe(frame(regime,'annual')),months:months.map((_,index)=>describe(frame(regime,'month',index)))}];
    }));
  }
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
  let statement,taxStatement;
  if(analysisPeriod){
    const captured=new Map([...sections.flatMap(section=>section.rows),...indicators].map(item=>[item.key,item]));
    const display=(key,label,options={})=>{const original=captured.get(key);return original?{...original,...options,label:label||original.label}:null;};
    // Change only the presentation sign. Preserve nulls, captured reasons and
    // reversals; Math.abs would incorrectly turn a reversal into another charge.
    const opposite=(original,options={})=>{
      if(!original)return null;
      const negate=value=>finite(value)?value===0?0:-value:null;
      const maps=Object.fromEntries(['values','calendarAnnualValues','percentValues','calendarAnnualPercentValues']
        .map(key=>[key,Object.fromEntries(Object.entries(original[key]||{}).map(([id,value])=>[id,negate(value)]))]));
      for(const key of ['monthlyValues','monthlyPercentValues'])maps[key]=Object.fromEntries(Object.entries(original[key]||{}).map(([id,values])=>[id,values.map(negate)]));
      return {...original,...maps,...options};
    };
    const combinedTaxes=row('cbsIbsNet','CBS/IBS (D − C)','line',f=>{
      const value=sum(['cbsDebit','ibsDebit','cbsUsed','ibsUsed'].map(key=>f.get(key)));
      return finite(value)?good(value):missing('Os débitos e créditos utilizados de CBS/IBS não estão completos nesta versão.');
    },{notes:['CBS/IBS apurado = débitos de CBS e IBS menos os créditos efetivamente utilizados de cada tributo, sem compensar saldos entre tributos ou competências. O valor devido já integra o total de impostos.'],
      sourceRefs:['result.regimes[].dre.cbsDebit','result.regimes[].dre.ibsDebit','result.regimes[].dre.cbsUsed','result.regimes[].dre.ibsUsed']});
    const expensesWithoutPayroll=row('operatingExpensesBeforePayroll','Total de despesas operacionais','subtotal',f=>{
      const value=sum(['salaries','benefits','administrative','rent','cards'].map(key=>f.get(key)));
      const expected=sum([f.get('preTax'),finite(f.get('grossProfit'))?-f.get('grossProfit'):null,finite(f.get('payroll'))?-f.get('payroll'):null]);
      return close(value,expected)?good(value):missing('As despesas sem encargos não conciliam com os subtotais salvos.');
    },{informative:true,notes:['Soma de salários, benefícios, outras despesas, aluguel e taxas de cartão. INSS/encargos da folha aparecem uma única vez no quadro de tributos.'],
      sourceRefs:['result.regimes[].dre.salaries','result.regimes[].dre.benefits','result.regimes[].dre.administrative','result.regimes[].dre.rent','result.regimes[].dre.cards']});
    const capturedRate=(key,entry)=>{
      const input=entry.engineInput||engineInput?.months?.find(item=>item.sourceMonth===entry.sourceMonth)?.input;
      const valid=value=>finite(value)&&value>=0&&value<=1;
      const raw=input?.rates?.[key],fromInput=valid(raw)?raw:null;
      const matches=(entry.result?.memory||[]).filter(item=>item?.id==='rate.'+key),stored=matches.length===1?matches[0]:null;
      if(matches.length&&(matches.length!==1||stored.unit!=='percent'||!valid(stored.value)))return null;
      const fromMemory=stored?.value??null;
      if(raw!==undefined&&!valid(raw))return null;
      if(fromInput!==null&&fromMemory!==null&&!close(fromInput,fromMemory))return null;
      return fromInput??fromMemory;
    };
    const rateMonths=analysisPeriod.includedMonths.map(sourceMonth=>{
      const matches=(result.monthlyResults||[]).filter(entry=>entry.sourceMonth===sourceMonth);
      const entry=matches.length===1?matches[0]:null,cbs=entry?capturedRate('cbs',entry):null,ibs=entry?capturedRate('ibs',entry):null;
      return {sourceMonth,cbs,ibs,combined:sum([cbs,ibs])};
    });
    const commonRate=key=>rateMonths.length&&rateMonths.every(entry=>finite(entry[key])&&close(entry[key],rateMonths[0][key]))?rateMonths[0][key]:null;
    const cbs=commonRate('cbs'),ibs=commonRate('ibs');
    const optionalTax=(key,label,notes)=>display(key,label,{notes})||row(key,label,'line',f=>currency(f.get(key)),{
      notes:[...notes,'Informação não capturada nesta versão permanece indisponível; não representa zero confirmado.'],
      sourceRefs:[`result.regimes[].dre.${key}`]});
    const assessedRows=[display('das','Simples'),display('icmsNet','ICMS (D − C)'),combinedTaxes,
      display('irpj','IRPJ'),display('csll','CSLL'),optionalTax('icmsAnticipation','Antecipação',['Antecipação de ICMS capturada no cenário, incluída uma única vez no total de impostos.']),optionalTax('difal','DIFAL',['DIFAL capturado no cenário, incluído uma única vez no total de impostos.']),
      display('payroll','INSS',{notes:['Encargos patronais da folha capturados no cenário. No Simples, somente a parcela fora do DAS; não somar novamente às despesas operacionais.']})].filter(Boolean);
    const iss=captured.get('iss');
    // Retain tax components whenever they are applied or their absence is not confirmed.
    if(iss&&originals.some(regime=>[iss.values[regime.id],iss.calendarAnnualValues[regime.id],...(iss.monthlyValues[regime.id]||[])].some(value=>value===null||value!==0)))assessedRows.push(display('iss','ISS fora do DAS'));
    const taxRates={cbs,ibs,combined:sum([cbs,ibs]),monthly:rateMonths};
    const taxTotal=display('totalTaxes','Total',{kind:'subtotal',notes:['Soma dos tributos e encargos apurados. Valores devidos são positivos e estornos são negativos. Créditos utilizados já foram abatidos; antecipação e INSS entram uma única vez.']});
    const taxesDeduction=opposite(taxTotal,{key:'taxesDeduction',label:'(−) Total de impostos',kind:'detail',informative:true,
      notes:['Dedução única do total apresentado no bloco Impostos. Inclui os encargos da folha e a antecipação de ICMS; os créditos utilizados já foram abatidos.']});
    taxStatement={version:'DRE_TAX_STATEMENT_V1',label:'Impostos',taxRates,
      rows:[...assessedRows.map(item=>opposite(item)),taxTotal,
        display('taxBurden','% sobre a receita',{notes:['Total de impostos ÷ Receita Total utilizada no mesmo período e regime × 100.']}),
        display('netProfit','Resultado',{kind:'subtotal',notes:['Resultado final da DRE, reproduzido para comparação. Não é uma parcela do total de impostos.']}),
        display('netMargin','% sobre a receita',{notes:['Resultado ÷ Receita Total utilizada no mesmo período e regime × 100.']})],
      note:'D = Débito; C = Crédito. Valores devidos são positivos; estornos são negativos. ICMS e CBS/IBS já estão líquidos dos créditos utilizados. Percentuais sobre a Receita Total utilizada no mesmo período e regime. O resultado é o mesmo da DRE.'};
    // Allocate each already-captured tax once; the separate taxes table is unchanged.
    const revenueTaxKeys=['das','icmsNet','cbsIbsNet','iss','difal'];
    const allocated=(f,key)=>key==='cbsIbsNet'?
      sum(['cbsDebit','ibsDebit','cbsUsed','ibsUsed'].map(part=>f.get(part))):f.get(key);
    const allocatedSum=(f,keys)=>sum(keys.map(key=>allocated(f,key)));
    const subtotalFrom=(key,label,parts,{expected=null,notes=[]}={})=>row(key,label,'subtotal',f=>{
      const value=sum(parts.map(part=>typeof part==='function'?part(f):allocated(f,part)));
      if(!finite(value))return missing('Faltam valores para conferir este subtotal no período.');
      if(expected!==null&&!close(value,f.get(expected)))return missing('O subtotal não concilia com a DRE salva.');
      return good(value);
    },{informative:true,notes,sourceRefs:['result.regimes[].dre']});
    const revenueTaxes=subtotalFrom('revenueTaxes','(=) Tributos sobre receitas',revenueTaxKeys);
    const netRevenueAfterTaxes=subtotalFrom('netRevenueAfterTaxes','= Receita líquida após tributos',['revenue',f=>allocatedSum(f,revenueTaxKeys)]);
    const costsWithAnticipation=subtotalFrom('costsWithAnticipation','= Compras / CMV e antecipação de ICMS',['cmv','icmsAnticipation']);
    const grossAfterCosts=subtotalFrom('grossAfterCosts','= Resultado após receitas, custos e tributos',
      [f=>allocatedSum(f,['revenue','cmv','icmsAnticipation',...revenueTaxKeys])]);
    const operatingExpensesWithPayroll=subtotalFrom('operatingExpensesWithPayroll','= Despesas e encargos da folha',
      ['salaries','benefits','administrative','rent','cards','payroll']);
    const resultBeforeIncomeTaxes=subtotalFrom('resultBeforeIncomeTaxes','= Resultado antes de IRPJ / CSLL',
      [f=>allocatedSum(f,['revenue','cmv','icmsAnticipation',...revenueTaxKeys,'salaries','benefits','administrative','rent','cards','payroll'])],
      {expected:'preTax',notes:['Base gerencial antes de IRPJ/CSLL; o imposto depende da base tributável trimestral.']});
    const allocationNote=['Crédito já utilizado para reduzir CBS/IBS líquido. Informação de conferência, não acrescentar novamente.'];
    statement={version:'DRE_STATEMENT_V1',taxRates,
      sections:[
        {key:'revenue',label:'Receitas e tributos sobre receitas',rows:[
          display('services','Receita de serviços'),display('sales','Receita de vendas utilizada'),display('revenue','Receita Total utilizada'),
          display('das','(−) Simples Nacional (DAS)'),display('icmsNet','(−) ICMS líquido (D − C)'),
          {...combinedTaxes,label:'(−) CBS/IBS líquido (D − C)'},display('iss','(−) ISS fora do DAS'),
          optionalTax('difal','(−) DIFAL sobre vendas',['Imposto sobre vendas quando aplicável.']),
          revenueTaxes,netRevenueAfterTaxes]},
        {key:'costs',label:'Compras e custos',rows:[
          display('cmvSimple'),display('cmvRegular'),display('cmv','Total de compras / CMV'),
          optionalTax('icmsAnticipation','(−) Antecipação de ICMS nas compras',['Imposto de entrada sobre compras elegíveis.']),
          display('cbsUsed','Crédito CBS utilizado · informativo',{kind:'detail',informative:true,notes:allocationNote}),
          display('ibsUsed','Crédito IBS utilizado · informativo',{kind:'detail',informative:true,notes:allocationNote}),
          costsWithAnticipation,grossAfterCosts]},
        {key:'expenses',label:'Despesas e encargos',rows:[
          display('salaries'),display('benefits'),display('administrative'),display('rent'),display('cards'),
          {...expensesWithoutPayroll,label:'Subtotal de despesas operacionais (sem INSS)'},
          display('payroll','(−) INSS / encargos da folha'),operatingExpensesWithPayroll]},
        {key:'profit',label:'IRPJ, CSLL e resultado',rows:[
          resultBeforeIncomeTaxes,display('irpj','(−) IRPJ normal e adicional'),display('csll','(−) CSLL'),
          taxesDeduction,display('netProfit','Resultado líquido'),display('netMargin','% sobre a receita · resultado')]}
      ],note:'Impostos distribuídos uma vez por natureza (receitas, compras, folha e resultado). A linha (−) Total de impostos apenas confere a soma já considerada; o quadro Impostos permanece completo.'};
  }
  return {version:DRE_PRESENTATION_VERSION,method:actual?'REPORT_MONTHS_V1':null,regimes,sections,details,indicators,revenueReconciliation,icmsReconciliation,irpjReconciliation,months,calendarYear,
    ...(statement?{statement,taxStatement}:{}),
    ...(analysisPeriod?{analysisPeriod,appliedCredits,commercialComposition,monthlyCommercialComposition}:{}),
    ...(regimeSelection?{regimeSelection}:{}),
    ...(['NOT_PROVIDED','NOT_REQUIRED','MANUAL','SIMPLES_SECTION_22','SIMPLES_PDF'].includes(capturedRbt12Source)?{rbt12Source:capturedRbt12Source}:{}),
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
