// Recognize the fixed export before accepting an automatic import. Values are
// still validated by purchase-parser and again by the API.
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (row, column, labels) => labels.includes(normalized(row[column]));

export function purchaseModelHeaders(rows, {type = 'PURCHASES', calculationVersion = 'NET_V2'} = {}) {
  if (!['PURCHASES', 'SALES'].includes(type) || !['NET_V2', 'Q_V1'].includes(calculationVersion)) throw new Error('Modelo de relatório inválido.');
  const matches = [];
  for (let index = 0; index < Math.min(rows.length, 21); index++) {
    const row = rows[index];
    const explicitCounterparty = row && (normalized(row[0]) + normalized(row[8]));
    if ((type === 'PURCHASES' && explicitCounterparty?.includes('comprador')) || (type === 'SALES' && explicitCounterparty?.includes('fornecedor'))) continue;
    if (!Array.isArray(row) || !same(row, 0, ['cnpj', 'cnpjcpf', 'cnpjcpfcno', 'cnpjfornecedor', 'cnpjcomprador']) ||
        !same(row, 8, ['razaosocial', 'fornecedor', 'comprador', 'nomefornecedor', 'nomecomprador']) ||
        !same(row, 16, ['valortotal']) || (type === 'PURCHASES' && !same(row, 15, ['quantidade']))) continue;
    if (calculationVersion === 'NET_V2' && (!same(row, 7, ['dataescrituracaoservico', 'dataescrituracao', 'dataservico']) ||
        !same(row, 24, ['valordesconto', 'desconto']) || !same(row, 25, ['valordespesaacessoria', 'despesaacessoria']) ||
        !same(row, 26, ['valorfrete', 'frete']) || !same(row, 27, ['abatimentonaotributado']))) continue;
    matches.push(index);
  }
  return matches;
}

export function assertPurchaseCompany(matrix, headerIndex, companyCode, {recoverDescriptionSeparators = false} = {}) {
  const header = matrix[headerIndex], codeColumn = header.findIndex(value => ['codigoempresa', 'codempresa'].includes(normalized(value)));
  if (codeColumn < 0) return;
  const normalizeCode = value => String(value ?? '').trim().replace(/^0+(?=\d)/, '');
  const expected = normalizeCode(companyCode);
  if (!expected) throw new Error('A empresa selecionada não possui código para conferir este arquivo. Atualize o cadastro antes de importar. Nenhum dado foi enviado.');
  const lastHeader = header.findLastIndex(value => String(value ?? '').trim());
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const row = matrix[index];
    if (!row.some(value => String(value ?? '').trim())) continue;
    // Only called after parser validation succeeds: any extra CSV description
    // separators have already been proven safe, with the selected company anchor.
    const surplus = recoverDescriptionSeparators ? Math.max(0, row.findLastIndex(value => String(value ?? '').trim()) - lastHeader) : 0;
    if (normalizeCode(row[codeColumn + surplus]) !== expected) throw new Error(`Linha ${index + 1}: o código da empresa no arquivo não corresponde à empresa selecionada. Nenhum dado foi enviado.`);
  }
}

export function uniquePurchaseModel(candidates) {
  if (!candidates.length) throw new Error('Não reconhecemos o modelo padrão deste relatório. Envie o arquivo original de compras ou vendas, com o cabeçalho completo nas primeiras 21 linhas. Nenhum dado foi enviado.');
  if (candidates.length !== 1) throw new Error('O arquivo contém mais de uma aba ou cabeçalho do modelo. Envie um arquivo com apenas o relatório desta empresa. Nenhum dado foi enviado.');
  return candidates[0];
}

export function assertMatchingPurchaseCompetences(period, other) {
  if (!period?.startMonth || !other?.startMonth) return;
  if (period.startMonth !== other.startMonth || period.endMonth !== other.endMonth || period.months !== other.months) {
    throw new Error(`Este arquivo cobre ${period.startMonth} a ${period.endMonth}, mas o outro relatório cobre ${other.startMonth} a ${other.endMonth}. Use as mesmas competências nos dois arquivos; os dias podem ser diferentes. Nenhum dado foi enviado.`);
  }
}
