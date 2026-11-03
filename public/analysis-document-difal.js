import {DIFAL_VERSION,DIFAL_RATE_PERCENT,isDifalVersion} from './difal.js';
import {ANTICIPATION_VERSION,ANTICIPATION_RATE_PERCENT,isAnticipationVersion} from './icms-anticipation.js';
import {isAnalysisMonth,reportMonthsInPeriod} from './analysis-period.js';

function checkedPeriod(period,current) {
  try {
    const year=current?period?.sourceYear:Number(String(period?.startMonth||'').slice(0,4));
    if(!Number.isInteger(year)||year<2000||year>2099)return false;
    if(!current)return reportMonthsInPeriod(period).every(month=>isAnalysisMonth(month,year));
    const months=period?.includedMonths;
    return period?.version==='JAN_SEP_V1'&&period.complete===true&&Array.isArray(months)&&months.length>=1&&months.length<=9&&
      months.every((month,index)=>isAnalysisMonth(month,year)&&(!index||month>months[index-1]))&&
      (period.months===undefined||period.months===months.length)&&
      (period.startMonth===undefined||period.startMonth===months[0])&&
      (period.endMonth===undefined||period.endMonth===months.at(-1));
  }catch{return false;}
}

/** Display the server's checked estimate, without recalculating tax in the browser. */
export function documentDifalSummary({job,type,jobId,clientId,generationId,policy,regimeSelection,choice}) {
  if(!['PURCHASES','SALES'].includes(type)||!jobId||!clientId||!generationId||
     job?.status!=='COMPLETED'||job._id!==jobId||job.clientId!==clientId||job.generationId!==generationId||
     job.mode!==(type==='PURCHASES'?'PURCHASES_V1':'SALES_V1'))return null;
  const entry=type==='PURCHASES';

  const taxKey=entry?'anticipation':'difal',currentKey=entry?'currentAnticipation':'currentDifal';
  const current=Object.hasOwn(job,currentKey),expectedVersion=entry?ANTICIPATION_VERSION:DIFAL_VERSION;
  const summary=current?job[currentKey]:job.purchaseInput?.[taxKey];
  const version=current?expectedVersion:job[entry?'anticipationVersion':'difalVersion'];
  const period=current?job[currentKey+'Period']:job.reportPeriod;
  const singleYear=period?.sourceYear??Number(String(period?.startMonth||'').slice(0,4));
  const safePeriod=checkedPeriod(period,current);
  const knownVersion=entry?isAnticipationVersion:isDifalVersion;
  const label=entry?'DIFAL de entrada':'DIFAL de saída';
  const context=entry?'Antecipação de ICMS · estimativa do arquivo':`DIFAL de saída desativado · janeiro a setembro${safePeriod?' de '+singleYear:''}`;
  const unavailable=note=>({label,context,state:'unavailable',amountCents:null,note});
  if(job[currentKey+'State']==='loading')return {label,context,state:'reading',amountCents:null,
    note:'Conferindo as operações de janeiro a setembro. Aguarde a resposta do relatório.'};
  if(job[currentKey+'State']==='error')return {...unavailable(job[currentKey+'Error']?.message||'Não foi possível conferir a estimativa. Tente atualizar a leitura.'),
    error:job[currentKey+'Error']};
  if(!summary)return unavailable('O relatório ainda não tem uma estimativa confirmada. Atualize a leitura.');
  if(!safePeriod)return unavailable('Não foi possível confirmar as competências de janeiro a setembro. Confira o período do relatório.');
  if(summary.version!==expectedVersion||!knownVersion(summary.version)||(version!==undefined&&version!==summary.version))
    return unavailable('A estimativa deste relatório precisa ser conferida pela regra atual. Atualize a leitura.');
  if(
     !['amountCents','baseCents','eligibleLines','pendingLines'].every(key=>Number.isSafeInteger(summary[key])&&summary[key]>=0)||
     summary.ratePercent!==(entry?ANTICIPATION_RATE_PERCENT:DIFAL_RATE_PERCENT)||summary.amountCents>summary.baseCents||
     summary.eligibleLines===0&&(summary.baseCents>0||summary.amountCents>0))
    return unavailable('A estimativa retornou dados incompletos ou inconsistentes. Tente atualizar a leitura.');
  const totals={baseCents:summary.baseCents,eligibleLines:summary.eligibleLines,pendingLines:summary.pendingLines};
  if(!entry){
    if(['amountCents','baseCents','eligibleLines','pendingLines'].some(key=>summary[key]!==0))
      return unavailable('A estimativa de saída não corresponde à regra atual. Atualize a leitura.');
    return {label,context,...totals,state:'ready',amountCents:0,note:'Não aplicado pela regra desta análise. Isso não significa ausência de vendas interestaduais.'};
  }
  if(summary.pendingLines){
    const partial=summary.eligibleLines>0;
    return {label,context,...totals,state:partial?'partial':'pending',amountCents:partial?summary.amountCents:null,
      note:`${partial?'Valor parcial · ':''}${summary.pendingLines} ${summary.pendingLines===1?'linha com UF pendente':'linhas com UF pendente'}. Confira o relatório.`};
  }
  return {label,context,...totals,state:'ready',amountCents:summary.amountCents,
    note:summary.baseCents===0?'Sem operações elegíveis neste arquivo.':''};
}

const currentEstimates = new Map();
const usable=summary=>summary&&['ready','pending','partial'].includes(summary.state);
function estimateError(error) {
  const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:null;
  const code=/^[A-Z0-9_]{1,80}$/.test(error?.code||'')?error.code:null;
  const requestId=/^[a-f0-9-]{36}$/i.test(error?.requestId||'')?error.requestId:null;
  let message=typeof error?.message==='string'&&error.message.trim()?error.message:'Não foi possível conferir a estimativa. Tente atualizar a leitura.';
  if(requestId&&!message.includes(requestId))message+=' Código da requisição: '+requestId+'.';
  return {message,status,code,requestId,retryable:error?.retryable===true||status===null||status>=500||status===429};
}
function trimEstimates() {
  for(const [key,entry] of currentEstimates){
    if(currentEstimates.size<=100)break;
    if(entry.value)currentEstimates.delete(key);
  }
}
/** Fetch checked Jan–Sep estimates independently; failures never become confirmed zero. */
export async function loadDocumentDifal(generation,{clientId,request,onUpdate=()=>{},force=false,cacheScope=''}={}) {
  const companies=generation?.companies?.filter(company=>company.clientId===clientId);
  if(companies?.length!==1)return;
  const company=companies[0];
  await Promise.all([
    ['sales','salesJobId','SALES_V1','difal','difalVersion',DIFAL_VERSION,'currentDifal'],
    ['purchases','purchaseJobId','PURCHASES_V1','anticipation','anticipationVersion',ANTICIPATION_VERSION,'currentAnticipation']
  ].map(async ([slot,idKey,mode,taxKey,versionKey,currentVersion,currentKey])=>{
    const companySlot=slot==='purchases'?'purchase':slot,job=company[companySlot];
    if(!job||job._id!==company[idKey]||job.clientId!==clientId||job.generationId!==generation._id||
       job.mode!==mode||job.status!=='COMPLETED')return;
    const input={job,type:slot==='purchases'?'PURCHASES':'SALES',jobId:job._id,clientId,generationId:generation._id};
    const fingerprint=()=>JSON.stringify([cacheScope,job._id,job.completedAt,job[versionKey],currentVersion,
      clientId,generation._id,job.reportPeriod,job.purchaseInput?.[taxKey]]);
    const key=fingerprint();
    const sameSource=!Object.hasOwn(job,currentKey)||(job[currentKey+'Scope']===cacheScope&&job[currentKey+'RequestKey']===key);
    if(!force&&sameSource&&usable(documentDifalSummary(input)))return;
    let cached=currentEstimates.get(key);
    if(force&&cached?.value){currentEstimates.delete(key);cached=null;}
    if(!cached){
      cached={promise:null,value:null};const entry=cached;
      cached.promise=Promise.resolve().then(()=>request('/api/v4/'+slot+'/'+encodeURIComponent(job._id)+'/difal-period')).then(result=>{
        if(result?.jobId!==job._id||result.clientId!==clientId||result.generationId!==generation._id)
          throw Object.assign(new Error('A resposta não corresponde ao relatório desta empresa. Atualize a leitura.'),{code:'DIFAL_SUMMARY_IDENTITY'});
        const checked=documentDifalSummary({...input,job:{...job,[currentKey]:result[taxKey],[currentKey+'Period']:result.period,[currentKey+'State']:'ready'}});
        if(!usable(checked))throw Object.assign(new Error(checked?.note||'Não foi possível confirmar a estimativa retornada. Atualize a leitura.'),{code:'DIFAL_SUMMARY_INVALID'});
        entry.value=structuredClone(result);trimEstimates();return entry.value;
      }).catch(error=>{if(currentEstimates.get(key)===entry)currentEstimates.delete(key);throw error;});
      currentEstimates.set(key,cached);
    }
    job[currentKey+'RequestKey']=key;
    if(!cached.value){Object.assign(job,{[currentKey+'State']:'loading',[currentKey+'Error']:null});onUpdate();}
    try {
      const result=cached.value||await cached.promise;
      if(company[idKey]!==job._id||company[companySlot]!==job||fingerprint()!==key||job[currentKey+'RequestKey']!==key)return;
      Object.assign(job,{[currentKey]:structuredClone(result[taxKey]),[currentKey+'Period']:structuredClone(result.period),[currentKey+'State']:'ready',[currentKey+'Error']:null,[currentKey+'Scope']:cacheScope});
    }catch(error){
      if(company[idKey]!==job._id||company[companySlot]!==job||fingerprint()!==key||job[currentKey+'RequestKey']!==key)return;
      Object.assign(job,{[currentKey]:null,[currentKey+'Period']:null,[currentKey+'State']:'error',[currentKey+'Error']:estimateError(error)});
    }
    onUpdate();
  }));
}
