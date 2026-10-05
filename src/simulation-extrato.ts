import {collection,scope} from './store.ts';
import {need} from './security.ts';
export const EXTRATO_VERSION = 'SIMPLES_SECTION_22_V2';
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000_000_000;
/** Reconcile the twelve stored rows; never accept a browser-provided financial source. */
export function validateSection22(result: any) {
  const valid = (ok: unknown) => need(ok, 'A seção 2.2 está incompleta ou inconsistente. Leia novamente o extrato.', 409, 'RBT12_EXTRACTION');
  valid(result?.parserVersion === EXTRATO_VERSION && result?.sourceSection === '2.2' && cents(result?.rbt12Cents));
  valid(typeof result?.pa === 'string' && /^(0[1-9]|1[0-2])\/20\d{2}$/.test(result.pa));
  valid(/^[A-Z0-9]{8}$/.test(result.cnpjBasico || ''));
  const [m,y] = result.pa.split('/').map(Number), absolute = y*12+m-1;
  const expected = Array.from({length:12},(_,i)=>{const n=absolute-12+i;return `${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;});
  valid(Array.isArray(result.rbt12Window) && result.rbt12Window.length === 12);
  const window = result.rbt12Window.map((row: any,i: number) => {
    valid(row?.month === expected[i] && row?.period === `${expected[i].slice(5)}/${expected[i].slice(0,4)}` &&
      cents(row.internalCents) && cents(row.externalCents) && cents(row.totalCents) && row.totalCents === row.internalCents+row.externalCents);
    return {period:row.period,month:row.month,internalCents:row.internalCents as number,externalCents:row.externalCents as number,totalCents:row.totalCents as number,usedInRbt12:true};
  });
  const internal = window.reduce((s:number,r:any)=>s+r.internalCents,0), external=window.reduce((s:number,r:any)=>s+r.externalCents,0);
  valid(cents(internal+external) && internal+external===result.rbt12Cents);
  valid(result.rbt12Basis?.section==='2.2' && result.rbt12Basis?.months===12 && result.rbt12Basis?.startMonth===expected[0] &&
    result.rbt12Basis?.endMonth===expected[11] && result.rbt12Basis?.internalCents===internal && result.rbt12Basis?.externalCents===external && result.rbt12Basis?.totalCents===internal+external);
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
    rbt12Cents:internal+external,rbt12CalculatedCents:internal+external,rbt12Reconciled:true,
    rbt12Basis:{section:'2.2',months:12,startMonth:expected[0],endMonth:expected[11],internalCents:internal,externalCents:external,totalCents:internal+external},
    rbt12Window:window,ocrUsed:result.ocrUsed===true,processedPages:result.processedPages||null,...processing};
}
export async function readRbt12Reference(id: string|null, clientId: string, declared: number|undefined) {
  need(id, 'Leia o Extrato do Simples Nacional. Novas simulações exigem a RBT12 calculada pela seção 2.2.', 409, 'RBT12_REQUIRED');
  const record = await (await collection('simplesExtractions')).findOne(scope({_id:id,clientId}));
  need(record && record.parserVersion===EXTRATO_VERSION, 'Leitura da seção 2.2 não encontrada para esta empresa. Leia novamente o PDF.',409,'RBT12_EXTRACTION');
  const result=validateSection22(record.result);
  need(declared!==undefined && Math.round(declared*100)===result.rbt12Cents,'A RBT12 difere da seção 2.2 do extrato. Leia o PDF novamente; não substitua por uma estimativa.',409,'RBT12_EXTRACTION');
  const client=await(await collection('clients')).findOne(scope({_id:clientId}));
  const cnpj=String(client?.cnpj||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
  need(!cnpj || cnpj.slice(0,8)===result.cnpjBasico,'O CNPJ do extrato não corresponde à empresa desta simulação.',409,'RBT12_COMPANY');
  return {id:record._id,fileName:record.fileName,fileSha256:record.fileSha256,...result};
}
