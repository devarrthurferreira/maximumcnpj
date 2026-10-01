/** Month ranges are for comparing separate reports, never for validating a stored snapshot. */
type CompetenceRange = {startMonth: string; endMonth: string; months: number};

function validRange(value: unknown): value is CompetenceRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const period = value as Partial<CompetenceRange>;
  const month = /^(?:19\d{2}|20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])$/;
  if (typeof period.startMonth !== 'string' || typeof period.endMonth !== 'string' ||
      !month.test(period.startMonth) || !month.test(period.endMonth) ||
      typeof period.months !== 'number' || !Number.isInteger(period.months)) return false;
  const [sy, sm] = period.startMonth.split('-').map(Number);
  const [ey, em] = period.endMonth.split('-').map(Number);
  const expected = (ey - sy) * 12 + em - sm + 1;
  return expected >= 1 && expected <= 12 && period.months === expected;
}

/** Days and months without transactions do not change the inclusive competence range. */
export function sameReportCompetences(left: unknown, right: unknown): boolean {
  return validRange(left) && validRange(right) &&
    left.startMonth === right.startMonth && left.endMonth === right.endMonth && left.months === right.months;
}
