import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAnalysisDifal,savedDifalChoice} from '../public/analysis-difal-assessment.js';
// The shared view imports navigation's stylesheet hook; rendering itself is pure.
globalThis.document={querySelector:()=>({})};
const {renderDifalChoice,renderDifalAssessment,renderFiscalReports}=await import('../public/analyses-view.js');
delete globalThis.document;
import {defaultDifalPolicy} from '../public/simulator-engine.js';
import {defaultFiscalData,parseFiscalData} from '../src/analysis-contract.ts';
import {WIZARD_STEPS} from '../public/analyses-wizard.js';

const selection={version:'REGIME_SELECTION_V1',selected:['pure','hybrid']};
function fixture(){
 const job=(type,summary)=>({_id:type,clientId:'client',generationId:'generation',status:'COMPLETED',mode:type==='entry'?'PURCHASES_V1':'SALES_V1',
   reportPeriod:{startMonth:'2025-01',endMonth:'2025-09',months:9},
   [type==='entry'?'anticipationVersion':'difalVersion']:summary.version,purchaseInput:{[type==='entry'?'anticipation':'difal']:summary}});
 const entry=job('entry',{version:'ICMS_ANTICIPATION_V5',ratePercent:7.32,issuerUf:'MG',baseCents:100000,amountCents:7320,eligibleLines:1,pendingLines:0});
 const exit=job('exit',{version:'DIFAL_ESTIMATE_V6',ratePercent:10,issuerUf:'MG',baseCents:0,amountCents:0,eligibleLines:0,pendingLines:0});
 return {analysis:{clientId:'client',fiscal:{revision:0,data:{generationId:'generation'}}},
   generation:{_id:'generation',companies:[{clientId:'client',purchaseJobId:'entry',purchase:entry,salesJobId:'exit',sales:exit}]}};
}
const entry=f=>f.generation.companies[0].purchase;
const html=f=>renderDifalChoice(selection,defaultDifalPolicy(),{choice:null,assessment:assessAnalysisDifal(f)});

test('sem arquivos não presume sim, não ou valor zero',()=>{
 const f={analysis:{clientId:'client',fiscal:{data:{generationId:null}}}};
 assert.equal(assessAnalysisDifal(f).entry.state,'waiting');
 const view=html(f);assert.doesNotMatch(view,/value="(?:yes|no)"[^>]*checked/);assert.doesNotMatch(view,/data-difal-detected-amount/);
 assert.match(view,/analysis-difal-question" disabled/);assert.match(view,/Nenhuma escolha confirmada/);
});
test('leitura positiva precede qualquer escolha e exibe centavos como reais',()=>{
 const f=fixture(),before=structuredClone(f),result=assessAnalysisDifal(f);
 assert.equal(result.entry.state,'available');assert.equal(result.entry.amountCents,7320);assert.equal(result.entry.eligibleLines,1);
 const view=html(f).replaceAll('\u00a0',' ');assert.match(view,/R\$ 73,20/);assert.match(view,/R\$ 1\.000,00/);
 assert.doesNotMatch(view,/value="(?:yes|no)"[^>]*checked/);assert.match(view,/data-evidence-ready="true"/);
 assert.deepEqual(f,before);
});
test('preferência Não não mascara valor do relatório nem é trocada por Sim',()=>{
 const f=fixture(),policy=defaultDifalPolicy();policy.enabled.pure=policy.enabled.hybrid=false;
 f.analysis.fiscal.data.difalPolicy=policy;f.analysis.fiscal.data.difalChoice='no';
 const before=structuredClone(f),assessment=assessAnalysisDifal(f);
 const view=renderDifalChoice(selection,policy,{choice:'no',assessment});
 assert.equal(assessment.entry.amountCents,7320);assert.match(view,/value="no"[^>]*checked/);assert.match(view,/Sua escolha: não incluir/);
 assert.deepEqual(f,before);
});
test('zero exige leitura concluída sem operações ou pendências',()=>{
 const f=fixture();Object.assign(entry(f).purchaseInput.anticipation,{baseCents:0,amountCents:0,eligibleLines:0});
 assert.equal(assessAnalysisDifal(f).entry.state,'none');assert.equal(assessAnalysisDifal(f).entry.amountCents,0);
 const view=html(f);assert.match(view,/Sem entrada elegível/);assert.match(view,/data-evidence-ready="false"/);
 assert.doesNotMatch(view,/value="no"[^>]*checked/);
});
test('pendência e valor parcial não liberam decisão nem zero confirmado',()=>{
 const f=fixture();entry(f).purchaseInput.anticipation.pendingLines=1;
 assert.equal(assessAnalysisDifal(f).entry.state,'partial');assert.match(html(f),/data-evidence-ready="false"/);
 Object.assign(entry(f).purchaseInput.anticipation,{baseCents:0,amountCents:0,eligibleLines:0});
 const result=assessAnalysisDifal(f);assert.equal(result.entry.state,'pending');assert.equal(result.entry.amountCents,null);
});
test('documento em processamento ou upload substituto não reutiliza valor anterior',()=>{
 const f=fixture();f.documentUploads={PURCHASES:{status:'reading'}};
 assert.equal(assessAnalysisDifal(f).entry.state,'reading');assert.equal(assessAnalysisDifal(f).entry.amountCents,null);
 delete f.documentUploads;entry(f).status='PROCESSING';assert.equal(assessAnalysisDifal(f).entry.state,'reading');
 entry(f).status='INVALID';assert.equal(assessAnalysisDifal(f).entry.state,'unavailable');
});
test('erros e identidade divergente nunca confirmam ausência de DIFAL',()=>{
 for(const change of [f=>f.generationError='erro',f=>f.generationUnavailable=true,f=>f.generation._id='other',
   f=>entry(f).clientId='other',f=>entry(f)._id='old',f=>entry(f).generationId='other',f=>f.generation.companies.push({...f.generation.companies[0]})]){
  const f=fixture();change(f);const result=assessAnalysisDifal(f);assert.equal(result.entry.confirmed,false);assert.equal(result.entry.amountCents,null);
 }
});
test('resumo antigo e período fora de janeiro a setembro exigem nova conferência',()=>{
 const f=fixture();entry(f).reportPeriod={startMonth:'2025-01',endMonth:'2025-12',months:12};
 assert.equal(assessAnalysisDifal(f).entry.state,'unavailable');
 entry(f).currentAnticipation={...entry(f).purchaseInput.anticipation};
 entry(f).currentAnticipationPeriod={version:'JAN_SEP_V1',sourceYear:2025,complete:true,includedMonths:['2025-01']};
 assert.equal(assessAnalysisDifal(f).entry.state,'available');
 entry(f).currentAnticipationPeriod.complete=false;assert.equal(assessAnalysisDifal(f).entry.state,'unavailable');
});
test('saída não aplicada é regra do modelo, não conclusão de ausência de vendas',()=>{
 const result=assessAnalysisDifal(fixture());assert.equal(result.exit.state,'disabled');assert.equal(result.exit.amountCents,0);
 const view=renderDifalAssessment(result);assert.match(view,/não significa ausência de vendas interestaduais/);assert.doesNotMatch(view,/Não possui DIFAL/);
 assert.doesNotMatch(html(fixture()),/data-analysis-difal-operation="exit"/);
});
test('regra de saída permanece distinta de evidência ausente, em leitura ou com erro',()=>{
 const changes=[
  f=>f.analysis.fiscal.data.generationId=null,
  f=>f.metadataState='loading',
  f=>f.generationError='Fonte temporariamente indisponível.',
  f=>f.generation.companies[0].sales.clientId='other-client',
  f=>delete f.generation.companies[0].sales.reportPeriod,
  f=>f.generation.companies[0].sales.reportPeriod={startMonth:'2025-01',endMonth:'2025-12',months:12},
  f=>f.generation.companies[0].sales.currentDifalState='loading'
 ];
 for(const change of changes){
  const f=fixture();change(f);const before=structuredClone(f),result=assessAnalysisDifal(f);
  assert.equal(result.exit.applicationState,'disabled');assert.equal(result.exit.confirmed,false);assert.equal(result.exit.amountCents,null);
  assert.notEqual(result.exit.state,'disabled');
  const view=renderDifalAssessment(result).split('<article class="analysis-difal-exit"')[1];
  assert.match(view,/data-difal-application-state="disabled"/);assert.match(view,/Saída não aplicada pela regra da análise/);
  assert.match(view,/<p class="analysis-difal-source-note" data-difal-evidence-note>Conferência do relatório/);
  assert.doesNotMatch(view,/data-difal-detected-amount/);
  assert.deepEqual(f,before);
 }
});
test('erro de conferência da saída fica visível fora da explicação recolhida da regra',()=>{
 const f=fixture(),sales=f.generation.companies[0].sales;
 sales.currentDifal=null;sales.currentDifalState='error';sales.currentDifalError={message:'Banco de origem temporariamente indisponível.',status:503};
 const result=assessAnalysisDifal(f),view=renderDifalAssessment(result).split('<article class="analysis-difal-exit"')[1];
 assert.equal(result.entry.state,'available');assert.equal(result.entry.amountCents,7320);
 assert.equal(result.exit.state,'unavailable');assert.equal(result.exit.confirmed,false);assert.equal(result.exit.amountCents,null);
 assert.match(view,/<p class="analysis-difal-source-note" data-difal-evidence-note>Conferência do relatório pendente: Banco de origem temporariamente indisponível\.<\/p>/);
 assert.doesNotMatch(view.match(/<details[\s\S]*?<\/details>/)[0],/Banco de origem/);
});
test('cartão de saída mostra regra não aplicada e mantém período inválido como pendência explícita',()=>{
 const f=fixture();f.analysis.config={regimeSelection:selection};f.analysis.company={uf:'MG'};
 f.generation.companies[0].sales.reportPeriod={startMonth:'2025-01',endMonth:'2025-12',months:12};
 const view=renderFiscalReports({...f,canWrite:true}).replaceAll('\u00a0',' ');
 assert.match(view,/data-analysis-document-difal="SALES" data-difal-state="unavailable" data-difal-application-state="disabled"/);
 assert.match(view,/<strong data-analysis-document-difal-amount>Não aplicado<\/strong>/);
 assert.match(view,/<p data-difal-evidence-note>Conferência do relatório pendente: Não foi possível confirmar as competências/);
 assert.doesNotMatch(view,/R\$ 0,00|>Indisponível</);
});
test('preferências aguardando confirmação sobrevivem a salvar e reabrir; legado preservado',()=>{
 assert.equal(savedDifalChoice({revision:0,data:{}}),null);assert.equal(savedDifalChoice({revision:3,data:{}}),undefined);
 for(const difalChoice of [null,'yes','no'])assert.equal(savedDifalChoice({revision:3,data:{difalChoice}}),difalChoice);
 const data=defaultFiscalData(selection);data.difalChoice=null;
 assert.equal(parseFiscalData(data,selection).difalChoice,null);
 delete data.difalChoice;assert.equal(Object.hasOwn(parseFiscalData(data,selection),'difalChoice'),false);
});
test('contrato fiscal valida a decisão, sem aceitar texto arbitrário ou preferências contraditórias',()=>{
 const data=defaultFiscalData(selection);
 for(const value of [true,false,0,'automatic','maybe',{}])assert.throws(()=>parseFiscalData({...data,difalChoice:value},selection));
 assert.throws(()=>parseFiscalData({...data,difalChoice:'no'},selection));
 assert.equal(parseFiscalData({...data,difalChoice:'yes'},selection).difalChoice,'yes');
 data.difalPolicy.enabled.pure=data.difalPolicy.enabled.hybrid=false;
 assert.equal(parseFiscalData({...data,difalChoice:'no'},selection).difalChoice,'no');
 assert.throws(()=>parseFiscalData({...data,difalChoice:'yes'},selection));
});
test('Fiscal confere documentos antes de perguntar sobre inclusão',()=>{
 assert.deepEqual(WIZARD_STEPS.fiscal.map(step=>step.id),['regimes','rbt12','documents','difal']);
});
