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
