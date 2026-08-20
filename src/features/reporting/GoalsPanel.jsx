import React, { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, Edit2, Gauge, Plus, Target, TrendingUp } from 'lucide-react';

const METRICS = [
  { value: 'won_revenue', label: 'Won revenue' },
  { value: 'collected_revenue', label: 'Collected revenue' },
  { value: 'deals_won', label: 'Deals won' },
];

export default function GoalsPanel({ request, members = [], defaultCurrency = 'USD', onNotify }) {
  const [goals, setGoals] = useState([]);
  const [definitions, setDefinitions] = useState({});
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => emptyGoal(defaultCurrency));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await request('/goals?pageSize=100&state=active', { includeMeta: true });
      setGoals(response?.data || []);
      setDefinitions(response?.definitions || {});
      setCanManage(Boolean(response?.permissions?.canManage));
    } catch (loadError) {
      setError(loadError.message || 'Goals and quotas could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => setForm(previous => editingId ? previous : { ...previous, currency: defaultCurrency }), [defaultCurrency, editingId]);

  const update = (field, value) => setForm(previous => ({
    ...previous,
    [field]: value,
    ...(field === 'scope' && value === 'team' ? { owner_user_id: '' } : {}),
  }));
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      await request(`/goals${editingId ? `?id=${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: {
          ...form,
          owner_user_id: form.scope === 'owner' ? form.owner_user_id : null,
          target_value: Number(form.target_value),
        },
      });
      onNotify?.(editingId ? 'Goal updated.' : 'Goal created.');
      setEditingId(null);
      setForm(emptyGoal(defaultCurrency));
      await load();
    } catch (saveError) {
      onNotify?.(saveError.message || 'The goal could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };
  const edit = goal => {
    setEditingId(goal.id);
    setForm({
      name: goal.name, scope: goal.scope, owner_user_id: goal.owner_user_id || '',
      metric: goal.metric, currency: goal.currency, target_value: String(goal.target_value),
      period_start: dateOnly(goal.period_start), period_end: dateOnly(goal.period_end),
    });
  };
  const archive = async goal => {
    try {
      await request(`/goals?id=${goal.id}`, { method: 'DELETE' });
      onNotify?.('Goal archived.');
      await load();
    } catch (archiveError) {
      onNotify?.(archiveError.message || 'The goal could not be archived.', 'error');
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-5 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2"><Target className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-gray-950">Goals, quotas and pacing</h2></div><p className="mt-1 text-sm text-gray-500">Actual performance follows event dates; forecasts compare likely period outcomes with the assigned target.</p></div>
        {canManage && <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700">Manager controls</span>}
      </div>

      {error && <p className="m-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading ? <p className="p-8 text-center text-sm text-gray-500">Calculating goal progress…</p> : <div className="grid gap-4 p-5 lg:grid-cols-2">{goals.length ? goals.map(goal => <GoalCard key={goal.id} goal={goal} definition={definitions[goal.metric]} canManage={canManage} onEdit={() => edit(goal)} onArchive={() => archive(goal)} />) : <p className="rounded-xl bg-gray-50 p-8 text-center text-sm text-gray-500 lg:col-span-2">No active goals have been assigned.</p>}</div>}

      {canManage && <form onSubmit={submit} className="border-t border-gray-200 bg-gray-50/70 p-5"><div className="flex items-center gap-2"><Plus className="h-4 w-4 text-indigo-600" /><h3 className="font-bold text-gray-900">{editingId ? 'Edit goal' : 'Create goal or quota'}</h3></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Name"><input required maxLength={160} value={form.name} onChange={event => update('name', event.target.value)} /></Field><Field label="Metric"><select value={form.metric} onChange={event => update('metric', event.target.value)}>{METRICS.map(metric => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></Field><Field label="Scope"><select value={form.scope} onChange={event => update('scope', event.target.value)}><option value="team">Team</option><option value="owner">Individual owner</option></select></Field>{form.scope === 'owner' && <Field label="Owner"><select required value={form.owner_user_id} onChange={event => update('owner_user_id', event.target.value)}><option value="">Select owner</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.email || member.user_id}</option>)}</select></Field>}<Field label={form.metric === 'deals_won' ? 'Target deals' : 'Target value'}><input required type="number" min={form.metric === 'deals_won' ? 1 : 0.01} step={form.metric === 'deals_won' ? 1 : 0.01} value={form.target_value} onChange={event => update('target_value', event.target.value)} /></Field><Field label="Currency"><input required pattern="[A-Za-z]{3}" maxLength={3} value={form.currency} onChange={event => update('currency', event.target.value.toUpperCase())} /></Field><Field label="Period start"><input required type="date" max={form.period_end} value={form.period_start} onChange={event => update('period_start', event.target.value)} /></Field><Field label="Period end"><input required type="date" min={form.period_start} value={form.period_end} onChange={event => update('period_end', event.target.value)} /></Field></div><div className="mt-4 flex flex-wrap justify-end gap-2">{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyGoal(defaultCurrency)); }} className="crm-btn crm-btn-secondary">Cancel</button>}<button type="submit" disabled={saving} className="crm-btn crm-btn-primary">{saving ? 'Saving…' : editingId ? 'Update goal' : 'Create goal'}</button></div></form>}
    </section>
  );
}

function GoalCard({ goal, definition, canManage, onEdit, onArchive }) {
  const progress = goal.progress || {};
  const unit = goal.metricDefinition?.unit || definition?.unit;
  const format = value => unit === 'count' ? Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0) : money(value, goal.currency);
  const attainment = Math.max(0, Number(progress.attainmentPercent || 0));
  const elapsed = Math.max(0, Math.min(100, Number(progress.elapsedPercent || 0)));
  return <article className="rounded-2xl border border-gray-200 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">{goal.scope === 'team' ? 'Team goal' : goal.owner_email || goal.owner_user_id}</p><h3 className="mt-1 text-lg font-bold text-gray-950">{goal.name}</h3><p className="mt-1 text-xs text-gray-500">{dateOnly(goal.period_start)} – {dateOnly(goal.period_end)} · {goal.currency}</p></div>{canManage && <div className="flex gap-1"><button type="button" onClick={onEdit} aria-label={`Edit ${goal.name}`} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><Edit2 className="h-4 w-4" /></button><button type="button" onClick={onArchive} aria-label={`Archive ${goal.name}`} className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"><Archive className="h-4 w-4" /></button></div>}</div><div className="mt-5 grid grid-cols-3 gap-3"><MiniMetric label="Actual" value={format(progress.actual)} /><MiniMetric label="Target" value={format(progress.target)} /><MiniMetric label="Forecast" value={format(progress.forecast)} /></div><div className="mt-5"><div className="flex justify-between text-xs font-semibold text-gray-600"><span>{attainment.toFixed(1)}% attained</span><span>{elapsed.toFixed(1)}% of period elapsed</span></div><div className="relative mt-2 h-3 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(attainment, 100)}%` }} /><span className="absolute inset-y-0 w-0.5 bg-gray-900" style={{ left: `${elapsed}%` }} /></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><StatusLine icon={Gauge} label={paceLabel(progress.paceStatus)} tone={progress.paceStatus === 'behind' ? 'red' : 'green'} /><StatusLine icon={TrendingUp} label={progress.forecastStatus === 'projected_to_hit' ? `Forecast reaches ${Number(progress.forecastAttainmentPercent || 0).toFixed(1)}%` : `Forecast reaches ${Number(progress.forecastAttainmentPercent || 0).toFixed(1)}%`} tone={progress.forecastStatus === 'projected_to_hit' ? 'green' : 'red'} /></div><p className="mt-3 text-xs leading-5 text-gray-500">{definition?.definition || goal.metricDefinition?.definition} Remaining pace: {format(progress.requiredPerRemainingDay)} per day across {progress.remainingDays || 0} days.</p></article>;
}

function emptyGoal(currency) { const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 0)); return { name: '', scope: 'team', owner_user_id: '', metric: 'won_revenue', currency: currency || 'USD', target_value: '', period_start: dateOnly(start), period_end: dateOnly(end) }; }
function dateOnly(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10); }
function money(value, currency) { try { return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0)); } catch { return `${currency} ${Number(value || 0).toFixed(0)}`; } }
function paceLabel(status) { return ({ upcoming: 'Goal period has not started', complete: 'Quota attained', on_track: 'On pace', behind: 'Behind required pace' })[status] || 'Pace unavailable'; }
function Field({ label, children }) { return <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">{label}{React.cloneElement(children, { className: 'crm-field mt-1 w-full normal-case tracking-normal' })}</label>; }
function MiniMetric({ label, value }) { return <div className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 truncate text-sm font-bold text-gray-950">{value}</p></div>; }
function StatusLine({ icon: Icon, label, tone }) { return <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><Icon className="h-4 w-4" />{label}{tone === 'green' && <CheckCircle2 className="ml-auto h-3.5 w-3.5" />}</div>; }
