import {analysisRequest} from './analyses-api.js';
import {analysisGuidance} from './analyses-guidance.js';
import {defaultRegimeSelection} from './regime-selection.js';

const base='/api/v4/analyses';
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);

function verifyCompany(analysis,clientId,analysisId){
  if(!uuid(analysis?.id)||analysis.clientId!==clientId||(analysisId&&analysis.id!==analysisId)){
    throw new Error('Não foi possível confirmar a análise desta empresa. Atualize a página.');
  }
  return analysis;
}

export function addCompanyDreButton(host,clientId,{analysisId,generationId,difalPolicy,label='Gerar DRE',saveAccounting,setBusy}={}){
  const button=document.createElement('button'),status=document.createElement('span');
  button.type='button';button.className='report-links';button.textContent=label;
  status.setAttribute('role','status');host.append(button,status);
  let request=null;
  button.onclick=async()=>{
    if(button.disabled)return;
    button.disabled=true;setBusy?.(true);status.textContent='Conferindo os dados salvos…';
    try{
      let id=analysisId;
      if(!id){
        const list=await analysisRequest(base+'?'+new URLSearchParams({clientId,summary:'1'}));
        if(!Array.isArray(list.items)||list.items.length>1)throw new Error('Não foi possível identificar a análise da empresa.');
        let current=list.items[0];
        if(!current){
          const opened=await analysisRequest(base+'?summary=1',{method:'POST',body:{clientId,year:2027,regimeSelection:defaultRegimeSelection(),difalChoice:null,...(difalPolicy?{difalPolicy}:{})}});
          current=opened.analysis;
        }
        id=verifyCompany(current,clientId).id;
      }
      const path=base+'/'+encodeURIComponent(id);
      let analysis=verifyCompany((await analysisRequest(path)).analysis,clientId,id);
      const editor=(sector)=>'/analyses.html?'+new URLSearchParams({id,sector});
      if(generationId&&analysis.fiscal.data.generationId!==generationId){
        if(analysis.fiscal.data.generationId){
          status.replaceChildren('A análise desta empresa usa outra geração. ');
          const link=document.createElement('a');link.href=editor('fiscal');link.textContent='Conferir a análise atual';status.append(link);return;
        }
        const fiscal=analysis.fiscal;
        // Attach only to an empty slot. A concurrent import changes the sector revision.
        await analysisRequest(path+'/fiscal?summary=1',{method:'PATCH',body:{expectedSectorRevision:fiscal.revision,
          expectedConfigRevision:analysis.config.revision,complete:false,data:{...fiscal.data,generationId,monthlyOverrides:null}}});
        analysis=verifyCompany((await analysisRequest(path)).analysis,clientId,id);
        if(analysis.fiscal.data.generationId!==generationId)throw new Error('O vínculo dos relatórios foi alterado. Confira a empresa novamente.');
      }
      if(saveAccounting){
        analysis=verifyCompany(await saveAccounting(analysis),clientId,id);
        if(generationId&&analysis.fiscal.data.generationId!==generationId)throw new Error('Os relatórios da empresa foram alterados. Reabra o simulador antes de gerar.');
      }
      if(analysis.accounting.status!=='COMPLETE'){
        location.assign(editor('accounting'));return;
      }
      const guidance=analysisGuidance(analysis);
      if(guidance.currentResult){location.assign(guidance.primaryAction.href);return;}
      if(!guidance.canGenerate){
        location.assign(editor(guidance.issues.some(issue=>issue.sector==='accounting')?'accounting':'fiscal'));return;
      }
      const missing=guidance.partialGeneration?guidance.missingSectors:[];
      if(missing.includes('accounting')){location.assign(editor('accounting'));return;}
      if(missing.length&&!confirm(guidance.generationConfirmation)){status.textContent='Geração cancelada.';return;}
      if(!request||request.expectedRevision!==analysis.revision||String(request.confirmedMissingSectors||[])!==String(missing)){
        request={requestId:crypto.randomUUID(),expectedRevision:analysis.revision,...(missing.length?{confirmedMissingSectors:missing}:{})};
      }
      status.textContent='Gerando a DRE…';
      const result=await analysisRequest(path+'/generate?summary=1',{method:'POST',body:request});
      const saved=verifyCompany(result.analysis,clientId,id),simulation=result.simulation?._id;
      if(!uuid(simulation)||saved.currentSimulation?.id!==simulation)throw new Error('A geração da DRE ainda não foi confirmada. Tente novamente.');
      location.assign('/simulator.html?'+new URLSearchParams({simulation,current:'1'}));
    }catch(error){status.textContent=error.message;}
    finally{setBusy?.(false);button.disabled=false;}
  };
}
