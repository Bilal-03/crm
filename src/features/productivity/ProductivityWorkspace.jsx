import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  ListTodo,
  Plus,
  RefreshCw,
  Search,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { ErrorState, LoadingState, ResourceEmptyState } from '../../components/ui/ResourceState.jsx';

const BUCKETS = [
  { id: 'today', label: 'My Day' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
];

const IMPORT_RESOURCES = ['leads', 'contacts', 'accounts', 'customers'];
const DUPLICATE_RESOURCES = ['leads', 'contacts', 'accounts', 'customers'];
const IMPORT_FIELDS = {
  leads: ['name', 'email', 'company', 'phone', 'source', 'stage'],
  contacts: ['name', 'email', 'phone', 'title', 'account_id', 'owner_user_id'],
  accounts: ['name', 'domain', 'phone', 'website', 'industry', 'owner_user_id'],
  customers: ['name', 'email', 'company', 'phone'],
};

export default function ProductivityWorkspace({ request, leads = [], accounts = [], contacts = [], deals = [], onNotify }) {
  const [bucket, setBucket] = useState('today');
  const [activities, setActivities] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(null);
  const [selectedActivities, setSelectedActivities] = useState([]);
  const [members, setMembers] = useState([]);
  const [myRecords, setMyRecords] = useState({ leads: [], contacts: [], accounts: [], deals: [], invoices: [] });
  const [myRecordsLoading, setMyRecordsLoading] = useState(true);
  const [activityForm, setActivityForm] = useState({ type: 'task', subject: '', description: '', due_at: '', priority: 'normal', target: '' });
  const [noteForm, setNoteForm] = useState({ body: '', target: '' });
  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState('');
  const [shareView, setShareView] = useState(false);
  const [importResource, setImportResource] = useState('leads');
  const [importRows, setImportRows] = useState([]);
  const [importMapping, setImportMapping] = useState({});
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [duplicateResource, setDuplicateResource] = useState('leads');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [mergeSelections, setMergeSelections] = useState({});

  const recordOptions = useMemo(() => [
    ...leads.map(record => ({ ...record, resource: 'lead', label: `Lead · ${record.name}` })),
    ...accounts.map(record => ({ ...record, resource: 'account', label: `Account · ${record.name}` })),
    ...contacts.map(record => ({ ...record, resource: 'contact', label: `Contact · ${record.name}` })),
    ...deals.map(record => ({ ...record, resource: 'deal', label: `Deal · ${record.name}` })),
  ], [leads, accounts, contacts, deals]);

  const targetPayload = target => {
    if (!target) return {};
    const separator = target.indexOf(':');
    if (separator < 1) return {};
    const resource = target.slice(0, separator);
    const id = target.slice(separator + 1);
    return id ? { [`${resource}_id`]: id } : {};
  };

  const loadActivities = async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const data = await request(`/activities?bucket=${bucket}&owner=me&pageSize=100`);
      setActivities(Array.isArray(data) ? data : []);
      setSelectedActivities([]);
    } catch (error) {
      setActivityError(error.message || 'Activities could not be loaded.');
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => { void loadActivities(); }, [bucket]);

  useEffect(() => {
    let active = true;
    Promise.all([
      request('/team').catch(() => null),
      request('/saved-views?resource=activities').catch(() => []),
    ]).then(([team, savedViews]) => {
      if (!active) return;
      setMembers(team?.members || []);
      setViews(Array.isArray(savedViews) ? savedViews : []);
    });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    let active = true;
    setMyRecordsLoading(true);
    Promise.all(Object.keys(myRecords).map(resource => request(`/${resource}?owner=me&pageSize=5`).catch(() => [])))
      .then(rows => {
        if (!active) return;
        setMyRecords(Object.fromEntries(Object.keys(myRecords).map((resource, index) => [resource, Array.isArray(rows[index]) ? rows[index] : []])));
      })
      .finally(() => {
        if (active) setMyRecordsLoading(false);
      });
    return () => { active = false; };
  }, [request]);

  const createActivity = async event => {
    event.preventDefault();
    if (!activityForm.subject.trim()) return;
    try {
      await request('/activities', {
        method: 'POST',
        body: {
          type: activityForm.type,
          subject: activityForm.subject.trim(),
          description: activityForm.description.trim() || null,
          due_at: activityForm.due_at ? new Date(activityForm.due_at).toISOString() : null,
          priority: activityForm.priority,
          ...targetPayload(activityForm.target),
        },
      });
      setActivityForm({ type: 'task', subject: '', description: '', due_at: '', priority: 'normal', target: '' });
      onNotify?.('Activity created.');
      await loadActivities();
    } catch (error) {
      onNotify?.(error.message || 'The activity could not be created.', 'error');
    }
  };

  const createNote = async event => {
    event.preventDefault();
    if (!noteForm.body.trim() || !noteForm.target) return;
    try {
      await request('/notes', { method: 'POST', body: { ...targetPayload(noteForm.target), body: noteForm.body.trim() } });
      setNoteForm({ body: '', target: '' });
      onNotify?.('Note saved.');
    } catch (error) {
      onNotify?.(error.message || 'The note could not be saved.', 'error');
    }
  };

  const completeActivity = async activity => {
    try {
      await request(`/activities?id=${activity.id}`, { method: 'PUT', body: { completed: !activity.completed } });
      await loadActivities();
    } catch (error) {
      onNotify?.(error.message || 'The activity could not be updated.', 'error');
    }
  };

  const assignSelected = async ownerUserId => {
    if (!ownerUserId || selectedActivities.length === 0) return;
    try {
      await request('/assign', { method: 'POST', body: { resource: 'activities', ids: selectedActivities, owner_user_id: ownerUserId } });
      onNotify?.('Activities reassigned.');
      await loadActivities();
    } catch (error) {
      onNotify?.(error.message || 'Activities could not be reassigned.', 'error');
    }
  };

  const saveView = async event => {
    event.preventDefault();
    if (!viewName.trim()) return;
    try {
      const view = await request('/saved-views', {
        method: 'POST',
        body: { resource: 'activities', name: viewName.trim(), filters: { bucket }, columns: [], sort: { due: 'asc' }, is_shared: shareView, is_pinned: false },
      });
      setViews(previous => [view, ...previous]);
      setViewName('');
      setShareView(false);
      onNotify?.('Saved view created.');
    } catch (error) {
      onNotify?.(error.message || 'The saved view could not be created.', 'error');
    }
  };

  const previewImport = async () => {
    if (!importRows.length) return;
    setImportBusy(true);
    try {
      const result = await request('/imports', { method: 'POST', body: { resource: importResource, mode: 'preview', rows: importRows, mapping: importMapping } });
      setImportPreview(result);
    } catch (error) {
      onNotify?.(error.message || 'The import preview could not be generated.', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const runImport = async () => {
    if (!importRows.length || importPreview?.summary?.errors) return;
    setImportBusy(true);
    try {
      const result = await request('/imports', { method: 'POST', body: { resource: importResource, mode: 'import', rows: importRows, mapping: importMapping } });
      onNotify?.(`${result.imported || 0} records imported.`);
      setImportRows([]);
      setImportMapping({});
      setImportPreview(null);
    } catch (error) {
      onNotify?.(error.message || 'The import was not applied.', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const loadDuplicates = async () => {
    setDuplicateBusy(true);
    try {
      const data = await request(`/duplicates?resource=${duplicateResource}&limit=50`);
      setDuplicateGroups(Array.isArray(data) ? data : []);
      setMergeSelections({});
    } catch (error) {
      onNotify?.(error.message || 'Duplicate records could not be loaded.', 'error');
    } finally {
      setDuplicateBusy(false);
    }
  };

  const mergeGroup = async group => {
    const survivorId = mergeSelections[group.id] || group.records[0]?.id;
    if (!survivorId) return;
    const duplicateIds = group.records.filter(record => record.id !== survivorId).map(record => record.id);
    setDuplicateBusy(true);
    try {
      await request('/duplicates', { method: 'POST', body: { resource: duplicateResource, survivor_id: survivorId, duplicate_ids: duplicateIds } });
      onNotify?.('Duplicate records merged and linked work preserved.');
      await loadDuplicates();
    } catch (error) {
      onNotify?.(error.message || 'The records could not be merged.', 'error');
    } finally {
      setDuplicateBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Sales productivity</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">My Day</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Work from a single activity queue, keep notes attributed, and maintain clean CRM records.</p>
        </div>
        <button type="button" onClick={loadActivities} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm" aria-label="Activity views">
        <div className="flex flex-wrap gap-2">
          {BUCKETS.map(item => (
            <button key={item.id} type="button" onClick={() => setBucket(item.id)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${bucket === item.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {selectedActivities.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
          <span className="font-semibold">{selectedActivities.length} selected</span>
          <select defaultValue="" onChange={event => assignSelected(event.target.value)} className="min-h-10 rounded-lg border border-indigo-200 bg-white px-3 font-semibold text-gray-700">
            <option value="">Assign to…</option>
            {members.map(member => <option key={member.user_id} value={member.user_id}>{member.email || member.user_id}</option>)}
          </select>
          <button type="button" onClick={() => setSelectedActivities([])} className="ml-auto inline-flex items-center gap-1 font-semibold text-indigo-700"><X className="h-4 w-4" />Clear</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-4">
          {activityLoading && <LoadingState label="Loading activities…" />}
          {activityError && <ErrorState message={activityError} onRetry={loadActivities} />}
          {!activityLoading && !activityError && activities.length === 0 && <ResourceEmptyState title="No activities in this view" description="Create a task, call, meeting, or email to keep the next step visible." />}
          {!activityLoading && !activityError && activities.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4"><p className="text-sm font-semibold text-gray-900">{BUCKETS.find(item => item.id === bucket)?.label} activities</p><p className="mt-1 text-xs text-gray-500">Assigned to you · workspace timezone</p></div>
              <div className="divide-y divide-gray-100">
                {activities.map(activity => {
                  const target = activity.lead || activity.account || activity.contact || activity.deal;
                  const checked = selectedActivities.includes(activity.id);
                  return (
                    <article key={activity.id} className="flex gap-3 px-5 py-4 hover:bg-gray-50">
                      <input type="checkbox" aria-label={`Select ${activity.subject}`} checked={checked} onChange={() => setSelectedActivities(previous => checked ? previous.filter(id => id !== activity.id) : [...previous, activity.id])} className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                      <button type="button" onClick={() => completeActivity(activity)} aria-label={activity.completed ? `Reopen ${activity.subject}` : `Complete ${activity.subject}`} className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${activity.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}>
                        {activity.completed ? <Check className="h-4 w-4" /> : <ListTodo className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className={`font-semibold ${activity.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{activity.subject}</h2><span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">{activity.type}</span></div>
                        {activity.description && <p className="mt-1 text-sm text-gray-600">{activity.description}</p>}
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{activity.due_at ? formatDateTime(activity.due_at) : 'No due date'}</span>{target && <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{target.name || 'Linked record'}</span>}<span className="font-semibold capitalize text-gray-600">{activity.priority}</span></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-600" /><h2 className="font-semibold text-gray-900">New activity</h2></div>
            <form onSubmit={createActivity} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-600">Type<select value={activityForm.type} onChange={event => setActivityForm(previous => ({ ...previous, type: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"><option value="task">Task</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option></select></label><label className="text-xs font-semibold text-gray-600">Priority<select value={activityForm.priority} onChange={event => setActivityForm(previous => ({ ...previous, priority: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
              <label className="block text-xs font-semibold text-gray-600">Subject<input value={activityForm.subject} onChange={event => setActivityForm(previous => ({ ...previous, subject: event.target.value }))} required maxLength={200} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" placeholder="Follow up on proposal" /></label>
              <label className="block text-xs font-semibold text-gray-600">Due date<input type="datetime-local" value={activityForm.due_at} onChange={event => setActivityForm(previous => ({ ...previous, due_at: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" /></label>
              <label className="block text-xs font-semibold text-gray-600">Related record<select value={activityForm.target} onChange={event => setActivityForm(previous => ({ ...previous, target: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"><option value="">No linked record</option>{recordOptions.map(record => <option key={`${record.resource}:${record.id}`} value={`${record.resource}:${record.id}`}>{record.label}</option>)}</select></label>
              <label className="block text-xs font-semibold text-gray-600">Description<textarea value={activityForm.description} onChange={event => setActivityForm(previous => ({ ...previous, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /></label>
              <button type="submit" className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Create activity</button>
            </form>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-600" /><h2 className="font-semibold text-gray-900">Attributed note</h2></div>
            <form onSubmit={createNote} className="mt-4 space-y-3"><label className="block text-xs font-semibold text-gray-600">Related record<select value={noteForm.target} onChange={event => setNoteForm(previous => ({ ...previous, target: event.target.value }))} required className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"><option value="">Choose a record</option>{recordOptions.map(record => <option key={`${record.resource}:${record.id}`} value={`${record.resource}:${record.id}`}>{record.label}</option>)}</select></label><textarea value={noteForm.body} onChange={event => setNoteForm(previous => ({ ...previous, body: event.target.value }))} required rows={3} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="What should the team remember?" /><button type="submit" className="min-h-10 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Save note</button></form>
          </section>
        </aside>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-3"><PanelHeading icon={Users} title="My records" /><p className="mt-1 text-sm text-gray-500">Records assigned to you across the workspace.</p>{myRecordsLoading ? <p className="mt-4 text-sm text-gray-500">Loading assigned records…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(myRecords).map(([resource, rows]) => <div key={resource} className="rounded-xl bg-gray-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">{resource}</p><p className="mt-1 text-2xl font-bold text-gray-950">{rows.length}</p><p className="mt-1 truncate text-xs text-gray-500">{rows[0]?.name || rows[0]?.invoice_number || (rows.length ? 'Assigned records' : 'None yet')}</p></div>)}</div>}</section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><PanelHeading icon={ListTodo} title="Saved views" /><form onSubmit={saveView} className="mt-4 flex flex-wrap gap-2"><input value={viewName} onChange={event => setViewName(event.target.value)} placeholder="View name" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm" /><button type="submit" className="min-h-10 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white">Save</button></form><label className="mt-3 flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={shareView} onChange={event => setShareView(event.target.checked)} className="rounded border-gray-300" />Share with workspace</label><div className="mt-4 space-y-2">{views.length === 0 ? <p className="text-sm text-gray-500">No saved activity views yet.</p> : views.map(view => <div key={view.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="font-medium text-gray-800">{view.name}</span><span className="text-xs text-gray-500">{view.is_shared ? 'Team' : 'Private'}</span></div>)}</div></section>
        <ImportPanel resource={importResource} setResource={setImportResource} rows={importRows} setRows={setImportRows} mapping={importMapping} setMapping={setImportMapping} preview={importPreview} busy={importBusy} onPreview={previewImport} onImport={runImport} />
        <DuplicatePanel resource={duplicateResource} setResource={setDuplicateResource} groups={duplicateGroups} busy={duplicateBusy} selections={mergeSelections} setSelections={setMergeSelections} onLoad={loadDuplicates} onMerge={mergeGroup} />
      </div>
    </div>
  );
}

function PanelHeading({ icon: Icon, title }) {
  return <div className="flex items-center gap-2"><Icon className="h-5 w-5 text-indigo-600" /><h2 className="font-semibold text-gray-900">{title}</h2></div>;
}

function ImportPanel({ resource, setResource, rows, setRows, mapping, setMapping, preview, busy, onPreview, onImport }) {
  const readFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isSpreadsheet = /\.(xlsx|xls)$/i.test(file.name);
    let parsedRows;
    if (isSpreadsheet) {
      const module = await import('xlsx');
      const xlsx = module.utils ? module : module.default;
      const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      parsedRows = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      parsedRows = parseCsv(await file.text());
    } else {
      return;
    }
    setRows(parsedRows);
    const headers = Object.keys(parsedRows[0] || {});
    setMapping(Object.fromEntries(IMPORT_FIELDS[resource].filter(field => headers.includes(field)).map(field => [field, field])));
  };
  const headers = Object.keys(rows[0] || {});
  return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><PanelHeading icon={Upload} title="Import data" /><div className="mt-4 space-y-3"><select value={resource} onChange={event => { setResource(event.target.value); setMapping({}); }} className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm">{IMPORT_RESOURCES.map(item => <option key={item} value={item}>{item}</option>)}</select><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"><Upload className="h-4 w-4" />Choose CSV or XLSX<input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={readFile} className="sr-only" /></label><p className="text-xs text-gray-500">Map columns, preview validation, then import in one transaction.</p>{rows.length > 0 && <><p className="text-sm text-gray-700">{rows.length} rows loaded.</p><div className="max-h-36 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3">{IMPORT_FIELDS[resource].map(field => <label key={field} className="flex items-center gap-2 text-xs font-semibold text-gray-600"><span className="w-28 shrink-0">{field}</span><select value={mapping[field] || ''} onChange={event => setMapping(previous => ({ ...previous, [field]: event.target.value }))} className="min-h-8 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 text-xs"><option value="">Not mapped</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></>}<div className="flex gap-2"><button type="button" disabled={!rows.length || busy} onClick={onPreview} className="min-h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 disabled:opacity-50">{busy ? 'Checking…' : 'Preview'}</button><button type="button" disabled={!preview || preview.summary?.errors > 0 || busy} onClick={onImport} className="min-h-10 flex-1 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-50">Import</button></div>{preview && <div className={`rounded-lg p-3 text-xs ${preview.summary?.errors ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}><p className="font-semibold">{preview.summary?.ready || 0} ready · {preview.summary?.errors || 0} errors</p>{preview.errors?.slice(0, 2).map(error => <p key={`${error.row}-${error.field}`} className="mt-1">Row {error.row}: {error.message}</p>)}</div>}</div></section>;
}

function DuplicatePanel({ resource, setResource, groups, busy, selections, setSelections, onLoad, onMerge }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><PanelHeading icon={Users} title="Duplicate review" /><div className="mt-4 flex gap-2"><select value={resource} onChange={event => setResource(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm">{DUPLICATE_RESOURCES.map(item => <option key={item} value={item}>{item}</option>)}</select><button type="button" onClick={onLoad} disabled={busy} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 disabled:opacity-50"><Search className="h-4 w-4" />Scan</button></div>{groups.length === 0 ? <p className="mt-4 text-sm text-gray-500">Run a scan to review possible duplicates.</p> : <div className="mt-4 space-y-3">{groups.map(group => <div key={group.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Matches: {group.reasons.join(', ')}</p><select value={selections[group.id] || group.records[0].id} onChange={event => setSelections(previous => ({ ...previous, [group.id]: event.target.value }))} className="mt-2 min-h-9 w-full rounded-lg border border-amber-200 bg-white px-2 text-xs">{group.records.map(record => <option key={record.id} value={record.id}>{record.name || record.email || record.id}</option>)}</select><div className="mt-2 overflow-x-auto"><table className="min-w-full text-xs"><tbody>{group.fields.slice(0, 5).map(field => <tr key={field}><td className="pr-2 py-1 font-semibold text-amber-900">{field}</td>{group.records.map(record => <td key={record.id} className="px-2 py-1 text-gray-700">{String(record[field] ?? '—')}</td>)}</tr>)}</tbody></table></div><button type="button" onClick={() => onMerge(group)} disabled={busy} className="mt-3 min-h-9 rounded-lg bg-amber-700 px-3 text-xs font-semibold text-white disabled:opacity-50">Merge into selected record</button></div>)}</div>}</section>;
}

function formatDateTime(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = []; cell = ''; continue;
    }
    cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(value => value)) rows.push(row); }
  const [header, ...data] = rows;
  return (data || []).map(values => Object.fromEntries((header || []).map((key, index) => [key, values[index] || ''])));
}
