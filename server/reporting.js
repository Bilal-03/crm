export function getReportWindow(rangeDays, now = new Date()) {
  const normalizedDays = Number(rangeDays);
  if (!Number.isInteger(normalizedDays) || normalizedDays < 1) {
    throw new Error('rangeDays must be a positive integer');
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (normalizedDays - 1));
  const endExclusive = new Date(today);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    rangeDays: normalizedDays,
    startDate: toDateOnly(start),
    endDateExclusive: toDateOnly(endExclusive),
  };
}

export function getExplicitReportWindow(startDate, endDate) {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  if (end < start) throw new Error('endDate must be on or after startDate');
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const rangeDays = Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  return {
    rangeDays,
    startDate: toDateOnly(start),
    endDateExclusive: toDateOnly(endExclusive),
  };
}

export function calculateManagementMetrics({ deals = [], payments = [], activities = [] }, window, currency) {
  const inRange = value => dateInWindow(value, window);
  const scopedDeals = deals.filter(deal => !currency || deal.currency === currency);
  const closed = scopedDeals.filter(deal => ['won', 'lost'].includes(deal.status) && inRange(deal.actual_close_date));
  const won = closed.filter(deal => deal.status === 'won');
  const lost = closed.filter(deal => deal.status === 'lost');
  const open = scopedDeals.filter(deal => deal.status === 'open');
  const wonAmount = sum(won, deal => deal.amount);
  const averageDealSize = won.length ? wonAmount / won.length : 0;
  const cycleDays = closed
    .map(deal => daysBetween(deal.created_at, deal.actual_close_date))
    .filter(value => Number.isFinite(value) && value >= 0);
  const averageCycleDays = cycleDays.length ? cycleDays.reduce((total, value) => total + value, 0) / cycleDays.length : 0;
  const winRate = closed.length ? won.length / closed.length : 0;
  const revenueCollected = sum(payments.filter(payment => (
    payment.status === 'settled'
      && (!currency || payment.currency === currency)
      && inRange(payment.payment_date)
  )), payment => payment.amount);

  return {
    openPipeline: sum(open, deal => deal.amount),
    weightedPipeline: sum(open, deal => Number(deal.amount) * Number(deal.probability || 0) / 100),
    bestCase: sum(open.filter(deal => ['best_case', 'commit'].includes(deal.forecast_category)), deal => deal.amount),
    commit: sum(open.filter(deal => deal.forecast_category === 'commit'), deal => deal.amount),
    wonAmount,
    lostAmount: sum(lost, deal => deal.amount),
    dealsWon: won.length,
    dealsLost: lost.length,
    winRate: winRate * 100,
    averageDealSize,
    averageCycleDays,
    salesVelocity: averageCycleDays > 0 ? open.length * winRate * averageDealSize / averageCycleDays : 0,
    revenueCollected,
    activitiesCreated: activities.filter(activity => inRange(activity.created_at)).length,
    activitiesCompleted: activities.filter(activity => inRange(activity.completed_at)).length,
  };
}

export const REPORT_DEFINITIONS = Object.freeze({
  openPipeline: 'Current amount of open deals in the selected currency, regardless of creation date.',
  weightedPipeline: 'Current open deal amount multiplied by each deal probability.',
  bestCase: 'Current open deals categorized as best case or commit.',
  commit: 'Current open deals categorized as commit.',
  wonAmount: 'Amount of deals whose effective close date falls in the selected period and whose status is won.',
  lostAmount: 'Amount of deals whose effective close date falls in the selected period and whose status is lost.',
  winRate: 'Won deals divided by all won and lost deals closed in the selected period.',
  averageDealSize: 'Average amount of won deals closed in the selected period.',
  averageCycleDays: 'Average calendar days from deal creation to effective close for deals closed in the selected period.',
  salesVelocity: 'Current open deal count × period win rate × average won deal size ÷ average sales cycle days.',
  revenueCollected: 'Settled payment events whose payment date falls in the selected period.',
  stageConversion: 'Deals entering a stage in the selected period that later exited that same stage by the period end.',
  stageAge: 'Calendar days since the latest stage-entry event for currently open deals.',
});

export function calculateReportMetrics({ leads = [], invoices = [], meetings = [] }, window) {
  const inRange = value => {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time)
      && time >= new Date(`${window.startDate}T00:00:00Z`).getTime()
      && time < new Date(`${window.endDateExclusive}T00:00:00Z`).getTime();
  };

  const newLeads = leads.filter(lead => inRange(lead.created_at || lead.createdAt));
  const won = leads.filter(lead => inRange(lead.won_at || lead.wonAt));
  const lost = leads.filter(lead => inRange(lead.lost_at || lead.lostAt));
  const paid = invoices.filter(invoice => invoice.status === 'paid' && inRange(invoice.paid_at || invoice.paidAt || invoice.invoice_date));
  const meetingsInRange = meetings.filter(meeting => inRange(meeting.date_time || meeting.dateTime));
  const revenue = paid.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  const closed = won.length + lost.length;

  return {
    newLeads: newLeads.length,
    dealsWon: won.length,
    dealsLost: lost.length,
    closeRate: closed ? Math.round((won.length / closed) * 100) : 0,
    revenueCollected: revenue,
    paidInvoices: paid.length,
    meetingsScheduled: meetingsInRange.length,
    averageLeadsPerDay: newLeads.length / window.rangeDays,
  };
}

function toDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || toDateOnly(parsed) !== value) throw new Error(`${field} must be a valid date`);
  return parsed;
}

function dateInWindow(value, window) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time)
    && time >= new Date(`${window.startDate}T00:00:00Z`).getTime()
    && time < new Date(`${window.endDateExclusive}T00:00:00Z`).getTime();
}

function daysBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return (endTime - startTime) / 86_400_000;
}

function sum(rows, value) {
  return rows.reduce((total, row) => total + Number(value(row) || 0), 0);
}
