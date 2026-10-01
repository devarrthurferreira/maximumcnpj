/** Synthetic structured response for persistence/browser tests. No real taxpayer data. */
export function section22(totalCents=15_000_000) {
 const start=2025*12+7;
 const rows=Array.from({length:12},(_,i)=>{
  const absolute=start+i,year=Math.floor(absolute/12),month=String(absolute%12+1).padStart(2,'0');
  const value=Math.floor(totalCents/12)+(i<totalCents%12?1:0);
  return {period:`${month}/${year}`,month:`${year}-${month}`,internalCents:value,externalCents:0,totalCents:value,usedInRbt12:true};
 });
 return {parserVersion:'SIMPLES_SECTION_22_V2',sourceSection:'2.2',documentType:'EXTRATO_SIMPLES_NACIONAL',pa:'08/2026',
  cnpjBasico:'12345678',companyName:'EMPRESA SINTÉTICA',rbt12Cents:totalCents,rbt12CalculatedCents:totalCents,rbt12Reconciled:true,
  rbt12Window:rows,priorRevenues:rows,rbt12Basis:{section:'2.2',startMonth:'2025-08',endMonth:'2026-07',months:12,internalCents:totalCents,externalCents:0,totalCents},
  processedPages:3,pageCount:3,ocrUsed:true,ocrPages:[1,2,3],ocrEngine:'MOCK',warnings:[]};
}
