import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {collection,scope,audit} from './store.ts';
import type {Doc} from './store.ts';
import {AppError,need,digest,escapeRegex,text,integer} from './security.ts';
import {write,withJob} from './lookup-db.ts';
import type {LookupActor} from './lookup-db.ts';
import {createGeneration,getGeneration,withGeneration} from './generation-store.ts';
import {generationSimulator,selectAnalysisSourceMonths} from './simulator-store.ts';
import {createAnalysisSimulation,createSimulation,getSimulation,validateSimulationRequest,assertSimulationNotDeleted,removeAnalysisSimulationSnapshot} from './simulation-history.ts';
import {readRbt12Reference,rbt12InputSource} from './simulation-extrato.ts';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {baselineMonth} from '../public/simulator-monthly.js';
import {JAN_SEP_POLICY,JAN_SEP_MODEL_VERSION,buildAnalysisPeriod,selectAnalysisPeriod,isAnalysisMonth} from '../public/analysis-period.js';
import type {AnalysisPeriod} from '../public/analysis-period.js';
import {resolveRegimeSelection,requiresSimplesReference} from '../public/regime-selection.js';
import {upgradeDifalPolicy} from '../public/simulator-engine.js';
import type {DifalPolicy} from '../public/simulator-engine.js';
import {ANALYSIS_VERSION,ANALYSIS_GROUPS,ACCOUNTING_FIELDS,analysisObject,analysisId,analysisRevision,
  analysisYear,analysisSelection,analysisDifalPolicy,defaultFiscalData,effectiveAnalysisDifalPolicy,parseFiscalData,parseAccountingData} from './analysis-contract.ts';
import type {AnalysisConfig,AccountingData,FiscalData,AnalysisIssue} from './analysis-contract.ts';
import {analysisDeletion,analysisDeletionStarted,assertAnalysisNotDeleted,companyHasAnalysisDeletion,reserveAnalysisDeletion} from './analysis-deletion.ts';
import type {AnalysisDeletionReceipt} from './analysis-deletion.ts';

type Author={id:string;name:string};
type Sector<T>={revision:number;status:'DRAFT'|'COMPLETE';data:T;completedAt:Date|null;updatedAt:Date;updatedBy:Author;
  confirmation?:{fingerprint:string;generationId:string;purchaseJobId:string;salesJobId:string;extractionId:string|null;months:string[];configRevision:number;analysisPeriod?:AnalysisPeriod}|null};
type Current={id:string;analysisRevision:number|null;createdAt:Date;modelVersion:string|null;legacy:boolean};
type Analysis=Doc & {clientId:string;company:{name:string;code:string|null;cnpj?:string|null};version:string;activated:boolean;revision:number;
  config:AnalysisConfig;fiscal:Sector<FiscalData>;accounting:Sector<AccountingData>;currentSimulation:Current|null;
  legacy:boolean;legacyReference?:{simulationId:string;monthlyInputsPreserved:boolean};createdAt:Date;createdBy:Author;updatedAt:Date;
  leaseOwner?:string;leaseUntil?:Date;lastGeneration?:{requestId:string;revision:number;simulationId:string};
  deletionStartedAt?:Date;deletionActor?:string;deletionRevision?:number};
type Source=Awaited<ReturnType<typeof generationSimulator>>;
export type AnalysisReadOptions={summary?:boolean;includeSource?:boolean};
type SourceError={code:string;message:string};
type Readiness={ready:boolean;issues:AnalysisIssue[];months:string[];checked:Awaited<ReturnType<typeof fiscalSource>>|null;
  source:Source|null;sourceError:SourceError|null;analysisPeriod:AnalysisPeriod|null;verification?:'SAVED'};
const PAGE_SIZE=20;
const author=(actor:LookupActor):Author=>({id:actor._id,name:actor.name});
const conflict=()=>new AppError(409,'ANALYSIS_CONFLICT','A análise mudou ou está sendo gerada. Reabra os dados antes de salvar para preservar o trabalho de todos.');
const missingGeneration=(error:unknown)=>error instanceof AppError && ['NOT_FOUND','GENERATION_DELETED'].includes(error.code);
const unavailableGeneration=()=>new AppError(409,'ANALYSIS_GENERATION_UNAVAILABLE',
  'Os relatórios de entradas e saídas vinculados a esta análise não estão mais disponíveis. Prepare novos relatórios no setor Fiscal e importe os arquivos novamente. As informações preenchidas e as versões salvas continuam preservadas.');
const leaseFree=()=>({$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]});
const active=()=>({deletionStartedAt:{$exists:false}});

async function analyses(){
  return collection('analyses');
}
async function record(id:string):Promise<Analysis>{
  const value=await(await analyses()).findOne(scope({_id:analysisId(id),...active()}));
  need(value && !await analysisDeletion(id),'Análise não encontrada.',404,'NOT_FOUND');return value as Analysis;
}
function ordered(value:any):any {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(ordered);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])]));
  return value;
}
function fingerprint(source:Source,reference:unknown,config:AnalysisConfig,data:FiscalData){
  return digest(JSON.stringify(ordered({generationId:source.generationId,clientId:source.clientId,purchases:source.purchases,sales:source.sales,
    monthlyReports:source.monthlyReports,fields:source.fields,period:source.period,analysisPeriod:source.analysisPeriod,importedOperationAudit:source.importedOperationAudit,operationVersion:source.operationVersion,
    reference,year:config.year,regimeSelection:config.regimeSelection,salesAnnex:data.salesAnnex,serviceAnnex:data.serviceAnnex,
    difalPolicy:data.difalPolicy,icmsOutside:data.icmsOutside,monthlyOverrides:data.monthlyOverrides})));
}
async function fiscalSource(item:Analysis,data=item.fiscal.data,onSource?:(source:Source)=>void){
  need(data.generationId,'Importe as entradas e saídas da empresa.',422,'ANALYSIS_FISCAL_INCOMPLETE');
  let source:Source;
  try{source=await generationSimulator(data.generationId,item.clientId,{periodPolicy:JAN_SEP_POLICY});}
  catch(error){if(missingGeneration(error))throw unavailableGeneration();throw error;}
  // The Fiscal form still needs the reconciled months while its RBT12 is pending.
  onSource?.(source);
  let months=source.monthlyReports?.map(row=>row.sourceMonth)||[];
  need(source.analysisPeriod?.complete && months.length>=1,
    'As entradas e saídas precisam ter pelo menos uma competência em comum entre janeiro e setembro.',422,'ANALYSIS_PERIOD_INCOMPLETE');
  let reference:unknown=null;
  if(requiresSimplesReference(item.config.regimeSelection)){
    const kind=rbt12InputSource(data.rbt12Source,data.rbt12Source==='MANUAL'?data.rbt12ManualConfirmed:undefined,data.rbt12ExtractionId,data.rbt12??undefined,item.config.regimeSelection);
    if(kind==='MANUAL') reference={source:'MANUAL',rbt12Cents:Math.round(data.rbt12!*100)};
    else if(kind==='SIMPLES_SECTION_22'){
      reference=await readRbt12Reference(data.rbt12ExtractionId,item.clientId,data.rbt12??undefined);
      // Only available Jan–Sep competences enter the comparison. Each selected
      // tax period requires its own previous-twelve-month history from section 2.2.
      const schedule=buildRbt12Schedule(reference as any,months);
      const pending=schedule.rows.filter(row=>row.status!=='CONFIRMED');
      const missingHistory=[...new Set(pending.flatMap(row=>row.missingMonths))].sort();
      const confirmed=schedule.rows.filter(row=>row.status==='CONFIRMED').map(row=>row.sourceMonth);
      need(confirmed.length>0,`Nenhuma competência dos relatórios tem RBT12 confirmada. Faltam receitas históricas da seção 2.2: ${missingHistory.join(', ')}. Confira um extrato com o histórico necessário.`,422,'RBT12_MONTHS_MISSING');
      if(confirmed.length!==months.length){
        source=selectAnalysisSourceMonths(source,confirmed);
        source.warnings.push(`Competências sem RBT12 mensal confirmada, excluídas do cálculo: ${pending.map(row=>row.sourceMonth).join(', ')}. Receitas históricas ausentes na seção 2.2: ${missingHistory.join(', ')}.`);
        months=confirmed;onSource?.(source);
      }
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
  if(data.monthlyOverrides)need(isDeepStrictEqual(data.monthlyOverrides.filter(row=>months.includes(row.sourceMonth)).map(row=>row.sourceMonth),months),
    'Os ajustes fiscais devem corresponder exatamente às competências dos relatórios. Revise os ajustes antes de concluir.',422,'ANALYSIS_MONTHS');
  return {source,months,reference,fingerprint:fingerprint(source,reference,item.config,data)};
}
function savedAnalysisPeriod(item:Analysis):AnalysisPeriod|null{
  const confirmation=item.fiscal.confirmation;
  if(!confirmation||confirmation.generationId!==item.fiscal.data.generationId)return null;
  if(confirmation.analysisPeriod?.version===JAN_SEP_POLICY)return confirmation.analysisPeriod;
  const months=confirmation.months;
  if(!months?.length)return null;
  try{const period={startMonth:months[0],endMonth:months.at(-1)!,months:months.length};return buildAnalysisPeriod(period,period);}
  catch{return null;}
}
async function readiness(item:Analysis):Promise<Readiness>{
  const issues:AnalysisIssue[]=[];let checked:Awaited<ReturnType<typeof fiscalSource>>|null=null,source:Source|null=null,sourceError:SourceError|null=null;
  if(item.fiscal.status!=='COMPLETE')issues.push({code:'FISCAL_NOT_CONFIRMED',sector:'fiscal',message:'Salve e conclua o setor Fiscal.'});
  try{checked=await fiscalSource(item,item.fiscal.data,value=>{source=value;});}
  catch(error){if(!(error instanceof AppError))throw error;issues.push({code:error.code,sector:'fiscal',message:error.message});
    if(!source)sourceError={code:error.code,message:error.message};}
  if(checked && item.fiscal.status==='COMPLETE' && (item.fiscal.confirmation?.fingerprint!==checked.fingerprint || item.fiscal.confirmation.configRevision!==item.config.revision)){
    issues.push({code:'FISCAL_SOURCE_CHANGED',sector:'fiscal',message:'Os arquivos ou as opções fiscais mudaram após a confirmação. Confira e conclua o Fiscal novamente.'});
  }
  if(item.accounting.status!=='COMPLETE')issues.push({code:'ACCOUNTING_NOT_CONFIRMED',sector:'accounting',message:'Salve e conclua as despesas do setor Contábil.'});
  const fiscalPeriod=(source as Source|null)?.analysisPeriod||savedAnalysisPeriod(item);
  const accounting=item.accounting.data.months.filter(row=>isAnalysisMonth(row.sourceMonth,fiscalPeriod?.sourceYear)&&ACCOUNTING_FIELDS.some(key=>row[key]!==null));
  const available=fiscalPeriod?.includedMonths||checked?.months||[];
  const months=available.filter(month=>accounting.some(row=>row.sourceMonth===month&&ACCOUNTING_FIELDS.every(key=>row[key]!==null)));
  const analysisPeriod=months.length&&fiscalPeriod?selectAnalysisPeriod(fiscalPeriod,months):fiscalPeriod;
  if(!accounting.length || accounting.some(row=>ACCOUNTING_FIELDS.some(key=>row[key]===null))){
    issues.push({code:'ACCOUNTING_VALUES_MISSING',sector:'accounting',message:'Preencha todas as despesas dos meses utilizados; deixe inteiramente vazios os meses sem dados.'});
  }
  if(available.length&&!months.length){
    issues.push({code:'ACCOUNTING_MONTHS_MISMATCH',sector:'accounting',message:'Preencha ao menos uma competência disponível no Fiscal para gerar o relatório consolidado.'});
  }
  return {ready:issues.length===0,issues,months,analysisPeriod,checked,source,sourceError};
}

/** Navigation describes saved work only. It never authorizes publication or validates source files. */
function savedReadiness(item:Analysis):Readiness{
  const issues:AnalysisIssue[]=[],confirmation=item.fiscal.confirmation;
  const fiscalPeriod=savedAnalysisPeriod(item),available=fiscalPeriod?.includedMonths||[];
  if(item.fiscal.status!=='COMPLETE')issues.push({code:'FISCAL_NOT_CONFIRMED',sector:'fiscal',message:'Salve e conclua o setor Fiscal.'});
  if(!item.fiscal.data.generationId)issues.push({code:'ANALYSIS_FISCAL_INCOMPLETE',sector:'fiscal',message:'Importe as entradas e saídas da empresa.'});
  if(item.fiscal.status==='COMPLETE'&&(!confirmation||confirmation.configRevision!==item.config.revision||
    confirmation.generationId!==item.fiscal.data.generationId||!confirmation.fingerprint||!confirmation.analysisPeriod?.complete||!available.length)){
    issues.push({code:'FISCAL_SOURCE_CHANGED',sector:'fiscal',message:'Confira e conclua o Fiscal para estas escolhas da análise.'});
  }
  if(item.accounting.status!=='COMPLETE')issues.push({code:'ACCOUNTING_NOT_CONFIRMED',sector:'accounting',message:'Salve e conclua as despesas do setor Contábil.'});
  const accounting=item.accounting.data.months.filter(row=>isAnalysisMonth(row.sourceMonth,fiscalPeriod?.sourceYear)&&ACCOUNTING_FIELDS.some(key=>row[key]!==null));
  const months=available.filter(month=>accounting.some(row=>row.sourceMonth===month&&ACCOUNTING_FIELDS.every(key=>row[key]!==null)));
  const analysisPeriod=months.length&&fiscalPeriod?selectAnalysisPeriod(fiscalPeriod,months):fiscalPeriod;
  if(!accounting.length||accounting.some(row=>ACCOUNTING_FIELDS.some(key=>row[key]===null))){
    issues.push({code:'ACCOUNTING_VALUES_MISSING',sector:'accounting',message:'Preencha todas as despesas dos meses utilizados; deixe inteiramente vazios os meses sem dados.'});
  }
  if(available.length&&!months.length){
    issues.push({code:'ACCOUNTING_MONTHS_MISMATCH',sector:'accounting',message:'Preencha ao menos uma competência disponível no Fiscal para gerar o relatório consolidado.'});
  }
  return {ready:issues.length===0,issues,months,analysisPeriod,checked:null,source:null,sourceError:null,verification:'SAVED'};
}

async function presentation(item:Analysis,options:AnalysisReadOptions={},prepared?:Readiness){
  const {checked,source,sourceError,...ready}=options.summary?savedReadiness(item):prepared||await readiness(item);
  const {workspaceId:_workspace,_id:id,leaseOwner:_owner,leaseUntil:_until,activated:_activated,lastGeneration:_last,...rest}=item;
  const current=item.currentSimulation;
  const analysis={...rest,id,periodPolicy:JAN_SEP_POLICY,readiness:ready,currentSimulation:current?{...current,stale:current.legacy || current.modelVersion!==JAN_SEP_MODEL_VERSION || current.analysisRevision!==item.revision ||
    (!options.summary&&(!checked || checked.fingerprint!==item.fiscal.confirmation?.fingerprint))}:null};
  return {analysis,...(options.includeSource?{source,sourceError}:{})};
}
async function visible(item:Analysis,options:AnalysisReadOptions={},prepared?:Readiness){
  return (await presentation(item,options,prepared)).analysis;
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
  if(requiresSimplesReference(selection)) Object.assign(data,{rbt12Source:snapshot.rbt12Source==='NOT_PROVIDED'?'NOT_PROVIDED':snapshot.rbt12Source==='MANUAL'?'MANUAL':'SIMPLES_SECTION_22',
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
async function ensureAnalysis(actor:LookupActor,clientId:string,year:2027|2028,selection:AnalysisConfig['regimeSelection'],activate:boolean,difalPolicy?:DifalPolicy):Promise<{item:Analysis;created:boolean}>{
  const c=await analyses();let existing=await c.findOne(scope({clientId}));
  if(existing){
    const receipt=await analysisDeletion(existing._id);
    if(receipt || existing.deletionStartedAt){
      // The deletion was explicitly confirmed already. Repair a failed purge before opening fresh work.
      await deleteAnalysis(actor,existing._id,{expectedRevision:receipt?.revision??existing.deletionRevision,confirmed:true});
      return ensureAnalysis(actor,clientId,year,selection,activate,difalPolicy);
    }
    return {item:existing as Analysis,created:false};
  }
  const client=await(await collection('clients')).findOne(scope({_id:clientId,active:true}));
  need(client,'Empresa ativa não encontrada.',404,'NOT_FOUND');
  const now=new Date(),item:Analysis={_id:randomUUID(),...scope(),version:ANALYSIS_VERSION,clientId,company:{name:client.name,code:client.code||null,cnpj:client.cnpj||null},
    activated:activate,revision:0,config:{revision:0,year,regimeSelection:selection},fiscal:sector(defaultFiscalData(selection),actor,now),
    accounting:sector({months:[]},actor,now),currentSimulation:null,legacy:false,createdAt:now,createdBy:author(actor),updatedAt:now};
  if(difalPolicy)item.fiscal.data.difalPolicy=structuredClone(difalPolicy);
  // Reserve only empty data. A delayed insert cannot publish a legacy seed read before another deletion.
  try{await c.insertOne(item);}
  catch(error:any){if(error.code!==11000)throw error;existing=await c.findOne(scope({clientId}));need(existing,'Não foi possível abrir a análise.',409,'ANALYSIS_CONFLICT');await assertAnalysisNotDeleted(existing._id);return {item:existing as Analysis,created:false};}
  try{
    await withAnalysis(item._id,async(current,owner)=>{
      // A concurrent sector/config write owns its data; opening must never replace it with old history.
      if(current.revision!==0 || current.config.revision!==0 || current.fiscal.revision!==0 || current.accounting.revision!==0 ||
        current.currentSimulation || await companyHasAnalysisDeletion(clientId))return;
      const latest=await(await collection('simulations')).find(scope({clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})).project({_id:1}).sort({createdAt:-1,_id:-1}).limit(1).next();
      if(!latest)return;
      let snapshot;
      try{snapshot=await getSimulation(latest._id);}
      catch(error){if(error instanceof AppError && error.code==='NOT_FOUND')return;throw error;}
      seedLegacy(current,snapshot,actor);
      if(difalPolicy)current.fiscal.data.difalPolicy=structuredClone(difalPolicy);
      const updated=await c.updateOne(scope({_id:item._id,revision:0,...active(),leaseOwner:owner,leaseUntil:{$gt:new Date()}}),
        {$set:{config:current.config,fiscal:current.fiscal,accounting:current.accounting,currentSimulation:current.currentSimulation,
          legacy:true,legacyReference:current.legacyReference,updatedAt:new Date()},$inc:{revision:1}});
      need(updated.matchedCount===1,conflict().message,409,'ANALYSIS_CONFLICT');
    });
  }catch(error){
    // Another active writer may have claimed the freshly reserved document. Its values win.
    if(!(error instanceof AppError) || error.code!=='ANALYSIS_CONFLICT')throw error;
  }
  const created=await record(item._id);await audit(actor._id,'analysis.open',item._id);return {item:created,created:true};
}
async function withAnalysis<T>(id:string,action:(item:Analysis,owner:string)=>Promise<T>,expected?:number,deleting=false):Promise<T>{
  const c=await analyses(),owner=randomUUID(),now=new Date();
  if(!deleting)await assertAnalysisNotDeleted(id);
  const item=await c.findOneAndUpdate(scope({_id:analysisId(id),...(expected===undefined?{}:{revision:expected}),...(!deleting?active():{}),...leaseFree()}),
    {$set:{leaseOwner:owner,leaseUntil:new Date(now.getTime()+120_000)}},{returnDocument:'after'});
  if(!item){
    if(deleting)need(await c.findOne(scope({_id:id})),'Análise não encontrada.',404,'NOT_FOUND');else await record(id);
    throw conflict();
  }
  try{if(!deleting)await assertAnalysisNotDeleted(id);return await action(item as Analysis,owner);}
  finally{await c.updateOne(scope({_id:id,leaseOwner:owner}),{$unset:{leaseOwner:'',leaseUntil:''}});}
}
async function revisionAudit(item:Analysis,actor:LookupActor,kind:'config'|'fiscal'|'accounting'|'import'){
  await assertAnalysisNotDeleted(item._id);
  const c=await collection('analysisRevisions');
  const data=kind==='config'?item.config:kind==='accounting'?item.accounting:item.fiscal;
  await c.updateOne(scope({_id:digest(`${item._id}:${item.revision}`)}),{$setOnInsert:{...scope(),analysisId:item._id,clientId:item.clientId,revision:item.revision,
    kind,data,createdAt:item.updatedAt,createdBy:author(actor)}},{upsert:true});
  if(await analysisDeletionStarted(item._id)){
    await c.deleteOne(scope({_id:digest(`${item._id}:${item.revision}`),analysisId:item._id}));
    await assertAnalysisNotDeleted(item._id);
  }
  await audit(actor._id,`analysis.${kind}`,item._id);
}

async function saveGenerationRequest(id:string,key:string,data:Record<string,unknown>){
  await assertAnalysisNotDeleted(id);const c=await collection('analysisGenerationRequests');
  await c.updateOne(scope({_id:key}),{$setOnInsert:{...scope(),analysisId:id,...data}},{upsert:true});
  if(await analysisDeletionStarted(id)){
    await c.deleteOne(scope({_id:key,analysisId:id}));await assertAnalysisNotDeleted(id);
  }
}
export async function openAnalysis(actor:LookupActor,input:unknown,options:AnalysisReadOptions={}){
  write(actor);analysisObject(input,['clientId','year','regimeSelection'],['difalPolicy']);
  const difalPolicy=Object.hasOwn(input,'difalPolicy')?analysisDifalPolicy(input.difalPolicy):undefined;
  const {item,created}=await ensureAnalysis(actor,analysisId(input.clientId),analysisYear(input.year),analysisSelection(input.regimeSelection),true,difalPolicy);
  if(!item.activated){
    await withAnalysis(item._id,async(current,owner)=>{
      const latest=await companyHasAnalysisDeletion(item.clientId)?null:await(await collection('simulations')).find(scope({clientId:item.clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})).sort({createdAt:-1,_id:-1}).limit(1).next();
      const reseeded=!!latest && latest._id!==current.currentSimulation?.id;
      if(reseeded)seedLegacy(current,latest,actor);
      await(await analyses()).updateOne(scope({_id:item._id,...active(),leaseOwner:owner,leaseUntil:{$gt:new Date()}}),{$set:{activated:true,config:current.config,
        fiscal:current.fiscal,accounting:current.accounting,currentSimulation:current.currentSimulation,legacy:current.legacy,
        ...(current.legacyReference?{legacyReference:current.legacyReference}:{}),updatedAt:new Date()},...(reseeded?{$inc:{revision:1}}:{})});
    });
  }
  return {analysis:await visible(await record(item._id),options),created};
}
export async function getAnalysis(id:string,options:AnalysisReadOptions={}){return presentation(await record(id),options);}
export async function analysisHistory(page:number,filters:{clientId?:string;search?:string}={},options:AnalysisReadOptions={}){
  page=integer(page,1,100000);const q:any=scope(active());if(filters.clientId)q.clientId=analysisId(filters.clientId);
  if(filters.search?.trim()){const term=escapeRegex(text(filters.search,100));q.$or=['company.name','company.code','company.cnpj'].map(key=>({[key]:{$regex:term,$options:'i'}}));}
  const c=await analyses();const [rows,total]=await Promise.all([c.find(q).sort({updatedAt:-1,_id:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).toArray(),c.countDocuments(q)]);
  const items=[];for(const row of rows)items.push(await visible(row as Analysis,options));
  return {items,pagination:{page,pageSize:PAGE_SIZE,total,totalPages:Math.ceil(total/PAGE_SIZE)}};
}
export async function updateAnalysisConfig(actor:LookupActor,id:string,input:unknown,options:AnalysisReadOptions={}){
  write(actor);analysisObject(input,['expectedConfigRevision','year','regimeSelection']);
  const expected=analysisRevision(input.expectedConfigRevision),year=analysisYear(input.year),selection=analysisSelection(input.regimeSelection),prior=await record(id);
  const data=structuredClone(prior.fiscal.data),needs=requiresSimplesReference(selection);
  if(!needs)Object.assign(data,{rbt12Source:'NOT_REQUIRED',rbt12:null,rbt12ExtractionId:null,rbt12DocumentId:null,rbt12ManualConfirmed:false});
  else if(data.rbt12Source==='NOT_REQUIRED')data.rbt12Source='NOT_PROVIDED';
  const now=new Date();
  const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,...active(),'config.revision':expected,'fiscal.revision':prior.fiscal.revision,...leaseFree()}),
    {$set:{activated:true,config:{revision:expected+1,year,regimeSelection:selection},'fiscal.data':data,'fiscal.status':'DRAFT','fiscal.completedAt':null,
      'fiscal.confirmation':null,'fiscal.updatedAt':now,'fiscal.updatedBy':author(actor),updatedAt:now},$inc:{revision:1,'fiscal.revision':1}},{returnDocument:'after'});
  if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,'config');return {analysis:await visible(updated as Analysis,options)};
}
export async function updateAnalysisSector(actor:LookupActor,id:string,kind:'fiscal'|'accounting',input:unknown,options:AnalysisReadOptions={}){
  write(actor);analysisObject(input,['expectedSectorRevision','expectedConfigRevision','complete','data']);
  const expected=analysisRevision(input.expectedSectorRevision),configRevision=analysisRevision(input.expectedConfigRevision);
  need(typeof input.complete==='boolean','Informe se deseja concluir o setor.');
  const prior=await record(id);need(prior.config.revision===configRevision && prior[kind].revision===expected,conflict().message,409,'ANALYSIS_CONFLICT');
  const data=kind==='fiscal'?parseFiscalData(input.data,prior.config.regimeSelection):parseAccountingData(input.data,input.complete,
    {periodPolicy:JAN_SEP_POLICY,sourceYear:savedAnalysisPeriod(prior)?.sourceYear});
  let confirmation:Sector<FiscalData>['confirmation']=null;
  if(kind==='fiscal'){
    const fiscal=data as FiscalData;
    if(fiscal.generationId){
      try{
        const generation=await getGeneration(fiscal.generationId);
        need(generation.companies.some((company:any)=>company.clientId===prior.clientId),'A geração não pertence à empresa da análise.',409,'GENERATION_CLIENT');
      }catch(error){
        // An existing link may outlive explicitly deleted source reports. Saving
        // options/RBT12 must remain possible so the user can prepare a new import.
        // Never accept a new missing link, or bypass ownership/integrity failures.
        if(!missingGeneration(error)||fiscal.generationId!==prior.fiscal.data.generationId)throw error;
        if(input.complete)throw unavailableGeneration();
      }
    }
    if(fiscal.generationId!==prior.fiscal.data.generationId)need(fiscal.monthlyOverrides===null,'Ao trocar os arquivos, revise os ajustes fiscais anteriores.',409,'ANALYSIS_SOURCE_CHANGED');
    if(input.complete){const checked=await fiscalSource(prior,fiscal);confirmation={fingerprint:checked.fingerprint,generationId:fiscal.generationId!,purchaseJobId:checked.source.purchases.jobId,
      salesJobId:checked.source.sales.jobId,extractionId:fiscal.rbt12ExtractionId,months:checked.months,configRevision,analysisPeriod:checked.source.analysisPeriod};}
  }
  const now=new Date();const value={revision:expected+1,status:input.complete?'COMPLETE':'DRAFT',data,completedAt:input.complete?now:null,updatedAt:now,updatedBy:author(actor),confirmation};
  const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,...active(),'config.revision':configRevision,[`${kind}.revision`]:expected,...leaseFree()}),
    {$set:{activated:true,[kind]:value,updatedAt:now},$inc:{revision:1}},{returnDocument:'after'});
  if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,kind);return {analysis:await visible(updated as Analysis,options)};
}
export async function importAnalysisGeneration(actor:LookupActor,id:string,input:unknown,options:AnalysisReadOptions={}){
  write(actor);analysisObject(input,['expectedSectorRevision','expectedConfigRevision']);
  const expected=analysisRevision(input.expectedSectorRevision),configRevision=analysisRevision(input.expectedConfigRevision);
  return withAnalysis(id,async(item,owner)=>{
    need(item.fiscal.revision===expected && item.config.revision===configRevision,conflict().message,409,'ANALYSIS_CONFLICT');
    const generationId=deterministicId(`import:${item._id}:${expected}:${configRevision}`);
    const effectivePolicy=effectiveAnalysisDifalPolicy(item.fiscal.data.difalPolicy,item.config.regimeSelection);
    await createGeneration(actor,{generationId,clientIds:[item.clientId],requiredReports:['PURCHASES','SALES'],companyDifalPolicies:[{clientId:item.clientId,difalPolicy:effectivePolicy}]});
    const now=new Date(),data={...item.fiscal.data,generationId,monthlyOverrides:null};
    const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,...active(),leaseOwner:owner,leaseUntil:{$gt:new Date()},'fiscal.revision':expected,'config.revision':configRevision}),
      {$set:{activated:true,fiscal:{...item.fiscal,revision:expected+1,status:'DRAFT',data,confirmation:null,completedAt:null,updatedAt:now,updatedBy:author(actor)},updatedAt:now},$inc:{revision:1}},{returnDocument:'after'});
    if(!updated)throw conflict();await revisionAudit(updated as Analysis,actor,'import');return {analysis:await visible(updated as Analysis,options),generationId};
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
    ...(requiresSimplesReference(item.config.regimeSelection)?{rbt12:f.rbt12}:{}),difalPolicy:f.difalPolicy,icmsOutside:f.icmsOutside,
    values:{...first.values,salesRevenue:ANALYSIS_GROUPS.slice(0,3).reduce((sum,key)=>sum+Math.round(first.groups[key]*100),0)/100,
      simplePurchases:first.groups.purchasesOptantCents,regularPurchases:first.groups.purchasesNonOptantCents}};
  return {simulationId,generationId:f.generationId,clientId:item.clientId,periodPolicy:JAN_SEP_POLICY,reportMonths:monthlyInputs.length,periodConfirmed:true,monthlyInputs,
    monthlyGroups:first.groups,draft,parentSimulationId:item.currentSimulation?.id||null,
    ...(f.rbt12Source==='MANUAL'?{rbt12Source:'MANUAL',rbt12ManualConfirmed:true}:f.rbt12Source==='NOT_REQUIRED'||f.rbt12Source==='NOT_PROVIDED'?{rbt12Source:f.rbt12Source}:{rbt12ExtractionId:f.rbt12ExtractionId})};
}
async function generatedSimulation(id:string,options:AnalysisReadOptions){
  // Keep ownership/deletion/publication checks even when navigation only needs the saved ID.
  const snapshot=await getSimulation(id);
  return options.summary?{_id:snapshot._id,analysisId:snapshot.analysisId,createdAt:snapshot.createdAt,modelVersion:snapshot.modelVersion}:snapshot;
}
export async function generateAnalysis(actor:LookupActor,id:string,input:unknown,options:AnalysisReadOptions={}){
  write(actor);analysisObject(input,['requestId','expectedRevision']);const requestId=analysisId(input.requestId),expected=analysisRevision(input.expectedRevision);
  const initial=await record(id);
  const requests=await collection('analysisGenerationRequests'),requestKey=digest(`${scope().workspaceId}:${id}:${requestId}`);
  const priorRequest=await requests.findOne(scope({_id:requestKey,analysisId:id}));
  if(priorRequest){need(priorRequest.revision===expected,'Este identificador pertence a outra revisão.',409,'ANALYSIS_CONFLICT');
    return {analysis:await visible(initial,options),simulation:await generatedSimulation(priorRequest.simulationId,options),reused:true};}
  if(initial.lastGeneration?.requestId===requestId){
    need(initial.lastGeneration.revision===expected,'Este identificador pertence a outra revisão.',409,'ANALYSIS_CONFLICT');
    await(await collection('simulations')).updateOne(scope({_id:initial.lastGeneration.simulationId,analysisId:id}),{$set:{analysisPublication:'PUBLISHED'}});
    return {analysis:await visible(initial,options),simulation:await generatedSimulation(initial.lastGeneration.simulationId,options),reused:true};
  }
  return withAnalysis(id,async(item,owner)=>{
    const prepared=await readiness(item);need(prepared.ready,prepared.issues.map(issue=>issue.message).join(' '),422,'ANALYSIS_NOT_READY');
    const source=selectAnalysisSourceMonths(prepared.checked!.source,prepared.months),sourceFingerprint=prepared.checked!.fingerprint;
    const simulationId=deterministicId(`generate:${item._id}:${item.revision}:${JAN_SEP_MODEL_VERSION}`);
    if(item.currentSimulation?.id===simulationId){
      await saveGenerationRequest(id,requestKey,{requestId,revision:expected,simulationId,createdAt:new Date(),createdBy:author(actor)});
      return {analysis:await visible(item,options,prepared),simulation:await generatedSimulation(simulationId,options),reused:true};
    }
    const sources=[source.purchases.jobId,source.sales.jobId].sort();
    return withGeneration(source.generationId,async(_generation,generationOwner)=>withJob(sources[0],async(first)=>withJob(sources[1],async(second)=>{
      let lastChecked=prepared.checked!;
      const unchanged=async()=>{
        const current=await(await analyses()).findOne(scope({_id:id,...active(),revision:expected,leaseOwner:owner,leaseUntil:{$gt:new Date()}}));if(!current)throw conflict();
        const locked=await(await collection('lookupJobs')).countDocuments(scope({$or:[{_id:first._id,leaseOwner:first.leaseOwner},{_id:second._id,leaseOwner:second.leaseOwner}],leaseUntil:{$gt:new Date()}}));
        need(locked===2,'Os arquivos estão sendo atualizados. Confira os dados e gere novamente.',409,'ANALYSIS_SOURCE_CHANGED');
        need(await(await collection('generations')).findOne(scope({_id:source.generationId,leaseOwner:generationOwner,leaseUntil:{$gt:new Date()}})),
          'A importação está sendo atualizada. Confira os dados e gere novamente.',409,'ANALYSIS_SOURCE_CHANGED');
        const checked=await fiscalSource(current as Analysis);
        need(checked.fingerprint===sourceFingerprint,'Os arquivos mudaram durante o cálculo. Confirme o Fiscal novamente antes de gerar.',409,'ANALYSIS_SOURCE_CHANGED');
        lastChecked=checked;
      };
      await unchanged();
      const simulation=await createAnalysisSimulation(actor,calculationInput(item,source,simulationId),{analysisId:id,analysisRevision:expected,source,beforeInsert:unchanged,
        evidence:{version:ANALYSIS_VERSION,configRevision:item.config.revision,
          fiscal:{revision:item.fiscal.revision,confirmedAt:item.fiscal.completedAt,confirmedBy:item.fiscal.updatedBy,sourceFingerprint},
          accounting:{revision:item.accounting.revision,confirmedAt:item.accounting.completedAt,confirmedBy:item.accounting.updatedBy}}});
      await unchanged();
      const updated=await(await analyses()).findOneAndUpdate(scope({_id:id,...active(),revision:expected,leaseOwner:owner,leaseUntil:{$gt:new Date()}}),
        {$set:{currentSimulation:currentOf(simulation,expected,false),legacy:false,activated:true,lastGeneration:{requestId,revision:expected,simulationId},updatedAt:new Date()}},{returnDocument:'after'});
      if(!updated)throw conflict();
      await(await collection('simulations')).updateOne(scope({_id:simulationId,analysisId:id,analysisRevision:expected}),{$set:{analysisPublication:'PUBLISHED'}});
      await saveGenerationRequest(id,requestKey,{requestId,revision:expected,simulationId,createdAt:new Date(),createdBy:author(actor)});
      await audit(actor._id,'analysis.generate',id);
      // The final source check above still owns all three leases and the CAS.
      // Reuse its verified result for presentation instead of reconciling every line again.
      return {analysis:await visible(updated as Analysis,options,{...prepared,checked:lastChecked,source:lastChecked.source}),
        simulation:await generatedSimulation(simulationId,options),reused:item.currentSimulation?.id===simulationId};
    })));
  },expected);
}
/** Compatibility bridge: old forms may append until the company is explicitly managed by the new workflow. */
export async function createLegacySimulation(actor:LookupActor,input:unknown){
  write(actor);const parsed=validateSimulationRequest(input);
  const existing=await(await collection('simulations')).findOne(scope({_id:parsed.simulationId}));
  if(existing){if(existing.analysisPublication==='PENDING')await getSimulation(parsed.simulationId);return createSimulation(actor,input);}
  await assertSimulationNotDeleted(parsed.simulationId);
  need(!await companyHasAnalysisDeletion(parsed.clientId),'Abra uma nova análise da empresa para editar e gerar pelos setores Fiscal e Contábil.',409,'ANALYSIS_WORKFLOW_REQUIRED');
  const {item}=await ensureAnalysis(actor,parsed.clientId,parsed.draft.year,resolveRegimeSelection(parsed.draft.regimeSelection),false);
  return withAnalysis(item._id,async(current,owner)=>{
    need(!current.activated,'Esta empresa já usa os setores Fiscal e Contábil. Abra a análise da empresa para editar e gerar uma nova versão.',409,'ANALYSIS_WORKFLOW_REQUIRED');
    try{
      await assertAnalysisNotDeleted(current._id);
      const simulation=await createSimulation(actor,input);await assertAnalysisNotDeleted(current._id);seedLegacy(current,simulation,actor);
      const updated=await(await analyses()).updateOne(scope({_id:current._id,...active(),leaseOwner:owner,leaseUntil:{$gt:new Date()},activated:false}),
        {$set:{config:current.config,fiscal:current.fiscal,accounting:current.accounting,currentSimulation:current.currentSimulation,
          legacy:true,legacyReference:current.legacyReference,updatedAt:new Date()},$inc:{revision:1}});
      need(updated.matchedCount===1,conflict().message,409,'ANALYSIS_CONFLICT');await assertAnalysisNotDeleted(current._id);return simulation;
    }catch(error){
      // An expired bridge lease must not leave a late, unlinked legacy result after deletion.
      if(await analysisDeletionStarted(current._id)){
        const receipt=await analysisDeletion(current._id),snapshots=await collection('simulations');
        if(await snapshots.findOne(scope({_id:parsed.simulationId,clientId:parsed.clientId}))){
          if(receipt)await removeAnalysisSimulationSnapshot(actor,parsed.simulationId,receipt);
          else await snapshots.deleteOne(scope({_id:parsed.simulationId,clientId:parsed.clientId}));
        }
      }
      throw error;
    }
  });
}

function adoptedSimulationIds(item:Analysis){
  const ids=[item.legacyReference?.simulationId,item.currentSimulation?.legacy?item.currentSimulation.id:null].filter(Boolean) as string[];
  need(ids.every(id=>typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)),
    'O vínculo do histórico da análise está inconsistente.',409,'ANALYSIS_INCONSISTENT');
  return [...new Set(ids)].sort();
}

/** Follow only automatic revisions with matching parent/original identities, never other company history. */
async function legacyRevisionIds(id:string,clientId:string,roots:string[]){
  const found=new Set(roots),c=await collection('simulations');let pending=[...roots];
  while(pending.length){
    const batch=pending.splice(0,200);
    const rows=await c.find(scope({clientId,parentSimulationId:{$in:batch},'reprocessing.originalId':{$in:batch},
      'reprocessing.version':{$type:'string'},$expr:{$eq:['$parentSimulationId','$reprocessing.originalId']},
      $or:[{analysisId:{$exists:false}},{analysisId:id}]})).project({_id:1}).toArray();
    for(const row of rows)if(!found.has(row._id)){found.add(row._id);pending.push(row._id);}
  }
  return [...found];
}

async function checkDeletionOwnership(item:Analysis,legacyIds:string[]){
  const c=await collection('simulations');
  need(!await c.findOne(scope({analysisId:item._id,clientId:{$ne:item.clientId}}),{projection:{_id:1}}),
    'Há um resultado vinculado a outra empresa. A exclusão foi bloqueada.',409,'ANALYSIS_INCONSISTENT');
  const linkedIds=[...new Set([...legacyIds,...(item.currentSimulation?[item.currentSimulation.id]:[])])];
  if(!linkedIds.length)return;
  const linked=await c.find(scope({_id:{$in:linkedIds}})).project({_id:1,clientId:1,analysisId:1}).toArray();
  need(linked.every(row=>row.clientId===item.clientId && (!row.analysisId || row.analysisId===item._id) &&
    (row.analysisId===item._id || legacyIds.includes(row._id))),
    'O resultado corrente ou adotado não pertence a esta análise. A exclusão foi bloqueada.',409,'ANALYSIS_INCONSISTENT');
  need(!await(await analyses()).findOne(scope({_id:{$ne:item._id},$or:[
    {'currentSimulation.id':{$in:linkedIds}},{'legacyReference.simulationId':{$in:linkedIds}}
  ]}),{projection:{_id:1}}),'Há uma versão compartilhada com outra análise. A exclusão foi bloqueada.',409,'ANALYSIS_INCONSISTENT');
}

async function purgeAnalysisReceipt(actor:LookupActor,receipt:AnalysisDeletionReceipt,owner?:string){
  const id=receipt.target,c=await analyses();
  // Previously removed descendants remain discoverable without retaining their fiscal data.
  const removed=await(await collection('audit')).find(scope({action:'simulation.delete',analysisId:id})).project({target:1}).toArray();
  const legacyIds=await legacyRevisionIds(id,receipt.clientId,[...new Set([...receipt.legacySimulationIds,...removed.map(row=>row.target as string)])]);
  const snapshots=await(await collection('simulations')).find(scope({clientId:receipt.clientId,
    $or:[{analysisId:id},...(legacyIds.length?[{_id:{$in:legacyIds}}]:[])]})).project({_id:1}).toArray();
  // Hide the entire owned set before physically purging any version.
  for(let offset=0;offset<snapshots.length;offset+=200){
    await(await collection('simulations')).updateMany(scope({_id:{$in:snapshots.slice(offset,offset+200).map(row=>row._id)},clientId:receipt.clientId,deletedAt:{$exists:false}}),
      {$set:{deletedAt:receipt.createdAt,deletedBy:{id:receipt.actor}}});
  }
  for(const snapshot of snapshots)await removeAnalysisSimulationSnapshot(actor,snapshot._id,receipt);
  // A failed request may have removed the snapshot before removing its queue entry.
  const reserved=await(await collection('audit')).find(scope({action:'simulation.delete',analysisId:id})).project({target:1}).toArray();
  const ids=reserved.map(row=>row.target as string);
  for(let offset=0;offset<ids.length;offset+=200){
    const batch=ids.slice(offset,offset+200);
    await(await collection('simulationReprocessItems')).deleteMany(scope({$or:[{originalId:{$in:batch}},{childId:{$in:batch}}]}));
  }
  await(await collection('analysisRevisions')).deleteMany(scope({analysisId:id,clientId:receipt.clientId}));
  await(await collection('analysisGenerationRequests')).deleteMany(scope({analysisId:id}));
  if(owner){
    const result=await c.deleteOne(scope({_id:id,clientId:receipt.clientId,deletionRevision:receipt.revision,leaseOwner:owner}));
    if(!result.deletedCount)need(!await c.findOne(scope({_id:id})),conflict().message,409,'ANALYSIS_CONFLICT');
  }else need(!await c.findOne(scope({_id:id})),conflict().message,409,'ANALYSIS_CONFLICT');
  return {deleted:true,id,clientId:receipt.clientId};
}

/** Explicitly remove one analysis and its owned results; source imports/documents are independent. */
export async function deleteAnalysis(actor:LookupActor,value:string,input:unknown){
  write(actor);const id=analysisId(value);analysisObject(input,['expectedRevision','confirmed']);
  const expected=analysisRevision(input.expectedRevision);
  need(input.confirmed===true,'Confirme a exclusão da análise e de suas versões.',400,'ANALYSIS_DELETE_CONFIRMATION');
  const prior=await analysisDeletion(id),c=await analyses();
  if(prior){
    need(prior.revision===expected,'A confirmação pertence a outra revisão da análise.',409,'ANALYSIS_CONFLICT');
    if(await c.findOne(scope({_id:id}))){
      try{return await withAnalysis(id,(_item,owner)=>purgeAnalysisReceipt(actor,prior,owner),expected,true);}
      catch(error){if(!(error instanceof AppError) || error.code!=='NOT_FOUND' || await c.findOne(scope({_id:id})))throw error;}
    }
    return purgeAnalysisReceipt(actor,prior);
  }
  return withAnalysis(id,async(item,owner)=>{
    const legacySimulationIds=adoptedSimulationIds(item);await checkDeletionOwnership(item,legacySimulationIds);
    const startedAt=item.deletionStartedAt||new Date(),deletionActor=item.deletionActor||actor._id;
    const marked=await c.updateOne(scope({_id:id,revision:expected,leaseOwner:owner,leaseUntil:{$gt:new Date()}}),
      {$set:{deletionStartedAt:startedAt,deletionActor,deletionRevision:expected}});
    need(marked.matchedCount===1,conflict().message,409,'ANALYSIS_CONFLICT');
    try{
      const receipt=await reserveAnalysisDeletion({target:id,clientId:item.clientId,revision:expected,actor:deletionActor,createdAt:startedAt,legacySimulationIds});
      return await purgeAnalysisReceipt(actor,receipt,owner);
    }catch(error){
      // No durable receipt means no purge has begun; restore the explicit retry action.
      if(!await analysisDeletion(id))await c.updateOne(scope({_id:id,leaseOwner:owner}),{$unset:{deletionStartedAt:'',deletionActor:'',deletionRevision:''}});
      throw error;
    }
  },expected,true);
}

export async function analysisVersions(id:string,page:number){
  const item=await record(id);page=integer(page,1,100000);
  const legacyIds=await legacyRevisionIds(id,item.clientId,adoptedSimulationIds(item));
  const q=scope({clientId:item.clientId,deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'},
    $or:[{analysisId:id},...(legacyIds.length?[{_id:{$in:legacyIds}}]:[])]}),c=await collection('simulations');
  const [items,total]=await Promise.all([c.find(q).project({_id:1,clientId:1,generationId:1,title:1,createdAt:1,createdBy:1,year:1,modelVersion:1,annualRevenue:1,bestRegimeName:1,bestAnnualProfit:1,
    parentSimulationId:1,analysisId:1,analysisRevision:1,reportMonths:1,analysisPeriod:1,'draft.regimeSelection':1}).sort({createdAt:-1,_id:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).toArray(),c.countDocuments(q)]);
  return {items:items.map(row=>({...row,current:row._id===item.currentSimulation?.id,legacy:!row.analysisId})),pagination:{page,pageSize:PAGE_SIZE,total,totalPages:Math.ceil(total/PAGE_SIZE)}};
}
/** Reprocessing never creates a second current, nor replaces a version edited or published in the meantime. */
export async function promoteReprocessedAnalysis(actor:LookupActor,originalId:string,child:any){
  const c=await analyses(),item=await c.findOne(scope({clientId:child.clientId,...active(),'currentSimulation.id':originalId}));if(!item || await analysisDeletion(item._id))return;
  if(item.activated && (item.currentSimulation?.analysisRevision!==item.revision || !child.analysisId))return;
  if(!item.activated){
    const updated=structuredClone(item) as Analysis;seedLegacy(updated,child,actor);
    await c.updateOne(scope({_id:item._id,...active(),revision:item.revision,activated:false,'currentSimulation.id':originalId,...leaseFree()}),
      {$set:{config:updated.config,fiscal:updated.fiscal,accounting:updated.accounting,currentSimulation:updated.currentSimulation,legacy:true,
        legacyReference:updated.legacyReference,updatedAt:new Date()},$inc:{revision:1}});
  }else await c.updateOne(scope({_id:item._id,...active(),revision:item.revision,'currentSimulation.id':originalId,...leaseFree()}),
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
      await c.updateOne(scope({_id:item._id,...active(),activated:false,leaseOwner:owner,leaseUntil:{$gt:new Date()},'currentSimulation.id':simulationId}),
        {$set:{currentSimulation:item.currentSimulation,legacy:item.legacy,config:item.config,fiscal:item.fiscal,accounting:item.accounting,
          ...(item.legacyReference?{legacyReference:item.legacyReference}:{}),updatedAt:new Date()},$inc:{revision:1}});
    }
    return result;
  });
}
