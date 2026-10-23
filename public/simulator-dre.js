import {dreRows, MONTH_NAMES} from './simulator-calendar.js';

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
  return rows;
}

export function buildDrePresentation({result,monthlyGroups,projection,source,reportMonths,engineInput,reprocessing,calendar}={}) {
  const originals = Array.isArray(result?.regimes) ? result.regimes : [];
  const hasCalendar = calendar != null;
  const validCalendar = ['DRE_CALENDAR_V1','DRE_CALENDAR_V2','DRE_CALENDAR_V3'].includes(calendar?.version) && Array.isArray(calendar.months) && calendar.months.length===12;
  const calendarYear = calendar?.year ?? engineInput?.year ?? null;
  const months = validCalendar ? calendar.months.map(month=>({...month})) : MONTH_NAMES.map((label,index)=>({number:index+1,label,period:calendarYear?`${calendarYear}-${String(index+1).padStart(2,'0')}`:null}));
  const actual=result?.method==='REPORT_MONTHS_V1';
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
      !!monthlyRegime&&monthlyRegime.available===true&&(!hasCalendar||(validCalendar&&calendar.version==='DRE_CALENDAR_V3'&&!!saved&&calendar.months[index]?.sourceMonth===monthlyEntry.sourceMonth)):
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
  const regimes = originals.map(r=>({id:r.id,name:r.name,available:r.available===true,
    ...(capturedDifalVersion(r.difalApplication)?{difalApplication:structuredClone(r.difalApplication)}:{}),
    ...(actual?{monthlyAvailability:months.map((_,index)=>frame(r,'month',index).available)}:{})}));
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
  const baseRows=dreRows(result),labels=new Map(baseRows);
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
      const baseline=f.monthlyEntry?source.monthlyReports.find(row=>row.sourceMonth===f.monthlyEntry.sourceMonth)?.fields.serviceRevenueCents/100:sum(source.monthlyReports.map(row=>row.fields.serviceRevenueCents))/100;
      return finite(baseline)&&finite(f.get('services'))?good(adjustment?f.get('services')-baseline:baseline):missing();
    }
    const annual=f.regime.dre?.services;
    if(!finite(serviceBaseline)||!finite(annual)||!close(annual*f.scale,f.get('services')))return missing('A base de serviços não está disponível ou não concilia com o cenário salvo.');
    return good((adjustment?annual-serviceBaseline:serviceBaseline)*f.scale);
  };
  const outsideMemory=unique(result?.memory,'id','outside');
  const outsideText=outsideMemory?.unit==='text'&&['Sim','Não'].includes(outsideMemory.value)?outsideMemory.value==='Sim':null;
  const outsideInput=typeof engineInput?.icmsOutside==='boolean'?engineInput.icmsOutside:null;
  const outside=outsideInput!==null&&outsideText!==null&&outsideInput!==outsideText?null:outsideInput??outsideText;
  function creditCell(tax,field){return f=>{
    const id=f.regime.id;
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
    rows:[['debit','Débito'],['potential','Crédito potencial'],['used','Crédito utilizado'],['due','Valor líquido a recolher'],['balance','Saldo credor potencial']].map(([field,label])=>detail(tax+'.'+field,label+' de '+tax.toUpperCase(),tax==='icms'?'icmsNet':tax+'Debit',creditCell(tax,field),{
      notes:[field==='balance'?'Saldo informativo: não compõe o lucro nem representa restituição automática.':tax==='icms'?'Crédito já abatido do ICMS líquido; não somar novamente ao resultado.':'Detalhe da apuração já refletida nas linhas de débitos e créditos da DRE.'],sourceRefs:[`result.credits.${tax}.${field}`]}))}));
  const irpjDetail=part=>f=>{
    const id=f.regime.id;
    if(['pure','hybrid'].includes(id))return missing('IRPJ incluído no DAS; sem parcela externa neste regime.');
    if(!['presumed','actual'].includes(id))return missing();
    const basic=memory(id+'.irBasic',f),additional=memory(id+'.irAdditional',f),total=memory(id+'.irTotal',f);
    return close(sum([basic,additional]),total)&&close(-total,f.regime.dre?.irpj)&&close(-total*f.scale,f.get('irpj'))?
      good(-(part==='basic'?basic:additional)*f.scale):missing('A memória do IRPJ não está disponível ou não concilia com o total salvo.');
  };
  const details=[
    {key:'salesBreakdown',label:'Composição da receita de vendas',parentKey:'sales',rows:GROUPS.map((key,index)=>detail(key,['Vendas a optantes do Simples','Vendas a não optantes do Simples','Vendas a CPFs'][index],'sales',salesDetail(index),{notes:['Componentes das vendas do cenário; valores líquidos podem incluir devoluções.'],sourceRefs:[`monthlyGroups.${key}`]}))},
    {key:'serviceBreakdown',label:'Composição da receita de serviços',parentKey:'services',rows:[detail('serviceReport',actual?'Serviços dos relatórios · por competência':'Serviços dos relatórios · média projetada','services',servicesDetail(false),{sourceRefs:['projection.monthlyGroupsCents.serviceRevenueCents']}),detail('serviceAdjustment','Ajuste de serviços no cenário','services',servicesDetail(true),{notes:[reprocessing?.serviceRevenueMigration?.warning||'Diferença entre os serviços do cenário e a base importada; pode ser positiva, negativa ou zero.'],sourceRefs:['result.regimes[].dre.services','projection.monthlyGroupsCents.serviceRevenueCents']})]},
    ...creditDetails,
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
    if(!finite(revenue)||revenue<=0)return missing('Percentual não aplicável sem receita bruta positiva.');
    const amount=typeof numerator==='function'?numerator(f):currency(f.get(numerator));
    if(amount.value===null)return amount;
    const value=amount.value*(negative?-1:1)/revenue;
    if(stored&&f.kind==='annual')return close(f.regime[stored],value)?good(f.regime[stored]):missing('O indicador não está disponível ou não concilia com o resultado salvo.');
    return good(value);
  };
  const indicator=(key,label,compute,options={})=>row(key,label,'indicator',compute,{unit:'percent',informative:true,notes:['Percentual sobre a receita bruta total do cenário.'],...options});
  const indicators=[
    indicator('grossMargin','Margem bruta sobre receita total',ratio('grossProfit')),
    indicator('preTaxMargin','Margem antes de IRPJ/CSLL sobre receita total',ratio('preTax')),
    indicator('netMargin','Margem líquida',ratio('netProfit',{stored:'margin'})),
    indicator('taxBurden','Tributos e encargos sobre receita',ratio(taxes,{stored:'taxBurden'})),
    indicator('cmvBurden','Compras/CMV sobre receita',ratio('cmv',{negative:true})),
    indicator('operatingExpenseBurden','Despesas operacionais sobre receita',ratio(reconciledSum(['personnel','administrative','rent','cards'],'preTax','grossProfit'),{negative:true})),
    indicator('totalTaxes','Tributos e encargos totais',taxes,{unit:'currency',notes:['Inclui encargos sobre a folha. Créditos utilizados já foram abatidos; não deduzir novamente.']})
  ];
  return {version:DRE_PRESENTATION_VERSION,method:actual?'REPORT_MONTHS_V1':null,regimes,sections,details,indicators,months,calendarYear,
    ...(capturedDifalVersion(result?.difalPolicy)?{difalPolicy:structuredClone(result.difalPolicy)}:{}),
    ...(calendar?.rbt12Schedule?{rbt12Schedule:structuredClone(calendar.rbt12Schedule)}:{}),
    calendarReference:calendar?.rbt12Reference??null,calendarRounding:calendar?.rounding??'Valores completos preservados; exibição com duas casas decimais.',
    percentBasis:'Receita bruta total do cenário'};
}
