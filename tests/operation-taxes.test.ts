import test from 'node:test';
import assert from 'node:assert/strict';
import {OPERATION_CATALOG_GROUPS} from '../src/operation-catalog.ts';
import {calculateDifal,summarizeDifal} from '../src/difal.ts';
import {calculateAnticipation,summarizeAnticipation} from '../src/icms-anticipation.ts';

const sale={totalCents:100_005,document:'12345678901',issuerUf:'MG',recipientUf:'SP'};
test('DIFAL V3 usa todas as naturezas VENDA e UF real; V1/V2 permanecem congelados',()=>{
  for(const nature of OPERATION_CATALOG_GROUPS.VENDA)assert.deepEqual(calculateDifal({...sale,natureCode:nature+'002',description:'Texto não altera catálogo'}),
    {eligible:true,baseCents:100_005,amountCents:10_001,reason:'ELIGIBLE'});
  assert.equal(calculateDifal({...sale,natureCode:'5405'}).eligible,true);
  assert.equal(calculateDifal({...sale,natureCode:'5405',description:'Venda'},'DIFAL_ESTIMATE_V2').eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'5102'},'DIFAL_ESTIMATE_V1').eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'5102'},'DIFAL_ESTIMATE_V2').eligible,true);
  for(const code of ['9000002','8000102','6949','1202','6202','9999'])assert.equal(calculateDifal({...sale,natureCode:code,description:'Venda'}).eligible,false);
  assert.equal(calculateDifal({...sale,natureCode:'6102',recipientUf:'MG'}).reason,'SAME_UF');
  assert.equal(calculateDifal({...sale,natureCode:'6102',document:'12345678000199'}).reason,'NOT_CPF');
  assert.equal(summarizeDifal([{...sale,natureCode:'6102',recipientUf:''}],'MG').pendingLines,1);
});
test('antecipação usa COMPRAS e prefixo8000, 7,32% por linha e pendências explícitas',()=>{
  for(const nature of [...OPERATION_CATALOG_GROUPS.COMPRAS,'8000','8000002','8000102'])assert.deepEqual(calculateAnticipation({...sale,natureCode:nature}),
    {eligible:true,baseCents:100_005,amountCents:7320,reason:'ELIGIBLE'});
  for(const natureCode of ['1202','2202','6202','5102','9000','1949','9999'])assert.equal(calculateAnticipation({...sale,natureCode}).reason,'NOT_PURCHASE');
  assert.equal(calculateAnticipation({...sale,natureCode:'2102',recipientUf:'MG'}).reason,'SAME_UF');
  assert.equal(calculateAnticipation({...sale,natureCode:'1102',totalCents:1250}).amountCents,92);
  assert.equal(calculateAnticipation({...sale,natureCode:'1102',totalCents:NaN}).reason,'INVALID_TOTAL');
  const summary=summarizeAnticipation([{...sale,natureCode:'1102'},{...sale,natureCode:'8000102',recipientUf:''},{...sale,natureCode:'1202'}],'MG');
  assert.equal(summary.eligibleLines,1);assert.equal(summary.pendingLines,1);assert.equal(summary.amountCents,7320);
});
