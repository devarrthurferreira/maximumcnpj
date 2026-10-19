/** Exports the presentation already prepared for the screen; never runs the calculator. */
import {unifiedDreRows} from './simulator-dre.js';

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
  return contexts;
}

function valueFor(row, regime, frame, month) {
  if (!regime.available) return null;
  if (frame === 'monthly') return row.monthlyValues?.[regime.id]?.[month] ?? null;
  if (frame === 'calendarAnnual') return row.calendarAnnualValues?.[regime.id] ?? null;
  return row.values?.[regime.id] ?? null;
}

function percentFor(row, regime, frame, month) {
  if (!regime.available || row.unit !== 'currency') return null;
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
    else if (!regime.available) notes.push(`${regime.name}: cenário indisponível.`);
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
 * a column and retains all twelve captured months plus the captured annual total.
 */
export function buildDreCsv({presentation, period = 'annual', company = {}, year, showPercent = false}) {
  if (!presentation || !Array.isArray(presentation.regimes) || !Array.isArray(presentation.sections)) {
    throw new TypeError('DRE inválida para exportação.');
  }
  if (!['annual','monthly'].includes(period)) throw new TypeError('Período da DRE inválido.');
  const lines = [];
  const textLine = cells => lines.push(cells.map(textCell).join(';'));
  const monthly = period === 'monthly';
  const regimes = presentation.regimes;
  const rows = unifiedDreRows(presentation);
  const contexts = rowContexts(presentation);
  textLine(['DRE completa', monthly ? 'Mensal · janeiro a dezembro · todos os regimes' : 'Anual · comparação de todos os regimes']);
  textLine(['Empresa', company.name || '', 'Código', company.code || '', 'CNPJ', company.cnpj || '']);
  textLine(['Ano do cenário', year ?? presentation.year ?? presentation.calendarYear ?? '', 'Versão da apresentação', presentation.version || '']);
  textLine(['Unidades', 'Valores monetários em BRL (R$); percentuais em %.']);
  textLine(['Critério', 'Valores da simulação preservados. Projeção mensal, não lançamentos históricos.']);
  textLine(['Arredondamento', 'Exibição com duas casas decimais; a soma dos meses exibidos pode diferir por centavos do total anual preservado.']);
  if (showPercent) textLine(['Análise vertical', presentation.percentBasis || 'Receita bruta total do cenário']);
  lines.push('');

  const prefix = row => [...(contexts.get(row) || ['DRE','']), row.label, row.kind || 'line', row.unit === 'percent' ? '%' : 'BRL'];
  if (!monthly) {
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
  } else {
    const months = Array.from({length:12}, (_, index) => presentation.months?.[index]?.label || MONTHS[index]);
    const columns = [...months, 'Total anual / indicador anual'];
    textLine(['Regime','Escopo','Seção','Indicador','Tipo','Unidade', ...columns.flatMap(label => showPercent ? [label, `${label} · % da receita`] : [label]), 'Observações','Referências']);
    for (const regime of regimes) {
      for (const row of rows) {
        const cells = [regime.name,...prefix(row)].map(textCell);
        for (let index = 0; index < 13; index++) {
          const frame = index === 12 ? 'calendarAnnual' : 'monthly';
          cells.push(numberCell(valueFor(row, regime, frame, index), row.unit === 'percent'));
          if (showPercent) cells.push(row.unit === 'currency' ? numberCell(percentFor(row, regime, frame, index), true) : textCell(''));
        }
        cells.push(textCell(rowNotes(row, [regime], true)), textCell((row.sourceRefs || []).join(' | ')));
        lines.push(cells.join(';'));
      }
    }
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
