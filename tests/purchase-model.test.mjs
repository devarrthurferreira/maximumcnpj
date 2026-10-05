import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseModelHeaders, uniquePurchaseModel, assertPurchaseCompany, assertMatchingPurchaseCompetences} from '../public/purchase-model.js';

function header() {
  const row = Array(30).fill('');
  for (const [column,label] of [[0,'CNPJ / CPF / CNO'],[7,'Data Escrituração/Serviço'],[8,'Razão Social'],[15,'Quantidade'],[16,'Valor Total'],[24,'Valor Desconto'],[25,'Valor Despesa Acessória'],[26,'Valor Frete'],[27,'Abatimento não Tributado'],[28,'Codigo Empresa'],[29,'Chave Lancamento']]) row[column] = label;
  return row;
}

test('fixed model detects a unique header after title rows, without accepting arbitrary nonempty columns', () => {
  assert.deepEqual(purchaseModelHeaders([['Relatório da empresa'],[],header()]), [2]);
  const invalid = header(); invalid[16] = 'Valor aproximado';
  assert.deepEqual(purchaseModelHeaders([invalid]), []);
  assert.deepEqual(purchaseModelHeaders([...Array(21).fill([]),header()]), []);
});

test('explicit buyer/supplier headers must agree with the selected report type', () => {
  const row = header(); row[0] = 'CNPJ Comprador'; row[8] = 'Comprador'; row[15] = '';
  assert.deepEqual(purchaseModelHeaders([row],{type:'SALES'}), [0]);
  assert.deepEqual(purchaseModelHeaders([row],{type:'PURCHASES'}), []);
  row[0] = 'CNPJ Fornecedor'; row[8] = 'Fornecedor'; row[15] = 'Quantidade';
  assert.deepEqual(purchaseModelHeaders([row],{type:'SALES'}), []);
  assert.deepEqual(purchaseModelHeaders([row],{type:'PURCHASES'}), [0]);
});

test('automatic model requires one recognized sheet/header, and refuses ambiguity', () => {
  const candidate = {name:'Compras',header:3};
  assert.equal(uniquePurchaseModel([candidate]), candidate);
  assert.throws(() => uniquePurchaseModel([]), /Não reconhecemos/);
  assert.throws(() => uniquePurchaseModel([candidate,{name:'Outro',header:0}]), /mais de uma/);
});

test('company code column binds all rows to the selected company, including safe CSV repairs', () => {
  const row = Array(30).fill(''); row[0] = '12345678900'; row[28] = '0017'; row[29] = '41';
  assert.doesNotThrow(() => assertPurchaseCompany([header(),row],0,'17'));
  assert.throws(() => assertPurchaseCompany([header(),row],0,'18'), /não corresponde/);
  assert.throws(() => assertPurchaseCompany([header(),row],0,''), /não possui código/);
  const shifted = [...row.slice(0,14),'Descrição','azul',...row.slice(15)];
  assert.doesNotThrow(() => assertPurchaseCompany([header(),shifted],0,'17',{recoverDescriptionSeparators:true}));
  assert.throws(() => assertPurchaseCompany([header(),shifted],0,'18',{recoverDescriptionSeparators:true}), /não corresponde/);
});

test('guided second import accepts different days in matching months and blocks mismatched competences', () => {
  const period = {startDate:'2026-04-02',endDate:'2026-08-31',startMonth:'2026-04',endMonth:'2026-08',months:5};
  assert.doesNotThrow(() => assertMatchingPurchaseCompetences(period,{...period,startDate:'2026-04-01'}));
  assert.doesNotThrow(() => assertMatchingPurchaseCompetences(period,null));
  assert.throws(() => assertMatchingPurchaseCompetences(period,{...period,startMonth:'2026-03',months:6}), /Nenhum dado foi enviado/);
});
