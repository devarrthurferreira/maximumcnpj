import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {collection,scope,audit} from './store.ts';
import type {Doc} from './store.ts';
import {AppError,need,digest,escapeRegex,text,integer} from './security.ts';
import {write,withJob} from './lookup-db.ts';
import type {LookupActor} from './lookup-db.ts';
import {createGeneration,getGeneration,withGeneration} from './generation-store.ts';
import {generationSimulator} from './simulator-store.ts';
import {createAnalysisSimulation,createSimulation,getSimulation,validateSimulationRequest} from './simulation-history.ts';
import {readRbt12Reference,rbt12InputSource} from './simulation-extrato.ts';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {baselineMonth,MONTHLY_MODEL_VERSION} from '../public/simulator-monthly.js';
import {resolveRegimeSelection,requiresSimplesReference} from '../public/regime-selection.js';
import {upgradeDifalPolicy} from '../public/simulator-engine.js';
import {ANALYSIS_VERSION,ANALYSIS_GROUPS,ACCOUNTING_FIELDS,analysisObject,analysisId,analysisRevision,
  analysisYear,analysisSelection,defaultFiscalData,effectiveAnalysisDifalPolicy,parseFiscalData,parseAccountingData} from './analysis-contract.ts';
import type {AnalysisConfig,AccountingData,FiscalData,AnalysisIssue} from './analysis-contract.ts';

type Author={id:string;name:string};
type Sector<T>={revision:number;status:'DRAFT'|'COMPLETE';data:T;completedAt:Date|null;updatedAt:Date;updatedBy:Author;
  confirmation?:{fingerprint:string;generationId:string;purchaseJobId:string;salesJobId:string;extractionId:string|null;months:string[];configRevision:number}|null};
type Current={id:string;analysisRevision:number|null;createdAt:Date;modelVersion:string|null;legacy:boolean};
type Analysis=Doc & {clientId:string;company:{name:string;code:string|null;cnpj?:string|null};version:string;activated:boolean;revision:number;
  config:AnalysisConfig;fiscal:Sector<FiscalData>;accounting:Sector<AccountingData>;currentSimulation:Current|null;
  legacy:boolean;legacyReference?:{simulationId:string;monthlyInputsPreserved:boolean};createdAt:Date;createdBy:Author;updatedAt:Date;
  leaseOwner?:string;leaseUntil?:Date;lastGeneration?:{requestId:string;revision:number;simulationId:string}};
type Source=Awaited<ReturnType<typeof generationSimulator>>;
const PAGE_SIZE=20;
const author=(actor:LookupActor):Author=>({id:actor._id,name:actor.name});
const conflict=()=>new AppError(409,'ANALYSIS_CONFLICT','A análise mudou ou está sendo gerada. Reabra os dados antes de salvar para preservar o trabalho de todos.');
const leaseFree=()=>({$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]});

async function analyses(){
  const c=await collection('analyses');
  await c.createIndex({workspaceId:1,clientId:1},{unique:true});
  await c.createIndex({workspaceId:1,updatedAt:-1,_id:-1});
  return c;
}
async function record(id:string):Promise<Analysis>{
  const value=await(await analyses()).findOne(scope({_id:analysisId(id)}));
  need(value,'Análise não encontrada.',404,'NOT_FOUND');return value as Analysis;
}
function ordered(value:any):any {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(ordered);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])]));
  return value;
}
function fingerprint(source:Source,reference:unknown,config:AnalysisConfig,data:FiscalData){
  return digest(JSON.stringify(ordered({generationId:source.generationId,clientId:source.clientId,purchases:source.purchases,sales:source.sales,
    monthlyReports:source.monthlyReports,fields:source.fields,period:source.period,operationVersion:source.operationVersion,
    reference,year:config.year,regimeSelection:config.regimeSelection,salesAnnex:data.salesAnnex,serviceAnnex:data.serviceAnnex,
    difalPolicy:data.difalPolicy,icmsOutside:data.icmsOutside,monthlyOverrides:data.monthlyOverrides})));
}
async function fiscalSource(item:Analysis,data=item.fiscal.data){
  need(data.generationId,'Importe as entradas e saídas da empresa.',422,'ANALYSIS_FISCAL_INCOMPLETE');
  const source=await generationSimulator(data.generationId,item.clientId);
  const months=source.monthlyReports?.map(row=>row.sourceMonth)||[];
  need(months.length>=1 && months.length<=12,'Os relatórios precisam conservar de 1 a 12 competências da coluna H.',422,'ANALYSIS_MONTHS');
  let reference:unknown=null;
  if(requiresSimplesReference(item.config.regimeSelection)){
    const kind=rbt12InputSource(data.rbt12Source,data.rbt12Source==='MANUAL'?data.rbt12ManualConfirmed:undefined,data.rbt12ExtractionId,data.rbt12??undefined,item.config.regimeSelection);
    if(kind==='MANUAL') reference={source:'MANUAL',rbt12Cents:Math.round(data.rbt12!*100)};
    else{
      reference=await readRbt12Reference(data.rbt12ExtractionId,item.clientId,data.rbt12??undefined);
      const schedule=buildRbt12Schedule(reference as any,months);
      need(schedule.complete,`O extrato não cobre todas as competências: ${schedule.rows.filter(row=>row.status!=='CONFIRMED').map(row=>row.sourceMonth).join(', ')}.`,422,'RBT12_MONTHS_MISSING');
    }
  } else rbt12InputSource(data.rbt12Source,undefined,data.rbt12ExtractionId,data.rbt12??undefined,item.config.regimeSelection);
  if(data.rbt12DocumentId){
    const document=await(await collection('simplesDocuments')).findOne(scope({_id:data.rbt12DocumentId,clientId:item.clientId}));
    need(document,'O arquivo do extrato não pertence a esta empresa.',409,'RBT12_COMPANY');
    need(data.rbt12Source==='SIMPLES_SECTION_22' && document.extractionId===data.rbt12ExtractionId && document.status==='READY',
      'O extrato foi alterado ou sua leitura não está concluída. Confira a referência antes de concluir o Fiscal.',409,'RBT12_EXTRACTION');
    need(!document.fileSha256 || document.fileSha256===(reference as any)?.fileSha256,
      'A leitura não corresponde ao arquivo atual do extrato.',409,'RBT12_EXTRACTION');
  }
  if(data.monthlyOverrides)need(isDeepStrictEqual(data.monthlyOverrides.map(row=>row.sourceMonth),months),
    'Os ajustes fiscais devem corresponder exatamente às competências dos relatórios. Revise os ajustes antes de concluir.',422,'ANALYSIS_MONTHS');
  return {source,months,reference,fingerprint:fingerprint(source,reference,item.config,data)};
}
async function readiness(item:Analysis){
  const issues:AnalysisIssue[]=[];let checked:Awaited<ReturnType<typeof fiscalSource>>|null=null;
  if(item.fiscal.status!=='COMPLETE')issues.push({code:'FISCAL_NOT_CONFIRMED',sector:'fiscal',message:'Salve e conclua o setor Fiscal.'});
  try{checked=await fiscalSource(item);}
  catch(error){if(!(error instanceof AppError))throw error;issues.push({code:error.code,sector:'fiscal',message:error.message});}
  if(checked && item.fiscal.status==='COMPLETE' && (item.fiscal.confirmation?.fingerprint!==checked.fingerprint || item.fiscal.confirmation.configRevision!==item.config.revision)){
    issues.push({code:'FISCAL_SOURCE_CHANGED',sector:'fiscal',message:'Os arquivos ou as opções fiscais mudaram após a confirmação. Confira e conclua o Fiscal novamente.'});
  }
  if(item.accounting.status!=='COMPLETE')issues.push({code:'ACCOUNTING_NOT_CONFIRMED',sector:'accounting',message:'Salve e conclua as despesas do setor Contábil.'});
  if(!item.accounting.data.months.length || item.accounting.data.months.some(row=>ACCOUNTING_FIELDS.some(key=>row[key]===null))){
    issues.push({code:'ACCOUNTING_VALUES_MISSING',sector:'accounting',message:'Preencha cada despesa ou confirme zero em todas as competências.'});
  }
  if(checked && !isDeepStrictEqual(item.accounting.data.months.map(row=>row.sourceMonth),checked.months)){
    issues.push({code:'ACCOUNTING_MONTHS_MISMATCH',sector:'accounting',message:`As despesas devem cobrir exatamente as competências dos relatórios: ${checked.months.join(', ')}.`});
  }
  return {ready:issues.length===0,issues,months:checked?.months||[],checked};
}
async function visible(item:Analysis){
  const {checked,...ready}=await readiness(item);
  const {workspaceId:_workspace,_id:id,leaseOwner:_owner,leaseUntil:_until,activated:_activated,lastGeneration:_last,...rest}=item;
  const current=item.currentSimulation;
  return {...rest,id,readiness:ready,currentSimulation:current?{...current,stale:current.legacy || current.analysisRevision!==item.revision ||
    !checked || checked.fingerprint!==item.fiscal.confirmation?.fingerprint}:null};
}
function sector<T>(data:T,actor:LookupActor,now:Date):Sector<T>{return {revision:0,status:'DRAFT',data,completedAt:null,updatedAt:now,updatedBy:author(actor),confirmation:null};}
function currentOf(snapshot:any,revision:number|null,legacy:boolean):Current{
  return {id:snapshot._id,analysisRevision:revision,createdAt:snapshot.createdAt,modelVersion:snapshot.modelVersion||null,legacy};
}
/** Only explicit open/legacy writes adopt old data. Reads never migrate snapshots. */
function seedLegacy(item:Analysis,snapshot:any,actor:LookupActor){
  const now=new Date(),selection=resolveRegimeSelection(snapshot.draft?.regimeSelection);
  const fiscalRevision=item.fiscal.revision+1,accountingRevision=item.accounting.revision+1;
  // A visible bridge can already be open in another tab. Never reuse its CAS tokens when adopting another version.
  item.config={revision:item.config.revision+1,year:analysisYear(snapshot.draft?.year||item.config.year),regimeSelection:selection};
  const data=defaultFiscalData(selection);
  Object.assign(data,{generationId:snapshot.generationId,salesAnnex:snapshot.draft?.salesAnnex||1,serviceAnnex:snapshot.draft?.serviceAnnex||3,
    difalPolicy:upgradeDifalPolicy(snapshot.draft?.difalPolicy??snapshot.source?.difalPolicy),icmsOutside:snapshot.draft?.icmsOutside===true});
  if(requiresSimplesReference(selection)) Object.assign(data,{rbt12Source:snapshot.rbt12Source==='MANUAL'?'MANUAL':'SIMPLES_SECTION_22',
    rbt12ExtractionId:snapshot.rbt12Extraction?.id||null,rbt12:snapshot.draft?.rbt12??null,rbt12ManualConfirmed:snapshot.rbt12Manual?.confirmed===true});
  const inputs=Array.isArray(snapshot.monthlyInputs)?snapshot.monthlyInputs:[];
  const accounting:AccountingData={months:inputs.map((row:any)=>({sourceMonth:row.sourceMonth,
    salariesCents:Math.round(row.values.salaries*100),rentCents:Math.round(row.values.rent*100),cardExpensesCents:Math.round(row.values.cardExpenses*100),
    benefitsCents:Math.round(row.values.benefits*100),adminExpensesCents:Math.round(row.values.adminExpenses*100)}))};
  if(inputs.length)data.monthlyOverrides=inputs.map((row:any)=>({sourceMonth:row.sourceMonth,groups:structuredClone(row.groups),serviceRevenue:row.values.serviceRevenue}));
  item.fiscal={...sector(parseFiscalData(data,selection),actor,now),revision:fiscalRevision};
  item.accounting={...sector(parseAccountingData(accounting),actor,now),revision:accountingRevision};
  item.currentSimulation=currentOf(snapshot,null,true);item.legacy=true;
  item.legacyReference={simulationId:snapshot._id,monthlyInputsPreserved:inputs.length>0};
}
async function ensureAnalysis(actor:LookupActor,clientId:string,year:2027|2028,selection:AnalysisConfig['regimeSelection'],activate:boolean){
  const c=await analyses();let existing=await c.findOne(scope({clientId}));
  if(existing)return {item:existing as Analysis,created:false};
  const client=await(await collection('clients')).findOne(scope({_id:clientId,active:true}));
  need(client,'Empresa ativa não encontrada.',404,'NOT_FOUND');
  const now=new Date(),item:Analysis={_id:randomUUID(),...scope(),version:ANALYSIS_VERSION,clientId,company:{name:client.name,code:client.code||null,cnpj:client.cnpj||null},
    activated:activate,revision:0,config:{revision:0,year,regimeSelection:selection},fiscal:sector(defaultFiscalData(selection),actor,now),
    accounting:sector({months:[]},actor,now),currentSimulation:null,legacy:false,createdAt:now,createdBy:author(actor),updatedAt:now};
  const latest=await(await collection('simulations')).find(scope({clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})).sort({createdAt:-1,_id:-1}).limit(1).next();
  if(latest)seedLegacy(item,latest,actor);
  try{await c.insertOne(item);await audit(actor._id,'analysis.open',item._id);return {item,created:true};}
  catch(error:any){if(error.code!==11000)throw error;existing=await c.findOne(scope({clientId}));need(existing,'Não foi possível abrir a análise.',409,'ANALYSIS_CONFLICT');return {item:existing as Analysis,created:false};}
}
async function withAnalysis<T>(id:string,action:(item:Analysis,owner:string)=>Promise<T>,expected?:number):Promise<T>{
  const c=await analyses(),owner=randomUUID(),now=new Date();
  const item=await c.findOneAndUpdate(scope({_id:analysisId(id),...(expected===undefined?{}:{revision:expected}),...leaseFree()}),
    {$set:{leaseOwner:owner,leaseUntil:new Date(now.getTime()+120_000)}},{returnDocument:'after'});
  if(!item){await record(id);throw conflict();}
  try{return await action(item as Analysis,owner);}finally{await c.updateOne(scope({_id:id,leaseOwner:owner}),{$unset:{leaseOwner:'',leaseUntil:''}});}
}
async function revisionAudit(item:Analysis,actor:LookupActor,kind:'config'|'fiscal'|'accounting'|'import'){
  const c=await collection('analysisRevisions');await c.createIndex({workspaceId:1,analysisId:1,revision:1},{unique:true});
  const data=kind==='config'?item.config:kind==='accounting'?item.accounting:item.fiscal;
  await c.updateOne(scope({_id:digest(`${item._id}:${item.revision}`)}),{$setOnInsert:{...scope(),analysisId:item._id,clientId:item.clientId,revision:item.revision,
    kind,data,createdAt:item.updatedAt,createdBy:author(actor)}},{upsert:true});
  await audit(actor._id,`analysis.${kind}`,item._id);
}
export async function openAnalysis(actor:LookupActor,input:unknown){
  write(actor);analysisObject(input,['clientId','year','regimeSelection']);
  const {item,created}=await ensureAnalysis(actor,analysisId(input.clientId),analysisYear(input.year),analysisSelection(input.regimeSelection),true);
  if(!item.activated){
    await withAnalysis(item._id,async(current,owner)=>{
      const latest=await(await collection('simulations')).find(scope({clientId:item.clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})).sort({createdAt:-1,_id:-1}).limit(1).next();
      const reseeded=!!latest && latest._id!==current.currentSimulation?.id;
      if(reseeded)seedLegacy(current,latest,actor);
      await(await analyses()).updateOne(scope({_id:item._id,leaseOwner:owner,leaseUntil:{$gt:new Date()}}),{$set:{activated:true,config:current.config,
        fiscal:current.fiscal,accounting:current.accounting,currentSimulation:current.currentSimulation,legacy:current.legacy,
        ...(current.legacyReference?{legacyReference:current.legacyReference}:{}),updatedAt:new Date()},...(reseeded?{$inc:{revision:1}}:{})});
    });
  }
  return {analysis:await visible(await record(item._id)),created};
}
export async function getAnalysis(id:string){return {analysis:await visible(await record(id))};}
export async function analysisHistory(page:number,filters:{clientId?:string;search?:string}={}){
  page=integer(page,1,100000);const q:any=scope();if(filters.clientId)q.clientId=analysisId(filters.clientId);
  if(filters.search?.trim()){const term=escapeRegex(text(filters.search,100));q.$or=['company.name','company.code','company.cnpj'].map(key=>({[key]:{$regex:term,$options:'i'}}));}
  const c=await analyses();const [rows,total]=await Promise.all([c.find(q).sort({updatedAt:-1,_id:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).toArray(),c.countDocuments(q)]);
  const items=[];for(const row of rows)items.push(await visible(row as Analysis));
  return {items,pagination:{page,pageSize:PAGE_SIZE,total,totalPages:Math.ceil(total/PAGE_SIZE)}};
}
export async function updateAnalysisConfig(actor:LookupActor,id:string,input:unknown){
  write(actor);analysisObject(input,['expectedConfigRevision','year','regimeSelection']);
  const expected=analysisRevision(input.expectedConfigRevision),year=analysisYear(input.year),selection=analysisSelection(input.regimeSelection),prior=await record(id);
  const data=structuredClone(prior.fiscal.data),needs=requiresSimplesReference(selection);
  if(!needs)Object.assign(data,{rbt12Source:'NOT_REQUIRED',rbt12:null,rbt12ExtractionId:null,rbt12DocumentId:null,rbt12ManualConfirmed:false});
  else if(data.rbt12Source==='NOT_REQUIRED')data.rbt12Source='SIMPLES_SECTION_22';
  const now=new Date();
  const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,'config.revision':expected,'fiscal.revision':prior.fiscal.revision,...leaseFree()}),
    {$set:{activated:true,config:{revision:expected+1,year,regimeSelection:selection},'fiscal.data':data,'fiscal.status':'DRAFT','fiscal.completedAt':null,
      'fiscal.confirmation':null,'fiscal.updatedAt':now,'fiscal.updatedBy':author(actor),updatedAt:now},$inc:{revision:1,'fiscal.revision':1}},{returnDocument:'after'});
  if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,'config');return {analysis:await visible(updated as Analysis)};
}
export async function updateAnalysisSector(actor:LookupActor,id:string,kind:'fiscal'|'accounting',input:unknown){
  write(actor);analysisObject(input,['expectedSectorRevision','expectedConfigRevision','complete','data']);
  const expected=analysisRevision(input.expectedSectorRevision),configRevision=analysisRevision(input.expectedConfigRevision);
  need(typeof input.complete==='boolean','Informe se deseja concluir o setor.');
  const prior=await record(id);need(prior.config.revision===configRevision && prior[kind].revision===expected,conflict().message,409,'ANALYSIS_CONFLICT');
  const data=kind==='fiscal'?parseFiscalData(input.data,prior.config.regimeSelection):parseAccountingData(input.data,input.complete);
  let confirmation:Sector<FiscalData>['confirmation']=null;
  if(kind==='fiscal'){
    const fiscal=data as FiscalData;
    if(fiscal.generationId){const generation=await getGeneration(fiscal.generationId);need(generation.companies.some((company:any)=>company.clientId===prior.clientId),'A geração não pertence à empresa da análise.',409,'GENERATION_CLIENT');}
    if(fiscal.generationId!==prior.fiscal.data.generationId)need(fiscal.monthlyOverrides===null,'Ao trocar os arquivos, revise os ajustes fiscais anteriores.',409,'ANALYSIS_SOURCE_CHANGED');
    if(input.complete){const checked=await fiscalSource(prior,fiscal);confirmation={fingerprint:checked.fingerprint,generationId:fiscal.generationId!,purchaseJobId:checked.source.purchases.jobId,
      salesJobId:checked.source.sales.jobId,extractionId:fiscal.rbt12ExtractionId,months:checked.months,configRevision};}
  }
  const now=new Date();const value={revision:expected+1,status:input.complete?'COMPLETE':'DRAFT',data,completedAt:input.complete?now:null,updatedAt:now,updatedBy:author(actor),confirmation};
  const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,'config.revision':configRevision,[`${kind}.revision`]:expected,...leaseFree()}),
    {$set:{activated:true,[kind]:value,updatedAt:now},$inc:{revision:1}},{returnDocument:'after'});
  if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,kind);return {analysis:await visible(updated as Analysis)};
}
export async function importAnalysisGeneration(actor:LookupActor,id:string,input:unknown){
  write(actor);analysisObject(input,['expectedSectorRevision','expectedConfigRevision']);
  const expected=analysisRevision(input.expectedSectorRevision),configRevision=analysisRevision(input.expectedConfigRevision);
  return withAnalysis(id,async(item,owner)=>{
    need(item.fiscal.revision===expected && item.config.revision===configRevision,conflict().message,409,'ANALYSIS_CONFLICT');
    const generationId=deterministicId(`import:${item._id}:${expected}:${configRevision}`);
    const effectivePolicy=effectiveAnalysisDifalPolicy(item.fiscal.data.difalPolicy,item.config.regimeSelection);
    await createGeneration(actor,{generationId,clientIds:[item.clientId],requiredReports:['PURCHASES','SALES'],companyDifalPolicies:[{clientId:item.clientId,difalPolicy:effectivePolicy}]});
    const now=new Date(),data={...item.fiscal.data,generationId,monthlyOverrides:null};
    const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,leaseOwner:owner,leaseUntil:{$gt:new Date()},'fiscal.revision':expected,'config.revision':configRevision}),
      {$set:{activated:true,fiscal:{...item.fiscal,revision:expected+1,status:'DRAFT',data,confirmation:null,completedAt:null,updatedAt:now,updatedBy:author(actor)},updatedAt:now},$inc:{revision:1}},{returnDocument:'after'});
    if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,'import');return {analysis:await visible(updated as Analysis),generationId};
  });
}
function deterministicId(key:string){const hex=digest(`${scope().workspaceId}:${key}`);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
function calculationInput(item:Analysis,source:Source,simulationId:string){
  const f=item.fiscal.data,expenses=new Map(item.accounting.data.months.map(row=>[row.sourceMonth,row]));
  const overrides=new Map((f.monthlyOverrides||[]).map(row=>[row.sourceMonth,row]));
  const monthlyInputs=source.monthlyReports!.map(row=>{
    const expense=expenses.get(row.sourceMonth)!,entry=baselineMonth(row);const override=overrides.get(row.sourceMonth);
    if(override){entry.groups=structuredClone(override.groups);entry.values.serviceRevenue=override.serviceRevenue;}
    Object.assign(entry.values,{salaries:expense.salariesCents!/100,rent:expense.rentCents!/100,cardExpenses:expense.cardExpensesCents!/100,
      benefits:expense.benefitsCents!/100,adminExpenses:expense.adminExpensesCents!/100});return entry;
  });
  const first=monthlyInputs[0],draft={year:item.config.year,salesAnnex:f.salesAnnex,serviceAnnex:f.serviceAnnex,regimeSelection:item.config.regimeSelection,
    ...(requiresSimplesReference(item.config.regimeSelection)?{rbt12:f.rbt12!}:{}),difalPolicy:f.difalPolicy,icmsOutside:f.icmsOutside,
    values:{...first.values,salesRevenue:ANALYSIS_GROUPS.slice(0,3).reduce((sum,key)=>sum+Math.round(first.groups[key]*100),0)/100,
      simplePurchases:first.groups.purchasesOptantCents,regularPurchases:first.groups.purchasesNonOptantCents}};
  return {simulationId,generationId:f.generationId,clientId:item.clientId,reportMonths:monthlyInputs.length,periodConfirmed:true,monthlyInputs,
    monthlyGroups:first.groups,draft,parentSimulationId:item.currentSimulation?.id||null,
    ...(f.rbt12Source==='MANUAL'?{rbt12Source:'MANUAL',rbt12ManualConfirmed:true}:f.rbt12Source==='NOT_REQUIRED'?{rbt12Source:'NOT_REQUIRED'}:{rbt12ExtractionId:f.rbt12ExtractionId})};
}
export async function generateAnalysis(actor:LookupActor,id:string,input:unknown){
  write(actor);analysisObject(input,['requestId','expectedRevision']);const requestId=analysisId(input.requestId),expected=analysisRevision(input.expectedRevision);
  const initial=await record(id);
  const requests=await collection('analysisGenerationRequests'),requestKey=digest(`${scope().workspaceId}:${id}:${requestId}`);
  const priorRequest=await requests.findOne(scope({_id:requestKey,analysisId:id}));
  if(priorRequest){need(priorRequest.revision===expected,'Este identificador pertence a outra revisão.',409,'ANALYSIS_CONFLICT');
    return {analysis:await visible(initial),simulation:await getSimulation(priorRequest.simulationId),reused:true};}
  if(initial.lastGeneration?.requestId===requestId){
    need(initial.lastGeneration.revision===expected,'Este identificador pertence a outra revisão.',409,'ANALYSIS_CONFLICT');
    await(await collection('simulations')).updateOne(scope({_id:initial.lastGeneration.simulationId,analysisId:id}),{$set:{analysisPublication:'PUBLISHED'}});
    return {analysis:await visible(initial),simulation:await getSimulation(initial.lastGeneration.simulationId),reused:true};
  }
  return withAnalysis(id,async(item,owner)=>{
    const prepared=await readiness(item);need(prepared.ready,prepared.issues.map(issue=>issue.message).join(' '),422,'ANALYSIS_NOT_READY');
    const source=prepared.checked!.source,sourceFingerprint=prepared.checked!.fingerprint;
    const simulationId=deterministicId(`generate:${item._id}:${item.revision}:${MONTHLY_MODEL_VERSION}`);
    if(item.currentSimulation?.id===simulationId){
      await requests.updateOne(scope({_id:requestKey}),{$setOnInsert:{...scope(),analysisId:id,requestId,revision:expected,simulationId,createdAt:new Date(),createdBy:author(actor)}},{upsert:true});
      return {analysis:await visible(item),simulation:await getSimulation(simulationId),reused:true};
    }
    const sources=[source.purchases.jobId,source.sales.jobId].sort();
    return withGeneration(source.generationId,async(_generation,generationOwner)=>withJob(sources[0],async(first)=>withJob(sources[1],async(second)=>{
      const unchanged=async()=>{
        const current=await(await analyses()).findOne(scope({_id:id,revision:expected,leaseOwner:owner,leaseUntil:{$gt:new Date()}}));if(!current)throw conflict();
        const locked=await(await collection('lookupJobs')).countDocuments(scope({$or:[{_id:first._id,leaseOwner:first.leaseOwner},{_id:second._id,leaseOwner:second.leaseOwner}],leaseUntil:{$gt:new Date()}}));
        need(locked===2,'Os arquivos estão sendo atualizados. Confira os dados e gere novamente.',409,'ANALYSIS_SOURCE_CHANGED');
        need(await(await collection('generations')).findOne(scope({_id:source.generationId,leaseOwner:generationOwner,leaseUntil:{$gt:new Date()}})),
          'A importação está sendo atualizada. Confira os dados e gere novamente.',409,'ANALYSIS_SOURCE_CHANGED');
        const checked=await fiscalSource(current as Analysis);
        need(checked.fingerprint===sourceFingerprint,'Os arquivos mudaram durante o cálculo. Confirme o Fiscal novamente antes de gerar.',409,'ANALYSIS_SOURCE_CHANGED');
      };
      await unchanged();
      const simulation=await createAnalysisSimulation(actor,calculationInput(item,source,simulationId),{analysisId:id,analysisRevision:expected,source,beforeInsert:unchanged,
        evidence:{version:ANALYSIS_VERSION,configRevision:item.config.revision,
          fiscal:{revision:item.fiscal.revision,confirmedAt:item.fiscal.completedAt,confirmedBy:item.fiscal.updatedBy,sourceFingerprint},
          accounting:{revision:item.accounting.revision,confirmedAt:item.accounting.completedAt,confirmedBy:item.accounting.updatedBy}}});
      await unchanged();
      const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,revision:expected,leaseOwner:owner,leaseUntil:{$gt:new Date()}}),
        {$set:{currentSimulation:currentOf(simulation,expected,false),legacy:false,activated:true,lastGeneration:{requestId,revision:expected,simulationId},updatedAt:new Date()}},{returnDocument:'after'});
      if(!updated)throw conflict();
      await(await collection('simulations')).updateOne(scope({_id:simulationId,analysisId:id,analysisRevision:expected}),{$set:{analysisPublication:'PUBLISHED'}});
      await requests.updateOne(scope({_id:requestKey}),{$setOnInsert:{...scope(),analysisId:id,requestId,revision:expected,simulationId,createdAt:new Date(),createdBy:author(actor)}},{upsert:true});
      await audit(actor._id,'analysis.generate',id);
      return {analysis:await visible(updated as Analysis),simulation:await getSimulation(simulationId),reused:item.currentSimulation?.id===simulationId};
    })));
  },expected);
}
/** Compatibility bridge: old forms may append until the company is explicitly managed by the new workflow. */
export async function createLegacySimulation(actor:LookupActor,input:unknown){
  write(actor);const parsed=validateSimulationRequest(input);
  const existing=await(await collection('simulations')).findOne(scope({_id:parsed.simulationId}));
  if(existing){if(existing.analysisPublication==='PENDING')await getSimulation(parsed.simulationId);return createSimulation(actor,input);}
  const {item}=await ensureAnalysis(actor,parsed.clientId,parsed.draft.year,resolveRegimeSelection(parsed.draft.regimeSelection),false);
  return withAnalysis(item._id,async(current,owner)=>{
    need(!current.activated,'Esta empresa já usa os setores Fiscal e Contábil. Abra a análise da empresa para editar e gerar uma nova versão.',409,'ANALYSIS_WORKFLOW_REQUIRED');
    const simulation=await createSimulation(actor,input);seedLegacy(current,simulation,actor);
    const updated=await(await analyses()).updateOne(scope({_id:current._id,leaseOwner:owner,leaseUntil:{$gt:new Date()},activated:false}),
      {$set:{config:current.config,fiscal:current.fiscal,accounting:current.accounting,currentSimulation:current.currentSimulation,
        legacy:true,legacyReference:current.legacyReference,updatedAt:new Date()},$inc:{revision:1}});
    need(updated.matchedCount===1,conflict().message,409,'ANALYSIS_CONFLICT');return simulation;
  });
}
export async function analysisVersions(id:string,page:number){
  const item=await record(id);page=integer(page,1,100000);
  const q=scope({clientId:item.clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}}),c=await collection('simulations');
  const [items,total]=await Promise.all([c.find(q).project({_id:1,clientId:1,generationId:1,title:1,createdAt:1,createdBy:1,year:1,modelVersion:1,annualRevenue:1,bestRegimeName:1,bestAnnualProfit:1,
    parentSimulationId:1,analysisId:1,analysisRevision:1,reportMonths:1,'draft.regimeSelection':1}).sort({createdAt:-1,_id:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).toArray(),c.countDocuments(q)]);
  return {items:items.map(row=>({...row,current:row._id===item.currentSimulation?.id,legacy:!row.analysisId})),pagination:{page,pageSize:PAGE_SIZE,total,totalPages:Math.ceil(total/PAGE_SIZE)}};
}
/** Reprocessing never creates a second current, nor replaces a version edited or published in the meantime. */
export async function promoteReprocessedAnalysis(actor:LookupActor,originalId:string,child:any){
  const c=await analyses(),item=await c.findOne(scope({clientId:child.clientId,'currentSimulation.id':originalId}));if(!item)return;
  if(item.activated && (item.currentSimulation?.analysisRevision!==item.revision || !child.analysisId))return;
  if(!item.activated){
    const updated=structuredClone(item) as Analysis;seedLegacy(updated,child,actor);
    await c.updateOne(scope({_id:item._id,revision:item.revision,activated:false,'currentSimulation.id':originalId,...leaseFree()}),
      {$set:{config:updated.config,fiscal:updated.fiscal,accounting:updated.accounting,currentSimulation:updated.currentSimulation,legacy:true,
        legacyReference:updated.legacyReference,updatedAt:new Date()},$inc:{revision:1}});
  }else await c.updateOne(scope({_id:item._id,revision:item.revision,'currentSimulation.id':originalId,...leaseFree()}),
      {$set:{currentSimulation:currentOf(child,item.currentSimulation.analysisRevision,item.currentSimulation.legacy),updatedAt:new Date()}});
}

/** A bridge is not activation. Explicit legacy deletion remains available until the sectors are opened. */
export async function withLegacyAnalysisDeletion<T>(simulationId:string,actor:LookupActor,remove:()=>Promise<T>):Promise<T>{
  const c=await analyses(),linked=await c.findOne(scope({'currentSimulation.id':simulationId}));
  if(!linked)return remove();
  return withAnalysis(linked._id,async(item,owner)=>{
    need(item.currentSimulation?.id!==simulationId || !item.activated,
      'A versão corrente da análise é preservada. Edite os setores e gere uma nova versão.',409,'ANALYSIS_VERSION_PROTECTED');
    const result=await remove();
    if(item.currentSimulation?.id===simulationId){
      const latest=await(await collection('simulations')).find(scope({clientId:item.clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})).sort({createdAt:-1,_id:-1}).limit(1).next();
      if(latest)seedLegacy(item,latest,actor);
      else{
        item.currentSimulation=null;item.legacy=false;
        item.config={...item.config,revision:item.config.revision+1};
        item.fiscal={...sector(defaultFiscalData(item.config.regimeSelection),actor,new Date()),revision:item.fiscal.revision+1};
        item.accounting={...sector({months:[]},actor,new Date()),revision:item.accounting.revision+1};
      }
      await c.updateOne(scope({_id:item._id,activated:false,leaseOwner:owner,leaseUntil:{$gt:new Date()},'currentSimulation.id':simulationId}),
        {$set:{currentSimulation:item.currentSimulation,legacy:item.legacy,config:item.config,fiscal:item.fiscal,accounting:item.accounting,
          ...(item.legacyReference?{legacyReference:item.legacyReference}:{}),updatedAt:new Date()},$inc:{revision:1}});
    }
    return result;
  });
}
