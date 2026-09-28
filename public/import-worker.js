/* Planilhas são analisadas fora da thread visual. O arquivo original não sai do navegador. */
let book, matrix, filename;
self.onmessage = async ({data}) => {
  try {
    const D = await import('./domain.js');
    if(data.action==='open') {
      filename=data.name;
      if(data.buffer.byteLength>10*1024*1024) throw new Error('Arquivo acima de 10 MiB. Divida a planilha.');
      if(/\.csv$/i.test(filename)) { book=null; matrix=D.csvParse(new TextDecoder(data.encoding||'utf-8').decode(data.buffer)); self.postMessage({type:'sheets',sheets:['CSV']}); }
      else if(/\.xlsx$/i.test(filename)) {
        D.inspectXlsxZip(data.buffer);
        if(!self.XLSX)importScripts('/vendor/xlsx.full.min.js');
        book=XLSX.read(data.buffer,{type:'array',cellFormula:true,cellDates:false,sheetRows:D.MAX_ROWS+21});
        self.postMessage({type:'sheets',sheets:book.SheetNames});
      } else throw new Error('Formato não suportado. Utilize CSV ou XLSX.');
    }
    if(data.action==='sheet') {
      if(book) {
        const sheet=book.Sheets[data.name]; if(!sheet)throw new Error('Aba não encontrada.');
        const full=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
        if(full.e.r>=D.MAX_ROWS+21 || full.e.c>=D.MAX_COLUMNS)throw new Error('Aba acima de 50.000 linhas de dados ou 80 colunas.');
        let formulas=0;
        for(const [address,cell] of Object.entries(sheet)) if(!address.startsWith('!') && cell && typeof cell==='object' && cell.f){cell.v='[FORMULA_NAO_SUPORTADA]';cell.t='s';delete cell.w;formulas++;}
        matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false});
        if(formulas)self.postMessage({type:'warning',message:`${formulas} células com fórmulas foram marcadas para revisão. Cole como valores na planilha antes de importar.`});
      }
      self.postMessage({type:'preview',rows:matrix.slice(0,15),total:matrix.length});
    }
    if(data.action==='matrix') { self.postMessage({type:'matrix',rows:matrix}); }
    if(data.action==='validate') {
      const header=Number(data.header), width=matrix.slice(header).reduce((max,row)=>Math.max(max,row.length),0);
      const headers=Array.from({length:width},(_,i)=>String(matrix[header]?.[i]||`Coluna ${i+1}`));
      if(!headers.length || headers.some(v=>v.length>200))throw new Error('Cabeçalho vazio ou longo demais.');
      const rows=matrix.slice(header+1).map(row=>Array.from({length:Math.max(headers.length,row.length)},(_,i)=>row[i]??''));
      const prepared=D.prepareRows(rows,Number(data.cnpjColumn),Number(data.nameColumn));
      self.postMessage({type:'validated',headers,rows,summary:D.importSummary(prepared),issues:prepared.filter(r=>!r.valid||r.duplicate||r.warnings.length).slice(0,30),warnings:prepared.filter(r=>r.warnings.length).length});
    }
    if(data.action==='export') {
      if(data.format==='csv') { const blob=new Blob([D.csvEncode([data.headers,...data.rows])],{type:'text/csv;charset=utf-8'}); self.postMessage({type:'export',blob,extension:'csv'}); }
      else { if(!self.XLSX)importScripts('/vendor/xlsx.full.min.js'); const sheet=XLSX.utils.aoa_to_sheet([data.headers,...data.rows].map(row=>row.map(v=>String(v??'')))); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheet,'Consulta CNPJ'); const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});self.postMessage({type:'export',blob:new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),extension:'xlsx'}); }
    }
  } catch(e) { self.postMessage({type:'error',message:e.message||'Falha ao ler a planilha.'}); }
};
