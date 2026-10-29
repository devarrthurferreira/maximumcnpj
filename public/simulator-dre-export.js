/** Exports the presentation already prepared for the screen; never runs the calculator. */
import {unifiedDreRows,dreDifalNotes,dreReportCoverage,dreRegimeStatuses,dreReportMemory} from './simulator-dre.js';
import {buildDreExecutiveSummary,readDreValue} from './simulator-dre-summary.js';

const BOM = '\uFEFF';
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function textCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent Excel from evaluating a formula in a text cell.
  if (/^[\s\u0000-\u001f]*[=+\-\u2212@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function numberCell(value, percent = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return textCell('Não disponível');
  // Numbers are emitted separately from untrusted text, preserving legitimate negatives.
  const number = percent ? value * 100 : value;
  if (!Number.isFinite(number)) return textCell('Não disponível');
  return number.toLocaleString('pt-BR', {useGrouping:false, minimumFractionDigits:2, maximumFractionDigits:percent ? 6 : 2});
}

function rowContexts(presentation) {
  const contexts = new Map();
  for (const section of presentation.sections || []) for (const row of section.rows || []) contexts.set(row, ['DRE',section.label]);
  for (const detail of presentation.details || []) for (const row of detail.rows || []) contexts.set(row, ['Detalhamento informativo',detail.label]);
  for (const row of presentation.indicators || []) contexts.set(row, ['Indicadores','Indicadores']);
  for (const row of presentation.revenueReconciliation?.rows || []) contexts.set(row, ['Conferência da receita',presentation.revenueReconciliation.label]);
  for (const row of presentation.icmsReconciliation?.rows || []) contexts.set(row, ['Apuração do crédito de ICMS',presentation.icmsReconciliation.label]);
  return contexts;
}

const availableFor=(regime,frame,month)=>frame==='monthly'&&Array.isArray(regime.monthlyAvailability)?regime.monthlyAvailability[month]===true:regime.available===true;
function valueFor(row, regime, frame, month) {
  if (!availableFor(regime,frame,month)) return null;
  if (frame === 'monthly') return row.monthlyValues?.[regime.id]?.[month] ?? null;
  if (frame === 'calendarAnnual') return row.calendarAnnualValues?.[regime.id] ?? null;
  return row.values?.[regime.id] ?? null;
}

function percentFor(row, regime, frame, month) {
  if (!availableFor(regime,frame,month) || row.unit !== 'currency') return null;
  if (frame === 'monthly') return row.monthlyPercentValues?.[regime.id]?.[month] ?? null;
  if (frame === 'calendarAnnual') return row.calendarAnnualPercentValues?.[regime.id] ?? null;
  return row.percentValues?.[regime.id] ?? null;
}

function rowNotes(row, regimes, monthly) {
  const notes = [...(row.notes || [])];
  if (row.informative) notes.push('Informativo: não somar novamente à DRE.');
  for (const regime of regimes) {
    const reason = monthly ? row.calendarReasonByRegime?.[regime.id] : row.reasonByRegime?.[regime.id];
    if (reason) notes.push(`${regime.name}: ${reason}`);
    else if (!regime.available) notes.push(`${regime.name}: ${regime.status||'cenário indisponível.'}`);
  }
  return [...new Set(notes)].join(' | ');
}

/** Preserve every captured field and attach only a separately versioned, derived view. */
export function buildDreExportPayload(payload, presentation) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Simulação inválida para exportação.');
  return {...payload, drePresentation:presentation};
}

/**
 * Semicolon-separated CSV with a UTF-8 BOM for Brazilian Excel.
 * One continuous table follows the same base/detail/indicator order as the screen.
 * Annual view compares regimes in columns. Monthly view identifies each regime in
 * a column and retains the captured months plus the captured period total.
 */
export function buildDreCsv({presentation, period = 'annual', company = {}, year, showPercent = false}) {
  if (!presentation || !Array.isArray(presentation.regimes) || !Array.isArray(presentation.sections)) {
    throw new TypeError('DRE inválida para exportação.');
  }
  if (!['annual','monthly','complete'].includes(period)) throw new TypeError('Período da DRE inválido.');
  const lines = [];
  const textLine = cells => lines.push(cells.map(textCell).join(';'));
  const monthly = period === 'monthly',complete=period==='complete';
  const fixed=presentation.analysisPeriod?.version==='JAN_SEP_V1',monthCount=fixed?(presentation.months?.length||0):12;
  const regimes = presentation.regimes;
  const regimeScope=regimes.length===4?'todos os regimes':regimes.length===1?'regime selecionado':'regimes selecionados';
  const rows = unifiedDreRows(presentation);
  const contexts = rowContexts(presentation);
  textLine(['DRE completa', complete?`Relatório completo · ${fixed?'DRE Jan–Set e mensal':'DRE anual e mensal'} · ${regimeScope}`:monthly ? `Mensal · janeiro a ${fixed?'setembro':'dezembro'} · ${regimeScope}` : `${fixed?'Consolidado Jan–Set':'Anual'} · ${regimeScope}`]);
  textLine(['Empresa', company.name || '', 'Código', company.code || '', 'CNPJ', company.cnpj || '']);
  textLine(['Ano do cenário', year ?? presentation.year ?? presentation.calendarYear ?? '', 'Versão da apresentação', presentation.version || '']);
  textLine(['Unidades', 'Valores monetários em BRL (R$); percentuais em %.']);
  textLine(['Critério',fixed?`Janela de janeiro a setembro: consolidado de ${monthCount} competências confirmadas, sem zerar ou projetar os meses ausentes. A RBT12 do Simples mantém sua referência própria de 12 meses.`:presentation.method==='REPORT_MONTHS_V1'?'Valores por competência dos relatórios. Total anual é a soma dos meses importados; meses fora do período sem dados.':'Valores da simulação preservados. Projeção mensal, não lançamentos históricos.']);
  textLine(['Arredondamento', `Exibição com duas casas decimais; a soma dos meses exibidos pode diferir por centavos do ${fixed?'consolidado Jan–Set':'total anual'} preservado.`]);
  const coverage=dreReportCoverage(presentation);
  textLine(['Cobertura dos relatórios',coverage.label,coverage.detail]);
  if(coverage.actual)textLine(['Competências de origem',coverage.sourceMonths.join(', ')]);
  if(fixed)textLine(['Competências excluídas do período fixo',(presentation.analysisPeriod.excludedMonths||[]).join(', ')||'Nenhuma']);
  if(presentation.rbt12Source==='NOT_PROVIDED')textLine(['Referência de RBT12','Não informada nesta versão','Os cenários do Simples não foram calculados.']);
  for(const status of dreRegimeStatuses(presentation)){
    textLine(['Situação do regime',status.name,status.available?'Cálculo disponível':'Conferência necessária',status.status]);
    for(const group of status.months)textLine(['Situação por competência',status.name,group.months.join(', '),group.status]);
  }
  const diagnostic=presentation.simplesDiagnostic;
  if(diagnostic?.version==='SIMPLES_DIAGNOSTIC_V1'){
    textLine(['Simples Nacional',diagnostic.message,'Ação',diagnostic.action]);
    textLine(['Simples · critério',diagnostic.revenueBasis==='ACTUAL_REPORT_MONTHS'?'Receita real das competências importadas':'Receita anual da projeção salva','O cálculo não confirma a opção ou permanência legal no regime.']);
    for(const [label,value] of [['Receita de referência',diagnostic.revenueReference],['RBT12',diagnostic.rbt12],['Menor RBT12',diagnostic.rbt12Min],['Maior RBT12',diagnostic.rbt12Max],['Limite federal',diagnostic.federalLimit],['Sublimite de ICMS/ISS',diagnostic.sublimit]]){
      if(value!==undefined)lines.push([textCell('Simples · bases'),textCell(label),numberCell(value)].join(';'));
    }
    for(const item of diagnostic.assumptions||[])textLine(['Simples · premissa',item]);
  }
  for(const note of dreDifalNotes(presentation))textLine(['DIFAL nos cenários',note]);
  if (showPercent) textLine(['Análise vertical', presentation.percentBasis || 'Receita utilizada na simulação, no mesmo período e regime']);
  if (presentation.revenueReconciliation?.note) textLine(['Fechamento da receita',presentation.revenueReconciliation.note]);
  if (presentation.icmsReconciliation?.note) textLine(['Critério do crédito de ICMS',presentation.icmsReconciliation.note]);
  lines.push('');

  if(fixed&&!monthly){
    textLine(['DRE resumida · consolidado de janeiro a setembro']);
    textLine(['Indicador',...regimes.map(regime=>regime.name)]);
    const summaries=regimes.map(regime=>buildDreExecutiveSummary(presentation,{id:regime.id,mode:'annual'}));
    for(const item of summaries[0]?.rows||[]){
      if(item.key==='revenueManualAdjustment'&&summaries.every(summary=>summary.rows.find(row=>row.key===item.key)?.value===0))continue;
      lines.push([textCell(item.label),...summaries.map(summary=>numberCell(summary.rows.find(row=>row.key===item.key)?.value))].join(';'));
    }
    lines.push([textCell('Impostos e encargos totais · indicador'),...summaries.map(summary=>numberCell(summary.taxes))].join(';'));
    lines.push([textCell('Margem líquida · %'),...summaries.map(summary=>numberCell(summary.margin,true))].join(';'));
    lines.push([textCell('Créditos tributários utilizados · informativo'),...regimes.map(regime=>numberCell(readDreValue(presentation.appliedCredits,{id:regime.id,mode:'annual'})))].join(';'));
    textLine(['Créditos tributários','Já considerados nos impostos/compras; não somar novamente. Não representam restituição em dinheiro.']);
    lines.push('');
  }
  const composition=fixed?presentation.commercialComposition:null;
  if(composition?.version==='COMMERCIAL_COMPOSITION_V1'){
    const labels={B2B:'B2B · empresas',B2C:'B2C · CPF',UNIDENTIFIED:'Tipo de cliente não identificado',OPTANTE:'Optantes do Simples',NAO_OPTANTE:'Fora do Simples',CPF:'CPF',NAO_CONFIRMADO:'Situação não confirmada',OUTROS:'Outros documentos'};
    textLine(['Composição dos documentos · janeiro a setembro','Valores das fontes após devoluções; percentuais sobre a receita ou as compras do período. Ajustes manuais estão na DRE e não redistribuem clientes ou fornecedores.']);
    for(const [scope,entries,denominator] of [['Receita por cliente',composition.revenue.byCustomerType,composition.revenue.percentDenominatorCents],['Receita por situação tributária',composition.revenue.byTaxStatus,composition.revenue.percentDenominatorCents],['Compras por fornecedor',composition.purchases.byTaxStatus,composition.purchases.percentDenominatorCents]]){
      textLine([scope,'Composição','Valor (BRL)','Percentual (%)','Base do percentual (BRL)']);
      for(const item of entries)lines.push([textCell(scope),textCell(labels[item.key]||item.key),numberCell(item.totalCents/100),numberCell(item.percent===null?null:item.percent/100,true),numberCell(denominator/100)].join(';'));
    }
    lines.push('');
  }

  const prefix = row => [...(contexts.get(row) || ['DRE','']), row.label, row.kind || 'line', row.unit === 'percent' ? '%' : 'BRL'];
  const annualTable=()=>{
    if(complete)textLine([fixed?'Demonstrativo consolidado · janeiro a setembro':'Demonstrativo anual consolidado']);
    textLine(['Escopo','Seção','Indicador','Tipo','Unidade', ...regimes.flatMap(regime => showPercent ? [regime.name, `${regime.name} · % da receita`] : [regime.name]), 'Observações','Referências']);
    for (const row of rows) {
      const cells = prefix(row).map(textCell);
      for (const regime of regimes) {
        cells.push(numberCell(valueFor(row, regime, 'annual'), row.unit === 'percent'));
        if (showPercent) cells.push(row.unit === 'currency' ? numberCell(percentFor(row, regime, 'annual'), true) : textCell(''));
      }
      cells.push(textCell(rowNotes(row, regimes, false)), textCell((row.sourceRefs || []).join(' | ')));
      lines.push(cells.join(';'));
    }
  };
  const monthlyTable=()=>{
    if(complete){lines.push('');textLine([`Demonstrativos mensais · ${regimeScope}`]);}
    const months = Array.from({length:monthCount}, (_, index) => presentation.months?.[index]?.label || MONTHS[index]);
    const columns = [...months, fixed?'Consolidado Jan–Set / indicador do período':'Total anual / indicador anual'];
    textLine(['Regime','Escopo','Seção','Indicador','Tipo','Unidade', ...columns.flatMap(label => showPercent ? [label, `${label} · % da receita`] : [label]), 'Observações','Referências']);
    for (const regime of regimes) {
      for (const row of rows) {
        const cells = [regime.name,...prefix(row)].map(textCell);
        for (let index = 0; index <= monthCount; index++) {
          const frame = index === monthCount ? 'calendarAnnual' : 'monthly';
          cells.push(numberCell(valueFor(row, regime, frame, index), row.unit === 'percent'));
          if (showPercent) cells.push(row.unit === 'currency' ? numberCell(percentFor(row, regime, frame, index), true) : textCell(''));
        }
        cells.push(textCell(rowNotes(row, [regime], true)), textCell((row.sourceRefs || []).join(' | ')));
        lines.push(cells.join(';'));
      }
    }
  };
  if(!monthly)annualTable();
  if(monthly||complete)monthlyTable();
  const report=presentation.report;
  if(report){
    lines.push('');textLine(['Premissas e referências do cálculo','Versão do motor',report.modelVersion||'Não registrada']);
    for(const warning of report.warnings||[])textLine(['Premissa / aviso',warning.title,warning.detail]);
    const entries=dreReportMemory(presentation);
    if(entries.length){
      textLine(['Memória consolidada','Seção','Item','Fórmula','Valor','Unidade']);
      for(const item of entries)lines.push([textCell('Memória'),textCell(item.section),textCell(item.label),textCell(item.formula),typeof item.value==='number'?numberCell(item.value,item.unit==='percent'):textCell(item.value),textCell(item.unit==='percent'?'%':item.unit==='currency'?'BRL':item.unit)].join(';'));
    }
    for(const source of report.sources||[])textLine(['Referência normativa',source.label,source.url]);
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
