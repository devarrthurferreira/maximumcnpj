import {collection,scope} from './store.ts';
import {need} from './security.ts';
import {reconcileSection22Extraction} from '../public/simulator-rbt12.js';
import {requiresSimplesReference} from '../public/regime-selection.js';
export const EXTRATO_VERSION = 'SIMPLES_SECTION_22_V2';
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000_000_000;
/** A missing/failed PDF never silently becomes a manual or projected RBT12. */
export function rbt12InputSource(source: unknown, manualConfirmed: unknown, extractionId: string|null, declared: number|null|undefined, regimeSelection?:unknown) {
  if(!requiresSimplesReference(regimeSelection)){
    need((source===undefined || source==='NOT_REQUIRED') && manualConfirmed===undefined && !extractionId && declared==null,
      'Sem regimes do Simples selecionados, não envie extrato, confirmação manual ou uma RBT12 fictícia.',400,'RBT12_SOURCE');
    return 'NOT_REQUIRED' as const;
  }
  need(source === undefined || source === 'SIMPLES_SECTION_22' || source === 'MANUAL' || source === 'NOT_PROVIDED',
    'Escolha não informar a RBT12, preencher o valor manualmente ou usar o extrato.', 400, 'RBT12_SOURCE');
  if(source==='NOT_PROVIDED'){
    need(manualConfirmed===undefined && !extractionId && declared==null,
      'Sem RBT12 informada, deixe o valor vazio e desvincule o extrato e a confirmação manual.',400,'RBT12_SOURCE');
    return 'NOT_PROVIDED' as const;
  }
  if (source !== 'MANUAL') {
    need(manualConfirmed === undefined, 'A confirmação manual exige selecionar a opção sem extrato.', 400, 'RBT12_SOURCE');
    return 'SIMPLES_SECTION_22' as const;
  }
  need(!extractionId, 'Use o extrato ou a informação manual, sem misturar as duas origens da RBT12.', 400, 'RBT12_SOURCE');
  need(manualConfirmed === true, 'Confirme a RBT12 informada manualmente antes de gerar a simulação.', 400, 'RBT12_CONFIRMATION');
  need(declared != null && cents(Math.round(declared * 100)) && declared === Math.round(declared * 100) / 100,
    'Informe a receita bruta dos 12 meses anteriores ao período de apuração. Use 0 somente quando esse for o valor real.', 400, 'RBT12_REQUIRED');
  return 'MANUAL' as const;
}
/** Reconcile the PA window and preserve all stored 2.2 rows for monthly rolling windows. */
export function validateSection22(result: any) {
  const valid = (ok: unknown) => need(ok, 'A seção 2.2 está incompleta ou inconsistente. Leia novamente o extrato.', 409, 'RBT12_EXTRACTION');
  valid(result?.parserVersion === EXTRATO_VERSION && result?.sourceSection === '2.2' && cents(result?.rbt12Cents));
  valid(typeof result?.pa === 'string' && /^(0[1-9]|1[0-2])\/20\d{2}$/.test(result.pa));
  valid(/^[A-Z0-9]{8}$/.test(result.cnpjBasico || ''));
  const reconciled=(()=>{try{return reconcileSection22Extraction(result);}catch{
    need(false,'A seção 2.2 está incompleta ou inconsistente. Leia novamente o extrato.',409,'RBT12_EXTRACTION');
  }})();
  const processing: Record<string, unknown> = {};
  for(const [key,allowed] of [['extractionScope',['SECTION_22','FULL_DOCUMENT']],['searchablePdfScope',['SELECTED_PAGES','FULL_DOCUMENT']]] as const) {
    if(result[key]!==undefined) {valid((allowed as readonly unknown[]).includes(result[key]));processing[key]=result[key];}
  }
  if(result.pageCount!==undefined) {valid(Number.isInteger(result.pageCount)&&result.pageCount>=1&&result.pageCount<=30);processing.pageCount=result.pageCount;}
  for(const key of ['processedPageNumbers','preservedPages','ocrPages']) {
    if(result[key]===undefined)continue;
    valid(Array.isArray(result[key])&&result[key].length<=30&&new Set(result[key]).size===result[key].length&&
      result[key].every((page:unknown)=>typeof page==='number'&&Number.isInteger(page)&&page>=1&&page<=(result.pageCount??30)));
    processing[key]=[...result[key]];
  }
  return {parserVersion:EXTRATO_VERSION,sourceSection:'2.2',pa:result.pa,cnpjBasico:result.cnpjBasico,
    companyName:typeof result.companyName==='string'?result.companyName.slice(0,200):null,
    ...reconciled,rbt12CalculatedCents:reconciled.rbt12Cents,rbt12Reconciled:true,
    ocrUsed:result.ocrUsed===true,processedPages:result.processedPages||null,...processing};
}
export async function readRbt12Reference(id: string|null, clientId: string, declared: number|null|undefined) {
  need(id, 'Leia o Extrato do Simples Nacional ou escolha informar e confirmar a RBT12 manualmente.', 409, 'RBT12_REQUIRED');
  const record = await (await collection('simplesExtractions')).findOne(scope({_id:id,clientId}));
  need(record && record.parserVersion===EXTRATO_VERSION, 'Leitura da seção 2.2 não encontrada para esta empresa. Leia novamente o PDF.',409,'RBT12_EXTRACTION');
  const result=validateSection22(record.result);
  need(declared!=null && Math.round(declared*100)===result.rbt12Cents,'A RBT12 difere da seção 2.2 do extrato. Leia o PDF novamente; não substitua por uma estimativa.',409,'RBT12_EXTRACTION');
  const client=await(await collection('clients')).findOne(scope({_id:clientId}));
  const cnpj=String(client?.cnpj||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  need(!cnpj || cnpj.slice(0,8)===result.cnpjBasico,'O CNPJ do extrato não corresponde à empresa desta simulação.',409,'RBT12_COMPANY');
  return {id:record._id,fileName:record.fileName,fileSha256:record.fileSha256,...result};
}
