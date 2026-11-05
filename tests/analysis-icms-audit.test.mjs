import test from 'node:test';
import assert from 'node:assert/strict';
import {renderIcmsSalesAudit} from '../public/analysis-icms-audit.js';
import {summarizeIcmsOperations} from '../public/simulator-icms.js';
globalThis.document={querySelector:()=>({})};
const {renderFiscalComposition}=await import('../public/analyses-view.js');
delete globalThis.document;

const line=(natureCode,totalCents,recipientUf,documentSpecies)=>({natureCode,totalCents,recipientUf,documentSpecies});
const month=(sourceMonth,sales,purchases,salesSpecies)=>({sourceMonth,salesSpecies,
  icmsOperations:summarizeIcmsOperations({sourceMonth,sales,purchases,issuerUf:'MG'})});
const species=(nfceLines,nfceBaseCents,missingLines=0)=>({version:'SALES_SPECIES_V1',nfceLines,nfceBaseCents,missingLines,missingBaseCents:0});
const text=value=>value.replaceAll('\u00a0',' ');

test('conferência mostra NFC-e interna, NF-e interestadual e devolução sem misturar crédito',()=>{
  const report=month('2025-01',[
    line('5102',100000,'RJ','NFCE'),line('5102',200000,'MG','NFE'),line('6102',50000,'SP','NFE')
  ],[line('1202',20000,'MG')],species(1,100000));
  const view=text(renderIcmsSalesAudit({monthlyReports:[report]}));
  assert.match(view,/1 linhas · R\$ 1\.000,00/);
  assert.match(view,/Vendas internas · 18%<\/dt><dd>Base R\$ 3\.000,00 · ICMS R\$ 540,00/);
  assert.match(view,/Vendas interestaduais · 12%<\/dt><dd>Base R\$ 500,00 · ICMS R\$ 60,00/);
  assert.match(view,/redução R\$ 36,00/);
  assert.match(view,/Débito de ICMS após devoluções<\/dt><dd>R\$ 564,00/);
  assert.match(view,/antes dos créditos de compras e de ajustes manuais/);
});

test('débito é limitado a zero em cada mês antes do consolidado',()=>{
  const a=month('2025-01',[line('5102',10000,'MG','NFCE')],[line('1202',20000,'MG')],species(1,10000));
  const b=month('2025-02',[line('5102',20000,'MG','NFCE')],[],species(1,20000));
  assert.match(text(renderIcmsSalesAudit({monthlyReports:[a,b]})),/Débito de ICMS após devoluções<\/dt><dd>R\$ 36,00/);
});

test('espécie e UF pendentes não exibem débito como se estivesse confirmado',()=>{
  const missing=month('2025-01',[line('5102',10000,'RJ',undefined)],[],species(0,0,1));
  const view=text(renderIcmsSalesAudit({monthlyReports:[missing]}));
  assert.match(view,/1 venda\(s\) sem espécie na coluna D/);assert.match(view,/Reimporte o relatório de saídas/);
  assert.doesNotMatch(view,/Débito de ICMS após devoluções/);
  const noUf=month('2025-01',[line('5102',10000,'','NFE')],[],species(0,0));
  assert.match(renderIcmsSalesAudit({monthlyReports:[noUf]}),/sem UF confirmada/);
  assert.doesNotMatch(renderIcmsSalesAudit({monthlyReports:[noUf]}),/Débito de ICMS após devoluções/);
});

test('dados antigos, contratos desconhecidos e somas fora do limite não viram zero confirmado',()=>{
  assert.equal(renderIcmsSalesAudit({}), '');
  assert.match(renderIcmsSalesAudit({monthlyReports:[{}]}),/ICMS das vendas a conferir/);
  const valid=month('2025-01',[line('5102',10000,'MG','NFCE')],[],species(1,10000));
  const broken=structuredClone(valid);broken.salesSpecies.nfceBaseCents=Number.MAX_SAFE_INTEGER;
  assert.match(renderIcmsSalesAudit({monthlyReports:[broken,valid]}),/Não foi possível conferir/);
});

test('a conferência acompanha os documentos reconciliados na tela Fiscal',()=>{
  const report=month('2025-01',[line('5102',10000,'SP','NFCE')],[],species(1,10000));
  const view=renderFiscalComposition({source:{monthlyReports:[report]}});
  assert.match(view,/data-analysis-icms-audit="ready"/);
  assert.match(view,/NFC-e identificadas/);
});
