/* Only approved report fields leave this worker; the source file stays local. */
let book, matrix, encoding, csvSource = null;
function sheetMatrix(name, preview = false) {
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error('Aba não encontrada.');
  const full = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if (!preview && (full.e.r >= 50022 || full.e.c >= 80)) throw new Error('Aba acima do limite de 50.000 linhas de dados ou 80 colunas.');
  if (!preview) for (const [address, cell] of Object.entries(sheet)) {
    if (!address.startsWith('!') && cell && typeof cell === 'object' && cell.f) {
      cell.v = '[FORMULA_NAO_SUPORTADA]'; cell.t = 's'; delete cell.w;
    }
  }
  // Absolute coordinates preserve the fixed source columns and leading zeros.
  const rows = XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:'', blankrows:true,
    range:{s:{r:0,c:0},e:preview ? {r:Math.min(20,full.e.r),c:Math.min(79,full.e.c)} : full.e}});
  if (!preview) for (let r = 0; r < rows.length; r++) {
    const cell = sheet[XLSX.utils.encode_cell({r, c:0})];
    if (cell && cell.t === 'n' && cell.w && !/[eE][+-]/.test(cell.w)) rows[r][0] = cell.w;
  }
  return rows;
}
function validate(parser, data, header) {
  return parser.parsePurchaseMatrix(matrix, Number(header), {type:data.reportType || data.type || 'PURCHASES', calculationVersion:data.calculationVersion || 'NET_V2',
    companyCode:data.companyCode, issuerUf:data.issuerUf, difalVersion:data.difalVersion, ...(csvSource ? {sourceFormat:'CSV', delimiter:csvSource.delimiter, sourceLines:csvSource.sourceLines, recoverDescriptionSeparators:true} : {})});
}
self.onmessage = async ({data}) => {
  try {
    const parser = await import('./purchase-parser.js');
    if (data.action === 'open') {
      if (data.buffer.byteLength > 10 * 1024 * 1024) throw new Error('Arquivo acima de 10 MiB. Divida o relatório.');
      if (/\.csv$/i.test(data.name)) {
        book = null;
        csvSource = parser.decodePurchaseCsv(data.buffer, data.encoding);
        ({matrix, encoding} = csvSource);
        if (!data.automatic) self.postMessage({type:'sheets', sheets:['CSV'], encoding});
      } else if (/\.xlsx?$/i.test(data.name)) {
        csvSource = null;
        const D = await import('./domain.js');
        if (/\.xlsx$/i.test(data.name)) D.inspectXlsxZip(data.buffer);
        if (!self.XLSX) importScripts('/vendor/xlsx.full.min.js');
        book = XLSX.read(data.buffer, {type:'array', cellFormula:true, cellDates:false, sheetRows:D.MAX_ROWS + 22});
        if (!data.automatic) self.postMessage({type:'sheets', sheets:book.SheetNames});
      } else throw new Error('Use um arquivo CSV, XLSX ou XLS.');
      if (data.automatic) {
        const {purchaseModelHeaders, uniquePurchaseModel, assertPurchaseCompany} = await import('./purchase-model.js');
        const options = {type:data.reportType || 'PURCHASES', calculationVersion:data.calculationVersion || 'NET_V2'};
        const candidates = book
          ? book.SheetNames.flatMap(name => purchaseModelHeaders(sheetMatrix(name, true), options).map(header => ({name, header})))
          : purchaseModelHeaders(matrix, options).map(header => ({name:'CSV', header}));
        const selected = uniquePurchaseModel(candidates);
        if (book) matrix = sheetMatrix(selected.name);
        const review = validate(parser, data, selected.header);
        if (!review.errors.length) assertPurchaseCompany(matrix, selected.header, data.companyCode, {recoverDescriptionSeparators:!!csvSource});
        self.postMessage({type:'validated', automatic:true, sheet:selected.name, header:selected.header, ...review});
      }
    }
    if (data.action === 'sheet') {
      if (book) matrix = sheetMatrix(data.name);
      self.postMessage({type:'preview', rows:matrix.slice(0,21), total:matrix.length, encoding});
    }
    if (data.action === 'validate') self.postMessage({type:'validated', ...validate(parser, data, data.header)});
  } catch (error) { self.postMessage({type:'error', message:error.message || 'Não foi possível ler o relatório.'}); }
};
