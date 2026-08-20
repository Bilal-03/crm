import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw, Target, Timer, TrendingUp, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorState, LoadingState } from '../../components/ui/ResourceState.jsx';
import GoalsPanel from './GoalsPanel.jsx';

const RANGE_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom dates' },
];

export default function ReportingWorkspace({ request, pipelines = [], members = [], onNotify }) {
  const [filters, setFilters] = useState({
    rangeDays: '30',
    startDate: localDate(-29),
    endDate: localDate(0),
    currency: '',
    owner: '',
    pipeline_id: '',
    source: '',
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const queryString = useMemo(() => buildQuery(filters), [filters]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await request(`/reports?${queryString}`));
    } catch (loadError) {
      setError(loadError.message || 'Management reports could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [queryString, request]);

  useEffect(() => { void load(); }, [load]);

  const selectedCurrency = filters.currency || report?.filters?.currency || 'USD';
  const money = value => {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: selectedCurrency, maximumFractionDigits: 0 }).format(Number(value || 0)); }
    catch { return `${selectedCurrency} ${Number(value || 0).toFixed(0)}`; }
  };
  const metrics = report?.metrics || {};
  const definitions = report?.definitions || {};
  const sources = [...new Set((report?.sourcePerformance || []).map(row => row.source))];

  const setFilter = (field, value) => setFilters(previous => ({ ...previous, [field]: value }));
  const exportReport = async () => {
    setExporting(true);
    try {
      const result = await request(`/reports/export?${queryString}`);
      downloadCsv(result.columns, result.rows, `crm-report-${selectedCurrency}-${new Date().toISOString().slice(0, 10)}.csv`);
      onNotify?.(`${result.rows.length} filtered reporting records exported.${result.truncated ? ' Export reached the 10,000-row limit.' : ''}`);
    } catch (exportError) {
      onNotify?.(exportError.message || 'The report export could not be generated.', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading && !report) return <LoadingState label="Building management-grade reports…" />;
  if (error && !report) return <ErrorState title="Reports unavailable" message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Reporting and forecasting</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Management reports</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">Pipeline is a current snapshot. Outcomes use effective deal-close dates, and collected revenue uses settled payment dates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="crm-btn crm-btn-secondary"><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button type="button" disabled={exporting} onClick={exportReport} className="crm-btn crm-btn-primary"><Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5" aria-label="Report filters">
        <Filter label="Period"><select value={filters.rangeDays} onChange={event => setFilter('rangeDays', event.target.value)}>{RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Filter>
        {filters.rangeDays === 'custom' && <Filter label="Start date"><input required type="date" max={filters.endDate} value={filters.startDate} onChange={event => event.target.value && setFilter('startDate', event.target.value)} /></Filter>}
        {filters.rangeDays === 'custom' && <Filter label="End date"><input required type="date" min={filters.startDate} value={filters.endDate} onChange={event => event.target.value && setFilter('endDate', event.target.value)} /></Filter>}
        <Filter label="Currency"><select value={selectedCurrency} onChange={event => setFilter('currency', event.target.value)}>{(report?.availableCurrencies?.length ? report.availableCurrencies : [selectedCurrency]).map(code => <option key={code} value={code}>{code}</option>)}</select></Filter>
        <Filter label="Owner"><select value={filters.owner} onChange={event => setFilter('owner', event.target.value)}><option value="">All owners</option><option value="me">My records</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.email || member.user_id}</option>)}</select></Filter>
        <Filter label="Pipeline"><select value={filters.pipeline_id} onChange={event => setFilter('pipeline_id', event.target.value)}><option value="">All pipelines</option>{pipelines.map(pipeline => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select></Filter>
        <Filter label="Source"><select value={filters.source} onChange={event => setFilter('source', event.target.value)}><option value="">All sources</option>{sources.map(source => <option key={source} value={source}>{source}</option>)}</select></Filter>
      </section>

      {loading && <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">Refreshing server-side report filters…</p>}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Forecast summary">
        <ReportMetric icon={Target} label="Open pipeline" value={money(metrics.openPipeline)} definition={definitions.openPipeline} />
        <ReportMetric icon={TrendingUp} label="Weighted pipeline" value={money(metrics.weightedPipeline)} definition={definitions.weightedPipeline} />
        <ReportMetric icon={BarChart3} label="Best case" value={money(metrics.bestCase)} definition={definitions.bestCase} />
        <ReportMetric icon={WalletCards} label="Commit" value={money(metrics.commit)} definition={definitions.commit} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Period performance">
        <ReportMetric label="Won" value={money(metrics.wonAmount)} detail={`${metrics.dealsWon || 0} deals`} definition={definitions.wonAmount} />
        <ReportMetric label="Win rate" value={`${Number(metrics.winRate || 0).toFixed(1)}%`} detail={`${metrics.dealsWon || 0} won · ${metrics.dealsLost || 0} lost`} definition={definitions.winRate} />
        <ReportMetric label="Average deal size" value={money(metrics.averageDealSize)} definition={definitions.averageDealSize} />
        <ReportMetric icon={Timer} label="Average cycle" value={`${Number(metrics.averageCycleDays || 0).toFixed(1)} days`} definition={definitions.averageCycleDays} />
        <ReportMetric label="Sales velocity" value={`${money(metrics.salesVelocity)} / day`} definition={definitions.salesVelocity} />
        <ReportMetric label="Revenue collected" value={money(metrics.revenueCollected)} definition={definitions.revenueCollected} />
        <ReportMetric label="Outstanding" value={money(metrics.outstanding)} detail="Current invoice balance" />
        <ReportMetric label="Activities completed" value={metrics.activitiesCompleted || 0} detail={`${metrics.activitiesOverdue || 0} currently overdue`} />
      </section>

      <GoalsPanel request={request} members={members} defaultCurrency={selectedCurrency} onNotify={onNotify} />

      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Collected revenue" description={`Settled ${selectedCurrency} payments by payment date.`}>
          {(report?.revenueTrend || []).length ? <ResponsiveContainer width="100%" height={280}><LineChart data={report.revenueTrend}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={value => money(value)} /><Line type="monotone" dataKey="revenue" stroke="var(--crm-primary)" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer> : <EmptyChart text="No settled payments in this period." />}
        </ChartCard>
        <ChartCard title="Source-to-revenue" description="Won deal amount by lead source for the selected period.">
          {(report?.sourcePerformance || []).length ? <ResponsiveContainer width="100%" height={280}><BarChart data={report.sourcePerformance}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" /><XAxis dataKey="source" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={value => money(value)} /><Bar dataKey="wonAmount" name="Won amount" fill="var(--crm-accent-strong)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer> : <EmptyChart text="No source performance data for these filters." />}
        </ChartCard>
      </section>

      <DataTable title="Stage conversion and aging" description={definitions.stageConversion} columns={['Stage', 'Current', 'Amount', 'Avg. age', 'Entered', 'Converted', 'Conversion']} rows={(report?.stagePerformance || []).map(stage => [stage.name, stage.currentCount, money(stage.currentAmount), `${stage.averageAgeDays.toFixed(1)} days`, stage.enteredCount, stage.convertedCount, `${stage.conversionRate.toFixed(1)}%`])} />
      <DataTable title="Owner performance" description="Deal outcomes use effective close date; activity totals use activity event dates." columns={['Owner', 'Open deals', 'Open pipeline', 'Won', 'Lost', 'Won amount', 'Activities completed']} rows={(report?.ownerPerformance || []).map(owner => [owner.ownerEmail || owner.ownerUserId, owner.openDeals, money(owner.openPipeline), owner.wonDeals, owner.lostDeals, money(owner.wonAmount), owner.activitiesCompleted])} />
      <DataTable title="Currency breakdown" description="Each row remains independent; currencies are never summed together." columns={['Currency', 'Open deals', 'Open pipeline', 'Weighted', 'Won', 'Lost']} rows={(report?.currencyBreakdown || []).map(row => [row.currency, row.openDeals, formatMoney(row.openPipeline, row.currency), formatMoney(row.weightedPipeline, row.currency), formatMoney(row.wonAmount, row.currency), formatMoney(row.lostAmount, row.currency)])} />

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-gray-950">Metric definitions and date semantics</h2>
        <dl className="mt-4 grid gap-4 md:grid-cols-2">{Object.entries(definitions).map(([key, definition]) => <div key={key} className="rounded-xl bg-gray-50 p-4"><dt className="text-sm font-bold text-gray-900">{humanize(key)}</dt><dd className="mt-1 text-sm leading-6 text-gray-600">{definition}</dd></div>)}</dl>
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">{Object.values(report?.dateSemantics || {}).map(text => <p key={text}>{text}</p>)}</div>
      </section>
    </div>
  );
}

function buildQuery(filters) {
  const query = filters.rangeDays === 'custom'
    ? new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate })
    : new URLSearchParams({ rangeDays: filters.rangeDays });
  for (const field of ['currency', 'owner', 'pipeline_id', 'source']) if (filters[field]) query.set(field, filters[field]);
  return query.toString();
}

function downloadCsv(columns, rows, filename) {
  const escape = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatMoney(value, currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toFixed(0)}`; }
}

function Filter({ label, children }) { return <label className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}{React.cloneElement(children, { className: 'mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-gray-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200' })}</label>; }
function ReportMetric({ icon: Icon = TrendingUp, label, value, detail, definition }) { return <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" title={definition}><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold text-gray-950">{value}</p>{detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}</div><span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600"><Icon className="h-5 w-5" /></span></div>{definition && <p className="mt-3 line-clamp-2 text-xs leading-5 text-gray-500">{definition}</p>}</article>; }
function ChartCard({ title, description, children }) { return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-gray-950">{title}</h2><p className="mt-1 text-sm text-gray-500">{description}</p><div className="mt-5">{children}</div></section>; }
function EmptyChart({ text }) { return <p className="flex h-[280px] items-center justify-center text-sm text-gray-500">{text}</p>; }
function DataTable({ title, description, columns, rows }) { return <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-950">{title}</h2><p className="mt-1 text-sm text-gray-500">{description}</p></div><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead className="bg-gray-50"><tr>{columns.map(column => <th key={column} className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-500">{column}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.length ? rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((value, columnIndex) => <td key={`${columnIndex}-${value}`} className="whitespace-nowrap px-5 py-4 text-gray-700">{value}</td>)}</tr>) : <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-gray-500">No records match these filters.</td></tr>}</tbody></table></div></section>; }
function humanize(value) { return value.replace(/([A-Z])/g, ' $1').replace(/^./, character => character.toUpperCase()); }
function localDate(offsetDays) { const value = new Date(); value.setDate(value.getDate() + offsetDays); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
