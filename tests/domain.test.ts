import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digits, normalizeCnpj, prepareRows, importSummary, classify, statistics, csvParse, csvEncode, safeCell, inspectXlsxZip } from '../src/domain.ts';
function cnpj(i: number) { const base=String(80000000+i).padStart(8,'0')+'0001'; return base+digits(base); }
test('CNPJ numérico e exemplo alfanumérico: checksum, máscara e letras',()=>{
 assert.equal(normalizeCnpj('00.000.000/0001-91').valid,true);
 assert.equal(normalizeCnpj('12.abc.345/01de-35').cnpj,'12ABC34501DE35');
 assert.equal(normalizeCnpj('12.ABC.345/01DE-35').valid,true);
 for(const v of ['00000000000000','11111111111111','12ABC34501DE36','1.234E+13','000000000001','12ABC34501D!35','',null])assert.equal(normalizeCnpj(v).valid,false,String(v));
 assert.equal(normalizeCnpj(Number(cnpj(1))).warnings.length,1);
});
test('10.001 CNPJs únicos e duplicados normalizados preservando linhas',()=>{
 const rows=Array.from({length:10001},(_,i)=>[cnpj(i),`Empresa sintética ${i}`]);
 rows.push([cnpj(0),'Duplicado']);rows.push(['invalido','Revisar']);
 const prepared=prepareRows(rows,0,1);
 assert.deepEqual(importSummary(prepared),{lines:10003,unique:10001,invalid:1,duplicates:1});
 assert.equal(prepared.at(-2)?.duplicate,true);assert.equal(prepared.at(-1)?.original,'invalido');
});
test('50.000 linhas, todas únicas, validadas sem truncamento',()=>{
 const rows=Array.from({length:50000},(_,i)=>[cnpj(i),`Carga ${i}`]);
 const result=importSummary(prepareRows(rows,0,1));assert.equal(result.unique,50000);assert.equal(result.invalid,0);
 assert.throws(()=>prepareRows([...rows,[cnpj(1)]],0,1),/50.000/);
});
test('Matriz e filiais não são deduplicadas pelo CNPJ básico',()=>{
 const a='123456780001',b='123456780002';
 assert.equal(importSummary(prepareRows([[a+digits(a)],[b+digits(b)]],0,-1)).unique,2);
});
test('Erros, nulos, valores inesperados e fonte duplicada nunca viram não optante',()=>{
 for(const input of [{sourceCount:0,simples:'N'},{sourceCount:1,simples:null},{sourceCount:1,simples:'talvez'},{sourceCount:2,simples:'N'},{sourceCount:1,simples:'N',mei:'S'}])assert.equal(classify({cnpj:cnpj(0),...input}).status,'NAO_CONFIRMADO');
 assert.equal(classify({cnpj:cnpj(1),sourceCount:1,simples:'N',mei:'N'}).status,'NAO_OPTANTE');
 assert.equal(classify({cnpj:cnpj(1),sourceCount:1,simples:true,mei:false}).status,'OPTANTE');
});
test('Indicadores únicos, denominador explícito e MEI subconjunto',()=>{
 const r=statistics([{cnpj:'a',status:'OPTANTE',mei:true},{cnpj:'b',status:'NAO_OPTANTE'},{cnpj:'c',status:'NAO_CONFIRMADO'},{cnpj:'a',status:'OPTANTE',mei:true}]);
 assert.equal(r.total,3);assert.equal(r.mei,1);assert.equal(r.optantsPercent,33.33);assert.equal(r.coverage,66.67);
 assert.equal(statistics([]).coverage,0);
 assert.equal(statistics([{cnpj:'a',status:'OPTANTE'},{cnpj:'a',status:'NAO_OPTANTE'}]).nonOptants,1);
});
test('CSV: BOM, delimitador, aspas, quebras em células e fórmula escapada',()=>{
 assert.deepEqual(csvParse('\ufeffCNPJ;Nome\r\n123;"A; B\nC"\r\n456;"Aspas ""duplas"""'),[['CNPJ','Nome'],['123','A; B\nC'],['456','Aspas "duplas"']]);
 assert.deepEqual(csvParse('a,b\n1,2'),[['a','b'],['1','2']]);
 assert.throws(()=>csvParse('a;"aberto'),/aspas/);
 for(const v of ['=1+1','+cmd','-2+3','@SUM(A1)',' \t=HYPERLINK("x")'])assert.ok(safeCell(v).startsWith("'"));
 assert.equal(safeCell('00000000000191'),'00000000000191');
 assert.ok(csvEncode([['=1+1']]).includes("'=1+1"));
});
test('Limites de células e XLSX inválido bloqueados',()=>{
 assert.throws(()=>prepareRows([[cnpj(0),'x'.repeat(2001)]],0,1),/2.000/);
 assert.throws(()=>inspectXlsxZip(new ArrayBuffer(30)),/XLSX/);
});
