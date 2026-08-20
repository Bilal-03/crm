export const GOAL_METRICS = Object.freeze({
  won_revenue: {
    label: 'Won revenue',
    definition: 'Deal amount whose effective won date falls inside the inclusive goal period.',
    forecastDefinition: 'Won revenue plus probability-weighted open deals expected to close inside the goal period.',
    unit: 'currency',
  },
  collected_revenue: {
    label: 'Collected revenue',
    definition: 'Settled payment amount whose payment date falls inside the inclusive goal period.',
    forecastDefinition: 'Collected revenue plus current invoice balances due inside the goal period.',
    unit: 'currency',
  },
  deals_won: {
    label: 'Deals won',
    definition: 'Count of deals whose effective won date falls inside the inclusive goal period.',
    forecastDefinition: 'Won-deal count plus probability-weighted open deals expected to close inside the goal period.',
    unit: 'count',
  },
});

export function calculateGoalProgress(goal, values, asOfDate = new Date()) {
  const start = parseDate(goal.period_start);
  const end = parseDate(goal.period_end);
  const asOf = normalizeDate(asOfDate);
  const totalDays = dayDifference(start, end) + 1;
  const elapsedDays = asOf < start ? 0 : asOf > end ? totalDays : dayDifference(start, asOf) + 1;
  const remainingDays = Math.max(totalDays - elapsedDays, 0);
  const target = Number(goal.target_value);
  const actual = Number(values.actual || 0);
  const forecast = Number(values.forecast || 0);
  const elapsedRatio = totalDays > 0 ? elapsedDays / totalDays : 1;
  const expectedToDate = target * elapsedRatio;
  const attainmentPercent = target > 0 ? actual / target * 100 : 0;
  const forecastAttainmentPercent = target > 0 ? forecast / target * 100 : 0;
  const paceVariance = actual - expectedToDate;
  const remainingValue = Math.max(target - actual, 0);
  const paceStatus = elapsedDays === 0
    ? 'upcoming'
    : actual >= target
      ? 'complete'
      : attainmentPercent >= elapsedRatio * 100 - 2
        ? 'on_track'
        : 'behind';

  return {
    target,
    actual,
    forecast,
    totalDays,
    elapsedDays,
    remainingDays,
    elapsedPercent: elapsedRatio * 100,
    expectedToDate,
    attainmentPercent,
    forecastAttainmentPercent,
    paceVariance,
    remainingValue,
    requiredPerRemainingDay: remainingDays > 0 ? remainingValue / remainingDays : 0,
    paceStatus,
    forecastStatus: forecast >= target ? 'projected_to_hit' : 'projected_to_miss',
  };
}

function parseDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Goal dates must be valid date values.');
  return date;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayDifference(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
