import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {collection, scope, audit} from './store.ts';
import type {Doc} from './store.ts';
import {AppError, need, digest} from './security.ts';
import {write} from './lookup-db.ts';
import type {LookupActor} from './lookup-db.ts';
import {getSimulation, createReprocessedSimulation} from './simulation-history.ts';
import {rebuildSimulationSource} from './simulation-reprocessing-source.ts';
import {assertGenerationNotDeleted} from './generation-deletion.ts';
import {validateSection22} from './simulation-extrato.ts';
import {buildRbt12Schedule} from '../public/simulator-rbt12.js';
import {annualizeReports, REPORT_GROUPS} from '../public/simulator-projection.js';
import type {ReportGroup} from '../public/simulator-projection.js';

import {baselineMonth, calculateMonthlySimulation, MONTHLY_MODEL_VERSION as MODEL_VERSION} from '../public/simulator-monthly.js';
import {buildMonthlyDre} from '../public/simulator-calendar.js';
import {resolveDifalApplication, upgradeDifalPolicy} from '../public/simulator-engine.js';
import {REPROCESS_VERSION} from '../public/simulation-reprocess-contract.js';


export {REPROCESS_VERSION};
export const SERVICE_REVENUE_MIGRATION_REVISION = 'LEGACY_ADDITIONAL_SERVICES_V1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PAGE_SIZE = 100;
const key = () => 'simulation-reprocessing:' + digest(JSON.stringify([scope().workspaceId, REPROCESS_VERSION]));
const itemId = (originalId: string) => key() + ':' + originalId;
export function reprocessedSimulationId(workspaceId: string, originalId: string) {
  const value = digest(JSON.stringify([workspaceId, originalId, REPROCESS_VERSION, MODEL_VERSION]));
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
}
function pending(condition: unknown, code: string, message: string): asserts condition {
  need(condition, message, 409, code);
}
function moneyCents(value: unknown, signed = false): number {
  pending(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000 &&
    (signed || value >= 0) && value === Math.round(value * 100) / 100, 'REPROCESS_INPUT', 'O histórico possui um valor financeiro ausente ou inválido.');
  return Math.round((value as number) * 100);
}

/** All arguments come from stored, scoped server records. Deltas use the frozen old baseline. */
export function planReprocessing(original: any, source: any, workspaceId: string) {
  pending(UUID.test(original?._id || '') && UUID.test(original?.generationId || '') && UUID.test(original?.clientId || ''),
    'REPROCESS_IDENTITY', 'O histórico não possui identificação completa de empresa e geração.');
  pending(source.generationId === original.generationId && source.clientId === original.clientId &&
    source.purchases.jobId === original.source?.purchases?.jobId && source.sales.jobId === original.source?.sales?.jobId,
    'REPROCESS_SOURCE', 'Os relatórios disponíveis não correspondem aos relatórios originais desta simulação.');
  pending(Number.isInteger(original.reportMonths) && original.reportMonths >= 1 && original.reportMonths <= 12 && original.periodConfirmed === true,
    'REPROCESS_PERIOD', 'O histórico não possui um período mensal confirmado.');
  pending(source.periodBasis !== 'COLUMN_H' || source.reportMonths === original.reportMonths,
    'REPROCESS_PERIOD', 'O período dos relatórios diverge do período confirmado no histórico.');
  pending((source.sales.totalCents === original.source.sales.totalCents || source.reprocessingSource?.originalSalesTotalCents === original.source.sales.totalCents) &&
    source.purchases.totalCents === original.source.purchases.totalCents,
    'REPROCESS_SOURCE_TOTAL', 'Os totais dos relatórios originais não reconciliam com o histórico.');
  const oldPeriod = original.reportPeriod || original.source.period;
  if(oldPeriod)pending(source.period && oldPeriod.startMonth === source.period.startMonth && oldPeriod.endMonth === source.period.endMonth && oldPeriod.months === source.period.months,
    'REPROCESS_PERIOD', 'As competências inicial e final diferem das competências congeladas no histórico.');
  const modern=original.result?.method==='REPORT_MONTHS_V1'&&Array.isArray(original.monthlyInputs);
  const p = annualizeReports(source.fields, original.reportMonths);
  pending(p.monthlyGroupsCents.serviceRevenueCents !== undefined, 'REPROCESS_SERVICES', 'A separação dos serviços não está disponível na origem.');
  const frozen = original.baselineMonthlyGroups || (original.projection?.monthlyGroupsCents &&
    Object.fromEntries(REPORT_GROUPS.map(field=>[field,original.projection.monthlyGroupsCents[field]/100])));
  pending(frozen && original.monthlyGroupsUnit === 'BRL' && original.monthlyGroups && original.draft?.values,
    'REPROCESS_BASELINE', 'O histórico não conserva a base mensal necessária para preservar os ajustes manuais.');
  pending(moneyCents(original.draft.values.salesRevenue) === REPORT_GROUPS.slice(0,3).reduce((sum,field)=>sum+moneyCents(original.monthlyGroups[field],true),0) &&
    moneyCents(original.draft.values.simplePurchases) === moneyCents(original.monthlyGroups.purchasesOptantCents) &&
    moneyCents(original.draft.values.regularPurchases) === moneyCents(original.monthlyGroups.purchasesNonOptantCents),
    'REPROCESS_INPUT_TOTAL','As receitas ou compras do cenário antigo não correspondem aos grupos mensais congelados.');
  if(original.projection?.monthlyGroupsCents)pending(original.projection.unit === 'CENTS' && original.projection.reportMonths === original.reportMonths &&
    REPORT_GROUPS.every((field,index)=>moneyCents(frozen[field],index<3) === original.projection.monthlyGroupsCents[field]),
    'REPROCESS_BASELINE','A base mensal antiga diverge da projeção congelada no histórico.');
  const monthlyGroups = Object.fromEntries(REPORT_GROUPS.map((field, index) => {
    if(modern)return [field,moneyCents(original.monthlyGroups[field],index<3)/100];
    const delta = moneyCents(original.monthlyGroups[field], index < 3) - moneyCents(frozen[field], index < 3);
    const adjusted = p.monthlyGroupsCents[field] + delta;
    pending(Number.isSafeInteger(adjusted) && (index < 3 || adjusted >= 0), 'REPROCESS_ADJUSTMENT', 'Um ajuste antigo produziria compras negativas ou valor fora do limite.');
    return [field, adjusted / 100];
  })) as Record<ReportGroup,number>;
  const draft = structuredClone(original.draft), priorService = moneyCents(draft.values.serviceRevenue);
  // Upgrade only the linked revision. Frozen requests and original snapshots retain
  // their exact legacy policy, while the new draft records the current directions.
  try { draft.difalPolicy = upgradeDifalPolicy(Object.hasOwn(draft, 'difalPolicy') ? draft.difalPolicy : original.source?.difalPolicy); }
  catch (error) { throw new AppError(409, 'REPROCESS_ADJUSTMENT', error instanceof Error ? error.message : 'Opções de DIFAL inválidas.'); }
  const oldSplit = original.source?.revenueSplit?.version === 'SALES_SERVICES_V1';
  if(!oldSplit)pending(!Object.hasOwn(original.source,'revenueSplit') &&
    !Object.hasOwn(original.source.fields || {},'serviceRevenueCents') && original.baselineServiceRevenue == null &&
    !Object.hasOwn(original.projection?.monthlyGroupsCents || {},'serviceRevenueCents'),
    'REPROCESS_SERVICES','O histórico possui indicadores de serviços separados sem uma versão de contrato reconhecida.');
  const newService = p.monthlyGroupsCents.serviceRevenueCents;
  let serviceRevenueMigration = null;
  if (oldSplit) {
    const baselineService = original.baselineServiceRevenue ?? (original.projection?.monthlyGroupsCents?.serviceRevenueCents === undefined ? undefined : original.projection.monthlyGroupsCents.serviceRevenueCents/100);
    pending(baselineService !== undefined, 'REPROCESS_BASELINE', 'O histórico não conserva a base original de serviços.');
    if(original.projection?.monthlyGroupsCents?.serviceRevenueCents !== undefined)pending(
      moneyCents(baselineService) === original.projection.monthlyGroupsCents.serviceRevenueCents,
      'REPROCESS_BASELINE','A base original de serviços diverge da projeção congelada no histórico.');
    draft.values.serviceRevenue = modern?priorService/100:(newService + priorService - moneyCents(baselineService)) / 100;
  } else {
    // The old form explicitly instructed users not to repeat services already in sales.
    // Its monthly service input therefore supplements the imported revenue. Move the
    // imported service baseline out of goods, preserving that additional amount once.
    const appliedService = newService + priorService;
    pending(Number.isSafeInteger(appliedService), 'REPROCESS_ADJUSTMENT', 'A receita de serviços ultrapassa o limite de cálculo.');
    draft.values.serviceRevenue = appliedService / 100;
    serviceRevenueMigration = {revision:SERVICE_REVENUE_MIGRATION_REVISION,policy:'ADDITIONAL_TO_REPORT' as const,unit:'CENTS' as const,
      sourceJobId:source.sales.jobId,reportMonths:original.reportMonths,sourceServiceTotalCents:source.fields.serviceRevenueCents,
      reportMonthlyServiceCents:newService,priorMonthlyServiceCents:priorService,appliedMonthlyServiceCents:appliedService,
      warning:'Os serviços manuais antigos foram preservados como receita mensal adicional aos serviços do relatório, conforme a orientação do formulário original.'};
  }
  draft.values.salesRevenue = REPORT_GROUPS.slice(0,3).reduce((sum, field) => sum + moneyCents(monthlyGroups[field], true), 0) / 100;
  draft.values.simplePurchases = monthlyGroups.purchasesOptantCents;
  draft.values.regularPurchases = monthlyGroups.purchasesNonOptantCents;
  pending(original.result?.method==='REPORT_MONTHS_V1'||(draft.values.salesRevenue >= 0 && draft.values.serviceRevenue >= 0), 'REPROCESS_ADJUSTMENT',
    'Os ajustes antigos produziriam receita negativa após separar mercadorias e serviços.');
  pending(draft.rbt12 !== undefined, 'RBT12_REQUIRED', 'O histórico não conserva uma RBT12 efetiva. A receita mensal projetada em doze meses não substitui essa informação.');
  moneyCents(draft.rbt12);
  let rbt12Extraction = null, rbt12Manual = null;
  let rbt12Source: 'MANUAL' | 'SIMPLES_SECTION_22';
  if (original.rbt12Source === 'MANUAL') {
    pending(original.rbt12Manual?.source === 'MANUAL' && original.rbt12Manual?.confirmed === true &&
      original.rbt12Manual.rbt12Cents === moneyCents(draft.rbt12) && original.rbt12Manual.confirmedBy?.id && original.rbt12Manual.confirmedAt,
      'RBT12_REQUIRED', 'A confirmação original da RBT12 manual não está disponível.');
    rbt12Source = 'MANUAL'; rbt12Manual = structuredClone(original.rbt12Manual);
  } else {
    pending(original.rbt12Source === 'SIMPLES_SECTION_22' && original.rbt12Extraction,
      'RBT12_REQUIRED', 'O histórico não conserva uma RBT12 efetiva validada; a projeção anual não pode substituí-la.');
    const checked = validateSection22(original.rbt12Extraction);
    pending(checked.rbt12Cents === moneyCents(draft.rbt12) && UUID.test(original.rbt12Extraction.id || ''),
      'RBT12_EXTRACTION', 'A RBT12 e sua identificação não reconciliam com o extrato congelado.');
    rbt12Source = 'SIMPLES_SECTION_22';
    rbt12Extraction = {id: original.rbt12Extraction.id, fileName: original.rbt12Extraction.fileName,
      fileSha256: original.rbt12Extraction.fileSha256, ...checked};
  }
  pending(source.monthlyReports,'SIMULATION_MONTHS','Reimporte compras e vendas com as datas da coluna H para calcular cada competência.');
  const monthlyInputs=source.monthlyReports.map((row:any)=>{
    const entry=baselineMonth(row,draft.values);
    if(modern)return entry;
    for(const field of REPORT_GROUPS)entry.groups[field]=(row.fields[field]+moneyCents(monthlyGroups[field],true)-p.monthlyGroupsCents[field])/100;
    entry.values.serviceRevenue=(row.fields.serviceRevenueCents+moneyCents(draft.values.serviceRevenue)-p.monthlyGroupsCents.serviceRevenueCents!)/100;
    return entry;
  });
  // Versions already using monthly values retain every individual adjustment.
  if(original.monthlyInputs && original.result?.method==='REPORT_MONTHS_V1'){
    pending(original.monthlyInputs.length===monthlyInputs.length&&Array.isArray(original.source.monthlyReports)&&
      original.source.monthlyReports.length===monthlyInputs.length,'REPROCESS_PERIOD','A quantidade de competências antigas não corresponde aos relatórios.');
    for(let i=0;i<monthlyInputs.length;i++){
      const oldRow=original.source.monthlyReports?.[i],oldInput=original.monthlyInputs[i];
      pending(oldRow?.sourceMonth===monthlyInputs[i].sourceMonth&&oldInput?.sourceMonth===oldRow.sourceMonth,'REPROCESS_PERIOD','As competências antigas não reconciliam.');
      const base=baselineMonth(oldRow);
      for(const field of REPORT_GROUPS)monthlyInputs[i].groups[field]=(source.monthlyReports[i].fields[field]+moneyCents(oldInput.groups[field],true)-moneyCents(base.groups[field],true))/100;
      monthlyInputs[i].values={...oldInput.values,serviceRevenue:(source.monthlyReports[i].fields.serviceRevenueCents+moneyCents(oldInput.values.serviceRevenue)-moneyCents(base.values.serviceRevenue))/100};
    }
  }
  Object.assign(monthlyGroups,monthlyInputs[0].groups);
  draft.values={...monthlyInputs[0].values,salesRevenue:REPORT_GROUPS.slice(0,3).reduce((sum,key)=>sum+moneyCents(monthlyGroups[key],true),0)/100,
    simplePurchases:monthlyGroups.purchasesOptantCents,regularPurchases:monthlyGroups.purchasesNonOptantCents};
  const rbt12Schedule=rbt12Extraction?buildRbt12Schedule(rbt12Extraction,source.monthlyReports.map((row:any)=>row.sourceMonth)):null;
  pending(!rbt12Schedule||rbt12Schedule.complete,'RBT12_MONTHS_MISSING',`O extrato congelado não cobre todas as competências. Reimporte o extrato com as receitas mensais do quadro 2.2. ${rbt12Schedule?.rows.filter(row=>row.status!=='CONFIRMED').map(row=>`${row.sourceMonth}: faltam ${row.missingMonths.join(', ')}`).join('; ')||''}`);
  const computed=(()=>{try{return calculateMonthlySimulation(draft,source.monthlyReports,monthlyInputs,source.sales.jobId,rbt12Schedule);}catch(error){throw new AppError(409,'REPROCESS_ADJUSTMENT',error instanceof Error?error.message:'Valores mensais inválidos.');}})();
  for (const [index, report] of source.monthlyReports.entries()) {
    const input = computed.engineInput.months[index].input;
    const applications = computed.result.monthlyResults[index].result.regimes.filter((regime: any) => regime.available).map((regime: any) => resolveDifalApplication({
      policy: draft.difalPolicy, regimeId: regime.id, rbt12: input.rbt12, icmsOutside: input.icmsOutside
    }));
    // A pending estimate matters only in a month and regime that can apply it.
    // Eligibility is independent of its amount: pending rows can have zero cents.
    if (applications.some((application: any) => application.salesDifal)) {
      pending(report.difal, 'DIFAL_SOURCE_MISSING', `O relatório original não possui os dados necessários para confirmar o DIFAL em ${report.sourceMonth}.`);
      pending(report.difal.pendingLines === 0, 'DIFAL_UF_PENDING', `Há linhas aguardando UF para confirmar o DIFAL em ${report.sourceMonth}.`);
    }
    if (applications.some((application: any) => application.purchaseAnticipation)) {
      pending(report.anticipation, 'ANTICIPATION_SOURCE_MISSING', `O relatório original não possui os dados necessários para confirmar o DIFAL de entrada em ${report.sourceMonth}.`);
      pending(report.anticipation.pendingLines === 0, 'ANTICIPATION_UF_PENDING', `Há compras aguardando UF para confirmar a antecipação de ICMS em ${report.sourceMonth}.`);
    }
  }
  const alreadyCurrent=modern&&isDeepStrictEqual(original.result,computed.result)&&isDeepStrictEqual(original.projection,computed.projection)&&
    isDeepStrictEqual(original.difalProjection,computed.difalProjection)&&isDeepStrictEqual(original.engineInput,computed.engineInput)&&
    isDeepStrictEqual(original.monthlyDre,buildMonthlyDre(computed.result,draft.year,rbt12Extraction||rbt12Manual,source.period||null));
  const input = {simulationId: reprocessedSimulationId(workspaceId, original._id), generationId: original.generationId,
    clientId: original.clientId, parentSimulationId: original._id, title: String(original.title || source.company.name).slice(0,140) + ' · Atualizada',
    reportMonths: original.reportMonths, periodConfirmed: true, monthlyGroups, draft, monthlyInputs,
    ...(rbt12Source === 'MANUAL' ? {rbt12Source, rbt12ManualConfirmed: true} : {rbt12ExtractionId: rbt12Extraction!.id})};
  return {alreadyCurrent, input, context: {version: REPROCESS_VERSION, originalId: original._id, source, rbt12Extraction, rbt12Manual, serviceRevenueMigration}};
}

async function status(page = 1, retryAfterMs = 0) {
  const batch = await (await collection('simulationReprocessBatches')).findOne(scope({_id:key()}));
  const c = await collection('simulationReprocessItems');
  const filter = scope({batchId:key()});
  const groups = await c.aggregate([{$match:filter}, {$group:{_id:'$status',count:{$sum:1}}}]).toArray();
  const counts = {queued:0,processing:0,ok:0,pending:0,failed:0};
  for (const group of groups) if (Object.hasOwn(counts, String(group._id).toLowerCase())) counts[String(group._id).toLowerCase() as keyof typeof counts] = group.count;
  const total = Object.values(counts).reduce((sum,value)=>sum+value,0);
  const retryableFailed = await c.countDocuments({...filter,status:'FAILED',attempts:{$lt:3}});
  const items = await c.find(filter).project({_id:0,originalId:1,childId:1,status:1,code:1,message:1,company:1,title:1,updatedAt:1}).sort({updatedAt:-1,originalId:1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE).toArray();
  const hasMore = !!batch && (!batch.inventoryComplete || counts.queued > 0 || counts.processing > 0);
  return {version:REPROCESS_VERSION,modelVersion:MODEL_VERSION,startedAt:batch?.startedAt || null,updatedAt:batch?.updatedAt || null,leaseExpiresAt:batch?.leaseUntil || null,retryableFailed,
    total,counts,inventoryComplete:batch?.inventoryComplete === true,hasMore,retryAfterMs:hasMore ? retryAfterMs || 1200 : 0,
    items,page,pageSize:PAGE_SIZE,totalPages:Math.ceil(total/PAGE_SIZE)};
}
export async function simulationReprocessingStatus(page = 1) { return status(page); }

async function inventory(batch: Doc) {
  const records = await (await collection('simulations')).find(scope({deletedAt:{$exists:false},reprocessing:{$exists:false},
    createdAt:{$lte:batch.startedAt},...(batch.cursor ? {_id:{$gt:batch.cursor}} : {})})).project({_id:1,title:1,company:1}).sort({_id:1}).limit(500).toArray();
  if (records.length) await (await collection('simulationReprocessItems')).bulkWrite(records.map(record=>({updateOne:{
    filter:scope({_id:itemId(record._id)}),update:{$setOnInsert:{...scope(),_id:itemId(record._id),batchId:key(),originalId:record._id,
      childId:null,status:'QUEUED',code:'QUEUED',message:'Aguardando recálculo.',title:record.title,company:record.company,updatedAt:new Date()}},upsert:true}})),{ordered:false});
  if(records.length) {
    const ids=records.map(record=>record._id);
    const live=await (await collection('simulations')).find(scope({_id:{$in:ids},deletedAt:{$exists:false}})).project({_id:1}).toArray();
    const liveIds=new Set(live.map(record=>record._id)),removed=ids.filter(id=>!liveIds.has(id));
    // Deletion may win between inventory read and upsert. Do not retain its copied
    // company/title in the batch; a later deletion also purges these items itself.
    if(removed.length)await (await collection('simulationReprocessItems')).deleteMany(scope({batchId:key(),originalId:{$in:removed}}));
  }
  await (await collection('simulationReprocessBatches')).updateOne(scope({_id:key(),leaseOwner:batch.leaseOwner}),{$set:{
    ...(records.length ? {cursor:records.at(-1)!._id} : {}),inventoryComplete:records.length<500,updatedAt:new Date()}});
}

async function reprocessItem(actor: LookupActor, item: Doc) {
  const original = await getSimulation(item.originalId);
  const targetId = reprocessedSimulationId(scope().workspaceId, original._id);
  // A completed child is recognized across operators and without re-reading mutable sources.
  const existing = await (await collection('simulations')).findOne(scope({_id:targetId,deletedAt:{$exists:false}}));
  if (existing?.reprocessing?.version === REPROCESS_VERSION && existing.reprocessing.originalId === original._id) {
    const child = await getSimulation(targetId);
    pending(child.parentSimulationId === original._id && child.clientId === original.clientId && child.generationId === original.generationId,
      'REPROCESS_SOURCE', 'A versão corrigida não corresponde ao histórico original.');
    pending(planReprocessing(child,child.source,scope().workspaceId).alreadyCurrent,'REPROCESS_CHILD_INVALID','A versão corrigida existente não passou na conferência dos cálculos armazenados.');
    return {childId:targetId,status:'OK',code:'UPDATED',message:'Versão corrigida já criada e preservada.'};
  }
  const purchaseJobId = original.source?.purchases?.jobId, salesJobId = original.source?.sales?.jobId;
  pending(UUID.test(purchaseJobId || '') && UUID.test(salesJobId || ''), 'REPROCESS_SOURCE', 'Os relatórios originais não estão identificados neste histórico.');
  await assertGenerationNotDeleted(original.generationId);
  const source = await rebuildSimulationSource(original);
  pending(source.reprocessingSource.missingOperationEvidenceLines === 0, 'SOURCE_OPERATION_MISSING',
    'Há linhas antigas sem natureza e sem descrição para reconstruir a classificação das operações com segurança.');
  const plan = planReprocessing(original, source, scope().workspaceId);
  if (plan.context.rbt12Extraction) {
    const client = await (await collection('clients')).findOne(scope({_id:original.clientId}),{projection:{cnpj:1}});
    const cnpj = String(client?.cnpj || '').replace(/[^A-Z0-9]/gi,'').toUpperCase();
    pending(!cnpj || cnpj.slice(0,8) === plan.context.rbt12Extraction.cnpjBasico, 'RBT12_COMPANY', 'O extrato congelado não corresponde ao CNPJ da empresa.');
  }
  if (plan.alreadyCurrent) return {childId:null,status:'OK',code:'ALREADY_CURRENT',message:'Simulação conferida: cálculos e fontes já correspondem às regras atuais.'};
  const child = await createReprocessedSimulation(actor, plan.input, plan.context);
  const migration = plan.context.serviceRevenueMigration;
  return {childId:child._id,status:'OK',code:'UPDATED',message:'Simulação refeita com DIFAL de entrada e saída somente no Simples puro e híbrido, conforme as escolhas. Original preservado.' +
    (migration && migration.priorMonthlyServiceCents > 0 ? ' ' + migration.warning : '')};
}

export async function reprocessSimulations(actor: LookupActor, input: unknown) {
  write(actor);
  need(input == null || (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key=>key==='retryFailed') &&
    (!Object.hasOwn(input,'retryFailed') || (input as any).retryFailed === true)), 'O recálculo usa somente os históricos armazenados; não envie valores ou identificadores.');
  const batches = await collection('simulationReprocessBatches'), now = new Date();
  try { await batches.updateOne(scope({_id:key()}),{$setOnInsert:{...scope(),_id:key(),version:REPROCESS_VERSION,startedAt:now,updatedAt:now,inventoryComplete:false}}, {upsert:true}); }
  catch(error:any) { if(error.code!==11000)throw error; }
  const owner = randomUUID();
  const batch = await batches.findOneAndUpdate(scope({_id:key(),$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:now}}]}),
    {$set:{leaseOwner:owner,leaseUntil:new Date(Date.now()+90000)}},{returnDocument:'after'});
  if(!batch)return status(1,10000);
  const items = await collection('simulationReprocessItems'), start = Date.now();
  try {
    await items.createIndex({workspaceId:1,batchId:1,status:1,originalId:1});
    // Only the workspace lease owner can claim work. Recover interrupted requests after lease expiry.
    await items.updateMany(scope({batchId:key(),status:'PROCESSING'}),{$set:{status:'QUEUED',code:'QUEUED',message:'Retomando recálculo interrompido.',updatedAt:new Date()}});
    // Revisit only the obsolete ambiguity gate, once for this documented policy.
    // Keep batch/child IDs stable; completed, deleted and other pending items stay untouched.
    await items.updateMany(scope({batchId:key(),status:'PENDING',code:'SERVICE_REVENUE_AMBIGUOUS',
      serviceRevenueMigrationRevision:{$ne:SERVICE_REVENUE_MIGRATION_REVISION}}),{$set:{status:'QUEUED',code:'QUEUED',
      serviceRevenueMigrationRevision:SERVICE_REVENUE_MIGRATION_REVISION,
      message:'Retomando a separação dos serviços com a regra documentada do formulário original.',updatedAt:new Date()}});
    if((input as any)?.retryFailed === true)await items.updateMany(scope({batchId:key(),status:'FAILED',attempts:{$lt:3}}),{$set:{status:'QUEUED',code:'QUEUED',message:'Nova tentativa solicitada para falha de processamento.',updatedAt:new Date()}});
    if(!batch.inventoryComplete)await inventory(batch);
    for(let count=0;count<3 && Date.now()-start<22000;count++) {
      const item = await items.findOneAndUpdate(scope({batchId:key(),status:'QUEUED'}),{$set:{status:'PROCESSING',processingOwner:owner,updatedAt:new Date()},$inc:{attempts:1}},{sort:{originalId:1},returnDocument:'after'});
      if(!item)break;
      let outcome;
      try { outcome = await reprocessItem(actor,item); }
      catch(error:any) {
        const expected = typeof error?.status === 'number' && error.status < 500;
        outcome = {childId:null,status:expected?'PENDING':'FAILED',code:expected?error.code || 'REPROCESS_PENDING':'REPROCESS_FAILED',
          message:expected?error.message:'Não foi possível concluir este recálculo. O histórico original foi preservado.'};
      }
      await items.updateOne(scope({_id:item._id,status:'PROCESSING',processingOwner:owner}),{$set:{...outcome,updatedAt:new Date()},$unset:{processingOwner:''}});
      await audit(actor._id,'simulation.reprocess.'+outcome.status.toLowerCase(),item.originalId);
    }
    await batches.updateOne(scope({_id:key(),leaseOwner:owner}),{$set:{updatedAt:new Date()}});
  } finally { await batches.updateOne(scope({_id:key(),leaseOwner:owner}),{$unset:{leaseOwner:'',leaseUntil:''}}); }
  return status();
}
