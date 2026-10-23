import test from 'node:test';
import assert from 'node:assert/strict';
import { digits } from '../src/domain.ts';
import { PURCHASE_SELECTION_VERSION, selectPurchaseLine, summarizePurchaseSelection } from '../src/purchase-selection.ts';

const ids = ['000000000001', '111111110001', '222222220001'].map(base => base + digits(base));
const row = (natureCode: string, totalCents: number, document = ids[0], status = 'OPTANTE') => ({
  natureCode, totalCents, document, status, grossCents: totalCents + 500, discountCents: 600,
  accessoryCents: 99, freightCents: 150, abatementCents: 50
});

test('seleção de compras cruza natureza, conserva o original e agrupa apenas documentos considerados', () => {
  const rows = [row('1102', 10000), row('1202', 50000), row('8000', 5000, ids[1], 'NAO_OPTANTE'),
    row('1949', 3000, ids[2], 'NAO_CONFIRMADO'), row('2102', 2000, '123.456.789-01'),
    row('5202', 600, '12345678901'), row('1102', 100, ''), row('1102', 200, ''), row('9999', 900),
    row('1102', 0, ids[1], 'NAO_OPTANTE'), row('5102', 700)];
  const before = structuredClone(rows), selection = summarizePurchaseSelection(rows, {includeGroups: true});
  assert.equal(selection.version, PURCHASE_SELECTION_VERSION);
  assert.equal(selection.available, true); assert.equal(selection.origin, 'DERIVED_FROM_SNAPSHOT');
  assert.deepEqual(selection.totals, {lines: 6, uniqueCnpjs: 2, uniqueDocuments: 5, nonCnpjDocumentCount: 3,
    cnpjLines: 3, nonCnpjLines: 3, totalCents: 17300, cnpjCents: 15000, nonCnpjCents: 2300});
  assert.equal(selection.reportTotalCents, 72500); assert.equal(selection.excludedTotalCents, 55200); assert.equal(selection.excludedLines, 5);
  assert.deepEqual(selection.components, {grossCents: 20300, discountCents: 3600, accessoryCents: 594, freightCents: 900, abatementCents: 300, totalCents: 17300});
  assert.deepEqual(selection.reportingGroups?.map(group => [group.status, group.count, group.lines, group.totalCents, group.valuePercent]),
    [['OPTANTE', 1, 1, 10000, 57.8], ['NAO_OPTANTE', 4, 5, 7300, 42.2]]);
  assert.equal(selection.groups?.find(group => group.status === 'NAO_CONFIRMADO')?.count, 0, 'CNPJ somente excluído não entra nos denominadores.');
  assert.equal(selection.natureTotals.find(nature => nature.natureCode === '1202')?.consideredCents, 0, 'Devolução não reduz nem compõe compras.');
  assert.equal(selection.natureTotals.find(nature => nature.natureCode === '9999')?.reason, 'NAO_CLASSIFICADA');
  assert.equal(selection.natureTotals.reduce((sum, nature) => sum + nature.consideredCents!, 0), selection.totals?.totalCents);
  assert.equal(selection.natureTotals.reduce((sum, nature) => sum + nature.excludedCents!, 0), selection.excludedTotalCents);
  assert.deepEqual(rows, before);
});

test('prévia não inventa situação fiscal; identidade de documentos é normalizada e falta de natureza não confirma zero', () => {
  const preview = summarizePurchaseSelection([row('1102', 1, '123.456.789-01'), row('1102', 2, '12345678901')], {origin: 'PREVIEW'});
  assert.equal(preview.origin, 'PREVIEW'); assert.equal(preview.totals?.uniqueDocuments, 1); assert.equal(preview.reportingGroups, null); assert.equal(preview.groups, null);
  for (const natureCode of ['', '1102002', '1.102', undefined]) {
    const selection = summarizePurchaseSelection([row('1102', 100), {...row('1102', 100), natureCode}]);
    assert.equal(selection.available, false); assert.equal(selection.origin, 'UNAVAILABLE');
    assert.equal(selection.totals, null); assert.equal(selection.excludedTotalCents, null); assert.equal(selection.components, null);
    assert.equal(selection.reportTotalCents, 200); assert.equal(selection.reason, 'MISSING_NATURE');
    assert.equal(selectPurchaseLine(row('1102', 100), selection.available).consideredCents, null);
  }
  const excluded = summarizePurchaseSelection([row('1202', 100), row('5202', 200), row('1949', 300), row('9999', 400)], {includeGroups: true});
  assert.equal(excluded.available, true); assert.equal(excluded.totals?.totalCents, 0); assert.equal(excluded.totals?.uniqueDocuments, 0);
  assert.equal(excluded.excludedTotalCents, 1000); assert(excluded.reportingGroups?.every(group => group.valuePercent === 0));
});

test('seleção exige centavos seguros e situação original quando grupos fiscais são solicitados', () => {
  assert.throws(() => summarizePurchaseSelection([row('1102', 0.1)]));
  assert.throws(() => summarizePurchaseSelection([row('1949', Number.MAX_SAFE_INTEGER), row('1949', 1)]));
  assert.throws(() => summarizePurchaseSelection([row('1102', 100, ids[0], 'DESCONHECIDA')], {includeGroups: true}));
  assert.throws(() => summarizePurchaseSelection([row('1102', 100), row('1102', 100, ids[0], 'NAO_OPTANTE')], {includeGroups: true}));
  const legacy = summarizePurchaseSelection([{document: ids[0], natureCode: '1102', totalCents: 100}], {calculationVersion: 'Q_V1'});
  assert.equal(legacy.components, null); assert.equal(legacy.totals?.totalCents, 100);
});
