import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCommercialMonth} from '../src/simulation-commercial-composition.ts';
import {renderCommercialComposition} from '../public/simulator-commercial-view.js';

const row=(natureCode,totalCents,extra={})=>({serviceDate:'2026-01-15',natureCode,totalCents,documentKind:'CPF',valid:false,...extra});
const cnpj=status=>({documentKind:'CNPJ',valid:true,status});
const clean=html=>html.replace(/\u00a0/g,' ');

test('composição apresenta valores e bases dos documentos sem confundir B2B com Simples',()=>{
  const source=summarizeCommercialMonth('2026-01',[
    row('1102',1000,cnpj('OPTANTE')),row('2102',2000,cnpj('NAO_OPTANTE')),row('8000',3000),
    row('8000',4000,cnpj('NAO_CONFIRMADO')),row('1102',500,{documentKind:'CNO_OU_OUTRO'}),row('1202',1000)
  ],[
    row('5102',10000,cnpj('OPTANTE')),row('9000',6000),row('9000',3000,cnpj('NAO_CONFIRMADO')),
    row('5102',1000,{documentKind:'AUSENTE'})
  ]),before=structuredClone(source),html=clean(renderCommercialComposition(source));
  const audience=html.split('data-commercial-audience>')[1].split('<details')[0];
  assert.match(audience,/B2B · CNPJ/);assert.match(audience,/B2C · CPF/);assert.match(audience,/Não identificado/);
  assert.match(audience,/R\$ 130,00/);assert.match(audience,/68,42%/);assert.match(audience,/R\$ 50,00/);
  assert.match(html,/Percentuais sobre R\$ 190,00 de receita após devoluções/);
  assert.match(html,/Vendas e serviços antes das devoluções<\/dt><dd>R\$ 200,00/);
  assert.match(html,/Devoluções de venda abatidas<\/dt><dd>-R\$ 10,00/);
  const purchases=html.split('data-commercial-side="purchases"')[1];
  assert.match(purchases,/Percentuais sobre R\$ 105,00 de compras selecionadas/);
  assert.match(purchases,/Optantes do Simples/);assert.match(purchases,/Fora do Simples/);assert.match(purchases,/data-commercial-group="CPF"/);
  assert.match(purchases,/Enquadramento não confirmado/);assert.match(purchases,/Outros documentos/);
  assert.match(html,/Valores dos documentos selecionados/);assert.deepEqual(source,before);
});

test('visão conserva percentuais negativos e usa traço quando não há base positiva',()=>{
  const signed=summarizeCommercialMonth('2026-01',[row('1202',3000)],
    [row('5102',10000,cnpj('NAO_OPTANTE')),row('9000',1000)]);
  const html=clean(renderCommercialComposition(signed));
  assert.match(html,/-R\$ 20,00/);assert.match(html,/-25,00%/);assert.match(html,/125,00%/);
  assert.doesNotMatch(html,/width:-|width:125/);assert.match(html,/devoluções geraram saldo negativo/);
  for(const returns of [1000,2000]){
    const emptyBase=summarizeCommercialMonth('2026-01',[row('1202',returns)],[row('9000',1000)]);
    const result=renderCommercialComposition(emptyBase);
    assert.match(result,/data-commercial-percent>—/);assert.match(result,/não tem saldo positivo/);
    assert.doesNotMatch(result,/commercial-share-track|0,00%/);
  }
});

test('legado não inventa composição; dados inconsistentes e HTML do título são tratados',()=>{
  assert.equal(renderCommercialComposition(null),'');assert.equal(renderCommercialComposition(undefined),'');
  const source=summarizeCommercialMonth('2026-01',[],[row('9000',100)]),damaged=structuredClone(source);
  damaged.revenue.totalCents=101;
  const unavailable=renderCommercialComposition(damaged);
  assert.match(unavailable,/data-commercial-unavailable/);assert.doesNotMatch(unavailable,/data-commercial-total/);
  const html=renderCommercialComposition(source,{title:'<img src=x onerror=alert(1)>',periodLabel:'<b>jan/2026</b>'});
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/&lt;b&gt;jan\/2026&lt;\/b&gt;/);
  assert.doesNotMatch(html,/<img|<b>jan/);
});
