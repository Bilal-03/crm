export function createPhase0Fixtures(now = new Date('2026-08-20T12:00:00.000Z')) {
  const leads = [
    {
      id: fixtureId(1),
      name: 'Historical Won Lead',
      email: 'won@example.com',
      stage: 'closed-won',
      created_at: '2026-06-01T10:00:00.000Z',
      won_at: '2026-08-15T10:00:00.000Z',
      lost_at: null,
      source: 'Referral',
    },
    {
      id: fixtureId(2),
      name: 'Historical Lost Lead',
      email: 'lost@example.com',
      stage: 'closed-lost',
      created_at: '2026-06-02T10:00:00.000Z',
      won_at: null,
      lost_at: '2026-08-10T10:00:00.000Z',
      source: 'Website',
    },
  ];

  for (let index = 3; index <= 501; index += 1) {
    leads.push({
      id: fixtureId(index),
      name: `Seed Lead ${index}`,
      email: `seed-${index}@example.com`,
      stage: 'new',
      created_at: '2026-08-01T10:00:00.000Z',
      won_at: null,
      lost_at: null,
      source: index % 2 === 0 ? 'Website' : 'Referral',
    });
  }

  return {
    now,
    leads,
    invoices: [
      {
        id: fixtureId(600),
        status: 'partial',
        total_amount: 1000,
        amount_paid: 250,
        balance_due: 750,
        invoice_date: '2026-08-01',
        paid_at: null,
      },
      {
        id: fixtureId(601),
        status: 'paid',
        total_amount: 1500,
        amount_paid: 1500,
        balance_due: 0,
        invoice_date: '2026-06-01',
        paid_at: '2026-08-16T12:00:00.000Z',
      },
    ],
    meetings: [
      { id: fixtureId(700), date_time: '2026-08-18T12:00:00.000Z' },
    ],
  };
}

function fixtureId(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
