import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Pause, Play, Plus, RefreshCw, RotateCcw, Workflow } from 'lucide-react';
import { ErrorState, LoadingState } from '../../components/ui/ResourceState.jsx';

const TRIGGERS = [
  ['lead_created', 'Lead created'],
  ['deal_stage_changed', 'Deal stage changed'],
  ['activity_overdue', 'Activity overdue'],
  ['invoice_overdue', 'Invoice overdue'],
  ['deal_won', 'Deal won'],
];
const ACTIONS = [
  ['assign_owner', 'Assign owner'],
  ['create_activity', 'Create activity'],
  ['create_notification', 'Create notification'],
  ['send_template_email', 'Send template email'],
  ['update_stage', 'Update deal stage'],
];

export default function AutomationsWorkspace({ request, members = [], pipelines = [], onNotify }) {
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyRule);
  const stages = useMemo(() => pipelines.flatMap(pipeline => (pipeline.stages || []).map(stage => ({ ...stage, pipelineName: pipeline.name }))), [pipelines]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [automationData, templateRows] = await Promise.all([
        request('/automations?pageSize=100'),
        request('/email-templates?pageSize=100&state=active'),
      ]);
      setData(automationData);
      setTemplates(templateRows || []);
    } catch (loadError) {
      setError(loadError.message || 'Automations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      await request('/automations', { method: 'POST', body: buildRule(form) });
      setForm(emptyRule());
      onNotify?.('Automation created. New matching events will run automatically.');
      await load();
    } catch (saveError) {
      onNotify?.(saveError.message || 'Automation could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (rule, status) => {
    try {
      await request(`/automations?id=${rule.id}`, { method: 'PUT', body: { status } });
      onNotify?.(`Automation ${status === 'active' ? 'activated' : 'paused'}.`);
      await load();
    } catch (updateError) { onNotify?.(updateError.message || 'Automation could not be updated.', 'error'); }
  };

  const archive = async rule => {
    try {
      await request(`/automations?id=${rule.id}`, { method: 'DELETE' });
      onNotify?.('Automation archived.');
      await load();
    } catch (updateError) { onNotify?.(updateError.message || 'Automation could not be archived.', 'error'); }
  };

  const runNow = async () => {
    setSaving(true);
    try {
      const result = await request('/automations', { method: 'PUT', body: { action: 'run_now' } });
      onNotify?.(`Automation worker processed ${result.processed || 0} job(s).`);
      await load();
    } catch (runError) { onNotify?.(runError.message || 'Automation worker could not run.', 'error'); }
    finally { setSaving(false); }
  };

  const retry = async job => {
    try {
      await request('/automations', { method: 'PUT', body: { action: 'retry_job', job_id: job.id } });
      onNotify?.('Dead-letter job queued for retry.');
      await runNow();
    } catch (retryError) { onNotify?.(retryError.message || 'Job could not be retried.', 'error'); }
  };

  if (loading && !data) return <LoadingState label="Loading workflow automations…" />;
  if (error && !data) return <ErrorState title="Automations unavailable" message={error} onRetry={load} />;
  const rules = data?.rules || [];
  const jobs = data?.jobs || [];
  const audit = data?.audit || [];

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Workflow engine</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Automations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">Run constrained trigger → condition → action workflows with idempotent jobs, retry backoff and visible dead letters.</p></div>
      <div className="flex gap-2"><button type="button" onClick={load} className="crm-btn crm-btn-secondary"><RefreshCw className="h-4 w-4" />Refresh</button>{data?.canManage && <button type="button" disabled={saving} onClick={runNow} className="crm-btn crm-btn-primary"><Play className="h-4 w-4" />Run now</button>}</div>
    </header>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

    {data?.canManage && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-gray-950">Create automation</h2></div>
      <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="Name"><input required maxLength={160} value={form.name} onChange={event => update(setForm, 'name', event.target.value)} /></Field>
        <Field label="Trigger"><select value={form.trigger_type} onChange={event => update(setForm, 'trigger_type', event.target.value)}>{TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Optional condition field"><input value={form.condition_field} onChange={event => update(setForm, 'condition_field', event.target.value)} placeholder="status, amount, owner_user_id…" /></Field>
        <div className="grid grid-cols-[140px_1fr] gap-3"><Field label="Operator"><select value={form.condition_operator} onChange={event => update(setForm, 'condition_operator', event.target.value)}>{['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Value"><input value={form.condition_value} onChange={event => update(setForm, 'condition_value', event.target.value)} disabled={!form.condition_field || form.condition_operator === 'exists'} /></Field></div>
        <Field label="Action"><select value={form.action_type} onChange={event => update(setForm, 'action_type', event.target.value)}>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <ActionFields form={form} setForm={setForm} members={members} templates={templates} stages={stages} />
        <button type="submit" disabled={saving} className="crm-btn crm-btn-primary lg:col-span-2"><Workflow className="h-4 w-4" />{saving ? 'Saving…' : 'Create automation'}</button>
      </form>
    </section>}

    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-950">Rules</h2><p className="mt-1 text-sm text-gray-500">Paused and archived rules never receive new jobs.</p></div>
      <div className="divide-y divide-gray-100">{rules.length ? rules.map(rule => <article key={rule.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Status status={rule.status} /><h3 className="font-bold text-gray-950">{rule.name}</h3></div><p className="mt-1 text-sm text-gray-600">{labelFor(TRIGGERS, rule.trigger_type)} → {(rule.actions || []).map(action => labelFor(ACTIONS, action.type)).join(', ')}</p><p className="mt-2 text-xs text-gray-400">{rule.run_count || 0} runs · {rule.succeeded_count || 0} succeeded · {rule.failed_count || 0} dead letter{rule.last_run_at ? ` · last ${new Date(rule.last_run_at).toLocaleString()}` : ''}</p></div>{data?.canManage && rule.status !== 'archived' && <div className="flex gap-2"><button type="button" onClick={() => setStatus(rule, rule.status === 'active' ? 'paused' : 'active')} className="crm-btn crm-btn-secondary">{rule.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{rule.status === 'active' ? 'Pause' : 'Activate'}</button><button type="button" onClick={() => archive(rule)} className="crm-btn crm-btn-secondary"><Archive className="h-4 w-4" />Archive</button></div>}</article>) : <p className="p-10 text-center text-sm text-gray-500">No automation rules yet.</p>}</div>
    </section>

    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-950">Recent jobs</h2><p className="mt-1 text-sm text-gray-500">Failures retry with exponential backoff; exhausted jobs stay visible for manual recovery.</p></div>
      <div className="divide-y divide-gray-100">{jobs.length ? jobs.map(job => <article key={job.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><JobStatus status={job.status} /><p className="font-bold text-gray-900">{job.rule_name}</p></div><p className="mt-1 text-sm text-gray-500">{labelFor(TRIGGERS, job.trigger_type)} · {job.entity_type} · attempt {job.attempts}/{job.max_attempts}</p>{job.last_error && <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{job.last_error}</p>}</div>{job.status === 'dead_letter' && data?.canManage && <button type="button" onClick={() => retry(job)} className="crm-btn crm-btn-secondary"><RotateCcw className="h-4 w-4" />Retry</button>}</article>) : <p className="p-10 text-center text-sm text-gray-500">No automation jobs have run.</p>}</div>
    </section>

    {data?.canManage && <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-5"><h2 className="text-lg font-bold text-gray-950">Change audit</h2><p className="mt-1 text-sm text-gray-500">Manager-only rule and recovery history with request IDs for incident correlation.</p></div>
      <div className="divide-y divide-gray-100">{audit.length ? audit.map(event => <article key={event.id} className="p-5"><p className="font-semibold text-gray-900">{event.action}</p><p className="mt-1 text-xs text-gray-500">{new Date(event.created_at).toLocaleString()} · actor {event.actor_user_id || 'system'}{event.request_id ? ` · request ${event.request_id}` : ''}</p></article>) : <p className="p-10 text-center text-sm text-gray-500">No automation changes recorded.</p>}</div>
    </section>}
  </div>;
}

function ActionFields({ form, setForm, members, templates, stages }) {
  if (form.action_type === 'assign_owner') return <MemberField label="New owner" value={form.owner_user_id} onChange={value => update(setForm, 'owner_user_id', value)} members={members} required />;
  if (form.action_type === 'create_activity') return <div className="grid gap-3 sm:grid-cols-2"><Field label="Activity subject"><input required value={form.subject} onChange={event => update(setForm, 'subject', event.target.value)} /></Field><MemberField label="Activity owner (optional)" value={form.owner_user_id} onChange={value => update(setForm, 'owner_user_id', value)} members={members} /></div>;
  if (form.action_type === 'create_notification') return <div className="grid gap-3 sm:grid-cols-2"><Field label="Notification title"><input required value={form.title} onChange={event => update(setForm, 'title', event.target.value)} /></Field><MemberField label="Recipient (optional)" value={form.recipient_user_id} onChange={value => update(setForm, 'recipient_user_id', value)} members={members} /></div>;
  if (form.action_type === 'send_template_email') return <Field label="Email template"><select required value={form.template_id} onChange={event => update(setForm, 'template_id', event.target.value)}><option value="">Select template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>;
  return <Field label="Deal stage"><select required value={form.stage_id} onChange={event => update(setForm, 'stage_id', event.target.value)}><option value="">Select stage</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.pipelineName} · {stage.name}</option>)}</select></Field>;
}

function MemberField({ label, value, onChange, members, required = false }) { return <Field label={label}><select required={required} value={value} onChange={event => onChange(event.target.value)}><option value="">{required ? 'Select member' : 'Use event owner'}</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.email || member.user_id} · {member.role}</option>)}</select></Field>; }
function Field({ label, children }) { return <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">{label}{React.cloneElement(children, { className: 'crm-field mt-1 w-full normal-case tracking-normal' })}</label>; }
function Status({ status }) { return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${status === 'active' ? 'bg-emerald-50 text-emerald-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{status}</span>; }
function JobStatus({ status }) { const good = status === 'succeeded'; return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${good ? 'bg-emerald-50 text-emerald-700' : status === 'dead_letter' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{good && <CheckCircle2 className="h-3 w-3" />}{status}</span>; }
function labelFor(items, value) { return items.find(item => item[0] === value)?.[1] || value; }
function update(setter, field, value) { setter(previous => ({ ...previous, [field]: value })); }
function emptyRule() { return { name: '', trigger_type: 'lead_created', condition_field: '', condition_operator: 'eq', condition_value: '', action_type: 'create_activity', owner_user_id: '', recipient_user_id: '', subject: '', title: '', template_id: '', stage_id: '' }; }
function buildRule(form) {
  const condition = form.condition_field ? [{ field: form.condition_field.trim(), operator: form.condition_operator, value: form.condition_operator === 'exists' ? true : scalar(form.condition_value) }] : [];
  const action = { type: form.action_type };
  if (form.action_type === 'assign_owner') action.owner_user_id = form.owner_user_id;
  if (form.action_type === 'create_activity') Object.assign(action, { subject: form.subject, ...(form.owner_user_id ? { owner_user_id: form.owner_user_id } : {}) });
  if (form.action_type === 'create_notification') Object.assign(action, { title: form.title, ...(form.recipient_user_id ? { recipient_user_id: form.recipient_user_id } : {}) });
  if (form.action_type === 'send_template_email') action.template_id = form.template_id;
  if (form.action_type === 'update_stage') action.stage_id = form.stage_id;
  return { name: form.name, trigger_type: form.trigger_type, conditions: { all: condition }, actions: [action], status: 'active' };
}
function scalar(value) { if (value === 'true') return true; if (value === 'false') return false; if (value !== '' && Number.isFinite(Number(value))) return Number(value); return value; }
