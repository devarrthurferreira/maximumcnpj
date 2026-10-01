import test from 'node:test';
import assert from 'node:assert/strict';
import {sameReportCompetences} from '../src/report-competence.ts';

function period(startDate: string, endDate: string) {
  const [sy, sm] = startDate.split('-').map(Number), [ey, em] = endDate.split('-').map(Number);
  return {startDate, endDate, startMonth: startDate.slice(0, 7), endMonth: endDate.slice(0, 7), months: (ey - sy) * 12 + em - sm + 1};
}

test('Caso informado: 02/04–31/08 e 01/04–31/08 são as mesmas cinco competências', () => {
  const purchases = period('2026-04-02', '2026-08-31'), sales = period('2026-04-01', '2026-08-31');
  assert.equal(purchases.months, 5);
  assert.equal(sameReportCompetences(purchases, sales), true);
  assert.equal(sameReportCompetences(sales, purchases), true);
  assert.equal(purchases.startDate, '2026-04-02');
});
test('Dias iniciais e finais diferentes no mesmo mês são aceitos', () => {
  assert.equal(sameReportCompetences(period('2026-04-02', '2026-08-30'), period('2026-04-25', '2026-08-01')), true);
  assert.equal(sameReportCompetences(period('2026-08-01', '2026-08-01'), period('2026-08-31', '2026-08-31')), true);
});
test('Meses sem movimento não reduzem nem tornam diferente o intervalo', () => {
  const base = period('2026-04-02', '2026-08-31');
  assert.equal(sameReportCompetences({...base, observedMonths: 2, missingMonths: ['2026-05', '2026-06', '2026-07']},
    {...base, startDate: '2026-04-01', observedMonths: 5, missingMonths: []}), true);
});
test('Mês inicial, final ou ano diferente continuam rejeitados mesmo com igual quantidade', () => {
  const base = period('2026-04-02', '2026-08-31');
  for (const other of [period('2026-05-01', '2026-08-31'), period('2026-04-01', '2026-09-01'),
    period('2026-05-01', '2026-09-01'), period('2025-04-01', '2025-08-31')]) {
    assert.equal(sameReportCompetences(base, other), false);
  }
});
test('Virada de ano, fevereiro bissexto e doze meses inclusivos', () => {
  assert.equal(sameReportCompetences(period('2025-11-30', '2026-02-01'), period('2025-11-01', '2026-02-28')), true);
  assert.equal(sameReportCompetences(period('2024-02-01', '2024-02-29'), period('2024-02-29', '2024-02-29')), true);
  const a = period('2025-09-30', '2026-08-01'), b = period('2025-09-01', '2026-08-31');
  assert.equal(a.months, 12); assert.equal(sameReportCompetences(a, b), true);
});
test('Ausência e metadados inconsistentes nunca passam pela comparação', () => {
  const valid = period('2026-04-01', '2026-08-31');
  for (const invalid of [null, undefined, {}, [], '2026-04', {...valid, months: 4}, {...valid, months: '5'},
    {...valid, startMonth: '2026-13'}, {...valid, startMonth: '2026-4'}, {...valid, endMonth: '2026-03'},
    period('2025-08-01', '2026-08-31')]) {
    assert.equal(sameReportCompetences(valid, invalid), false);
    assert.equal(sameReportCompetences(invalid, invalid), false);
  }
});
