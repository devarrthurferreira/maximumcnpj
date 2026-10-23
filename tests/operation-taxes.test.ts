import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OPERATION_CATALOG_GROUPS} from '../src/operation-catalog.ts';
import {calculateDifal,summarizeDifal,DIFAL_VERSION,DIFAL_CATALOG_VERSION} from '../src/difal.ts';
import {calculateAnticipation,summarizeAnticipation,ANTICIPATION_VERSION,ANTICIPATION_CPF_CNPJ_VERSION,ANTICIPATION_PREVIOUS_VERSION,ANTICIPATION_LEGACY_VERSION} from '../src/icms-anticipation.ts';

const sale={totalCents:100_005,document:'12345678901',issuerUf:'MG',recipientUf:'SP'};
test('DIFAL V4 usa catálogo VENDA e UF real; V1/V2/V3 permanecem congelados',()=>{
  for(const nature of OPERATION_CATALOG_GROUPS.VENDA)assert.deepEqual(calculateDifal({...sale,natureCode:nature+'002',description:'Texto não altera catálogo'}),
    {eligible:true,baseCents:100_005,amountCents:10_001,reason:'ELIGIBLE'});
  assert.equal(calculateDifal({...sale,natureCode:'5405'}).eligible,true);
  assert.equal(calculateDifal({...sale,natureCode:'5405',description:'Venda'},'DIFAL_ESTIMATE_V2').eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'5102'},'DIFAL_ESTIMATE_V1').eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'5102'},'DIFAL_ESTIMATE_V2').eligible,true);
  for(const code of ['9000002','8000102','6949','1202','6202','9999'])assert.equal(calculateDifal({...sale,natureCode:code,description:'Venda'}).eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'6102',recipientUf:'MG'}).reason,'SAME_UF');
  assert.equal(calculateDifal({...sale,natureCode:'6102',document:'12345678000199'}).reason,'NOT_CPF_OR_CNPJ');
  assert.equal(summarizeDifal([{...sale,natureCode:'6102',recipientUf:''}],'MG').pendingLines,1);
});
test('antecipação V4 usa somente COMPRAS, 7,32% por linha e pendências explícitas',()=>{
  for(const nature of OPERATION_CATALOG_GROUPS.COMPRAS)assert.deepEqual(calculateAnticipation({...sale,natureCode:nature}),
    {eligible:true,baseCents:100_005,amountCents:7320,reason:'ELIGIBLE'});
  for(const natureCode of ['1202','2202','6202','5102','9000','1949','9999'])assert.equal(calculateAnticipation({...sale,natureCode}).reason,'NOT_PURCHASE');
  assert.equal(calculateAnticipation({...sale,natureCode:'2102',recipientUf:'MG'}).reason,'SAME_UF');
  assert.equal(calculateAnticipation({...sale,natureCode:'1102',totalCents:1250}).amountCents,92);
  assert.equal(calculateAnticipation({...sale,natureCode:'1102',totalCents:NaN}).reason,'INVALID_TOTAL');
  const summary=summarizeAnticipation([{...sale,natureCode:'1102'},{...sale,natureCode:'8000102',recipientUf:''},{...sale,natureCode:'2102',recipientUf:''},{...sale,natureCode:'1202'}],'MG');
  assert.equal(summary.eligibleLines,1);assert.equal(summary.pendingLines,1);assert.equal(summary.amountCents,7320);
});

test('V4 exclui todo prefixo 8000 sem base nem pendência; V1/V2/V3 mantêm serviços históricos',()=>{
  const natures=['8000','8000002','8000102','8000999999','8.000.102',8000102];
  for(const natureCode of natures) {
    for(const document of [sale.document,'11222333000181','12ABC34501DE35','123456789012','']) {
      for(const [issuerUf,recipientUf] of [['MG','SP'],['MG',''],['','SP'],['','']]) {
        const input={...sale,natureCode,document,issuerUf,recipientUf},before={...input};
        assert.deepEqual(calculateAnticipation(input),{eligible:false,baseCents:0,amountCents:0,reason:'SERVICE_PURCHASE_EXCLUDED'});
        const summary=summarizeAnticipation([input],issuerUf);
        assert.equal(summary.baseCents,0);assert.equal(summary.amountCents,0);assert.equal(summary.pendingLines,0);assert.equal(summary.eligibleLines,0);
        assert.deepEqual(input,before);
      }
    }
    for(const version of [ANTICIPATION_LEGACY_VERSION,ANTICIPATION_PREVIOUS_VERSION,ANTICIPATION_CPF_CNPJ_VERSION]) {
      assert.deepEqual(calculateAnticipation({...sale,natureCode},version),{eligible:true,baseCents:100005,amountCents:7320,reason:'ELIGIBLE'});
      assert.equal(calculateAnticipation({...sale,natureCode,recipientUf:''},version).reason,'MISSING_RECIPIENT_UF');
    }
    assert.equal(calculateAnticipation({...sale,natureCode,document:'11222333000181'},ANTICIPATION_CPF_CNPJ_VERSION).amountCents,7320);
    assert.equal(calculateAnticipation({...sale,natureCode,document:'11222333000182'},ANTICIPATION_CPF_CNPJ_VERSION).reason,'NOT_CPF_OR_CNPJ');
  }
});

test('antecipação V2 calcula somente CPF; V1 explícita preserva PJ e ausências históricas',()=>{
  for(const document of ['00000000000191','123456789012','','ABC',undefined]){
    assert.equal(calculateAnticipation({...sale,natureCode:'1102',document},ANTICIPATION_PREVIOUS_VERSION).reason,'NOT_CPF');
    assert.equal(calculateAnticipation({...sale,natureCode:'1102',document,issuerUf:'',recipientUf:''},ANTICIPATION_PREVIOUS_VERSION).reason,'NOT_CPF');
    assert.equal(calculateAnticipation({...sale,natureCode:'1102',document},ANTICIPATION_LEGACY_VERSION).eligible,true);
  }
  assert.equal(calculateAnticipation({...sale,natureCode:'1102',document:'123.456.789-01'}).eligible,true);
  assert.equal(summarizeAnticipation([{...sale,natureCode:'1102',document:'00000000000191',recipientUf:''}],'MG',ANTICIPATION_PREVIOUS_VERSION).pendingLines,0);
  assert.equal(summarizeAnticipation([{...sale,natureCode:'1102'}],'MG').version,ANTICIPATION_VERSION);
  assert.equal(summarizeAnticipation([{...sale,natureCode:'1102'}],'MG',ANTICIPATION_LEGACY_VERSION).version,ANTICIPATION_LEGACY_VERSION);
});


test('regras atuais aceitam CPF e CNPJ válido numérico ou alfanumérico, sem considerar enquadramento',()=>{
  for(const document of ['123.456.789-01','00.000.000/0001-91','12.abc.345/01de-35']) {
    for(const status of ['OPTANTE','NAO_OPTANTE','NAO_CONFIRMADO',undefined]) {
      assert.equal(calculateDifal({...sale,natureCode:'5405002',document,status}).amountCents,10001);
      assert.equal(calculateAnticipation({...sale,natureCode:'2102002',document,status}).amountCents,7320);
    }
    assert.equal(calculateDifal({...sale,natureCode:'6102',document,recipientUf:''}).reason,'MISSING_RECIPIENT_UF');
    assert.equal(calculateAnticipation({...sale,natureCode:'1102',document,issuerUf:''}).reason,'MISSING_ISSUER_UF');
  }
  for(const document of ['00000000000192','12ABC34501DE36','123456789012','ABC','',undefined]) {
    assert.equal(calculateDifal({...sale,natureCode:'6102',document}).reason,'NOT_CPF_OR_CNPJ');
    assert.equal(calculateAnticipation({...sale,natureCode:'1102',document}).reason,'NOT_CPF_OR_CNPJ');
  }
  for(const version of ['DIFAL_ESTIMATE_V1','DIFAL_ESTIMATE_V2',DIFAL_CATALOG_VERSION] as const) {
    assert.equal(calculateDifal({...sale,natureCode:'6102',document:'00000000000191'},version).reason,'NOT_CPF');
  }
  assert.equal(calculateDifal({...sale,natureCode:'5405',description:'Remessa'},DIFAL_CATALOG_VERSION).eligible,true,'V3 conserva catálogo independente da descrição.');
  assert.equal(summarizeDifal([{...sale,natureCode:'6102',document:'00000000000191'}],'MG').version,DIFAL_VERSION);
  assert.equal(summarizeAnticipation([{...sale,natureCode:'1102',document:'00000000000191'}],'MG').version,ANTICIPATION_VERSION);
});

test('Node e Python concordam na antecipação atual e em todas as versões históricas',()=>{
  const cases=[];
  for(const version of [ANTICIPATION_VERSION,ANTICIPATION_CPF_CNPJ_VERSION,ANTICIPATION_PREVIOUS_VERSION,ANTICIPATION_LEGACY_VERSION])
    for(const natureCode of ['2102','1102001','8000','8000002','8000102','8.000.102','1202','6202'])
      for(const document of ['12345678901','11222333000181','12ABC34501DE35','11222333000182','123456789012',''])
        for(const [issuerUf,recipientUf] of [['MG','SP'],['MG',''],['','SP'],['MG','MG']])
          cases.push({input:{...sale,natureCode,document,issuerUf,recipientUf},version});
  const directory=mkdtempSync(join(tmpdir(),'maximum-anticipation-parity-')),fixture=join(directory,'cases.json');
  try {
    writeFileSync(fixture,JSON.stringify(cases.map(({input,version})=>({input,version,expected:calculateAnticipation(input,version)}))));
    const source='import json,sys\nfrom reporting.anticipation import calculate_anticipation\nwith open(sys.argv[1]) as source: cases=json.load(source)\nfor case in cases:\n actual=calculate_anticipation(case["input"],case["input"]["issuerUf"],case["version"])\n assert actual==case["expected"], (case,actual)\nprint(len(cases))';
    const count=Number(execFileSync('python',['-c',source,fixture],{encoding:'utf8',timeout:15000}));
    assert.equal(count,cases.length);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
