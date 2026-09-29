/* Only A/I/P/Q/Y/Z/AA/AB leave this worker as approved financial data; source file stays local. */
let book, matrix, encoding, csvSource = null;
self.onmessage = async ({data}) => {
  try {
    const parser = await import('./purchase-parser.js');
    if (data.action === 'open') {
      if (data.buffer.byteLength > 10 * 1024 * 1024) throw new Error('Arquivo acima de 10 MiB. Divida o relatório.');
      if (/\.csv$/i.test(data.name)) {
        book = null;
        csvSource = parser.decodePurchaseCsv(data.buffer, data.encoding);
        ({matrix, encoding} = csvSource);
        self.postMessage({type:'sheets', sheets:['CSV'], encoding});
      } else if (/\.xlsx?$/i.test(data.name)) {
        csvSource = null;
        const D = await import('./domain.js');
        if (/\.xlsx$/i.test(data.name)) D.inspectXlsxZip(data.buffer);
        if (!self.XLSX) importScripts('/vendor/xlsx.full.min.js');
        book = XLSX.read(data.buffer, {type:'array', cellFormula:true, cellDates:false, sheetRows:D.MAX_ROWS + 22});
        self.postMessage({type:'sheets', sheets:book.SheetNames});
      } else throw new Error('Use um arquivo CSV, XLSX ou XLS.');
    }
    if (data.action === 'sheet') {
      if (book) {
        const sheet = book.Sheets[data.name];
        if (!sheet) throw new Error('Aba não encontrada.');
        const full = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
        if (full.e.r >= 50022 || full.e.c >= 80) throw new Error('Aba acima do limite de 50.000 linhas de dados ou 80 colunas.');
        for (const [address, cell] of Object.entries(sheet)) {
          if (!address.startsWith('!') && cell && typeof cell === 'object' && cell.f) {
            cell.v = '[FORMULA_NAO_SUPORTADA]'; cell.t = 's'; delete cell.w;
          }
        }
        // Use absolute A1-based coordinates even when !ref starts at A5 or a later column.
        // This keeps fixed A/I/P/Q/Y/Z/AA/AB positions and document formatting aligned to their source row.
        matrix = XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:'', blankrows:true, range:{s:{r:0,c:0},e:full.e}});
        // Preserve explicit spreadsheet formatting of document identifiers, including leading zeros.
        for (let r = 0; r < matrix.length; r++) {
          const cell = sheet[XLSX.utils.encode_cell({r, c:0})];
          if (cell && cell.t === 'n' && cell.w && !/[eE][+-]/.test(cell.w)) matrix[r][0] = cell.w;
        }
      }
      self.postMessage({type:'preview', rows:matrix.slice(0,21), total:matrix.length, encoding});
    }
    if (data.action === 'validate') self.postMessage({type:'validated', ...parser.parsePurchaseMatrix(matrix, Number(data.header), {type:data.reportType || data.type || 'PURCHASES', calculationVersion:data.calculationVersion || 'NET_V2',
      companyCode:data.companyCode, ...(csvSource ? {sourceFormat:'CSV', delimiter:csvSource.delimiter, sourceLines:csvSource.sourceLines, recoverDescriptionSeparators:true} : {})})});
  } catch (error) { self.postMessage({type:'error', message:error.message || 'Não foi possível ler o relatório.'}); }
};
