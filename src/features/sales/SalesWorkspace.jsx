import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Edit2,
  Filter,
  LayoutGrid,
  List,
  Mail,
  MoveRight,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  Target,
  TrendingUp,
  User,
  Users,
  X,
} from 'lucide-react';
import { ErrorState, LoadingState, ResourceEmptyState } from '../../components/ui/ResourceState.jsx';

const STAGE_AGING_DAYS = 14;
const FALLBACK_STAGES = [
  { key: 'new', name: 'New Lead', position: 10, probability: 10, color: '#3B82F6' },
  { key: 'qualified', name: 'Qualified', position: 20, probability: 25, color: '#8B5CF6' },
  { key: 'follow-up', name: 'Follow-up', position: 30, probability: 40, color: '#F59E0B' },
  { key: 'proposal', name: 'Proposal', position: 40, probability: 60, color: '#10B981' },
  { key: 'closed-won', name: 'Closed Won', position: 50, probability: 100, color: '#059669', is_closed_won: true },
  { key: 'closed-lost', name: 'Closed Lost', position: 60, probability: 0, color: '#EF4444', is_closed_lost: true },
];

const todayKey = () => new Date().toISOString().slice(0, 10);

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function daysBetween(from, to = new Date()) {
  if (!from) return 0;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((to.getTime() - start.getTime()) / 86_400_000));
}

function nextActivityForDeal(deal, activities = []) {
  return activities
    .filter(activity => !activity.completed && (
      activity.deal_id === deal.id
      || activity.lead_id === deal.source_lead_id
      || activity.account_id === deal.account_id
      || activity.contact_id === deal.primary_contact_id
    ))
    .sort((left, right) => new Date(left.due_at || left.created_at || 0).getTime() - new Date(right.due_at || right.created_at || 0).getTime())[0] || null;
}

function attentionForDeal(deal, activities = []) {
  if (!deal || deal.status !== 'open') return [];
  const attention = [];
  const today = todayKey();
  const nextActivityDate = nextActivityForDeal(deal, activities)?.due_at?.slice(0, 10) || deal.next_activity_date;
  if (!nextActivityDate) attention.push({ key: 'no-next-activity', label: 'No next activity', tone: 'amber' });
  if (nextActivityDate && nextActivityDate < today) attention.push({ key: 'overdue', label: 'Overdue activity', tone: 'red' });
  if (deal.expected_close_date && deal.expected_close_date < today) attention.push({ key: 'passed-close', label: 'Passed close date', tone: 'red' });
  if (daysBetween(deal.updated_at) >= STAGE_AGING_DAYS) attention.push({ key: 'aging', label: `Aging ${daysBetween(deal.updated_at)}d`, tone: 'violet' });
  return attention;
}

function stageForDeal(deal, stages) {
  return deal?.stage || stages.find(stage => stage.id === deal?.stage_id) || stages.find(stage => stage.key === deal?.stage_key) || stages[0] || FALLBACK_STAGES[0];
}

function pipelineStages(pipelines) {
  const pipeline = pipelines.find(item => item.is_default) || pipelines[0];
  const stages = [...(pipeline?.stages || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  return { pipeline, stages: stages.length ? stages : FALLBACK_STAGES };
}

function toneClass(tone) {
  return {
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  }[tone] || 'border-gray-200 bg-gray-50 text-gray-700';
}

function PageHeading({ eyebrow = 'Sales workspace', title, description, actions }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

function PrimaryButton({ children, icon: Icon = Plus, ...props }) {
  return <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50" {...props}><Icon className="h-4 w-4" aria-hidden="true" />{children}</button>;
}

function SecondaryButton({ children, icon: Icon, ...props }) {
  return <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50" {...props}>{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}{children}</button>;
}

function AttentionBadge({ item }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${toneClass(item.tone)}`}>{item.label}</span>;
}

function StageBadge({ stage }) {
  if (!stage) return null;
  return <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: `${stage.color || '#6366F1'}18`, color: stage.color || '#4F46E5' }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color || '#6366F1' }} />{stage.name || stage.label || stage.key}</span>;
}

function Dialog({ title, description, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const previousActiveRef = useRef(null);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    previousActiveRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]') || [])];
    window.setTimeout(() => focusables()[0]?.focus(), 0);
    const handleKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusables();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousActiveRef.current?.isConnected) previousActiveRef.current.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-gray-950/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sales-dialog-title" className={`max-h-[min(92vh,56rem)] w-full overflow-y-auto rounded-t-3xl border border-gray-200 bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="sales-dialog-title" className="text-xl font-bold text-gray-950">{title}</h2>{description && <p className="mt-1 text-sm text-gray-600">{description}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function SearchToolbar({ search, onSearch, placeholder, filter, onFilter, filterLabel = 'All records', children, density, onDensityChange, columns, visibleColumns, onToggleColumn }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <label className="sr-only" htmlFor="sales-search">Search records</label>
        <input id="sales-search" value={search} onChange={event => onSearch(event.target.value)} placeholder={placeholder} className="crm-field min-h-11 w-full pl-9" />
      </div>
      {filter && <label className="relative"><span className="sr-only">{filterLabel}</span><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" /><select value={filter.value} onChange={event => filter.onChange(event.target.value)} className="crm-field min-h-11 w-full appearance-none pl-9 pr-9 sm:w-auto">{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" /></label>}
      {children}
      <label className="relative"><span className="sr-only">Table density</span><select value={density} onChange={event => onDensityChange(event.target.value)} className="crm-field min-h-11 appearance-none pr-9"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" /></label>
      <details className="relative">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Columns</summary>
        <div className="absolute right-0 top-12 z-20 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Visible columns</p>
          <div className="mt-2 space-y-2">{columns.map(column => <label key={column.key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={() => onToggleColumn(column.key)} disabled={column.required} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />{column.label}</label>)}</div>
        </div>
      </details>
    </div>
  );
}

function useTablePreferences(defaultColumns) {
  const [density, setDensity] = useState('comfortable');
  const [visibleColumns, setVisibleColumns] = useState(defaultColumns.map(column => column.key));
  const toggleColumn = key => setVisibleColumns(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  return { density, setDensity, visibleColumns, toggleColumn };
}

function DataTable({ columns, rows, visibleColumns, density, onRowClick, empty }) {
  const shownColumns = columns.filter(column => visibleColumns.includes(column.key) || column.required);
  if (!rows.length) return empty;
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="divide-y divide-gray-100 md:hidden">
        {rows.map(row => <button type="button" key={row.id} onClick={() => onRowClick?.(row)} className="block w-full p-4 text-left hover:bg-gray-50"><div className="flex items-start justify-between gap-3"><div className="min-w-0">{shownColumns.slice(0, 2).map(column => <div key={column.key} className={column.key === shownColumns[0].key ? 'font-semibold text-gray-950' : 'mt-1 text-sm text-gray-600'}>{column.render(row)}</div>)}</div><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /></div>{shownColumns.slice(2, 4).map(column => <div key={column.key} className="mt-2 text-sm text-gray-600">{column.render(row)}</div>)}</button>)}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50"><tr>{shownColumns.map(column => <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">{column.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">{rows.map(row => <tr key={row.id} onClick={() => onRowClick?.(row)} className={`transition ${onRowClick ? 'cursor-pointer hover:bg-indigo-50/40' : ''}`}>{shownColumns.map(column => <td key={column.key} className={`${density === 'compact' ? 'px-4 py-2.5' : 'px-4 py-4'} whitespace-nowrap text-sm text-gray-700`}>{column.render(row)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'indigo' }) {
  const toneMap = { indigo: 'bg-indigo-50 text-indigo-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700' };
  return <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-gray-950">{value}</p>{detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}</div><div className={`rounded-xl p-3 ${toneMap[tone] || toneMap.indigo}`}><Icon className="h-5 w-5" aria-hidden="true" /></div></div></div>;
}

function SalesDashboard({ summary, deals, pipelines, activities, onNavigate, onOpenDeal, onAddLead }) {
  const { stages } = pipelineStages(pipelines);
  const openDeals = deals.filter(deal => deal.status === 'open');
  const attentionDeals = openDeals.map(deal => ({ deal, attention: attentionForDeal(deal, activities) })).filter(item => item.attention.length).sort((a, b) => b.attention.length - a.attention.length || Number(b.deal.amount || 0) - Number(a.deal.amount || 0));
  const currency = summary?.deals?.currency || openDeals[0]?.currency || 'USD';
  const openValue = summary?.deals?.openPipelineAmount ?? openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
  const weightedValue = summary?.deals?.weightedPipelineAmount ?? openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0) * Number(deal.probability || 0) / 100, 0);
  const wonValue = summary?.deals?.closedWonAmount ?? deals.filter(deal => deal.status === 'won').reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
  return <div className="space-y-8">
    <PageHeading title="Sales command center" description="See what needs attention, what is moving, and where revenue is expected next." actions={<><SecondaryButton icon={LayoutGrid} onClick={() => onNavigate('pipeline')}>Open pipeline</SecondaryButton><PrimaryButton onClick={onAddLead}>Add lead</PrimaryButton></>} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sales metrics">
      <MetricCard label="Open pipeline" value={formatMoney(openValue, currency)} detail={`${openDeals.length} open opportunities`} icon={Target} />
      <MetricCard label="Weighted pipeline" value={formatMoney(weightedValue, currency)} detail="Amount × probability" icon={TrendingUp} tone="amber" />
      <MetricCard label="Closed won" value={formatMoney(wonValue, currency)} detail={`${deals.filter(deal => deal.status === 'won').length} won deals`} icon={CheckCircle2} tone="emerald" />
      <MetricCard label="Needs attention" value={attentionDeals.length} detail="Open deals with a risk signal" icon={AlertTriangle} tone={attentionDeals.length ? 'red' : 'indigo'} />
    </section>
    <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-gray-950">Pipeline snapshot</h2><p className="mt-1 text-sm text-gray-500">Real deal value by stage.</p></div><button type="button" onClick={() => onNavigate('pipeline')} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">View pipeline <ArrowRight className="inline h-4 w-4" aria-hidden="true" /></button></div><div className="mt-6 space-y-4">{stages.map(stage => { const stageDeals = deals.filter(deal => stageForDeal(deal, stages).id === stage.id || stageForDeal(deal, stages).key === stage.key); const value = stageDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0); return <button type="button" key={stage.id || stage.key} onClick={() => onNavigate('pipeline')} className="group flex w-full items-center gap-3 text-left"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} /><span className="w-28 shrink-0 text-sm font-semibold text-gray-700">{stage.name}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full transition-all group-hover:opacity-80" style={{ width: `${Math.min(100, Math.max(stageDeals.length ? 15 : 0, stageDeals.length / Math.max(deals.length, 1) * 100))}%`, backgroundColor: stage.color }} /></span><span className="w-24 text-right text-sm font-semibold text-gray-900">{formatMoney(value, currency)}</span><span className="w-6 text-right text-xs text-gray-500">{stageDeals.length}</span></button>; })}</div></div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"><div><h2 className="text-lg font-bold text-gray-950">Deal attention</h2><p className="mt-1 text-sm text-gray-500">The next decisions for your open pipeline.</p></div>{attentionDeals.length ? <div className="mt-5 space-y-3">{attentionDeals.slice(0, 5).map(({ deal, attention }) => <button type="button" key={deal.id} onClick={() => onOpenDeal(deal)} className="w-full rounded-xl border border-gray-100 p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-gray-950">{deal.name}</p><p className="mt-1 truncate text-sm text-gray-500">{deal.account?.name || 'No account'} · {formatMoney(deal.amount, deal.currency)}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /></div><div className="mt-3 flex flex-wrap gap-2">{attention.slice(0, 2).map(item => <AttentionBadge key={item.key} item={item} />)}</div></button>)}</div> : <div className="mt-8 rounded-xl bg-emerald-50 p-5 text-sm font-medium text-emerald-800"><CheckCircle2 className="mr-2 inline h-5 w-5" aria-hidden="true" />No open deals currently need attention.</div>}</div>
    </section>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-gray-950">Recent activity</h2><p className="mt-1 text-sm text-gray-500">The latest changes across your workspace.</p></div><button type="button" onClick={() => onNavigate('deals')} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">Open deals <ArrowRight className="inline h-4 w-4" aria-hidden="true" /></button></div>{activities.length ? <div className="mt-5 grid gap-3 md:grid-cols-2">{activities.slice(0, 6).map(activity => <div key={activity.id} className="flex gap-3 rounded-xl bg-gray-50 p-4"><div className="mt-0.5 rounded-lg bg-white p-2 text-indigo-600 shadow-sm"><Clock className="h-4 w-4" aria-hidden="true" /></div><div className="min-w-0"><p className="text-sm font-medium text-gray-800">{activity.message}</p><p className="mt-1 text-xs text-gray-500">{formatDateTime(activity.timestamp || activity.created_at)}</p></div></div>)}</div> : <p className="mt-5 text-sm text-gray-500">Activity will appear here as your team works deals.</p>}</section>
  </div>;
}

function LeadList({ leads, onAddLead, onEditLead, onViewLead, onConvertLead }) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const columns = useMemo(() => [
    { key: 'name', label: 'Lead', required: true, render: lead => <span className="font-semibold text-gray-950">{lead.name}</span> },
    { key: 'company', label: 'Company', render: lead => lead.company || '—' },
    { key: 'stage', label: 'Stage', render: lead => { const stage = FALLBACK_STAGES.find(item => item.key === lead.stage) || { key: lead.stage, name: lead.stage, color: '#6366F1' }; return <StageBadge stage={stage} />; } },
    { key: 'email', label: 'Contact', render: lead => <span className="inline-flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />{lead.email}</span> },
    { key: 'created', label: 'Created', render: lead => formatDate(lead.created_at || lead.createdAt) },
    { key: 'actions', label: 'Actions', required: true, render: lead => <span className="flex items-center gap-2" onClick={event => event.stopPropagation()}><button type="button" onClick={() => onEditLead(lead)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Edit ${lead.name}`}><Edit2 className="h-4 w-4" aria-hidden="true" /></button><button type="button" onClick={() => onConvertLead(lead)} className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50" aria-label={`Create deal from ${lead.name}`}><MoveRight className="h-4 w-4" aria-hidden="true" /></button></span> },
  ], [onConvertLead, onEditLead]);
  const preferences = useTablePreferences(columns);
  const rows = useMemo(() => leads.filter(lead => { const term = search.toLowerCase().trim(); return (!term || [lead.name, lead.company, lead.email, lead.phone].some(value => String(value || '').toLowerCase().includes(term))) && (stage === 'all' || lead.stage === stage); }), [leads, search, stage]);
  return <div className="space-y-6"><PageHeading title="Leads" description="Capture, qualify and convert new opportunities." actions={<PrimaryButton onClick={onAddLead}>Add lead</PrimaryButton>} /><SearchToolbar search={search} onSearch={setSearch} placeholder="Search leads, companies or email" filter={{ value: stage, onChange: setStage, options: [{ value: 'all', label: 'All stages' }, ...FALLBACK_STAGES.map(item => ({ value: item.key, label: item.name }))] }} density={preferences.density} onDensityChange={preferences.setDensity} columns={columns} visibleColumns={preferences.visibleColumns} onToggleColumn={preferences.toggleColumn} /><DataTable columns={columns} rows={rows} visibleColumns={preferences.visibleColumns} density={preferences.density} onRowClick={onViewLead} empty={<ResourceEmptyState title={search || stage !== 'all' ? 'No matching leads' : 'No leads yet'} description={search || stage !== 'all' ? 'Try a different search or stage filter.' : 'Add your first lead to begin the sales workflow.'} actionLabel={search || stage !== 'all' ? undefined : 'Add lead'} onAction={onAddLead} />} /></div>;
}

function ContactList({ contacts, accounts, onCreate, onEdit }) {
  const [search, setSearch] = useState('');
  const preferences = useTablePreferences([{ key: 'name' }, { key: 'account' }, { key: 'email' }, { key: 'phone' }, { key: 'updated' }]);
  const columns = useMemo(() => [
    { key: 'name', label: 'Contact', required: true, render: contact => <span><span className="font-semibold text-gray-950">{contact.name}</span>{contact.title && <span className="ml-2 text-xs text-gray-500">{contact.title}</span>}</span> },
    { key: 'account', label: 'Account', render: contact => contact.account?.name || accounts.find(account => account.id === contact.account_id)?.name || 'Unassigned' },
    { key: 'email', label: 'Email', render: contact => contact.email || '—' },
    { key: 'phone', label: 'Phone', render: contact => contact.phone || '—' },
    { key: 'updated', label: 'Updated', render: contact => formatDate(contact.updated_at) },
    { key: 'actions', label: 'Actions', required: true, render: contact => <button type="button" onClick={event => { event.stopPropagation(); onEdit(contact); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Edit ${contact.name}`}><Edit2 className="h-4 w-4" aria-hidden="true" /></button> },
  ], [accounts, onEdit]);
  const rows = contacts.filter(contact => [contact.name, contact.title, contact.email, contact.phone, contact.account?.name].some(value => String(value || '').toLowerCase().includes(search.toLowerCase().trim())));
  return <div className="space-y-6"><PageHeading title="Contacts" description="Keep people, roles and account relationships current." actions={<PrimaryButton onClick={() => onCreate()}>Add contact</PrimaryButton>} /><SearchToolbar search={search} onSearch={setSearch} placeholder="Search contacts" density={preferences.density} onDensityChange={preferences.setDensity} columns={columns} visibleColumns={preferences.visibleColumns} onToggleColumn={preferences.toggleColumn} /><DataTable columns={columns} rows={rows} visibleColumns={preferences.visibleColumns} density={preferences.density} onRowClick={onEdit} empty={<ResourceEmptyState title={search ? 'No matching contacts' : 'No contacts yet'} description={search ? 'Try a different search.' : 'Create a contact or convert a lead to start your relationship map.'} actionLabel={search ? undefined : 'Add contact'} onAction={() => onCreate()} />} /></div>;
}

function AccountList({ accounts, onCreate, onEdit }) {
  const [search, setSearch] = useState('');
  const preferences = useTablePreferences([{ key: 'name' }, { key: 'domain' }, { key: 'contacts' }, { key: 'deals' }, { key: 'value' }]);
  const columns = useMemo(() => [
    { key: 'name', label: 'Account', required: true, render: account => <span className="inline-flex items-center gap-2 font-semibold text-gray-950"><Building2 className="h-4 w-4 text-indigo-500" aria-hidden="true" />{account.name}</span> },
    { key: 'domain', label: 'Domain', render: account => account.domain || '—' },
    { key: 'contacts', label: 'Contacts', render: account => account.contact_count ?? 0 },
    { key: 'deals', label: 'Deals', render: account => account.deal_count ?? 0 },
    { key: 'value', label: 'Open value', render: account => formatMoney(account.open_pipeline_amount, 'USD') },
    { key: 'actions', label: 'Actions', required: true, render: account => <button type="button" onClick={event => { event.stopPropagation(); onEdit(account); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Edit ${account.name}`}><Edit2 className="h-4 w-4" aria-hidden="true" /></button> },
  ], [onEdit]);
  const rows = accounts.filter(account => [account.name, account.domain, account.website, account.industry].some(value => String(value || '').toLowerCase().includes(search.toLowerCase().trim())));
  return <div className="space-y-6"><PageHeading title="Accounts" description="Organize companies and see the opportunities connected to them." actions={<PrimaryButton onClick={() => onCreate()}>Add account</PrimaryButton>} /><SearchToolbar search={search} onSearch={setSearch} placeholder="Search accounts" density={preferences.density} onDensityChange={preferences.setDensity} columns={columns} visibleColumns={preferences.visibleColumns} onToggleColumn={preferences.toggleColumn} /><DataTable columns={columns} rows={rows} visibleColumns={preferences.visibleColumns} density={preferences.density} onRowClick={onEdit} empty={<ResourceEmptyState title={search ? 'No matching accounts' : 'No accounts yet'} description={search ? 'Try a different search.' : 'Accounts are created during lead migration or from this workspace.'} actionLabel={search ? undefined : 'Add account'} onAction={() => onCreate()} />} /></div>;
}

function DealList({ deals, pipelines, activities, onCreate, onOpenDeal, onUpdateDeal }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const { stages } = pipelineStages(pipelines);
  const preferences = useTablePreferences([{ key: 'name' }, { key: 'account' }, { key: 'stage' }, { key: 'amount' }, { key: 'close' }, { key: 'next' }]);
  const columns = useMemo(() => [
    { key: 'name', label: 'Deal', required: true, render: deal => <span><span className="font-semibold text-gray-950">{deal.name}</span>{deal.primary_contact?.name && <span className="ml-2 text-xs text-gray-500">{deal.primary_contact.name}</span>}</span> },
    { key: 'account', label: 'Account', render: deal => deal.account?.name || 'No account' },
    { key: 'stage', label: 'Stage', render: deal => <StageBadge stage={stageForDeal(deal, stages)} /> },
    { key: 'amount', label: 'Amount', render: deal => <span className="font-semibold text-gray-950">{formatMoney(deal.amount, deal.currency)}</span> },
    { key: 'close', label: 'Close date', render: deal => formatDate(deal.expected_close_date) },
    { key: 'next', label: 'Next activity', render: deal => { const next = nextActivityForDeal(deal, activities); return next ? <span title={next.subject}>{next.due_at ? formatDate(next.due_at) : next.subject}</span> : deal.next_activity_date ? formatDate(deal.next_activity_date) : <span className="font-semibold text-amber-700">Not set</span>; } },
    { key: 'attention', label: 'Attention', render: deal => <div className="flex max-w-48 flex-wrap gap-1">{attentionForDeal(deal, activities).slice(0, 2).map(item => <AttentionBadge key={item.key} item={item} />)}</div> },
  ], [activities, stages]);
  const rows = deals.filter(deal => { const term = search.toLowerCase().trim(); return (!term || [deal.name, deal.account?.name, deal.primary_contact?.name, deal.lead_source].some(value => String(value || '').toLowerCase().includes(term))) && (status === 'all' || deal.status === status); });
  return <div className="space-y-6"><PageHeading title="Deals" description="Manage real opportunities from qualification through close." actions={<PrimaryButton onClick={() => onCreate()}>Add deal</PrimaryButton>} /><SearchToolbar search={search} onSearch={setSearch} placeholder="Search deals, accounts or contacts" filter={{ value: status, onChange: setStatus, options: [{ value: 'all', label: 'All statuses' }, { value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] }} density={preferences.density} onDensityChange={preferences.setDensity} columns={columns} visibleColumns={preferences.visibleColumns} onToggleColumn={preferences.toggleColumn} /><DataTable columns={columns} rows={rows} visibleColumns={preferences.visibleColumns} density={preferences.density} onRowClick={onOpenDeal} empty={<ResourceEmptyState title={search || status !== 'all' ? 'No matching deals' : 'No deals yet'} description={search || status !== 'all' ? 'Try a different search or status.' : 'Create a deal from a qualified lead or add one directly.'} actionLabel={search || status !== 'all' ? undefined : 'Add deal'} onAction={() => onCreate()} />} /></div>;
}

function DealCard({ deal, stages, activities = [], onOpen, onMove }) {
  const stage = stageForDeal(deal, stages);
  const attention = attentionForDeal(deal, activities);
  return <article draggable onDragStart={event => event.dataTransfer.setData('text/plain', deal.id)} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"><button type="button" onClick={() => onOpen(deal)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><h3 className="line-clamp-2 font-semibold leading-5 text-gray-950">{deal.name}</h3><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /></div><p className="mt-3 text-lg font-bold text-gray-950">{formatMoney(deal.amount, deal.currency)}</p><p className="mt-1 truncate text-sm text-gray-600">{deal.account?.name || 'No account'}{deal.primary_contact?.name ? ` · ${deal.primary_contact.name}` : ''}</p><div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-500"><span>{deal.probability ?? stage.probability}% likely</span><span>{deal.expected_close_date ? formatDate(deal.expected_close_date) : 'No close date'}</span></div>{attention.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{attention.slice(0, 2).map(item => <AttentionBadge key={item.key} item={item} />)}</div>}</button><label className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs font-semibold text-gray-600"><span className="sr-only">Move {deal.name} to stage</span><MoveRight className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" /><select value={stage.id || stage.key} onClick={event => event.stopPropagation()} onChange={event => { event.stopPropagation(); const next = stages.find(item => item.id === event.target.value || item.key === event.target.value); if (next) onMove(deal, next); }} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700">{stages.map(item => <option key={item.id || item.key} value={item.id || item.key}>{item.name}</option>)}</select></label></article>;
}

function SalesPipeline({ deals, pipelines, activities, onOpenDeal, onUpdateDeal, onAddDeal }) {
  const { pipeline, stages } = pipelineStages(pipelines);
  const [mobileStage, setMobileStage] = useState(stages[0]?.id || stages[0]?.key);
  const [draggedDeal, setDraggedDeal] = useState(null);
  const openDeals = deals.filter(deal => deal.status === 'open');
  const moveDeal = async (deal, stage) => { if ((deal.stage_id || deal.stage_key) === (stage.id || stage.key)) return; await onUpdateDeal(deal.id, { stage_id: stage.id }); };
  const stageCards = stage => openDeals.filter(deal => { const dealStage = stageForDeal(deal, stages); return dealStage.id === stage.id || dealStage.key === stage.key; });
  const activeMobileStage = stages.find(stage => stage.id === mobileStage || stage.key === mobileStage) || stages[0];
  return <div className="space-y-6"><PageHeading title="Pipeline" description="Make the next sales decision from amount, risk, owner and timing." actions={<PrimaryButton onClick={onAddDeal}>Add deal</PrimaryButton>} /><div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Open opportunities" value={openDeals.length} detail={formatMoney(openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0), openDeals[0]?.currency || 'USD')} icon={Target} /><MetricCard label="Weighted value" value={formatMoney(openDeals.reduce((sum, deal) => sum + Number(deal.amount || 0) * Number(deal.probability || 0) / 100, 0), openDeals[0]?.currency || 'USD')} detail="Probability weighted" icon={TrendingUp} tone="amber" /><MetricCard label="Needs attention" value={openDeals.filter(deal => attentionForDeal(deal, activities).length).length} detail="Risk signals in open pipeline" icon={AlertTriangle} tone="red" /></div>{pipeline && <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-indigo-900"><span className="font-semibold">{pipeline.name}</span><span className="ml-2 text-indigo-700">· {stages.length} configurable stages</span></div>}<div className="md:hidden"><label className="block text-sm font-semibold text-gray-700" htmlFor="mobile-pipeline-stage">Pipeline stage</label><select id="mobile-pipeline-stage" value={mobileStage} onChange={event => setMobileStage(event.target.value)} className="crm-field mt-2 min-h-12 w-full">{stages.map(stage => <option key={stage.id || stage.key} value={stage.id || stage.key}>{stage.name} · {stageCards(stage).length} deals</option>)}</select><div className="mt-4 space-y-3"><div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-3" onDragOver={event => event.preventDefault()} onDrop={async event => { event.preventDefault(); const dealId = event.dataTransfer.getData('text/plain'); const deal = deals.find(item => item.id === dealId); if (deal) await moveDeal(deal, activeMobileStage); }}>{stageCards(activeMobileStage).length ? stageCards(activeMobileStage).map(deal => <DealCard key={deal.id} deal={deal} activities={activities} stages={stages} onOpen={onOpenDeal} onMove={moveDeal} />) : <p className="py-12 text-center text-sm text-gray-500">No open deals in this stage.</p>}</div></div></div><div className="hidden gap-4 overflow-x-auto pb-2 md:grid md:auto-cols-[minmax(16rem,1fr)] md:grid-flow-col">{stages.map(stage => { const stageDeals = stageCards(stage); return <section key={stage.id || stage.key} className="min-w-0" onDragOver={event => event.preventDefault()} onDrop={async event => { event.preventDefault(); const dealId = event.dataTransfer.getData('text/plain'); const deal = deals.find(item => item.id === dealId); if (deal) await moveDeal(deal, stage); setDraggedDeal(null); }}><header className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} /><h2 className="truncate text-sm font-bold text-gray-950">{stage.name}</h2></div><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{stageDeals.length}</span></div><div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500"><span>{stage.probability ?? 0}% probability</span><span>{formatMoney(stageDeals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0), stageDeals[0]?.currency || 'USD')}</span></div></header><div className={`mt-3 min-h-[26rem] space-y-3 rounded-2xl border-2 border-dashed p-3 transition ${draggedDeal ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 bg-gray-50/70'}`}>{stageDeals.length ? stageDeals.map(deal => <DealCard key={deal.id} deal={deal} activities={activities} stages={stages} onOpen={onOpenDeal} onMove={moveDeal} />) : <p className="py-12 text-center text-xs text-gray-500">Drop deals here</p>}</div></section>; })}</div></div>;
}

function DealFormDialog({ deal, lead, pipelines, accounts, contacts, onClose, onSave }) {
  const { pipeline, stages } = pipelineStages(pipelines);
  const initialStage = deal ? stageForDeal(deal, stages) : stages[0];
  const [form, setForm] = useState(() => ({ name: deal?.name || (lead ? `${lead.name} opportunity` : ''), amount: deal?.amount ?? '', currency: deal?.currency || 'USD', pipeline_id: deal?.pipeline_id || pipeline?.id || '', stage_id: deal?.stage_id || initialStage?.id || '', account_id: deal?.account_id || '', primary_contact_id: deal?.primary_contact_id || '', expected_close_date: deal?.expected_close_date || '', next_activity_date: deal?.next_activity_date || '', lead_source: deal?.lead_source || lead?.source || '', probability: deal?.probability ?? initialStage?.probability ?? 0 }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setForm(current => ({ ...current, pipeline_id: deal?.pipeline_id || pipeline?.id || current.pipeline_id, stage_id: deal?.stage_id || initialStage?.id || current.stage_id })); }, [deal, initialStage?.id, pipeline?.id]);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => { event.preventDefault(); setSaving(true); setError(''); try { await onSave({ ...form, amount: form.amount === '' ? 0 : Number(form.amount), probability: form.probability === '' ? undefined : Number(form.probability), account_id: form.account_id || null, primary_contact_id: form.primary_contact_id || null, expected_close_date: form.expected_close_date || null, next_activity_date: form.next_activity_date || null, lead_source: form.lead_source || null }); } catch (saveError) { setError(saveError.message || 'The deal could not be saved.'); } finally { setSaving(false); } };
  const availableContacts = form.account_id ? contacts.filter(contact => contact.account_id === form.account_id) : contacts;
  const selectedPipeline = pipelines.find(item => item.id === form.pipeline_id) || pipeline;
  const formStages = [...(selectedPipeline?.stages || stages)].sort((a, b) => (a.position || 0) - (b.position || 0));
  return <Dialog title={deal ? 'Edit deal' : 'Create deal'} description="Keep the opportunity amount, timing and next action explicit." onClose={onClose} wide><form onSubmit={submit} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Deal name" required><input required value={form.name} onChange={event => update('name', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Amount"><input type="number" min="0" step="0.01" value={form.amount} onChange={event => update('amount', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Account"><select value={form.account_id} onChange={event => { update('account_id', event.target.value); if (form.primary_contact_id && !contacts.find(contact => contact.id === form.primary_contact_id && (!event.target.value || contact.account_id === event.target.value))) update('primary_contact_id', ''); }} className="crm-field mt-1 w-full"><option value="">No account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field><Field label="Primary contact"><select value={form.primary_contact_id} onChange={event => update('primary_contact_id', event.target.value)} className="crm-field mt-1 w-full"><option value="">No primary contact</option>{availableContacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ''}</option>)}</select></Field><Field label="Pipeline"><select value={form.pipeline_id} onChange={event => { const nextPipeline = pipelines.find(item => item.id === event.target.value); const nextStages = [...(nextPipeline?.stages || stages)].sort((a, b) => (a.position || 0) - (b.position || 0)); update('pipeline_id', event.target.value); update('stage_id', nextStages[0]?.id || ''); update('probability', nextStages[0]?.probability || 0); }} className="crm-field mt-1 w-full">{pipelines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Stage"><select value={form.stage_id} onChange={event => { update('stage_id', event.target.value); const selectedStage = formStages.find(item => item.id === event.target.value); if (selectedStage) update('probability', selectedStage.probability); }} className="crm-field mt-1 w-full">{formStages.map(stage => <option key={stage.id || stage.key} value={stage.id}>{stage.name}</option>)}</select></Field><Field label="Expected close date"><input type="date" value={form.expected_close_date} onChange={event => update('expected_close_date', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Next activity date"><input type="date" value={form.next_activity_date} onChange={event => update('next_activity_date', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Lead source"><input value={form.lead_source} onChange={event => update('lead_source', event.target.value)} placeholder="Referral, website…" className="crm-field mt-1 w-full" /></Field><Field label="Probability"><input type="number" min="0" max="100" step="1" value={form.probability} onChange={event => update('probability', event.target.value)} className="crm-field mt-1 w-full" /></Field></div>{error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}<div className="flex justify-end gap-3 border-t border-gray-100 pt-5"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton icon={Check} disabled={saving}>{saving ? 'Saving…' : 'Save deal'}</PrimaryButton></div></form></Dialog>;
}

function EntityFormDialog({ kind, record, accounts, onClose, onSave }) {
  const [form, setForm] = useState(() => kind === 'account' ? { name: record?.name || '', domain: record?.domain || '', phone: record?.phone || '', website: record?.website || '', industry: record?.industry || '' } : { name: record?.name || '', title: record?.title || '', email: record?.email || '', phone: record?.phone || '', account_id: record?.account_id || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => { event.preventDefault(); setSaving(true); setError(''); try { await onSave({ ...form, account_id: form.account_id || null }); } catch (saveError) { setError(saveError.message || 'The record could not be saved.'); } finally { setSaving(false); } };
  const accountForm = kind === 'account';
  return <Dialog title={`${record ? 'Edit' : 'Add'} ${accountForm ? 'account' : 'contact'}`} description={accountForm ? 'Use a clear company name so related people and deals stay grouped.' : 'Keep the person and account relationship ready for the next conversation.'} onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label={accountForm ? 'Account name' : 'Contact name'} required><input required value={form.name} onChange={event => update('name', event.target.value)} className="crm-field mt-1 w-full" /></Field>{accountForm ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Domain"><input value={form.domain} onChange={event => update('domain', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Industry"><input value={form.industry} onChange={event => update('industry', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Phone"><input value={form.phone} onChange={event => update('phone', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Website"><input type="url" value={form.website} onChange={event => update('website', event.target.value)} className="crm-field mt-1 w-full" /></Field></div> : <div className="grid gap-4 sm:grid-cols-2"><Field label="Title"><input value={form.title} onChange={event => update('title', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Account"><select value={form.account_id} onChange={event => update('account_id', event.target.value)} className="crm-field mt-1 w-full"><option value="">No account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field><Field label="Email"><input type="email" value={form.email} onChange={event => update('email', event.target.value)} className="crm-field mt-1 w-full" /></Field><Field label="Phone"><input value={form.phone} onChange={event => update('phone', event.target.value)} className="crm-field mt-1 w-full" /></Field></div>}{error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}<div className="flex justify-end gap-3 border-t border-gray-100 pt-5"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton icon={Check} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div></form></Dialog>;
}

function Field({ label, required = false, children }) { return <label className="block text-sm font-semibold text-gray-700">{label}{required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}{children}</label>; }

function DealDetailDrawer({ initialDeal, stages, activities, meetings, onClose, onEdit, onUpdateDeal, onNotify }) {
  const drawerRef = useRef(null);
  const closeRef = useRef(onClose);
  const [deal, setDeal] = useState(initialDeal);
  const [lostReason, setLostReason] = useState(initialDeal.lost_reason || '');
  const [showLostReason, setShowLostReason] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousActive = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => drawerRef.current?.querySelector('button, select, textarea')?.focus(), 0);
    const handleKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); document.body.style.overflow = previousOverflow; if (previousActive?.isConnected) previousActive.focus(); };
  }, []);
  useEffect(() => { setDeal(initialDeal); setLostReason(initialDeal.lost_reason || ''); }, [initialDeal]);
  const stage = stageForDeal(deal, stages);
  const relatedActivities = activities.filter(activity => activity.deal_id === deal.id || activity.lead_id === deal.source_lead_id || activity.account_id === deal.account_id || activity.contact_id === deal.primary_contact_id);
  const relatedMeetings = meetings.filter(meeting => meeting.lead_id && meeting.lead_id === deal.source_lead_id);
  const nextActivity = nextActivityForDeal(deal, activities);
  const timeline = [...(deal.stage_history || []).map(item => ({ id: `stage-${item.id}`, type: 'stage', date: item.changed_at, title: item.from_stage_name ? `Moved from ${item.from_stage_name} to ${item.to_stage_name}` : `Entered ${item.to_stage_name}`, detail: `Changed by ${item.changed_by}` })), ...relatedActivities.map(item => ({ id: `activity-${item.id}`, type: 'activity', date: item.created_at || item.timestamp, title: item.subject || item.message, detail: item.type || 'Activity' })), ...relatedMeetings.map(item => ({ id: `meeting-${item.id}`, type: 'meeting', date: item.date_time, title: item.title, detail: 'Meeting' }))].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const update = async body => { setSaving(true); try { const updated = await onUpdateDeal(deal.id, body); if (updated) setDeal(updated); } finally { setSaving(false); } };
  const markWon = async () => { const wonStage = stages.find(item => item.is_closed_won); if (!wonStage) return; await update({ stage_id: wonStage.id, status: 'won' }); onNotify?.('Deal marked as won.'); };
  const markLost = async () => { const lostStage = stages.find(item => item.is_closed_lost); if (!lostStage || !lostReason.trim()) return; await update({ stage_id: lostStage.id, status: 'lost', lost_reason: lostReason.trim() }); setShowLostReason(false); onNotify?.('Deal marked as lost.'); };
  return <div className="fixed inset-0 z-[80] bg-gray-950/40" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside ref={drawerRef} className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="deal-detail-title"><div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5 sm:p-7"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Deal detail</p><h2 id="deal-detail-title" className="mt-2 truncate text-2xl font-bold text-gray-950">{deal.name}</h2><div className="mt-3 flex flex-wrap items-center gap-2"><StageBadge stage={stage} />{deal.status !== 'open' && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${deal.status === 'won' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{deal.status === 'won' ? 'Won' : 'Lost'}</span>}</div></div><button type="button" onClick={onClose} aria-label="Close deal detail" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" aria-hidden="true" /></button></div><div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-7"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</p><p className="mt-2 text-xl font-bold text-gray-950">{formatMoney(deal.amount, deal.currency)}</p></div><div className="rounded-xl bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Probability</p><p className="mt-2 text-xl font-bold text-gray-950">{deal.probability ?? stage.probability}%</p></div><div className="rounded-xl bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Close date</p><p className="mt-2 text-sm font-bold text-gray-950">{formatDate(deal.expected_close_date)}</p></div></div>{attentionForDeal(deal, activities).length > 0 && <div className="flex flex-wrap gap-2">{attentionForDeal(deal, activities).map(item => <AttentionBadge key={item.key} item={item} />)}</div>}<div className="grid gap-4 border-y border-gray-100 py-5 sm:grid-cols-2"><Detail icon={Building2} label="Account" value={deal.account?.name || 'No account'} /><Detail icon={User} label="Primary contact" value={deal.primary_contact?.name || 'No primary contact'} /><Detail icon={Calendar} label="Next activity" value={nextActivity ? `${nextActivity.subject}${nextActivity.due_at ? ` · ${formatDate(nextActivity.due_at)}` : ''}` : deal.next_activity_date ? formatDate(deal.next_activity_date) : 'Not scheduled'} /><Detail icon={Target} label="Lead source" value={deal.lead_source || 'Not recorded'} />{deal.status === 'lost' && <Detail icon={AlertCircle} label="Lost reason" value={deal.lost_reason || 'Not recorded'} />}</div><section><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-gray-950">Deal timeline</h3><p className="mt-1 text-sm text-gray-500">Stage movement and related activity history.</p></div></div>{timeline.length ? <div className="mt-5 space-y-4 border-l-2 border-indigo-100 pl-5">{timeline.map(item => <div key={item.id} className="relative"><span className="absolute -left-[1.85rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500 shadow-sm" /><p className="text-sm font-semibold text-gray-800">{item.title}</p><p className="mt-1 text-xs text-gray-500">{item.detail} · {formatDateTime(item.date)}</p></div>)}</div> : <p className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">No timeline events have been recorded for this deal yet.</p>}</section></div><div className="border-t border-gray-200 bg-white p-5 sm:p-7"><div className="flex flex-wrap gap-3"><SecondaryButton icon={Edit2} onClick={onEdit}>Edit deal</SecondaryButton>{deal.status === 'open' && <><button type="button" disabled={saving} onClick={markWon} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Mark won</button><button type="button" disabled={saving} onClick={() => setShowLostReason(value => !value)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><AlertCircle className="h-4 w-4" aria-hidden="true" />Mark lost</button></>}</div>{showLostReason && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4"><Field label="Why was this deal lost?" required><textarea required rows="3" value={lostReason} onChange={event => setLostReason(event.target.value)} className="crm-field mt-1 w-full bg-white" placeholder="Capture the reason for future learning." /></Field><div className="mt-3 flex justify-end"><button type="button" onClick={markLost} disabled={!lostReason.trim() || saving} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save lost reason</button></div></div>}</div></aside></div>;
}

function Detail({ icon: Icon, label, value }) { return <div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /><div><p className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-sm font-semibold text-gray-800">{value}</p></div></div>; }

export default function SalesWorkspace({ page, loading = false, error, summary, leads, accounts, contacts, deals, pipelines, activities, meetings, onNavigate, onAddLead, onEditLead, onViewLead, onConvertLead, onCreateDeal, onUpdateDeal, onCreateAccount, onUpdateAccount, onCreateContact, onUpdateContact, onNotify }) {
  const [dealDialog, setDealDialog] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [contactDialog, setContactDialog] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const openDealDialog = (deal = null) => setDealDialog({ deal });
  const saveDeal = async input => { const result = dealDialog?.deal ? await onUpdateDeal(dealDialog.deal.id, input) : await onCreateDeal(input); setDealDialog(null); if (result) setSelectedDeal(result); };
  const openAccountDialog = (account = null) => setAccountDialog({ account });
  const saveAccount = async input => { if (accountDialog?.account) await onUpdateAccount(accountDialog.account.id, input); else await onCreateAccount(input); setAccountDialog(null); };
  const openContactDialog = (contact = null) => setContactDialog({ contact });
  const saveContact = async input => { if (contactDialog?.contact) await onUpdateContact(contactDialog.contact.id, input); else await onCreateContact(input); setContactDialog(null); };
  if (loading) return <LoadingState label="Loading sales workspace…" />;
  if (error) return <ErrorState message={error} />;
  const shared = { leads, accounts, contacts, deals, pipelines, activities, meetings, onNavigate, onNotify };
  return <>
    {page === 'dashboard' && <SalesDashboard {...shared} summary={summary} onOpenDeal={setSelectedDeal} onAddLead={onAddLead} />}
    {page === 'leads' && <LeadList leads={leads} onAddLead={onAddLead} onEditLead={onEditLead} onViewLead={onViewLead} onConvertLead={onConvertLead} />}
    {page === 'contacts' && <ContactList contacts={contacts} accounts={accounts} onCreate={openContactDialog} onEdit={openContactDialog} />}
    {page === 'accounts' && <AccountList accounts={accounts} onCreate={openAccountDialog} onEdit={openAccountDialog} />}
    {page === 'deals' && <DealList deals={deals} pipelines={pipelines} activities={activities} onCreate={openDealDialog} onOpenDeal={setSelectedDeal} onUpdateDeal={onUpdateDeal} />}
    {page === 'pipeline' && <SalesPipeline deals={deals} pipelines={pipelines} activities={activities} onOpenDeal={setSelectedDeal} onUpdateDeal={onUpdateDeal} onAddDeal={() => openDealDialog()} />}
    {dealDialog && <DealFormDialog deal={dealDialog.deal} pipelines={pipelines} accounts={accounts} contacts={contacts} onClose={() => setDealDialog(null)} onSave={saveDeal} />}
    {accountDialog && <EntityFormDialog kind="account" record={accountDialog.account} accounts={accounts} onClose={() => setAccountDialog(null)} onSave={saveAccount} />}
    {contactDialog && <EntityFormDialog kind="contact" record={contactDialog.contact} accounts={accounts} onClose={() => setContactDialog(null)} onSave={saveContact} />}
    {selectedDeal && <DealDetailDrawer initialDeal={selectedDeal} stages={pipelineStages(pipelines).stages} activities={activities} meetings={meetings} onClose={() => setSelectedDeal(null)} onEdit={() => { setDealDialog({ deal: selectedDeal }); setSelectedDeal(null); }} onUpdateDeal={async (dealId, input) => { const result = await onUpdateDeal(dealId, input); if (result) setSelectedDeal(result); return result; }} onNotify={onNotify} />}
  </>;
}
