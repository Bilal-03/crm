export function createPhase6Fixtures() {
  return {
    window: { rangeDays: 30, startDate: '2026-08-01', endDateExclusive: '2026-08-31' },
    currency: 'USD',
    deals: [
      { id: 'open-1', status: 'open', currency: 'USD', amount: 1000, probability: 50, forecast_category: 'pipeline', created_at: '2026-07-01' },
      { id: 'open-2', status: 'open', currency: 'USD', amount: 200, probability: 80, forecast_category: 'commit', created_at: '2026-07-01' },
      { id: 'open-3', status: 'open', currency: 'USD', amount: 300, probability: 20, forecast_category: 'best_case', created_at: '2026-07-01' },
      { id: 'won-period', status: 'won', currency: 'USD', amount: 600, probability: 100, created_at: '2026-07-26', actual_close_date: '2026-08-05' },
      { id: 'lost-period', status: 'lost', currency: 'USD', amount: 200, probability: 0, created_at: '2026-08-01', actual_close_date: '2026-08-11' },
      { id: 'won-before', status: 'won', currency: 'USD', amount: 400, probability: 100, created_at: '2026-06-01', actual_close_date: '2026-07-15' },
      { id: 'eur-open', status: 'open', currency: 'EUR', amount: 999, probability: 100, forecast_category: 'commit', created_at: '2026-07-01' },
    ],
    payments: [
      { status: 'settled', currency: 'USD', amount: 250, payment_date: '2026-08-03' },
      { status: 'void', currency: 'USD', amount: 100, payment_date: '2026-08-04' },
      { status: 'settled', currency: 'EUR', amount: 500, payment_date: '2026-08-05' },
      { status: 'settled', currency: 'USD', amount: 50, payment_date: '2026-07-31' },
    ],
    activities: [
      { created_at: '2026-08-01', completed_at: '2026-08-02' },
      { created_at: '2026-08-03', completed_at: null },
      { created_at: '2026-07-20', completed_at: '2026-08-04' },
    ],
  };
}
